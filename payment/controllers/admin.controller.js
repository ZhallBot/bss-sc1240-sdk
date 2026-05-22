/**
 * @file admin.controller.js
 * @description Admin Controller — Force-Open Lock & Transaction Management
 *
 * Provides admin override capabilities for:
 *   - Force opening a barrier when payment succeeded but hardware is offline
 *   - Listing and filtering transactions for the dashboard
 */

'use strict';

const ParkingTransaction      = require('../models/ParkingTransaction');
const HardwareService         = require('../services/hardware.service');
const TransactionStateMachine = require('../services/stateMachine.service');
const RetryQueue              = require('../services/retryQueue.service');
const { AppError }            = require('../utils/errors');

/* ─────────────────────────────────────────────
 * POST /api/v1/admin/locks/:lock_id/force-open
 *
 * Called by admin dashboard when:
 *   - Payment confirmed but hardware offline (HARDWARE_PENDING)
 *   - Retry queue exhausted (MANUAL_NEEDED)
 *
 * Body: { transaction_id: string }
 * ───────────────────────────────────────────── */
async function forceOpenLock(req, res, next) {
    try {
        const { lock_id }       = req.params;
        const { transaction_id } = req.body;
        const admin_id           = req.user?.id || 'system';

        if (!transaction_id) {
            throw new AppError('transaction_id is required in request body', 400);
        }

        // Load and validate transaction
        const txn = await ParkingTransaction.findOne({ transaction_id, lock_id });
        if (!txn) {
            throw new AppError(`Transaction ${transaction_id} not found for lock ${lock_id}`, 404);
        }

        if (!TransactionStateMachine.canForceOpen(txn.status)) {
            throw new AppError(
                `Force open not allowed in status: ${txn.status}. ` +
                `Allowed states: PAID, HARDWARE_PENDING, MANUAL_NEEDED`,
                409
            );
        }

        // Cancel any existing retry job
        RetryQueue.cancel(transaction_id);

        // Attempt hardware command
        let hardwareSuccess = false;
        let hardwareError   = null;

        try {
            await HardwareService.lowerLock(lock_id);
            hardwareSuccess = true;
        } catch (err) {
            hardwareError = err.message;
            console.error(`[Admin] Force-open hardware failed for ${lock_id}: ${err.message}`);
        }

        // Transition state regardless of hardware success
        // (Admin has authorised the override — update records)
        await TransactionStateMachine.transitionTo(txn, 'LOCK_LOWERED', {
            lock_lowered_at:   new Date(),
            force_opened_by:   admin_id,
            force_open_reason: hardwareSuccess ? 'admin_command' : 'admin_override_hardware_failed',
        });

        return res.status(200).json({
            success:         true,
            transaction_id,
            lock_id,
            hardware_executed: hardwareSuccess,
            hardware_error:    hardwareError,
            status:          'LOCK_LOWERED',
            forced_by:       admin_id,
            timestamp:       new Date().toISOString(),
            message:         hardwareSuccess
                ? `Lock ${lock_id} opened successfully.`
                : `Database updated but hardware command failed: ${hardwareError}. Physical inspection required.`,
        });

    } catch (err) {
        next(err);
    }
}

/* ─────────────────────────────────────────────
 * GET /api/v1/admin/transactions
 * Query params:
 *   status    - filter by state
 *   lock_id   - filter by lock
 *   date_from - ISO date
 *   date_to   - ISO date
 *   limit     - default 50, max 200
 *   offset    - pagination
 * ───────────────────────────────────────────── */
async function listTransactions(req, res, next) {
    try {
        const {
            status,
            lock_id,
            date_from,
            date_to,
            limit  = 50,
            offset = 0,
        } = req.query;

        const query = {};
        if (status)    query.status  = status;
        if (lock_id)   query.lock_id = lock_id;
        if (date_from || date_to) {
            query.checkout_time = {};
            if (date_from) query.checkout_time.$gte = new Date(date_from);
            if (date_to)   query.checkout_time.$lte = new Date(date_to);
        }

        const [transactions, total] = await Promise.all([
            ParkingTransaction
                .find(query)
                .sort({ checkout_time: -1 })
                .skip(Number(offset))
                .limit(Math.min(Number(limit), 200))
                .lean(),
            ParkingTransaction.countDocuments(query),
        ]);

        return res.status(200).json({
            total,
            limit:  Number(limit),
            offset: Number(offset),
            data:   transactions,
            retry_queue: RetryQueue.listActive(),
        });

    } catch (err) {
        next(err);
    }
}

module.exports = { forceOpenLock, listTransactions };

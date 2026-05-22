/**
 * @file checkout.controller.js
 * @description Module 1 — Dynamic QRIS Generator (Transaction Initiation)
 *
 * POST /api/v1/parking/checkout
 *
 * End-to-End Flow:
 *   1. Validate request (lock_id, entry_time)
 *   2. Check for existing active/pending transaction → reject duplicate
 *   3. Calculate parking fee (duration × tariff)
 *   4. Call Payment Gateway API to create Dynamic QRIS
 *   5. Persist transaction record in DB (state: PENDING)
 *   6. Return QRIS data to caller
 *   7. Start expiry watchdog (15 min)
 */

'use strict';

const { v4: uuidv4 }       = require('uuid');
const ParkingTransaction   = require('../models/ParkingTransaction');
const PaymentGateway       = require('../services/paymentGateway.service');
const HardwareService      = require('../services/hardware.service');
const TransactionStateMachine = require('../services/stateMachine.service');
const { calculateParkingFee } = require('../utils/feeCalculator');
const { AppError }         = require('../utils/errors');

/* ─────────────────────────────────────────────
 * Tariff configuration (in IDR per minute)
 * In production: load from DB / config service
 * ───────────────────────────────────────────── */
const TARIFF_CONFIG = {
    base_fee_idr:        3000,   // Flat fee for first 30 min
    base_duration_min:   30,
    per_hour_idr:        5000,   // After first 30 min
    max_daily_idr:       50000,  // Daily cap
    qris_expiry_sec:     900,    // 15 minutes
};

/* ─────────────────────────────────────────────
 * POST /api/v1/parking/checkout
 *
 * Request Body:
 * {
 *   "lock_id":    "SC1240-A01",
 *   "entry_time": "2026-05-22T08:30:00+08:00",
 *   "plate":      "B 1234 XYZ"   (optional, for receipt)
 * }
 *
 * Response 200:
 * {
 *   "transaction_id": "TXN-...",
 *   "qris_string":    "00020101021226...",
 *   "qris_url":       "https://qris.id/...",
 *   "amount_idr":     8000,
 *   "duration_min":   65,
 *   "expires_at":     "2026-05-22T09:55:00+08:00",
 *   "status":         "PENDING"
 * }
 * ───────────────────────────────────────────── */
async function createCheckout(req, res, next) {
    try {
        const { lock_id, entry_time, plate } = req.body;

        // ── 1. Input validation ───────────────
        if (!lock_id || !entry_time) {
            throw new AppError('lock_id and entry_time are required', 400);
        }

        const entryDate = new Date(entry_time);
        if (isNaN(entryDate.getTime())) {
            throw new AppError('Invalid entry_time format. Use ISO 8601.', 400);
        }

        const now = new Date();
        if (entryDate >= now) {
            throw new AppError('entry_time must be in the past.', 400);
        }

        // ── 2. Duplicate transaction guard ────
        // If there's already a PENDING transaction for this lock, reject.
        const existing = await ParkingTransaction.findOne({
            lock_id,
            status: { $in: ['PENDING', 'QRIS_GENERATED'] },
        });

        if (existing) {
            // Return the existing QRIS if still valid
            if (new Date(existing.expires_at) > now) {
                return res.status(200).json({
                    transaction_id: existing.transaction_id,
                    qris_string:    existing.qris_string,
                    qris_url:       existing.qris_url,
                    amount_idr:     existing.amount_idr,
                    duration_min:   existing.duration_min,
                    expires_at:     existing.expires_at,
                    status:         existing.status,
                    message:        'Existing active QRIS returned.',
                });
            }
            // Expired — transition to EXPIRED state
            await TransactionStateMachine.transitionTo(existing, 'EXPIRED');
        }

        // ── 3. Calculate fee ──────────────────
        const { amount_idr, duration_min } = calculateParkingFee(
            entryDate, now, TARIFF_CONFIG
        );

        // ── 4. Generate transaction ID ────────
        const transaction_id = `TXN-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;
        const expires_at = new Date(now.getTime() + TARIFF_CONFIG.qris_expiry_sec * 1000);

        // ── 5. Call Payment Gateway ───────────
        const pgResponse = await PaymentGateway.createDynamicQris({
            transaction_id,
            amount_idr,
            lock_id,
            plate:       plate || 'UNKNOWN',
            expires_at,
            description: `Parkir BSS - ${lock_id} - ${duration_min} menit`,
        });

        // ── 6. Persist transaction ────────────
        const transaction = await ParkingTransaction.create({
            transaction_id,
            lock_id,
            plate:        plate || null,
            entry_time:   entryDate,
            checkout_time: now,
            duration_min,
            amount_idr,
            qris_string:  pgResponse.qris_string,
            qris_url:     pgResponse.qris_url,
            pg_reference: pgResponse.reference_id,
            expires_at,
            status:       'QRIS_GENERATED',
        });

        // ── 7. Start expiry watchdog ──────────
        scheduleExpiryCheck(transaction_id, TARIFF_CONFIG.qris_expiry_sec * 1000);

        return res.status(200).json({
            transaction_id,
            qris_string:  pgResponse.qris_string,
            qris_url:     pgResponse.qris_url,
            amount_idr,
            duration_min,
            expires_at:   expires_at.toISOString(),
            status:       'QRIS_GENERATED',
        });

    } catch (err) {
        next(err);
    }
}

/* ─────────────────────────────────────────────
 * GET /api/v1/parking/checkout/:transaction_id
 * ───────────────────────────────────────────── */
async function getCheckoutStatus(req, res, next) {
    try {
        const { transaction_id } = req.params;
        const txn = await ParkingTransaction.findOne({ transaction_id }).lean();
        if (!txn) throw new AppError('Transaction not found', 404);

        return res.status(200).json({
            transaction_id:  txn.transaction_id,
            lock_id:         txn.lock_id,
            status:          txn.status,
            amount_idr:      txn.amount_idr,
            duration_min:    txn.duration_min,
            qris_string:     txn.qris_string,
            qris_url:        txn.qris_url,
            expires_at:      txn.expires_at,
            paid_at:         txn.paid_at || null,
            lock_lowered_at: txn.lock_lowered_at || null,
        });
    } catch (err) {
        next(err);
    }
}

/* ─────────────────────────────────────────────
 * POST /api/v1/parking/checkout/:transaction_id/refresh
 * Re-generates QRIS for an EXPIRED transaction (same amount).
 * ───────────────────────────────────────────── */
async function refreshQris(req, res, next) {
    try {
        const { transaction_id } = req.params;
        const now = new Date();

        const txn = await ParkingTransaction.findOne({ transaction_id });
        if (!txn) throw new AppError('Transaction not found', 404);

        if (!['EXPIRED', 'QRIS_GENERATED'].includes(txn.status)) {
            throw new AppError(
                `Cannot refresh QRIS in status: ${txn.status}`, 409
            );
        }

        // Recalculate fee (time has passed since original checkout)
        const { amount_idr, duration_min } = calculateParkingFee(
            new Date(txn.entry_time), now, TARIFF_CONFIG
        );

        const new_expires_at = new Date(now.getTime() + TARIFF_CONFIG.qris_expiry_sec * 1000);

        // Call PG to create a new QRIS with updated amount
        const pgResponse = await PaymentGateway.createDynamicQris({
            transaction_id,    // Keep same transaction_id for idempotency
            amount_idr,
            lock_id:     txn.lock_id,
            plate:       txn.plate || 'UNKNOWN',
            expires_at:  new_expires_at,
            description: `Parkir BSS Refresh - ${txn.lock_id}`,
        });

        // Update transaction record
        await ParkingTransaction.updateOne({ transaction_id }, {
            amount_idr,
            duration_min,
            qris_string:  pgResponse.qris_string,
            qris_url:     pgResponse.qris_url,
            pg_reference: pgResponse.reference_id,
            expires_at:   new_expires_at,
            status:       'QRIS_GENERATED',
            refresh_count: (txn.refresh_count || 0) + 1,
        });

        scheduleExpiryCheck(transaction_id, TARIFF_CONFIG.qris_expiry_sec * 1000);

        return res.status(200).json({
            transaction_id,
            qris_string:  pgResponse.qris_string,
            qris_url:     pgResponse.qris_url,
            amount_idr,
            duration_min,
            expires_at:   new_expires_at.toISOString(),
            status:       'QRIS_GENERATED',
            message:      'QRIS refreshed successfully.',
        });

    } catch (err) {
        next(err);
    }
}

/* ─────────────────────────────────────────────
 * Internal: schedule QRIS expiry transition
 * Uses in-process timer. In production use a
 * job queue (BullMQ / Redis) for persistence.
 * ───────────────────────────────────────────── */
function scheduleExpiryCheck(transaction_id, delayMs) {
    setTimeout(async () => {
        try {
            const txn = await ParkingTransaction.findOne({ transaction_id });
            if (!txn || !['QRIS_GENERATED', 'PENDING'].includes(txn.status)) return;
            await TransactionStateMachine.transitionTo(txn, 'EXPIRED');
            console.log(`[Checkout] QRIS expired: ${transaction_id}`);
        } catch (err) {
            console.error(`[Checkout] Expiry check error for ${transaction_id}:`, err.message);
        }
    }, delayMs);
}

module.exports = { createCheckout, getCheckoutStatus, refreshQris };

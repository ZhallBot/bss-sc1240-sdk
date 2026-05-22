/**
 * @file retryQueue.service.js
 * @description Module 3 — Hardware Retry Queue & Fallback Mechanism
 *
 * When lowerLock() fails (device offline), this service:
 *   1. Enqueues a retry job with exponential backoff
 *   2. Retries every RETRY_INTERVAL_MS for up to MAX_RETRY_DURATION_MS
 *   3. On exhaustion: marks transaction as MANUAL_NEEDED and sends admin alert
 *
 * Architecture:
 *   In-memory queue (this file): suitable for single-instance deployments.
 *   For production / multi-instance: replace with BullMQ + Redis.
 *   Drop-in: set USE_BULLMQ=true in env and install bullmq package.
 *
 * Job schema:
 * {
 *   type:              'LOWER_LOCK',
 *   transaction_id:    string,
 *   lock_id:           string,
 *   max_retries:       number,   // e.g., 20
 *   retry_interval_ms: number,   // e.g., 30000 (30s)
 *   attempt:           number,   // current attempt count
 *   created_at:        ISO string,
 * }
 */

'use strict';

const HardwareService         = require('./hardware.service');
const TransactionStateMachine = require('./stateMachine.service');
const ParkingTransaction      = require('../models/ParkingTransaction');
const AlertService            = require('./alert.service');

/* ─────────────────────────────────────────────
 * In-memory job store (keyed by transaction_id)
 * ───────────────────────────────────────────── */
const activeJobs = new Map();

class RetryQueueService {

    /**
     * Enqueue a hardware retry job.
     * Idempotent: calling enqueue for the same transaction_id twice
     * will cancel the existing job and restart fresh.
     *
     * @param {object} job
     */
    async enqueue(job) {
        const { transaction_id } = job;

        // Cancel existing job for this transaction if any
        if (activeJobs.has(transaction_id)) {
            clearTimeout(activeJobs.get(transaction_id).timerId);
            activeJobs.delete(transaction_id);
        }

        const state = {
            ...job,
            attempt: 0,
            timerId: null,
        };

        console.log(`[RetryQueue] Enqueued job: ${transaction_id} (max ${job.max_retries} retries)`);
        activeJobs.set(transaction_id, state);

        // Start first attempt immediately
        await this._scheduleAttempt(transaction_id);
    }

    /**
     * Cancel a pending retry job (e.g., if admin manually opened the lock).
     * @param {string} transaction_id
     */
    cancel(transaction_id) {
        const job = activeJobs.get(transaction_id);
        if (job?.timerId) clearTimeout(job.timerId);
        activeJobs.delete(transaction_id);
        console.log(`[RetryQueue] Job cancelled: ${transaction_id}`);
    }

    /**
     * List all active retry jobs (for admin dashboard).
     * @returns {Array<object>}
     */
    listActive() {
        return Array.from(activeJobs.values()).map(j => ({
            transaction_id:    j.transaction_id,
            lock_id:           j.lock_id,
            attempt:           j.attempt,
            max_retries:       j.max_retries,
            retry_interval_ms: j.retry_interval_ms,
            created_at:        j.created_at,
        }));
    }

    /* ─────────────────────────────────────────
     * Internal: schedule next attempt with backoff
     * ─────────────────────────────────────────*/
    async _scheduleAttempt(transaction_id) {
        const job = activeJobs.get(transaction_id);
        if (!job) return;

        // Exponential backoff: interval doubles every 5 failures (capped at 5 min)
        const backoffFactor = Math.min(Math.floor(job.attempt / 5), 4);
        const delay = Math.min(
            job.retry_interval_ms * Math.pow(2, backoffFactor),
            300_000    // max 5 minutes between retries
        );

        job.timerId = setTimeout(
            () => this._executeAttempt(transaction_id),
            job.attempt === 0 ? 0 : delay   // First attempt: immediate
        );
    }

    async _executeAttempt(transaction_id) {
        const job = activeJobs.get(transaction_id);
        if (!job) return;

        job.attempt++;
        const { lock_id, max_retries } = job;

        console.log(`[RetryQueue] Attempt ${job.attempt}/${max_retries} for ${transaction_id} → ${lock_id}`);

        try {
            // Attempt hardware command
            await HardwareService.lowerLock(lock_id);

            // ✅ Success
            console.log(`[RetryQueue] ✅ Success on attempt ${job.attempt}: ${transaction_id}`);
            activeJobs.delete(transaction_id);

            // Update transaction state
            const txn = await ParkingTransaction.findOne({ transaction_id });
            if (txn && txn.status === 'HARDWARE_PENDING') {
                await TransactionStateMachine.transitionTo(txn, 'LOCK_LOWERED', {
                    lock_lowered_at: new Date(),
                    retry_attempt:   job.attempt,
                });
            }

        } catch (err) {
            console.warn(`[RetryQueue] ❌ Attempt ${job.attempt} failed for ${lock_id}: ${err.message}`);

            if (job.attempt >= max_retries) {
                // Exhausted all retries
                console.error(`[RetryQueue] 🚨 EXHAUSTED retries for ${transaction_id} — requires manual intervention`);
                activeJobs.delete(transaction_id);

                // Transition to MANUAL_NEEDED
                const txn = await ParkingTransaction.findOne({ transaction_id });
                if (txn) {
                    await TransactionStateMachine.transitionTo(txn, 'MANUAL_NEEDED', {
                        manual_reason: `Hardware unreachable after ${max_retries} retries`,
                    }).catch(() => {});
                }

                // Alert admin
                await AlertService.sendAdminAlert({
                    type:           'HARDWARE_RETRY_EXHAUSTED',
                    transaction_id,
                    lock_id,
                    message:        `Lock ${lock_id} unreachable. Payment was successful but barrier is still raised. Manual opening required.`,
                    timestamp:      new Date().toISOString(),
                });

            } else {
                // Schedule next retry
                await this._scheduleAttempt(transaction_id);
            }
        }
    }
}

module.exports = new RetryQueueService();

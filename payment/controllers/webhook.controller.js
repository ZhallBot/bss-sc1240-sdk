/**
 * @file webhook.controller.js
 * @description Module 2 — Webhook / Callback Handler (Payment Listener)
 *
 * POST /api/v1/payments/webhook
 *
 * Security-critical endpoint. Receives real-time payment notifications
 * from Payment Gateway (Midtrans / Xendit / Dana).
 *
 * Processing pipeline (all steps are atomic or idempotent):
 *   1. HMAC-SHA512 signature verification
 *   2. Parse & validate payload
 *   3. Idempotency check (already processed?)
 *   4. State machine transition: QRIS_GENERATED → PAID
 *   5. Trigger lowerLock() on IoT device via HardwareService
 *   6. If hardware unreachable: enqueue retry job
 *   7. Respond 200 OK immediately (PG retries on non-2xx)
 */

'use strict';

const crypto                  = require('crypto');
const ParkingTransaction      = require('../models/ParkingTransaction');
const HardwareService         = require('../services/hardware.service');
const TransactionStateMachine = require('../services/stateMachine.service');
const RetryQueue              = require('../services/retryQueue.service');
const { AppError }            = require('../utils/errors');

/* ─────────────────────────────────────────────
 * Supported gateway adapters
 * Each adapter normalises gateway-specific
 * payload into a standard WebhookPayload object.
 * ───────────────────────────────────────────── */
const GATEWAY_ADAPTERS = {
    midtrans: require('../adapters/midtrans.adapter'),
    xendit:   require('../adapters/xendit.adapter'),
    dana:     require('../adapters/dana.adapter'),
};

// Configured gateway (from env / config)
const ACTIVE_GATEWAY = process.env.PAYMENT_GATEWAY || 'midtrans';

/* ─────────────────────────────────────────────
 * POST /api/v1/payments/webhook
 *
 * Headers expected (Midtrans example):
 *   X-Callback-Signature: <SHA512 hex>
 *   Content-Type: application/json
 *
 * Body (raw Buffer for HMAC computation):
 *   { see JSON examples in docs }
 * ───────────────────────────────────────────── */
async function handleWebhook(req, res, next) {
    // Respond 200 IMMEDIATELY to prevent gateway retry timeout.
    // All processing is done async after this point.
    res.status(200).json({ received: true });

    // Process asynchronously — any error here is logged, not returned to caller
    processWebhookAsync(req).catch(err => {
        console.error('[Webhook] Unhandled async error:', err.message);
    });
}

/* ─────────────────────────────────────────────
 * Internal: async processing pipeline
 * ───────────────────────────────────────────── */
async function processWebhookAsync(req) {
    const rawBody = req.body;  // Buffer (due to express.raw)
    const headers = req.headers;

    // ── Step 1: Signature Verification ───────
    const adapter = GATEWAY_ADAPTERS[ACTIVE_GATEWAY];
    if (!adapter) {
        console.error(`[Webhook] No adapter for gateway: ${ACTIVE_GATEWAY}`);
        return;
    }

    const isValid = adapter.verifySignature(rawBody, headers);
    if (!isValid) {
        console.error('[Webhook] SIGNATURE MISMATCH — request rejected');
        // In production: emit security alert, log IP, increment fail counter
        return;
    }

    // ── Step 2: Parse & normalize payload ────
    let payload;
    try {
        payload = adapter.normalizePayload(JSON.parse(rawBody.toString('utf8')));
    } catch (err) {
        console.error('[Webhook] Payload parse error:', err.message);
        return;
    }

    const { transaction_id, status, amount_idr, pg_reference, paid_at } = payload;

    console.log(`[Webhook] Received: txn=${transaction_id} status=${status} amount=${amount_idr}`);

    // ── Step 3: Load transaction from DB ──────
    const txn = await ParkingTransaction.findOne({ transaction_id });
    if (!txn) {
        console.warn(`[Webhook] Unknown transaction_id: ${transaction_id}`);
        return;
    }

    // ── Step 4: Idempotency check ─────────────
    // If already PAID or LOCK_LOWERED, skip silently (PG may retry webhooks)
    if (['PAID', 'LOCK_LOWERED', 'COMPLETED'].includes(txn.status)) {
        console.log(`[Webhook] Duplicate webhook for ${transaction_id} (status: ${txn.status}) — skipped`);
        return;
    }

    // ── Step 5: Handle by gateway status ─────
    if (status === 'settlement' || status === 'paid' || status === 'COMPLETED') {
        await handlePaymentSuccess(txn, { amount_idr, pg_reference, paid_at });
    } else if (status === 'expire' || status === 'EXPIRED') {
        await TransactionStateMachine.transitionTo(txn, 'EXPIRED');
        console.log(`[Webhook] Transaction expired: ${transaction_id}`);
    } else if (status === 'cancel' || status === 'CANCELED') {
        await TransactionStateMachine.transitionTo(txn, 'CANCELLED');
        console.log(`[Webhook] Transaction cancelled: ${transaction_id}`);
    } else {
        // Pending / capture / authorize — update but don't trigger hardware
        await ParkingTransaction.updateOne({ transaction_id }, {
            pg_status: status,
            pg_reference,
        });
        console.log(`[Webhook] Non-terminal status (${status}) for ${transaction_id} — no action`);
    }
}

/* ─────────────────────────────────────────────
 * Payment success pipeline
 * ───────────────────────────────────────────── */
async function handlePaymentSuccess(txn, { amount_idr, pg_reference, paid_at }) {
    const transaction_id = txn.transaction_id;
    const lock_id        = txn.lock_id;

    // Validate amount matches (prevent underpayment fraud)
    if (amount_idr < txn.amount_idr) {
        console.error(`[Webhook] Amount mismatch: expected ${txn.amount_idr}, got ${amount_idr} — txn: ${transaction_id}`);
        await TransactionStateMachine.transitionTo(txn, 'AMOUNT_MISMATCH');
        return;
    }

    // Transition to PAID
    await TransactionStateMachine.transitionTo(txn, 'PAID', {
        pg_reference,
        paid_at:    paid_at ? new Date(paid_at) : new Date(),
        amount_paid: amount_idr,
    });

    console.log(`[Webhook] ✅ Payment confirmed: ${transaction_id} — IDR ${amount_idr}`);

    // ── Step 6: Trigger hardware lowerLock() ──
    await triggerLockLower(txn);
}

/* ─────────────────────────────────────────────
 * Hardware trigger with retry fallback
 * ───────────────────────────────────────────── */
async function triggerLockLower(txn) {
    const { transaction_id, lock_id } = txn;

    try {
        // Attempt immediate lowerLock()
        await HardwareService.lowerLock(lock_id);

        // Mark hardware command as executed
        await TransactionStateMachine.transitionTo(txn, 'LOCK_LOWERED', {
            lock_lowered_at: new Date(),
        });

        console.log(`[Webhook] 🔓 Lock lowered: ${lock_id} (txn: ${transaction_id})`);

    } catch (err) {
        console.error(`[Webhook] ⚠️  Hardware unreachable for ${lock_id}: ${err.message}`);

        // Enqueue retry job — will retry every 30s for up to 10 minutes
        await RetryQueue.enqueue({
            type:           'LOWER_LOCK',
            transaction_id,
            lock_id,
            max_retries:    20,
            retry_interval_ms: 30_000,
            created_at:     new Date().toISOString(),
        });

        // Mark as PAYMENT_CONFIRMED but hardware pending
        await TransactionStateMachine.transitionTo(txn, 'HARDWARE_PENDING', {
            hardware_error: err.message,
        });

        console.log(`[Webhook] Retry job queued for lock: ${lock_id}`);
    }
}

module.exports = { handleWebhook };

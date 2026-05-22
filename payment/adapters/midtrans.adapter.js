/**
 * @file midtrans.adapter.js
 * @description Midtrans Webhook Adapter
 *
 * Verifies Midtrans webhook signature and normalizes the payload
 * into the SDK's standard WebhookPayload format.
 *
 * Midtrans Signature Verification (SHA512):
 *   signature = SHA512(order_id + status_code + gross_amount + SERVER_KEY)
 *   Compare with notification.signature_key header/field
 *
 * Reference: https://docs.midtrans.com/reference/notification-handling
 */

'use strict';

const crypto = require('crypto');

const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || 'SB-Mid-server-XXXX';

module.exports = {

    /**
     * Verify Midtrans webhook signature.
     * Midtrans embeds the signature inside the JSON body (not in headers).
     *
     * @param {Buffer} rawBody   Raw request body buffer
     * @param {object} headers   HTTP request headers (not used by Midtrans)
     * @returns {boolean}
     */
    verifySignature(rawBody, headers) {
        try {
            const body = JSON.parse(rawBody.toString('utf8'));
            const { order_id, status_code, gross_amount, signature_key } = body;

            if (!order_id || !status_code || !gross_amount || !signature_key) {
                console.warn('[Midtrans] Missing signature fields in body');
                return false;
            }

            const payload    = `${order_id}${status_code}${gross_amount}${SERVER_KEY}`;
            const computed   = crypto.createHash('sha512').update(payload).digest('hex');
            const isValid    = crypto.timingSafeEqual(
                Buffer.from(computed),
                Buffer.from(signature_key)
            );

            if (!isValid) {
                console.warn('[Midtrans] Signature mismatch:', { computed, received: signature_key });
            }
            return isValid;

        } catch (err) {
            console.error('[Midtrans] Signature verification error:', err.message);
            return false;
        }
    },

    /**
     * Normalize Midtrans notification body to standard WebhookPayload.
     *
     * Midtrans status mapping:
     *   capture + fraud_status=accept → paid
     *   settlement                    → paid
     *   pending                       → pending
     *   deny / cancel / expire        → respective states
     *
     * @param {object} body  Parsed Midtrans notification object
     * @returns {object}     Standard WebhookPayload
     */
    normalizePayload(body) {
        const {
            order_id,
            transaction_status,
            fraud_status,
            gross_amount,
            transaction_id,
            payment_type,
            settlement_time,
            transaction_time,
        } = body;

        // Determine normalized status
        let status = 'pending';
        if (transaction_status === 'settlement') {
            status = 'settlement';
        } else if (transaction_status === 'capture' && fraud_status === 'accept') {
            status = 'settlement';
        } else if (transaction_status === 'expire') {
            status = 'expire';
        } else if (transaction_status === 'cancel' || transaction_status === 'deny') {
            status = 'cancel';
        }

        return {
            transaction_id: order_id,                          // our order_id IS the transaction_id
            status,
            amount_idr:     Math.round(parseFloat(gross_amount || 0)),
            pg_reference:   transaction_id,                    // Midtrans internal txn ID
            paid_at:        settlement_time || transaction_time,
            payment_method: payment_type,
            gateway:        'midtrans',
            raw:            body,
        };
    },
};

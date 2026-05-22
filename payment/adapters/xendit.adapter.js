/**
 * @file xendit.adapter.js
 * @description Xendit Webhook Adapter
 *
 * Xendit sends a webhook token in the header:
 *   X-CALLBACK-TOKEN: <your_webhook_verification_token>
 *
 * Reference: https://developers.xendit.co/api-reference/#callback-header
 */

'use strict';

const WEBHOOK_TOKEN = process.env.XENDIT_WEBHOOK_TOKEN || 'changeme';

module.exports = {

    /**
     * Verify Xendit webhook token (header-based, constant-time compare).
     */
    verifySignature(rawBody, headers) {
        const receivedToken = headers['x-callback-token'];
        if (!receivedToken) {
            console.warn('[Xendit] Missing X-CALLBACK-TOKEN header');
            return false;
        }
        try {
            return crypto.timingSafeEqual(
                Buffer.from(WEBHOOK_TOKEN),
                Buffer.from(receivedToken)
            );
        } catch {
            return false;
        }
    },

    /**
     * Normalize Xendit QR callback payload.
     * Xendit sends: { event, data: { ... } }
     */
    normalizePayload(body) {
        const data = body.data || body;
        const {
            reference_id,
            status,
            amount,
            id,
            created,
        } = data;

        let normalizedStatus = 'pending';
        if (status === 'SUCCEEDED') normalizedStatus = 'settlement';
        if (status === 'EXPIRED')   normalizedStatus = 'expire';

        return {
            transaction_id: reference_id,
            status:         normalizedStatus,
            amount_idr:     Math.round(amount || 0),
            pg_reference:   id,
            paid_at:        status === 'SUCCEEDED' ? new Date().toISOString() : null,
            payment_method: 'QRIS',
            gateway:        'xendit',
            raw:            body,
        };
    },
};

const crypto = require('crypto');

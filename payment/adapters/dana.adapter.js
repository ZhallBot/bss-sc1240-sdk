/**
 * @file dana.adapter.js
 * @description Dana / LinkAja Webhook Adapter
 *
 * Dana uses RSA signature verification on the request body.
 * Public key is obtained from Dana Developer Dashboard.
 */

'use strict';

const crypto = require('crypto');

const DANA_PUBLIC_KEY = process.env.DANA_PUBLIC_KEY || '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----';

module.exports = {

    verifySignature(rawBody, headers) {
        const signature = headers['dana-signature'] || headers['x-dana-signature'];
        if (!signature) {
            console.warn('[Dana] Missing dana-signature header');
            return false;
        }
        try {
            const verify = crypto.createVerify('SHA256');
            verify.update(rawBody);
            return verify.verify(DANA_PUBLIC_KEY, signature, 'base64');
        } catch (err) {
            console.error('[Dana] Signature verification error:', err.message);
            return false;
        }
    },

    normalizePayload(body) {
        const innerBody = body.body || {};
        const { merchantTransId, orderStatus, amount, payTime } = innerBody;

        let status = 'pending';
        if (orderStatus === 'SUCCESS') status = 'settlement';
        if (orderStatus === 'EXPIRED') status = 'expire';
        if (orderStatus === 'FAILED')  status = 'cancel';

        return {
            transaction_id: merchantTransId,
            status,
            amount_idr:     Math.round((parseFloat(amount?.value || 0)) / 100),
            pg_reference:   innerBody.partnerReferenceNo,
            paid_at:        payTime || null,
            payment_method: 'QRIS',
            gateway:        'dana',
            raw:            body,
        };
    },
};

/**
 * @file paymentGateway.service.js
 * @description Payment Gateway Abstraction Layer
 *
 * Provides a unified interface for multiple payment gateways.
 * Currently supports: Midtrans, Xendit, Dana.
 * Switch gateway via PAYMENT_GATEWAY env variable.
 *
 * All methods return a normalized PaymentGatewayResponse object:
 * {
 *   qris_string:  string,    // Raw QRIS string (EMVCo format)
 *   qris_url:     string,    // Displayable URL / deep link
 *   reference_id: string,    // Gateway's internal reference ID
 *   expires_at:   Date,
 * }
 */

'use strict';

const axios  = require('axios');
const crypto = require('crypto');

/* ─────────────────────────────────────────────
 * Gateway Configurations (load from env/secrets)
 * ───────────────────────────────────────────── */
const GATEWAY_CONFIGS = {
    midtrans: {
        base_url:    process.env.MIDTRANS_BASE_URL    || 'https://api.midtrans.com/v2',
        server_key:  process.env.MIDTRANS_SERVER_KEY  || 'SB-Mid-server-XXXX',
        client_key:  process.env.MIDTRANS_CLIENT_KEY  || 'SB-Mid-client-XXXX',
        webhook_key: process.env.MIDTRANS_WEBHOOK_KEY || 'changeme',
    },
    xendit: {
        base_url:   process.env.XENDIT_BASE_URL   || 'https://api.xendit.co',
        secret_key: process.env.XENDIT_SECRET_KEY || 'xnd_production_XXXX',
        webhook_token: process.env.XENDIT_WEBHOOK_TOKEN || 'changeme',
    },
    dana: {
        base_url:    process.env.DANA_BASE_URL    || 'https://api.dana.id',
        merchant_id: process.env.DANA_MERCHANT_ID || 'MERCHANT_XXXX',
        private_key: process.env.DANA_PRIVATE_KEY || '-----BEGIN RSA PRIVATE KEY-----\n...',
    },
};

/* ─────────────────────────────────────────────
 * PaymentGatewayRequest (input to createDynamicQris)
 *
 * {
 *   transaction_id: string,
 *   amount_idr:     number,
 *   lock_id:        string,
 *   plate:          string,
 *   expires_at:     Date,
 *   description:    string,
 * }
 * ───────────────────────────────────────────── */

class PaymentGatewayService {

    constructor(gatewayName = process.env.PAYMENT_GATEWAY || 'midtrans') {
        this.gatewayName = gatewayName;
        this.config      = GATEWAY_CONFIGS[gatewayName];
        if (!this.config) throw new Error(`Unknown gateway: ${gatewayName}`);
    }

    /* ─────────────────────────────────────────
     * createDynamicQris
     * Main factory method — dispatches to gateway-specific implementation.
     * ─────────────────────────────────────────*/
    async createDynamicQris(params) {
        switch (this.gatewayName) {
            case 'midtrans': return this._midtransCreateQris(params);
            case 'xendit':   return this._xenditCreateQris(params);
            case 'dana':     return this._danaCreateQris(params);
            default:         throw new Error(`No QRIS creator for: ${this.gatewayName}`);
        }
    }

    /* ─────────────────────────────────────────
     * MIDTRANS — Create QRIS via Snap / Core API
     * Docs: https://docs.midtrans.com/reference/qris
     * ─────────────────────────────────────────*/
    async _midtransCreateQris({ transaction_id, amount_idr, lock_id, plate, expires_at, description }) {
        const serverKey = this.config.server_key;
        const authHeader = `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;

        const body = {
            transaction_details: {
                order_id:     transaction_id,
                gross_amount: amount_idr,
            },
            payment_type: 'qris',
            qris: {
                acquirer: 'gopay',   // or 'airpay shopee'
            },
            item_details: [{
                id:       lock_id,
                price:    amount_idr,
                quantity: 1,
                name:     description,
            }],
            customer_details: {
                first_name: plate,
            },
            expiry: {
                unit:     'second',
                duration: Math.floor((expires_at - new Date()) / 1000),
            },
        };

        const response = await axios.post(
            `${this.config.base_url}/charge`,
            body,
            {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type':  'application/json',
                },
                timeout: 10_000,
            }
        );

        const data = response.data;

        // Midtrans returns qr_string and qr_code_url inside actions[]
        const qrisAction = data.actions?.find(a => a.name === 'generate-qr-code');

        return {
            qris_string:  data.qr_string || '',
            qris_url:     qrisAction?.url || data.redirect_url || '',
            reference_id: data.transaction_id,
            expires_at,
        };
    }

    /* ─────────────────────────────────────────
     * XENDIT — Create QR Code payment
     * Docs: https://developers.xendit.co/api-reference/#create-qr-code
     * ─────────────────────────────────────────*/
    async _xenditCreateQris({ transaction_id, amount_idr, lock_id, expires_at, description }) {
        const response = await axios.post(
            `${this.config.base_url}/qr_codes`,
            {
                reference_id: transaction_id,
                type:         'DYNAMIC',
                currency:     'IDR',
                amount:        amount_idr,
                expires_at:    expires_at.toISOString(),
                basket: [{
                    reference_id: lock_id,
                    name:         description,
                    category:     'PARKING',
                    currency:     'IDR',
                    price:         amount_idr,
                    quantity:      1,
                    type:         'SERVICE',
                }],
            },
            {
                auth: { username: this.config.secret_key, password: '' },
                headers: { 'Content-Type': 'application/json' },
                timeout: 10_000,
            }
        );

        const data = response.data;
        return {
            qris_string:  data.qr_string,
            qris_url:     data.qr_string,   // Xendit returns raw string
            reference_id: data.id,
            expires_at,
        };
    }

    /* ─────────────────────────────────────────
     * DANA — Create QRIS (simplified)
     * Docs: https://dashboard.dana.id/
     * ─────────────────────────────────────────*/
    async _danaCreateQris({ transaction_id, amount_idr, expires_at, description }) {
        const timestamp  = new Date().toISOString();
        const requestBody = {
            head: {
                version:     '2.0',
                function:    'dana.acquiring.order.createOrder',
                clientId:    this.config.merchant_id,
                reqTime:     timestamp,
                reqMsgId:    transaction_id,
            },
            body: {
                order: {
                    orderTitle:  description,
                    merchantTransId: transaction_id,
                    orderAmount: {
                        value:    (amount_idr * 100).toString(),
                        currency: 'IDR',
                    },
                    orderExpiredTime: expires_at.toISOString(),
                    paymentType:     'QRIS',
                },
            },
        };

        // Sign with RSA private key (DANA requirement)
        const sign = crypto.createSign('SHA256');
        sign.update(JSON.stringify(requestBody));
        requestBody.head.signature = sign.sign(this.config.private_key, 'base64');

        const response = await axios.post(
            `${this.config.base_url}/v1.0/qr/qr-mpm-generate`,
            requestBody,
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10_000,
            }
        );

        const data = response.data;
        return {
            qris_string:  data.body?.qrCode || '',
            qris_url:     data.body?.qrCodeUrl || '',
            reference_id: data.body?.partnerReferenceNo || transaction_id,
            expires_at,
        };
    }
}

// Export singleton (configured via env)
module.exports = new PaymentGatewayService();

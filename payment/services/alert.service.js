/**
 * @file alert.service.js
 * @description Alert Service — Admin notifications for critical events
 *
 * Sends alerts via configurable channels:
 *   - Telegram Bot API
 *   - Email (nodemailer)
 *   - Webhook (Slack / Discord / custom)
 *
 * In production: replace stubs with actual transport implementations.
 */

'use strict';

const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '';
const SLACK_WEBHOOK_URL  = process.env.SLACK_WEBHOOK_URL  || '';

class AlertService {

    /**
     * Send a critical alert to all configured admin channels.
     *
     * @param {object} alert
     * @param {string} alert.type           Alert type (e.g., HARDWARE_RETRY_EXHAUSTED)
     * @param {string} alert.transaction_id
     * @param {string} alert.lock_id
     * @param {string} alert.message        Human-readable message
     * @param {string} alert.timestamp      ISO timestamp
     */
    async sendAdminAlert(alert) {
        const text = `🚨 *BSS PARKING ALERT*\n` +
                     `Type: \`${alert.type}\`\n` +
                     `Lock: \`${alert.lock_id}\`\n` +
                     `TxID: \`${alert.transaction_id}\`\n` +
                     `Msg: ${alert.message}\n` +
                     `Time: ${alert.timestamp}`;

        const promises = [];

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
            promises.push(this._sendTelegram(text));
        }
        if (SLACK_WEBHOOK_URL) {
            promises.push(this._sendSlack(text));
        }

        // Fire all channels concurrently; don't let alert failure affect main flow
        await Promise.allSettled(promises);
        console.log(`[Alert] Sent: ${alert.type} for ${alert.lock_id}`);
    }

    async _sendTelegram(text) {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' },
            { timeout: 5000 }
        );
    }

    async _sendSlack(text) {
        await axios.post(
            SLACK_WEBHOOK_URL,
            { text },
            { timeout: 5000 }
        );
    }
}

module.exports = new AlertService();

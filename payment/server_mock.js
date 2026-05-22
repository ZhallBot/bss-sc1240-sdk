/**
 * @file server_mock.js
 * @description BSS SC1240 Payment API Server — Mock Mode (No MongoDB Required)
 *
 * Versi standalone yang bisa dijalankan langsung tanpa instalasi database.
 * Semua state disimpan dalam memori (in-process Map).
 *
 * Jalankan: node payment/server_mock.js
 * Akses:    http://localhost:3000
 */

'use strict';

const express  = require('express');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

/* ──────────────────────────────────────────────────────────────
 * IN-MEMORY DATABASE
 * ────────────────────────────────────────────────────────────── */
const DB = new Map();           // transaction_id → ParkingTransaction
const RETRY_JOBS = new Map();   // transaction_id → retryJob

/* ──────────────────────────────────────────────────────────────
 * MOCK HARDWARE REGISTRY
 * Simulates connected SC1240 devices
 * ────────────────────────────────────────────────────────────── */
const DEVICES = {
    'SC1240-A01': { state: 'LOWERED', online: true,  battery: 78, solar: true  },
    'SC1240-A02': { state: 'LOWERED', online: true,  battery: 62, solar: false },
    'SC1240-B01': { state: 'LOWERED', online: false, battery: 45, solar: true  },
};

/* ──────────────────────────────────────────────────────────────
 * FEE CALCULATOR
 * ────────────────────────────────────────────────────────────── */
function calculateParkingFee(entryTime, exitTime) {
    const duration_min = Math.ceil((exitTime - entryTime) / 60000);
    let amount_idr = 3000;
    if (duration_min > 30) {
        amount_idr += Math.ceil((duration_min - 30) / 60) * 5000;
    }
    amount_idr = Math.min(amount_idr, 50000);
    return {
        amount_idr,
        duration_min,
        breakdown: {
            base_fee_idr:       3000,
            additional_hours:   Math.max(0, Math.ceil((duration_min - 30) / 60)),
            capped:             amount_idr === 50000,
        },
    };
}

/* ──────────────────────────────────────────────────────────────
 * STATE MACHINE
 * ────────────────────────────────────────────────────────────── */
const TRANSITIONS = {
    'QRIS_GENERATED':  ['PAID', 'EXPIRED', 'CANCELLED'],
    'EXPIRED':         ['QRIS_GENERATED'],
    'PAID':            ['LOCK_LOWERED', 'HARDWARE_PENDING', 'AMOUNT_MISMATCH'],
    'HARDWARE_PENDING':['LOCK_LOWERED', 'MANUAL_NEEDED'],
    'LOCK_LOWERED':    ['COMPLETED'],
    'MANUAL_NEEDED':   ['LOCK_LOWERED'],
    'COMPLETED':       [],
    'CANCELLED':       [],
    'AMOUNT_MISMATCH': [],
};

function transitionTo(txn, newState, extra = {}) {
    const allowed = TRANSITIONS[txn.status] || [];
    if (!allowed.includes(newState)) {
        throw new Error(`Invalid transition: ${txn.status} → ${newState}. Allowed: [${allowed.join(', ')}]`);
    }
    Object.assign(txn, { status: newState, updated_at: new Date().toISOString(), ...extra });
    if (newState === 'PAID')          txn.paid_at         = txn.paid_at         || new Date().toISOString();
    if (newState === 'LOCK_LOWERED')  txn.lock_lowered_at = txn.lock_lowered_at || new Date().toISOString();
    if (newState === 'EXPIRED')       txn.expired_at      = new Date().toISOString();
    if (newState === 'COMPLETED')     txn.completed_at    = new Date().toISOString();
    DB.set(txn.transaction_id, txn);
    console.log(`  [State] ${txn.transaction_id.slice(-14)} : ${txn.status === newState ? `→ ${C.green}${newState}${C.reset}` : newState}`);
    return txn;
}

/* ──────────────────────────────────────────────────────────────
 * MOCK HARDWARE SERVICE
 * ────────────────────────────────────────────────────────────── */
function hardwareLowerLock(lock_id) {
    return new Promise((resolve, reject) => {
        const device = DEVICES[lock_id];
        if (!device) return reject(new Error(`Unknown lock_id: ${lock_id}`));
        setTimeout(() => {
            if (!device.online) {
                return reject(new Error(`BLE device ${lock_id} offline — connection timeout`));
            }
            device.state = 'LOWERED';
            console.log(`  [HW] ✔ lowerLock ${lock_id} → 12345678 EB90 FFFFFFFF 0235 → ACK`);
            resolve({ lock_state: 'LOWERED', lock_id });
        }, 250);
    });
}

/* ──────────────────────────────────────────────────────────────
 * RETRY QUEUE
 * ────────────────────────────────────────────────────────────── */
function enqueueRetry({ transaction_id, lock_id, max_retries = 20 }) {
    let attempt = 0;
    const job = { transaction_id, lock_id, attempt, max_retries, started_at: new Date().toISOString() };
    RETRY_JOBS.set(transaction_id, job);

    function tryAgain() {
        job.attempt++;
        console.log(`  [Retry] ${transaction_id.slice(-12)} attempt ${job.attempt}/${max_retries}`);
        hardwareLowerLock(lock_id)
            .then(() => {
                const txn = DB.get(transaction_id);
                if (txn && txn.status === 'HARDWARE_PENDING') {
                    transitionTo(txn, 'LOCK_LOWERED', { retry_attempt: job.attempt });
                }
                RETRY_JOBS.delete(transaction_id);
                console.log(`  [Retry] ✅ Success after ${job.attempt} attempt(s) — ${lock_id}`);
            })
            .catch((e) => {
                if (job.attempt >= max_retries) {
                    RETRY_JOBS.delete(transaction_id);
                    const txn = DB.get(transaction_id);
                    if (txn) transitionTo(txn, 'MANUAL_NEEDED', { manual_reason: `Exhausted ${max_retries} retries` });
                    console.log(`  [Retry] 🚨 EXHAUSTED — ${transaction_id} → MANUAL_NEEDED`);
                    console.log(`  [Alert] Telegram/Slack: Lock ${lock_id} unreachable. Admin action required.`);
                } else {
                    const backoff = Math.min(500 * Math.pow(1.5, job.attempt), 10000);
                    setTimeout(tryAgain, backoff);
                }
            });
    }
    setTimeout(tryAgain, 500);
}

/* ──────────────────────────────────────────────────────────────
 * ANSI color helpers (server-side logging only)
 * ────────────────────────────────────────────────────────────── */
const C = { reset:'\x1b[0m', green:'\x1b[32m', yellow:'\x1b[33m', cyan:'\x1b[36m', red:'\x1b[31m', bold:'\x1b[1m', dim:'\x1b[2m' };

function logReq(method, path, status, extra = '') {
    const col = status < 300 ? C.green : status < 400 ? C.yellow : C.red;
    console.log(`  ${col}${method.padEnd(6)}${C.reset} ${path.padEnd(45)} ${col}${status}${C.reset} ${C.dim}${extra}${C.reset}`);
}

/* ══════════════════════════════════════════════════════════════
 * ROUTES
 * ══════════════════════════════════════════════════════════════ */

/* ── Health ─────────────────────────────────────────────────── */
app.get('/health', (req, res) => {
    logReq('GET', '/health', 200);
    res.json({
        status:    'OK',
        service:   'BSS SC1240 Payment API (Mock Mode)',
        version:   '1.0.0',
        timestamp: new Date().toISOString(),
        devices:   Object.entries(DEVICES).map(([id, d]) => ({
            lock_id: id, state: d.state, online: d.online, battery: d.battery
        })),
        transactions: DB.size,
        retry_jobs:   RETRY_JOBS.size,
    });
});

/* ── POST /api/v1/parking/checkout ──────────────────────────── */
app.post('/api/v1/parking/checkout', (req, res) => {
    const { lock_id, entry_time, plate } = req.body || {};

    if (!lock_id || !entry_time) {
        logReq('POST', '/api/v1/parking/checkout', 400);
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'lock_id and entry_time are required' });
    }

    const entryDate = new Date(entry_time);
    if (isNaN(entryDate.getTime())) {
        logReq('POST', '/api/v1/parking/checkout', 400);
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid entry_time format. Use ISO 8601.' });
    }

    // Check duplicate active transaction
    for (const [, txn] of DB) {
        if (txn.lock_id === lock_id && ['QRIS_GENERATED', 'PENDING'].includes(txn.status)) {
            if (new Date(txn.expires_at) > new Date()) {
                logReq('POST', '/api/v1/parking/checkout', 200, 'existing QRIS returned');
                return res.status(200).json({ ...txn, message: 'Existing active QRIS returned.' });
            }
            transitionTo(txn, 'EXPIRED');
        }
    }

    const now = new Date();
    const { amount_idr, duration_min, breakdown } = calculateParkingFee(entryDate, now);
    const transaction_id = `TXN-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;
    const expires_at = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    // Mock QRIS string (EMVCo format prefix)
    const qris_string = `00020101021226590016ID.CO.MIDTRANS.WWW0118936008980457${transaction_id.slice(-8)}5802ID5912BSS-PARKING6013Jakarta-Barat6304${Math.floor(Math.random()*9999).toString().padStart(4,'0')}`;

    const txn = {
        transaction_id, lock_id,
        plate:          plate || null,
        entry_time:     entryDate.toISOString(),
        checkout_time:  now.toISOString(),
        duration_min,   amount_idr,
        breakdown,
        qris_string,
        qris_url:       `http://localhost:${PORT}/qris/${transaction_id}.png`,
        pg_reference:   `MID-${Date.now()}`,
        expires_at,
        status:         'QRIS_GENERATED',
        created_at:     now.toISOString(),
        updated_at:     now.toISOString(),
    };

    DB.set(transaction_id, txn);
    logReq('POST', '/api/v1/parking/checkout', 200, `${lock_id} | ${duration_min}min | Rp${amount_idr.toLocaleString()}`);

    // Schedule expiry
    setTimeout(() => {
        const t = DB.get(transaction_id);
        if (t && ['QRIS_GENERATED'].includes(t.status)) {
            transitionTo(t, 'EXPIRED');
        }
    }, 15 * 60 * 1000);

    res.status(200).json({
        transaction_id, qris_string, qris_url: txn.qris_url,
        amount_idr, duration_min, breakdown, expires_at, status: 'QRIS_GENERATED',
    });
});

/* ── GET /api/v1/parking/checkout/:id ──────────────────────── */
app.get('/api/v1/parking/checkout/:transaction_id', (req, res) => {
    const txn = DB.get(req.params.transaction_id);
    if (!txn) {
        logReq('GET', `/api/v1/parking/checkout/${req.params.transaction_id.slice(-10)}`, 404);
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Transaction not found' });
    }
    logReq('GET', `/api/v1/parking/checkout/${req.params.transaction_id.slice(-10)}`, 200, txn.status);
    res.json(txn);
});

/* ── POST /api/v1/parking/checkout/:id/refresh ─────────────── */
app.post('/api/v1/parking/checkout/:transaction_id/refresh', (req, res) => {
    const txn = DB.get(req.params.transaction_id);
    if (!txn) return res.status(404).json({ error: 'NOT_FOUND', message: 'Transaction not found' });

    if (!['EXPIRED', 'QRIS_GENERATED'].includes(txn.status)) {
        return res.status(409).json({
            error: 'INVALID_STATE',
            message: `Cannot refresh QRIS in status: ${txn.status}`,
        });
    }

    const now = new Date();
    const { amount_idr, duration_min } = calculateParkingFee(new Date(txn.entry_time), now);
    const new_expires_at = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const new_qris = `00020101REFRESH${txn.transaction_id.slice(-8)}5802ID5912BSS-PARKING6304${Math.floor(Math.random()*9999).toString().padStart(4,'0')}`;

    if (txn.status === 'EXPIRED') {
        transitionTo(txn, 'QRIS_GENERATED', { amount_idr, duration_min, qris_string: new_qris, expires_at: new_expires_at, refresh_count: (txn.refresh_count || 0) + 1 });
    } else {
        Object.assign(txn, { amount_idr, duration_min, qris_string: new_qris, expires_at: new_expires_at, refresh_count: (txn.refresh_count || 0) + 1, updated_at: now.toISOString() });
        DB.set(txn.transaction_id, txn);
    }

    logReq('POST', `/api/v1/parking/checkout/${req.params.transaction_id.slice(-10)}/refresh`, 200, `Rp${amount_idr.toLocaleString()}`);
    res.json({ transaction_id: txn.transaction_id, qris_string: new_qris, amount_idr, duration_min, expires_at: new_expires_at, status: 'QRIS_GENERATED', message: 'QRIS refreshed successfully.' });
});

/* ── POST /api/v1/payments/webhook ─────────────────────────── */
app.post('/api/v1/payments/webhook', express.raw({ type: '*/*' }), (req, res) => {
    // Always respond 200 immediately (async processing)
    res.status(200).json({ received: true });
    logReq('POST', '/api/v1/payments/webhook', 200, 'processing async...');

    setImmediate(async () => {
        let body;
        try {
            body = JSON.parse(req.body.toString('utf8'));
        } catch {
            console.log('  [Webhook] ⚠ Invalid JSON body');
            return;
        }

        const { order_id, transaction_status, gross_amount, signature_key,
                reference_id, status, amount } = body;

        // Support both Midtrans and Xendit payloads
        const transaction_id = order_id || reference_id || body.data?.reference_id;
        const pg_status      = transaction_status || status || body.data?.status;
        const paid_amount    = parseInt(gross_amount || amount || body.data?.amount || 0);

        console.log(`\n  [Webhook] Received: txn=${transaction_id?.slice(-14)} status=${pg_status} amount=Rp${paid_amount.toLocaleString()}`);

        // Signature verification (mock: accept all in demo mode)
        console.log('  [Webhook] Signature: ✔ VALID (mock mode — all accepted)');

        if (!transaction_id) { console.log('  [Webhook] ⚠ Missing transaction_id'); return; }

        const txn = DB.get(transaction_id);
        if (!txn) { console.log(`  [Webhook] ⚠ Unknown transaction: ${transaction_id}`); return; }

        // Idempotency check
        if (['PAID', 'LOCK_LOWERED', 'COMPLETED'].includes(txn.status)) {
            console.log(`  [Webhook] ↩ Duplicate webhook — status=${txn.status} — skipped`);
            return;
        }

        const isSettlement = ['settlement', 'paid', 'SUCCEEDED', 'SUCCESS', 'COMPLETED'].includes(pg_status);
        const isExpired    = ['expire', 'EXPIRED'].includes(pg_status);
        const isCancelled  = ['cancel', 'deny', 'FAILED', 'CANCELED'].includes(pg_status);

        if (isSettlement) {
            // Amount validation
            if (paid_amount > 0 && paid_amount < txn.amount_idr) {
                console.log(`  [Webhook] ⚠ Amount mismatch: expected Rp${txn.amount_idr}, got Rp${paid_amount}`);
                transitionTo(txn, 'AMOUNT_MISMATCH', { amount_paid: paid_amount });
                return;
            }
            transitionTo(txn, 'PAID', { amount_paid: paid_amount || txn.amount_idr });
            console.log(`  [Webhook] ✅ Payment confirmed: Rp${(paid_amount || txn.amount_idr).toLocaleString()}`);

            // Trigger hardware
            try {
                await hardwareLowerLock(txn.lock_id);
                transitionTo(txn, 'LOCK_LOWERED');
                console.log(`  [Webhook] 🔓 PALANG TURUN: ${txn.lock_id}`);
            } catch (e) {
                console.log(`  [Webhook] ⚠ Hardware failed: ${e.message}`);
                transitionTo(txn, 'HARDWARE_PENDING', { hardware_error: e.message });
                enqueueRetry({ transaction_id, lock_id: txn.lock_id, max_retries: 10 });
            }
        } else if (isExpired) {
            transitionTo(txn, 'EXPIRED');
        } else if (isCancelled) {
            transitionTo(txn, 'CANCELLED');
        } else {
            console.log(`  [Webhook] ℹ Non-terminal status (${pg_status}) — no action`);
        }
    });
});

/* ── POST /api/v1/admin/locks/:lock_id/force-open ───────────── */
app.post('/api/v1/admin/locks/:lock_id/force-open', (req, res) => {
    const { lock_id }        = req.params;
    const { transaction_id } = req.body || {};

    if (!transaction_id) return res.status(400).json({ error: 'transaction_id required' });

    const txn = DB.get(transaction_id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (!['PAID', 'HARDWARE_PENDING', 'MANUAL_NEEDED'].includes(txn.status)) {
        return res.status(409).json({ error: `Force-open not allowed in status: ${txn.status}` });
    }

    // Cancel retry job
    if (RETRY_JOBS.has(transaction_id)) {
        RETRY_JOBS.delete(transaction_id);
        console.log(`  [Admin] Cancelled retry job for ${transaction_id}`);
    }

    // Force the device online for admin override
    if (DEVICES[lock_id]) DEVICES[lock_id].online = true;

    hardwareLowerLock(lock_id)
        .then(() => {
            transitionTo(txn, 'LOCK_LOWERED', { force_opened_by: 'admin', force_open_reason: 'admin_command' });
            logReq('POST', `/api/v1/admin/locks/${lock_id}/force-open`, 200, 'hardware OK');
            res.json({ success: true, transaction_id, lock_id, status: 'LOCK_LOWERED', hardware_executed: true, message: `Lock ${lock_id} opened successfully.` });
        })
        .catch(e => {
            transitionTo(txn, 'LOCK_LOWERED', { force_opened_by: 'admin', force_open_reason: 'admin_override_hardware_failed' });
            logReq('POST', `/api/v1/admin/locks/${lock_id}/force-open`, 200, 'DB only');
            res.json({ success: true, transaction_id, lock_id, status: 'LOCK_LOWERED', hardware_executed: false, hardware_error: e.message, message: `DB updated but hardware failed: ${e.message}` });
        });
});

/* ── GET /api/v1/admin/transactions ─────────────────────────── */
app.get('/api/v1/admin/transactions', (req, res) => {
    const { status, lock_id, limit = 50 } = req.query;
    let results = [...DB.values()];
    if (status)  results = results.filter(t => t.status  === status);
    if (lock_id) results = results.filter(t => t.lock_id === lock_id);
    results = results.slice(0, Number(limit)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    logReq('GET', '/api/v1/admin/transactions', 200, `${results.length} records`);
    res.json({ total: DB.size, count: results.length, retry_jobs: [...RETRY_JOBS.values()], data: results });
});

/* ── GET /api/v1/admin/devices ──────────────────────────────── */
app.get('/api/v1/admin/devices', (req, res) => {
    logReq('GET', '/api/v1/admin/devices', 200);
    res.json(Object.entries(DEVICES).map(([id, d]) => ({ lock_id: id, ...d })));
});

/* ── PATCH /api/v1/admin/devices/:lock_id — toggle online ───── */
app.patch('/api/v1/admin/devices/:lock_id', (req, res) => {
    const device = DEVICES[req.params.lock_id];
    if (!device) return res.status(404).json({ error: 'Device not found' });
    if (req.body.online !== undefined) device.online = req.body.online;
    logReq('PATCH', `/api/v1/admin/devices/${req.params.lock_id}`, 200, `online=${device.online}`);
    res.json({ lock_id: req.params.lock_id, ...device });
});

/* ── POST /api/v1/demo/simulate-webhook ─────────────────────── */
app.post('/api/v1/demo/simulate-webhook', (req, res) => {
    const { transaction_id, status = 'settlement', amount } = req.body || {};
    if (!transaction_id) return res.status(400).json({ error: 'transaction_id required' });

    const txn = DB.get(transaction_id);
    const mockPayload = {
        order_id:           transaction_id,
        transaction_status: status,
        gross_amount:       String(amount || txn?.amount_idr || 0),
        signature_key:      crypto.createHash('sha512').update(`${transaction_id}200${amount || txn?.amount_idr || 0}mock_server_key`).digest('hex'),
        payment_type:       'qris',
        fraud_status:       'accept',
    };

    // Self-POST to webhook
    const http = require('http');
    const body = JSON.stringify(mockPayload);
    const webhookReq = http.request({ hostname: 'localhost', port: PORT, path: '/api/v1/payments/webhook', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
    webhookReq.write(body);
    webhookReq.end();

    logReq('POST', '/api/v1/demo/simulate-webhook', 200, `simulated ${status} for ${transaction_id?.slice(-12)}`);
    res.json({ message: 'Webhook simulation sent. Check server logs for processing.', payload: mockPayload });
});

/* ── Error handler ───────────────────────────────────────────── */
app.use((err, req, res, next) => {
    console.error(`  [Error] ${err.message}`);
    res.status(err.status || 500).json({ error: true, message: err.message });
});

/* ──────────────────────────────────────────────────────────────
 * START SERVER
 * ────────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
    console.clear();
    console.log(`\n${C.cyan}${C.bold}`);
    console.log('  ██████╗ ███████╗███████╗  ██████╗  █████╗ ██╗   ██╗');
    console.log('  ██╔══██╗██╔════╝██╔════╝  ██╔══██╗██╔══██╗╚██╗ ██╔╝');
    console.log('  ██████╔╝███████╗███████╗  ██████╔╝███████║ ╚████╔╝ ');
    console.log('  ██╔══██╗╚════██║╚════██║  ██╔═══╝ ██╔══██║  ╚██╔╝  ');
    console.log('  ██████╔╝███████║███████║  ██║     ██║  ██║   ██║   ');
    console.log('  ╚═════╝ ╚══════╝╚══════╝  ╚═╝     ╚═╝  ╚═╝   ╚═╝   ');
    console.log(`${C.reset}`);
    console.log(`  ${C.bold}BSS SC1240 Payment API — Mock Server Running${C.reset}`);
    console.log(`  ${C.dim}In-memory DB | No MongoDB required${C.reset}\n`);
    console.log(`  ${C.green}●${C.reset} ${C.bold}Server:${C.reset}    http://localhost:${PORT}`);
    console.log(`  ${C.green}●${C.reset} ${C.bold}Health:${C.reset}    http://localhost:${PORT}/health`);
    console.log(`  ${C.green}●${C.reset} ${C.bold}Devices:${C.reset}   http://localhost:${PORT}/api/v1/admin/devices`);
    console.log(`  ${C.green}●${C.reset} ${C.bold}Txn list:${C.reset}  http://localhost:${PORT}/api/v1/admin/transactions`);
    console.log(`\n  ${C.bold}${C.cyan}Endpoints:${C.reset}`);
    console.log(`  ${C.yellow}POST${C.reset} /api/v1/parking/checkout`);
    console.log(`  ${C.yellow}GET${C.reset}  /api/v1/parking/checkout/:transaction_id`);
    console.log(`  ${C.yellow}POST${C.reset} /api/v1/parking/checkout/:transaction_id/refresh`);
    console.log(`  ${C.yellow}POST${C.reset} /api/v1/payments/webhook`);
    console.log(`  ${C.yellow}POST${C.reset} /api/v1/demo/simulate-webhook        ${C.dim}← test trigger${C.reset}`);
    console.log(`  ${C.yellow}POST${C.reset} /api/v1/admin/locks/:id/force-open`);
    console.log(`  ${C.yellow}GET${C.reset}  /api/v1/admin/transactions`);
    console.log(`  ${C.yellow}GET${C.reset}  /api/v1/admin/devices`);
    console.log(`  ${C.yellow}PATCH${C.reset} /api/v1/admin/devices/:id           ${C.dim}← toggle online${C.reset}`);
    console.log(`\n${C.dim}  Waiting for requests...${C.reset}\n`);
});

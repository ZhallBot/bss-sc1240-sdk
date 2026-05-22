/**
 * @file server.js
 * @description BSS SC1240 Payment Backend — Express App Entry Point
 *
 * Starts the full payment API server with:
 *   - MongoDB connection (optional, uses in-memory mock if not set)
 *   - All payment routes
 *   - Error handling middleware
 *   - WebSocket for real-time status push (optional)
 */

'use strict';

const express     = require('express');
const cors        = require('cors');
const paymentRoutes = require('./routes/payment.routes');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ─────────────────────────────── */
app.use(cors());
app.use(express.json());

/* ── Health check ───────────────────────────── */
app.get('/health', (req, res) => {
    res.json({
        status:    'OK',
        service:   'BSS SC1240 Payment API',
        version:   '1.0.0',
        timestamp: new Date().toISOString(),
    });
});

/* ── Routes ─────────────────────────────────── */
app.use('/api/v1', paymentRoutes);

/* ── Global error handler ───────────────────── */
app.use((err, req, res, next) => {
    const status  = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    console.error(`[Error] ${status} ${req.method} ${req.path}: ${message}`);
    res.status(status).json({ error: true, message });
});

/* ── Start ──────────────────────────────────── */
app.listen(PORT, () => {
    console.log(`\n🚀 BSS SC1240 Payment API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Checkout: POST http://localhost:${PORT}/api/v1/parking/checkout`);
    console.log(`   Webhook:  POST http://localhost:${PORT}/api/v1/payments/webhook\n`);
});

module.exports = app;

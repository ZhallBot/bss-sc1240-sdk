/**
 * @file payment.routes.js
 * @description BSS SC1240 — Payment Integration Module
 * Route definitions for the Payment API layer.
 *
 * Registered under Express app:
 *   app.use('/api/v1', paymentRoutes);
 */

'use strict';

const express  = require('express');
const router   = express.Router();

const checkoutController = require('../controllers/checkout.controller');
const webhookController  = require('../controllers/webhook.controller');
const adminController    = require('../controllers/admin.controller');
const authMiddleware     = require('../middleware/auth.middleware');
const rateLimiter        = require('../middleware/rateLimiter.middleware');

/* ─────────────────────────────────────────────
 * POST /api/v1/parking/checkout
 * Initiates a payment session and generates a dynamic QRIS.
 * Called by: mobile app / entry/exit terminal when vehicle exits.
 * ───────────────────────────────────────────── */
router.post(
    '/parking/checkout',
    authMiddleware.verifyApiKey,
    rateLimiter.checkout,          // max 10 req/min per lock_id
    checkoutController.createCheckout
);

/* ─────────────────────────────────────────────
 * GET /api/v1/parking/checkout/:transaction_id
 * Poll checkout status (for terminals without WebSocket).
 * ───────────────────────────────────────────── */
router.get(
    '/parking/checkout/:transaction_id',
    authMiddleware.verifyApiKey,
    checkoutController.getCheckoutStatus
);

/* ─────────────────────────────────────────────
 * POST /api/v1/parking/checkout/:transaction_id/refresh
 * Re-generate an expired QRIS for the same transaction.
 * ───────────────────────────────────────────── */
router.post(
    '/parking/checkout/:transaction_id/refresh',
    authMiddleware.verifyApiKey,
    checkoutController.refreshQris
);

/* ─────────────────────────────────────────────
 * POST /api/v1/payments/webhook
 * Receives real-time payment status from Payment Gateway.
 * NO auth middleware here — signature verification is done inside.
 * ───────────────────────────────────────────── */
router.post(
    '/payments/webhook',
    express.raw({ type: 'application/json' }),  // raw body for HMAC
    webhookController.handleWebhook
);

/* ─────────────────────────────────────────────
 * POST /api/v1/admin/locks/:lock_id/force-open
 * Admin override: lower barrier if payment confirmed but device offline.
 * Requires admin JWT.
 * ───────────────────────────────────────────── */
router.post(
    '/admin/locks/:lock_id/force-open',
    authMiddleware.verifyAdminJwt,
    adminController.forceOpenLock
);

/* ─────────────────────────────────────────────
 * GET /api/v1/admin/transactions
 * List transactions with filters (status, date, lock_id).
 * ───────────────────────────────────────────── */
router.get(
    '/admin/transactions',
    authMiddleware.verifyAdminJwt,
    adminController.listTransactions
);

module.exports = router;

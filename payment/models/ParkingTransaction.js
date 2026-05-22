/**
 * @file ParkingTransaction.js
 * @description MongoDB Schema — ParkingTransaction
 *
 * Central record for the full lifecycle of one parking exit event.
 * Indexed for: transaction_id (unique), lock_id + status (compound),
 * and expires_at (TTL cleanup of very old expired records).
 */

'use strict';

const mongoose = require('mongoose');

const ParkingTransactionSchema = new mongoose.Schema({

    /* ── Identity ─────────────────────────────────── */
    transaction_id: {
        type:     String,
        required: true,
        unique:   true,
        index:    true,
    },
    lock_id: {
        type:     String,
        required: true,
        index:    true,
    },
    plate: {
        type:    String,
        default: null,
    },

    /* ── Timing ──────────────────────────────────── */
    entry_time: {
        type:     Date,
        required: true,
    },
    checkout_time: {
        type:     Date,
        required: true,
    },
    duration_min: {
        type:     Number,
        required: true,
    },

    /* ── Fee ─────────────────────────────────────── */
    amount_idr: {
        type:     Number,
        required: true,
    },
    amount_paid: {
        type:    Number,
        default: null,
    },

    /* ── QRIS ────────────────────────────────────── */
    qris_string: {
        type:    String,
        default: null,
    },
    qris_url: {
        type:    String,
        default: null,
    },
    expires_at: {
        type:  Date,
        index: true,
    },
    refresh_count: {
        type:    Number,
        default: 0,
    },

    /* ── Payment Gateway ─────────────────────────── */
    pg_reference: {
        type:    String,
        default: null,
    },
    pg_status: {
        type:    String,
        default: null,
    },

    /* ── State Machine ───────────────────────────── */
    status: {
        type:    String,
        enum:    [
            'QRIS_GENERATED',
            'PAID',
            'EXPIRED',
            'CANCELLED',
            'LOCK_LOWERED',
            'HARDWARE_PENDING',
            'MANUAL_NEEDED',
            'COMPLETED',
            'AMOUNT_MISMATCH',
        ],
        default: 'QRIS_GENERATED',
        index:   true,
    },
    last_state: {
        type:    String,
        default: null,
    },

    /* ── Timestamps for each state ───────────────── */
    paid_at:          { type: Date, default: null },
    lock_lowered_at:  { type: Date, default: null },
    expired_at:       { type: Date, default: null },
    completed_at:     { type: Date, default: null },

    /* ── Hardware / Fallback ─────────────────────── */
    hardware_error:   { type: String, default: null },
    force_opened_by:  { type: String, default: null },
    force_open_reason:{ type: String, default: null },
    retry_attempt:    { type: Number, default: 0    },
    manual_reason:    { type: String, default: null },

    /* ── Audit ───────────────────────────────────── */
    updated_at: {
        type:    Date,
        default: Date.now,
    },

}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

/* ── Compound index for lock_id + active status queries ─── */
ParkingTransactionSchema.index({ lock_id: 1, status: 1 });

/* ── TTL index: auto-delete COMPLETED records after 90 days ─ */
ParkingTransactionSchema.index(
    { completed_at: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 90, partialFilterExpression: { status: 'COMPLETED' } }
);

module.exports = mongoose.model('ParkingTransaction', ParkingTransactionSchema);

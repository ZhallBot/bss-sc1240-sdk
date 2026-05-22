/**
 * @file stateMachine.service.js
 * @description Module 3 — Transaction State Machine
 *
 * Enforces legal state transitions for ParkingTransaction.
 * Prevents illegal states (e.g., PAID → QRIS_GENERATED).
 * All transitions are persisted atomically to MongoDB.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │                  PARKING TRANSACTION STATE MACHINE                   │
 * │                                                                      │
 * │   ┌─────────┐   checkout    ┌───────────────┐                       │
 * │   │  START  │──────────────►│ QRIS_GENERATED│                       │
 * │   └─────────┘               └───────┬───────┘                       │
 * │                                     │                                │
 * │                    ┌────────────────┼─────────────┐                 │
 * │                    │                │             │                  │
 * │               timeout         webhook ok     webhook fail/cancel     │
 * │                    │                │             │                  │
 * │                    ▼                ▼             ▼                  │
 * │               ┌─────────┐      ┌───────┐    ┌───────────┐           │
 * │               │ EXPIRED │      │  PAID │    │ CANCELLED │           │
 * │               └────┬────┘      └───┬───┘    └───────────┘           │
 * │                    │              │                                   │
 * │            refresh │    ┌─────────┴──────────┐                      │
 * │                    │    │ HardwareService OK  │ HardwareService FAIL │
 * │                    ▼    ▼                     ▼                      │
 * │          QRIS_GENERATED  LOCK_LOWERED   HARDWARE_PENDING             │
 * │                               │               │                      │
 * │                               │           retry loop                 │
 * │                               │        (max 10 minutes)              │
 * │                               │         ┌────┴────┐                  │
 * │                               │     success    give up               │
 * │                               │         │         │                  │
 * │                               ▼         ▼         ▼                  │
 * │                          COMPLETED  LOCK_LOWERED  MANUAL_NEEDED      │
 * └──────────────────────────────────────────────────────────────────────┘
 */

'use strict';

const ParkingTransaction = require('../models/ParkingTransaction');

/* Valid transitions: from → [to, ...] */
const VALID_TRANSITIONS = new Map([
    ['QRIS_GENERATED',  ['PAID', 'EXPIRED', 'CANCELLED']],
    ['EXPIRED',         ['QRIS_GENERATED']],            // allow refresh
    ['PAID',            ['LOCK_LOWERED', 'HARDWARE_PENDING', 'AMOUNT_MISMATCH']],
    ['HARDWARE_PENDING',['LOCK_LOWERED', 'MANUAL_NEEDED']],
    ['LOCK_LOWERED',    ['COMPLETED']],
    ['COMPLETED',       []],
    ['CANCELLED',       []],
    ['MANUAL_NEEDED',   ['LOCK_LOWERED']],
    ['AMOUNT_MISMATCH', []],
]);

/* Terminal states (no further transitions allowed) */
const TERMINAL_STATES = new Set(['COMPLETED', 'CANCELLED', 'AMOUNT_MISMATCH']);

class TransactionStateMachine {

    /**
     * Validate and execute a state transition.
     * Throws an error if the transition is not allowed.
     *
     * @param {object} txn      Mongoose document (or plain object with status)
     * @param {string} newState Target state
     * @param {object} [extra]  Additional fields to update on the document
     * @returns {Promise<object>} Updated transaction
     */
    static async transitionTo(txn, newState, extra = {}) {
        const currentState = txn.status;

        if (TERMINAL_STATES.has(currentState)) {
            throw new Error(
                `[StateMachine] Cannot transition from terminal state: ${currentState}`
            );
        }

        const allowed = VALID_TRANSITIONS.get(currentState) || [];
        if (!allowed.includes(newState)) {
            throw new Error(
                `[StateMachine] Invalid transition: ${currentState} → ${newState}. ` +
                `Allowed: [${allowed.join(', ')}]`
            );
        }

        const updatePayload = {
            status:        newState,
            last_state:    currentState,
            updated_at:    new Date(),
            ...extra,
        };

        // Add timestamp for key transitions
        if (newState === 'PAID')          updatePayload.paid_at         = updatePayload.paid_at         || new Date();
        if (newState === 'LOCK_LOWERED')  updatePayload.lock_lowered_at = updatePayload.lock_lowered_at || new Date();
        if (newState === 'EXPIRED')       updatePayload.expired_at      = new Date();
        if (newState === 'COMPLETED')     updatePayload.completed_at    = new Date();

        const updated = await ParkingTransaction.findOneAndUpdate(
            {
                transaction_id: txn.transaction_id,
                status: currentState,  // Optimistic lock: ensure state hasn't changed
            },
            { $set: updatePayload },
            { new: true }
        );

        if (!updated) {
            // Race condition: another process changed state first
            const fresh = await ParkingTransaction.findOne({ transaction_id: txn.transaction_id });
            throw new Error(
                `[StateMachine] Concurrent state change detected for ${txn.transaction_id}. ` +
                `Expected: ${currentState}, found: ${fresh?.status}`
            );
        }

        console.log(
            `[StateMachine] ${txn.transaction_id}: ${currentState} → ${newState}`
        );

        return updated;
    }

    /**
     * Check if a transaction is in a state where payment can be accepted.
     * @param {string} status
     * @returns {boolean}
     */
    static canAcceptPayment(status) {
        return ['QRIS_GENERATED'].includes(status);
    }

    /**
     * Check if a lock can be force-opened by an admin.
     * @param {string} status
     * @returns {boolean}
     */
    static canForceOpen(status) {
        return ['PAID', 'HARDWARE_PENDING', 'MANUAL_NEEDED'].includes(status);
    }

    /**
     * Serialize allowed transitions for API documentation.
     * @returns {object}
     */
    static getAllTransitions() {
        const result = {};
        for (const [from, to] of VALID_TRANSITIONS.entries()) {
            result[from] = to;
        }
        return result;
    }
}

module.exports = TransactionStateMachine;

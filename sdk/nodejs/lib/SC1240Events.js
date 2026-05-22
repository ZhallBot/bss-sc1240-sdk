/**
 * @file SC1240Events.js
 * @description Module 2 — Event Listener & Telemetry Error Handler
 *
 * Extends Node.js EventEmitter with delta-detection logic that compares
 * successive telemetry snapshots and fires named events for any state changes.
 * Each error bitmask bit maps to a structured event payload.
 */

'use strict';

const { EventEmitter } = require('events');
const { ERRORS, EVENTS, ERROR_DESCRIPTIONS, LOCK_STATE } = require('./constants');

/* Error bits ordered from MSB to LSB for iteration */
const ERROR_BITS = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];

/**
 * Build a rich error event payload from a bitmask.
 * @param {number} bit
 * @param {object} telemetry
 * @returns {object}
 */
function buildErrorPayload(bit, telemetry) {
    const info = ERROR_DESCRIPTIONS[bit] || {
        code: `ERROR_${bit.toString(16).toUpperCase().padStart(2, '0')}`,
        name: 'UNKNOWN_ERROR',
        message: 'Unknown device error.',
        severity: 'error',
    };
    return {
        ...info,
        errorBit:      bit,
        baffleAngle:   telemetry.baffleAngleDeg,
        batteryPercent: telemetry.batteryPercent,
        timestamp:     Date.now(),
    };
}

/**
 * @class SC1240Events
 * @extends EventEmitter
 *
 * @example
 * const evts = new SC1240Events();
 * evts.on('vehicleDetected', ({ baffleAngle }) => console.log('Car parked, angle:', baffleAngle));
 * evts.on('error',           (payload)         => console.error('[ALARM]', payload.message));
 *
 * // Feed raw telemetry objects from SC1240Protocol.parseTelemetry()
 * evts.processTelemetry(parsedData);
 */
class SC1240Events extends EventEmitter {
    constructor() {
        super();
        this._prev = null;   // Previous telemetry snapshot
        this._errorCooldowns = {};  // Debounce repeated errors (ms)
        this.ERROR_COOLDOWN_MS = 10_000; // 10 s between repeated error events
    }

    /**
     * Process a newly parsed telemetry object and fire appropriate events.
     * @param {object} telemetry  Output of SC1240Protocol.parseTelemetry().data
     */
    processTelemetry(telemetry) {
        if (!telemetry) return;

        const prev = this._prev;

        // Always emit raw telemetry
        this.emit(EVENTS.TELEMETRY, telemetry);

        // ── Error bitmask delta ─────────────────
        const prevErr  = prev?.errorFlags ?? 0;
        const newBits  = telemetry.errorFlags & ~prevErr;  // Only newly-set bits

        for (const bit of ERROR_BITS) {
            if (newBits & bit) {
                const now = Date.now();
                const lastEmit = this._errorCooldowns[bit] || 0;
                if (now - lastEmit >= this.ERROR_COOLDOWN_MS) {
                    this._errorCooldowns[bit] = now;
                    this.emit(EVENTS.ERROR, buildErrorPayload(bit, telemetry));
                }
            }
        }

        // ── Vehicle detection delta ─────────────
        if (prev === null || telemetry.vehicleDetected !== prev.vehicleDetected) {
            if (telemetry.vehicleDetected) {
                this.emit(EVENTS.VEHICLE_DETECTED, {
                    baffleAngle:    telemetry.baffleAngleDeg,
                    batteryPercent: telemetry.batteryPercent,
                    sensorMode:     telemetry.sensorMode,
                    timestamp:      Date.now(),
                });
            } else if (prev !== null) {
                this.emit(EVENTS.VEHICLE_DEPARTED, {
                    timestamp: Date.now(),
                });
            }
        }

        // ── Lock state transitions ──────────────
        if (prev === null || telemetry.lockState !== prev.lockState) {
            if (telemetry.lockState === LOCK_STATE.RAISED) {
                this.emit(EVENTS.LOCK_RAISED, {
                    baffleAngle: telemetry.baffleAngleDeg,
                    timestamp:   Date.now(),
                });
            } else if (telemetry.lockState === LOCK_STATE.LOWERED) {
                this.emit(EVENTS.LOCK_LOWERED, { timestamp: Date.now() });
            }
        }

        // ── Battery low threshold ───────────────
        const prevBat = prev?.batteryPercent ?? 100;
        if (prevBat > 20 && telemetry.batteryPercent <= 20) {
            this.emit(EVENTS.BATTERY_LOW, {
                batteryPercent: telemetry.batteryPercent,
                voltage:        null, // populated if HAL ADC available
                timestamp:      Date.now(),
            });
        }

        // ── Solar charging state ────────────────
        if (prev && !prev.solarCharging && telemetry.solarCharging) {
            this.emit(EVENTS.SOLAR_CHARGING, { timestamp: Date.now() });
        }

        this._prev = { ...telemetry };
    }

    /**
     * Emit OTA progress from OTA module.
     * @param {'otaProgress'|'otaComplete'|'otaFailed'} eventName
     * @param {number} progressPct  0–100
     */
    emitOtaEvent(eventName, progressPct = 0) {
        this.emit(eventName, {
            progress:  progressPct,
            timestamp: Date.now(),
        });
    }

    /** Reset snapshot (e.g., after reconnect). */
    reset() {
        this._prev = null;
        this._errorCooldowns = {};
    }
}

module.exports = SC1240Events;

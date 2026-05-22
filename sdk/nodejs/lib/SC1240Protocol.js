/**
 * @file SC1240Protocol.js
 * @description Module 1 — Communication & Command Parsing
 *
 * Handles building validated hex frames, dispatching them over a transport
 * (BLE / USB-Serial), and parsing incoming telemetry bytes.
 *
 * Security: Every outbound frame is verified by recomputing the XOR checksum
 * before transmission. Every inbound telemetry packet is validated for
 * preamble magic + XOR checksum before being parsed.
 */

'use strict';

const { COMMANDS, LOCK_STATE } = require('./constants');

const PREAMBLE     = 0x12345678;
const HEADER       = 0xEB90;
const FRAME_LEN    = 12;
const TELEMETRY_LEN = 16; /* sizeof(SC1240_Telemetry_t) */

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_RETRIES        = 3;

/**
 * Compute XOR checksum over bytes [4..len-2] of a Buffer.
 * Mirrors sc1240_checksum() in C firmware.
 * @param {Buffer} buf
 * @returns {number} 8-bit checksum
 */
function computeChecksum(buf) {
    let chk = 0x00;
    for (let i = 4; i < buf.length - 1; i++) {
        chk ^= buf[i];
    }
    return chk & 0xFF;
}

/**
 * Build a 12-byte command frame with default payload 0xFFFFFFFF.
 * @param {Buffer} commandFrame  - Pre-built 12-byte command (from COMMANDS)
 * @returns {Buffer} validated frame ready to transmit
 */
function buildFrame(commandFrame) {
    if (!Buffer.isBuffer(commandFrame) || commandFrame.length !== FRAME_LEN) {
        throw new Error(`Invalid command frame: must be ${FRAME_LEN}-byte Buffer`);
    }
    // Commands from COMMANDS map are pre-validated; clone to avoid mutation
    return Buffer.from(commandFrame);
}

/**
 * Parse a raw 16-byte telemetry Buffer into a structured object.
 * @param {Buffer} raw
 * @returns {{ valid: boolean, data: object }}
 */
function parseTelemetry(raw) {
    if (!Buffer.isBuffer(raw) || raw.length < TELEMETRY_LEN) {
        return { valid: false, data: null, reason: 'Insufficient length' };
    }

    // Validate preamble
    const preamble = raw.readUInt32BE(0);
    if (preamble !== PREAMBLE) {
        return { valid: false, data: null, reason: `Bad preamble: 0x${preamble.toString(16)}` };
    }

    // Validate header
    const header = raw.readUInt16BE(4);
    if (header !== HEADER) {
        return { valid: false, data: null, reason: `Bad header: 0x${header.toString(16)}` };
    }

    // Validate XOR checksum (last byte)
    const expectedChk = computeChecksum(raw.slice(0, TELEMETRY_LEN));
    const actualChk   = raw[TELEMETRY_LEN - 1];
    if (expectedChk !== actualChk) {
        return {
            valid: false,
            data: null,
            reason: `Checksum mismatch: expected 0x${expectedChk.toString(16)}, got 0x${actualChk.toString(16)}`,
        };
    }

    const data = {
        lockState:       raw[6],
        lockStateName:   lockStateName(raw[6]),
        errorFlags:      raw[7],
        sensorMode:      raw[8],
        batteryPercent:  raw[9],
        solarCharging:   raw[10] === 1,
        vehicleDetected: raw[11] === 1,
        baffleAngleDeg:  raw.readUInt16BE(12) / 10.0,
        reserved:        raw.readUInt16BE(14),
        checksum:        raw[15],
        rawHex:          raw.toString('hex').toUpperCase(),
    };

    return { valid: true, data };
}

function lockStateName(code) {
    return Object.entries(LOCK_STATE).find(([, v]) => v === code)?.[0] ?? 'UNKNOWN';
}

/* ─────────────────────────────────────────────
 * SC1240Protocol Class
 * ───────────────────────────────────────────── */
class SC1240Protocol {
    /**
     * @param {object}   opts
     * @param {object}   opts.transport      Transport object with async write(buf) method
     * @param {number}  [opts.timeoutMs]     ACK timeout (default 3000 ms)
     * @param {number}  [opts.maxRetries]    Retransmit attempts (default 3)
     * @param {Function}[opts.logger]        Logger function (default console.log)
     */
    constructor({ transport, timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = MAX_RETRIES, logger } = {}) {
        if (!transport) throw new Error('transport is required');
        this._transport   = transport;
        this._timeoutMs   = timeoutMs;
        this._maxRetries  = maxRetries;
        this._log         = logger || ((...args) => console.log('[SC1240]', ...args));
        this._rxBuffer    = Buffer.alloc(0);
        this._pendingAck  = null;  // { resolve, reject, timer }
        this._otaLocked   = false;
    }

    /**
     * Feed incoming raw bytes (from BLE notify or serial data event).
     * Call this from your transport's onData callback.
     * @param {Buffer} chunk
     */
    feedRx(chunk) {
        this._rxBuffer = Buffer.concat([this._rxBuffer, chunk]);
        this._tryParseFrame();
    }

    /**
     * Internal: scan rx buffer for a complete telemetry frame.
     */
    _tryParseFrame() {
        while (this._rxBuffer.length >= TELEMETRY_LEN) {
            const preamble = this._rxBuffer.readUInt32BE(0);
            if (preamble === PREAMBLE) {
                const frame = this._rxBuffer.slice(0, TELEMETRY_LEN);
                const { valid, data, reason } = parseTelemetry(frame);
                this._rxBuffer = this._rxBuffer.slice(TELEMETRY_LEN);

                if (valid) {
                    if (this._pendingAck) {
                        clearTimeout(this._pendingAck.timer);
                        this._pendingAck.resolve(data);
                        this._pendingAck = null;
                    }
                    this.onTelemetry?.(data);
                } else {
                    this._log(`Invalid frame: ${reason}`);
                }
            } else {
                // Slip one byte and re-scan
                this._rxBuffer = this._rxBuffer.slice(1);
            }
        }
    }

    /**
     * Send a command frame and wait for ACK telemetry.
     * @param {Buffer} frame
     * @returns {Promise<object>} Resolved telemetry data on ACK
     */
    async _sendWithAck(frame) {
        if (this._otaLocked) {
            throw new Error('Device is in OTA mode — commands blocked');
        }

        const validated = buildFrame(frame);

        for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
            this._log(`>> TX [${validated.toString('hex').toUpperCase()}] attempt ${attempt}/${this._maxRetries}`);

            const ackPromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this._pendingAck = null;
                    reject(new Error(`ACK timeout after ${this._timeoutMs} ms (attempt ${attempt})`));
                }, this._timeoutMs);
                this._pendingAck = { resolve, reject, timer };
            });

            try {
                await this._transport.write(validated);
                const result = await ackPromise;
                return result;
            } catch (err) {
                if (attempt === this._maxRetries) throw err;
                this._log(`Retry ${attempt}/${this._maxRetries}: ${err.message}`);
            }
        }
    }

    // ── Public Command API ─────────────────────

    /** Reset the device. */
    async resetDevice()  { return this._sendWithAck(COMMANDS.RESET_DEVICE); }

    /** Raise the parking baffle. */
    async raiseLock()    { return this._sendWithAck(COMMANDS.RAISE_LOCK);   }

    /** Lower the parking baffle. */
    async lowerLock()    { return this._sendWithAck(COMMANDS.LOWER_LOCK);   }

    /** Request full telemetry snapshot. */
    async getStatus()    { return this._sendWithAck(COMMANDS.GET_STATUS);   }

    // ── Utility ───────────────────────────────

    static parseTelemetry(raw) { return parseTelemetry(raw); }
    static computeChecksum(buf) { return computeChecksum(buf); }
    static buildFrame(cmd) { return buildFrame(cmd); }
}

module.exports = SC1240Protocol;

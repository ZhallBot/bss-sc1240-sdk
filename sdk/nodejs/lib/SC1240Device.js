/**
 * @file SC1240Device.js
 * @description High-level SC1240 Device facade
 *
 * Orchestrates SC1240Protocol, SC1240Events, SC1240Power, and SC1240OTA
 * into a single ergonomic class. Applications interact exclusively with
 * this class for most use-cases.
 *
 * @example
 * const { SC1240Device } = require('sc1240-sdk');
 *
 * const device = new SC1240Device({
 *   transport: myBleTransport,  // any object with async write(buf) + onData callback
 * });
 *
 * device.on('vehicleDetected', async () => {
 *   console.log('Vehicle detected — raising lock...');
 *   await device.raiseLock();
 * });
 *
 * device.on('lockRaised', () => console.log('Lock is UP'));
 * device.on('error', payload => console.error('[ALARM]', payload.message));
 *
 * await device.connect();
 */

'use strict';

const { EventEmitter } = require('events');
const SC1240Protocol   = require('./SC1240Protocol');
const SC1240Events     = require('./SC1240Events');
const SC1240Power      = require('./SC1240Power');
const SC1240OTA        = require('./SC1240OTA');
const { EVENTS }       = require('./constants');

class SC1240Device extends EventEmitter {
    /**
     * @param {object}   opts
     * @param {object}   opts.transport     Transport adapter (BLE/Serial)
     *                                     Must have: write(buf), onData(fn), connect(), disconnect()
     * @param {number}  [opts.timeoutMs]   Command ACK timeout ms (default 3000)
     * @param {number}  [opts.maxRetries]  Max retry attempts (default 3)
     * @param {boolean} [opts.autoReconnect] Re-connect on disconnect (default false)
     * @param {Function}[opts.logger]      Custom logger function
     */
    constructor({
        transport,
        timeoutMs    = 3000,
        maxRetries   = 3,
        autoReconnect = false,
        logger,
    } = {}) {
        super();

        if (!transport) throw new Error('[SC1240Device] transport is required');

        this._transport     = transport;
        this._autoReconnect = autoReconnect;
        this._log           = logger || ((...a) => console.log('[SC1240Device]', ...a));
        this._connected     = false;

        // Compose modules
        this._protocol = new SC1240Protocol({
            transport,
            timeoutMs,
            maxRetries,
            logger: this._log,
        });

        this._events  = new SC1240Events();
        this._power   = new SC1240Power(this._protocol);
        this._ota     = new SC1240OTA({
            protocol: this._protocol,
            events:   this._events,
            power:    this._power,
        });

        // Bridge telemetry from protocol → events module
        this._protocol.onTelemetry = (data) => {
            this._events.processTelemetry(data);
        };

        // Bridge all SC1240Events → this device's EventEmitter
        for (const evtName of Object.values(EVENTS)) {
            this._events.on(evtName, (payload) => this.emit(evtName, payload));
        }

        // Transport lifecycle hooks
        if (transport.onDisconnect) {
            transport.onDisconnect(() => {
                this._connected = false;
                this.emit(EVENTS.DISCONNECTED);
                this._log('Disconnected from device');
                if (this._autoReconnect) {
                    setTimeout(() => this.connect().catch(e => this._log('Reconnect failed:', e)), 3000);
                }
            });
        }
    }

    // ── Lifecycle ────────────────────────────

    /**
     * Open the transport connection and subscribe to telemetry notifications.
     * @returns {Promise<void>}
     */
    async connect() {
        this._log('Connecting...');
        await this._transport.connect();
        // Subscribe to RX data and pipe into protocol parser
        this._transport.onData((chunk) => this._protocol.feedRx(chunk));
        this._connected = true;
        this._events.reset();
        this.emit(EVENTS.CONNECTED);
        this._log('Connected');
    }

    /**
     * Close the transport connection.
     */
    async disconnect() {
        await this._transport.disconnect?.();
        this._connected = false;
        this.emit(EVENTS.DISCONNECTED);
    }

    get isConnected() { return this._connected; }

    // ── Commands ─────────────────────────────

    /** Soft-reset the device MCU. */
    async resetDevice() {
        this._assertConnected();
        return this._protocol.resetDevice();
    }

    /** Raise the parking baffle. */
    async raiseLock() {
        this._assertConnected();
        return this._protocol.raiseLock();
    }

    /** Lower the parking baffle. */
    async lowerLock() {
        this._assertConnected();
        return this._protocol.lowerLock();
    }

    /** Request a full telemetry snapshot. */
    async getStatus() {
        this._assertConnected();
        return this._protocol.getStatus();
    }

    // ── Power ────────────────────────────────

    /**
     * Get battery percentage, solar charging state, and status label.
     * @returns {Promise<SC1240BatteryStatus>}
     */
    async getBatteryStatus() {
        this._assertConnected();
        return this._power.getBatteryStatus();
    }

    // ── OTA ──────────────────────────────────

    /**
     * Perform OTA firmware update.
     * @param {string|Buffer} firmwareSource  Path to .bin or raw Buffer
     * @param {object}       [opts]           See SC1240OTA.update options
     * @returns {Promise<void>}
     */
    async updateFirmware(firmwareSource, opts = {}) {
        this._assertConnected();
        opts.onProgress = opts.onProgress || ((pct, idx, total) => {
            this._log(`OTA: ${pct}% (${idx}/${total} chunks)`);
        });
        return this._ota.update(firmwareSource, opts);
    }

    // ── Internal ─────────────────────────────

    _assertConnected() {
        if (!this._connected) {
            throw new Error('Not connected. Call device.connect() first.');
        }
    }

    // ── Direct module access (advanced users) ─

    get protocol() { return this._protocol; }
    get events()   { return this._events;   }
    get power()    { return this._power;    }
    get ota()      { return this._ota;      }
}

module.exports = SC1240Device;

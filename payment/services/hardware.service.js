/**
 * @file hardware.service.js
 * @description IoT Hardware Bridge Service
 *
 * Bridges the payment backend to the SC1240 SDK.
 * Manages a registry of connected SC1240Device instances (one per lock_id).
 * In production: devices connect via BLE gateway (e.g., Raspberry Pi) or
 * via MQTT broker → hardware agent → BLE.
 *
 * Connection modes:
 *   - DIRECT_BLE:  Node.js process has direct BLE access (same machine as gateway)
 *   - MQTT:        Commands dispatched via MQTT broker to a remote BLE gateway
 *   - HTTP:        Commands sent to a local HTTP agent running on the BLE gateway
 */

'use strict';

const axios = require('axios');

/* ─────────────────────────────────────────────
 * Device Registry
 * Maps lock_id → { agentUrl, mqttTopic, status }
 * In production: load from DB / config service
 * ───────────────────────────────────────────── */
const DEVICE_REGISTRY = {
    'SC1240-A01': { agentUrl: process.env.AGENT_A01_URL || 'http://192.168.1.101:8080', mode: 'HTTP' },
    'SC1240-A02': { agentUrl: process.env.AGENT_A02_URL || 'http://192.168.1.102:8080', mode: 'HTTP' },
    'SC1240-B01': { mqttTopic: 'bss/locks/B01/cmd',  mode: 'MQTT' },
};

const COMMAND_TIMEOUT_MS = 5000;   // 5 seconds
const LOWER_LOCK_HEX     = '12345678EB90FFFFFFFF0235';

class HardwareService {

    /**
     * Send the lowerLock command (0x0235) to the specified lock.
     * Throws if the device is unreachable or returns an error.
     *
     * @param {string} lock_id  e.g., 'SC1240-A01'
     * @returns {Promise<void>}
     */
    async lowerLock(lock_id) {
        const device = DEVICE_REGISTRY[lock_id];
        if (!device) {
            throw new Error(`Unknown lock_id: ${lock_id}. Not in device registry.`);
        }

        console.log(`[Hardware] lowerLock → ${lock_id} (mode: ${device.mode})`);

        switch (device.mode) {
            case 'HTTP':  return this._sendViaHttp(device.agentUrl, lock_id, 'LOWER_LOCK');
            case 'MQTT':  return this._sendViaMqtt(device.mqttTopic, 'LOWER_LOCK');
            default:      throw new Error(`Unsupported device mode: ${device.mode}`);
        }
    }

    /**
     * Send the raiseLock command (0x0234) to the specified lock.
     * Used for admin actions / error recovery.
     *
     * @param {string} lock_id
     * @returns {Promise<void>}
     */
    async raiseLock(lock_id) {
        const device = DEVICE_REGISTRY[lock_id];
        if (!device) throw new Error(`Unknown lock_id: ${lock_id}`);

        switch (device.mode) {
            case 'HTTP': return this._sendViaHttp(device.agentUrl, lock_id, 'RAISE_LOCK');
            case 'MQTT': return this._sendViaMqtt(device.mqttTopic, 'RAISE_LOCK');
            default:     throw new Error(`Unsupported device mode: ${device.mode}`);
        }
    }

    /**
     * Query device status.
     * @param {string} lock_id
     * @returns {Promise<object>}  Telemetry snapshot
     */
    async getStatus(lock_id) {
        const device = DEVICE_REGISTRY[lock_id];
        if (!device) throw new Error(`Unknown lock_id: ${lock_id}`);

        const response = await axios.get(`${device.agentUrl}/status/${lock_id}`, {
            timeout: COMMAND_TIMEOUT_MS,
        });
        return response.data;
    }

    /* ─────────────────────────────────────────
     * HTTP Agent Transport
     * The BLE gateway agent exposes:
     *   POST /command  { lock_id, command }
     * ─────────────────────────────────────────*/
    async _sendViaHttp(agentUrl, lock_id, command) {
        const payload = {
            lock_id,
            command,
            hex:       LOWER_LOCK_HEX,  // included for audit trail
            timestamp: new Date().toISOString(),
        };

        const response = await axios.post(`${agentUrl}/command`, payload, {
            timeout: COMMAND_TIMEOUT_MS,
            headers: {
                'Content-Type':  'application/json',
                'X-Agent-Token': process.env.BLE_AGENT_TOKEN || 'changeme',
            },
        });

        if (response.data?.status !== 'OK' && response.data?.status !== 'ok') {
            throw new Error(
                `Agent returned non-OK status: ${JSON.stringify(response.data)}`
            );
        }

        console.log(`[Hardware] HTTP command ${command} ACK from ${lock_id}`);
    }

    /* ─────────────────────────────────────────
     * MQTT Transport
     * In production: use mqtt.js client with QoS 1
     * ─────────────────────────────────────────*/
    async _sendViaMqtt(topic, command) {
        // Placeholder: in production inject an mqtt.Client instance
        // await mqttClient.publishAsync(topic, JSON.stringify({ command }), { qos: 1 });
        console.log(`[Hardware] MQTT → topic: ${topic}, command: ${command} (stub)`);
        throw new Error('MQTT transport not yet configured. Install mqtt.js and inject client.');
    }
}

module.exports = new HardwareService();

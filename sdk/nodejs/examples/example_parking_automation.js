/**
 * @file example_parking_automation.js
 * @description SDK Usage Example — Smart Parking Automation
 *
 * Demonstrates the core use-case:
 *   1. Connect to a SC1240 lock via BLE
 *   2. Listen for vehicleDetected → automatically raise the lock
 *   3. Listen for vehicleDeparted → lower the lock
 *   4. Handle all error events with appropriate responses
 *   5. Log battery status periodically
 *   6. Perform OTA firmware update
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOTE: This example uses a MockBleTransport. In production, replace with
 *       a real transport (e.g., using the `@abandonware/noble` npm package
 *       for Node.js BLE or a `serialport`-based transport for USB-Serial).
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { SC1240Device } = require('../index');

/* ─────────────────────────────────────────────
 * Mock BLE Transport (replace with real one)
 * In production:
 *   npm install @abandonware/noble
 *   const transport = new BleTransport('AA:BB:CC:DD:EE:FF');
 * ───────────────────────────────────────────── */
class MockBleTransport {
    constructor(deviceId) {
        this.deviceId    = deviceId;
        this._dataCallback = null;
        this._disconnectCb = null;
        console.log(`[Transport] Mock BLE transport for device: ${deviceId}`);
    }

    async connect() {
        console.log(`[Transport] Connected to ${this.deviceId}`);
        // Simulate device sending initial telemetry after connection
        setTimeout(() => this._simulateTelemetry({ vehicleDetected: false, lockState: 0x00, batteryPercent: 78, solarCharging: true }), 500);
    }

    async disconnect() {
        console.log(`[Transport] Disconnected`);
    }

    async write(buf) {
        const hex = buf.toString('hex').toUpperCase();
        console.log(`[Transport] >> TX: ${hex}`);

        // Simulate ACK telemetry response
        setTimeout(() => {
            const opcode = buf.readUInt16BE(buf.length >= 12 ? 10 : 6);
            let lockState = 0x00;
            if (opcode === 0x0234) lockState = 0x02; // RAISED
            if (opcode === 0x0235) lockState = 0x00; // LOWERED
            if (opcode === 0x0233) lockState = 0x00; // RESET
            this._simulateTelemetry({ lockState, batteryPercent: 78, solarCharging: true, vehicleDetected: false });
        }, 200);
    }

    onData(cb) {
        this._dataCallback = cb;
    }

    onDisconnect(cb) {
        this._disconnectCb = cb;
    }

    /** Simulate a telemetry packet arriving from the device */
    _simulateTelemetry({ lockState = 0x00, errorFlags = 0x00, sensorMode = 0x01,
                          batteryPercent = 85, solarCharging = false, vehicleDetected = false,
                          baffleAngleDeg = 90.0 }) {
        // Build a valid 16-byte telemetry packet
        const buf = Buffer.alloc(16, 0x00);
        buf.writeUInt32BE(0x12345678, 0);  // PREAMBLE
        buf.writeUInt16BE(0xEB90,     4);  // HEADER
        buf[6]  = lockState;
        buf[7]  = errorFlags;
        buf[8]  = sensorMode;
        buf[9]  = batteryPercent;
        buf[10] = solarCharging ? 1 : 0;
        buf[11] = vehicleDetected ? 1 : 0;
        buf.writeUInt16BE(Math.round(baffleAngleDeg * 10), 12);
        buf.writeUInt16BE(0x0000, 14); // reserved
        // Compute XOR checksum bytes [4..14]
        let chk = 0;
        for (let i = 4; i < 15; i++) chk ^= buf[i];
        buf[15] = chk & 0xFF;

        if (this._dataCallback) {
            console.log(`[Transport] << RX (simulated telemetry): ${buf.toString('hex').toUpperCase()}`);
            this._dataCallback(buf);
        }
    }
}

/* ─────────────────────────────────────────────
 * Main Application Logic
 * ───────────────────────────────────────────── */
async function main() {
    console.log('═══════════════════════════════════════════');
    console.log(' BSS SC1240 Smart Parking — Demo App       ');
    console.log('═══════════════════════════════════════════\n');

    const transport = new MockBleTransport('AA:BB:CC:DD:EE:FF');
    const device    = new SC1240Device({ transport, timeoutMs: 5000 });

    /* ── Event: Vehicle Detected ─────────────
     * Core automation: when a car parks, raise the baffle lock
     */
    device.on('vehicleDetected', async ({ baffleAngle, batteryPercent }) => {
        console.log(`\n🚗 VEHICLE DETECTED — angle: ${baffleAngle}° | battery: ${batteryPercent}%`);
        try {
            console.log('   → Raising lock...');
            await device.raiseLock();
        } catch (err) {
            console.error('   ✗ Failed to raise lock:', err.message);
        }
    });

    /* ── Event: Lock Raised ─────────────────*/
    device.on('lockRaised', ({ baffleAngle }) => {
        console.log(`\n🔒 LOCK RAISED — baffle angle: ${baffleAngle}°`);
        console.log('   Space is now secured.');
    });

    /* ── Event: Vehicle Departed ────────────*/
    device.on('vehicleDeparted', async () => {
        console.log('\n🚦 VEHICLE DEPARTED — lowering lock...');
        try {
            await device.lowerLock();
        } catch (err) {
            console.error('   ✗ Failed to lower lock:', err.message);
        }
    });

    /* ── Event: Lock Lowered ────────────────*/
    device.on('lockLowered', () => {
        console.log('🔓 LOCK LOWERED — space is free.');
    });

    /* ── Event: Error Handling ──────────────*/
    device.on('error', (payload) => {
        const icon = {
            critical: '🔴',
            warning:  '🟡',
            error:    '🟠',
        }[payload.severity] || '⚠️';
        console.error(`\n${icon} [${payload.code}] ${payload.name}`);
        console.error(`   ${payload.message}`);
        console.error(`   Baffle angle: ${payload.baffleAngle}° | Battery: ${payload.batteryPercent}%`);

        // Auto-response for critical errors
        if (payload.name === 'SHAKING_ALARM') {
            console.warn('   → ALERT: Notifying security operator...');
            // notifyOperator(payload);  // Your backend call here
        }
        if (payload.name === 'OBSTACLE_HIT') {
            console.warn('   → Auto-bounce activated. Lock returned to ground.');
        }
    });

    /* ── Event: Battery Low ─────────────────*/
    device.on('batteryLow', ({ batteryPercent }) => {
        console.warn(`\n🔋 BATTERY LOW: ${batteryPercent}% — check solar panel`);
    });

    /* ── Event: Solar Charging ──────────────*/
    device.on('solarCharging', () => {
        console.log('\n☀️  Solar panel charging detected');
    });

    /* ── Event: OTA Progress ────────────────*/
    device.on('otaProgress', ({ progress }) => {
        process.stdout.write(`\r📡 OTA Update: ${'█'.repeat(Math.floor(progress / 5))}${'░'.repeat(20 - Math.floor(progress / 5))} ${progress}%`);
    });
    device.on('otaComplete', () => {
        console.log('\n✅ OTA Update Complete — device rebooting');
    });
    device.on('otaFailed', () => {
        console.error('\n❌ OTA Update FAILED — device reverted to previous firmware');
    });

    /* ── Connect ────────────────────────────*/
    await device.connect();

    /* ── Query battery status ───────────────*/
    await new Promise(r => setTimeout(r, 700));  // Wait for initial telemetry
    try {
        const battery = await device.getBatteryStatus();
        console.log(`\n🔋 Battery: ${battery.percent}% | Solar: ${battery.solarCharging ? 'Charging ☀️' : 'Not charging'} | Status: ${battery.status}`);
    } catch (e) {
        console.error('Battery query failed:', e.message);
    }

    /* ── Simulate vehicle arriving ──────────*/
    console.log('\n[Demo] Simulating vehicle detection in 2s...');
    setTimeout(() => {
        transport._simulateTelemetry({ vehicleDetected: true, lockState: 0x00, batteryPercent: 78, baffleAngleDeg: 0 });
    }, 2000);

    /* ── Simulate vehicle departing ─────────*/
    setTimeout(() => {
        transport._simulateTelemetry({ vehicleDetected: false, lockState: 0x02, batteryPercent: 78, baffleAngleDeg: 90 });
    }, 6000);

    /* ── Keep process alive for demo ────────*/
    await new Promise(r => setTimeout(r, 10000));
    await device.disconnect();
    console.log('\n[Demo] Done.');
}

main().catch(console.error);

/**
 * @file SC1240Power.js
 * @description Module 4 (partial) — Power Management: getBatteryStatus()
 *
 * Queries the device via CMD_GET_STATUS and extracts battery + solar data.
 * Includes the lead-acid voltage → percentage LUT (mirrored from firmware).
 */

'use strict';

/** Lead-acid 12V open-circuit voltage → charge percentage LUT */
const BATTERY_LUT = [
    { v: 12.80, pct: 100 },
    { v: 12.65, pct: 90  },
    { v: 12.50, pct: 80  },
    { v: 12.35, pct: 70  },
    { v: 12.20, pct: 60  },
    { v: 12.05, pct: 50  },
    { v: 11.90, pct: 40  },
    { v: 11.75, pct: 30  },
    { v: 11.60, pct: 20  },
    { v: 11.40, pct: 10  },
    { v: 11.10, pct: 0   },
];

/**
 * Convert lead-acid terminal voltage to percentage via linear interpolation.
 * @param {number} v  Measured voltage in volts
 * @returns {number}  0–100
 */
function voltageToPercent(v) {
    if (v >= BATTERY_LUT[0].v)                       return 100;
    if (v <= BATTERY_LUT[BATTERY_LUT.length - 1].v)  return 0;

    for (let i = 0; i < BATTERY_LUT.length - 1; i++) {
        if (v <= BATTERY_LUT[i].v && v > BATTERY_LUT[i + 1].v) {
            const spanV   = BATTERY_LUT[i].v   - BATTERY_LUT[i + 1].v;
            const spanPct = BATTERY_LUT[i].pct - BATTERY_LUT[i + 1].pct;
            const ratio   = (v - BATTERY_LUT[i + 1].v) / spanV;
            return Math.round(BATTERY_LUT[i + 1].pct + ratio * spanPct);
        }
    }
    return 0;
}

class SC1240Power {
    /**
     * @param {SC1240Protocol} protocol  SC1240Protocol instance
     */
    constructor(protocol) {
        if (!protocol) throw new Error('SC1240Protocol instance is required');
        this._protocol = protocol;
    }

    /**
     * Query the device for battery and solar charging status.
     *
     * @returns {Promise<{
     *   percent:          number,
     *   voltageV:         number|null,
     *   solarCharging:    boolean,
     *   lowBattery:       boolean,
     *   criticalBattery:  boolean,
     *   status:           string
     * }>}
     */
    async getBatteryStatus() {
        const telemetry = await this._protocol.getStatus();

        const percent        = telemetry.batteryPercent;
        const solarCharging  = telemetry.solarCharging;
        const lowBattery     = percent <= 20;
        const criticalBattery = percent <= 10;

        let statusLabel = 'OK';
        if (criticalBattery) statusLabel = 'CRITICAL';
        else if (lowBattery)  statusLabel = 'LOW';
        else if (solarCharging) statusLabel = 'CHARGING';

        return {
            percent,
            voltageV:        null,  // Direct voltage only available via ADC HAL
            solarCharging,
            lowBattery,
            criticalBattery,
            status: statusLabel,
        };
    }

    /**
     * Utility: convert a raw lead-acid voltage reading to a percentage.
     * Useful when voltage is obtained from an external ADC over MQTT/HTTP.
     * @param {number} voltageV
     * @returns {number} 0–100
     */
    static voltageToPercent(voltageV) {
        return voltageToPercent(voltageV);
    }

    static get BATTERY_LUT() { return BATTERY_LUT; }
}

module.exports = SC1240Power;

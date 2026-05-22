/**
 * @file feeCalculator.js
 * @description Parking Fee Calculation Utility
 *
 * Fee structure:
 *   - Base fee: IDR 3,000 for first 30 minutes
 *   - Per hour: IDR 5,000 per hour (or part thereof) after 30 min
 *   - Daily cap: IDR 50,000 maximum per session
 *
 * Examples:
 *   20 min  → IDR 3,000  (within base duration)
 *   45 min  → IDR 8,000  (base + 1 hour)
 *   90 min  → IDR 13,000 (base + 2 hours)
 *   12 hrs  → IDR 50,000 (daily cap)
 */

'use strict';

/**
 * Calculate parking fee.
 *
 * @param {Date}   entryTime
 * @param {Date}   exitTime
 * @param {object} config
 * @param {number} config.base_fee_idr        Flat fee for first base_duration_min
 * @param {number} config.base_duration_min   Minutes covered by base fee
 * @param {number} config.per_hour_idr        Fee per additional hour (or part)
 * @param {number} config.max_daily_idr       Maximum daily cap
 *
 * @returns {{ amount_idr: number, duration_min: number, breakdown: object }}
 */
function calculateParkingFee(entryTime, exitTime, config) {
    const {
        base_fee_idr      = 3000,
        base_duration_min = 30,
        per_hour_idr      = 5000,
        max_daily_idr     = 50000,
    } = config;

    // Duration in minutes (always positive)
    const duration_min = Math.ceil((exitTime - entryTime) / 60000);

    if (duration_min <= 0) {
        throw new Error('Exit time must be after entry time');
    }

    let amount_idr = base_fee_idr;
    let additional_hours = 0;

    if (duration_min > base_duration_min) {
        const extra_minutes = duration_min - base_duration_min;
        additional_hours    = Math.ceil(extra_minutes / 60);
        amount_idr         += additional_hours * per_hour_idr;
    }

    // Apply daily cap
    amount_idr = Math.min(amount_idr, max_daily_idr);

    return {
        amount_idr,
        duration_min,
        breakdown: {
            base_fee_idr,
            additional_hours,
            additional_fee_idr: additional_hours * per_hour_idr,
            capped:             amount_idr === max_daily_idr,
        },
    };
}

module.exports = { calculateParkingFee };

/**
 * @file constants.js
 * @description Protocol constants mirroring sc1240_protocol.h
 */

'use strict';

/** 12-byte fixed command frames (Buffer literals) */
const COMMANDS = Object.freeze({
    RESET_DEVICE: Buffer.from('12345678EB90FFFFFFFF0233', 'hex'),
    RAISE_LOCK:   Buffer.from('12345678EB90FFFFFFFF0234', 'hex'),
    LOWER_LOCK:   Buffer.from('12345678EB90FFFFFFFF0235', 'hex'),
    GET_STATUS:   Buffer.from('12345678EB90FFFFFFFF0236', 'hex'),
    OTA_BEGIN:    Buffer.from('12345678EB90FFFFFFFF0240', 'hex'),
    OTA_COMMIT:   Buffer.from('12345678EB90FFFFFFFF0242', 'hex'),
    OTA_ABORT:    Buffer.from('12345678EB90FFFFFFFF0243', 'hex'),
});

/** Error bitmask codes */
const ERRORS = Object.freeze({
    NONE:          0x00,
    GEOMAG_FAIL:   0x01,
    RADAR_FAIL:    0x02,
    ANGLE_FAIL:    0x04,
    PROBE_FAIL:    0x08,
    OBSTACLE_HIT:  0x10,
    SHAKING_ALARM: 0x20,
    LIFT_TIMEOUT:  0x40,
    BAFFLE_JAMMED: 0x80,
});

/** Human-readable descriptions for each error bit */
const ERROR_DESCRIPTIONS = Object.freeze({
    [0x80]: {
        code: 'ERROR_80',
        name: 'BAFFLE_JAMMED',
        message: 'Baffle Jammed — mechanical obstruction detected. Inspect for foreign objects. Manual intervention required.',
        severity: 'critical',
    },
    [0x40]: {
        code: 'ERROR_40',
        name: 'LIFT_TIMEOUT',
        message: 'Lifting Timeout — motor failed to complete raise cycle. Check motor and drive circuit.',
        severity: 'critical',
    },
    [0x20]: {
        code: 'ERROR_20',
        name: 'SHAKING_ALARM',
        message: 'Shaking Alarm — abnormal vibration detected. Possible fare evasion or vandalism. Alert operator.',
        severity: 'warning',
    },
    [0x10]: {
        code: 'ERROR_10',
        name: 'OBSTACLE_HIT',
        message: 'Obstacle During Raise — baffle angle < 35°. Auto-bounce protection activated.',
        severity: 'warning',
    },
    [0x08]: {
        code: 'ERROR_08',
        name: 'PROBE_FAIL',
        message: 'Probe Communication Failure — sensor bus not responding. Check wiring.',
        severity: 'error',
    },
    [0x04]: {
        code: 'ERROR_04',
        name: 'ANGLE_FAIL',
        message: 'Angle Sensor Failure — tilt reading out of range. Obstacle protection degraded.',
        severity: 'error',
    },
    [0x02]: {
        code: 'ERROR_02',
        name: 'RADAR_FAIL',
        message: 'Microwave Radar Failure — detection accuracy reduced to geomagnetic + IR only.',
        severity: 'error',
    },
    [0x01]: {
        code: 'ERROR_01',
        name: 'GEOMAG_FAIL',
        message: 'Geomagnetic Sensor Failure — primary presence sensor offline. Immediate service required.',
        severity: 'critical',
    },
});

/** SDK event name constants */
const EVENTS = Object.freeze({
    CONNECTED:        'connected',
    DISCONNECTED:     'disconnected',
    VEHICLE_DETECTED: 'vehicleDetected',
    VEHICLE_DEPARTED: 'vehicleDeparted',
    LOCK_RAISED:      'lockRaised',
    LOCK_LOWERED:     'lockLowered',
    TELEMETRY:        'telemetry',
    ERROR:            'error',
    BATTERY_LOW:      'batteryLow',
    SOLAR_CHARGING:   'solarCharging',
    OTA_PROGRESS:     'otaProgress',
    OTA_COMPLETE:     'otaComplete',
    OTA_FAILED:       'otaFailed',
});

/** Lock state codes */
const LOCK_STATE = Object.freeze({
    LOWERED:  0x00,
    RAISING:  0x01,
    RAISED:   0x02,
    LOWERING: 0x03,
    FAULT:    0xFF,
});

module.exports = { COMMANDS, ERRORS, ERROR_DESCRIPTIONS, EVENTS, LOCK_STATE };

/**
 * SC1240SDK — BSS Parking Smart Lock SC1240 Node.js SDK
 * =======================================================
 * Main entry point. Exports the high-level SC1240Device class and
 * all supporting types so consumers get a single import.
 *
 * @module sc1240-sdk
 *
 * @example
 * const { SC1240Device } = require('sc1240-sdk');
 * const device = new SC1240Device({ transport: 'ble', deviceId: 'AA:BB:CC:DD:EE:FF' });
 *
 * device.on('vehicleDetected', () => device.raiseLock());
 * device.on('lockRaised',      () => console.log('Lock is up!'));
 *
 * await device.connect();
 */

'use strict';

const SC1240Device   = require('./lib/SC1240Device');
const SC1240Protocol = require('./lib/SC1240Protocol');
const SC1240Events   = require('./lib/SC1240Events');
const SC1240OTA      = require('./lib/SC1240OTA');
const SC1240Power    = require('./lib/SC1240Power');
const { COMMANDS, ERRORS, EVENTS } = require('./lib/constants');

module.exports = {
    SC1240Device,
    SC1240Protocol,
    SC1240Events,
    SC1240OTA,
    SC1240Power,
    COMMANDS,
    ERRORS,
    EVENTS,
};

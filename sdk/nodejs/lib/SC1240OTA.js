/**
 * @file SC1240OTA.js
 * @description Module 4 — OTA (Over-The-Air) Firmware Update via BLE
 *
 * Chunks a firmware binary and streams it to the SC1240 device using the
 * OTA command sequence. Emits progress events via SC1240Events.
 *
 * SAFETY RULES (mirrors firmware dual-bank logic):
 *   1. Abort if battery < 25%
 *   2. Each chunk validated with CRC-16/CCITT before transmit
 *   3. Full-image CRC32 verified on commit
 *   4. On any error: CMD_OTA_ABORT sent to restore device to bank A
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const { COMMANDS, EVENTS } = require('./constants');

const CHUNK_SIZE = 128;  // Must match SC1240_OTA_CHUNK_SIZE in firmware

/**
 * CRC-16/CCITT (polynomial 0x1021, init 0xFFFF) — pure JS implementation.
 * @param {Buffer} data
 * @returns {number} 16-bit CRC
 */
function crc16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i] << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
        }
    }
    return crc;
}

/**
 * CRC-32 (standard Ethernet polynomial) — pure JS implementation.
 * @param {Buffer} data
 * @returns {number} 32-bit CRC
 */
function crc32(data) {
    const table = crc32._table || (crc32._table = buildCrc32Table());
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildCrc32Table() {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
    }
    return t;
}

class SC1240OTA {
    /**
     * @param {object}        opts
     * @param {SC1240Protocol} opts.protocol   Protocol instance
     * @param {SC1240Events}   opts.events     Events instance (for progress)
     * @param {SC1240Power}    opts.power      Power instance (battery check)
     */
    constructor({ protocol, events, power }) {
        if (!protocol) throw new Error('SC1240Protocol instance required');
        this._protocol = protocol;
        this._events   = events;
        this._power    = power;
        this._inProgress = false;
    }

    /**
     * Perform a complete OTA firmware update.
     *
     * @param {string|Buffer} firmwareSource  Path to .bin file OR raw Buffer
     * @param {object}       [opts]
     * @param {number}       [opts.retryPerChunk=3]  Retransmit attempts per chunk
     * @param {Function}     [opts.onProgress]       Callback(pct, chunkIdx, total)
     * @returns {Promise<void>}
     */
    async update(firmwareSource, opts = {}) {
        if (this._inProgress) {
            throw new Error('OTA already in progress');
        }

        const { retryPerChunk = 3, onProgress } = opts;

        // ── 1. Load firmware image ─────────────
        let image;
        if (typeof firmwareSource === 'string') {
            const filePath = path.resolve(firmwareSource);
            if (!fs.existsSync(filePath)) throw new Error(`Firmware file not found: ${filePath}`);
            image = fs.readFileSync(filePath);
        } else if (Buffer.isBuffer(firmwareSource)) {
            image = firmwareSource;
        } else {
            throw new Error('firmwareSource must be a file path string or Buffer');
        }

        // ── 2. Battery safety gate ─────────────
        if (this._power) {
            const bat = await this._power.getBatteryStatus();
            if (bat.percent < 25) {
                throw new Error(`OTA aborted: Battery too low (${bat.percent}%). Need ≥ 25%.`);
            }
        }

        // ── 3. Pre-compute checksums ───────────
        const imageCrc32  = crc32(image);
        const totalChunks = Math.ceil(image.length / CHUNK_SIZE);

        console.log(`[OTA] Starting: ${image.length} bytes, ${totalChunks} chunks, CRC32=0x${imageCrc32.toString(16).toUpperCase()}`);

        this._inProgress = true;
        this._protocol._otaLocked = true;

        try {
            // ── 4. Send OTA_BEGIN ──────────────
            const beginFrame = this._buildOtaBeginFrame(totalChunks, imageCrc32, image.length);
            await this._protocol._transport.write(beginFrame);
            await this._delay(500);  // Allow device to erase Bank B

            // ── 5. Stream chunks ───────────────
            for (let i = 0; i < totalChunks; i++) {
                const offset  = i * CHUNK_SIZE;
                const payload = image.slice(offset, offset + CHUNK_SIZE);

                // Pad last chunk to CHUNK_SIZE
                const chunk   = Buffer.alloc(CHUNK_SIZE, 0x00);
                payload.copy(chunk, 0);

                const chunkCrc16 = crc16(chunk);
                const chunkFrame = this._buildChunkFrame(i, totalChunks, chunk, chunkCrc16);

                let sent = false;
                for (let attempt = 0; attempt < retryPerChunk && !sent; attempt++) {
                    try {
                        await this._protocol._transport.write(chunkFrame);
                        await this._delay(50);  // BLE throughput pacing
                        sent = true;
                    } catch (err) {
                        if (attempt === retryPerChunk - 1) throw err;
                        console.warn(`[OTA] Chunk ${i} retry ${attempt + 1}`);
                    }
                }

                const pct = Math.round(((i + 1) / totalChunks) * 100);
                onProgress?.(pct, i + 1, totalChunks);
                this._events?.emitOtaEvent(EVENTS.OTA_PROGRESS, pct);
            }

            // ── 6. Commit ──────────────────────
            await this._protocol._transport.write(COMMANDS.OTA_COMMIT);
            await this._delay(200);

            this._events?.emitOtaEvent(EVENTS.OTA_COMPLETE, 100);
            console.log('[OTA] Complete — device rebooting into new firmware');

        } catch (err) {
            console.error('[OTA] Error:', err.message);
            await this._protocol._transport.write(COMMANDS.OTA_ABORT).catch(() => {});
            this._events?.emitOtaEvent(EVENTS.OTA_FAILED, 0);
            throw err;
        } finally {
            this._inProgress = false;
            this._protocol._otaLocked = false;
        }
    }

    // ── Frame Builders ───────────────────────

    /**
     * Build CMD_OTA_BEGIN extended frame (24 bytes):
     * [PREAMBLE 4B][HEADER 2B][OPCODE 2B][total_chunks 4B][image_size 4B][crc32 4B][checksum 1B][reserved 7B]
     */
    _buildOtaBeginFrame(totalChunks, imageCrc32, imageSize) {
        const buf = Buffer.alloc(24, 0x00);
        buf.writeUInt32BE(0x12345678, 0);   // PREAMBLE
        buf.writeUInt16BE(0xEB90,    4);    // HEADER
        buf.writeUInt16BE(0x0240,    6);    // CMD_OTA_BEGIN
        buf.writeUInt32BE(totalChunks,  8);
        buf.writeUInt32BE(imageSize,   12);
        buf.writeUInt32BE(imageCrc32,  16);
        // Checksum over bytes [4..22]
        let chk = 0;
        for (let i = 4; i < 23; i++) chk ^= buf[i];
        buf[23] = chk & 0xFF;
        return buf;
    }

    /**
     * Build CMD_OTA_CHUNK frame (148 bytes):
     * [PREAMBLE 4B][HEADER 2B][OPCODE 2B][chunk_index 4B][total_chunks 4B][data 128B][crc16 2B]
     */
    _buildChunkFrame(chunkIndex, totalChunks, data, chunkCrc16) {
        const buf = Buffer.alloc(146, 0x00);
        buf.writeUInt32BE(0x12345678, 0);
        buf.writeUInt16BE(0xEB90,     4);
        buf.writeUInt16BE(0x0241,     6);   // CMD_OTA_CHUNK
        buf.writeUInt32BE(chunkIndex, 8);
        buf.writeUInt32BE(totalChunks, 12);
        data.copy(buf, 16);                 // 128 bytes of payload
        buf.writeUInt16BE(chunkCrc16, 144);
        return buf;
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /** Compute CRC32 of a Buffer (static utility). */
    static crc32(buf) { return crc32(buf); }

    /** Compute CRC-16/CCITT of a Buffer (static utility). */
    static crc16(buf)  { return crc16(buf); }
}

module.exports = SC1240OTA;

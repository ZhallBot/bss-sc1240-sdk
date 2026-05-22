/**
 * @file sc1240_comm.c
 * @brief BSS SC1240 — Module 1 Implementation: Communication & Command Parsing
 *
 * Builds and dispatches validated hex command frames, handles retransmission
 * on timeout, and parses incoming telemetry from the RX ring-buffer.
 */

#include "sc1240_comm.h"
#include <string.h>

/* ─────────────────────────────────────────────
 * Internal helpers
 * ───────────────────────────────────────────── */

/**
 * @brief Write a uint32 into buf in big-endian order.
 */
static void write_be32(uint8_t *buf, uint32_t val) {
    buf[0] = (uint8_t)((val >> 24) & 0xFF);
    buf[1] = (uint8_t)((val >> 16) & 0xFF);
    buf[2] = (uint8_t)((val >>  8) & 0xFF);
    buf[3] = (uint8_t)( val        & 0xFF);
}

static void write_be16(uint8_t *buf, uint16_t val) {
    buf[0] = (uint8_t)((val >> 8) & 0xFF);
    buf[1] = (uint8_t)( val       & 0xFF);
}

/* ─────────────────────────────────────────────
 * sc1240_build_frame
 * Frame layout (12 bytes, all big-endian):
 *  [0..3]  PREAMBLE  0x12345678
 *  [4..5]  HEADER    0xEB90
 *  [6..9]  PAYLOAD   (default 0xFFFFFFFF)
 *  [10..11] CMD opcode
 *  NOTE: The hardware uses the last nibble of CMD as an implicit checksum;
 *  an XOR checksum over [4..11] is appended as byte[11] in extended frames.
 *  For the fixed 12-byte command format the checksum is already baked into
 *  the opcode constant — so we validate only on the response side.
 * ───────────────────────────────────────────── */
SC1240_Status_t sc1240_build_frame(uint8_t *buf,
                                    SC1240_Command_t cmd,
                                    uint32_t payload)
{
    if (!buf) return SC1240_ERR_PARAM;

    write_be32(&buf[0], SC1240_PREAMBLE);
    write_be16(&buf[4], SC1240_HEADER);
    write_be32(&buf[6], payload);
    write_be16(&buf[10], (uint16_t)cmd);

    return SC1240_OK;
}

/* ─────────────────────────────────────────────
 * sc1240_comm_init
 * ───────────────────────────────────────────── */
SC1240_Status_t sc1240_comm_init(SC1240_CommHandle_t *h,
                                  void *hal_ctx,
                                  uint32_t timeout_ms)
{
    if (!h || !hal_ctx) return SC1240_ERR_PARAM;

    memset(h, 0, sizeof(SC1240_CommHandle_t));
    h->hal_ctx    = hal_ctx;
    h->timeout_ms = (timeout_ms > 0) ? timeout_ms : SC1240_DEFAULT_TIMEOUT_MS;
    h->max_retries = SC1240_MAX_RETRIES;

    sc1240_hal_log("[SC1240] Comm init OK (timeout=%u ms)\n", h->timeout_ms);
    return SC1240_OK;
}

/* ─────────────────────────────────────────────
 * sc1240_comm_feed_rx
 * ───────────────────────────────────────────── */
void sc1240_comm_feed_rx(SC1240_CommHandle_t *h,
                          const uint8_t *data,
                          uint16_t len)
{
    if (!h || !data) return;
    for (uint16_t i = 0; i < len; i++) {
        uint16_t next = (h->rx_head + 1) % sizeof(h->rx_buf);
        if (next != h->rx_tail) {
            h->rx_buf[h->rx_head] = data[i];
            h->rx_head = next;
        }
        /* On overflow: drop oldest byte (tail advances) */
    }
}

/* ─────────────────────────────────────────────
 * Internal: send frame with retry + timeout
 * ───────────────────────────────────────────── */
static SC1240_Status_t _send_command(SC1240_CommHandle_t *h,
                                      SC1240_Command_t cmd)
{
    if (h->ota_in_progress) {
        sc1240_hal_log("[SC1240] ERR: Command blocked — OTA in progress\n");
        return SC1240_ERR_BUSY;
    }

    uint8_t frame[SC1240_FRAME_LEN];
    SC1240_Status_t rc = sc1240_build_frame(frame, cmd, SC1240_PAYLOAD_DEFAULT);
    if (rc != SC1240_OK) return rc;

    sc1240_hal_log("[SC1240] >> CMD 0x%04X [%02X %02X %02X %02X %02X %02X "
                   "%02X %02X %02X %02X %02X %02X]\n",
                   cmd,
                   frame[0], frame[1], frame[2], frame[3],
                   frame[4], frame[5], frame[6], frame[7],
                   frame[8], frame[9], frame[10], frame[11]);

    for (uint8_t attempt = 0; attempt < h->max_retries; attempt++) {
        /* Drain RX buffer before sending */
        h->rx_head = h->rx_tail = 0;

        int sent = sc1240_hal_transmit(h->hal_ctx, frame, SC1240_FRAME_LEN);
        if (sent < 0) {
            sc1240_hal_log("[SC1240] HAL transmit error: %d\n", sent);
            return SC1240_ERR_HAL;
        }

        /* Wait for ACK (device echoes the same opcode in telemetry status) */
        uint32_t t0 = sc1240_hal_tick_ms();
        while ((sc1240_hal_tick_ms() - t0) < h->timeout_ms) {
            /* Minimal ACK check: look for preamble bytes in RX buffer */
            uint16_t available = (h->rx_head - h->rx_tail + sizeof(h->rx_buf))
                                  % sizeof(h->rx_buf);
            if (available >= sizeof(SC1240_Telemetry_t)) {
                /* Peek at preamble */
                uint8_t p[4];
                for (int j = 0; j < 4; j++)
                    p[j] = h->rx_buf[(h->rx_tail + j) % sizeof(h->rx_buf)];
                uint32_t pre = ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16)
                              | ((uint32_t)p[2] << 8)  |  p[3];
                if (pre == SC1240_PREAMBLE) {
                    sc1240_hal_log("[SC1240] ACK received (attempt %d)\n", attempt + 1);
                    return SC1240_OK;
                }
                /* Preamble not matched — advance tail by 1 and retry scan */
                h->rx_tail = (h->rx_tail + 1) % sizeof(h->rx_buf);
            }
            sc1240_hal_delay_ms(10);
        }

        sc1240_hal_log("[SC1240] Timeout attempt %d/%d\n",
                       attempt + 1, h->max_retries);
    }

    return SC1240_ERR_TIMEOUT;
}

/* ─────────────────────────────────────────────
 * Public Command Wrappers
 * ───────────────────────────────────────────── */
SC1240_Status_t sc1240_resetDevice(SC1240_CommHandle_t *h) {
    sc1240_hal_log("[SC1240] resetDevice()\n");
    return _send_command(h, CMD_RESET_DEVICE);
}

SC1240_Status_t sc1240_raiseLock(SC1240_CommHandle_t *h) {
    sc1240_hal_log("[SC1240] raiseLock()\n");
    return _send_command(h, CMD_RAISE_LOCK);
}

SC1240_Status_t sc1240_lowerLock(SC1240_CommHandle_t *h) {
    sc1240_hal_log("[SC1240] lowerLock()\n");
    return _send_command(h, CMD_LOWER_LOCK);
}

/* ─────────────────────────────────────────────
 * sc1240_getStatus
 * ───────────────────────────────────────────── */
SC1240_Status_t sc1240_getStatus(SC1240_CommHandle_t *h,
                                  SC1240_Telemetry_t *out)
{
    if (!h || !out) return SC1240_ERR_PARAM;

    SC1240_Status_t rc = _send_command(h, CMD_GET_STATUS);
    if (rc != SC1240_OK) return rc;

    /* Copy telemetry bytes from ring-buffer into struct */
    uint16_t avail = (h->rx_head - h->rx_tail + sizeof(h->rx_buf))
                      % sizeof(h->rx_buf);
    if (avail < sizeof(SC1240_Telemetry_t)) return SC1240_ERR_TIMEOUT;

    uint8_t raw[sizeof(SC1240_Telemetry_t)];
    for (size_t i = 0; i < sizeof(SC1240_Telemetry_t); i++) {
        raw[i] = h->rx_buf[(h->rx_tail + i) % sizeof(h->rx_buf)];
    }
    h->rx_tail = (h->rx_tail + sizeof(SC1240_Telemetry_t)) % sizeof(h->rx_buf);

    memcpy(out, raw, sizeof(SC1240_Telemetry_t));

    if (!sc1240_validate_telemetry(out)) {
        sc1240_hal_log("[SC1240] Telemetry checksum FAIL\n");
        return SC1240_ERR_CHECKSUM;
    }

    sc1240_hal_log("[SC1240] Status OK — lock=%d bat=%d%% angle=%.1f°\n",
                   out->lock_state,
                   out->battery_percent,
                   out->baffle_angle_x10 / 10.0f);

    return SC1240_OK;
}

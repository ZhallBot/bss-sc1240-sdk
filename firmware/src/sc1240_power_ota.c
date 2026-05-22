/**
 * @file sc1240_power_ota.c
 * @brief BSS SC1240 — Module 4 Implementation: Power Management & OTA Update
 *
 * Lead-acid 12V / 7AH battery percentage lookup + dual-bank OTA mechanism.
 *
 * OTA DUAL-BANK SAFETY FLOW:
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  BANK A (current running firmware — READ-ONLY during OTA)            │
 * │  BANK B (target firmware — erased, written, CRC-verified)            │
 * │                                                                      │
 * │  1. ota_begin()  → Verify battery ≥ 25%                             │
 * │                  → Erase BANK B                                     │
 * │                  → Set ota_in_progress flag (blocks normal commands) │
 * │                                                                      │
 * │  2. ota_write_chunk() × N                                            │
 * │     For each chunk:                                                  │
 * │       a. Validate CRC-16 of chunk payload                            │
 * │       b. Write 128 bytes to BANK B at (chunk_index × 128)           │
 * │       c. Accumulate CRC32 of all written data                       │
 * │       d. Emit EVT_OTA_PROGRESS (progress%)                          │
 * │       e. On CRC-16 fail: NAK → caller must retransmit chunk         │
 * │                                                                      │
 * │  3. ota_commit()                                                     │
 * │       a. Compare running_crc32 == image_crc32                       │
 * │       b. On match:                                                   │
 * │            - Write "BANK B VALID" flag to OTP/RTC register          │
 * │            - Emit EVT_OTA_COMPLETE                                  │
 * │            - Trigger watchdog reset (boot from BANK B)              │
 * │       c. On mismatch:                                                │
 * │            - Erase BANK B                                           │
 * │            - Emit EVT_OTA_FAILED                                    │
 * │            - Clear ota_in_progress flag (device stays on BANK A)    │
 * │                                                                      │
 * │  SAFETY GUARANTEES:                                                  │
 * │  • If power is lost during write: BANK A unchanged → device boots OK│
 * │  • CRC32 mismatch on commit: BANK B erased → no corrupted image     │
 * │  • Battery gate (25%) prevents brown-out during flash erase          │
 * └──────────────────────────────────────────────────────────────────────┘
 */

#include "sc1240_power_ota.h"
#include <string.h>
#include <stdio.h>

/* ─────────────────────────────────────────────
 * Lead-Acid 12V Voltage → % Lookup Table
 * Based on standard open-circuit voltage curve.
 * Format: { voltage_v, percent }
 * ───────────────────────────────────────────── */
typedef struct { float v; uint8_t pct; } VoltageLUT_t;

static const VoltageLUT_t BATTERY_LUT[] = {
    { 12.80f, 100 },
    { 12.65f,  90 },
    { 12.50f,  80 },
    { 12.35f,  70 },
    { 12.20f,  60 },
    { 12.05f,  50 },
    { 11.90f,  40 },
    { 11.75f,  30 },
    { 11.60f,  20 },
    { 11.40f,  10 },
    { 11.10f,   0 },
};
#define LUT_SIZE  (sizeof(BATTERY_LUT) / sizeof(BATTERY_LUT[0]))

/* ─────────────────────────────────────────────
 * sc1240_voltage_to_percent
 * Linear interpolation between LUT points.
 * ───────────────────────────────────────────── */
int sc1240_voltage_to_percent(float v) {
    if (v >= BATTERY_LUT[0].v)               return 100;
    if (v <= BATTERY_LUT[LUT_SIZE - 1].v)    return 0;

    for (size_t i = 0; i < LUT_SIZE - 1; i++) {
        if (v <= BATTERY_LUT[i].v && v > BATTERY_LUT[i + 1].v) {
            float span_v   = BATTERY_LUT[i].v   - BATTERY_LUT[i + 1].v;
            float span_pct = BATTERY_LUT[i].pct - BATTERY_LUT[i + 1].pct;
            float ratio    = (v - BATTERY_LUT[i + 1].v) / span_v;
            return (int)(BATTERY_LUT[i + 1].pct + ratio * span_pct);
        }
    }
    return -1;
}

/* ─────────────────────────────────────────────
 * sc1240_getBatteryStatus
 * ───────────────────────────────────────────── */
int sc1240_getBatteryStatus(SC1240_BatteryStatus_t *status) {
    if (!status) return SC1240_ERR_PARAM;

    float v = sc1240_hal_read_battery_voltage();
    if (v < 0.0f) return SC1240_ERR_HAL;

    status->voltage_v       = v;
    int pct                 = sc1240_voltage_to_percent(v);
    status->percent         = (uint8_t)(pct < 0 ? 0 : pct);
    status->solar_charging  = sc1240_hal_read_solar_charging();
    status->low_battery     = (status->percent <= 20);
    status->critical_battery= (status->percent <= 10);

    return SC1240_OK;
}

/* ─────────────────────────────────────────────
 * OTA Implementation
 * ───────────────────────────────────────────── */
void sc1240_ota_init(SC1240_OtaContext_t *ctx,
                      SC1240_TelemetryListener_t *listener) {
    if (!ctx) return;
    memset(ctx, 0, sizeof(SC1240_OtaContext_t));
    ctx->state    = OTA_STATE_IDLE;
    ctx->listener = listener;
}

int sc1240_ota_begin(SC1240_OtaContext_t *ctx,
                      uint32_t total_chunks,
                      uint32_t image_crc32,
                      uint32_t image_size_bytes)
{
    if (!ctx || total_chunks == 0) return SC1240_ERR_PARAM;

    /* Safety gate: require ≥25% battery to prevent brown-out during erase */
    SC1240_BatteryStatus_t bat;
    if (sc1240_getBatteryStatus(&bat) == SC1240_OK) {
        if (bat.percent < 25) {
            sc1240_hal_log("[OTA] ABORT: Battery too low (%d%%). Need ≥25%%\n",
                           bat.percent);
            return SC1240_ERR_BUSY;
        }
    }

    /* Erase Bank B */
    if (sc1240_hal_flash_erase_bank_b() != 0) {
        sc1240_hal_log("[OTA] ABORT: Flash erase failed\n");
        ctx->state = OTA_STATE_FAILED;
        return SC1240_ERR_HAL;
    }

    ctx->state             = OTA_STATE_READY;
    ctx->total_chunks      = total_chunks;
    ctx->received_chunks   = 0;
    ctx->image_crc32       = image_crc32;
    ctx->image_size_bytes  = image_size_bytes;
    ctx->running_crc32     = 0xFFFFFFFFUL;  /* CRC32 seed */
    ctx->progress_pct      = 0;

    sc1240_hal_log("[OTA] Session started: %u chunks, expected CRC32=0x%08X\n",
                   total_chunks, image_crc32);

    if (ctx->listener) {
        sc1240_telemetry_emit_ota(ctx->listener, EVT_OTA_PROGRESS, 0,
                                  sc1240_hal_tick_ms());
    }

    ctx->state = OTA_STATE_RECEIVING;
    return SC1240_OK;
}

int sc1240_ota_write_chunk(SC1240_OtaContext_t *ctx,
                            const SC1240_OtaChunk_t *chunk)
{
    if (!ctx || !chunk)                        return SC1240_ERR_PARAM;
    if (ctx->state != OTA_STATE_RECEIVING)     return SC1240_ERR_BUSY;

    /* Validate chunk CRC-16 */
    uint16_t computed_crc = sc1240_hal_crc16(chunk->data, SC1240_OTA_CHUNK_SIZE);
    if (computed_crc != chunk->crc16) {
        sc1240_hal_log("[OTA] CRC-16 FAIL chunk %u: got 0x%04X expected 0x%04X\n",
                       chunk->chunk_index, computed_crc, chunk->crc16);
        return SC1240_ERR_CHECKSUM;  /* Caller must retransmit this chunk */
    }

    /* Write to flash bank B */
    uint32_t offset = chunk->chunk_index * SC1240_OTA_CHUNK_SIZE;
    if (sc1240_hal_flash_write(offset, chunk->data, SC1240_OTA_CHUNK_SIZE) != 0) {
        sc1240_hal_log("[OTA] Flash write FAIL at offset %u\n", offset);
        ctx->state = OTA_STATE_FAILED;
        return SC1240_ERR_HAL;
    }

    /* Accumulate full-image CRC32 */
    ctx->running_crc32 = sc1240_hal_crc32(ctx->running_crc32,
                                           chunk->data,
                                           SC1240_OTA_CHUNK_SIZE);

    ctx->received_chunks++;
    ctx->progress_pct = (uint8_t)((ctx->received_chunks * 100U)
                                  / ctx->total_chunks);

    sc1240_hal_log("[OTA] Chunk %u/%u — %d%%\n",
                   ctx->received_chunks, ctx->total_chunks, ctx->progress_pct);

    if (ctx->listener) {
        sc1240_telemetry_emit_ota(ctx->listener, EVT_OTA_PROGRESS,
                                  ctx->progress_pct, sc1240_hal_tick_ms());
    }

    return SC1240_OK;
}

int sc1240_ota_commit(SC1240_OtaContext_t *ctx) {
    if (!ctx || ctx->state != OTA_STATE_RECEIVING) return SC1240_ERR_PARAM;
    if (ctx->received_chunks != ctx->total_chunks)  return SC1240_ERR_TIMEOUT;

    ctx->state = OTA_STATE_VERIFYING;

    /* Finalise CRC32 (XOR with 0xFFFFFFFF per standard) */
    uint32_t final_crc = ctx->running_crc32 ^ 0xFFFFFFFFUL;

    sc1240_hal_log("[OTA] CRC32 check: computed=0x%08X expected=0x%08X\n",
                   final_crc, ctx->image_crc32);

    if (final_crc != ctx->image_crc32) {
        sc1240_hal_log("[OTA] CRC32 MISMATCH — aborting, erasing Bank B\n");
        sc1240_ota_abort(ctx);
        return SC1240_ERR_CHECKSUM;
    }

    ctx->state = OTA_STATE_COMMITTING;
    sc1240_hal_log("[OTA] CRC32 OK — setting boot vector to Bank B\n");

    if (ctx->listener) {
        sc1240_telemetry_emit_ota(ctx->listener, EVT_OTA_COMPLETE, 100,
                                  sc1240_hal_tick_ms());
    }

    ctx->state = OTA_STATE_REBOOTING;

    /* Trigger watchdog reset to boot Bank B (~100 ms grace for BLE ACK) */
    sc1240_hal_delay_ms(100);
    sc1240_hal_boot_swap_and_reset();  /* No return */

    return SC1240_OK;
}

void sc1240_ota_abort(SC1240_OtaContext_t *ctx) {
    if (!ctx) return;

    sc1240_hal_log("[OTA] Abort — erasing Bank B\n");
    sc1240_hal_flash_erase_bank_b();

    if (ctx->listener) {
        sc1240_telemetry_emit_ota(ctx->listener, EVT_OTA_FAILED, 0,
                                  sc1240_hal_tick_ms());
    }

    ctx->state = OTA_STATE_FAILED;
}

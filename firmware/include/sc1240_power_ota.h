/**
 * @file sc1240_power_ota.h
 * @brief BSS SC1240 — Module 4: Power Management & OTA Update
 *
 * Power management: getBatteryStatus(), solar charging indicator.
 * OTA: chunked BLE firmware update with CRC-16 verification, dual-bank
 * flash strategy to prevent bricking on partial upload.
 */

#ifndef SC1240_POWER_OTA_H
#define SC1240_POWER_OTA_H

#include "sc1240_protocol.h"
#include "sc1240_telemetry.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ─────────────────────────────────────────────
 * Battery / Power Status
 * ───────────────────────────────────────────── */
typedef struct {
    uint8_t  percent;         /**< 0–100 %                                   */
    float    voltage_v;       /**< Measured terminal voltage (V)             */
    bool     solar_charging;  /**< True = panel delivering current           */
    bool     low_battery;     /**< True if percent ≤ 20%                     */
    bool     critical_battery;/**< True if percent ≤ 10% (shutdown imminent) */
} SC1240_BatteryStatus_t;

/* ─────────────────────────────────────────────
 * OTA Context
 * ───────────────────────────────────────────── */
typedef enum {
    OTA_STATE_IDLE       = 0,
    OTA_STATE_READY      = 1,  /**< CMD_OTA_BEGIN accepted                   */
    OTA_STATE_RECEIVING  = 2,  /**< Chunks arriving                          */
    OTA_STATE_VERIFYING  = 3,  /**< CRC / size check in progress             */
    OTA_STATE_COMMITTING = 4,  /**< Writing to flash bank B                  */
    OTA_STATE_REBOOTING  = 5,  /**< Watchdog reboot to new image             */
    OTA_STATE_FAILED     = 6,  /**< Aborted; device stays on bank A          */
} SC1240_OtaState_t;

typedef struct {
    SC1240_OtaState_t   state;
    uint32_t            total_chunks;
    uint32_t            received_chunks;
    uint32_t            image_size_bytes;
    uint32_t            image_crc32;        /**< Expected CRC32 of full image  */
    uint32_t            running_crc32;      /**< Accumulator during receive    */
    uint8_t             progress_pct;       /**< 0–100                         */
    SC1240_TelemetryListener_t *listener;   /**< For emitting OTA events       */
} SC1240_OtaContext_t;

/* ─────────────────────────────────────────────
 * Public API — Power Management
 * ───────────────────────────────────────────── */

/**
 * @brief Query current battery state from ADC and charging pin.
 *        Lead-acid 12V → ADC reading maps to percentage via lookup table.
 *        Populates *status and returns SC1240_OK or SC1240_ERR_HAL.
 */
int sc1240_getBatteryStatus(SC1240_BatteryStatus_t *status);

/**
 * @brief Voltage → percentage LUT for 12 V / 7 AH lead-acid cell.
 *        Returns 0–100; returns -1 if voltage is out of valid range.
 */
int sc1240_voltage_to_percent(float voltage_v);

/* ─────────────────────────────────────────────
 * Public API — OTA Update
 * ───────────────────────────────────────────── */

/**
 * @brief Initialise OTA context.
 */
void sc1240_ota_init(SC1240_OtaContext_t *ctx,
                      SC1240_TelemetryListener_t *listener);

/**
 * @brief Begin OTA session. Validates battery (abort if <25%) and
 *        erases flash bank B.
 * @param total_chunks  Total number of SC1240_OTA_CHUNK_SIZE chunks
 * @param image_crc32   Expected CRC32 of complete firmware image
 * @return SC1240_OK or error code
 */
int sc1240_ota_begin(SC1240_OtaContext_t *ctx,
                      uint32_t total_chunks,
                      uint32_t image_crc32,
                      uint32_t image_size_bytes);

/**
 * @brief Write a single firmware chunk to flash bank B.
 *        Verifies chunk CRC-16 before writing.
 * @param chunk  Received OTA chunk packet (fully populated)
 * @return SC1240_OK, SC1240_ERR_CHECKSUM (drop & request retransmit),
 *         or SC1240_ERR_HAL (flash write error — abort session).
 */
int sc1240_ota_write_chunk(SC1240_OtaContext_t *ctx,
                            const SC1240_OtaChunk_t *chunk);

/**
 * @brief Finalise OTA: verify full-image CRC32, update boot vector,
 *        then trigger watchdog reboot into bank B.
 *        On CRC mismatch: erases bank B and emits EVT_OTA_FAILED.
 * @return SC1240_OK if reboot initiated, or error code.
 */
int sc1240_ota_commit(SC1240_OtaContext_t *ctx);

/**
 * @brief Abort OTA in progress. Erases bank B, restores bank A boot vector.
 */
void sc1240_ota_abort(SC1240_OtaContext_t *ctx);

/* ─────────────────────────────────────────────
 * HAL Hooks — implement per platform
 * ───────────────────────────────────────────── */

/** @brief Read battery ADC voltage in volts. */
extern float sc1240_hal_read_battery_voltage(void);

/** @brief Read solar charging pin state (active HIGH). */
extern bool sc1240_hal_read_solar_charging(void);

/** @brief Erase OTA flash bank B. Returns 0 on success. */
extern int sc1240_hal_flash_erase_bank_b(void);

/** @brief Write data to OTA flash bank B at given byte offset. */
extern int sc1240_hal_flash_write(uint32_t offset,
                                   const uint8_t *data,
                                   uint32_t len);

/** @brief Set boot vector to bank B and reset MCU. */
extern void sc1240_hal_boot_swap_and_reset(void);

/** @brief CRC32 hardware accelerator (or software fallback). */
extern uint32_t sc1240_hal_crc32(uint32_t crc,
                                  const uint8_t *data,
                                  uint32_t len);

/** @brief CRC-16/CCITT for chunk validation. */
extern uint16_t sc1240_hal_crc16(const uint8_t *data, uint32_t len);

/** @brief Return current monotonic tick in milliseconds. */
extern uint32_t sc1240_hal_tick_ms(void);

#ifdef __cplusplus
}
#endif

#endif /* SC1240_POWER_OTA_H */

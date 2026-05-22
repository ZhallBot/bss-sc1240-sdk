/**
 * @file sc1240_comm.h
 * @brief BSS SC1240 — Module 1: Communication & Command Parsing
 *
 * Provides HAL-agnostic wrappers for building and dispatching command
 * frames over BLE UART / USB-Serial, with timeout and checksum validation.
 *
 * Caller must implement the platform HAL functions declared at the bottom.
 */

#ifndef SC1240_COMM_H
#define SC1240_COMM_H

#include "sc1240_protocol.h"
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ─────────────────────────────────────────────
 * Configuration
 * ───────────────────────────────────────────── */
#define SC1240_DEFAULT_TIMEOUT_MS   3000U  /**< Default ACK wait (ms)      */
#define SC1240_MAX_RETRIES          3U     /**< Max retransmission attempts */
#define SC1240_BLE_NOTIFY_UUID      "FFE1" /**< Characteristic UUID (RW)   */

/* ─────────────────────────────────────────────
 * Return Codes
 * ───────────────────────────────────────────── */
typedef enum {
    SC1240_OK           =  0,  /**< Command accepted & ACK received        */
    SC1240_ERR_TIMEOUT  = -1,  /**< No ACK within timeout window           */
    SC1240_ERR_CHECKSUM = -2,  /**< Response checksum mismatch             */
    SC1240_ERR_BUSY     = -3,  /**< Device is in OTA or fault state        */
    SC1240_ERR_HAL      = -4,  /**< HAL transmit failed (BLE/UART error)   */
    SC1240_ERR_PARAM    = -5,  /**< Invalid parameter passed by caller     */
} SC1240_Status_t;

/* ─────────────────────────────────────────────
 * Comm Handle (opaque context per connection)
 * ───────────────────────────────────────────── */
typedef struct {
    void    *hal_ctx;           /**< Pointer to HAL context (UART/BLE)     */
    uint32_t timeout_ms;        /**< Per-command ACK timeout               */
    uint8_t  max_retries;       /**< Retransmission limit                  */
    bool     ota_in_progress;   /**< Guard: block commands during OTA      */
    /* Internal ring-buffer for incoming bytes */
    uint8_t  rx_buf[256];
    uint16_t rx_head;
    uint16_t rx_tail;
} SC1240_CommHandle_t;

/* ─────────────────────────────────────────────
 * Public API
 * ───────────────────────────────────────────── */

/**
 * @brief Initialise the comm handle with HAL context and defaults.
 */
SC1240_Status_t sc1240_comm_init(SC1240_CommHandle_t *h,
                                  void *hal_ctx,
                                  uint32_t timeout_ms);

/**
 * @brief Feed incoming bytes from ISR/DMA into the internal RX buffer.
 *        Call this from your UART/BLE receive callback.
 */
void sc1240_comm_feed_rx(SC1240_CommHandle_t *h,
                          const uint8_t *data,
                          uint16_t len);

/**
 * @brief Perform a soft-reset of the device.
 *        Hex: 12 34 56 78  EB 90  FF FF FF FF  02 33
 */
SC1240_Status_t sc1240_resetDevice(SC1240_CommHandle_t *h);

/**
 * @brief Raise the parking baffle (arm up).
 *        Hex: 12 34 56 78  EB 90  FF FF FF FF  02 34
 */
SC1240_Status_t sc1240_raiseLock(SC1240_CommHandle_t *h);

/**
 * @brief Lower the parking baffle (arm down).
 *        Hex: 12 34 56 78  EB 90  FF FF FF FF  02 35
 */
SC1240_Status_t sc1240_lowerLock(SC1240_CommHandle_t *h);

/**
 * @brief Request a full telemetry snapshot from the device.
 *        Populates *out on success.
 */
SC1240_Status_t sc1240_getStatus(SC1240_CommHandle_t *h,
                                  SC1240_Telemetry_t *out);

/* ─────────────────────────────────────────────
 * Internal Frame Builder (exposed for testing)
 * ───────────────────────────────────────────── */

/**
 * @brief Build a 12-byte command frame into buf[].
 *        buf must be at least SC1240_FRAME_LEN bytes.
 */
SC1240_Status_t sc1240_build_frame(uint8_t *buf,
                                    SC1240_Command_t cmd,
                                    uint32_t payload);

/* ─────────────────────────────────────────────
 * HAL Callbacks — implement per platform
 * ───────────────────────────────────────────── */

/**
 * @brief Platform-specific transmit function.
 *        Must block until all bytes are queued (DMA/FIFO).
 * @return Number of bytes written, or negative on error.
 */
extern int sc1240_hal_transmit(void *hal_ctx,
                                const uint8_t *data,
                                uint16_t len);

/**
 * @brief Platform-specific millisecond delay.
 */
extern void sc1240_hal_delay_ms(uint32_t ms);

/**
 * @brief Platform-specific millisecond tick counter.
 */
extern uint32_t sc1240_hal_tick_ms(void);

/**
 * @brief Platform-specific log output (printf-compatible).
 */
extern void sc1240_hal_log(const char *fmt, ...);

#ifdef __cplusplus
}
#endif

#endif /* SC1240_COMM_H */

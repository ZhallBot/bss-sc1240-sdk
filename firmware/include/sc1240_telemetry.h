/**
 * @file sc1240_telemetry.h
 * @brief BSS SC1240 — Module 2: Event Listener & Telemetry Error Handler
 *
 * Provides an observer/callback system for asynchronous telemetry events
 * received from the SC1240 device. Each error bit in the telemetry packet
 * maps to a named callback and a human-readable diagnostic message.
 */

#ifndef SC1240_TELEMETRY_H
#define SC1240_TELEMETRY_H

#include "sc1240_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ─────────────────────────────────────────────
 * Event Types
 * ───────────────────────────────────────────── */
typedef enum {
    EVT_VEHICLE_DETECTED     = 0x01, /**< Vehicle entered the parking space  */
    EVT_VEHICLE_DEPARTED     = 0x02, /**< Vehicle left the parking space      */
    EVT_LOCK_RAISED          = 0x03, /**< Baffle successfully raised          */
    EVT_LOCK_LOWERED         = 0x04, /**< Baffle successfully lowered         */
    EVT_ERROR_BAFFLE_JAMMED  = 0x10, /**< ERROR_80: mechanical jam            */
    EVT_ERROR_LIFT_TIMEOUT   = 0x11, /**< ERROR_40: motor timeout             */
    EVT_ERROR_SHAKING        = 0x12, /**< ERROR_20: shaking/fare-evasion      */
    EVT_ERROR_OBSTACLE       = 0x13, /**< ERROR_10: obstacle — auto bounce    */
    EVT_ERROR_PROBE_FAIL     = 0x14, /**< ERROR_08: probe comm failure        */
    EVT_ERROR_ANGLE_FAIL     = 0x15, /**< ERROR_04: angle sensor failure      */
    EVT_ERROR_RADAR_FAIL     = 0x16, /**< ERROR_02: radar failure             */
    EVT_ERROR_GEOMAG_FAIL    = 0x17, /**< ERROR_01: geomagnetic failure       */
    EVT_BATTERY_LOW          = 0x20, /**< Battery ≤ 20%                       */
    EVT_SOLAR_CHARGING       = 0x21, /**< Solar panel charging started        */
    EVT_OTA_PROGRESS         = 0x30, /**< OTA chunk progress update           */
    EVT_OTA_COMPLETE         = 0x31, /**< OTA finished and verified           */
    EVT_OTA_FAILED           = 0x32, /**< OTA aborted or CRC error           */
} SC1240_EventType_t;

/* ─────────────────────────────────────────────
 * Event Data Payload
 * ───────────────────────────────────────────── */
typedef struct {
    SC1240_EventType_t  type;
    const char         *message;      /**< Human-readable description        */
    float               baffle_angle; /**< Angle in degrees (0.0 – 90.0)     */
    uint8_t             battery_pct;  /**< Battery percentage 0–100          */
    uint8_t             error_flags;  /**< Raw error bitmask from telemetry  */
    uint32_t            timestamp_ms; /**< Monotonic ms tick when event fired */
    uint8_t             ota_progress; /**< OTA: 0–100%                        */
} SC1240_Event_t;

/* ─────────────────────────────────────────────
 * Callback type
 * ───────────────────────────────────────────── */
typedef void (*SC1240_EventCallback_t)(const SC1240_Event_t *evt,
                                       void *user_ctx);

/* ─────────────────────────────────────────────
 * Listener Handle
 * ───────────────────────────────────────────── */
#define SC1240_MAX_LISTENERS  8U

typedef struct {
    SC1240_EventCallback_t callbacks[SC1240_MAX_LISTENERS];
    void                  *user_contexts[SC1240_MAX_LISTENERS];
    uint8_t                count;

    /* Previous telemetry snapshot for delta detection */
    SC1240_Telemetry_t     prev_telemetry;
    bool                   has_prev;
} SC1240_TelemetryListener_t;

/* ─────────────────────────────────────────────
 * Public API
 * ───────────────────────────────────────────── */

/**
 * @brief Initialise a telemetry listener context.
 */
void sc1240_telemetry_init(SC1240_TelemetryListener_t *l);

/**
 * @brief Register an event callback.
 * @param l        Listener context
 * @param cb       Callback function
 * @param user_ctx Opaque pointer passed back in every event call
 * @return 0 on success, -1 if listener list is full
 */
int sc1240_telemetry_on_event(SC1240_TelemetryListener_t *l,
                               SC1240_EventCallback_t cb,
                               void *user_ctx);

/**
 * @brief Process a newly received telemetry packet.
 *        Compares with previous snapshot and fires events for any changes.
 *        Call this whenever a complete SC1240_Telemetry_t arrives from device.
 */
void sc1240_telemetry_process(SC1240_TelemetryListener_t *l,
                               const SC1240_Telemetry_t *pkt,
                               uint32_t timestamp_ms);

/**
 * @brief Manually emit an OTA progress event.
 */
void sc1240_telemetry_emit_ota(SC1240_TelemetryListener_t *l,
                                SC1240_EventType_t evt_type,
                                uint8_t progress_pct,
                                uint32_t timestamp_ms);

/**
 * @brief Returns a constant string description for a given error bit.
 */
const char *sc1240_error_describe(SC1240_ErrorCode_t err_bit);

#ifdef __cplusplus
}
#endif

#endif /* SC1240_TELEMETRY_H */

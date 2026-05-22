/**
 * @file sc1240_telemetry.c
 * @brief BSS SC1240 — Module 2 Implementation: Event Listener & Error Handling
 *
 * Delta-detection between successive telemetry snapshots drives event emission.
 * Error bits (0x01–0x80) are mapped to human-readable messages per IEC 62443.
 */

#include "sc1240_telemetry.h"
#include "sc1240_comm.h"
#include <string.h>
#include <stddef.h>

/* ─────────────────────────────────────────────
 * Error bit → description table
 * ───────────────────────────────────────────── */
typedef struct {
    SC1240_ErrorCode_t  bit;
    SC1240_EventType_t  event;
    const char         *message;
} ErrorEntry_t;

static const ErrorEntry_t ERROR_TABLE[] = {
    { ERROR_BAFFLE_JAMMED, EVT_ERROR_BAFFLE_JAMMED,
      "ERROR_80: Baffle Jammed — mechanical obstruction detected. "
      "Inspect for foreign objects. Manual intervention required." },

    { ERROR_LIFT_TIMEOUT,  EVT_ERROR_LIFT_TIMEOUT,
      "ERROR_40: Lifting Timeout — motor failed to complete raise cycle "
      "within the configured window. Check motor & drive circuit." },

    { ERROR_SHAKING_ALARM, EVT_ERROR_SHAKING,
      "ERROR_20: Shaking Alarm — abnormal vibration detected on baffle. "
      "Possible fare evasion or vandalism. Alert operator immediately." },

    { ERROR_OBSTACLE_HIT,  EVT_ERROR_OBSTACLE,
      "ERROR_10: Obstacle During Raise — baffle angle < 35°. "
      "Auto-bounce protection activated. Baffle returned to ground position." },

    { ERROR_PROBE_FAIL,    EVT_ERROR_PROBE_FAIL,
      "ERROR_08: Probe Communication Failure — sensor bus (I2C/SPI) "
      "is not responding. Check wiring and pull-up resistors." },

    { ERROR_ANGLE_FAIL,    EVT_ERROR_ANGLE_FAIL,
      "ERROR_04: Angle Sensor Failure — tilt reading out of range. "
      "Obstacle protection is degraded. Service required." },

    { ERROR_RADAR_FAIL,    EVT_ERROR_RADAR_FAIL,
      "ERROR_02: Microwave Radar Failure — radar module not responding. "
      "Detection accuracy reduced to geomagnetic + IR only." },

    { ERROR_GEOMAG_FAIL,   EVT_ERROR_GEOMAG_FAIL,
      "ERROR_01: Geomagnetic Sensor Failure — primary presence sensor offline. "
      "Vehicle detection severely degraded. Immediate service required." },
};

#define ERROR_TABLE_SIZE  (sizeof(ERROR_TABLE) / sizeof(ERROR_TABLE[0]))

/* ─────────────────────────────────────────────
 * Internal: fire an event to all registered listeners
 * ───────────────────────────────────────────── */
static void _emit(SC1240_TelemetryListener_t *l,
                  const SC1240_Event_t *evt)
{
    for (uint8_t i = 0; i < l->count; i++) {
        if (l->callbacks[i]) {
            l->callbacks[i](evt, l->user_contexts[i]);
        }
    }
}

/* ─────────────────────────────────────────────
 * sc1240_error_describe
 * ───────────────────────────────────────────── */
const char *sc1240_error_describe(SC1240_ErrorCode_t err_bit) {
    for (size_t i = 0; i < ERROR_TABLE_SIZE; i++) {
        if (ERROR_TABLE[i].bit == err_bit)
            return ERROR_TABLE[i].message;
    }
    return "Unknown error code.";
}

/* ─────────────────────────────────────────────
 * sc1240_telemetry_init
 * ───────────────────────────────────────────── */
void sc1240_telemetry_init(SC1240_TelemetryListener_t *l) {
    if (!l) return;
    memset(l, 0, sizeof(SC1240_TelemetryListener_t));
}

/* ─────────────────────────────────────────────
 * sc1240_telemetry_on_event
 * ───────────────────────────────────────────── */
int sc1240_telemetry_on_event(SC1240_TelemetryListener_t *l,
                               SC1240_EventCallback_t cb,
                               void *user_ctx)
{
    if (!l || !cb) return -1;
    if (l->count >= SC1240_MAX_LISTENERS) return -1;

    l->callbacks[l->count]     = cb;
    l->user_contexts[l->count] = user_ctx;
    l->count++;
    return 0;
}

/* ─────────────────────────────────────────────
 * sc1240_telemetry_process
 *
 * Delta detection strategy:
 *   1. Compare error_flags for newly set bits → emit error events
 *   2. Compare vehicle_detected flag → emit vehicle presence events
 *   3. Compare lock_state transitions → emit lock events
 *   4. Check battery thresholds
 *   5. Check solar charging state change
 * ───────────────────────────────────────────── */
void sc1240_telemetry_process(SC1240_TelemetryListener_t *l,
                               const SC1240_Telemetry_t *pkt,
                               uint32_t timestamp_ms)
{
    if (!l || !pkt) return;

    SC1240_Event_t evt;
    memset(&evt, 0, sizeof(SC1240_Event_t));
    evt.timestamp_ms  = timestamp_ms;
    evt.battery_pct   = pkt->battery_percent;
    evt.baffle_angle  = pkt->baffle_angle_x10 / 10.0f;
    evt.error_flags   = pkt->error_flags;

    /* ── 1. Error bit delta ─────────────────── */
    uint8_t prev_err  = l->has_prev ? l->prev_telemetry.error_flags : 0;
    uint8_t new_bits  = pkt->error_flags & ~prev_err;  /* Only newly set bits */

    for (size_t i = 0; i < ERROR_TABLE_SIZE; i++) {
        if (new_bits & (uint8_t)ERROR_TABLE[i].bit) {
            evt.type    = ERROR_TABLE[i].event;
            evt.message = ERROR_TABLE[i].message;
            _emit(l, &evt);
        }
    }

    /* ── 2. Vehicle detection delta ─────────── */
    uint8_t prev_veh = l->has_prev ? l->prev_telemetry.vehicle_detected : 0xFF;
    if (pkt->vehicle_detected != prev_veh) {
        evt.error_flags = 0;
        if (pkt->vehicle_detected) {
            evt.type    = EVT_VEHICLE_DETECTED;
            evt.message = "Vehicle detected in parking space.";
        } else {
            evt.type    = EVT_VEHICLE_DEPARTED;
            evt.message = "Vehicle departed. Parking space is now free.";
        }
        _emit(l, &evt);
    }

    /* ── 3. Lock state transitions ──────────── */
    uint8_t prev_lock = l->has_prev ? l->prev_telemetry.lock_state
                                    : (uint8_t)0xFF;
    if (pkt->lock_state != prev_lock) {
        if (pkt->lock_state == LOCK_STATE_RAISED) {
            evt.type    = EVT_LOCK_RAISED;
            evt.message = "Parking baffle raised successfully.";
            _emit(l, &evt);
        } else if (pkt->lock_state == LOCK_STATE_LOWERED) {
            evt.type    = EVT_LOCK_LOWERED;
            evt.message = "Parking baffle lowered successfully.";
            _emit(l, &evt);
        }
    }

    /* ── 4. Battery low threshold ───────────── */
    uint8_t prev_bat = l->has_prev ? l->prev_telemetry.battery_percent : 100;
    if (prev_bat > 20 && pkt->battery_percent <= 20) {
        evt.type    = EVT_BATTERY_LOW;
        evt.message = "Battery low (≤20%). Check solar panel or replace battery.";
        _emit(l, &evt);
    }

    /* ── 5. Solar charging state ────────────── */
    uint8_t prev_sol = l->has_prev ? l->prev_telemetry.solar_charging : 0;
    if (!prev_sol && pkt->solar_charging) {
        evt.type    = EVT_SOLAR_CHARGING;
        evt.message = "Solar panel charging detected.";
        _emit(l, &evt);
    }

    /* Update snapshot */
    memcpy(&l->prev_telemetry, pkt, sizeof(SC1240_Telemetry_t));
    l->has_prev = true;
}

/* ─────────────────────────────────────────────
 * sc1240_telemetry_emit_ota
 * ───────────────────────────────────────────── */
void sc1240_telemetry_emit_ota(SC1240_TelemetryListener_t *l,
                                SC1240_EventType_t evt_type,
                                uint8_t progress_pct,
                                uint32_t timestamp_ms)
{
    if (!l) return;

    SC1240_Event_t evt;
    memset(&evt, 0, sizeof(SC1240_Event_t));
    evt.type         = evt_type;
    evt.ota_progress = progress_pct;
    evt.timestamp_ms = timestamp_ms;

    switch (evt_type) {
        case EVT_OTA_PROGRESS:
            evt.message = "OTA firmware update in progress.";
            break;
        case EVT_OTA_COMPLETE:
            evt.message = "OTA update complete. Device is rebooting.";
            break;
        case EVT_OTA_FAILED:
            evt.message = "OTA update FAILED. Device reverted to previous firmware.";
            break;
        default:
            evt.message = "OTA event.";
            break;
    }

    _emit(l, &evt);
}

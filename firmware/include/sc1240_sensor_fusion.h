/**
 * @file sc1240_sensor_fusion.h
 * @brief BSS SC1240 — Module 3: Sensor Fusion & Vehicle Protection Logic
 *
 * Describes the MCU-side tri-modal detection algorithm:
 *   Geomagnetic (always-on gate) → triggers IR + Radar on positive edge.
 *
 * Power budget targets:
 *   Sleep / Geomag-only : 200–300 µA
 *   Full detection mode  : ~8–12 mA (radar dominant)
 *   Motor active         : ~1.5–3.0 A (lead-acid backed)
 */

#ifndef SC1240_SENSOR_FUSION_H
#define SC1240_SENSOR_FUSION_H

#include "sc1240_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ─────────────────────────────────────────────
 * Fusion Configuration
 * ───────────────────────────────────────────── */
#define GEOMAG_THRESHOLD_GAUSS    15.0f   /**< Field change to trigger wakeup  */
#define IR_CONFIRM_WINDOW_MS      200U    /**< IR must confirm within 200 ms   */
#define RADAR_CONFIRM_WINDOW_MS   500U    /**< Radar must confirm within 500 ms*/
#define BAFFLE_OBSTACLE_ANGLE_DEG 35.0f   /**< Auto-bounce threshold           */
#define SENSOR_FULL_TIMEOUT_MS    5000U   /**< Revert to geomag-only if idle   */
#define VOTE_THRESHOLD            2U      /**< Minimum sensor votes to confirm  */

/* ─────────────────────────────────────────────
 * Raw Sensor Readings
 * ───────────────────────────────────────────── */
typedef struct {
    float    geomag_delta_gauss;  /**< Change in magnetic field (|ΔB|)      */
    bool     ir_blocked;          /**< Infrared beam interrupted             */
    bool     radar_presence;      /**< Microwave radar reports occupancy     */
    float    baffle_angle_deg;    /**< Tilt angle from angle sensor (0–90°)  */
    uint32_t timestamp_ms;        /**< Sample timestamp                      */
} SC1240_SensorReading_t;

/* ─────────────────────────────────────────────
 * Fusion Output
 * ───────────────────────────────────────────── */
typedef struct {
    bool                vehicle_present;     /**< Fused occupancy decision     */
    uint8_t             sensor_votes;        /**< 0–3 sensors that agreed      */
    SC1240_SensorMode_t active_mode;         /**< Current power mode           */
    float               baffle_angle_deg;    /**< Filtered angle (0.1° res.)   */
    bool                obstacle_protection; /**< True if bounce guard active  */
    uint8_t             sensor_error_mask;   /**< Failed sensor bits           */
} SC1240_FusionResult_t;

/* ─────────────────────────────────────────────
 * Fusion State Machine (per-device context)
 * ───────────────────────────────────────────── */
typedef struct {
    SC1240_SensorMode_t   mode;
    uint32_t              wakeup_ts_ms;    /**< When full mode was entered     */
    SC1240_FusionResult_t last_result;
    float                 angle_filter;    /**< IIR-filtered angle (0.1° res.) */
} SC1240_FusionContext_t;

/* ─────────────────────────────────────────────
 * Public API
 * ───────────────────────────────────────────── */

/**
 * @brief Initialise fusion context. Call once at boot.
 */
void sc1240_fusion_init(SC1240_FusionContext_t *ctx);

/**
 * @brief Process a new set of sensor readings through the fusion algorithm.
 *        Returns the fused result and updates power mode accordingly.
 *
 * @param ctx     Fusion state machine context (persistent across calls)
 * @param reading Latest raw sensor sample
 * @param result  Output: fused detection result
 */
void sc1240_fusion_process(SC1240_FusionContext_t *ctx,
                            const SC1240_SensorReading_t *reading,
                            SC1240_FusionResult_t *result);

/**
 * @brief Check angle sensor and assert obstacle protection.
 *        Returns true if baffle should auto-bounce (angle < 35°).
 */
bool sc1240_fusion_check_obstacle(SC1240_FusionContext_t *ctx,
                                   float current_angle_deg);

/**
 * @brief Force sensor mode (for testing / override).
 */
void sc1240_fusion_set_mode(SC1240_FusionContext_t *ctx,
                             SC1240_SensorMode_t mode);

#ifdef __cplusplus
}
#endif

#endif /* SC1240_SENSOR_FUSION_H */

/**
 * @file sc1240_protocol.h
 * @brief BSS Parking Smart Lock SC1240 — Protocol Definitions
 *
 * Defines the binary frame format, command opcodes, and error/telemetry
 * bitmask codes used by the SC1240 firmware over BLE UART / USB-Serial.
 *
 * Frame structure (12 bytes):
 *   [PREAMBLE 4B][HEADER 2B][PAYLOAD 4B][CMD 2B][CHECKSUM implicit in CMD]
 *
 * All multi-byte fields are BIG-ENDIAN.
 */

#ifndef SC1240_PROTOCOL_H
#define SC1240_PROTOCOL_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ─────────────────────────────────────────────
 * Frame Constants
 * ───────────────────────────────────────────── */
#define SC1240_PREAMBLE         0x12345678UL   /**< 4-byte magic preamble      */
#define SC1240_HEADER           0xEB90U        /**< 2-byte fixed header field   */
#define SC1240_PAYLOAD_DEFAULT  0xFFFFFFFFUL   /**< 4-byte default payload      */
#define SC1240_FRAME_LEN        12U            /**< Total command frame length  */

/* ─────────────────────────────────────────────
 * Command Opcodes (last 2 bytes of frame)
 * ───────────────────────────────────────────── */
typedef enum {
    CMD_RESET_DEVICE = 0x0233,  /**< Soft-reset the MCU & all subsystems  */
    CMD_RAISE_LOCK   = 0x0234,  /**< Raise the parking baffle (arm up)    */
    CMD_LOWER_LOCK   = 0x0235,  /**< Lower the parking baffle (arm down)  */
    CMD_GET_STATUS   = 0x0236,  /**< Request full telemetry snapshot      */
    CMD_OTA_BEGIN    = 0x0240,  /**< Initiate OTA firmware upgrade mode   */
    CMD_OTA_CHUNK    = 0x0241,  /**< Transmit next OTA data chunk         */
    CMD_OTA_COMMIT   = 0x0242,  /**< Commit & verify OTA image            */
    CMD_OTA_ABORT    = 0x0243,  /**< Abort OTA, revert to previous image  */
} SC1240_Command_t;

/* ─────────────────────────────────────────────
 * Error / Telemetry Bitmask Codes
 * Returned in the STATUS byte of telemetry packets.
 * Multiple bits can be set simultaneously.
 * ───────────────────────────────────────────── */
typedef enum {
    ERROR_NONE          = 0x00, /**< No error — normal operation          */
    ERROR_GEOMAG_FAIL   = 0x01, /**< Geomagnetic sensor failure           */
    ERROR_RADAR_FAIL    = 0x02, /**< Microwave radar sensor failure        */
    ERROR_ANGLE_FAIL    = 0x04, /**< Tilt angle sensor failure             */
    ERROR_PROBE_FAIL    = 0x08, /**< Communication probe failure           */
    ERROR_OBSTACLE_HIT  = 0x10, /**< Obstacle detected during raise       */
    ERROR_SHAKING_ALARM = 0x20, /**< Forced shaking / fare evasion alarm  */
    ERROR_LIFT_TIMEOUT  = 0x40, /**< Motor lift timeout (motor fault)      */
    ERROR_BAFFLE_JAMMED = 0x80, /**< Baffle mechanically jammed           */
} SC1240_ErrorCode_t;

/* ─────────────────────────────────────────────
 * Lock / Baffle State
 * ───────────────────────────────────────────── */
typedef enum {
    LOCK_STATE_LOWERED   = 0x00, /**< Baffle is fully lowered (retracted) */
    LOCK_STATE_RAISING   = 0x01, /**< Baffle is in motion — raising        */
    LOCK_STATE_RAISED    = 0x02, /**< Baffle is fully raised (extended)    */
    LOCK_STATE_LOWERING  = 0x03, /**< Baffle is in motion — lowering       */
    LOCK_STATE_FAULT     = 0xFF, /**< Fault state — requires intervention  */
} SC1240_LockState_t;

/* ─────────────────────────────────────────────
 * Sensor Fusion Subsystem State
 * ───────────────────────────────────────────── */
typedef enum {
    SENSOR_MODE_SLEEP     = 0x00, /**< All sensors powered down (deep sleep) */
    SENSOR_MODE_GEOMAG    = 0x01, /**< Only geomagnetic active (gate duty)   */
    SENSOR_MODE_FULL      = 0x03, /**< Geomag + IR + Radar all active        */
} SC1240_SensorMode_t;

/* ─────────────────────────────────────────────
 * Telemetry Data Packet
 * Sent by device in response to CMD_GET_STATUS
 * or pushed asynchronously on state change.
 * ───────────────────────────────────────────── */
typedef struct __attribute__((packed)) {
    uint32_t  preamble;           /**< Must equal SC1240_PREAMBLE           */
    uint16_t  header;             /**< Must equal SC1240_HEADER             */
    uint8_t   lock_state;         /**< SC1240_LockState_t                   */
    uint8_t   error_flags;        /**< Bitmask of SC1240_ErrorCode_t        */
    uint8_t   sensor_mode;        /**< SC1240_SensorMode_t                  */
    uint8_t   battery_percent;    /**< 0–100 (%)                            */
    uint8_t   solar_charging;     /**< 0 = not charging, 1 = charging       */
    uint8_t   vehicle_detected;   /**< 0 = space free, 1 = vehicle present  */
    uint16_t  baffle_angle_x10;   /**< Angle × 10 (e.g., 350 = 35.0°)      */
    uint16_t  reserved;           /**< Reserved for future use              */
    uint8_t   checksum;           /**< XOR of bytes [4..13]                 */
} SC1240_Telemetry_t;

/* ─────────────────────────────────────────────
 * OTA Chunk Packet
 * ───────────────────────────────────────────── */
#define SC1240_OTA_CHUNK_SIZE   128U  /**< BLE MTU-safe chunk payload size  */

typedef struct __attribute__((packed)) {
    uint32_t  preamble;
    uint16_t  header;
    uint16_t  opcode;             /**< CMD_OTA_CHUNK                        */
    uint32_t  chunk_index;        /**< Zero-based chunk sequence number     */
    uint32_t  total_chunks;       /**< Total number of chunks in image      */
    uint8_t   data[SC1240_OTA_CHUNK_SIZE];
    uint16_t  crc16;              /**< CRC-16/CCITT of chunk data           */
} SC1240_OtaChunk_t;

/* ─────────────────────────────────────────────
 * Utility: Compute frame XOR checksum
 * Covers bytes at index 4 through (len-2).
 * ───────────────────────────────────────────── */
static inline uint8_t sc1240_checksum(const uint8_t *buf, uint16_t len) {
    uint8_t chk = 0x00;
    for (uint16_t i = 4; i < (len - 1); i++) {
        chk ^= buf[i];
    }
    return chk;
}

/* ─────────────────────────────────────────────
 * Utility: Validate received telemetry packet
 * Returns true if preamble, header, and checksum are valid.
 * ───────────────────────────────────────────── */
static inline bool sc1240_validate_telemetry(const SC1240_Telemetry_t *pkt) {
    if (pkt->preamble != SC1240_PREAMBLE) return false;
    if (pkt->header   != SC1240_HEADER)   return false;
    uint8_t chk = sc1240_checksum((const uint8_t *)pkt, sizeof(SC1240_Telemetry_t));
    return (chk == pkt->checksum);
}

#ifdef __cplusplus
}
#endif

#endif /* SC1240_PROTOCOL_H */

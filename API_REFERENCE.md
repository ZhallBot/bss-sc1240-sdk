# BSS Parking Smart Lock SC1240 — SDK & Firmware API Reference

**Version:** 1.0.0  
**Hardware:** SC1240 Parking Smart Lock  
**Protocol:** Bluetooth LE (BLE) / USB-Serial (CH340)  
**Revision date:** 2026-05-22

---

## Directory Structure

```
bss-sc1240-sdk/
├── firmware/                     # C/C++ Embedded Firmware Modules
│   ├── include/
│   │   ├── sc1240_protocol.h     # Frame format, opcodes, error codes (shared)
│   │   ├── sc1240_comm.h         # Module 1: Communication API
│   │   ├── sc1240_telemetry.h    # Module 2: Event listener & error handler
│   │   ├── sc1240_sensor_fusion.h# Module 3: Tri-modal detection algorithm
│   │   └── sc1240_power_ota.h    # Module 4: Power management & OTA
│   └── src/
│       ├── sc1240_comm.c
│       ├── sc1240_telemetry.c
│       ├── sc1240_sensor_fusion.c
│       └── sc1240_power_ota.c
│
├── sdk/
│   ├── nodejs/                   # Node.js SDK (Backend / Raspberry Pi gateway)
│   │   ├── index.js              # Main export
│   │   ├── lib/
│   │   │   ├── constants.js      # Protocol constants & error descriptions
│   │   │   ├── SC1240Protocol.js # Module 1: Frame builder & parser
│   │   │   ├── SC1240Events.js   # Module 2: EventEmitter + delta detection
│   │   │   ├── SC1240Power.js    # Module 4: getBatteryStatus()
│   │   │   ├── SC1240OTA.js      # Module 4: OTA update streamer
│   │   │   └── SC1240Device.js   # High-level device facade
│   │   └── examples/
│   │       └── example_parking_automation.js
│   │
│   ├── swift/                    # Swift SDK (iOS / macOS)
│   │   └── SC1240SDK.swift       # All modules in one file (SPM compatible)
│   │
│   └── java/                     # Java SDK (Android)
│       └── SC1240Device.java     # All modules (RxJava 3)
│
└── docs/
    └── API_REFERENCE.md          # ← This file
```

---

## Module 1 — Communication & Command Parsing

### Protocol Frame Format

All commands use a fixed 12-byte big-endian frame:

| Offset | Bytes | Field       | Value              |
|--------|-------|-------------|-------------------|
| 0      | 4     | PREAMBLE    | `0x12345678`       |
| 4      | 2     | HEADER      | `0xEB90`           |
| 6      | 4     | PAYLOAD     | `0xFFFFFFFF`       |
| 10     | 2     | OPCODE/CMD  | See table below    |

### Command Opcodes

| Command       | Opcode   | Full Hex Frame                         | Description              |
|---------------|----------|----------------------------------------|--------------------------|
| `resetDevice` | `0x0233` | `12345678 EB90 FFFFFFFF 0233`          | Soft-reset MCU           |
| `raiseLock`   | `0x0234` | `12345678 EB90 FFFFFFFF 0234`          | Raise parking baffle     |
| `lowerLock`   | `0x0235` | `12345678 EB90 FFFFFFFF 0235`          | Lower parking baffle     |
| `getStatus`   | `0x0236` | `12345678 EB90 FFFFFFFF 0236`          | Request telemetry        |
| `otaBegin`    | `0x0240` | Extended 24-byte frame (see OTA spec)  | Begin OTA session        |
| `otaChunk`    | `0x0241` | Extended 146-byte frame                | Send OTA data chunk      |
| `otaCommit`   | `0x0242` | `12345678 EB90 FFFFFFFF 0242`          | Commit OTA image         |
| `otaAbort`    | `0x0243` | `12345678 EB90 FFFFFFFF 0243`          | Abort OTA session        |

### Telemetry Response Packet (16 bytes)

Sent by device asynchronously or in response to `getStatus`:

| Offset | Bytes | Field             | Description                           |
|--------|-------|-------------------|---------------------------------------|
| 0      | 4     | PREAMBLE          | `0x12345678` (validation)             |
| 4      | 2     | HEADER            | `0xEB90` (validation)                 |
| 6      | 1     | `lock_state`      | See Lock State table                  |
| 7      | 1     | `error_flags`     | Bitmask (see Error Codes)             |
| 8      | 1     | `sensor_mode`     | `0=SLEEP, 1=GEOMAG, 3=FULL`          |
| 9      | 1     | `battery_percent` | 0–100 (%)                             |
| 10     | 1     | `solar_charging`  | `0=not charging, 1=charging`          |
| 11     | 1     | `vehicle_detected`| `0=free, 1=occupied`                  |
| 12     | 2     | `baffle_angle×10` | Angle × 10 (e.g., `0x016E` = 36.6°) |
| 14     | 1     | `reserved`        | 0x00                                  |
| 15     | 1     | `checksum`        | XOR of bytes [4..14]                  |

### Lock State Codes

| Code   | Name       | Meaning                       |
|--------|------------|-------------------------------|
| `0x00` | `LOWERED`  | Baffle fully down (retracted) |
| `0x01` | `RAISING`  | Motor moving — raising        |
| `0x02` | `RAISED`   | Baffle fully up (extended)    |
| `0x03` | `LOWERING` | Motor moving — lowering       |
| `0xFF` | `FAULT`    | Hardware fault                |

### Checksum Algorithm

```
checksum = XOR of all bytes from index 4 to (frame_length - 2) inclusive
```

> [!IMPORTANT]
> Always validate the checksum on every received telemetry packet before processing.
> Discard malformed packets and log the event.

---

## Module 2 — Event Listener & Error Handling

### Error Bitmask Codes

Each bit in `error_flags` is independently set. Multiple errors can be active simultaneously.

| Bitmask | Code       | Name             | Severity | Description                                                    |
|---------|------------|------------------|----------|----------------------------------------------------------------|
| `0x80`  | `ERROR_80` | `BAFFLE_JAMMED`  | 🔴 critical | Baffle mechanically jammed. Foreign object in mechanism.    |
| `0x40`  | `ERROR_40` | `LIFT_TIMEOUT`   | 🔴 critical | Motor failed to complete raise cycle. Motor/drive fault.    |
| `0x20`  | `ERROR_20` | `SHAKING_ALARM`  | 🟡 warning | Abnormal vibration. Possible fare evasion / vandalism.      |
| `0x10`  | `ERROR_10` | `OBSTACLE_HIT`   | 🟡 warning | Obstacle at < 35° during raise. Auto-bounce activated.      |
| `0x08`  | `ERROR_08` | `PROBE_FAIL`     | 🟠 error   | Sensor communication bus failure. Check I2C/SPI wiring.    |
| `0x04`  | `ERROR_04` | `ANGLE_FAIL`     | 🟠 error   | Tilt angle sensor out of range. Protection degraded.        |
| `0x02`  | `ERROR_02` | `RADAR_FAIL`     | 🟠 error   | Microwave radar module offline. Detection accuracy reduced. |
| `0x01`  | `ERROR_01` | `GEOMAG_FAIL`    | 🔴 critical | Geomagnetic sensor offline. Detection severely degraded.    |

### SDK Events (Node.js / Swift / Java)

| Event Name        | Trigger Condition                                  |
|-------------------|----------------------------------------------------|
| `connected`       | BLE/Serial connection established                  |
| `disconnected`    | Connection lost                                    |
| `telemetry`       | Every telemetry packet received (raw data)         |
| `vehicleDetected` | `vehicle_detected` transitions 0 → 1              |
| `vehicleDeparted` | `vehicle_detected` transitions 1 → 0              |
| `lockRaised`      | `lock_state` transitions to `RAISED` (0x02)        |
| `lockLowered`     | `lock_state` transitions to `LOWERED` (0x00)       |
| `error`           | Any new error bit set in `error_flags`             |
| `batteryLow`      | `battery_percent` crosses ≤ 20% threshold          |
| `solarCharging`   | `solar_charging` transitions 0 → 1                 |
| `otaProgress`     | Each OTA chunk successfully written                |
| `otaComplete`     | OTA CRC verified and device rebooting              |
| `otaFailed`       | OTA aborted due to CRC mismatch or error           |

---

## Module 3 — Sensor Fusion Algorithm

### Tri-Mode Detection Flow

```
BOOT
 │
 └─► GEOMAG_ONLY mode (200–300 µA standby)
          │
          │  |ΔB| > 15 Gauss
          ▼
     FULL_DETECT mode (IR + Radar powered on, ~8–12 mA)
          │
          │  Voting:
          │  geomag_triggered (1) + ir_blocked (1) + radar_presence (1)
          │
          │  IF votes >= 2 of 3  →  vehicle_present = TRUE
          │  IF votes < 2        →  vehicle_present = FALSE
          │
          │  IF !vehicle_present AND elapsed > 5000ms
          └─► Return to GEOMAG_ONLY (IR + Radar powered off)
```

### Obstacle Protection Logic

```
WHILE motor_state == RAISING:
    angle = IIR_filter(read_angle_sensor(), α=0.2)
    angle_deg = round(angle * 10) / 10      // 0.1° precision
    
    IF angle_deg < 35.0:
        → Set ERROR_OBSTACLE_HIT flag
        → Reverse motor (lower baffle)
        → Emit error event to SDK
        → Stop raise operation
```

### Power Budget

| Mode            | Current Draw | Sensors Active              |
|-----------------|-------------|-----------------------------|
| Sleep           | 200–300 µA  | None                        |
| Geomag-only     | 200–300 µA  | Geomagnetic only            |
| Full Detect     | 8–12 mA     | Geomagnetic + IR + Radar    |
| Motor Active    | 1.5–3.0 A   | All sensors + motor drive   |

---

## Module 4 — Power Management & OTA

### getBatteryStatus() — Lead-Acid Voltage LUT

| Voltage (V) | Charge (%) |
|-------------|------------|
| ≥ 12.80     | 100%       |
| 12.65       | 90%        |
| 12.50       | 80%        |
| 12.35       | 70%        |
| 12.20       | 60%        |
| 12.05       | 50%        |
| 11.90       | 40%        |
| 11.75       | 30%        |
| 11.60       | 20% ⚠️    |
| 11.40       | 10% 🔴    |
| ≤ 11.10     | 0%  ☠️    |

Values between LUT points are linearly interpolated.

### OTA Dual-Bank Update Flow

```
ota_begin(totalChunks, imageCrc32, imageSize)
   │
   ├─ [Safety] Battery ≥ 25%? → Abort if NO
   ├─ Erase Flash Bank B
   └─ Set ota_in_progress = TRUE (blocks normal commands)
          │
          ▼
   ota_write_chunk(chunk) × N  [repeats for each 128-byte block]
   │  a. Validate chunk CRC-16/CCITT
   │  b. Write 128 bytes to Bank B at (chunk_index × 128)
   │  c. Accumulate CRC-32 of all data
   │  d. Emit OTA_PROGRESS event
   │  e. On CRC-16 fail: return CHECKSUM_ERROR → caller retransmits
          │
          ▼
   ota_commit()
   │  a. Finalize CRC-32 (XOR with 0xFFFFFFFF)
   │  b. Compare with expected imageCrc32
   │
   ├─ MATCH: Set Bank B boot vector → Watchdog reset → Boot Bank B ✅
   └─ MISMATCH: Erase Bank B → Emit OTA_FAILED → Stay on Bank A ❌
```

> [!WARNING]
> Do NOT power off the device during OTA. The battery gate (≥25%) mitigates this risk,
> but ensure the solar panel is connected or the battery is freshly charged before initiating OTA.

> [!NOTE]
> If power is lost mid-write, Bank A is always intact. The device will boot normally
> from Bank A and the OTA session must be restarted.

### OTA Frame Formats

**BEGIN Frame (24 bytes):**
```
[PREAMBLE 4B][HEADER 2B][0x0240 2B][total_chunks 4B][image_size 4B][crc32 4B][checksum 1B][reserved 7B]
```

**CHUNK Frame (146 bytes):**
```
[PREAMBLE 4B][HEADER 2B][0x0241 2B][chunk_index 4B][total_chunks 4B][data 128B][crc16 2B]
```

---

## Node.js SDK — Quick Reference

### Installation
```bash
npm install  # (future: npm install bss-sc1240-sdk)
```

### Minimal Usage Example
```javascript
const { SC1240Device } = require('./sdk/nodejs');

const device = new SC1240Device({ transport: myBleTransport });

// ── Core automation loop ─────────────────────
device.on('vehicleDetected', async ({ baffleAngle, batteryPercent }) => {
    console.log(`🚗 Vehicle detected! Battery: ${batteryPercent}%`);
    await device.raiseLock();
});

device.on('lockRaised',  () => console.log('🔒 Lock raised'));
device.on('lockLowered', () => console.log('🔓 Lock lowered'));
device.on('error',       (e) => console.error(`🚨 [${e.code}] ${e.message}`));

// ── Power check ──────────────────────────────
await device.connect();
const battery = await device.getBatteryStatus();
console.log(`Battery: ${battery.percent}% [${battery.status}]`);

// ── OTA Update ───────────────────────────────
await device.updateFirmware('./firmware_v2.bin', {
    onProgress: (pct) => console.log(`OTA: ${pct}%`)
});
```

---

## Swift SDK — Quick Reference

```swift
import Combine

let sdk = SC1240SDK(peripheralUUID: UUID(uuidString: "YOUR-DEVICE-UUID")!)
var cancellables = Set<AnyCancellable>()

sdk.eventPublisher
    .receive(on: DispatchQueue.main)
    .sink { event in
        switch event {
        case .vehicleDetected(let angle, let bat):
            print("🚗 Vehicle at angle \(angle)°, battery \(bat)%")
            Task { try? await sdk.raiseLock() }
        case .error(let code, let msg, let severity, _):
            print("🚨 [\(code)] [\(severity)] \(msg)")
        case .lockRaised(let angle):
            print("🔒 Lock raised at \(angle)°")
        default: break
        }
    }
    .store(in: &cancellables)

sdk.connect()

// Battery status
Task {
    let bat = try await sdk.getBatteryStatus()
    print("Battery: \(bat.percent)% [\(bat.statusLabel)]")
}
```

---

## Java/Android SDK — Quick Reference

```java
SC1240Device device = new SC1240Device(this, "AA:BB:CC:DD:EE:FF");

device.onVehicleDetected()
    .observeOn(AndroidSchedulers.mainThread())
    .subscribe(event -> {
        Log.d("App", "🚗 Vehicle detected! Battery: " + event.telemetry.batteryPercent + "%");
        device.raiseLock()
              .observeOn(AndroidSchedulers.mainThread())
              .subscribe(t -> Log.d("App", "🔒 Lock raised at " + t.baffleAngleDeg + "°"),
                         err -> Log.e("App", "❌ " + err.getMessage()));
    });

device.onError()
    .subscribe(event ->
        Log.e("App", "🚨 [" + event.errorCode + "] " + event.message));

device.connect();

// Battery status
device.getBatteryStatus()
      .subscribe(bat -> Log.d("App", "Battery: " + bat.percent + "% [" + bat.statusLabel + "]"));
```

---

## Security Considerations (IoT Baseline)

| Area                  | Mechanism                                                           |
|-----------------------|---------------------------------------------------------------------|
| Frame Integrity       | XOR checksum on every telemetry frame; discard on mismatch         |
| OTA Integrity         | CRC-16 per chunk + CRC-32 full-image verification before commit    |
| OTA Safety Gate       | Battery ≥ 25% required; dual-bank prevents bricking               |
| Command Blocking      | All normal commands rejected while `ota_in_progress = true`        |
| BLE Pairing           | Use BLE Secure Connections (LE Secure Connections) with bonding     |
| Replay Protection     | Add sequence counter / nonce to command frames in production        |
| Error Cooldown        | SDK debounces repeated error events (10 s window) to prevent spam  |
| Sensitive Data        | No PII transmitted; telemetry is operational data only             |

> [!CAUTION]
> The default hex commands use no authentication. In production deployments,
> wrap commands in an authenticated/encrypted BLE GATT layer (e.g., AES-CCM
> per Bluetooth Mesh spec) or use a VPN tunnel for cellular/LPWAN backhaul.

---

## Frequently Asked Questions

**Q: Can I run multiple SC1240 locks from one gateway?**  
A: Yes. Instantiate a separate `SC1240Device` / `SC1240CommHandle` per device.
Each maintains its own RX buffer, event listener, and OTA context.

**Q: What happens if BLE drops mid-OTA?**  
A: The device times out the OTA session and stays on Bank A. The SDK emits
`OTA_FAILED`. Simply reconnect and restart from `ota_begin()`.

**Q: How do I add cellular/LPWAN (NB-IoT/LoRa) support?**  
A: Replace the `transport` adapter in the Node.js SDK with a UART/AT-command
transport to your cellular modem. The protocol layer is transport-agnostic.

**Q: How accurate is the baffle angle?**  
A: The firmware applies an IIR filter (α=0.2) and reports angle with 0.1°
resolution (value × 10 in the wire format). Obstacle protection triggers at < 35°.

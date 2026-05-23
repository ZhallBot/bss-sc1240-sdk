package com.bss.parking.fieldapp.sdk;

// SC1240SDK.java
// BSS Parking Smart Lock SC1240 — Android/Java SDK
// =================================================
// Full Bluetooth Low Energy integration for Android using the
// Android BLE API (android.bluetooth.*). Uses RxJava 3 for reactive
// event streaming.
//
// Minimum API Level: 21 (Android 5.0)
//
// Usage:
//   SC1240Device device = new SC1240Device(context, "AA:BB:CC:DD:EE:FF");
//   device.events().subscribe(event -> { ... });
//   device.connect();
//   device.raiseLock().subscribe(telemetry -> { ... });

import android.bluetooth.*;
import android.content.Context;
import android.util.Log;

import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.CRC32;

import io.reactivex.rxjava3.core.Observable;
import io.reactivex.rxjava3.core.Single;
import io.reactivex.rxjava3.subjects.PublishSubject;

/**
 * High-level facade for the BSS SC1240 Parking Smart Lock.
 * Thread-safe; all BLE callbacks are dispatched to the main thread.
 */
public class SC1240Device {

    private static final String TAG = "SC1240SDK";

    // ── Protocol Constants ─────────────────────────────────────────────
    public static final int    PREAMBLE         = 0x12345678;
    public static final int    HEADER           = 0xEB90;
    public static final int    FRAME_LEN        = 12;
    public static final int    TELEMETRY_LEN    = 16;
    public static final int    OTA_CHUNK_SIZE   = 128;
    public static final long   DEFAULT_TIMEOUT  = 3000L;   // ms
    public static final int    MAX_RETRIES      = 3;
    public static final String BLE_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
    public static final String BLE_CHAR_UUID    = "0000ffe1-0000-1000-8000-00805f9b34fb";

    // ── Commands ───────────────────────────────────────────────────────
    public enum Command {
        RESET_DEVICE(0x0233),
        RAISE_LOCK  (0x0234),
        LOWER_LOCK  (0x0235),
        GET_STATUS  (0x0236),
        OTA_BEGIN   (0x0240),
        OTA_CHUNK   (0x0241),
        OTA_COMMIT  (0x0242),
        OTA_ABORT   (0x0243);

        public final int opcode;
        Command(int opcode) { this.opcode = opcode; }

        /** Build the canonical 12-byte command frame */
        public byte[] frame() {
            ByteBuffer buf = ByteBuffer.allocate(12).order(ByteOrder.BIG_ENDIAN);
            buf.putInt(PREAMBLE);
            buf.putShort((short) HEADER);
            buf.putInt(0xFFFFFFFF);
            buf.putShort((short) opcode);
            return buf.array();
        }
    }

    // ── Error Flags ────────────────────────────────────────────────────
    public static final int ERR_GEOMAG_FAIL   = 0x01;
    public static final int ERR_RADAR_FAIL    = 0x02;
    public static final int ERR_ANGLE_FAIL    = 0x04;
    public static final int ERR_PROBE_FAIL    = 0x08;
    public static final int ERR_OBSTACLE_HIT  = 0x10;
    public static final int ERR_SHAKING_ALARM = 0x20;
    public static final int ERR_LIFT_TIMEOUT  = 0x40;
    public static final int ERR_BAFFLE_JAMMED = 0x80;

    private static final Map<Integer, String[]> ERROR_DESCRIPTIONS = new LinkedHashMap<Integer, String[]>() {{
        put(ERR_BAFFLE_JAMMED,  new String[]{"ERROR_80", "BAFFLE_JAMMED",  "Baffle Jammed — mechanical obstruction detected. Manual intervention required.", "critical"});
        put(ERR_LIFT_TIMEOUT,   new String[]{"ERROR_40", "LIFT_TIMEOUT",   "Lifting Timeout — motor failed to complete raise cycle.", "critical"});
        put(ERR_SHAKING_ALARM,  new String[]{"ERROR_20", "SHAKING_ALARM",  "Shaking Alarm — possible fare evasion or vandalism.", "warning"});
        put(ERR_OBSTACLE_HIT,   new String[]{"ERROR_10", "OBSTACLE_HIT",   "Obstacle During Raise — auto-bounce protection activated.", "warning"});
        put(ERR_PROBE_FAIL,     new String[]{"ERROR_08", "PROBE_FAIL",     "Probe Communication Failure — check sensor bus wiring.", "error"});
        put(ERR_ANGLE_FAIL,     new String[]{"ERROR_04", "ANGLE_FAIL",     "Angle Sensor Failure — obstacle protection degraded.", "error"});
        put(ERR_RADAR_FAIL,     new String[]{"ERROR_02", "RADAR_FAIL",     "Microwave Radar Failure — detection accuracy reduced.", "error"});
        put(ERR_GEOMAG_FAIL,    new String[]{"ERROR_01", "GEOMAG_FAIL",    "Geomagnetic Sensor Failure — immediate service required.", "critical"});
    }};

    // ── Telemetry Data Class ───────────────────────────────────────────
    public static class Telemetry {
        public final int     lockState;
        public final int     errorFlags;
        public final int     sensorMode;
        public final int     batteryPercent;
        public final boolean solarCharging;
        public final boolean vehicleDetected;
        public final float   baffleAngleDeg;
        public final long    timestamp;

        public Telemetry(int lockState, int errorFlags, int sensorMode,
                         int batteryPercent, boolean solarCharging,
                         boolean vehicleDetected, float baffleAngleDeg) {
            this.lockState       = lockState;
            this.errorFlags      = errorFlags;
            this.sensorMode      = sensorMode;
            this.batteryPercent  = batteryPercent;
            this.solarCharging   = solarCharging;
            this.vehicleDetected = vehicleDetected;
            this.baffleAngleDeg  = baffleAngleDeg;
            this.timestamp       = System.currentTimeMillis();
        }

        public boolean isBatteryLow()      { return batteryPercent <= 20; }
        public boolean isBatteryCritical() { return batteryPercent <= 10; }
    }

    // ── SDK Event ──────────────────────────────────────────────────────
    public static class DeviceEvent {
        public enum Type {
            CONNECTED, DISCONNECTED, TELEMETRY,
            VEHICLE_DETECTED, VEHICLE_DEPARTED,
            LOCK_RAISED, LOCK_LOWERED,
            ERROR, BATTERY_LOW, SOLAR_CHARGING,
            OTA_PROGRESS, OTA_COMPLETE, OTA_FAILED
        }

        public final Type      type;
        public final Telemetry telemetry;
        public final String    message;
        public final String    errorCode;
        public final String    severity;
        public final int       progress;    // for OTA events

        public DeviceEvent(Type type, Telemetry t, String message,
                           String code, String severity, int progress) {
            this.type      = type;
            this.telemetry = t;
            this.message   = message;
            this.errorCode = code;
            this.severity  = severity;
            this.progress  = progress;
        }

        public static DeviceEvent of(Type type) {
            return new DeviceEvent(type, null, null, null, null, 0);
        }
        public static DeviceEvent of(Type type, Telemetry t) {
            return new DeviceEvent(type, t, null, null, null, 0);
        }
        public static DeviceEvent error(Telemetry t, String code, String name, String msg, String severity) {
            return new DeviceEvent(Type.ERROR, t, msg, code, severity, 0);
        }
        public static DeviceEvent ota(Type type, int progress) {
            return new DeviceEvent(type, null, null, null, null, progress);
        }
    }

    // ── Battery Status ─────────────────────────────────────────────────
    public static class BatteryStatus {
        public final int     percent;
        public final boolean solarCharging;
        public final boolean isLow;
        public final boolean isCritical;
        public final String  statusLabel;

        public BatteryStatus(int pct, boolean solar) {
            this.percent       = pct;
            this.solarCharging = solar;
            this.isLow         = pct <= 20;
            this.isCritical    = pct <= 10;
            this.statusLabel   = isCritical ? "CRITICAL"
                               : isLow      ? "LOW"
                               : solar       ? "CHARGING" : "OK";
        }
    }

    // ── Instance Fields ────────────────────────────────────────────────
    private final Context context;
    private final String  deviceAddress;
    private final PublishSubject<DeviceEvent> eventSubject = PublishSubject.create();

    private BluetoothAdapter        btAdapter;
    private BluetoothGatt           gatt;
    private BluetoothGattCharacteristic txChar;

    private final LinkedList<Byte> rxBuffer     = new LinkedList<>();
    private volatile boolean       otaLocked    = false;
    private volatile boolean       connected    = false;
    private Telemetry              prevTelemetry;

    // Pending command synchronisation
    private volatile CompletableFuture<Telemetry> pendingAck;

    // ── Constructor ────────────────────────────────────────────────────

    /**
     * @param context       Android context
     * @param deviceAddress BLE MAC address (e.g., "AA:BB:CC:DD:EE:FF")
     */
    public SC1240Device(Context context, String deviceAddress) {
        this.context       = context.getApplicationContext();
        this.deviceAddress = deviceAddress;
        BluetoothManager mgr = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        this.btAdapter = mgr.getAdapter();
    }

    // ── Reactive event stream ──────────────────────────────────────────

    /** Subscribe to all device events. */
    public Observable<DeviceEvent> events() { return eventSubject.hide(); }

    /** Filter helper: subscribe only to vehicle detection events. */
    public Observable<DeviceEvent> onVehicleDetected() {
        return events().filter(e -> e.type == DeviceEvent.Type.VEHICLE_DETECTED);
    }

    /** Filter helper: subscribe only to error events. */
    public Observable<DeviceEvent> onError() {
        return events().filter(e -> e.type == DeviceEvent.Type.ERROR);
    }

    // ── Connection ─────────────────────────────────────────────────────

    public void connect() {
        BluetoothDevice device = btAdapter.getRemoteDevice(deviceAddress);
        gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
    }

    public void disconnect() {
        if (gatt != null) { gatt.disconnect(); }
    }

    public boolean isConnected() { return connected; }

    // ── Commands ───────────────────────────────────────────────────────

    public Single<Telemetry> resetDevice() { return sendCommand(Command.RESET_DEVICE); }
    public Single<Telemetry> raiseLock()   { return sendCommand(Command.RAISE_LOCK);   }
    public Single<Telemetry> lowerLock()   { return sendCommand(Command.LOWER_LOCK);   }
    public Single<Telemetry> getStatus()   { return sendCommand(Command.GET_STATUS);   }

    // ── Power ──────────────────────────────────────────────────────────

    public Single<BatteryStatus> getBatteryStatus() {
        return getStatus().map(t -> new BatteryStatus(t.batteryPercent, t.solarCharging));
    }

    // ── Internal: send command with timeout ────────────────────────────

    private Single<Telemetry> sendCommand(Command cmd) {
        return Single.create(emitter -> {
            if (!connected)  { emitter.onError(new Exception("Not connected"));       return; }
            if (otaLocked)   { emitter.onError(new Exception("OTA in progress"));     return; }

            CompletableFuture<Telemetry> future = new CompletableFuture<>();
            this.pendingAck = future;

            for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
                txChar.setValue(cmd.frame());
                gatt.writeCharacteristic(txChar);

                try {
                    Telemetry result = future.get(DEFAULT_TIMEOUT, TimeUnit.MILLISECONDS);
                    emitter.onSuccess(result);
                    return;
                } catch (TimeoutException e) {
                    if (attempt == MAX_RETRIES - 1) {
                        emitter.onError(new Exception("ACK timeout after " + MAX_RETRIES + " attempts"));
                    }
                    future = new CompletableFuture<>();
                    this.pendingAck = future;
                }
            }
        });
    }

    // ── Telemetry parsing & delta detection ────────────────────────────

    private synchronized void feedRx(byte[] data) {
        for (byte b : data) rxBuffer.add(b);
        while (rxBuffer.size() >= TELEMETRY_LEN) {
            // Check preamble
            if (rxBuffer.size() < 4) break;
            int pre = ((rxBuffer.get(0) & 0xFF) << 24) | ((rxBuffer.get(1) & 0xFF) << 16)
                    | ((rxBuffer.get(2) & 0xFF) << 8)  |  (rxBuffer.get(3) & 0xFF);
            if (pre != PREAMBLE) { rxBuffer.poll(); continue; }
            if (rxBuffer.size() < TELEMETRY_LEN) break;

            byte[] raw = new byte[TELEMETRY_LEN];
            Iterator<Byte> it = rxBuffer.iterator();
            for (int i = 0; i < TELEMETRY_LEN; i++) raw[i] = it.next();

            Telemetry t = parseTelemetry(raw);
            for (int i = 0; i < TELEMETRY_LEN; i++) rxBuffer.poll();

            if (t != null) handleTelemetry(t);
        }
    }

    private Telemetry parseTelemetry(byte[] raw) {
        // Validate checksum
        int chk = 0;
        for (int i = 4; i < TELEMETRY_LEN - 1; i++) chk ^= (raw[i] & 0xFF);
        if ((chk & 0xFF) != (raw[TELEMETRY_LEN - 1] & 0xFF)) {
            Log.w(TAG, "Checksum mismatch");
            return null;
        }
        int lockState      = raw[6] & 0xFF;
        int errorFlags     = raw[7] & 0xFF;
        int sensorMode     = raw[8] & 0xFF;
        int batteryPercent = raw[9] & 0xFF;
        boolean solar      = raw[10] == 1;
        boolean vehicle    = raw[11] == 1;
        int angleRaw       = ((raw[12] & 0xFF) << 8) | (raw[13] & 0xFF);
        float angle        = angleRaw / 10.0f;

        return new Telemetry(lockState, errorFlags, sensorMode, batteryPercent, solar, vehicle, angle);
    }

    private void handleTelemetry(Telemetry t) {
        // Resolve pending command
        if (pendingAck != null) pendingAck.complete(t);

        eventSubject.onNext(DeviceEvent.of(DeviceEvent.Type.TELEMETRY, t));

        // Vehicle delta
        if (prevTelemetry == null || t.vehicleDetected != prevTelemetry.vehicleDetected) {
            eventSubject.onNext(DeviceEvent.of(
                t.vehicleDetected ? DeviceEvent.Type.VEHICLE_DETECTED : DeviceEvent.Type.VEHICLE_DEPARTED, t));
        }

        // Lock state delta
        if (prevTelemetry != null && t.lockState != prevTelemetry.lockState) {
            if (t.lockState == 0x02) eventSubject.onNext(DeviceEvent.of(DeviceEvent.Type.LOCK_RAISED, t));
            if (t.lockState == 0x00) eventSubject.onNext(DeviceEvent.of(DeviceEvent.Type.LOCK_LOWERED, t));
        }

        // Error delta
        int prevErr = prevTelemetry != null ? prevTelemetry.errorFlags : 0;
        int newBits = t.errorFlags & ~prevErr;
        for (Map.Entry<Integer, String[]> entry : ERROR_DESCRIPTIONS.entrySet()) {
            int bit = entry.getKey();
            if ((newBits & bit) != 0) {
                String[] info = entry.getValue();
                eventSubject.onNext(DeviceEvent.error(t, info[0], info[1], info[2], info[3]));
            }
        }

        // Battery low
        int prevBat = prevTelemetry != null ? prevTelemetry.batteryPercent : 100;
        if (prevBat > 20 && t.batteryPercent <= 20)
            eventSubject.onNext(DeviceEvent.of(DeviceEvent.Type.BATTERY_LOW, t));

        // Solar
        if (prevTelemetry != null && !prevTelemetry.solarCharging && t.solarCharging)
            eventSubject.onNext(DeviceEvent.of(DeviceEvent.Type.SOLAR_CHARGING, t));

        prevTelemetry = t;
    }

    // ── BLE GATT Callback ──────────────────────────────────────────────

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connected = true;
                g.discoverServices();
                eventSubject.onNext(DeviceEvent.of(DeviceEvent.Type.CONNECTED));
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connected = false;
                eventSubject.onNext(DeviceEvent.of(DeviceEvent.Type.DISCONNECTED));
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            BluetoothGattService svc = g.getService(UUID.fromString(BLE_SERVICE_UUID));
            if (svc != null) {
                txChar = svc.getCharacteristic(UUID.fromString(BLE_CHAR_UUID));
                g.setCharacteristicNotification(txChar, true);
                // Enable CCCD notifications
                BluetoothGattDescriptor desc = txChar.getDescriptor(
                    UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
                if (desc != null) {
                    desc.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    g.writeDescriptor(desc);
                }
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g,
                                            BluetoothGattCharacteristic characteristic) {
            feedRx(characteristic.getValue());
        }
    };

    // ── CRC Utilities ──────────────────────────────────────────────────

    public static long crc32(byte[] data) {
        CRC32 crc = new CRC32();
        crc.update(data);
        return crc.getValue();
    }

    public static int crc16(byte[] data) {
        int crc = 0xFFFF;
        for (byte b : data) {
            crc ^= (b & 0xFF) << 8;
            for (int j = 0; j < 8; j++) {
                crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
                crc &= 0xFFFF;
            }
        }
        return crc;
    }
}

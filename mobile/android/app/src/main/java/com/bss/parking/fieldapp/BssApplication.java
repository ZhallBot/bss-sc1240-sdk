package com.bss.parking.fieldapp;

import android.app.Application;
import android.util.Log;
import java.util.ArrayList;
import java.util.List;

/**
 * Global Application class.
 * Holds the active SC1240Device connection and shared event log.
 */
public class BssApplication extends Application {

    private static final String TAG = "BssApplication";

    // Singleton reference to the active connected device
    private static com.bss.parking.fieldapp.sdk.SC1240Device activeDevice;
    private static String activeDeviceName = "";
    private static String activeDeviceAddress = "";

    // Shared event log (max 200 entries)
    private static final List<EventLogEntry> eventLog = new ArrayList<>();
    private static final int MAX_LOG_SIZE = 200;

    // Listeners for log updates
    public interface LogUpdateListener {
        void onLogUpdated(EventLogEntry entry);
    }
    private static final List<LogUpdateListener> logListeners = new ArrayList<>();

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "BSS Parking Field App started");
    }

    // ── Active Device ──────────────────────────────────────────────────

    public static com.bss.parking.fieldapp.sdk.SC1240Device getActiveDevice() {
        return activeDevice;
    }

    public static void setActiveDevice(com.bss.parking.fieldapp.sdk.SC1240Device device,
                                       String name, String address) {
        activeDevice = device;
        activeDeviceName = name;
        activeDeviceAddress = address;
    }

    public static void clearActiveDevice() {
        if (activeDevice != null) {
            activeDevice.disconnect();
        }
        activeDevice = null;
        activeDeviceName = "";
        activeDeviceAddress = "";
    }

    public static String getActiveDeviceName() { return activeDeviceName; }
    public static String getActiveDeviceAddress() { return activeDeviceAddress; }
    public static boolean hasActiveDevice() { return activeDevice != null; }

    // ── Event Log ──────────────────────────────────────────────────────

    public static synchronized void addLog(EventLogEntry entry) {
        eventLog.add(0, entry); // newest first
        if (eventLog.size() > MAX_LOG_SIZE) {
            eventLog.remove(eventLog.size() - 1);
        }
        for (LogUpdateListener l : logListeners) l.onLogUpdated(entry);
    }

    public static synchronized List<EventLogEntry> getEventLog() {
        return new ArrayList<>(eventLog);
    }

    public static void addLogListener(LogUpdateListener l) {
        if (!logListeners.contains(l)) logListeners.add(l);
    }

    public static void removeLogListener(LogUpdateListener l) {
        logListeners.remove(l);
    }

    // ── EventLogEntry ──────────────────────────────────────────────────

    public static class EventLogEntry {
        public enum Category { COMMAND, TELEMETRY, ERROR, CONNECTION, SYSTEM }

        public final long     timestamp;
        public final Category category;
        public final String   title;
        public final String   detail;
        public final String   severity;  // "info", "warning", "error", "critical"

        public EventLogEntry(Category category, String title, String detail, String severity) {
            this.timestamp = System.currentTimeMillis();
            this.category  = category;
            this.title     = title;
            this.detail    = detail;
            this.severity  = severity;
        }

        public static EventLogEntry command(String cmd, String result) {
            return new EventLogEntry(Category.COMMAND, "CMD: " + cmd, result, "info");
        }

        public static EventLogEntry error(String code, String msg, String severity) {
            return new EventLogEntry(Category.ERROR, "ERR: " + code, msg, severity);
        }

        public static EventLogEntry connection(String msg) {
            return new EventLogEntry(Category.CONNECTION, "BLE", msg, "info");
        }

        public static EventLogEntry system(String msg) {
            return new EventLogEntry(Category.SYSTEM, "SYS", msg, "info");
        }
    }
}

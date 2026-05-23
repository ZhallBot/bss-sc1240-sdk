package com.bss.parking.fieldapp.model;

/**
 * Data model for a discovered BLE device.
 */
public class DeviceInfo {
    public final String  name;
    public final String  address;
    public       int     rssi;
    public final boolean isSC1240;

    public DeviceInfo(String name, String address, int rssi, boolean isSC1240) {
        this.name     = name;
        this.address  = address;
        this.rssi     = rssi;
        this.isSC1240 = isSC1240;
    }

    /** Signal strength label */
    public String signalLabel() {
        if (rssi >= -60) return "Kuat";
        if (rssi >= -75) return "Sedang";
        return "Lemah";
    }

    /** Signal strength icon emoji */
    public String signalIcon() {
        if (rssi >= -60) return "📶";
        if (rssi >= -75) return "📶";
        return "📵";
    }
}

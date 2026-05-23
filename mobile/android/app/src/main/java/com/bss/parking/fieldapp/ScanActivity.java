package com.bss.parking.fieldapp;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.bss.parking.fieldapp.adapter.DeviceListAdapter;
import com.bss.parking.fieldapp.model.DeviceInfo;
import com.bss.parking.fieldapp.sdk.SC1240Device;
import java.util.ArrayList;
import java.util.List;

/**
 * BLE Scanner Activity — find nearby SC1240 parking locks.
 */
public class ScanActivity extends AppCompatActivity implements DeviceListAdapter.OnDeviceClickListener {

    private static final int PERMISSION_REQUEST_CODE = 100;
    private static final long SCAN_DURATION_MS = 15_000L;

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner leScanner;
    private ScanCallback scanCallback;
    private Handler stopHandler;

    private Button btnScan;
    private TextView tvScanStatus;
    private TextView tvScanCount;
    private RecyclerView recyclerDevices;
    private View progressScanning;

    private DeviceListAdapter adapter;
    private final List<DeviceInfo> devices = new ArrayList<>();
    private boolean isScanning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_scan);

        btnScan         = findViewById(R.id.btn_scan);
        tvScanStatus    = findViewById(R.id.tv_scan_status);
        tvScanCount     = findViewById(R.id.tv_scan_count);
        recyclerDevices = findViewById(R.id.recycler_devices);
        progressScanning = findViewById(R.id.progress_scanning);

        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle("Scan Perangkat BLE");
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }

        adapter = new DeviceListAdapter(devices, this);
        recyclerDevices.setLayoutManager(new LinearLayoutManager(this));
        recyclerDevices.setAdapter(adapter);

        BluetoothManager mgr = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        bluetoothAdapter = mgr.getAdapter();
        stopHandler = new Handler();

        btnScan.setOnClickListener(v -> {
            if (isScanning) stopScan();
            else startScan();
        });

        // Auto-start scan
        requestBlePermissions();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    // ── Permissions ────────────────────────────────────────────────────

    private void requestBlePermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED)
                perms.add(Manifest.permission.BLUETOOTH_SCAN);
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
                perms.add(Manifest.permission.BLUETOOTH_CONNECT);
        } else {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
                perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }

        if (perms.isEmpty()) startScan();
        else ActivityCompat.requestPermissions(this, perms.toArray(new String[0]), PERMISSION_REQUEST_CODE);
    }

    @Override
    public void onRequestPermissionsResult(int req, @NonNull String[] perms, @NonNull int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == PERMISSION_REQUEST_CODE) {
            boolean granted = true;
            for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) { granted = false; break; }
            if (granted) startScan();
            else Toast.makeText(this, "Izin Bluetooth diperlukan", Toast.LENGTH_LONG).show();
        }
    }

    // ── BLE Scanning ───────────────────────────────────────────────────

    private void startScan() {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            Toast.makeText(this, "Aktifkan Bluetooth terlebih dahulu", Toast.LENGTH_SHORT).show();
            return;
        }

        devices.clear();
        adapter.notifyDataSetChanged();
        isScanning = true;
        updateScanUI(true);

        leScanner = bluetoothAdapter.getBluetoothLeScanner();
        scanCallback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                BluetoothDevice device = result.getDevice();
                String name = device.getName();
                if (name == null) name = "Unknown";

                // Filter SC1240 / BSS devices (or show all in demo mode)
                boolean isSC1240 = name.contains("SC1240") || name.contains("BSS") || name.contains("Parking");

                final String finalName = name;
                final int rssi = result.getRssi();
                final String addr = device.getAddress();

                // Check duplicate
                for (DeviceInfo d : devices) {
                    if (d.address.equals(addr)) {
                        // Update RSSI
                        int idx = devices.indexOf(d);
                        devices.get(idx).rssi = rssi;
                        runOnUiThread(() -> adapter.notifyItemChanged(idx));
                        return;
                    }
                }

                DeviceInfo info = new DeviceInfo(finalName, addr, rssi, isSC1240);
                runOnUiThread(() -> {
                    devices.add(0, info);
                    adapter.notifyItemInserted(0);
                    tvScanCount.setText(devices.size() + " perangkat ditemukan");
                });
            }

            @Override
            public void onScanFailed(int errorCode) {
                runOnUiThread(() -> {
                    tvScanStatus.setText("Scan gagal (error " + errorCode + ")");
                    stopScan();
                });
            }
        };

        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        leScanner.startScan(new ArrayList<ScanFilter>(), settings, scanCallback);
        stopHandler.postDelayed(this::stopScan, SCAN_DURATION_MS);

        BssApplication.addLog(BssApplication.EventLogEntry.connection("BLE scan dimulai"));
    }

    private void stopScan() {
        if (!isScanning) return;
        isScanning = false;
        if (leScanner != null && scanCallback != null) {
            try { leScanner.stopScan(scanCallback); } catch (Exception ignored) {}
        }
        runOnUiThread(() -> updateScanUI(false));
        BssApplication.addLog(BssApplication.EventLogEntry.connection(
            "BLE scan selesai — " + devices.size() + " perangkat"));
    }

    private void updateScanUI(boolean scanning) {
        btnScan.setText(scanning ? "⏹ STOP SCAN" : "🔍 MULAI SCAN");
        tvScanStatus.setText(scanning ? "Memindai perangkat BLE…" : "Scan selesai");
        progressScanning.setVisibility(scanning ? View.VISIBLE : View.GONE);
    }

    // ── Device Selected ────────────────────────────────────────────────

    @Override
    public void onDeviceClick(DeviceInfo device) {
        stopScan();
        tvScanStatus.setText("Menghubungkan ke " + device.name + "…");

        SC1240Device sc1240 = new SC1240Device(this, device.address);
        BssApplication.setActiveDevice(sc1240, device.name, device.address);
        BssApplication.addLog(BssApplication.EventLogEntry.connection("Connecting → " + device.address));

        sc1240.connect();

        // Subscribe to events
        sc1240.events()
            .observeOn(io.reactivex.rxjava3.android.schedulers.AndroidSchedulers.mainThread())
            .subscribe(event -> {
                switch (event.type) {
                    case CONNECTED:
                        BssApplication.addLog(BssApplication.EventLogEntry.connection("Terhubung ✓"));
                        startActivity(new Intent(ScanActivity.this, DeviceControlActivity.class));
                        break;
                    case DISCONNECTED:
                        BssApplication.addLog(BssApplication.EventLogEntry.connection("Koneksi terputus"));
                        runOnUiThread(() -> tvScanStatus.setText("Koneksi terputus. Coba lagi."));
                        break;
                    case ERROR:
                        BssApplication.addLog(BssApplication.EventLogEntry.error(
                            event.errorCode, event.message, event.severity));
                        break;
                    default:
                        break;
                }
            }, err -> {
                BssApplication.addLog(BssApplication.EventLogEntry.error("BLE_ERR", err.getMessage(), "error"));
            });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopScan();
    }
}

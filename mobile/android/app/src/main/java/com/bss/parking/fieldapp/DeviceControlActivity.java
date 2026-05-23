package com.bss.parking.fieldapp;

import android.content.DialogInterface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import com.bss.parking.fieldapp.sdk.SC1240Device;
import io.reactivex.rxjava3.android.schedulers.AndroidSchedulers;
import io.reactivex.rxjava3.disposables.CompositeDisposable;
import io.reactivex.rxjava3.schedulers.Schedulers;

/**
 * Device Control Activity — main control panel for a connected SC1240.
 * Shows live telemetry and provides one-tap command buttons.
 */
public class DeviceControlActivity extends AppCompatActivity {

    // Status panels
    private TextView tvLockState;
    private TextView tvVehicleStatus;
    private TextView tvBatteryValue;
    private TextView tvBatteryLabel;
    private ProgressBar batteryProgressBar;
    private TextView tvSolarStatus;
    private TextView tvSensorMode;
    private TextView tvBaffleAngle;
    private TextView tvDeviceName;
    private TextView tvDeviceAddress;
    private TextView tvConnectionChip;

    // Error banner
    private LinearLayout errorBanner;
    private TextView tvErrorMessage;

    // Command buttons
    private Button btnRaise;
    private Button btnLower;
    private Button btnReset;
    private Button btnStatus;

    // Command progress
    private View commandProgress;
    private TextView tvCommandStatus;

    // Live log
    private TextView tvLiveLog;

    private SC1240Device device;
    private final CompositeDisposable disposables = new CompositeDisposable();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Rolling log buffer
    private final StringBuilder liveLogBuffer = new StringBuilder();
    private static final int MAX_LOG_LINES = 8;
    private int logLineCount = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_device_control);

        device = BssApplication.getActiveDevice();
        if (device == null) {
            Toast.makeText(this, "Tidak ada perangkat aktif", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        bindViews();
        setupActionBar();
        setupCommandButtons();
        subscribeToEvents();

        // Request initial status
        sendGetStatus();
    }

    private void bindViews() {
        tvLockState       = findViewById(R.id.tv_lock_state);
        tvVehicleStatus   = findViewById(R.id.tv_vehicle_status);
        tvBatteryValue    = findViewById(R.id.tv_battery_value);
        tvBatteryLabel    = findViewById(R.id.tv_battery_label);
        batteryProgressBar = findViewById(R.id.progress_battery);
        tvSolarStatus     = findViewById(R.id.tv_solar_status);
        tvSensorMode      = findViewById(R.id.tv_sensor_mode);
        tvBaffleAngle     = findViewById(R.id.tv_baffle_angle);
        tvDeviceName      = findViewById(R.id.tv_device_name);
        tvDeviceAddress   = findViewById(R.id.tv_device_address);
        tvConnectionChip  = findViewById(R.id.tv_connection_chip);
        errorBanner       = findViewById(R.id.error_banner);
        tvErrorMessage    = findViewById(R.id.tv_error_message);
        btnRaise          = findViewById(R.id.btn_raise);
        btnLower          = findViewById(R.id.btn_lower);
        btnReset          = findViewById(R.id.btn_reset);
        btnStatus         = findViewById(R.id.btn_status);
        commandProgress   = findViewById(R.id.command_progress);
        tvCommandStatus   = findViewById(R.id.tv_command_status);
        tvLiveLog         = findViewById(R.id.tv_live_log);

        tvDeviceName.setText(BssApplication.getActiveDeviceName());
        tvDeviceAddress.setText(BssApplication.getActiveDeviceAddress());
        updateConnectionChip(device.isConnected());
        errorBanner.setVisibility(View.GONE);
        commandProgress.setVisibility(View.GONE);
    }

    private void setupActionBar() {
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle("Kontrol Kunci Parkir");
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private void setupCommandButtons() {
        btnRaise.setOnClickListener(v -> confirmAndSend("RAISE LOCK",
            "Angkat palang kunci parkir?", () -> sendRaise()));

        btnLower.setOnClickListener(v -> confirmAndSend("LOWER LOCK",
            "Turunkan palang kunci parkir?", () -> sendLower()));

        btnReset.setOnClickListener(v -> confirmAndSend("RESET DEVICE",
            "Reset perangkat SC1240? Ini akan memutus koneksi sementara.", () -> sendReset()));

        btnStatus.setOnClickListener(v -> sendGetStatus());
    }

    // ── Command Execution ──────────────────────────────────────────────

    private void confirmAndSend(String title, String message, Runnable action) {
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton("Ya, Lanjutkan", (d, w) -> action.run())
            .setNegativeButton("Batal", null)
            .show();
    }

    private void sendRaise() {
        setCommandLoading(true, "Mengirim RAISE LOCK…");
        BssApplication.addLog(BssApplication.EventLogEntry.command("RAISE_LOCK", "Mengirim…"));
        appendLiveLog("▲ RAISE LOCK dikirim");

        disposables.add(
            device.raiseLock()
                .subscribeOn(Schedulers.io())
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(telemetry -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✓ Palang NAIK — " + telemetry.baffleAngleDeg + "°");
                    BssApplication.addLog(BssApplication.EventLogEntry.command(
                        "RAISE_LOCK", "OK — angle: " + telemetry.baffleAngleDeg + "°"));
                    updateTelemetryUI(telemetry);
                    showToast("✓ Palang berhasil diangkat");
                }, err -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✗ RAISE gagal: " + err.getMessage());
                    BssApplication.addLog(BssApplication.EventLogEntry.error(
                        "RAISE_FAIL", err.getMessage(), "error"));
                    showToast("Gagal: " + err.getMessage());
                })
        );
    }

    private void sendLower() {
        setCommandLoading(true, "Mengirim LOWER LOCK…");
        BssApplication.addLog(BssApplication.EventLogEntry.command("LOWER_LOCK", "Mengirim…"));
        appendLiveLog("▼ LOWER LOCK dikirim");

        disposables.add(
            device.lowerLock()
                .subscribeOn(Schedulers.io())
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(telemetry -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✓ Palang TURUN — " + telemetry.baffleAngleDeg + "°");
                    BssApplication.addLog(BssApplication.EventLogEntry.command(
                        "LOWER_LOCK", "OK — angle: " + telemetry.baffleAngleDeg + "°"));
                    updateTelemetryUI(telemetry);
                    showToast("✓ Palang berhasil diturunkan");
                }, err -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✗ LOWER gagal: " + err.getMessage());
                    BssApplication.addLog(BssApplication.EventLogEntry.error(
                        "LOWER_FAIL", err.getMessage(), "error"));
                    showToast("Gagal: " + err.getMessage());
                })
        );
    }

    private void sendReset() {
        setCommandLoading(true, "Mengirim RESET…");
        BssApplication.addLog(BssApplication.EventLogEntry.command("RESET_DEVICE", "Mengirim…"));
        appendLiveLog("↺ RESET DEVICE dikirim");

        disposables.add(
            device.resetDevice()
                .subscribeOn(Schedulers.io())
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(telemetry -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✓ RESET berhasil");
                    BssApplication.addLog(BssApplication.EventLogEntry.command("RESET_DEVICE", "OK"));
                    updateTelemetryUI(telemetry);
                    errorBanner.setVisibility(View.GONE);
                    showToast("✓ Perangkat berhasil direset");
                }, err -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✗ RESET gagal: " + err.getMessage());
                    BssApplication.addLog(BssApplication.EventLogEntry.error(
                        "RESET_FAIL", err.getMessage(), "error"));
                    showToast("Gagal: " + err.getMessage());
                })
        );
    }

    private void sendGetStatus() {
        setCommandLoading(true, "Memperbarui status…");
        appendLiveLog("? STATUS dikirim");

        disposables.add(
            device.getStatus()
                .subscribeOn(Schedulers.io())
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(telemetry -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✓ STATUS diterima");
                    BssApplication.addLog(BssApplication.EventLogEntry.command(
                        "GET_STATUS", "bat:" + telemetry.batteryPercent + "% lock:" + telemetry.lockState));
                    updateTelemetryUI(telemetry);
                }, err -> {
                    setCommandLoading(false, "");
                    appendLiveLog("✗ STATUS gagal: " + err.getMessage());
                })
        );
    }

    // ── Event Subscription ─────────────────────────────────────────────

    private void subscribeToEvents() {
        disposables.add(
            device.events()
                .observeOn(AndroidSchedulers.mainThread())
                .subscribe(event -> {
                    switch (event.type) {
                        case CONNECTED:
                            updateConnectionChip(true);
                            appendLiveLog("● BLE Terhubung");
                            break;
                        case DISCONNECTED:
                            updateConnectionChip(false);
                            appendLiveLog("○ BLE Terputus");
                            setButtonsEnabled(false);
                            break;
                        case TELEMETRY:
                            if (event.telemetry != null) updateTelemetryUI(event.telemetry);
                            break;
                        case VEHICLE_DETECTED:
                            appendLiveLog("🚗 Kendaraan terdeteksi!");
                            BssApplication.addLog(BssApplication.EventLogEntry.command(
                                "VEHICLE", "Kendaraan masuk"));
                            break;
                        case VEHICLE_DEPARTED:
                            appendLiveLog("🚗 Kendaraan keluar");
                            break;
                        case ERROR:
                            showErrorBanner(event.errorCode + ": " + event.message);
                            appendLiveLog("⚠ ERROR: " + event.errorCode);
                            BssApplication.addLog(BssApplication.EventLogEntry.error(
                                event.errorCode, event.message, event.severity));
                            break;
                        case BATTERY_LOW:
                            appendLiveLog("🔋 Baterai rendah!");
                            showToast("⚠ Baterai rendah!");
                            break;
                        case SOLAR_CHARGING:
                            appendLiveLog("☀ Solar charging aktif");
                            break;
                        default:
                            break;
                    }
                }, err -> appendLiveLog("✗ Event error: " + err.getMessage()))
        );
    }

    // ── UI Helpers ─────────────────────────────────────────────────────

    private int color(int colorResId) {
        return ContextCompat.getColor(this, colorResId);
    }

    private void updateTelemetryUI(SC1240Device.Telemetry t) {
        // Lock state
        String lockLabel;
        int lockColor;
        switch (t.lockState) {
            case 0x02: lockLabel = "▲ NAIK (Terkunci)"; lockColor = color(R.color.red_error);   break;
            case 0x00: lockLabel = "▼ TURUN (Bebas)";   lockColor = color(R.color.green_ok);    break;
            case 0x01: lockLabel = "↕ BERGERAK…";        lockColor = color(R.color.yellow_warn); break;
            default:   lockLabel = "? TIDAK DIKETAHUI"; lockColor = color(R.color.text_secondary); break;
        }
        tvLockState.setText(lockLabel);
        tvLockState.setTextColor(lockColor);

        // Vehicle
        tvVehicleStatus.setText(t.vehicleDetected ? "🚗 ADA KENDARAAN" : "○ KOSONG");
        tvVehicleStatus.setTextColor(color(t.vehicleDetected ? R.color.yellow_warn : R.color.green_ok));

        // Battery
        tvBatteryValue.setText(t.batteryPercent + "%");
        batteryProgressBar.setProgress(t.batteryPercent);
        if (t.isBatteryCritical()) {
            tvBatteryLabel.setText("KRITIS");
            tvBatteryLabel.setTextColor(color(R.color.red_error));
        } else if (t.isBatteryLow()) {
            tvBatteryLabel.setText("RENDAH");
            tvBatteryLabel.setTextColor(color(R.color.yellow_warn));
        } else {
            tvBatteryLabel.setText(t.solarCharging ? "CHARGING ☀" : "NORMAL");
            tvBatteryLabel.setTextColor(color(R.color.green_ok));
        }

        // Solar
        tvSolarStatus.setText(t.solarCharging ? "☀ Solar ON" : "— Solar OFF");
        tvSolarStatus.setTextColor(color(t.solarCharging ? R.color.yellow_warn : R.color.text_secondary));

        // Sensor mode
        String sensorLabel;
        switch (t.sensorMode) {
            case 0x01: sensorLabel = "IR"; break;
            case 0x02: sensorLabel = "Radar"; break;
            case 0x04: sensorLabel = "Geomag"; break;
            case 0x07: sensorLabel = "IR + Radar + Geomag"; break;
            default:   sensorLabel = "Mode " + t.sensorMode; break;
        }
        tvSensorMode.setText(sensorLabel);

        // Baffle angle
        tvBaffleAngle.setText(String.format("%.1f°", t.baffleAngleDeg));

        // Error flags
        if (t.errorFlags != 0) {
            showErrorBanner("Error flags aktif: 0x" + String.format("%02X", t.errorFlags));
        } else {
            errorBanner.setVisibility(View.GONE);
        }

        setButtonsEnabled(device.isConnected());
    }

    private void updateConnectionChip(boolean connected) {
        tvConnectionChip.setText(connected ? "● TERHUBUNG" : "○ PUTUS");
        tvConnectionChip.setTextColor(color(connected ? R.color.green_ok : R.color.red_error));
    }

    private void showErrorBanner(String message) {
        errorBanner.setVisibility(View.VISIBLE);
        tvErrorMessage.setText("⚠ " + message);
    }

    private void setCommandLoading(boolean loading, String message) {
        commandProgress.setVisibility(loading ? View.VISIBLE : View.GONE);
        tvCommandStatus.setText(message);
        setButtonsEnabled(!loading && device.isConnected());
    }

    private void setButtonsEnabled(boolean enabled) {
        btnRaise.setEnabled(enabled);
        btnLower.setEnabled(enabled);
        btnReset.setEnabled(enabled);
        btnStatus.setEnabled(enabled);
    }

    private void appendLiveLog(String text) {
        mainHandler.post(() -> {
            String timestamp = new java.text.SimpleDateFormat("HH:mm:ss",
                java.util.Locale.getDefault()).format(new java.util.Date());
            liveLogBuffer.insert(0, "[" + timestamp + "] " + text + "\n");
            logLineCount++;
            // Trim to max lines
            String[] lines = liveLogBuffer.toString().split("\n");
            if (lines.length > MAX_LOG_LINES) {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < MAX_LOG_LINES && i < lines.length; i++) {
                    sb.append(lines[i]).append("\n");
                }
                liveLogBuffer.setLength(0);
                liveLogBuffer.append(sb);
            }
            tvLiveLog.setText(liveLogBuffer.toString());
        });
    }

    private void showToast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        disposables.clear();
    }
}

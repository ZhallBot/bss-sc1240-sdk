package com.bss.parking.fieldapp;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.cardview.widget.CardView;

/**
 * Main dashboard — shown after splash.
 * Displays quick status and navigation to Scan / Control / History.
 */
public class MainActivity extends AppCompatActivity {

    private TextView tvDeviceStatus;
    private TextView tvDeviceName;
    private TextView tvDeviceAddress;
    private CardView cardDeviceConnected;
    private CardView cardDeviceDisconnected;
    private Button btnScanDevices;
    private Button btnOpenControl;
    private Button btnOpenHistory;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        tvDeviceStatus       = findViewById(R.id.tv_device_status);
        tvDeviceName         = findViewById(R.id.tv_device_name);
        tvDeviceAddress      = findViewById(R.id.tv_device_address);
        cardDeviceConnected  = findViewById(R.id.card_device_connected);
        cardDeviceDisconnected = findViewById(R.id.card_device_disconnected);
        btnScanDevices       = findViewById(R.id.btn_scan_devices);
        btnOpenControl       = findViewById(R.id.btn_open_control);
        btnOpenHistory       = findViewById(R.id.btn_open_history);

        btnScanDevices.setOnClickListener(v ->
            startActivity(new Intent(this, ScanActivity.class)));

        btnOpenControl.setOnClickListener(v -> {
            if (BssApplication.hasActiveDevice()) {
                startActivity(new Intent(this, DeviceControlActivity.class));
            }
        });

        btnOpenHistory.setOnClickListener(v ->
            startActivity(new Intent(this, HistoryActivity.class)));

        BssApplication.addLog(BssApplication.EventLogEntry.system("App started"));
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateConnectionCard();
    }

    private void updateConnectionCard() {
        if (BssApplication.hasActiveDevice()) {
            cardDeviceConnected.setVisibility(View.VISIBLE);
            cardDeviceDisconnected.setVisibility(View.GONE);
            tvDeviceName.setText(BssApplication.getActiveDeviceName());
            tvDeviceAddress.setText(BssApplication.getActiveDeviceAddress());
            tvDeviceStatus.setText(
                BssApplication.getActiveDevice().isConnected() ? "● TERHUBUNG" : "○ PUTUS");
            tvDeviceStatus.setTextColor(getResources().getColor(
                BssApplication.getActiveDevice().isConnected()
                    ? R.color.green_ok : R.color.red_error, null));
            btnOpenControl.setEnabled(true);
        } else {
            cardDeviceConnected.setVisibility(View.GONE);
            cardDeviceDisconnected.setVisibility(View.VISIBLE);
            btnOpenControl.setEnabled(false);
        }
    }
}

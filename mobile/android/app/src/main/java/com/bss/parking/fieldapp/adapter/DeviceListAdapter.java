package com.bss.parking.fieldapp.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;
import com.bss.parking.fieldapp.R;
import com.bss.parking.fieldapp.model.DeviceInfo;
import java.util.List;

/**
 * RecyclerView adapter for the BLE device list in ScanActivity.
 */
public class DeviceListAdapter extends RecyclerView.Adapter<DeviceListAdapter.ViewHolder> {

    public interface OnDeviceClickListener {
        void onDeviceClick(DeviceInfo device);
    }

    private final List<DeviceInfo>     devices;
    private final OnDeviceClickListener listener;

    public DeviceListAdapter(List<DeviceInfo> devices, OnDeviceClickListener listener) {
        this.devices  = devices;
        this.listener = listener;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
            .inflate(R.layout.item_device, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        DeviceInfo device = devices.get(position);
        holder.bind(device, listener);
    }

    @Override
    public int getItemCount() { return devices.size(); }

    static class ViewHolder extends RecyclerView.ViewHolder {
        private final TextView tvDeviceName;
        private final TextView tvDeviceAddress;
        private final TextView tvDeviceRssi;
        private final TextView tvDeviceType;
        private final View     indicatorDot;

        ViewHolder(View itemView) {
            super(itemView);
            tvDeviceName    = itemView.findViewById(R.id.tv_device_name);
            tvDeviceAddress = itemView.findViewById(R.id.tv_device_address);
            tvDeviceRssi    = itemView.findViewById(R.id.tv_device_rssi);
            tvDeviceType    = itemView.findViewById(R.id.tv_device_type);
            indicatorDot    = itemView.findViewById(R.id.indicator_dot);
        }

        void bind(DeviceInfo device, OnDeviceClickListener listener) {
            tvDeviceName.setText(device.name);
            tvDeviceAddress.setText(device.address);
            tvDeviceRssi.setText(device.rssi + " dBm  " + device.signalLabel());
            tvDeviceType.setText(device.isSC1240 ? "SC1240 Parking Lock" : "Unknown BLE Device");

            int dotColor = device.isSC1240
                ? ContextCompat.getColor(itemView.getContext(), R.color.cyan_accent)
                : ContextCompat.getColor(itemView.getContext(), R.color.text_secondary);
            indicatorDot.setBackgroundTintList(
                android.content.res.ColorStateList.valueOf(dotColor));

            itemView.setOnClickListener(v -> listener.onDeviceClick(device));
        }
    }
}

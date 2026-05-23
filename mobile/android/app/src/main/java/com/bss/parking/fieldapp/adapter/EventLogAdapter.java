package com.bss.parking.fieldapp.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;
import com.bss.parking.fieldapp.BssApplication;
import com.bss.parking.fieldapp.R;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * RecyclerView adapter for the event log in HistoryActivity.
 */
public class EventLogAdapter extends RecyclerView.Adapter<EventLogAdapter.ViewHolder> {

    private List<BssApplication.EventLogEntry> entries;
    private final SimpleDateFormat sdf = new SimpleDateFormat("HH:mm:ss", Locale.getDefault());

    public EventLogAdapter(List<BssApplication.EventLogEntry> entries) {
        this.entries = entries;
    }

    public void updateData(List<BssApplication.EventLogEntry> newData) {
        this.entries = newData;
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
            .inflate(R.layout.item_log_entry, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        holder.bind(entries.get(position));
    }

    @Override
    public int getItemCount() { return entries.size(); }

    class ViewHolder extends RecyclerView.ViewHolder {
        private final View     severityBar;
        private final TextView tvTimestamp;
        private final TextView tvTitle;
        private final TextView tvDetail;
        private final TextView tvCategory;

        ViewHolder(View itemView) {
            super(itemView);
            severityBar  = itemView.findViewById(R.id.severity_bar);
            tvTimestamp  = itemView.findViewById(R.id.tv_log_timestamp);
            tvTitle      = itemView.findViewById(R.id.tv_log_title);
            tvDetail     = itemView.findViewById(R.id.tv_log_detail);
            tvCategory   = itemView.findViewById(R.id.tv_log_category);
        }

        void bind(BssApplication.EventLogEntry entry) {
            tvTimestamp.setText(sdf.format(new Date(entry.timestamp)));
            tvTitle.setText(entry.title);
            tvDetail.setText(entry.detail != null ? entry.detail : "");
            tvCategory.setText(entry.category.name());

            // Severity color on the left bar
            int color;
            switch (entry.severity) {
                case "critical": color = ContextCompat.getColor(itemView.getContext(), R.color.red_error);     break;
                case "error":    color = ContextCompat.getColor(itemView.getContext(), R.color.red_error);     break;
                case "warning":  color = ContextCompat.getColor(itemView.getContext(), R.color.yellow_warn);   break;
                default:         color = ContextCompat.getColor(itemView.getContext(), R.color.cyan_accent);   break;
            }
            severityBar.setBackgroundColor(color);

            // Category chip color
            int catColor;
            switch (entry.category) {
                case ERROR:      catColor = ContextCompat.getColor(itemView.getContext(), R.color.red_error);   break;
                case COMMAND:    catColor = ContextCompat.getColor(itemView.getContext(), R.color.cyan_accent); break;
                case CONNECTION: catColor = ContextCompat.getColor(itemView.getContext(), R.color.green_ok);    break;
                default:         catColor = ContextCompat.getColor(itemView.getContext(), R.color.text_secondary); break;
            }
            tvCategory.setTextColor(catColor);
        }
    }
}

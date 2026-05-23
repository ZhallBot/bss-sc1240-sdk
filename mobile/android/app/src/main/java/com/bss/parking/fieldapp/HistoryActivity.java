package com.bss.parking.fieldapp;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.FileProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import com.bss.parking.fieldapp.adapter.EventLogAdapter;
import com.google.android.material.chip.Chip;
import com.google.android.material.chip.ChipGroup;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * History Activity — shows filterable event log with CSV export.
 */
public class HistoryActivity extends AppCompatActivity {

    private RecyclerView recyclerLog;
    private EventLogAdapter adapter;
    private TextView tvLogCount;
    private TextView tvEmptyState;
    private ChipGroup chipGroup;

    private List<BssApplication.EventLogEntry> allLogs;
    private BssApplication.EventLogEntry.Category activeFilter = null; // null = All

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_history);

        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle("Riwayat Event");
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }

        recyclerLog  = findViewById(R.id.recycler_log);
        tvLogCount   = findViewById(R.id.tv_log_count);
        tvEmptyState = findViewById(R.id.tv_empty_state);
        chipGroup    = findViewById(R.id.chip_group_filter);

        allLogs = BssApplication.getEventLog();
        adapter = new EventLogAdapter(new ArrayList<>(allLogs));
        recyclerLog.setLayoutManager(new LinearLayoutManager(this));
        recyclerLog.setAdapter(adapter);

        setupFilterChips();
        updateUI();

        // Live updates
        BssApplication.addLogListener(entry -> {
            runOnUiThread(() -> {
                allLogs = BssApplication.getEventLog();
                applyFilter();
            });
        });
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.history_menu, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.action_export_csv) {
            exportToCSV();
            return true;
        }
        if (item.getItemId() == R.id.action_clear_log) {
            // Can't clear in this demo — just show message
            Toast.makeText(this, "Log hanya bisa dihapus dengan restart app", Toast.LENGTH_SHORT).show();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    // ── Filter Chips ───────────────────────────────────────────────────

    private void setupFilterChips() {
        String[] labels = {"Semua", "Perintah", "Error", "Telemetri", "Koneksi"};
        BssApplication.EventLogEntry.Category[] cats = {
            null,
            BssApplication.EventLogEntry.Category.COMMAND,
            BssApplication.EventLogEntry.Category.ERROR,
            BssApplication.EventLogEntry.Category.TELEMETRY,
            BssApplication.EventLogEntry.Category.CONNECTION
        };

        for (int i = 0; i < labels.length; i++) {
            Chip chip = new Chip(this);
            chip.setText(labels[i]);
            chip.setCheckable(true);
            chip.setChecked(i == 0);
            final BssApplication.EventLogEntry.Category cat = cats[i];
            chip.setOnCheckedChangeListener((btn, checked) -> {
                if (checked) {
                    activeFilter = cat;
                    applyFilter();
                }
            });
            chipGroup.addView(chip);
        }
    }

    private void applyFilter() {
        List<BssApplication.EventLogEntry> filtered = new ArrayList<>();
        for (BssApplication.EventLogEntry e : allLogs) {
            if (activeFilter == null || e.category == activeFilter) filtered.add(e);
        }
        adapter.updateData(filtered);
        tvLogCount.setText(filtered.size() + " event");
        tvEmptyState.setVisibility(filtered.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private void updateUI() {
        applyFilter();
    }

    // ── CSV Export ─────────────────────────────────────────────────────

    private void exportToCSV() {
        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.getDefault());
            String filename = "bss_log_" + sdf.format(new Date()) + ".csv";
            File file = new File(getCacheDir(), filename);
            FileWriter writer = new FileWriter(file);

            writer.write("Timestamp,Kategori,Judul,Detail,Severity\n");
            SimpleDateFormat ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault());
            for (BssApplication.EventLogEntry entry : allLogs) {
                writer.write(String.format("%s,%s,%s,%s,%s\n",
                    ts.format(new Date(entry.timestamp)),
                    entry.category,
                    escape(entry.title),
                    escape(entry.detail),
                    entry.severity));
            }
            writer.close();

            Uri uri = FileProvider.getUriForFile(this,
                getPackageName() + ".fileprovider", file);
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/csv");
            share.putExtra(Intent.EXTRA_STREAM, uri);
            share.putExtra(Intent.EXTRA_SUBJECT, "BSS Parking Event Log");
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(share, "Bagikan Log"));

        } catch (IOException e) {
            Toast.makeText(this, "Gagal ekspor: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private String escape(String s) {
        if (s == null) return "";
        return "\"" + s.replace("\"", "\"\"") + "\"";
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        BssApplication.removeLogListener(null);
    }
}

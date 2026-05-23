# BSS Parking Field Officer App — Android

Aplikasi Android untuk petugas lapangan yang mengelola kunci parkir **SC1240** via Bluetooth Low Energy (BLE).

---

## Fitur Utama

| Layar | Fungsi |
|---|---|
| **Dashboard** | Status koneksi, navigasi ke semua fitur |
| **BLE Scanner** | Scan & temukan kunci SC1240 terdekat |
| **Kontrol Kunci** | Real-time telemetri + perintah RAISE/LOWER/RESET |
| **Riwayat Event** | Log terfilter dengan export CSV |

---

## Persyaratan

- **Android:** API 21+ (Android 5.0 Lollipop)
- **Bluetooth:** BLE (Bluetooth 4.0+)
- **Tools:** Android Studio Hedgehog (2023.1.1) atau lebih baru
- **Java:** JDK 8+

---

## Cara Build & Install

### 1. Buka Project di Android Studio

```
File → Open → pilih folder: mobile/android/
```

### 2. Sync Gradle

Android Studio akan otomatis sync. Tunggu hingga selesai.

### 3. Build APK

```
Build → Build Bundle(s)/APK(s) → Build APK(s)
```

APK tersedia di: `app/build/outputs/apk/debug/app-debug.apk`

### 4. Install ke HP Petugas

Aktifkan **USB Debugging** di HP, lalu:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

Atau share file APK via WhatsApp/email.

---

## Struktur Proyek

```
app/src/main/
├── java/com/bss/parking/fieldapp/
│   ├── BssApplication.java        ← Global state & event log
│   ├── SplashActivity.java        ← Splash screen
│   ├── MainActivity.java          ← Dashboard utama
│   ├── ScanActivity.java          ← BLE scanner
│   ├── DeviceControlActivity.java ← Panel kontrol SC1240
│   ├── HistoryActivity.java       ← Riwayat event + CSV export
│   ├── adapter/
│   │   ├── DeviceListAdapter.java ← RecyclerView untuk scan
│   │   └── EventLogAdapter.java   ← RecyclerView untuk history
│   ├── model/
│   │   └── DeviceInfo.java        ← Model BLE device
│   └── sdk/
│       └── SC1240Device.java      ← SDK komunikasi BLE SC1240
├── res/
│   ├── layout/                    ← XML layouts semua screen
│   ├── values/
│   │   ├── colors.xml             ← Palet warna dark theme
│   │   ├── strings.xml            ← String resources
│   │   └── themes.xml             ← App theme & styles
│   └── drawable/                  ← Background drawables
└── AndroidManifest.xml
```

---

## Panduan Penggunaan (Petugas Lapangan)

### Langkah 1 — Scan Perangkat
1. Buka app → tap **🔍 SCAN PERANGKAT BLE**
2. Tunggu daftar kunci parkir muncul
3. Tap nama kunci yang ingin dikontrol

### Langkah 2 — Kontrol Kunci
Setelah terhubung, panel kontrol menampilkan:
- **Status real-time**: posisi palang, kendaraan, baterai, sensor
- **Tombol RAISE (Hijau)**: angkat palang → slot parkir terkunci
- **Tombol LOWER (Merah)**: turunkan palang → slot parkir bebas
- **Tombol RESET**: restart perangkat jika ada masalah

### Langkah 3 — Pantau Log
- Tap **📋 Riwayat Event** untuk melihat semua aktivitas
- Filter berdasarkan: Perintah / Error / Koneksi
- Ekspor ke CSV via menu (⋮)

---

## Kode Perintah SC1240

| Perintah | Hex Opcode | Fungsi |
|---|---|---|
| RAISE_LOCK | `0x0234` | Angkat palang |
| LOWER_LOCK | `0x0235` | Turunkan palang |
| RESET_DEVICE | `0x0233` | Reset perangkat |
| GET_STATUS | `0x0236` | Baca status telemetri |

---

## Izin Aplikasi

| Izin | Kegunaan |
|---|---|
| `BLUETOOTH_SCAN` | Scan perangkat BLE |
| `BLUETOOTH_CONNECT` | Koneksi ke SC1240 |
| `ACCESS_FINE_LOCATION` | Diperlukan Android < 12 untuk BLE scan |

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Perangkat tidak terdeteksi | Aktifkan Bluetooth + Location di HP |
| Koneksi gagal | Dekatkan HP ke kunci (< 5 meter) |
| Perintah timeout | Tap RESET atau reconect ulang |
| Baterai kritis | Hubungi teknisi untuk penggantian baterai |

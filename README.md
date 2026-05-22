# BSS Parking Smart Lock SC1240
# Panduan Instalasi & Setup Lengkap

**Versi SDK:** 1.0.0 | **Hardware:** SC1240 Parking Smart Lock
**Tanggal:** 2026-05-22 | **Dukungan:** Firmware C/C++ - Node.js - Swift - Java/Android - Payment Backend

---

## Daftar Isi

1. [Gambaran Arsitektur](#1-gambaran-arsitektur)
2. [Prasyarat Sistem](#2-prasyarat-sistem)
3. [Struktur Project](#3-struktur-project)
4. [Track A: Firmware Embedded C/C++](#track-a-firmware-embedded-cc)
5. [Track B: Node.js SDK Backend / Gateway](#track-b-nodejs-sdk-backend--gateway)
6. [Track C: iOS SDK Swift](#track-c-ios-sdk-swift)
7. [Track D: Android SDK Java](#track-d-android-sdk-java)
8. [Track E: Payment Backend](#track-e-payment-backend)
9. [Menjalankan Demo Lengkap](#9-menjalankan-demo-lengkap)
10. [Konfigurasi Environment Variables](#10-konfigurasi-environment-variables)
11. [Koneksi Hardware Fisik](#11-koneksi-hardware-fisik)
12. [Troubleshooting](#12-troubleshooting)
13. [Checklist Produksi](#13-checklist-produksi)

---

## 1. Gambaran Arsitektur

```
LAYER APLIKASI
  Mobile App (iOS/Android)   Dashboard Admin (Web)
       REST API                    REST API
LAYER BACKEND
  Payment API Server (Node.js + Express)
  /checkout   /webhook   /admin/*
  StateMachine - RetryQueue - PaymentGateway Service
LAYER SDK
  SC1240 SDK (Node.js / Swift / Java)
  Protocol - Events - Power - OTA
LAYER GATEWAY
  BLE Gateway (Raspberry Pi / PC)
  @abandonware/noble - Agent HTTP Server
LAYER HARDWARE
  SC1240 IoT Lock - Firmware (Embedded C/C++)
  Comm - Telemetry - Sensor Fusion - Power/OTA
```

---

## 2. Prasyarat Sistem

### 2.1 Kebutuhan Minimum

| Komponen | Versi Minimum | Catatan |
|----------|--------------|---------|
| **Node.js** | >= 18.0.0 | LTS direkomendasikan (v24.16.0 tested) |
| **npm** | >= 9.0.0 | Bundled dengan Node.js |
| **GCC ARM** | >= 12.0 | Untuk kompilasi firmware C/C++ |
| **CMake** | >= 3.20 | Build system firmware |
| **Python** | >= 3.8 | Skrip OTA dan utilitas |
| **Git** | >= 2.30 | Version control |
| **MongoDB** | >= 6.0 | Untuk payment backend (opsional: ada mock mode) |

### 2.2 Platform yang Didukung

| Platform | Status | Catatan |
|----------|--------|---------|
| Windows 10/11 | Supported | Node.js SDK + Payment Backend |
| macOS 13+ | Supported | Semua track |
| Ubuntu 22.04+ | Supported | Semua track |
| Raspberry Pi OS | Supported | BLE Gateway (Node.js) |
| iOS 14+ | Supported | Swift SDK |
| Android API 26+ | Supported | Java SDK |

---

## 3. Struktur Project

```
bss-sc1240-sdk/
|
|-- firmware/                      Track A: Embedded Firmware (C/C++)
|   |-- include/
|   |   |-- sc1240_protocol.h      Protocol frame, opcodes, error codes
|   |   |-- sc1240_comm.h          Communication module API
|   |   |-- sc1240_telemetry.h     Event listener & error handler
|   |   |-- sc1240_sensor_fusion.h Tri-modal detection algorithm
|   |   +-- sc1240_power_ota.h     Power management & OTA update
|   +-- src/
|       |-- sc1240_comm.c          Ring buffer, retry, checksum
|       |-- sc1240_telemetry.c     Delta detection, event dispatch
|       |-- sc1240_sensor_fusion.c 2-of-3 voting, IIR filter
|       +-- sc1240_power_ota.c     LUT baterai, dual-bank OTA
|
|-- sdk/                           Track B/C/D: Multi-Platform SDK
|   |-- nodejs/                    Track B: Node.js (Backend/Gateway)
|   |   |-- index.js               Entry point
|   |   |-- package.json
|   |   +-- lib/
|   |       |-- constants.js       Konstanta protokol
|   |       |-- SC1240Protocol.js  Frame builder & parser
|   |       |-- SC1240Events.js    EventEmitter + delta detection
|   |       |-- SC1240Power.js     getBatteryStatus()
|   |       |-- SC1240OTA.js       OTA streamer (CRC-16/CRC-32)
|   |       +-- SC1240Device.js    High-level device facade
|   |-- swift/
|   |   +-- SC1240SDK.swift        Track C: iOS/macOS (CoreBluetooth)
|   +-- java/
|       +-- SC1240Device.java      Track D: Android (GATT + RxJava 3)
|
|-- payment/                       Track E: Payment Backend
|   |-- server_mock.js             Server tanpa database (demo/dev)
|   |-- server.js                  Server produksi (butuh MongoDB)
|   |-- package.json
|   |-- routes/payment.routes.js
|   |-- controllers/
|   |   |-- checkout.controller.js POST /checkout, QRIS generator
|   |   |-- webhook.controller.js  POST /webhook, payment listener
|   |   +-- admin.controller.js    Force-open, transaction list
|   |-- services/
|   |   |-- paymentGateway.service.js  Midtrans/Xendit/Dana
|   |   |-- stateMachine.service.js    9-state machine
|   |   |-- hardware.service.js        Bridge ke SC1240 SDK
|   |   |-- retryQueue.service.js      Exponential backoff retry
|   |   +-- alert.service.js           Telegram/Slack alerts
|   |-- adapters/
|   |   |-- midtrans.adapter.js    SHA-512 signature + normalisasi
|   |   |-- xendit.adapter.js      HMAC token verification
|   |   +-- dana.adapter.js        RSA-SHA256 signature
|   |-- models/ParkingTransaction.js   MongoDB schema
|   +-- utils/feeCalculator.js         Kalkulasi tarif parkir
|
+-- demo/
    +-- run_demo.js                Demo end-to-end standalone
```

---

## Track A: Firmware Embedded C/C++

> Untuk siapa: Embedded engineer yang mengembangkan/memodifikasi firmware SC1240

### A.1 Install Toolchain

#### Windows

```powershell
# 1. Install ARM GCC via winget
winget install Arm.GnuArmEmbeddedToolchain

# 2. Install CMake
winget install Kitware.CMake

# 3. Install Make
winget install GnuWin32.Make

# 4. Install CH340 USB-Serial driver
# Download: https://www.wch.cn/downloads/CH341SER_EXE.html
# Jalankan CH341SER.EXE dan klik Install

# 5. Verifikasi (buka terminal BARU setelah install)
arm-none-eabi-gcc --version
cmake --version
```

#### macOS

```bash
brew install --cask gcc-arm-embedded
brew install cmake
```

#### Ubuntu / Debian / Raspberry Pi OS

```bash
sudo apt update
sudo apt install -y gcc-arm-none-eabi cmake make binutils-arm-none-eabi

# Verifikasi
arm-none-eabi-gcc --version
cmake --version
```

### A.2 Buat CMakeLists.txt

Buat file `firmware/CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.20)

set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR ARM)
set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_OBJCOPY arm-none-eabi-objcopy)

project(sc1240_firmware C)
set(CMAKE_C_STANDARD 11)

add_compile_options(
    -mcpu=cortex-m4
    -mthumb
    -mfpu=fpv4-sp-d16
    -mfloat-abi=hard
    -O2 -Wall -Wextra
    -ffunction-sections -fdata-sections
)

set(SOURCES
    src/sc1240_comm.c
    src/sc1240_telemetry.c
    src/sc1240_sensor_fusion.c
    src/sc1240_power_ota.c
)

include_directories(include)
add_library(sc1240_fw STATIC ${SOURCES})
```

### A.3 Kompilasi Firmware

```bash
cd bss-sc1240-sdk/firmware
mkdir build && cd build

# Windows
cmake .. -G "MinGW Makefiles"
# Linux / macOS
cmake .. -G "Unix Makefiles"

# Build
make -j4
# Output: build/libsc1240_fw.a
```

### A.4 Flash ke Hardware via USB-Serial CH340

```bash
# 1. Sambungkan kabel USB-SERIAL CH340 ke SC1240
# 2. Cari COM port:
#    Windows: Device Manager > Ports > COM?
#    Linux  : ls /dev/ttyUSB*
#    macOS  : ls /dev/cu.usbserial*

# 3. Flash (ganti /dev/ttyUSB0 sesuai port Anda):
stm32flash -w firmware.bin -v -g 0x0 /dev/ttyUSB0

# Windows (ganti COM3 sesuai port Anda):
stm32flash -w firmware.bin -v -g 0x0 COM3
```

### A.5 Verifikasi via Serial Monitor

```
Port   : sesuai deteksi
Baud   : 115200
Data   : 8 bit
Stop   : 1 bit
Parity : None
```

Program: PuTTY (Windows), minicom (Linux/macOS), Tera Term (Windows)

Output yang diharapkan saat boot:
```
[SC1240] Firmware v1.0.0 booting...
[SC1240] Bank A active
[SC1240] Sensor fusion: GEOMAG_ONLY mode (200uA standby)
[SC1240] BLE advertising: SC1240-A01
[SC1240] Ready.
```

---

## Track B: Node.js SDK Backend / Gateway

> Untuk siapa: Backend developer, developer gateway Raspberry Pi

### B.1 Install Node.js

**Windows:**

```powershell
winget install OpenJS.NodeJS.LTS

# Verifikasi (buka terminal BARU)
node --version
npm --version
```

**macOS:**

```bash
brew install node@20
```

**Ubuntu / Raspberry Pi OS:**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### B.2 Install Dependensi SDK

```bash
cd bss-sc1240-sdk/sdk/nodejs
npm install
```

### B.3 Quick Start: Node.js SDK

```javascript
// my_parking_app.js
const { SC1240Device } = require('./sdk/nodejs');

// Implementasikan transport sesuai BLE library Anda
const transport = {
    write:  async (buffer)   => { /* kirim ke BLE characteristic FFE1 */ },
    onData: (callback) => { /* daftarkan listener dari BLE */ }
};

const device = new SC1240Device({ transport });

device.on('vehicleDetected', async ({ batteryPercent }) => {
    console.log('Kendaraan terdeteksi. Baterai:', batteryPercent + '%');
    await device.raiseLock();
});
device.on('lockRaised',  () => console.log('Palang terangkat'));
device.on('lockLowered', () => console.log('Palang turun'));
device.on('batteryLow',  () => console.warn('Baterai lemah!'));
device.on('error',  (e)  => console.error('[' + e.code + '] ' + e.message));

async function main() {
    await device.connect();
    const battery = await device.getBatteryStatus();
    console.log('Baterai:', battery.percent + '% [' + battery.status + ']');
}
main();
```

### B.4 Install BLE Transport untuk Gateway Fisik

```bash
# Install noble untuk BLE di Raspberry Pi / Linux
npm install @abandonware/noble

# Dependensi sistem:
sudo apt install -y bluetooth bluez libbluetooth-dev libudev-dev

# Jalankan dengan hak akses BLE:
sudo node my_parking_app.js

# Atau tanpa sudo (Ubuntu):
sudo setcap cap_net_raw+eip $(which node)
node my_parking_app.js
```

### B.5 Jalankan Demo SDK (Tanpa Hardware)

```bash
# Windows
"C:\Program Files\nodejs\node.exe" demo/run_demo.js

# Linux / macOS
node demo/run_demo.js
```

---

## Track C: iOS SDK Swift

> Untuk siapa: iOS developer

### C.1 Persyaratan

- macOS 13 atau lebih baru
- Xcode 15 atau lebih baru
- iOS Deployment Target >= 14.0

### C.2 Tambahkan SDK ke Project Xcode

**Opsi 1: Swift Package Manager (direkomendasikan)**

Di Xcode: File > Add Package Dependencies > masukkan URL repository

**Opsi 2: Salin File Manual**

```bash
cp sdk/swift/SC1240SDK.swift YourApp/
# Tambahkan file ke Xcode project target
```

### C.3 Konfigurasi Info.plist

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Diperlukan untuk terhubung ke SC1240 Parking Smart Lock</string>

<key>NSBluetoothPeripheralUsageDescription</key>
<string>Diperlukan untuk komunikasi dengan perangkat parkir</string>
```

### C.4 Quick Start: Swift

```swift
import Combine

let sdk = SC1240SDK(peripheralUUID: UUID(uuidString: "DEVICE-UUID-HERE")!)
var cancellables = Set<AnyCancellable>()

sdk.eventPublisher
    .receive(on: DispatchQueue.main)
    .sink { event in
        switch event {
        case .vehicleDetected(let angle, let bat):
            print("Kendaraan terdeteksi, baterai: \(bat)%")
            Task { try? await sdk.raiseLock() }
        case .lockRaised(let angle):
            print("Palang naik \(angle) derajat")
        case .lockLowered:
            print("Palang turun")
        case .error(let code, let msg, let severity, _):
            print("[\(code)] [\(severity)] \(msg)")
        case .batteryLow(let pct):
            print("Baterai lemah: \(pct)%")
        default:
            break
        }
    }
    .store(in: &cancellables)

sdk.connect()

// Cek baterai
Task {
    let bat = try await sdk.getBatteryStatus()
    print("Baterai: \(bat.percent)% [\(bat.statusLabel)]")
}
```

---

## Track D: Android SDK Java

> Untuk siapa: Android developer

### D.1 Persyaratan

- Android Studio Hedgehog (2023.1) atau lebih baru
- Android API Level 26 (Android 8.0) minimum
- Gradle 8.0 atau lebih baru

### D.2 Tambahkan Dependensi ke app/build.gradle

```groovy
dependencies {
    // RxJava 3
    implementation 'io.reactivex.rxjava3:rxjava:3.1.8'
    implementation 'io.reactivex.rxjava3:rxandroid:3.0.2'
}
```

### D.3 Salin SDK dan Konfigurasi Permission

```bash
# Salin file SDK ke project Android
cp sdk/java/SC1240Device.java app/src/main/java/com/yourapp/ble/SC1240Device.java
```

Tambahkan ke `AndroidManifest.xml`:

```xml
<!-- BLE Permissions (Android 12+) -->
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<!-- BLE feature requirement -->
<uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />
```

### D.4 Quick Start: Java Android

```java
// Di dalam Activity / Fragment Anda
SC1240Device device = new SC1240Device(this, "AA:BB:CC:DD:EE:FF");

// Deteksi kendaraan -> angkat palang
device.onVehicleDetected()
    .observeOn(AndroidSchedulers.mainThread())
    .subscribe(event -> {
        Log.d("BSS", "Kendaraan terdeteksi! Baterai: " + event.telemetry.batteryPercent + "%");
        device.raiseLock()
              .observeOn(AndroidSchedulers.mainThread())
              .subscribe(
                  t   -> Log.d("BSS", "Palang naik: " + t.baffleAngleDeg + " derajat"),
                  err -> Log.e("BSS", "Error: " + err.getMessage())
              );
    });

// Error events
device.onError()
    .observeOn(AndroidSchedulers.mainThread())
    .subscribe(e -> Log.e("BSS", "[" + e.errorCode + "] " + e.message));

// Status baterai
device.getBatteryStatus()
    .observeOn(AndroidSchedulers.mainThread())
    .subscribe(bat -> Log.d("BSS", "Baterai: " + bat.percent + "% [" + bat.statusLabel + "]"));

// Hubungkan
device.connect();
```

> [!NOTE]
> Jangan lupa request runtime permission BLUETOOTH_CONNECT dan BLUETOOTH_SCAN
> di Android 12+ (API 31+) sebelum memanggil connect().

---

## Track E: Payment Backend

> Untuk siapa: Backend developer integrasi pembayaran QRIS

### E.1 Install Dependensi

```bash
cd bss-sc1240-sdk/payment
npm install
```

Output yang diharapkan:
```
added 395 packages, and audited 396 packages in 35s
```

### E.2 Mode Development: Server Mock (Tanpa MongoDB)

Cara termudah untuk mulai development dan testing:

```bash
# Windows
"C:\Program Files\nodejs\node.exe" payment/server_mock.js

# Linux / macOS
node payment/server_mock.js
```

Server berjalan di `http://localhost:3000` tanpa konfigurasi tambahan.

### E.3 Mode Produksi: Server dengan MongoDB

```bash
# 1. Install MongoDB
#    Windows:
winget install MongoDB.Server
net start MongoDB

#    Ubuntu:
sudo apt install -y mongodb
sudo systemctl start mongod

# 2. Buat file environment
copy payment\.env.example payment\.env    # Windows
cp payment/.env.example payment/.env      # Linux/macOS

# 3. Edit .env (lihat Bagian 10 untuk semua variabel)

# 4. Jalankan server
"C:\Program Files\nodejs\node.exe" payment/server.js
```

### E.4 Konfigurasi Gateway Pembayaran

File `.env` (wajib dikonfigurasi sebelum go-live):

```env
PORT=3000
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/bss_parking

# Pilih salah satu: midtrans / xendit / dana
PAYMENT_GATEWAY=midtrans

# Midtrans (jika PAYMENT_GATEWAY=midtrans)
MIDTRANS_SERVER_KEY=SB-Mid-server-XXXXXXXXXXXXXXXX
MIDTRANS_BASE_URL=https://api.sandbox.midtrans.com/v2

# Xendit (jika PAYMENT_GATEWAY=xendit)
XENDIT_SECRET_KEY=xnd_production_XXXXXXXX
XENDIT_WEBHOOK_TOKEN=your-webhook-token

# Dana (jika PAYMENT_GATEWAY=dana)
DANA_MERCHANT_ID=YOUR_MERCHANT_ID
DANA_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...

# BLE Gateway
BLE_AGENT_TOKEN=ganti-dengan-token-rahasia
AGENT_A01_URL=http://192.168.1.101:8080
AGENT_A02_URL=http://192.168.1.102:8080

# Alert Admin
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
TELEGRAM_CHAT_ID=-1001234567890
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

### E.5 Test Endpoint API

```bash
# Health check
curl http://localhost:3000/health

# Buat QRIS checkout
curl -X POST http://localhost:3000/api/v1/parking/checkout \
  -H "Content-Type: application/json" \
  -d '{"lock_id":"SC1240-A01","entry_time":"2026-05-22T08:30:00+08:00","plate":"B 1234 XYZ"}'

# Simulasi pembayaran berhasil (simpan transaction_id dari response checkout)
curl -X POST http://localhost:3000/api/v1/demo/simulate-webhook \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"TXN-XXXX-XXXXXXXX","status":"settlement"}'

# Lihat semua transaksi
curl http://localhost:3000/api/v1/admin/transactions

# Lihat status device
curl http://localhost:3000/api/v1/admin/devices

# Toggle device offline untuk test retry
curl -X PATCH http://localhost:3000/api/v1/admin/devices/SC1240-A01 \
  -H "Content-Type: application/json" \
  -d '{"online":false}'

# Admin force-open setelah hardware offline
curl -X POST http://localhost:3000/api/v1/admin/locks/SC1240-A01/force-open \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"TXN-XXXX-XXXXXXXX"}'
```

---

## 9. Menjalankan Demo Lengkap

### Demo CLI Standalone (Tidak Butuh Database atau Hardware Fisik)

Demo ini menjalankan seluruh sistem secara simulasi dalam satu proses Node.js.
Tidak ada instalasi eksternal yang diperlukan selain Node.js.

```bash
# Windows
"C:\Program Files\nodejs\node.exe" demo/run_demo.js

# Linux / macOS
node demo/run_demo.js
```

Demo menjalankan 5 skenario secara berurutan:

```
DEMO 1: IoT SDK   - BLE Connect + Sensor Fusion + Error Events
DEMO 2: Payment   - QRIS Generator + Webhook + Auto Lower Lock
DEMO 3: Expired   - QRIS Kadaluarsa + Refresh Flow
DEMO 4: Offline   - Hardware Offline + Retry Queue + Force-Open
DEMO 5: Security  - Double Payment Prevention (Idempotency Guard)
```

### Demo Server HTTP (Interaktif)

```bash
# Terminal 1: jalankan server
"C:\Program Files\nodejs\node.exe" payment/server_mock.js

# Terminal 2: test dengan curl atau Postman
curl http://localhost:3000/health
```

Semua endpoint tersedia tanpa konfigurasi tambahan dalam mock mode.

---

## 10. Konfigurasi Environment Variables

| Variable | Default | Keterangan |
|----------|---------|-----------|
| `PORT` | `3000` | Port HTTP server |
| `NODE_ENV` | `development` | `development` atau `production` |
| `MONGODB_URI` | (tidak ada) | URI koneksi MongoDB |
| `PAYMENT_GATEWAY` | `midtrans` | `midtrans`, `xendit`, atau `dana` |
| `MIDTRANS_SERVER_KEY` | (tidak ada) | Server key Midtrans |
| `MIDTRANS_BASE_URL` | sandbox URL | Ganti ke production saat go-live |
| `XENDIT_SECRET_KEY` | (tidak ada) | Secret key Xendit |
| `XENDIT_WEBHOOK_TOKEN` | (tidak ada) | Token webhook Xendit |
| `DANA_MERCHANT_ID` | (tidak ada) | Merchant ID Dana |
| `DANA_PRIVATE_KEY` | (tidak ada) | RSA private key Dana (format PEM) |
| `BLE_AGENT_TOKEN` | `changeme` | Token autentikasi BLE gateway agent |
| `AGENT_A01_URL` | `http://192.168.1.101:8080` | URL HTTP agent untuk SC1240-A01 |
| `AGENT_A02_URL` | `http://192.168.1.102:8080` | URL HTTP agent untuk SC1240-A02 |
| `TELEGRAM_BOT_TOKEN` | (tidak ada) | Token Telegram Bot untuk alert |
| `TELEGRAM_CHAT_ID` | (tidak ada) | Chat ID tujuan alert admin |
| `SLACK_WEBHOOK_URL` | (tidak ada) | Slack incoming webhook URL |

---

## 11. Koneksi Hardware Fisik

### USB-Serial CH340: Flash Firmware

```
PC / Laptop
    |
[USB]
    |
[CH340 Module]
    |-- TX  ----->  RX  SC1240 MCU
    |-- RX  <-----  TX  SC1240 MCU
    |-- GND ------  GND SC1240 MCU
    +-- 3.3V ----->  VCC SC1240 MCU   (JANGAN gunakan 5V langsung)
```

> [!CAUTION]
> Perangkat SC1240 beroperasi pada tegangan 3.3V untuk antarmuka serial.
> Menggunakan 5V dapat merusak MCU secara permanen.

### BLE: Koneksi SDK ke Hardware

```
BLE Service UUID  : 0000FFE0-0000-1000-8000-00805F9B34FB
TX Characteristic : 0000FFE1-0000-1000-8000-00805F9B34FB  (Write)
RX Characteristic : 0000FFE2-0000-1000-8000-00805F9B34FB  (Notify)
Device Name       : SC1240-A01 (sesuai konfigurasi)
Jangkauan BLE     : maksimal 10 meter tanpa penghalang
```

### Pinout MCU SC1240

| Pin MCU | Tipe | Terhubung ke |
|---------|------|-------------|
| PA0, PA1 | I2C | Sensor Geomagnetic (QMC5883L) |
| PB0, PB1 | UART | Radar Microwave (LD1115H) |
| PC0 | GPIO INPUT | Sensor IR (active LOW) |
| PD0, PD1 | PWM OUTPUT | Motor Driver Palang |
| PE0 | ADC INPUT | Monitor Tegangan Baterai |
| PE1 | ADC INPUT | Sensor Sudut (AS5600) |
| PA8 | GPIO INPUT | Deteksi Charging Panel Surya |

### Arsitektur Daya

```
Panel Surya (12V)
    |
[Solar Charge Controller]
    |
[Baterai Lead-Acid 7AH/12V]
    |
[Buck Converter 3.3V]
    |
MCU SC1240 (standby: 200-300 uA)
```

---

## 12. Troubleshooting

| # | Gejala / Error | Kemungkinan Penyebab | Solusi |
|---|----------------|---------------------|--------|
| 1 | `arm-none-eabi-gcc: command not found` | Toolchain belum install atau PATH belum diperbarui | Jalankan install command, lalu buka terminal baru |
| 2 | `node: command not found` | PATH Node.js belum diperbarui | Buka terminal baru, atau gunakan path penuh `C:\Program Files\nodejs\node.exe` |
| 3 | `EACCES permission denied` saat BLE | Noble membutuhkan raw socket access | `sudo node app.js` atau `sudo setcap cap_net_raw+eip $(which node)` |
| 4 | `Cannot find module 'eventemitter3'` | npm install belum dijalankan | Jalankan `npm install` di folder sdk/nodejs |
| 5 | `MongoServerError: connect ECONNREFUSED` | MongoDB tidak berjalan | `net start MongoDB` (Windows) atau `sudo systemctl start mongod` |
| 6 | `Webhook signature mismatch` | Body JSON di-parse sebelum HMAC dihitung | Gunakan `express.raw()` bukan `express.json()` untuk route webhook |
| 7 | QRIS tidak bisa dipindai oleh aplikasi payment | Format QRIS string tidak valid | Pastikan `qris_string` dimulai dengan `000201` (standar EMVCo) |
| 8 | Palang tidak turun setelah pembayaran berhasil | BLE gateway offline atau SC1240 tidak terjangkau | Cek status di `/api/v1/admin/transactions`, lihat kolom `hardware_error` |
| 9 | `CMake Error: No CMAKE_C_COMPILER` | ARM GCC tidak ditemukan di PATH | Pastikan `arm-none-eabi-gcc` ada di PATH sebelum menjalankan cmake |
| 10 | OTA update gagal di tengah proses | Baterai habis atau koneksi BLE terputus | Pastikan baterai >= 25% sebelum OTA. Firmware secara otomatis memblok OTA jika baterai rendah |

---

## 13. Checklist Produksi

> [!CAUTION]
> Semua item wajib diselesaikan sebelum deploy ke lingkungan produksi.
> Kegagalan pada item security dapat menyebabkan kebocoran data atau eksploitasi sistem.

### Security

- [ ] Ganti semua nilai `changeme` di file `.env` dengan secret yang kuat
- [ ] Aktifkan HTTPS dengan TLS 1.2 atau lebih baru di semua endpoint publik
- [ ] Verifikasi signature webhook berfungsi untuk setiap gateway yang aktif
- [ ] Set `NODE_ENV=production`
- [ ] Simpan semua secret key di secret manager (AWS Secrets Manager, HashiCorp Vault, dll.)
- [ ] Aktifkan rate limiting pada endpoint checkout (10 request per menit per lock_id)
- [ ] Ganti `BLE_AGENT_TOKEN` dengan token panjang yang di-generate secara acak

### Database

- [ ] Aktifkan autentikasi MongoDB dengan username dan password
- [ ] Aktifkan MongoDB replica set untuk high availability
- [ ] Konfigurasi backup otomatis harian
- [ ] Verifikasi TTL index berjalan untuk menghapus transaksi lama (90 hari)

### Hardware

- [ ] Flash firmware versi terbaru ke semua unit SC1240
- [ ] Test koneksi BLE dari setiap gateway ke setiap lock yang terdaftar
- [ ] Kalibrasi sensor geomagnetic setelah instalasi fisik di lokasi parkir
- [ ] Verifikasi panel surya dan baterai terhubung dan terisi dengan benar

### Payment Gateway

- [ ] Ganti URL base ke lingkungan Production (bukan Sandbox)
- [ ] Daftarkan URL webhook produksi di dashboard Payment Gateway
- [ ] Lakukan test end-to-end dengan nominal terkecil yang diizinkan
- [ ] Verifikasi alert Telegram atau Slack diterima oleh admin

### Monitoring

- [ ] Konfigurasi uptime monitoring pada endpoint `/health` (UptimeRobot, Datadog, dll.)
- [ ] Konfigurasi log aggregation (ELK Stack, CloudWatch, Grafana Loki, dll.)
- [ ] Test skenario hardware offline secara manual dan verifikasi admin menerima notifikasi
- [ ] Dokumentasikan prosedur force-open untuk petugas lapangan

---

## Ringkasan Perintah Cepat

```bash
# Jalankan demo standalone (tidak butuh database atau hardware)
"C:\Program Files\nodejs\node.exe" demo/run_demo.js

# Jalankan payment server mock (tidak butuh MongoDB)
"C:\Program Files\nodejs\node.exe" payment/server_mock.js

# Install dependensi Node.js SDK
cd sdk/nodejs && npm install

# Install dependensi Payment Backend
cd payment && npm install

# Kompilasi firmware (butuh ARM GCC + CMake)
cd firmware
mkdir build && cd build
cmake .. -G "MinGW Makefiles"
make -j4

# Health check server
curl http://localhost:3000/health

# Lihat semua transaksi
curl http://localhost:3000/api/v1/admin/transactions

# Lihat status device
curl http://localhost:3000/api/v1/admin/devices
```

---

Dokumentasi ini dibuat untuk BSS SC1240 SDK v1.0.0

Referensi lanjutan:
- API_REFERENCE.md: Spesifikasi frame protokol, error codes, checksum
- PAYMENT_MODULE.md: Sequence diagram, JSON payload, state machine

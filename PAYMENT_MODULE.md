# BSS SC1240 — Payment Integration Module
## API Reference & Sequence Diagrams

**Version:** 1.0.0 | **Date:** 2026-05-22  
**Stack:** Node.js + Express + MongoDB + BLE Gateway

---

## 1. API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/v1/parking/checkout` | API Key | Generate dynamic QRIS for vehicle exit |
| `GET`  | `/api/v1/parking/checkout/:transaction_id` | API Key | Poll transaction status |
| `POST` | `/api/v1/parking/checkout/:transaction_id/refresh` | API Key | Re-generate expired QRIS |
| `POST` | `/api/v1/payments/webhook` | Signature (internal) | Payment Gateway callback |
| `POST` | `/api/v1/admin/locks/:lock_id/force-open` | Admin JWT | Manual barrier override |
| `GET`  | `/api/v1/admin/transactions` | Admin JWT | Transaction dashboard |

---

## 2. Sequence Diagrams

### 2.1 — Happy Path: QRIS Scan & Automatic Barrier Lowering

```mermaid
sequenceDiagram
    autonumber
    actor User as User-ExitTerminal
    participant App as MobileApp-Terminal
    participant BE as Backend-Nodejs
    participant DB as MongoDB
    participant PG as PaymentGateway
    participant GW as BLE-Gateway-RPi
    participant HW as SC1240-IoT-Lock

    User->>App: Siap keluar parkir
    App->>BE: POST /api/v1/parking/checkout lock_id+entry_time+plate
    BE->>DB: Check PENDING transaction for lock_id
    DB-->>BE: null - no active transaction
    BE->>BE: calculateParkingFee duration=65min
    Note over BE: duration=65min => IDR 8000
    BE->>PG: POST /charge order_id+amount+qris+expiry15min
    PG-->>BE: qr_string + transaction_id MID-xxx
    BE->>DB: INSERT ParkingTransaction status=QRIS_GENERATED expires_at=+15min
    DB-->>BE: OK
    BE-->>App: 200 OK qris_string+qris_url+amount_idr=8000+expires_at
    App->>User: Tampilkan QRIS di layar terminal
    User->>PG: Scan dan bayar IDR 8000 via GoPay/OVO/Dana
    PG-->>BE: POST /api/v1/payments/webhook order_id+settlement+gross=8000
    Note over BE: 1-Verify SHA512 signature
    Note over BE: 2-Idempotency check not PAID yet
    Note over BE: 3-Validate amount >= expected
    BE->>DB: UPDATE status QRIS_GENERATED=>PAID paid_at+pg_reference
    DB-->>BE: OK
    BE->>GW: POST /command lock_id=SC1240-A01 command=LOWER_LOCK
    GW->>HW: BLE Write 12345678EB90FFFFFFFF0235
    HW-->>GW: Telemetry ACK lock_state=LOWERED
    GW-->>BE: 200 OK
    BE->>DB: UPDATE status PAID=>LOCK_LOWERED lock_lowered_at=now
    HW->>User: Palang turun - kendaraan dapat keluar
```

---

### 2.2 — QRIS Expired: Refresh Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant App as App-Terminal
    participant BE as Backend
    participant DB as MongoDB
    participant PG as PaymentGateway

    User->>App: Coba scan QRIS sudah lebih 15 menit
    Note over App: QRIS expired di sisi Payment App
    App->>BE: GET /api/v1/parking/checkout/TXN-001
    BE->>DB: Find transaction
    DB-->>BE: status=EXPIRED expires_at=past
    BE-->>App: status=EXPIRED
    App->>User: QRIS kadaluarsa - membuat ulang
    App->>BE: POST /api/v1/parking/checkout/TXN-001/refresh
    BE->>BE: Recalculate fee dengan waktu terkini
    Note over BE: Durasi bertambah => amount baru
    BE->>PG: POST /charge same_txn_id + new_amount
    PG-->>BE: qr_string=NEW
    BE->>DB: UPDATE status=QRIS_GENERATED qris_string=new expires_at=+15min refresh_count+1
    DB-->>BE: OK
    BE-->>App: 200 OK new_qris + updated_amount
    App->>User: QRIS baru ditampilkan
```

---

### 2.3 — Hardware Offline: Retry & Force-Open

```mermaid
sequenceDiagram
    autonumber
    actor User as User-Waiting
    participant PG as PaymentGateway
    participant BE as Backend
    participant DB as MongoDB
    participant RQ as RetryQueue
    participant GW as BLE-Gateway
    participant HW as SC1240-Lock
    participant Admin as AdminDashboard

    PG->>BE: Webhook status=settlement
    BE->>DB: UPDATE status=>PAID
    BE->>GW: POST /command LOWER_LOCK
    GW--xHW: Device offline - BLE disconnected
    GW-->>BE: HTTP 503 timeout
    BE->>DB: UPDATE status=>HARDWARE_PENDING hardware_error=Device-unreachable
    BE->>RQ: enqueue LOWER_LOCK lock_id max_retries=20
    Note over User: Palang tidak turun - user menunggu

    loop Exponential backoff 30s to 300s
        RQ->>GW: Retry POST /command LOWER_LOCK
        GW--xHW: Masih offline
        RQ->>RQ: attempt++
    end

    Note over RQ: Setelah 20 retries sekitar 10 menit
    RQ->>DB: UPDATE status=>MANUAL_NEEDED
    RQ->>Admin: Alert Telegram/Slack Lock-SC1240-A01 tidak bisa dibuka TXN-xxx sudah lunas

    Admin->>BE: POST /api/v1/admin/locks/SC1240-A01/force-open transaction_id
    BE->>GW: POST /command LOWER_LOCK
    GW->>HW: BLE Write 12345678EB90FFFFFFFF0235
    HW-->>GW: ACK OK
    GW-->>BE: 200 OK
    BE->>DB: UPDATE status=>LOCK_LOWERED force_opened_by=admin_001
    BE-->>Admin: success=true hardware_executed=true
    HW->>User: Palang turun - kendaraan keluar
```

---

### 2.4 — Double Payment Prevention

```mermaid
sequenceDiagram
    autonumber
    participant PG as PaymentGateway
    participant BE as Backend
    participant DB as MongoDB
    participant HW as SC1240-Lock

    Note over PG,BE: Skenario PG mengirim webhook dua kali karena network retry

    PG->>BE: Webhook-1 order_id=TXN-001 status=settlement
    BE->>DB: SELECT status WHERE transaction_id=TXN-001
    DB-->>BE: status=QRIS_GENERATED - dapat diproses
    BE->>DB: UPDATE status=>PAID optimistic-lock WHERE-status=QRIS_GENERATED
    DB-->>BE: 1 row updated
    BE->>HW: lowerLock palang turun
    BE->>DB: UPDATE status=>LOCK_LOWERED

    Note over PG,BE: Beberapa detik kemudian webhook duplikat

    PG->>BE: Webhook-2 order_id=TXN-001 status=settlement duplikat
    BE->>DB: SELECT status WHERE transaction_id=TXN-001
    DB-->>BE: status=LOCK_LOWERED - terminal state
    Note over BE: Idempotency check status dalam PAID/LOCK_LOWERED/COMPLETED => SKIP
    BE-->>PG: 200 OK no action taken no double trigger
    Note over HW: Palang tidak diturunkan dua kali
```

---

## 3. JSON Payload Examples

### 3.1 — Checkout Request

```json
{
  "method":  "POST",
  "url":     "/api/v1/parking/checkout",
  "headers": {
    "Authorization": "ApiKey bss-api-key-prod-xxxx",
    "Content-Type":  "application/json"
  },
  "body": {
    "lock_id":    "SC1240-A01",
    "entry_time": "2026-05-22T08:30:00+08:00",
    "plate":      "B 1234 XYZ"
  }
}
```

### 3.2 — Checkout Response (Success)

```json
{
  "status": 200,
  "body": {
    "transaction_id": "TXN-1748345612345-A9F3B2C1",
    "qris_string":    "00020101021226590016ID.CO.MIDTRANS.WWW01189360089804570000001224052205300",
    "qris_url":       "https://api.midtrans.com/v2/qris/img/TXN-1748345612345-A9F3B2C1.png",
    "amount_idr":     8000,
    "duration_min":   65,
    "expires_at":     "2026-05-22T09:55:12+08:00",
    "status":         "QRIS_GENERATED"
  }
}
```

### 3.3 — Checkout Response: Duplicate Active QRIS

```json
{
  "status": 200,
  "body": {
    "transaction_id": "TXN-1748345612345-A9F3B2C1",
    "qris_string":    "00020101...",
    "amount_idr":     8000,
    "expires_at":     "2026-05-22T09:55:12+08:00",
    "status":         "QRIS_GENERATED",
    "message":        "Existing active QRIS returned."
  }
}
```

### 3.4 — Checkout Error: Conflict

```json
{
  "status":  409,
  "body": {
    "error":   "CONFLICT",
    "message": "Active transaction already exists for lock SC1240-A01",
    "hint":    "Use GET /api/v1/parking/checkout/{transaction_id} to retrieve existing QRIS"
  }
}
```

---

### 3.5 — Midtrans Webhook (Settlement)

> Signature embedded in body: `SHA512(order_id + status_code + gross_amount + SERVER_KEY)`

```json
{
  "transaction_time":   "2026-05-22 09:40:15",
  "transaction_status": "settlement",
  "transaction_id":     "MID-txn-abc123def456",
  "status_message":     "midtrans payment notification",
  "status_code":        "200",
  "signature_key":      "<SHA512-hex-of-order_id+status_code+gross_amount+server_key>",
  "settlement_time":    "2026-05-22 09:40:18",
  "payment_type":       "qris",
  "order_id":           "TXN-1748345612345-A9F3B2C1",
  "merchant_id":        "M123456789",
  "gross_amount":       "8000.00",
  "fraud_status":       "accept",
  "currency":           "IDR",
  "acquirer":           "gopay"
}
```

### 3.6 — Xendit Webhook (SUCCEEDED)

> Signature in header: `X-CALLBACK-TOKEN: your-xendit-webhook-token`

```json
{
  "event": "qr.payment",
  "data": {
    "id":           "qr_123abc456def",
    "reference_id": "TXN-1748345612345-A9F3B2C1",
    "business_id":  "600bfb793291ef3a7b6d29fe",
    "type":         "DYNAMIC",
    "currency":     "IDR",
    "amount":       8000,
    "status":       "SUCCEEDED",
    "created":      "2026-05-22T01:40:15.123Z",
    "updated":      "2026-05-22T01:40:18.456Z",
    "payment_detail": {
      "source":     "GOPAY",
      "receipt_id": "GOPAY-xyz-999"
    }
  }
}
```

### 3.7 — Dana Webhook (SUCCESS)

> Signature in header: `dana-signature: <RSA-SHA256-base64>`

```json
{
  "head": {
    "version":  "2.0",
    "function": "dana.acquiring.order.payNotify",
    "reqMsgId": "notify-uuid-xyz",
    "reqTime":  "2026-05-22T09:40:18+08:00"
  },
  "body": {
    "merchantTransId":    "TXN-1748345612345-A9F3B2C1",
    "partnerReferenceNo": "DANA-REF-987654",
    "orderStatus":        "SUCCESS",
    "payTime":            "2026-05-22T09:40:15+08:00",
    "amount": {
      "value":    "800000",
      "currency": "IDR"
    },
    "payerInfo": {
      "maskedPhoneNo": "+62812****5678"
    }
  }
}
```

### 3.8 — Admin Force-Open

```json
{
  "request": {
    "method":  "POST",
    "url":     "/api/v1/admin/locks/SC1240-A01/force-open",
    "headers": { "Authorization": "Bearer eyJhbGciOiJIUzI1NiIs..." },
    "body":    { "transaction_id": "TXN-1748345612345-A9F3B2C1" }
  },
  "response": {
    "status": 200,
    "body": {
      "success":           true,
      "transaction_id":    "TXN-1748345612345-A9F3B2C1",
      "lock_id":           "SC1240-A01",
      "hardware_executed": true,
      "hardware_error":    null,
      "status":            "LOCK_LOWERED",
      "forced_by":         "admin_001",
      "timestamp":         "2026-05-22T09:55:00+08:00",
      "message":           "Lock SC1240-A01 opened successfully."
    }
  }
}
```

---

## 4. Transaction State Machine

```mermaid
stateDiagram-v2
    [*] --> QRIS_GENERATED : POST checkout

    QRIS_GENERATED --> PAID : webhook settlement
    QRIS_GENERATED --> EXPIRED : 15min timeout
    QRIS_GENERATED --> CANCELLED : webhook cancel

    EXPIRED --> QRIS_GENERATED : POST refresh

    PAID --> LOCK_LOWERED : lowerLock OK
    PAID --> HARDWARE_PENDING : lowerLock failed
    PAID --> AMOUNT_MISMATCH : underpayment

    HARDWARE_PENDING --> LOCK_LOWERED : retry success
    HARDWARE_PENDING --> MANUAL_NEEDED : retries exhausted

    MANUAL_NEEDED --> LOCK_LOWERED : admin force-open

    LOCK_LOWERED --> COMPLETED : vehicle departed

    COMPLETED --> [*]
    CANCELLED --> [*]
    AMOUNT_MISMATCH --> [*]
```

---

## 5. Error Handling Matrix

| Scenario | Detection | Response | Recovery |
|----------|-----------|----------|----------|
| QRIS Expired | `expires_at < now` on GET | Return `status: EXPIRED` | `POST /checkout/:id/refresh` |
| Device Offline | `HardwareService` throws | State → `HARDWARE_PENDING` | RetryQueue 30s × 20 retries |
| Retry Exhausted | `attempt >= max_retries` | State → `MANUAL_NEEDED` + Alert | Admin force-open dashboard |
| Double Webhook | `status ∈ [PAID, LOCK_LOWERED]` | Skip silently, return 200 | No action needed |
| Amount Mismatch | `amount_paid < amount_idr` | State → `AMOUNT_MISMATCH` + Log | Manual refund investigation |
| Invalid Signature | HMAC compare fails | Log security event, return 200 | Block IP after N failures |
| PG API Down | `axios.post` throws | Return 503 to client | Client retry with backoff |
| DB Write Conflict | Optimistic lock fails | Throw ConcurrentStateChange | Log + retry idempotent path |

> [!NOTE]
> Always return HTTP 200 to webhook endpoint even on errors. A non-2xx response causes the Payment Gateway
> to retry the webhook, creating potential duplicate-processing attack surface.

---

## 6. Security Checklist

> [!IMPORTANT]
> All items must be implemented before production deployment.

| # | Control | Implementation |
|---|---------|----------------|
| 1 | Webhook Signature | SHA-512 (Midtrans), HMAC token (Xendit), RSA-SHA256 (Dana) |
| 2 | Timing-Safe Compare | `crypto.timingSafeEqual()` prevents timing side-channel attacks |
| 3 | Idempotency | Check terminal status before processing any webhook |
| 4 | Amount Validation | Reject if `amount_paid < amount_idr` |
| 5 | Double Payment Guard | Optimistic DB lock (`WHERE status = QRIS_GENERATED`) |
| 6 | API Key Auth | `Authorization: ApiKey` header for checkout endpoints |
| 7 | Admin JWT | Short-lived JWT (15 min) with role claim for force-open |
| 8 | Rate Limiting | 10 req/min per `lock_id` on checkout endpoint |
| 9 | Raw Body for HMAC | `express.raw()` — never parse JSON before computing HMAC |
| 10 | HTTPS Only | All endpoints behind TLS 1.2+ (Let's Encrypt / AWS ACM) |
| 11 | No PII in QRIS | QRIS string contains only `order_id` and `amount` |
| 12 | Secrets in Env | All gateway keys in environment variables / secret manager |

---

## 7. Deployment Architecture

```
INTERNET / CELLULAR
│
├── Mobile App ───────────────────────────────────────────────┐
├── Payment Gateway (Midtrans / Xendit / Dana) ───────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  BACKEND SERVER  (Node.js + Express)                  │◄──┘
│  │  checkout.controller | webhook.controller             │
│  │  admin.controller    | stateMachine.service           │
│  │  retryQueue.service  | hardware.service               │
│  │  alert.service       | midtrans/xendit/dana adapter   │
│  └────────────────────┬─────────────────────────────────┘
│                       │ HTTPS / LAN
│                       │
│  ┌────────────────────▼────────────────────────────────┐
│  │  BLE GATEWAY (Raspberry Pi)                          │
│  │  - HTTP Agent: POST /command                         │
│  │  - SC1240 Node.js SDK                                │
│  │  - @abandonware/noble BLE                            │
│  └────────────────────┬────────────────────────────────┘
│                       │ Bluetooth LE (max 10m)
│                       │
│  ┌────────────────────▼────────────────────────────────┐
│  │  SC1240 IoT Lock (Embedded C Firmware)               │
│  │  BLE UART characteristic FFE1                        │
│  │  Tri-modal sensor fusion (Geomag + IR + Radar)       │
│  │  Motor controller lowerLock hex 0235                 │
│  └─────────────────────────────────────────────────────┘
│
│  MongoDB Atlas ── ParkingTransaction (state machine)
└─────────────────────────────────────────────────────────────
```

---

## 8. Parking Fee Reference Table

| Duration | Amount (IDR) | Breakdown |
|----------|-------------|-----------|
| 0 – 30 menit | Rp 3.000 | Base fee |
| 31 – 90 menit | Rp 8.000 | Base + 1 jam |
| 91 – 150 menit | Rp 13.000 | Base + 2 jam |
| 151 – 210 menit | Rp 18.000 | Base + 3 jam |
| 211 – 270 menit | Rp 23.000 | Base + 4 jam |
| lebih dari 8.5 jam | Rp 50.000 | Daily cap |

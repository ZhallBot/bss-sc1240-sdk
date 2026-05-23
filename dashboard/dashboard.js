/* ──────────────────────────────────────────────────────────────
   BSS Parking SC1240 Dashboard Controller
   Simulates 10 Parking Locks, Telemetry, Webhooks & Overrides
   ────────────────────────────────────────────────────────────── */

'use strict';

// 1. Initial 10 Slots Mock Data
let parkingSlots = [
    { id: '01', status: 'vacant', plate: '', entryTime: null, duration: 0, cost: 0, battery: 84, solar: true, signal: 95, errorCode: null },
    { id: '02', status: 'occupied', plate: 'B 1234 XYZ', entryTime: new Date(Date.now() - 42 * 60 * 1000), duration: 42, cost: 8000, battery: 76, solar: true, signal: 90, errorCode: null },
    { id: '03', status: 'error', plate: 'B 9999 JAM', entryTime: new Date(Date.now() - 110 * 60 * 1000), duration: 110, cost: 13000, battery: 65, solar: false, signal: 85, errorCode: 0x80, errorName: 'BAFFLE_JAMMED', errorMsg: 'Palang macet/terganjal benda asing.' },
    { id: '04', status: 'vacant', plate: '', entryTime: null, duration: 0, cost: 0, battery: 18, solar: false, signal: 88, errorCode: null }, // Low Battery Warning
    { id: '05', status: 'occupied', plate: 'D 888 AM', entryTime: new Date(Date.now() - 15 * 60 * 1000), duration: 15, cost: 3000, battery: 92, solar: true, signal: 98, errorCode: null },
    { id: '06', status: 'vacant', plate: '', entryTime: null, duration: 0, cost: 0, battery: 72, solar: true, signal: 92, errorCode: null },
    { id: '07', status: 'offline', plate: '', entryTime: null, duration: 0, cost: 0, battery: 0, solar: false, signal: 0, errorCode: null }, // Device Offline
    { id: '08', status: 'occupied', plate: 'F 4567 GD', entryTime: new Date(Date.now() - 180 * 60 * 1000), duration: 180, cost: 18000, battery: 78, solar: true, signal: 91, errorCode: null },
    { id: '09', status: 'vacant', plate: '', entryTime: null, duration: 0, cost: 0, battery: 88, solar: true, signal: 94, errorCode: null },
    { id: '10', status: 'error', plate: 'B 303 VDL', entryTime: new Date(Date.now() - 30 * 60 * 1000), duration: 30, cost: 3000, battery: 70, solar: true, signal: 82, errorCode: 0x20, errorName: 'SHAKING_ALARM', errorMsg: 'Guncangan abnormal terdeteksi (dugaan pencurian tarif).' }
];

// 2. Activity Logs Database (Mock)
let activityLogs = [
    { time: new Date(Date.now() - 2 * 60 * 1000), slot: '10', type: 'error', text: 'Peringatan: Guncangan abnormal (Shaking) terdeteksi pada Slot 10.', user: 'Sistem SC1240' },
    { time: new Date(Date.now() - 10 * 60 * 1000), slot: '02', type: 'payment', text: 'Transaksi Sukses via QRIS Midtrans: Rp 8.000. Palang diturunkan otomatis.', user: 'Midtrans Webhook' },
    { time: new Date(Date.now() - 15 * 60 * 1000), slot: '05', type: 'telemetry', text: 'Deteksi Kendaraan Masuk (IR + Radar) - Palang terangkat otomatis.', user: 'Sensor Fusion' },
    { time: new Date(Date.now() - 25 * 60 * 1000), slot: '03', type: 'error', text: 'Error Kritis 0x80: Baffle Jammed (Palang Macet) terdeteksi pada Slot 03.', user: 'Telemetry MCU' },
    { time: new Date(Date.now() - 40 * 60 * 1000), slot: '07', type: 'error', text: 'Kehilangan koneksi BLE / Ping Timeout dengan perangkat Slot 07.', user: 'Gateway Agent' }
];

// Active State Management
let selectedSlot = null;
let activeFilters = { type: 'all', slot: '' };

// Hex Commands
const HEX_RAISE = '12345678EB90FFFFFFFF0234';
const HEX_LOWER = '12345678EB90FFFFFFFF0235';

// DOM Elements
const gridContainer = document.getElementById('parking-grid');
const incidentFeed = document.getElementById('incident-feed');
const logsBody = document.getElementById('logs-table-body');
const searchSlotInput = document.getElementById('log-search-slot');
const alertCountBadge = document.getElementById('sidebar-alert-count');

// Modal Elements
const quickActionModal = document.getElementById('quick-action-modal');
const modalSlotId = document.getElementById('modal-slot-id');
const modalStatusText = document.getElementById('modal-status-text');
const modalPlate = document.getElementById('modal-plate');
const modalBattery = document.getElementById('modal-battery');
const modalSolarStatus = document.getElementById('modal-solar-status');
const modalSignal = document.getElementById('modal-signal');
const modalSignalLabel = document.getElementById('modal-signal-label');
const modalDuration = document.getElementById('modal-duration');
const modalCheckinTime = document.getElementById('modal-checkin-time');
const modalCost = document.getElementById('modal-cost');
const safetyBypassCheckbox = document.getElementById('safety-bypass-checkbox');
const overrideFormElements = document.getElementById('override-form-elements');
const overrideReasonSelect = document.getElementById('override-reason');
const overrideCustomReason = document.getElementById('override-custom-reason');
const btnRaiseLock = document.getElementById('btn-raise-lock');
const btnLowerLock = document.getElementById('btn-lower-lock');
const hexPreview = document.getElementById('hex-preview');

// Confirm Dialog Elements
const confirmModal = document.getElementById('confirm-modal');
const confSlotId = document.getElementById('conf-slot-id');
const confAction = document.getElementById('conf-action');
const confHex = document.getElementById('conf-hex');
const confReason = document.getElementById('conf-reason');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnConfirmSubmit = document.getElementById('btn-confirm-submit');

// Toast Notification Elements
const toastNotif = document.getElementById('toast-notif');

// ──────────────────────────────────────────────────────────────
// 3. RENDER FUNCTIONS
// ──────────────────────────────────────────────────────────────

// Render Grid
function renderGrid() {
    gridContainer.innerHTML = '';
    parkingSlots.forEach(slot => {
        const card = document.createElement('div');
        card.className = `parking-slot-card slot-${slot.status}`;
        card.setAttribute('data-id', slot.id);
        
        let subDetails = '';
        if (slot.status === 'vacant') {
            subDetails = `<span class="slot-empty-placeholder">Kosong (Tersedia)</span>`;
        } else if (slot.status === 'offline') {
            subDetails = `<span class="slot-empty-placeholder text-muted">Perangkat Offline</span>`;
        } else if (slot.status === 'error') {
            subDetails = `
                <span class="slot-plate-num">${slot.plate || 'ERROR'}</span>
                <span class="slot-duration text-red" style="font-weight: 700;">⚠ ${slot.errorName}</span>
            `;
        } else {
            subDetails = `
                <span class="slot-plate-num">${slot.plate}</span>
                <span class="slot-duration">${slot.duration} mnt • Rp ${slot.cost.toLocaleString('id-ID')}</span>
            `;
        }

        // Battery level color class
        const batColor = slot.battery < 20 ? '#ef4444' : '#10b981';

        card.innerHTML = `
            <div class="slot-top-row">
                <span class="slot-num-badge">${slot.id}</span>
                <span class="slot-status-pill">${getStatusLabel(slot.status)}</span>
            </div>
            <div class="slot-mid-row">
                ${subDetails}
            </div>
            <div class="slot-bottom-row">
                <div class="slot-battery">
                    <div class="battery-icon">
                        <div class="battery-fill" style="width: ${slot.battery}%; background-color: ${batColor};"></div>
                    </div>
                    <span>${slot.battery}%</span>
                </div>
                <div class="slot-signal">
                    <div class="signal-dots">
                        <div class="signal-dot ${slot.signal >= 25 ? 'active' : ''}"></div>
                        <div class="signal-dot ${slot.signal >= 50 ? 'active' : ''}"></div>
                        <div class="signal-dot ${slot.signal >= 75 ? 'active' : ''}"></div>
                        <div class="signal-dot ${slot.signal >= 90 ? 'active' : ''}"></div>
                    </div>
                    <span>${slot.signal ? slot.signal + '%' : 'OFF'}</span>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => openQuickActionPanel(slot));
        gridContainer.appendChild(card);
    });
    
    updateHeaderStats();
}

function getStatusLabel(status) {
    const labels = {
        vacant: 'Kosong',
        occupied: 'Terisi',
        raising: 'Menaikkan',
        lowering: 'Menurunkan',
        offline: 'Offline',
        error: 'Eror/Anomali'
    };
    return labels[status] || status;
}

// Update Header Statistics Badges
function updateHeaderStats() {
    document.getElementById('count-total').innerText = parkingSlots.length;
    document.getElementById('count-vacant').innerText = parkingSlots.filter(s => s.status === 'vacant').length;
    document.getElementById('count-occupied').innerText = parkingSlots.filter(s => s.status === 'occupied').length;
    document.getElementById('count-transition').innerText = parkingSlots.filter(s => s.status === 'raising' || s.status === 'lowering').length;
    document.getElementById('count-anomaly').innerText = parkingSlots.filter(s => s.status === 'error' || s.battery < 20).length;
    document.getElementById('count-offline').innerText = parkingSlots.filter(s => s.status === 'offline').length;
}

// Render Incidents Sidebar
function renderIncidents() {
    incidentFeed.innerHTML = '';
    
    // Compile incidents from slot statuses
    let incidents = [];
    
    parkingSlots.forEach(slot => {
        // Critical Errors
        if (slot.status === 'error' && slot.errorCode) {
            incidents.push({
                slotId: slot.id,
                severity: 'critical',
                title: `${slot.errorName} (Slot ${slot.id})`,
                desc: `${slot.errorMsg} Sensor mendeteksi kegagalan pada aktuator palang.`,
                time: new Date()
            });
        }
        // Warning: Battery low
        if (slot.battery > 0 && slot.battery < 20) {
            incidents.push({
                slotId: slot.id,
                severity: 'warning',
                title: `Baterai Lemah < 20% (Slot ${slot.id})`,
                desc: `Daya baterai saat ini ${slot.battery}%. Hubungkan panel surya atau ganti aki baterai lead-acid segera.`,
                time: new Date()
            });
        }
        // Warning: Device Offline
        if (slot.status === 'offline') {
            incidents.push({
                slotId: slot.id,
                severity: 'warning',
                title: `Perangkat Offline (Slot ${slot.id})`,
                desc: `Kehilangan heartbeat sensor selama > 5 menit. Periksa koneksi BLE / NB-IoT.`,
                time: new Date()
            });
        }
    });

    alertCountBadge.innerText = incidents.length;
    alertCountBadge.style.display = incidents.length > 0 ? 'inline-block' : 'none';

    if (incidents.length === 0) {
        incidentFeed.innerHTML = `
            <div class="empty-feed-placeholder">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 12l3 3 5-5" />
                </svg>
                <span>Semua sistem berjalan normal</span>
            </div>
        `;
        return;
    }

    incidents.forEach(inc => {
        const card = document.createElement('div');
        card.className = `incident-card incident-${inc.severity}`;
        
        card.innerHTML = `
            <div class="incident-top">
                <span class="incident-badge">${inc.severity === 'critical' ? 'Kritis' : 'Peringatan'}</span>
                <span class="incident-time">Baru saja</span>
            </div>
            <h4 class="incident-title">${inc.title}</h4>
            <p class="incident-desc">${inc.desc}</p>
            <div class="incident-actions">
                <button class="btn-resolve" onclick="resolveIncident('${inc.slotId}')">Investigasi Selesai</button>
            </div>
        `;
        
        incidentFeed.appendChild(card);
    });
}

// Action to Resolve Incidents
window.resolveIncident = function(slotId) {
    const slot = parkingSlots.find(s => s.id === slotId);
    if (!slot) return;
    
    let oldStatus = slot.status;
    let text = '';
    
    if (slot.status === 'error') {
        // Resolve error, set back to vacant or occupied based on layout
        slot.status = slot.plate ? 'occupied' : 'vacant';
        slot.errorCode = null;
        slot.errorMsg = '';
        text = `Petugas Keamanan menyelesaikan investigasi Slot ${slotId}. Status dipulihkan ke ${slot.status === 'occupied' ? 'Terisi' : 'Kosong'}.`;
    } else if (slot.battery < 20) {
        // Recharge battery simulation
        slot.battery = 88;
        slot.solar = true;
        text = `Petugas mengganti aki/memperbaiki pengisian panel surya Slot ${slotId}. Baterai dipulihkan ke 88%.`;
    } else if (slot.status === 'offline') {
        // Reconnect device simulation
        slot.status = 'vacant';
        slot.signal = 88;
        slot.battery = 74;
        text = `Koneksi ke perangkat Slot ${slotId} berhasil dipulihkan setelah investigasi lapangan.`;
    }

    addActivityLog(slotId, 'override', text, 'Bripda Setiawan (Manual)');
    showToast('Investigasi Selesai', `Status Slot ${slotId} berhasil dipulihkan.`, 'success');
    
    renderGrid();
    renderIncidents();
    renderLogs();
};

// Render Logs Table
function renderLogs() {
    logsBody.innerHTML = '';
    
    // Apply filters
    let filteredLogs = activityLogs.filter(log => {
        // Filter by slot
        if (activeFilters.slot && !log.slot.includes(activeFilters.slot)) {
            return false;
        }
        // Filter by type
        if (activeFilters.type !== 'all' && log.type !== activeFilters.type) {
            return false;
        }
        return true;
    });

    if (filteredLogs.length === 0) {
        logsBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 24px;">
                    Tidak ada aktivitas log yang cocok dengan kriteria filter.
                </td>
            </tr>
        `;
        return;
    }

    filteredLogs.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${log.time.toLocaleTimeString('id-ID')} <span style="font-size: 9px; color: var(--text-muted);">${log.time.toLocaleDateString('id-ID')}</span></td>
            <td><span class="log-slot-num">${log.slot}</span></td>
            <td><span class="log-badge type-${log.type}">${getLogTypeLabel(log.type)}</span></td>
            <td>${log.text}</td>
            <td><span style="font-weight: 500;">${log.user}</span></td>
        `;
        logsBody.appendChild(row);
    });
}

function getLogTypeLabel(type) {
    const labels = {
        payment: 'Pembayaran',
        error: 'Anomali',
        telemetry: 'Deteksi IoT',
        override: 'Override Manual'
    };
    return labels[type] || type;
}

// Add New Activity Log Helper
function addActivityLog(slot, type, text, user = 'Sistem') {
    activityLogs.unshift({
        time: new Date(),
        slot,
        type,
        text,
        user
    });
    // Keep max 50 logs in history
    if (activityLogs.length > 50) activityLogs.pop();
}

// ──────────────────────────────────────────────────────────────
// 4. MODAL & OVERRIDE ACTIONS
// ──────────────────────────────────────────────────────────────

// Open Quick Action modal
function openQuickActionPanel(slot) {
    selectedSlot = slot;
    
    modalSlotId.innerText = slot.id;
    modalStatusText.innerText = getStatusLabel(slot.status);
    
    // Status text color classes in modal
    modalStatusText.className = 'val status-pill';
    if (slot.status === 'vacant') modalStatusText.classList.add('btn-green');
    else if (slot.status === 'occupied') modalStatusText.classList.add('btn-red');
    else if (slot.status === 'offline') modalStatusText.classList.add('btn-secondary');
    else modalStatusText.classList.add('btn-red'); // Error / Transisi
    
    modalPlate.innerText = slot.plate || 'Kosong (Tersedia)';
    modalBattery.innerText = `${slot.battery}%`;
    modalSolarStatus.innerText = slot.solar ? 'Solar Panel: Aktif Charging' : 'Solar Panel: Tidak Mengisi Daya';
    modalSolarStatus.style.color = slot.solar ? '#10b981' : '#ef4444';
    
    modalSignal.innerText = slot.signal ? `${slot.signal}%` : 'OFFLINE';
    modalSignalLabel.innerText = getSignalLabel(slot.signal);
    
    modalDuration.innerText = slot.duration ? `${slot.duration} menit` : '0 mnt';
    modalCheckinTime.innerText = slot.entryTime ? `Check-in: ${slot.entryTime.toLocaleTimeString('id-ID')}` : 'Check-in: -';
    modalCost.innerText = `Rp ${slot.cost.toLocaleString('id-ID')}`;
    
    // Reset manual override safety switch
    safetyBypassCheckbox.checked = false;
    document.querySelector('.safety-lock-card').classList.remove('unlocked');
    overrideFormElements.classList.add('disabled-state');
    overrideReasonSelect.value = '';
    overrideCustomReason.value = '';
    btnRaiseLock.disabled = true;
    btnLowerLock.disabled = true;
    hexPreview.innerText = 'Silakan pilih perintah...';
    
    // Display Modal
    quickActionModal.classList.add('active');
}

function getSignalLabel(val) {
    if (!val) return 'Tidak Terkoneksi';
    if (val >= 90) return 'Sangat Baik (LTE/BLE)';
    if (val >= 60) return 'Baik (Sinyal Stabil)';
    return 'Cukup (Sinyal Lemah)';
}

// Safety Switch Trigger
safetyBypassCheckbox.addEventListener('change', function() {
    const safetyCard = document.querySelector('.safety-lock-card');
    if (this.checked) {
        safetyCard.classList.add('unlocked');
        overrideFormElements.classList.remove('disabled-state');
        updateOverrideButtons();
    } else {
        safetyCard.classList.remove('unlocked');
        overrideFormElements.classList.add('disabled-state');
        btnRaiseLock.disabled = true;
        btnLowerLock.disabled = true;
    }
});

// Update manual override buttons status based on forms inputs
overrideReasonSelect.addEventListener('change', updateOverrideButtons);

function updateOverrideButtons() {
    if (!safetyBypassCheckbox.checked || !overrideReasonSelect.value) {
        btnRaiseLock.disabled = true;
        btnLowerLock.disabled = true;
        hexPreview.innerText = 'Pilih alasan audit untuk melihat command...';
        return;
    }

    // Enable buttons based on current state of device
    btnRaiseLock.disabled = false;
    btnLowerLock.disabled = false;
    
    hexPreview.innerHTML = `
        Raise Lock: <span style="color: #f59e0b; font-weight: 700;">${HEX_RAISE}</span> | 
        Lower Lock: <span style="color: #10b981; font-weight: 700;">${HEX_LOWER}</span>
    `;
}

// Close Modal
document.getElementById('modal-close-btn').addEventListener('click', () => {
    quickActionModal.classList.remove('active');
    selectedSlot = null;
});

// Click button "Kunci Slot"
btnRaiseLock.addEventListener('click', () => {
    triggerOverrideConfirmation('KUNCI_SLOT', HEX_RAISE);
});

// Click button "Buka Paksa"
btnLowerLock.addEventListener('click', () => {
    triggerOverrideConfirmation('BUKA_PAKSA', HEX_LOWER);
});

// Confirm Override Dialog Trigger
let pendingCommand = null;

function triggerOverrideConfirmation(action, hex) {
    const reasonText = overrideReasonSelect.value + (overrideCustomReason.value ? ` (${overrideCustomReason.value})` : '');
    
    confSlotId.innerText = selectedSlot.id;
    confAction.innerText = action === 'KUNCI_SLOT' ? 'KUNCI SLOT (Naikkan Palang)' : 'BUKA PAKSA (Turunkan Palang)';
    confHex.innerText = hex;
    confReason.innerText = reasonText;
    
    // Save details to pending state
    pendingCommand = {
        action,
        hex,
        reason: reasonText,
        slotId: selectedSlot.id
    };
    
    confirmModal.classList.add('active');
}

// Cancel Confirm dialog
btnConfirmCancel.addEventListener('click', () => {
    confirmModal.classList.remove('active');
    pendingCommand = null;
});

// Submit Confirm dialog (EXECUTION)
btnConfirmSubmit.addEventListener('click', async () => {
    if (!pendingCommand) return;
    
    const { action, hex, reason, slotId } = pendingCommand;
    const slot = parkingSlots.find(s => s.id === slotId);
    
    // Close modals
    confirmModal.classList.remove('active');
    quickActionModal.classList.remove('active');
    
    // Put Slot into transition state
    const oldStatus = slot.status;
    slot.status = action === 'KUNCI_SLOT' ? 'raising' : 'lowering';
    showToast('Mengirim Command', `Hex command ${hex} dikirim ke Slot ${slotId}...`, 'info');
    
    // Render transition UI
    renderGrid();
    
    // Generate Log of Command Sent
    addActivityLog(slotId, 'override', `Command manual override [${action}] dikirim. Hex: ${hex}. Alasan: "${reason}"`, 'Bripda Setiawan (Manual)');
    renderLogs();
    
    // Simulate mechanical movement delay (2 seconds)
    setTimeout(() => {
        if (action === 'KUNCI_SLOT') {
            slot.status = 'occupied';
            slot.plate = 'B 777 VIP';
            slot.entryTime = new Date();
            slot.duration = 1;
            slot.cost = 3000;
            addActivityLog(slotId, 'telemetry', `Slot ${slotId} berhasil dikunci (Palang Naik 90°). Plat: ${slot.plate}.`, 'Sensor Fusion');
            showToast('Override Sukses', `Slot ${slotId} berhasil dikunci (Palang Naik).`, 'success');
        } else {
            slot.status = 'vacant';
            slot.plate = '';
            slot.entryTime = null;
            slot.duration = 0;
            slot.cost = 0;
            slot.errorCode = null;
            addActivityLog(slotId, 'telemetry', `Slot ${slotId} berhasil dibuka paksa (Palang Turun 0°).`, 'Sensor Fusion');
            showToast('Override Sukses', `Slot ${slotId} berhasil dibuka paksa (Palang Turun).`, 'success');
        }
        
        renderGrid();
        renderIncidents();
        renderLogs();
    }, 2000);
    
    pendingCommand = null;
    selectedSlot = null;
});

// Toast Notif Helper
function showToast(title, desc, type = 'success') {
    const toastTitle = toastNotif.querySelector('.toast-title');
    const toastDesc = toastNotif.querySelector('.toast-desc');
    const toastIcon = toastNotif.querySelector('.toast-icon');
    
    toastTitle.innerText = title;
    toastDesc.innerText = desc;
    
    // Reset toast classes
    toastNotif.className = 'toast-notification';
    toastNotif.classList.add(`toast-${type === 'info' ? 'success' : type}`);
    
    if (type === 'success') {
        toastIcon.innerHTML = '✔';
    } else if (type === 'error') {
        toastIcon.innerHTML = '✖';
    } else {
        toastIcon.innerHTML = 'ℹ';
    }
    
    toastNotif.classList.add('active');
    
    // Auto hide after 4 seconds
    setTimeout(() => {
        toastNotif.classList.remove('active');
    }, 4000);
}

// ──────────────────────────────────────────────────────────────
// 5. ACTIVITY LOG FILTERS
// ──────────────────────────────────────────────────────────────
const filterBtns = document.querySelectorAll('.filter-btn');

filterBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        filterBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        activeFilters.type = this.getAttribute('data-filter');
        renderLogs();
    });
});

searchSlotInput.addEventListener('input', function() {
    activeFilters.slot = this.value.trim();
    renderLogs();
});

// ──────────────────────────────────────────────────────────────
// 6. LIVE EVENT SIMULATION (Feeling Alive Tickers)
// ──────────────────────────────────────────────────────────────

// Pulse the Telemetry Ticker and periodically updates durations
setInterval(() => {
    const tick = document.getElementById('telemetry-tick-indicator');
    tick.classList.add('active');
    
    // Update active vehicles duration
    parkingSlots.forEach(slot => {
        if (slot.status === 'occupied' && slot.entryTime) {
            const elapsed = Math.floor((Date.now() - slot.entryTime.getTime()) / 60000);
            slot.duration = elapsed;
            
            // Recalculate cost
            let amount = 3000;
            if (elapsed > 30) {
                amount += Math.ceil((elapsed - 30) / 60) * 5000;
            }
            slot.cost = Math.min(amount, 50000);
        }
    });
    
    renderGrid();
    
    setTimeout(() => {
        tick.classList.remove('active');
    }, 400);
}, 2000);

// Dynamic Event Simulation: Vehicles arriving & leaving automatically
// This showcases the "real-time operational" feel.
setInterval(() => {
    // 35% chance to simulate a vehicle event every 18 seconds
    if (Math.random() > 0.65) {
        simulateVehicleAction();
    }
}, 18000);

function simulateVehicleAction() {
    // Check vacant slots
    const vacantSlots = parkingSlots.filter(s => s.status === 'vacant');
    const occupiedSlots = parkingSlots.filter(s => s.status === 'occupied');
    
    if (vacantSlots.length > 0 && Math.random() > 0.4) {
        // Vehicle arriving simulation
        const randomSlot = vacantSlots[Math.floor(Math.random() * vacantSlots.length)];
        const plates = ['B 8261 SH', 'D 404 ERR', 'B 920 TPP', 'DK 4746 XX', 'AD 2026 OK'];
        const plate = plates[Math.floor(Math.random() * plates.length)];
        
        randomSlot.status = 'occupied';
        randomSlot.plate = plate;
        randomSlot.entryTime = new Date();
        randomSlot.duration = 1;
        randomSlot.cost = 3000;
        
        addActivityLog(randomSlot.id, 'telemetry', `Kendaraan terdeteksi pada Slot ${randomSlot.id} (Plat: ${plate}). Palang dinaikkan otomatis.`, 'Sensor Fusion');
        showToast('Mobil Masuk', `Kendaraan masuk di Slot ${randomSlot.id} (${plate})`, 'info');
        
        renderGrid();
        renderLogs();
    } else if (occupiedSlots.length > 0) {
        // Vehicle leaving simulation (after payment)
        const randomSlot = occupiedSlots[Math.floor(Math.random() * occupiedSlots.length)];
        
        addActivityLog(randomSlot.id, 'payment', `Transaksi Sukses via Gopay: Rp ${randomSlot.cost.toLocaleString('id-ID')} untuk Slot ${randomSlot.id}. Palang diturunkan otomatis.`, 'Xendit Webhook');
        showToast('Pembayaran Berhasil', `Slot ${randomSlot.id} dibayar. Palang diturunkan.`, 'success');
        
        randomSlot.status = 'lowering';
        renderGrid();
        renderLogs();
        
        setTimeout(() => {
            randomSlot.status = 'vacant';
            randomSlot.plate = '';
            randomSlot.entryTime = null;
            randomSlot.duration = 0;
            randomSlot.cost = 0;
            
            addActivityLog(randomSlot.id, 'telemetry', `Slot ${randomSlot.id} terdeteksi kosong. Palang diturunkan penuh (0°).`, 'Sensor Fusion');
            renderGrid();
            renderLogs();
        }, 3000);
    }
}

// Initial Boot Rendering
window.addEventListener('DOMContentLoaded', () => {
    renderGrid();
    renderIncidents();
    renderLogs();
});

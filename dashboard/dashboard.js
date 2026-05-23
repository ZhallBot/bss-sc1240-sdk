/* ──────────────────────────────────────────────────────────────
   BSS Parking SC1240 Dashboard Controller (V2)
   Manages tabs, SVG charting, CSV export, telemetry and overrides.
   ────────────────────────────────────────────────────────────── */

'use strict';

// 1. Initial 10 Slots Mock Data
let parkingSlots = [
    { id: '01', status: 'vacant', plate: '', entryTime: null, duration: 0, cost: 0, battery: 84, solar: true, signal: 95, errorCode: null, standbyUa: 240 },
    { id: '02', status: 'occupied', plate: 'B 1234 XYZ', entryTime: new Date(Date.now() - 45 * 60 * 1000), duration: 45, cost: 8000, battery: 76, solar: true, signal: 90, errorCode: null, standbyUa: 12000 },
    { id: '03', status: 'error', plate: 'B 9999 JAM', entryTime: new Date(Date.now() - 110 * 60 * 1000), duration: 110, cost: 18000, battery: 65, solar: false, signal: 85, errorCode: 0x80, errorName: 'BAFFLE_JAMMED', errorMsg: 'Error 80: Palang macet/terganjal benda asing.', standbyUa: 45000 },
    { id: '04', status: 'vacant', plate: '', entryTime: null, duration: 0, cost: 0, battery: 18, solar: false, signal: 88, errorCode: null, standbyUa: 210 }, // Low Battery Warning
    { id: '05', status: 'occupied', plate: 'D 888 AM', entryTime: new Date(Date.now() - 15 * 60 * 1000), duration: 15, cost: 3000, battery: 92, solar: true, signal: 98, errorCode: null, standbyUa: 11500 },
    { id: '06', status: 'vacant', plate: '', entryTime: null, duration: 0, cost: 0, battery: 72, solar: true, signal: 92, errorCode: null, standbyUa: 235 },
    { id: '07', status: 'offline', plate: '', entryTime: null, duration: 0, cost: 0, battery: 0, solar: false, signal: 0, errorCode: null, standbyUa: 0 }, // Device Offline
    { id: '08', status: 'occupied', plate: 'F 4567 GD', entryTime: new Date(Date.now() - 180 * 60 * 1000), duration: 180, cost: 18000, battery: 78, solar: true, signal: 91, errorCode: null, standbyUa: 12100 },
    { id: '09', status: 'error', plate: 'B 920 TPP', entryTime: new Date(Date.now() - 65 * 60 * 1000), duration: 65, cost: 8000, battery: 80, solar: true, signal: 94, errorCode: 0x10, errorName: 'ELEVATION_LOW', errorMsg: 'Error 10: Sudut palang abnormal (<35 derajat).', standbyUa: 320 },
    { id: '10', status: 'error', plate: 'B 303 VDL', entryTime: new Date(Date.now() - 30 * 60 * 1000), duration: 30, cost: 3000, battery: 70, solar: true, signal: 82, errorCode: 0x20, errorName: 'SHAKING_ALARM', errorMsg: 'Error 20: Guncangan abnormal (dugaan pencurian tarif).', standbyUa: 420 }
];

// 2. Mock Audit Transactions (Tab 2 Finance Audit Table)
let auditTransactions = [
    { id: 'TXN-982103-A02', slot: '02', entryTime: '08:11:15', exitTime: '--:--:--', duration: '45 mnt', amount: 8000, method: 'QRIS (Xendit)', crosscheck: 'VERIFIED', status: 'PAID' },
    { id: 'TXN-982054-A05', slot: '05', entryTime: '08:41:02', exitTime: '--:--:--', duration: '15 mnt', amount: 3000, method: 'QRIS (Midtrans)', crosscheck: 'VERIFIED', status: 'PAID' },
    { id: 'TXN-981881-A03', slot: '03', entryTime: '07:06:00', exitTime: '08:56:00', duration: '110 mnt', amount: 18000, method: 'QRIS (Dana)', crosscheck: 'MANUAL_OVERRIDE', status: 'PAID' },
    { id: 'TXN-981755-A08', slot: '08', entryTime: '05:56:32', exitTime: '--:--:--', duration: '180 mnt', amount: 18000, method: 'QRIS (Midtrans)', crosscheck: 'VERIFIED', status: 'PAID' },
    { id: 'TXN-981650-A01', slot: '01', entryTime: '04:12:00', exitTime: '05:15:00', duration: '63 mnt', amount: 8000, method: 'QRIS (Xendit)', crosscheck: 'VERIFIED', status: 'PAID' },
    { id: 'TXN-981541-A06', slot: '06', entryTime: '02:30:00', exitTime: '03:10:00', duration: '40 mnt', amount: 8000, method: 'QRIS (Midtrans)', crosscheck: 'VERIFIED', status: 'PAID' }
];

// 3. Activity Logs Database (Mock)
let activityLogs = [
    { time: new Date(Date.now() - 2 * 60 * 1000), slot: '10', type: 'error', text: 'Peringatan Error 20: Guncangan abnormal terdeteksi pada Slot 10.', user: 'Sistem SC1240' },
    { time: new Date(Date.now() - 5 * 60 * 1000), slot: '09', type: 'error', text: 'Peringatan Error 10: Hambatan elevasi kurang dari 35 derajat pada Slot 09. Palang naik/turun berulang terdeteksi.', user: 'Sistem Proteksi' },
    { time: new Date(Date.now() - 10 * 60 * 1000), slot: '02', type: 'payment', text: 'Transaksi Sukses via QRIS Xendit: Rp 8.000. Palang diturunkan otomatis.', user: 'Xendit Webhook' },
    { time: new Date(Date.now() - 15 * 60 * 1000), slot: '05', type: 'telemetry', text: 'Deteksi Kendaraan Masuk (IR + Radar) - Palang terangkat otomatis.', user: 'Sensor Fusion' },
    { time: new Date(Date.now() - 25 * 60 * 1000), slot: '03', type: 'error', text: 'Error Kritis 80: Baffle Jammed (Palang Macet) terdeteksi pada Slot 03.', user: 'Telemetry MCU' },
    { time: new Date(Date.now() - 40 * 60 * 1000), slot: '07', type: 'error', text: 'Kehilangan koneksi BLE / Ping Timeout dengan perangkat Slot 07.', user: 'Gateway Agent' }
];

// State Management
let selectedSlot = null;
let activeFilters = { type: 'all', slot: '' };

// Hex Commands
const HEX_RESET = '12345678EB90FFFFFFFF0233';
const HEX_RAISE = '12345678EB90FFFFFFFF0234';
const HEX_LOWER = '12345678EB90FFFFFFFF0235';

// DOM Elements
const gridContainer = document.getElementById('parking-grid');
const incidentFeed = document.getElementById('incident-feed');
const logsBody = document.getElementById('logs-table-body');
const searchSlotInput = document.getElementById('log-search-slot');
const alertCountBadge = document.getElementById('sidebar-alert-count');
const auditTableBody = document.getElementById('audit-table-body');
const btnExportCsv = document.getElementById('btn-export-csv');

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
const modalCurrentDraw = document.getElementById('modal-current-current');
const safetyBypassCheckbox = document.getElementById('safety-bypass-checkbox');
const overrideFormElements = document.getElementById('override-form-elements');
const overrideReasonSelect = document.getElementById('override-reason');
const overrideCustomReason = document.getElementById('override-custom-reason');
const btnRaiseLock = document.getElementById('btn-raise-lock');
const btnLowerLock = document.getElementById('btn-lower-lock');
const btnResetLock = document.getElementById('btn-reset-lock');
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
// 3. TAB NAVIGATION CONTROL
// ──────────────────────────────────────────────────────────────
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');

navTabs.forEach(tab => {
    tab.addEventListener('click', function() {
        navTabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        this.classList.add('active');
        const targetTab = this.getAttribute('data-tab');
        document.getElementById(`content-${targetTab}`).classList.add('active');
        
        if (targetTab === 'analytics') {
            renderAnalyticsTab();
        }
    });
});

// Spec Section Sidebar Menu Controls
const specMenuBtns = document.querySelectorAll('.spec-menu-btn');
const specSections = document.querySelectorAll('.spec-section');

specMenuBtns.forEach(btn => {
    btn.addEventListener('click', function() {
        specMenuBtns.forEach(b => b.classList.remove('active'));
        specSections.forEach(s => s.classList.remove('active'));
        
        this.classList.add('active');
        const targetSection = this.getAttribute('data-spec-section');
        document.getElementById(`spec-section-${targetSection}`).classList.add('active');
    });
});

// ──────────────────────────────────────────────────────────────
// 4. RENDER FUNCTIONS (Control Center Tab)
// ──────────────────────────────────────────────────────────────

// Render Grid of Devices
function renderGrid() {
    if (!gridContainer) return;
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

// Update Top Badge Counts
function updateHeaderStats() {
    const countTotal = document.getElementById('count-total');
    if (!countTotal) return;
    
    countTotal.innerText = parkingSlots.length;
    document.getElementById('count-vacant').innerText = parkingSlots.filter(s => s.status === 'vacant').length;
    document.getElementById('count-occupied').innerText = parkingSlots.filter(s => s.status === 'occupied').length;
    document.getElementById('count-transition').innerText = parkingSlots.filter(s => s.status === 'raising' || s.status === 'lowering').length;
    document.getElementById('count-anomaly').innerText = parkingSlots.filter(s => s.status === 'error' || s.battery < 20).length;
    document.getElementById('count-offline').innerText = parkingSlots.filter(s => s.status === 'offline').length;
}

// Render Sidebar Incident Feed
function renderIncidents() {
    if (!incidentFeed) return;
    incidentFeed.innerHTML = '';
    
    let incidents = [];
    parkingSlots.forEach(slot => {
        // Critical System Errors
        if (slot.status === 'error' && slot.errorCode) {
            let severity = (slot.errorCode === 0x80 || slot.errorCode === 0x20) ? 'critical' : 'warning';
            incidents.push({
                slotId: slot.id,
                severity,
                title: `${slot.errorName} (Slot ${slot.id})`,
                desc: slot.errorMsg,
                time: new Date()
            });
        }
        // Warning: Battery
        if (slot.battery > 0 && slot.battery < 20) {
            incidents.push({
                slotId: slot.id,
                severity: 'warning',
                title: `Baterai Lemah < 20% (Slot ${slot.id})`,
                desc: `Level baterai ${slot.battery}%. Standby current: 200uA. Segera lakukan penggantian baterai/cek panel surya.`,
                time: new Date()
            });
        }
        // Warning: Offline
        if (slot.status === 'offline') {
            incidents.push({
                slotId: slot.id,
                severity: 'warning',
                title: `Koneksi Terputus (Slot ${slot.id})`,
                desc: `Perangkat tidak mengirim telemetri. Sinyal: 0%. Periksa konektivitas Gateway BLE.`,
                time: new Date()
            });
        }
    });

    alertCountBadge.innerText = incidents.length;
    alertCountBadge.style.display = incidents.length > 0 ? 'inline-block' : 'none';

    if (incidents.length === 0) {
        incidentFeed.innerHTML = `
            <div class="empty-feed-placeholder">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
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

// Manual Action Resolve Incidents
window.resolveIncident = function(slotId) {
    const slot = parkingSlots.find(s => s.id === slotId);
    if (!slot) return;
    
    let text = '';
    if (slot.status === 'error') {
        slot.status = slot.plate ? 'occupied' : 'vacant';
        slot.errorCode = null;
        slot.errorMsg = '';
        text = `Operator menyelesaikan investigasi Slot ${slotId}. Alarm kesalahan berhasil di-reset.`;
    } else if (slot.battery < 20) {
        slot.battery = 85;
        slot.solar = true;
        text = `Aki lead-acid Slot ${slotId} diganti. Daya terisi penuh kembali.`;
    } else if (slot.status === 'offline') {
        slot.status = 'vacant';
        slot.signal = 90;
        slot.battery = 78;
        text = `Koneksi Gateway BLE dengan perangkat Slot ${slotId} dipulihkan.`;
    }

    addActivityLog(slotId, 'override', text, 'Bripda Setiawan (Manual)');
    showToast('Resolusi Sukses', `Masalah Slot ${slotId} berhasil ditandai selesai.`, 'success');
    
    renderGrid();
    renderIncidents();
    renderLogs();
};

// Render Logs Table
function renderLogs() {
    if (!logsBody) return;
    logsBody.innerHTML = '';
    
    let filteredLogs = activityLogs.filter(log => {
        if (activeFilters.slot && !log.slot.includes(activeFilters.slot)) return false;
        if (activeFilters.type !== 'all' && log.type !== activeFilters.type) return false;
        return true;
    });

    if (filteredLogs.length === 0) {
        logsBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 16px;">Tidak ada log aktivitas.</td></tr>`;
        return;
    }

    filteredLogs.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${log.time.toLocaleTimeString('id-ID')}</td>
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

function addActivityLog(slot, type, text, user = 'Sistem') {
    activityLogs.unshift({ time: new Date(), slot, type, text, user });
    if (activityLogs.length > 50) activityLogs.pop();
}

// ──────────────────────────────────────────────────────────────
// 5. TAB 2: ANALITIK PENDAPATAN & KEUANGAN
// ──────────────────────────────────────────────────────────────

function renderAnalyticsTab() {
    // 1. Calculate KPIs
    let totalRevenue = 65000 + auditTransactions.reduce((acc, curr) => acc + curr.amount, 0);
    let totalTransactions = 8 + auditTransactions.length;
    let occupancyCount = parkingSlots.filter(s => s.status === 'occupied' || (s.status === 'error' && s.plate)).length;
    let occupancyRate = Math.round((occupancyCount / parkingSlots.length) * 100);
    let leakageTotal = parkingSlots.filter(s => s.errorCode === 0x20).reduce((acc, curr) => acc + 15000, 0); // e.g. Rp 15.000 leakage for Slot 10

    document.getElementById('kpi-revenue').innerText = `Rp ${totalRevenue.toLocaleString('id-ID')}`;
    document.getElementById('kpi-transactions').innerText = `${totalTransactions} Transaksi`;
    document.getElementById('kpi-occupancy').innerText = `${occupancyRate}%`;
    document.getElementById('kpi-leakage').innerText = `Rp ${leakageTotal.toLocaleString('id-ID')}`;

    // 2. Render Custom SVG Charts
    renderHourlyRevenueChart();
    renderDurationRevenueChart();

    // 3. Render Finance Audit Table
    renderAuditTable();
}

// Render Hourly Revenue Chart (SVG Dynamic)
function renderHourlyRevenueChart() {
    const container = document.getElementById('hourly-revenue-chart');
    if (!container) return;

    // Hourly data points: [Hour, Revenue]
    const data = [
        { label: '06:00', val: 14000 },
        { label: '09:00', val: 32000 },
        { label: '12:00', val: 78000 },
        { label: '15:00', val: 45000 },
        { label: '18:00', val: 98000 },
        { label: '21:00', val: 24000 }
    ];

    const width = 450;
    const height = 180;
    const padding = 25;

    // Find max value for scaling
    const maxVal = Math.max(...data.map(d => d.val));
    
    // Draw SVG
    let svgContent = `
        <svg viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.4"/>
                    <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <!-- Grid Lines -->
            <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis" />
            <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="chart-axis" />
            
            <line x1="${padding}" y1="${padding + (height - 2*padding)*0.25}" x2="${width - padding}" y2="${padding + (height - 2*padding)*0.25}" class="chart-grid-line" />
            <line x1="${padding}" y1="${padding + (height - 2*padding)*0.5}" x2="${width - padding}" y2="${padding + (height - 2*padding)*0.5}" class="chart-grid-line" />
            <line x1="${padding}" y1="${padding + (height - 2*padding)*0.75}" x2="${width - padding}" y2="${padding + (height - 2*padding)*0.75}" class="chart-grid-line" />
    `;

    // Map points coordinates
    let points = [];
    const stepX = (width - 2 * padding) / (data.length - 1);
    data.forEach((d, i) => {
        const x = padding + i * stepX;
        const y = height - padding - (d.val / maxVal) * (height - 2 * padding);
        points.push({ x, y, label: d.label, val: d.val });
    });

    // Draw area under curve
    let pathArea = `M ${points[0].x} ${height - padding} `;
    points.forEach(p => {
        pathArea += `L ${p.x} ${p.y} `;
    });
    pathArea += `L ${points[points.length - 1].x} ${height - padding} Z`;
    svgContent += `<path d="${pathArea}" class="chart-area" />`;

    // Draw line
    let pathLine = `M ${points[0].x} ${points[0].y} `;
    for (let i = 1; i < points.length; i++) {
        pathLine += `L ${points[i].x} ${points[i].y} `;
    }
    svgContent += `<path d="${pathLine}" class="chart-line" />`;

    // Draw dots and text labels
    points.forEach(p => {
        svgContent += `
            <circle cx="${p.x}" cy="${p.y}" r="4.5" class="chart-dot" />
            <text x="${p.x}" y="${height - padding + 15}" text-anchor="middle" class="chart-text">${p.label}</text>
            <text x="${p.x}" y="${p.y - 8}" text-anchor="middle" class="chart-text" style="font-weight: 700; fill: #fff;">Rp ${(p.val/1000)}k</text>
        `;
    });

    svgContent += `</svg>`;
    container.innerHTML = svgContent;
}

// Render Duration vs Revenue scatter plot (SVG Dynamic)
function renderDurationRevenueChart() {
    const container = document.getElementById('duration-revenue-chart');
    if (!container) return;

    // Scatter points: [Duration in min, Revenue in IDR]
    const data = [
        { dur: 15, rev: 3000, slot: '05' },
        { dur: 45, rev: 8000, slot: '02' },
        { dur: 65, rev: 8000, slot: '09' },
        { dur: 110, rev: 18000, slot: '03' },
        { dur: 180, rev: 18000, slot: '08' },
        { dur: 30, rev: 3000, slot: '10' },
        { dur: 60, rev: 8000, slot: '06' },
        { dur: 120, rev: 13000, slot: '01' }
    ];

    const width = 450;
    const height = 180;
    const padding = 25;

    const maxDur = 200;
    const maxRev = 25000;

    let svgContent = `
        <svg viewBox="0 0 ${width} ${height}">
            <!-- Axes -->
            <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" class="chart-axis" />
            <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" class="chart-axis" />
            
            <!-- Axis Labels -->
            <text x="${width - padding}" y="${height - padding - 5}" text-anchor="end" class="chart-text" style="font-size: 8px;">Durasi (Mnt)</text>
            <text x="${padding + 8}" y="${padding + 10}" text-anchor="start" class="chart-text" style="font-size: 8px;">Tarif (Rp)</text>
            
            <!-- Trend Line -->
            <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${padding + 40}" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.6"/>
    `;

    // Map and render scatter dots
    data.forEach(d => {
        const x = padding + (d.dur / maxDur) * (width - 2 * padding);
        const y = height - padding - (d.rev / maxRev) * (height - 2 * padding);
        svgContent += `
            <circle cx="${x}" cy="${y}" r="5" class="chart-scatter-dot" />
            <text x="${x}" y="${y - 8}" text-anchor="middle" class="chart-text" style="font-size: 8px; fill: #fff;">${d.slot}</text>
        `;
    });

    // Horizontal helper labels
    const helperTicks = [5000, 15000, 25000];
    helperTicks.forEach(tick => {
        const y = height - padding - (tick / maxRev) * (height - 2 * padding);
        svgContent += `
            <line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" class="chart-grid-line" />
            <text x="${padding - 4}" y="${y + 3}" text-anchor="end" class="chart-text">${tick/1000}k</text>
        `;
    });

    // Vertical helper labels
    const helperDur = [50, 100, 150];
    helperDur.forEach(tick => {
        const x = padding + (tick / maxDur) * (width - 2 * padding);
        svgContent += `
            <line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" class="chart-grid-line" />
            <text x="${x}" y="${height - padding + 12}" text-anchor="middle" class="chart-text">${tick}m</text>
        `;
    });

    svgContent += `</svg>`;
    container.innerHTML = svgContent;
}

// Render Audit Transactions table list
function renderAuditTable() {
    if (!auditTableBody) return;
    auditTableBody.innerHTML = '';
    
    // Auto sync from current parking slots first to show live slots
    let liveTxns = [];
    
    // Add occupied slots to active audit txns list
    parkingSlots.forEach(s => {
        if (s.plate) {
            liveTxns.push({
                id: `TXN-${s.entryTime ? s.entryTime.getTime().toString().slice(-6) : '826'}-A${s.id}`,
                slot: s.id,
                entryTime: s.entryTime ? s.entryTime.toLocaleTimeString('id-ID') : '08:41:02',
                exitTime: '--:--:--',
                duration: `${s.duration} mnt`,
                amount: s.cost,
                method: 'QRIS (Dynamic)',
                crosscheck: s.status === 'error' ? 'MANUAL_NEEDED' : 'VERIFIED',
                status: 'ACTIVE'
            });
        }
    });

    let allTxns = [...liveTxns, ...auditTransactions];

    allTxns.forEach(t => {
        const row = document.createElement('tr');
        
        let crossPill = '';
        if (t.crosscheck === 'VERIFIED') {
            crossPill = `<span class="log-badge type-payment">Auto Verified</span>`;
        } else if (t.crosscheck === 'MANUAL_OVERRIDE') {
            crossPill = `<span class="log-badge type-override">Manual Override</span>`;
        } else {
            crossPill = `<span class="log-badge type-error" style="animation: flash-red 2s infinite;">Pengecekan Manual</span>`;
        }

        let statusPill = '';
        if (t.status === 'PAID') {
            statusPill = `<span style="color: var(--status-vacant); font-weight: 700;">Paid (Selesai)</span>`;
        } else {
            statusPill = `<span style="color: var(--status-transition); font-weight: 700;">Active (Berjalan)</span>`;
        }

        row.innerHTML = `
            <td style="font-family: monospace; color: var(--text-accent);">${t.id}</td>
            <td><strong style="color: #fff;">Slot ${t.slot}</strong></td>
            <td>${t.entryTime}</td>
            <td>${t.exitTime}</td>
            <td>${t.duration}</td>
            <td><strong>Rp ${t.amount.toLocaleString('id-ID')}</strong></td>
            <td>${t.method}</td>
            <td>${crossPill}</td>
            <td>${statusPill}</td>
        `;
        
        auditTableBody.appendChild(row);
    });
}

// CSV Export Logic
btnExportCsv.addEventListener('click', function() {
    let csvContent = 'ID Transaksi,Slot,Waktu Masuk,Waktu Keluar,Total Durasi,Nominal (IDR),Metode Pembayaran,Crosscheck Palang,Status\n';
    
    // Construct rows
    let liveTxns = [];
    parkingSlots.forEach(s => {
        if (s.plate) {
            liveTxns.push({
                id: `TXN-${s.entryTime ? s.entryTime.getTime().toString().slice(-6) : '826'}-A${s.id}`,
                slot: s.id,
                entryTime: s.entryTime ? s.entryTime.toLocaleTimeString('id-ID') : '08:41:02',
                exitTime: 'Active',
                duration: `${s.duration} min`,
                amount: s.cost,
                method: 'QRIS (Dynamic)',
                crosscheck: s.status === 'error' ? 'MANUAL_NEEDED' : 'VERIFIED',
                status: 'ACTIVE'
            });
        }
    });
    
    let allTxns = [...liveTxns, ...auditTransactions];
    
    allTxns.forEach(t => {
        csvContent += `${t.id},Slot ${t.slot},${t.entryTime},${t.exitTime},${t.duration},${t.amount},${t.method},${t.crosscheck},${t.status}\n`;
    });
    
    // Download File in Browser
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "bss_parking_finance_audit_report.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('Ekspor Berhasil', 'File Laporan Keuangan CSV berhasil diunduh.', 'success');
});

// ──────────────────────────────────────────────────────────────
// 6. MODALS & MAINTENANCE OVERRIDES (V2 Reset commands support)
// ──────────────────────────────────────────────────────────────

function openQuickActionPanel(slot) {
    selectedSlot = slot;
    
    modalSlotId.innerText = slot.id;
    modalStatusText.innerText = getStatusLabel(slot.status);
    
    modalStatusText.className = 'val status-pill';
    if (slot.status === 'vacant') modalStatusText.classList.add('btn-green');
    else if (slot.status === 'occupied') modalStatusText.classList.add('btn-red');
    else if (slot.status === 'offline') modalStatusText.classList.add('btn-secondary');
    else modalStatusText.classList.add('btn-red');
    
    modalPlate.innerText = slot.plate || 'Kosong (Tersedia)';
    modalBattery.innerText = `${slot.battery}%`;
    modalSolarStatus.innerText = slot.solar ? 'Panel Surya: Aktif Mengisi Daya' : 'Panel Surya: Tidak Mengisi Daya';
    modalSolarStatus.style.color = slot.solar ? '#10b981' : '#ef4444';
    
    modalSignal.innerText = slot.signal ? `${slot.signal}%` : 'OFFLINE';
    modalSignalLabel.innerText = getSignalLabel(slot.signal);
    
    modalDuration.innerText = slot.duration ? `${slot.duration} menit` : '0 mnt';
    modalCheckinTime.innerText = slot.entryTime ? `Check-in: ${slot.entryTime.toLocaleTimeString('id-ID')}` : 'Check-in: -';
    modalCost.innerText = `Rp ${slot.cost.toLocaleString('id-ID')}`;
    
    // Display Standby current details
    modalCurrentDraw.innerText = `Arus Saat Ini: ${slot.standbyUa.toLocaleString('id-ID')} uA`;
    modalCurrentDraw.style.color = slot.standbyUa < 500 ? '#10b981' : '#a78bfa';

    // Reset safety override panel
    safetyBypassCheckbox.checked = false;
    document.querySelector('.safety-lock-card').classList.remove('unlocked');
    overrideFormElements.classList.add('disabled-state');
    overrideReasonSelect.value = '';
    overrideCustomReason.value = '';
    btnRaiseLock.disabled = true;
    btnLowerLock.disabled = true;
    btnResetLock.disabled = true;
    hexPreview.innerText = 'Silakan pilih perintah...';
    
    quickActionModal.classList.add('active');
}

function getSignalLabel(val) {
    if (!val) return 'Malfungsi Jaringan';
    if (val >= 90) return 'Sangat Baik (LTE/BLE)';
    if (val >= 60) return 'Baik (Sinyal Stabil)';
    return 'Cukup (Sinyal Lemah)';
}

// Safety Check Trigger
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
        btnResetLock.disabled = true;
    }
});

overrideReasonSelect.addEventListener('change', updateOverrideButtons);

function updateOverrideButtons() {
    if (!safetyBypassCheckbox.checked || !overrideReasonSelect.value) {
        btnRaiseLock.disabled = true;
        btnLowerLock.disabled = true;
        btnResetLock.disabled = true;
        hexPreview.innerText = 'Pilih alasan audit untuk melihat command...';
        return;
    }

    btnRaiseLock.disabled = false;
    btnLowerLock.disabled = false;
    btnResetLock.disabled = false;
    
    hexPreview.innerHTML = `
        Reset: <span style="color: #3b82f6;">${HEX_RESET}</span> | 
        Naik: <span style="color: #f59e0b;">${HEX_RAISE}</span> | 
        Turun: <span style="color: #10b981;">${HEX_LOWER}</span>
    `;
}

// Close Modal
document.getElementById('modal-close-btn').addEventListener('click', () => {
    quickActionModal.classList.remove('active');
    selectedSlot = null;
});

// Click handlers
btnRaiseLock.addEventListener('click', () => triggerOverrideConfirmation('KUNCI_SLOT', HEX_RAISE));
btnLowerLock.addEventListener('click', () => triggerOverrideConfirmation('BUKA_PAKSA', HEX_LOWER));
btnResetLock.addEventListener('click', () => triggerOverrideConfirmation('REBOOT_DEVICE', HEX_RESET));

// Confirm dialog trigger
let pendingCommand = null;

function triggerOverrideConfirmation(action, hex) {
    const reasonText = overrideReasonSelect.value + (overrideCustomReason.value ? ` (${overrideCustomReason.value})` : '');
    
    confSlotId.innerText = selectedSlot.id;
    if (action === 'KUNCI_SLOT') confAction.innerText = 'LOCKOUT (Naikkan Palang)';
    else if (action === 'BUKA_PAKSA') confAction.innerText = 'LOCK-DOWN (Turunkan Palang)';
    else confAction.innerText = 'RESET DEVICE (Reboot Perangkat)';
    
    confHex.innerText = hex;
    confReason.innerText = reasonText;
    
    pendingCommand = { action, hex, reason: reasonText, slotId: selectedSlot.id };
    confirmModal.classList.add('active');
}

// Cancel confirm dialog
btnConfirmCancel.addEventListener('click', () => {
    confirmModal.classList.remove('active');
    pendingCommand = null;
});

// Submit confirm dialog (EXECUTION)
btnConfirmSubmit.addEventListener('click', async () => {
    if (!pendingCommand) return;
    
    const { action, hex, reason, slotId } = pendingCommand;
    const slot = parkingSlots.find(s => s.id === slotId);
    
    confirmModal.classList.remove('active');
    quickActionModal.classList.remove('active');
    
    showToast('Mengirim Command', `Mengirim perintah ${hex} ke perangkat Slot ${slotId}...`, 'info');
    
    if (action === 'REBOOT_DEVICE') {
        const oldStatus = slot.status;
        slot.status = 'offline';
        renderGrid();
        
        addActivityLog(slotId, 'override', `Mengirim perintah Reset Device [${HEX_RESET}]. Alasan: "${reason}"`, 'Bripda Setiawan (Manual)');
        renderLogs();
        
        // Reboot delay simulation (3 seconds)
        setTimeout(() => {
            slot.status = slot.plate ? 'occupied' : 'vacant';
            slot.errorCode = null;
            slot.errorMsg = '';
            slot.battery = 82;
            slot.signal = 94;
            slot.standbyUa = slot.status === 'vacant' ? 240 : 11800;
            
            addActivityLog(slotId, 'telemetry', `Slot ${slotId} berhasil reboot dan terhubung kembali. Baterai: 82%, Sinyal: 94%.`, 'Sistem');
            showToast('Reboot Berhasil', `Slot ${slotId} berhasil dinyalakan ulang.`, 'success');
            
            renderGrid();
            renderIncidents();
            renderLogs();
        }, 3000);
    } else {
        // Raise / Lower
        slot.status = action === 'KUNCI_SLOT' ? 'raising' : 'lowering';
        renderGrid();
        
        addActivityLog(slotId, 'override', `Mengirim perintah override manual. Hex: ${hex}. Alasan: "${reason}"`, 'Bripda Setiawan (Manual)');
        renderLogs();
        
        setTimeout(() => {
            if (action === 'KUNCI_SLOT') {
                slot.status = 'occupied';
                slot.plate = 'B 777 VIP';
                slot.entryTime = new Date();
                slot.duration = 1;
                slot.cost = 3000;
                slot.standbyUa = 12000;
                slot.errorCode = null;
                addActivityLog(slotId, 'telemetry', `Slot ${slotId} terangkat penuh (Palang Naik 90°). Plat: ${slot.plate}.`, 'Sensor Fusion');
                showToast('Override Sukses', `Slot ${slotId} berhasil dikunci.`, 'success');
            } else {
                slot.status = 'vacant';
                slot.plate = '';
                slot.entryTime = null;
                slot.duration = 0;
                slot.cost = 0;
                slot.standbyUa = 240;
                slot.errorCode = null;
                addActivityLog(slotId, 'telemetry', `Slot ${slotId} turun penuh (Palang Turun 0°).`, 'Sensor Fusion');
                showToast('Override Sukses', `Slot ${slotId} berhasil diturunkan.`, 'success');
            }
            
            renderGrid();
            renderIncidents();
            renderLogs();
        }, 2000);
    }
    
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
    
    toastNotif.className = 'toast-notification';
    toastNotif.classList.add(`toast-${type === 'info' ? 'success' : type}`);
    
    if (type === 'success') toastIcon.innerHTML = '✓';
    else if (type === 'error') toastIcon.innerHTML = '✖';
    else toastIcon.innerHTML = 'ℹ';
    
    toastNotif.classList.add('active');
    setTimeout(() => { toastNotif.classList.remove('active'); }, 4000);
}

// ──────────────────────────────────────────────────────────────
// 8. LIVE TELEMETRY TICK & PEAK HOUR SIMULATIONS
// ──────────────────────────────────────────────────────────────

// Ticker to update elapsed parking durations and pulsate telemetry lights
setInterval(() => {
    const tick = document.getElementById('telemetry-tick-indicator');
    if (tick) {
        tick.classList.add('active');
        setTimeout(() => { tick.classList.remove('active'); }, 400);
    }
    
    parkingSlots.forEach(slot => {
        if (slot.status === 'occupied' && slot.entryTime) {
            const elapsed = Math.floor((Date.now() - slot.entryTime.getTime()) / 60000);
            slot.duration = elapsed;
            
            // Calculate Parking Fee: Rp 3.000 first 30 mins, then Rp 5.000/hour
            let amount = 3000;
            if (elapsed > 30) {
                amount += Math.ceil((elapsed - 30) / 60) * 5000;
            }
            slot.cost = Math.min(amount, 50000); // Daily cap Rp 50.000
        }
    });
    
    renderGrid();
    
    // If active tab is analytics, redraw values
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab && activeTab.getAttribute('data-tab') === 'analytics') {
        renderAnalyticsTab();
    }
}, 2000);

// Randomly simulate real-world events (vehicle entering/paying/errors) to make dashboard feel alive
setInterval(() => {
    if (Math.random() > 0.7) {
        simulateLiveEvent();
    }
}, 20000);

function simulateLiveEvent() {
    const vacantSlots = parkingSlots.filter(s => s.status === 'vacant');
    const occupiedSlots = parkingSlots.filter(s => s.status === 'occupied');
    
    if (vacantSlots.length > 0 && Math.random() > 0.4) {
        // Vehicle arriving
        const randomSlot = vacantSlots[Math.floor(Math.random() * vacantSlots.length)];
        const plates = ['B 9192 OP', 'D 404 KPL', 'B 727 TPP', 'DK 8888 XY', 'AD 2026 GG'];
        const plate = plates[Math.floor(Math.random() * plates.length)];
        
        randomSlot.status = 'occupied';
        randomSlot.plate = plate;
        randomSlot.entryTime = new Date();
        randomSlot.duration = 1;
        randomSlot.cost = 3000;
        randomSlot.standbyUa = 11800;
        
        addActivityLog(randomSlot.id, 'telemetry', `Kendaraan terdeteksi pada Slot ${randomSlot.id} (Plat: ${plate}). Palang dinaikkan otomatis.`, 'Sensor Fusion');
        showToast('Mobil Masuk', `Kendaraan masuk di Slot ${randomSlot.id} (${plate})`, 'info');
        
        renderGrid();
        renderLogs();
    } else if (occupiedSlots.length > 0) {
        // Vehicle paying and leaving
        const randomSlot = occupiedSlots[Math.floor(Math.random() * occupiedSlots.length)];
        
        addActivityLog(randomSlot.id, 'payment', `Transaksi Sukses via Gopay: Rp ${randomSlot.cost.toLocaleString('id-ID')} untuk Slot ${randomSlot.id}. Palang diturunkan otomatis.`, 'Midtrans Webhook');
        showToast('Pembayaran Berhasil', `Slot ${randomSlot.id} dibayar. Palang diturunkan.`, 'success');
        
        // Add to historical audits
        auditTransactions.unshift({
            id: `TXN-${Date.now().toString().slice(-6)}-A${randomSlot.id}`,
            slot: randomSlot.id,
            entryTime: randomSlot.entryTime ? randomSlot.entryTime.toLocaleTimeString('id-ID') : '08:00:00',
            exitTime: new Date().toLocaleTimeString('id-ID'),
            duration: `${randomSlot.duration} mnt`,
            amount: randomSlot.cost,
            method: 'QRIS (Midtrans)',
            crosscheck: 'VERIFIED',
            status: 'PAID'
        });
        if (auditTransactions.length > 30) auditTransactions.pop();

        randomSlot.status = 'lowering';
        renderGrid();
        renderLogs();
        
        setTimeout(() => {
            randomSlot.status = 'vacant';
            randomSlot.plate = '';
            randomSlot.entryTime = null;
            randomSlot.duration = 0;
            randomSlot.cost = 0;
            randomSlot.standbyUa = 240;
            
            addActivityLog(randomSlot.id, 'telemetry', `Slot ${randomSlot.id} kosong. Palang diturunkan penuh (0°).`, 'Sensor Fusion');
            renderGrid();
            renderIncidents();
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

import { db, ref, set, push, update, remove, onValue } from './firebase-config.js';

// DOM Elements & Initial State
const DEFAULT_MOBIL = ["Buka pintu kendaraan", "Ucapkan salam & senyum", "Tanyakan jenis BBM & nominal", "Cek nol meter (tunjukkan ke customer)", "Isi BBM sesuai permintaan", "Tunjukkan meter akhir", "Terima pembayaran & hitung kembalian", "Ucapkan terima kasih", "Arahkan keluar dengan aman"];
const DEFAULT_MOTOR = ["Ucapkan salam & senyum", "Tanyakan jenis BBM & nominal", "Minta matikan mesin", "Cek nol meter (tunjukkan ke customer)", "Isi BBM sesuai permintaan", "Tunjukkan meter akhir", "Terima pembayaran & hitung kembalian", "Ucapkan terima kasih"];

let allRecords = [];

// ==========================================
// THEME
// ==========================================
const THEME_PALETTES = {
  orange: { primary: '#F15800', hover: '#D94500', bg: '#FFF0E6', light: '#fed7aa' },
  blue: { primary: '#2563EB', hover: '#1D4ED8', bg: '#EFF6FF', light: '#93c5fd' },
  emerald: { primary: '#059669', hover: '#047857', bg: '#ECFDF5', light: '#6ee7b7' },
  purple: { primary: '#7C3AED', hover: '#6D28D9', bg: '#F5F3FF', light: '#c4b5fd' },
  red: { primary: '#DC2626', hover: '#B91C1C', bg: '#FEF2F2', light: '#fca5a5' },
  slate: { primary: '#334155', hover: '#1E293B', bg: '#F1F5F9', light: '#cbd5e1' }
};

function applyTheme(themeKey) {
  localStorage.setItem('spbu_theme', themeKey);
  const t = THEME_PALETTES[themeKey] || THEME_PALETTES['orange'];
  document.documentElement.style.setProperty('--primary', t.primary);
  document.documentElement.style.setProperty('--primary-hover', t.hover);
  document.documentElement.style.setProperty('--primary-bg', t.bg);
  document.documentElement.style.setProperty('--primary-light', t.light);
}

const savedTheme = localStorage.getItem('spbu_theme');
if (savedTheme) applyTheme(savedTheme);

// Dark Mode (personal, shared via localStorage)
if (localStorage.getItem('spbu_dark_mode') === 'true') document.documentElement.classList.add('dark-mode');

onValue(ref(db, 'settings/theme'), snap => {
  const theme = snap.val();
  if (theme) applyTheme(theme);
});
let currentTab = 'Mobil';
let checkedItems = new Set();
let sopTab = 'Mobil';
let editingKaryawanRecord = null;
let editingSopRecord = null;
let currentRekapFilter = 'hari';
let customStartDate = null;
let customEndDate = null;
let sopViolationChart = null;
let monthlyCheckDone = false;

let centralUsers = [];

// Helpers to get typed records
function getChecklists() { return allRecords.filter(r => r.type === 'checklist'); }
function getKaryawanRecords() { return centralUsers; }
function getSopRecords(cat) { return allRecords.filter(r => r.type === (cat === 'Mobil' ? 'sop_mobil' : 'sop_motor')).sort((a, b) => (a.order_index || 0) - (b.order_index || 0)); }
function getSopItems(cat) {
    const records = getSopRecords(cat);
    if (records.length === 0) return cat === 'Mobil' ? [...DEFAULT_MOBIL] : [...DEFAULT_MOTOR];
    return records.map(r => r.name);
}

// Attach functions to window so inline onclick handlers work
window.showPage = showPage;
window.switchTab = switchTab;
window.submitChecklist = submitChecklist;

window.switchSopTab = switchSopTab;
window.addSopItem = addSopItem;
window.editSopItem = editSopItem;
window.deleteSopItem = deleteSopItem;
window.moveSop = moveSop;
window.switchFilter = switchFilter;
window.applyCustomDateFilter = applyCustomDateFilter;
window.showResetConfirm = showResetConfirm;
window.hideResetConfirm = hideResetConfirm;
window.closeDeleteModal = closeDeleteModal;
window.confirmResetData = confirmResetData;
window.downloadMonthlyPDF = downloadMonthlyPDF;
window.closeMonthlyModal = closeMonthlyModal;
window.downloadAndResetOldData = downloadAndResetOldData;

// Navigation
function showPage(page) {
    ['ceklis', 'karyawan', 'sop', 'rekap'].forEach(p => {
        document.getElementById('page-' + p).classList.toggle('hidden', p !== page);
        document.getElementById('nav-' + p).classList.toggle('nav-active', p === page);
    });
    if (page === 'karyawan') renderKaryawan();
    if (page === 'sop') renderSopList();
    if (page === 'ceklis') { populateOperatorSelect(); renderChecklist(); }
    if (page === 'rekap') {
        renderRekap(currentRekapFilter);
        renderViolationChart();
        checkOldMonthlyData();
    }
}

// === CEKLIS ===
function populateOperatorSelect() {
    const sel = document.getElementById('operator');
    const list = getKaryawanRecords().map(r => r.name);
    sel.innerHTML = '<option value="">-- Pilih Operator --</option>' + list.map(k => `<option value="${k}">${k}</option>`).join('');
}

function switchTab(tab) {
    currentTab = tab; checkedItems.clear();
    document.getElementById('tab-mobil').className = tab === 'Mobil' ? 'tab-active flex-1 py-2 rounded-lg font-medium' : 'tab-inactive flex-1 py-2 rounded-lg font-medium';
    document.getElementById('tab-motor').className = tab === 'Motor' ? 'tab-active flex-1 py-2 rounded-lg font-medium' : 'tab-inactive flex-1 py-2 rounded-lg font-medium';
    renderChecklist(); updateScore();
}

function renderChecklist() {
    const sopRecords = getSopRecords(currentTab);
    const container = document.getElementById('checklist-container');

    // If no SOP items exist, show empty state
    if (sopRecords.length === 0) {
        container.innerHTML = `<div class="border-dashed border-2 rounded-lg p-6 text-center opacity-60 bg-gray-50">
  <p class="text-sm">Belum ada item SOP untuk kategori ${currentTab}</p>
  <p class="text-xs text-gray-500 mt-2">Tambahkan item di halaman "Kelola SOP"</p>
</div>`;
        document.getElementById('score-display').textContent = '0%';
        return;
    }

    container.innerHTML = '';
    sopRecords.forEach((record, i) => {
        const div = document.createElement('div');
        div.className = 'check-item border rounded-lg px-4 py-3 cursor-pointer flex items-center gap-3 select-none bg-white';
        div.innerHTML = `<span class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${checkedItems.has(i) ? 'bg-green-500 border-green-500 text-white' : 'border-gray-400'}">${checkedItems.has(i) ? '✓' : ''}</span><span class="text-sm">${i + 1}. ${record.name}</span>`;
        if (checkedItems.has(i)) div.classList.add('checked');
        div.onclick = () => { checkedItems.has(i) ? checkedItems.delete(i) : checkedItems.add(i); renderChecklist(); updateScore(); };
        container.appendChild(div);
    });
}

function updateScore() {
    const sopRecords = getSopRecords(currentTab);
    const total = sopRecords.length;
    const pct = total ? Math.round((checkedItems.size / total) * 100) : 0;
    document.getElementById('score-display').textContent = pct + '%';
}

async function submitChecklist() {
    const sopRecords = getSopRecords(currentTab);
    const name = document.getElementById('operator').value;
    const shift = document.getElementById('shift').value;
    
    if (!name) { showFeedback('⚠️ Pilih operator', 'text-red-600'); return; }
    if (sopRecords.length === 0) { showFeedback('⚠️ Tambahkan item SOP terlebih dahulu', 'text-red-600'); return; }
    if (checkedItems.size === 0) { showFeedback('⚠️ Centang minimal 1 item', 'text-red-600'); return; }
    
    const items = sopRecords.map(r => r.name);
    const score = Math.round((checkedItems.size / items.length) * 100);
    const checklist_data = JSON.stringify(Array.from(checkedItems).map(i => items[i]));
    
    const btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.style.opacity = '0.6';
    
    try {
        await set(push(ref(db, 'ceklissop/records')), { 
            type: 'checklist', 
            operator_name: name, 
            shift, 
            category: currentTab, 
            checklist_data, 
            score, 
            date: new Date().toISOString() 
        });
        showFeedback('✅ Tersimpan!', 'text-green-600'); 
        checkedItems.clear(); 
        renderChecklist(); 
        updateScore();
    } catch (e) {
        console.error(e);
        showFeedback('❌ Gagal menyimpan', 'text-red-600');
    }
    btn.disabled = false; btn.style.opacity = '1';
}

function showFeedback(msg, cls) {
    const el = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `p-3 rounded shadow bg-white border-l-4 ${cls.includes('green') ? 'border-green-500' : 'border-red-500'} ${cls}`;
    toast.textContent = msg;
    el.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}

function renderHistory() {
    const data = getChecklists();
    const list = document.getElementById('history-list');
    const empty = document.getElementById('empty-history');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayData = data.filter(r => { const d = new Date(r.date); return d >= today && d < tomorrow; });
    if (!todayData.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
    
    empty.classList.add('hidden');
    list.innerHTML = todayData.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map(r => {
        const d = new Date(r.date);
        const dateStr = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<div class="border rounded-lg p-3 bg-white flex justify-between items-center"><div><span class="font-medium">${r.operator_name}</span> <span class="text-xs opacity-60">${r.shift} • ${r.category}</span><div class="text-xs text-gray-500">${dateStr}</div></div><span class="text-lg font-bold ${r.score >= 80 ? 'text-green-600' : r.score >= 50 ? 'text-yellow-600' : 'text-red-600'}">${r.score}%</span></div>`;
    }).join('');
}

// === KARYAWAN ===
function renderKaryawan() {
    const records = getKaryawanRecords();
    const container = document.getElementById('karyawan-list');
    const empty = document.getElementById('empty-karyawan');
    if (!records.length) { container.innerHTML = ''; empty.classList.remove('hidden'); return; }
    
    empty.classList.add('hidden');
    container.innerHTML = records.map(k => `<div class="border rounded-lg p-3 bg-white flex justify-between items-center"><span class="font-medium">${k.name}</span><span class="text-xs text-gray-500">${k.position || ''}</span></div>`).join('');
}

// === KELOLA SOP ===
function switchSopTab(tab) {
    sopTab = tab; editingSopRecord = null;
    document.getElementById('sop-input').value = '';
    document.getElementById('sop-tab-mobil').className = tab === 'Mobil' ? 'tab-active flex-1 py-2 rounded-lg font-medium' : 'tab-inactive flex-1 py-2 rounded-lg font-medium';
    document.getElementById('sop-tab-motor').className = tab === 'Motor' ? 'tab-active flex-1 py-2 rounded-lg font-medium' : 'tab-inactive flex-1 py-2 rounded-lg font-medium';
    renderSopList();
}

function renderSopList() {
    const records = getSopRecords(sopTab);
    const container = document.getElementById('sop-list');
    const empty = document.getElementById('empty-sop');

    if (!records.length) { container.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    container.innerHTML = records.map((item, i) => {
        return `<div class="border rounded-lg p-3 bg-white flex justify-between items-center gap-2"><span class="text-sm flex-1">${i + 1}. ${item.name}</span><div class="flex gap-2 flex-shrink-0"><button class="text-blue-600 text-sm font-medium" onclick="moveSop('${item._key}',-1)" ${i === 0 ? 'disabled style="opacity:0.3"' : ''}>⬆️</button><button class="text-blue-600 text-sm font-medium" onclick="moveSop('${item._key}',1)" ${i === records.length - 1 ? 'disabled style="opacity:0.3"' : ''}>⬇️</button><button class="text-blue-600 text-sm font-medium" onclick="editSopItem('${item._key}')">Edit</button><button class="text-red-600 text-sm font-medium" onclick="deleteSopItem('${item._key}')">Hapus</button></div></div>`;
    }).join('');
    updateSopButtonLabel();
}

async function addSopItem() {
    const input = document.getElementById('sop-input');
    const val = input.value.trim();
    if (!val) return;
    const btn = document.getElementById('btn-add-sop');
    btn.disabled = true; btn.style.opacity = '0.6';
    
    const type = sopTab === 'Mobil' ? 'sop_mobil' : 'sop_motor';
    const path = `ceklissop/${type}`;

    try {
        if (editingSopRecord) {
            await update(ref(db, `${path}/${editingSopRecord._key}`), { name: val });
            editingSopRecord = null;
        } else {
            const records = getSopRecords(sopTab);
            const maxIdx = records.length > 0 ? Math.max(...records.map(r => r.order_index || 0)) : -1;
            await set(push(ref(db, path)), { type, name: val, order_index: maxIdx + 1 });
        }
        input.value = '';
    } catch(e) { showFeedback('❌ Gagal menyimpan', 'text-red-600'); }
    
    btn.disabled = false; btn.style.opacity = '1';
    updateSopButtonLabel();
}

function editSopItem(id) {
    const record = allRecords.find(r => r._key === id);
    if (!record) return;
    document.getElementById('sop-input').value = record.name;
    editingSopRecord = record;
    updateSopButtonLabel();
}

function deleteSopItem(id) {
    const record = allRecords.find(r => r._key === id);
    if (!record) return;
    const type = sopTab === 'Mobil' ? 'sop_mobil' : 'sop_motor';
    const modal = document.getElementById('delete-modal');
    document.getElementById('delete-modal-title').textContent = 'Hapus Item SOP?';
    document.getElementById('delete-modal-message').textContent = `"${record.name}"`;
    modal.classList.remove('hidden');
    document.getElementById('delete-confirm-btn').onclick = async () => {
        await remove(ref(db, `ceklissop/${type}/${record._key}`));
        editingSopRecord = null;
        modal.classList.add('hidden');
    };
}

async function moveSop(id, dir) {
    const records = getSopRecords(sopTab);
    const idx = records.findIndex(r => r._key === id);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= records.length) return;
    const a = records[idx], b = records[swapIdx];
    const aIdx = a.order_index, bIdx = b.order_index;
    
    const type = sopTab === 'Mobil' ? 'sop_mobil' : 'sop_motor';
    await update(ref(db, `ceklissop/${type}/${a._key}`), { order_index: bIdx });
    await update(ref(db, `ceklissop/${type}/${b._key}`), { order_index: aIdx });
}

function updateSopButtonLabel() {
    const btn = document.getElementById('btn-add-sop');
    btn.textContent = editingSopRecord ? 'Simpan' : 'Tambah';
}

// === REKAP ===
function switchFilter(filter) {
    currentRekapFilter = filter;
    ['hari', 'minggu', 'bulan', 'custom'].forEach(f => {
        document.getElementById('filter-' + f).className = f === filter ? 'tab-active flex-1 min-w-fit py-2 rounded-lg font-medium text-sm' : 'tab-inactive flex-1 min-w-fit py-2 rounded-lg font-medium text-sm';
    });
    document.getElementById('custom-date-section').classList.toggle('hidden', filter !== 'custom');
    renderRekap(filter);
    renderViolationChart();
}

function applyCustomDateFilter() {
    const s = document.getElementById('custom-start').value;
    const e = document.getElementById('custom-end').value;
    if (!s || !e) { showFeedback('⚠️ Pilih tanggal mulai dan akhir', 'text-red-600'); return; }
    customStartDate = new Date(s); customEndDate = new Date(e); customEndDate.setHours(23, 59, 59, 999);
    renderRekap('custom');
    renderViolationChart();
}

function getDateRange(filter) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    let start, end;
    if (filter === 'hari') { start = new Date(now); end = new Date(now); end.setHours(23, 59, 59, 999); }
    else if (filter === 'minggu') { start = new Date(now); const day = start.getDay(); start.setDate(start.getDate() - (day === 0 ? 6 : day - 1)); end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999); }
    else if (filter === 'bulan') { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0); end.setHours(23, 59, 59, 999); }
    else { start = customStartDate || new Date(0); end = customEndDate || new Date(0); }
    return { start, end };
}

function renderRekap(filter) {
    const { start, end } = getDateRange(filter);
    const checklists = getChecklists().filter(r => { const d = new Date(r.date); return d >= start && d <= end; });
    const container = document.getElementById('rekap-container');
    const empty = document.getElementById('empty-rekap');
    if (!checklists.length) { container.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    
    const grouped = {};
    checklists.forEach(r => {
        if (!grouped[r.operator_name]) grouped[r.operator_name] = { scores: [], count: 0 };
        grouped[r.operator_name].scores.push(r.score);
        grouped[r.operator_name].count++;
    });
    
    const sorted = Object.entries(grouped).map(([name, d]) => ({ 
        name, 
        avg: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length), 
        count: d.count, 
        min: Math.min(...d.scores), 
        max: Math.max(...d.scores) 
    })).sort((a, b) => b.avg - a.avg);
    
    container.innerHTML = sorted.map((d, idx) => {
        const badge = idx === 0 ? '⭐ ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : `${idx + 1}. `;
        const cls = d.avg >= 80 ? 'text-green-600' : d.avg >= 50 ? 'text-yellow-600' : 'text-red-600';
        return `<div class="border rounded-lg p-4 bg-white"><div class="flex justify-between items-start mb-2"><h3 class="font-bold text-base">${badge}${d.name}</h3><span class="text-lg font-bold ${cls}">${d.avg}%</span></div><div class="text-xs text-gray-600"><div>Penilaian: ${d.count}x</div><div>Rentang: ${d.min}% - ${d.max}%</div></div></div>`;
    }).join('');
}

// === RESET ===
function showResetConfirm() { document.getElementById('reset-modal').classList.remove('hidden'); }
function hideResetConfirm() { document.getElementById('reset-modal').classList.add('hidden'); }
function closeDeleteModal() { document.getElementById('delete-modal').classList.add('hidden'); }

async function confirmResetData() {
    const btn = document.getElementById('reset-confirm-btn');
    btn.disabled = true; btn.style.opacity = '0.6';
    const checklists = getChecklists();
    for (const r of checklists) { await remove(ref(db, 'ceklissop/records/' + r._key)); }
    btn.disabled = false; btn.style.opacity = '1';
    hideResetConfirm();
    showFeedback('✅ Data rekapan berhasil dihapus!', 'text-green-600');
}

// === GRAFIK SOP SERING DILANGGAR ===
function renderViolationChart() {
    const { start, end } = getDateRange(currentRekapFilter);
    const checklists = getChecklists().filter(r => { const d = new Date(r.date); return d >= start && d <= end; });
    const chartEmpty = document.getElementById('chart-empty');
    const canvas = document.getElementById('chart-sop-violations');
    
    if (!checklists.length) {
        if (sopViolationChart) { sopViolationChart.destroy(); sopViolationChart = null; }
        canvas.style.display = 'none';
        chartEmpty.classList.remove('hidden');
        return;
    }
    canvas.style.display = 'block';
    chartEmpty.classList.add('hidden');
    
    // Collect all SOP items and count how many times each was NOT checked
    const violationCount = {};
    checklists.forEach(r => {
        const cat = r.category || 'Mobil';
        const allSopItems = getSopItems(cat);
        let checkedArr = [];
        try { checkedArr = JSON.parse(r.checklist_data || '[]'); } catch(e) {}
        allSopItems.forEach(item => {
            if (!checkedArr.includes(item)) {
                violationCount[item] = (violationCount[item] || 0) + 1;
            }
        });
    });
    
    // Sort by most violated and take top 10
    const sorted = Object.entries(violationCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    if (!sorted.length) {
        if (sopViolationChart) { sopViolationChart.destroy(); sopViolationChart = null; }
        canvas.style.display = 'none';
        chartEmpty.classList.remove('hidden');
        return;
    }
    
    const labels = sorted.map(([name]) => name.length > 25 ? name.substring(0, 25) + '...' : name);
    const values = sorted.map(([, count]) => count);
    const colors = sorted.map((_, i) => {
        const hue = 0 + (i * 15);
        return `hsla(${hue}, 80%, 55%, 0.85)`;
    });
    
    if (sopViolationChart) sopViolationChart.destroy();
    sopViolationChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Jumlah Pelanggaran',
                data: values,
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace('0.85', '1')),
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => sorted[items[0].dataIndex][0],
                        label: (item) => `Tidak dipenuhi: ${item.raw}x`
                    }
                }
            },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { display: false } },
                y: { ticks: { font: { size: 10 } }, grid: { display: false } }
            }
        }
    });
}

// === REKAP BULANAN PDF ===
function getMonthName(m) {
    return ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'][m];
}

function buildPdfContent(checklists, monthLabel) {
    const grouped = {};
    checklists.forEach(r => {
        if (!grouped[r.operator_name]) grouped[r.operator_name] = { scores: [], records: [] };
        grouped[r.operator_name].scores.push(r.score);
        grouped[r.operator_name].records.push(r);
    });

    const sorted = Object.entries(grouped).map(([name, d]) => ({
        name,
        avg: Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length),
        count: d.records.length,
        min: Math.min(...d.scores),
        max: Math.max(...d.scores)
    })).sort((a, b) => b.avg - a.avg);

    const violationCount = {};
    checklists.forEach(r => {
        const cat = r.category || 'Mobil';
        const allSopItems = getSopItems(cat);
        let checkedArr = [];
        try { checkedArr = JSON.parse(r.checklist_data || '[]'); } catch(e) {}
        allSopItems.forEach(item => {
            if (!checkedArr.includes(item)) {
                violationCount[item] = (violationCount[item] || 0) + 1;
            }
        });
    });
    const topViolations = Object.entries(violationCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

    return `
    <div style="font-family:'DM Sans',Arial,sans-serif; padding:20px; max-width:700px; margin:auto;">
        <div style="text-align:center; margin-bottom:24px;">
            <h1 style="font-size:20px; font-weight:700; color:#1e3a5f; margin:0;">Rekap Ceklis SOP Bulanan</h1>
            <p style="font-size:14px; color:#666; margin:4px 0 0;">SPBU Gontor — ${monthLabel}</p>
            <p style="font-size:11px; color:#999; margin:2px 0 0;">Dicetak: ${new Date().toLocaleDateString('id-ID', { day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit' })}</p>
        </div>

        <h2 style="font-size:14px; font-weight:700; color:#1e3a5f; border-bottom:2px solid #1e40af; padding-bottom:4px; margin-bottom:12px;">Ringkasan per Karyawan</h2>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px;">
            <thead>
                <tr style="background:#1e40af; color:white;">
                    <th style="padding:8px 6px; text-align:left;">#</th>
                    <th style="padding:8px 6px; text-align:left;">Nama</th>
                    <th style="padding:8px 6px; text-align:center;">Penilaian</th>
                    <th style="padding:8px 6px; text-align:center;">Rata-rata</th>
                    <th style="padding:8px 6px; text-align:center;">Min</th>
                    <th style="padding:8px 6px; text-align:center;">Maks</th>
                </tr>
            </thead>
            <tbody>
                ${sorted.map((d, i) => `<tr style="background:${i % 2 === 0 ? '#f8fafc' : '#fff'}; border-bottom:1px solid #e2e8f0;">
                    <td style="padding:6px;">${i + 1}</td>
                    <td style="padding:6px; font-weight:500;">${d.name}</td>
                    <td style="padding:6px; text-align:center;">${d.count}x</td>
                    <td style="padding:6px; text-align:center; font-weight:700; color:${d.avg >= 80 ? '#16a34a' : d.avg >= 50 ? '#ca8a04' : '#dc2626'};">${d.avg}%</td>
                    <td style="padding:6px; text-align:center;">${d.min}%</td>
                    <td style="padding:6px; text-align:center;">${d.max}%</td>
                </tr>`).join('')}
            </tbody>
        </table>

        ${topViolations.length > 0 ? `
        <h2 style="font-size:14px; font-weight:700; color:#1e3a5f; border-bottom:2px solid #dc2626; padding-bottom:4px; margin-bottom:12px;">SOP Paling Sering Tidak Dipenuhi</h2>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px;">
            <thead>
                <tr style="background:#dc2626; color:white;">
                    <th style="padding:8px 6px; text-align:left;">#</th>
                    <th style="padding:8px 6px; text-align:left;">Item SOP</th>
                    <th style="padding:8px 6px; text-align:center;">Tidak Dipenuhi</th>
                </tr>
            </thead>
            <tbody>
                ${topViolations.map(([name, count], i) => `<tr style="background:${i % 2 === 0 ? '#fef2f2' : '#fff'}; border-bottom:1px solid #fecaca;">
                    <td style="padding:6px;">${i + 1}</td>
                    <td style="padding:6px;">${name}</td>
                    <td style="padding:6px; text-align:center; font-weight:700; color:#dc2626;">${count}x</td>
                </tr>`).join('')}
            </tbody>
        </table>
        ` : ''}

        <div style="text-align:center; font-size:10px; color:#aaa; margin-top:24px; border-top:1px solid #e2e8f0; padding-top:12px;">
            Total Penilaian: ${checklists.length} &bull; Digenerate otomatis oleh Sistem Ceklis SOP SPBU Gontor
        </div>
    </div>`;
}

function downloadMonthlyPDF() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    const checklists = getChecklists().filter(r => { const d = new Date(r.date); return d >= start && d <= end; });
    
    if (!checklists.length) {
        showFeedback('⚠️ Belum ada data bulan ini untuk diunduh', 'text-red-600');
        return;
    }
    
    const monthLabel = getMonthName(now.getMonth()) + ' ' + now.getFullYear();
    generateAndDownloadPDF(checklists, monthLabel, `Rekap_SOP_${monthLabel.replace(' ', '_')}`);
}

function generateAndDownloadPDF(checklists, monthLabel, filename) {
    const printArea = document.getElementById('pdf-print-area');
    printArea.innerHTML = buildPdfContent(checklists, monthLabel);
    printArea.style.display = 'block';
    
    html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: filename + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(printArea).save().then(() => {
        printArea.style.display = 'none';
        printArea.innerHTML = '';
        showFeedback('✅ PDF berhasil diunduh!', 'text-green-600');
    });
}

// === CEK DATA BULAN LALU & AUTO RESET ===
function getOldMonthChecklists() {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return getChecklists().filter(r => new Date(r.date) < thisMonthStart);
}

function checkOldMonthlyData() {
    if (monthlyCheckDone) return;
    const oldData = getOldMonthChecklists();
    if (oldData.length > 0) {
        document.getElementById('old-data-count').textContent = oldData.length;
        document.getElementById('monthly-recap-modal').classList.remove('hidden');
    }
    monthlyCheckDone = true;
}

function closeMonthlyModal() {
    document.getElementById('monthly-recap-modal').classList.add('hidden');
}

async function downloadAndResetOldData() {
    const oldData = getOldMonthChecklists();
    if (!oldData.length) { closeMonthlyModal(); return; }
    
    const oldest = oldData.reduce((a, b) => new Date(a.date) < new Date(b.date) ? a : b);
    const dt = new Date(oldest.date);
    const monthLabel = getMonthName(dt.getMonth()) + ' ' + dt.getFullYear();
    const filename = `Rekap_SOP_${monthLabel.replace(' ', '_')}`;
    
    const btn = document.getElementById('btn-recap-reset');
    btn.disabled = true; btn.textContent = '⏳ Mengunduh...';
    
    const printArea = document.getElementById('pdf-print-area');
    printArea.innerHTML = buildPdfContent(oldData, monthLabel);
    printArea.style.display = 'block';
    
    try {
        await html2pdf().set({
            margin: [10, 10, 10, 10],
            filename: filename + '.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(printArea).save();
        
        printArea.style.display = 'none';
        printArea.innerHTML = '';
        
        btn.textContent = '🗑️ Menghapus data lama...';
        for (const r of oldData) {
            await remove(ref(db, 'ceklissop/records/' + r._key));
        }
        
        showFeedback('✅ Rekap diunduh & data lama berhasil dihapus!', 'text-green-600');
    } catch(e) {
        console.error(e);
        showFeedback('❌ Terjadi kesalahan', 'text-red-600');
    }
    
    btn.disabled = false; btn.textContent = '📄 Unduh & Reset';
    closeMonthlyModal();
}

// === INIT FIREBASE LISTENER ===
onValue(ref(db, 'users'), (snapshot) => {
    const data = snapshot.val() || {};
    centralUsers = Object.entries(data).map(([key, val]) => ({ ...val, _key: key, type: 'karyawan' }));
    
    const activePage = ['ceklis', 'karyawan', 'sop', 'rekap'].find(p => !document.getElementById('page-' + p).classList.contains('hidden'));
    if (activePage === 'karyawan') renderKaryawan();
    if (activePage === 'ceklis') populateOperatorSelect();
});

onValue(ref(db, 'ceklissop'), (snapshot) => {
    const data = snapshot.val() || {};
    let parsedData = [];
    
    // Parse records
    if (data.records) Object.entries(data.records).forEach(([key, val]) => parsedData.push({ ...val, _key: key, type: 'checklist' }));
    // Parse SOP Mobil
    if (data.sop_mobil) Object.entries(data.sop_mobil).forEach(([key, val]) => parsedData.push({ ...val, _key: key, type: 'sop_mobil' }));
    // Parse SOP Motor
    if (data.sop_motor) Object.entries(data.sop_motor).forEach(([key, val]) => parsedData.push({ ...val, _key: key, type: 'sop_motor' }));
    
    allRecords = parsedData;
    
    // Re-render
    renderHistory();
    const activePage = ['ceklis', 'karyawan', 'sop', 'rekap'].find(p => !document.getElementById('page-' + p).classList.contains('hidden'));
    if (activePage === 'sop') renderSopList();
    if (activePage === 'ceklis') { populateOperatorSelect(); renderChecklist(); }
    if (activePage === 'rekap') {
        renderRekap(currentRekapFilter);
        renderViolationChart();
    }
    
    if (lucide) lucide.createIcons();
});

document.addEventListener('DOMContentLoaded', () => {
    // Basic init not dependent on data
    if (lucide) lucide.createIcons();
});

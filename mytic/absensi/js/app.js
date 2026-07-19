import { db, ref, onValue, set, push, remove, update } from './firebase-config.js?v=1';

// ==========================================
// STATE
// ==========================================
let allData = { employees: {}, records: {}, settings: {} };
let currentEmployee = null; // { _key, name, nickname, position }

const $ = id => document.getElementById(id);
const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

// ==========================================
// THEME
// ==========================================
const THEME_PALETTES = {
  orange: { primary: '#F15800', hover: '#D94500', bg: '#FFF0E6' },
  blue: { primary: '#2563EB', hover: '#1D4ED8', bg: '#EFF6FF' },
  emerald: { primary: '#059669', hover: '#047857', bg: '#ECFDF5' },
  purple: { primary: '#7C3AED', hover: '#6D28D9', bg: '#F5F3FF' },
  red: { primary: '#DC2626', hover: '#B91C1C', bg: '#FEF2F2' },
  slate: { primary: '#334155', hover: '#1E293B', bg: '#F1F5F9' }
};

function applyTheme(themeKey) {
  localStorage.setItem('spbu_theme', themeKey);
  const t = THEME_PALETTES[themeKey] || THEME_PALETTES['orange'];
  document.documentElement.style.setProperty('--primary', t.primary);
  document.documentElement.style.setProperty('--primary-dark', t.hover);
  document.documentElement.style.setProperty('--primary-light', t.hover);
  document.documentElement.style.setProperty('--primary-bg', t.bg);
}

const savedTheme = localStorage.getItem('spbu_theme');
if (savedTheme) applyTheme(savedTheme);

// ==========================================
// SHIFTS
// ==========================================
let SHIFTS = {
  '1': { start: [4, 45], end: [12, 45], label: 'Shift 1 (04:45–12:45)', tolerance: 5 },
  '2': { start: [12, 45], end: [21, 15], label: 'Shift 2 (12:45–21:15)', tolerance: 5 },
  '3': { start: [21, 15], end: [4, 45], label: 'Shift 3 (21:15–04:45)', tolerance: 5 },
  'admin': { start: [7, 0], end: [15, 0], label: 'Admin (07:00–15:00)', tolerance: 10 }
};
const DEFAULT_SHIFTS = JSON.parse(JSON.stringify(SHIFTS));

// ==========================================
// HELPERS
// ==========================================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDateID(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
function calcLate(shiftKey, clockInTime) {
  const [h, m] = clockInTime.split(':').map(Number);
  const s = SHIFTS[shiftKey];
  const startMin = s.start[0] * 60 + s.start[1];
  const currentMin = h * 60 + m;
  let diff = currentMin - startMin;
  if (shiftKey === '3' && diff < -720) diff += 1440;
  if (shiftKey === '3' && diff > 720) diff -= 1440;
  return diff > s.tolerance ? diff : 0;
}
function formatLate(mins) {
  if (mins <= 0) return 'On Time ✓';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  let parts = [];
  if (h > 0) parts.push(`${h} jam`);
  if (m > 0) parts.push(`${m} menit`);
  return `Terlambat ${parts.join(' ')}`;
}
function showToast(msg, type = 'success') {
  const c = $('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
function showModal(title, message, isLate) {
  $('modal-icon').textContent = isLate ? '⚠️' : '✅';
  $('modal-title').textContent = title;
  $('modal-message').textContent = message;
  $('modal-overlay').classList.add('active');
}
let confirmCallback = null;
function showConfirm(title, message, cb, btnText = 'Yakin', isDanger = false) {
  confirmCallback = cb;
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  const btn = $('confirm-ok');
  btn.textContent = btnText;
  btn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
  $('confirm-overlay').classList.add('active');
}

function getEmployees() {
  return Object.entries(allData.employees || {}).map(([k, v]) => ({ _key: k, ...v }));
}
function getRecords(empName) {
  const all = Object.entries(allData.records || {}).map(([k, v]) => ({ _key: k, ...v }));
  if (empName) return all.filter(r => r.emp_name === empName);
  return all;
}
function getMessages() {
  const s = allData.settings || {};
  return {
    onTime: s.msg_on_time || 'MasyaAllah kamu datang tepat waktu, semangat kerjanya {nama}!',
    late: s.msg_late || 'Astaghfirullah {nama} terlambat {terlambat}, besok datang lebih awal ya',
    clockOut: s.msg_clock_out || 'Alhamdulillah {nama}, hati-hati di jalan ya, semoga selamat sampai tujuan'
  };
}
function replaceVars(msg, vars) {
  let r = msg;
  if (vars.nama) r = r.replace(/{nama}/g, vars.nama);
  if (vars.waktu) r = r.replace(/{waktu}/g, vars.waktu);
  if (vars.terlambat) r = r.replace(/{terlambat}/g, vars.terlambat);
  return r;
}

// ==========================================
// FIREBASE LISTENER
// ==========================================
onValue(ref(db, 'absensi'), snap => {
  allData = snap.val() || { employees: {}, records: {}, settings: {} };
  if (!allData.employees) allData.employees = {};
  if (!allData.records) allData.records = {};
  if (!allData.settings) allData.settings = {};
  
  if (allData.settings.shifts) {
    SHIFTS = allData.settings.shifts;
  } else {
    SHIFTS = JSON.parse(JSON.stringify(DEFAULT_SHIFTS));
  }
  
  render();
});

onValue(ref(db, 'settings/theme'), snap => {
  const theme = snap.val();
  if (theme) applyTheme(theme);
});

function render() {
  const activeView = document.querySelector('.view.active');
  if (!activeView) return;
  const id = activeView.id;
  if (id === 'view-select') renderEmployeeList();
  if (id === 'view-employee') { renderEmpStatus(); renderEmpRecap(); }
  if (id === 'view-admin') { renderAdminDashboard(); renderAdminEmployees(); renderLeaderboard(); }
}

// ==========================================
// VIEW: PILIH KARYAWAN
// ==========================================
function renderEmployeeList() {
  const emps = getEmployees();
  const list = $('employee-list');
  const noMsg = $('no-employees');
  if (emps.length === 0) {
    list.innerHTML = '';
    noMsg.classList.remove('hidden');
    return;
  }
  noMsg.classList.add('hidden');
  list.innerHTML = emps.map(e => `
    <div class="emp-select-card" data-key="${e._key}">
      <div class="emp-name">${esc(e.name)}</div>
      <div class="emp-pos">${esc(e.position)}</div>
    </div>
  `).join('');
  list.querySelectorAll('.emp-select-card').forEach(card => {
    card.addEventListener('click', () => {
      const emp = getEmployees().find(e => e._key === card.dataset.key);
      if (emp) { currentEmployee = emp; openEmployeePanel(); }
    });
  });
  renderLeaderboard();
}

function renderLeaderboard() {
  const container = $('leaderboard-list');
  if (!container) return;
  const emps = getEmployees();
  const recs = getRecords();
  const targetDate = new Date();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const y = targetDate.getFullYear();
  const d = String(targetDate.getDate()).padStart(2, '0');
  
  const startStr = `${y}-${m}-01`;
  const endStr = `${y}-${m}-${d}`;
  
  const monthRecs = recs.filter(r => r.date && r.date >= startStr && r.date <= endStr);
  
  const scores = emps.map(emp => {
    const empRecs = monthRecs.filter(r => r.emp_name === emp.name);
    let score = 0;
    let present = 0;
    let totalSecLate = 0;
    
    empRecs.forEach(r => {
      if (r.clock_in && r.clock_in !== '-') {
        present++;
        if ((r.late_minutes || 0) <= 0) score += 10; // Tepat waktu
        else score += 5; // Terlambat
        
        // Tie-breaker: calculate exact seconds relative to shift start
        let [h, m, s] = r.clock_in.split(':').map(Number);
        s = s || 0;
        let sKey = Object.keys(SHIFTS).find(k => SHIFTS[k].label === r.shift);
        if (sKey) {
           const sh = SHIFTS[sKey];
           const startSec = sh.start[0] * 3600 + sh.start[1] * 60;
           let currentSec = h * 3600 + m * 60 + s;
           let diffSec = currentSec - startSec;
           if (sKey === '3' && diffSec < -43200) diffSec += 86400; // cross day threshold
           if (sKey === '3' && diffSec > 43200) diffSec -= 86400;
           totalSecLate += diffSec;
        }
      } else {
        if (['Sakit','Izin','Cuti'].includes(r.status)) score += 2; // Keterangan sah
      }
    });
    return { name: emp.name, present, totalSecLate };
  }).filter(e => e.present > 0).sort((a, b) => {
    return a.totalSecLate - b.totalSecLate; // The lowest total SecLate (most early cumulatively) wins
  });

  if (scores.length === 0) {
    container.innerHTML = '<p class="text-center text-sm text-muted">Belum ada data absensi pada periode ini</p>';
    return;
  }

  const generateListHTML = (list, isTop3) => list.map((s, i) => `
    <div class="leaderboard-item rank-${i + 1}" data-emp="${esc(s.name)}" style="cursor:pointer;${!isTop3 ? 'background:#f8fafc;box-shadow:none;border:1px solid #e2e8f0;margin-bottom:0.5rem;' : ''}">
      <div class="leaderboard-rank" style="${!isTop3 && i >= 3 ? 'background:#94a3b8;color:#fff;' : ''}">#${i + 1}</div>
      <div class="leaderboard-info">
        <div class="leaderboard-name">${esc(s.name)}</div>
      </div>
    </div>
  `).join('');

  container.innerHTML = generateListHTML(scores.slice(0, 3), true);
  
  const adminContainer = $('admin-leaderboard-list');
  if (adminContainer) {
    adminContainer.innerHTML = generateListHTML(scores, false);
    adminContainer.querySelectorAll('.leaderboard-item').forEach(item => {
      item.addEventListener('click', () => showLeaderboardDetail(item.dataset.emp));
    });
  }
}

function showLeaderboardDetail(empName) {
  const recs = getRecords(empName);
  const targetDate = new Date();
  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
  const y = targetDate.getFullYear();
  const d = String(targetDate.getDate()).padStart(2, '0');
  const startStr = `${y}-${m}-01`;
  const endStr = `${y}-${m}-${d}`;
  
  const monthRecs = recs.filter(r => r.date && r.date >= startStr && r.date <= endStr);
  
  let onTime = 0, late = 0, absent = 0, totalLateMins = 0;
  monthRecs.forEach(r => {
    if (r.clock_in && r.clock_in !== '-') {
      if ((r.late_minutes || 0) > 0) { late++; totalLateMins += (r.late_minutes || 0); }
      else onTime++;
    } else {
      absent++;
    }
  });
  
  $('detail-title').textContent = `📋 Rincian: ${empName}`;
  
  let html = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1rem;">
      <div class="card" style="text-align:center;padding:0.75rem;">
        <div style="font-size:1.5rem;font-weight:800;color:var(--success);">${onTime}</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">Tepat Waktu</div>
      </div>
      <div class="card" style="text-align:center;padding:0.75rem;">
        <div style="font-size:1.5rem;font-weight:800;color:var(--warning);">${late}</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">Terlambat</div>
      </div>
      <div class="card" style="text-align:center;padding:0.75rem;">
        <div style="font-size:1.5rem;font-weight:800;color:var(--info);">${absent}</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">Izin/Sakit/Cuti</div>
      </div>
      <div class="card" style="text-align:center;padding:0.75rem;">
        <div style="font-size:1.5rem;font-weight:800;color:var(--danger);">${totalLateMins}m</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">Total Telat</div>
      </div>
    </div>
    <h4 style="font-size:0.9rem;margin-bottom:0.5rem;color:var(--text);">Riwayat Bulan Ini</h4>
  `;
  
  if (monthRecs.length === 0) {
    html += '<p class="text-sm text-muted">Belum ada data bulan ini.</p>';
  } else {
    html += '<div style="max-height:250px;overflow-y:auto;">';
    monthRecs.sort((a, b) => b.date.localeCompare(a.date)).forEach(r => {
      const statusColor = (!r.clock_in || r.clock_in === '-') ? 'var(--info)' : ((r.late_minutes || 0) > 0 ? 'var(--warning)' : 'var(--success)');
      const statusText = (!r.clock_in || r.clock_in === '-') ? (r.note || r.status || 'Tidak Hadir') : ((r.late_minutes || 0) > 0 ? `Telat ${r.late_minutes}m` : 'Tepat Waktu');
      const clockIn = (r.clock_in && r.clock_in !== '-') ? r.clock_in : '-';
      const clockOut = (r.clock_out && r.clock_out !== '-') ? r.clock_out : '-';
      
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;">
          <div>
            <div style="font-weight:600;color:var(--text);">${fmtDateID(r.date)}</div>
            <div style="color:var(--text-muted);font-size:0.7rem;">${r.shift || '-'} | Masuk: ${clockIn} | Pulang: ${clockOut}</div>
          </div>
          <span style="color:${statusColor};font-weight:600;font-size:0.75rem;white-space:nowrap;">${statusText}</span>
        </div>`;
    });
    html += '</div>';
  }
  
  $('detail-content').innerHTML = html;
  $('detail-overlay').classList.add('active');
}

// ==========================================
// VIEW: PANEL KARYAWAN
// ==========================================
function openEmployeePanel() {
  $('emp-name').textContent = currentEmployee.name;
  $('emp-position').textContent = currentEmployee.position;
  $('emp-date').textContent = fmtDateID(todayStr());
  showView('view-employee');
  renderEmpStatus();
  renderEmpRecap();
}

function renderEmpStatus() {
  if (!currentEmployee) return;
  const today = todayStr();
  const rec = getRecords(currentEmployee.name).find(r => r.date === today);
  const statusEl = $('emp-today-status');
  const textEl = $('emp-status-text');
  if (rec && rec.clock_in && rec.clock_in !== '-') {
    statusEl.classList.remove('hidden');
    textEl.textContent = `Masuk: ${rec.clock_in} | Pulang: ${rec.clock_out || '-'} | ${rec.status || ''}`;
  } else {
    statusEl.classList.add('hidden');
  }
}

function renderEmpRecap() {
  if (!currentEmployee) return;
  const container = $('emp-recap');
  const recs = getRecords(currentEmployee.name)
    .filter(r => r.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15);
  if (recs.length === 0) {
    container.innerHTML = '<p class="no-data">Belum ada riwayat absensi</p>';
    return;
  }
  container.innerHTML = recs.map(r => {
    const isLate = (r.late_minutes || 0) > 0;
    const isAbsent = r.clock_in === '-';
    const badgeClass = isAbsent ? 'badge-info' : (isLate ? 'badge-warning' : 'badge-success');
    return `<div class="record-card">
      <div class="record-header">
        <span class="record-date">${fmtDateID(r.date)}</span>
        <span class="badge ${badgeClass}">${esc(r.status || '-')}</span>
      </div>
      <div class="record-detail">${esc(r.shift || '-')} | ${r.clock_in || '-'} – ${r.clock_out || '-'}${r.note ? ' | ' + esc(r.note) : ''}</div>
    </div>`;
  }).join('');
}

// ==========================================
// CLOCK IN (Shift Selection)
// ==========================================
$('btn-clock-in').addEventListener('click', () => {
  const today = todayStr();
  const existing = getRecords(currentEmployee.name).find(r => r.date === today && r.clock_in && r.clock_in !== '-');
  if (existing) { showToast('Sudah absen masuk hari ini', 'warning'); return; }
  const hasNote = getRecords(currentEmployee.name).find(r => r.date === today && (r.clock_in === '-' || !r.clock_in) && ['Sakit','Izin','Cuti','Libur','Lainnya'].includes(r.status));
  if (hasNote) { showToast('Manajemen sudah memberikan keterangan hari ini', 'warning'); return; }
  
  // Build shift options
  const optContainer = $('shift-options');
  optContainer.innerHTML = Object.entries(SHIFTS).map(([key, s]) => `
    <button class="shift-option" data-shift="${key}">
      <div class="shift-name">${key === 'admin' ? 'Admin' : 'Shift ' + key}</div>
      <div class="shift-time">${String(s.start[0]).padStart(2,'0')}:${String(s.start[1]).padStart(2,'0')} – ${String(s.end[0]).padStart(2,'0')}:${String(s.end[1]).padStart(2,'0')}</div>
    </button>
  `).join('');
  optContainer.querySelectorAll('.shift-option').forEach(btn => {
    btn.addEventListener('click', () => {
      $('shift-overlay').classList.remove('active');
      const shiftKey = btn.dataset.shift;
      const sName = shiftKey === 'admin' ? 'Admin' : 'Shift ' + shiftKey;
      showConfirm('Konfirmasi Masuk', `Apakah Anda yakin ingin absen masuk untuk ${sName}?`, () => {
        doClockIn(shiftKey);
      });
    });
  });
  $('shift-overlay').classList.add('active');
});

async function doClockIn(shiftKey) {
  $('shift-overlay').classList.remove('active');
  const time = nowTime();
  const late = calcLate(shiftKey, time);
  const status = late > 0 ? formatLate(late) : 'On Time ✓';
  const msgs = getMessages();

  await set(push(ref(db, 'absensi/records')), {
    emp_name: currentEmployee.name,
    date: todayStr(),
    clock_in: time,
    clock_out: '',
    shift: SHIFTS[shiftKey].label,
    status: status,
    late_minutes: late,
    note: ''
  });

  if (late > 0) {
    const h = Math.floor(late / 60), m = late % 60;
    let lp = []; if (h > 0) lp.push(`${h} jam`); if (m > 0) lp.push(`${m} menit`);
    const msg = replaceVars(msgs.late, { nama: currentEmployee.nickname || currentEmployee.name, waktu: time, terlambat: lp.join(' ') });
    showModal('Astaghfirullah', msg, true);
  } else {
    const msg = replaceVars(msgs.onTime, { nama: currentEmployee.nickname || currentEmployee.name, waktu: time });
    showModal('MasyaAllah', msg, false);
  }
}

$('shift-cancel').addEventListener('click', () => $('shift-overlay').classList.remove('active'));

// ==========================================
// CLOCK OUT
// ==========================================
$('btn-clock-out').addEventListener('click', async () => {
  const today = todayStr();
  const recs = getRecords(currentEmployee.name);
  const existing = recs.find(r => r.date === today && r.clock_in && r.clock_in !== '-');
  if (!existing) { showToast('Belum absen masuk', 'warning'); return; }
  if (existing.clock_out) { showToast('Sudah absen pulang', 'warning'); return; }

  const time = nowTime();
  await update(ref(db, 'absensi/records/' + existing._key), { clock_out: time });

  const msgs = getMessages();
  const msg = replaceVars(msgs.clockOut, { nama: currentEmployee.nickname || currentEmployee.name, waktu: time });
  showModal('Alhamdulillah', msg, false);
});

// ==========================================
// MODALS
// ==========================================
$('modal-close').addEventListener('click', () => $('modal-overlay').classList.remove('active'));
$('detail-close').addEventListener('click', () => $('detail-overlay').classList.remove('active'));
$('confirm-ok').addEventListener('click', () => {
  $('confirm-overlay').classList.remove('active');
  if (confirmCallback) { confirmCallback(); confirmCallback = null; }
});
$('confirm-cancel').addEventListener('click', () => {
  $('confirm-overlay').classList.remove('active');
  confirmCallback = null;
});

// ==========================================
// NAVIGATION
// ==========================================
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id).classList.add('active');
  $('btn-back').classList.toggle('hidden', id === 'view-select');
  $('btn-admin-lock').classList.toggle('hidden', id !== 'view-select');
  render();
}
$('btn-back').addEventListener('click', () => {
  showView('view-select');
  currentEmployee = null;
});

// Admin trigger: PIN based
$('btn-admin-lock').addEventListener('click', () => {
  $('pin-input').value = '';
  $('pin-overlay').classList.add('active');
  setTimeout(() => $('pin-input').focus(), 100);
});

$('pin-cancel').addEventListener('click', () => {
  $('pin-overlay').classList.remove('active');
});

$('pin-input').addEventListener('keyup', (e) => {
  if (e.key === 'Enter') $('pin-submit').click();
});

$('pin-submit').addEventListener('click', () => {
  const pin = $('pin-input').value.trim();
  const correctPin = allData.settings?.admin_pin || '123456'; // Default PIN if not set
  if (pin === correctPin) {
    $('pin-overlay').classList.remove('active');
    showView('view-admin');
    renderAdminDashboard();
    renderAdminEmployees();
    renderMessagesForm();
    showToast('Akses Admin Diberikan', 'success');
  } else {
    showToast('PIN Salah!', 'error');
  }
});

// Admin tabs
document.querySelectorAll('.tab-btn').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    $('tab-' + tab.dataset.tab).classList.remove('hidden');
    if (tab.dataset.tab === 'report') renderReport();
    if (tab.dataset.tab === 'messages') renderMessagesForm();
  });
});

// ==========================================
// ADMIN: DASHBOARD
// ==========================================
let disciplineChart = null;
function renderAdminDashboard() {
  const today = todayStr();
  const emps = getEmployees();
  const recs = getRecords();
  const clockedIn = recs.filter(r => r.date === today && r.clock_in && r.clock_in !== '-').map(r => r.emp_name);
  const withNote = recs.filter(r => r.date === today && (r.clock_in === '-' || !r.clock_in) && ['Sakit','Izin','Cuti','Libur','Lainnya'].includes(r.status)).map(r => r.emp_name);
  const absent = emps.filter(e => !clockedIn.includes(e.name) && !withNote.includes(e.name));

  const container = $('dashboard-absent');
  const allP = $('all-present');
  if (absent.length === 0) {
    container.innerHTML = '';
    allP.classList.remove('hidden');
  } else {
    allP.classList.add('hidden');
    container.innerHTML = absent.map(e => `
      <div class="card mb-2 flex items-center justify-between" style="padding:1rem;">
        <div>
          <div style="font-weight:700;">${esc(e.name)}</div>
          <div class="text-xs text-muted">${esc(e.position)}</div>
        </div>
        <select class="form-select note-select" style="width:auto;min-width:120px;" data-name="${esc(e.name)}">
          <option value="">Keterangan</option>
          <option value="Sakit">Sakit</option>
          <option value="Izin">Izin</option>
          <option value="Cuti">Cuti</option>
          <option value="Libur">Libur</option>
          <option value="Lainnya">Lainnya</option>
        </select>
      </div>
    `).join('');
    container.querySelectorAll('.note-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        sel.disabled = true;
        await set(push(ref(db, 'absensi/records')), {
          emp_name: sel.dataset.name,
          date: todayStr(),
          clock_in: '-',
          clock_out: '-',
          shift: '-',
          status: sel.value,
          late_minutes: 0,
          note: sel.value
        });
        sel.disabled = false;
        showToast(`${sel.dataset.name}: ${sel.value}`, 'success');
      });
    });
  }

  // Render Chart
  const startInput = $('dash-start');
  const endInput = $('dash-end');
  
  if (!startInput.value || !endInput.value) {
    const todayDate = new Date();
    const y = todayDate.getFullYear();
    const m = String(todayDate.getMonth() + 1).padStart(2, '0');
    const d = String(todayDate.getDate()).padStart(2, '0');
    startInput.value = `${y}-${m}-01`;
    endInput.value = `${y}-${m}-${d}`;
  }
  
  const startStr = startInput.value;
  const endStr = endInput.value;
  
  const monthRecs = recs.filter(r => r.date && r.date >= startStr && r.date <= endStr);
  
  let onTimeCount = 0, lateCount = 0, absentNoteCount = 0;
  monthRecs.forEach(r => {
    if (r.clock_in && r.clock_in !== '-') {
      if ((r.late_minutes || 0) > 0) lateCount++;
      else onTimeCount++;
    } else {
      absentNoteCount++;
    }
  });

  const ctx = $('discipline-chart');
  if (ctx) {
    if (disciplineChart) disciplineChart.destroy();
    disciplineChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Tepat Waktu', 'Terlambat', 'Sakit/Izin/Cuti/Libur'],
        datasets: [{
          data: [onTimeCount, lateCount, absentNoteCount],
          backgroundColor: ['#059669', '#D97706', '#0284C7'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, padding: 20 } }
        }
      }
    });
  }

}

// Date filter event listeners for donut chart
$('dash-start').addEventListener('change', () => renderAdminDashboard());
$('dash-end').addEventListener('change', () => renderAdminDashboard());

// ==========================================
// ADMIN: KELOLA KARYAWAN
// ==========================================
let selectedPosition = '';
document.querySelectorAll('.position-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.position-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedPosition = btn.dataset.pos;
  });
});

$('btn-add-emp').addEventListener('click', async () => {
  const name = $('input-name').value.trim();
  const nickname = $('input-nickname').value.trim();
  if (!name) { showToast('Nama harus diisi', 'warning'); return; }
  if (!selectedPosition) { showToast('Pilih jabatan', 'warning'); return; }
  if (getEmployees().find(e => e.name === name)) { showToast('Nama sudah ada', 'warning'); return; }

  await set(push(ref(db, 'absensi/employees')), { name, nickname, position: selectedPosition });
  $('input-name').value = '';
  $('input-nickname').value = '';
  selectedPosition = '';
  document.querySelectorAll('.position-btn').forEach(b => b.classList.remove('selected'));
  showToast('Karyawan ditambahkan!', 'success');
});

// Auto-capitalize
$('input-name').addEventListener('input', function() {
  const pos = this.selectionStart;
  this.value = this.value.replace(/\b\w/g, c => c.toUpperCase());
  this.setSelectionRange(pos, pos);
});

let editingKey = null;
function renderAdminEmployees() {
  const container = $('admin-emp-list');
  const emps = getEmployees();
  if (emps.length === 0) {
    container.innerHTML = '<p class="no-data">Belum ada karyawan</p>';
    return;
  }
  container.innerHTML = emps.map(e => `
    <div class="card mb-2 flex items-center justify-between" style="padding:1rem;">
      <div>
        <div style="font-weight:700;">${esc(e.name)}</div>
        <div class="text-xs text-muted">${esc(e.position)}${e.nickname ? ' • ' + esc(e.nickname) : ''}</div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary edit-emp-btn" style="padding:0.4rem 0.75rem;font-size:0.8rem;" data-key="${e._key}">Edit</button>
        <button class="btn btn-danger del-emp-btn" style="padding:0.4rem 0.75rem;font-size:0.8rem;" data-key="${e._key}" data-name="${esc(e.name)}">Hapus</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.edit-emp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emp = getEmployees().find(e => e._key === btn.dataset.key);
      if (!emp) return;
      editingKey = emp._key;
      $('edit-name').value = emp.name;
      $('edit-nickname').value = emp.nickname || '';
      $('edit-position').value = emp.position;
      $('edit-overlay').classList.add('active');
    });
  });

  container.querySelectorAll('.del-emp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      showConfirm('Hapus Karyawan', `Hapus ${name} dan semua data absensinya?`, async () => {
        await remove(ref(db, 'absensi/employees/' + btn.dataset.key));
        // Delete associated records
        const recs = getRecords(name);
        for (const r of recs) { await remove(ref(db, 'absensi/records/' + r._key)); }
        showToast(`${name} dihapus`, 'success');
      }, 'Hapus', true);
    });
  });
}

// Edit modal
$('edit-save').addEventListener('click', async () => {
  if (!editingKey) return;
  const newName = $('edit-name').value.trim();
  const newNick = $('edit-nickname').value.trim();
  const newPos = $('edit-position').value;
  if (!newName) { showToast('Nama harus diisi', 'warning'); return; }

  const oldEmp = getEmployees().find(e => e._key === editingKey);
  await update(ref(db, 'absensi/employees/' + editingKey), { name: newName, nickname: newNick, position: newPos });

  // Update name in records if changed
  if (oldEmp && oldEmp.name !== newName) {
    const recs = getRecords(oldEmp.name);
    for (const r of recs) { await update(ref(db, 'absensi/records/' + r._key), { emp_name: newName }); }
  }

  $('edit-overlay').classList.remove('active');
  editingKey = null;
  showToast('Karyawan diperbarui!', 'success');
});
$('edit-cancel').addEventListener('click', () => { $('edit-overlay').classList.remove('active'); editingKey = null; });

// ==========================================
// ADMIN: REKAP
// ==========================================
$('report-date').valueAsDate = new Date();
$('report-period').addEventListener('change', renderReport);
$('report-date').addEventListener('change', renderReport);

function renderReport() {
  const period = $('report-period').value;
  const dateVal = $('report-date').value;
  const container = $('report-content');
  if (!dateVal) { container.innerHTML = ''; return; }

  const targetDate = new Date(dateVal);
  let filtered = getRecords().filter(r => r.date);

  if (period === 'daily') {
    filtered = filtered.filter(r => r.date === dateVal);
  } else if (period === 'weekly') {
    const start = new Date(targetDate);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    filtered = filtered.filter(r => r.date >= startStr && r.date <= endStr);
  } else {
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const y = targetDate.getFullYear();
    const prefix = `${y}-${m}`;
    filtered = filtered.filter(r => r.date.startsWith(prefix));
  }

  // Group by employee
  const emps = getEmployees();
  const grouped = {};
  emps.forEach(e => { grouped[e.name] = { present: 0, late: 0, sick: 0, leave: 0, off: 0, permit: 0, other: 0 }; });
  filtered.forEach(r => {
    if (!grouped[r.emp_name]) grouped[r.emp_name] = { present: 0, late: 0, sick: 0, leave: 0, off: 0, permit: 0, other: 0 };
    const g = grouped[r.emp_name];
    if (r.clock_in && r.clock_in !== '-') {
      g.present++;
      if ((r.late_minutes || 0) > 0) g.late++;
    } else {
      if (r.status === 'Sakit') g.sick++;
      else if (r.status === 'Izin') g.permit++;
      else if (r.status === 'Cuti') g.leave++;
      else if (r.status === 'Libur') g.off++;
      else g.other++;
    }
  });

  const names = Object.keys(grouped).filter(n => {
    const g = grouped[n];
    return g.present + g.late + g.sick + g.permit + g.leave + g.off + g.other > 0 || emps.find(e => e.name === n);
  });

  if (names.length === 0 && filtered.length === 0) {
    container.innerHTML = '<p class="no-data">Tidak ada data untuk periode ini</p>';
    return;
  }

  container.innerHTML = names.map(name => {
    const s = grouped[name];
    return `<div class="card mb-2">
      <div style="font-weight:700;margin-bottom:0.75rem;">${esc(name)}</div>
      <div class="stat-grid">
        <div class="stat-item"><div class="stat-value" style="color:var(--success);">${s.present}</div><div class="stat-label">Hadir</div></div>
        <div class="stat-item"><div class="stat-value" style="color:var(--warning);">${s.late}</div><div class="stat-label">Terlambat</div></div>
        <div class="stat-item"><div class="stat-value" style="color:var(--danger);">${s.sick}</div><div class="stat-label">Sakit</div></div>
        <div class="stat-item"><div class="stat-value" style="color:var(--info);">${s.permit}</div><div class="stat-label">Izin</div></div>
        <div class="stat-item"><div class="stat-value" style="color:var(--primary);">${s.leave}</div><div class="stat-label">Cuti</div></div>
        <div class="stat-item"><div class="stat-value" style="color:var(--text-muted);">${s.off}</div><div class="stat-label">Libur</div></div>
      </div>
    </div>`;
  }).join('');
}

// Unduh PDF
$('btn-download-pdf').addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const period = $('report-period').value;
  const dateVal = $('report-date').value;
  if (!dateVal) { showToast('Pilih tanggal/periode terlebih dahulu', 'warning'); return; }

  doc.setFontSize(16);
  doc.text('Laporan Rekap Absensi SPBU Gontor', 14, 20);
  doc.setFontSize(10);
  doc.text(`Periode: ${period === 'daily' ? 'Harian' : (period === 'weekly' ? 'Mingguan' : 'Bulanan')} (${dateVal})`, 14, 28);
  doc.text(`Dicetak pada: ${fmtDateID(todayStr())}`, 14, 34);

  const emps = getEmployees();
  const targetDate = new Date(dateVal);
  let filtered = getRecords().filter(r => r.date);

  if (period === 'daily') {
    filtered = filtered.filter(r => r.date === dateVal);
  } else if (period === 'weekly') {
    const start = new Date(targetDate);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    filtered = filtered.filter(r => r.date >= startStr && r.date <= endStr);
  } else {
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const y = targetDate.getFullYear();
    const prefix = `${y}-${m}`;
    filtered = filtered.filter(r => r.date.startsWith(prefix));
  }

  const grouped = {};
  emps.forEach(e => { grouped[e.name] = { present: 0, late: 0, sick: 0, leave: 0, off: 0, permit: 0, other: 0 }; });
  filtered.forEach(r => {
    if (!grouped[r.emp_name]) grouped[r.emp_name] = { present: 0, late: 0, sick: 0, leave: 0, off: 0, permit: 0, other: 0 };
    const g = grouped[r.emp_name];
    if (r.clock_in && r.clock_in !== '-') {
      g.present++;
      if ((r.late_minutes || 0) > 0) g.late++;
    } else {
      if (r.status === 'Sakit') g.sick++;
      else if (r.status === 'Izin') g.permit++;
      else if (r.status === 'Cuti') g.leave++;
      else if (r.status === 'Libur') g.off++;
      else g.other++;
    }
  });

  const names = Object.keys(grouped).filter(n => {
    const g = grouped[n];
    return g.present + g.late + g.sick + g.permit + g.leave + g.off + g.other > 0 || emps.find(e => e.name === n);
  });

  const tableData = names.map((name, i) => {
    const s = grouped[name];
    return [ i + 1, name, s.present, s.late, s.sick, s.permit, s.leave, s.off ];
  });

  doc.autoTable({
    startY: 40,
    head: [['No', 'Nama Karyawan', 'Hadir', 'Terlambat', 'Sakit', 'Izin', 'Cuti', 'Libur']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229] }
  });

  doc.save(`Rekap_Absensi_${dateVal}.pdf`);
  showToast('PDF berhasil diunduh', 'success');
});

// Reset Data
$('btn-reset-data').addEventListener('click', () => {
  const period = $('report-period').value;
  const dateVal = $('report-date').value;
  if (!dateVal) { showToast('Pilih tanggal terlebih dahulu', 'warning'); return; }

  const targetDate = new Date(dateVal);
  let toDelete = getRecords().filter(r => r.date);

  if (period === 'daily') {
    toDelete = toDelete.filter(r => r.date === dateVal);
  } else if (period === 'weekly') {
    const start = new Date(targetDate);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    toDelete = toDelete.filter(r => r.date >= startStr && r.date <= endStr);
  } else {
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const y = targetDate.getFullYear();
    const prefix = `${y}-${m}`;
    toDelete = toDelete.filter(r => r.date.startsWith(prefix));
  }

  if (toDelete.length === 0) { showToast('Tidak ada data untuk dihapus', 'warning'); return; }

  showConfirm('Reset Data', `Hapus ${toDelete.length} data absensi? Aksi ini tidak bisa dibatalkan.`, async () => {
    for (const r of toDelete) { await remove(ref(db, 'absensi/records/' + r._key)); }
    showToast(`${toDelete.length} data dihapus`, 'success');
    renderReport();
  }, 'Hapus', true);
});

// ==========================================
// ADMIN: PESAN
// ==========================================
function renderMessagesForm() {
  const msgs = getMessages();
  $('msg-on-time').value = msgs.onTime;
  $('msg-late').value = msgs.late;
  $('msg-clock-out').value = msgs.clockOut;
  
  const shiftContainer = $('shift-settings-container');
  if (shiftContainer) {
    let html = '';
    Object.keys(SHIFTS).forEach(k => {
      const s = SHIFTS[k];
      html += `
      <div class="card mb-3" style="border-left: 4px solid var(--primary); padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h5 style="margin-bottom: 0.5rem; color: var(--text);">${esc(s.label.split(' (')[0])}</h5>
        <div class="grid-2">
          <div class="form-group mb-0">
            <label class="form-label" style="font-size:0.75rem;">Mulai</label>
            <input type="time" id="set-shift-start-${k}" class="form-input" value="${String(s.start[0]).padStart(2,'0')}:${String(s.start[1]).padStart(2,'0')}">
          </div>
          <div class="form-group mb-0">
            <label class="form-label" style="font-size:0.75rem;">Selesai</label>
            <input type="time" id="set-shift-end-${k}" class="form-input" value="${String(s.end[0]).padStart(2,'0')}:${String(s.end[1]).padStart(2,'0')}">
          </div>
        </div>
        <div class="form-group mt-2 mb-0">
          <label class="form-label" style="font-size:0.75rem;">Toleransi Keterlambatan (menit)</label>
          <input type="number" id="set-shift-tol-${k}" class="form-input" value="${s.tolerance}" min="0">
        </div>
      </div>`;
    });
    shiftContainer.innerHTML = html;
  }
}

$('btn-save-messages').addEventListener('click', async () => {
  const onTime = $('msg-on-time').value.trim() || 'MasyaAllah kamu datang tepat waktu, semangat kerjanya {nama}!';
  const late = $('msg-late').value.trim() || 'Astaghfirullah {nama} terlambat {terlambat}, besok datang lebih awal ya';
  const clockOut = $('msg-clock-out').value.trim() || 'Alhamdulillah {nama}, hati-hati di jalan ya, semoga selamat sampai tujuan';
  
  const updates = {
    msg_on_time: onTime,
    msg_late: late,
    msg_clock_out: clockOut
  };
  
  const newPin = $('setting-pin').value.trim();
  if (newPin && newPin.length <= 6) {
    updates.admin_pin = newPin;
  }
  
  const newShifts = {};
  Object.keys(SHIFTS).forEach(k => {
    const s = SHIFTS[k];
    const startTime = $(`set-shift-start-${k}`).value || "00:00";
    const endTime = $(`set-shift-end-${k}`).value || "00:00";
    const tol = parseInt($(`set-shift-tol-${k}`).value) || 0;
    
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const labelPrefix = s.label.split(' (')[0];
    
    newShifts[k] = {
      start: [startH, startM],
      end: [endH, endM],
      label: `${labelPrefix} (${startTime}–${endTime})`,
      tolerance: tol
    };
  });
  updates.shifts = newShifts;

  await update(ref(db, 'absensi/settings'), updates);
  
  $('setting-pin').value = ''; // clear input after saving
  showToast('Pengaturan berhasil disimpan!', 'success');
});

// Init
if (window.location.search.includes('admin=true')) {
  showView('view-admin');
} else {
  renderEmployeeList();
}

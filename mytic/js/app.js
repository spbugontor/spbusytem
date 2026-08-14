import { db, auth, ref, onValue, set, push, remove, update, get, child, signInWithEmailAndPassword, signOut, onAuthStateChanged, browserSessionPersistence, setPersistence } from './firebase-config.js?v=20260712g';

// ==========================================
// STATE
// ==========================================
let currentUser = null;
let currentSection = 'dashboard';
let allData = { users: {}, transactions: {}, leaves: {}, savings: {}, violations: {}, ratings: {}, criteria: {}, leave_types: {}, settings: {}, pin_history: {}, payroll: {}, payroll_settings: {}, certificates: {} };

// ==========================================
// THEME
// ==========================================
const THEME_PALETTES = {
  orange: { primary: '#F15800', hover: '#D94500', bg: '#FFF0E6', shadow: 'rgba(241, 88, 0, 0.39)' },
  blue: { primary: '#2563EB', hover: '#1D4ED8', bg: '#EFF6FF', shadow: 'rgba(37, 99, 235, 0.39)' },
  emerald: { primary: '#059669', hover: '#047857', bg: '#ECFDF5', shadow: 'rgba(5, 150, 105, 0.39)' },
  purple: { primary: '#7C3AED', hover: '#6D28D9', bg: '#F5F3FF', shadow: 'rgba(124, 58, 237, 0.39)' },
  red: { primary: '#DC2626', hover: '#B91C1C', bg: '#FEF2F2', shadow: 'rgba(220, 38, 38, 0.39)' },
  slate: { primary: '#334155', hover: '#1E293B', bg: '#F1F5F9', shadow: 'rgba(51, 65, 85, 0.39)' }
};

function applyTheme(themeKey) {
  localStorage.setItem('spbu_theme', themeKey);
  const t = THEME_PALETTES[themeKey] || THEME_PALETTES['orange'];
  document.documentElement.style.setProperty('--primary', t.primary);
  document.documentElement.style.setProperty('--primary-hover', t.hover);
  document.documentElement.style.setProperty('--primary-bg', t.bg);
  document.documentElement.style.setProperty('--primary-shadow', t.shadow || 'rgba(0,0,0,0.2)');

  // Dynamically update PWA & Mobile status bar header colors (Android, Chrome, Safari, Samsung)
  let metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement('meta');
    metaTheme.name = 'theme-color';
    document.head.appendChild(metaTheme);
  }
  metaTheme.setAttribute('content', t.primary);

  let metaNav = document.querySelector('meta[name="msapplication-navbutton-color"]');
  if (!metaNav) {
    metaNav = document.createElement('meta');
    metaNav.name = 'msapplication-navbutton-color';
    document.head.appendChild(metaNav);
  }
  metaNav.setAttribute('content', t.primary);
}

const savedTheme = localStorage.getItem('spbu_theme') || 'blue';
applyTheme(savedTheme);

function populateEmpSelectFromCache() {
  const empSelect = document.getElementById('inp-emp-username');
  if (!empSelect) return;
  try {
    const raw = localStorage.getItem('mytic_cached_users');
    if (raw) {
      const usersList = JSON.parse(raw);
      if (Array.isArray(usersList) && usersList.length > 0) {
        empSelect.innerHTML = '<option value="">-- Pilih Nama Anda --</option>' +
          usersList.map(u => `<option value="${esc(u.username)}">${esc(u.name)} (${esc(u.position)})</option>`).join('');
      }
    }
  } catch (e) { console.warn('Cache load error:', e); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', populateEmpSelectFromCache);
} else {
  populateEmpSelectFromCache();
}

// Dark Mode Logic
const savedDarkMode = localStorage.getItem('spbu_dark_mode') === 'true';
if (savedDarkMode) document.documentElement.classList.add('dark-mode');

function syncDarkIcons(isDark) {
  ['', '-mobile'].forEach(suffix => {
    const moon = document.getElementById('icon-moon' + suffix);
    const sun = document.getElementById('icon-sun' + suffix);
    if (moon && sun) {
      if (isDark) { moon.classList.add('hidden'); sun.classList.remove('hidden'); }
      else { moon.classList.remove('hidden'); sun.classList.add('hidden'); }
    }
  });
}

window._myTicCharts = window._myTicCharts || {};

function destroyChart(id) {
  if (window._myTicCharts[id]) {
    window._myTicCharts[id].destroy();
    delete window._myTicCharts[id];
  }
}

function getChartColors() {
  const isDark = document.documentElement.classList.contains('dark-mode');
  return {
    text: isDark ? '#94A3B8' : '#64748B',
    grid: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    cardBg: isDark ? '#1E293B' : '#FFFFFF'
  };
}

window.toggleDarkMode = () => {
  const isDark = document.documentElement.classList.toggle('dark-mode');
  localStorage.setItem('spbu_dark_mode', isDark);
  syncDarkIcons(isDark);
  if (currentUser) renderCurrentSection();
};

// Update icons on load if they exist
document.addEventListener('DOMContentLoaded', () => {
  if (savedDarkMode) syncDarkIcons(true);
});

// ==========================================
// UTILITIES
// ==========================================
function esc(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[t])); }
function fmt(n) {
  const num = Number(n) || 0;
  const hasDec = Math.abs(num % 1) > 0.001;
  return 'Rp ' + num.toLocaleString('id-ID', { minimumFractionDigits: hasDec ? 2 : 0, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  const num = Number(n) || 0;
  const hasDec = Math.abs(num % 1) > 0.001;
  return num.toLocaleString('id-ID', { minimumFractionDigits: hasDec ? 2 : 0, maximumFractionDigits: 2 });
}
function fmtDate(d) { if (!d) return '-'; try { return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } }
function fmtMonthYear(d) { if (!d) return '-'; try { const [y, m] = d.split('-'); const date = new Date(y, parseInt(m) - 1, 1); return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); } catch { return d; } }
function today() { return new Date().toISOString().split('T')[0]; }

function getUsers() { return Object.entries(allData.users).map(([k, v]) => ({ ...v, _key: k })); }
function getUserByKey(key) { const u = allData.users[key]; return u ? { ...u, _key: key } : null; }
function getUserByUsername(uname) { return getUsers().find(u => u.username === uname); }
function getUserByEmpId(eid) { return getUsers().find(u => u.emp_id === eid); }

function getTxns(empId) { return Object.entries(allData.transactions).filter(([, v]) => v.emp_id === empId).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b._key.localeCompare(a._key)); }
function calcBalance(empId) { let b = 0; getTxns(empId).forEach(t => { if (t.type === 'debit') b += (t.amount || 0); else b -= (t.amount || 0); }); return b; }

function getLeaves(empId) { return Object.entries(allData.leaves).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => { const aP = a.status === 'Menunggu' ? 1 : 0; const bP = b.status === 'Menunggu' ? 1 : 0; if (aP !== bP) return bP - aP; return b._key.localeCompare(a._key); }); }
function getSavings(empId) { return Object.entries(allData.savings).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b._key.localeCompare(a._key)); }
function getViolations(empId) { return Object.entries(allData.violations).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b._key.localeCompare(a._key)); }
function getRatings(empId) { return Object.entries(allData.ratings).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b._key.localeCompare(a._key)); }
function getCriteria(pos) { return Object.entries(allData.criteria || {}).filter(([, v]) => { if (!pos) return true; const p = v.position; if (!p) return true; if (Array.isArray(p)) return p.includes('Semua') || p.includes(pos); const pStr = String(p); if (pStr === 'Semua' || pStr === pos) return true; return pStr.split(',').map(s => s.trim()).includes(pos); }).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a._key || '').localeCompare(b._key || '')); }
function getLeaveTypes() { return Object.entries(allData.leave_types).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (a.name || '').localeCompare(b.name || '')); }
function getPinHistory(empId) { return Object.entries(allData.pin_history || {}).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')); }

function genEmpId(position, existingUsers) {
  const prefixes = { 'Manager': 'A', 'Admin': 'B', 'Supervisor': 'C', 'Operator': 'D', 'Cleaning Service': 'E' };
  const prefix = prefixes[position] || 'X';
  const samePos = existingUsers.filter(e => e.position === position);
  let maxNum = 0;
  samePos.forEach(e => { const n = parseInt((e.emp_id || '').substring(1)) || 0; if (n > maxNum) maxNum = n; });
  return prefix + (maxNum + 1);
}
function genUsername(name, empId) { const first = (name || '').trim().split(/\s+/)[0] || 'USER'; return (first + '_' + empId).toUpperCase(); }

// DOM Cache
const $ = id => document.getElementById(id);

function showToast(msg, type = 'info') {
  const c = $('toast-container'); if (!c) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠️' };
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${esc(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('toast-hide'); setTimeout(() => el.remove(), 300); }, 3000);
}

function showModal(html, sizeClass = '') {
  let overlay = $('global-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'global-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-content"></div>';
    overlay.addEventListener('click', e => { if (e.target === overlay) hideModal(); });
    document.body.appendChild(overlay);
  }
  const contentEl = overlay.querySelector('.modal-content');
  contentEl.className = 'modal-content ' + (sizeClass || '');
  contentEl.innerHTML = html;
  requestAnimationFrame(() => overlay.classList.add('show'));
}
window.hideModal = function() {
  const m = document.getElementById('global-modal') || (typeof $ === 'function' ? $('global-modal') : null);
  if (m) m.classList.remove('show');
};
function hideModal() { window.hideModal(); }

function isEmailAllowedForMyTic(email) {
  if (!email) return false;
  const s = allData.settings || {};
  const allowedEmailsStr = s.mytic_mgmt_emails || 'spbugontor02@gmail.com';
  const allowedList = allowedEmailsStr.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return allowedList.includes(email.trim().toLowerCase());
}

// ==========================================
// INITIALIZATION
// ==========================================
function init() {
  setupEventListeners();
  setPersistence(auth, browserSessionPersistence).catch(console.error);

  onAuthStateChanged(auth, user => {
    if (user) {
      const email = user.email || '';
      if (!isEmailAllowedForMyTic(email)) {
        showToast('Akun ini adalah akun Pemesanan LPG dan tidak memiliki hak akses ke MyTIC.', 'error');
        signOut(auth);
        doLogout(false);
        return;
      }
      currentUser = { role: 'admin', name: 'Manajemen', username: 'admin', email: email };
      loginSuccess();
    } else {
      const s = sessionStorage.getItem('mytic_emp_session');
      if (s) { currentUser = JSON.parse(s); loginSuccess(); }
      else doLogout(false);
    }
  });

  // Global real-time listeners per node
  const nodes = ['users', 'transactions', 'leaves', 'savings', 'violations', 'ratings', 'criteria', 'leave_types', 'settings', 'pin_history', 'internal_chats', 'payroll', 'payroll_settings', 'absensi/records'];
  nodes.forEach(node => {
    onValue(ref(db, node), snap => {
      const dataKey = node === 'absensi/records' ? 'absensi_records' : node;
      allData[dataKey] = snap.exists() ? snap.val() : {};

      if (node === 'settings') {
        const themeToApply = allData.settings.theme || localStorage.getItem('spbu_theme') || 'blue';
        applyTheme(themeToApply);
      }

      if (node === 'users') {
        const empSelect = document.getElementById('inp-emp-username');
        if (empSelect) {
          const currentVal = empSelect.value;
          const usersList = Object.values(allData.users).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          if (usersList.length === 0) {
            empSelect.innerHTML = '<option value="">-- Belum ada karyawan --</option>';
          } else {
            localStorage.setItem('mytic_cached_users', JSON.stringify(usersList));
            empSelect.innerHTML = '<option value="">-- Pilih Nama Anda --</option>' +
              usersList.map(u => `<option value="${esc(u.username)}">${esc(u.name)} (${esc(u.position)})</option>`).join('');
          }
          if (currentVal) empSelect.value = currentVal;
        }
        // Auto-reset leave quota when contract ends
        if (currentUser && currentUser.role === 'admin') {
          autoResetLeaveOnContractEnd();
        }
      }

      checkAndNotifyNode(node, snap);

      if (currentUser) renderCurrentSection();
    }, error => {
      console.warn(`Info/Warning reading ${node}:`, error);
      if (!allData[node]) allData[node] = {};
    });
  });

function isRecordForUser(item, user) {
  if (!item || !user) return false;
  const target = (item.emp_id || item.empId || item.username || item.emp_name || '').toString().toLowerCase().trim();
  if (!target) return false;

  const uId = (user.id || '').toString().toLowerCase().trim();
  const uKey = (user._key || '').toString().toLowerCase().trim();
  const uEmpId = (user.emp_id || '').toString().toLowerCase().trim();
  const uUsername = (user.username || '').toString().toLowerCase().trim();
  const uName = (user.name || '').toString().toLowerCase().trim();

  return (uId && target === uId) ||
         (uKey && target === uKey) ||
         (uEmpId && target === uEmpId) ||
         (uUsername && target === uUsername) ||
         (uName && target === uName);
}

function checkAndNotifyNode(node, rawSnap) {
  if (!currentUser || !rawSnap.exists()) return;
  const items = Object.values(rawSnap.val());
  if (items.length === 0) return;

  const lastNotifiedKey = `_lastNotified_${node}_ts`;

  // On first app load, record the highest timestamp as baseline so old items don't spam
  if (!window[lastNotifiedKey]) {
    let maxTs = 0;
    items.forEach(i => {
      const ts = i.timestamp || 0;
      if (ts > maxTs) maxTs = ts;
    });
    window[lastNotifiedKey] = maxTs || Date.now();
    return;
  }

  const baselineTs = window[lastNotifiedKey];
  let newMaxTs = baselineTs;

  // Filter all new or updated items with timestamp strictly greater than baselineTs
  const newItems = items.filter(i => (i.timestamp || 0) > baselineTs);
  if (newItems.length === 0) return;

  newItems.forEach(item => {
    const itemTs = item.timestamp || Date.now();
    if (itemTs > newMaxTs) newMaxTs = itemTs;

    // 1. DISKUSI INTERNAL
    if (node === 'internal_chats') {
      const isMe = (currentUser.role === 'employee' && item.sender_id === currentUser.id) || (currentUser.role === 'admin' && item.sender_role === 'Manajemen');
      if (!isMe && currentSection !== 'internal-chat') {
        showToast(`💬 Pesan Diskusi dari ${item.sender_name}: "${item.message}"`, 'info');
        triggerSystemNotification(`💬 Pesan Diskusi - ${item.sender_name}`, {
          body: item.message,
          tag: 'mytic-chat-' + itemTs
        });
      }
    }

    // 2. IZIN / CUTI
    else if (node === 'leaves') {
      if (currentUser.role === 'admin' && item.status === 'Menunggu') {
        const empName = item.emp_name || 'Karyawan';
        showToast(`🏖️ Pengajuan Izin Baru: ${empName}`, 'info');
        triggerSystemNotification(`🏖️ Pengajuan Izin Baru - ${empName}`, {
          body: `Alasan: ${item.reason || '-'} (${item.start_date} s/d ${item.end_date})`,
          tag: 'mytic-leave-' + itemTs
        });
      } else if (currentUser.role === 'employee' && isRecordForUser(item, currentUser)) {
        if (item.status === 'Disetujui' || item.status === 'Ditolak') {
          showToast(`🏖️ Status Izin Anda: ${item.status}`, 'info');
          triggerSystemNotification(`🏖️ Status Izin: ${item.status}`, {
            body: `Pengajuan izin Anda tanggal ${item.start_date} telah ${item.status.toLowerCase()} oleh Manajemen.`,
            tag: 'mytic-leave-status-' + itemTs
          });
        }
      }
    }

    // 3. PELANGGARAN
    else if (node === 'violations') {
      if (currentUser.role === 'employee' && isRecordForUser(item, currentUser)) {
        const vType = item.violation_type || item.type || 'Pelanggaran';
        const pts = item.level || item.points || 'Peringatan';
        showToast(`⚠️ Pelanggaran Baru: ${vType}`, 'warning');
        triggerSystemNotification(`⚠️ Catatan Pelanggaran Baru`, {
          body: `Jenis: ${vType} (${pts}). Catatan: ${item.description || item.note || '-'}`,
          tag: 'mytic-violation-' + itemTs
        });
      }
    }

    // 4. TRANSAKSI (DEBIT / KREDIT)
    else if (node === 'transactions') {
      if (currentUser.role === 'employee' && isRecordForUser(item, currentUser)) {
        const title = item.type === 'credit' ? '💳 Pembayaran Tunggakan (Kredit)' : '💳 Catatan Tunggakan Baru (Debit)';
        const formattedAmt = `Rp ${Number(item.amount || 0).toLocaleString('id-ID')}`;
        showToast(`${title}: ${formattedAmt}`, 'info');
        triggerSystemNotification(title, {
          body: `Nominal: ${formattedAmt}. Ket: ${item.note || '-'}`,
          tag: 'mytic-txn-' + itemTs
        });
      }
    }

    // 5. PENILAIAN KINERJA
    else if (node === 'ratings') {
      if (currentUser.role === 'employee' && isRecordForUser(item, currentUser)) {
        const avgScore = item.scores ? (Object.values(item.scores).reduce((s, v) => s + v, 0) / Object.values(item.scores).length).toFixed(1) : (item.score || '5.0');
        showToast(`⭐ Penilaian Kinerja Baru (Skor: ${avgScore})`, 'info');
        triggerSystemNotification('⭐ Penilaian Kinerja Karyawan Baru', {
          body: `Bulan: ${item.date || '-'}. Skor Rata-rata: ${avgScore} / 5`,
          tag: 'mytic-rating-' + itemTs
        });
      }
    }

    // 6. TABUNGAN
    else if (node === 'savings') {
      if (currentUser.role === 'employee' && isRecordForUser(item, currentUser)) {
        const formattedAmt = `Rp ${Number(item.amount || 0).toLocaleString('id-ID')}`;
        showToast(`💰 Tabungan Karyawan: ${formattedAmt}`, 'info');
        triggerSystemNotification('💰 Transaksi Tabungan Karyawan', {
          body: `Bulan: ${item.month || '-'}. Nominal: ${formattedAmt}`,
          tag: 'mytic-savings-' + itemTs
        });
      }
    }
  });

  window[lastNotifiedKey] = newMaxTs;
}

function triggerSystemNotification(title, options = {}) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            icon: 'icons/icon-192.png',
            badge: 'icons/icon-192.png',
            vibrate: [200, 100, 200],
            renotify: true,
            tag: 'mytic-system-notif',
            ...options
          });
        }).catch(() => {
          new Notification(title, { icon: 'icons/icon-192.png', ...options });
        });
      } else {
        new Notification(title, { icon: 'icons/icon-192.png', ...options });
      }
    } catch (e) {
      console.warn('System notification error:', e);
    }
  }
}

window.requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    showToast('Browser HP Anda tidak mendukung Notifikasi System.', 'warning');
    return;
  }
  const currentPerm = Notification.permission;
  if (currentPerm === 'granted') {
    showToast('Notifikasi HP sudah AKTIF! 🔔', 'success');
    triggerSystemNotification('🔔 Notifikasi HP SPBU Gontor', {
      body: 'Notifikasi HP Anda 100% aktif dan siap menerima data real-time.',
      tag: 'mytic-test-' + Date.now()
    });
    return;
  }
  if (currentPerm === 'denied') {
    showToast('Izin notifikasi diblokir browser. Buka Setelan Situs di browser HP Anda.', 'error');
    return;
  }
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    showToast('Berhasil! Notifikasi HP diaktifkan 🔔', 'success');
    triggerSystemNotification('🔔 Notifikasi HP Aktif! - MyTIC', {
      body: 'Hebat! Notifikasi HP berhasil diaktifkan.',
      tag: 'mytic-welcome'
    });
  } else {
    showToast('Notifikasi belum diizinkan.', 'warning');
  }
};

window.testHpNotification = () => {
  window.requestNotificationPermission();
};

  onValue(ref(db, 'absensi/records'), snap => {
    allData.absensi_records = snap.exists() ? snap.val() : {};
    if (currentUser) renderCurrentSection();
  });

  onValue(ref(db, 'ceklissop/records'), snap => {
    allData.ceklissop_records = snap.exists() ? snap.val() : {};
    if (currentUser) renderCurrentSection();
  });
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
  $('tab-employee').addEventListener('click', () => { $('tab-employee').classList.add('active'); $('tab-management').classList.remove('active'); $('form-login-employee').classList.remove('hidden'); $('form-login-management').classList.add('hidden'); });
  $('tab-management').addEventListener('click', () => { $('tab-management').classList.add('active'); $('tab-employee').classList.remove('active'); $('form-login-management').classList.remove('hidden'); $('form-login-employee').classList.add('hidden'); });
  $('btn-login-mgmt').addEventListener('click', () => handleAdminLogin(false));
  $('inp-mgmt-pin').addEventListener('keypress', e => { if (e.key === 'Enter') handleAdminLogin(false); });
  $('btn-login-emp').addEventListener('click', handleEmpLogin);
  $('inp-emp-pin').addEventListener('keypress', e => { if (e.key === 'Enter') handleEmpLogin(); });
  $('btn-logout-sidebar').addEventListener('click', () => doLogout(true));
  $('btn-logout-mobile').addEventListener('click', () => doLogout(true));

  // Auto-login for Employee (Instant as soon as PIN matches)
  $('inp-emp-pin').addEventListener('input', () => {
    const username = $('inp-emp-username').value;
    const pin = $('inp-emp-pin').value.trim();
    if (username && pin) {
      const userObj = Object.values(allData.users || {}).find(u => u.username === username);
      if (userObj && userObj.pin === pin) {
        handleEmpLogin();
      }
    }
  });

  // Auto-login for Management (Triggers as soon as valid password is typed)
  let mgmtAutoLoginTimer = null;
  $('inp-mgmt-pin').addEventListener('input', () => {
    clearTimeout(mgmtAutoLoginTimer);
    const email = $('inp-mgmt-username').value.trim();
    const pin = $('inp-mgmt-pin').value.trim();
    if (email && pin.length >= 6) {
      mgmtAutoLoginTimer = setTimeout(() => {
        handleAdminLogin(true);
      }, 350);
    }
  });
}

// ==========================================
// AUTH
// ==========================================
async function handleAdminLogin(isAuto = false) {
  const email = $('inp-mgmt-username').value.trim().toLowerCase();
  const pin = $('inp-mgmt-pin').value.trim();
  if (!email || !pin) {
    if (!isAuto) showToast('Isi email dan password!', 'warning');
    return;
  }

  if (!isEmailAllowedForMyTic(email)) {
    if (!isAuto) showToast('Akun ini adalah akun Pemesanan LPG dan tidak memiliki hak akses ke MyTIC.', 'error');
    return;
  }

  const btn = $('btn-login-mgmt');
  if (btn) { btn.textContent = 'Memproses...'; btn.disabled = true; }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pin);
    if (!isEmailAllowedForMyTic(cred.user.email)) {
      if (!isAuto) showToast('Akun ini adalah akun Pemesanan LPG dan tidak memiliki hak akses ke MyTIC.', 'error');
      await signOut(auth);
      return;
    }
    showToast('Berhasil masuk', 'success');
  } catch (err) {
    if (!isAuto) {
      console.error('Admin login error:', err);
      showToast('Login gagal. Periksa email dan password.', 'error');
    }
  } finally {
    if (btn) { btn.textContent = 'Masuk Manajemen'; btn.disabled = false; }
  }
}

async function handleEmpLogin() {
  const username = $('inp-emp-username').value;
  const pin = $('inp-emp-pin').value.trim();
  if (!username || !pin) { showToast('Pilih nama dan isi PIN!', 'warning'); return; }
  const btn = $('btn-login-emp'); btn.textContent = 'Memproses...'; btn.disabled = true;
  try {
    const snap = await get(child(ref(db), 'users'));
    let found = false;
    if (snap.exists()) {
      for (const [key, u] of Object.entries(snap.val())) {
        if (u.username === username && u.pin === pin) {
          found = true;
          currentUser = { role: 'employee', id: key, username: u.username, name: u.name, position: u.position, emp_id: u.emp_id };
          sessionStorage.setItem('mytic_emp_session', JSON.stringify(currentUser));
          loginSuccess();
          showToast(`Selamat datang, ${u.name}`, 'success');
          break;
        }
      }
    }
    if (!found) showToast('Username atau PIN salah!', 'error');
  } catch { showToast('Kesalahan jaringan', 'error'); }
  finally { btn.textContent = 'Masuk Karyawan'; btn.disabled = false; }
}

function loginSuccess() {
  $('screen-login').classList.add('hidden');
  $('screen-main').classList.remove('hidden');
  $('screen-main').style.display = 'flex';
  $('nav-mobile').classList.remove('hidden');
  $('display-user-name').textContent = currentUser.name;
  $('display-user-role').textContent = currentUser.role === 'admin' ? 'Manajemen' : currentUser.position;
  $('display-mobile-name').textContent = currentUser.name;

  const savedCollapsed = localStorage.getItem('mytic_sidebar_collapsed');
  const screenMain = document.getElementById('screen-main');
  if (screenMain) {
    if (savedCollapsed === 'false') {
      screenMain.classList.remove('sidebar-collapsed');
    } else {
      screenMain.classList.add('sidebar-collapsed');
    }
  }

  setupNavigation();
  switchSection('dashboard');

  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => {
      window.requestNotificationPermission();
    }, 1500);
  }
}

function doLogout(msg = true) {
  currentUser = null;
  sessionStorage.removeItem('mytic_emp_session');
  signOut(auth);
  $('screen-login').classList.remove('hidden');
  $('screen-main').classList.add('hidden');
  $('nav-mobile').classList.add('hidden');
  $('inp-mgmt-pin').value = '';
  $('inp-emp-pin').value = '';
      if (msg) showToast('Anda telah keluar', 'info');
}

// ==========================================
// NAVIGATION
// ==========================================
const ADMIN_MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1' },
  { id: 'employees', label: 'Karyawan', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197' },
  { id: 'debits', label: 'Tunggakan', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  { id: 'leaves', label: 'Izin/Cuti', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'leaderboard', label: 'Peringkat & KPI', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
  { id: 'payroll', label: 'Gaji & Payroll', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 8v2m0-6c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'internal-chat', label: 'Diskusi Internal', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' },
  { id: 'leave-types', label: 'Jenis Cuti', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { id: 'violations', label: 'Pelanggaran', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { id: 'savings', label: 'Tabungan', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'ratings', label: 'Penilaian', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  { id: 'criteria', label: 'Kriteria', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
  { id: 'settings', label: 'Pengaturan', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'ext-absensi', label: 'Sistem Absensi', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8', href: 'absensi/index.html?admin=true' },
  { id: 'ext-ceklis', label: 'Ceklis SOP', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4', href: 'ceklissop/index.html' }
];

const EMP_MENU = [
  { id: 'dashboard', label: 'Beranda', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1' },
  { id: 'emp-history', label: 'Riwayat Harian', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'emp-debits', label: 'Tunggakan', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  { id: 'emp-leaves', label: 'Izin/Cuti', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { id: 'emp-violations', label: 'Pelanggaran', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { id: 'emp-savings', label: 'Tabungan', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'emp-ratings', label: 'Penilaian', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  { id: 'emp-profile', label: 'Profil', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
];

function isManagerUser() {
  if (!currentUser) return false;
  const r = (currentUser.role || '').toLowerCase();
  const p = (currentUser.position || '').toLowerCase();
  return r === 'admin' || r === 'manager' || p === 'manager';
}

function setupNavigation() {
  const isAdmin = currentUser.role === 'admin';
  let menu = isAdmin ? [...ADMIN_MENU] : [...EMP_MENU];

  if (!isAdmin && isEmpAdminOrSupervisor()) {
    const hasChatMenu = menu.some(m => m.id === 'internal-chat');
    if (!hasChatMenu) {
      menu.splice(4, 0, { id: 'internal-chat', label: 'Diskusi Internal', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z' });
    }
  }

  // Ensure Leaderboard & Payroll menu is strictly for Panel Manajemen (Manager)
  if (!isAdmin) {
    if (isManagerUser()) {
      const hasLeaderboard = menu.some(m => m.id === 'leaderboard');
      if (!hasLeaderboard) {
        menu.splice(1, 0, { id: 'leaderboard', label: 'Peringkat & KPI', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' });
      }
      const hasPayroll = menu.some(m => m.id === 'payroll');
      if (!hasPayroll) {
        menu.splice(2, 0, { id: 'payroll', label: 'Gaji & Payroll', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 8v2m0-6c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' });
      }
    } else {
      menu = menu.filter(m => m.id !== 'leaderboard' && m.id !== 'payroll');
    }
  }

  // Check unread/pending leaves & internal chats for badges
  let empHasUnreadLeave = false;
  let adminHasPendingLeave = false;

  if (isAdmin) {
    const allLeaves = getLeaves();
    adminHasPendingLeave = allLeaves.some(l => {
      const chats = l.chats ? Object.values(l.chats) : [];
      const lastRead = l.lastRead_Manajemen || 0;
      const hasUnreadChat = chats.some(c => c.role === 'Karyawan' && c.timestamp > lastRead);
      const isUnreadPending = l.status === 'Menunggu' && !l.lastRead_Manajemen;
      return hasUnreadChat || isUnreadPending;
    });
  } else if (currentUser && currentUser.username) {
    const emp = getUserByUsername(currentUser.username);
    if (emp) {
      const empLeaves = getLeaves(emp.emp_id);
      empHasUnreadLeave = empLeaves.some(l => {
        const chats = l.chats ? Object.values(l.chats) : [];
        const lastRead = l.lastRead_Karyawan || 0;
        return chats.some(c => c.role === 'Manajemen' && c.timestamp > lastRead);
      });
    }
  }

  // User-specific unread chat tracking
  const unreadChatCount = getUnreadChatCount();

  const redDot = `<span style="width:8px;height:8px;background:var(--danger);border-radius:50%;display:inline-block;margin-left:5px;box-shadow:0 0 6px var(--danger);vertical-align:middle"></span>`;
  const chatBadge = unreadChatCount > 0 
    ? `${redDot}<span style="background:var(--danger);color:#fff;font-size:0.6rem;padding:1px 6px;border-radius:10px;font-weight:700;margin-left:4px;box-shadow:0 0 6px var(--danger);">${unreadChatCount} Baru!</span>`
    : '';

  let dHTML = '';
  menu.forEach(m => {
    const isLeaveMenu = (m.id === 'leaves' && adminHasPendingLeave) || (m.id === 'emp-leaves' && empHasUnreadLeave);
    const isChatMenu = m.id === 'internal-chat' && unreadChatCount > 0;

    let labelWithBadge = m.label;
    if (isLeaveMenu) labelWithBadge = `${m.label}${redDot}`;
    if (isChatMenu) labelWithBadge = `${m.label}${chatBadge}`;

    if (m.href) {
      dHTML += `<a href="${m.href}" class="nav-item"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg>${labelWithBadge}</a>`;
    } else {
      dHTML += `<a class="nav-item" data-target="${m.id}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg>${labelWithBadge}</a>`;
    }
  });
  $('nav-desktop').innerHTML = dHTML;

  // Mobile: show max 4 items + "Lainnya" button
  const MAX_MOBILE = 4;
  const mobileMain = menu.slice(0, MAX_MOBILE);
  const mobileMore = menu.slice(MAX_MOBILE);
  let mHTML = '';
  mobileMain.forEach(m => {
    const isLeaveMenu = (m.id === 'leaves' && adminHasPendingLeave) || (m.id === 'emp-leaves' && empHasUnreadLeave);
    const isChatMenu = m.id === 'internal-chat' && unreadChatCount > 0;

    let labelWithBadge = m.label;
    if (isLeaveMenu) labelWithBadge = `${m.label}${redDot}`;
    if (isChatMenu) labelWithBadge = `${m.label}${chatBadge}`;

    if (m.href) {
      mHTML += `<a href="${m.href}" class="mobile-nav-item"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg><span>${labelWithBadge}</span></a>`;
    } else {
      mHTML += `<a class="mobile-nav-item" data-target="${m.id}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg><span>${labelWithBadge}</span></a>`;
    }
  });

  // Update Header Bell Button Visibility and Badge
  const bellBtn = document.getElementById('btn-nav-chat-bell');
  const bellBadge = document.getElementById('badge-bell-count');
  if (bellBtn) {
    if (isAdmin || isEmpAdminOrSupervisor()) {
      bellBtn.style.display = 'inline-flex';
      if (unreadChatCount > 0) {
        if (bellBadge) {
          bellBadge.textContent = unreadChatCount;
          bellBadge.classList.remove('hidden');
        }
      } else {
        if (bellBadge) bellBadge.classList.add('hidden');
      }
    } else {
      bellBtn.style.display = 'none';
    }
  }

  const hasMoreUnread = mobileMore.some(m => 
    (m.id === 'leaves' && adminHasPendingLeave) || 
    (m.id === 'emp-leaves' && empHasUnreadLeave) ||
    (m.id === 'internal-chat' && unreadChatCount > 0)
  );
  if (mobileMore.length > 0) {
    mHTML += `<a class="mobile-nav-item" onclick="window._toggleMoreMenu()"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg><span>Lainnya${hasMoreUnread ? redDot : ''}</span></a>`;
  }
  $('nav-mobile').innerHTML = mHTML;

  // Build "more" popup
  let existingMore = document.getElementById('more-menu-popup');
  if (existingMore) existingMore.remove();
  if (mobileMore.length > 0) {
    const popup = document.createElement('div');
    popup.id = 'more-menu-popup';
    popup.className = 'more-menu-popup hidden';
    popup.innerHTML = `<div class="more-menu-backdrop" onclick="window._toggleMoreMenu()"></div>
      <div class="more-menu-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid var(--border)">
          <strong style="font-size:0.95rem">Menu Lainnya</strong>
          <button onclick="window._toggleMoreMenu()" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--text-muted)">✕</button>
        </div>
        <div style="padding:0.75rem">${mobileMore.map(m => {
      const isLeaveMenu = (m.id === 'leaves' && adminHasPendingLeave) || (m.id === 'emp-leaves' && empHasUnreadLeave);
      const isChatMenu = m.id === 'internal-chat' && unreadChatCount > 0;

      let labelWithBadge = m.label;
      if (isLeaveMenu) labelWithBadge = `${m.label}${redDot}`;
      if (isChatMenu) labelWithBadge = `${m.label}${chatBadge}`;

      if (m.href) {
        return `<a href="${m.href}" class="more-menu-item">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg>
            <span>${labelWithBadge}</span>
          </a>`;
      } else {
        return `<a class="more-menu-item" data-target="${m.id}" onclick="window._toggleMoreMenu()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg>
            <span>${labelWithBadge}</span>
          </a>`;
      }
    }).join('')}</div>
      </div>`;
    document.body.appendChild(popup);
  }

  document.querySelectorAll('[data-target]').forEach(el => el.addEventListener('click', () => switchSection(el.getAttribute('data-target'))));
}

window._toggleMoreMenu = () => {
  const popup = document.getElementById('more-menu-popup');
  if (popup) popup.classList.toggle('hidden');
};

window._toggleDesktopSidebar = () => {
  const screenMain = document.getElementById('screen-main');
  if (!screenMain) return;
  screenMain.classList.toggle('sidebar-collapsed');
  const isCollapsed = screenMain.classList.contains('sidebar-collapsed');
  localStorage.setItem('mytic_sidebar_collapsed', isCollapsed ? 'true' : 'false');
};

window._previewImage = (imgSrc, title = '') => {
  if (!imgSrc) return;
  showModal(`
    <div class="modal-header" style="border-bottom:1px solid var(--border)">
      <h3 class="modal-title">${esc(title || 'Foto Profil')}</h3>
      <button class="modal-close" onclick="window._hideModal()">✕</button>
    </div>
    <div class="modal-body" style="text-align:center;padding:1rem;">
      <img src="${imgSrc}" alt="Preview" style="max-width:100%;max-height:70vh;border-radius:var(--radius-lg);object-fit:contain;box-shadow:var(--shadow-lg);">
    </div>
    <div class="modal-footer" style="text-align:right;">
      <button class="btn btn-secondary" onclick="window._hideModal()">Tutup</button>
    </div>
  `);
};

function switchSection(id) {
  currentSection = id;
  document.querySelectorAll('[data-target]').forEach(el => el.classList.toggle('active', el.getAttribute('data-target') === id));
  const label = document.querySelector(`.nav-item[data-target="${id}"]`);
  $('topbar-title').textContent = label ? label.textContent.trim() : 'Dashboard';

  // Auto-hide sidebar on PC when selecting a menu
  const screenMain = document.getElementById('screen-main');
  if (screenMain && !screenMain.classList.contains('sidebar-collapsed')) {
    screenMain.classList.add('sidebar-collapsed');
  }

  renderCurrentSection();
}
window.switchSection = switchSection;

// Auto-hide PC sidebar when clicking outside
document.addEventListener('click', (e) => {
  const screenMain = document.getElementById('screen-main');
  if (!screenMain || screenMain.classList.contains('sidebar-collapsed')) return;
  const isSidebar = e.target.closest('.sidebar');
  const isToggleBtn = e.target.closest('#btn-toggle-sidebar');
  if (!isSidebar && !isToggleBtn) {
    screenMain.classList.add('sidebar-collapsed');
  }
});

function renderCurrentSection() {
  if (currentUser) setupNavigation();
  const w = $('content-wrapper'); if (!w) return;
  const isAdmin = currentUser && currentUser.role === 'admin';
  let html = '';
  if (isAdmin) {
    switch (currentSection) {
      case 'dashboard': html = renderAdminDashboard(); break;
      case 'employees': html = renderEmployees(); break;
      case 'internal-chat': html = renderInternalChat(); break;
      case 'debits': html = renderDebits(); break;
      case 'leaves': html = renderMgmtLeaves(); break;
      case 'leave-types': html = renderLeaveTypes(); break;
      case 'violations': html = renderViolations(); break;
      case 'savings': html = renderSavings(); break;
      case 'ratings': html = renderRatings(); break;
      case 'criteria': html = renderCriteriaPage(); break;
      case 'leaderboard': html = isManagerUser() ? renderLeaderboardPage() : '<div class="card p-6 text-center text-muted">Akses Khusus Manager / Panel Manajemen.</div>'; break;
      case 'payroll': html = (isAdmin || isManagerUser()) ? renderPayrollPage() : '<div class="card p-6 text-center text-muted">Akses Khusus Panel Manajemen.</div>'; break;
      case 'settings': html = renderSettings(); break;
      default: html = renderAdminDashboard();
    }
  } else {
    switch (currentSection) {
      case 'dashboard': html = renderEmpDashboard(); break;
      case 'internal-chat': html = renderInternalChat(); break;
      case 'emp-debits': html = renderEmpDebits(); break;
      case 'emp-history': html = renderEmpHistory(); break;
      case 'emp-leaves': html = renderEmpLeaves(); break;
      case 'emp-violations': html = renderEmpViolations(); break;
      case 'emp-savings': html = renderEmpSavings(); break;
      case 'emp-ratings': html = renderEmpRatings(); break;
      case 'emp-profile': html = renderEmpProfile(); break;
      case 'leaderboard': html = isManagerUser() ? renderLeaderboardPage() : '<div class="card p-6 text-center text-muted">Akses Khusus Manager / Panel Manajemen.</div>'; break;
      case 'payroll': html = isManagerUser() ? renderPayrollPage() : '<div class="card p-6 text-center text-muted">Akses Khusus Panel Manajemen.</div>'; break;
      default: html = renderEmpDashboard();
    }
  }
  w.innerHTML = html;
  if (currentSection === 'criteria' && window._activeCriteriaFormState) {
    const state = { ...window._activeCriteriaFormState };
    window._showCriteriaForm();
    setTimeout(() => {
      const sel = $('cf-indicator-select');
      if (sel) {
        const opt = Array.from(sel.options).find(o => o.value === state.indicator);
        if (opt) {
          sel.value = state.indicator;
          sel.dispatchEvent(new Event('change'));
        }
      }
      const nameInp = $('cf-name');
      if (nameInp) {
        nameInp.value = '';
        nameInp.focus();
      }
    }, 30);
  }
}

// ==========================================
// ADMIN DASHBOARD
// ==========================================
function renderAdminDashboard() {
  const users = getUsers();
  const leaves = getLeaves();
  const pending = leaves.filter(l => l.status === 'Menunggu').length;
  let totalDebit = 0; users.forEach(u => totalDebit += calcBalance(u.emp_id));
  let totalSavings = 0; Object.values(allData.savings || {}).forEach(s => totalSavings += (s.amount || 0));

  setTimeout(() => initAdminDashboardCharts(), 50);

  return `<div class="fade-in">
    <div class="dashboard-grid">
      <div class="stat-card" onclick="window._nav('employees')"><div class="stat-title">Total Karyawan</div><div class="stat-value">${users.length}</div></div>
      <div class="stat-card" onclick="window._nav('debits')"><div class="stat-title">Total Tunggakan</div><div class="stat-value" style="color:var(--danger)">${fmt(totalDebit)}</div></div>
      <div class="stat-card" onclick="window._nav('leaves')"><div class="stat-title">Menunggu Approve</div><div class="stat-value" style="color:var(--warning)">${pending}</div></div>
      <div class="stat-card" onclick="window._nav('savings')"><div class="stat-title">Total Tabungan</div><div class="stat-value" style="color:var(--success)">${fmt(totalSavings)}</div></div>
    </div>

    <!-- LEADERBOARD QUICK BANNER CARD -->
    <div class="card mb-6" style="padding:1.25rem; background:var(--surface); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; cursor:pointer;" onclick="window._nav('leaderboard')">
      <div style="display:flex; align-items:center; gap:1rem;">
        <div style="width:46px; height:46px; border-radius:12px; background:linear-gradient(135deg, #FFD700, #FFA500); display:flex; align-items:center; justify-content:center; font-size:1.4rem; box-shadow:0 4px 12px rgba(255,215,0,0.4);">
          🏆
        </div>
        <div>
          <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Modul Peringkat & KPI Karyawan</h3>
          <p class="text-xs text-muted">Evaluasi kedisiplinan, kepatuhan SOP, & rating seluruh karyawan secara objektif</p>
        </div>
      </div>
      <button class="btn btn-primary" style="padding:0.5rem 1.25rem; font-size:0.85rem;" onclick="event.stopPropagation(); window._nav('leaderboard')">
        Buka Peringkat Karyawan ➔
      </button>
    </div>

    <!-- CERTIFICATE GENERATOR QUICK BANNER -->
    <div class="card mb-6" style="padding:1.25rem; background:var(--surface); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; cursor:pointer;" onclick="window._openCertificateModal()">
      <div style="display:flex; align-items:center; gap:1rem;">
        <div style="width:46px; height:46px; border-radius:12px; background:linear-gradient(135deg, #bf953f, #fcf6ba); display:flex; align-items:center; justify-content:center; font-size:1.4rem; box-shadow:0 4px 12px rgba(191,149,63,0.4);">
          🎖️
        </div>
        <div>
          <h3 style="font-size:1.05rem; font-weight:800; color:var(--text-main);">Sertifikat Penghargaan Karyawan</h3>
          <p class="text-xs text-muted">Buat & cetak sertifikat penghargaan premium untuk karyawan berprestasi</p>
        </div>
      </div>
      <button class="btn" style="padding:0.5rem 1.25rem; font-size:0.85rem; font-weight:800; background:linear-gradient(135deg,#b38728,#fcf6ba,#bf953f); color:#1a1a2e; border:none; border-radius:8px; box-shadow:0 4px 12px rgba(179,135,40,0.3);" onclick="event.stopPropagation(); window._openCertificateModal()">
        Buat Sertifikat ➔
      </button>
    </div>

    <!-- GRAPHICS GRID HEADER WITH PERIOD FILTER -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.75rem;">
      <h3 style="font-size:1.1rem; font-weight:800; color:var(--text-main); display:flex; align-items:center; gap:0.5rem; margin:0;">
        📊 Grafik & Analisis Operasional SPBU
      </h3>
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <label class="form-label" style="margin:0; font-weight:700; font-size:0.8rem; color:var(--text-muted);">Periode Grafik:</label>
        <select id="admin-chart-period" class="form-input form-select" onchange="window._onAdminChartPeriodChange()" style="padding:0.4rem 0.8rem; font-size:0.8rem; min-width:180px;">
          <option value="month" ${(window._adminChartPeriod || 'month') === 'month' ? 'selected' : ''}>Bulan Ini (${new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})</option>
          <option value="last_month" ${(window._adminChartPeriod || 'month') === 'last_month' ? 'selected' : ''}>Bulan Lalu (${new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})</option>
          ${Array.from({length: 10}, (_, i) => {
            const d = new Date(new Date().getFullYear(), new Date().getMonth() - (i + 2), 1);
            const val = d.toISOString().slice(0, 7);
            const label = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
            return `<option value="${val}" ${(window._adminChartPeriod || 'month') === val ? 'selected' : ''}>${label}</option>`;
          }).join('')}
          <option value="quarter" ${(window._adminChartPeriod || 'month') === 'quarter' ? 'selected' : ''}>Triwulan (3 Bulan)</option>
          <option value="year" ${(window._adminChartPeriod || 'month') === 'year' ? 'selected' : ''}>Tahun Ini (${new Date().getFullYear()})</option>
          <option value="all" ${(window._adminChartPeriod || 'month') === 'all' ? 'selected' : ''}>Semua Periode</option>
        </select>
      </div>
    </div>

    <!-- GRAPHICS GRID -->
    <div class="graphics-grid">
      <div class="card chart-card-wide" style="padding:1.25rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 class="card-title" style="font-size:1rem;">📈 Tren Kehadiran & Ketepatan Waktu</h3>
        </div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-admin-attendance"></canvas>
        </div>
      </div>

      <div class="card chart-card-compact" style="padding:1.25rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 class="card-title" style="font-size:1rem;">🍩 Distribusi Pengajuan Cuti & Izin</h3>
        </div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-admin-leaves"></canvas>
        </div>
      </div>

      <div class="card chart-card-wide" style="padding:1.25rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 class="card-title" style="font-size:1rem;">📊 Performa Ceklis SOP per Kategori</h3>
        </div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-admin-sop"></canvas>
        </div>
      </div>

      <div class="card chart-card-compact" style="padding:1.25rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h3 class="card-title" style="font-size:1rem;">⚠️ Ringkasan Pelanggaran & Teguran SP</h3>
        </div>
        <div style="position:relative;height:260px;">
          <canvas id="chart-admin-violations"></canvas>
        </div>
      </div>
    </div>

    <div class="card"><div class="card-header"><h3 class="card-title">Pengajuan Terbaru</h3></div>
      ${leaves.length === 0 ? '<p class="text-muted text-sm">Belum ada pengajuan.</p>' :
      leaves.slice(0, 5).map(l => {
        const emp = getUserByEmpId(l.emp_id);
        const sc = l.status === 'Disetujui' ? 'badge-success' : l.status === 'Ditolak' ? 'badge-danger' : 'badge-warning';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 0;border-bottom:1px solid var(--border)">
          <div><strong class="text-sm">${esc(emp ? emp.name : l.emp_id)}</strong><br><span class="text-xs text-muted">${esc(l.leave_type)} • ${fmtDate(l.start_date)}</span></div>
          <span class="badge ${sc}">${esc(l.status)}</span></div>`;
      }).join('')}
    </div>
  </div>`;
}

window._onAdminChartPeriodChange = () => {
  const sel = document.getElementById('admin-chart-period');
  if (sel) {
    window._adminChartPeriod = sel.value;
    initAdminDashboardCharts();
  }
};

function getAdminChartPeriodRange(period) {
  const now = new Date();
  let startDate = new Date();
  let endDate = new Date();
  let mode = 'days';

  if (period === 'last_month') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  } else if (period === 'quarter') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (period === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    mode = 'months';
  } else if (period === 'all') {
    startDate = new Date(2020, 0, 1);
    endDate = new Date(2030, 11, 31, 23, 59, 59);
    mode = 'all';
  } else if (typeof period === 'string' && /^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    startDate = new Date(y, m - 1, 1);
    endDate = new Date(y, m, 0, 23, 59, 59);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  }

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  return { startDate, endDate, startStr, endStr, mode };
}

function initAdminDashboardCharts() {
  if (typeof Chart === 'undefined') return;
  const colors = getChartColors();
  const periodKey = window._adminChartPeriod || 'month';
  const range = getAdminChartPeriodRange(periodKey);

  const parseToISO = (val) => {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number') {
      try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch { return ''; }
    }
    const str = val.toString().trim();
    if (!str) return '';
    if (/^\d{10,13}$/.test(str)) {
      try {
        const num = Number(str);
        const d = new Date(num > 1e11 ? num : num * 1000);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch { return ''; }
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    if (/^\d{4}-\d{2}$/.test(str)) return str + '-01';
    const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;
    }
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
    return '';
  };

  const isRecordInChartPeriod = (...dateCandidates) => {
    if (range.mode === 'all') return true;
    for (const val of dateCandidates) {
      const iso = parseToISO(val);
      if (iso) {
        return iso >= range.startStr && iso <= range.endStr;
      }
    }
    return false;
  };

  // 1. Attendance Trend
  const attCanvas = document.getElementById('chart-admin-attendance');
  if (attCanvas) {
    destroyChart('admin-attendance');
    const days = [];
    const onTimeData = [];
    const lateData = [];
    const sakitData = [];
    const izinData = [];
    const cutiData = [];
    const liburData = [];
    const otherData = [];

    const allAbsensi = Object.values(allData.absensi_records || {});

    const cur = new Date(range.startDate);
    const endLimit = new Date(Math.min(range.endDate.getTime(), Date.now()));

    while (cur <= endLimit) {
      const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      days.push(cur.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));

      const recs = allAbsensi.filter(r => parseToISO(r.date || r.tanggal) === dateStr);
      let onTime = 0, late = 0, sakit = 0, izin = 0, cuti = 0, libur = 0, other = 0;

      recs.forEach(r => {
        const rawStatus = (r.status || r.type || '').toString().trim();
        const st = rawStatus.toLowerCase();
        const lateMins = Number(r.late_minutes || 0);

        if (st.includes('sakit')) {
          sakit++;
        } else if (st.includes('izin')) {
          izin++;
        } else if (st.includes('cuti')) {
          cuti++;
        } else if (st.includes('libur') || st.includes('off')) {
          libur++;
        } else if (st.includes('terlambat') || (lateMins > 0 && !st.includes('on time'))) {
          late++;
        } else if (st.includes('on time') || st.includes('hadir') || (r.clock_in && r.clock_in !== '-')) {
          onTime++;
        } else if (st) {
          other++;
        }
      });

      onTimeData.push(onTime);
      lateData.push(late);
      sakitData.push(sakit);
      izinData.push(izin);
      cutiData.push(cuti);
      liburData.push(libur);
      otherData.push(other);

      cur.setDate(cur.getDate() + 1);
    }

    window._myTicCharts['admin-attendance'] = new Chart(attCanvas, {
      type: 'line',
      data: {
        labels: days.length ? days : ['Belum Ada Data'],
        datasets: [
          { label: 'Tepat Waktu', data: onTimeData, borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.1)', fill: false, tension: 0.3 },
          { label: 'Terlambat', data: lateData, borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: false, tension: 0.3 },
          { label: 'Sakit', data: sakitData, borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.1)', fill: false, tension: 0.3 },
          { label: 'Izin', data: izinData, borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)', fill: false, tension: 0.3 },
          { label: 'Cuti', data: cutiData, borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.1)', fill: false, tension: 0.3 },
          { label: 'Libur', data: liburData, borderColor: '#6366F1', backgroundColor: 'rgba(99,102,241,0.1)', fill: false, tension: 0.3 },
          { label: 'Lainnya', data: otherData, borderColor: '#EC4899', backgroundColor: 'rgba(236,72,153,0.1)', fill: false, tension: 0.3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: colors.text,
              usePointStyle: true,
              boxWidth: 8
            }
          }
        },
        scales: {
          x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.text, stepSize: 1 }, grid: { color: colors.grid }, beginAtZero: true }
        }
      }
    });
  }

  // 2. Leave Distribution (Doughnut)
  const leaveCanvas = document.getElementById('chart-admin-leaves');
  if (leaveCanvas) {
    destroyChart('admin-leaves');
    const leaves = Object.values(allData.leaves || {}).filter(l => isRecordInChartPeriod(l.start_date, l.created_at));
    const approved = leaves.filter(l => l.status === 'Disetujui').length;
    const pending = leaves.filter(l => l.status === 'Menunggu').length;
    const rejected = leaves.filter(l => l.status === 'Ditolak').length;

    window._myTicCharts['admin-leaves'] = new Chart(leaveCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Disetujui', 'Menunggu', 'Ditolak'],
        datasets: [{
          data: [approved, pending, rejected],
          backgroundColor: ['#10B981', '#F59E0B', '#EF4444'],
          borderWidth: 2,
          borderColor: colors.cardBg
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: colors.text } } }
      }
    });
  }

  // 3. SOP Performance per Category (Bar)
  const sopCanvas = document.getElementById('chart-admin-sop');
  if (sopCanvas) {
    destroyChart('admin-sop');
    const sopRecords = Object.values(allData.ceklissop_records || allData.sop_checklists || {}).filter(r => isRecordInChartPeriod(r.date, r.tanggal, r.created_at));
    const catScores = {};
    sopRecords.forEach(r => {
      const cat = r.category || 'Umum';
      if (!catScores[cat]) catScores[cat] = { total: 0, count: 0 };
      catScores[cat].total += (r.score || 0);
      catScores[cat].count++;
    });

    const labels = Object.keys(catScores);
    const dataAvg = labels.map(c => catScores[c].count ? Math.round(catScores[c].total / catScores[c].count) : 0);

    window._myTicCharts['admin-sop'] = new Chart(sopCanvas, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Belum Ada Data'],
        datasets: [{
          label: 'Rata-rata Kepatuhan (%)',
          data: dataAvg.length ? dataAvg : [0],
          backgroundColor: '#3B82F6',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: colors.text } } },
        scales: {
          x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.text }, grid: { color: colors.grid }, min: 0, max: 100 }
        }
      }
    });
  }

  // 4. Violation Breakdown (Pie)
  const viosCanvas = document.getElementById('chart-admin-violations');
  if (viosCanvas) {
    destroyChart('admin-violations');
    const vios = Object.values(allData.violations || {}).filter(v => isRecordInChartPeriod(v.date, v.tanggal, v.created_at, v.start_date));
    const sp1 = vios.filter(v => v.level === 'SP1').length;
    const sp2 = vios.filter(v => v.level === 'SP2').length;
    const sp3 = vios.filter(v => v.level === 'SP3').length;
    const teguran = vios.filter(v => v.level === 'Teguran' || v.level === 'Lisan' || !['SP1','SP2','SP3'].includes(v.level)).length;

    window._myTicCharts['admin-violations'] = new Chart(viosCanvas, {
      type: 'pie',
      data: {
        labels: ['SP1', 'SP2', 'SP3', 'Teguran'],
        datasets: [{
          data: [sp1, sp2, sp3, teguran],
          backgroundColor: ['#F59E0B', '#EC4899', '#EF4444', '#3B82F6'],
          borderWidth: 2,
          borderColor: colors.cardBg
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: colors.text } } }
      }
    });
  }
}

// ==========================================
// EMPLOYEES (ADMIN)
// ==========================================
function renderEmployees() {
  const users = getUsers();
  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <div><h3 class="text-xl font-bold">${users.length} Karyawan</h3></div>
      <button class="btn btn-primary" onclick="window._showEmpForm()">+ Tambah</button>
    </div>
    <div id="emp-form-area"></div>
    ${users.length === 0 ? '<div class="card" style="text-align:center;padding:3rem"><p class="text-muted">Belum ada karyawan. Klik Tambah.</p></div>' :
      users.map(e => {
        const avatarHtml = e.profile_picture
          ? `<img src="${e.profile_picture}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;cursor:pointer;transition:transform 0.2s" onclick="window._previewImage('${e.profile_picture}', '${esc(e.name)}')" title="Klik untuk lihat foto penuh" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">`
          : `<div style="width:44px;height:44px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem">${(e.name || '?')[0]}</div>`;
        return `<div class="card" style="margin-bottom:0.75rem">
      <div style="display:flex;align-items:center;gap:1rem">
        ${avatarHtml}
        <div style="flex:1;min-width:0"><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)} • ${esc(e.emp_id)} • ${esc(e.username)}</span></div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-secondary" style="padding:0.5rem 0.75rem;font-size:0.75rem" onclick="window._showEmpDetail('${e._key}')">Detail</button>
          <button class="btn btn-secondary" style="padding:0.5rem 0.75rem;font-size:0.75rem" onclick="window._showEmpForm('${e._key}')">Edit</button>
          <button class="btn btn-outline-danger" style="padding:0.5rem 0.75rem;font-size:0.75rem" onclick="window._deleteEmp('${e._key}')">Hapus</button>
        </div>
      </div>
    </div>`;
      }).join('')}
  </div>`;
}

function isEmpAdminOrSupervisor() {
  if (!currentUser || currentUser.role !== 'employee') return false;
  const pos = (currentUser.position || '').toLowerCase();
  return pos.includes('admin') || pos.includes('supervisor');
}

function canAddDebit() {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  return isEmpAdminOrSupervisor();
}

function canAddCredit() {
  if (!currentUser) return false;
  return currentUser.role === 'admin';
}

// ==========================================
// DEBITS (ADMIN & SUPERVISOR)
// ==========================================
function renderTxnListItems(txns, empId) {
  if (!txns || txns.length === 0) return '<p class="text-xs text-muted" style="text-align:center;padding:0.5rem">Belum ada transaksi pada kategori ini.</p>';
  return txns.map(t => {
    const adder = t.added_by || 'Manajemen';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.75rem;background:var(--bg-color);border-radius:var(--radius-md);margin-bottom:0.35rem;font-size:0.8rem">
    <div>
      <strong style="color:${t.type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${t.type === 'debit' ? '+' : '-'}${fmt(t.amount)}</strong> 
      <span class="text-muted">${esc(t.note || '')}</span>
      <span class="text-xs text-muted" style="display:block;margin-top:3px;font-size:0.72rem;">✍️ Ditambahkan oleh: <strong style="color:var(--text-main)">${esc(adder)}</strong></span>
    </div>
    <div style="display:flex;align-items:center;gap:0.5rem">
      <span class="text-muted" style="font-size:0.75rem">${fmtDate(t.date)}</span>
      ${currentUser && currentUser.role === 'admin' ? `<button style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:0.7rem" onclick="window._deleteTxn('${t._key}')">✕</button>` : ''}
    </div>
  </div>`;
  }).join('');
}

function renderDebits() {
  const users = getUsers();
  const allowCredit = canAddCredit();
  const allowDebit = canAddDebit();

  let grandTotalDebit = 0;
  let grandTotalCredit = 0;

  const allTxns = Object.values(allData.transactions || {});
  allTxns.forEach(t => {
    if (t.type === 'debit') grandTotalDebit += (t.amount || 0);
    else if (t.type === 'credit') grandTotalCredit += (t.amount || 0);
  });
  const grandNetBalance = grandTotalDebit - grandTotalCredit;

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem">
      <div>
        <h3 class="text-xl font-bold">Tunggakan & Pelunasan Karyawan</h3>
        <p class="text-xs text-muted">Rekapitulasi transaksi debit (tunggakan) dan kredit (pembayaran) per karyawan</p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-secondary" style="padding:0.4rem 0.8rem;font-size:0.75rem" onclick="window._showDebitCreditSummaryModal()">📋 Lihat Rekap Tabel All Karyawan</button>
        ${isEmpAdminOrSupervisor() ? '<span class="badge badge-warning">Akses Tambah Debit</span>' : ''}
      </div>
    </div>

    <!-- Overview Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:0.75rem;margin-bottom:1.25rem">
      <div class="card" style="padding:1rem;border-left:4px solid var(--danger);background:var(--card-bg)">
        <p class="text-xs text-muted font-semibold">🔴 TOTAL DEBIT (TUNGGAKAN)</p>
        <p style="font-size:1.25rem;font-weight:800;color:var(--danger);margin-top:0.25rem">${fmt(grandTotalDebit)}</p>
      </div>
      <div class="card" style="padding:1rem;border-left:4px solid var(--success);background:var(--card-bg)">
        <p class="text-xs text-muted font-semibold">🟢 TOTAL KREDIT (PEMBAYARAN)</p>
        <p style="font-size:1.25rem;font-weight:800;color:var(--success);margin-top:0.25rem">${fmt(grandTotalCredit)}</p>
      </div>
      <div class="card" style="padding:1rem;border-left:4px solid var(--primary);background:var(--card-bg)">
        <p class="text-xs text-muted font-semibold">⚖️ SISA NET SALDO TUNGGAKAN</p>
        <p style="font-size:1.25rem;font-weight:800;color:${grandNetBalance > 0 ? 'var(--danger)' : 'var(--success)'};margin-top:0.25rem">${fmt(grandNetBalance)}</p>
      </div>
    </div>

    ${users.length === 0 ? '<div class="card"><p class="text-muted">Tambahkan karyawan dahulu.</p></div>' :
      users.map(e => {
        const txns = getTxns(e.emp_id);
        const empDebit = txns.filter(t => t.type === 'debit').reduce((sum, t) => sum + (t.amount || 0), 0);
        const empCredit = txns.filter(t => t.type === 'credit').reduce((sum, t) => sum + (t.amount || 0), 0);
        const bal = empDebit - empCredit;

        return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;flex-wrap:wrap;gap:0.75rem" onclick="document.getElementById('txn-${e.emp_id}').classList.toggle('hidden')">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div style="width:42px;height:42px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800">${(e.name || '?')[0]}</div>
            <div>
              <strong>${esc(e.name)}</strong><br>
              <span class="text-xs text-muted">${esc(e.position)} • ${txns.length} Transaksi</span>
            </div>
          </div>
          <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
            <div style="text-align:right;font-size:0.75rem;border-right:1px solid var(--border);padding-right:0.75rem">
              <span style="color:var(--danger);font-weight:700">Debit: ${fmt(empDebit)}</span><br>
              <span style="color:var(--success);font-weight:700">Kredit: ${fmt(empCredit)}</span>
            </div>
            <div style="text-align:right">
              <span class="text-xs text-muted">Sisa Saldo</span><br>
              <strong style="font-size:1.05rem;color:${bal > 0 ? 'var(--danger)' : bal < 0 ? 'var(--success)' : 'var(--text-muted)'}">${fmt(bal)}</strong>
            </div>
          </div>
        </div>
        <div id="txn-${e.emp_id}" class="hidden" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
          ${(allowDebit || allowCredit) ? `
          <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
            ${allowDebit ? `<button class="btn btn-danger" style="flex:1;padding:0.5rem;font-size:0.75rem" onclick="window._showTxnForm('${e.emp_id}','debit')">+ Debit (Tambah Tunggakan)</button>` : ''}
            ${allowCredit ? `<button class="btn btn-primary" style="flex:1;padding:0.5rem;font-size:0.75rem;background:var(--success)" onclick="window._showTxnForm('${e.emp_id}','credit')">+ Kredit (Pembayaran)</button>` : ''}
          </div>` : ''}
          <div id="txn-form-${e.emp_id}"></div>

          <!-- Transaction Filter Tabs -->
          <div style="display:flex;gap:0.4rem;margin-bottom:0.75rem;border-bottom:1px solid var(--border);padding-bottom:0.5rem">
            <button class="btn btn-secondary btn-txn-filter active" style="padding:0.25rem 0.6rem;font-size:0.7rem" onclick="window._filterTxns('${e.emp_id}', 'all', this)">Semua (${txns.length})</button>
            <button class="btn btn-secondary btn-txn-filter" style="padding:0.25rem 0.6rem;font-size:0.7rem" onclick="window._filterTxns('${e.emp_id}', 'debit', this)">🔴 Debit (${txns.filter(t=>t.type==='debit').length})</button>
            <button class="btn btn-secondary btn-txn-filter" style="padding:0.25rem 0.6rem;font-size:0.7rem" onclick="window._filterTxns('${e.emp_id}', 'credit', this)">🟢 Kredit (${txns.filter(t=>t.type==='credit').length})</button>
          </div>

          <div id="txn-list-${e.emp_id}">
            ${renderTxnListItems(txns, e.emp_id)}
          </div>
        </div>
      </div>`;
      }).join('')}
  </div>`;
}

// ==========================================
// LEAVES (ADMIN)
// ==========================================
function renderLeaveChatButton(l, role) {
  const chats = l.chats ? Object.values(l.chats) : [];
  if (chats.length === 0) {
    return `<button class="btn btn-primary" style="padding:0.3rem 0.6rem;font-size:0.7rem;display:inline-flex;align-items:center;gap:0.3rem" onclick="window._showLeaveChat('${l._key}', '${role}')">💬 Diskusi</button>`;
  }

  chats.sort((a, b) => a.timestamp - b.timestamp);
  const lastRead = role === 'Manajemen' ? (l.lastRead_Manajemen || 0) : (l.lastRead_Karyawan || 0);
  const unreadCount = chats.filter(c => c.role !== role && c.timestamp > lastRead).length;

  if (unreadCount > 0) {
    return `<button class="btn btn-primary" style="padding:0.3rem 0.6rem;font-size:0.7rem;display:inline-flex;align-items:center;gap:0.3rem;border:1.5px solid var(--danger);box-shadow: 0 0 8px rgba(239, 68, 68, 0.4)" onclick="window._showLeaveChat('${l._key}', '${role}')">
      💬 Diskusi (${chats.length}) 
      <span style="background:var(--danger);color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:8px;font-weight:700">${unreadCount} Baru!</span>
    </button>`;
  }

  return `<button class="btn btn-primary" style="padding:0.3rem 0.6rem;font-size:0.7rem;display:inline-flex;align-items:center;gap:0.3rem" onclick="window._showLeaveChat('${l._key}', '${role}')">💬 Diskusi (${chats.length})</button>`;
}

function renderMgmtLeaves() {
  const leaves = getLeaves();
  return `<div class="fade-in">
    <h3 class="text-xl font-bold mb-4">Pengajuan Izin/Cuti</h3>
    ${leaves.length === 0 ? '<div class="card"><p class="text-muted">Belum ada pengajuan.</p></div>' :
      leaves.map(l => {
        const emp = getUserByEmpId(l.emp_id);
        const sc = l.status === 'Disetujui' ? 'badge-success' : l.status === 'Ditolak' ? 'badge-danger' : 'badge-warning';
        return `<div class="card" style="margin-bottom:0.75rem;border-left:4px solid ${l.status === 'Disetujui' ? 'var(--success)' : l.status === 'Ditolak' ? 'var(--danger)' : 'var(--warning)'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <strong>${esc(emp ? emp.name : l.emp_id)}</strong><br>
            <span class="text-xs text-muted">${esc(l.leave_type)} • ${fmtDate(l.start_date)} - ${fmtDate(l.end_date)}</span><br>
            <span class="text-xs text-muted">${esc(l.reason || '-')}</span>
            ${l.feedback ? `<br><span class="text-xs mt-1" style="display:inline-block;padding:0.25rem 0.5rem;background:var(--bg-color);border-radius:var(--radius-sm);color:var(--primary);font-weight:600">Catatan: ${esc(l.feedback)}</span>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;align-items:flex-end">
            <select onchange="window._updateLeaveStatus('${l._key}',this.value)" class="form-input form-select" style="padding:0.4rem 2rem 0.4rem 0.6rem;font-size:0.75rem;font-weight:700;width:auto">
              <option value="Menunggu" ${l.status === 'Menunggu' ? 'selected' : ''}>Menunggu</option>
              <option value="Disetujui" ${l.status === 'Disetujui' ? 'selected' : ''}>Disetujui</option>
              <option value="Ditolak" ${l.status === 'Ditolak' ? 'selected' : ''}>Ditolak</option>
            </select>
            <div style="display:flex;gap:0.5rem">
              ${renderLeaveChatButton(l, 'Manajemen')}
              <button class="btn btn-outline-danger" style="padding:0.3rem 0.6rem;font-size:0.7rem" onclick="window._deleteLeave('${l._key}')">Hapus</button>
            </div>
          </div>
        </div>
      </div>`;
      }).join('')}
  </div>`;
}

// ==========================================
// LEAVE TYPES (ADMIN)
// ==========================================
function renderLeaveTypes() {
  const types = getLeaveTypes();
  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Jenis Cuti</h3>
      <button class="btn btn-primary" onclick="window._showLeaveTypeForm()">+ Tambah</button>
    </div>
    <div id="lt-form-area"></div>
    ${types.length === 0 ? '<div class="card"><p class="text-muted">Belum ada jenis cuti.</p></div>' :
      types.map(t => `<div class="card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center">
      <div><strong>${esc(t.name)}</strong><br><span class="text-xs text-muted">Jatah: ${t.quota || '-'} hari/tahun • Berlaku: ${esc(t.gender || 'Semua')}</span></div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-secondary" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._showLeaveTypeForm('${t._key}')">Edit</button>
        <button class="btn btn-outline-danger" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._deleteLeaveType('${t._key}')">Hapus</button>
      </div>
    </div>`).join('')}
  </div>`;
}

// ==========================================
// VIOLATIONS (ADMIN)
// ==========================================
function renderViolations() {
  const users = getUsers();
  return `<div class="fade-in">
    <h3 class="text-xl font-bold mb-4">Kartu Pelanggaran</h3>
    ${users.length === 0 ? '<div class="card"><p class="text-muted">Tambahkan karyawan dahulu.</p></div>' :
      users.map(e => {
        const vios = getViolations(e.emp_id);
        return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="document.getElementById('vio-${e.emp_id}').classList.toggle('hidden')">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800">${(e.name || '?')[0]}</div>
            <div><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)}</span></div>
          </div>
          <div style="text-align:right"><strong style="color:var(--danger)">${vios.length}</strong><br><span class="text-xs text-muted">pelanggaran</span></div>
        </div>
        <div id="vio-${e.emp_id}" class="hidden" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
          <button class="btn btn-danger" style="width:100%;margin-bottom:1rem;padding:0.5rem;font-size:0.75rem" onclick="window._showVioForm('${e.emp_id}')">+ Tambah Pelanggaran</button>
          <div id="vio-form-${e.emp_id}"></div>
          ${vios.length === 0 ? '<p class="text-xs text-muted" style="text-align:center">Bersih 👍</p>' :
            vios.map(v => {
              const lc = v.level === 'SP3' ? 'var(--danger)' : v.level === 'SP2' ? 'var(--warning)' : v.level === 'SP1' ? '#EAB308' : 'var(--info)';
              return `<div style="border-left:4px solid ${lc};padding:0.75rem;background:var(--bg-color);border-radius:var(--radius-md);margin-bottom:0.5rem">
              <div style="display:flex;justify-content:space-between"><strong class="text-xs" style="color:${lc}">${esc(v.level)}</strong><button style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:0.7rem" onclick="window._deleteVio('${v._key}')">✕</button></div>
              <p class="text-xs">${esc(v.violation_type)}: ${esc(v.description)}</p>
              <span class="text-xs text-muted">${fmtDate(v.date)}</span>
            </div>`;
            }).join('')}
        </div>
      </div>`;
      }).join('')}
  </div>`;
}

// ==========================================
// SAVINGS (ADMIN)
// ==========================================
function renderSavings() {
  const users = getUsers();
  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Tabungan Karyawan</h3>
      <button class="btn btn-primary" onclick="window._showMassSavingForm()">+ Input Massal</button>
    </div>
    <div id="mass-sav-form-area"></div>
    ${users.length === 0 ? '<div class="card"><p class="text-muted">Tambahkan karyawan dahulu.</p></div>' :
      users.map(e => {
        const svs = getSavings(e.emp_id);
        const total = svs.reduce((s, x) => s + (x.amount || 0), 0);
        return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="document.getElementById('sav-${e.emp_id}').classList.toggle('hidden')">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800">${(e.name || '?')[0]}</div>
            <div><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)}</span></div>
          </div>
          <div style="text-align:right"><strong style="color:var(--success)">${fmt(total)}</strong><br><span class="text-xs text-muted">${svs.length} entri</span></div>
        </div>
        <div id="sav-${e.emp_id}" class="hidden" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
          <button class="btn btn-primary" style="width:100%;margin-bottom:1rem;padding:0.5rem;font-size:0.75rem;background:var(--success)" onclick="window._showSavingForm('${e.emp_id}')">+ Tambah Tabungan</button>
          <div id="sav-form-${e.emp_id}"></div>
          ${svs.length === 0 ? '<p class="text-xs text-muted" style="text-align:center">Belum ada tabungan.</p>' :
            svs.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-color);border-radius:var(--radius-md);margin-bottom:0.25rem;font-size:0.8rem">
            <div><strong style="color:var(--success)">${fmt(s.amount)}</strong> <span class="text-muted">${esc(s.month || '')}</span></div>
            <div style="display:flex;align-items:center;gap:0.5rem"><span class="text-muted">${fmtDate(s.date)}</span><button style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:0.7rem" onclick="window._deleteSaving('${s._key}')">✕</button></div>
          </div>`).join('')}
        </div>
      </div>`;
      }).join('')}
  </div>`;
}

// ==========================================
// RATINGS (ADMIN)
// ==========================================
function renderRatings() {
  let ratings = getRatings();
  const users = getUsers();

  const empFilter = (window._ratingSearchEmp || '').trim();
  const monthFilter = (window._ratingSearchMonth || '').trim();

  const filteredRatings = ratings.filter(r => {
    const matchEmp = !empFilter || r.emp_id === empFilter;
    const matchMonth = !monthFilter || (r.date || '').startsWith(monthFilter);
    return matchEmp && matchMonth;
  });

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem">
      <h3 class="text-xl font-bold">Penilaian Kinerja</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        ${filteredRatings.length > 0 ? `<button class="btn btn-primary" style="font-weight:bold; background:linear-gradient(135deg, #6366f1, #a855f7); color:#fff; border:none; box-shadow:0 2px 8px rgba(99,102,241,0.3);" onclick="window._downloadAllRatingsPDF()">👁️ Pratinjau & Cetak Penilaian (${filteredRatings.length} PDF)</button>` : ''}
        <button class="btn btn-primary" onclick="window._showRatingForm()">+ Tambah Penilaian</button>
      </div>
    </div>

    <!-- FILTER BAR -->
    <div class="card" style="margin-bottom:1.25rem; background:var(--surface); border:1px solid var(--border); padding:0.85rem 1rem;">
      <div style="display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-end; justify-content:space-between;">
        <div style="display:flex; gap:0.75rem; flex-wrap:wrap; flex:1; align-items:flex-end;">
          <div style="min-width:220px; flex:1;">
            <label class="form-label" style="font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">👤 Pilih Nama Karyawan</label>
            <select id="rating-search-name" class="form-input form-select" style="padding:0.4rem 0.6rem; font-size:0.82rem;" onchange="window._filterRatings()">
              <option value="">-- Semua Karyawan --</option>
              ${users.map(u => `<option value="${u.emp_id}" ${window._ratingSearchEmp === u.emp_id ? 'selected' : ''}>${esc(u.name)} (${esc(u.position)})</option>`).join('')}
            </select>
          </div>
          <div style="width:160px;">
            <label class="form-label" style="font-size:0.75rem; font-weight:700; margin-bottom:0.25rem;">📅 Periode Bulan</label>
            <input type="month" id="rating-search-month" class="form-input" style="padding:0.4rem 0.6rem; font-size:0.82rem;" value="${window._ratingSearchMonth || ''}" onchange="window._filterRatings()">
          </div>
          ${(window._ratingSearchEmp || window._ratingSearchMonth) ? `
          <div>
            <button class="btn btn-outline-danger" style="padding:0.4rem 0.75rem; font-size:0.75rem; font-weight:700;" onclick="window._clearRatingFilters()">✕ Reset Filter</button>
          </div>` : ''}
        </div>
        <div style="font-size:0.8rem; font-weight:700; color:var(--text-muted);">
          Ditemukan: <span style="color:var(--primary); font-weight:900;">${filteredRatings.length}</span> / ${ratings.length} Data
        </div>
      </div>
    </div>

    ${filteredRatings.length === 0 ? `<div class="card"><p class="text-muted">${ratings.length === 0 ? 'Belum ada penilaian.' : 'Tidak ada data penilaian yang sesuai dengan filter.'}</p></div>` :
      filteredRatings.map(r => {
        const emp = getUserByEmpId(r.emp_id);
        const avg = r.scores ? (Object.values(r.scores).reduce((s, v) => s + v, 0) / Object.values(r.scores).length).toFixed(1) : '0';
        const color = avg >= 4.5 ? 'var(--success)' : avg >= 3.5 ? 'var(--info)' : avg >= 2.5 ? 'var(--warning)' : 'var(--danger)';
        return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(emp ? emp.name : r.emp_id)}</strong><br><span class="text-xs text-muted">Periode: ${fmtMonthYear(r.date)}</span></div>
          <div style="text-align:right"><span style="font-size:1.5rem;font-weight:800;color:${color}">${avg}</span><span class="text-xs text-muted">/5</span><br>
          <div style="display:flex;gap:0.4rem;justify-content:flex-end;margin-top:0.35rem;flex-wrap:wrap;">
            <button class="btn btn-outline-info" style="padding:0.25rem 0.55rem;font-size:0.7rem;font-weight:700;" onclick="window._viewRatingDetail('${r._key}')">👁️ Lihat Detail</button>
            <button class="btn btn-outline-primary" style="padding:0.25rem 0.55rem;font-size:0.7rem;font-weight:700;" onclick="window._editRating('${r._key}')">✏️ Edit</button>
            <button class="btn btn-outline-primary" style="padding:0.25rem 0.55rem;font-size:0.7rem;font-weight:700;" onclick="window._exportSingleRatingPDF('${r._key}')">🖨️ Cetak / Pratinjau PDF</button>
            <button class="btn btn-outline-danger" style="padding:0.25rem 0.55rem;font-size:0.7rem;font-weight:700;" onclick="window._deleteRating('${r._key}')">Hapus</button>
          </div>
          </div>
        </div>
        ${r.note ? `<p class="text-xs text-muted mt-2" style="border-top:1px solid var(--border);padding-top:0.5rem">"${esc(r.note)}"</p>` : ''}
      </div>`;
      }).join('')}
  </div>`;
}

window._filterRatings = () => {
  const nameEl = $('rating-search-name');
  const monthEl = $('rating-search-month');
  if (nameEl) window._ratingSearchEmp = nameEl.value;
  if (monthEl) window._ratingSearchMonth = monthEl.value;
  renderCurrentSection();
};

window._clearRatingFilters = () => {
  window._ratingSearchEmp = '';
  window._ratingSearchMonth = '';
  renderCurrentSection();
};

// ==========================================
// CRITERIA (ADMIN)
// ==========================================
function renderCriteriaPage() {
  const criteria = getCriteria();

  // Group by indicator
  const grouped = {};
  criteria.forEach(c => {
    const ind = c.indicator || 'Umum';
    if (!grouped[ind]) grouped[ind] = [];
    grouped[ind].push(c);
  });

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Kriteria Penilaian</h3>
      <button class="btn btn-primary" onclick="window._showCriteriaForm()">+ Tambah Kriteria</button>
    </div>
    <div id="crit-form-area"></div>
    ${criteria.length === 0 ? '<div class="card"><p class="text-muted">Belum ada kriteria.</p></div>' :
      Object.keys(grouped).map(ind => `
      <div style="margin-bottom:1.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;padding-bottom:0.4rem;border-bottom:2px solid var(--border);flex-wrap:wrap;gap:0.5rem">
          <h4 style="font-weight:700;margin:0;font-size:1.05rem;color:var(--text-color)">Indikator: <span style="color:var(--primary)">${esc(ind)}</span></h4>
          <div style="display:flex;gap:0.4rem;">
            <button class="btn btn-outline-primary" style="padding:0.25rem 0.6rem;font-size:0.7rem;display:inline-flex;align-items:center;gap:0.3rem;" onclick="window._editIndicatorName('${esc(ind)}')">
              ✏️ Edit Nama Indikator
            </button>
            <button class="btn btn-outline-danger" style="padding:0.25rem 0.6rem;font-size:0.7rem;display:inline-flex;align-items:center;gap:0.3rem;" onclick="window._deleteIndicatorGroup('${esc(ind)}')">
              🗑️ Hapus Indikator
            </button>
          </div>
        </div>
        ${grouped[ind].map(c => {
          const posStr = Array.isArray(c.position) ? (c.position.includes('Semua') ? 'Semua Jabatan' : c.position.join(', ')) : (c.position || 'Semua Jabatan');
          return `<div class="card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(c.name)}</strong><br><span class="text-xs text-muted">Berlaku: ${esc(posStr)}</span></div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-secondary" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._showCriteriaForm('${c._key}')">Edit Sub</button>
            <button class="btn btn-outline-danger" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._deleteCriteria('${c._key}')">Hapus Sub</button>
          </div>
        </div>`;
        }).join('')}
      </div>
    `).join('')}
  </div>`;
}

// ==========================================
// LEADERBOARD (ADMIN)
// ==========================================
function getRatingsForPeriod(period) {
  const allRatings = getRatings();
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = String(now.getMonth() + 1).padStart(2, '0');
  const curYearMonth = `${curYear}-${curMonth}`;

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastYearMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const threeMonthsAgoStr = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

  return allRatings.filter(r => {
    if (!r.date) return false;
    const rYm = r.date.substring(0, 7);
    if (!period || period === 'this_month') {
      return rYm === curYearMonth;
    } else if (period === 'last_month') {
      return rYm === lastYearMonth;
    } else if (period === 'quarter') {
      return rYm >= threeMonthsAgoStr && rYm <= curYearMonth;
    } else if (period === 'this_year') {
      return r.date.startsWith(String(curYear));
    } else if (period === 'all') {
      return true;
    } else if (period.length === 7) {
      return rYm === period;
    }
    return true;
  });
}

function renderLeaderboard() {
  window._kpiPeriod = window._kpiPeriod || 'this_month';
  const period = window._kpiPeriod;
  const users = getUsers();
  const periodRatings = getRatingsForPeriod(period);

  const periodLabels = {
    this_month: 'Bulan Ini',
    last_month: 'Bulan Lalu',
    quarter: 'Triwulan (3 Bulan)',
    this_year: 'Tahun Ini',
    all: 'Semua Periode'
  };
  const labelPeriodStr = periodLabels[period] || period;

  if (users.length === 0) return '<div class="fade-in"><div class="card"><p class="text-muted">Tambahkan karyawan terlebih dahulu.</p></div></div>';

  const scores = users.map(u => {
    const r = periodRatings.filter(x => x.emp_id === u.emp_id);
    let avg = 0;
    if (r.length > 0) {
      let totalScores = 0; let totalCount = 0;
      r.forEach(rt => {
        if (rt.scores) {
          const vals = Object.values(rt.scores);
          totalScores += vals.reduce((a, b) => a + b, 0);
          totalCount += vals.length;
        }
      });
      if (totalCount > 0) avg = totalScores / totalCount;
    }
    return { ...u, avg: parseFloat(avg.toFixed(2)), evalCount: r.length, periodRatingsList: r };
  }).filter(u => u.evalCount > 0 || period === 'all')
    .sort((a, b) => b.avg - a.avg);

  return `<div class="fade-in">
    <div style="display:flex;flex-wrap:wrap;gap:0.75rem;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <div>
        <h3 class="text-xl font-bold">Peringkat & KPI Kinerja Karyawan</h3>
        <span class="text-xs text-muted">Periode Aktif: <strong>${labelPeriodStr}</strong></span>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
        <select id="kpi-period-select" class="form-input form-select" style="padding:0.45rem 0.8rem; font-size:0.8rem; font-weight:700; width:auto; border-radius:var(--radius-md);" onchange="window._onKpiPeriodChange(this.value)">
          <option value="this_month" ${period === 'this_month' ? 'selected' : ''}>📅 Bulan Ini</option>
          <option value="last_month" ${period === 'last_month' ? 'selected' : ''}>⏪ Bulan Lalu</option>
          <option value="quarter" ${period === 'quarter' ? 'selected' : ''}>📊 Triwulan (3 Bulan)</option>
          <option value="this_year" ${period === 'this_year' ? 'selected' : ''}>📆 Tahun Ini</option>
          <option value="all" ${period === 'all' ? 'selected' : ''}>🌐 Semua Periode</option>
        </select>
        <button class="btn btn-primary" style="font-weight:bold; background:linear-gradient(135deg, #6366f1, #a855f7); color:#fff; border:none; box-shadow:0 2px 8px rgba(99,102,241,0.3);" onclick="window._printAllKpiRapors()">
          👁️ Pratinjau & Cetak semua rapor KPI (PDF)
        </button>
      </div>
    </div>
    ${scores.length === 0 ? '<div class="card"><p class="text-muted">Belum ada data penilaian pada periode ini.</p></div>' :
      scores.map((s, idx) => {
        const color = s.avg >= 4.5 ? 'var(--success)' : s.avg >= 3.5 ? 'var(--info)' : s.avg >= 2.5 ? 'var(--warning)' : 'var(--danger)';
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1) + '.';
        return `<div class="card" style="margin-bottom:0.75rem;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:1rem">
          <div style="font-size:1.5rem;font-weight:800;width:40px;text-align:center">${medal}</div>
          <div><strong style="font-size:1.1rem">${esc(s.name)}</strong><br><span class="text-xs text-muted">${esc(s.position)} • ${s.evalCount} evaluasi</span></div>
        </div>
        <div style="text-align:right">
          <span style="font-size:1.8rem;font-weight:800;color:${color}">${s.avg}</span><span class="text-xs text-muted">/5</span><br>
          ${s.evalCount > 0 ? `<button class="btn btn-outline-primary" style="padding:0.2rem 0.5rem;font-size:0.65rem;margin-top:0.25rem;" onclick="window._printSingleKpiRapor('${s.emp_id}')">🖨️ Cetak Rapor KPI</button>` : ''}
        </div>
      </div>`;
      }).join('')}
  </div>`;
}

window._onKpiPeriodChange = (val) => {
  window._kpiPeriod = val;
  renderCurrentSection();
};

window._filterLeaderboard = (val) => {
  window._kpiPeriod = val;
  renderCurrentSection();
};

window._printSingleKpiRapor = (empId) => {
  window._kpiSingleEmp = empId;
  window._printAllKpiRapors();
  window._kpiSingleEmp = null;
};

window._printAllKpiRapors = () => {
  window._kpiPeriod = window._kpiPeriod || 'this_month';
  const period = window._kpiPeriod;
  const users = getUsers();
  const periodRatings = getRatingsForPeriod(period);

  const periodLabels = {
    this_month: 'BULAN INI',
    last_month: 'BULAN LALU',
    quarter: 'TRIWULAN (3 BULAN)',
    this_year: 'TAHUN INI',
    all: 'SEMUA PERIODE'
  };
  const labelPeriodStr = periodLabels[period] || period.toUpperCase();

  let scores = users.map(u => {
    const r = periodRatings.filter(x => x.emp_id === u.emp_id);
    let avg = 0;
    if (r.length > 0) {
      let totalScores = 0; let totalCount = 0;
      r.forEach(rt => {
        if (rt.scores) {
          const vals = Object.values(rt.scores);
          totalScores += vals.reduce((a, b) => a + b, 0);
          totalCount += vals.length;
        }
      });
      if (totalCount > 0) avg = totalScores / totalCount;
    }
    return { ...u, avg: parseFloat(avg.toFixed(2)), evalCount: r.length, periodRatingsList: r };
  }).filter(u => u.evalCount > 0)
    .sort((a, b) => b.avg - a.avg);

  if (window._kpiSingleEmp) {
    scores = scores.filter(s => s.emp_id === window._kpiSingleEmp);
  }

  if (scores.length === 0) {
    showToast(`Belum ada data penilaian pada periode ${labelPeriodStr}`, 'warning');
    return;
  }

  const formattedDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  let combinedContainers = '';
  scores.forEach((s, idx) => {
    const rank = idx + 1;
    const empName = s.name;
    const empPos = s.position || '-';
    const empId = s.emp_id;
    const avgScore = s.avg.toFixed(1);

    let criteriaRows = '';
    const allCrits = getCriteria();
    const groupedScores = {};

    s.periodRatingsList.forEach(r => {
      if (r.scores) {
        Object.entries(r.scores).forEach(([critKey, score]) => {
          const cDef = allCrits.find(c => c._key === critKey || c.name === critKey);
          const actualName = cDef ? cDef.name : critKey;
          const ind = cDef && cDef.indicator ? cDef.indicator : 'Umum';
          if (!groupedScores[ind]) groupedScores[ind] = [];
          groupedScores[ind].push({ name: actualName, score });
        });
      }
    });

    Object.keys(groupedScores).forEach(ind => {
      criteriaRows += `<tr><td colspan="2" style="border:1px solid #cbd5e1;padding:6px 10px;background:#e2e8f0;font-weight:bold;text-transform:uppercase;font-size:11px;color:#0f172a !important;">${esc(ind)}</td></tr>`;
      groupedScores[ind].forEach(item => {
        criteriaRows += `
          <tr>
            <td style="border:1px solid #cbd5e1;padding:6px 10px;padding-left:16px;font-size:11px;color:#0f172a !important;font-weight:600;">${esc(item.name)}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 10px;text-align:center;font-weight:bold;font-size:11px;color:#1e40af !important;">${item.score} / 5</td>
          </tr>
        `;
      });
    });

    const notes = s.periodRatingsList.map(r => r.note).filter(Boolean).join('; ') || 'Tidak ada catatan khusus.';

    if (idx > 0) {
      combinedContainers += `<div style="page-break-before:always; height:1px;"></div>`;
    }

    combinedContainers += `
    <div class="rapor-container" style="margin-bottom:20px;">
      <div class="kop-header">
        <div class="kop-title">PT. ESTAFET DWI MASA</div>
        <div class="kop-subtitle">SPBU 54.634.25 GONTOR MLARAK</div>
        <div class="kop-address">
          Kantor Pusat : Ds. Gontor, Kec. Mlarak, Kab. Ponorogo - Jawa Timur 63472<br>
          Kantor Cabang : Jalan Mayjend Bambang Sugeng Km. 01 Sidojoyo Wonosobo<br>
          Email: estafetdwimasa@gmail.com
        </div>
      </div>
      
      <div class="doc-title-box">
        <div class="doc-title">LEMBAR EVALUASI & RAPOR KPI KINERJA KARYAWAN</div>
        <div class="doc-subtitle">PERIODE: ${labelPeriodStr} | PERINGKAT: KE-${rank} DARI ${scores.length} KARYAWAN | TANGGAL CETAK: ${formattedDate.toUpperCase()}</div>
      </div>

      <table class="info-table">
        <tr>
          <td class="label">Nama Karyawan</td>
          <td><strong>${esc(empName)}</strong></td>
          <td class="label">ID Karyawan</td>
          <td><strong>${esc(empId)}</strong></td>
        </tr>
        <tr>
          <td class="label">Jabatan / Posisi</td>
          <td>${esc(empPos)}</td>
          <td class="label">Skor KPI & Peringkat</td>
          <td><strong style="color:#1d4ed8; font-size:12px;">⭐ ${avgScore} / 5.0 (Peringkat #${rank})</strong></td>
        </tr>
      </table>

      <h4 style="margin:6px 0 4px 0; color:#1e40af; font-size:10.5px; border-bottom:1px solid #cbd5e1; padding-bottom:2px;">A. PENILAIAN KRITERIA & CAPAIAN KPI</h4>
      <table class="metric-table">
        <thead>
          <tr>
            <th style="border:1px solid #cbd5e1;padding:4px 8px;text-align:left;background:#1e40af;color:#fff !important;">Indikator / Sub-Indikator Kriteria</th>
            <th style="border:1px solid #cbd5e1;padding:4px 8px;text-align:center;width:90px;background:#1e40af;color:#fff !important;">Skor (1-5)</th>
          </tr>
        </thead>
        <tbody>
          ${criteriaRows || '<tr><td colspan="2" style="padding:6px;text-align:center;">Data kriteria tidak tersedia</td></tr>'}
          <tr>
            <td style="border:1px solid #cbd5e1;padding:4px 8px;text-align:right;color:#0f172a !important;"><strong>Rata-Rata Skor KPI:</strong></td>
            <td style="border:1px solid #cbd5e1;padding:4px 8px;text-align:center;font-size:11px;font-weight:bold;color:#1d4ed8 !important;">⭐ ${avgScore} / 5.0</td>
          </tr>
        </tbody>
      </table>
      
      <div style="border:1px solid #cbd5e1; border-radius:4px; padding:6px 10px; background:#f8fafc !important; color:#0f172a !important; margin-bottom:8px;">
        <div style="font-weight:bold; font-size:9.5px; color:#1e40af !important; margin-bottom:2px; text-transform:uppercase;">💬 CATATAN EVALUASI KPI:</div>
        <div style="font-size:10px; color:#0f172a !important; font-style:italic; line-height:1.2;">${esc(notes)}</div>
      </div>

      <div class="signature-area">
        <div class="sig-box">
          <div>Penerima Evaluasi (Karyawan),<br>&nbsp;</div>
          <div class="sig-space"></div>
          <div><strong>( ${esc(empName)} )</strong></div>
          <div style="font-size:8.5px; color:#64748b;">ID: ${esc(empId)}</div>
        </div>
        <div class="sig-box">
          <div>Gontor, ${formattedDate}<br><strong>Manager SPBU Gontor</strong>,</div>
          <div class="sig-space"></div>
          <div><strong>( ______________________ )</strong></div>
          <div style="font-size:8.5px; color:#64748b;">PT. ESTAFET DWI MASA</div>
        </div>
      </div>
    </div>`;
  });

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Bundel Rapor KPI Karyawan (${labelPeriodStr}) - SPBU Gontor</title>
  <style id="page-style">
    @page { size: A4 portrait; margin: 6mm 10mm; }
  </style>
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 10px; background: #e2e8f0; font-size: 12px; line-height: 1.35; }
    .rapor-container { background: #fff; max-width: 210mm; min-height: 265mm; margin: 0 auto; padding: 22px 28px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 8px 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); max-width: 210mm; margin-left: auto; margin-right: auto; }
    .no-print-bar button { padding: 6px 14px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; font-size: 11.5px; }
    .btn-print { background: #1d4ed8; color: #fff; }
    .btn-close { background: #64748b; color: #fff; margin-left: 8px; }
    .kop-header { text-align: center; border-bottom: 2.5px double #1d4ed8; padding-bottom: 6px; margin-bottom: 12px; width: 100%; }
    .kop-title { font-family: 'Times New Roman', Times, serif; font-weight: 900; font-size: 28px; color: #1e40af; letter-spacing: 1.2px; line-height: 1.05; margin-bottom: 2px; }
    .kop-subtitle { font-family: 'Times New Roman', Times, serif; font-weight: 800; font-size: 16px; color: #1d4ed8; margin-top: 1px; letter-spacing: 0.5px; line-height: 1.05; margin-bottom: 3px; }
    .kop-address { font-size: 10.5px; color: #1e3a8a; margin-top: 1px; line-height: 1.3; }
    .doc-title-box { text-align: center; margin-bottom: 12px; }
    .doc-title { font-size: 15px; font-weight: 800; text-transform: uppercase; color: #0f172a; border-bottom: 1.5px solid #0f172a; display: inline-block; padding-bottom: 2px; }
    .doc-subtitle { font-size: 10px; color: #64748b; margin-top: 3px; font-weight: 700; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; }
    .info-table td { padding: 6px 12px; font-size: 11px; vertical-align: top; border-bottom: 1px solid #e2e8f0; color: #0f172a !important; }
    .info-table td.label { font-weight: 700; color: #475569 !important; width: 140px; background: #f1f5f9; }
    .metric-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .metric-table th, .metric-table td { border: 1px solid #cbd5e1; padding: 7px 12px; font-size: 11px; }
    .metric-table th { background: #1e40af; color: #ffffff !important; font-weight: 700; text-align: left; padding: 8px 12px; }
    tr { page-break-inside: avoid !important; }
    .signature-area { margin-top: 20px; display: flex; justify-content: space-between; align-items: flex-end; page-break-inside: avoid; }
    .sig-box { width: 220px; text-align: center; font-size: 11px; color: #0f172a !important; }
    .sig-space { height: 80px; }
    @media print {
      html, body { background: #fff; padding: 0; margin: 0; }
      .rapor-container { box-shadow: none; padding: 0; max-width: 100% !important; border-radius: 0; min-height: 265mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <div style="display:flex; align-items:center; gap:8px;">
      <label style="font-weight:bold; font-size:11.5px; color:#334155;">📐 Ukuran Kertas:</label>
      <select id="paper-size-select" style="padding:4px 8px; font-size:11px; border-radius:4px; border:1px solid #94a3b8; font-weight:600; cursor:pointer;" onchange="
        const styleEl = document.getElementById('page-style');
        const containers = document.querySelectorAll('.rapor-container, .no-print-bar');
        if (this.value === 'F4') {
          styleEl.innerHTML = '@page { size: 215mm 330mm portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '215mm');
        } else {
          styleEl.innerHTML = '@page { size: A4 portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '210mm');
        }
      ">
        <option value="A4" selected>A4 (210 x 297 mm)</option>
        <option value="F4">F4 / Folio (215 x 330 mm)</option>
      </select>
    </div>
    <div>
      <button class="btn-print" onclick="window.print()">🖨️ Cetak PDF / Print</button>
      <button class="btn-close" onclick="window.close()">✕ Tutup</button>
    </div>
  </div>

  ${combinedContainers}
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(fullHtml);
    win.document.close();
  } else {
    showToast('Izinkan pop-up di browser untuk mencetak PDF Rapor KPI.', 'error');
  }
};

// ==========================================
// SETTINGS (ADMIN)
// ==========================================
function renderSettings() {
  const s = allData.settings || {};
  const ep = s.emp_profile_edit || {};
  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Pengaturan Sistem</h3>
    </div>

    <div class="card mb-4">
      <h3 class="card-title mb-2">🔔 Uji Coba & Status Notifikasi HP</h3>
      <p class="text-sm text-muted mb-3">Klik tombol di bawah untuk meminta izin atau menguji apakah notifikasi sistem HP Anda berfungsi dengan baik.</p>
      <button class="btn btn-primary" onclick="window.testHpNotification()" style="display:inline-flex;align-items:center;gap:0.5rem;padding:0.65rem 1.25rem;">
        <span>🔔 Tes Notifikasi HP Sekarang</span>
      </button>
    </div>
    
    <div class="card mb-4">
      <h3 class="card-title mb-2">Email Manajemen Terotorisasi MyTIC</h3>
      <p class="text-sm text-muted mb-3">Masukkan email yang diizinkan untuk login sebagai Manajemen di MyTIC. Pisahkan dengan koma jika lebih dari satu. Akun email LPG yang tidak ada di daftar ini akan ditolak otomatis oleh MyTIC.</p>
      <div class="form-group mb-0">
        <input type="text" id="set-mgmt-emails" class="form-control" value="${esc(s.mytic_mgmt_emails || 'spbugontor02@gmail.com')}" placeholder="spbugontor02@gmail.com, admin@spbugontor.com">
      </div>
    </div>

    <div class="card mb-4">
      <h3 class="card-title mb-4">Izin Edit Profil Karyawan</h3>
      <p class="text-sm text-muted mb-4">Pilih data mana saja yang diizinkan untuk diubah sendiri oleh karyawan melalui akun mereka.</p>
      
      <div style="display:flex;flex-direction:column;gap:1rem;">
        <label style="display:flex;align-items:center;gap:0.75rem;cursor:pointer">
          <input type="checkbox" id="set-edit-name" ${ep.name ? 'checked' : ''} style="width:1.25rem;height:1.25rem;">
          <span style="font-weight:600;">Izinkan Edit Nama</span>
        </label>
        
        <label style="display:flex;align-items:center;gap:0.75rem;cursor:pointer">
          <input type="checkbox" id="set-edit-photo" ${ep.photo ? 'checked' : ''} style="width:1.25rem;height:1.25rem;">
          <span style="font-weight:600;">Izinkan Edit Foto Profil</span>
        </label>
        
        <label style="display:flex;align-items:center;gap:0.75rem;cursor:pointer">
          <input type="checkbox" id="set-edit-phone" ${ep.phone ? 'checked' : ''} style="width:1.25rem;height:1.25rem;">
          <span style="font-weight:600;">Izinkan Edit No. Telepon</span>
        </label>
        
        <label style="display:flex;align-items:center;gap:0.75rem;cursor:pointer">
          <input type="checkbox" id="set-edit-email" ${ep.email ? 'checked' : ''} style="width:1.25rem;height:1.25rem;">
          <span style="font-weight:600;">Izinkan Edit Email</span>
        </label>
        
        <label style="display:flex;align-items:center;gap:0.75rem;cursor:pointer">
          <input type="checkbox" id="set-edit-dob" ${ep.dob ? 'checked' : ''} style="width:1.25rem;height:1.25rem;">
          <span style="font-weight:600;">Izinkan Edit Tanggal Lahir</span>
        </label>
      </div>
    </div>

    <div class="card mb-4">
      <h3 class="card-title mb-4">Tema Warna Aplikasi</h3>
      <p class="text-sm text-muted mb-4">Ubah tema warna untuk MyTIC, Absensi, dan Ceklis SOP secara bersamaan.</p>
      
      <div class="theme-grid">
        ${Object.keys(THEME_PALETTES).map(k => {
    const t = THEME_PALETTES[k];
    const active = (s.theme || 'orange') === k ? 'active' : '';
    return `
          <div class="theme-card ${active}" onclick="window._setTheme('${k}')" style="border-color: ${active ? t.primary : 'var(--border)'}">
            <div class="theme-color-preview" style="background: ${t.primary}"></div>
            <div class="theme-name" style="text-transform: capitalize; font-weight: 600; text-align: center; margin-top: 0.5rem; font-size: 0.85rem;">${k}</div>
          </div>`;
  }).join('')}
      </div>
    </div>

    <div class="card mb-4" style="border:1.5px solid var(--primary)">
      <h3 class="card-title mb-2">💾 Manajemen Backup, Audit & Tutup Buku SPBU</h3>
      <p class="text-xs text-muted mb-4">Kelola cadangan data JSON, jalankan mode audit arsip lama tanpa mengganggu operasional harian, serta lakukan pembersihan periode.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:0.75rem">
        <button class="btn btn-primary" style="padding:0.65rem;font-size:0.8rem" onclick="window._exportDatabaseBackup()">💾 Download Backup JSON (1-Klik)</button>
        <button class="btn btn-secondary" style="padding:0.65rem;font-size:0.8rem;background:var(--info);color:#fff;border:none" onclick="window._startAuditModeWithFile()">🔍 Mode Audit / Preview Arsip JSON</button>
        <button class="btn btn-secondary" style="padding:0.65rem;font-size:0.8rem" onclick="window._importDatabaseRestore()">📥 Restore Database dari JSON</button>
        <button class="btn btn-outline-danger" style="padding:0.65rem;font-size:0.8rem" onclick="window._resetPeriodData()">🧹 Reset Periode / Tutup Buku</button>
      </div>
    </div>

    <div style="margin-top:2rem;">
      <button class="btn btn-primary" onclick="window._saveSettings()">Simpan Pengaturan</button>
    </div>
  </div>`;
}

window._setTheme = async (themeKey) => {
  await set(ref(db, 'settings/theme'), themeKey);
  showToast('Tema diubah!', 'success');
};

// ==========================================
// EMPLOYEE VIEWS
// ==========================================
function renderEmpDashboard() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';
  const bal = calcBalance(emp.emp_id);
  const savTotal = getSavings(emp.emp_id).reduce((s, x) => s + (x.amount || 0), 0);
  const pendingLeaves = getLeaves(emp.emp_id).filter(l => l.status === 'Menunggu').length;

  // Calculate Employee Remaining Leave Quota
  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  const currentYear = new Date().getFullYear();
  const empApprovedLeaves = getLeaves(emp.emp_id).filter(l => l.status === 'Disetujui' && new Date(l.start_date).getFullYear() === currentYear);

  let totalQuota = 0;
  let totalTaken = 0;
  let leaveQuotaBreakdownHtml = '';

  leaveTypes.forEach(t => {
    if (t.quota > 0) {
      totalQuota += t.quota;
      let taken = 0;
      empApprovedLeaves.filter(l => l.leave_type === t.name).forEach(l => {
        const d1 = new Date(l.start_date);
        const d2 = new Date(l.end_date);
        taken += Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
      });
      totalTaken += taken;
      const remaining = Math.max(0, t.quota - taken);
      const pct = Math.min(100, Math.round((remaining / t.quota) * 100));

      leaveQuotaBreakdownHtml += `
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.85rem;background:var(--surface)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
            <strong class="text-sm">${esc(t.name)}</strong>
            <span class="badge ${remaining > 0 ? 'badge-success' : 'badge-danger'}">${remaining} hari tersisa</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-muted);margin-bottom:0.4rem">
            <span>Terpakai: ${taken} hari</span>
            <span>Total Jatah: ${t.quota} hari</span>
          </div>
          <div style="width:100%;height:6px;background:var(--border);border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${remaining > 0 ? 'var(--success)' : 'var(--danger)'}"></div>
          </div>
        </div>`;
    }
  });

  const totalRemaining = Math.max(0, totalQuota - totalTaken);

  setTimeout(() => initEmpDashboardCharts(), 50);

  return `<div class="fade-in">
    <div class="dashboard-grid">
      <div class="stat-card" onclick="window._nav('emp-leaves')"><div class="stat-title">Sisa Cuti Saya (${currentYear})</div><div class="stat-value" style="color:var(--primary)">${totalRemaining} <span style="font-size:0.85rem;font-weight:600;color:var(--text-muted)">hari</span></div></div>
      <div class="stat-card" onclick="window._nav('emp-debits')"><div class="stat-title">Tunggakan Saya</div><div class="stat-value" style="color:${bal > 0 ? 'var(--danger)' : 'var(--success)'}">${fmt(bal)}</div></div>
      <div class="stat-card" onclick="window._nav('emp-savings')"><div class="stat-title">Tabungan Saya</div><div class="stat-value" style="color:var(--success)">${fmt(savTotal)}</div></div>
      <div class="stat-card" onclick="window._nav('emp-leaves')"><div class="stat-title">Izin Pending</div><div class="stat-value" style="color:var(--warning)">${pendingLeaves}</div></div>
    </div>

    <!-- LEAVE QUOTA BREAKDOWN WIDGET -->
    <div class="card mb-4">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h3 class="card-title" style="font-size:1rem;">🌴 Rincian Sisa Jatah Cuti (${currentYear})</h3>
        <button class="btn btn-secondary" style="padding:0.25rem 0.6rem;font-size:0.75rem" onclick="window._nav('emp-leaves')">Ajukan Cuti ➔</button>
      </div>
      ${leaveQuotaBreakdownHtml ? `<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:0.75rem">${leaveQuotaBreakdownHtml}</div>` : '<p class="text-xs text-muted">Belum ada jatah cuti khusus yang dikonfigurasi.</p>'}
    </div>

    <!-- EMPLOYEE GRAPHICS GRID -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:1.5rem;margin-bottom:1.5rem;">
      <div class="card" style="padding:1.25rem;">
        <h3 class="card-title mb-2" style="font-size:1rem;">🎯 Kedisiplinan Kehadiran Bulan Ini</h3>
        <div style="position:relative;height:220px;">
          <canvas id="chart-emp-attendance-gauge"></canvas>
        </div>
      </div>

      <div class="card" style="padding:1.25rem;">
        <h3 class="card-title mb-2" style="font-size:1rem;">📈 Riwayat Evaluasi / Rating Diri</h3>
        <div style="position:relative;height:220px;">
          <canvas id="chart-emp-rating-trend"></canvas>
        </div>
      </div>
    </div>

    <div class="card"><h3 class="card-title mb-4">Informasi Pribadi</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div><p class="form-label">Nama</p><p class="font-bold">${esc(emp.name)}</p></div>
        <div><p class="form-label">Jabatan</p><p class="font-bold">${esc(emp.position)}</p></div>
        <div><p class="form-label">ID</p><p class="font-bold">${esc(emp.emp_id)}</p></div>
        <div><p class="form-label">Username</p><p class="font-bold">${esc(emp.username)}</p></div>
      </div>
    </div>
  </div>`;
}

function initEmpDashboardCharts() {
  if (typeof Chart === 'undefined') return;
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return;
  const colors = getChartColors();

  // 1. Employee Attendance Rate (Donut Gauge)
  const gaugeCanvas = document.getElementById('chart-emp-attendance-gauge');
  if (gaugeCanvas) {
    destroyChart('emp-attendance-gauge');
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const myRecs = Object.values(allData.absensi_records || {}).filter(r => r.emp_name === emp.name && r.date && r.date.startsWith(currentMonthStr));

    let onTime = 0, late = 0;
    myRecs.forEach(r => {
      if (r.clock_in && r.clock_in !== '-') {
        if ((r.late_minutes || 0) > 0) late++; else onTime++;
      }
    });

    const total = onTime + late;

    window._myTicCharts['emp-attendance-gauge'] = new Chart(gaugeCanvas, {
      type: 'doughnut',
      data: {
        labels: ['Tepat Waktu', 'Terlambat'],
        datasets: [{
          data: total > 0 ? [onTime, late] : [1, 0],
          backgroundColor: ['#10B981', '#EF4444'],
          borderWidth: 2,
          borderColor: colors.cardBg
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: colors.text } },
          tooltip: { enabled: total > 0 }
        }
      }
    });
  }

  // 2. Employee Rating History (Line Chart)
  const ratingCanvas = document.getElementById('chart-emp-rating-trend');
  if (ratingCanvas) {
    destroyChart('emp-rating-trend');
    const myRatings = Object.values(allData.ratings || {})
      .filter(r => r.emp_id === emp.emp_id)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const labels = myRatings.map(r => r.date ? fmtMonthYear(r.date) : 'Periode');
    const scores = myRatings.map(r => {
      const vals = r.ratings ? Object.values(r.ratings) : [];
      return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
    });

    window._myTicCharts['emp-rating-trend'] = new Chart(ratingCanvas, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['Belum Ada Rating'],
        datasets: [{
          label: 'Skor Evaluasi (1-5)',
          data: scores.length ? scores : [0],
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245,158,11,0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: colors.text } } },
        scales: {
          x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.text }, grid: { color: colors.grid }, min: 1, max: 5 }
        }
      }
    });
  }
}

function renderEmpHistory() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';

  const absensiRecords = Object.values(allData.absensi_records || {}).filter(r => r.emp_name === emp.name);
  const ceklisRecords = Object.values(allData.ceklissop_records || {}).filter(r => r.operator_name === emp.name);

  // Parse and sort history by date descending
  let history = [];

  absensiRecords.forEach(r => {
    history.push({
      type: 'absensi',
      dateObj: new Date(`${r.date}T${r.clock_in || '00:00'}`),
      dateStr: r.date,
      timeStr: r.clock_in,
      title: 'Absensi Masuk',
      subtitle: r.shift,
      status: r.status,
      isWarning: r.status && r.status !== 'On Time ✓' && !r.status.toLowerCase().includes('izin')
    });
  });

  // Group ceklis records by date (accumulate per day)
  const ceklisByDate = {};
  ceklisRecords.forEach(r => {
    const d = new Date(r.date);
    const dateStr = d.toISOString().split('T')[0];
    if (!ceklisByDate[dateStr]) ceklisByDate[dateStr] = { scores: [], count: 0, categories: [], lastTime: d };
    ceklisByDate[dateStr].scores.push(r.score || 0);
    ceklisByDate[dateStr].count++;
    if (!ceklisByDate[dateStr].categories.includes(r.category)) ceklisByDate[dateStr].categories.push(r.category);
    if (d > ceklisByDate[dateStr].lastTime) ceklisByDate[dateStr].lastTime = d;
  });

  Object.entries(ceklisByDate).forEach(([dateStr, data]) => {
    const avgScore = Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length);
    history.push({
      type: 'ceklis',
      dateObj: data.lastTime,
      dateStr: dateStr,
      timeStr: data.lastTime.toTimeString().split(' ')[0].substring(0, 5),
      title: `SOP Harian (${data.categories.join(' & ')})`,
      subtitle: `${data.count}x pengecekan`,
      status: `Rata-rata: ${avgScore}%`,
      isWarning: avgScore < 100
    });
  });

  history.sort((a, b) => {
    if (a.dateStr !== b.dateStr) return b.dateStr.localeCompare(a.dateStr);
    const timeA = (a.timeStr && a.timeStr !== '-') ? a.timeStr : '00:00';
    const timeB = (b.timeStr && b.timeStr !== '-') ? b.timeStr : '00:00';
    return timeB.localeCompare(timeA);
  });

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Riwayat Harian (Absensi & SOP)</h3>
    </div>
    
    <div class="card">
      ${history.length === 0 ? '<p class="text-muted text-center" style="padding: 2rem 0;">Belum ada riwayat tercatat.</p>' :
      history.map(h => {
        const icon = h.type === 'absensi'
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>'
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-500"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';

        const statusColor = h.isWarning ? 'color: var(--danger);' : 'color: var(--success);';

        return `
        <div style="display:flex;align-items:center;gap:1rem;padding:1rem 0;border-bottom:1px solid var(--border);">
          <div style="background:var(--bg);padding:0.75rem;border-radius:50%;">${icon}</div>
          <div style="flex:1;">
            <div style="font-weight:700;">${h.title}</div>
            <div class="text-xs text-muted">${fmtDate(h.dateStr)} • Jam ${h.timeStr} • Shift ${h.subtitle}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700; ${statusColor}">${h.status}</div>
          </div>
        </div>
        `;
      }).join('')}
    </div>
  </div>`;
}

function renderEmpDebits() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';

  // If employee position is Admin or Supervisor, show full employee tunggakan list (with Debit-Only access)
  if (isEmpAdminOrSupervisor()) {
    return renderDebits();
  }

  const bal = calcBalance(emp.emp_id);
  const txns = getTxns(emp.emp_id);
  return `<div class="fade-in">
    <div class="card mb-4" style="text-align:center"><p class="form-label">Saldo Tunggakan Saya</p><p style="font-size:2rem;font-weight:800;color:${bal > 0 ? 'var(--danger)' : 'var(--success)'}">${fmt(bal)}</p></div>
    <div class="card"><h3 class="card-title mb-4">Riwayat Transaksi</h3>
    ${txns.length === 0 ? '<p class="text-muted text-sm">Belum ada transaksi.</p>' :
      txns.map(t => {
        const adder = t.added_by || 'Manajemen';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 0;border-bottom:1px solid var(--border);font-size:0.85rem">
        <div>
          <strong style="color:${t.type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${t.type === 'debit' ? '+' : '-'}${fmt(t.amount)}</strong> 
          <span class="text-muted">${esc(t.note || '')}</span>
          <span class="text-xs text-muted" style="display:block;margin-top:3px;font-size:0.75rem;">✍️ Ditambahkan oleh: <strong style="color:var(--text-main)">${esc(adder)}</strong></span>
        </div>
        <span class="text-muted">${fmtDate(t.date)}</span></div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderEmpLeaves() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';
  const leaves = getLeaves(emp.emp_id);
  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  const currentYear = new Date().getFullYear();
  const empLeaves = leaves.filter(l => l.status !== 'Ditolak' && new Date(l.start_date).getFullYear() === currentYear);

  let quotaSummaryCardsHtml = '';
  let hasAnyCustom = false;
  if (leaveTypes.length > 0) {
    quotaSummaryCardsHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:0.75rem;margin-bottom:1.25rem">`;
    leaveTypes.forEach(t => {
      const balInfo = getEmpLeaveBalance(emp, t, empLeaves);
      if (balInfo.isCustom) hasAnyCustom = true;
      quotaSummaryCardsHtml += `<div class="card" style="padding:0.75rem;text-align:center">
        <p class="text-xs text-muted mb-1">${esc(t.name)}</p>
        <p class="font-bold text-lg" style="color:${balInfo.remaining <= 0 ? 'var(--danger)' : 'var(--success)'}">${balInfo.remaining} <span class="text-xs font-normal text-muted">/ ${balInfo.totalQuota} hari</span></p>
        ${balInfo.isCustom ? '<span class="badge badge-warning" style="font-size:0.6rem;padding:2px 6px;margin-top:2px;display:inline-block">Disesuaikan</span>' : ''}
      </div>`;
    });
    quotaSummaryCardsHtml += `</div>`;
  }

  const customNoticeHtml = hasAnyCustom ? `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-left:4px solid #f59e0b;padding:0.75rem 1rem;border-radius:var(--radius-md);margin-bottom:1.25rem;font-size:0.825rem;display:flex;align-items:center;gap:0.75rem;">
      <div style="background:#f59e0b;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0;font-size:0.8rem">ℹ️</div>
      <div>
        <strong style="color:#b45309;display:block;margin-bottom:0.1rem">Informasi Penyesuaian Cuti:</strong>
        <span style="color:var(--text-main)">Telah dilakukan penyesuaian sisa cuti oleh Manajemen untuk akun Anda.</span>
      </div>
    </div>
  ` : '';

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem">
      <div>
        <h3 class="text-xl font-bold">Izin/Cuti Saya</h3>
        <p class="text-xs text-muted">Sisa jatah cuti & riwayat pengajuan izin (${currentYear})</p>
      </div>
      <button class="btn btn-primary" onclick="window._showEmpLeaveForm()">+ Ajukan</button>
    </div>
    ${customNoticeHtml}
    ${quotaSummaryCardsHtml}`
,StartLine:2558,TargetContent:
    <div id="emp-leave-form-area"></div>
    ${leaves.length === 0 ? '<div class="card"><p class="text-muted">Belum ada pengajuan.</p></div>' :
      leaves.map(l => {
        const sc = l.status === 'Disetujui' ? 'badge-success' : l.status === 'Ditolak' ? 'badge-danger' : 'badge-warning';
        return `<div class="card" style="margin-bottom:0.75rem;border-left:4px solid ${l.status === 'Disetujui' ? 'var(--success)' : l.status === 'Ditolak' ? 'var(--danger)' : 'var(--warning)'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem">
          <div style="flex:1;min-width:200px">
            <strong>${esc(l.leave_type)}</strong><br>
            <span class="text-xs text-muted">${fmtDate(l.start_date)} - ${fmtDate(l.end_date)}</span><br>
            <span class="text-xs text-muted">${esc(l.reason || '')}</span>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.5rem">
            <span class="badge ${sc}">${esc(l.status)}</span>
            <div style="display:flex;gap:0.25rem">
              ${l.status === 'Menunggu' ? `<button class="btn btn-secondary" style="padding:0.2rem 0.5rem;font-size:0.7rem" onclick="window._editEmpLeaveForm('${l._key}')">Edit</button>` : ''}
              ${renderLeaveChatButton(l, 'Karyawan')}
            </div>
          </div>
        </div>
      </div>`;
      }).join('')}
  </div>`;
}

function renderEmpViolations() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';
  const vios = getViolations(emp.emp_id);
  return `<div class="fade-in">
    <h3 class="text-xl font-bold mb-4">Pelanggaran Saya</h3>
    ${vios.length === 0 ? '<div class="card" style="text-align:center;padding:2rem"><p class="text-muted">Bersih! Tidak ada pelanggaran 👍</p></div>' :
      vios.map(v => {
        const lc = v.level === 'SP3' ? 'var(--danger)' : v.level === 'SP2' ? 'var(--warning)' : v.level === 'SP1' ? '#EAB308' : 'var(--info)';
        return `<div class="card" style="margin-bottom:0.5rem;border-left:4px solid ${lc}">
        <strong class="text-xs" style="color:${lc}">${esc(v.level)}</strong>
        <p class="text-xs">${esc(v.violation_type)}: ${esc(v.description)}</p>
        <span class="text-xs text-muted">${fmtDate(v.date)}</span>
      </div>`;
      }).join('')}
  </div>`;
}

function renderEmpSavings() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';
  const svs = getSavings(emp.emp_id);
  const total = svs.reduce((s, x) => s + (x.amount || 0), 0);
  return `<div class="fade-in">
    <div class="card mb-4" style="text-align:center"><p class="form-label">Total Tabungan</p><p style="font-size:2rem;font-weight:800;color:var(--success)">${fmt(total)}</p></div>
    <div class="card"><h3 class="card-title mb-4">Riwayat Tabungan</h3>
    ${svs.length === 0 ? '<p class="text-muted text-sm">Belum ada.</p>' :
      svs.map(s => `<div style="display:flex;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border);font-size:0.85rem">
      <div><strong style="color:var(--success)">${fmt(s.amount)}</strong> <span class="text-muted">${esc(s.month || '')}</span></div>
      <span class="text-muted">${fmtDate(s.date)}</span></div>`).join('')}
    </div>
  </div>`;
}

function renderEmpRatings() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';
  const ratings = getRatings(emp.emp_id);
  return `<div class="fade-in">
    <h3 class="text-xl font-bold mb-4">Penilaian Saya</h3>
    ${ratings.length === 0 ? '<div class="card"><p class="text-muted">Belum ada penilaian.</p></div>' :
      ratings.map(r => {
        const avg = r.scores ? (Object.values(r.scores).reduce((s, v) => s + v, 0) / Object.values(r.scores).length).toFixed(1) : '0';
        const color = avg >= 4.5 ? 'var(--success)' : avg >= 3.5 ? 'var(--info)' : avg >= 2.5 ? 'var(--warning)' : 'var(--danger)';
        return `<div class="card" style="margin-bottom:0.75rem; cursor:pointer; transition:transform 0.2s, box-shadow 0.2s;" onclick="window._viewRatingDetail('${r._key}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="text-muted text-sm" style="font-weight:700;">Periode: ${fmtMonthYear(r.date)}</span>
            <br><span style="font-size:0.75rem; color:var(--primary); font-weight:700;">👁️ Klik untuk lihat rata-rata per indikator</span>
          </div>
          <span style="font-size:1.5rem;font-weight:800;color:${color}">${avg}/5</span>
        </div>
        ${r.note ? `<p class="text-xs text-muted mt-2" style="border-top:1px solid var(--border);padding-top:0.5rem">"${esc(r.note)}"</p>` : ''}
      </div>`;
      }).join('')}
  </div>`;
}

function renderEmpProfile() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';

  const s = allData.settings || {};
  const ep = s.emp_profile_edit || {};

  const avatarHtml = emp.profile_picture
    ? `<img src="${emp.profile_picture}" alt="Profil" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto 1rem;border:2px solid var(--primary);cursor:pointer;transition:transform 0.2s" onclick="window._previewImage('${emp.profile_picture}', '${esc(emp.name)}')" title="Klik untuk lihat foto penuh" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">`
    : `<div style="width:80px;height:80px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;margin:0 auto 1rem">${(emp.name || '?')[0]}</div>`;

  return `<div class="fade-in">
    <div class="card" style="text-align:center;padding:2rem;margin-bottom:1rem;position:relative;">
      ${avatarHtml}
      <h2 class="text-xl font-bold">${esc(emp.name)}</h2>
      <p class="text-muted">${esc(emp.position)} • ${esc(emp.emp_id)}</p>
      ${ep.photo ? `
      <div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:center;">
        <label for="pe-photo" class="btn btn-secondary" style="cursor:pointer;padding:0.4rem 0.8rem;font-size:0.8rem;">Ubah Foto</label>
        <input type="file" id="pe-photo" accept="image/*" style="display:none" onchange="window._handlePhotoSelect(event)">
        ${emp.profile_picture ? `<button class="btn btn-outline-danger" style="padding:0.4rem 0.8rem;font-size:0.8rem;" onclick="window._deleteEmployeePhoto()">Hapus</button>` : ''}
      </div>
      <p id="pe-photo-name" class="text-xs text-muted mt-2"></p>
      ` : ''}
    </div>

    <div class="card"><h3 class="card-title mb-4">Informasi & Edit Profil</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div class="form-group">
          <label class="form-label">Nama Lengkap ${!ep.name ? '<span class="text-xs text-muted">(Terkunci)</span>' : ''}</label>
          <input id="pe-name" class="form-input" value="${esc(emp.name)}" ${!ep.name ? 'disabled' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">Username <span class="text-xs text-muted">(Terkunci)</span></label>
          <input class="form-input" value="${esc(emp.username)}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">No. Telepon ${!ep.phone ? '<span class="text-xs text-muted">(Terkunci)</span>' : ''}</label>
          <input id="pe-phone" class="form-input" value="${esc(emp.phone || '')}" ${!ep.phone ? 'disabled' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">Email ${!ep.email ? '<span class="text-xs text-muted">(Terkunci)</span>' : ''}</label>
          <input id="pe-email" class="form-input" value="${esc(emp.email || '')}" ${!ep.email ? 'disabled' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">Tanggal Lahir ${!ep.dob ? '<span class="text-xs text-muted">(Terkunci)</span>' : ''}</label>
          <input id="pe-dob" type="date" class="form-input" value="${emp.date_of_birth || ''}" ${!ep.dob ? 'disabled' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">Jenis Kelamin <span class="text-xs text-muted">(Terkunci)</span></label>
          <input class="form-input" value="${esc(emp.gender || '-')}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">Jenis Kontrak <span class="text-xs text-muted">(Terkunci)</span></label>
          <input class="form-input" value="${esc(emp.contract_type || '-')}" disabled>
        </div>
        <div class="form-group">
          <label class="form-label">Masa Kontrak <span class="text-xs text-muted">(Terkunci)</span></label>
          <input class="form-input" value="${fmtDate(emp.contract_start)} s/d ${fmtDate(emp.contract_end)}" disabled>
        </div>
      </div>
      ${(ep.name || ep.phone || ep.email || ep.dob) ? `
      <div style="margin-top:1.5rem">
        <button class="btn btn-primary" onclick="window._updateEmployeeProfile()">Simpan Perubahan Profil</button>
      </div>` : ''}
    </div>

    <div class="card mt-4"><h3 class="card-title mb-4">Ubah PIN</h3>
      <div class="form-group"><label class="form-label">PIN Lama</label><div class="password-wrapper"><input id="cp-old" type="password" inputmode="numeric" maxlength="6" class="form-input" placeholder="••••••"><button type="button" class="password-toggle" onclick="window._togglePassword(this)">👁️</button></div></div>
      <div class="form-group"><label class="form-label">PIN Baru</label><div class="password-wrapper"><input id="cp-new" type="password" inputmode="numeric" maxlength="6" class="form-input" placeholder="••••••"><button type="button" class="password-toggle" onclick="window._togglePassword(this)">👁️</button></div></div>
      <div class="form-group"><label class="form-label">Konfirmasi PIN Baru</label><div class="password-wrapper"><input id="cp-confirm" type="password" inputmode="numeric" maxlength="6" class="form-input" placeholder="••••••"><button type="button" class="password-toggle" onclick="window._togglePassword(this)">👁️</button></div></div>
      <button class="btn btn-primary" onclick="window._changePin()">Ubah PIN</button>
    </div>
  </div>`;
}

// ==========================================
// GLOBAL ACTIONS (window-level handlers)
// ==========================================

// Navigation
window._nav = id => switchSection(id);

window._togglePassword = (btn) => {
  const inp = btn.previousElementSibling;
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.innerHTML = '👁️‍🗨️';
  } else {
    inp.type = 'password';
    btn.innerHTML = '👁️';
  }
};

// --- EMPLOYEE CRUD ---
window._showEmpForm = (key) => {
  const emp = key ? getUserByKey(key) : null;
  const area = $('emp-form-area'); if (!area) return;
  const positions = ['Manager', 'Admin', 'Supervisor', 'Operator', 'Cleaning Service'];
  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--primary)">
    <h3 class="card-title mb-4">${emp ? 'Edit Karyawan' : 'Tambah Karyawan Baru'}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="form-group"><label class="form-label">Nama Lengkap</label><input id="ef-name" class="form-input" value="${esc(emp?.name || '')}"></div>
      <div class="form-group"><label class="form-label">Jenis Kelamin</label><select id="ef-gender" class="form-input form-select"><option value="Laki-Laki" ${emp?.gender === 'Laki-Laki' ? 'selected' : ''}>Laki-Laki</option><option value="Perempuan" ${emp?.gender === 'Perempuan' ? 'selected' : ''}>Perempuan</option></select></div>
      <div class="form-group"><label class="form-label">Jabatan</label><select id="ef-pos" class="form-input form-select">${positions.map(p => `<option ${emp?.position === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">PIN (6 digit)</label><div class="password-wrapper"><input id="ef-pin" type="password" inputmode="numeric" maxlength="6" class="form-input" value="${esc(emp?.pin || '')}" placeholder="••••••"><button type="button" class="password-toggle" onclick="window._togglePassword(this)">👁️</button></div></div>
      <div class="form-group"><label class="form-label">Tanggal Mulai Kerja</label><input id="ef-jdate" type="date" class="form-input" value="${emp?.join_date || emp?.contract_start || ''}"></div>
      <div class="form-group"><label class="form-label">Jenis Kontrak</label><select id="ef-ctype" class="form-input form-select"><option value="Training" ${emp?.contract_type === 'Training' ? 'selected' : ''}>Training (3 Bulan)</option><option value="Tetap" ${emp?.contract_type === 'Tetap' ? 'selected' : ''}>Tetap (1 Tahun)</option></select></div>
      <div class="form-group"><label class="form-label">Mulai Kontrak</label><input id="ef-cstart" type="date" class="form-input" value="${emp?.contract_start || ''}"></div>
      <div class="form-group"><label class="form-label">Telepon</label><input id="ef-phone" class="form-input" value="${esc(emp?.phone || '')}"></div>
      <div class="form-group"><label class="form-label">Email</label><input id="ef-email" type="email" class="form-input" value="${esc(emp?.email || '')}"></div>
      <div class="form-group"><label class="form-label">Tanggal Lahir</label><input id="ef-dob" type="date" class="form-input" value="${emp?.date_of_birth || ''}"></div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:1rem">
      <button class="btn btn-primary" onclick="window._saveEmp('${key || ''}')">${emp ? 'Perbarui' : 'Simpan'}</button>
      <button class="btn btn-secondary" onclick="document.getElementById('emp-form-area').innerHTML=''">Batal</button>
    </div>
  </div>`;
};

window._saveEmp = async (key) => {
  const name = $('ef-name').value.trim();
  const pin = $('ef-pin').value.trim();
  const position = $('ef-pos').value;
  if (!name || !pin || pin.length !== 6) { showToast('Nama dan PIN 6 digit wajib!', 'error'); return; }

  const cstart = $('ef-cstart').value;
  let cend = '';
  if (cstart) {
    const d = new Date(cstart);
    if ($('ef-ctype').value === 'Training') d.setMonth(d.getMonth() + 3); else d.setFullYear(d.getFullYear() + 1);
    cend = d.toISOString().split('T')[0];
  }

  const others = getUsers().filter(u => u._key !== key);
  const emp_id = key ? getUserByKey(key)?.emp_id : genEmpId(position, others);
  const username = genUsername(name, emp_id);
  const join_date = $('ef-jdate') ? $('ef-jdate').value : (cstart || '');

  const data = { name, gender: $('ef-gender').value, position, pin, emp_id, username, join_date, contract_type: $('ef-ctype').value, contract_start: cstart, contract_end: cend, phone: $('ef-phone').value.trim(), email: $('ef-email').value.trim(), date_of_birth: $('ef-dob').value };

  if (key) await update(ref(db, 'users/' + key), data);
  else await set(push(ref(db, 'users')), data);

  showToast(key ? 'Karyawan diperbarui!' : 'Karyawan ditambahkan!', 'success');
  $('emp-form-area').innerHTML = '';
};

window._filterTxns = (empId, type, btnEl) => {
  const container = document.getElementById('txn-list-' + empId);
  if (!container) return;
  const txns = getTxns(empId);
  let filtered = txns;
  if (type === 'debit') filtered = txns.filter(t => t.type === 'debit');
  else if (type === 'credit') filtered = txns.filter(t => t.type === 'credit');

  const parent = btnEl.parentElement;
  if (parent) {
    parent.querySelectorAll('.btn-txn-filter').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }

  container.innerHTML = renderTxnListItems(filtered, empId);
};

window._showDebitCreditSummaryModal = () => {
  const users = getUsers();
  let totalD = 0, totalC = 0;

  const rowsHtml = users.map((e, idx) => {
    const txns = getTxns(e.emp_id);
    const empDebit = txns.filter(t => t.type === 'debit').reduce((sum, t) => sum + (t.amount || 0), 0);
    const empCredit = txns.filter(t => t.type === 'credit').reduce((sum, t) => sum + (t.amount || 0), 0);
    const bal = empDebit - empCredit;
    totalD += empDebit;
    totalC += empCredit;

    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:0.5rem;text-align:center">${idx + 1}</td>
      <td style="padding:0.5rem"><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)} (${esc(e.emp_id)})</span></td>
      <td style="padding:0.5rem;text-align:right;color:var(--danger);font-weight:700">${fmt(empDebit)}</td>
      <td style="padding:0.5rem;text-align:right;color:var(--success);font-weight:700">${fmt(empCredit)}</td>
      <td style="padding:0.5rem;text-align:right;font-weight:800;color:${bal > 0 ? 'var(--danger)' : 'var(--success)'}">${fmt(bal)}</td>
    </tr>`;
  }).join('');

  const modalHtml = `
    <div class="modal-header">
      <h3 class="modal-title">📋 Tabel Rekapitulasi Debit & Kredit Karyawan</h3>
      <button class="modal-close" onclick="window._hideModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:1rem">
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead>
          <tr style="border-bottom:2px solid var(--border);background:var(--bg-color);text-align:left">
            <th style="padding:0.5rem;text-align:center;width:40px">#</th>
            <th style="padding:0.5rem">Nama Karyawan</th>
            <th style="padding:0.5rem;text-align:right">Total Debit (Tunggakan)</th>
            <th style="padding:0.5rem;text-align:right">Total Kredit (Pembayaran)</th>
            <th style="padding:0.5rem;text-align:right">Sisa Net Saldo</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || '<tr><td colspan="5" style="text-align:center;padding:1rem" class="text-muted">Belum ada data.</td></tr>'}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border);background:var(--bg-color);font-weight:bold">
            <td colspan="2" style="padding:0.6rem;text-align:right">GRAND TOTAL SPBU:</td>
            <td style="padding:0.6rem;text-align:right;color:var(--danger)">${fmt(totalD)}</td>
            <td style="padding:0.6rem;text-align:right;color:var(--success)">${fmt(totalC)}</td>
            <td style="padding:0.6rem;text-align:right;color:${(totalD - totalC) > 0 ? 'var(--danger)' : 'var(--success)'}">${fmt(totalD - totalC)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="modal-footer" style="display:flex;justify-content:flex-end">
      <button class="btn btn-secondary" onclick="window._hideModal()">Tutup</button>
    </div>
  `;
  showModal(modalHtml, 'modal-wide');
};

window._showEditLeaveQuotaModal = (key) => {
  const emp = getUserByKey(key);
  if (!emp) return;

  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  if (leaveTypes.length === 0) {
    showToast('Belum ada Master Jenis Cuti yang dikonfigurasi di sistem.', 'warning');
    return;
  }

  const inputsHtml = leaveTypes.map(t => {
    const defaultQuota = Number(t.quota || 0);
    const currentCustom = (emp.custom_quota && emp.custom_quota[t.name] !== undefined) ? emp.custom_quota[t.name] : defaultQuota;

    return `<div class="form-group" style="margin-bottom:0.75rem">
      <label class="form-label" style="font-size:0.8rem">${esc(t.name)} <span class="text-xs text-muted">(Standar: ${defaultQuota} hari/tahun)</span></label>
      <input type="number" min="0" max="365" class="form-input inp-custom-quota" data-typename="${esc(t.name)}" value="${currentCustom}">
    </div>`;
  }).join('');

  const modalHtml = `
    <div class="modal-header">
      <h3 class="modal-title">✏️ Edit Jatah Cuti: ${esc(emp.name)}</h3>
      <button class="modal-close" onclick="window._hideModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:1rem">
      <p class="text-xs text-muted mb-3">Sesuaikan total jatah cuti khusus untuk karyawan ini jika terdapat perbedaan atau penyesuaian khusus.</p>
      ${inputsHtml}
    </div>
    <div class="modal-footer" style="display:flex;gap:0.5rem;justify-content:flex-end">
      <button class="btn btn-secondary" onclick="window._hideModal()">Batal</button>
      <button class="btn btn-primary" onclick="window._saveCustomLeaveQuota('${emp._key}')">Simpan Jatah Cuti</button>
    </div>
  `;
  showModal(modalHtml);
};

window._saveCustomLeaveQuota = async (key) => {
  const emp = getUserByKey(key);
  if (!emp) return;

  const inputs = document.querySelectorAll('.inp-custom-quota');
  const customQuotaObj = { ...(emp.custom_quota || {}) };

  inputs.forEach(inp => {
    const typeName = inp.dataset.typename;
    const val = Number(inp.value || 0);
    customQuotaObj[typeName] = val;
  });

  await update(ref(db, 'users/' + key), { custom_quota: customQuotaObj });
  showToast(`Jatah cuti khusus untuk ${emp.name} berhasil diperbarui!`, 'success');
  window._hideModal();
  if (currentUser) renderCurrentSection();
};

function autoResetLeaveOnContractEnd() {
  if (window._isAuditMode) return;
  const users = getUsers();
  const todayStr = new Date().toISOString().split('T')[0];
  const leaves = getLeaves();

  users.forEach(async (u) => {
    if (!u.contract_end) return;
    if (todayStr > u.contract_end) {
      const expiredLeaves = leaves.filter(l => (l.emp_id === u.emp_id || l.username === u.username) && (l.start_date <= u.contract_end || l.created_at <= u.contract_end));
      if (expiredLeaves.length > 0) {
        expiredLeaves.forEach(async (l) => {
          if (l._key) {
            await remove(ref(db, 'leaves/' + l._key)).catch(console.error);
          }
        });
      }
      if (u.custom_quota) {
        await update(ref(db, 'users/' + u._key), { custom_quota: null }).catch(console.error);
      }
    }
  });
}

window._realAllDataBackup = null;
window._isAuditMode = false;
window._auditFileName = '';

window._exportDatabaseBackup = () => {
  try {
    const backupData = {
      app: 'MyTIC SPBU Gontor',
      exported_at: new Date().toISOString(),
      data: allData
    };
    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const todayStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `mytic_backup_spbu_gontor_${todayStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup database berhasil diunduh!', 'success');
  } catch (e) {
    showToast('Gagal mengunduh backup: ' + e.message, 'error');
  }
};

window._importDatabaseRestore = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const dataToRestore = parsed.data || parsed;
        if (!dataToRestore || typeof dataToRestore !== 'object') {
          showToast('Format file backup JSON tidak valid!', 'error');
          return;
        }
        showConfirm('RESTORE DATABASE', 'Apakah Anda yakin ingin memulihkan database dari file backup ini? Data saat ini akan diperbarui dengan isi file backup.', async () => {
          await set(ref(db, '/'), dataToRestore);
          showToast('Database berhasil dipulihkan 100%!', 'success');
          location.reload();
        }, 'Ya, Pulihkan Database', true);
      } catch (err) {
        showToast('Gagal membaca file JSON: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

window._startAuditModeWithFile = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const auditData = parsed.data || parsed;
        if (!auditData || typeof auditData !== 'object') {
          showToast('Format file JSON tidak valid!', 'error');
          return;
        }
        window._realAllDataBackup = JSON.parse(JSON.stringify(allData));
        window._auditFileName = file.name;
        allData = auditData;
        window._isAuditMode = true;
        renderAuditModeBanner();
        showToast(`Mode Audit Aktif: ${file.name}`, 'info');
        renderCurrentSection();
      } catch (err) {
        showToast('Gagal membuka file audit: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };
  input.click();
};

window._exitAuditMode = () => {
  if (window._realAllDataBackup) {
    allData = JSON.parse(JSON.stringify(window._realAllDataBackup));
  }
  window._isAuditMode = false;
  const banner = document.getElementById('audit-mode-banner');
  if (banner) banner.remove();
  showToast('Keluar dari Mode Audit. Kembali ke data real-time hari ini.', 'success');
  renderCurrentSection();
};

function renderAuditModeBanner() {
  let banner = document.getElementById('audit-mode-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'audit-mode-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#1e40af;color:#ffffff;padding:0.6rem 1.25rem;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-size:0.85rem;font-weight:700;';
    document.body.prepend(banner);
  }
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.6rem">
      <span style="font-size:1.1rem">🔍</span>
      <span>MODE AUDIT & PREVIEW ARSIP: <span style="color:#fde047;text-decoration:underline">${esc(window._auditFileName || 'File Backup')}</span></span>
      <span style="font-size:0.75rem;opacity:0.85;font-weight:normal">(Data real-time hari ini aman di background)</span>
    </div>
    <button class="btn btn-secondary" style="padding:0.25rem 0.75rem;font-size:0.75rem;background:#ffffff;color:#1e40af;font-weight:800;border:none;cursor:pointer" onclick="window._exitAuditMode()">✕ Keluar Mode Audit</button>
  `;
}

window._resetPeriodData = () => {
  showConfirm('RESET PERIODE / TUTUP BUKU', 'Pastikan Anda SUDAH mem-backup database sebelum melakukan reset! Log absensi & transaksi periode lalu akan dibersihkan. Cuti & jatah cuti karyawan yang kontraknya masih AKTIF akan TETAP DIJAGA UTUH. Lanjutkan?', async () => {
    try {
      // 1. Reset absensi records
      await set(ref(db, 'absensi/records'), null);

      // 2. Clean leaves safely: KEEP leaves for employees whose contract is STILL ACTIVE
      const todayStr = today();
      const users = getUsers();
      const allLeaves = Object.entries(allData.leaves || {});

      for (const [k, l] of allLeaves) {
        const emp = users.find(u => u.emp_id === l.emp_id || u.username === l.username);
        if (emp && emp.contract_start && emp.contract_end) {
          const isActiveContract = (todayStr <= emp.contract_end) && (l.start_date >= emp.contract_start);
          if (isActiveContract) {
            // Active contract leave: KEEP INTACT!
            continue;
          }
        }
        // Delete expired/past contract leave record
        await remove(ref(db, 'leaves/' + k)).catch(console.error);
      }

      showToast('Reset periode berhasil! Cuti karyawan kontrak aktif tetap aman utuh!', 'success');
      location.reload();
    } catch (err) {
      showToast('Gagal reset periode: ' + err.message, 'error');
    }
  }, 'Ya, Reset Periode', true);
};

window._showSectionGuideModal = (secId) => {
  let targetSec = secId || currentSection || 'dashboard';
  
  const isMgmt = currentUser && (currentUser.role === 'admin' || isEmpAdminOrSupervisor());
  if (!isMgmt && (targetSec === 'dashboard' || targetSec === 'emp-dashboard')) {
    targetSec = 'emp-dashboard';
  }
  
  const sectionGuides = {
    dashboard: {
      title: '📊 Panduan Halaman Beranda (Dashboard Manajemen)',
      color: 'var(--primary)',
      content: `
        <div style="background:rgba(30,64,175,0.06);border-left:4px solid var(--primary);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Halaman Beranda adalah pusat pemantauan utama (*control center*) untuk melihat ringkasan performa operasional, statistik kedisiplinan absensi karyawan, dan alert pengajuan pending di SPBU Gontor secara real-time.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>
        
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--primary);margin-bottom:0.35rem">1. Grafik Tren Kehadiran 7 Hari</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Setiap hari oleh Manajemen untuk mengevaluasi konsistensi jam masuk seluruh operator & staf.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong> Arahkan kursor atau sentuh (tap) pada batang grafik harian. Grafik secara otomatis terbagi menjadi 3 warna: <span style="color:#10b981;font-weight:700">On Time (Hijau)</span>, <span style="color:#f59e0b;font-weight:700">Terlambat (Kuning)</span>, dan <span style="color:#6b7280;font-weight:700">Libur (Abu-abu)</span>.</p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Data diambil otomatis secara *live* dari Sistem Absensi SPBU.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--info);margin-bottom:0.35rem">2. Kartu Ringkasan Karyawan</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Untuk melihat total staf aktif SPBU secara sekilas.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong> Klik pada kartu <code>Total Karyawan</code> untuk langsung berpindah ke halaman Kelola Karyawan.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--danger);margin-bottom:0.35rem">3. Kartu Ringkasan Tunggakan Aktif</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Untuk memantau total saldo kasbon/tunggakan seluruh karyawan yang belum lunas.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong> Klik pada kartu <code>Tunggakan Aktif</code> untuk langsung berpindah ke halaman Manajemen Tunggakan.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:var(--warning);margin-bottom:0.35rem">4. Kartu Alert Izin/Cuti Pending</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Ketika ada angka badge merah/kuning yang menunjukkan pengajuan izin karyawan membutuhkan keputusan.</p>
          <p style="margin:0"><strong>Cara Pakai:</strong> Klik kartu untuk membuka persetujuan izin & Obrolan Cuti.</p>
        </div>
      `
    },
    'emp-dashboard': {
      title: '🏠 Panduan Halaman Beranda Karyawan',
      color: 'var(--primary)',
      content: `
        <div style="background:rgba(30,64,175,0.06);border-left:4px solid var(--primary);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Halaman utama Beranda Karyawan ini merangkum seluruh status kehadiran pribadi Anda, statistik jam kerja harian, pengumuman dari Manajemen SPBU, dan saldo cepat Anda secara real-time.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Informasi Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--primary);margin-bottom:0.35rem">1. Ringkasan Kehadiran Saya</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Setiap hari untuk memantau akumulasi total jam kerja, hari masuk, dan catatan ketepatan waktu Anda bulan ini.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--info);margin-bottom:0.35rem">2. Kartu Informasi Cepat (Saldo & Cuti)</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Fungsi:</strong> Menampilkan sisa jatah cuti tahunan, sisa saldo tunggakan/kasbon, dan saldo tabungan pribadi Anda secara sekilas.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:var(--success);margin-bottom:0.35rem">3. Pintasan Sistem Absensi</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Fungsi:</strong> Pintasan untuk langsung membuka aplikasi Sistem Absensi SPBU saat hendak presensi Clock-In / Clock-Out.</p>
        </div>
      `
    },
    employees: {
      title: '👥 Panduan Menu Kelola Karyawan & Jatah Cuti Khusus',
      color: 'var(--info)',
      content: `
        <div style="background:rgba(14,165,233,0.06);border-left:4px solid var(--info);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Halaman ini digunakan oleh Admin/Manajemen untuk menambah staf baru, memperbarui PIN akses, mengatur tanggal & masa berlaku kontrak kerja, serta mengkustomisasi jatah cuti khusus per individu.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--info);margin-bottom:0.35rem">1. Tombol "+ Tambah Karyawan Baru" (Pojok Kanan Atas)</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Ketika SPBU merekrut pegawai atau operator shift baru.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Langkah Penggunaan:</strong>
            <ol style="padding-left:1.25rem;margin:0.25rem 0">
              <li>Klik <code>+ Tambah Karyawan</code>.</li>
              <li>Isi Nama Lengkap, Jenis Kelamin, dan Jabatan (Manager, Admin, Supervisor, Operator, Cleaning Service).</li>
              <li>Masukkan <strong>PIN 6-digit rahasia</strong> awal untuk login karyawan.</li>
              <li>Isi Tanggal Mulai Kerja, Jenis Kontrak, Tanggal Mulai Kontrak, & Tanggal Berakhir Kontrak.</li>
              <li>Klik <code>Simpan Data Karyawan</code>.</li>
            </ol>
          </p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Akun karyawan langsung aktif & terdaftar di seluruh sistem MyTIC dan Absensi.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--primary);margin-bottom:0.35rem">2. Tombol "Detail" (Pada Kartu Karyawan)</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat ingin mengecek biodata, mengubah PIN yang lupa, atau melihat log keamanan perubahan PIN.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Langkah Penggunaan:</strong> Klik <code>Detail</code> pada kartu nama karyawan. Di dalam modal akan muncul biodata lengkap dan kotak <strong>Riwayat Perubahan PIN</strong>.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--success);margin-bottom:0.35rem">3. Tombol "✏️ Edit Jatah Cuti Khusus"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat ada penyesuaian/komplain jatah cuti individu, atau jika manajemen memberikan jatah cuti khusus tambahan untuk karyawan tertentu.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Langkah Penggunaan:</strong>
            <ol style="padding-left:1.25rem;margin:0.25rem 0">
              <li>Klik tombol <code>Detail</code> pada nama karyawan.</li>
              <li>Klik tombol <code>✏️ Edit Jatah Cuti</code> di samping angka jatah cuti.</li>
              <li>Masukkan total hari cuti khusus yang diinginkan (contoh: 12 hari).</li>
              <li>Klik <code>Simpan Cuti Khusus</code>.</li>
            </ol>
          </p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Kuota cuti karyawan tersebut langsung diperbarui tanpa mengubah kuota karyawan lain.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:#8b5cf6;margin-bottom:0.35rem">4. Sistem Otomatis Reset Cuti Masa Kontrak (Auto-Guard)</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Berjalan:</strong> Berjalan otomatis secara individual per tanggal berakhirnya kontrak (<code>contract_end</code>).</p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Hanya karyawan yang kontraknya resmi BERAKHIR yang riwayat cutinya dibersihkan untuk kontrak baru. <strong>Karyawan lain yang kontraknya MASIH AKTIF jatah cutinya TETAP UTUH DIJAGA SAMPAI KONTRAK MEREKA SELESAI.</strong></p>
        </div>
      `
    },
    debits: {
      title: '💳 Panduan Menu Tunggakan (Debit & Kredit Manajemen)',
      color: 'var(--danger)',
      content: `
        <div style="background:rgba(239,68,68,0.06);border-left:4px solid var(--danger);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Modul ini digunakan untuk mencatat secara akurat seluruh pinjaman/kasbon baru (Debit) dan pembayaran cicilan/pelunasan (Kredit) karyawan SPBU Gontor dengan jaminan saldo *carry-over* yang aman.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--danger);margin-bottom:0.35rem">1. Tombol "+ Debit" (Tambah Tunggakan / Kasbon Baru)</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Ketika karyawan mengajukan pinjaman/kasbon baru atau terjadi ganti rugi selisih yang harus dicatat.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Langkah Penggunaan:</strong>
            <ol style="padding-left:1.25rem;margin:0.25rem 0">
              <li>Klik tombol <code>+ Debit</code> di kanan atas atau pada kartu karyawan.</li>
              <li>Pilih Nama Karyawan.</li>
              <li>Masukkan Jumlah Nominal (Rp) dan Tanggal Transaksi.</li>
              <li>Isi Keterangan / Alasan Kasbon.</li>
              <li>Klik <code>Simpan Transaksi Debit</code>.</li>
            </ol>
          </p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Total Debit dan Sisa Saldo Tunggakan karyawan akan bertambah secara otomatis.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--success);margin-bottom:0.35rem">2. Tombol "+ Kredit" (Pembayaran / Pelunasan)</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Ketika karyawan membayar angsuran/potongan gaji untuk pelunasan kasbon.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Langkah Penggunaan:</strong>
            <ol style="padding-left:1.25rem;margin:0.25rem 0">
              <li>Klik tombol <code>+ Kredit</code>.</li>
              <li>Pilih Nama Karyawan.</li>
              <li>Masukkan Nominal Pembayaran (Rp) dan Tanggal.</li>
              <li>Klik <code>Simpan Transaksi Kredit</code>.</li>
            </ol>
          </p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Total Kredit bertambah dan Sisa Saldo Tunggakan berkurang hingga Lunas (Rp 0).</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--info);margin-bottom:0.35rem">3. Filter Tab Transaksi ([Semua], [🔴 Debit], [🟢 Kredit])</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat Admin ingin menyaring riwayat transaksi karyawan tertentu agar tidak membingungkan.</p>
          <p style="margin:0"><strong>Cara Pakai:</strong> Klik tombol filter <code>[Semua]</code>, <code>[🔴 Debit]</code>, atau <code>[🟢 Kredit]</code> di bagian atas daftar transaksi.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:#8b5cf6;margin-bottom:0.35rem">4. Tombol "📋 Lihat Rekap Tabel All Karyawan"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat Manajemen atau Auditor ingin melihat audit rekapitulasi tunggakan seluruh karyawan sekaligus dalam tampilan tabel yang sangat luas.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong> Klik tombol <code>📋 Lihat Rekap Tabel All Karyawan</code> di bagian atas. Jendela tabel lebar (1050px) akan terbuka rapi tanpa terpotong di layar PC.</p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Menampilkan ringkasan Total Debit, Total Kredit, dan Net Saldo per karyawan dalam 1 tabel utuh.</p>
        </div>
      `
    },
    'emp-debits': {
      title: '💳 Panduan Menu Tunggakan Saya',
      color: 'var(--danger)',
      content: `
        <div style="background:rgba(239,68,68,0.06);border-left:4px solid var(--danger);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Tempat Anda mengecek rincian catatan tunggakan kasbon dan pembayaran pelunasan pribadi secara transparan.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">📌 Rincian Kartu Informasi:</h4>
        <ul style="padding-left:1.25rem;margin:0 0 1rem 0">
          <li><strong>Total Debit</strong>: Jumlah akumulasi pinjaman/kasbon yang pernah dicatat.</li>
          <li><strong>Total Kredit</strong>: Jumlah akumulasi pembayaran/cicilan yang telah diserahkan ke Manajemen.</li>
          <li><strong>Sisa Net Saldo</strong>: Sisa kewajiban saldo yang perlu dilunasi. Saldo ini akan terus terbawa sampai Lunas (Rp 0).</li>
        </ul>
      `
    },
    leaves: {
      title: '🏖️ Panduan Menu Izin & Cuti Manajemen',
      color: 'var(--success)',
      content: `
        <div style="background:rgba(16,185,129,0.06);border-left:4px solid var(--success);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Halaman ini digunakan Manajemen untuk meninjau, menyetujui, atau menolak pengajuan izin/cuti dari karyawan, serta berdiskusi interaktif via Obrolan Cuti.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--success);margin-bottom:0.35rem">1. Tombol "Setujui" & "Tolak"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat ada pengajuan izin masuk bertanda badge <code>Menunggu</code>.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong>
            <ul style="padding-left:1.25rem;margin:0.25rem 0">
              <li>Klik <code>Setujui</code> jika izin diizinkan. Kuota cuti karyawan akan otomatis terpotong sesuai jumlah hari.</li>
              <li>Klik <code>Tolak</code> jika izin tidak disetujui. Kuota cuti karyawan tidak akan terpotong.</li>
            </ul>
          </p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:var(--primary);margin-bottom:0.35rem">2. Tombol "💬 Chat" (Obrolan Cuti)</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Ketika Admin butuh klarifikasi alasan cuti atau konfirmasi penukaran shift kerja.</p>
          <p style="margin:0"><strong>Cara Pakai:</strong> Klik ikon <code>💬 Chat</code> pada kartu pengajuan. Jendela pesan interaktif akan terbuka secara real-time.</p>
        </div>
      `
    },
    'emp-leaves': {
      title: '🏖️ Panduan Menu Izin & Cuti Saya',
      color: 'var(--success)',
      content: `
        <div style="background:rgba(16,185,129,0.06);border-left:4px solid var(--success);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Tempat Anda memantau sisa jatah cuti pribadi, mengajukan izin baru, dan berdiskusi dengan Admin.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--success);margin-bottom:0.35rem">1. Tombol "+ Ajukan Izin Baru"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat hendak berhalangan hadir (Cuti Tahunan, Cuti Sakit, dll).</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong> Klik <code>+ Ajukan</code>, pilih Jenis Izin, Tanggal Mulai, Tanggal Selesai, dan tulis Alasan.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:var(--primary);margin-bottom:0.35rem">2. Tombol "💬 Chat Diskusi"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Untuk memberikan kabar terbaru kepada Admin mengenai persetujuan izin Anda.</p>
          <p style="margin:0"><strong>Cara Pakai:</strong> Klik ikon <code>💬 Chat</code> pada riwayat pengajuan izin Anda.</p>
        </div>
      `
    },
    leaderboard: {
      title: '🏆 Panduan Menu Peringkat & KPI (Cetak Rapor PDF)',
      color: 'var(--warning)',
      content: `
        <div style="background:rgba(245,158,11,0.06);border-left:4px solid var(--warning);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Modul ini menampilkan pemeringkatan karyawan terbaik berdasarkan penilaian KPI dan fasilitas mencetak **Rapor Kinerja PDF Resmi**.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--warning);margin-bottom:0.35rem">1. Tombol "🖨️ Cetak PDF Rapor KPI"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Setiap akhir bulan/periode evaluasi saat Manajemen ingin menerbitkan dokumen resmi rapor evaluasi staf.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Langkah Penggunaan:</strong>
            <ol style="padding-left:1.25rem;margin:0.25rem 0">
              <li>Pilih nama karyawan & bulan evaluasi.</li>
              <li>Pilih Ukuran Kertas: <code>A4</code> atau <code>F4 / Folio</code>.</li>
              <li>Klik tombol <code>🖨️ Cetak PDF Rapor KPI</code>.</li>
            </ol>
          </p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Menghasilkan file PDF rapor resmi yang siap diprint lengkap dengan area tanda tangan Manajer SPBU & Karyawan.</p>
        </div>
      `
    },
    payroll: {
      title: '💵 Panduan Menu Gaji & Payroll',
      color: '#10b981',
      content: `
        <div style="background:rgba(16,185,129,0.06);border-left:4px solid #10b981;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Digunakan oleh Manajer/Admin Keuangan untuk mengonfigurasi struktur Gaji Pokok, Tunjangan Jabatan, Uang Makan, Bonus, dan Potongan, serta menerbitkan slip gaji resmi.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:#10b981;margin-bottom:0.35rem">1. Tombol "Atur Gaji & Tunjangan"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat menetapkan standar gaji karyawan baru atau saat ada kenaikan jabatan/tunjangan.</p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Nilai master gaji tersimpan aman di database dan tidak akan terhapus saat reset periode.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:var(--primary);margin-bottom:0.35rem">2. Tombol "Cetak Slip Gaji PDF"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat penggajian bulanan diterbitkan kepada karyawan.</p>
          <p style="margin:0"><strong>Cara Pakai:</strong> Klik <code>Cetak Slip Gaji</code> pada nama karyawan untuk mengunduh dokumen slip gaji resmi.</p>
        </div>
      `
    },
    settings: {
      title: '⚙️ Panduan Menu Pengaturan, Backup JSON, Audit & Reset',
      color: '#8b5cf6',
      content: `
        <div style="background:rgba(139,92,246,0.06);border-left:4px solid #8b5cf6;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Pusat kontrol keamanan sistem SPBU untuk mengunduh backup 1-klik, melakukan audit laporan arsip lama, memulihkan database, dan melakukan Tutup Buku (Reset Periode).</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Tombol-Tombol Utama:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:#10b981;margin-bottom:0.35rem">1. Tombol "💾 Download Backup JSON (1-Klik)"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Wajib dilakukan setiap akhir bulan sebelum Reset Periode atau secara rutin seminggu sekali.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong> Klik tombol <code>💾 Download Backup JSON</code>. File cadangan bertanggal otomatis akan langsung terunduh ke komputer/HP Anda.</p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Menjamin 100% data seluruh SPBU tersimpan aman di penyimpanan lokal Anda.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:#1e40af;margin-bottom:0.35rem">2. Tombol "🔍 Mode Audit / Preview Arsip JSON"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Ketika Admin atau Manajer ingin memeriksa laporan arsip bulan/tahun lalu tanpa mengganggu operasional harian real-time hari ini.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Langkah Penggunaan:</strong>
            <ol style="padding-left:1.25rem;margin:0.25rem 0">
              <li>Klik <code>🔍 Buka File Backup (Mode Audit)</code>.</li>
              <li>Pilih file backup JSON lama yang ingin ditinjau.</li>
              <li>Banner biru Mode Audit akan aktif di layar atas. Seluruh tampilan aplikasi akan memperlihatkan data arsip lama tersebut.</li>
              <li>Setelah selesai memeriksa, klik <code>✕ Keluar Mode Audit</code> di banner atas.</li>
            </ol>
          </p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Aman 100%! Data real-time hari ini di background sama sekali tidak terpengaruh atau terhapus.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--danger);margin-bottom:0.35rem">3. Tombol "📥 Restore Database"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Hanya dalam keadaan darurat jika terjadi kesalahan fatal data dan ingin mengembalikan database dari file backup JSON.</p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Memperbarui database live secara keseluruhan dengan isi file backup yang dipilih.</p>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:#dc2626;margin-bottom:0.35rem">4. Tombol "🧹 Reset Periode / Tutup Buku"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Setiap pergantian periode penggajian/tutup buku bulanan setelah file backup JSON diunduh.</p>
          <p style="margin:0 0 0.35rem 0"><strong>Cara Pakai:</strong> Klik tombol <code>🧹 Reset Periode / Tutup Buku</code> $\rightarrow$ konfirmasi dialog.</p>
          <p style="margin:0"><strong>Efek Sistem:</strong> Log absensi & log transaksi lama dirapikan. <strong>Cuti & jatah cuti karyawan yang masa kontraknya masih AKTIF TETAP DIJAGA UTUH DENGAN AMAN.</strong></p>
        </div>
      `
    },
    violations: {
      title: '⚠️ Panduan Menu Pelanggaran & Disiplin',
      color: '#f97316',
      content: `
        <div style="background:rgba(249,115,22,0.06);border-left:4px solid #f97316;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Digunakan oleh Manajemen untuk mencatat surat peringatan (SP) dan sanksi kedisiplinan karyawan.</p>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:#f97316;margin-bottom:0.35rem">1. Tombol "+ Catat Pelanggaran"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Ketika karyawan melakukan pelanggaran SOP atau aturan kedisiplinan SPBU.</p>
          <p style="margin:0"><strong>Cara Pakai:</strong> Pilih nama karyawan, tanggal, jenis pelanggaran, dan isi sanksi.</p>
        </div>
      `
    },
    'emp-violations': {
      title: '⚠️ Panduan Menu Pelanggaran Saya',
      color: '#f97316',
      content: `
        <div style="background:rgba(249,115,22,0.06);border-left:4px solid #f97316;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Tempat Anda mengecek riwayat catatan kedisiplinan, sanksi, atau Surat Peringatan (SP) yang dicatat oleh Manajemen SPBU.</p>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:#f97316;margin-bottom:0.35rem">1. Kartu Catatan Kedisiplinan</h5>
          <p style="margin:0">Menampilkan tanggal kejadian, jenis pelanggaran, dan deskripsi sanksi. Catatan ini dijadikan acuan evaluasi KPI bulanan Anda.</p>
        </div>
      `
    },
    savings: {
      title: '💰 Panduan Menu Tabungan Karyawan',
      color: '#14b8a6',
      content: `
        <div style="background:rgba(20,184,166,0.06);border-left:4px solid #14b8a6;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Modul pencatatan uang simpanan/tabungan karyawan SPBU Gontor dengan jaminan saldo 100% utuh.</p>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:#14b8a6;margin-bottom:0.35rem">1. Tombol "+ Setor / Tarik Tabungan"</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Kapan Digunakan:</strong> Saat karyawan menyetorkan tabungan bulanan atau menarik tabungan.</p>
          <p style="margin:0"><strong>Cara Pakai:</strong> Pilih nama karyawan, jenis transaksi (Setor/Tarik), tanggal, nominal, dan keterangan.</p>
        </div>
      `
    },
    'emp-savings': {
      title: '💰 Panduan Menu Tabungan Saya',
      color: '#14b8a6',
      content: `
        <div style="background:rgba(20,184,166,0.06);border-left:4px solid #14b8a6;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Memantau akumulasi total saldo uang tabungan pribadi Anda di SPBU Gontor beserta histori rincian setorannya.</p>
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem">
          <h5 style="font-weight:800;color:#14b8a6;margin-bottom:0.35rem">1. Keamanan Saldo Tabungan</h5>
          <p style="margin:0">Saldo tabungan Anda tersimpan secara 100% aman dan <strong>TIDAK AKAN BERKURANG / HILANG saat ada Reset Periode Tutup Buku</strong>.</p>
        </div>
      `
    },
    ratings: {
      title: '⭐ Panduan Menu Penilaian Karyawan (KPI)',
      color: '#eab308',
      content: `
        <div style="background:rgba(234,179,8,0.06);border-left:4px solid #eab308;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Tempat Manajemen menginput nilai evaluasi bulanan karyawan berbasis skor bintang 1-5.</p>
        </div>
      `
    },
    'emp-ratings': {
      title: '⭐ Panduan Menu Penilaian Saya (KPI)',
      color: '#eab308',
      content: `
        <div style="background:rgba(234,179,8,0.06);border-left:4px solid #eab308;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Melihat hasil nilai evaluasi kinerja bulanan Anda (skor bintang 1-5) dan saran/catatan langsung dari Manajemen SPBU Gontor.</p>
        </div>
      `
    },
    criteria: {
      title: '📝 Panduan Menu Kriteria KPI',
      color: '#6366f1',
      content: `
        <div style="background:rgba(99,102,241,0.06);border-left:4px solid #6366f1;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Master data untuk mengatur bobot dan kriteria penilaian indikator KPI per posisi/jabatan.</p>
        </div>
      `
    },
    'leave-types': {
      title: '📝 Panduan Master Jenis Cuti',
      color: '#06b6d4',
      content: `
        <div style="background:rgba(6,182,212,0.06);border-left:4px solid #06b6d4;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Master data untuk menentukan nama jenis cuti dan jatah kuota standar tahunan.</p>
        </div>
      `
    },
    'internal-chat': {
      title: '💬 Panduan Diskusi Internal',
      color: '#8b5cf6',
      content: `
        <div style="background:rgba(139,92,246,0.06);border-left:4px solid #8b5cf6;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Wadah komunikasi pesan instan antar staf dan Manajemen SPBU.</p>
        </div>
      `
    },
    'emp-history': {
      title: '⏱️ Panduan Menu Riwayat Harian Saya',
      color: 'var(--info)',
      content: `
        <div style="background:rgba(14,165,233,0.06);border-left:4px solid var(--info);padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Halaman ini menampilkan histori catatan absensi presensi harian Anda (Jam Masuk, Jam Pulang, Lokasi, dan Menit Keterlambatan) yang diambil langsung dari Sistem Absensi SPBU Gontor.</p>
        </div>

        <h4 style="font-weight:800;margin:1rem 0 0.5rem 0">🎛️ Fitur & Cara Membaca Informasi:</h4>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem">
          <h5 style="font-weight:800;color:var(--info);margin-bottom:0.35rem">1. Tabel Riwayat Presensi</h5>
          <p style="margin:0 0 0.35rem 0"><strong>Informasi:</strong> Menampilkan Tanggal, Jam Masuk (Clock-In), Jam Pulang (Clock-Out), dan Status Kehadiran (On Time / Terlambat X Menit).</p>
          <p style="margin:0"><strong>Guna:</strong> Untuk memverifikasi catatan jam hadir Anda agar sesuai dengan jadwal shift kerja yang ditentukan Manajemen.</p>
        </div>
      `
    },
    'emp-profile': {
      color: '#8b5cf6',
      content: `
        <div style="background:rgba(139,92,246,0.06);border-left:4px solid #8b5cf6;padding:0.75rem 1rem;border-radius:var(--radius-sm);margin-bottom:1rem">
          <h4 style="font-weight:800;margin-bottom:0.25rem">🔍 Apa Fungsi Halaman Ini?</h4>
          <p style="margin:0;font-size:0.85rem">Tempat mengunggah foto profil pribadi dan memperbarui PIN 6-digit rahasia akun Anda.</p>
        </div>
      `
    }
  };

  const g = sectionGuides[targetSec] || sectionGuides['dashboard'];
  
  const modalHtml = `
    <div class="modal-header" style="background:${g.color || 'var(--primary)'};color:#fff">
      <h3 class="modal-title" style="color:#fff">${g.title}</h3>
      <button class="modal-close" style="color:#fff" onclick="window._hideModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height:75vh;overflow-y:auto;padding:1.25rem;font-size:0.85rem;line-height:1.6">
      ${g.content}
    </div>
    <div class="modal-footer" style="display:flex;justify-content:flex-end">
      <button class="btn btn-primary" onclick="window._hideModal()">Tutup Panduan</button>
    </div>
  `;
  showModal(modalHtml, 'modal-wide');
};

window._showUserGuideModal = () => {
  window._showSectionGuideModal(currentSection || 'dashboard');
};

window._showEmpDetail = (key) => {
  const emp = getUserByKey(key); if (!emp) return;
  const bal = calcBalance(emp.emp_id);
  const pinHist = getPinHistory(emp.emp_id);
  const pinHistHtml = pinHist.length === 0 ? '<p class="text-xs text-muted">Belum ada riwayat perubahan PIN.</p>' :
    `<div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md);padding:0.5rem">
       ${pinHist.map(h => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:0.25rem 0;font-size:0.75rem">
         <span>${new Date(h.timestamp).toLocaleString('id-ID')}</span>
         <span><span style="text-decoration:line-through;color:var(--danger)">${esc(h.old_pin)}</span> ➔ <strong style="color:var(--success)">${esc(h.new_pin)}</strong></span>
       </div>`).join('')}
     </div>`;

  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  const currentYear = new Date().getFullYear();
  const empLeaves = getLeaves(emp.emp_id).filter(l => l.status !== 'Ditolak' && new Date(l.start_date).getFullYear() === currentYear);

function getEmpLeaveBalance(emp, t, empLeaves) {
  const defaultQuota = Number(t.quota || 0);
  const totalQuota = (emp.custom_quota && emp.custom_quota[t.name] !== undefined)
    ? Number(emp.custom_quota[t.name])
    : defaultQuota;

  let taken = 0;
  if (empLeaves) {
    empLeaves.filter(l => l.leave_type === t.name).forEach(l => {
      const d1 = new Date(l.start_date);
      const d2 = new Date(l.end_date);
      taken += Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
    });
  }

  let remaining = totalQuota - taken;
  let isCustom = false;

  if (emp.custom_remaining && emp.custom_remaining[t.name] !== undefined) {
    isCustom = true;
    const cData = emp.custom_remaining[t.name];
    if (typeof cData === 'object' && cData !== null && cData.remaining !== undefined) {
      const setRem = Number(cData.remaining || 0);
      const takenAtSet = Number(cData.taken_at_set || 0);
      const takenDelta = Math.max(0, taken - takenAtSet);
      remaining = Math.max(0, setRem - takenDelta);
    } else {
      remaining = Math.max(0, Number(cData || 0));
    }
  } else if (emp.custom_quota && emp.custom_quota[t.name] !== undefined) {
    isCustom = true;
  }

  return {
    defaultQuota,
    totalQuota,
    taken,
    remaining,
    isCustom
  };
}

window._showEmpDetail = (key) => {
  const emp = getUserByKey(key); if (!emp) return;
  const bal = calcBalance(emp.emp_id);
  const pinHist = getPinHistory(emp.emp_id);
  const pinHistHtml = pinHist.length === 0 ? '<p class="text-xs text-muted">Belum ada riwayat perubahan PIN.</p>' :
    `<div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md);padding:0.5rem">
       ${pinHist.map(h => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:0.25rem 0;font-size:0.75rem">
         <span>${new Date(h.timestamp).toLocaleString('id-ID')}</span>
         <span><span style="text-decoration:line-through;color:var(--danger)">${esc(h.old_pin)}</span> ➔ <strong style="color:var(--success)">${esc(h.new_pin)}</strong></span>
       </div>`).join('')}
     </div>`;

  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  const currentYear = new Date().getFullYear();
  const empLeaves = getLeaves(emp.emp_id).filter(l => l.status !== 'Ditolak' && new Date(l.start_date).getFullYear() === currentYear);

  let leaveQuotaHtml = '';
  if (leaveTypes.length > 0) {
    leaveQuotaHtml = `<div class="mt-4">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
        <p class="form-label mb-0">Sisa Jatah Cuti (${currentYear})</p>
        ${currentUser && currentUser.role === 'admin' ? `<button class="btn btn-secondary" style="padding:0.2rem 0.5rem;font-size:0.7rem" onclick="window._showEditLeaveBalanceModal('${emp._key}')">✏️ Edit Sisa Cuti</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">`;
    let hasQuota = false;
    leaveTypes.forEach(t => {
      const balInfo = getEmpLeaveBalance(emp, t, empLeaves);
      if (balInfo.totalQuota > 0) {
        hasQuota = true;
        leaveQuotaHtml += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <p class="text-xs text-muted mb-1">${esc(t.name)}</p>
            ${balInfo.isCustom ? '<span class="badge badge-warning" style="font-size:0.6rem;padding:1px 4px">Disesuaikan</span>' : ''}
          </div>
          <p class="font-bold text-sm" style="color:${balInfo.remaining <= 0 ? 'var(--danger)' : 'var(--success)'}">${balInfo.remaining} <span class="text-xs font-normal text-muted">dari ${balInfo.totalQuota} hari</span></p>
        </div>`;
      }
    });
    leaveQuotaHtml += `</div></div>`;
    if (!hasQuota) leaveQuotaHtml = '';
  }

  const avatarHeaderHtml = emp.profile_picture
    ? `<div style="text-align:center;margin-bottom:1rem">
        <img src="${emp.profile_picture}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;cursor:pointer;border:2px solid var(--primary);transition:transform 0.2s" onclick="window._previewImage('${emp.profile_picture}', '${esc(emp.name)}')" title="Klik untuk lihat foto penuh" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">
       </div>`
    : '';

  showModal(`<div class="modal-header"><h3 class="modal-title">${esc(emp.name)}</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body">
      ${avatarHeaderHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <div><p class="form-label">Jabatan</p><p class="font-semibold text-sm">${esc(emp.position)}</p></div>
        <div><p class="form-label">ID</p><p class="font-semibold text-sm">${esc(emp.emp_id)}</p></div>
        <div><p class="form-label">Username</p><p class="font-semibold text-sm">${esc(emp.username)}</p></div>
        <div><p class="form-label">Kelamin</p><p class="font-semibold text-sm">${esc(emp.gender || '-')}</p></div>
        <div><p class="form-label">Kontrak</p><p class="font-semibold text-sm">${esc(emp.contract_type || '-')}</p></div>
        <div><p class="form-label">Mulai Kerja</p><p class="font-semibold text-sm">${fmtDate(emp.join_date || emp.contract_start)}</p></div>
        <div><p class="form-label">Berakhir</p><p class="font-semibold text-sm">${fmtDate(emp.contract_end)}</p></div>
        <div><p class="form-label">Tunggakan</p><p class="font-semibold text-sm" style="color:${bal > 0 ? 'var(--danger)' : 'var(--success)'}">${fmt(bal)}</p></div>
        <div><p class="form-label">Telepon</p><p class="font-semibold text-sm">${esc(emp.phone || '-')}</p></div>
      </div>
      ${leaveQuotaHtml}
      <div class="mt-4">
        <p class="form-label mb-2">Riwayat Perubahan PIN</p>
        ${pinHistHtml}
      </div>
    </div>
    <div class="modal-footer" style="display:flex;gap:0.5rem;justify-content:flex-end">
      ${leaveQuotaHtml ? `<button class="btn btn-warning" style="margin-right:auto" onclick="window._resetLeaveQuota('${emp.emp_id}','${esc(emp.name)}')">⟲ Perbarui Cuti</button>` : ''}
      <button class="btn btn-secondary" onclick="window._hideModal()">Tutup</button>
    </div>`);
};

window._showEditLeaveBalanceModal = (key) => {
  const emp = getUserByKey(key);
  if (!emp) return;

  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  const currentYear = new Date().getFullYear();
  const empLeaves = getLeaves(emp.emp_id).filter(l => l.status !== 'Ditolak' && new Date(l.start_date).getFullYear() === currentYear);

  let formHtml = '';
  leaveTypes.forEach(t => {
    const balInfo = getEmpLeaveBalance(emp, t, empLeaves);

    formHtml += `
      <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:0.75rem;margin-bottom:0.75rem;background:var(--bg-color)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <strong style="font-size:0.85rem">${esc(t.name)}</strong>
          ${balInfo.isCustom ? '<span class="badge badge-warning" style="font-size:0.65rem;padding:2px 6px">Disesuaikan</span>' : '<span class="badge badge-info" style="font-size:0.65rem;padding:2px 6px">Standar ('+balInfo.totalQuota+' Hari)</span>'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.75rem;margin-bottom:0.5rem;color:var(--text-muted)">
          <div>Sudah Terpakai: <strong style="color:var(--danger)">${balInfo.taken} Hari</strong></div>
          <div>Sisa Cuti Saat Ini: <strong style="color:${balInfo.remaining <= 0 ? 'var(--danger)' : 'var(--success)'}">${balInfo.remaining} dari ${balInfo.totalQuota} Hari</strong></div>
        </div>
        <div>
          <label class="form-label" style="font-size:0.75rem;margin-bottom:0.25rem;display:block">Ubah Sisa Cuti Baru (Hari):</label>
          <input type="number" id="edit-rem-${t.name.replace(/\s+/g, '_')}" data-type-name="${esc(t.name)}" data-taken="${balInfo.taken}" value="${balInfo.remaining}" min="0" max="365" class="form-input" style="font-size:0.85rem;padding:0.4rem 0.6rem">
          <span class="text-xs text-muted" style="font-size:0.7rem;display:block;margin-top:0.25rem">Akan ditampilkan sebagai <strong>X dari ${balInfo.totalQuota} hari</strong></span>
        </div>
      </div>
    `;
  });

  const modalContent = `
    <div class="modal-header">
      <h3 class="modal-title">✏️ Edit Sisa Cuti - ${esc(emp.name)}</h3>
      <button class="modal-close" onclick="window._hideModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto">
      <p class="text-xs text-muted mb-3">Masukkan jumlah <strong>Sisa Cuti (Hari)</strong> yang seharusnya dimiliki oleh <strong>${esc(emp.name)}</strong>. Total kuota (${leaveTypes[0]?.quota || 3} hari) akan tetap utuh.</p>
      ${formHtml || '<p class="text-xs text-muted">Tidak ada jenis cuti yang tersedia.</p>'}
    </div>
    <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center">
      <button class="btn btn-secondary" style="font-size:0.75rem" onclick="window._resetEmpLeaveCustom('${emp._key}')">⟲ Reset ke Standar</button>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-secondary" style="font-size:0.75rem" onclick="window._hideModal()">Batal</button>
        <button class="btn btn-primary" style="font-size:0.75rem" onclick="window._saveLeaveBalance('${emp._key}')">💾 Simpan Sisa Cuti</button>
      </div>
    </div>
  `;

  showModal(modalContent, 'modal-md');
};

window._saveLeaveBalance = async (key) => {
  const emp = getUserByKey(key);
  if (!emp) return;

  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  const newCustomRemaining = { ...(emp.custom_remaining || {}) };

  leaveTypes.forEach(t => {
    const inputId = `edit-rem-${t.name.replace(/\s+/g, '_')}`;
    const inputEl = document.getElementById(inputId);
    if (inputEl) {
      const desiredRemaining = Math.max(0, parseInt(inputEl.value) || 0);
      const taken = parseInt(inputEl.getAttribute('data-taken')) || 0;
      newCustomRemaining[t.name] = {
        remaining: desiredRemaining,
        taken_at_set: taken
      };
    }
  });

  try {
    await update(ref(db, `users/${key}`), { custom_remaining: newCustomRemaining });
    showToast(`Sisa cuti ${emp.name} berhasil diperbarui!`, 'success');
    hideModal();
    window._showEmpDetail(key);
  } catch (err) {
    showToast('Gagal menyimpan sisa cuti: ' + err.message, 'error');
  }
};

window._resetEmpLeaveCustom = async (key) => {
  const emp = getUserByKey(key);
  if (!emp) return;
  if (!confirm(`Kembalikan sisa cuti ${emp.name} ke perhitungan standar sistem?`)) return;

  try {
    await update(ref(db, `users/${key}`), { custom_remaining: null, custom_quota: null });
    showToast(`Cuti ${emp.name} kembali ke perhitungan standar!`, 'success');
    hideModal();
    window._showEmpDetail(key);
  } catch (err) {
    showToast('Gagal me-reset cuti: ' + err.message, 'error');
  }
};

window._deleteEmp = async (key) => {
  if (!confirm('Hapus karyawan ini dan semua data terkait?')) return;
  const emp = getUserByKey(key);
  await remove(ref(db, 'users/' + key));
  // Delete related data
  if (emp) {
    for (const [k, v] of Object.entries(allData.transactions)) { if (v.emp_id === emp.emp_id) await remove(ref(db, 'transactions/' + k)); }
    for (const [k, v] of Object.entries(allData.leaves)) { if (v.emp_id === emp.emp_id) await remove(ref(db, 'leaves/' + k)); }
    for (const [k, v] of Object.entries(allData.savings)) { if (v.emp_id === emp.emp_id) await remove(ref(db, 'savings/' + k)); }
    for (const [k, v] of Object.entries(allData.violations)) { if (v.emp_id === emp.emp_id) await remove(ref(db, 'violations/' + k)); }
    for (const [k, v] of Object.entries(allData.ratings)) { if (v.emp_id === emp.emp_id) await remove(ref(db, 'ratings/' + k)); }
  }
  showToast('Karyawan dihapus!', 'success');
};

window._hideModal = hideModal;

// --- RESET LEAVE QUOTA ---
window._resetLeaveQuota = async (empId, empName) => {
  if (!confirm(`Reset semua jatah cuti ${empName} untuk tahun ${new Date().getFullYear()}?\n\nSemua record izin/cuti yang sudah disetujui & menunggu di tahun ini akan dihapus, sehingga sisa cuti kembali penuh.`)) return;
  const currentYear = new Date().getFullYear();
  let deleted = 0;
  for (const [k, v] of Object.entries(allData.leaves)) {
    if (v.emp_id === empId && new Date(v.start_date).getFullYear() === currentYear) {
      await remove(ref(db, 'leaves/' + k));
      deleted++;
    }
  }
  showToast(`Jatah cuti ${empName} telah direset! (${deleted} record dihapus)`, 'success');
  hideModal();
};

// --- TRANSACTION CRUD ---
window._showTxnForm = (empId, type) => {
  const area = $('txn-form-' + empId); if (!area) return;
  area.innerHTML = `<div style="padding:0.75rem;background:var(--bg-color);border-radius:var(--radius-lg);margin-bottom:1rem;border:1px solid var(--border)">
    <p class="text-xs font-bold mb-2" style="color:${type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${type === 'debit' ? 'Tambah Debit' : 'Tambah Kredit'}</p>
    <input id="tf-amt" type="number" inputmode="numeric" class="form-input mb-2" placeholder="Jumlah (Rp)" style="font-size:0.85rem;padding:0.5rem">
    <input id="tf-date" type="date" value="${today()}" class="form-input mb-2" style="font-size:0.85rem;padding:0.5rem">
    <input id="tf-note" class="form-input mb-2" placeholder="Keterangan" style="font-size:0.85rem;padding:0.5rem">
    <div style="display:flex;gap:0.5rem">
      <button class="btn ${type === 'debit' ? 'btn-danger' : 'btn-primary'}" style="padding:0.5rem 1rem;font-size:0.75rem;${type === 'credit' ? 'background:var(--success)' : ''}" onclick="window._saveTxn('${empId}','${type}')">Simpan</button>
      <button class="btn btn-secondary" style="padding:0.5rem 1rem;font-size:0.75rem" onclick="document.getElementById('txn-form-${empId}').innerHTML=''">Batal</button>
    </div>
  </div>`;
};

window._saveTxn = async (empId, type) => {
  const amt = parseFloat($('tf-amt').value) || 0;
  const date = $('tf-date').value;
  const note = $('tf-note').value.trim();
  if (amt <= 0) { showToast('Jumlah harus > 0', 'error'); return; }

  if (type === 'credit' && !canAddCredit()) {
    showToast('Hanya Manajemen yang diizinkan menambahkan transaksi Kredit!', 'error');
    return;
  }
  if (type === 'debit' && !canAddDebit()) {
    showToast('Anda tidak memiliki akses untuk menambah Debit!', 'error');
    return;
  }

  if (type === 'credit' && amt > calcBalance(empId)) { showToast('Pembayaran melebihi hutang!', 'error'); return; }

  let addedBy = 'Manajemen';
  if (currentUser.role === 'employee') {
    addedBy = `${currentUser.name} (${currentUser.position})`;
  } else if (currentUser.name) {
    addedBy = currentUser.name;
  }

  await set(push(ref(db, 'transactions')), {
    emp_id: empId,
    type,
    amount: amt,
    date,
    note,
    added_by: addedBy,
    timestamp: Date.now()
  });

  showToast('Transaksi berhasil disimpan!', 'success');
};

window._deleteTxn = async (key) => { if (confirm('Hapus transaksi?')) { await remove(ref(db, 'transactions/' + key)); showToast('Dihapus!', 'success'); } };

// --- INTERNAL PRIVAT CHAT ---
function markInternalChatAsRead() {
  if (!currentUser) return;
  const rawChats = allData.internal_chats ? Object.values(allData.internal_chats) : [];
  if (rawChats.length === 0) return;

  let latestTs = 0;
  rawChats.forEach(c => { if ((c.timestamp || 0) > latestTs) latestTs = c.timestamp; });
  if (!latestTs) return;

  if (currentUser.role === 'admin') {
    const currentRead = allData.settings ? (allData.settings.lastRead_InternalChat_admin || 0) : 0;
    localStorage.setItem('mytic_lastread_chat_admin', latestTs);
    if (currentRead < latestTs) {
      if (allData.settings) allData.settings.lastRead_InternalChat_admin = latestTs;
      update(ref(db, 'settings'), { lastRead_InternalChat_admin: latestTs }).catch(console.error);
    }
  } else if (currentUser.id) {
    const emp = allData.users ? allData.users[currentUser.id] : null;
    const currentRead = emp ? (emp.lastRead_InternalChat || 0) : 0;
    localStorage.setItem(`mytic_lastread_chat_${currentUser.id}`, latestTs);
    if (currentRead < latestTs) {
      if (emp) emp.lastRead_InternalChat = latestTs;
      update(ref(db, `users/${currentUser.id}`), { lastRead_InternalChat: latestTs }).catch(console.error);
    }
  }
}

function getUnreadChatCount() {
  if (!currentUser) return 0;
  
  let lastRead = 0;
  if (currentUser.role === 'admin') {
    const fromDb = allData.settings ? allData.settings.lastRead_InternalChat_admin : 0;
    const fromLocal = parseInt(localStorage.getItem('mytic_lastread_chat_admin') || '0');
    lastRead = Math.max(fromDb || 0, fromLocal || 0);
  } else if (currentUser.id) {
    const emp = allData.users ? allData.users[currentUser.id] : null;
    const fromDb = emp ? emp.lastRead_InternalChat : 0;
    const fromLocal = parseInt(localStorage.getItem(`mytic_lastread_chat_${currentUser.id}`) || '0');
    lastRead = Math.max(fromDb || 0, fromLocal || 0);
  }

  const rawInternalChats = allData.internal_chats ? Object.values(allData.internal_chats) : [];
  return rawInternalChats.filter(c => {
    const isMe = (currentUser.role === 'employee' && c.sender_id === currentUser.id) || (currentUser.role === 'admin' && c.sender_role === 'Manajemen');
    return !isMe && (c.timestamp || 0) > lastRead;
  }).length;
}

function renderInternalChat() {
  markInternalChatAsRead();

  const chatEntries = allData.internal_chats ? Object.entries(allData.internal_chats) : [];
  const rawChats = chatEntries.map(([key, val]) => ({ ...val, _key: key }));
  rawChats.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  requestAnimationFrame(() => {
    const chatContainer = $('internal-chat-messages');
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
  });

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <div>
        <h3 class="text-xl font-bold">Diskusi Internal Privat</h3>
        <p class="text-xs text-muted">Ruang koordinasi khusus Manajemen, Admin, dan Supervisor SPBU Gontor</p>
      </div>
      <span class="badge badge-warning" style="display:flex;align-items:center;gap:0.3rem">🔒 Rahasia / Internal Only</span>
    </div>

    <div class="card" style="padding:1rem;display:flex;flex-direction:column;height:calc(100vh - 220px);min-height:450px;">
      <div id="internal-chat-messages" style="flex:1;overflow-y:auto;padding-right:0.5rem;margin-bottom:1rem;display:flex;flex-direction:column;gap:0.75rem;">
        ${rawChats.length === 0 ? '<div style="margin:auto;text-align:center;" class="text-muted"><p class="text-sm">Belum ada pesan dalam diskusi ini.</p><span class="text-xs">Mulai percakapan dengan mengetik pesan di bawah.</span></div>' :
          rawChats.map(c => {
            const isMe = (currentUser.role === 'employee' && c.sender_id === currentUser.id) || (currentUser.role === 'admin' && c.sender_role === 'Manajemen');
            const canDelete = currentUser.role === 'admin' || isMe;
            const bubbleBg = isMe ? 'var(--primary)' : 'var(--bg-color)';
            const textColor = isMe ? '#ffffff' : 'var(--text-main)';
            const alignSelf = isMe ? 'flex-end' : 'flex-start';
            const borderRadius = isMe ? '16px 16px 2px 16px' : '16px 16px 16px 2px';

            return `<div style="align-self:${alignSelf};max-width:80%;display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'}">
              <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.2rem;display:flex;gap:0.4rem;align-items:center;">
                <strong style="color:var(--text-main)">${esc(c.sender_name)}</strong>
                <span class="badge badge-info" style="font-size:0.6rem;padding:0.1rem 0.35rem">${esc(c.sender_role)}</span>
                <span>${fmtDate(c.timestamp || Date.now())}</span>
                ${canDelete ? `<button style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:0.7rem;margin-left:0.2rem;padding:0 0.2rem;" onclick="window._deleteInternalChat('${c._key}')" title="Hapus Pesan">✕</button>` : ''}
              </div>
              <div style="background:${bubbleBg};color:${textColor};padding:0.65rem 0.9rem;border-radius:${borderRadius};font-size:0.85rem;line-height:1.4;box-shadow:0 2px 5px rgba(0,0,0,0.05);word-break:break-word;">
                ${esc(c.message)}
              </div>
            </div>`;
          }).join('')}
      </div>

      <div style="display:flex;align-items:center;gap:0.5rem;border-top:1px solid var(--border);padding-top:0.75rem;width:100%;">
        <input type="text" id="inp-internal-chat" class="form-input" placeholder="Tulis pesan diskusi..." style="flex:1;width:100%;font-size:0.88rem;padding:0.65rem 1rem;border-radius:var(--radius-lg);" onkeypress="if(event.key==='Enter') window._sendInternalChat()">
        <button class="btn btn-primary" onclick="window._sendInternalChat()" title="Kirim Pesan" style="width:42px;height:42px;min-width:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0;box-shadow:0 4px 12px var(--primary-shadow, rgba(0,0,0,0.2));">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform: translateX(1px);"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  </div>`;
}

window._sendInternalChat = async () => {
  const inp = $('inp-internal-chat');
  if (!inp) return;
  const msg = inp.value.trim();
  if (!msg) return;

  let senderId = 'admin';
  let senderName = 'Manajemen';
  let senderRole = 'Manajemen';

  if (currentUser && currentUser.role === 'employee') {
    senderId = currentUser.id;
    senderName = currentUser.name;
    senderRole = currentUser.position || 'Supervisor';
  }

  inp.value = '';
  inp.focus();

  await set(push(ref(db, 'internal_chats')), {
    sender_id: senderId,
    sender_name: senderName,
    sender_role: senderRole,
    message: msg,
    timestamp: Date.now()
  });
};

window._deleteInternalChat = async (key) => {
  if (!key) return;
  if (confirm('Hapus pesan diskusi ini?')) {
    await remove(ref(db, `internal_chats/${key}`));
    showToast('Pesan berhasil dihapus!', 'success');
  }
};

// --- LEAVE CRUD ---
window._updateLeaveStatus = async (key, status) => {
  await update(ref(db, 'leaves/' + key), { status, timestamp: Date.now() });
  showToast('Status diperbarui!', 'success');
};
window._deleteLeave = async (key) => { if (confirm('Hapus pengajuan?')) { await remove(ref(db, 'leaves/' + key)); showToast('Dihapus!', 'success'); } };

window._showLeaveChat = (key, role) => {
  const l = allData.leaves[key];
  if (!l) return;

  // Mark as read in Firebase and local state
  const readField = role === 'Manajemen' ? 'lastRead_Manajemen' : 'lastRead_Karyawan';
  const now = Date.now();
  update(ref(db, `leaves/${key}`), { [readField]: now });
  l[readField] = now;
  if (currentUser) setupNavigation();

  const chats = l.chats ? Object.values(l.chats) : [];
  chats.sort((a, b) => a.timestamp - b.timestamp);

  let chatHTML = chats.length === 0 ? '<p class="text-muted text-center" style="margin-top:2rem">Belum ada pesan. Mulai diskusi di bawah.</p>' :
    chats.map(c => {
      const isMe = c.role === role;
      return `<div style="display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 0.75rem;">
        <span class="text-xs text-muted" style="margin-bottom:0.25rem">${esc(c.senderName)} • ${new Date(c.timestamp).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
        <div style="background:${isMe ? 'var(--primary)' : 'var(--bg-color)'}; color:${isMe ? '#fff' : 'var(--text)'}; padding:0.5rem 0.75rem; border-radius: var(--radius-md); max-width:85%; font-size:0.85rem; border: 1px solid ${isMe ? 'var(--primary)' : 'var(--border)'};">
          ${esc(c.message)}
        </div>
      </div>`;
    }).join('');

  showModal(`<div class="modal-header" style="border-bottom:1px solid var(--border);"><h3 class="modal-title">💬 Diskusi Pengajuan</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body" style="padding:0; display:flex; flex-direction:column;">
      <div id="leave-chat-box" style="height: 350px; overflow-y: auto; padding: 1rem; background: var(--surface);">
        ${chatHTML}
      </div>
      <div style="padding: 1rem; border-top: 1px solid var(--border); display:flex; gap:0.5rem; background: var(--surface);">
        <input type="text" id="leave-chat-input" class="form-input" placeholder="Ketik pesan..." style="flex:1;" onkeypress="if(event.key==='Enter') window._sendLeaveChat('${key}', '${role}')">
        <button class="btn btn-primary" onclick="window._sendLeaveChat('${key}', '${role}')">Kirim</button>
      </div>
    </div>`);

  setTimeout(() => {
    const box = $('leave-chat-box');
    if (box) box.scrollTop = box.scrollHeight;
    const inp = $('leave-chat-input');
    if (inp) inp.focus();
  }, 100);
};

window._sendLeaveChat = async (key, role) => {
  const inp = $('leave-chat-input');
  if (!inp) return;
  const msg = inp.value.trim();
  if (!msg) return;

  const senderName = role === 'Manajemen' ? 'Manajemen' : (getUserByUsername(currentUser.username)?.name || 'Karyawan');
  const now = Date.now();
  const readField = role === 'Manajemen' ? 'lastRead_Manajemen' : 'lastRead_Karyawan';

  inp.disabled = true;
  await set(push(ref(db, `leaves/${key}/chats`)), {
    senderName,
    role,
    message: msg,
    timestamp: now
  });
  await update(ref(db, `leaves/${key}`), { [readField]: now });
  if (allData.leaves[key]) allData.leaves[key][readField] = now;

  inp.disabled = false;
  inp.value = '';
  window._showLeaveChat(key, role);
};
window._showEmpLeaveForm = () => {
  const emp = getUserByUsername(currentUser.username); if (!emp) return;
  const area = $('emp-leave-form-area'); if (!area) return;
  const types = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--primary)">
    <h3 class="card-title mb-4">Ajukan Izin/Cuti</h3>
    <div class="form-group"><label class="form-label">Jenis</label><select id="lf-type" class="form-input form-select">
      <option value="Izin">Izin (Umum)</option>
      ${types.map(t => `<option value="${esc(t.name)}">${esc(t.name)} (${t.quota} hari)</option>`).join('')}
    </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="form-group"><label class="form-label">Mulai</label><input id="lf-start" type="date" class="form-input" value="${today()}"></div>
      <div class="form-group"><label class="form-label">Selesai</label><input id="lf-end" type="date" class="form-input" value="${today()}"></div>
    </div>
    <div class="form-group"><label class="form-label">Alasan</label><textarea id="lf-reason" class="form-input" rows="2" placeholder="Jelaskan alasan..."></textarea></div>
    <div style="display:flex;gap:0.75rem">
      <button class="btn btn-primary" onclick="window._saveEmpLeave()">Ajukan</button>
      <button class="btn btn-secondary" onclick="document.getElementById('emp-leave-form-area').innerHTML=''">Batal</button>
    </div>
  </div>`;
};

window._saveEmpLeave = async () => {
  const emp = getUserByUsername(currentUser.username); if (!emp) return;
  const leaveType = $('lf-type').value;
  const startDate = $('lf-start').value;
  const endDate = $('lf-end').value;
  const reason = $('lf-reason').value.trim();
  if (!startDate || !endDate) { showToast('Tanggal wajib diisi!', 'error'); return; }

  const d1 = new Date(startDate);
  const d2 = new Date(endDate);
  if (d2 < d1) { showToast('Tanggal selesai harus setelah atau sama dengan mulai!', 'error'); return; }
  const requestedDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;

  if (leaveType !== 'Izin') {
    const types = getLeaveTypes();
    const typeObj = types.find(t => t.name === leaveType);
    if (typeObj && typeObj.quota > 0) {
      const currentYear = new Date().getFullYear();
      const userLeaves = getLeaves(emp.emp_id).filter(l => l.leave_type === leaveType && l.status !== 'Ditolak' && new Date(l.start_date).getFullYear() === currentYear);
      let takenDays = 0;
      userLeaves.forEach(l => {
        const ld1 = new Date(l.start_date);
        const ld2 = new Date(l.end_date);
        takenDays += Math.round((ld2 - ld1) / (1000 * 60 * 60 * 24)) + 1;
      });
      if (takenDays + requestedDays > typeObj.quota) {
        showToast(`Jatah ${leaveType} tidak cukup! (Sisa: ${typeObj.quota - takenDays} hari)`, 'error');
        return;
      }
    }
  }

  await set(push(ref(db, 'leaves')), { emp_id: emp.emp_id, emp_name: emp.name, leave_type: leaveType, start_date: startDate, end_date: endDate, reason, status: 'Menunggu', date: today(), timestamp: Date.now() });
  showToast('Pengajuan berhasil!', 'success');
  $('emp-leave-form-area').innerHTML = '';
};

window._editEmpLeaveForm = (key) => {
  const l = allData.leaves[key];
  if (!l || l.status !== 'Menunggu') return;
  const emp = getUserByUsername(currentUser.username); if (!emp) return;
  const area = $('emp-leave-form-area'); if (!area) return;
  const types = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === emp.gender);
  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--warning)">
    <h3 class="card-title mb-4">Edit Pengajuan Izin/Cuti</h3>
    <div class="form-group"><label class="form-label">Jenis</label><select id="lf-type-edit" class="form-input form-select">
      <option value="Izin" ${l.leave_type === 'Izin' ? 'selected' : ''}>Izin (Umum)</option>
      ${types.map(t => `<option value="${esc(t.name)}" ${l.leave_type === t.name ? 'selected' : ''}>${esc(t.name)} (${t.quota} hari)</option>`).join('')}
    </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="form-group"><label class="form-label">Mulai</label><input id="lf-start-edit" type="date" class="form-input" value="${l.start_date}"></div>
      <div class="form-group"><label class="form-label">Selesai</label><input id="lf-end-edit" type="date" class="form-input" value="${l.end_date}"></div>
    </div>
    <div class="form-group"><label class="form-label">Alasan</label><textarea id="lf-reason-edit" class="form-input" rows="2" placeholder="Jelaskan alasan...">${esc(l.reason || '')}</textarea></div>
    <div style="display:flex;gap:0.75rem">
      <button class="btn btn-warning" onclick="window._updateEmpLeave('${key}')">Perbarui</button>
      <button class="btn btn-secondary" onclick="document.getElementById('emp-leave-form-area').innerHTML=''">Batal</button>
    </div>
  </div>`;
  // Scroll to the edit form area smoothly
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window._updateEmpLeave = async (key) => {
  const l = allData.leaves[key];
  if (!l || l.status !== 'Menunggu') return;
  const emp = getUserByUsername(currentUser.username); if (!emp) return;

  const leaveType = $('lf-type-edit').value;
  const startDate = $('lf-start-edit').value;
  const endDate = $('lf-end-edit').value;
  const reason = $('lf-reason-edit').value.trim();

  if (!startDate || !endDate) { showToast('Tanggal wajib diisi!', 'error'); return; }

  const d1 = new Date(startDate);
  const d2 = new Date(endDate);
  if (d2 < d1) { showToast('Tanggal selesai harus setelah atau sama dengan mulai!', 'error'); return; }
  const requestedDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;

  if (leaveType !== 'Izin') {
    const types = getLeaveTypes();
    const typeObj = types.find(t => t.name === leaveType);
    if (typeObj && typeObj.quota > 0) {
      const currentYear = new Date().getFullYear();
      // Exclude the current leave request being edited from the taken count
      const userLeaves = getLeaves(emp.emp_id).filter(leave => leave._key !== key && leave.leave_type === leaveType && leave.status !== 'Ditolak' && new Date(leave.start_date).getFullYear() === currentYear);
      let takenDays = 0;
      userLeaves.forEach(leave => {
        const ld1 = new Date(leave.start_date);
        const ld2 = new Date(leave.end_date);
        takenDays += Math.round((ld2 - ld1) / (1000 * 60 * 60 * 24)) + 1;
      });
      if (takenDays + requestedDays > typeObj.quota) {
        showToast(`Jatah ${leaveType} tidak cukup! (Sisa: ${typeObj.quota - takenDays} hari)`, 'error');
        return;
      }
    }
  }

  await update(ref(db, 'leaves/' + key), { leave_type: leaveType, start_date: startDate, end_date: endDate, reason });
  showToast('Pengajuan diperbarui!', 'success');
  $('emp-leave-form-area').innerHTML = '';
};


// --- LEAVE TYPE CRUD ---
window._showLeaveTypeForm = (key) => {
  const lt = key ? (() => { const v = allData.leave_types[key]; return v ? { ...v, _key: key } : null; })() : null;
  const area = $('lt-form-area'); if (!area) return;
  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--primary)">
    <h3 class="card-title mb-4">${lt ? 'Edit' : 'Tambah'} Jenis Cuti</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem">
      <div class="form-group"><label class="form-label">Nama Jenis Cuti</label><input id="ltf-name" class="form-input" value="${esc(lt?.name || '')}"></div>
      <div class="form-group"><label class="form-label">Jatah (hari)</label><input id="ltf-quota" type="number" class="form-input" value="${lt?.quota || ''}"></div>
      <div class="form-group"><label class="form-label">Jenis Kelamin</label><select id="ltf-gender" class="form-input form-select">
        <option value="Semua" ${lt?.gender === 'Semua' ? 'selected' : ''}>Semua</option>
        <option value="Laki-Laki" ${lt?.gender === 'Laki-Laki' ? 'selected' : ''}>Laki-Laki</option>
        <option value="Perempuan" ${lt?.gender === 'Perempuan' ? 'selected' : ''}>Perempuan</option>
      </select></div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:0.5rem">
      <button class="btn btn-primary" onclick="window._saveLeaveType('${key || ''}')">${lt ? 'Perbarui' : 'Simpan'}</button>
      <button class="btn btn-secondary" onclick="document.getElementById('lt-form-area').innerHTML=''">Batal</button>
    </div>
  </div>`;
};
window._saveLeaveType = async (key) => {
  const name = $('ltf-name').value.trim();
  const quota = parseInt($('ltf-quota').value) || 0;
  const gender = $('ltf-gender').value;
  if (!name) { showToast('Nama wajib diisi!', 'error'); return; }
  if (key) await update(ref(db, 'leave_types/' + key), { name, quota, gender });
  else await set(push(ref(db, 'leave_types')), { name, quota, gender });
  showToast('Jenis cuti disimpan!', 'success');
  $('lt-form-area').innerHTML = '';
};
window._deleteLeaveType = async (key) => { if (confirm('Hapus jenis cuti ini?')) { await remove(ref(db, 'leave_types/' + key)); showToast('Dihapus!', 'success'); } };

// --- VIOLATION CRUD ---
window._showVioForm = (empId) => {
  const area = $('vio-form-' + empId); if (!area) return;
  area.innerHTML = `<div style="padding:0.75rem;background:var(--danger-bg);border-radius:var(--radius-lg);margin-bottom:1rem;border:1px solid var(--danger)">
    <p class="text-xs font-bold mb-2" style="color:var(--danger)">Tambah Pelanggaran</p>
    <input id="vf-type" class="form-input mb-2" placeholder="Jenis pelanggaran" style="font-size:0.85rem;padding:0.5rem">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.5rem">
      <select id="vf-cat" class="form-input form-select" style="font-size:0.85rem;padding:0.5rem"><option>Ringan</option><option>Sedang</option><option>Berat</option></select>
      <select id="vf-level" class="form-input form-select" style="font-size:0.85rem;padding:0.5rem"><option>Peringatan</option><option>SP1</option><option>SP2</option><option>SP3</option></select>
    </div>
    <textarea id="vf-desc" class="form-input mb-2" rows="2" placeholder="Keterangan" style="font-size:0.85rem;padding:0.5rem"></textarea>
    <input id="vf-date" type="date" value="${today()}" class="form-input mb-2" style="font-size:0.85rem;padding:0.5rem">
    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-danger" style="padding:0.5rem 1rem;font-size:0.75rem" onclick="window._saveVio('${empId}')">Simpan</button>
      <button class="btn btn-secondary" style="padding:0.5rem 1rem;font-size:0.75rem" onclick="document.getElementById('vio-form-${empId}').innerHTML=''">Batal</button>
    </div>
  </div>`;
};
window._saveVio = async (empId) => {
  const vType = $('vf-type').value.trim();
  const desc = $('vf-desc').value.trim();
  if (!vType || !desc) { showToast('Jenis dan keterangan wajib!', 'error'); return; }
  await set(push(ref(db, 'violations')), { emp_id: empId, violation_type: vType, category: $('vf-cat').value, level: $('vf-level').value, description: desc, date: $('vf-date').value, status: 'Berlaku', timestamp: Date.now() });
  showToast('Pelanggaran dicatat!', 'success');
};
window._deleteVio = async (key) => { if (confirm('Hapus?')) { await remove(ref(db, 'violations/' + key)); showToast('Dihapus!', 'success'); } };

// --- SAVING CRUD ---
window._showSavingForm = (empId) => {
  const area = $('sav-form-' + empId); if (!area) return;
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const now = new Date();
  const curMonthIdx = now.getMonth();
  const curYear = now.getFullYear();
  const years = [curYear - 1, curYear, curYear + 1];
  let monthOptions = '';
  years.forEach(y => {
    months.forEach((m, i) => {
      const isSel = (i === curMonthIdx && y === curYear);
      monthOptions += `<option value="${m} ${y}" ${isSel ? 'selected' : ''}>${m} ${y}</option>`;
    });
  });

  area.innerHTML = `<div style="padding:0.85rem;background:var(--success-bg);border-radius:var(--radius-lg);margin-bottom:1rem;border:1px solid var(--success)">
    <p class="text-xs font-bold mb-3" style="color:#065F46;font-size:0.85rem;">💳 Tambah Transaksi Tabungan</p>
    
    <div style="margin-bottom:0.65rem;">
      <label class="form-label" style="font-size:0.72rem;font-weight:700;color:#065F46;margin-bottom:0.2rem;display:block;">1. Jumlah Nominal (Rp)</label>
      <input id="sf-amt" type="number" inputmode="numeric" class="form-input mb-1" placeholder="Masukkan jumlah Rp..." style="font-size:0.85rem;padding:0.45rem;">
    </div>

    <div style="margin-bottom:0.65rem;">
      <label class="form-label" style="font-size:0.72rem;font-weight:700;color:#065F46;margin-bottom:0.2rem;display:block;">2. Tabungan Bulan Apa (Bulan & Tahun)</label>
      <select id="sf-month" class="form-input form-select mb-1" style="font-size:0.85rem;padding:0.45rem;width:100%;">${monthOptions}</select>
    </div>

    <div style="margin-bottom:0.85rem;">
      <label class="form-label" style="font-size:0.72rem;font-weight:700;color:#065F46;margin-bottom:0.2rem;display:block;">3. Tanggal Transaksi / Pengambilan</label>
      <input id="sf-date" type="date" value="${today()}" class="form-input mb-1" style="font-size:0.85rem;padding:0.45rem;width:100%;">
    </div>

    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-primary" style="padding:0.45rem 1.1rem;font-size:0.75rem;background:var(--success)" onclick="window._saveSaving('${empId}')">Simpan</button>
      <button class="btn btn-secondary" style="padding:0.45rem 1.1rem;font-size:0.75rem" onclick="document.getElementById('sav-form-${empId}').innerHTML=''">Batal</button>
    </div>
  </div>`;
};
window._saveSaving = async (empId) => {
  const amt = parseFloat($('sf-amt').value) || 0;
  const dateVal = $('sf-date').value || today();
  if (amt <= 0) { showToast('Jumlah harus > 0', 'error'); return; }

  const mStr = $('sf-month').value.trim();
  const tabMonth = dateVal.substring(0, 7);
  const nextPayrollMonth = getNextMonthStr(tabMonth);

  const newRef = push(ref(db, 'savings'));
  const newKey = newRef.key;
  const newRecord = { emp_id: empId, amount: amt, month: mStr, date: dateVal, timestamp: Date.now() };

  allData.savings = allData.savings || {};
  allData.savings[newKey] = newRecord;

  const totalTab = getEmployeeSavingsForMonth(empId, tabMonth);

  allData.payroll = allData.payroll || {};
  allData.payroll[nextPayrollMonth] = allData.payroll[nextPayrollMonth] || {};
  allData.payroll[nextPayrollMonth].internal_data = allData.payroll[nextPayrollMonth].internal_data || {};
  allData.payroll[nextPayrollMonth].internal_data[empId] = allData.payroll[nextPayrollMonth].internal_data[empId] || {};
  allData.payroll[nextPayrollMonth].internal_data[empId].savings_deduction = totalTab;

  const updates = {};
  updates[`savings/${newKey}`] = newRecord;
  updates[`payroll/${nextPayrollMonth}/internal_data/${empId}/savings_deduction`] = totalTab;

  await update(ref(db), updates);

  showToast('Tabungan disimpan & otomatis terisi ke Gaji Payroll!', 'success');
  $('sav-form-' + empId).innerHTML = '';
  renderCurrentSection();
};

window._showMassSavingForm = () => {
  const area = $('mass-sav-form-area'); if (!area) return;
  const users = getUsers();
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const now = new Date();
  const curMonthIdx = now.getMonth();
  const curYear = now.getFullYear();
  const monthOptions = months.map((m, i) => `<option value="${m} ${curYear}" ${i === curMonthIdx ? 'selected' : ''}>${m} ${curYear}</option>`).join('');
  area.innerHTML = `<div class="card mb-4" style="background:var(--success-bg);border:1px solid var(--success)">
    <h3 class="card-title mb-4" style="color:#065F46">Input Tabungan Massal</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem">
      <div class="form-group"><label class="form-label">Jumlah (Rp)</label><input id="msf-amt" type="number" inputmode="numeric" class="form-input" placeholder="Misal: 50000"></div>
      <div class="form-group"><label class="form-label">Bulan</label><select id="msf-month" class="form-input form-select">${monthOptions}</select></div>
      <div class="form-group"><label class="form-label">Tanggal</label><input id="msf-date" type="date" class="form-input" value="${today()}"></div>
    </div>
    <div class="form-group">
      <label class="form-label" style="display:flex;justify-content:space-between"><span>Pilih Karyawan</span><label style="cursor:pointer;font-weight:normal"><input type="checkbox" onchange="document.querySelectorAll('.msf-emp-cb').forEach(c=>c.checked=this.checked)"> Pilih Semua</label></label>
      <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;background:var(--bg-color)">
        ${users.map(u => `<label style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;cursor:pointer"><input type="checkbox" class="msf-emp-cb" value="${u.emp_id}"> <strong>${esc(u.name)}</strong> (${esc(u.position)})</label>`).join('')}
      </div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:1rem">
      <button class="btn btn-primary" style="background:var(--success)" onclick="window._saveMassSaving()">Simpan Massal</button>
      <button class="btn btn-secondary" onclick="document.getElementById('mass-sav-form-area').innerHTML=''">Batal</button>
    </div>
  </div>`;
};

window._saveMassSaving = async () => {
  const amt = parseFloat($('msf-amt').value) || 0;
  const month = $('msf-month').value.trim();
  const dateVal = $('msf-date').value || today();
  const cbs = document.querySelectorAll('.msf-emp-cb:checked');

  if (amt <= 0) { showToast('Jumlah harus > 0', 'error'); return; }
  if (!month || !dateVal) { showToast('Bulan dan tanggal wajib diisi!', 'error'); return; }
  if (cbs.length === 0) { showToast('Pilih minimal 1 karyawan!', 'error'); return; }

  const tabMonth = dateVal.substring(0, 7);
  const nextPayrollMonth = getNextMonthStr(tabMonth);
  allData.payroll = allData.payroll || {};
  allData.payroll[nextPayrollMonth] = allData.payroll[nextPayrollMonth] || {};
  allData.payroll[nextPayrollMonth].internal_data = allData.payroll[nextPayrollMonth].internal_data || {};

  const dbUpdates = {};

  for (const cb of cbs) {
    const empId = cb.value;
    const newRefKey = push(ref(db, 'savings')).key;
    const newRecord = { emp_id: empId, amount: amt, month, date: dateVal, timestamp: Date.now() };

    allData.savings = allData.savings || {};
    allData.savings[newRefKey] = newRecord;
    dbUpdates[`savings/${newRefKey}`] = newRecord;

    const totalTab = getEmployeeSavingsForMonth(empId, tabMonth);

    allData.payroll[nextPayrollMonth].internal_data[empId] = allData.payroll[nextPayrollMonth].internal_data[empId] || {};
    allData.payroll[nextPayrollMonth].internal_data[empId].savings_deduction = totalTab;

    dbUpdates[`payroll/${nextPayrollMonth}/internal_data/${empId}/savings_deduction`] = totalTab;
  }

  showToast(cbs.length + ' tabungan berhasil disimpan & terisi ke Gaji Payroll!', 'success');
  $('mass-sav-form-area').innerHTML = '';
  renderCurrentSection();
  await update(ref(db), dbUpdates);
};
window._deleteSaving = async (key) => { if (confirm('Hapus?')) { await remove(ref(db, 'savings/' + key)); showToast('Dihapus!', 'success'); } };

// --- RATING CRUD ---
window._showRatingForm = (editKey = null) => {
  window._editingRatingKey = editKey;
  const users = getUsers();
  const criteria = getCriteria();
  if (users.length === 0) { showToast('Tambahkan karyawan dulu!', 'warning'); return; }
  if (criteria.length === 0) { showToast('Buat kriteria penilaian dulu!', 'warning'); return; }

  const rating = editKey ? (allData.ratings[editKey] || null) : null;
  const modalTitle = rating ? 'Edit Penilaian Kinerja' : 'Tambah Penilaian Kinerja';
  const selectedEmpId = rating ? rating.emp_id : (users[0] ? users[0].emp_id : '');
  const selectedDate = rating ? rating.date : today().substring(0, 7);
  const noteVal = rating ? (rating.note || '') : '';

  showModal(`<div class="modal-header"><h3 class="modal-title">${modalTitle}</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Pilih Karyawan</label><select id="rf-emp" class="form-input form-select" onchange="window._updateRatingCriteria()">${users.map(u => `<option value="${u.emp_id}" data-pos="${esc(u.position)}" ${u.emp_id === selectedEmpId ? 'selected' : ''}>${esc(u.name)} (${esc(u.position)})</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Bulan Penilaian</label><input id="rf-date" type="month" value="${selectedDate}" class="form-input" onchange="window._updateRatingCriteria()"></div>
      <div id="rf-dup-warning"></div>
      <div id="rf-criteria-container"></div>
      <div class="form-group mt-4"><label class="form-label">Catatan & Evaluasi Manajemen</label><textarea id="rf-note" class="form-input" rows="2" placeholder="Catatan tambahan...">${esc(noteVal)}</textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="window._saveRating()">${rating ? 'Simpan Perubahan' : 'Simpan Penilaian'}</button><button class="btn btn-secondary" onclick="window._hideModal()">Batal</button></div>`, 'modal-lg');

  window._updateRatingCriteria(rating ? rating.scores : null);
};

window._updateRatingCriteria = (existingScores = null) => {
  const empSelect = $('rf-emp');
  if (!empSelect) return;
  const selectedOption = empSelect.options[empSelect.selectedIndex];
  if (!selectedOption) return;
  const pos = selectedOption.getAttribute('data-pos');

  const empId = empSelect.value;
  const dateVal = $('rf-date') ? $('rf-date').value.substring(0, 7) : '';
  const warnContainer = $('rf-dup-warning');
  if (warnContainer) {
    const existing = getRatings().filter(r => r.emp_id === empId && (r.date || '').substring(0, 7) === dateVal && r._key !== window._editingRatingKey);
    if (existing.length > 0) {
      warnContainer.innerHTML = `<div style="background:#fee2e2; border:1px solid #ef4444; color:#991b1b; padding:0.6rem 0.8rem; border-radius:6px; font-size:0.8rem; font-weight:700; margin-bottom:1rem;">⚠️ PERHATIAN: Karyawan ini sudah memiliki penilaian lain di periode ${dateVal}.</div>`;
    } else {
      warnContainer.innerHTML = '';
    }
  }

  const posCriteria = getCriteria(pos);
  const grouped = {};
  posCriteria.forEach(c => {
    const ind = c.indicator || 'Umum';
    if (!grouped[ind]) grouped[ind] = [];
    grouped[ind].push(c);
  });

  const container = $('rf-criteria-container');
  if (!container) return;

  if (posCriteria.length === 0) {
    container.innerHTML = '<p class="text-muted text-sm italic py-2">Tidak ada kriteria untuk jabatan ini.</p>';
    return;
  }

  let html = '<p class="form-label mt-2">Skor Kriteria (1-5)</p>';
  Object.keys(grouped).forEach(ind => {
    html += `<div style="margin-top:0.75rem;background:var(--surface);color:var(--text-main);padding:0.85rem;border-radius:var(--radius-md);border:1px solid var(--border)">
      <h5 style="font-size:0.85rem;font-weight:700;color:var(--primary);margin-bottom:0.75rem;text-transform:uppercase">${esc(ind)}</h5>`;

    grouped[ind].forEach(c => {
      const savedVal = existingScores ? (existingScores[c._key] || 3) : 3;
      html += `<div style="display:flex;flex-direction:column;gap:0.6rem;padding:0.6rem 0;border-bottom:1px solid var(--border)">
        <span class="text-sm font-semibold" style="flex:1;color:var(--text-main);">${esc(c.name)}</span>
        <input type="hidden" class="rf-score" data-key="${c._key}" id="score-${c._key}" value="${savedVal}">
        <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:0.2rem;" id="rating-group-${c._key}">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="rating-btn rating-btn-${n} ${n === savedVal ? 'active' : ''}" onclick="_setRating('${c._key}', ${n})">${n}</button>`).join('')}
        </div>
      </div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
};

window._setRating = (key, val) => {
  const input = $('score-' + key);
  if (input) input.value = val;

  const group = $('rating-group-' + key);
  if (group) {
    group.querySelectorAll('.rating-btn').forEach(btn => {
      const btnVal = parseInt(btn.textContent);
      if (btnVal === val) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
};

window._saveRating = async () => {
  const empId = $('rf-emp').value;
  const date = $('rf-date').value;
  const note = $('rf-note').value.trim();

  if (!empId || !date) {
    showToast('Pilih karyawan dan bulan penilaian!', 'error');
    return;
  }

  const targetMonth = date.substring(0, 7);
  const existing = getRatings().filter(r => r.emp_id === empId && (r.date || '').substring(0, 7) === targetMonth && r._key !== window._editingRatingKey);
  if (existing.length > 0) {
    const emp = getUserByEmpId(empId);
    const empName = emp ? emp.name : empId;
    showToast(`DITOLAK: ${empName} sudah memiliki penilaian lain untuk periode ${targetMonth}!`, 'error');
    return;
  }

  const scores = {};
  document.querySelectorAll('.rf-score').forEach(el => { scores[el.dataset.key] = Math.min(5, Math.max(1, parseInt(el.value) || 1)); });

  if (window._editingRatingKey) {
    await set(ref(db, 'ratings/' + window._editingRatingKey), { emp_id: empId, date, scores, note, timestamp: Date.now() });
    showToast('Penilaian berhasil diperbarui!', 'success');
    window._editingRatingKey = null;
  } else {
    await set(push(ref(db, 'ratings')), { emp_id: empId, date, scores, note, timestamp: Date.now() });
    showToast('Penilaian disimpan!', 'success');
  }
  hideModal();
};

window._viewRatingDetail = (key) => {
  const rating = allData.ratings[key];
  if (!rating) {
    showToast('Data penilaian tidak ditemukan!', 'error');
    return;
  }
  const emp = getUserByEmpId(rating.emp_id);
  const empName = emp ? emp.name : rating.emp_id;
  const empPos = emp ? emp.position : '-';
  const overallAvg = rating.scores ? (Object.values(rating.scores).reduce((s, v) => s + v, 0) / Object.values(rating.scores).length).toFixed(1) : '0';
  const color = overallAvg >= 4.5 ? 'var(--success)' : overallAvg >= 3.5 ? 'var(--info)' : overallAvg >= 2.5 ? 'var(--warning)' : 'var(--danger)';

  // Group criteria by Indicator name and calculate AVERAGE per Indicator
  const posCriteria = getCriteria(empPos);
  const groupedIndicatorScores = {};

  posCriteria.forEach(c => {
    const indName = c.indicator || 'Umum';
    if (!groupedIndicatorScores[indName]) {
      groupedIndicatorScores[indName] = { sum: 0, count: 0 };
    }
    const scoreVal = rating.scores ? Number(rating.scores[c._key] || 0) : 0;
    if (scoreVal > 0) {
      groupedIndicatorScores[indName].sum += scoreVal;
      groupedIndicatorScores[indName].count += 1;
    }
  });

  // Fallback if position match criteria is empty
  if (Object.keys(groupedIndicatorScores).length === 0 && rating.scores) {
    const allCriteria = getCriteria();
    Object.keys(rating.scores).forEach(key => {
      const c = allCriteria.find(x => x._key === key);
      const indName = c ? (c.indicator || 'Umum') : 'Umum';
      if (!groupedIndicatorScores[indName]) {
        groupedIndicatorScores[indName] = { sum: 0, count: 0 };
      }
      const scoreVal = Number(rating.scores[key] || 0);
      if (scoreVal > 0) {
        groupedIndicatorScores[indName].sum += scoreVal;
        groupedIndicatorScores[indName].count += 1;
      }
    });
  }

  let indicatorRowsHtml = '';
  Object.keys(groupedIndicatorScores).forEach(indName => {
    const item = groupedIndicatorScores[indName];
    const indAvg = item.count > 0 ? (item.sum / item.count).toFixed(1) : '0';
    const numAvg = parseFloat(indAvg);
    const indColor = numAvg >= 4.5 ? '#10b981' : numAvg >= 3.5 ? '#3b82f6' : numAvg >= 2.5 ? '#f59e0b' : '#ef4444';
    const filledStars = '⭐'.repeat(Math.round(numAvg));
    const percentBar = (numAvg / 5) * 100;

    indicatorRowsHtml += `
    <div style="margin-top:0.75rem; background:var(--surface); padding:0.9rem 1rem; border-radius:var(--radius-md); border:1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
        <span style="font-size:0.85rem; font-weight:800; color:var(--text-main); text-transform:uppercase;">${esc(indName)}</span>
        <span style="font-size:1.1rem; font-weight:900; color:${indColor};">${indAvg} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">/ 5.0</span></span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem;">
        <div style="flex:1; background:rgba(148, 163, 184, 0.2); height:7px; border-radius:10px; overflow:hidden;">
          <div style="width:${percentBar}%; background:${indColor}; height:100%; border-radius:10px; transition:width 0.3s ease;"></div>
        </div>
        <span style="font-size:0.8rem;">${filledStars}</span>
      </div>
    </div>`;
  });

  const isAdminOrMgr = currentUser && ['admin', 'manager', 'supervisor', 'spv'].includes((currentUser.role || '').toLowerCase());

  showModal(`<div class="modal-header"><h3 class="modal-title">👁️ Rincian Rata-Rata Penilaian Kinerja</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body">
      <div style="display:flex; justify-content:space-between; align-items:center; padding:1rem; background:var(--surface); border-radius:8px; border:1px solid var(--border); margin-bottom:1rem;">
        <div>
          <h4 style="font-size:1.1rem; font-weight:800; color:var(--text-main); margin:0;">${esc(empName)}</h4>
          <span style="font-size:0.8rem; color:var(--text-muted);">${esc(empPos)} • Periode: <strong>${fmtMonthYear(rating.date)}</strong></span>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.8rem; font-weight:900; color:${color}; line-height:1;">${overallAvg} <span style="font-size:0.9rem; color:var(--text-muted); font-weight:normal;">/ 5.0</span></div>
          <span style="font-size:0.75rem; font-weight:700; color:var(--text-muted);">Nilai Total Rata-Rata</span>
        </div>
      </div>

      <div style="font-size:0.8rem; font-weight:800; color:var(--primary); text-transform:uppercase; margin-bottom:0.25rem;">📊 RATA-RATA NILAI PER INDIKATOR:</div>
      ${indicatorRowsHtml || '<p class="text-muted text-sm py-2">Rincian indikator tidak ditemukan.</p>'}

      ${rating.note ? `<div style="margin-top:1rem; padding:0.85rem; background:var(--surface); border-radius:8px; border:1px solid var(--border);">
        <div style="font-size:0.75rem; font-weight:700; color:var(--primary); text-transform:uppercase; margin-bottom:0.25rem;">💬 Catatan & Evaluasi Manajemen:</div>
        <div style="font-size:0.85rem; font-style:italic; color:var(--text-main);">"${esc(rating.note)}"</div>
      </div>` : ''}
    </div>
    <div class="modal-footer">
      ${isAdminOrMgr ? `
        <button class="btn btn-primary" onclick="window._hideModal(); window._editRating('${key}')">✏️ Edit Penilaian</button>
        <button class="btn btn-outline-primary" onclick="window._exportSingleRatingPDF('${key}')">🖨️ Pratinjau PDF</button>
      ` : ''}
      <button class="btn btn-secondary" onclick="window._hideModal()">Tutup</button>
    </div>`, 'modal-lg');
};

window._editRating = (key) => {
  window._showRatingForm(key);
};
window._deleteRating = async (key) => { if (confirm('Hapus penilaian?')) { await remove(ref(db, 'ratings/' + key)); showToast('Dihapus!', 'success'); } };

window._generateRatingPDFHtml = (key) => {
  const rating = allData.ratings[key];
  if (!rating) {
    showToast('Data penilaian tidak ditemukan', 'error');
    return null;
  }

  const emp = getUserByEmpId(rating.emp_id);
  const empName = emp ? emp.name : rating.emp_id;
  const empPos = emp ? emp.position : '-';
  const empGender = emp ? emp.gender : 'Semua';
  const avg = rating.scores ? (Object.values(rating.scores).reduce((s, v) => s + v, 0) / Object.values(rating.scores).length).toFixed(1) : '0';

  // --- Hitung data Izin/Cuti ---
  const currentYear = new Date().getFullYear();
  const empLeaves = getLeaves(rating.emp_id);
  const ratingMonth = rating.date; // e.g. "2026-07"
  const approvedLeavesBulanIni = empLeaves.filter(l => l.status === 'Disetujui' && l.start_date.startsWith(ratingMonth));
  const totalIzinBulanIni = approvedLeavesBulanIni.length;

  // Sisa cuti per jenis (Filtered by gender, for the whole year)
  const leaveTypes = getLeaveTypes().filter(t => !t.gender || t.gender === 'Semua' || t.gender === empGender);
  let leaveQuotaRows = '';
  leaveTypes.forEach(t => {
    if (t.quota > 0) {
      let taken = 0;
      empLeaves.filter(l => l.leave_type === t.name && l.status !== 'Ditolak' && new Date(l.start_date).getFullYear() === currentYear).forEach(l => {
        const s = new Date(l.start_date); const e = new Date(l.end_date);
        taken += Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1);
      });
      const remaining = t.quota - taken;
      leaveQuotaRows += `<tr>
        <td style="border:1px solid #000;padding:4px;">${esc(t.name)}</td>
        <td style="border:1px solid #000;padding:4px;text-align:center;">${t.quota} hari</td>
        <td style="border:1px solid #000;padding:4px;text-align:center;">${taken} hari</td>
        <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:bold;color:${remaining <= 0 ? 'red' : '#065F46'}">${remaining} hari</td>
      </tr>`;
    }
  });

  // --- Hitung Tunggakan ---
  const balance = calcBalance(rating.emp_id);

  let criteriaRows = '';
  if (rating.scores) {
    const allCrits = getCriteria();
    const groupedScores = {};

    Object.entries(rating.scores).forEach(([critKey, score]) => {
      const cDef = allCrits.find(c => c._key === critKey || c.name === critKey);
      const actualName = cDef ? cDef.name : critKey;
      const ind = cDef && cDef.indicator ? cDef.indicator : 'Umum';
      if (!groupedScores[ind]) groupedScores[ind] = [];
      groupedScores[ind].push({ name: actualName, score });
    });

    Object.keys(groupedScores).forEach(ind => {
      criteriaRows += `<tr><td colspan="2" style="border:1px solid #cbd5e1;padding:6px 10px;background:#e2e8f0;font-weight:bold;text-transform:uppercase;font-size:11px;color:#0f172a !important;">${esc(ind)}</td></tr>`;
      groupedScores[ind].forEach(item => {
        criteriaRows += `
          <tr>
            <td style="border:1px solid #cbd5e1;padding:6px 10px;padding-left:16px;font-size:11px;color:#0f172a !important;font-weight:600;">${esc(item.name)}</td>
            <td style="border:1px solid #cbd5e1;padding:6px 10px;text-align:center;font-weight:bold;font-size:11px;color:#1e40af !important;">${item.score} / 5</td>
          </tr>
        `;
      });
    });
  }

  const formattedDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Evaluasi Kriteria Penilaian ${esc(empName)} - SPBU Gontor</title>
  <style id="page-style">
    @page { size: A4 portrait; margin: 6mm 10mm; }
  </style>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 10px; background: #e2e8f0; font-size: 12px; line-height: 1.35; }
    .rapor-container { background: #fff; max-width: 210mm; min-height: 265mm; margin: 0 auto; padding: 22px 28px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 8px 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); max-width: 210mm; margin-left: auto; margin-right: auto; }
    .no-print-bar button { padding: 6px 14px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; font-size: 11.5px; }
    .btn-print { background: #1d4ed8; color: #fff; }
    .btn-close { background: #64748b; color: #fff; margin-left: 8px; }
    .kop-header { text-align: center; border-bottom: 2.5px double #1d4ed8; padding-bottom: 6px; margin-bottom: 12px; width: 100%; }
    .kop-title { font-family: 'Times New Roman', Times, serif; font-weight: 900; font-size: 28px; color: #1e40af; letter-spacing: 1.2px; line-height: 1.05; margin-bottom: 2px; }
    .kop-subtitle { font-family: 'Times New Roman', Times, serif; font-weight: 800; font-size: 16px; color: #1d4ed8; margin-top: 1px; letter-spacing: 0.5px; line-height: 1.05; margin-bottom: 3px; }
    .kop-address { font-size: 10.5px; color: #1e3a8a; margin-top: 1px; line-height: 1.3; }
    .doc-title-box { text-align: center; margin-bottom: 12px; }
    .doc-title { font-size: 15px; font-weight: 800; text-transform: uppercase; color: #0f172a; border-bottom: 1.5px solid #0f172a; display: inline-block; padding-bottom: 2px; }
    .doc-subtitle { font-size: 10px; color: #64748b; margin-top: 3px; font-weight: 700; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; }
    .info-table td { padding: 6px 12px; font-size: 11px; vertical-align: top; border-bottom: 1px solid #e2e8f0; color: #0f172a !important; }
    .info-table td.label { font-weight: 700; color: #475569 !important; width: 140px; background: #f1f5f9; }
    .metric-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .metric-table th, .metric-table td { border: 1px solid #cbd5e1; padding: 7px 12px; font-size: 11px; }
    .metric-table th { background: #1e40af; color: #ffffff !important; font-weight: 700; text-align: left; padding: 8px 12px; }
    tr { page-break-inside: avoid !important; page-break-after: auto !important; }
    .signature-area { margin-top: 20px; display: flex; justify-content: space-between; align-items: flex-end; page-break-inside: avoid; }
    .sig-box { width: 220px; text-align: center; font-size: 11px; color: #0f172a !important; }
    .sig-space { height: 80px; }
    @media print {
      html, body { background: #fff; padding: 0; margin: 0; }
      .rapor-container { box-shadow: none; padding: 0; max-width: 100% !important; border-radius: 0; min-height: 265mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <div style="display:flex; align-items:center; gap:8px;">
      <label style="font-weight:bold; font-size:11.5px; color:#334155;">📐 Ukuran Kertas:</label>
      <select id="paper-size-select" style="padding:4px 8px; font-size:11px; border-radius:4px; border:1px solid #94a3b8; font-weight:600; cursor:pointer;" onchange="
        const styleEl = document.getElementById('page-style');
        const containers = document.querySelectorAll('.rapor-container, .no-print-bar');
        if (this.value === 'F4') {
          styleEl.innerHTML = '@page { size: 215mm 330mm portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '215mm');
        } else {
          styleEl.innerHTML = '@page { size: A4 portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '210mm');
        }
      ">
        <option value="A4" selected>A4 (210 x 297 mm)</option>
        <option value="F4">F4 / Folio (215 x 330 mm)</option>
      </select>
    </div>
    <div>
      <button class="btn-print" onclick="window.print()">🖨️ Cetak PDF / Print</button>
      <button class="btn-close" onclick="window.close()">✕ Tutup</button>
    </div>
  </div>

  <div class="rapor-container">
    <div class="kop-header">
      <div class="kop-title">PT. ESTAFET DWI MASA</div>
      <div class="kop-subtitle">SPBU 54.634.25 GONTOR MLARAK</div>
      <div class="kop-address">
        Kantor Pusat : Ds. Gontor, Kec. Mlarak, Kab. Ponorogo - Jawa Timur 63472<br>
        Kantor Cabang : Jalan Mayjend Bambang Sugeng Km. 01 Sidojoyo Wonosobo<br>
        Email: estafetdwimasa@gmail.com
      </div>
    </div>
    
    <div class="doc-title-box">
      <div class="doc-title">LEMBAR EVALUASI PENILAIAN KARYAWAN</div>
      <div class="doc-subtitle">PERIODE EVALUASI: ${fmtMonthYear(rating.date).toUpperCase()} | TANGGAL CETAK: ${formattedDate.toUpperCase()}</div>
    </div>

    <table class="info-table">
      <tr>
        <td class="label">Nama Karyawan</td>
        <td><strong>${esc(empName)}</strong></td>
        <td class="label">ID Karyawan</td>
        <td><strong>${esc(rating.emp_id)}</strong></td>
      </tr>
      <tr>
        <td class="label">Jabatan / Posisi</td>
        <td>${esc(empPos)}</td>
        <td class="label">Rata-Rata Rating</td>
        <td><strong style="color:#1d4ed8; font-size:12px;">⭐ ${avg} / 5.0</strong></td>
      </tr>
    </table>

    <h4 style="margin:6px 0 4px 0; color:#1e40af; font-size:10.5px; border-bottom:1px solid #cbd5e1; padding-bottom:2px;">A. PENILAIAN KRITERIA INDIKATOR</h4>
    <table class="metric-table">
      <thead>
        <tr>
          <th style="border:1px solid #cbd5e1;padding:4px 8px;text-align:left;background:#1e40af;color:#fff !important;">Indikator / Sub-Indikator Kriteria</th>
          <th style="border:1px solid #cbd5e1;padding:4px 8px;text-align:center;width:90px;background:#1e40af;color:#fff !important;">Skor (1-5)</th>
        </tr>
      </thead>
      <tbody>
        ${criteriaRows}
        <tr>
          <td style="border:1px solid #cbd5e1;padding:4px 8px;text-align:right;color:#0f172a !important;"><strong>Rata-Rata Skor Kriteria:</strong></td>
          <td style="border:1px solid #cbd5e1;padding:4px 8px;text-align:center;font-size:11px;font-weight:bold;color:#1d4ed8 !important;">⭐ ${avg} / 5.0</td>
        </tr>
      </tbody>
    </table>
    
    <div style="border:1px solid #cbd5e1; border-radius:4px; padding:6px 10px; background:#f8fafc !important; color:#0f172a !important; margin-bottom:8px;">
      <div style="font-weight:bold; font-size:9.5px; color:#1e40af !important; margin-bottom:2px; text-transform:uppercase;">💬 CATATAN EVALUASI ATASAN:</div>
      <div style="font-size:10px; color:#0f172a !important; font-style:italic; line-height:1.2;">${esc(rating.note || 'Tidak ada catatan khusus.')}</div>
    </div>

    <div class="signature-area">
      <div class="sig-box">
        <div>Penerima Evaluasi (Karyawan),<br>&nbsp;</div>
        <div class="sig-space"></div>
        <div><strong>( ${esc(empName)} )</strong></div>
        <div style="font-size:8.5px; color:#64748b;">ID: ${esc(rating.emp_id)}</div>
      </div>
      <div class="sig-box">
        <div>Gontor, ${formattedDate}<br><strong>Manager SPBU Gontor</strong>,</div>
        <div class="sig-space"></div>
        <div><strong>( ______________________ )</strong></div>
        <div style="font-size:8.5px; color:#64748b;">PT. ESTAFET DWI MASA</div>
      </div>
    </div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script>
    function downloadRatingPdfDirect() {
      const btn = document.getElementById('btn-dl-rating-pdf');
      const noPrintBar = document.querySelector('.no-print-bar');
      const oldText = btn ? btn.innerHTML : '';
      if (btn) { btn.innerHTML = '⏳ Mengunduh...'; btn.disabled = true; }

      const paperSize = document.getElementById('paper-size-select') ? document.getElementById('paper-size-select').value : 'A4';
      
      // Hide top control bar completely before rendering
      if (noPrintBar) {
        noPrintBar.style.setProperty('display', 'none', 'important');
      }

      const element = document.querySelector('.rapor-container');
      const safeName = '${esc(empName).replace(/[^a-zA-Z0-9]/g, '_')}';

      const opt = {
        margin: [6, 8, 6, 8],
        filename: 'Evaluasi_Penilaian_' + safeName + '.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2.2,
          useCORS: true,
          logging: false,
          ignoreElements: (node) => node.classList && (node.classList.contains('no-print') || node.classList.contains('no-print-bar'))
        },
        jsPDF: { unit: 'mm', format: paperSize === 'F4' ? [215, 330] : 'a4', orientation: 'portrait' }
      };

      html2pdf().set(opt).from(element).save().then(() => {
        if (noPrintBar) noPrintBar.style.setProperty('display', 'flex');
        if (btn) { btn.innerHTML = oldText; btn.disabled = false; }
      }).catch(err => {
        console.error(err);
        if (noPrintBar) noPrintBar.style.setProperty('display', 'flex');
        if (btn) { btn.innerHTML = oldText; btn.disabled = false; }
        alert('Tanda peringatan: Jika unduh otomatis terhalang, silakan gunakan tombol Cetak / Print lalu pilih Tujuan: Simpan sebagai PDF.');
      });
    }
  </script>
</body>
</html>`;
};

window._exportSingleRatingPDF = (key) => {
  const html = _generateRatingPDFHtml(key);
  if (!html) return;
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  } else {
    showToast('Izinkan pop-up di browser untuk mencetak PDF Evaluasi.', 'error');
  }
};

window._downloadSingleRatingPDF = (key) => {
  window._exportSingleRatingPDF(key);
};

window._downloadAllRatingsPDF = () => {
  let ratings = getRatings();

  const empFilter = (window._ratingSearchEmp || '').trim();
  const monthFilter = (window._ratingSearchMonth || '').trim();

  if (empFilter || monthFilter) {
    ratings = ratings.filter(r => {
      const matchEmp = !empFilter || r.emp_id === empFilter;
      const matchMonth = !monthFilter || (r.date || '').startsWith(monthFilter);
      return matchEmp && matchMonth;
    });
  }

  if (ratings.length === 0) {
    showToast('Tidak ada data penilaian yang sesuai dengan filter', 'warning');
    return;
  }

  const formattedDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  let combinedContainers = '';
  ratings.forEach((r, idx) => {
    const emp = getUserByEmpId(r.emp_id);
    const empName = emp ? emp.name : r.emp_id;
    const empPos = emp ? emp.position : '-';
    const avg = r.scores ? (Object.values(r.scores).reduce((s, v) => s + v, 0) / Object.values(r.scores).length).toFixed(1) : '0';

    let criteriaRows = '';
    if (r.scores) {
      const allCrits = getCriteria();
      const groupedScores = {};
      Object.entries(r.scores).forEach(([critKey, score]) => {
        const cDef = allCrits.find(c => c._key === critKey || c.name === critKey);
        const actualName = cDef ? cDef.name : critKey;
        const ind = cDef && cDef.indicator ? cDef.indicator : 'Umum';
        if (!groupedScores[ind]) groupedScores[ind] = [];
        groupedScores[ind].push({ name: actualName, score });
      });

      Object.keys(groupedScores).forEach(ind => {
        criteriaRows += `<tr><td colspan="2" style="border:1px solid #cbd5e1;padding:6px 10px;background:#e2e8f0;font-weight:bold;text-transform:uppercase;font-size:11px;color:#0f172a !important;">${esc(ind)}</td></tr>`;
        groupedScores[ind].forEach(item => {
          criteriaRows += `
            <tr>
              <td style="border:1px solid #cbd5e1;padding:6px 10px;padding-left:16px;font-size:11px;color:#0f172a !important;font-weight:600;">${esc(item.name)}</td>
              <td style="border:1px solid #cbd5e1;padding:6px 10px;text-align:center;font-weight:bold;font-size:11px;color:#1e40af !important;">${item.score} / 5</td>
            </tr>
          `;
        });
      });
    }

    if (idx > 0) {
      combinedContainers += `<div style="page-break-before:always; height:1px;"></div>`;
    }

    combinedContainers += `
    <div class="rapor-container" style="margin-bottom:20px;">
      <div class="kop-header">
        <div class="kop-title">PT. ESTAFET DWI MASA</div>
        <div class="kop-subtitle">SPBU 54.634.25 GONTOR MLARAK</div>
        <div class="kop-address">
          Kantor Pusat : Ds. Gontor, Kec. Mlarak, Kab. Ponorogo - Jawa Timur 63472<br>
          Kantor Cabang : Jalan Mayjend Bambang Sugeng Km. 01 Sidojoyo Wonosobo<br>
          Email: estafetdwimasa@gmail.com
        </div>
      </div>
      
      <div class="doc-title-box">
        <div class="doc-title">LEMBAR EVALUASI PENILAIAN KARYAWAN</div>
        <div class="doc-subtitle">PERIODE EVALUASI: ${fmtMonthYear(r.date).toUpperCase()} | TANGGAL CETAK: ${formattedDate.toUpperCase()}</div>
      </div>

      <table class="info-table">
        <tr>
          <td class="label">Nama Karyawan</td>
          <td><strong>${esc(empName)}</strong></td>
          <td class="label">ID Karyawan</td>
          <td><strong>${esc(r.emp_id)}</strong></td>
        </tr>
        <tr>
          <td class="label">Jabatan / Posisi</td>
          <td>${esc(empPos)}</td>
          <td class="label">Rata-Rata Rating</td>
          <td><strong style="color:#1d4ed8; font-size:12px;">⭐ ${avg} / 5.0</strong></td>
        </tr>
      </table>

      <h4 style="margin:6px 0 4px 0; color:#1e40af; font-size:10.5px; border-bottom:1px solid #cbd5e1; padding-bottom:2px;">A. PENILAIAN KRITERIA INDIKATOR</h4>
      <table class="metric-table">
        <thead>
          <tr>
            <th style="border:1px solid #cbd5e1;padding:4px 8px;text-align:left;background:#1e40af;color:#fff !important;">Indikator / Sub-Indikator Kriteria</th>
            <th style="border:1px solid #cbd5e1;padding:4px 8px;text-align:center;width:90px;background:#1e40af;color:#fff !important;">Skor (1-5)</th>
          </tr>
        </thead>
        <tbody>
          ${criteriaRows}
          <tr>
            <td style="border:1px solid #cbd5e1;padding:4px 8px;text-align:right;color:#0f172a !important;"><strong>Rata-Rata Skor Kriteria:</strong></td>
            <td style="border:1px solid #cbd5e1;padding:4px 8px;text-align:center;font-size:11px;font-weight:bold;color:#1d4ed8 !important;">⭐ ${avg} / 5.0</td>
          </tr>
        </tbody>
      </table>
      
      <div style="border:1px solid #cbd5e1; border-radius:4px; padding:6px 10px; background:#f8fafc !important; color:#0f172a !important; margin-bottom:8px;">
        <div style="font-weight:bold; font-size:9.5px; color:#1e40af !important; margin-bottom:2px; text-transform:uppercase;">💬 CATATAN EVALUASI ATASAN:</div>
        <div style="font-size:10px; color:#0f172a !important; font-style:italic; line-height:1.2;">${esc(r.note || 'Tidak ada catatan khusus.')}</div>
      </div>

      <div class="signature-area">
        <div class="sig-box">
          <div>Penerima Evaluasi (Karyawan),<br>&nbsp;</div>
          <div class="sig-space"></div>
          <div><strong>( ${esc(empName)} )</strong></div>
          <div style="font-size:8.5px; color:#64748b;">ID: ${esc(r.emp_id)}</div>
        </div>
        <div class="sig-box">
          <div>Gontor, ${formattedDate}<br><strong>Manager SPBU Gontor</strong>,</div>
          <div class="sig-space"></div>
          <div><strong>( ______________________ )</strong></div>
          <div style="font-size:8.5px; color:#64748b;">PT. ESTAFET DWI MASA</div>
        </div>
      </div>
    </div>`;
  });

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Laporan Bundel Evaluasi Penilaian Semua Karyawan - SPBU Gontor</title>
  <style id="page-style">
    @page { size: A4 portrait; margin: 6mm 10mm; }
  </style>
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 10px; background: #e2e8f0; font-size: 12px; line-height: 1.35; }
    .rapor-container { background: #fff; max-width: 210mm; min-height: 265mm; margin: 0 auto; padding: 22px 28px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 8px 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); max-width: 210mm; margin-left: auto; margin-right: auto; }
    .no-print-bar button { padding: 6px 14px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; font-size: 11.5px; }
    .btn-print { background: #1d4ed8; color: #fff; }
    .btn-close { background: #64748b; color: #fff; margin-left: 8px; }
    .kop-header { text-align: center; border-bottom: 2.5px double #1d4ed8; padding-bottom: 6px; margin-bottom: 12px; width: 100%; }
    .kop-title { font-family: 'Times New Roman', Times, serif; font-weight: 900; font-size: 28px; color: #1e40af; letter-spacing: 1.2px; line-height: 1.05; margin-bottom: 2px; }
    .kop-subtitle { font-family: 'Times New Roman', Times, serif; font-weight: 800; font-size: 16px; color: #1d4ed8; margin-top: 1px; letter-spacing: 0.5px; line-height: 1.05; margin-bottom: 3px; }
    .kop-address { font-size: 10.5px; color: #1e3a8a; margin-top: 1px; line-height: 1.3; }
    .doc-title-box { text-align: center; margin-bottom: 12px; }
    .doc-title { font-size: 15px; font-weight: 800; text-transform: uppercase; color: #0f172a; border-bottom: 1.5px solid #0f172a; display: inline-block; padding-bottom: 2px; }
    .doc-subtitle { font-size: 10px; color: #64748b; margin-top: 3px; font-weight: 700; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; }
    .info-table td { padding: 6px 12px; font-size: 11px; vertical-align: top; border-bottom: 1px solid #e2e8f0; color: #0f172a !important; }
    .info-table td.label { font-weight: 700; color: #475569 !important; width: 140px; background: #f1f5f9; }
    .metric-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    .metric-table th, .metric-table td { border: 1px solid #cbd5e1; padding: 7px 12px; font-size: 11px; }
    .metric-table th { background: #1e40af; color: #ffffff !important; font-weight: 700; text-align: left; padding: 8px 12px; }
    tr { page-break-inside: avoid !important; }
    .signature-area { margin-top: 20px; display: flex; justify-content: space-between; align-items: flex-end; page-break-inside: avoid; }
    .sig-box { width: 220px; text-align: center; font-size: 11px; color: #0f172a !important; }
    .sig-space { height: 80px; }
    @media print {
      html, body { background: #fff; padding: 0; margin: 0; }
      .rapor-container { box-shadow: none; padding: 0; max-width: 100% !important; border-radius: 0; min-height: 265mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <div style="display:flex; align-items:center; gap:8px;">
      <label style="font-weight:bold; font-size:11.5px; color:#334155;">📐 Ukuran Kertas:</label>
      <select id="paper-size-select" style="padding:4px 8px; font-size:11px; border-radius:4px; border:1px solid #94a3b8; font-weight:600; cursor:pointer;" onchange="
        const styleEl = document.getElementById('page-style');
        const containers = document.querySelectorAll('.rapor-container, .no-print-bar');
        if (this.value === 'F4') {
          styleEl.innerHTML = '@page { size: 215mm 330mm portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '215mm');
        } else {
          styleEl.innerHTML = '@page { size: A4 portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '210mm');
        }
      ">
        <option value="A4" selected>A4 (210 x 297 mm)</option>
        <option value="F4">F4 / Folio (215 x 330 mm)</option>
      </select>
    </div>
    <div>
      <button class="btn-print" onclick="window.print()">🖨️ Cetak PDF / Print</button>
      <button class="btn-close" onclick="window.close()">✕ Tutup</button>
    </div>
  </div>

  ${combinedContainers}
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(fullHtml);
    win.document.close();
  } else {
    showToast('Izinkan pop-up di browser untuk mencetak PDF Evaluasi.', 'error');
  }
};

// --- CRITERIA CRUD ---
window._showCriteriaForm = (key) => {
  const c = key ? (() => { const v = allData.criteria[key]; return v ? { ...v, _key: key } : null; })() : null;
  const area = $('crit-form-area'); if (!area) return;

  const allCrits = getCriteria();
  const uniqueIndicators = [...new Set(allCrits.map(x => x.indicator || 'Umum'))];
  const currentInd = c?.indicator || (uniqueIndicators.length > 0 ? uniqueIndicators[0] : '__NEW__');

  const rawPos = c?.position;
  let selectedPositions = [];
  if (Array.isArray(rawPos)) {
    selectedPositions = rawPos;
  } else if (typeof rawPos === 'string') {
    selectedPositions = rawPos.split(',').map(s => s.trim());
  } else {
    selectedPositions = ['Semua'];
  }
  const isSemua = selectedPositions.includes('Semua') || selectedPositions.length === 0;

  const availablePositions = ['Manager', 'Admin', 'Supervisor', 'Operator', 'Cleaning Service'];

  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--primary)">
    <h3 class="card-title mb-4">${c ? 'Edit' : 'Tambah'} Kriteria</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="form-group">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
          <label class="form-label" style="margin-bottom:0;">Nama Indikator</label>
          <button id="btn-del-selected-ind" type="button" class="btn btn-outline-danger" style="padding:0.15rem 0.5rem; font-size:0.7rem; display:${currentInd !== '__NEW__' ? 'inline-flex' : 'none'}; align-items:center; gap:0.25rem;" onclick="window._deleteIndicatorGroup(document.getElementById('cf-indicator-select').value)">
            🗑️ Hapus Indikator Ini
          </button>
        </div>
        <select id="cf-indicator-select" class="form-input form-select mb-2" onchange="
          const isNew = this.value === '__NEW__';
          document.getElementById('cf-indicator').style.display = isNew ? 'block' : 'none';
          const delBtn = document.getElementById('btn-del-selected-ind');
          if (delBtn) delBtn.style.display = isNew ? 'none' : 'inline-flex';
        ">
          ${uniqueIndicators.map(ind => `<option value="${esc(ind)}" ${ind === currentInd ? 'selected' : ''}>${esc(ind)}</option>`).join('')}
          <option value="__NEW__" ${currentInd === '__NEW__' ? 'selected' : ''}>+ Tambah Indikator Baru</option>
        </select>
        <input id="cf-indicator" class="form-input" value="" placeholder="Ketik nama indikator baru..." style="display:${currentInd === '__NEW__' ? 'block' : 'none'};">
      </div>
      <div class="form-group"><label class="form-label">Sub-Indikator</label><input id="cf-name" class="form-input" value="${esc(c?.name || '')}" placeholder="Misal: Tepat Waktu"></div>
      <div class="form-group" style="grid-column: 1 / -1">
        <label class="form-label mb-2">Berlaku Untuk Jabatan (Pilih satu atau lebih)</label>
        <div style="display:flex;flex-wrap:wrap;gap:0.75rem 1.25rem;background:var(--surface);padding:0.85rem;border-radius:var(--radius-md);border:1px solid var(--border);">
          <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-weight:600;font-size:0.85rem;color:var(--text-main);">
            <input type="checkbox" class="cf-pos-cb" value="Semua" ${isSemua ? 'checked' : ''} onchange="window._onCriteriaPosCheck(this)">
            <span>Semua Jabatan</span>
          </label>
          ${availablePositions.map(p => `
            <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.85rem;color:var(--text-main);">
              <input type="checkbox" class="cf-pos-cb" value="${esc(p)}" ${(!isSemua && selectedPositions.includes(p)) ? 'checked' : ''} onchange="window._onCriteriaPosCheck(this)">
              <span>${esc(p)}</span>
            </label>
          `).join('')}
        </div>
      </div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:0.5rem">
      <button class="btn btn-primary" onclick="window._saveCriteria('${key || ''}')">${c ? 'Perbarui' : 'Simpan'}</button>
      <button class="btn btn-secondary" onclick="window._cancelCriteriaForm()">Batal</button>
    </div>
  </div>`;
};

window._cancelCriteriaForm = () => {
  window._activeCriteriaFormState = null;
  const area = $('crit-form-area');
  if (area) area.innerHTML = '';
};

window._onCriteriaPosCheck = (el) => {
  const cbs = document.querySelectorAll('.cf-pos-cb');
  if (el.value === 'Semua' && el.checked) {
    cbs.forEach(cb => {
      if (cb.value !== 'Semua') cb.checked = false;
    });
  } else if (el.value !== 'Semua' && el.checked) {
    cbs.forEach(cb => {
      if (cb.value === 'Semua') cb.checked = false;
    });
  }
  
  const anyChecked = Array.from(cbs).some(cb => cb.checked);
  if (!anyChecked) {
    const semuaCb = Array.from(cbs).find(cb => cb.value === 'Semua');
    if (semuaCb) semuaCb.checked = true;
  }
};

window._saveCriteria = async (key) => {
  const selVal = $('cf-indicator-select').value;
  let indicator = (selVal === '__NEW__' ? $('cf-indicator').value.trim() : selVal) || 'Umum';

  const name = $('cf-name').value.trim();
  if (!name) { showToast('Sub-indikator wajib diisi!', 'error'); return; }

  const checkedCbs = Array.from(document.querySelectorAll('.cf-pos-cb:checked')).map(cb => cb.value);
  const position = (checkedCbs.length === 0 || checkedCbs.includes('Semua')) ? ['Semua'] : checkedCbs;

  const existingTimestamp = key && allData.criteria[key] ? (allData.criteria[key].timestamp || Date.now()) : Date.now();
  const data = { indicator, name, position, timestamp: existingTimestamp };
  if (key) {
    window._activeCriteriaFormState = null;
    await update(ref(db, 'criteria/' + key), data);
    showToast('Kriteria diperbarui!', 'success');
    $('crit-form-area').innerHTML = '';
  } else {
    window._activeCriteriaFormState = { indicator };
    await set(push(ref(db, 'criteria')), data);
    showToast(`Sub-kriteria "${name}" tersimpan! Form tetap terbuka untuk entri berikutnya.`, 'success');
  }
};
window._deleteCriteria = async (key) => { if (confirm('Hapus kriteria?')) { await remove(ref(db, 'criteria/' + key)); showToast('Dihapus!', 'success'); } };

window._editIndicatorName = async (oldName) => {
  const newName = prompt(`Ubah nama Indikator "${oldName}" menjadi:`, oldName);
  if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
  
  const trimmedNewName = newName.trim();
  const allCrit = getCriteria();
  const matched = allCrit.filter(c => (c.indicator || 'Umum') === oldName);
  
  if (matched.length === 0) return;
  
  const updates = {};
  matched.forEach(c => {
    updates[`criteria/${c._key}/indicator`] = trimmedNewName;
  });

  try {
    await update(ref(db), updates);
    showToast(`Nama indikator berhasil diubah menjadi "${trimmedNewName}"!`, 'success');
  } catch (err) {
    console.error('Error updating indicator name:', err);
    showToast('Gagal mengubah nama indikator.', 'error');
  }
};

window._deleteIndicatorGroup = (indName) => {
  if (!indName || indName === '__NEW__') return;
  const allCrit = getCriteria();
  const matched = allCrit.filter(c => (c.indicator || 'Umum') === indName);
  
  const subCount = matched.length;
  showModal(`
    <div class="modal-header" style="background:var(--danger-bg); border-bottom:1px solid rgba(239,68,68,0.3);">
      <h3 class="modal-title" style="color:var(--danger); display:flex; align-items:center; gap:0.5rem;">
        ⚠️ Konfirmasi Hapus Indikator
      </h3>
      <button class="modal-close" onclick="window._hideModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:1.5rem;">
      <p style="font-size:0.95rem; color:var(--text-main); margin-bottom:1rem; line-height:1.5;">
        Apakah Anda <strong>100% YAKIN</strong> ingin menghapus Indikator <strong>"${esc(indName)}"</strong>?
      </p>
      ${subCount > 0 ? `
        <div style="background:rgba(239,68,68,0.1); border-left:4px solid var(--danger); padding:0.85rem; border-radius:var(--radius-md); margin-bottom:1.25rem;">
          <strong style="color:var(--danger); font-size:0.85rem;">🔴 PERINGATAN KRUSIAL:</strong>
          <p style="font-size:0.82rem; color:var(--text-main); margin-top:0.25rem;">
            Menghapus indikator ini akan secara permanen menghapus <strong>${subCount} sub-kriteria</strong> yang terikat di bawahnya!
          </p>
        </div>
      ` : `
        <p class="text-xs text-muted mb-4">Indikator ini saat ini belum memiliki sub-kriteria.</p>
      `}
      <div class="form-group mb-2">
        <label class="form-label" style="font-weight:700; color:var(--danger);">
          Ketik kata <span style="background:var(--danger); color:#fff; padding:2px 8px; border-radius:4px;">HAPUS</span> di bawah ini untuk mengonfirmasi keyakinan Anda:
        </label>
        <input id="inp-confirm-delete-indicator" type="text" class="form-input" placeholder="Ketik HAPUS di sini..." oninput="document.getElementById('btn-confirm-execute-delete-ind').disabled = (this.value.trim().toUpperCase() !== 'HAPUS');">
      </div>
    </div>
    <div class="modal-footer" style="gap:0.75rem;">
      <button id="btn-confirm-execute-delete-ind" class="btn btn-danger" disabled onclick="window._executeDeleteIndicatorGroup('${esc(indName)}')">
        🗑️ Ya, Saya Yakin Hapus Indikator Ini
      </button>
      <button class="btn btn-secondary" onclick="window._hideModal()">Batal</button>
    </div>
  `);
};

window._executeDeleteIndicatorGroup = async (indName) => {
  const allCrit = getCriteria();
  const matched = allCrit.filter(c => (c.indicator || 'Umum') === indName);
  
  const updates = {};
  matched.forEach(c => {
    updates[`criteria/${c._key}`] = null;
  });

  try {
    if (Object.keys(updates).length > 0) {
      await update(ref(db), updates);
    }
    hideModal();
    showToast(`Indikator "${indName}" berhasil dihapus!`, 'success');
    const formArea = $('crit-form-area');
    if (formArea) formArea.innerHTML = '';
    // Re-render criteria view if active
    if (typeof renderCriteria === 'function') {
      const mainWrapper = document.querySelector('.content-wrapper');
      if (mainWrapper) mainWrapper.innerHTML = renderCriteria();
    }
  } catch (err) {
    console.error('Error deleting indicator group:', err);
    showToast('Gagal menghapus indikator.', 'error');
  }
};

window._saveSettings = async () => {
  const currentSettings = allData.settings || {};
  const settingsData = {
    ...currentSettings,
    emp_profile_edit: {
      name: $('set-edit-name').checked,
      photo: $('set-edit-photo').checked,
      phone: $('set-edit-phone').checked,
      email: $('set-edit-email').checked,
      dob: $('set-edit-dob').checked
    },
    mytic_mgmt_emails: $('set-mgmt-emails').value.trim()
  };
  await set(ref(db, 'settings'), settingsData);
  showToast('Pengaturan berhasil disimpan!', 'success');
};

// --- CHANGE PIN (Employee) ---
window._tempProfilePhoto = null;
window._handlePhotoSelect = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const max_size = 800;
  const reader = new FileReader();
  reader.onload = (readerEvent) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > max_size) { height = Math.round(height * max_size / width); width = max_size; }
      } else {
        if (height > max_size) { width = Math.round(width * max_size / height); height = max_size; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      window._tempProfilePhoto = canvas.toDataURL('image/jpeg', 0.8);
      const nameEl = document.getElementById('pe-photo-name');
      if (nameEl) nameEl.textContent = 'Foto siap diunggah. Klik Simpan Perubahan Profil.';
    };
    img.src = readerEvent.target.result;
  };
  reader.readAsDataURL(file);
};

window._deleteEmployeePhoto = async () => {
  if (!confirm('Hapus foto profil dan kembali ke avatar bawaan?')) return;
  const emp = getUserByUsername(currentUser.username); if (!emp) return;
  await update(ref(db, 'users/' + emp._key), { profile_picture: null });
  if (currentUser.profile_picture) {
    delete currentUser.profile_picture;
    sessionStorage.setItem('mytic_emp_session', JSON.stringify(currentUser));
  }
  showToast('Foto profil dihapus', 'success');
  window._tempProfilePhoto = null;
  switchSection('emp-profile');
};

window._updateEmployeeProfile = async () => {
  const emp = getUserByUsername(currentUser.username); if (!emp) return;
  const s = allData.settings || {};
  const ep = s.emp_profile_edit || {};

  const updates = {};
  if (ep.name) updates.name = $('pe-name').value.trim();
  if (ep.phone) updates.phone = $('pe-phone').value.trim();
  if (ep.email) updates.email = $('pe-email').value.trim();
  if (ep.dob) updates.date_of_birth = $('pe-dob').value;
  if (window._tempProfilePhoto) updates.profile_picture = window._tempProfilePhoto;

  if (Object.keys(updates).length === 0) {
    showToast('Tidak ada data yang bisa diubah', 'warning');
    return;
  }

  if (ep.name && updates.name === '') { showToast('Nama tidak boleh kosong', 'error'); return; }

  await update(ref(db, 'users/' + emp._key), updates);

  // Update currentUser local session so UI updates instantly
  if (updates.name) currentUser.name = updates.name;
  sessionStorage.setItem('mytic_emp_session', JSON.stringify(currentUser));

  // Update header UI
  const hd = document.getElementById('display-mobile-name');
  if (hd) hd.textContent = currentUser.name;

  window._tempProfilePhoto = null; // reset
  showToast('Profil berhasil diperbarui!', 'success');
  // Refresh view
  switchSection('emp-profile');
};

window._changePin = async () => {
  const emp = getUserByUsername(currentUser.username); if (!emp) return;
  const oldPin = $('cp-old').value.trim();
  const newPin = $('cp-new').value.trim();
  const confirmPin = $('cp-confirm').value.trim();
  if (oldPin !== emp.pin) { showToast('PIN lama salah!', 'error'); return; }
  if (newPin.length !== 6) { showToast('PIN baru harus 6 digit!', 'error'); return; }
  if (newPin !== confirmPin) { showToast('Konfirmasi PIN tidak cocok!', 'error'); return; }
  await update(ref(db, 'users/' + emp._key), { pin: newPin });
  const timestamp = new Date().toISOString();
  await set(push(ref(db, 'pin_history')), { emp_id: emp.emp_id, old_pin: oldPin, new_pin: newPin, timestamp: timestamp });
  // Update local session
  currentUser.pin = newPin;
  sessionStorage.setItem('mytic_emp_session', JSON.stringify(currentUser));
  showToast('PIN berhasil diubah!', 'success');
  $('cp-old').value = ''; $('cp-new').value = ''; $('cp-confirm').value = '';
};

// ==========================================
// PWA INSTALLATION HANDLER
// ==========================================
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showPwaInstallBanner();
});

function showPwaInstallBanner() {
  const existing = document.getElementById('pwa-install-banner');
  if (existing || !deferredPrompt) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;">
      <div style="width:36px;height:36px;background:var(--primary);color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.9rem">📱</div>
      <div>
        <strong style="font-size:0.85rem;display:block;">Install Aplikasi MyTIC</strong>
        <span style="font-size:0.75rem;color:var(--text-muted)">Pasang di layar utama HP / Laptop untuk akses cepat!</span>
      </div>
    </div>
    <div style="display:flex;gap:0.5rem;align-items:center;">
      <button class="btn btn-primary" style="padding:0.35rem 0.75rem;font-size:0.75rem;" onclick="window._triggerPwaInstall()">Install</button>
      <button style="background:none;border:none;color:var(--text-muted);font-size:1.1rem;cursor:pointer;padding:0 0.25rem;" onclick="document.getElementById('pwa-install-banner').remove()">✕</button>
    </div>
  `;
  document.body.appendChild(banner);
}

window._triggerPwaInstall = () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === 'accepted') {
      showToast('Aplikasi MyTIC berhasil dipasang!', 'success');
    }
    deferredPrompt = null;
    const banner = document.getElementById('pwa-install-banner');
    if (banner) banner.remove();
  });
};

// ==========================================
// LEADERBOARD & KPI ENGINE (EXCLUSIVELY FOR MANAGER)
// ==========================================
window._leaderboardPeriod = 'month';
window._leaderboardMetric = 'composite';
window._leaderboardPos = 'Semua';

window._onLeaderboardFilterChange = () => {
  const pEl = document.getElementById('lb-filter-period');
  const mEl = document.getElementById('lb-filter-metric');
  const posEl = document.getElementById('lb-filter-pos');
  if (pEl) window._leaderboardPeriod = pEl.value;
  if (mEl) window._leaderboardMetric = mEl.value;
  if (posEl) window._leaderboardPos = posEl.value;
  renderCurrentSection();
};

function isRecordForUser(item, user) {
  if (!item || !user) return false;

  const itemEmpId = (item.emp_id || item.empId || item.user_id || '').toString().toLowerCase().trim();
  const itemEmpName = (item.emp_name || item.empName || item.username || item.name || '').toString().toLowerCase().trim();

  const userEmpId = (user.emp_id || user.id || user._key || '').toString().toLowerCase().trim();
  const userName = (user.name || user.username || '').toString().toLowerCase().trim();

  if (itemEmpId && userEmpId && itemEmpId === userEmpId) return true;
  if (itemEmpName && userName && (itemEmpName === userName || itemEmpName.includes(userName) || userName.includes(itemEmpName))) return true;

  return false;
}

function calculateEmployeeKpi(emp, period) {
  const now = new Date();
  let startDate = new Date();
  let endDate = new Date();

  if (period === 'last_month') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  } else if (period === 'quarter') {
    startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (period === 'year') {
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  } else if (typeof period === 'string' && /^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    startDate = new Date(y, m - 1, 1);
    endDate = new Date(y, m, 0, 23, 59, 59);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  }

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  const startMonthStr = startStr.slice(0, 7);
  const endMonthStr = endStr.slice(0, 7);

  const parseDateToISO = (val) => {
    if (val === null || val === undefined || val === '') return '';
    if (typeof val === 'number') {
      try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch { return ''; }
    }
    const str = val.toString().trim();
    if (!str) return '';
    if (/^\d{10,13}$/.test(str)) {
      try {
        const num = Number(str);
        const d = new Date(num > 1e11 ? num : num * 1000);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch { return ''; }
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.slice(0, 10);
    }
    if (/^\d{4}-\d{2}$/.test(str)) {
      return str + '-01';
    }
    const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (ddmmyyyy) {
      const d = ddmmyyyy[1].padStart(2, '0');
      const m = ddmmyyyy[2].padStart(2, '0');
      const y = ddmmyyyy[3];
      return `${y}-${m}-${d}`;
    }
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
    return '';
  };

  const isRecordInPeriod = (...dateCandidates) => {
    for (const val of dateCandidates) {
      const iso = parseDateToISO(val);
      if (iso) {
        return iso >= startStr && iso <= endStr;
      }
    }
    return false;
  };

  const isOperator = (emp.position || '').toString().toLowerCase() === 'operator';

  // 1. Attendance Punctuality Score (0 - 100)
  const absensiRecords = Object.values(allData.absensi_records || {}).filter(r => {
    return isRecordForUser(r, emp) && isRecordInPeriod(r.date, r.tanggal, r.timestamp);
  });

  let onTimeCount = 0;
  let totalLateMinutes = 0;
  let totalSecLate = 0;
  let lateCount = 0;
  let excusedCount = 0;
  let totalWorkDays = absensiRecords.length;

  const ABSENSI_SHIFTS = {
    '1': { start: [4, 45], label: 'Shift 1 (04:45–12:45)' },
    '2': { start: [12, 45], label: 'Shift 2 (12:45–21:15)' },
    '3': { start: [21, 15], label: 'Shift 3 (21:15–04:45)' },
    'admin': { start: [7, 0], label: 'Admin (07:00–15:00)' }
  };

  absensiRecords.forEach(r => {
    const st = (r.status || r.type || '').toString().toLowerCase();
    const ket = (r.keterangan || r.note || '').toString().toLowerCase();
    const isExcused = ['sakit', 'izin', 'cuti', 'libur', 'off', 'dinas', 'tugas'].includes(st) ||
                      ['sakit', 'izin', 'cuti', 'libur', 'off', 'dinas', 'tugas'].some(k => ket.includes(k));

    if (isExcused) {
      excusedCount++;
    } else if (r.clock_in && r.clock_in !== '-') {
      const lateMins = Number(r.late_minutes || 0);
      const isLate = lateMins > 0 || st === 'terlambat';

      if (!isLate) {
        onTimeCount++;
      } else {
        lateCount++;
        totalLateMinutes += Math.max(lateMins, 0);
      }

      // Calculate raw clock-in diff for tie-breaker ranking only
      let parts = (r.clock_in || '').split(':').map(Number);
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        let h = parts[0], m = parts[1], s = parts[2] || 0;
        let sName = (r.shift || '').toString();
        let sKey = Object.keys(ABSENSI_SHIFTS).find(k => {
          const lbl = ABSENSI_SHIFTS[k].label;
          return sName === lbl || sName === k || sName.includes(lbl.split(' (')[0]);
        }) || '1';

        const sh = ABSENSI_SHIFTS[sKey] || ABSENSI_SHIFTS['1'];
        const startSec = sh.start[0] * 3600 + sh.start[1] * 60;
        let currentSec = h * 3600 + m * 60 + s;
        let diffSec = currentSec - startSec;
        if (sKey === '3' && diffSec < -43200) diffSec += 86400;
        if (sKey === '3' && diffSec > 43200) diffSec -= 86400;
        totalSecLate += diffSec;
      }
    }
  });

  const validAttendanceCount = onTimeCount + excusedCount;
  const attendanceRate = totalWorkDays > 0 ? Math.min(100, Math.round((validAttendanceCount / totalWorkDays) * 100)) : 100;

  // 2. SOP Checklist Compliance Score (0 - 100) - ONLY FOR OPERATOR
  let sopRate = null;
  if (isOperator) {
    const sopRecords = Object.values(allData.sop_checklists || allData.ceklis_sop || {}).filter(s => {
      return isRecordForUser(s, emp) && isRecordInPeriod(s.date, s.tanggal, s.created_at, s.timestamp);
    });

    let completedSop = 0;
    let totalSop = sopRecords.length;
    sopRecords.forEach(s => {
      if (s.status === 'Selesai' || s.completed || s.is_completed) completedSop++;
    });

    sopRate = totalSop > 0 ? Math.round((completedSop / totalSop) * 100) : 100;
  }

  // 3. Performance Appraisal Rating (0 - 100)
  const ratingRecords = Object.values(allData.ratings || allData.penilaian_kinerja || {}).filter(rt => {
    return isRecordForUser(rt, emp) && isRecordInPeriod(rt.date, rt.tanggal, rt.created_at, rt.timestamp);
  });

  let sumRating = 0;
  let countRating = 0;
  ratingRecords.forEach(rt => {
    let scoresObj = rt.scores;
    if (!scoresObj && rt.rating_scores) {
      try {
        scoresObj = typeof rt.rating_scores === 'string' ? JSON.parse(rt.rating_scores) : rt.rating_scores;
      } catch (e) {}
    }
    if (scoresObj && typeof scoresObj === 'object') {
      const values = Object.values(scoresObj).map(Number).filter(v => !isNaN(v) && v > 0);
      if (values.length > 0) {
        const itemAvg = values.reduce((a, b) => a + b, 0) / values.length;
        sumRating += itemAvg;
        countRating++;
        return;
      }
    }
    const singleVal = Number(rt.rating || rt.skor || rt.score);
    if (!isNaN(singleVal) && singleVal > 0) {
      sumRating += singleVal;
      countRating++;
    }
  });

  const avgRatingNum = countRating > 0 ? (sumRating / countRating) : 0;
  const ratingScore = Math.round(avgRatingNum * 20); // 5.0 -> 100, 0.0 -> 0

  // 4. Violation Penalty / Track Record (0 - 100)
  const violationRecords = Object.values(allData.violations || allData.pelanggaran || {}).filter(v => {
    return isRecordForUser(v, emp) && v.status !== 'Dibatalkan' && isRecordInPeriod(v.date, v.tanggal, v.start_date, v.created_at, v.timestamp);
  });

  let penalty = 0;
  violationRecords.forEach(v => {
    const type = (v.type || v.jenis || '').toString().toLowerCase();
    if (type.includes('sp3')) penalty += 50;
    else if (type.includes('sp2')) penalty += 30;
    else if (type.includes('sp1')) penalty += 20;
    else if (type.includes('teguran')) penalty += 10;
    else penalty += 15;
  });

  const trackRecordScore = Math.max(0, 100 - penalty);

  // 5. Debit / Tunggakan Akuntabilitas Keuangan (0 - 100)
  const totalDebitAmt = Math.max(0, calcBalance(emp.emp_id));
  const allTxns = getTxns(emp.emp_id);
  const periodTxns = allTxns.filter(t => isRecordInPeriod(t.date, t.tanggal, t.timestamp, t.created_at));
  const periodTxCount = periodTxns.length;
  const periodDebitTxns = periodTxns.filter(t => t.type === 'debit');

  const nominalPenalty = Math.floor(totalDebitAmt / 50000) * 5;
  const frequencyPenalty = periodDebitTxns.length * 5;
  const debitScore = Math.max(0, 100 - (nominalPenalty + frequencyPenalty));

  // 6. FAIR Composite KPI Score Calculation:
  // For Operator: 15% Attendance + 25% SOP + 30% Rating + 20% Debit + 10% Track Record = 100%
  // For Non-Operator (Admin/Supervisor/Cleaning Service): 45% Attendance + 40% Rating + 5% Debit + 10% Track Record = 100%
  let compositeScore = 0;
  if (isOperator) {
    compositeScore = Math.round(
      (attendanceRate * 0.15) +
      ((sopRate || 0) * 0.25) +
      (ratingScore * 0.30) +
      (debitScore * 0.20) +
      (trackRecordScore * 0.10)
    );
  } else {
    compositeScore = Math.round(
      (attendanceRate * 0.45) +
      (ratingScore * 0.40) +
      (debitScore * 0.05) +
      (trackRecordScore * 0.10)
    );
  }

  return {
    isOperator,
    attendanceRate,
    totalSecLate,
    totalLateMinutes,
    lateCount,
    onTimeCount,
    excusedCount,
    totalWorkDays,
    sopRate,
    avgRating: avgRatingNum.toFixed(1),
    ratingScore,
    totalDebitAmt,
    periodTxCount,
    debitScore,
    trackRecordScore,
    violationCount: violationRecords.length,
    compositeScore
  };
}

function _generateEmployeeKpiRaporContainerHtml(empId, forcedRank, forcedTotalUsers, forcedPeriod) {
  const users = getUsers();
  const u = users.find(x => x.emp_id === empId);
  if (!u) return '';

  const period = forcedPeriod || window._leaderboardPeriod || 'month';
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = lastMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const thisMonthStr = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  let periodTitle = '';
  if (period === 'month') {
    periodTitle = thisMonthStr;
  } else if (period === 'last_month') {
    periodTitle = lastMonthStr;
  } else if (period === 'quarter') {
    periodTitle = 'Triwulan (3 Bulan)';
  } else if (period === 'year') {
    periodTitle = 'Tahun ' + now.getFullYear();
  } else if (typeof period === 'string' && /^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    periodTitle = new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  } else {
    periodTitle = thisMonthStr;
  }

  let userRank = forcedRank;
  let totalUsers = forcedTotalUsers;

  if (!userRank || !totalUsers) {
    const rankedUsers = users.map(userItem => {
      const kpi = calculateEmployeeKpi(userItem, period);
      return { user: userItem, kpi, targetValue: kpi.compositeScore };
    }).sort((a, b) => b.targetValue - a.targetValue || a.kpi.totalSecLate - b.kpi.totalSecLate);

    totalUsers = rankedUsers.length;
    const userRankIdx = rankedUsers.findIndex(r => r.user.emp_id === empId);
    userRank = userRankIdx >= 0 ? userRankIdx + 1 : '-';
  }

  const kpi = calculateEmployeeKpi(u, period);

  let rankBadgeEmoji = '🏆';
  if (userRank === 1) rankBadgeEmoji = '🥇';
  else if (userRank === 2) rankBadgeEmoji = '🥈';
  else if (userRank === 3) rankBadgeEmoji = '🥉';

  let kpiCategoryStr = 'Sangat Baik (Excellent 🟢)';
  if (kpi.compositeScore < 60) kpiCategoryStr = 'Perlu Evaluasi Khusus (Needs Improvement 🔴)';
  else if (kpi.compositeScore < 75) kpiCategoryStr = 'Cukup (Fair 🟡)';
  else if (kpi.compositeScore < 90) kpiCategoryStr = 'Baik (Good 🔵)';

  const formattedDate = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const settings = getPayrollSettings();
  let managerObj = users.find(uItem => (uItem.position || '').toLowerCase() === 'manager' || (uItem.name || '').toLowerCase().includes('pedri'));
  const managerName = managerObj ? managerObj.name : (settings.name_audit_manager || 'Pedri Fauzi');

  const ratings = getRatings(empId);
  const latestRating = ratings.length > 0 ? ratings[0] : null;
  const empNote = latestRating ? latestRating.note : '';

  const currentYear = new Date().getFullYear();
  const empLeaves = Object.values(allData.leaves || {}).filter(l => isRecordForUser(l, u));
  const leavesBulanIni = empLeaves.filter(l => {
    if (l.status !== 'Disetujui') return false;
    const d = new Date(l.start_date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  let totalIzinBulanIni = 0;
  leavesBulanIni.forEach(l => {
    const s = new Date(l.start_date); const e = new Date(l.end_date);
    totalIzinBulanIni += Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1);
  });

  const leaveTypes = getLeaveTypes();
  let leaveQuotaRows = '';
  leaveTypes.forEach(t => {
    if (t.quota > 0) {
      let taken = 0;
      empLeaves.filter(l => l.leave_type === t.name && l.status !== 'Ditolak' && new Date(l.start_date).getFullYear() === currentYear).forEach(l => {
        const s = new Date(l.start_date); const e = new Date(l.end_date);
        taken += Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1);
      });
      const remaining = t.quota - taken;
      leaveQuotaRows += `<tr>
        <td style="border:1px solid #cbd5e1;padding:6px 12px;font-size:11px;color:#0f172a !important;">${esc(t.name)}</td>
        <td style="border:1px solid #cbd5e1;padding:6px 12px;text-align:center;font-size:11px;color:#0f172a !important;">${t.quota} hari</td>
        <td style="border:1px solid #cbd5e1;padding:6px 12px;text-align:center;font-size:11px;color:#0f172a !important;">${taken} hari</td>
        <td style="border:1px solid #cbd5e1;padding:6px 12px;text-align:center;font-size:11px;font-weight:bold;color:${remaining <= 0 ? '#dc2626' : '#166534'} !important;">${remaining} hari</td>
      </tr>`;
    }
  });

  return `
  <div class="rapor-container" style="margin-bottom:20px;">
    <div>
      <div class="kop-header" style="text-align:center; border-bottom:2.5px double #1d4ed8 !important; padding-bottom:6px; margin-bottom:12px;">
        <div class="kop-title" style="font-family:'Times New Roman', Times, serif; font-weight:900; font-size:28px; color:#1e40af !important; letter-spacing:1.2px; line-height:1.05; margin-bottom:2px;">PT. ESTAFET DWI MASA</div>
        <div class="kop-subtitle" style="font-family:'Times New Roman', Times, serif; font-weight:800; font-size:16px; color:#1d4ed8 !important; margin-top:1px; letter-spacing:0.5px; line-height:1.05; margin-bottom:3px;">SPBU 54.634.25 GONTOR MLARAK</div>
        <div class="kop-address" style="font-size:10.5px; color:#1e3a8a !important; margin-top:1px; line-height:1.3;">
          Kantor Pusat : Ds. Gontor, Kec. Mlarak, Kab. Ponorogo - Jawa Timur 63472<br>
          Kantor Cabang : Jalan Mayjend Bambang Sugeng Km. 01 Sidojoyo Wonosobo<br>
          Email: estafetdwimasa@gmail.com
        </div>
      </div>
      <div class="doc-title-box" style="text-align:center; margin-bottom:12px;">
        <div class="doc-title" style="font-size:15px; font-weight:800; text-transform:uppercase; color:#0f172a !important; border-bottom:1.5px solid #0f172a !important; display:inline-block; padding-bottom:2px;">RAPOR EVALUASI KINERJA INDIVIDUAL KARYAWAN</div>
        <div class="doc-subtitle" style="font-size:10px; color:#475569 !important; margin-top:3px; font-weight:700;">PERIODE EVALUASI: ${esc(periodTitle).toUpperCase()} | TANGGAL CETAK: ${formattedDate.toUpperCase()}</div>
      </div>
      <table class="info-table" style="width:100%; border-collapse:collapse; margin-bottom:14px; background:#f8fafc !important; border:1px solid #cbd5e1 !important; border-radius:4px;">
        <tr>
          <td class="label" style="font-weight:700; color:#334155 !important; width:140px; background:#f1f5f9 !important; padding:6px 12px; font-size:11px;">Nama Karyawan</td>
          <td style="padding:6px 12px; font-size:11px;"><strong style="color:#0f172a !important;">${esc(u.name)}</strong></td>
          <td class="label" style="font-weight:700; color:#334155 !important; width:140px; background:#f1f5f9 !important; padding:6px 12px; font-size:11px;">ID Karyawan</td>
          <td style="padding:6px 12px; font-size:11px;"><strong style="color:#0f172a !important;">${esc(u.emp_id)}</strong></td>
        </tr>
        <tr>
          <td class="label" style="font-weight:700; color:#334155 !important; width:140px; background:#f1f5f9 !important; padding:6px 12px; font-size:11px;">Jabatan / Posisi</td>
          <td style="padding:6px 12px; font-size:11px;"><strong style="color:#0f172a !important;">${esc(u.position)}</strong></td>
          <td class="label" style="font-weight:700; color:#334155 !important; width:140px; background:#f1f5f9 !important; padding:6px 12px; font-size:11px;">Status Evaluasi</td>
          <td style="padding:6px 12px; font-size:11px;"><span style="color:#16a34a !important; font-weight:bold;">Selesai (Aktif)</span></td>
        </tr>
      </table>
      <div class="score-summary-grid" style="display:flex; gap:12px; margin-bottom:14px; width:100%;">
        <div class="score-card" style="flex:1; background:#eff6ff !important; border:1.5px solid #3b82f6 !important; border-radius:6px; padding:10px 14px; text-align:center;">
          <div style="font-size:10px; font-weight:700; color:#1e40af !important; text-transform:uppercase;">SKOR KPI KOMPOSIT AKHIR</div>
          <div class="score-value" style="font-size:22px; font-weight:900; color:#1e40af !important; margin:2px 0;">${kpi.compositeScore} <span style="font-size:12px; font-weight:normal; color:#475569 !important;">/ 100</span></div>
          <div style="font-size:10.5px; font-weight:bold; color:#1e3a8a !important;">Kategori: ${kpiCategoryStr}</div>
        </div>
        <div class="score-card rank-card" style="flex:1; background:#f0fdf4 !important; border:1.5px solid #22c55e !important; border-radius:6px; padding:10px 14px; text-align:center;">
          <div style="font-size:10px; font-weight:700; color:#15803d !important; text-transform:uppercase;">PERINGKAT PERUSAHAAN</div>
          <div class="score-value" style="font-size:22px; font-weight:900; color:#15803d !important; margin:2px 0;">#${userRank} <span style="font-size:12px; font-weight:normal; color:#166534 !important;">dari ${totalUsers} Karyawan</span></div>
          <div style="font-size:10.5px; font-weight:bold; color:#166534 !important;">${rankBadgeEmoji} Peringkat Seluruh Perusahaan</div>
        </div>
      </div>
      <table class="metric-table" style="width:100%; border-collapse:collapse; margin-bottom:14px;">
        <thead>
          <tr>
            <th style="width:24px; text-align:center; background:#1e40af !important; color:#ffffff !important; padding:8px 12px; font-size:11px;">#</th>
            <th style="background:#1e40af !important; color:#ffffff !important; padding:8px 12px; font-size:11px;">Indikator Evaluasi Kinerja</th>
            <th style="width:110px; text-align:center; background:#1e40af !important; color:#ffffff !important; padding:8px 12px; font-size:11px;">Pencapaian Riil</th>
            <th style="width:75px; text-align:center; background:#1e40af !important; color:#ffffff !important; padding:8px 12px; font-size:11px;">Bobot</th>
            <th style="width:85px; text-align:center; background:#1e40af !important; color:#ffffff !important; padding:8px 12px; font-size:11px;">Skor Metrik</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">1</td>
            <td style="color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">
              <strong style="color:#0f172a !important;">⏱️ Kedisiplinan Kehadiran (Sistem Absensi)</strong><br>
              <span style="font-size:9.5px; color:#475569 !important;">Tepat Waktu: ${kpi.onTimeCount}x | Terlambat: ${kpi.lateCount}x (${kpi.totalLateMinutes} Menit)${kpi.excusedCount > 0 ? ` | Izin/Cuti/Libur: ${kpi.excusedCount}x` : ''} | Total Hari Kerja: ${kpi.totalWorkDays}</span>
            </td>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.attendanceRate}%</td>
            <td style="text-align:center; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.isOperator ? '15%' : '45%'}</td>
            <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.attendanceRate} / 100</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">2</td>
            <td style="color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">
              <strong style="color:#0f172a !important;">📋 Kepatuhan Ceklis SOP (Aplikasi Ceklis SOP)</strong><br>
              <span style="font-size:9.5px; color:#475569 !important;">${kpi.isOperator ? `Kepatuhan pengisian SOP shift kerja: ${kpi.sopRate}%` : 'Metrik SOP khusus untuk Jabatan Operator (Non-Operator N/A)'}</span>
            </td>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.isOperator ? `${kpi.sopRate}%` : 'N/A'}</td>
            <td style="text-align:center; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.isOperator ? '25%' : '0%'}</td>
            <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.isOperator ? `${kpi.sopRate} / 100` : 'N/A'}</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">3</td>
            <td style="color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">
              <strong style="color:#0f172a !important;">⭐ Rating Evaluasi Kinerja</strong><br>
              <span style="font-size:9.5px; color:#475569 !important;">Rating rata-rata: ${kpi.avgRating} dari 5.0 Bintang</span>
            </td>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.avgRating} / 5.0</td>
            <td style="text-align:center; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.isOperator ? '30%' : '40%'}</td>
            <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.ratingScore} / 100</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">4</td>
            <td style="color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">
              <strong style="color:#0f172a !important;">💳 Akuntabilitas Keuangan (Tunggakan & Tabungan)</strong><br>
              <span style="font-size:9.5px; color:#475569 !important;">Saldo Tunggakan: ${fmt(kpi.totalDebitAmt)} (${kpi.periodTxCount} Transaksi)</span>
            </td>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.totalDebitAmt > 0 ? fmt(kpi.totalDebitAmt) : 'Clean (Rp 0)'}</td>
            <td style="text-align:center; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.isOperator ? '20%' : '5%'}</td>
            <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.debitScore} / 100</td>
          </tr>
          <tr>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">5</td>
            <td style="color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">
              <strong style="color:#0f172a !important;">🛡️ Rekam Pelanggaran & Kedisiplinan (Track Record)</strong><br>
              <span style="font-size:9.5px; color:#475569 !important;">Jumlah Surat Peringatan (SP) Aktif: ${kpi.violationCount} Catatan</span>
            </td>
            <td style="text-align:center; font-weight:bold; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.violationCount > 0 ? `${kpi.violationCount} SP` : 'Clean'}</td>
            <td style="text-align:center; color:#0f172a !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">10%</td>
            <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important; padding:7px 12px; font-size:11px; border:1px solid #cbd5e1;">${kpi.trackRecordScore} / 100</td>
          </tr>
        </tbody>
      </table>

      <h4 style="margin:10px 0 6px 0; color:#1e40af !important; font-size:11px; border-bottom:1px solid #cbd5e1; padding-bottom:3px;">📋 REKAPITULASI IZIN & HAK CUTI KARYAWAN</h4>
      <table class="info-table" style="width:100%; border-collapse:collapse; margin-bottom:8px; background:#f8fafc !important; border:1px solid #cbd5e1 !important; border-radius:4px;">
        <tr>
          <td class="label" style="width:160px; font-weight:700; color:#334155 !important; background:#f1f5f9 !important; padding:6px 12px; font-size:11px;">Izin Disetujui (Bulan Ini)</td>
          <td style="padding:6px 12px; font-size:11px;"><strong style="color:#0f172a !important;">${totalIzinBulanIni} Kali</strong></td>
        </tr>
      </table>
      ${leaveQuotaRows ? `
      <table class="metric-table" style="width:100%; border-collapse:collapse; margin-bottom:12px;">
        <thead>
          <tr>
            <th style="border:1px solid #cbd5e1;padding:6px 12px;text-align:left;background:#334155 !important;color:#fff !important;font-size:11px;">Jenis Hak Cuti</th>
            <th style="border:1px solid #cbd5e1;padding:6px 12px;text-align:center;background:#334155 !important;color:#fff !important;width:95px;font-size:11px;">Jatah (${currentYear})</th>
            <th style="border:1px solid #cbd5e1;padding:6px 12px;text-align:center;background:#334155 !important;color:#fff !important;width:95px;font-size:11px;">Terpakai</th>
            <th style="border:1px solid #cbd5e1;padding:6px 12px;text-align:center;background:#334155 !important;color:#fff !important;width:95px;font-size:11px;">Sisa Cuti</th>
          </tr>
        </thead>
        <tbody>${leaveQuotaRows}</tbody>
      </table>` : '<p style="color:#64748b !important;font-style:italic;font-size:10px;margin-bottom:8px;">Tidak ada jenis cuti terdaftar.</p>'}

      <div style="border:1px solid #cbd5e1; border-radius:4px; padding:10px 14px; background:#f8fafc !important; color:#0f172a !important; margin-bottom:14px;">
        <div style="font-weight:bold; font-size:10.5px; color:#1e40af !important; margin-bottom:3px; text-transform:uppercase;">💬 CATATAN & EVALUASI DARI MANAJEMEN:</div>
        <div style="font-size:11px; color:#0f172a !important; font-style:italic; line-height:1.3;">
          ${empNote ? esc(empNote) : 'Terima kasih atas kontribusi dan dedikasi Anda. Tingkatkan terus kedisiplinan dan kualitas pelayanan demi kemajuan bersama SPBU 54.634.25 GONTOR MLARAK.'}
        </div>
      </div>
    </div>

    <div class="signature-area" style="margin-top:20px; display:flex; justify-content:space-between; align-items:flex-start;">
      <div class="sig-box" style="width:220px; text-align:center; font-size:11px; color:#0f172a !important;">
        <div style="color:#0f172a !important;">Penerima Rapor (Karyawan),<br>&nbsp;</div>
        <div class="sig-space" style="height:65px;"></div>
        <div><strong style="color:#0f172a !important;">( ______________________ )</strong></div>
        <div style="font-size:10px; font-weight:bold; color:#0f172a !important; margin-top:2px;">${esc(u.name)}</div>
        <div style="font-size:9.5px; color:#64748b !important;">ID: ${esc(u.emp_id)}</div>
      </div>
      <div class="sig-box" style="width:220px; text-align:center; font-size:11px; color:#0f172a !important;">
        <div style="color:#0f172a !important;">Gontor, ${formattedDate}<br><strong style="color:#0f172a !important;">Manager SPBU Gontor</strong>,</div>
        <div class="sig-space" style="height:65px;"></div>
        <div><strong style="color:#0f172a !important;">( ______________________ )</strong></div>
        <div style="font-size:10px; font-weight:bold; color:#0f172a !important; margin-top:2px;">${esc(managerName)}</div>
        <div style="font-size:9.5px; color:transparent !important; margin-top:2px; user-select:none;">&nbsp;</div>
      </div>
    </div>
  </div>`;
}

function _generateEmployeeKpiPDFHtml(empId) {
  const containerHtml = _generateEmployeeKpiRaporContainerHtml(empId);
  if (!containerHtml) return '';

  const users = getUsers();
  const u = users.find(x => x.emp_id === empId);
  const empName = u ? u.name : empId;

  const period = window._leaderboardPeriod || 'month';
  const periodTitles = {
    'month': 'Bulan_Ini',
    'last_month': 'Bulan_Lalu',
    'quarter': 'Triwulan',
    'year': 'Tahun_' + new Date().getFullYear()
  };
  const periodTitleStr = periodTitles[period] || 'Bulan_Ini';
  const safeName = esc(empName).replace(/[^a-zA-Z0-9]/g, '_');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Rapor Kinerja ${esc(empName)} - SPBU Gontor</title>
  <style id="page-style">
    @page { size: A4 portrait; margin: 6mm 10mm; }
  </style>
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #0f172a !important; margin: 0; padding: 10px; background: #e2e8f0 !important; font-size: 12px; line-height: 1.35; }
    .rapor-container { background: #ffffff !important; color: #0f172a !important; max-width: 210mm; min-height: 265mm; margin: 0 auto; padding: 22px 28px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff !important; padding: 8px 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); max-width: 210mm; margin-left: auto; margin-right: auto; }
    .no-print-bar button { padding: 6px 14px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; font-size: 11.5px; }
    .btn-print { background: #1d4ed8; color: #fff; }
    .btn-close { background: #64748b; color: #fff; margin-left: 8px; }
    tr { page-break-inside: avoid !important; }
    @media print {
      html, body { background: #fff !important; padding: 0; margin: 0; }
      .rapor-container { box-shadow: none; padding: 0; max-width: 100% !important; border-radius: 0; min-height: 265mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <div style="display:flex; align-items:center; gap:8px;">
      <label style="font-weight:bold; font-size:11.5px; color:#334155;">📐 Ukuran Kertas:</label>
      <select id="paper-size-select" style="padding:4px 8px; font-size:11px; border-radius:4px; border:1px solid #94a3b8; font-weight:600; cursor:pointer;" onchange="
        const styleEl = document.getElementById('page-style');
        const containers = document.querySelectorAll('.rapor-container, .no-print-bar');
        if (this.value === 'F4') {
          styleEl.innerHTML = '@page { size: 215mm 330mm portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '215mm');
        } else {
          styleEl.innerHTML = '@page { size: A4 portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '210mm');
        }
      ">
        <option value="A4" selected>A4 (210 x 297 mm)</option>
        <option value="F4">F4 / Folio (215 x 330 mm)</option>
      </select>
    </div>
    <div>
      <button id="btn-dl-pdf" style="background:#16a34a; color:#fff; font-weight:bold; padding:6px 14px; border-radius:4px; border:none; cursor:pointer; font-size:11.5px;" onclick="downloadPdfDirect(false)">📥 Simpan PDF</button>
      <button class="btn-print" onclick="window.print()">🖨️ Cetak / Print</button>
      <button class="btn-close" onclick="window.close()">✕ Tutup</button>
    </div>
  </div>

  ${containerHtml}

  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <script>
    function downloadPdfDirect(autoClose = false) {
      if (typeof html2pdf === 'undefined') {
        setTimeout(() => downloadPdfDirect(autoClose), 150);
        return;
      }
      const btn = document.getElementById('btn-dl-pdf');
      const noPrintBar = document.querySelector('.no-print-bar');
      const oldText = btn ? btn.innerHTML : '';
      if (btn) { btn.innerHTML = '⏳ Mengunduh...'; btn.disabled = true; }
      const paperSize = document.getElementById('paper-size-select') ? document.getElementById('paper-size-select').value : 'A4';
      if (noPrintBar) noPrintBar.style.setProperty('display', 'none', 'important');
      const element = document.querySelector('.rapor-container');
      const safeName = '${safeName}';
      const safePeriod = '${periodTitleStr}';
      const opt = {
        margin: [4, 6, 4, 6],
        filename: 'Rapor_Kinerja_' + safeName + '_' + safePeriod + '.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2.2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: paperSize === 'F4' ? [215, 330] : 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(element).save().then(() => {
        if (noPrintBar) noPrintBar.style.setProperty('display', 'flex');
        if (btn) { btn.innerHTML = oldText; btn.disabled = false; }
        if (autoClose) { setTimeout(() => window.close(), 300); }
      }).catch(err => {
        console.error(err);
        if (noPrintBar) noPrintBar.style.setProperty('display', 'flex');
        if (btn) { btn.innerHTML = oldText; btn.disabled = false; }
      });
    }
  </script>
</body>
</html>`;
}

window._printAllKpiBundle = () => {
  const users = getUsers();
  const period = window._leaderboardPeriod || 'month';
  const selectedMetric = window._leaderboardMetric || 'composite';
  const selectedPos = window._leaderboardPos || 'Semua';

  let filteredUsers = users;
  if (selectedPos !== 'Semua') {
    filteredUsers = users.filter(u => u.position === selectedPos);
  }

  const rankedUsers = filteredUsers.map(u => {
    const kpi = calculateEmployeeKpi(u, period);
    let targetValue = kpi.compositeScore;
    if (selectedMetric === 'attendance') targetValue = kpi.attendanceRate;
    else if (selectedMetric === 'sop') targetValue = kpi.isOperator ? (kpi.sopRate || 0) : 0;
    else if (selectedMetric === 'rating') targetValue = kpi.ratingScore;
    else if (selectedMetric === 'debit') targetValue = kpi.debitScore;
    return { user: u, kpi, targetValue };
  }).sort((a, b) => b.targetValue - a.targetValue || a.kpi.totalSecLate - b.kpi.totalSecLate);

  if (rankedUsers.length === 0) {
    showToast('Tidak ada data karyawan untuk dicetak.', 'warning');
    return;
  }

  let combinedContainers = '';
  rankedUsers.forEach((item, idx) => {
    const u = item.user;
    if (idx > 0) {
      combinedContainers += `<div style="page-break-before:always; height:1px;"></div>`;
    }
    combinedContainers += _generateEmployeeKpiRaporContainerHtml(u.emp_id, idx + 1, rankedUsers.length, period);
  });

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Bundel Rapor KPI Seluruh Karyawan - SPBU Gontor</title>
  <style id="page-style">
    @page { size: A4 portrait; margin: 6mm 10mm; }
  </style>
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #0f172a !important; margin: 0; padding: 10px; background: #e2e8f0 !important; font-size: 12px; line-height: 1.35; }
    .rapor-container { background: #ffffff !important; color: #0f172a !important; max-width: 210mm; min-height: 265mm; margin: 0 auto; padding: 22px 28px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff !important; padding: 8px 16px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); max-width: 210mm; margin-left: auto; margin-right: auto; }
    .no-print-bar button { padding: 6px 14px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; font-size: 11.5px; }
    .btn-print { background: #1d4ed8; color: #fff; }
    .btn-close { background: #64748b; color: #fff; margin-left: 8px; }
    tr { page-break-inside: avoid !important; }
    @media print {
      html, body { background: #fff !important; padding: 0; margin: 0; }
      .rapor-container { box-shadow: none; padding: 0; max-width: 100% !important; border-radius: 0; min-height: 265mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print no-print-bar">
    <div style="display:flex; align-items:center; gap:8px;">
      <label style="font-weight:bold; font-size:11.5px; color:#334155;">📐 Ukuran Kertas:</label>
      <select id="paper-size-select" style="padding:4px 8px; font-size:11px; border-radius:4px; border:1px solid #94a3b8; font-weight:600; cursor:pointer;" onchange="
        const styleEl = document.getElementById('page-style');
        const containers = document.querySelectorAll('.rapor-container, .no-print-bar');
        if (this.value === 'F4') {
          styleEl.innerHTML = '@page { size: 215mm 330mm portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '215mm');
        } else {
          styleEl.innerHTML = '@page { size: A4 portrait; margin: 6mm 10mm; }';
          containers.forEach(c => c.style.maxWidth = '210mm');
        }
      ">
        <option value="A4" selected>A4 (210 x 297 mm)</option>
        <option value="F4">F4 / Folio (215 x 330 mm)</option>
      </select>
    </div>
    <div>
      <button class="btn-print" onclick="window.print()">🖨️ Cetak PDF / Print</button>
      <button class="btn-close" onclick="window.close()">✕ Tutup</button>
    </div>
  </div>

  ${combinedContainers}
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(fullHtml);
    win.document.close();
  } else {
    showToast('Izinkan pop-up di browser untuk mencetak PDF Rapor.', 'error');
  }
};

window._printEmployeeKpiPDF = (empId) => {
  const pdfHtml = _generateEmployeeKpiPDFHtml(empId);
  if (!pdfHtml) { showToast('Karyawan tidak ditemukan', 'error'); return; }

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(pdfHtml);
    win.document.close();
  } else {
    showToast('Izinkan pop-up di browser untuk mencetak PDF Rapor.', 'error');
  }
};

window._downloadEmployeeKpiDirectPDF = (empId) => {
  const pdfHtml = _generateEmployeeKpiPDFHtml(empId);
  if (!pdfHtml) { showToast('Karyawan tidak ditemukan', 'error'); return; }

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(pdfHtml);
    win.document.close();
    showToast('Menyiapkan file unduhan Rapor...', 'info');

    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (win.closed) {
        clearInterval(timer);
        return;
      }
      if (typeof win.downloadPdfDirect === 'function') {
        clearInterval(timer);
        win.downloadPdfDirect(true);
      } else if (attempts > 40) {
        clearInterval(timer);
      }
    }, 100);
  } else {
    showToast('Izinkan pop-up di browser untuk mengunduh PDF Rapor.', 'error');
  }
};

function renderLeaderboardPage() {
  const users = getUsers();
  const period = window._leaderboardPeriod || 'month';
  const selectedMetric = window._leaderboardMetric || 'composite';
  const selectedPos = window._leaderboardPos || 'Semua';

  const now = new Date();
  const thisMonthName = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthName = lastMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const pastMonthOptions = [];
  for (let i = 2; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    pastMonthOptions.push({ val, label });
  }

  // Filter users by position
  let filteredUsers = users;
  if (selectedPos !== 'Semua') {
    filteredUsers = users.filter(u => u.position === selectedPos);
  }

  // Compute KPI scores for each employee
  const rankedUsers = filteredUsers.map(u => {
    const kpi = calculateEmployeeKpi(u, period);
    let targetValue = kpi.compositeScore;
    if (selectedMetric === 'attendance') targetValue = kpi.attendanceRate;
    else if (selectedMetric === 'sop') targetValue = kpi.isOperator ? (kpi.sopRate || 0) : 0;
    else if (selectedMetric === 'rating') targetValue = kpi.ratingScore;
    else if (selectedMetric === 'debit') targetValue = kpi.debitScore;

    return {
      user: u,
      kpi,
      targetValue
    };
  });

  // Sort descending by targetValue with exact cumulative early clock-in tie-breaker!
  rankedUsers.sort((a, b) => {
    if (b.targetValue !== a.targetValue) {
      return b.targetValue - a.targetValue;
    }
    // Tie-breaker 1: Lowest totalSecLate (earliest cumulative clock-in) wins #1 rank!
    if (a.kpi.totalSecLate !== b.kpi.totalSecLate) {
      return a.kpi.totalSecLate - b.kpi.totalSecLate;
    }
    // Tie-breaker 2: Higher attendance rate
    return b.kpi.attendanceRate - a.kpi.attendanceRate;
  });

  return `<div class="fade-in">
    <!-- FILTER BAR -->
    <div class="card mb-6" style="padding:1.25rem; background:var(--surface);">
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:1rem;">
        <div>
          <h2 style="font-size:1.25rem; font-weight:800; color:var(--text-main);">🏆 Peringkat & KPI Karyawan</h2>
          <p class="text-xs text-muted" style="margin-top:0.2rem;">Evaluasi kinerja & kedisiplinan seluruh karyawan secara objektif & adil (Panel Manajemen)</p>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.75rem; align-items:center;">
          <div>
            <label class="form-label" style="margin-bottom:0.25rem;">Periode</label>
            <select id="lb-filter-period" class="form-input form-select" onchange="window._onLeaderboardFilterChange()" style="padding:0.45rem 0.8rem; font-size:0.8rem;">
              <option value="month" ${period === 'month' ? 'selected' : ''}>Bulan Ini (${thisMonthName})</option>
              <option value="last_month" ${period === 'last_month' ? 'selected' : ''}>Bulan Lalu (${lastMonthName})</option>
              ${pastMonthOptions.map(m => `<option value="${m.val}" ${period === m.val ? 'selected' : ''}>${m.label}</option>`).join('')}
              <option value="quarter" ${period === 'quarter' ? 'selected' : ''}>Triwulan (3 Bulan)</option>
              <option value="year" ${period === 'year' ? 'selected' : ''}>Tahun Ini (${now.getFullYear()})</option>
            </select>
          </div>
          <div>
            <label class="form-label" style="margin-bottom:0.25rem;">Metrik Utama</label>
            <select id="lb-filter-metric" class="form-input form-select" onchange="window._onLeaderboardFilterChange()" style="padding:0.45rem 0.8rem; font-size:0.8rem;">
              <option value="composite" ${selectedMetric === 'composite' ? 'selected' : ''}>Kinerja Keseluruhan (KPI Composite)</option>
              <option value="attendance" ${selectedMetric === 'attendance' ? 'selected' : ''}>Kedisiplinan Kehadiran</option>
              <option value="sop" ${selectedMetric === 'sop' ? 'selected' : ''}>Kepatuhan Ceklis SOP (Khusus Operator)</option>
              <option value="rating" ${selectedMetric === 'rating' ? 'selected' : ''}>Rating Evaluasi Kinerja</option>
              <option value="debit" ${selectedMetric === 'debit' ? 'selected' : ''}>Akuntabilitas Keuangan (Tunggakan)</option>
            </select>
          </div>
          <div>
            <label class="form-label" style="margin-bottom:0.25rem;">Jabatan</label>
            <select id="lb-filter-pos" class="form-input form-select" onchange="window._onLeaderboardFilterChange()" style="padding:0.45rem 0.8rem; font-size:0.8rem;">
              <option value="Semua" ${selectedPos === 'Semua' ? 'selected' : ''}>Semua Jabatan</option>
              <option value="Manager" ${selectedPos === 'Manager' ? 'selected' : ''}>Manager</option>
              <option value="Admin" ${selectedPos === 'Admin' ? 'selected' : ''}>Admin</option>
              <option value="Supervisor" ${selectedPos === 'Supervisor' ? 'selected' : ''}>Supervisor</option>
              <option value="Operator" ${selectedPos === 'Operator' ? 'selected' : ''}>Operator</option>
              <option value="Cleaning Service" ${selectedPos === 'Cleaning Service' ? 'selected' : ''}>Cleaning Service</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- FULL LEADERBOARD TABLE -->
    <div class="card" style="padding:1.5rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem; flex-wrap:wrap; gap:0.75rem;">
        <h3 class="card-title" style="font-size:1.1rem; display:flex; align-items:center; gap:0.5rem; margin:0;">
          📊 Daftar Peringkat Seluruh Karyawan <span class="text-xs text-muted">(${rankedUsers.length} Karyawan)</span>
        </h3>
        ${rankedUsers.length > 0 ? `
        <button class="btn btn-primary" style="font-weight:bold; background:linear-gradient(135deg, #6366f1, #a855f7); color:#fff; border:none; box-shadow:0 2px 8px rgba(99,102,241,0.3); padding:0.45rem 1rem; font-size:0.8rem;" onclick="window._printAllKpiBundle()">
          👁️ Pratinjau & Cetak Semua Rapor KPI (${rankedUsers.length} PDF)
        </button>` : ''}
      </div>

      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th style="width:70px; text-align:center;">Peringkat</th>
              <th>Nama Karyawan</th>
              <th>Jabatan</th>
              <th style="min-width:240px;">Rincian Indikator KPI</th>
              <th style="text-align:right; width:100px;">Skor KPI</th>
              <th style="text-align:center; width:120px;">Aksi Rapor</th>
            </tr>
          </thead>
          <tbody>
            ${rankedUsers.length === 0 ? `
              <tr><td colspan="6" style="text-align:center; padding:2rem;" class="text-muted">Belum ada data karyawan untuk kriteria ini.</td></tr>
            ` : rankedUsers.map((item, idx) => {
              const rank = idx + 1;
              const u = item.user;
              const kpi = item.kpi;
              const score = item.targetValue;

              let rankBadgeClass = 'rank-badge-other';
              let rankLabel = `#${rank}`;
              if (rank === 1) { rankBadgeClass = 'rank-badge-1'; rankLabel = '🥇'; }
              else if (rank === 2) { rankBadgeClass = 'rank-badge-2'; rankLabel = '🥈'; }
              else if (rank === 3) { rankBadgeClass = 'rank-badge-3'; rankLabel = '🥉'; }

              let scoreClass = 'kpi-score-high';
              let barColor = '#10B981';
              if (score < 60) { scoreClass = 'kpi-score-low'; barColor = '#EF4444'; }
              else if (score < 75) { scoreClass = 'kpi-score-warning'; barColor = '#F59E0B'; }
              else if (score < 90) { scoreClass = 'kpi-score-mid'; barColor = '#3B82F6'; }

              const avatarSrc = u.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || u.emp_id)}&background=random`;

              const displayScore = (selectedMetric === 'sop' && !kpi.isOperator) ? 'N/A' : score;
              const isNA = displayScore === 'N/A';

              return `
                <tr style="${rank <= 3 && !isNA ? 'background:var(--surface-hover);' : ''}">
                  <td style="text-align:center;">
                    <span class="rank-badge ${isNA ? 'rank-badge-other' : rankBadgeClass}">${isNA ? `#${rank}` : rankLabel}</span>
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                      <img src="${avatarSrc}" alt="${esc(u.name)}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid var(--border);" onclick="window._previewImage('${avatarSrc}', '${esc(u.name)}')">
                      <div>
                        <strong style="font-size:0.9rem; color:var(--text-main);">${esc(u.name)}</strong>
                        <br><span class="text-xs text-muted">ID: ${esc(u.emp_id)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span class="badge" style="background:var(--bg-color); color:var(--text-main); border:1px solid var(--border); font-size:0.75rem;">${esc(u.position)}</span>
                  </td>
                  <td>
                    <div style="display:flex; flex-wrap:wrap; gap:0.35rem; margin-bottom:0.25rem;">
                      <span class="kpi-pill" title="Kedisiplinan Kehadiran Tepat Waktu">⏱️ ${kpi.attendanceRate}% Hadir</span>
                      ${kpi.isOperator ? `<span class="kpi-pill" title="Kepatuhan Ceklis SOP">📋 ${kpi.sopRate}% SOP</span>` : `<span class="kpi-pill" style="opacity:0.6;" title="Ceklis SOP Hanya Khusus Jabatan Operator">📋 SOP (N/A)</span>`}
                      <span class="kpi-pill" title="Rating Penilaian Kinerja">⭐ ${kpi.avgRating} / 5</span>
                      ${kpi.totalDebitAmt > 0 ? `<span class="kpi-pill" style="color:var(--danger); border-color:var(--danger-bg);" title="Tunggakan Aktif Rp ${fmt(kpi.totalDebitAmt)} (${kpi.debitTxCount} Transaksi)">💳 Rp ${fmt(kpi.totalDebitAmt)}</span>` : `<span class="kpi-pill" style="color:var(--success);" title="Bebas Tunggakan / Minus">💳 Clean</span>`}
                      ${kpi.violationCount > 0 ? `<span class="kpi-pill" style="color:var(--danger); border-color:var(--danger-bg);" title="Jumlah Pelanggaran Active">⚠️ ${kpi.violationCount} SP</span>` : `<span class="kpi-pill" style="color:var(--success);" title="Bebas Pelanggaran">🛡️ SP Clean</span>`}
                    </div>
                    <div class="kpi-bar-bg">
                      <div class="kpi-bar-fill" style="width:${isNA ? 0 : Math.min(100, Math.max(5, score))}%; background:${isNA ? 'var(--border)' : barColor};"></div>
                    </div>
                  </td>
                  <td style="text-align:right;">
                    <span class="kpi-score-badge ${isNA ? 'kpi-score-low' : scoreClass}" style="${isNA ? 'opacity:0.55;' : ''}">${displayScore}</span>
                  </td>
                  <td style="text-align:center;">
                    <div style="display:flex; justify-content:center; gap:0.35rem;">
                      <button class="btn btn-sm btn-outline-success" style="padding:0.25rem 0.45rem; font-size:0.75rem; display:inline-flex; align-items:center; gap:0.2rem;" onclick="window._downloadEmployeeKpiDirectPDF('${u.emp_id}')" title="Unduh File PDF Rapor KPI ${esc(u.name)}">
                        📥 Unduh PDF
                      </button>
                      <button class="btn btn-sm btn-outline-primary" style="padding:0.25rem 0.45rem; font-size:0.75rem; display:inline-flex; align-items:center; gap:0.2rem;" onclick="window._printEmployeeKpiPDF('${u.emp_id}')" title="Pratinjau / Cetak Rapor KPI ${esc(u.name)}">
                        🖨️ Cetak
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ==========================================
// GAJI & PAYROLL MODULE (MANAGEMENT PANEL ONLY)
// ==========================================
function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

window._payrollActiveTab = window._payrollActiveTab || 'internal';
window._payrollMonth = window._payrollMonth || getTodayStr().substring(0, 7);
window._payrollPrintDate = window._payrollPrintDate || getTodayStr();

window._setPayrollTab = (tab) => {
  window._payrollActiveTab = tab;
  switchSection('payroll');
};

window._setPayrollMonth = (monthVal) => {
  if (monthVal) window._payrollMonth = monthVal;
  switchSection('payroll');
};

window._setPayrollPrintDate = (dateVal) => {
  if (dateVal) window._payrollPrintDate = dateVal;
};

function renderPayrollPage() {
  if (!isManagerUser() && currentUser.role !== 'admin') {
    return '<div class="card p-6 text-center text-muted">Akses Khusus Panel Manajemen.</div>';
  }

  const tab = window._payrollActiveTab || 'internal';
  const month = window._payrollMonth || getTodayStr().substring(0, 7);

  return `<div class="fade-in">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-bottom:1.25rem;">
      <div>
        <h3 style="font-size:1.3rem; font-weight:800; color:var(--text-main); margin:0;">💵 Sistem Gaji & Payroll SPBU Gontor</h3>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">Pengelolaan Penggajian Mode Internal, Mode Audit, & Pengaturan Master</p>
      </div>
      <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
        <label style="font-size:0.8rem; font-weight:700; color:var(--text-main);">Periode Penggajian:</label>
        <input type="month" value="${month}" class="form-input" style="padding:0.4rem 0.6rem; font-size:0.85rem; width:150px;" onchange="window._setPayrollMonth(this.value)">
      </div>
    </div>

    <!-- TABS NAV -->
    <div style="display:flex; gap:0.5rem; border-bottom:2px solid var(--border); margin-bottom:1.5rem; flex-wrap:wrap;">
      <button class="btn ${tab === 'internal' ? 'btn-primary' : 'btn-secondary'}" style="border-radius:var(--radius-md) var(--radius-md) 0 0; font-weight:700; padding:0.5rem 1.1rem;" onclick="window._setPayrollTab('internal')">
        🏠 Gaji Internal (Asli)
      </button>
      <button class="btn ${tab === 'audit' ? 'btn-primary' : 'btn-secondary'}" style="border-radius:var(--radius-md) var(--radius-md) 0 0; font-weight:700; padding:0.5rem 1.1rem;" onclick="window._setPayrollTab('audit')">
        📋 Gaji Audit (Pertamina)
      </button>
      <button class="btn ${tab === 'history' ? 'btn-primary' : 'btn-secondary'}" style="border-radius:var(--radius-md) var(--radius-md) 0 0; font-weight:700; padding:0.5rem 1.1rem;" onclick="window._setPayrollTab('history')">
        📜 Riwayat Gaji Bulanan
      </button>
      <button class="btn ${tab === 'settings' ? 'btn-primary' : 'btn-secondary'}" style="border-radius:var(--radius-md) var(--radius-md) 0 0; font-weight:700; padding:0.5rem 1.1rem;" onclick="window._setPayrollTab('settings')">
        ⚙️ Pengaturan Master & TTD
      </button>
    </div>

    <div id="payroll-tab-content">
      ${tab === 'internal' ? renderInternalPayrollTab() : tab === 'audit' ? renderAuditPayrollTab() : tab === 'history' ? renderHistoryPayrollTab() : renderPayrollSettingsTab()}
    </div>
  </div>`;
}

function getPayrollSettings() {
  const s = allData.payroll_settings || {};
  return {
    gaji_pokok_internal_staf: Number(s.gaji_pokok_internal_staf !== undefined ? s.gaji_pokok_internal_staf : 1000000),
    umk_staf: Number(s.umk_staf !== undefined ? s.umk_staf : 2549876),
    umk_manager: Number(s.umk_manager !== undefined ? s.umk_manager : 3059851),
    bpjs_percent: Number(s.bpjs_percent !== undefined ? s.bpjs_percent : 1),

    // PW Internal Groups
    pw_int_group1_name: s.pw_int_group1_name || 'SPV & Admin',
    pw_int_group1_positions: s.pw_int_group1_positions || ['Supervisor', 'Admin', 'SPV'],
    pw_int_group1_percent: Number(s.pw_int_group1_percent !== undefined ? s.pw_int_group1_percent : 20),

    pw_int_group2_name: s.pw_int_group2_name || 'Operator & CS',
    pw_int_group2_positions: s.pw_int_group2_positions || ['Operator', 'Cleaning Service', 'CS'],
    pw_int_group2_percent: Number(s.pw_int_group2_percent !== undefined ? s.pw_int_group2_percent : 80),

    // PW Audit Groups
    pw_aud_group1_name: s.pw_aud_group1_name || 'Manager & Admin',
    pw_aud_group1_positions: s.pw_aud_group1_positions || ['Manager', 'Admin'],
    pw_aud_group1_percent: Number(s.pw_aud_group1_percent !== undefined ? s.pw_aud_group1_percent : 20),

    pw_aud_group2_name: s.pw_aud_group2_name || 'SPV, Operator & CS',
    pw_aud_group2_positions: s.pw_aud_group2_positions || ['Supervisor', 'SPV', 'Operator', 'Cleaning Service', 'CS'],
    pw_aud_group2_percent: Number(s.pw_aud_group2_percent !== undefined ? s.pw_aud_group2_percent : 80),

    bbm_products: Array.isArray(s.bbm_products) && s.bbm_products.length > 0 ? s.bbm_products : [
      { id: 'pertalite', name: 'Pertalite', mult_internal: 2, mult_audit: 4 },
      { id: 'solar', name: 'Solar / Biosolar', mult_internal: 2, mult_audit: 4 },
      { id: 'turbo', name: 'Pertamax Turbo', mult_internal: 12, mult_audit: 30 },
      { id: 'px92', name: 'Pertamax 92', mult_internal: 12, mult_audit: 30 },
      { id: 'dex', name: 'Pertamina Dex', mult_internal: 12, mult_audit: 30 }
    ],
    name_finance_manager: s.name_finance_manager || 'Hazel Hudaya Bisri',
    name_audit_supervisor: s.name_audit_supervisor || 'Gilang Wahyu Ramadhan',
    name_audit_manager: s.name_audit_manager || 'Pedri Fauzi',
    custom_allowances: s.custom_allowances || [
      { id: 'tunj_jabatan', name: 'Tunjangan Jabatan' },
      { id: 'tunj_kinerja', name: 'Tunjangan Kinerja' },
      { id: 'tunj_masa_kerja', name: 'Tunjangan Masa Kerja' }
    ]
  };
}

function normalizePosition(pos) {
  const p = (pos || '').toString().toLowerCase().trim();
  if (!p) return '';
  if (p === 'cs' || p.includes('clean') || p.includes('kebersihan')) return 'cs';
  if (p === 'spv' || p.includes('superv') || p.includes('pengawas')) return 'spv';
  if (p.includes('admin')) return 'admin';
  if (p.includes('operat') || p === 'opr') return 'operator';
  if (p.includes('manager') || p === 'mgr') return 'manager';
  return p;
}

function isPositionMatch(empPosition, positionList) {
  if (!empPosition || !Array.isArray(positionList)) return false;
  const empNorm = normalizePosition(empPosition);
  if (!empNorm) return false;

  return positionList.some(p => {
    const pNorm = normalizePosition(p);
    if (!pNorm) return false;
    return empNorm === pNorm || empNorm.includes(pNorm) || pNorm.includes(empNorm);
  });
}

function getPositionsLabel(positions, defaultName) {
  if (Array.isArray(positions) && positions.length > 0) {
    return positions.map(p => p.toUpperCase()).join(' + ');
  }
  return (defaultName || '').toUpperCase();
}

function getAvailablePositions() {
  const users = getUsers();
  const defaultPositions = ['Manager', 'Supervisor', 'Admin', 'Operator', 'Cleaning Service'];
  const userPositions = users.map(u => u.position).filter(Boolean);
  return Array.from(new Set([...defaultPositions, ...userPositions]));
}

function getBbmProducts() {
  const settings = getPayrollSettings();
  return settings.bbm_products;
}

function getBbmSalesData(month) {
  const p = allData.payroll || {};
  const m = p[month] || {};
  const b = m.bbm_sales || {};
  const products = getBbmProducts();
  const res = {};
  products.forEach(prod => {
    res[prod.id] = Number(b[prod.id] !== undefined ? b[prod.id] : 0);
  });
  return res;
}

function getPrevMonthStr(monthStr) {
  if (!monthStr || !monthStr.includes('-')) return '';
  const parts = monthStr.split('-');
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${m.toString().padStart(2, '0')}`;
}

function getNextMonthStr(monthStr) {
  if (!monthStr || !monthStr.includes('-')) return '';
  const parts = monthStr.split('-');
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${m.toString().padStart(2, '0')}`;
}

function getEmployeeSavingsForSpecificMonth(empId, monthIdx, year) {
  const indonesianMonths = [
    'januari', 'februari', 'maret', 'april', 'mei', 'juni',
    'juli', 'agustus', 'september', 'oktober', 'november', 'desember'
  ];

  const targetIndo = indonesianMonths[monthIdx];
  const targetYear = year.toString();

  const list = Object.values(allData.savings || {}).filter(s => {
    if (!s || !s.emp_id || s.emp_id !== empId) return false;
    if (!s.month) return false;

    const smLower = s.month.toLowerCase().trim();
    // Match exact month name + year, e.g. "januari 2026"
    return smLower.includes(targetIndo) && smLower.includes(targetYear);
  });

  return list.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}

function getEmployeeSavingsForMonth(empId, monthStr) {
  const savings = Object.values(allData.savings || {}).filter(s => {
    if (!s || !s.emp_id || s.emp_id !== empId) return false;
    const sDate = s.date || '';
    if (sDate.startsWith(monthStr)) return true;
    if (s.month) {
      const year = monthStr.split('-')[0];
      const monthNum = parseInt(monthStr.split('-')[1], 10);
      const months = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
      const mName = months[monthNum - 1];
      if (s.month.toLowerCase().includes(mName) && s.month.includes(year)) return true;
    }
    return false;
  });
  return savings.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}

function computePwInternal(bbm) {
  const products = getBbmProducts();
  const res = { total: 0, items: {} };
  products.forEach(p => {
    const qty = Number(bbm[p.id] || 0);
    const mult = Number(p.mult_internal !== undefined ? p.mult_internal : 0);
    const amt = qty * mult;
    res[p.id] = amt;
    res.items[p.id] = { qty, mult, amt, name: p.name };
    res.total += amt;
  });
  res.pwPertalite = res.pertalite || 0;
  res.pwSolar = res.solar || 0;
  res.pwTurbo = res.turbo || 0;
  res.pwPx92 = res.px92 || 0;
  res.pwDex = res.dex || 0;
  return res;
}

function computePwAudit(bbm) {
  const products = getBbmProducts();
  const res = { total: 0, items: {} };
  products.forEach(p => {
    const qty = Number(bbm[p.id] || 0);
    const mult = Number(p.mult_audit !== undefined ? p.mult_audit : 0);
    const amt = qty * mult;
    res[p.id] = amt;
    res.items[p.id] = { qty, mult, amt, name: p.name };
    res.total += amt;
  });
  res.pwPertalite = res.pertalite || 0;
  res.pwSolar = res.solar || 0;
  res.pwTurbo = res.turbo || 0;
  res.pwPx92 = res.px92 || 0;
  res.pwDex = res.dex || 0;
  return res;
}

function getTenureMonths(joinDateStr, targetMonthStr) {
  if (!joinDateStr) return 0;
  const join = new Date(joinDateStr);
  if (isNaN(join.getTime())) return 0;

  let targetDate = new Date();
  if (targetMonthStr && targetMonthStr.includes('-')) {
    const parts = targetMonthStr.split('-');
    targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
  }

  const yearsDiff = targetDate.getFullYear() - join.getFullYear();
  const monthsDiff = targetDate.getMonth() - join.getMonth();
  const totalMonths = yearsDiff * 12 + monthsDiff;
  return Math.max(0, totalMonths);
}

function fmtTenureText(months) {
  const m = Math.max(0, Number(months) || 0);
  if (m === 0) return '0 Bln';
  if (m < 12) return `${m} Bln`;
  const y = Math.floor(m / 12);
  const remM = m % 12;
  if (remM === 0) return `${y} Thn`;
  return `${y} Thn ${remM} Bln`;
}

function getDefaultTenureAllowance(months) {
  if (months >= 50) return 150000;
  if (months >= 25) return 100000;
  if (months >= 12) return 50000;
  return 0;
}

function getDefaultPositionAllowance(position) {
  const p = (position || '').toString().toLowerCase();
  if (p.includes('admin')) return 500000;
  if (p.includes('supervisor') || p.includes('spv')) return 400000;
  if (p.includes('operator') || p.includes('opr')) return 250000;
  return 0;
}
window._saveBbmSales = async () => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const products = getBbmProducts();
  const bbm = { updated_at: Date.now() };
  products.forEach(p => {
    const el = $(`bbm-${p.id}`);
    bbm[p.id] = Number(el ? el.value : 0);
  });

  allData.payroll = allData.payroll || {};
  allData.payroll[month] = allData.payroll[month] || {};
  allData.payroll[month].bbm_sales = bbm;

  renderCurrentSection();

  await set(ref(db, `payroll/${month}/bbm_sales`), bbm);
  showToast('Data Penjualan Liter BBM berhasil disimpan!', 'success');
};

window._resetPayrollMonthData = async () => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  if (!confirm(`Apakah Anda yakin ingin BERSIHKAN / RESET semua data gaji & BBM untuk bulan ${month}? Data akan kembali ke nilai bersih awal.`)) return;

  if (allData.payroll && allData.payroll[month]) {
    delete allData.payroll[month];
  }

  renderCurrentSection();

  await remove(ref(db, `payroll/${month}`));
  showToast(`Data penggajian bulan ${month} berhasil dibersihkan!`, 'success');
};

window._savePayrollSettings = async () => {
  const current = getPayrollSettings();

  const getCheckedPositions = (className) => {
    return Array.from(document.querySelectorAll(`.${className}:checked`)).map(el => el.value);
  };

  const hasIntG1 = document.querySelectorAll('.pw-int-g1-pos').length > 0;
  const hasIntG2 = document.querySelectorAll('.pw-int-g2-pos').length > 0;
  const hasAudG1 = document.querySelectorAll('.pw-aud-g1-pos').length > 0;
  const hasAudG2 = document.querySelectorAll('.pw-aud-g2-pos').length > 0;

  const intG1Pos = getCheckedPositions('pw-int-g1-pos');
  const intG2Pos = getCheckedPositions('pw-int-g2-pos');
  const audG1Pos = getCheckedPositions('pw-aud-g1-pos');
  const audG2Pos = getCheckedPositions('pw-aud-g2-pos');

  const settings = {
    ...current,
    gaji_pokok_internal_staf: Number($('set-gaji-pokok-internal')?.value || 1000000),
    umk_staf: Number($('set-umk-staf')?.value || 2549876),
    umk_manager: Number($('set-umk-manager')?.value || 3059851),
    bpjs_percent: Number($('set-bpjs-percent')?.value || 1),

    // PW Int Groups
    pw_int_group1_name: $('set-pw-int-g1-name')?.value.trim() || 'Kelompok 1 (Internal)',
    pw_int_group1_positions: hasIntG1 ? intG1Pos : current.pw_int_group1_positions,
    pw_int_group1_percent: Number($('set-pw-int-g1-pct')?.value || 20),

    pw_int_group2_name: $('set-pw-int-g2-name')?.value.trim() || 'Kelompok 2 (Internal)',
    pw_int_group2_positions: hasIntG2 ? intG2Pos : current.pw_int_group2_positions,
    pw_int_group2_percent: Number($('set-pw-int-g2-pct')?.value || 80),

    // PW Aud Groups
    pw_aud_group1_name: $('set-pw-aud-g1-name')?.value.trim() || 'Kelompok 1 (Audit)',
    pw_aud_group1_positions: hasAudG1 ? audG1Pos : current.pw_aud_group1_positions,
    pw_aud_group1_percent: Number($('set-pw-aud-g1-pct')?.value || 20),

    pw_aud_group2_name: $('set-pw-aud-g2-name')?.value.trim() || 'Kelompok 2 (Audit)',
    pw_aud_group2_positions: hasAudG2 ? audG2Pos : current.pw_aud_group2_positions,
    pw_aud_group2_percent: Number($('set-pw-aud-g2-pct')?.value || 80),

    name_finance_manager: $('set-name-finance')?.value.trim() || 'Hazel Hudaya Bisri',
    name_audit_supervisor: $('set-name-spv')?.value.trim() || 'Gilang Wahyu Ramadhan',
    name_audit_manager: $('set-name-manager')?.value.trim() || 'Pedri Fauzi',
    updated_at: Date.now()
  };

  allData.payroll_settings = settings;
  renderCurrentSection();

  await set(ref(db, 'payroll_settings'), settings);
  showToast('Pengaturan Master Gaji & Jabatan berhasil disimpan!', 'success');
};

window._addBbmProduct = async () => {
  const nameInput = $('new-bbm-name');
  const multIntInput = $('new-bbm-mult-int');
  const multAudInput = $('new-bbm-mult-aud');
  if (!nameInput || !nameInput.value.trim()) {
    showToast('Nama produk BBM tidak boleh kosong!', 'error');
    return;
  }
  const name = nameInput.value.trim();
  const id = 'bbm_' + Date.now();
  const multInt = Number(multIntInput.value || 0);
  const multAud = Number(multAudInput.value || 0);
  
  const currentSettings = getPayrollSettings();
  const list = [...currentSettings.bbm_products, { id, name, mult_internal: multInt, mult_audit: multAud }];
  
  const updatedSettings = {
    ...currentSettings,
    bbm_products: list,
    updated_at: Date.now()
  };

  allData.payroll_settings = updatedSettings;
  renderCurrentSection();

  await set(ref(db, 'payroll_settings'), updatedSettings);
  showToast(`Produk BBM "${name}" berhasil ditambahkan!`, 'success');
};

window._deleteBbmProduct = async (id) => {
  if (!confirm('Hapus produk BBM ini dari daftar master?')) return;
  const currentSettings = getPayrollSettings();
  const list = currentSettings.bbm_products.filter(b => b.id !== id);

  const updatedSettings = {
    ...currentSettings,
    bbm_products: list,
    updated_at: Date.now()
  };

  allData.payroll_settings = updatedSettings;
  renderCurrentSection();

  await set(ref(db, 'payroll_settings'), updatedSettings);
  showToast('Produk BBM dihapus!', 'success');
};

window._updateBbmProduct = async (id, field, val) => {
  const currentSettings = getPayrollSettings();
  const list = currentSettings.bbm_products.map(b => {
    if (b.id === id) {
      return { ...b, [field]: field.includes('mult') ? Number(val || 0) : val };
    }
    return b;
  });

  const updatedSettings = {
    ...currentSettings,
    bbm_products: list,
    updated_at: Date.now()
  };

  allData.payroll_settings = updatedSettings;
  await set(ref(db, 'payroll_settings'), updatedSettings);
};

window._addCustomAllowance = async () => {
  const nameInput = $('new-tunj-name');
  if (!nameInput || !nameInput.value.trim()) {
    showToast('Nama tunjangan tidak boleh kosong!', 'error');
    return;
  }
  const name = nameInput.value.trim();
  const id = 'tunj_' + Date.now();
  const currentSettings = getPayrollSettings();
  const list = [...currentSettings.custom_allowances, { id, name }];
  
  const updatedSettings = {
    ...currentSettings,
    custom_allowances: list,
    updated_at: Date.now()
  };

  allData.payroll_settings = updatedSettings;
  renderCurrentSection();

  await set(ref(db, 'payroll_settings'), updatedSettings);
  showToast(`Tunjangan "${name}" berhasil ditambahkan!`, 'success');
  nameInput.value = '';
};

window._deleteCustomAllowance = async (id) => {
  if (!confirm('Hapus jenis tunjangan ini?')) return;
  const currentSettings = getPayrollSettings();
  const list = currentSettings.custom_allowances.filter(a => a.id !== id);

  const updatedSettings = {
    ...currentSettings,
    custom_allowances: list,
    updated_at: Date.now()
  };

  allData.payroll_settings = updatedSettings;
  renderCurrentSection();

  await set(ref(db, 'payroll_settings'), updatedSettings);
  showToast('Tunjangan dihapus!', 'success');
};

window._fmtCur = (val) => {
  if (val === null || val === undefined || val === '' || val === 0 || val === '0') return '';
  const num = String(val).replace(/\D/g, '');
  if (!num || Number(num) === 0) return '';
  return new Intl.NumberFormat('id-ID').format(Number(num));
};

window._parseCur = (val) => {
  if (!val) return 0;
  return Number(String(val).replace(/\D/g, '')) || 0;
};

window._saveInternalPayrollItem = async (empId, field, value) => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  allData.payroll = allData.payroll || {};
  allData.payroll[month] = allData.payroll[month] || {};
  allData.payroll[month].internal_data = allData.payroll[month].internal_data || {};
  allData.payroll[month].internal_data[empId] = allData.payroll[month].internal_data[empId] || {};
  allData.payroll[month].internal_data[empId][field] = value;

  renderCurrentSection();

  const path = `payroll/${month}/internal_data/${empId}/${field}`;
  await set(ref(db, path), value);
};

window._toggleEmpAllowance = async (empId, tunjId, isChecked) => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  allData.payroll = allData.payroll || {};
  allData.payroll[month] = allData.payroll[month] || {};
  allData.payroll[month].internal_data = allData.payroll[month].internal_data || {};
  allData.payroll[month].internal_data[empId] = allData.payroll[month].internal_data[empId] || {};
  allData.payroll[month].internal_data[empId].tunjangan = allData.payroll[month].internal_data[empId].tunjangan || {};
  allData.payroll[month].internal_data[empId].tunjangan[tunjId] = allData.payroll[month].internal_data[empId].tunjangan[tunjId] || {};
  allData.payroll[month].internal_data[empId].tunjangan[tunjId].enabled = isChecked;

  renderCurrentSection();

  const path = `payroll/${month}/internal_data/${empId}/tunjangan/${tunjId}/enabled`;
  await set(ref(db, path), isChecked);
};

window._updateEmpAllowanceAmt = async (empId, tunjId, amt) => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const numAmt = Number(amt || 0);
  allData.payroll = allData.payroll || {};
  allData.payroll[month] = allData.payroll[month] || {};
  allData.payroll[month].internal_data = allData.payroll[month].internal_data || {};
  allData.payroll[month].internal_data[empId] = allData.payroll[month].internal_data[empId] || {};
  allData.payroll[month].internal_data[empId].tunjangan = allData.payroll[month].internal_data[empId].tunjangan || {};
  allData.payroll[month].internal_data[empId].tunjangan[tunjId] = allData.payroll[month].internal_data[empId].tunjangan[tunjId] || {};
  allData.payroll[month].internal_data[empId].tunjangan[tunjId].amount = numAmt;

  renderCurrentSection();

  const path = `payroll/${month}/internal_data/${empId}/tunjangan/${tunjId}/amount`;
  await set(ref(db, path), numAmt);
};

window._openMassAllowanceModal = () => {
  const settings = getPayrollSettings();
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  
  let optionsHTML = `
    <optgroup label="💵 Gaji & Komponen Utama">
      <option value="item_gaji_pokok">Gaji Pokok Internal (Rp)</option>
      <option value="item_pw_amount">Pertamina Way Bulatan (Rp)</option>
      <option value="item_overtime_shifts">Shift Lembur Kerja (Jumlah Shift)</option>
      <option value="item_savings_deduction">Potongan Tabungan (Rp)</option>
    </optgroup>
    <optgroup label="🎁 Tunjangan Karyawan">
  `;
  
  optionsHTML += settings.custom_allowances.map(ca => `<option value="${ca.id}">${esc(ca.name)}</option>`).join('');
  optionsHTML += `</optgroup>`;

  const empCheckboxes = users.map(u => {
    const pos = u.position || '-';
    return `<label style="display:flex; align-items:center; gap:0.5rem; background:var(--surface); border:1px solid var(--border); padding:0.45rem 0.6rem; border-radius:var(--radius-sm); font-size:0.8rem; cursor:pointer; box-sizing:border-box; width:100%; overflow:hidden;">
      <input type="checkbox" class="mass-emp-chk" value="${u.emp_id}" data-pos="${esc(pos)}" checked style="flex-shrink:0;">
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><strong>${esc(u.name)}</strong> (${esc(pos)})</span>
    </label>`;
  }).join('');

  showModal(`
    <div style="padding:1.25rem 1.5rem; box-sizing:border-box;">
      <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:0.75rem;">
        <h3 class="modal-title" style="font-size:1.1rem; font-weight:800; color:var(--text-main); margin:0;">⚡ Pengaturan Gaji & Tunjangan Massal</h3>
        <button type="button" class="btn btn-icon btn-sm btn-outline-secondary" onclick="window.hideModal()" style="border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:1.1rem; cursor:pointer;">✕</button>
      </div>
      <div class="modal-body" style="padding:1rem 0; box-sizing:border-box; overflow:hidden;">
        <div style="margin-bottom:1rem;">
          <label class="form-label" style="font-size:0.8rem; font-weight:700;">1. Pilih Komponen Gaji / Tunjangan</label>
          <select id="mass-tunj-select" class="form-input form-select" style="padding:0.45rem 0.75rem; font-size:0.85rem; width:100%; box-sizing:border-box;">
            ${optionsHTML}
          </select>
        </div>

        <div style="margin-bottom:1rem;">
          <label class="form-label" style="font-size:0.8rem; font-weight:700;">2. Input Nominal (Rp) atau Jumlah Shift</label>
          <input id="mass-tunj-amt" type="number" class="form-input" placeholder="Misal: 1000000 atau 400000" style="padding:0.45rem 0.75rem; font-size:0.85rem; width:100%; box-sizing:border-box;">
        </div>

        <div style="margin-bottom:0.5rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
          <label class="form-label" style="font-size:0.8rem; font-weight:700; margin:0;">3. Pilih Karyawan Yang Menerima</label>
          <div style="display:flex; gap:0.35rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-outline-primary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="document.querySelectorAll('.mass-emp-chk').forEach(c => c.checked = true)">Centang Semua</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="document.querySelectorAll('.mass-emp-chk').forEach(c => c.checked = false)">Hapus Centang</button>
            <button type="button" class="btn btn-sm btn-outline-info" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="document.querySelectorAll('.mass-emp-chk').forEach(c => c.checked = (c.getAttribute('data-pos')||'').toLowerCase().includes('operator'))">Khusus Operator</button>
            <button type="button" class="btn btn-sm btn-outline-warning" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="document.querySelectorAll('.mass-emp-chk').forEach(c => c.checked = !(c.getAttribute('data-pos')||'').toLowerCase().includes('operator'))">Khusus Non-Operator</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:0.4rem; max-height:210px; overflow-y:auto; border:1px solid var(--border); padding:0.6rem; border-radius:var(--radius-sm); box-sizing:border-box; margin:0;">
          ${empCheckboxes}
        </div>
      </div>
      <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:0.5rem; border-top:1px solid var(--border); padding-top:0.75rem; margin-top:0.5rem;">
        <button type="button" class="btn btn-secondary" onclick="window.hideModal()" style="padding:0.45rem 1.2rem; cursor:pointer;">Batal</button>
        <button type="button" class="btn btn-success" style="font-weight:bold; padding:0.45rem 1.5rem; cursor:pointer;" onclick="window._applyMassAllowance()">💾 Terapkan Pengaturan Massal</button>
      </div>
    </div>
  `, 'modal-md');
};

window._applyMassAllowance = () => {
  const selectElem = document.getElementById('mass-tunj-select');
  const amtElem = document.getElementById('mass-tunj-amt');
  if (!selectElem || !amtElem) {
    showToast('Elemen modal tidak ditemukan!', 'warning');
    return;
  }

  const itemId = selectElem.value;
  const amt = Number(amtElem.value || 0);
  const selectedEmpIds = Array.from(document.querySelectorAll('.mass-emp-chk:checked')).map(c => c.value);

  if (selectedEmpIds.length === 0) {
    showToast('Pilih setidaknya 1 karyawan!', 'warning');
    return;
  }

  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  allData.payroll = allData.payroll || {};
  allData.payroll[month] = allData.payroll[month] || {};
  allData.payroll[month].internal_data = allData.payroll[month].internal_data || {};

  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const dbUpdates = {};

  for (const u of users) {
    const empId = u.emp_id;
    if (selectedEmpIds.includes(empId)) {
      allData.payroll[month].internal_data[empId] = allData.payroll[month].internal_data[empId] || {};

      if (itemId === 'item_gaji_pokok') {
        allData.payroll[month].internal_data[empId].gaji_pokok = amt;
        dbUpdates[`payroll/${month}/internal_data/${empId}/gaji_pokok`] = amt;
      } else if (itemId === 'item_pw_amount') {
        allData.payroll[month].internal_data[empId].pw_enabled = true;
        allData.payroll[month].internal_data[empId].pw_amount = amt;
        dbUpdates[`payroll/${month}/internal_data/${empId}/pw_enabled`] = true;
        dbUpdates[`payroll/${month}/internal_data/${empId}/pw_amount`] = amt;
      } else if (itemId === 'item_overtime_shifts') {
        allData.payroll[month].internal_data[empId].overtime_shifts = amt;
        dbUpdates[`payroll/${month}/internal_data/${empId}/overtime_shifts`] = amt;
      } else if (itemId === 'item_savings_deduction') {
        allData.payroll[month].internal_data[empId].savings_deduction = amt;
        dbUpdates[`payroll/${month}/internal_data/${empId}/savings_deduction`] = amt;
      } else {
        allData.payroll[month].internal_data[empId].tunjangan = allData.payroll[month].internal_data[empId].tunjangan || {};
        allData.payroll[month].internal_data[empId].tunjangan[itemId] = {
          enabled: true,
          amount: amt
        };
        dbUpdates[`payroll/${month}/internal_data/${empId}/tunjangan/${itemId}`] = {
          enabled: true,
          amount: amt
        };
      }
    }
  }

  // Instant UI Feedback (0ms delay!)
  window.hideModal();
  renderCurrentSection();
  showToast(`Pengaturan massal berhasil diterapkan ke ${selectedEmpIds.length} karyawan!`, 'success');

  // Background non-blocking update to Firebase
  update(ref(db), dbUpdates).catch(err => console.error('Firebase update error:', err));
};

window._exportToExcel = (reportType) => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const settings = getPayrollSettings();
  const monthName = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  let csvContent = '\uFEFF';

  if (reportType === 'internal') {
    const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
    const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};
    const bbm = getBbmSalesData(month);
    const pwInt = computePwInternal(bbm);
    const spvAdminCount = users.filter(u => {
      const p = (u.position || '').toLowerCase();
      return p.includes('admin') || p.includes('supervisor') || p.includes('spv');
    }).length || 3;
    const oprCsCount = users.length - spvAdminCount || 11;

    csvContent += `REKAPITULASI GAJI INTERNAL KARYAWAN SPBU GONTOR 54.634.25 MLARAK\n`;
    csvContent += `PERIODE: ${monthName.toUpperCase()}\n\n`;
    csvContent += `No,Nama Karyawan,Jabatan,Masa Kerja,Gaji Pokok UMK,Tunjangan Jabatan,Tunjangan Kinerja,Tunjangan Masa Kerja,Pertamina Way,Lembur,Tabungan,Gaji Bersih (THP)\n`;

    users.forEach((u, idx) => {
      const empId = u.emp_id;
      const empData = monthData[empId] || {};
      const pos = u.position || '-';
      const isSpvAdmin = pos.toLowerCase().includes('admin') || pos.toLowerCase().includes('supervisor') || pos.toLowerCase().includes('spv');
      const defaultPwRound = isSpvAdmin ? 150000 : 100000;
      const tenureMonths = getTenureMonths(u.join_date || u.created_at);

      const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : settings.gaji_pokok_internal_staf);

      const tunjData = empData.tunjangan || {};
      const tunjJabatanEnabled = tunjData['tunj_jabatan'] ? tunjData['tunj_jabatan'].enabled : (pos.toLowerCase() !== 'cleaning service' && !pos.toLowerCase().includes('cs'));
      const tunjJabatanAmt = tunjJabatanEnabled ? Number((tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].amount !== undefined) ? tunjData['tunj_jabatan'].amount : getDefaultPositionAllowance(pos)) : 0;

      const tunjKinerjaEnabled = tunjData['tunj_kinerja'] ? tunjData['tunj_kinerja'].enabled : (tenureMonths >= 6);
      const tunjKinerjaAmt = tunjKinerjaEnabled ? Number((tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].amount !== undefined) ? tunjData['tunj_kinerja'].amount : (tenureMonths >= 6 ? 400000 : 200000)) : 0;

      const tunjMasaKerjaEnabled = tunjData['tunj_masa_kerja'] ? tunjData['tunj_masa_kerja'].enabled : (tenureMonths >= 12);
      const tunjMasaKerjaAmt = tunjMasaKerjaEnabled ? Number((tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].amount !== undefined) ? tunjData['tunj_masa_kerja'].amount : getDefaultTenureAllowance(tenureMonths)) : 0;

      const pwEnabled = empData.pw_enabled !== undefined ? empData.pw_enabled : true;
      const pwAmount = pwEnabled ? Number(empData.pw_amount !== undefined ? empData.pw_amount : defaultPwRound) : 0;

      const otShifts = Number(empData.overtime_shifts || 0);
      const otAmt = otShifts * 50000;

      const tabunganAmt = Number(empData.savings_deduction || 0);

      const gajiKotor = gajiPokok + tunjJabatanAmt + tunjKinerjaAmt + tunjMasaKerjaAmt + pwAmount + otAmt;
      const gajiBersih = gajiKotor - tabunganAmt;

      csvContent += `"${idx + 1}","${u.name}","${pos}","${tenureMonths} Bln","${gajiPokok}","${tunjJabatanAmt}","${tunjKinerjaAmt}","${tunjMasaKerjaAmt}","${pwAmount}","${otAmt}","${tabunganAmt}","${gajiBersih}"\n`;
    });
  } else if (reportType === 'audit') {
    const bbm = getBbmSalesData(month);
    const pwAudit = computePwAudit(bbm);
    const users = getUsers();
    let managerObj = users.find(u => (u.position || '').toLowerCase() === 'manager' || (u.name || '').toLowerCase().includes('pedri'));
    if (!managerObj) managerObj = { emp_id: 'M1', name: settings.name_audit_manager, position: 'Manager' };
    const staffUsers = users.filter(u => u.emp_id !== managerObj.emp_id);
    const auditUsers = [managerObj, ...staffUsers];
    const pwMgrAdminEach = Math.round((pwAudit.total * 0.20) / 2);
    const pwStaffEach = Math.round((pwAudit.total * 0.80) / 13);

    csvContent += `LEMBAR PENGGAJIAN AUDIT PERTAMINA SPBU GONTOR 54.634.25 MLARAK\n`;
    csvContent += `PERIODE: ${monthName.toUpperCase()}\n\n`;
    csvContent += `No,Nama Karyawan,Jabatan,Gaji Pokok UMK,Pertamina Way Audit,Potongan BPJS (1%),THP Audit\n`;

    auditUsers.forEach((u, idx) => {
      const pos = u.position || '-';
      const isMgr = pos.toLowerCase() === 'manager' || u.emp_id === managerObj.emp_id;
      const isAdmin = pos.toLowerCase().includes('admin');
      const gajiPokok = isMgr ? settings.umk_manager : settings.umk_staf;
      const pwVal = (isMgr || isAdmin) ? pwMgrAdminEach : pwStaffEach;
      const bpjsVal = Math.round(gajiPokok * (settings.bpjs_percent / 100));
      const thpVal = gajiPokok + pwVal - bpjsVal;

      csvContent += `"${idx + 1}","${u.name}","${pos}","${gajiPokok}","${pwVal}","${bpjsVal}","${thpVal}"\n`;
    });
  } else if (reportType === 'overtime') {
    const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
    const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};

    csvContent += `REKAPITULASI LEMBURAN KARYAWAN SPBU GONTOR\nPERIODE: ${monthName.toUpperCase()}\n\n`;
    csvContent += `No,Nama Karyawan,Jabatan,Nominal Lembur/Shift,Jumlah Shift Lembur,Total Nominal Lembur\n`;

    users.forEach((u, idx) => {
      const empData = monthData[u.emp_id] || {};
      const shifts = Number(empData.overtime_shifts || 0);
      const otAmt = shifts * 50000;
      csvContent += `"${idx + 1}","${u.name}","${u.position || '-'}","50000","${shifts}","${otAmt}"\n`;
    });
  } else if (reportType === 'savings') {
    const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
    const currentYear = new Date().getFullYear();
    const monthsList = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    csvContent += `REKAPITULASI TABUNGAN KARYAWAN SPBU GONTOR TAHUN ${currentYear}\n\n`;
    csvContent += `No,Nama Karyawan,` + monthsList.map(m => `${m}-${currentYear}`).join(',') + `,Total Tabungan\n`;

    users.forEach((u, idx) => {
      let empTotal = 0;
      const mAmts = monthsList.map((m, mIdx) => {
        const monthKey = `${currentYear}-${(mIdx + 1).toString().padStart(2, '0')}`;
        const mData = (allData.payroll && allData.payroll[monthKey] && allData.payroll[monthKey].internal_data && allData.payroll[monthKey].internal_data[u.emp_id]) || {};
        const tenureMonths = getTenureMonths(u.join_date || u.created_at);
        const amt = Number(mData.savings_deduction !== undefined ? mData.savings_deduction : (tenureMonths >= 6 ? 50000 : 0));
        if (amt > 0) empTotal += amt;
        return amt;
      });

      csvContent += `"${idx + 1}","${u.name}",` + mAmts.join(',') + `,"${empTotal}"\n`;
    });
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Rekap_${reportType.toUpperCase()}_${month}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`File Excel (${reportType.toUpperCase()}) berhasil diunduh!`, 'success');
};

window._setPayrollMonthStatus = async (month, newStatus) => {
  allData.payroll = allData.payroll || {};
  allData.payroll[month] = allData.payroll[month] || {};
  allData.payroll[month].status = newStatus;

  renderCurrentSection();

  const path = `payroll/${month}/status`;
  await set(ref(db, path), newStatus);
  showToast(`Status Penggajian bulan ${month} berhasil diubah ke: ${newStatus === 'FINAL' ? '🔒 TERKUNCI (FINAL)' : '📝 REVISI (DRAFT)'}`, 'success');
};

window._copyPreviousMonthPayroll = async (targetMonth) => {
  const [y, m] = targetMonth.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const prevMonthData = (allData.payroll && allData.payroll[prevMonth] && allData.payroll[prevMonth].internal_data) || null;

  if (!prevMonthData || Object.keys(prevMonthData).length === 0) {
    showToast(`Tidak ada data gaji pada bulan sebelumnya (${prevMonth}) untuk disalin.`, 'warning');
    return;
  }

  const prevMonthName = new Date(prevMonth + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const targetMonthName = new Date(targetMonth + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  if (!confirm(`Apakah Anda yakin ingin menyalin seluruh data komponen gaji dari ${prevMonthName} ke ${targetMonthName}?\n\nData gaji bulan ini yang ada sekarang akan diperbarui dengan data dari bulan lalu.`)) {
    return;
  }

  const copiedData = JSON.parse(JSON.stringify(prevMonthData));

  allData.payroll = allData.payroll || {};
  allData.payroll[targetMonth] = allData.payroll[targetMonth] || {};
  allData.payroll[targetMonth].internal_data = copiedData;

  renderCurrentSection();

  const dbUpdates = {};
  dbUpdates[`payroll/${targetMonth}/internal_data`] = copiedData;

  await update(ref(db), dbUpdates).catch(err => console.error('Firebase copy error:', err));
  showToast(`Berhasil menyalin data gaji dari ${prevMonthName} ke ${targetMonthName}!`, 'success');
};

function renderHistoryPayrollTab() {
  const payrollData = allData.payroll || {};
  const settings = getPayrollSettings();
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');

  const selectedEmpId = window._payrollHistoryEmpId || 'ALL';

  const allMonths = Object.keys(payrollData).filter(m => m.match(/^\d{4}-\d{2}$/)).sort().reverse();

  const monthSummaries = allMonths.map(m => {
    const mData = payrollData[m] || {};
    const intData = mData.internal_data || {};
    const status = mData.status || 'DRAFT';
    const monthName = new Date(m + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    let empCount = 0;
    let totalKotor = 0;
    let totalTabungan = 0;
    let totalBersih = 0;

    users.forEach(u => {
      const empData = intData[u.emp_id] || {};
      const pos = u.position || '-';
      
      const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);
      const tunjData = empData.tunjangan || {};
      const tunjJabatan = (tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].enabled) ? Number(tunjData['tunj_jabatan'].amount || 0) : 0;
      const tunjKinerja = (tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].enabled) ? Number(tunjData['tunj_kinerja'].amount || 0) : 0;
      const tunjMasa = (tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].enabled) ? Number(tunjData['tunj_masa_kerja'].amount || 0) : 0;
      const pwAmt = (empData.pw_enabled) ? Number(empData.pw_amount || 0) : 0;
      const otAmt = Number(empData.overtime_shifts || 0) * 50000;
      
      let customTunjSum = 0;
      settings.custom_allowances.forEach(ca => {
        if (['tunj_jabatan', 'tunj_kinerja', 'tunj_masa_kerja'].includes(ca.id)) return;
        const cItem = tunjData[ca.id] || {};
        if (cItem.enabled) customTunjSum += Number(cItem.amount || 0);
      });

      const totalTambahan = tunjJabatan + tunjKinerja + tunjMasa + pwAmt + otAmt + customTunjSum;
      const gajiKotor = gajiPokok + totalTambahan;
      const tabunganAmt = Number(empData.savings_deduction || 0);
      const gajiBersih = gajiKotor - tabunganAmt;

      if (Object.keys(empData).length > 0 || gajiKotor > 0) empCount++;
      totalKotor += gajiKotor;
      totalTabungan += tabunganAmt;
      totalBersih += gajiBersih;
    });

    return {
      monthKey: m,
      monthName,
      status,
      empCount: empCount || users.length,
      totalKotor,
      totalTabungan,
      totalBersih
    };
  });

  const empOptionsHTML = `<option value="ALL" ${selectedEmpId === 'ALL' ? 'selected' : ''}>-- Rekap Seluruh Perusahaan --</option>` +
    users.map(u => `<option value="${u.emp_id}" ${selectedEmpId === u.emp_id ? 'selected' : ''}>${esc(u.name)} (${esc(u.position)})</option>`).join('');

  let empHistoryTableHTML = '';
  if (selectedEmpId !== 'ALL') {
    const selectedUser = users.find(u => u.emp_id === selectedEmpId);
    if (selectedUser) {
      const empRows = allMonths.map((m, idx) => {
        const mData = payrollData[m] || {};
        const empData = (mData.internal_data && mData.internal_data[selectedEmpId]) || {};
        const monthName = new Date(m + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        
        const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);
        const tunjData = empData.tunjangan || {};
        const tunjJabatan = (tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].enabled) ? Number(tunjData['tunj_jabatan'].amount || 0) : 0;
        const tunjKinerja = (tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].enabled) ? Number(tunjData['tunj_kinerja'].amount || 0) : 0;
        const tunjMasa = (tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].enabled) ? Number(tunjData['tunj_masa_kerja'].amount || 0) : 0;
        const pwAmt = (empData.pw_enabled) ? Number(empData.pw_amount || 0) : 0;
        const otShifts = Number(empData.overtime_shifts || 0);
        const otAmt = otShifts * 50000;
        const tabunganAmt = Number(empData.savings_deduction || 0);

        let customTunjSum = 0;
        settings.custom_allowances.forEach(ca => {
          if (['tunj_jabatan', 'tunj_kinerja', 'tunj_masa_kerja'].includes(ca.id)) return;
          const cItem = tunjData[ca.id] || {};
          if (cItem.enabled) customTunjSum += Number(cItem.amount || 0);
        });

        const totalTunj = tunjJabatan + tunjKinerja + tunjMasa + customTunjSum;
        const gajiKotor = gajiPokok + totalTunj + pwAmt + otAmt;
        const gajiBersih = gajiKotor - tabunganAmt;

        return `<tr>
          <td style="text-align:center; font-weight:bold;">${idx + 1}</td>
          <td><strong>${monthName}</strong></td>
          <td style="text-align:right;">${fmt(gajiPokok)}</td>
          <td style="text-align:right;">${fmt(totalTunj)}</td>
          <td style="text-align:right;">${fmt(pwAmt)}</td>
          <td style="text-align:center;">${otShifts} shift (${fmt(otAmt)})</td>
          <td style="text-align:right; color:#dc2626;">${fmt(tabunganAmt)}</td>
          <td style="text-align:right; font-weight:bold; color:#16a34a; font-size:0.85rem;">${fmt(gajiBersih)}</td>
        </tr>`;
      }).join('');

      empHistoryTableHTML = `
      <div class="card" style="margin-top:1.25rem;">
        <h4 style="font-size:1rem; font-weight:800; color:var(--text-main); margin-bottom:1rem;">
          👤 Riwayat Gaji Individual: ${esc(selectedUser.name)} (${esc(selectedUser.position)})
        </h4>
        <div class="table-responsive">
          <table class="metric-table" style="width:100%; border-collapse:collapse; font-size:0.75rem;">
            <thead>
              <tr>
                <th style="width:35px; text-align:center;">#</th>
                <th>Bulan / Periode</th>
                <th style="text-align:right;">Gaji Pokok</th>
                <th style="text-align:right;">Total Tunjangan</th>
                <th style="text-align:right;">Pertamina Way</th>
                <th style="text-align:center;">Lemburan</th>
                <th style="text-align:right;">Tabungan</th>
                <th style="text-align:right;">THP Bersih</th>
              </tr>
            </thead>
            <tbody>
              ${empRows || '<tr><td colspan="8" class="text-center text-muted p-4">Belum ada riwayat gaji terdaftar untuk karyawan ini.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
    }
  }

  const tableRows = monthSummaries.map((ms, idx) => {
    const isLocked = ms.status === 'FINAL';
    return `<tr>
      <td style="text-align:center; font-weight:bold; padding:8px;">${idx + 1}</td>
      <td style="padding:8px;">
        <strong style="font-size:0.88rem; color:var(--text-main);">${ms.monthName}</strong>
        <div class="text-xs text-muted">Periode: ${ms.monthKey}</div>
      </td>
      <td style="text-align:center; padding:8px;">
        <span class="badge" style="background:${isLocked ? '#fef2f2' : '#eff6ff'}; color:${isLocked ? '#991b1b' : '#1e40af'}; border:1px solid ${isLocked ? '#fca5a5' : '#bfdbfe'}; font-size:0.72rem; padding:3px 8px; font-weight:bold;">
          ${isLocked ? '🔒 FINAL' : '📝 REVISI'}
        </span>
      </td>
      <td style="text-align:center; padding:8px; font-weight:600;">${ms.empCount} Karyawan</td>
      <td style="text-align:right; padding:8px; font-weight:600;">${fmt(ms.totalKotor)}</td>
      <td style="text-align:right; padding:8px; color:#dc2626; font-weight:600;">${fmt(ms.totalTabungan)}</td>
      <td style="text-align:right; padding:8px; font-weight:800; color:#16a34a; font-size:0.85rem;">${fmt(ms.totalBersih)}</td>
      <td style="text-align:center; padding:8px;">
        <div style="display:flex; justify-content:center; gap:0.35rem; flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary" style="padding:0.25rem 0.55rem; font-size:0.72rem; font-weight:bold;" onclick="window._setPayrollMonth('${ms.monthKey}'); window._setPayrollTab('internal');" title="Buka detail payroll bulan ${ms.monthKey}">
            👁️ Buka Periode
          </button>
          <button class="btn btn-sm btn-outline-primary" style="padding:0.25rem 0.45rem; font-size:0.72rem;" onclick="window._setPayrollMonth('${ms.monthKey}'); window._printInternalPayrollSummary();" title="Cetak Rekap 1 Lembar">
            🖨️ Rekap
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `<div class="fade-in">
    <!-- FILTER BAR RIWAYAT GAJI -->
    <div class="card" style="margin-bottom:1.25rem; background:var(--surface); border:1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
        <div>
          <h4 style="font-size:1rem; font-weight:800; color:var(--text-main); margin:0;">📜 Riwayat Penggajian Bulanan SPBU Gontor</h4>
          <p style="font-size:0.78rem; color:var(--text-muted); margin-top:0.15rem; margin-bottom:0;">Lihat & pantau rekapitulasi penggajian bulan demi bulan atau riwayat per karyawan</p>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <label style="font-size:0.8rem; font-weight:700;">Filter Karyawan:</label>
          <select class="form-input form-select" style="padding:0.4rem 0.75rem; font-size:0.8rem; min-width:220px;" onchange="window._payrollHistoryEmpId = this.value; switchSection('payroll');">
            ${empOptionsHTML}
          </select>
        </div>
      </div>
    </div>

    <!-- MAIN HISTORY TABLE -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
        <h4 style="font-size:0.95rem; font-weight:800; color:var(--text-main); margin:0;">📊 Summary Rekapitulasi Gaji Per Bulan (${allMonths.length} Bulan Terdaftar)</h4>
      </div>
      <div class="table-responsive">
        <table class="metric-table" style="width:100%; border-collapse:collapse; font-size:0.78rem;">
          <thead>
            <tr>
              <th style="width:40px; text-align:center;">#</th>
              <th>Bulan / Periode</th>
              <th style="text-align:center; width:100px;">Status</th>
              <th style="text-align:center; width:110px;">Penerima</th>
              <th style="text-align:right;">Total Gaji Kotor</th>
              <th style="text-align:right;">Total Tabungan</th>
              <th style="text-align:right;">Total THP Bersih</th>
              <th style="text-align:center; width:150px;">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || '<tr><td colspan="8" class="text-center text-muted p-4">Belum ada riwayat penggajian terdaftar di database.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    ${empHistoryTableHTML}
  </div>`;
}

function renderInternalPayrollTab() {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const monthStatus = (allData.payroll && allData.payroll[month] && allData.payroll[month].status) || 'DRAFT';
  const isLocked = monthStatus === 'FINAL';
  const bbm = getBbmSalesData(month);
  const pwInt = computePwInternal(bbm);
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};

  const excludedUsersCount = users.filter(u => (monthData[u.emp_id] || {}).excluded === true).length;
  const activeUsersCount = users.length - excludedUsersCount;

  // Count non-manager employees for PW distribution based on configured positions
  const group1Users = users.filter(u => isPositionMatch(u.position, settings.pw_int_group1_positions));
  const group2Users = users.filter(u => !isPositionMatch(u.position, settings.pw_int_group1_positions));

  const g1Count = Math.max(1, group1Users.length);
  const g2Count = Math.max(1, group2Users.length);

  const pctSpv = (settings.pw_int_group1_percent || 20) / 100;
  const pctOpr = (settings.pw_int_group2_percent || 80) / 100;
  const rawPwSpvAdmin = (pwInt.total * pctSpv) / g1Count;
  const rawPwOprCs = (pwInt.total * pctOpr) / g2Count;

  const g1IntPosText = getPositionsLabel(settings.pw_int_group1_positions, settings.pw_int_group1_name);
  const g2IntPosText = getPositionsLabel(settings.pw_int_group2_positions, settings.pw_int_group2_name);

  let totalGajiKotorAll = 0;
  let totalTabunganAll = 0;
  let totalGajiBersihAll = 0;
  let totalLemburAll = 0;

  const empRows = users.map((u, idx) => {
    const empId = u.emp_id;
    const empData = monthData[empId] || {};
    const pos = u.position || '-';
    const isSpvAdmin = isPositionMatch(pos, settings.pw_int_group1_positions);
    const defaultPwRound = isSpvAdmin ? 150000 : 100000;
    
    const pwEnabled = empData.pw_enabled !== undefined ? empData.pw_enabled : false;
    const pwAmount = Number(empData.pw_amount !== undefined ? empData.pw_amount : 0);

    const tenureMonths = getTenureMonths(u.join_date || u.contract_start || u.created_at, month);
    const tenureText = fmtTenureText(tenureMonths);

    // Allowances
    const tunjData = empData.tunjangan || {};

    const tunjJabatanEnabled = tunjData['tunj_jabatan'] ? tunjData['tunj_jabatan'].enabled : false;
    const tunjJabatanAmt = Number((tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].amount !== undefined) ? tunjData['tunj_jabatan'].amount : 0);

    const tunjKinerjaEnabled = tunjData['tunj_kinerja'] ? tunjData['tunj_kinerja'].enabled : false;
    const tunjKinerjaAmt = Number((tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].amount !== undefined) ? tunjData['tunj_kinerja'].amount : 0);

    const tunjMasaKerjaEnabled = tunjData['tunj_masa_kerja'] ? tunjData['tunj_masa_kerja'].enabled : false;
    const tunjMasaKerjaAmt = Number((tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].amount !== undefined) ? tunjData['tunj_masa_kerja'].amount : 0);

    let customTunjSum = 0;
    const customTunjHTML = settings.custom_allowances.map(ca => {
      if (['tunj_jabatan', 'tunj_kinerja', 'tunj_masa_kerja'].includes(ca.id)) return '';
      const cItem = tunjData[ca.id] || {};
      const cEn = cItem.enabled !== undefined ? cItem.enabled : false;
      const cAmt = Number(cItem.amount || 0);
      if (cEn) customTunjSum += cAmt;
      return `<div style="display:flex; align-items:center; gap:0.4rem; font-size:0.75rem; margin-top:0.2rem;">
        <input type="checkbox" ${cEn ? 'checked' : ''} onchange="window._toggleEmpAllowance('${empId}', '${ca.id}', this.checked)">
        <span>${esc(ca.name)}:</span>
        <input type="text" inputmode="numeric" placeholder="0" value="${window._fmtCur(cAmt)}" style="min-width:110px; width:100%; max-width:125px; padding:0.2rem 0.35rem; font-size:0.78rem; text-align:right;" oninput="this.value = window._fmtCur(this.value)" onchange="window._updateEmpAllowanceAmt('${empId}', '${ca.id}', window._parseCur(this.value))">
      </div>`;
    }).join('');

    const isExcluded = empData.excluded === true;

    const otShifts = Number(empData.overtime_shifts || 0);
    const otAmt = otShifts * 50000;

    const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);
    const totalTambahan = (tunjJabatanEnabled ? tunjJabatanAmt : 0) +
                          (tunjKinerjaEnabled ? tunjKinerjaAmt : 0) +
                          (tunjMasaKerjaEnabled ? tunjMasaKerjaAmt : 0) +
                          (pwEnabled ? pwAmount : 0) +
                          otAmt + customTunjSum;
    const gajiKotor = gajiPokok + totalTambahan;
    const tabunganAmt = Number(empData.savings_deduction || 0);
    const gajiBersih = gajiKotor - tabunganAmt;

    if (!isExcluded) {
      totalLemburAll += otAmt;
      totalGajiKotorAll += gajiKotor;
      totalTabunganAll += tabunganAmt;
      totalGajiBersihAll += gajiBersih;
    }

    if (window._hideExcludedPayrollEmps && isExcluded) return '';

    return `<tr style="${isExcluded ? 'background:rgba(239, 68, 68, 0.08); opacity:0.75;' : (isLocked ? 'background:rgba(241, 245, 249, 0.4);' : '')}">
      <td style="text-align:center; font-weight:bold; padding:4px 6px;">${idx + 1}</td>
      <td style="padding:4px 6px;">
        <div style="display:flex; align-items:flex-start; gap:0.35rem;">
          <input type="checkbox" title="${isExcluded ? 'Klik untuk sertakan kembali di penggajian' : 'Klik untuk keluarkan/sembunyikan dari penggajian'}" ${!isExcluded ? 'checked' : ''} ${isLocked ? 'disabled' : ''} onchange="window._saveInternalPayrollItem('${empId}', 'excluded', !this.checked)">
          <div>
            <strong style="${isExcluded ? 'text-decoration:line-through; color:var(--danger); opacity:0.75;' : ''}">${esc(u.name)}</strong>
            ${isExcluded ? '<br><span class="badge badge-warning" style="font-size:0.6rem; padding:1px 4px; margin-top:2px; display:inline-block;">🙈 Disembunyikan (0 Dihitung)</span>' : ''}
            <br><span class="text-xs text-muted" style="${isExcluded ? 'opacity:0.55;' : ''}">ID: ${esc(u.emp_id)} | Masa: ${tenureMonths} Bln</span>
          </div>
        </div>
      </td>
      <td style="padding:4px 6px;"><span class="badge" style="background:var(--bg-color); color:var(--text-main); font-size:0.7rem; padding:2px 5px;">${esc(pos)}</span></td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <input type="text" inputmode="numeric" placeholder="0" value="${window._fmtCur(gajiPokok)}" ${isLocked || isExcluded ? 'disabled' : ''} class="form-input" style="width:100%; min-width:125px; max-width:145px; box-sizing:border-box; padding:0.25rem 0.4rem; font-size:0.82rem; font-weight:700; text-align:right;" oninput="this.value = window._fmtCur(this.value)" onchange="window._saveInternalPayrollItem('${empId}', 'gaji_pokok', window._parseCur(this.value))">
        <div class="text-xs text-muted" style="margin-top:0.1rem; font-size:0.65rem;">${fmt(gajiPokok)}</div>
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <div style="display:flex; align-items:center; gap:0.25rem;">
          <input type="checkbox" ${tunjJabatanEnabled ? 'checked' : ''} ${isLocked || isExcluded ? 'disabled' : ''} onchange="window._toggleEmpAllowance('${empId}', 'tunj_jabatan', this.checked)">
          <span style="font-size:0.7rem; min-width:48px;">Jabatan:</span>
          <input type="text" inputmode="numeric" placeholder="0" value="${window._fmtCur(tunjJabatanAmt)}" ${isLocked || isExcluded ? 'disabled' : ''} class="form-input" style="width:100%; min-width:110px; max-width:125px; box-sizing:border-box; padding:0.2rem 0.35rem; font-size:0.78rem; text-align:right;" oninput="this.value = window._fmtCur(this.value)" onchange="window._updateEmpAllowanceAmt('${empId}', 'tunj_jabatan', window._parseCur(this.value))">
        </div>
        <div style="display:flex; align-items:center; gap:0.25rem; margin-top:0.2rem;">
          <input type="checkbox" ${tunjKinerjaEnabled ? 'checked' : ''} ${isLocked || isExcluded ? 'disabled' : ''} onchange="window._toggleEmpAllowance('${empId}', 'tunj_kinerja', this.checked)">
          <span style="font-size:0.7rem; min-width:48px;">Kinerja:</span>
          <input type="text" inputmode="numeric" placeholder="0" value="${window._fmtCur(tunjKinerjaAmt)}" ${isLocked || isExcluded ? 'disabled' : ''} class="form-input" style="width:100%; min-width:110px; max-width:125px; box-sizing:border-box; padding:0.2rem 0.35rem; font-size:0.78rem; text-align:right;" oninput="this.value = window._fmtCur(this.value)" onchange="window._updateEmpAllowanceAmt('${empId}', 'tunj_kinerja', window._parseCur(this.value))">
        </div>
        <div style="display:flex; align-items:center; gap:0.25rem; margin-top:0.2rem;">
          <input type="checkbox" ${tunjMasaKerjaEnabled ? 'checked' : ''} ${isLocked || isExcluded ? 'disabled' : ''} onchange="window._toggleEmpAllowance('${empId}', 'tunj_masa_kerja', this.checked)">
          <span style="font-size:0.7rem; min-width:48px;">Masa:</span>
          <input type="text" inputmode="numeric" placeholder="0" value="${window._fmtCur(tunjMasaKerjaAmt)}" ${isLocked || isExcluded ? 'disabled' : ''} class="form-input" style="width:100%; min-width:110px; max-width:125px; box-sizing:border-box; padding:0.2rem 0.35rem; font-size:0.78rem; text-align:right;" oninput="this.value = window._fmtCur(this.value)" onchange="window._updateEmpAllowanceAmt('${empId}', 'tunj_masa_kerja', window._parseCur(this.value))">
        </div>
        ${customTunjHTML}
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <div style="display:flex; align-items:center; gap:0.25rem;">
          <input type="checkbox" ${pwEnabled ? 'checked' : ''} ${isLocked || isExcluded ? 'disabled' : ''} onchange="window._saveInternalPayrollItem('${empId}', 'pw_enabled', this.checked)">
          <span style="font-size:0.7rem;">PW:</span>
          <input type="text" inputmode="numeric" placeholder="0" value="${window._fmtCur(pwAmount)}" ${isLocked || isExcluded ? 'disabled' : ''} class="form-input" style="width:100%; min-width:110px; max-width:125px; box-sizing:border-box; padding:0.2rem 0.35rem; font-size:0.78rem; text-align:right;" oninput="this.value = window._fmtCur(this.value)" onchange="window._saveInternalPayrollItem('${empId}', 'pw_amount', window._parseCur(this.value))">
        </div>
        <div class="text-xs text-muted" style="margin-top:0.15rem; font-size:0.65rem;">Est: ${fmt(isSpvAdmin ? rawPwSpvAdmin : rawPwOprCs)}</div>
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <div style="display:flex; align-items:center; gap:0.2rem;">
          <input type="number" placeholder="0" value="${otShifts || ''}" ${isLocked || isExcluded ? 'disabled' : ''} class="form-input" style="width:100%; min-width:55px; max-width:65px; box-sizing:border-box; padding:0.2rem 0.35rem; font-size:0.78rem; text-align:center;" min="0" onchange="window._saveInternalPayrollItem('${empId}', 'overtime_shifts', Number(this.value))">
          <span style="font-size:0.7rem;">Shf</span>
        </div>
        <strong style="color:var(--primary); font-size:0.75rem;">${fmt(otAmt)}</strong>
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <input type="text" inputmode="numeric" placeholder="0" value="${window._fmtCur(tabunganAmt)}" ${isLocked || isExcluded ? 'disabled' : ''} class="form-input" style="width:100%; min-width:110px; max-width:125px; box-sizing:border-box; padding:0.2rem 0.35rem; font-size:0.78rem; text-align:right;" oninput="this.value = window._fmtCur(this.value)" onchange="window._saveInternalPayrollItem('${empId}', 'savings_deduction', window._parseCur(this.value))">
      </td>
      <td style="text-align:right; padding:4px 6px;">
        <div style="font-size:0.68rem; color:var(--text-muted);">Kotor: ${fmt(gajiKotor)}</div>
        <strong style="font-size:0.85rem; color:${isExcluded ? 'var(--danger)' : '#16a34a'};">${isExcluded ? 'Rp 0 (Disembunyikan)' : fmt(gajiBersih)}</strong>
      </td>
    </tr>`;
  }).join('');

  return `<div class="fade-in">
    <!-- STATUS & CONTROLS -->
    <div class="card" style="margin-bottom:1.25rem; background:var(--surface); border:1px solid var(--border);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
        <div style="display:flex; align-items:center; gap:0.5rem;">
          <span class="badge ${isLocked ? 'badge-success' : 'badge-warning'}" style="font-size:0.85rem; padding:0.4rem 0.75rem; font-weight:bold;">
            ${isLocked ? '🔒 TERKUNCI / FINAL' : '✏️ MODE REVISI (DRAFT)'}
          </span>
          <span class="text-xs text-muted">
            ${isLocked ? 'Data gaji bulan ini sudah final & dikunci agar tidak sengaja terubah. Buka kunci jika ingin melakukan revisi.' : 'Mode revisi aktif. Anda dapat mengubah nominal, menyalin dari bulan lalu, atau mengunci gaji jika sudah final.'}
          </span>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
          ${!isLocked ? `
          <button class="btn btn-outline-primary" style="font-weight:700; font-size:0.78rem; background:#fff;" onclick="window._copyPreviousMonthPayroll('${month}')">📋 Salin Gaji dari Bulan Lalu</button>
          <button class="btn btn-success" style="font-weight:800; font-size:0.78rem;" onclick="window._setPayrollMonthStatus('${month}', 'FINAL')">🔒 Kunci & Finalkan Gaji</button>` : `
          <button class="btn btn-outline-danger" style="font-weight:800; font-size:0.78rem; background:#fff;" onclick="window._setPayrollMonthStatus('${month}', 'DRAFT')">🔓 Buka Kunci untuk Revisi</button>`}
        </div>
      </div>
    </div>

    <!-- INPUT PENJUALAN LITER BBM -->
    <div class="card" style="margin-bottom:1.25rem; background:var(--surface); border:1px solid var(--border);">
      <h4 style="font-size:0.95rem; font-weight:800; color:var(--primary); margin-bottom:0.75rem;">⛽ Input Penjualan Liter BBM (Periode: ${month})</h4>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:0.75rem;">
        ${getBbmProducts().map(p => `
          <div>
            <label class="form-label" style="font-size:0.75rem;">${esc(p.name)} (L)</label>
            <input id="bbm-${p.id}" type="number" step="0.01" value="${bbm[p.id] || 0}" ${isLocked ? 'disabled' : ''} class="form-input" style="padding:0.4rem; font-size:0.85rem;">
          </div>
        `).join('')}
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.85rem; flex-wrap:wrap; gap:0.5rem;">
        <div style="font-size:0.8rem; font-weight:700; color:var(--text-main);">
          Total PW Internal: <span style="color:var(--primary); font-size:0.95rem;">${fmt(pwInt.total)}</span> (${esc(g1IntPosText)} ${settings.pw_int_group1_percent}%: ${fmt(pwInt.total * pctSpv)} | ${esc(g2IntPosText)} ${settings.pw_int_group2_percent}%: ${fmt(pwInt.total * pctOpr)})
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          <button class="btn btn-outline-danger" style="padding:0.4rem 0.9rem; font-size:0.8rem;" ${isLocked ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="window._resetPayrollMonthData()">🗑️ Bersihkan Data Bulan Ini</button>
          <button class="btn btn-primary" style="padding:0.4rem 0.9rem; font-size:0.8rem;" ${isLocked ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="window._saveBbmSales()">Simpan Penjualan BBM</button>
        </div>
      </div>
    </div>

    <!-- MAIN PAYROLL TABLE -->
    <div class="card" style="margin-bottom:1.25rem; overflow-x:auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
        <h4 style="font-size:1rem; font-weight:800; color:var(--text-main); margin:0;">📋 Daftar Gaji Internal Karyawan (${activeUsersCount} Aktif${excludedUsersCount > 0 ? ` | ${excludedUsersCount} Disembunyikan` : ''})</h4>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
          ${excludedUsersCount > 0 ? `
          <label style="font-size:0.75rem; font-weight:700; display:flex; align-items:center; gap:0.35rem; cursor:pointer; background:var(--surface); padding:0.25rem 0.6rem; border-radius:4px; border:1px solid var(--border);">
            <input type="checkbox" ${window._hideExcludedPayrollEmps ? 'checked' : ''} onchange="window._hideExcludedPayrollEmps = this.checked; renderCurrentSection();"> 🙈 Sembunyikan Karyawan Non-Gaji (${excludedUsersCount})
          </label>` : ''}
          <button class="btn btn-warning" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" ${isLocked ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="window._openMassAllowanceModal()">⚡ Input Massal Gaji & Tunjangan</button>
          <label style="font-size:0.75rem; font-weight:700;">Tgl Cetak:</label>
          <input type="date" value="${printDate}" class="form-input" style="padding:0.3rem 0.5rem; font-size:0.75rem; width:135px;" onchange="window._setPayrollPrintDate(this.value)">
          <button class="btn btn-primary" style="padding:0.4rem 0.9rem; font-size:0.78rem; font-weight:900; background:linear-gradient(135deg, #6366f1, #a855f7); color:#fff; border:none; box-shadow:0 2px 8px rgba(99,102,241,0.3);" onclick="window._printAllPayrollBundle()">👁️ Pratinjau & Cetak Bundel Gaji (PDF)</button>
          <button class="btn btn-outline-success" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" onclick="window._exportToExcel('internal')">📊 Export Excel</button>
          <button class="btn btn-outline-primary" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="window._printInternalPayrollSummary()">🖨️ Rekap Gaji (1 Hal)</button>
          <button class="btn btn-outline-primary" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="window._printOvertimeSummary()">⏰ Rekap Lemburan</button>
          <button class="btn btn-outline-primary" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="window._printSavingsSummary()">🏦 Rekap Tabungan</button>
          <button class="btn btn-success" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" onclick="window._printEnvelopeSlips('A4', 6)">✂️ Cetak 6 Slip / A4</button>
          <button class="btn btn-success" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" onclick="window._printEnvelopeSlips('F4', 6)">✂️ Cetak 6 Slip / F4</button>
        </div>
      </div>

      <table class="metric-table" style="width:100%; border-collapse:collapse; font-size:0.75rem;">
        <thead>
          <tr>
            <th style="width:25px; text-align:center; padding:4px 6px;">#</th>
            <th style="padding:4px 6px;">Nama & Masa Kerja</th>
            <th style="padding:4px 6px;">Jabatan</th>
            <th style="width:145px; min-width:135px; text-align:right; padding:4px 6px;">Gaji Pokok</th>
            <th style="min-width:210px; padding:4px 6px;">Tunjangan & Nominal</th>
            <th style="width:145px; min-width:135px; padding:4px 6px;">PW Internal</th>
            <th style="width:90px; padding:4px 6px;">Lembur</th>
            <th style="width:135px; min-width:125px; padding:4px 6px;">Tabungan</th>
            <th style="width:145px; min-width:135px; text-align:right; padding:4px 6px;">Gaji Bersih (THP)</th>
          </tr>
        </thead>
        <tbody>${empRows}</tbody>
      </table>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem; padding-top:0.75rem; border-top:2px solid var(--border); font-weight:bold; font-size:0.9rem;">
        <div>Total Pengeluaran Gaji Internal: <span style="color:#16a34a; font-size:1.1rem;">${fmt(totalGajiBersihAll)}</span></div>
        <div style="font-size:0.8rem; color:var(--text-muted);">Total Tabungan: ${fmt(totalTabunganAll)} | Total Lembur: ${fmt(totalLemburAll)}</div>
      </div>
    </div>
  </div>`;
}

function renderAuditPayrollTab() {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const settings = getPayrollSettings();
  const bbm = getBbmSalesData(month);
  const pwAudit = computePwAudit(bbm);

  const users = getUsers();
  let managerObj = users.find(u => (u.position || '').toLowerCase() === 'manager' || (u.name || '').toLowerCase().includes('pedri'));
  if (!managerObj) managerObj = { emp_id: 'M1', name: settings.name_audit_manager, position: 'Manager' };

  const staffUsers = users.filter(u => u.emp_id !== managerObj.emp_id);
  const auditUsers = [managerObj, ...staffUsers];

  const group1AuditUsers = auditUsers.filter(u => isPositionMatch(u.position, settings.pw_aud_group1_positions));
  const group2AuditUsers = auditUsers.filter(u => !isPositionMatch(u.position, settings.pw_aud_group1_positions));

  const g1AudCount = Math.max(1, group1AuditUsers.length);
  const g2AudCount = Math.max(1, group2AuditUsers.length);

  const pctMgrAud = (settings.pw_aud_group1_percent || 20) / 100;
  const pctStafAud = (settings.pw_aud_group2_percent || 80) / 100;
  const pwMgrAdminEach = (pwAudit.total * pctMgrAud) / g1AudCount;
  const pwStaffEach = (pwAudit.total * pctStafAud) / g2AudCount;

  let totalGajiPokokAll = 0, totalPwAll = 0, totalBpjsAll = 0, totalThpAll = 0;

  const g1AudPosText = getPositionsLabel(settings.pw_aud_group1_positions, settings.pw_aud_group1_name);
  const g2AudPosText = getPositionsLabel(settings.pw_aud_group2_positions, settings.pw_aud_group2_name);

  const rowsHTML = auditUsers.map((u, idx) => {
    const pos = u.position || '-';
    const isMgr = pos.toLowerCase() === 'manager' || u.emp_id === managerObj.emp_id;
    const isG1 = isPositionMatch(pos, settings.pw_aud_group1_positions);
    const gajiPokok = isMgr ? settings.umk_manager : settings.umk_staf;
    const pwVal = isG1 ? pwMgrAdminEach : pwStaffEach;
    const bpjsVal = gajiPokok * (settings.bpjs_percent / 100);
    const thpVal = gajiPokok + pwVal - bpjsVal;
    totalGajiPokokAll += gajiPokok; totalPwAll += pwVal; totalBpjsAll += bpjsVal; totalThpAll += thpVal;
    return `<tr>
      <td style="text-align:center; font-weight:bold;">${idx + 1}</td>
      <td><strong>${esc(u.name)}</strong></td>
      <td><span class="badge" style="background:var(--bg-color); color:var(--text-main); font-size:0.75rem;">${esc(pos)}</span></td>
      <td style="text-align:right;">${fmt(gajiPokok)}</td>
      <td style="text-align:right; color:var(--primary); font-weight:bold;">${fmt(pwVal)}</td>
      <td style="text-align:right; color:var(--danger);">${fmt(bpjsVal)}</td>
      <td style="text-align:right; font-weight:bold; color:#16a34a;">${fmt(thpVal)}</td>
    </tr>`;
  }).join('');

  return `<div class="fade-in">
    <div class="card" style="margin-bottom:1.25rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <h4 style="font-size:1.05rem; font-weight:800; color:var(--text-main); margin:0;">📋 Lembar Penggajian & Pertamina Way Mode Audit (${auditUsers.length} Karyawan)</h4>
          <span class="text-xs text-muted">Berisi ${auditUsers.length} Karyawan (Termasuk Manager ${esc(managerObj.name)}) | UMK Staf: ${fmt(settings.umk_staf)} | UMK Manager: ${fmt(settings.umk_manager)}</span>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-primary" style="padding:0.45rem 1rem; font-size:0.8rem; font-weight:900; background:linear-gradient(135deg, #6366f1, #a855f7); color:#fff; border:none; box-shadow:0 2px 8px rgba(99,102,241,0.3);" onclick="window._printAllPayrollBundle()">👁️ Pratinjau & Cetak Bundel Gaji (PDF)</button>
          <button class="btn btn-outline-success" style="font-weight:bold; padding:0.45rem 1rem;" onclick="window._exportToExcel('audit')">📊 Export Excel (Audit)</button>
          <button class="btn btn-primary" style="font-weight:bold; padding:0.45rem 1rem;" onclick="window._printAuditDocuments()">👁️ Pratinjau & Cetak Audit Pertamina (PDF)</button>
        </div>
      </div>
      <div style="background:var(--surface); border:1px solid var(--border); padding:0.75rem; border-radius:var(--radius-md); margin-bottom:1rem; font-size:0.8rem;">
        <strong>Omset Penjualan Liter BBM (Audit):</strong> Total PW Audit = <strong style="color:var(--primary);">${fmt(pwAudit.total)}</strong><br>
        • ${esc(g1AudPosText)} (${settings.pw_aud_group1_percent}%): ${fmt(pwAudit.total * pctMgrAud)} (Per @ ${fmt(pwMgrAdminEach)})<br>
        • ${esc(g2AudPosText)} (${settings.pw_aud_group2_percent}%): ${fmt(pwAudit.total * pctStafAud)} (Per @ ${fmt(pwStaffEach)})
      </div>
      <div style="overflow-x:auto;">
        <table class="metric-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr>
              <th style="width:30px; text-align:center;">NO</th>
              <th>NAMA KARYAWAN</th>
              <th>JABATAN</th>
              <th style="text-align:right;">GAJI POKOK UMK</th>
              <th style="text-align:right;">PERTAMINA WAY</th>
              <th style="text-align:right;">BPJS KESEHATAN (${settings.bpjs_percent}%)</th>
              <th style="text-align:right;">JUMLAH (THP AUDIT)</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
          <tfoot>
            <tr style="font-weight:bold; background:var(--surface);">
              <td colspan="3" style="text-align:right;">TOTAL:</td>
              <td style="text-align:right;">${fmt(totalGajiPokokAll)}</td>
              <td style="text-align:right; color:var(--primary);">${fmt(totalPwAll)}</td>
              <td style="text-align:right; color:var(--danger);">${fmt(totalBpjsAll)}</td>
              <td style="text-align:right; color:#16a34a; font-size:0.95rem;">${fmt(totalThpAll)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>`;
}

function renderPayrollSettingsTab() {
  const s = getPayrollSettings();
  const availPositions = getAvailablePositions();

  const bbmRowsHTML = s.bbm_products.map((b, idx) => {
    return `<tr>
      <td style="text-align:center; font-weight:bold; padding:6px;">${idx + 1}</td>
      <td style="padding:6px;">
        <input type="text" value="${esc(b.name)}" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.8rem; font-weight:600; width:100%; min-width:120px;" onchange="window._updateBbmProduct('${b.id}', 'name', this.value)">
      </td>
      <td style="padding:6px; text-align:center;">
        <div style="display:flex; align-items:center; justify-content:center; gap:0.2rem;">
          <span style="font-size:0.75rem;">Rp</span>
          <input type="number" value="${b.mult_internal}" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.8rem; width:70px; text-align:right;" onchange="window._updateBbmProduct('${b.id}', 'mult_internal', this.value)">
        </div>
      </td>
      <td style="padding:6px; text-align:center;">
        <div style="display:flex; align-items:center; justify-content:center; gap:0.2rem;">
          <span style="font-size:0.75rem;">Rp</span>
          <input type="number" value="${b.mult_audit}" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.8rem; width:70px; text-align:right;" onchange="window._updateBbmProduct('${b.id}', 'mult_audit', this.value)">
        </div>
      </td>
      <td style="text-align:center; padding:6px;">
        <button class="btn btn-outline-danger" style="padding:0.2rem 0.5rem; font-size:0.7rem;" onclick="window._deleteBbmProduct('${b.id}')">🗑️ Hapus</button>
      </td>
    </tr>`;
  }).join('');

  const customListHTML = s.custom_allowances.map(ca => {
    return `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface); border:1px solid var(--border); padding:0.5rem 0.75rem; border-radius:var(--radius-sm); margin-bottom:0.4rem;">
      <span style="font-size:0.85rem; font-weight:600; color:var(--text-main);">${esc(ca.name)}</span>
      ${['tunj_jabatan', 'tunj_kinerja', 'tunj_masa_kerja'].includes(ca.id) ? '<span class="text-xs text-muted">Standar Sistem</span>' : `<button class="btn btn-outline-danger" style="padding:0.2rem 0.5rem; font-size:0.65rem;" onclick="window._deleteCustomAllowance('${ca.id}')">Hapus</button>`}
    </div>`;
  }).join('');

  return `<div class="fade-in">
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1.25rem;">
      <!-- CARD 1: GAJI POKOK & UMK -->
      <div class="card">
        <h4 style="font-size:1rem; font-weight:800; color:var(--primary); margin-bottom:1rem;">💰 Pengaturan Gaji Pokok & UMK</h4>
        <div class="form-group">
          <label class="form-label">Gaji Pokok Internal Staf (Rp)</label>
          <input id="set-gaji-pokok-internal" type="number" value="${s.gaji_pokok_internal_staf}" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Gaji Pokok UMK Staf (Audit) (Rp)</label>
          <input id="set-umk-staf" type="number" value="${s.umk_staf}" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Gaji Pokok UMK Manajer (Audit) (Rp)</label>
          <input id="set-umk-manager" type="number" value="${s.umk_manager}" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Potongan BPJS Kesehatan Audit (%)</label>
          <input id="set-bpjs-percent" type="number" step="0.1" value="${s.bpjs_percent}" class="form-input">
        </div>
        <button class="btn btn-primary" style="width:100%; margin-top:0.5rem;" onclick="window._savePayrollSettings()">Simpan Pengaturan Master Gaji</button>
      </div>

      <!-- CARD 2: PERSENTASE & PEMILIHAN JABATAN PERTAMINA WAY (PW) -->
      <div class="card">
        <h4 style="font-size:1rem; font-weight:800; color:var(--primary); margin-bottom:1rem;">📊 Kelompok Jabatan & Persentase PW</h4>
        
        <div style="background:var(--surface); border:1px solid var(--border); padding:0.75rem; border-radius:var(--radius-md); margin-bottom:1rem;">
          <h5 style="font-size:0.85rem; font-weight:700; color:var(--text-main); margin-bottom:0.5rem;">Mode Internal (Gaji Asli):</h5>
          
          <div style="margin-bottom:0.75rem; padding-bottom:0.6rem; border-bottom:1px dashed var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.3rem;">
              <input id="set-pw-int-g1-name" type="text" value="${esc(s.pw_int_group1_name)}" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.8rem; font-weight:bold; flex:1;" title="Nama Kelompok 1 Internal">
              <div style="display:flex; align-items:center; gap:0.2rem;">
                <input id="set-pw-int-g1-pct" type="number" value="${s.pw_int_group1_percent}" class="form-input" style="width:55px; padding:0.25rem 0.3rem; font-size:0.8rem; font-weight:bold; text-align:right;">
                <span style="font-size:0.78rem; font-weight:bold;">%</span>
              </div>
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">Pilih Jabatan Kelompok 1 Internal:</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.35rem;">
              ${availPositions.map(pos => {
                const isChecked = isPositionMatch(pos, s.pw_int_group1_positions);
                return `<label style="font-size:0.72rem; background:var(--bg-color); padding:2px 6px; border-radius:4px; border:1px solid var(--border); display:flex; align-items:center; gap:0.25rem; cursor:pointer;">
                  <input type="checkbox" class="pw-int-g1-pos" value="${esc(pos)}" ${isChecked ? 'checked' : ''}> ${esc(pos)}
                </label>`;
              }).join('')}
            </div>
          </div>

          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.3rem;">
              <input id="set-pw-int-g2-name" type="text" value="${esc(s.pw_int_group2_name)}" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.8rem; font-weight:bold; flex:1;" title="Nama Kelompok 2 Internal">
              <div style="display:flex; align-items:center; gap:0.2rem;">
                <input id="set-pw-int-g2-pct" type="number" value="${s.pw_int_group2_percent}" class="form-input" style="width:55px; padding:0.25rem 0.3rem; font-size:0.8rem; font-weight:bold; text-align:right;">
                <span style="font-size:0.78rem; font-weight:bold;">%</span>
              </div>
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">Pilih Jabatan Kelompok 2 Internal:</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.35rem;">
              ${availPositions.map(pos => {
                const isChecked = isPositionMatch(pos, s.pw_int_group2_positions);
                return `<label style="font-size:0.72rem; background:var(--bg-color); padding:2px 6px; border-radius:4px; border:1px solid var(--border); display:flex; align-items:center; gap:0.25rem; cursor:pointer;">
                  <input type="checkbox" class="pw-int-g2-pos" value="${esc(pos)}" ${isChecked ? 'checked' : ''}> ${esc(pos)}
                </label>`;
              }).join('')}
            </div>
          </div>
        </div>

        <div style="background:var(--surface); border:1px solid var(--border); padding:0.75rem; border-radius:var(--radius-md); margin-bottom:1rem;">
          <h5 style="font-size:0.85rem; font-weight:700; color:var(--text-main); margin-bottom:0.5rem;">Mode Audit (Dokumen Pertamina):</h5>
          
          <div style="margin-bottom:0.75rem; padding-bottom:0.6rem; border-bottom:1px dashed var(--border);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.3rem;">
              <input id="set-pw-aud-g1-name" type="text" value="${esc(s.pw_aud_group1_name)}" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.8rem; font-weight:bold; flex:1;" title="Nama Kelompok 1 Audit">
              <div style="display:flex; align-items:center; gap:0.2rem;">
                <input id="set-pw-aud-g1-pct" type="number" value="${s.pw_aud_group1_percent}" class="form-input" style="width:55px; padding:0.25rem 0.3rem; font-size:0.8rem; font-weight:bold; text-align:right;">
                <span style="font-size:0.78rem; font-weight:bold;">%</span>
              </div>
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">Pilih Jabatan Kelompok 1 Audit:</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.35rem;">
              ${availPositions.map(pos => {
                const isChecked = isPositionMatch(pos, s.pw_aud_group1_positions);
                return `<label style="font-size:0.72rem; background:var(--bg-color); padding:2px 6px; border-radius:4px; border:1px solid var(--border); display:flex; align-items:center; gap:0.25rem; cursor:pointer;">
                  <input type="checkbox" class="pw-aud-g1-pos" value="${esc(pos)}" ${isChecked ? 'checked' : ''}> ${esc(pos)}
                </label>`;
              }).join('')}
            </div>
          </div>

          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.3rem;">
              <input id="set-pw-aud-g2-name" type="text" value="${esc(s.pw_aud_group2_name)}" class="form-input" style="padding:0.25rem 0.4rem; font-size:0.8rem; font-weight:bold; flex:1;" title="Nama Kelompok 2 Audit">
              <div style="display:flex; align-items:center; gap:0.2rem;">
                <input id="set-pw-aud-g2-pct" type="number" value="${s.pw_aud_group2_percent}" class="form-input" style="width:55px; padding:0.25rem 0.3rem; font-size:0.8rem; font-weight:bold; text-align:right;">
                <span style="font-size:0.78rem; font-weight:bold;">%</span>
              </div>
            </div>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:0.25rem;">Pilih Jabatan Kelompok 2 Audit:</div>
            <div style="display:flex; flex-wrap:wrap; gap:0.35rem;">
              ${availPositions.map(pos => {
                const isChecked = isPositionMatch(pos, s.pw_aud_group2_positions);
                return `<label style="font-size:0.72rem; background:var(--bg-color); padding:2px 6px; border-radius:4px; border:1px solid var(--border); display:flex; align-items:center; gap:0.25rem; cursor:pointer;">
                  <input type="checkbox" class="pw-aud-g2-pos" value="${esc(pos)}" ${isChecked ? 'checked' : ''}> ${esc(pos)}
                </label>`;
              }).join('')}
            </div>
          </div>
        </div>

        <button class="btn btn-primary" style="width:100%;" onclick="window._savePayrollSettings()">Simpan Pengaturan Jabatan & Persentase</button>
      </div>

      <!-- CARD 3: TTD & PENANDATANGAN -->
      <div class="card">
        <h4 style="font-size:1rem; font-weight:800; color:var(--primary); margin-bottom:1rem;">✍️ Penandatangan Dokumen & Manajer</h4>
        <div class="form-group">
          <label class="form-label">Nama Manajer Keuangan (Penandatangan Slip Amplop)</label>
          <input id="set-name-finance" type="text" value="${esc(s.name_finance_manager)}" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Nama Supervisor Penandatangan Audit</label>
          <input id="set-name-spv" type="text" value="${esc(s.name_audit_supervisor)}" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">Nama Manajer (Karyawan ke-15 Audit)</label>
          <input id="set-name-manager" type="text" value="${esc(s.name_audit_manager)}" class="form-input">
        </div>
        <button class="btn btn-primary" style="width:100%; margin-top:0.5rem;" onclick="window._savePayrollSettings()">Simpan Nama Penandatangan</button>
      </div>

      <!-- CARD 4: MANAJEMEN PRODUK BBM & MULTIPLIER -->
      <div class="card" style="grid-column: 1 / -1;">
        <h4 style="font-size:1rem; font-weight:800; color:var(--primary); margin-bottom:0.5rem;">⛽ Master Produk BBM & Pengali Pertamina Way (PW)</h4>
        <p style="font-size:0.78rem; color:var(--text-muted); margin-bottom:1rem;">Tambah/edit/hapus jenis BBM dan ubah nominal insentif per liter untuk Mode Internal maupun Mode Audit.</p>

        <!-- TABLE PRODUK BBM -->
        <div class="table-responsive" style="margin-bottom:1rem;">
          <table class="metric-table" style="width:100%; border-collapse:collapse; font-size:0.78rem;">
            <thead>
              <tr>
                <th style="width:35px; text-align:center;">#</th>
                <th>Nama Produk BBM</th>
                <th style="text-align:center; width:130px;">Pengali Internal (Rp/L)</th>
                <th style="text-align:center; width:130px;">Pengali Audit (Rp/L)</th>
                <th style="text-align:center; width:90px;">Aksi</th>
              </tr>
            </thead>
            <tbody>${bbmRowsHTML}</tbody>
          </table>
        </div>

        <!-- FORM TAMBAH PRODUK BBM BARU -->
        <div style="background:var(--surface); border:1px solid var(--border); padding:0.85rem; border-radius:var(--radius-md);">
          <strong style="font-size:0.82rem; color:var(--text-main); display:block; margin-bottom:0.5rem;">+ Tambah Produk BBM Baru:</strong>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
            <input id="new-bbm-name" type="text" class="form-input" placeholder="Nama BBM (misal: Pertamax Green 95)" style="flex:2; min-width:180px; padding:0.4rem 0.6rem; font-size:0.8rem;">
            <input id="new-bbm-mult-int" type="number" class="form-input" placeholder="Pengali Int (Rp)" style="flex:1; min-width:110px; padding:0.4rem 0.6rem; font-size:0.8rem;">
            <input id="new-bbm-mult-aud" type="number" class="form-input" placeholder="Pengali Aud (Rp)" style="flex:1; min-width:110px; padding:0.4rem 0.6rem; font-size:0.8rem;">
            <button class="btn btn-success" style="padding:0.4rem 0.85rem; font-size:0.8rem; font-weight:bold;" onclick="window._addBbmProduct()">+ Tambah BBM</button>
          </div>
        </div>
      </div>

      <!-- CARD 5: TUNJANGAN CUSTOM INTERNAL -->
      <div class="card" style="grid-column: 1 / -1;">
        <h4 style="font-size:1rem; font-weight:800; color:var(--primary); margin-bottom:1rem;">🎁 Manajemen Jenis Tunjangan (Internal)</h4>
        <div style="display:flex; gap:0.5rem; margin-bottom:1rem; flex-wrap:wrap;">
          <input id="new-tunj-name" type="text" class="form-input" placeholder="Nama Tunjangan Baru (misal: Tunjangan Shift Malam)" style="flex:1;">
          <button class="btn btn-success" onclick="window._addCustomAllowance()">+ Tambah Tunjangan</button>
        </div>
        <div>${customListHTML}</div>
      </div>
    </div>
  </div>`;
}

// ==========================================
// PRINT ROUTINES FOR PAYROLL MODULE
// ==========================================

window._printAllPayrollBundle = () => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};
  const users = getUsers().filter(u => {
    if ((u.position || '').toLowerCase() === 'manager') return false;
    const empData = monthData[u.emp_id] || {};
    return !empData.excluded;
  });
  const bbm = getBbmSalesData(month);
  const pwInt = computePwInternal(bbm);
  const pwAudit = computePwAudit(bbm);

  const monthName = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const monthNameUpper = monthName.toUpperCase();
  const formattedPrintDate = new Date(printDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const currentYear = new Date().getFullYear();

  const group1Users = users.filter(u => isPositionMatch(u.position, settings.pw_int_group1_positions));
  const group2Users = users.filter(u => !isPositionMatch(u.position, settings.pw_int_group1_positions));

  const g1Count = Math.max(1, group1Users.length);
  const g2Count = Math.max(1, group2Users.length);

  const pctSpv = (settings.pw_int_group1_percent || 20) / 100;
  const pctOpr = (settings.pw_int_group2_percent || 80) / 100;
  const rawPwSpvAdmin = (pwInt.total * pctSpv) / g1Count;
  const rawPwOprCs = (pwInt.total * pctOpr) / g2Count;

  const g1IntPosText = getPositionsLabel(settings.pw_int_group1_positions, settings.pw_int_group1_name);
  const g2IntPosText = getPositionsLabel(settings.pw_int_group2_positions, settings.pw_int_group2_name);
  const g1AudPosText = getPositionsLabel(settings.pw_aud_group1_positions, settings.pw_aud_group1_name);
  const g2AudPosText = getPositionsLabel(settings.pw_aud_group2_positions, settings.pw_aud_group2_name);

  // --- 1. SLIP GAJI AMPLOP (6 SLIP / PAGE) ---
  let slipsHTML = '';
  let currentPageSlips = [];
  users.forEach((u, idx) => {
    const empId = u.emp_id;
    const empData = monthData[empId] || {};
    const pos = u.position || '-';
    const pwEnabled = empData.pw_enabled !== undefined ? empData.pw_enabled : false;
    const pwAmount = Number(empData.pw_amount !== undefined ? empData.pw_amount : 0);

    const tunjData = empData.tunjangan || {};
    const tunjJabatanEnabled = tunjData['tunj_jabatan'] ? tunjData['tunj_jabatan'].enabled : false;
    const tunjJabatanAmt = Number((tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].amount !== undefined) ? tunjData['tunj_jabatan'].amount : 0);
    const tunjKinerjaEnabled = tunjData['tunj_kinerja'] ? tunjData['tunj_kinerja'].enabled : false;
    const tunjKinerjaAmt = Number((tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].amount !== undefined) ? tunjData['tunj_kinerja'].amount : 0);
    const tunjMasaKerjaEnabled = tunjData['tunj_masa_kerja'] ? tunjData['tunj_masa_kerja'].enabled : false;
    const tunjMasaKerjaAmt = Number((tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].amount !== undefined) ? tunjData['tunj_masa_kerja'].amount : 0);

    let tambahanRows = '';
    let itemIdx = 1;
    if (tunjJabatanEnabled && tunjJabatanAmt > 0) tambahanRows += `<tr><td>:${itemIdx++} Tunjangan Jabatan</td><td style="text-align:right;">${fmt(tunjJabatanAmt)}</td></tr>`;
    if (tunjKinerjaEnabled && tunjKinerjaAmt > 0) tambahanRows += `<tr><td>:${itemIdx++} Tunjangan Kinerja</td><td style="text-align:right;">${fmt(tunjKinerjaAmt)}</td></tr>`;
    if (tunjMasaKerjaEnabled && tunjMasaKerjaAmt > 0) tambahanRows += `<tr><td>:${itemIdx++} Tunjangan Masa Kerja</td><td style="text-align:right;">${fmt(tunjMasaKerjaAmt)}</td></tr>`;
    if (pwEnabled && pwAmount > 0) tambahanRows += `<tr><td>:${itemIdx++} Pertamina Way</td><td style="text-align:right;">${fmt(pwAmount)}</td></tr>`;

    const otShifts = Number(empData.overtime_shifts || 0);
    const otAmt = otShifts * 50000;
    if (otAmt > 0) tambahanRows += `<tr><td>:${itemIdx++} Lembur Kerja</td><td style="text-align:right;">${fmt(otAmt)}</td></tr>`;

    settings.custom_allowances.forEach(ca => {
      if (['tunj_jabatan', 'tunj_kinerja', 'tunj_masa_kerja'].includes(ca.id)) return;
      const cItem = tunjData[ca.id] || {};
      if (cItem.enabled && Number(cItem.amount || 0) > 0) {
        tambahanRows += `<tr><td>:${itemIdx++} ${esc(ca.name)}</td><td style="text-align:right;">${fmt(Number(cItem.amount))}</td></tr>`;
      }
    });

    const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);
    const totalTambahan = (tunjJabatanEnabled ? tunjJabatanAmt : 0) + (tunjKinerjaEnabled ? tunjKinerjaAmt : 0) + (tunjMasaKerjaEnabled ? tunjMasaKerjaAmt : 0) + (pwEnabled ? pwAmount : 0) + otAmt;
    const gajiKotor = gajiPokok + totalTambahan;
    const tabunganAmt = Number(empData.savings_deduction || 0);
    const gajiBersih = gajiKotor - tabunganAmt;

    const slipHTML = `<div class="slip-card">
      <div class="slip-top-bar"></div>
      <div class="slip-header-area">
        <div class="company-badge"><div><div class="company-name">SPBU GONTOR</div><div class="company-id">54.634.25</div></div></div>
        <div class="period-badge">${monthName}</div>
      </div>
      <div class="slip-body">
        <div class="emp-info-row"><div class="emp-name">${esc(u.name)}</div><div class="emp-pos">${esc(pos)}</div></div>
        <div class="detail-section">
          <div class="detail-row main-row"><span>Gaji Pokok</span><span class="amount">${fmt(gajiPokok)}</span></div>
          ${tambahanRows ? `<div class="tambahan-label">Tambahan :</div><table class="tambahan-tbl">${tambahanRows}</table>` : ''}
          <div class="detail-row subtotal-row"><span>Total Pendapatan</span><span class="amount">${fmt(gajiKotor)}</span></div>
          ${tabunganAmt > 0 ? `<div class="detail-row deduction-row"><span>Potongan Tabungan</span><span class="amount deduction">- ${fmt(tabunganAmt)}</span></div>` : ''}
        </div>
      </div>
      <div class="slip-footer-area">
        <div class="net-pay-bar"><div class="net-label">GAJI BERSIH</div><div class="net-amount">${fmt(gajiBersih)}</div></div>
        <div class="sign-area">
          <div class="sign-date">Ponorogo, ${formattedPrintDate}</div>
          <div class="sign-title">Manajer Keuangan</div>
          <div class="sign-space"></div>
          <div class="sign-name">${esc(settings.name_finance_manager)}</div>
        </div>
      </div>
    </div>`;

    currentPageSlips.push(slipHTML);
    if (currentPageSlips.length === 4 || idx === users.length - 1) {
      slipsHTML += `<div class="page-grid per-page-4">${currentPageSlips.join('')}</div>`;
      currentPageSlips = [];
    }
  });

  // --- 2. REKAP GAJI INTERNAL ---
  let totalGajiPokok = 0, totalTunjJabatan = 0, totalTunjKinerja = 0, totalTunjMasaKerja = 0, totalPw = 0, totalLembur = 0, totalTabungan = 0, totalBersih = 0;
  const rekapRows = users.map((u, idx) => {
    const empId = u.emp_id;
    const empData = monthData[empId] || {};
    const pos = u.position || '-';
    const pwEnabled = empData.pw_enabled !== undefined ? empData.pw_enabled : false;
    const pwAmount = Number(empData.pw_amount !== undefined ? empData.pw_amount : 0);
    const tenureMonths = getTenureMonths(u.join_date || u.contract_start || u.created_at, month);
    const tenureText = fmtTenureText(tenureMonths);

    const tunjData = empData.tunjangan || {};
    const jAmt = tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].enabled ? Number(tunjData['tunj_jabatan'].amount || 0) : 0;
    const kAmt = tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].enabled ? Number(tunjData['tunj_kinerja'].amount || 0) : 0;
    const mkAmt = tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].enabled ? Number(tunjData['tunj_masa_kerja'].amount || 0) : 0;
    const pwVal = pwEnabled ? pwAmount : 0;
    const otAmt = Number(empData.overtime_shifts || 0) * 50000;
    const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);
    const tabunganAmt = Number(empData.savings_deduction || 0);
    const gajiKotor = gajiPokok + jAmt + kAmt + mkAmt + pwVal + otAmt;
    const gajiBersih = gajiKotor - tabunganAmt;

    totalGajiPokok += gajiPokok; totalTunjJabatan += jAmt; totalTunjKinerja += kAmt; totalTunjMasaKerja += mkAmt; totalPw += pwVal; totalLembur += otAmt; totalTabungan += tabunganAmt; totalBersih += gajiBersih;

    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><strong>${esc(u.name)}</strong></td>
      <td style="text-align:center;">UMK 100%</td>
      <td style="text-align:center;">${tenureText}</td>
      <td style="text-align:right;">${fmt(gajiPokok)}</td>
      <td style="text-align:right;">${fmt(jAmt)}</td>
      <td style="text-align:right;">${fmt(kAmt)}</td>
      <td style="text-align:right;">${fmt(mkAmt)}</td>
      <td style="text-align:right;">${fmt(pwVal)}</td>
      <td style="text-align:right;">${fmt(otAmt)}</td>
      <td style="text-align:right;">${fmt(tabunganAmt)}</td>
      <td style="text-align:right; font-weight:bold;">${fmt(gajiBersih)}</td>
    </tr>`;
  }).join('');

  // --- 3. REKAP LEMBURAN ---
  let totalOtAmtAll = 0;
  const otRows = users.map((u, idx) => {
    const empData = monthData[u.emp_id] || {};
    const shifts = Number(empData.overtime_shifts || 0);
    const otAmt = shifts * 50000;
    totalOtAmtAll += otAmt;
    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><strong>${esc(u.name)}</strong></td>
      <td style="text-align:center;">${esc((u.position || '-').toUpperCase())}</td>
      <td style="text-align:right;">50,000</td>
      <td style="text-align:center;">${shifts} Shift</td>
      <td style="text-align:right; font-weight:bold;">${otAmt > 0 ? fmt(otAmt) : 'Rp -'}</td>
    </tr>`;
  }).join('');

  // --- 4. REKAP TABUNGAN ---
  const monthsList = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let totalAllSavings = 0;
  const tabunganRows = users.map((u, idx) => {
    let empTotal = 0;
    const monthCells = monthsList.map((m, mIdx) => {
      const amt = getEmployeeSavingsForSpecificMonth(u.emp_id, mIdx, currentYear);
      if (amt > 0) empTotal += amt;
      return `<td style="text-align:right;">${amt > 0 ? fmt(amt) : 'Rp -'}</td>`;
    }).join('');
    totalAllSavings += empTotal;
    return `<tr><td style="text-align:center;">${idx + 1}</td><td><strong>${esc(u.name)}</strong></td>${monthCells}<td style="text-align:right; font-weight:bold;">${fmt(empTotal)}</td></tr>`;
  }).join('');

  // --- 5. DOKUMEN AUDIT PERTAMINA (3 HALAMAN) ---
  const allUsers = getUsers();
  let managerObj = allUsers.find(u => (u.position || '').toLowerCase() === 'manager' || (u.name || '').toLowerCase().includes('pedri'));
  if (!managerObj) managerObj = { emp_id: 'M1', name: settings.name_audit_manager, position: 'Manager' };
  const staffUsers = allUsers.filter(u => u.emp_id !== managerObj.emp_id);
  const auditUsers = [managerObj, ...staffUsers];
  const group1AuditUsers = auditUsers.filter(u => isPositionMatch(u.position, settings.pw_aud_group1_positions));
  const group2AuditUsers = auditUsers.filter(u => !isPositionMatch(u.position, settings.pw_aud_group1_positions));

  const g1AudCount = Math.max(1, group1AuditUsers.length);
  const g2AudCount = Math.max(1, group2AuditUsers.length);

  const pctMgrAud = (settings.pw_aud_group1_percent || 20) / 100;
  const pctStafAud = (settings.pw_aud_group2_percent || 80) / 100;
  const pwMgrAdminEach = (pwAudit.total * pctMgrAud) / g1AudCount;
  const pwStaffEach = (pwAudit.total * pctStafAud) / g2AudCount;

  let totalGajiPokokAll = 0, totalPwAll = 0, totalBpjsAll = 0, totalThpAll = 0;

  const auditH3Rows = auditUsers.map((u, idx) => {
    const pos = u.position || '-';
    const isMgr = pos.toLowerCase() === 'manager' || u.emp_id === managerObj.emp_id;
    const isG1 = isPositionMatch(pos, settings.pw_aud_group1_positions);
    const gajiPokok = isMgr ? settings.umk_manager : settings.umk_staf;
    const pwVal = isG1 ? pwMgrAdminEach : pwStaffEach;
    const bpjsVal = gajiPokok * (settings.bpjs_percent / 100);
    const thpVal = gajiPokok + pwVal - bpjsVal;

    totalGajiPokokAll += gajiPokok; totalPwAll += pwVal; totalBpjsAll += bpjsVal; totalThpAll += thpVal;

    const isOddRow = (idx % 2 === 0);
    const nextUserExists = (idx + 1 < auditUsers.length);
    let ttdCells = '';
    if (isOddRow) {
      const leftNum = idx + 1;
      const rightNum = idx + 2;
      const rSpan = nextUserExists ? 'rowspan="2"' : 'rowspan="1"';
      const rightCellContent = nextUserExists ? `${rightNum}.` : '';
      ttdCells = `<td ${rSpan} style="width:70px; vertical-align:top; padding:6px 8px; border:1px solid #cbd5e1; font-weight:700; color:#334155; font-size:9.5px; background:#fff;">${leftNum}.</td>
      <td ${rSpan} style="width:70px; vertical-align:top; padding:6px 8px; border:1px solid #cbd5e1; font-weight:700; color:#334155; font-size:9.5px; background:#fff;">${rightCellContent}</td>`;
    }

    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><strong>${esc(u.name)}</strong></td>
      <td style="text-align:center;">${esc(pos.toUpperCase())}</td>
      <td style="text-align:right;">${fmt(gajiPokok)}</td>
      <td style="text-align:right;">${fmt(pwVal)}</td>
      <td style="text-align:right;">${fmt(bpjsVal)}</td>
      <td style="text-align:right; font-weight:800; color:#0f172a;">${fmt(thpVal)}</td>
      ${ttdCells}
    </tr>`;
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Bundel Laporan Penggajian Lengkap - SPBU Gontor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>
      function downloadPDFDirect() {
        const btn = document.getElementById('btn-dl-direct');
        const origText = btn ? btn.innerHTML : '📥 UNDUH FILE PDF DIRECT';
        if (btn) { btn.innerHTML = '⏳ Mengunduh PDF...'; btn.disabled = true; }
        
        function restoreUI(msg) {
          if (btn) {
            btn.innerHTML = msg || origText;
            setTimeout(function() { btn.innerHTML = origText; btn.disabled = false; }, 2500);
          }
        }

        let attempts = 0;
        function runGen() {
          attempts++;
          const pdfLib = window.html2pdf || (window.opener && window.opener.html2pdf);
          const el = document.getElementById('print-area') || document.body;

          if (typeof pdfLib !== 'undefined') {
            const opt = {
              margin: 3,
              filename: 'Laporan_Penggajian_Lengkap_SPBU_Gontor_${month}.pdf',
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
              pagebreak: { mode: ['css', 'legacy'] }
            };

            pdfLib().set(opt).from(el).save().then(function() {
              restoreUI('✅ PDF Terunduh!');
            }).catch(function(err) {
              console.error(err);
              restoreUI();
              window.print();
            });
          } else if (attempts < 10) {
            setTimeout(runGen, 300);
          } else {
            restoreUI();
            window.print();
          }
        }

        runGen();
      }
    </script>
    <style>
      @page { size: A4 landscape; margin: 4mm 6mm; }
      * { -webkit-print-color-adjust: exact ; print-color-adjust: exact ; box-sizing: border-box; margin: 0; padding: 0; }
      html, body { font-family: 'Inter', sans-serif; color: #0f172a ; background-color: #ffffff ; background: #ffffff ; padding: 0; margin: 0; -webkit-font-smoothing: antialiased; }
      #print-area { background-color: #ffffff ; background: #ffffff ; color: #0f172a ; padding: 6px; box-sizing: border-box; width: 100%; min-height: 100vh; }

      .page-break { page-break-before: always; }
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: #0f172a ; color: #ffffff ; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .header-card * { color: #ffffff ; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #ffffff ; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff ; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 ; }
      .period-badge { background: rgba(255,255,255,0.18) ; color: #ffffff ; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.5px; }
      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a ; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5px; background-color: #ffffff ; background: #ffffff ; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 5px 6px; color: #0f172a ; background-color: #ffffff ; }
      th { background-color: #0f172a ; background: #0f172a ; color: #ffffff ; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9px; letter-spacing: 0.3px; }
      tfoot td { background-color: #f1f5f9 ; background: #f1f5f9 ; font-weight: 800; color: #0f172a ; }

      .page-grid { display: grid; grid-template-columns: 1fr 1fr; grid-gap: 6px; width: 100%; min-height: 95vh; padding: 4px; box-sizing: border-box; page-break-after: always; }
      .per-page-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
      .per-page-6 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; }
      .slip-card { border: 1px solid #e2e8f0 ; border-radius: 8px; display: flex; flex-direction: column; background-color: #ffffff ; background: #ffffff ; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; position: relative; color: #0f172a ; }
      .slip-top-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); }
      .slip-header-area { background-color: #0f172a ; background: #0f172a ; padding: 7px 10px; display: flex; justify-content: space-between; align-items: center; }
      .slip-header-area * { color: #ffffff ; }
      .company-badge { display: flex; align-items: center; gap: 6px; }
      .company-icon { width: 26px; height: 26px; background: linear-gradient(135deg, #f59e0b, #ef4444) ; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #fff ; }
      .company-name { font-size: 12px; font-weight: 800; color: #fff ; letter-spacing: 0.5px; }
      .company-id { font-size: 9px; color: #94a3b8 ; font-weight: 500; }
      .slip-body { padding: 7px 10px 4px; flex: 1; background-color: #ffffff ; }
      .emp-info-row { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 5px; border-bottom: 1.5px solid #e2e8f0; margin-bottom: 5px; }
      .emp-name { font-size: 11px; font-weight: 800; color: #0f172a ; }
      .emp-pos { font-size: 8px; font-weight: 700; color: #4338ca ; background-color: #e0e7ff ; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; }
      .detail-section { font-size: 9.5px; }
      .detail-row { display: flex; justify-content: space-between; align-items: center; padding: 2px 0; }
      .detail-row .amount { font-weight: 700; font-variant-numeric: tabular-nums; color: #0f172a ; }
      .main-row { color: #0f172a ; font-weight: 600; }
      .tambahan-label { font-size: 8.5px; font-weight: 700; color: #475569 ; text-transform: uppercase; margin: 3px 0 1px; }
      .tambahan-tbl { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 2px; }
      .tambahan-tbl td { padding: 1px 0 1px 6px; color: #0f172a ; background-color: #ffffff ; }
      .subtotal-row { border-top: 1.5px solid #cbd5e1; margin-top: 3px; padding-top: 3px; font-weight: 800; color: #0f172a ; font-size: 10px; }
      .deduction-row { color: #dc2626 ; font-size: 9px; padding: 2px 0; }
      .deduction-row * { color: #dc2626 ; }
      .slip-footer-area { padding: 0 10px 7px; background-color: #ffffff ; }
      .net-pay-bar { background-color: #059669 ; background: #059669 ; border-radius: 5px; padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
      .net-pay-bar * { color: #ffffff ; }
      .net-label { color: #ffffff ; font-size: 8.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
      .net-amount { color: #ffffff ; font-size: 13px; font-weight: 900; }
      .sign-area { text-align: right; font-size: 8px; color: #475569 ; line-height: 1.35; }
      .sign-date { font-weight: 500; color: #475569 ; }
      .sign-title { font-weight: 600; color: #475569 ; margin-top: 2px; }
      .sign-space { height: 50px; }
      .sign-name { font-weight: 800; color: #0f172a ; text-decoration: underline; font-size: 8.5px; }

      .toolbar-btn { padding: 8px 18px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-family: 'Inter', sans-serif; transition: all 0.2s; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:#0f172a; border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff; font-weight:700;">🖨️ CETAK PDF / PRINT</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div id="print-area">

    <!-- SEKSI 1: SLIP GAJI AMPLOP -->
    ${slipsHTML}

    <!-- SEKSI 2: REKAP GAJI INTERNAL -->
    <div class="page-break"></div>
    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box"><div><div class="brand-title">SPBU GONTOR 54.634.25 MLARAK</div><div class="brand-sub">Laporan Rekapitulasi Penerimaan Gaji Internal Karyawan</div></div></div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>
    <div class="doc-title-bar">REKAPITULASI PENERIMAAN GAJI KARYAWAN INTERNAL</div>
    <table>
      <thead>
        <tr><th style="width:25px;">No</th><th>Nama</th><th>Keterangan</th><th>Masa Kerja</th><th>Gaji Pokok</th><th>Tunjangan Jabatan</th><th>Tunjangan Kinerja</th><th>Tunjangan Masa Kerja</th><th>Pertamina Way</th><th>Lembur Kerja</th><th>Tabungan</th><th>Penerimaan Gaji Bersih Karyawan</th></tr>
      </thead>
      <tbody>${rekapRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="text-align:right;">TOTAL</td>
          <td style="text-align:right;">${fmt(totalGajiPokok)}</td>
          <td style="text-align:right;">${fmt(totalTunjJabatan)}</td>
          <td style="text-align:right;">${fmt(totalTunjKinerja)}</td>
          <td style="text-align:right;">${fmt(totalTunjMasaKerja)}</td>
          <td style="text-align:right;">${fmt(totalPw)}</td>
          <td style="text-align:right;">${fmt(totalLembur)}</td>
          <td style="text-align:right;">${fmt(totalTabungan)}</td>
          <td style="text-align:right; color:#059669; font-size:11px;">${fmt(totalBersih)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="display:flex; justify-content:space-between; margin-top:20px; font-size:9.5px; color:#475569;">
      <div><strong style="color:#0f172a;">TOTAL PENGELUARAN GAJI UNTUK KARYAWAN:</strong> <span style="font-size:12px; font-weight:bold; background:#facc15; color:#0f172a; padding:3px 8px; border-radius:4px; margin-left:10px;">${fmt(totalBersih + totalTabungan)}</span></div>
      <div style="text-align:right;">Ponorogo, ${formattedPrintDate}<br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_finance_manager)}</strong><br><span>Manajer Keuangan</span></div>
    </div>

    <!-- SEKSI 3: REKAP LEMBURAN -->
    <div class="page-break"></div>
    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box"><div><div class="brand-title">SPBU GONTOR 54.634.25 MLARAK</div><div class="brand-sub">Laporan Rekapitulasi Lembur Kerja Karyawan</div></div></div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>
    <div class="doc-title-bar">REKAPITULASI LEMBURAN KARYAWAN</div>
    <table>
      <thead>
        <tr><th style="width:30px;">NO</th><th>NAMA</th><th>JABATAN</th><th>NOMINAL LEMBUR / SHIFT</th><th>JUMLAH LEMBUR 1 BULAN</th><th style="text-align:right;">JUMLAH</th></tr>
      </thead>
      <tbody>${otRows}</tbody>
      <tfoot><tr><td colspan="5" style="text-align:right;">TOTAL</td><td style="text-align:right; color:#059669; font-size:11px;">Rp ${fmt(totalOtAmtAll)}</td></tr></tfoot>
    </table>
    <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
      Ponorogo, ${formattedPrintDate}<br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_finance_manager)}</strong><br><span>Manajer Keuangan</span>
    </div>

    <!-- SEKSI 4: REKAP TABUNGAN -->
    <div class="page-break"></div>
    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box"><div><div class="brand-title">SPBU GONTOR 54.634.25 MLARAK</div><div class="brand-sub">Laporan Rekapitulasi Tabungan Karyawan</div></div></div>
      <div class="period-badge">TAHUN ${currentYear}</div>
    </div>
    <div class="doc-title-bar">REKAPITULASI TABUNGAN KARYAWAN PERIODE ${currentYear}</div>
    <table>
      <thead>
        <tr><th style="width:25px;">NO</th><th>Nama</th>${monthsList.map(m => `<th>${m}-${currentYear.toString().slice(-2)}</th>`).join('')}<th>Total Tabungan/Individu</th></tr>
      </thead>
      <tbody>${tabunganRows}</tbody>
      <tfoot><tr><td colspan="14" style="text-align:right;">Total</td><td style="text-align:right; background:#facc15; font-weight:800; color:#0f172a;">${fmt(totalAllSavings)}</td></tr></tfoot>
    </table>
    <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
      Ponorogo, ${formattedPrintDate}<br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_finance_manager)}</strong><br><span>Manajer Keuangan</span>
    </div>

    <!-- SEKSI 4B: DOKUMEN PERHITUNGAN PERTAMINA WAY INTERNAL -->
    <div class="page-break"></div>
    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box"><div><div class="brand-title">SPBU GONTOR 54.634.25 MLARAK</div><div class="brand-sub">Dokumen Perhitungan Pertamina Way Internal</div></div></div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>
    <div class="doc-title-bar">
      <div style="font-size:13.5px; font-weight:900; letter-spacing:0.5px;">PERHITUNGAN INSENTIF PERTAMINA WAY INTERNAL BULAN ${monthNameUpper}</div>
      <div style="font-size:10.5px; font-weight:700; color:#475569; margin-top:2px; letter-spacing:0.3px;">KARYAWAN SPBU 5463425 GONTOR MLARAK</div>
    </div>
    <table>
      <thead>
        <tr><th rowspan="2">PRODUK BBM</th><th rowspan="2">PENJUALAN ( LITER )<br>DALAM 1 BULAN</th><th colspan="2">INSENTIF PW PER LITER</th><th rowspan="2">TOTAL PW INTERNAL</th></tr>
        <tr><th>PENGALI INTERNAL</th><th>NOMINAL / LITER</th></tr>
      </thead>
      <tbody>
        ${getBbmProducts().map(p => {
          const qty = Number(bbm[p.id] || 0);
          const mult = Number(p.mult_internal !== undefined ? p.mult_internal : 0);
          const amt = qty * mult;
          return `<tr><td>${esc(p.name.toUpperCase())}</td><td style="text-align:right;">${fmtNum(qty)}</td><td style="text-align:center;">Rp ${mult}</td><td style="text-align:right;">Rp ${mult}</td><td style="text-align:right; font-weight:600;">${fmt(amt)}</td></tr>`;
        }).join('')}
      </tbody>
      <tfoot><tr><td colspan="4" style="text-align:right;">TOTAL PW INTERNAL</td><td style="text-align:right; color:#059669; font-size:11px; font-weight:800;">${fmt(pwInt.total)}</td></tr></tfoot>
    </table>
    <div style="font-weight:700; color:#0f172a; margin-top:10px; margin-bottom:4px; font-size:11px;">ALOKASI PEMBAGIAN INSENTIF PERTAMINA WAY INTERNAL</div>
    <table>
      <thead><tr><th>RINCIAN KELOMPOK PEMBAGIAN</th><th>ALOKASI (%)</th><th>TOTAL ALOKASI</th><th>ESTIMASI PER INDIVIDU (@)</th></tr></thead>
      <tbody>
        <tr><td>${esc(settings.pw_int_group1_name.toUpperCase())} (${g1Count} Orang)</td><td style="text-align:center;">${settings.pw_int_group1_percent}%</td><td style="text-align:right;">${fmt(pwInt.total * (settings.pw_int_group1_percent / 100))}</td><td style="text-align:right; font-weight:600;">${fmt(rawPwSpvAdmin)}</td></tr>
        <tr><td>${esc(settings.pw_int_group2_name.toUpperCase())} (${g2Count} Orang)</td><td style="text-align:center;">${settings.pw_int_group2_percent}%</td><td style="text-align:right;">${fmt(pwInt.total * (settings.pw_int_group2_percent / 100))}</td><td style="text-align:right; font-weight:600;">${fmt(rawPwOprCs)}</td></tr>
      </tbody>
      <tfoot><tr><td>TOTAL</td><td style="text-align:center;">100%</td><td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwInt.total)}</td><td></td></tr></tfoot>
    </table>
    <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
      Ponorogo, ${formattedPrintDate}<br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_finance_manager)}</strong><br><span>Manajer Keuangan</span>
    </div>

    <!-- SEKSI 5: DOKUMEN AUDIT PERTAMINA HALAMAN 1 -->
    <div class="page-break"></div>
    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box"><div><div class="brand-title">SPBU GONTOR 54.634.25</div><div class="brand-sub">Dokumen Perhitungan Pertamina Way</div></div></div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>
    <div class="doc-title-bar">
      <div style="font-size:13.5px; font-weight:900; letter-spacing:0.5px;">PERHITUNGAN PERTAMINA WAY BULAN ${monthNameUpper}</div>
      <div style="font-size:10.5px; font-weight:700; color:#475569; margin-top:2px; letter-spacing:0.3px;">KARYAWAN SPBU 5463425 GONTOR</div>
    </div>
    <table>
      <thead>
        <tr><th rowspan="2">PRODUK</th><th rowspan="2">PENJUALAN ( LITER )<br>DALAM 1 BULAN</th><th colspan="2">MARGIN</th><th rowspan="2">PW PERUSAHAAN</th><th rowspan="2">PW KARYAWAN</th></tr>
        <tr><th>PERUSAHAAN</th><th>KARYAWAN</th></tr>
      </thead>
      <tbody>
        ${getBbmProducts().map(p => {
          const qty = Number(bbm[p.id] || 0);
          const mult = Number(p.mult_audit !== undefined ? p.mult_audit : 0);
          const amt = qty * mult;
          return `<tr><td>${esc(p.name.toUpperCase())}</td><td style="text-align:right;">${fmtNum(qty)}</td><td></td><td style="text-align:right;">Rp ${mult}</td><td style="text-align:right;">Rp -</td><td style="text-align:right; font-weight:600;">${fmt(amt)}</td></tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="text-align:right;">TOTAL</td>
          <td style="text-align:right;">Rp -</td>
          <td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="font-weight:700; color:#0f172a; margin-bottom:4px; font-size:11px;">TOTAL PENERIMAAN PERTAMINA WAY</div>
    <table style="width:320px;">
      <tr><td>PW PERUSAHAAN</td><td style="text-align:right;">Rp -</td></tr>
      <tr><td>PW KARYAWAN</td><td style="text-align:right; font-weight:600;">${fmt(pwAudit.total)}</td></tr>
      <tfoot><tr><td>TOTAL</td><td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td></tr></tfoot>
    </table>
    <div style="font-weight:700; color:#0f172a; margin-top:10px; margin-bottom:4px; font-size:11px;">PERTAMINA WAY YANG DIBAGIKAN KE KARYAWAN</div>
    <table>
      <thead><tr><th>RINCIAN PEMBAGIAN</th><th>PRESENTASE (%)</th><th>JUMLAH</th><th>PW PER @</th></tr></thead>
      <tbody>
        <tr><td>${esc(g1AudPosText)}</td><td style="text-align:center;">${settings.pw_aud_group1_percent}%</td><td style="text-align:right;">${fmt(pwAudit.total * pctMgrAud)}</td><td style="text-align:right; font-weight:600;">${fmt(pwMgrAdminEach)}</td></tr>
        <tr><td>${esc(g2AudPosText)}</td><td style="text-align:center;">${settings.pw_aud_group2_percent}%</td><td style="text-align:right;">${fmt(pwAudit.total * pctStafAud)}</td><td style="text-align:right; font-weight:600;">${fmt(pwStaffEach)}</td></tr>
      </tbody>
      <tfoot><tr><td>TOTAL</td><td style="text-align:center;">100%</td><td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td><td></td></tr></tfoot>
    </table>
    <div style="display:flex; justify-content:space-between; margin-top:15px; font-size:9.5px; color:#475569; align-items:flex-end;">
      <div>Mengetahui,<br><strong style="color:#0f172a;">SPBU 54.634.25 MLARAK</strong><br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_manager)}</strong><br><span>Manager</span></div>
      <div style="text-align:right;">Ponorogo, ${formattedPrintDate}<br>&nbsp;<br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_supervisor)}</strong><br><span>Supervisor</span></div>
    </div>

    <!-- SEKSI 6: DOKUMEN AUDIT PERTAMINA HALAMAN 2 -->
    <div class="page-break"></div>
    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box"><div><div class="brand-title">SPBU GONTOR 54.634.25</div><div class="brand-sub">Daftar Penerimaan Pertamina Way Karyawan</div></div></div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>
    <div class="doc-title-bar">
      <div style="font-size:13.5px; font-weight:900; letter-spacing:0.5px;">DAFTAR PENERIMAAN PERTAMINA WAY</div>
      <div style="font-size:10.5px; font-weight:700; color:#475569; margin-top:2px; letter-spacing:0.3px;">KARYAWAN SPBU 5463425 GONTOR</div>
    </div>
    <table>
      <thead><tr><th style="width:30px;">NO</th><th>NAMA KARYAWAN</th><th>JABATAN</th><th style="text-align:right; width:150px;">INSENTIF (PW)</th></tr></thead>
      <tbody>
        ${auditUsers.map((u, idx) => `<tr><td style="text-align:center;">${idx + 1}</td><td><strong>${esc(u.name)}</strong></td><td style="text-align:center;">${esc(u.position || '-')}</td><td style="text-align:right; font-weight:600;">${fmt(isPositionMatch(u.position, settings.pw_aud_group1_positions) ? pwMgrAdminEach : pwStaffEach)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;">TOTAL</td><td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td></tr></tfoot>
    </table>
    <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
      Ponorogo, ${formattedPrintDate}<br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_supervisor)}</strong><br><span>Supervisor</span>
    </div>

    <!-- SEKSI 7: DOKUMEN AUDIT PERTAMINA HALAMAN 3 -->
    <div class="page-break"></div>
    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box"><div><div class="brand-title">SPBU GONTOR 54.634.25</div><div class="brand-sub">Daftar Penerimaan Gaji</div></div></div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>
    <div class="doc-title-bar">
      <div style="font-size:14px; font-weight:900; letter-spacing:0.5px;">TANDA TERIMA GAJI DAN PERTAMINA WAY</div>
      <div style="font-size:10.5px; font-weight:700; color:#475569; margin-top:2px; letter-spacing:0.3px;">KARYAWAN SPBU 5463425 GONTOR</div>
    </div>
    <table>
      <thead>
        <tr><th rowspan="2" style="width:25px;">NO</th><th rowspan="2">NAMA KARYAWAN</th><th rowspan="2">JABATAN</th><th rowspan="2">GAJI POKOK</th><th>PERTAMINA WAY</th><th>BPJS</th><th rowspan="2">JUMLAH (THP)</th><th rowspan="2" colspan="2" style="width:140px;">TANDA TANGAN</th></tr>
        <tr><th>PX/PL/PXT/PTD/BS</th><th>KESEHATAN 1%</th></tr>
      </thead>
      <tbody>${auditH3Rows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;">Total</td><td style="text-align:right;">${fmt(totalGajiPokokAll)}</td><td style="text-align:right;">${fmt(totalPwAll)}</td><td style="text-align:right;">${fmt(totalBpjsAll)}</td><td style="text-align:right; color:#059669; font-size:11px;">${fmt(totalThpAll)}</td><td colspan="2"></td></tr></tfoot>
    </table>
    <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
      Ponorogo, ${formattedPrintDate}<br><div style="height:75px;"></div><strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_supervisor)}</strong><br><span>Supervisor</span>
    </div>
    </div>
  </body>
  </html>`);
  win.document.close();
};

window._printEnvelopeSlips = (paperSize = 'A4', perPage = 6) => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};
  const users = getUsers().filter(u => {
    if ((u.position || '').toLowerCase() === 'manager') return false;
    const empData = monthData[u.emp_id] || {};
    return !empData.excluded;
  });
  const bbm = getBbmSalesData(month);
  const pwInt = computePwInternal(bbm);

  const monthName = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  const formattedPrintDate = new Date(printDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const spvAdminCount = users.filter(u => {
    const p = (u.position || '').toLowerCase();
    return p.includes('admin') || p.includes('supervisor') || p.includes('spv');
  }).length || 3;
  const oprCsCount = users.length - spvAdminCount || 11;

  let slipsHTML = '';
  let currentPageSlips = [];

  users.forEach((u, idx) => {
    const empId = u.emp_id;
    const empData = monthData[empId] || {};
    const pos = u.position || '-';
    const isSpvAdmin = pos.toLowerCase().includes('admin') || pos.toLowerCase().includes('supervisor') || pos.toLowerCase().includes('spv');
    const defaultPwRound = isSpvAdmin ? 150000 : 100000;
    
    const pwEnabled = empData.pw_enabled !== undefined ? empData.pw_enabled : false;
    const pwAmount = Number(empData.pw_amount !== undefined ? empData.pw_amount : 0);
    const tenureMonths = getTenureMonths(u.join_date || u.created_at);

    const tunjData = empData.tunjangan || {};
    const tunjJabatanEnabled = tunjData['tunj_jabatan'] ? tunjData['tunj_jabatan'].enabled : false;
    const tunjJabatanAmt = Number((tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].amount !== undefined) ? tunjData['tunj_jabatan'].amount : 0);

    const tunjKinerjaEnabled = tunjData['tunj_kinerja'] ? tunjData['tunj_kinerja'].enabled : false;
    const tunjKinerjaAmt = Number((tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].amount !== undefined) ? tunjData['tunj_kinerja'].amount : 0);

    const tunjMasaKerjaEnabled = tunjData['tunj_masa_kerja'] ? tunjData['tunj_masa_kerja'].enabled : false;
    const tunjMasaKerjaAmt = Number((tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].amount !== undefined) ? tunjData['tunj_masa_kerja'].amount : 0);

    let tambahanRows = '';
    let itemIdx = 1;

    if (tunjJabatanEnabled && tunjJabatanAmt > 0) {
      tambahanRows += `<tr><td>:${itemIdx++} Tunjangan Jabatan</td><td style="text-align:right;">${fmt(tunjJabatanAmt)}</td></tr>`;
    }
    if (tunjKinerjaEnabled && tunjKinerjaAmt > 0) {
      tambahanRows += `<tr><td>:${itemIdx++} Tunjangan Kinerja</td><td style="text-align:right;">${fmt(tunjKinerjaAmt)}</td></tr>`;
    }
    if (tunjMasaKerjaEnabled && tunjMasaKerjaAmt > 0) {
      tambahanRows += `<tr><td>:${itemIdx++} Tunjangan Masa Kerja</td><td style="text-align:right;">${fmt(tunjMasaKerjaAmt)}</td></tr>`;
    }
    if (pwEnabled && pwAmount > 0) {
      tambahanRows += `<tr><td>:${itemIdx++} Pertamina Way</td><td style="text-align:right;">${fmt(pwAmount)}</td></tr>`;
    }

    const otShifts = Number(empData.overtime_shifts || 0);
    const otAmt = otShifts * 50000;
    if (otAmt > 0) {
      tambahanRows += `<tr><td>:${itemIdx++} Lembur Kerja</td><td style="text-align:right;">${fmt(otAmt)}</td></tr>`;
    }

    settings.custom_allowances.forEach(ca => {
      if (['tunj_jabatan', 'tunj_kinerja', 'tunj_masa_kerja'].includes(ca.id)) return;
      const cItem = tunjData[ca.id] || {};
      if (cItem.enabled && Number(cItem.amount || 0) > 0) {
        tambahanRows += `<tr><td>:${itemIdx++} ${esc(ca.name)}</td><td style="text-align:right;">${fmt(Number(cItem.amount))}</td></tr>`;
      }
    });

    const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);
    const totalTambahan = (tunjJabatanEnabled ? tunjJabatanAmt : 0) +
                          (tunjKinerjaEnabled ? tunjKinerjaAmt : 0) +
                          (tunjMasaKerjaEnabled ? tunjMasaKerjaAmt : 0) +
                          (pwEnabled ? pwAmount : 0) +
                          otAmt;

    const gajiKotor = gajiPokok + totalTambahan;
    const tabunganAmt = Number(empData.savings_deduction || 0);
    const gajiBersih = gajiKotor - tabunganAmt;

    const slipHTML = `<div class="slip-card">
      <div class="slip-top-bar"></div>
      <div class="slip-header-area">
        <div class="company-badge">
          <div>
            <div class="company-name">SPBU GONTOR</div>
            <div class="company-id">54.634.25</div>
          </div>
        </div>
        <div class="period-badge">${monthName}</div>
      </div>

      <div class="slip-body">
        <div class="emp-info-row">
          <div class="emp-name">${esc(u.name)}</div>
          <div class="emp-pos">${esc(pos)}</div>
        </div>

        <div class="detail-section">
          <div class="detail-row main-row">
            <span>Gaji Pokok</span>
            <span class="amount">${fmt(gajiPokok)}</span>
          </div>
          ${tambahanRows ? `
          <div class="tambahan-label">Tambahan :</div>
          <table class="tambahan-tbl">${tambahanRows}</table>
          ` : ''}
          <div class="detail-row subtotal-row">
            <span>Total Pendapatan</span>
            <span class="amount">${fmt(gajiKotor)}</span>
          </div>
          ${tabunganAmt > 0 ? `
          <div class="detail-row deduction-row">
            <span>Potongan Tabungan</span>
            <span class="amount deduction">- ${fmt(tabunganAmt)}</span>
          </div>` : ''}
        </div>
      </div>

      <div class="slip-footer-area">
        <div class="net-pay-bar">
          <div class="net-label">GAJI BERSIH</div>
          <div class="net-amount">${fmt(gajiBersih)}</div>
        </div>
        <div class="sign-area">
          <div class="sign-date">Ponorogo, ${formattedPrintDate}</div>
          <div class="sign-title">Manajer Keuangan</div>
          <div class="sign-space"></div>
          <div class="sign-name">${esc(settings.name_finance_manager)}</div>
        </div>
      </div>
    </div>`;

    currentPageSlips.push(slipHTML);

    if (currentPageSlips.length === perPage || idx === users.length - 1) {
      slipsHTML += `<div class="page-grid per-page-${perPage}">${currentPageSlips.join('')}</div>`;
      currentPageSlips = [];
    }
  });

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Slip Gaji Amplop - SPBU Gontor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>
      function downloadPDFDirect() {
        const btn = document.getElementById('btn-dl-direct');
        const origText = btn ? btn.innerHTML : '📥 UNDUH FILE PDF DIRECT';
        if (btn) { btn.innerHTML = '⏳ Mengunduh PDF...'; btn.disabled = true; }
        
        function restoreUI(msg) {
          if (btn) {
            btn.innerHTML = msg || origText;
            setTimeout(function() { btn.innerHTML = origText; btn.disabled = false; }, 2500);
          }
        }

        let attempts = 0;
        function runGen() {
          attempts++;
          const pdfLib = window.html2pdf || (window.opener && window.opener.html2pdf);
          const el = document.getElementById('print-area') || document.body;

          if (typeof pdfLib !== 'undefined') {
            const opt = {
              margin: 2,
              filename: 'Slip_Gaji_Amplop_${month}.pdf',
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: ${paperSize === 'F4' ? "[215, 330]" : "'a4'"}, orientation: 'portrait', compress: true },
              pagebreak: { mode: ['css', 'legacy'] }
            };

            pdfLib().set(opt).from(el).save().then(function() {
              restoreUI('✅ PDF Terunduh!');
            }).catch(function(err) {
              console.error(err);
              restoreUI();
              window.print();
            });
          } else if (attempts < 10) {
            setTimeout(runGen, 300);
          } else {
            restoreUI();
            window.print();
          }
        }

        runGen();
      }
    </script>
    <style>
      @page { size: ${paperSize === 'F4' ? '215mm 330mm' : 'A4'} portrait; margin: 4mm; }
      * { -webkit-print-color-adjust: exact ; print-color-adjust: exact ; box-sizing: border-box; margin: 0; padding: 0; }
      html, body { font-family: 'Inter', sans-serif; color: #0f172a ; background-color: #ffffff ; background: #ffffff ; padding: 0; margin: 0; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
      #print-area { background-color: #ffffff ; background: #ffffff ; color: #0f172a ; padding: 6px; box-sizing: border-box; width: 100%; min-height: 100vh; }
      body, div, p, span, td, th { color: #0f172a ; }
      
      .page-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; grid-gap: 6px; width: 100%; min-height: 95vh; padding: 4px; box-sizing: border-box; page-break-after: always; }
      .per-page-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
      .per-page-6 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; }

      .slip-card {
        border: 1px solid #e2e8f0 ;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        background-color: #ffffff ;
        background: #ffffff ;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        overflow: hidden;
        position: relative;
        color: #0f172a ;
      }

      .slip-top-bar {
        height: 4px;
        background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7);
      }

      .slip-header-area {
        background-color: #0f172a ;
        background: #0f172a ;
        padding: 7px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .slip-header-area * {
        color: #ffffff ;
      }

      .company-badge {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .company-icon {
        width: 26px;
        height: 26px;
        background: linear-gradient(135deg, #f59e0b, #ef4444) ;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: #ffffff ;
      }

      .company-name {
        font-size: 12px;
        font-weight: 800;
        color: #fff ;
        letter-spacing: 0.5px;
      }

      .company-id {
        font-size: 9px;
        color: #94a3b8 ;
        font-weight: 500;
      }

      .period-badge {
        background: rgba(255,255,255,0.12) ;
        color: #e2e8f0 ;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 8.5px;
        font-weight: 600;
        border: 1px solid rgba(255,255,255,0.15);
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .slip-body {
        padding: 7px 10px 4px;
        flex: 1;
        background-color: #ffffff ;
      }

      .emp-info-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding-bottom: 5px;
        border-bottom: 1.5px solid #e2e8f0;
        margin-bottom: 5px;
      }

      .emp-name {
        font-size: 11px;
        font-weight: 800;
        color: #0f172a ;
      }

      .emp-pos {
        font-size: 8px;
        font-weight: 600;
        color: #4338ca ;
        background-color: #e0e7ff ;
        background: #e0e7ff ;
        padding: 2px 6px;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .detail-section {
        font-size: 9.5px;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 2px 0;
      }

      .detail-row .amount {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: #0f172a ;
      }

      .main-row {
        color: #0f172a ;
        font-weight: 600;
      }

      .tambahan-label {
        font-size: 8.5px;
        font-weight: 700;
        color: #475569 ;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 3px 0 1px;
      }

      .tambahan-tbl {
        width: 100%;
        border-collapse: collapse;
        font-size: 9px;
        margin-bottom: 2px;
      }

      .tambahan-tbl td {
        padding: 1px 0 1px 6px;
        color: #0f172a ;
        background-color: #ffffff ;
      }

      .subtotal-row {
        border-top: 1.5px solid #cbd5e1;
        margin-top: 3px;
        padding-top: 3px;
        font-weight: 800;
        color: #0f172a ;
        font-size: 10px;
      }

      .deduction-row {
        color: #dc2626 ;
        font-size: 9px;
        padding: 2px 0;
      }

      .deduction-row * {
        color: #dc2626 ;
      }

      .slip-footer-area {
        padding: 0 10px 7px;
        background-color: #ffffff ;
      }

      .net-pay-bar {
        background-color: #059669 ;
        background: #059669 ;
        border-radius: 5px;
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
      }

      .net-pay-bar * {
        color: #ffffff ;
      }

      .net-label {
        color: #ffffff ;
        font-size: 8.5px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
      }

      .net-amount {
        color: #ffffff ;
        font-size: 13px;
        font-weight: 900;
        letter-spacing: 0.3px;
      }

      .sign-area {
        text-align: right;
        font-size: 8px;
        color: #475569 ;
        line-height: 1.35;
      }

      .sign-date { font-weight: 500; color: #475569 ; }
      .sign-title { font-weight: 600; color: #475569 ; margin-top: 2px; }
      .sign-space { height: 50px; }
      .sign-name { font-weight: 800; color: #0f172a ; text-decoration: underline; font-size: 8.5px; }

      .toolbar-btn {
        padding: 8px 18px;
        font-weight: 700;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-family: 'Inter', sans-serif;
        transition: all 0.2s;
      }

      .toolbar-btn:hover { opacity: 0.9; transform: translateY(-1px); }

      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:#0f172a; border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff; font-weight:700;">🖨️ CETAK PDF / PRINT</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div id="print-area">
    ${slipsHTML}
    </div>
  </body>
  </html>`);
  win.document.close();
};

window._printAuditDocuments = () => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const bbm = getBbmSalesData(month);
  const pwAudit = computePwAudit(bbm);

  const monthNameUpper = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase();
  const formattedPrintDate = new Date(printDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const users = getUsers();
  let managerObj = users.find(u => (u.position || '').toLowerCase() === 'manager' || (u.name || '').toLowerCase().includes('pedri'));
  if (!managerObj) {
    managerObj = { emp_id: 'M1', name: settings.name_audit_manager, position: 'Manager' };
  }

  const staffUsers = users.filter(u => u.emp_id !== managerObj.emp_id);
  const auditUsers = [managerObj, ...staffUsers];
  const group1AuditUsers = auditUsers.filter(u => isPositionMatch(u.position, settings.pw_aud_group1_positions));
  const group2AuditUsers = auditUsers.filter(u => !isPositionMatch(u.position, settings.pw_aud_group1_positions));

  const g1AudCount = Math.max(1, group1AuditUsers.length);
  const g2AudCount = Math.max(1, group2AuditUsers.length);

  const g1AudPosText = getPositionsLabel(settings.pw_aud_group1_positions, settings.pw_aud_group1_name);
  const g2AudPosText = getPositionsLabel(settings.pw_aud_group2_positions, settings.pw_aud_group2_name);

  const pctMgrAud = (settings.pw_aud_group1_percent || 20) / 100;
  const pctStafAud = (settings.pw_aud_group2_percent || 80) / 100;
  const pwMgrAdminEach = (pwAudit.total * pctMgrAud) / g1AudCount;
  const pwStaffEach = (pwAudit.total * pctStafAud) / g2AudCount;

  let totalGajiPokokAll = 0;
  let totalPwAll = 0;
  let totalBpjsAll = 0;
  let totalThpAll = 0;

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Dokumen Resmi Audit Pertamina - SPBU Gontor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>
      function downloadPDFDirect() {
        const btn = document.getElementById('btn-dl-direct');
        const origText = btn ? btn.innerHTML : '📥 UNDUH FILE PDF DIRECT';
        if (btn) { btn.innerHTML = '⏳ Mengunduh PDF...'; btn.disabled = true; }
        
        function restoreUI(msg) {
          if (btn) {
            btn.innerHTML = msg || origText;
            setTimeout(function() { btn.innerHTML = origText; btn.disabled = false; }, 2500);
          }
        }

        let attempts = 0;
        function runGen() {
          attempts++;
          const pdfLib = window.html2pdf || (window.opener && window.opener.html2pdf);
          const el = document.getElementById('print-area') || document.body;

          if (typeof pdfLib !== 'undefined') {
            const opt = {
              margin: 3,
              filename: 'Dokumen_Audit_Pertamina_${month}.pdf',
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
              pagebreak: { mode: ['css', 'legacy'] }
            };

            pdfLib().set(opt).from(el).save().then(function() {
              restoreUI('✅ PDF Terunduh!');
            }).catch(function(err) {
              console.error(err);
              restoreUI();
              window.print();
            });
          } else if (attempts < 10) {
            setTimeout(runGen, 300);
          } else {
            restoreUI();
            window.print();
          }
        }

        runGen();
      }
    </script>
    <style>
      @page { size: A4 landscape; margin: 4mm 6mm; }
      * { -webkit-print-color-adjust: exact ; print-color-adjust: exact ; box-sizing: border-box; margin: 0; padding: 0; }
      html, body { font-family: 'Inter', sans-serif; color: #0f172a ; background-color: #ffffff ; background: #ffffff ; padding: 0; margin: 0; -webkit-font-smoothing: antialiased; }
      #print-area { background-color: #ffffff ; background: #ffffff ; color: #0f172a ; padding: 6px; box-sizing: border-box; width: 100%; min-height: 100vh; }
      body, div, p, span, td, th { color: #0f172a ; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: #0f172a ; color: #ffffff ; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .header-card * { color: #ffffff ; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #ffffff ; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff ; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 ; }
      .period-badge { background: rgba(255,255,255,0.18) ; color: #ffffff ; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a ; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; background-color: #ffffff ; background: #ffffff ; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 5px 7px; color: #0f172a ; background-color: #ffffff ; }
      th { background-color: #0f172a ; background: #0f172a ; color: #ffffff ; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.3px; }
      tfoot td { background-color: #f1f5f9 ; background: #f1f5f9 ; font-weight: 800; color: #0f172a ; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:#0f172a; border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff; font-weight:700;">🖨️ CETAK PDF / PRINT</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div id="print-area">

    <!-- HALAMAN 1: PERHITUNGAN PERTAMINA WAY -->
    <div>
      <div class="top-accent-bar"></div>
      <div class="header-card">
        <div class="brand-box">
          <div>
            <div class="brand-title">SPBU GONTOR 54.634.25</div>
            <div class="brand-sub">Dokumen Perhitungan Pertamina Way</div>
          </div>
        </div>
        <div class="period-badge">BULAN ${monthNameUpper}</div>
      </div>

      <div class="doc-title-bar">
        <div style="font-size:13.5px; font-weight:900; letter-spacing:0.5px;">PERHITUNGAN PERTAMINA WAY BULAN ${monthNameUpper}</div>
        <div style="font-size:10.5px; font-weight:700; color:#475569; margin-top:2px; letter-spacing:0.3px;">KARYAWAN SPBU 5463425 GONTOR</div>
      </div>

      <table>
        <thead>
          <tr>
            <th rowspan="2">PRODUK</th>
            <th rowspan="2">PENJUALAN ( LITER )<br>DALAM 1 BULAN</th>
            <th colspan="2">MARGIN</th>
            <th rowspan="2">PW PERUSAHAAN</th>
            <th rowspan="2">PW KARYAWAN</th>
          </tr>
          <tr>
            <th>PERUSAHAAN</th>
            <th>KARYAWAN</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>PERTALITE</td><td style="text-align:right;">${fmtNum(bbm.pertalite)}</td><td></td><td style="text-align:right;">Rp 4</td><td style="text-align:right;">Rp -</td><td style="text-align:right; font-weight:600;">${fmt(pwAudit.pwPertalite)}</td></tr>
          <tr><td>SOLAR (BIOSOLAR)</td><td style="text-align:right;">${fmtNum(bbm.solar)}</td><td></td><td style="text-align:right;">Rp 4</td><td style="text-align:right;">Rp -</td><td style="text-align:right; font-weight:600;">${fmt(pwAudit.pwSolar)}</td></tr>
          <tr><td>PERTAMAX TURBO</td><td style="text-align:right;">${fmtNum(bbm.turbo)}</td><td></td><td style="text-align:right;">Rp 30</td><td style="text-align:right;">Rp -</td><td style="text-align:right; font-weight:600;">${fmt(pwAudit.pwTurbo)}</td></tr>
          <tr><td>PERTAMAX 92</td><td style="text-align:right;">${fmtNum(bbm.px92)}</td><td></td><td style="text-align:right;">Rp 30</td><td style="text-align:right;">Rp -</td><td style="text-align:right; font-weight:600;">${fmt(pwAudit.pwPx92)}</td></tr>
          <tr><td>PERTAMINA DEX</td><td style="text-align:right;">${fmtNum(bbm.dex)}</td><td></td><td style="text-align:right;">Rp 30</td><td style="text-align:right;">Rp -</td><td style="text-align:right; font-weight:600;">${fmt(pwAudit.pwDex)}</td></tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="text-align:right;">TOTAL</td>
            <td style="text-align:right;">Rp -</td>
            <td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="font-weight:700; color:#0f172a; margin-bottom:4px; font-size:11px;">TOTAL PENERIMAAN PERTAMINA WAY</div>
      <table style="width:320px;">
        <tr><td>PW PERUSAHAAN</td><td style="text-align:right;">Rp -</td></tr>
        <tr><td>PW KARYAWAN</td><td style="text-align:right; font-weight:600;">${fmt(pwAudit.total)}</td></tr>
        <tfoot><tr><td>TOTAL</td><td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td></tr></tfoot>
      </table>

      <div style="font-weight:700; color:#0f172a; margin-top:10px; margin-bottom:4px; font-size:11px;">PERTAMINA WAY YANG DIBAGIKAN KE KARYAWAN</div>
      <table>
        <thead>
          <tr>
            <th>RINCIAN PEMBAGIAN</th>
            <th>PRESENTASE (%)</th>
            <th>JUMLAH</th>
            <th>PW PER @</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>${esc(g1AudPosText)}</td><td style="text-align:center;">${settings.pw_aud_group1_percent}%</td><td style="text-align:right;">${fmt(pwAudit.total * pctMgrAud)}</td><td style="text-align:right; font-weight:600;">${fmt(pwMgrAdminEach)}</td></tr>
          <tr><td>${esc(g2AudPosText)}</td><td style="text-align:center;">${settings.pw_aud_group2_percent}%</td><td style="text-align:right;">${fmt(pwAudit.total * pctStafAud)}</td><td style="text-align:right; font-weight:600;">${fmt(pwStaffEach)}</td></tr>
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td style="text-align:center;">100%</td>
            <td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div style="display:flex; justify-content:space-between; margin-top:20px; font-size:9.5px; color:#475569; align-items:flex-end;">
        <div>
          Mengetahui,<br>
          <strong style="color:#0f172a;">SPBU 54.634.25 MLARAK</strong><br>
          <div style="height:75px;"></div>
          <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_manager)}</strong><br>
          <span>Manager</span>
        </div>
        <div style="text-align:right;">
          Ponorogo, ${formattedPrintDate}<br>
          &nbsp;<br>
          <div style="height:75px;"></div>
          <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_supervisor)}</strong><br>
          <span>Supervisor</span>
        </div>
      </div>
    </div>

    <!-- HALAMAN 2: DAFTAR PENERIMAAN PW -->
    <div style="page-break-before:always; padding-top:10px;">
      <div class="top-accent-bar"></div>
      <div class="header-card">
        <div class="brand-box">
          <div class="brand-icon">⛽</div>
          <div>
            <div class="brand-title">SPBU GONTOR 54.634.25</div>
            <div class="brand-sub">Daftar Penerimaan Pertamina Way Karyawan</div>
          </div>
        </div>
        <div class="period-badge">BULAN ${monthNameUpper}</div>
      </div>

      <div class="doc-title-bar">
        <div style="font-size:13.5px; font-weight:900; letter-spacing:0.5px;">DAFTAR PENERIMAAN PERTAMINA WAY</div>
        <div style="font-size:10.5px; font-weight:700; color:#475569; margin-top:2px; letter-spacing:0.3px;">KARYAWAN SPBU 5463425 GONTOR</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:30px;">NO</th>
            <th>NAMA KARYAWAN</th>
            <th>JABATAN</th>
            <th style="text-align:right; width:150px;">INSENTIF (PW)</th>
          </tr>
        </thead>
        <tbody>
          ${auditUsers.map((u, idx) => `<tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td><strong>${esc(u.name)}</strong></td>
            <td style="text-align:center;">${esc(u.position || '-')}</td>
            <td style="text-align:right; font-weight:600;">${fmt(isPositionMatch(u.position, settings.pw_aud_group1_positions) ? pwMgrAdminEach : pwStaffEach)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="text-align:right;">TOTAL</td>
            <td style="text-align:right; color:#059669; font-size:11px;">${fmt(pwAudit.total)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
        Ponorogo, ${formattedPrintDate}<br>
        <div style="height:75px;"></div>
        <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_supervisor)}</strong><br>
        <span>Supervisor</span>
      </div>
    </div>

    <!-- HALAMAN 3: PENERIMAAN GAJI AUDIT -->
    <div style="page-break-before:always; padding-top:10px;">
      <div class="top-accent-bar"></div>
      <div class="header-card">
        <div class="brand-box">
          <div class="brand-icon">⛽</div>
          <div>
            <div class="brand-title">SPBU GONTOR 54.634.25</div>
            <div class="brand-sub">Daftar Penerimaan Gaji</div>
          </div>
        </div>
        <div class="period-badge">BULAN ${monthNameUpper}</div>
      </div>

      <div class="doc-title-bar">
        <div style="font-size:14px; font-weight:900; letter-spacing:0.5px;">TANDA TERIMA GAJI DAN PERTAMINA WAY</div>
        <div style="font-size:10.5px; font-weight:700; color:#475569; margin-top:2px; letter-spacing:0.3px;">KARYAWAN SPBU 5463425 GONTOR</div>
      </div>
      <table>
        <thead>
          <tr>
            <th rowspan="2" style="width:25px;">NO</th>
            <th rowspan="2">NAMA KARYAWAN</th>
            <th rowspan="2">JABATAN</th>
            <th rowspan="2">GAJI POKOK</th>
            <th>PERTAMINA WAY</th>
            <th>BPJS</th>
            <th rowspan="2">JUMLAH (THP)</th>
            <th rowspan="2" colspan="2" style="width:140px;">TANDA TANGAN</th>
          </tr>
          <tr>
            <th>PX/PL/PXT/PTD/BS</th>
            <th>KESEHATAN 1%</th>
          </tr>
        </thead>
        <tbody>
          ${auditUsers.map((u, idx) => {
            const pos = u.position || '-';
            const isMgr = pos.toLowerCase() === 'manager' || u.emp_id === managerObj.emp_id;
            const isAdmin = pos.toLowerCase().includes('admin');

            const gajiPokok = isMgr ? settings.umk_manager : settings.umk_staf;
            const pwVal = (isMgr || isAdmin) ? pwMgrAdminEach : pwStaffEach;
            const bpjsVal = gajiPokok * (settings.bpjs_percent / 100);
            const thpVal = gajiPokok + pwVal - bpjsVal;

            totalGajiPokokAll += gajiPokok;
            totalPwAll += pwVal;
            totalBpjsAll += bpjsVal;
            totalThpAll += thpVal;

            const isOddRow = (idx % 2 === 0);
            const nextUserExists = (idx + 1 < auditUsers.length);

            let ttdCells = '';
            if (isOddRow) {
              const leftNum = idx + 1;
              const rightNum = idx + 2;
              const rSpan = nextUserExists ? 'rowspan="2"' : 'rowspan="1"';
              const rightCellContent = nextUserExists ? `${rightNum}.` : '';

              ttdCells = `<td ${rSpan} style="width:70px; vertical-align:top; padding:6px 8px; border:1px solid #cbd5e1; font-weight:700; color:#334155; font-size:9.5px; background:#fff;">${leftNum}.</td>
              <td ${rSpan} style="width:70px; vertical-align:top; padding:6px 8px; border:1px solid #cbd5e1; font-weight:700; color:#334155; font-size:9.5px; background:#fff;">${rightCellContent}</td>`;
            }

            return `<tr>
              <td style="text-align:center;">${idx + 1}</td>
              <td><strong>${esc(u.name)}</strong></td>
              <td style="text-align:center;">${esc(pos.toUpperCase())}</td>
              <td style="text-align:right;">${fmt(gajiPokok)}</td>
              <td style="text-align:right;">${fmt(pwVal)}</td>
              <td style="text-align:right;">${fmt(bpjsVal)}</td>
              <td style="text-align:right; font-weight:800; color:#0f172a;">${fmt(thpVal)}</td>
              ${ttdCells}
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="text-align:right;">Total</td>
            <td style="text-align:right;">${fmt(totalGajiPokokAll)}</td>
            <td style="text-align:right;">${fmt(totalPwAll)}</td>
            <td style="text-align:right;">${fmt(totalBpjsAll)}</td>
            <td style="text-align:right; color:#059669; font-size:11px;">${fmt(totalThpAll)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>

      <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
        Ponorogo, ${formattedPrintDate}<br>
        <div style="height:75px;"></div>
        <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_supervisor)}</strong><br>
        <span>Supervisor</span>
      </div>
    </div>
  </body>
  </html>`);
  win.document.close();
};

window._printInternalPayrollSummary = () => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};
  const bbm = getBbmSalesData(month);
  const pwInt = computePwInternal(bbm);

  const monthNameUpper = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase();
  const formattedPrintDate = new Date(printDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const spvAdminCount = users.filter(u => {
    const p = (u.position || '').toLowerCase();
    return p.includes('admin') || p.includes('supervisor') || p.includes('spv');
  }).length || 3;
  const oprCsCount = users.length - spvAdminCount || 11;

  let totalGajiPokok = 0, totalTunjJabatan = 0, totalTunjKinerja = 0, totalTunjMasaKerja = 0, totalPw = 0, totalLembur = 0, totalTabungan = 0, totalBersih = 0;

  const rows = users.map((u, idx) => {
    const empId = u.emp_id;
    const empData = monthData[empId] || {};
    const pos = u.position || '-';
    const isSpvAdmin = pos.toLowerCase().includes('admin') || pos.toLowerCase().includes('supervisor') || pos.toLowerCase().includes('spv');
    const defaultPwRound = isSpvAdmin ? 150000 : 100000;
    
    const pwEnabled = empData.pw_enabled !== undefined ? empData.pw_enabled : false;
    const pwAmount = Number(empData.pw_amount !== undefined ? empData.pw_amount : 0);
    const tenureMonths = getTenureMonths(u.join_date || u.contract_start || u.created_at, month);
    const tenureText = fmtTenureText(tenureMonths);

    const tunjData = empData.tunjangan || {};
    const tunjJabatanEnabled = tunjData['tunj_jabatan'] ? tunjData['tunj_jabatan'].enabled : false;
    const tunjJabatanAmt = Number((tunjData['tunj_jabatan'] && tunjData['tunj_jabatan'].amount !== undefined) ? tunjData['tunj_jabatan'].amount : 0);

    const tunjKinerjaEnabled = tunjData['tunj_kinerja'] ? tunjData['tunj_kinerja'].enabled : false;
    const tunjKinerjaAmt = Number((tunjData['tunj_kinerja'] && tunjData['tunj_kinerja'].amount !== undefined) ? tunjData['tunj_kinerja'].amount : 0);

    const tunjMasaKerjaEnabled = tunjData['tunj_masa_kerja'] ? tunjData['tunj_masa_kerja'].enabled : false;
    const tunjMasaKerjaAmt = Number((tunjData['tunj_masa_kerja'] && tunjData['tunj_masa_kerja'].amount !== undefined) ? tunjData['tunj_masa_kerja'].amount : 0);

    const otShifts = Number(empData.overtime_shifts || 0);
    const otAmt = otShifts * 50000;
    const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);

    const jAmt = tunjJabatanEnabled ? tunjJabatanAmt : 0;
    const kAmt = tunjKinerjaEnabled ? tunjKinerjaAmt : 0;
    const mkAmt = tunjMasaKerjaEnabled ? tunjMasaKerjaAmt : 0;
    const pwVal = pwEnabled ? pwAmount : 0;

    const tabunganAmt = Number(empData.savings_deduction || 0);
    const gajiKotor = gajiPokok + jAmt + kAmt + mkAmt + pwVal + otAmt;
    const gajiBersih = gajiKotor - tabunganAmt;

    totalGajiPokok += gajiPokok;
    totalTunjJabatan += jAmt;
    totalTunjKinerja += kAmt;
    totalTunjMasaKerja += mkAmt;
    totalPw += pwVal;
    totalLembur += otAmt;
    totalTabungan += tabunganAmt;
    totalBersih += gajiBersih;

    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><strong>${esc(u.name)}</strong></td>
      <td style="text-align:center;">UMK 100%</td>
      <td style="text-align:center;">${tenureText}</td>
      <td style="text-align:right;">${fmt(gajiPokok)}</td>
      <td style="text-align:right;">${fmt(jAmt)}</td>
      <td style="text-align:right;">${fmt(kAmt)}</td>
      <td style="text-align:right;">${fmt(mkAmt)}</td>
      <td style="text-align:right;">${fmt(pwVal)}</td>
      <td style="text-align:right;">${fmt(otAmt)}</td>
      <td style="text-align:right;">${fmt(tabunganAmt)}</td>
      <td style="text-align:right; font-weight:bold;">${fmt(gajiBersih)}</td>
    </tr>`;
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Penerimaan Gaji Karyawan Internal - SPBU Gontor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>
      function downloadPDFDirect() {
        const btn = document.getElementById('btn-dl-direct');
        const origText = btn ? btn.innerHTML : '📥 UNDUH FILE PDF DIRECT';
        if (btn) { btn.innerHTML = '⏳ Mengunduh PDF...'; btn.disabled = true; }
        
        function restoreUI(msg) {
          if (btn) {
            btn.innerHTML = msg || origText;
            setTimeout(function() { btn.innerHTML = origText; btn.disabled = false; }, 2500);
          }
        }

        let attempts = 0;
        function runGen() {
          attempts++;
          const pdfLib = window.html2pdf || (window.opener && window.opener.html2pdf);
          const el = document.getElementById('print-area') || document.body;

          if (typeof pdfLib !== 'undefined') {
            const opt = {
              margin: 3,
              filename: 'Rekap_Gaji_Internal_${month}.pdf',
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
              pagebreak: { mode: ['css', 'legacy'] }
            };

            pdfLib().set(opt).from(el).save().then(function() {
              restoreUI('✅ PDF Terunduh!');
            }).catch(function(err) {
              console.error(err);
              restoreUI();
              window.print();
            });
          } else if (attempts < 10) {
            setTimeout(runGen, 300);
          } else {
            restoreUI();
            window.print();
          }
        }

        runGen();
      }
    </script>
    <style>
      @page { size: A4 landscape; margin: 5mm; }
      * { -webkit-print-color-adjust: exact ; print-color-adjust: exact ; box-sizing: border-box; margin: 0; padding: 0; }
      html, body { font-family: 'Inter', sans-serif; color: #0f172a ; background-color: #ffffff ; background: #ffffff ; padding: 0; margin: 0; -webkit-font-smoothing: antialiased; }
      #print-area { background-color: #ffffff ; background: #ffffff ; color: #0f172a ; padding: 6px; box-sizing: border-box; width: 100%; min-height: 100vh; }
      body, div, p, span, td, th { color: #0f172a ; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: #0f172a ; color: #ffffff ; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .header-card * { color: #ffffff ; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #ffffff ; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff ; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 ; }
      .period-badge { background: rgba(255,255,255,0.18) ; color: #ffffff ; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a ; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9.5px; background-color: #ffffff ; background: #ffffff ; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 5px 6px; color: #0f172a ; background-color: #ffffff ; }
      th { background-color: #0f172a ; background: #0f172a ; color: #ffffff ; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9px; letter-spacing: 0.3px; }
      tfoot td { background-color: #f1f5f9 ; background: #f1f5f9 ; font-weight: 800; color: #0f172a ; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:#0f172a; border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff; font-weight:700;">🖨️ CETAK PDF / PRINT</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div id="print-area">

    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box">
        <div>
          <div class="brand-title">SPBU GONTOR 54.634.25 MLARAK</div>
          <div class="brand-sub">Laporan Rekapitulasi Penerimaan Gaji Internal Karyawan</div>
        </div>
      </div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>

    <div class="doc-title-bar">REKAPITULASI PENERIMAAN GAJI KARYAWAN INTERNAL</div>

    <table>
      <thead>
        <tr>
          <th style="width:25px;">No</th>
          <th>Nama</th>
          <th>Keterangan</th>
          <th>Masa Kerja</th>
          <th>Gaji Pokok</th>
          <th>Tunjangan Jabatan</th>
          <th>Tunjangan Kinerja</th>
          <th>Tunjangan Masa Kerja</th>
          <th>Pertamina Way</th>
          <th>Lembur Kerja</th>
          <th>Tabungan</th>
          <th>Penerimaan Gaji Bersih Karyawan</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="font-weight:bold; background:#e5e7eb;">
          <td colspan="4" style="text-align:right;">TOTAL</td>
          <td style="text-align:right;">${fmt(totalGajiPokok)}</td>
          <td style="text-align:right;">${fmt(totalTunjJabatan)}</td>
          <td style="text-align:right;">${fmt(totalTunjKinerja)}</td>
          <td style="text-align:right;">${fmt(totalTunjMasaKerja)}</td>
          <td style="text-align:right;">${fmt(totalPw)}</td>
          <td style="text-align:right;">${fmt(totalLembur)}</td>
          <td style="text-align:right;">${fmt(totalTabungan)}</td>
          <td style="text-align:right;">${fmt(totalBersih)}</td>
        </tr>
      </tfoot>
    </table>

    <div style="display:flex; justify-content:space-between; margin-top:20px; font-size:9.5px; color:#475569;">
      <div>
        <strong style="color:#0f172a;">TOTAL PENGELUARAN GAJI UNTUK KARYAWAN:</strong>
        <span style="font-size:12px; font-weight:bold; background:#facc15; color:#0f172a; padding:3px 8px; border-radius:4px; margin-left:10px;">
          ${fmt(totalBersih + totalTabungan)}
        </span>
      </div>
      <div style="text-align:right;">
        Ponorogo, ${formattedPrintDate}<br>
        <div style="height:75px;"></div>
        <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_finance_manager)}</strong><br>
        <span>Manajer Keuangan</span>
      </div>
    </div>
    </div>
  </body>
  </html>`);
  win.document.close();
};

window._printSavingsSummary = () => {
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const formattedPrintDate = new Date(printDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const currentYear = new Date().getFullYear();
  const monthsList = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let totalAllSavings = 0;
  const rows = users.map((u, idx) => {
    let empTotal = 0;
    const monthCells = monthsList.map((m, mIdx) => {
      const amt = getEmployeeSavingsForSpecificMonth(u.emp_id, mIdx, currentYear);

      if (amt > 0) empTotal += amt;
      return `<td style="text-align:right;">${amt > 0 ? fmt(amt) : 'Rp -'}</td>`;
    }).join('');

    totalAllSavings += empTotal;

    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><strong>${esc(u.name)}</strong></td>
      ${monthCells}
      <td style="text-align:right; font-weight:bold;">${fmt(empTotal)}</td>
    </tr>`;
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Rekapitulasi Tabungan Karyawan - SPBU Gontor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>
      function downloadPDFDirect() {
        const btn = document.getElementById('btn-dl-direct');
        const origText = btn ? btn.innerHTML : '📥 UNDUH FILE PDF DIRECT';
        if (btn) { btn.innerHTML = '⏳ Mengunduh PDF...'; btn.disabled = true; }
        
        function restoreUI(msg) {
          if (btn) {
            btn.innerHTML = msg || origText;
            setTimeout(function() { btn.innerHTML = origText; btn.disabled = false; }, 2500);
          }
        }

        const pdfLib = window.html2pdf || (window.opener && window.opener.html2pdf);

        if (typeof pdfLib !== 'undefined') {
          const el = document.getElementById('print-area') || document.body;
          const opt = {
            margin: 3,
            filename: 'Rekap_Tabungan_Karyawan_${currentYear}.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
            pagebreak: { mode: ['css', 'legacy'] }
          };

          pdfLib().set(opt).from(el).save().then(function() {
            restoreUI('✅ PDF Terunduh!');
          }).catch(function(err) {
            console.error(err);
            restoreUI();
            window.print();
          });
        } else {
          restoreUI();
          window.print();
        }
      }
    </script>
    <style>
      @page { size: A4 landscape; margin: 5mm; }
      * { -webkit-print-color-adjust: exact ; print-color-adjust: exact ; box-sizing: border-box; margin: 0; padding: 0; }
      html, body { font-family: 'Inter', sans-serif; color: #0f172a ; background-color: #ffffff ; background: #ffffff ; padding: 0; margin: 0; -webkit-font-smoothing: antialiased; }
      #print-area { background-color: #ffffff ; background: #ffffff ; color: #0f172a ; padding: 6px; box-sizing: border-box; width: 100%; min-height: 100vh; }
      body, div, p, span, td, th { color: #0f172a ; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: #0f172a ; color: #ffffff ; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .header-card * { color: #ffffff ; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #ffffff ; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff ; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 ; }
      .period-badge { background: rgba(255,255,255,0.18) ; color: #ffffff ; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a ; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9px; background-color: #ffffff ; background: #ffffff ; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 4.5px 5px; color: #0f172a ; background-color: #ffffff ; }
      th { background-color: #0f172a ; background: #0f172a ; color: #ffffff ; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9px; letter-spacing: 0.3px; }
      tfoot td { background-color: #f1f5f9 ; background: #f1f5f9 ; font-weight: 800; color: #0f172a ; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:#0f172a; border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff; font-weight:700;">🖨️ CETAK PDF / PRINT</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div id="print-area">

    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box">
        <div>
          <div class="brand-title">SPBU GONTOR 54.634.25 MLARAK</div>
          <div class="brand-sub">Laporan Rekapitulasi Tabungan Karyawan</div>
        </div>
      </div>
      <div class="period-badge">TAHUN ${currentYear}</div>
    </div>

    <div class="doc-title-bar">REKAPITULASI TABUNGAN KARYAWAN PERIODE ${currentYear}</div>
    <table>
      <thead>
        <tr>
          <th style="width:25px;">NO</th>
          <th>Nama</th>
          ${monthsList.map(m => `<th>${m}-${currentYear.toString().slice(-2)}</th>`).join('')}
          <th>Total Tabungan/Individu</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="font-weight:bold; background:#e5e7eb;">
          <td colspan="14" style="text-align:right;">Total</td>
          <td style="text-align:right; background:#facc15; font-weight:800; color:#0f172a;">${fmt(totalAllSavings)}</td>
        </tr>
      </tfoot>
    </table>

    <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
      Ponorogo, ${formattedPrintDate}<br>
      <div style="height:75px;"></div>
      <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_finance_manager)}</strong><br>
      <span>Manajer Keuangan</span>
    </div>
    </div>
  </body>
  </html>`);
  win.document.close();
};

window._printOvertimeSummary = () => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};
  
  const monthNameUpper = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase();
  const formattedPrintDate = new Date(printDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  let totalOtAmtAll = 0;
  const rows = users.map((u, idx) => {
    const empId = u.emp_id;
    const empData = monthData[empId] || {};
    const shifts = Number(empData.overtime_shifts || 0);
    const otAmt = shifts * 50000;
    totalOtAmtAll += otAmt;

    return `<tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td><strong>${esc(u.name)}</strong></td>
      <td style="text-align:center;">${esc((u.position || '-').toUpperCase())}</td>
      <td style="text-align:right;">50,000</td>
      <td style="text-align:center;">${shifts} Shift</td>
      <td style="text-align:right; font-weight:bold;">${otAmt > 0 ? fmt(otAmt) : 'Rp -'}</td>
    </tr>`;
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Rekapitulasi Lemburan Karyawan - SPBU Gontor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <script>
      function downloadPDFDirect() {
        const btn = document.getElementById('btn-dl-direct');
        const origText = btn ? btn.innerHTML : '📥 UNDUH FILE PDF DIRECT';
        if (btn) { btn.innerHTML = '⏳ Mengunduh PDF...'; btn.disabled = true; }
        
        function restoreUI(msg) {
          if (btn) {
            btn.innerHTML = msg || origText;
            setTimeout(function() { btn.innerHTML = origText; btn.disabled = false; }, 2500);
          }
        }

        const pdfLib = window.html2pdf || (window.opener && window.opener.html2pdf);

        if (typeof pdfLib !== 'undefined') {
          const el = document.getElementById('print-area') || document.body;
          const opt = {
            margin: 3,
            filename: 'Rekap_Lembur_Karyawan_${month}.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true },
            pagebreak: { mode: ['css', 'legacy'] }
          };

          pdfLib().set(opt).from(el).save().then(function() {
            restoreUI('✅ PDF Terunduh!');
          }).catch(function(err) {
            console.error(err);
            restoreUI();
            window.print();
          });
        } else {
          restoreUI();
          window.print();
        }
      }
    </script>
    <style>
      @page { size: A4 landscape; margin: 4mm 6mm; }
      * { -webkit-print-color-adjust: exact ; print-color-adjust: exact ; box-sizing: border-box; margin: 0; padding: 0; }
      html, body { font-family: 'Inter', sans-serif; color: #0f172a ; background-color: #ffffff ; background: #ffffff ; padding: 0; margin: 0; -webkit-font-smoothing: antialiased; }
      #print-area { background-color: #ffffff ; background: #ffffff ; color: #0f172a ; padding: 6px; box-sizing: border-box; width: 100%; min-height: 100vh; }
      body, div, p, span, td, th { color: #0f172a ; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: #0f172a ; color: #ffffff ; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .header-card * { color: #ffffff ; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #6366f1, #a855f7); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #ffffff ; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff ; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 ; }
      .period-badge { background: rgba(255,255,255,0.18) ; color: #ffffff ; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a ; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; background-color: #ffffff ; background: #ffffff ; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 5.5px 7px; color: #0f172a ; background-color: #ffffff ; }
      th { background-color: #0f172a ; background: #0f172a ; color: #ffffff ; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.3px; }
      tfoot td { background-color: #f1f5f9 ; background: #f1f5f9 ; font-weight: 800; color: #0f172a ; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:#0f172a; border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff; font-weight:700;">🖨️ CETAK PDF / PRINT</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div id="print-area">

    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box">
        <div>
          <div class="brand-title">SPBU GONTOR 54.634.25 MLARAK</div>
          <div class="brand-sub">Laporan Rekapitulasi Lembur Kerja Karyawan</div>
        </div>
      </div>
      <div class="period-badge">BULAN ${monthNameUpper}</div>
    </div>

    <div class="doc-title-bar">REKAPITULASI LEMBURAN KARYAWAN</div>

    <table>
      <thead>
        <tr>
          <th style="width:30px;">NO</th>
          <th>NAMA</th>
          <th>JABATAN</th>
          <th>NOMINAL LEMBUR / SHIFT</th>
          <th>JUMLAH LEMBUR 1 BULAN</th>
          <th style="text-align:right;">JUMLAH</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="font-weight:bold; background:#e5e7eb;">
          <td colspan="5" style="text-align:right;">TOTAL</td>
          <td style="text-align:right; color:#059669; font-size:11px;">Rp ${fmt(totalOtAmtAll)}</td>
        </tr>
      </tfoot>
    </table>

    <div style="text-align:right; margin-top:20px; font-size:9.5px; color:#475569;">
      Ponorogo, ${formattedPrintDate}<br>
      <div style="height:75px;"></div>
      <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_finance_manager)}</strong><br>
      <span>Manajer Keuangan</span>
    </div>
    </div>
  </body>
  </html>`);
  win.document.close();
};

// ==========================================
// CERTIFICATE GENERATOR (SERTIFIKAT PENGHARGAAN)
// ==========================================

function getNextCertNumber(month) {
  const certs = allData.certificates || {};
  const prefix = `CERT/SPBU-5463425/${month.replace('-', '/')}`;
  let maxNum = 0;
  Object.values(certs).forEach(c => {
    if (c.reg_no && c.reg_no.startsWith(prefix)) {
      const parts = c.reg_no.split('/');
      const num = parseInt(parts[parts.length - 1]) || 0;
      if (num > maxNum) maxNum = num;
    }
  });
  return String(maxNum + 1).padStart(3, '0');
}

function generateCertRegNo(month) {
  const [y, m] = month.split('-');
  const seq = getNextCertNumber(month);
  return `CERT/SPBU-5463425/${y}/${m}/${seq}`;
}

window._openCertificateModal = (empId) => {
  const users = getUsers();
  const settings = getPayrollSettings();
  const now = new Date();
  const currentMonth = now.toISOString().substring(0, 7);
  const todayStr = now.toISOString().substring(0, 10);
  const regNo = generateCertRegNo(currentMonth);

  let selectedUser = empId ? users.find(u => u.emp_id === empId) : null;

  const titlePresets = [
    'KARYAWAN TERBAIK (EMPLOYEE OF THE MONTH)',
    'PENGHARGAAN KEDISIPLINAN & KEPATUHAN SOP',
    'OPERATOR TERDISIPLIN',
    'OPERATOR TELITI & JUJUR',
    'KARYAWAN PALING BERDEDIKASI',
    'PENGHARGAAN LOYALITAS KERJA'
  ];

  const descPresets = [
    'Atas dedikasi luar biasa, kedisiplinan tinggi, serta kepatuhan penuh terhadap standar operasional dan pelayanan prima di SPBU Gontor 54.634.25 Mlarak.',
    'Atas integritas, kejujuran, dan kontribusi nyata dalam menjaga kualitas pelayanan SPBU Gontor 54.634.25 Mlarak.',
    'Atas konsistensi kehadiran, ketepatan waktu, dan profesionalisme kerja yang patut menjadi teladan bagi seluruh karyawan SPBU Gontor 54.634.25 Mlarak.'
  ];

  const periodMonth = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const modal = document.createElement('div');
  modal.id = 'cert-modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px);';
  modal.innerHTML = `
  <div style="background:var(--surface,#1e293b);border-radius:16px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;padding:1.75rem;box-shadow:0 25px 50px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;">
      <h3 style="margin:0;font-size:1.15rem;font-weight:800;color:var(--text-main,#f1f5f9);">🎖️ Buat Sertifikat Penghargaan</h3>
      <button onclick="document.getElementById('cert-modal-overlay').remove()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted,#94a3b8);">✕</button>
    </div>

    <div style="display:grid;gap:0.85rem;">
      <div>
        <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Pilih Karyawan</label>
        <select id="cert-emp" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;" onchange="window._certEmpChanged()">
          <option value="">-- Pilih Karyawan atau Input Manual --</option>
          ${users.map(u => `<option value="${u.emp_id}" ${selectedUser && u.emp_id === selectedUser.emp_id ? 'selected' : ''}>${esc(u.name)} — ${esc(u.position || '-')}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Nama Penerima</label>
          <input id="cert-name" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="${selectedUser ? esc(selectedUser.name) : ''}" placeholder="Nama Lengkap Karyawan">
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Jabatan</label>
          <input id="cert-position" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="${selectedUser ? esc(selectedUser.position || '') : ''}" placeholder="Jabatan">
        </div>
      </div>
      <div>
        <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">No. Registrasi Sertifikat</label>
        <input id="cert-regno" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="${regNo}">
      </div>
      <div>
        <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Judul Penghargaan</label>
        <select id="cert-title-preset" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;margin-bottom:0.4rem;" onchange="if(this.value)document.getElementById('cert-title').value=this.value;">
          <option value="">-- Pilih Preset atau Ketik Sendiri --</option>
          ${titlePresets.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <input id="cert-title" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="${titlePresets[0]}" placeholder="Judul Penghargaan Kustom">
      </div>
      <div>
        <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Keterangan / Narasi Penghargaan</label>
        <select id="cert-desc-preset" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;margin-bottom:0.4rem;" onchange="if(this.value)document.getElementById('cert-desc').value=this.value;">
          <option value="">-- Pilih Preset atau Ketik Sendiri --</option>
          ${descPresets.map(d => `<option value="${d}">${d.substring(0, 80)}...</option>`).join('')}
        </select>
        <textarea id="cert-desc" class="form-input" rows="3" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;resize:vertical;">${descPresets[0]}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Periode Penghargaan</label>
          <input id="cert-period" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="Periode ${periodMonth}">
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Tanggal Terbit</label>
          <input id="cert-date" type="date" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="${todayStr}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Penandatangan 1 (Nama)</label>
          <input id="cert-sign1-name" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="${esc(settings.name_finance_manager || 'Pedri Fauzi')}">
          <input id="cert-sign1-title" class="form-input" style="width:100%;padding:0.5rem;font-size:0.8rem;box-sizing:border-box;margin-top:0.3rem;" value="Manager" placeholder="Jabatan">
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Penandatangan 2 (Opsional)</label>
          <input id="cert-sign2-name" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;box-sizing:border-box;" value="" placeholder="Nama Direktur / Supervisor">
          <input id="cert-sign2-title" class="form-input" style="width:100%;padding:0.5rem;font-size:0.8rem;box-sizing:border-box;margin-top:0.3rem;" value="" placeholder="Jabatan">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Font Judul Sertifikat</label>
          <select id="cert-title-font" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;">
            <option value="Cinzel">🏛️ Cinzel (Clean Roman Capital - Resmi & Wibawa)</option>
            <option value="Cormorant Garamond">📜 Cormorant Garamond (Classic Diplomatic Serif)</option>
            <option value="Playfair Display">💼 Playfair Display (High-Contrast Executive)</option>
            <option value="Bodoni Moda">✨ Bodoni Moda (Modern Premium Luxury)</option>
            <option value="Cinzel Decorative">🎨 Cinzel Decorative (Ukiran Hiasan)</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Font Nama Karyawan</label>
          <select id="cert-name-font" class="form-input" style="width:100%;padding:0.5rem;font-size:0.85rem;">
            <option value="Alex Brush">✨ Alex Brush (Kaligrafi Klasik & Rapi - Rekomendasi)</option>
            <option value="Great Vibes">🖊️ Great Vibes (Kaligrafi Halus)</option>
            <option value="Playfair Display">📜 Playfair Display (Serif Formal & Wibawa)</option>
            <option value="Pinyon Script">👑 Pinyon Script (Royal / Luxury Script)</option>
            <option value="Tangerine">🖋️ Tangerine (Artistic Quill Pen Calligraphy)</option>
            <option value="Cinzel Decorative">🏛️ Cinzel Decorative (Capital Bold Formal)</option>
          </select>
        </div>
      </div>
      <div>
        <label style="font-size:0.78rem;font-weight:700;color:var(--text-muted,#94a3b8);display:block;margin-bottom:0.3rem;">Tema Desain Sertifikat</label>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.82rem;color:var(--text-main,#f1f5f9);">
            <input type="radio" name="cert-theme" value="gold" checked> 🏆 Royal Gold Classic
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.82rem;color:var(--text-main,#f1f5f9);">
            <input type="radio" name="cert-theme" value="navy"> 🔷 Navy Gold Executive
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.82rem;color:var(--text-main,#f1f5f9);">
            <input type="radio" name="cert-theme" value="emerald"> 💎 Emerald Leadership
          </label>
        </div>
      </div>
    </div>

    <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.25rem;flex-wrap:wrap;">
      <button class="btn" style="padding:0.5rem 1.25rem;font-size:0.85rem;background:#334155;color:#cbd5e1;border:none;border-radius:8px;cursor:pointer;font-weight:700;" onclick="document.getElementById('cert-modal-overlay').remove()">Batal</button>
      <button class="btn" style="padding:0.5rem 1.25rem;font-size:0.85rem;background:linear-gradient(135deg,#b38728,#fcf6ba,#bf953f);color:#1a1a2e;border:none;border-radius:8px;cursor:pointer;font-weight:900;box-shadow:0 4px 15px rgba(179,135,40,0.4);" onclick="window._printCertificate()">🎖️ Pratinjau & Cetak Sertifikat</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
};

window._certEmpChanged = () => {
  const sel = $('cert-emp');
  if (!sel || !sel.value) return;
  const users = getUsers();
  const u = users.find(x => x.emp_id === sel.value);
  if (u) {
    const nameInp = $('cert-name');
    const posInp = $('cert-position');
    if (nameInp) nameInp.value = u.name || '';
    if (posInp) posInp.value = u.position || '';
  }
};

window._printCertificate = async () => {
  const name = ($('cert-name') || {}).value || 'Nama Karyawan';
  const position = ($('cert-position') || {}).value || 'Jabatan';
  const regNo = ($('cert-regno') || {}).value || '';
  const title = ($('cert-title') || {}).value || 'KARYAWAN TERBAIK';
  const desc = ($('cert-desc') || {}).value || '';
  const period = ($('cert-period') || {}).value || '';
  const dateStr = ($('cert-date') || {}).value || '';
  const sign1Name = ($('cert-sign1-name') || {}).value || '';
  const sign1Title = ($('cert-sign1-title') || {}).value || '';
  const sign2Name = ($('cert-sign2-name') || {}).value || '';
  const sign2Title = ($('cert-sign2-title') || {}).value || '';
  const titleFont = ($('cert-title-font') || {}).value || 'Cinzel';
  const nameFont = ($('cert-name-font') || {}).value || 'Alex Brush';
  const themeRadio = document.querySelector('input[name="cert-theme"]:checked');
  const theme = themeRadio ? themeRadio.value : 'gold';

  const formattedDate = dateStr ? new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  // Save certificate to database
  const certId = 'cert_' + Date.now();
  try {
    await set(ref(db, 'certificates/' + certId), {
      reg_no: regNo, emp_name: name, position, title, description: desc,
      period, issue_date: dateStr, sign1_name: sign1Name, sign1_title: sign1Title,
      sign2_name: sign2Name, sign2_title: sign2Title, title_font: titleFont, name_font: nameFont, theme, created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Failed to save certificate to Firebase:', err);
  }

  // Theme color palettes
  const themes = {
    gold: {
      borderGrad1: '#b45309', borderGrad2: '#d97706', borderGrad3: '#92400e', borderGrad4: '#78350f',
      headerColor: '#78350f', titleColor: '#1e293b', nameColor: '#92400e', bodyBg: '#fffdf5',
      titleGrad1: '#78350f', titleGrad2: '#b45309', titleGrad3: '#92400e',
      sealColor1: '#d97706', sealColor2: '#fef3c7', cornerAccent: '#b45309',
      guillocheLine: 'rgba(180,83,9,0.15)', watermarkColor: 'rgba(120,53,15,0.095)'
    },
    navy: {
      borderGrad1: '#1e3a8a', borderGrad2: '#2563eb', borderGrad3: '#b45309', borderGrad4: '#78350f',
      headerColor: '#1e3a8a', titleColor: '#0f172a', nameColor: '#1e3a8a', bodyBg: '#f8fafc',
      titleGrad1: '#1e3a8a', titleGrad2: '#2563eb', titleGrad3: '#1e3a8a',
      sealColor1: '#b45309', sealColor2: '#fef3c7', cornerAccent: '#1d4ed8',
      guillocheLine: 'rgba(30,58,138,0.15)', watermarkColor: 'rgba(30,58,138,0.095)'
    },
    emerald: {
      borderGrad1: '#065f46', borderGrad2: '#059669', borderGrad3: '#b45309', borderGrad4: '#78350f',
      headerColor: '#065f46', titleColor: '#0f172a', nameColor: '#065f46', bodyBg: '#f0fdf4',
      titleGrad1: '#065f46', titleGrad2: '#059669', titleGrad3: '#065f46',
      sealColor1: '#059669', sealColor2: '#ecfdf5', cornerAccent: '#047857',
      guillocheLine: 'rgba(6,95,70,0.15)', watermarkColor: 'rgba(6,95,70,0.095)'
    }
  };
  const t = themes[theme] || themes.gold;

  // Build clean corner SVG pattern without square boxes
  const islamicCornerSVG = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" style="position:absolute;width:140px;height:140px;opacity:0.8;pointer-events:none;">
      <defs>
        <linearGradient id="isGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${t.borderGrad1}"/>
          <stop offset="50%" style="stop-color:${t.borderGrad3}"/>
          <stop offset="100%" style="stop-color:${t.borderGrad4}"/>
        </linearGradient>
      </defs>
      <path d="M 8 8 L 130 8 L 130 16 L 16 16 L 16 130 L 8 130 Z" fill="url(#isGrad)" opacity="0.3"/>
      <path d="M 22 22 L 95 22 L 95 25 L 25 25 L 25 95 L 22 95 Z" fill="url(#isGrad)" opacity="0.5"/>
    </svg>`;

  // Build Gold Seal SVG with large, bold, high-contrast SPBU GONTOR 54.634.25 text
  const sealSVG = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style="width:150px;height:150px;">
      <defs>
        <linearGradient id="sealGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${t.sealColor1}"/>
          <stop offset="35%" style="stop-color:${t.sealColor2}"/>
          <stop offset="70%" style="stop-color:${t.sealColor1}"/>
          <stop offset="100%" style="stop-color:${t.borderGrad4}"/>
        </linearGradient>
        <filter id="sealShadow"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="rgba(0,0,0,0.3)"/></filter>
      </defs>
      <g filter="url(#sealShadow)">
        <path d="${generateStarPath(100, 100, 88, 70, 20)}" fill="url(#sealGrad)" stroke="${t.borderGrad4}" stroke-width="1.5"/>
        <circle cx="100" cy="100" r="62" fill="${t.bodyBg}" stroke="${t.borderGrad4}" stroke-width="1.5"/>
        <circle cx="100" cy="100" r="56" fill="none" stroke="${t.borderGrad1}" stroke-width="1" stroke-dasharray="4 2"/>
      </g>
      <text x="100" y="70" text-anchor="middle" fill="${t.headerColor}" font-family="Cinzel,serif" font-size="9.5" font-weight="900" letter-spacing="1.8">EXCELLENCE</text>
      <text x="100" y="85" text-anchor="middle" fill="${t.headerColor}" font-family="Cinzel,serif" font-size="8.5" font-weight="800" letter-spacing="1.2">AWARD</text>
      <line x1="55" y1="92" x2="145" y2="92" stroke="${t.borderGrad4}" stroke-width="1"/>
      <text x="100" y="108" text-anchor="middle" fill="#0f172a" font-family="Cinzel,serif" font-size="10.5" font-weight="900" letter-spacing="1.2">SPBU GONTOR</text>
      <text x="100" y="123" text-anchor="middle" fill="#78350f" font-family="Cinzel,sans-serif" font-size="9.5" font-weight="900" letter-spacing="0.8">54.634.25</text>
    </svg>`;

  // Signature block
  const sign1Block = sign1Name ? `
    <div style="text-align:center;min-width:220px;">
      <div style="height:80px;"></div>
      <div style="border-bottom:2px solid ${t.headerColor};width:200px;margin:0 auto;"></div>
      <div style="font-family:'Cinzel',serif;font-weight:700;font-size:13px;color:${t.titleColor};margin-top:6px;">${esc(sign1Name)}</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:11px;color:#64748b;margin-top:2px;">${esc(sign1Title)}</div>
    </div>` : '';

  const sign2Block = sign2Name ? `
    <div style="text-align:center;min-width:220px;">
      <div style="height:80px;"></div>
      <div style="border-bottom:2px solid ${t.headerColor};width:200px;margin:0 auto;"></div>
      <div style="font-family:'Cinzel',serif;font-weight:700;font-size:13px;color:${t.titleColor};margin-top:6px;">${esc(sign2Name)}</div>
      <div style="font-family:'Cormorant Garamond',serif;font-size:11px;color:#64748b;margin-top:2px;">${esc(sign2Title)}</div>
    </div>` : '';

  const win = window.open('', '_blank');
  if (!win) { alert('Popup diblokir. Izinkan popup untuk mencetak sertifikat.'); return; }
  win.document.write(`<!DOCTYPE html>
  <html lang="id">
  <head>
    <meta charset="UTF-8">
    <title>Sertifikat Penghargaan - ${esc(name)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Alex+Brush&family=Bodoni+Moda:ital,opsz,wght@0,6..96,700;0,6..96,900;1,6..96,700&family=Cinzel+Decorative:wght@400;700;900&family=Cinzel:wght@400;500;600;700;800;900&family=Great+Vibes&family=Playfair+Display:ital,wght@0,600;0,700;1,600&family=Pinyon+Script&family=Tangerine:wght@700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      @page { size: A4 landscape; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { width: 297mm; height: 210mm; overflow: hidden; background: #fff; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }

      .cert-page {
        width: 297mm; height: 210mm; position: relative; overflow: hidden;
        background: radial-gradient(circle, #ffffff 30%, ${t.bodyBg} 100%);
        display: flex; align-items: center; justify-content: center;
      }

      .cert-page::after {
        content: 'SPBU GONTOR'; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-25deg);
        font-family: 'Cinzel', serif; font-size: 110px; font-weight: 900; letter-spacing: 15px;
        color: ${t.watermarkColor}; z-index: 0; white-space: nowrap; pointer-events: none;
      }

      .cert-frame {
        position: relative; z-index: 1;
        width: calc(297mm - 24mm); height: calc(210mm - 24mm);
        border: 4px solid ${t.borderGrad1};
        border-image: linear-gradient(135deg, ${t.borderGrad1}, ${t.borderGrad2}, ${t.borderGrad3}, ${t.borderGrad2}, ${t.borderGrad4}) 1;
        padding: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
      }

      /* Inner decorative border */
      .cert-inner {
        position: absolute; inset: 6px;
        border: 1.5px solid ${t.borderGrad3};
        border-image: linear-gradient(135deg, ${t.borderGrad3}aa, ${t.borderGrad2}dd, ${t.borderGrad1}aa) 1;
        pointer-events: none;
      }
      .cert-inner::after {
        content: ''; position: absolute; inset: 4px;
        border: 0.8px solid ${t.borderGrad3}66;
        pointer-events: none;
      }

      .cert-content {
        text-align: center; padding: 40px 60px; position: relative; z-index: 2;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        height: 100%; width: 100%;
      }

      .corner-tl { position: absolute; top: -5px; left: -5px; transform: rotate(0deg); }
      .corner-tr { position: absolute; top: -5px; right: -5px; transform: rotate(90deg); }
      .corner-bl { position: absolute; bottom: -5px; left: -5px; transform: rotate(270deg); }
      .corner-br { position: absolute; bottom: -5px; right: -5px; transform: rotate(180deg); }

      .no-print { display: block; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px;background:#0f172a;border-bottom:3px solid #bf953f;display:flex;justify-content:flex-end;gap:10px;align-items:center;">
      <button onclick="window.print()" style="padding:8px 20px;background:linear-gradient(135deg,#b38728,#fcf6ba,#bf953f);color:#1a1a2e;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:900;font-family:'Inter',sans-serif;">🖨️ CETAK / PRINT PDF</button>
      <button onclick="window.close()" style="padding:8px 20px;background:#334155;color:#cbd5e1;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-family:'Inter',sans-serif;">✕ Tutup</button>
    </div>

    <div class="cert-page">
      <div class="cert-frame">
        <div class="cert-inner"></div>

        <!-- Corner Ornaments -->
        <div class="corner-tl">${islamicCornerSVG}</div>
        <div class="corner-tr">${islamicCornerSVG}</div>
        <div class="corner-bl">${islamicCornerSVG}</div>
        <div class="corner-br">${islamicCornerSVG}</div>

        <div class="cert-content">

          <!-- Reg Number Top Right -->
          <div style="position:absolute;top:24px;right:36px;font-family:'Inter',sans-serif;font-size:10px;color:#64748b;letter-spacing:0.5px;font-weight:600;">
            No. ${esc(regNo)}
          </div>

          <!-- Top section container -->
          <div style="display:flex; flex-direction:column; align-items:center; width:100%;">
            <!-- Header -->
            <div style="margin-top:8px; margin-bottom:6px;">
              <div style="font-family:'Cinzel',serif;font-size:15px;font-weight:800;color:${t.headerColor};letter-spacing:3.5px;text-transform:uppercase;">PT. ESTAFET DWI MASA</div>
            </div>

            <!-- Islamic Header Line with Rub el Hizb Emblem -->
            <svg width="420" height="18" style="margin-bottom:12px;">
              <defs>
                <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style="stop-color:transparent"/>
                  <stop offset="25%" style="stop-color:${t.borderGrad1}"/>
                  <stop offset="50%" style="stop-color:${t.borderGrad3}"/>
                  <stop offset="75%" style="stop-color:${t.borderGrad1}"/>
                  <stop offset="100%" style="stop-color:transparent"/>
                </linearGradient>
              </defs>
              <line x1="0" y1="9" x2="420" y2="9" stroke="url(#lineGrad)" stroke-width="1.2"/>
              <g transform="translate(210, 9)">
                <rect x="-7" y="-7" width="14" height="14" fill="${t.bodyBg}" stroke="${t.borderGrad1}" stroke-width="1.2" transform="rotate(0)"/>
                <rect x="-7" y="-7" width="14" height="14" fill="none" stroke="${t.borderGrad1}" stroke-width="1.2" transform="rotate(45)"/>
                <circle cx="0" cy="0" r="2.5" fill="${t.borderGrad3}"/>
              </g>
            </svg>

            <!-- Title (Highlighted Crisp Metallic Gradient) -->
            <div style="font-family:'${esc(titleFont)}',serif;font-size:44px;font-weight:900;color:${t.headerColor};letter-spacing:6px;line-height:1.25;margin-bottom:4px;background:linear-gradient(135deg, ${t.titleGrad1}, ${t.titleGrad2}, ${t.titleGrad3});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15));">
              SERTIFIKAT PENGHARGAAN
            </div>
            <div style="font-family:'Cinzel',serif;font-size:15px;font-weight:800;color:${t.headerColor};letter-spacing:6px;margin-bottom:16px;opacity:0.95;">
              CERTIFICATE OF EXCELLENCE
            </div>

            <!-- Subtitle -->
            <div style="font-family:'Cormorant Garamond',serif;font-size:18px;color:#334155;font-style:italic;margin-bottom:10px;font-weight:600;">
              Diberikan dengan bangga dan penghargaan setinggi-tingginya kepada:
            </div>
          </div>

          <!-- Middle recipient section (Highlighted Name) -->
          <div style="display:flex; flex-direction:column; align-items:center; width:100%; margin: 4px 0;">
            <!-- Recipient Name Highlighted -->
            <div style="font-family:'${esc(nameFont)}',cursive,serif;font-size:68px;color:${t.nameColor};margin-bottom:2px;line-height:1.1;font-weight:700;text-shadow:0 3px 12px ${t.borderGrad1}44;">
              ${esc(name)}
            </div>
            <div style="width:280px;height:2px;background:linear-gradient(90deg,transparent,${t.borderGrad1},${t.borderGrad3},${t.borderGrad1},transparent);margin:2px 0 8px;"></div>
            <div style="font-family:'Cinzel',serif;font-size:15px;font-weight:800;color:${t.headerColor};letter-spacing:4px;text-transform:uppercase;margin-bottom:12px;">
              ${esc(position)}
            </div>

            <!-- Award decorative line -->
            <svg width="320" height="8" style="margin-bottom:12px;">
              <defs><linearGradient id="lineGrad2" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:transparent"/><stop offset="30%" style="stop-color:${t.borderGrad1}"/><stop offset="50%" style="stop-color:${t.borderGrad2}"/><stop offset="70%" style="stop-color:${t.borderGrad1}"/><stop offset="100%" style="stop-color:transparent"/></linearGradient></defs>
              <line x1="0" y1="4" x2="320" y2="4" stroke="url(#lineGrad2)" stroke-width="1"/>
            </svg>

            <!-- Award Title -->
            <div style="font-family:'Cinzel',serif;font-size:17px;font-weight:800;color:${t.titleColor};letter-spacing:2px;margin-bottom:12px;padding:7px 28px;border:1.5px solid ${t.borderGrad1}66;border-radius:4px;background:linear-gradient(135deg,${t.borderGrad1}10,${t.borderGrad2}20,${t.borderGrad1}10);box-shadow:0 2px 6px rgba(0,0,0,0.03);">
              " ${esc(title)} "
            </div>

            <!-- Description -->
            <div style="font-family:'Cormorant Garamond',serif;font-size:16.5px;color:#1e293b;max-width:760px;line-height:1.7;margin-bottom:10px;font-weight:500;">
              ${esc(desc)}
            </div>

            <!-- Period -->
            <div style="font-family:'Cinzel',serif;font-size:13px;font-weight:700;color:${t.headerColor};letter-spacing:2px;margin-bottom:8px;">
              ${esc(period)}
            </div>
          </div>

          <!-- Seal + Signatures Row -->
          <div style="display:flex;align-items:flex-end;justify-content:center;gap:80px;width:100%;margin-top:auto;padding-bottom:6px;">
            <!-- Seal -->
            <div style="display:flex;flex-direction:column;align-items:center;">
              ${sealSVG}
            </div>

            <!-- Signatures -->
            <div style="display:flex;gap:100px;">
              ${sign1Block}
              ${sign2Block}
            </div>
          </div>

          <!-- Bottom date -->
          <div style="position:absolute;bottom:22px;right:36px;font-family:'Cormorant Garamond',serif;font-size:12px;color:#475569;font-weight:600;">
            Ponorogo, ${formattedDate}
          </div>

        </div>
      </div>
    </div>

  </body>
  </html>`);
  win.document.close();
};

// Helper: generate star/seal path for SVG
function generateStarPath(cx, cy, outerR, innerR, points) {
  let path = '';
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    path += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
  }
  return path + 'Z';
}

// ==========================================
// START
// ==========================================
document.addEventListener('DOMContentLoaded', init);

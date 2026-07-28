import { db, auth, ref, onValue, set, push, remove, update, get, child, signInWithEmailAndPassword, signOut, onAuthStateChanged, browserSessionPersistence, setPersistence } from './firebase-config.js?v=20260712g';

// ==========================================
// STATE
// ==========================================
let currentUser = null;
let currentSection = 'dashboard';
let allData = { users: {}, transactions: {}, leaves: {}, savings: {}, violations: {}, ratings: {}, criteria: {}, leave_types: {}, settings: {}, pin_history: {}, payroll: {}, payroll_settings: {} };

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

const savedTheme = localStorage.getItem('spbu_theme');
if (savedTheme) applyTheme(savedTheme);

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
  const nodes = ['users', 'transactions', 'leaves', 'savings', 'violations', 'ratings', 'criteria', 'leave_types', 'settings', 'pin_history', 'internal_chats', 'payroll', 'payroll_settings'];
  nodes.forEach(node => {
    onValue(ref(db, node), snap => {
      allData[node] = snap.exists() ? snap.val() : {};

      if (node === 'settings') {
        applyTheme(allData.settings.theme || 'orange');
      }

      if (node === 'users') {
        const empSelect = document.getElementById('inp-emp-username');
        if (empSelect) {
          const currentVal = empSelect.value;
          const usersList = Object.values(allData.users).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          if (usersList.length === 0) {
            empSelect.innerHTML = '<option value="">-- Belum ada karyawan --</option>';
          } else {
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
  { id: 'leaderboard', label: 'Peringkat & KPI', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
  { id: 'payroll', label: 'Gaji & Payroll', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V6m0 8v2m0-6c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'employees', label: 'Karyawan', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197' },
  { id: 'debits', label: 'Tunggakan', icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z' },
  { id: 'leaves', label: 'Izin/Cuti', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
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

function initAdminDashboardCharts() {
  if (typeof Chart === 'undefined') return;
  const colors = getChartColors();

  // 1. Attendance Trend (Last 14 days with Sakit / Izin / Cuti / Libur / Lainnya breakdown)
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

    const allLeaves = Object.values(allData.leaves || {}).filter(l => l.status === 'Disetujui');
    const allAbsensi = Object.values(allData.absensi_records || {});

    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      days.push(d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));

      const recs = allAbsensi.filter(r => r.date === dateStr);
      let onTime = 0, late = 0, sakit = 0, izin = 0, cuti = 0, libur = 0, other = 0;

      recs.forEach(r => {
        const st = (r.status || r.type || '').toString().toLowerCase();
        if (r.clock_in && r.clock_in !== '-' && !['sakit', 'izin', 'cuti', 'libur', 'off'].includes(st)) {
          if ((r.late_minutes || 0) > 0 || st === 'terlambat') late++;
          else onTime++;
        } else if (st === 'sakit') {
          sakit++;
        } else if (st === 'izin') {
          izin++;
        } else if (st === 'cuti') {
          cuti++;
        } else if (st === 'libur' || st === 'off') {
          libur++;
        } else if (st && st !== 'hadir') {
          other++;
        }
      });

      // Count approved leaves active on dateStr
      allLeaves.forEach(l => {
        if (l.start_date && l.end_date && dateStr >= l.start_date && dateStr <= l.end_date) {
          const lType = (l.leave_type || '').toString().toLowerCase();
          if (lType.includes('sakit')) sakit++;
          else if (lType.includes('izin')) izin++;
          else if (lType.includes('cuti')) cuti++;
          else if (lType.includes('libur') || lType.includes('off')) libur++;
          else other++;
        }
      });

      onTimeData.push(onTime);
      lateData.push(late);
      sakitData.push(sakit);
      izinData.push(izin);
      cutiData.push(cuti);
      liburData.push(libur);
      otherData.push(other);
    }

    window._myTicCharts['admin-attendance'] = new Chart(attCanvas, {
      type: 'line',
      data: {
        labels: days,
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
    const leaves = Object.values(allData.leaves || {});
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
    const sopRecords = Object.values(allData.ceklissop_records || {});
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
    const vios = Object.values(allData.violations || {});
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
function renderDebits() {
  const users = getUsers();
  const allowCredit = canAddCredit();
  const allowDebit = canAddDebit();

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h3 class="text-xl font-bold">Tunggakan Karyawan</h3>
      ${isEmpAdminOrSupervisor() ? '<span class="badge badge-warning">Akses Tambah Debit (Admin/Supervisor)</span>' : ''}
    </div>
    ${users.length === 0 ? '<div class="card"><p class="text-muted">Tambahkan karyawan dahulu.</p></div>' :
      users.map(e => {
        const bal = calcBalance(e.emp_id);
        const txns = getTxns(e.emp_id);
        return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="document.getElementById('txn-${e.emp_id}').classList.toggle('hidden')">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800">${(e.name || '?')[0]}</div>
            <div><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)}</span></div>
          </div>
          <div style="text-align:right"><strong style="color:${bal > 0 ? 'var(--danger)' : bal < 0 ? 'var(--success)' : 'var(--text-muted)'}">${fmt(bal)}</strong><br><span class="text-xs text-muted">${txns.length} transaksi</span></div>
        </div>
        <div id="txn-${e.emp_id}" class="hidden" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
          ${(allowDebit || allowCredit) ? `
          <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
            ${allowDebit ? `<button class="btn btn-danger" style="flex:1;padding:0.5rem;font-size:0.75rem" onclick="window._showTxnForm('${e.emp_id}','debit')">+ Debit (Tambah Tunggakan)</button>` : ''}
            ${allowCredit ? `<button class="btn btn-primary" style="flex:1;padding:0.5rem;font-size:0.75rem;background:var(--success)" onclick="window._showTxnForm('${e.emp_id}','credit')">+ Kredit (Pembayaran)</button>` : ''}
          </div>` : ''}
          <div id="txn-form-${e.emp_id}"></div>
          ${txns.length === 0 ? '<p class="text-xs text-muted" style="text-align:center">Belum ada transaksi.</p>' :
            txns.map(t => {
              const adder = t.added_by || 'Manajemen';
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.75rem;background:var(--bg-color);border-radius:var(--radius-md);margin-bottom:0.35rem;font-size:0.8rem">
              <div>
                <strong style="color:${t.type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${t.type === 'debit' ? '+' : '-'}${fmt(t.amount)}</strong> 
                <span class="text-muted">${esc(t.note || '')}</span>
                <span class="text-xs text-muted" style="display:block;margin-top:3px;font-size:0.72rem;">✍️ Ditambahkan oleh: <strong style="color:var(--text-main)">${esc(adder)}</strong></span>
              </div>
              <div style="display:flex;align-items:center;gap:0.5rem">
                <span class="text-muted" style="font-size:0.75rem">${fmtDate(t.date)}</span>
                ${currentUser.role === 'admin' ? `<button style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:0.7rem" onclick="window._deleteTxn('${t._key}')">✕</button>` : ''}
              </div>
            </div>`;
            }).join('')}
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
  const ratings = getRatings();
  const users = getUsers();
  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem">
      <h3 class="text-xl font-bold">Penilaian Kinerja</h3>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        ${ratings.length > 0 ? `<button class="btn btn-outline-primary" onclick="window._downloadAllRatingsPDF()">Unduh Semua PDF</button>` : ''}
        <button class="btn btn-primary" onclick="window._showRatingForm()">+ Tambah Penilaian</button>
      </div>
    </div>
    ${ratings.length === 0 ? '<div class="card"><p class="text-muted">Belum ada penilaian.</p></div>' :
      ratings.map(r => {
        const emp = getUserByEmpId(r.emp_id);
        const avg = r.scores ? (Object.values(r.scores).reduce((s, v) => s + v, 0) / Object.values(r.scores).length).toFixed(1) : '0';
        const color = avg >= 4.5 ? 'var(--success)' : avg >= 3.5 ? 'var(--info)' : avg >= 2.5 ? 'var(--warning)' : 'var(--danger)';
        return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(emp ? emp.name : r.emp_id)}</strong><br><span class="text-xs text-muted">Periode: ${fmtMonthYear(r.date)}</span></div>
          <div style="text-align:right"><span style="font-size:1.5rem;font-weight:800;color:${color}">${avg}</span><span class="text-xs text-muted">/5</span><br>
          <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.25rem;flex-wrap:wrap;">
            <button class="btn btn-outline-primary" style="padding:0.2rem 0.5rem;font-size:0.65rem;" onclick="window._downloadSingleRatingPDF('${r._key}')">Unduh PDF</button>
            <button class="btn btn-outline-primary" style="padding:0.2rem 0.5rem;font-size:0.65rem;" onclick="window._exportSingleRatingPDF('${r._key}')">Cetak</button>
            <button class="btn btn-outline-danger" style="padding:0.2rem 0.5rem;font-size:0.65rem;" onclick="window._deleteRating('${r._key}')">Hapus</button>
          </div>
          </div>
        </div>
        ${r.note ? `<p class="text-xs text-muted mt-2" style="border-top:1px solid var(--border);padding-top:0.5rem">"${esc(r.note)}"</p>` : ''}
      </div>`;
      }).join('')}
  </div>`;
}

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
function renderLeaderboard() {
  const monthVal = window._leaderboardMonth || '';
  const users = getUsers();
  let allRatings = getRatings();

  if (monthVal) {
    allRatings = allRatings.filter(r => (r.date || '').startsWith(monthVal));
  }

  if (users.length === 0) return '<div class="fade-in"><div class="card"><p class="text-muted">Tambahkan karyawan terlebih dahulu.</p></div></div>';

  const scores = users.map(u => {
    const r = allRatings.filter(x => x.emp_id === u.emp_id);
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
    return { ...u, avg: parseFloat(avg.toFixed(2)), evalCount: r.length };
  }).filter(u => u.evalCount > 0 || !monthVal) // Hide employees with 0 evals in specific month, but show all if no filter
    .sort((a, b) => b.avg - a.avg);

  return `<div class="fade-in">
    <div style="display:flex;flex-wrap:wrap;gap:1rem;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Peringkat Kinerja Karyawan</h3>
      <input type="month" class="input-field" style="width: auto; padding: 0.5rem; border-radius: var(--radius-md); border: 1px solid var(--border);" value="${monthVal}" onchange="window._filterLeaderboard(this.value)">
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
          <span style="font-size:1.8rem;font-weight:800;color:${color}">${s.avg}</span><span class="text-xs text-muted">/5</span>
        </div>
      </div>`;
      }).join('')}
  </div>`;
}

window._filterLeaderboard = (val) => {
  window._leaderboardMonth = val;
  renderCurrentSection();
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
  const leaveTypes = getLeaveTypes();
  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Izin/Cuti Saya</h3>
      <button class="btn btn-primary" onclick="window._showEmpLeaveForm()">+ Ajukan</button>
    </div>
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
        return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="text-muted text-sm">Periode: ${fmtMonthYear(r.date)}</span>
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

  const data = { name, gender: $('ef-gender').value, position, pin, emp_id, username, contract_type: $('ef-ctype').value, contract_start: cstart, contract_end: cend, phone: $('ef-phone').value.trim(), email: $('ef-email').value.trim(), date_of_birth: $('ef-dob').value };

  if (key) await update(ref(db, 'users/' + key), data);
  else await set(push(ref(db, 'users')), data);

  showToast(key ? 'Karyawan diperbarui!' : 'Karyawan ditambahkan!', 'success');
  $('emp-form-area').innerHTML = '';
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

  let leaveQuotaHtml = '';
  if (leaveTypes.length > 0) {
    leaveQuotaHtml = `<div class="mt-4"><p class="form-label mb-2">Sisa Jatah Cuti (${currentYear})</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">`;
    let hasQuota = false;
    leaveTypes.forEach(t => {
      if (t.quota > 0) {
        hasQuota = true;
        let taken = 0;
        empLeaves.filter(l => l.leave_type === t.name).forEach(l => {
          const d1 = new Date(l.start_date);
          const d2 = new Date(l.end_date);
          taken += Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
        });
        const remaining = t.quota - taken;
        leaveQuotaHtml += `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem">
          <p class="text-xs text-muted">${esc(t.name)}</p>
          <p class="font-bold text-sm" style="color:${remaining <= 0 ? 'var(--danger)' : 'var(--success)'}">${remaining} <span class="text-xs font-normal text-muted">dari ${t.quota} hari</span></p>
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

// --- AUTO-RESET LEAVE WHEN CONTRACT ENDS ---
async function autoResetLeaveOnContractEnd() {
  const todayStr = today();
  const currentYear = new Date().getFullYear();
  const users = getUsers();

  for (const emp of users) {
    if (!emp.contract_end) continue;

    // Check if contract has ended (contract_end <= today)
    if (emp.contract_end <= todayStr) {
      // Check if already reset this cycle (store marker in user data)
      const resetMarker = emp.leave_reset_date;
      if (resetMarker === emp.contract_end) continue; // Already reset for this contract end

      // Delete all leaves for this employee in the current year
      let deleted = 0;
      for (const [k, v] of Object.entries(allData.leaves)) {
        if (v.emp_id === emp.emp_id && new Date(v.start_date).getFullYear() === currentYear) {
          await remove(ref(db, 'leaves/' + k));
          deleted++;
        }
      }

      // Mark as reset so it doesn't re-trigger
      if (deleted > 0) {
        await update(ref(db, 'users/' + emp._key), { leave_reset_date: emp.contract_end });
        console.log(`[Auto-Reset] Cuti ${emp.name} direset (kontrak berakhir: ${emp.contract_end}). ${deleted} record dihapus.`);
      }
    }
  }
}

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
window._showRatingForm = () => {
  const users = getUsers();
  const criteria = getCriteria(); // Used just for checking if any exist
  if (users.length === 0) { showToast('Tambahkan karyawan dulu!', 'warning'); return; }
  if (criteria.length === 0) { showToast('Buat kriteria penilaian dulu!', 'warning'); return; }

  showModal(`<div class="modal-header"><h3 class="modal-title">Tambah Penilaian</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Pilih Karyawan</label><select id="rf-emp" class="form-input form-select" onchange="window._updateRatingCriteria()">${users.map(u => `<option value="${u.emp_id}" data-pos="${esc(u.position)}">${esc(u.name)} (${esc(u.position)})</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Bulan Penilaian</label><input id="rf-date" type="month" value="${today().substring(0, 7)}" class="form-input"></div>
      <div id="rf-criteria-container"></div>
      <div class="form-group mt-4"><label class="form-label">Catatan</label><textarea id="rf-note" class="form-input" rows="2" placeholder="Catatan tambahan..."></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="window._saveRating()">Simpan Penilaian</button><button class="btn btn-secondary" onclick="window._hideModal()">Batal</button></div>`, 'modal-lg');

  // Initialize criteria list for the first selected employee
  window._updateRatingCriteria();
};

window._updateRatingCriteria = () => {
  const empSelect = $('rf-emp');
  if (!empSelect) return;
  const selectedOption = empSelect.options[empSelect.selectedIndex];
  if (!selectedOption) return;
  const pos = selectedOption.getAttribute('data-pos');

  // Get criteria filtered by this position
  const posCriteria = getCriteria(pos);

  // Group by indicator
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
      const defaultVal = 3;
      html += `<div style="display:flex;flex-direction:column;gap:0.6rem;padding:0.6rem 0;border-bottom:1px solid var(--border)">
        <span class="text-sm font-semibold" style="flex:1;color:var(--text-main);">${esc(c.name)}</span>
        <input type="hidden" class="rf-score" data-key="${c._key}" id="score-${c._key}" value="${defaultVal}">
        <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:0.2rem;" id="rating-group-${c._key}">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="rating-btn rating-btn-${n} ${n === defaultVal ? 'active' : ''}" onclick="_setRating('${c._key}', ${n})">${n}</button>`).join('')}
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
  const scores = {};
  document.querySelectorAll('.rf-score').forEach(el => { scores[el.dataset.key] = Math.min(5, Math.max(1, parseInt(el.value) || 1)); });
  await set(push(ref(db, 'ratings')), { emp_id: empId, date, scores, note, timestamp: Date.now() });
  showToast('Penilaian disimpan!', 'success');
  hideModal();
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
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; margin: 0; padding: 10px; background: #e2e8f0; font-size: 10.5px; line-height: 1.25; }
    .rapor-container { background: #fff; max-width: 210mm; margin: 0 auto; padding: 12px 18px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; page-break-inside: avoid; page-break-after: avoid; }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); max-width: 210mm; margin-left: auto; margin-right: auto; }
    .no-print-bar button { padding: 5px 12px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; font-size: 11px; }
    .btn-print { background: #1d4ed8; color: #fff; }
    .btn-close { background: #64748b; color: #fff; margin-left: 8px; }
    .kop-header { text-align: center; border-bottom: 2.5px double #1d4ed8; padding-bottom: 4px; margin-bottom: 6px; width: 100%; }
    .kop-title { font-family: 'Times New Roman', Times, serif; font-weight: 900; font-size: 26px; color: #1e40af; letter-spacing: 1.2px; line-height: 1.05; margin-bottom: 1px; }
    .kop-subtitle { font-family: 'Times New Roman', Times, serif; font-weight: 800; font-size: 15px; color: #1d4ed8; margin-top: 1px; letter-spacing: 0.5px; line-height: 1.05; margin-bottom: 2px; }
    .kop-address { font-size: 9.5px; color: #1e3a8a; margin-top: 1px; line-height: 1.2; }
    .doc-title-box { text-align: center; margin-bottom: 6px; }
    .doc-title { font-size: 13px; font-weight: 800; text-transform: uppercase; color: #0f172a; border-bottom: 1.5px solid #0f172a; display: inline-block; padding-bottom: 1px; }
    .doc-subtitle { font-size: 9px; color: #64748b; margin-top: 2px; font-weight: 600; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; }
    .info-table td { padding: 4px 8px; font-size: 10px; vertical-align: top; border-bottom: 1px solid #e2e8f0; color: #0f172a !important; }
    .info-table td.label { font-weight: 700; color: #475569 !important; width: 120px; background: #f1f5f9; }
    .metric-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .metric-table th, .metric-table td { border: 1px solid #cbd5e1; padding: 4px 8px; font-size: 9.5px; }
    .metric-table th { background: #1e40af; color: #ffffff !important; font-weight: 700; text-align: left; }
    tr { page-break-inside: avoid !important; page-break-after: auto !important; }
    .signature-area { margin-top: 10px; display: flex; justify-content: space-between; page-break-inside: avoid; }
    .sig-box { width: 200px; text-align: center; font-size: 9.5px; color: #0f172a !important; }
    .sig-space { height: 35px; }
    @media print {
      html, body { height: 100%; overflow: hidden; background: #fff; padding: 0; }
      .rapor-container { box-shadow: none; padding: 0; max-width: 100% !important; border-radius: 0; page-break-inside: avoid; page-break-after: avoid; }
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
      <button id="btn-dl-rating-pdf" style="background:#16a34a; color:#fff; font-weight:bold; padding:5px 12px; border-radius:4px; border:none; cursor:pointer; font-size:11px;" onclick="downloadRatingPdfDirect()">📥 Simpan File PDF</button>
      <button class="btn-print" onclick="window.print()">🖨️ Cetak / Print</button>
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
      <div class="doc-title">LEMBAR EVALUASI PENILAIAN ATASAN</div>
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
        <div>Penerima Evaluasi (Karyawan),</div>
        <div class="sig-space"></div>
        <div><strong>( ${esc(empName)} )</strong></div>
        <div style="font-size:8.5px; color:#64748b;">ID: ${esc(rating.emp_id)}</div>
      </div>
      <div class="sig-box">
        <div>Gontor, ${formattedDate}<br><strong>Manager SPBU Gontor Mlarak</strong>,</div>
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
  if (typeof html2pdf === 'undefined') {
    showToast('Library PDF sedang dimuat, coba sebentar lagi', 'warning');
    return;
  }

  const html = _generateRatingPDFHtml(key);
  if (!html) return;

  const rating = allData.ratings[key];
  const emp = getUserByEmpId(rating.emp_id);
  const empName = emp ? emp.name : rating.emp_id;
  const filename = `Evaluasi_${empName.replace(/\s+/g, '_')}_${rating.date}.pdf`;

  const div = document.createElement('div');
  div.innerHTML = html;
  // Strip out control bar so downloaded PDF starts directly with Kop Surat
  div.querySelectorAll('.no-print-bar, .no-print').forEach(el => el.remove());

  const opt = {
    margin: [6, 8, 6, 8],
    filename: filename,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2.2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  showToast('Menyiapkan file unduhan...', 'info');
  html2pdf().set(opt).from(div).save().then(() => {
    showToast('PDF berhasil diunduh!', 'success');
  }).catch(e => {
    console.error(e);
    showToast('Gagal mengunduh PDF', 'error');
  });
};

window._downloadAllRatingsPDF = () => {
  if (typeof html2pdf === 'undefined') {
    showToast('Library PDF sedang dimuat, coba sebentar lagi', 'warning');
    return;
  }

  const ratings = getRatings();
  if (ratings.length === 0) {
    showToast('Belum ada data penilaian', 'warning');
    return;
  }

  // Build combined HTML with page breaks between employees
  let combinedHtml = '';
  ratings.forEach((r, idx) => {
    const pageHtml = _generateRatingPDFHtml(r._key);
    if (pageHtml) {
      if (idx > 0) {
        combinedHtml += '<div style="page-break-before:always;"></div>';
      }
      combinedHtml += pageHtml;
    }
  });

  if (!combinedHtml) {
    showToast('Tidak ada data yang bisa di-export', 'error');
    return;
  }

  const div = document.createElement('div');
  div.innerHTML = combinedHtml;
  // Strip out control bar so downloaded PDF starts directly with Kop Surat
  div.querySelectorAll('.no-print-bar, .no-print').forEach(el => el.remove());

  const opt = {
    margin: [6, 8, 6, 8],
    filename: `Evaluasi_Semua_Karyawan_${today()}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2.5, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css'] }
  };

  showToast('Menyiapkan file unduhan massal...', 'info');
  html2pdf().set(opt).from(div).save().then(() => {
    showToast('PDF massal berhasil diunduh!', 'success');
  }).catch(e => {
    console.error(e);
    showToast('Gagal mengunduh PDF massal', 'error');
  });
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

  const isRecordInPeriod = (dateVal) => {
    if (!dateVal) return true;
    const dStr = dateVal.toString().trim();
    if (/^\d{4}-\d{2}$/.test(dStr)) {
      return dStr >= startMonthStr && dStr <= endMonthStr;
    }
    const dMonth = dStr.slice(0, 7);
    return (dStr >= startStr && dStr <= endStr) || (dMonth >= startMonthStr && dMonth <= endMonthStr);
  };

  const isOperator = (emp.position || '').toString().toLowerCase() === 'operator';

  // 1. Attendance Punctuality Score (0 - 100)
  const absensiRecords = Object.values(allData.absensi_records || {}).filter(r => {
    return isRecordForUser(r, emp) && isRecordInPeriod(r.date || r.tanggal);
  });

  let onTimeCount = 0;
  let totalSecLate = 0;
  let totalWorkDays = absensiRecords.length;

  const ABSENSI_SHIFTS = {
    '1': { start: [4, 45], label: 'Shift 1 (04:45–12:45)' },
    '2': { start: [12, 45], label: 'Shift 2 (12:45–21:15)' },
    '3': { start: [21, 15], label: 'Shift 3 (21:15–04:45)' },
    'admin': { start: [7, 0], label: 'Admin (07:00–15:00)' }
  };

  absensiRecords.forEach(r => {
    const st = (r.status || r.type || '').toString().toLowerCase();
    if (r.clock_in && r.clock_in !== '-' && !['sakit', 'izin', 'cuti', 'libur', 'off'].includes(st)) {
      if ((r.late_minutes || 0) <= 0 && st !== 'terlambat') {
        onTimeCount++;
      }
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

  const attendanceRate = totalWorkDays > 0 ? Math.round((onTimeCount / totalWorkDays) * 100) : 100;

  // 2. SOP Checklist Compliance Score (0 - 100) - ONLY FOR OPERATOR
  let sopRate = null;
  if (isOperator) {
    const sopRecords = Object.values(allData.sop_checklists || allData.ceklis_sop || {}).filter(s => {
      return isRecordForUser(s, emp) && isRecordInPeriod(s.date || s.tanggal || s.created_at);
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
    return isRecordForUser(rt, emp) && isRecordInPeriod(rt.date || rt.tanggal || rt.created_at);
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
    return isRecordForUser(v, emp) && v.status !== 'Dibatalkan' && isRecordInPeriod(v.date || v.tanggal || v.start_date || v.created_at);
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
  const debitTxns = getTxns(emp.emp_id).filter(t => t.type === 'debit' && isRecordInPeriod(t.date || t.tanggal || t.timestamp));
  const debitTxCount = debitTxns.length;

  const nominalPenalty = Math.floor(totalDebitAmt / 50000) * 5;
  const frequencyPenalty = debitTxCount * 5;
  const debitScore = Math.max(0, 100 - (nominalPenalty + frequencyPenalty));

  // 6. FAIR Composite KPI Score Calculation:
  // For Operator: 30% Attendance + 20% SOP + 25% Rating + 15% Debit + 10% Track Record = 100%
  // For Non-Operator (Admin/Supervisor/Cleaning Service): 45% Attendance + 40% Rating + 5% Debit + 10% Track Record = 100%
  let compositeScore = 0;
  if (isOperator) {
    compositeScore = Math.round(
      (attendanceRate * 0.30) +
      ((sopRate || 0) * 0.20) +
      (ratingScore * 0.25) +
      (debitScore * 0.15) +
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
    sopRate,
    avgRating: avgRatingNum.toFixed(1),
    ratingScore,
    totalDebitAmt,
    debitTxCount,
    debitScore,
    trackRecordScore,
    violationCount: violationRecords.length,
    compositeScore
  };
}

function _generateEmployeeKpiPDFHtml(empId) {
  const users = getUsers();
  const u = users.find(x => x.emp_id === empId);
  if (!u) return '';

  const period = window._leaderboardPeriod || 'month';
  const periodTitles = {
    'month': 'Bulan Ini (' + new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) + ')',
    'last_month': 'Bulan Lalu',
    'quarter': 'Triwulan (3 Bulan)',
    'year': 'Tahun ' + new Date().getFullYear()
  };
  const periodTitle = periodTitles[period] || 'Bulan Ini';

  // Compute ranking among all employees
  const rankedUsers = users.map(userItem => {
    const kpi = calculateEmployeeKpi(userItem, period);
    return { user: userItem, kpi, targetValue: kpi.compositeScore };
  }).sort((a, b) => b.targetValue - a.targetValue || a.kpi.totalSecLate - b.kpi.totalSecLate);

  const totalUsers = rankedUsers.length;
  const userRankIdx = rankedUsers.findIndex(r => r.user.emp_id === empId);
  const userRank = userRankIdx >= 0 ? userRankIdx + 1 : '-';

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

  // Check if employee has recent manager evaluation note
  const ratings = getRatings(empId);
  const latestRating = ratings.length > 0 ? ratings[0] : null;
  const empNote = latestRating ? latestRating.note : '';

  // --- Hitung data Izin/Cuti ---
  const currentYear = new Date().getFullYear();
  const empLeaves = getLeaves(empId);
  const periodMonth = period === 'bulan_ini' ? new Date().toISOString().slice(0, 7) : period;
  const approvedLeavesBulanIni = empLeaves.filter(l => l.status === 'Disetujui' && l.start_date.startsWith(periodMonth));
  const totalIzinBulanIni = approvedLeavesBulanIni.length;

  const empGender = u.gender || 'Semua';
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
        <td style="border:1px solid #cbd5e1;padding:3px 6px;color:#0f172a !important;">${esc(t.name)}</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px;text-align:center;color:#0f172a !important;">${t.quota} hari</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px;text-align:center;color:#0f172a !important;">${taken} hari</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px;text-align:center;font-weight:bold;color:${remaining <= 0 ? '#dc2626' : '#166534'} !important;">${remaining} hari</td>
      </tr>`;
    }
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Rapor Kinerja ${esc(u.name)} - SPBU Gontor</title>
  <style id="page-style">
    @page { size: A4 portrait; margin: 6mm 10mm; }
  </style>
  <style>
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #0f172a !important; margin: 0; padding: 10px; background: #e2e8f0 !important; font-size: 10.5px; line-height: 1.25; }
    .rapor-container { background: #ffffff !important; color: #0f172a !important; max-width: 210mm; margin: 0 auto; padding: 12px 18px; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); box-sizing: border-box; page-break-inside: avoid; page-break-after: avoid; }
    .no-print-bar { display: flex; justify-content: space-between; align-items: center; background: #ffffff !important; padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); max-width: 210mm; margin-left: auto; margin-right: auto; }
    .no-print-bar button { padding: 5px 12px; font-weight: bold; border-radius: 4px; border: none; cursor: pointer; font-size: 11px; }
    .btn-print { background: #1d4ed8; color: #fff; }
    .btn-close { background: #64748b; color: #fff; margin-left: 8px; }
    .kop-header { text-align: center; border-bottom: 2.5px double #1d4ed8 !important; padding-bottom: 4px; margin-bottom: 6px; width: 100%; }
    .kop-title { font-family: 'Times New Roman', Times, serif; font-weight: 900; font-size: 26px; color: #1e40af !important; letter-spacing: 1.2px; line-height: 1.05; margin-bottom: 1px; }
    .kop-subtitle { font-family: 'Times New Roman', Times, serif; font-weight: 800; font-size: 15px; color: #1d4ed8 !important; margin-top: 1px; letter-spacing: 0.5px; line-height: 1.05; margin-bottom: 2px; }
    .kop-address { font-size: 9.5px; color: #1e3a8a !important; margin-top: 1px; line-height: 1.2; }
    .doc-title-box { text-align: center; margin-bottom: 6px; }
    .doc-title { font-size: 13px; font-weight: 800; text-transform: uppercase; color: #0f172a !important; border-bottom: 1.5px solid #0f172a !important; display: inline-block; padding-bottom: 1px; }
    .doc-subtitle { font-size: 9px; color: #475569 !important; margin-top: 2px; font-weight: 600; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; background: #f8fafc !important; border: 1px solid #cbd5e1 !important; border-radius: 4px; }
    .info-table td { padding: 4px 8px; font-size: 10px; vertical-align: middle; border-bottom: 1px solid #e2e8f0 !important; color: #0f172a !important; }
    .info-table td.label { font-weight: 700; color: #334155 !important; width: 115px; background: #f1f5f9 !important; }
    .score-summary-grid { display: flex; gap: 8px; margin-bottom: 6px; width: 100%; }
    .score-card { flex: 1; background: #eff6ff !important; border: 1.5px solid #3b82f6 !important; border-radius: 5px; padding: 6px 10px; text-align: center; }
    .score-card.rank-card { background: #f0fdf4 !important; border-color: #22c55e !important; }
    .score-value { font-size: 18px; font-weight: 900; color: #1e40af !important; margin: 1px 0; }
    .rank-card .score-value { color: #15803d !important; }
    .metric-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    .metric-table th, .metric-table td { border: 1px solid #cbd5e1 !important; padding: 4px 6px; font-size: 9.5px; color: #0f172a !important; }
    .metric-table th { background: #1e40af !important; color: #ffffff !important; font-weight: 700; text-align: left; }
    tr { page-break-inside: avoid !important; page-break-after: auto !important; }
    .signature-area { margin-top: 8px; display: flex; justify-content: space-between; page-break-inside: avoid; }
    .sig-box { width: 200px; text-align: center; font-size: 9.5px; color: #0f172a !important; }
    .sig-space { height: 35px; }
    @media print {
      html, body { height: 100%; overflow: hidden; background: #fff !important; padding: 0; }
      .rapor-container { box-shadow: none; padding: 0; max-width: 100% !important; border-radius: 0; }
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
      <button id="btn-dl-pdf" style="background:#16a34a; color:#fff; font-weight:bold; padding:5px 12px; border-radius:4px; border:none; cursor:pointer; font-size:11px;" onclick="downloadPdfDirect(false)">📥 Simpan File PDF</button>
      <button class="btn-print" onclick="window.print()">🖨️ Cetak / Print</button>
      <button class="btn-close" onclick="window.close()">✕ Tutup</button>
    </div>
  </div>

  <div class="rapor-container">
    <div class="kop-header" style="text-align:center; border-bottom:2.5px double #1d4ed8 !important; padding-bottom:4px; margin-bottom:6px;">
      <div class="kop-title" style="font-family:'Times New Roman', Times, serif; font-weight:900; font-size:26px; color:#1e40af !important; letter-spacing:1.2px; line-height:1.05; margin-bottom:1px;">PT. ESTAFET DWI MASA</div>
      <div class="kop-subtitle" style="font-family:'Times New Roman', Times, serif; font-weight:800; font-size:15px; color:#1d4ed8 !important; margin-top:1px; letter-spacing:0.5px; line-height:1.05; margin-bottom:2px;">SPBU 54.634.25 GONTOR MLARAK</div>
      <div class="kop-address" style="font-size:9.5px; color:#1e3a8a !important; margin-top:1px; line-height:1.2;">
        Kantor Pusat : Ds. Gontor, Kec. Mlarak, Kab. Ponorogo - Jawa Timur 63472<br>
        Kantor Cabang : Jalan Mayjend Bambang Sugeng Km. 01 Sidojoyo Wonosobo<br>
        Email: estafetdwimasa@gmail.com
      </div>
    </div>
  <div class="doc-title-box">
    <div class="doc-title" style="font-size:13px; font-weight:800; text-transform:uppercase; color:#0f172a !important; border-bottom:1.5px solid #0f172a !important; display:inline-block; padding-bottom:1px;">RAPOR EVALUASI KINERJA INDIVIDUAL KARYAWAN</div>
    <div class="doc-subtitle" style="font-size:9px; color:#475569 !important; margin-top:2px; font-weight:600;">PERIODE EVALUASI: ${esc(periodTitle).toUpperCase()} | TANGGAL CETAK: ${formattedDate.toUpperCase()}</div>
  </div>
  <table class="info-table">
    <tr>
      <td class="label" style="font-weight:700; color:#334155 !important; width:115px; background:#f1f5f9 !important;">Nama Karyawan</td>
      <td><strong style="color:#0f172a !important;">${esc(u.name)}</strong></td>
      <td class="label" style="font-weight:700; color:#334155 !important; width:115px; background:#f1f5f9 !important;">ID Karyawan</td>
      <td><strong style="color:#0f172a !important;">${esc(u.emp_id)}</strong></td>
    </tr>
    <tr>
      <td class="label" style="font-weight:700; color:#334155 !important; width:115px; background:#f1f5f9 !important;">Jabatan / Posisi</td>
      <td><strong style="color:#0f172a !important;">${esc(u.position)}</strong></td>
      <td class="label" style="font-weight:700; color:#334155 !important; width:115px; background:#f1f5f9 !important;">Status Evaluasi</td>
      <td><span style="color:#16a34a !important; font-weight:bold;">Selesai (Aktif)</span></td>
    </tr>
  </table>
  <div class="score-summary-grid">
    <div class="score-card">
      <div style="font-size:9.5px; font-weight:700; color:#1e40af !important; text-transform:uppercase;">SKOR KPI KOMPOSIT AKHIR</div>
      <div class="score-value">${kpi.compositeScore} <span style="font-size:11px; font-weight:normal; color:#475569 !important;">/ 100</span></div>
      <div style="font-size:9.5px; font-weight:bold; color:#1e3a8a !important;">Kategori: ${kpiCategoryStr}</div>
    </div>
    <div class="score-card rank-card">
      <div style="font-size:9.5px; font-weight:700; color:#15803d !important; text-transform:uppercase;">PERINGKAT PERUSAHAAN</div>
      <div class="score-value">#${userRank} <span style="font-size:11px; font-weight:normal; color:#166534 !important;">dari ${totalUsers} Karyawan</span></div>
      <div style="font-size:9.5px; font-weight:bold; color:#166534 !important;">${rankBadgeEmoji} Peringkat Seluruh Perusahaan</div>
    </div>
  </div>
  <table class="metric-table">
    <thead>
      <tr>
        <th style="width:20px; text-align:center; background:#1e40af !important; color:#ffffff !important;">#</th>
        <th style="background:#1e40af !important; color:#ffffff !important;">Indikator Evaluasi Kinerja</th>
        <th style="width:95px; text-align:center; background:#1e40af !important; color:#ffffff !important;">Pencapaian Riil</th>
        <th style="width:65px; text-align:center; background:#1e40af !important; color:#ffffff !important;">Bobot</th>
        <th style="width:75px; text-align:center; background:#1e40af !important; color:#ffffff !important;">Skor Metrik</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">1</td>
        <td style="color:#0f172a !important;">
          <strong style="color:#0f172a !important;">⏱️ Kedisiplinan Kehadiran (Sistem Absensi)</strong><br>
          <span style="font-size:8.5px; color:#475569 !important;">Hadir tepat waktu: ${kpi.attendanceRate}% | Total Keterlambatan: ${Math.round(kpi.totalSecLate / 60)} Menit</span>
        </td>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">${kpi.attendanceRate}%</td>
        <td style="text-align:center; color:#0f172a !important;">${kpi.isOperator ? '30%' : '45%'}</td>
        <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important;">${kpi.attendanceRate} / 100</td>
      </tr>
      <tr>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">2</td>
        <td style="color:#0f172a !important;">
          <strong style="color:#0f172a !important;">📋 Kepatuhan Ceklis SOP (Aplikasi Ceklis SOP)</strong><br>
          <span style="font-size:8.5px; color:#475569 !important;">${kpi.isOperator ? `Kepatuhan pengisian SOP shift kerja: ${kpi.sopRate}%` : 'Metrik SOP khusus untuk Jabatan Operator (Non-Operator N/A)'}</span>
        </td>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">${kpi.isOperator ? `${kpi.sopRate}%` : 'N/A'}</td>
        <td style="text-align:center; color:#0f172a !important;">${kpi.isOperator ? '20%' : '0%'}</td>
        <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important;">${kpi.isOperator ? `${kpi.sopRate} / 100` : 'N/A'}</td>
      </tr>
      <tr>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">3</td>
        <td style="color:#0f172a !important;">
          <strong style="color:#0f172a !important;">⭐ Rating Evaluasi Kinerja Atasan (Per Criteria)</strong><br>
          <span style="font-size:8.5px; color:#475569 !important;">Rating rata-rata: ${kpi.avgRating} dari 5.0 Bintang</span>
        </td>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">${kpi.avgRating} / 5.0</td>
        <td style="text-align:center; color:#0f172a !important;">${kpi.isOperator ? '25%' : '40%'}</td>
        <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important;">${kpi.ratingScore} / 100</td>
      </tr>
      <tr>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">4</td>
        <td style="color:#0f172a !important;">
          <strong style="color:#0f172a !important;">💳 Akuntabilitas Keuangan (Tunggakan & Tabungan)</strong><br>
          <span style="font-size:8.5px; color:#475569 !important;">Total Tunggakan: ${fmt(kpi.totalDebitAmt)} (${kpi.debitTxCount} Catatan Transaksi)</span>
        </td>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">${kpi.totalDebitAmt > 0 ? fmt(kpi.totalDebitAmt) : 'Clean (Rp 0)'}</td>
        <td style="text-align:center; color:#0f172a !important;">${kpi.isOperator ? '15%' : '5%'}</td>
        <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important;">${kpi.debitScore} / 100</td>
      </tr>
      <tr>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">5</td>
        <td style="color:#0f172a !important;">
          <strong style="color:#0f172a !important;">🛡️ Rekam Pelanggaran & Kedisiplinan (Track Record)</strong><br>
          <span style="font-size:8.5px; color:#475569 !important;">Jumlah Surat Peringatan (SP) Aktif: ${kpi.violationCount} Catatan</span>
        </td>
        <td style="text-align:center; font-weight:bold; color:#0f172a !important;">${kpi.violationCount > 0 ? `${kpi.violationCount} SP` : 'Clean'}</td>
        <td style="text-align:center; color:#0f172a !important;">10%</td>
        <td style="text-align:center; font-weight:bold; color:#1d4ed8 !important;">${kpi.trackRecordScore} / 100</td>
      </tr>
    </tbody>
  </table>

  <h4 style="margin:6px 0 3px 0; color:#1e40af !important; font-size:10.5px; border-bottom:1px solid #cbd5e1; padding-bottom:2px;">📋 REKAPITULASI IZIN & HAK CUTI KARYAWAN</h4>
  <table class="info-table" style="margin-bottom:5px;">
    <tr>
      <td class="label" style="width:130px; font-weight:700; color:#334155 !important; background:#f1f5f9 !important;">Izin Disetujui (Bulan Ini)</td>
      <td><strong style="color:#0f172a !important;">${totalIzinBulanIni} Kali</strong></td>
    </tr>
  </table>
  ${leaveQuotaRows ? `
  <table class="metric-table" style="margin-bottom:6px;">
    <thead>
      <tr>
        <th style="border:1px solid #cbd5e1;padding:3px 6px;text-align:left;background:#334155 !important;color:#fff !important;">Jenis Hak Cuti</th>
        <th style="border:1px solid #cbd5e1;padding:3px 6px;text-align:center;background:#334155 !important;color:#fff !important;width:75px;">Jatah (${currentYear})</th>
        <th style="border:1px solid #cbd5e1;padding:3px 6px;text-align:center;background:#334155 !important;color:#fff !important;width:75px;">Terpakai</th>
        <th style="border:1px solid #cbd5e1;padding:3px 6px;text-align:center;background:#334155 !important;color:#fff !important;width:75px;">Sisa Cuti</th>
      </tr>
    </thead>
    <tbody>${leaveQuotaRows}</tbody>
  </table>` : '<p style="color:#64748b !important;font-style:italic;font-size:9.5px;margin-bottom:5px;">Tidak ada jenis cuti terdaftar.</p>'}

  <div style="border:1px solid #cbd5e1; border-radius:4px; padding:6px 10px; background:#f8fafc !important; color:#0f172a !important; margin-bottom:8px;">
    <div style="font-weight:bold; font-size:9.5px; color:#1e40af !important; margin-bottom:2px; text-transform:uppercase;">💬 CATATAN & EVALUASI DARI MANAJEMEN:</div>
    <div style="font-size:10px; color:#0f172a !important; font-style:italic; line-height:1.2;">
      ${empNote ? esc(empNote) : 'Terima kasih atas kontribusi dan dedikasi Anda. Tingkatkan terus kedisiplinan dan kualitas pelayanan demi kemajuan bersama SPBU 54.634.25 GONTOR MLARAK.'}
    </div>
  </div>
  <div class="signature-area">
    <div class="sig-box">
      <div style="color:#0f172a !important;">Penerima Rapor (Karyawan),</div>
      <div class="sig-space"></div>
      <div><strong style="color:#0f172a !important;">( ${esc(u.name)} )</strong></div>
      <div style="font-size:8.5px; color:#64748b !important;">ID: ${esc(u.emp_id)}</div>
    </div>
    <div class="sig-box">
      <div style="color:#0f172a !important;">Gontor, ${formattedDate}<br><strong style="color:#0f172a !important;">Manager SPBU Gontor Mlarak</strong>,</div>
      <div class="sig-space"></div>
      <div><strong style="color:#0f172a !important;">( ______________________ )</strong></div>
      <div style="font-size:8.5px; color:#64748b !important;">PT. ESTAFET DWI MASA</div>
    </div>
  </div>
  </div>

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
      
      if (noPrintBar) {
        noPrintBar.style.setProperty('display', 'none', 'important');
      }

      const element = document.querySelector('.rapor-container');
      const safeName = '${esc(u.name).replace(/[^a-zA-Z0-9]/g, '_')}';
      const safePeriod = '${periodTitle.replace(/[^a-zA-Z0-9]/g, '_')}';

      const opt = {
        margin: [4, 6, 4, 6],
        filename: 'Rapor_Kinerja_' + safeName + '_' + safePeriod + '.pdf',
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
              <option value="month" ${period === 'month' ? 'selected' : ''}>Bulan Ini</option>
              <option value="last_month" ${period === 'last_month' ? 'selected' : ''}>Bulan Lalu</option>
              <option value="quarter" ${period === 'quarter' ? 'selected' : ''}>Triwulan (3 Bulan)</option>
              <option value="year" ${period === 'year' ? 'selected' : ''}>Tahun Ini</option>
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
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
        <h3 class="card-title" style="font-size:1.1rem; display:flex; align-items:center; gap:0.5rem;">
          📊 Daftar Peringkat Seluruh Karyawan <span class="text-xs text-muted">(${rankedUsers.length} Karyawan)</span>
        </h3>
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
      <button class="btn ${tab === 'settings' ? 'btn-primary' : 'btn-secondary'}" style="border-radius:var(--radius-md) var(--radius-md) 0 0; font-weight:700; padding:0.5rem 1.1rem;" onclick="window._setPayrollTab('settings')">
        ⚙️ Pengaturan Master & TTD
      </button>
    </div>

    <div id="payroll-tab-content">
      ${tab === 'internal' ? renderInternalPayrollTab() : tab === 'audit' ? renderAuditPayrollTab() : renderPayrollSettingsTab()}
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

function getBbmSalesData(month) {
  const p = allData.payroll || {};
  const m = p[month] || {};
  const b = m.bbm_sales || {};
  return {
    pertalite: Number(b.pertalite !== undefined ? b.pertalite : 0),
    solar: Number(b.solar !== undefined ? b.solar : 0),
    turbo: Number(b.turbo !== undefined ? b.turbo : 0),
    px92: Number(b.px92 !== undefined ? b.px92 : 0),
    dex: Number(b.dex !== undefined ? b.dex : 0)
  };
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
  const pwPertalite = bbm.pertalite * 2;
  const pwSolar = bbm.solar * 2;
  const pwTurbo = bbm.turbo * 12;
  const pwPx92 = bbm.px92 * 12;
  const pwDex = bbm.dex * 12;
  const total = pwPertalite + pwSolar + pwTurbo + pwPx92 + pwDex;
  return { pwPertalite, pwSolar, pwTurbo, pwPx92, pwDex, total };
}

function computePwAudit(bbm) {
  const pwPertalite = bbm.pertalite * 4;
  const pwSolar = bbm.solar * 4;
  const pwTurbo = bbm.turbo * 30;
  const pwPx92 = bbm.px92 * 30;
  const pwDex = bbm.dex * 30;
  const total = pwPertalite + pwSolar + pwTurbo + pwPx92 + pwDex;
  return { pwPertalite, pwSolar, pwTurbo, pwPx92, pwDex, total };
}

function getTenureMonths(joinDateStr) {
  if (!joinDateStr) return 12;
  const join = new Date(joinDateStr);
  const now = new Date();
  if (isNaN(join.getTime())) return 12;
  return Math.max(1, (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth()));
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
  const bbm = {
    pertalite: Number($('bbm-pertalite').value || 0),
    solar: Number($('bbm-solar').value || 0),
    turbo: Number($('bbm-turbo').value || 0),
    px92: Number($('bbm-px92').value || 0),
    dex: Number($('bbm-dex').value || 0),
    updated_at: Date.now()
  };

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
  const settings = {
    gaji_pokok_internal_staf: Number($('set-gaji-pokok-internal').value || 1000000),
    umk_staf: Number($('set-umk-staf').value || 2549876),
    umk_manager: Number($('set-umk-manager').value || 3059851),
    bpjs_percent: Number($('set-bpjs-percent').value || 1),
    name_finance_manager: $('set-name-finance').value.trim() || 'Hazel Hudaya Bisri',
    name_audit_supervisor: $('set-name-spv').value.trim() || 'Gilang Wahyu Ramadhan',
    name_audit_manager: $('set-name-manager').value.trim() || 'Pedri Fauzi',
    custom_allowances: getPayrollSettings().custom_allowances,
    updated_at: Date.now()
  };

  allData.payroll_settings = settings;
  renderCurrentSection();

  await set(ref(db, 'payroll_settings'), settings);
  showToast('Pengaturan Master Gaji berhasil disimpan!', 'success');
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

function renderInternalPayrollTab() {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const bbm = getBbmSalesData(month);
  const pwInt = computePwInternal(bbm);
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};

  // Count non-manager employees for PW distribution
  const spvAdminCount = users.filter(u => {
    const p = (u.position || '').toLowerCase();
    return p.includes('admin') || p.includes('supervisor') || p.includes('spv');
  }).length || 3;

  const oprCsCount = users.length - spvAdminCount || 11;

  const rawPwSpvAdmin = (pwInt.total * 0.20) / Math.max(1, spvAdminCount);
  const rawPwOprCs = (pwInt.total * 0.80) / Math.max(1, oprCsCount);

  let totalGajiKotorAll = 0;
  let totalTabunganAll = 0;
  let totalGajiBersihAll = 0;
  let totalLemburAll = 0;

  const empRows = users.map((u, idx) => {
    const empId = u.emp_id;
    const empData = monthData[empId] || {};
    const pos = u.position || '-';
    const isSpvAdmin = pos.toLowerCase().includes('admin') || pos.toLowerCase().includes('supervisor') || pos.toLowerCase().includes('spv');
    const defaultPwRound = isSpvAdmin ? 150000 : 100000;
    
    const pwEnabled = empData.pw_enabled !== undefined ? empData.pw_enabled : false;
    const pwAmount = Number(empData.pw_amount !== undefined ? empData.pw_amount : 0);

    const tenureMonths = getTenureMonths(u.join_date || u.created_at);

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
        <input type="number" value="${cAmt}" style="width:90px; padding:0.2rem 0.4rem; font-size:0.75rem;" onchange="window._updateEmpAllowanceAmt('${empId}', '${ca.id}', this.value)">
      </div>`;
    }).join('');

    const otShifts = Number(empData.overtime_shifts || 0);
    const otAmt = otShifts * 50000;
    totalLemburAll += otAmt;

    const gajiPokok = Number(empData.gaji_pokok !== undefined ? empData.gaji_pokok : 0);
    const totalTambahan = (tunjJabatanEnabled ? tunjJabatanAmt : 0) +
                          (tunjKinerjaEnabled ? tunjKinerjaAmt : 0) +
                          (tunjMasaKerjaEnabled ? tunjMasaKerjaAmt : 0) +
                          (pwEnabled ? pwAmount : 0) +
                          otAmt + customTunjSum;
    const gajiKotor = gajiPokok + totalTambahan;
    const tabunganAmt = Number(empData.savings_deduction || 0);
    const gajiBersih = gajiKotor - tabunganAmt;

    totalGajiKotorAll += gajiKotor;
    totalTabunganAll += tabunganAmt;
    totalGajiBersihAll += gajiBersih;

    return `<tr>
      <td style="text-align:center; font-weight:bold; padding:4px 6px;">${idx + 1}</td>
      <td style="padding:4px 6px;"><strong>${esc(u.name)}</strong><br><span class="text-xs text-muted">ID: ${esc(u.emp_id)} | Masa: ${tenureMonths} Bln</span></td>
      <td style="padding:4px 6px;"><span class="badge" style="background:var(--bg-color); color:var(--text-main); font-size:0.7rem; padding:2px 5px;">${esc(pos)}</span></td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <input type="number" value="${gajiPokok}" class="form-input" style="width:100%; max-width:92px; box-sizing:border-box; padding:0.2rem 0.35rem; font-size:0.75rem; font-weight:600; text-align:right;" onchange="window._saveInternalPayrollItem('${empId}', 'gaji_pokok', Number(this.value))">
        <div class="text-xs text-muted" style="margin-top:0.1rem; font-size:0.65rem;">${fmt(gajiPokok)}</div>
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <div style="display:flex; align-items:center; gap:0.25rem;">
          <input type="checkbox" ${tunjJabatanEnabled ? 'checked' : ''} onchange="window._toggleEmpAllowance('${empId}', 'tunj_jabatan', this.checked)">
          <span style="font-size:0.7rem; min-width:48px;">Jabatan:</span>
          <input type="number" value="${tunjJabatanAmt}" class="form-input" style="width:100%; max-width:80px; box-sizing:border-box; padding:0.18rem 0.3rem; font-size:0.72rem; text-align:right;" onchange="window._updateEmpAllowanceAmt('${empId}', 'tunj_jabatan', this.value)">
        </div>
        <div style="display:flex; align-items:center; gap:0.25rem; margin-top:0.2rem;">
          <input type="checkbox" ${tunjKinerjaEnabled ? 'checked' : ''} onchange="window._toggleEmpAllowance('${empId}', 'tunj_kinerja', this.checked)">
          <span style="font-size:0.7rem; min-width:48px;">Kinerja:</span>
          <input type="number" value="${tunjKinerjaAmt}" class="form-input" style="width:100%; max-width:80px; box-sizing:border-box; padding:0.18rem 0.3rem; font-size:0.72rem; text-align:right;" onchange="window._updateEmpAllowanceAmt('${empId}', 'tunj_kinerja', this.value)">
        </div>
        <div style="display:flex; align-items:center; gap:0.25rem; margin-top:0.2rem;">
          <input type="checkbox" ${tunjMasaKerjaEnabled ? 'checked' : ''} onchange="window._toggleEmpAllowance('${empId}', 'tunj_masa_kerja', this.checked)">
          <span style="font-size:0.7rem; min-width:48px;">Masa:</span>
          <input type="number" value="${tunjMasaKerjaAmt}" class="form-input" style="width:100%; max-width:80px; box-sizing:border-box; padding:0.18rem 0.3rem; font-size:0.72rem; text-align:right;" onchange="window._updateEmpAllowanceAmt('${empId}', 'tunj_masa_kerja', this.value)">
        </div>
        ${customTunjHTML}
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <div style="display:flex; align-items:center; gap:0.25rem;">
          <input type="checkbox" ${pwEnabled ? 'checked' : ''} onchange="window._saveInternalPayrollItem('${empId}', 'pw_enabled', this.checked)">
          <span style="font-size:0.7rem;">PW:</span>
          <input type="number" value="${pwAmount}" class="form-input" style="width:100%; max-width:80px; box-sizing:border-box; padding:0.18rem 0.3rem; font-size:0.72rem; text-align:right;" onchange="window._saveInternalPayrollItem('${empId}', 'pw_amount', Number(this.value))">
        </div>
        <div class="text-xs text-muted" style="margin-top:0.15rem; font-size:0.65rem;">Est: ${fmt(isSpvAdmin ? rawPwSpvAdmin : rawPwOprCs)}</div>
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <div style="display:flex; align-items:center; gap:0.2rem;">
          <input type="number" value="${otShifts}" class="form-input" style="width:100%; max-width:48px; box-sizing:border-box; padding:0.18rem 0.3rem; font-size:0.72rem; text-align:center;" min="0" onchange="window._saveInternalPayrollItem('${empId}', 'overtime_shifts', Number(this.value))">
          <span style="font-size:0.7rem;">Shf</span>
        </div>
        <strong style="color:var(--primary); font-size:0.75rem;">${fmt(otAmt)}</strong>
      </td>
      <td style="font-size:0.75rem; padding:4px 6px;">
        <input type="number" value="${tabunganAmt}" class="form-input" style="width:100%; max-width:80px; box-sizing:border-box; padding:0.18rem 0.3rem; font-size:0.72rem; text-align:right;" onchange="window._saveInternalPayrollItem('${empId}', 'savings_deduction', Number(this.value))">
      </td>
      <td style="text-align:right; padding:4px 6px;">
        <div style="font-size:0.68rem; color:var(--text-muted);">Kotor: ${fmt(gajiKotor)}</div>
        <strong style="font-size:0.85rem; color:#16a34a;">${fmt(gajiBersih)}</strong>
      </td>
    </tr>`;
  }).join('');

  return `<div class="fade-in">
    <!-- INPUT PENJUALAN LITER BBM -->
    <div class="card" style="margin-bottom:1.25rem; background:var(--surface); border:1px solid var(--border);">
      <h4 style="font-size:0.95rem; font-weight:800; color:var(--primary); margin-bottom:0.75rem;">⛽ Input Penjualan Liter BBM (Periode: ${month})</h4>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:0.75rem;">
        <div><label class="form-label" style="font-size:0.75rem;">Pertalite (L)</label><input id="bbm-pertalite" type="number" step="0.01" value="${bbm.pertalite}" class="form-input" style="padding:0.4rem; font-size:0.85rem;"></div>
        <div><label class="form-label" style="font-size:0.75rem;">Solar / Biosolar (L)</label><input id="bbm-solar" type="number" step="0.01" value="${bbm.solar}" class="form-input" style="padding:0.4rem; font-size:0.85rem;"></div>
        <div><label class="form-label" style="font-size:0.75rem;">Pertamax Turbo (L)</label><input id="bbm-turbo" type="number" step="0.01" value="${bbm.turbo}" class="form-input" style="padding:0.4rem; font-size:0.85rem;"></div>
        <div><label class="form-label" style="font-size:0.75rem;">Pertamax 92 (L)</label><input id="bbm-px92" type="number" step="0.01" value="${bbm.px92}" class="form-input" style="padding:0.4rem; font-size:0.85rem;"></div>
        <div><label class="form-label" style="font-size:0.75rem;">Pertamina Dex (L)</label><input id="bbm-dex" type="number" step="0.01" value="${bbm.dex}" class="form-input" style="padding:0.4rem; font-size:0.85rem;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.85rem; flex-wrap:wrap; gap:0.5rem;">
        <div style="font-size:0.8rem; font-weight:700; color:var(--text-main);">
          Total PW Internal: <span style="color:var(--primary); font-size:0.95rem;">${fmt(pwInt.total)}</span> (SPV+Admin 20%: ${fmt(pwInt.total * 0.2)} | OPR+CS 80%: ${fmt(pwInt.total * 0.8)})
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          <button class="btn btn-outline-danger" style="padding:0.4rem 0.9rem; font-size:0.8rem;" onclick="window._resetPayrollMonthData()">🗑️ Bersihkan Data Bulan Ini</button>
          <button class="btn btn-primary" style="padding:0.4rem 0.9rem; font-size:0.8rem;" onclick="window._saveBbmSales()">Simpan Penjualan BBM</button>
        </div>
      </div>
    </div>

    <!-- MAIN PAYROLL TABLE -->
    <div class="card" style="margin-bottom:1.25rem; overflow-x:auto;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
        <h4 style="font-size:1rem; font-weight:800; color:var(--text-main); margin:0;">📋 Daftar Gaji Internal Karyawan (${users.length} Karyawan)</h4>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-warning" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" onclick="window._openMassAllowanceModal()">⚡ Input Massal Gaji & Tunjangan</button>
          <label style="font-size:0.75rem; font-weight:700;">Tgl Cetak:</label>
          <input type="date" value="${printDate}" class="form-input" style="padding:0.3rem 0.5rem; font-size:0.75rem; width:135px;" onchange="window._setPayrollPrintDate(this.value)">
          <button class="btn btn-outline-success" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" onclick="window._exportToExcel('internal')">📊 Export Excel</button>
          <button class="btn btn-outline-primary" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="window._printInternalPayrollSummary()">🖨️ Rekap Gaji (1 Hal)</button>
          <button class="btn btn-outline-primary" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="window._printOvertimeSummary()">⏰ Rekap Lemburan</button>
          <button class="btn btn-outline-primary" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="window._printSavingsSummary()">🏦 Rekap Tabungan</button>
          <button class="btn btn-success" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" onclick="window._printEnvelopeSlips('A4', 4)">✂️ Cetak 4 Slip / A4</button>
          <button class="btn btn-success" style="padding:0.35rem 0.75rem; font-size:0.75rem; font-weight:bold;" onclick="window._printEnvelopeSlips('F4', 6)">✂️ Cetak 6 Slip / F4</button>
        </div>
      </div>

      <table class="metric-table" style="width:100%; border-collapse:collapse; font-size:0.75rem;">
        <thead>
          <tr>
            <th style="width:25px; text-align:center; padding:4px 6px;">#</th>
            <th style="padding:4px 6px;">Nama & Masa Kerja</th>
            <th style="padding:4px 6px;">Jabatan</th>
            <th style="width:95px; text-align:right; padding:4px 6px;">Gaji Pokok</th>
            <th style="min-width:175px; padding:4px 6px;">Tunjangan & Nominal</th>
            <th style="width:115px; padding:4px 6px;">PW Internal</th>
            <th style="width:75px; padding:4px 6px;">Lembur</th>
            <th style="width:80px; padding:4px 6px;">Tabungan</th>
            <th style="width:110px; text-align:right; padding:4px 6px;">Gaji Bersih (THP)</th>
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
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const bbm = getBbmSalesData(month);
  const pwAudit = computePwAudit(bbm);

  // Audit includes 15 employees (Manager Pedri Fauzi + 14 staff)
  const users = getUsers();
  let managerObj = users.find(u => (u.position || '').toLowerCase() === 'manager' || (u.name || '').toLowerCase().includes('pedri'));
  if (!managerObj) {
    managerObj = { emp_id: 'M1', name: settings.name_audit_manager, position: 'Manager' };
  }

  const staffUsers = users.filter(u => u.emp_id !== managerObj.emp_id);
  const auditUsers = [managerObj, ...staffUsers];

  const pwMgrAdminEach = (pwAudit.total * 0.20) / 2;
  const pwStaffEach = (pwAudit.total * 0.80) / 13;

  let totalGajiPokokAll = 0;
  let totalPwAll = 0;
  let totalBpjsAll = 0;
  let totalThpAll = 0;

  const rowsHTML = auditUsers.map((u, idx) => {
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
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <h4 style="font-size:1rem; font-weight:800; color:var(--text-main); margin:0;">📋 Lembar Penggajian & Pertamina Way Mode Audit (${auditUsers.length} Karyawan)</h4>
          <p style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">Berisi 15 Karyawan (Termasuk Manager ${esc(settings.name_audit_manager)}) | UMK Staf: ${fmt(settings.umk_staf)} | UMK Manager: ${fmt(settings.umk_manager)}</p>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button class="btn btn-outline-success" style="font-weight:bold; padding:0.45rem 1rem;" onclick="window._exportToExcel('audit')">📊 Export Excel (Audit)</button>
          <button class="btn btn-primary" style="font-weight:bold; padding:0.45rem 1rem;" onclick="window._printAuditDocuments()">📥 UNDUH FILE / CETAK DOKUMEN AUDIT (PDF)</button>
        </div>
      </div>

      <div style="background:var(--surface); border:1px solid var(--border); padding:0.75rem; border-radius:var(--radius-md); margin-bottom:1rem; font-size:0.8rem;">
        <strong>Omset Penjualan Liter BBM (Audit):</strong> Total PW Audit = <strong style="color:var(--primary);">${fmt(pwAudit.total)}</strong><br>
        • Manager & Admin (20%): ${fmt(pwAudit.total * 0.2)} (Per @ ${fmt(pwMgrAdminEach)})<br>
        • SPV, Operator, & CS (80%): ${fmt(pwAudit.total * 0.8)} (Per @ ${fmt(pwStaffEach)})
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
  const customListHTML = s.custom_allowances.map(ca => {
    return `<div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface); border:1px solid var(--border); padding:0.5rem 0.75rem; border-radius:var(--radius-sm); margin-bottom:0.4rem;">
      <span style="font-size:0.85rem; font-weight:600; color:var(--text-main);">${esc(ca.name)}</span>
      ${['tunj_jabatan', 'tunj_kinerja', 'tunj_masa_kerja'].includes(ca.id) ? '<span class="text-xs text-muted">Standar Sistem</span>' : `<button class="btn btn-outline-danger" style="padding:0.2rem 0.5rem; font-size:0.65rem;" onclick="window._deleteCustomAllowance('${ca.id}')">Hapus</button>`}
    </div>`;
  }).join('');

  return `<div class="fade-in">
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1.25rem;">
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

window._printEnvelopeSlips = (paperSize = 'A4', perPage = 4) => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const settings = getPayrollSettings();
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};
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
          <div class="company-icon">⛽</div>
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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
    <script>
      function downloadPDF() {
        const btnBar = document.querySelector('.no-print');
        if (btnBar) btnBar.style.display = 'none';
        if (window.html2pdf) {
          const opt = {
            margin: [2, 2, 2, 2],
            filename: 'Slip_Gaji_Amplop_${month}.pdf',
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: { scale: 4, useCORS: true, logging: false, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }
          };
          html2pdf().set(opt).from(document.body).save().then(() => { if (btnBar) btnBar.style.display = 'flex'; }).catch(() => { if (btnBar) btnBar.style.display = 'flex'; window.print(); });
        } else { if (btnBar) btnBar.style.display = 'flex'; window.print(); }
      }
    </script>
    <style>
      @page { size: ${paperSize === 'F4' ? '215mm 330mm' : 'A4'} portrait; margin: 4mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', sans-serif; color: #1e293b; background: #f8fafc; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
      
      .page-grid { display: grid; grid-template-columns: 1fr 1fr; grid-gap: 6px; page-break-after: always; width: 100%; min-height: 96vh; padding: 3px; }
      .per-page-4 { grid-template-rows: 1fr 1fr; }
      .per-page-6 { grid-template-rows: 1fr 1fr 1fr; }

      .slip-card {
        border: none;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        overflow: hidden;
        position: relative;
      }

      .slip-top-bar {
        height: 4px;
        background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7);
      }

      .slip-header-area {
        background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%) !important;
        padding: 7px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .company-badge {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .company-icon {
        width: 26px;
        height: 26px;
        background: linear-gradient(135deg, #f59e0b, #ef4444) !important;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: #fff;
      }

      .company-name {
        font-size: 12px;
        font-weight: 800;
        color: #fff !important;
        letter-spacing: 0.5px;
      }

      .company-id {
        font-size: 9px;
        color: #94a3b8 !important;
        font-weight: 500;
      }

      .period-badge {
        background: rgba(255,255,255,0.12) !important;
        color: #e2e8f0 !important;
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
        color: #0f172a;
      }

      .emp-pos {
        font-size: 8px;
        font-weight: 600;
        color: #6366f1;
        background: #eef2ff !important;
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
      }

      .main-row {
        color: #334155;
        font-weight: 500;
      }

      .tambahan-label {
        font-size: 8.5px;
        font-weight: 700;
        color: #64748b;
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
      }

      .subtotal-row {
        border-top: 1.5px solid #cbd5e1;
        margin-top: 3px;
        padding-top: 3px;
        font-weight: 700;
        color: #0f172a;
        font-size: 10px;
      }

      .deduction-row {
        color: #dc2626;
        font-size: 9px;
        padding: 2px 0;
      }

      .deduction-row .deduction {
        color: #dc2626;
      }

      .slip-footer-area {
        padding: 0 10px 7px;
      }

      .net-pay-bar {
        background: linear-gradient(135deg, #059669, #10b981) !important;
        border-radius: 5px;
        padding: 5px 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 5px;
      }

      .net-label {
        color: rgba(255,255,255,0.85) !important;
        font-size: 8.5px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
      }

      .net-amount {
        color: #fff !important;
        font-size: 13px;
        font-weight: 900;
        letter-spacing: 0.3px;
      }

      .sign-area {
        text-align: right;
        font-size: 8px;
        color: #64748b;
        line-height: 1.35;
      }

      .sign-date { font-weight: 500; }
      .sign-title { font-weight: 600; color: #475569; margin-top: 1px; }
      .sign-space { height: 20px; }
      .sign-name { font-weight: 700; color: #0f172a; text-decoration: underline; font-size: 8.5px; }

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
    <div class="no-print" style="padding:10px 16px; background:linear-gradient(135deg,#0f172a,#1e3a5f); border-bottom:3px solid #6366f1; display:flex; justify-content:flex-end; gap:10px; align-items:center;">
      <button onclick="downloadPDF()" class="toolbar-btn" style="background:linear-gradient(135deg,#059669,#10b981); color:#fff;">📥 UNDUH FILE / SIMPAN PDF (Super HD)</button>
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff;">🖨️ Cetak Slip Amplop (Printer)</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>
    ${slipsHTML}
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

  const pwMgrAdminEach = (pwAudit.total * 0.20) / 2;
  const pwStaffEach = (pwAudit.total * 0.80) / 13;

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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
    <script>
      function downloadPDF() {
        const btnBar = document.querySelector('.no-print');
        if (btnBar) btnBar.style.display = 'none';
        if (window.html2pdf) {
          const opt = {
            margin: [3, 3, 3, 3],
            filename: 'Dokumen_Audit_Pertamina_${month}.pdf',
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: { scale: 4, useCORS: true, logging: false, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }
          };
          html2pdf().set(opt).from(document.body).save().then(() => { if (btnBar) btnBar.style.display = 'flex'; }).catch(() => { if (btnBar) btnBar.style.display = 'flex'; window.print(); });
        } else { if (btnBar) btnBar.style.display = 'flex'; window.print(); }
      }
    </script>
    <style>
      @page { size: A4 portrait; margin: 6mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', sans-serif; color: #1e293b; background: #f8fafc; padding: 6px; font-size: 10.5px; -webkit-font-smoothing: antialiased; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%) !important; color: #fff; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #f59e0b, #ef4444); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #fff !important; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 !important; }
      .period-badge { background: rgba(255,255,255,0.12) !important; color: #e2e8f0 !important; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.18); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 5px 7px; }
      th { background: #0f172a !important; color: #fff !important; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.3px; }
      tfoot td { background: #f1f5f9 !important; font-weight: 800; color: #0f172a; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:linear-gradient(135deg,#0f172a,#1e3a5f); border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="downloadPDF()" class="toolbar-btn" style="background:linear-gradient(135deg,#059669,#10b981); color:#fff;">📥 UNDUH PDF (Super HD)</button>
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff;">🖨️ Cetak Dokumen Audit (3 Halaman)</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <!-- HALAMAN 1: PERHITUNGAN PERTAMINA WAY -->
    <div>
      <div class="top-accent-bar"></div>
      <div class="header-card">
        <div class="brand-box">
          <div class="brand-icon">⛽</div>
          <div>
            <div class="brand-title">SPBU GONTOR 54.634.25</div>
            <div class="brand-sub">Dokumen Perhitungan Pertamina Way Internal</div>
          </div>
        </div>
        <div class="period-badge">BULAN ${monthNameUpper}</div>
      </div>

      <div class="doc-title-bar">PERHITUNGAN PERTAMINA WAY BULAN ${monthNameUpper}</div>

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
          <tr><td>MANAGER & ADMIN</td><td style="text-align:center;">20%</td><td style="text-align:right;">${fmt(pwAudit.total * 0.2)}</td><td style="text-align:right; font-weight:600;">${fmt(pwMgrAdminEach)}</td></tr>
          <tr><td>PENGAWAS + OPERATOR + CS</td><td style="text-align:center;">80%</td><td style="text-align:right;">${fmt(pwAudit.total * 0.8)}</td><td style="text-align:right; font-weight:600;">${fmt(pwStaffEach)}</td></tr>
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

      <div style="display:flex; justify-content:space-between; margin-top:15px; font-size:9.5px; color:#475569;">
        <div>
          Mengetahui,<br>
          <strong style="color:#0f172a;">SPBU 54.634.25 MLARAK</strong><br>
          <div style="height:30px;"></div>
          <strong style="text-decoration:underline; color:#0f172a;">${esc(settings.name_audit_manager)}</strong><br>
          <span>Manager</span>
        </div>
        <div style="text-align:right;">
          Ponorogo, ${formattedPrintDate}<br>
          <div style="height:30px;"></div>
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

      <div class="doc-title-bar">DAFTAR PENERIMAAN PERTAMINA WAY</div>
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
            <td style="text-align:right; font-weight:600;">${fmt((u.position || '').toLowerCase().includes('manager') || (u.position || '').toLowerCase().includes('admin') ? pwMgrAdminEach : pwStaffEach)}</td>
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
        <div style="height:35px;"></div>
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
            <div class="brand-sub">Daftar Penerimaan Gaji Resmi Audit</div>
          </div>
        </div>
        <div class="period-badge">BULAN ${monthNameUpper}</div>
      </div>

      <div class="doc-title-bar">PENERIMAAN GAJI KARYAWAN AUDIT PERTAMINA</div>
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
            <th rowspan="2" colspan="2" style="width:90px;">TANDA TANGAN</th>
          </tr>
          <tr>
            <th>PX/PL/PXT/PTD</th>
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

            const ttdLeft = (idx % 2 === 0) ? `${idx + 1}` : '';
            const ttdRight = (idx % 2 === 1) ? `${idx + 1}` : '';

            return `<tr>
              <td style="text-align:center;">${idx + 1}</td>
              <td><strong>${esc(u.name)}</strong></td>
              <td style="text-align:center;">${esc(pos.toUpperCase())}</td>
              <td style="text-align:right;">${fmt(gajiPokok)}</td>
              <td style="text-align:right;">${fmt(pwVal)}</td>
              <td style="text-align:right;">${fmt(bpjsVal)}</td>
              <td style="text-align:right; font-weight:800; color:#0f172a;">${fmt(thpVal)}</td>
              <td style="width:40px; font-size:9px; vertical-align:top; border-right:none;">${ttdLeft}</td>
              <td style="width:40px; font-size:9px; vertical-align:bottom; text-align:right; border-left:none;">${ttdRight}</td>
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

      <div style="text-align:right; margin-top:15px; font-size:9.5px; color:#475569;">
        Ponorogo, ${formattedPrintDate}<br>
        <div style="height:35px;"></div>
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
    const tenureMonths = getTenureMonths(u.join_date || u.created_at);

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
      <td style="text-align:center;">${tenureMonths} Bulan</td>
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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
    <script>
      function downloadPDF() {
        const btnBar = document.querySelector('.no-print');
        if (btnBar) btnBar.style.display = 'none';
        if (window.html2pdf) {
          const opt = {
            margin: [3, 3, 3, 3],
            filename: 'Rekap_Gaji_Internal_${month}.pdf',
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: { scale: 4, useCORS: true, logging: false, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true }
          };
          html2pdf().set(opt).from(document.body).save().then(() => { if (btnBar) btnBar.style.display = 'flex'; }).catch(() => { if (btnBar) btnBar.style.display = 'flex'; window.print(); });
        } else { if (btnBar) btnBar.style.display = 'flex'; window.print(); }
      }
    </script>
    <style>
      @page { size: A4 landscape; margin: 5mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', sans-serif; color: #1e293b; background: #f8fafc; padding: 6px; font-size: 9.5px; -webkit-font-smoothing: antialiased; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%) !important; color: #fff; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #f59e0b, #ef4444); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #fff !important; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 !important; }
      .period-badge { background: rgba(255,255,255,0.12) !important; color: #e2e8f0 !important; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.18); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9px; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 5px 6px; }
      th { background: #0f172a !important; color: #fff !important; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9px; letter-spacing: 0.3px; }
      tfoot td { background: #f1f5f9 !important; font-weight: 800; color: #0f172a; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:linear-gradient(135deg,#0f172a,#1e3a5f); border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="downloadPDF()" class="toolbar-btn" style="background:linear-gradient(135deg,#059669,#10b981); color:#fff;">📥 UNDUH PDF (Super HD)</button>
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff;">🖨️ Cetak Rekapitulasi Gaji Internal</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box">
        <div class="brand-icon">⛽</div>
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

    <div style="display:flex; justify-content:space-between; margin-top:20px; font-size:10px;">
      <div>
        <strong>TOTAL PENGELUARAN GAJI UNTUK KARYAWAN:</strong>
        <span style="font-size:12px; font-weight:bold; background:#facc15; padding:3px 8px; border:1px solid #000; margin-left:10px;">
          ${fmt(totalBersih + totalTabungan)}
        </span>
      </div>
      <div style="text-align:right;">
        Ponorogo, ${formattedPrintDate}<br>
        <div style="height:35px;"></div>
        <strong style="text-decoration:underline;">${esc(settings.name_finance_manager)}</strong><br>
        <span>Manajer Keuangan</span>
      </div>
    </div>
  </body>
  </html>`);
  win.document.close();
};

window._printSavingsSummary = () => {
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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
    <script>
      function downloadPDF() {
        const btnBar = document.querySelector('.no-print');
        if (btnBar) btnBar.style.display = 'none';
        if (window.html2pdf) {
          const opt = {
            margin: [3, 3, 3, 3],
            filename: 'Rekap_Tabungan_Karyawan_${currentYear}.pdf',
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: { scale: 4, useCORS: true, logging: false, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape', compress: true }
          };
          html2pdf().set(opt).from(document.body).save().then(() => { if (btnBar) btnBar.style.display = 'flex'; }).catch(() => { if (btnBar) btnBar.style.display = 'flex'; window.print(); });
        } else { if (btnBar) btnBar.style.display = 'flex'; window.print(); }
      }
    </script>
    <style>
      @page { size: A4 landscape; margin: 5mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', sans-serif; color: #1e293b; background: #f8fafc; padding: 6px; font-size: 9px; -webkit-font-smoothing: antialiased; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%) !important; color: #fff; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #059669, #10b981); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #fff !important; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 !important; }
      .period-badge { background: rgba(255,255,255,0.12) !important; color: #e2e8f0 !important; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.18); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 9px; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 4.5px 5px; }
      th { background: #0f172a !important; color: #fff !important; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9px; letter-spacing: 0.3px; }
      tfoot td { background: #f1f5f9 !important; font-weight: 800; color: #0f172a; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:linear-gradient(135deg,#0f172a,#1e3a5f); border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="downloadPDF()" class="toolbar-btn" style="background:linear-gradient(135deg,#059669,#10b981); color:#fff;">📥 UNDUH PDF (Super HD)</button>
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff;">🖨️ Cetak Rekap Tabungan (Printer)</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box">
        <div class="brand-icon">💳</div>
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
          <td style="text-align:right; background:#facc15;">${fmt(totalAllSavings)}</td>
        </tr>
      </tfoot>
    </table>
  </body>
  </html>`);
  win.document.close();
};

window._printOvertimeSummary = () => {
  const month = window._payrollMonth || getTodayStr().substring(0, 7);
  const printDate = window._payrollPrintDate || getTodayStr();
  const users = getUsers().filter(u => (u.position || '').toLowerCase() !== 'manager');
  const monthData = (allData.payroll && allData.payroll[month] && allData.payroll[month].internal_data) || {};
  
  const monthNameUpper = new Date(month + '-01').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase();

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
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
    <script>
      function downloadPDF() {
        const btnBar = document.querySelector('.no-print');
        if (btnBar) btnBar.style.display = 'none';
        if (window.html2pdf) {
          const opt = {
            margin: [4, 4, 4, 4],
            filename: 'Rekap_Lembur_Karyawan_${month}.pdf',
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: { scale: 4, useCORS: true, logging: false, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }
          };
          html2pdf().set(opt).from(document.body).save().then(() => { if (btnBar) btnBar.style.display = 'flex'; }).catch(() => { if (btnBar) btnBar.style.display = 'flex'; window.print(); });
        } else { if (btnBar) btnBar.style.display = 'flex'; window.print(); }
      }
    </script>
    <style>
      @page { size: A4 portrait; margin: 6mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', sans-serif; color: #1e293b; background: #f8fafc; padding: 6px; font-size: 10.5px; -webkit-font-smoothing: antialiased; }
      
      .top-accent-bar { height: 4px; background: linear-gradient(90deg, #0ea5e9, #6366f1, #a855f7); border-radius: 4px 4px 0 0; }
      .header-card { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%) !important; color: #fff; padding: 10px 14px; border-radius: 0 0 8px 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
      .brand-box { display: flex; align-items: center; gap: 8px; }
      .brand-icon { width: 30px; height: 30px; background: linear-gradient(135deg, #3b82f6, #6366f1); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 15px; }
      .brand-title { font-size: 14px; font-weight: 800; letter-spacing: 0.5px; color: #fff !important; }
      .brand-sub { font-size: 9.5px; color: #94a3b8 !important; }
      .period-badge { background: rgba(255,255,255,0.12) !important; color: #e2e8f0 !important; padding: 4px 10px; border-radius: 5px; font-size: 9px; font-weight: 700; border: 1px solid rgba(255,255,255,0.18); text-transform: uppercase; letter-spacing: 0.5px; }

      .doc-title-bar { text-align: center; font-size: 12px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }

      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      th, td { border: 1px solid #cbd5e1; padding: 5.5px 7px; }
      th { background: #0f172a !important; color: #fff !important; font-weight: 700; text-align: center; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.3px; }
      tfoot td { background: #f1f5f9 !important; font-weight: 800; color: #0f172a; }
      
      .toolbar-btn { padding: 7px 16px; font-weight: 700; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Inter', sans-serif; }
      @media print { .no-print { display: none !important; } }
    </style>
  </head>
  <body>
    <div class="no-print" style="padding:10px 16px; background:linear-gradient(135deg,#0f172a,#1e3a5f); border-bottom:3px solid #6366f1; margin-bottom:12px; display:flex; justify-content:flex-end; gap:10px; align-items:center; border-radius:6px;">
      <button onclick="downloadPDF()" class="toolbar-btn" style="background:linear-gradient(135deg,#059669,#10b981); color:#fff;">📥 UNDUH PDF (Super HD)</button>
      <button onclick="window.print()" class="toolbar-btn" style="background:linear-gradient(135deg,#3b82f6,#6366f1); color:#fff;">🖨️ Cetak Rekap Lemburan (Printer)</button>
      <button onclick="window.close()" class="toolbar-btn" style="background:#334155; color:#cbd5e1;">✕ Tutup</button>
    </div>

    <div class="top-accent-bar"></div>
    <div class="header-card">
      <div class="brand-box">
        <div class="brand-icon">⏰</div>
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
          <td style="text-align:right;">Rp ${fmt(totalOtAmtAll)}</td>
        </tr>
      </tfoot>
    </table>
  </body>
  </html>`);
  win.document.close();
};

// ==========================================
// START
// ==========================================
document.addEventListener('DOMContentLoaded', init);

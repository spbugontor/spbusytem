import { db, auth, ref, onValue, set, push, remove, update, get, child, signInWithEmailAndPassword, signOut, onAuthStateChanged, browserSessionPersistence, setPersistence } from './firebase-config.js?v=20260712g';

// ==========================================
// STATE
// ==========================================
let currentUser = null;
let currentSection = 'dashboard';
let allData = { users: {}, transactions: {}, leaves: {}, savings: {}, violations: {}, ratings: {}, criteria: {}, leave_types: {}, settings: {}, pin_history: {} };

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
  document.documentElement.style.setProperty('--primary-hover', t.hover);
  document.documentElement.style.setProperty('--primary-bg', t.bg);
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

window.toggleDarkMode = () => {
  const isDark = document.documentElement.classList.toggle('dark-mode');
  localStorage.setItem('spbu_dark_mode', isDark);
  syncDarkIcons(isDark);
};

// Update icons on load if they exist
document.addEventListener('DOMContentLoaded', () => {
  if (savedDarkMode) syncDarkIcons(true);
});

// ==========================================
// UTILITIES
// ==========================================
function esc(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[t])); }
function fmt(n) { return 'Rp ' + (parseInt(n) || 0).toLocaleString('id-ID'); }
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
function getCriteria(pos) { return Object.entries(allData.criteria).filter(([, v]) => pos ? (v.position === pos || v.position === 'Semua') : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (a.name || '').localeCompare(b.name || '')); }
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

function showModal(html) {
  let overlay = $('global-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'global-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-content"></div>';
    overlay.addEventListener('click', e => { if (e.target === overlay) hideModal(); });
    document.body.appendChild(overlay);
  }
  overlay.querySelector('.modal-content').innerHTML = html;
  requestAnimationFrame(() => overlay.classList.add('show'));
}
function hideModal() { const m = $('global-modal'); if (m) m.classList.remove('show'); }

// ==========================================
// INITIALIZATION
// ==========================================
function init() {
  setupEventListeners();
  setPersistence(auth, browserSessionPersistence).catch(console.error);

  onAuthStateChanged(auth, user => {
    if (user) {
      currentUser = { role: 'admin', name: 'Manajemen', username: 'admin' };
      loginSuccess();
    } else {
      const s = sessionStorage.getItem('mytic_emp_session');
      if (s) { currentUser = JSON.parse(s); loginSuccess(); }
      else doLogout(false);
    }
  });

  // Global real-time listeners per node
  const nodes = ['users', 'transactions', 'leaves', 'savings', 'violations', 'ratings', 'criteria', 'leave_types', 'settings', 'pin_history'];
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

      if (currentUser) renderCurrentSection();
    }, error => {
      console.error(`Error reading ${node}:`, error);
      showToast(`Akses ditolak pada data ${node}. Periksa Firebase Rules!`, 'error');
    });
  });

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
  $('btn-login-mgmt').addEventListener('click', handleAdminLogin);
  $('inp-mgmt-pin').addEventListener('keypress', e => { if (e.key === 'Enter') handleAdminLogin(); });
  $('btn-login-emp').addEventListener('click', handleEmpLogin);
  $('inp-emp-pin').addEventListener('keypress', e => { if (e.key === 'Enter') handleEmpLogin(); });
  $('btn-logout-sidebar').addEventListener('click', () => doLogout(true));
  $('btn-logout-mobile').addEventListener('click', () => doLogout(true));
}

// ==========================================
// AUTH
// ==========================================
async function handleAdminLogin() {
  const email = $('inp-mgmt-username').value.trim().toLowerCase();
  const pin = $('inp-mgmt-pin').value.trim();
  if (!email || !pin) { showToast('Isi email dan password!', 'warning'); return; }
  const btn = $('btn-login-mgmt'); btn.textContent = 'Memproses...'; btn.disabled = true;
  try { await signInWithEmailAndPassword(auth, email, pin); showToast('Berhasil masuk', 'success'); }
  catch { showToast('Login gagal. Periksa email dan password.', 'error'); }
  finally { btn.textContent = 'Masuk Manajemen'; btn.disabled = false; }
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
  setupNavigation();
  switchSection('dashboard');
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
  { id: 'leave-types', label: 'Jenis Cuti', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { id: 'violations', label: 'Pelanggaran', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { id: 'savings', label: 'Tabungan', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
  { id: 'ratings', label: 'Penilaian', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
  { id: 'criteria', label: 'Kriteria', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'leaderboard', label: 'Leaderboard', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
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

function setupNavigation() {
  const isAdmin = currentUser.role === 'admin';
  const menu = isAdmin ? ADMIN_MENU : EMP_MENU;

  // Check unread/pending leaves for badges
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

  const redDot = `<span style="width:8px;height:8px;background:var(--danger);border-radius:50%;display:inline-block;margin-left:5px;box-shadow:0 0 6px var(--danger);vertical-align:middle"></span>`;

  let dHTML = '';
  menu.forEach(m => {
    const isLeaveMenu = (m.id === 'leaves' && adminHasPendingLeave) || (m.id === 'emp-leaves' && empHasUnreadLeave);
    const labelWithBadge = isLeaveMenu ? `${m.label}${redDot}` : m.label;

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
    const labelWithBadge = isLeaveMenu ? `${m.label}${redDot}` : m.label;

    if (m.href) {
      mHTML += `<a href="${m.href}" class="mobile-nav-item"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg><span>${labelWithBadge}</span></a>`;
    } else {
      mHTML += `<a class="mobile-nav-item" data-target="${m.id}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg><span>${labelWithBadge}</span></a>`;
    }
  });

  const hasMoreUnread = mobileMore.some(m => (m.id === 'leaves' && adminHasPendingLeave) || (m.id === 'emp-leaves' && empHasUnreadLeave));
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
      const labelWithBadge = isLeaveMenu ? `${m.label}${redDot}` : m.label;

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

function switchSection(id) {
  currentSection = id;
  document.querySelectorAll('[data-target]').forEach(el => el.classList.toggle('active', el.getAttribute('data-target') === id));
  const label = document.querySelector(`.nav-item[data-target="${id}"]`);
  $('topbar-title').textContent = label ? label.textContent.trim() : 'Dashboard';
  renderCurrentSection();
}

function renderCurrentSection() {
  if (currentUser) setupNavigation();
  const w = $('content-wrapper'); if (!w) return;
  const isAdmin = currentUser && currentUser.role === 'admin';
  let html = '';
  if (isAdmin) {
    switch (currentSection) {
      case 'dashboard': html = renderAdminDashboard(); break;
      case 'employees': html = renderEmployees(); break;
      case 'debits': html = renderDebits(); break;
      case 'leaves': html = renderMgmtLeaves(); break;
      case 'leave-types': html = renderLeaveTypes(); break;
      case 'violations': html = renderViolations(); break;
      case 'savings': html = renderSavings(); break;
      case 'ratings': html = renderRatings(); break;
      case 'criteria': html = renderCriteriaPage(); break;
      case 'leaderboard': html = renderLeaderboard(); break;
      case 'settings': html = renderSettings(); break;
      default: html = renderAdminDashboard();
    }
  } else {
    switch (currentSection) {
      case 'dashboard': html = renderEmpDashboard(); break;
      case 'emp-debits': html = renderEmpDebits(); break;
      case 'emp-history': html = renderEmpHistory(); break;
      case 'emp-leaves': html = renderEmpLeaves(); break;
      case 'emp-violations': html = renderEmpViolations(); break;
      case 'emp-savings': html = renderEmpSavings(); break;
      case 'emp-ratings': html = renderEmpRatings(); break;
      case 'emp-profile': html = renderEmpProfile(); break;
      default: html = renderEmpDashboard();
    }
  }
  w.innerHTML = html;
}

// ==========================================
// ADMIN DASHBOARD
// ==========================================
function renderAdminDashboard() {
  const users = getUsers();
  const leaves = getLeaves();
  const pending = leaves.filter(l => l.status === 'Menunggu').length;
  let totalDebit = 0; users.forEach(u => totalDebit += calcBalance(u.emp_id));
  let totalSavings = 0; Object.values(allData.savings).forEach(s => totalSavings += (s.amount || 0));

  return `<div class="fade-in">
    <div class="dashboard-grid">
      <div class="stat-card" onclick="window._nav('employees')"><div class="stat-title">Total Karyawan</div><div class="stat-value">${users.length}</div></div>
      <div class="stat-card" onclick="window._nav('debits')"><div class="stat-title">Total Tunggakan</div><div class="stat-value" style="color:var(--danger)">${fmt(totalDebit)}</div></div>
      <div class="stat-card" onclick="window._nav('leaves')"><div class="stat-title">Menunggu Approve</div><div class="stat-value" style="color:var(--warning)">${pending}</div></div>
      <div class="stat-card" onclick="window._nav('savings')"><div class="stat-title">Total Tabungan</div><div class="stat-value" style="color:var(--success)">${fmt(totalSavings)}</div></div>
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
          ? `<img src="${e.profile_picture}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;">`
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

// ==========================================
// DEBITS (ADMIN)
// ==========================================
function renderDebits() {
  const users = getUsers();
  return `<div class="fade-in">
    <h3 class="text-xl font-bold mb-4">Tunggakan Karyawan</h3>
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
          <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
            <button class="btn btn-danger" style="flex:1;padding:0.5rem;font-size:0.75rem" onclick="window._showTxnForm('${e.emp_id}','debit')">+ Debit</button>
            <button class="btn btn-primary" style="flex:1;padding:0.5rem;font-size:0.75rem;background:var(--success)" onclick="window._showTxnForm('${e.emp_id}','credit')">+ Kredit</button>
          </div>
          <div id="txn-form-${e.emp_id}"></div>
          ${txns.length === 0 ? '<p class="text-xs text-muted" style="text-align:center">Belum ada transaksi.</p>' :
            txns.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-color);border-radius:var(--radius-md);margin-bottom:0.25rem;font-size:0.8rem">
            <div><strong style="color:${t.type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${t.type === 'debit' ? '+' : '-'}${fmt(t.amount)}</strong> <span class="text-muted">${esc(t.note || '')}</span></div>
            <div style="display:flex;align-items:center;gap:0.5rem"><span class="text-muted">${fmtDate(t.date)}</span><button style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:0.7rem" onclick="window._deleteTxn('${t._key}')">✕</button></div>
          </div>`).join('')}
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
      <button class="btn btn-primary" onclick="window._showCriteriaForm()">+ Tambah</button>
    </div>
    <div id="crit-form-area"></div>
    ${criteria.length === 0 ? '<div class="card"><p class="text-muted">Belum ada kriteria.</p></div>' :
      Object.keys(grouped).map(ind => `
      <div style="margin-bottom:1.5rem">
        <h4 style="font-weight:700;margin-bottom:0.75rem;padding-bottom:0.25rem;border-bottom:2px solid var(--border)">Indikator: ${esc(ind)}</h4>
        ${grouped[ind].map(c => `<div class="card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(c.name)}</strong><br><span class="text-xs text-muted">Berlaku: ${esc(c.position || 'Semua')}</span></div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-secondary" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._showCriteriaForm('${c._key}')">Edit</button>
            <button class="btn btn-outline-danger" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._deleteCriteria('${c._key}')">Hapus</button>
          </div>
        </div>`).join('')}
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
  return `<div class="fade-in">
    <div class="dashboard-grid">
      <div class="stat-card"><div class="stat-title">Tunggakan Saya</div><div class="stat-value" style="color:${bal > 0 ? 'var(--danger)' : 'var(--success)'}">${fmt(bal)}</div></div>
      <div class="stat-card"><div class="stat-title">Tabungan Saya</div><div class="stat-value" style="color:var(--success)">${fmt(savTotal)}</div></div>
      <div class="stat-card"><div class="stat-title">Izin Pending</div><div class="stat-value" style="color:var(--warning)">${pendingLeaves}</div></div>
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
  const bal = calcBalance(emp.emp_id);
  const txns = getTxns(emp.emp_id);
  return `<div class="fade-in">
    <div class="card mb-4" style="text-align:center"><p class="form-label">Saldo Tunggakan</p><p style="font-size:2rem;font-weight:800;color:${bal > 0 ? 'var(--danger)' : 'var(--success)'}">${fmt(bal)}</p></div>
    <div class="card"><h3 class="card-title mb-4">Riwayat Transaksi</h3>
    ${txns.length === 0 ? '<p class="text-muted text-sm">Belum ada transaksi.</p>' :
      txns.map(t => `<div style="display:flex;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border);font-size:0.85rem">
      <div><strong style="color:${t.type === 'debit' ? 'var(--danger)' : 'var(--success)'}">${t.type === 'debit' ? '+' : '-'}${fmt(t.amount)}</strong> <span class="text-muted">${esc(t.note || '')}</span></div>
      <span class="text-muted">${fmtDate(t.date)}</span></div>`).join('')}
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
    ? `<img src="${emp.profile_picture}" alt="Profil" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto 1rem;border:2px solid var(--primary);">`
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

  showModal(`<div class="modal-header"><h3 class="modal-title">${esc(emp.name)}</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body">
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
  if (type === 'credit' && amt > calcBalance(empId)) { showToast('Pembayaran melebihi hutang!', 'error'); return; }
  await set(push(ref(db, 'transactions')), { emp_id: empId, type, amount: amt, date, note });
  showToast('Transaksi disimpan!', 'success');
};

window._deleteTxn = async (key) => { if (confirm('Hapus transaksi?')) { await remove(ref(db, 'transactions/' + key)); showToast('Dihapus!', 'success'); } };

// --- LEAVE CRUD ---
window._updateLeaveStatus = async (key, status) => {
  await update(ref(db, 'leaves/' + key), { status });
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
        <span class="text-xs text-muted" style="margin-bottom:0.25rem">${esc(c.senderName)} • ${new Date(c.timestamp).toLocaleString('id-ID', {hour:'2-digit', minute:'2-digit', day:'numeric', month:'short'})}</span>
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

  await set(push(ref(db, 'leaves')), { emp_id: emp.emp_id, leave_type: leaveType, start_date: startDate, end_date: endDate, reason, status: 'Menunggu', date: today() });
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
  await set(push(ref(db, 'violations')), { emp_id: empId, violation_type: vType, category: $('vf-cat').value, level: $('vf-level').value, description: desc, date: $('vf-date').value, status: 'Berlaku' });
  showToast('Pelanggaran dicatat!', 'success');
};
window._deleteVio = async (key) => { if (confirm('Hapus?')) { await remove(ref(db, 'violations/' + key)); showToast('Dihapus!', 'success'); } };

// --- SAVING CRUD ---
window._showSavingForm = (empId) => {
  const area = $('sav-form-' + empId); if (!area) return;
  const cm = new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' });
  area.innerHTML = `<div style="padding:0.75rem;background:var(--success-bg);border-radius:var(--radius-lg);margin-bottom:1rem;border:1px solid var(--success)">
    <p class="text-xs font-bold mb-2" style="color:#065F46">Tambah Tabungan</p>
    <input id="sf-amt" type="number" inputmode="numeric" class="form-input mb-2" placeholder="Jumlah (Rp)" style="font-size:0.85rem;padding:0.5rem">
    <input id="sf-month" class="form-input mb-2" value="${cm}" placeholder="Bulan" style="font-size:0.85rem;padding:0.5rem">
    <input id="sf-date" type="date" value="${today()}" class="form-input mb-2" style="font-size:0.85rem;padding:0.5rem">
    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-primary" style="padding:0.5rem 1rem;font-size:0.75rem;background:var(--success)" onclick="window._saveSaving('${empId}')">Simpan</button>
      <button class="btn btn-secondary" style="padding:0.5rem 1rem;font-size:0.75rem" onclick="document.getElementById('sav-form-${empId}').innerHTML=''">Batal</button>
    </div>
  </div>`;
};
window._saveSaving = async (empId) => {
  const amt = parseFloat($('sf-amt').value) || 0;
  if (amt <= 0) { showToast('Jumlah harus > 0', 'error'); return; }
  await set(push(ref(db, 'savings')), { emp_id: empId, amount: amt, month: $('sf-month').value.trim(), date: $('sf-date').value });
  showToast('Tabungan disimpan!', 'success');
  $('sav-form-' + empId).innerHTML = '';
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
  const date = $('msf-date').value;
  const cbs = document.querySelectorAll('.msf-emp-cb:checked');

  if (amt <= 0) { showToast('Jumlah harus > 0', 'error'); return; }
  if (!month || !date) { showToast('Bulan dan tanggal wajib diisi!', 'error'); return; }
  if (cbs.length === 0) { showToast('Pilih minimal 1 karyawan!', 'error'); return; }

  for (const cb of cbs) {
    const empId = cb.value;
    await set(push(ref(db, 'savings')), { emp_id: empId, amount: amt, month, date });
  }

  showToast(cbs.length + ' tabungan berhasil disimpan!', 'success');
  $('mass-sav-form-area').innerHTML = '';
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
    <div class="modal-footer"><button class="btn btn-primary" onclick="window._saveRating()">Simpan Penilaian</button><button class="btn btn-secondary" onclick="window._hideModal()">Batal</button></div>`);

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
    html += `<div style="margin-top:0.5rem;background:#f8fafc;padding:0.5rem;border-radius:4px;border:1px solid var(--border)">
      <h5 style="font-size:0.8rem;font-weight:700;color:var(--primary);margin-bottom:0.25rem;text-transform:uppercase">${esc(ind)}</h5>`;

    grouped[ind].forEach(c => {
      // the data-key attribute is used in _saveRating to avoid invalid characters in Firebase keys
      html += `<div style="display:flex;flex-direction:column;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid #e2e8f0">
        <span class="text-sm font-semibold" style="flex:1;">${esc(c.name)}</span>
        <input type="hidden" class="rf-score" data-key="${c._key}" id="score-${c._key}" value="3">
        <div style="display:flex;gap:0.5rem;justify-content:flex-end;" id="rating-group-${c._key}">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="rating-btn ${n === 3 ? 'active' : ''}" onclick="_setRating('${c._key}', ${n})">${n}</button>`).join('')}
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
      if (parseInt(btn.textContent) === val) {
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
  await set(push(ref(db, 'ratings')), { emp_id: empId, date, scores, note });
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

  let html = `
    <div style="font-family:sans-serif;font-size:0.8rem;padding:0;">
    <div style="text-align:center;margin-bottom:10px;border-bottom:1px solid #000;padding-bottom:5px;">
      <h2 style="margin:0 0 2px 0;font-size:1.1rem;">Laporan Evaluasi Kinerja Karyawan</h2>
      <p style="font-size:1rem;font-weight:bold;margin:0;">SPBU GONTOR</p>
    </div>
    
    <table style="width:100%;margin-bottom:10px;">
      <tr>
        <td style="width:120px;"><strong>Nama Karyawan</strong></td>
        <td>: ${esc(empName)}</td>
      </tr>
      <tr>
        <td><strong>Jabatan</strong></td>
        <td>: ${esc(empPos)}</td>
      </tr>
      <tr>
        <td><strong>Periode Penilaian</strong></td>
        <td>: ${fmtMonthYear(rating.date)}</td>
      </tr>
    </table>

    <h3 style="margin:10px 0 5px;border-bottom:1px dotted #999;font-size:0.9rem;">A. Penilaian Kinerja</h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:4px;text-align:left;background:#f0f0f0;">Indikator / Sub-Indikator</th>
          <th style="border:1px solid #000;padding:4px;text-align:center;width:80px;background:#f0f0f0;">Skor (1-5)</th>
        </tr>
      </thead>
      <tbody>
  `;

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
      html += `<tr><td colspan="2" style="border:1px solid #000;padding:4px;background:#f8fafc;font-weight:bold;text-transform:uppercase;font-size:0.7rem;">${esc(ind)}</td></tr>`;
      groupedScores[ind].forEach(item => {
        html += `
          <tr>
            <td style="border:1px solid #000;padding:4px;padding-left:12px;">${esc(item.name)}</td>
            <td style="border:1px solid #000;padding:4px;text-align:center;">${item.score}</td>
          </tr>
        `;
      });
    });
  }

  html += `
        <tr>
          <td style="border:1px solid #000;padding:4px;text-align:right;"><strong>Rata-Rata:</strong></td>
          <td style="border:1px solid #000;padding:4px;text-align:center;font-size:0.9rem;"><strong>${avg}</strong></td>
        </tr>
      </tbody>
    </table>
    
    <div style="margin-top:10px;">
      <strong>Catatan Evaluasi:</strong>
      <p style="border:1px solid #000;padding:6px;min-height:30px;margin-top:2px;">${esc(rating.note || 'Tidak ada catatan.')}</p>
    </div>

    <h3 style="margin:10px 0 5px;border-bottom:1px dotted #999;font-size:0.9rem;">B. Rekap Izin/Cuti</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:5px;font-size:0.75rem;">
      <tr>
        <td style="width:180px;"><strong>Izin Disetujui (Bulan Ini)</strong></td>
        <td>: <strong>${totalIzinBulanIni} kali</strong></td>
      </tr>
    </table>
    ${leaveQuotaRows ? `
    <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:4px;text-align:left;background:#f0f0f0;">Jenis Cuti</th>
          <th style="border:1px solid #000;padding:4px;text-align:center;background:#f0f0f0;">Jatah</th>
          <th style="border:1px solid #000;padding:4px;text-align:center;background:#f0f0f0;">Terpakai</th>
          <th style="border:1px solid #000;padding:4px;text-align:center;background:#f0f0f0;">Sisa</th>
        </tr>
      </thead>
      <tbody>${leaveQuotaRows}</tbody>
    </table>` : '<p style="color:#666;font-style:italic;font-size:0.75rem;">Tidak ada jenis cuti terdaftar.</p>'}

    <h3 style="margin:10px 0 5px;border-bottom:1px dotted #999;font-size:0.9rem;">C. Tunggakan</h3>
    <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
      <tr>
        <td style="width:150px;"><strong>Total Tunggakan</strong></td>
        <td>: <strong style="color:${balance > 0 ? 'red' : '#065F46'}">${fmt(balance)}</strong></td>
      </tr>
    </table>

    <table style="width:100%;margin-top:20px;text-align:center;font-size:0.8rem;">
      <tr>
        <td style="width:50%;">
          <p>Karyawan,</p>
          <br><br><br>
          <p><strong>(${esc(empName)})</strong></p>
        </td>
        <td style="width:50%;">
          <p>Manajemen,</p>
          <br><br><br>
          <p><strong>(...............................)</strong></p>
        </td>
      </tr>
    </table>
    </div>
  `;
  return html;
};

window._exportSingleRatingPDF = (key) => {
  const html = _generateRatingPDFHtml(key);
  if (!html) return;
  const printArea = document.getElementById('print-area');
  if (printArea) {
    printArea.innerHTML = html;
    window.print();
    setTimeout(() => { printArea.innerHTML = ''; }, 1000);
  } else {
    showToast('Elemen print-area tidak ditemukan', 'error');
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

  const opt = {
    margin: 10,
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  const div = document.createElement('div');
  div.innerHTML = html;

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

  const opt = {
    margin: 10,
    filename: `Evaluasi_Semua_Karyawan_${today()}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css'] }
  };

  const div = document.createElement('div');
  div.innerHTML = combinedHtml;

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
  const currentInd = c?.indicator || 'Umum';
  if (!uniqueIndicators.includes(currentInd)) uniqueIndicators.push(currentInd);
  if (uniqueIndicators.length === 0) uniqueIndicators.push('Umum');

  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--primary)">
    <h3 class="card-title mb-4">${c ? 'Edit' : 'Tambah'} Kriteria</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="form-group">
        <label class="form-label">Nama Indikator</label>
        <select id="cf-indicator-select" class="form-input form-select mb-2" onchange="document.getElementById('cf-indicator').style.display = this.value === '__NEW__' ? 'block' : 'none';">
          ${uniqueIndicators.map(ind => `<option value="${esc(ind)}" ${ind === currentInd ? 'selected' : ''}>${esc(ind)}</option>`).join('')}
          <option value="__NEW__">+ Tambah Indikator Baru</option>
        </select>
        <input id="cf-indicator" class="form-input" value="" placeholder="Ketik nama indikator baru..." style="display:none;">
      </div>
      <div class="form-group"><label class="form-label">Sub-Indikator</label><input id="cf-name" class="form-input" value="${esc(c?.name || '')}" placeholder="Misal: Tepat Waktu"></div>
      <div class="form-group" style="grid-column: 1 / -1"><label class="form-label">Berlaku Untuk</label><select id="cf-pos" class="form-input form-select">
        <option value="Semua" ${c?.position === 'Semua' ? 'selected' : ''}>Semua Jabatan</option>
        <option value="Manager" ${c?.position === 'Manager' ? 'selected' : ''}>Manager</option>
        <option value="Admin" ${c?.position === 'Admin' ? 'selected' : ''}>Admin</option>
        <option value="Supervisor" ${c?.position === 'Supervisor' ? 'selected' : ''}>Supervisor</option>
        <option value="Operator" ${c?.position === 'Operator' ? 'selected' : ''}>Operator</option>
        <option value="Cleaning Service" ${c?.position === 'Cleaning Service' ? 'selected' : ''}>Cleaning Service</option>
      </select></div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:0.5rem">
      <button class="btn btn-primary" onclick="window._saveCriteria('${key || ''}')">${c ? 'Perbarui' : 'Simpan'}</button>
      <button class="btn btn-secondary" onclick="document.getElementById('crit-form-area').innerHTML=''">Batal</button>
    </div>
  </div>`;
};
window._saveCriteria = async (key) => {
  const selVal = $('cf-indicator-select').value;
  let indicator = (selVal === '__NEW__' ? $('cf-indicator').value.trim() : selVal) || 'Umum';

  const name = $('cf-name').value.trim();
  if (!name) { showToast('Sub-indikator wajib diisi!', 'error'); return; }
  const data = { indicator, name, position: $('cf-pos').value };
  if (key) await update(ref(db, 'criteria/' + key), data);
  else await set(push(ref(db, 'criteria')), data);
  showToast('Kriteria disimpan!', 'success');
  $('crit-form-area').innerHTML = '';
};
window._deleteCriteria = async (key) => { if (confirm('Hapus kriteria?')) { await remove(ref(db, 'criteria/' + key)); showToast('Dihapus!', 'success'); } };

window._saveSettings = async () => {
  const settingsData = {
    emp_profile_edit: {
      name: $('set-edit-name').checked,
      photo: $('set-edit-photo').checked,
      phone: $('set-edit-phone').checked,
      email: $('set-edit-email').checked,
      dob: $('set-edit-dob').checked
    }
  };
  await set(ref(db, 'settings'), settingsData);
  showToast('Pengaturan berhasil disimpan!', 'success');
};

// --- CHANGE PIN (Employee) ---
window._tempProfilePhoto = null;
window._handlePhotoSelect = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const max_size = 300;
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
// START
// ==========================================
document.addEventListener('DOMContentLoaded', init);

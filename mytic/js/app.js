import { db, auth, ref, onValue, set, push, remove, update, get, child, signInWithEmailAndPassword, signOut, onAuthStateChanged, browserLocalPersistence, setPersistence } from './firebase-config.js';

// ==========================================
// STATE
// ==========================================
let currentUser = null;
let currentSection = 'dashboard';
let allData = { users: {}, transactions: {}, leaves: {}, savings: {}, violations: {}, ratings: {}, criteria: {}, leave_types: {}, settings: {}, pin_history: {} };

// ==========================================
// UTILITIES
// ==========================================
function esc(s) { if (!s) return ''; return String(s).replace(/[&<>"']/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[t])); }
function fmt(n) { return 'Rp ' + (parseInt(n) || 0).toLocaleString('id-ID'); }
function fmtDate(d) { if (!d) return '-'; try { return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } }
function fmtMonthYear(d) { if (!d) return '-'; try { const [y,m] = d.split('-'); const date = new Date(y, parseInt(m)-1, 1); return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); } catch { return d; } }
function today() { return new Date().toISOString().split('T')[0]; }

function getUsers() { return Object.entries(allData.users).map(([k, v]) => ({ ...v, _key: k })); }
function getUserByKey(key) { const u = allData.users[key]; return u ? { ...u, _key: key } : null; }
function getUserByUsername(uname) { return getUsers().find(u => u.username === uname); }
function getUserByEmpId(eid) { return getUsers().find(u => u.emp_id === eid); }

function getTxns(empId) { return Object.entries(allData.transactions).filter(([, v]) => v.emp_id === empId).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
function calcBalance(empId) { let b = 0; getTxns(empId).forEach(t => { if (t.type === 'debit') b += (t.amount || 0); else b -= (t.amount || 0); }); return b; }

function getLeaves(empId) { return Object.entries(allData.leaves).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
function getSavings(empId) { return Object.entries(allData.savings).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
function getViolations(empId) { return Object.entries(allData.violations).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
function getRatings(empId) { return Object.entries(allData.ratings).filter(([, v]) => empId ? v.emp_id === empId : true).map(([k, v]) => ({ ...v, _key: k })).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
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
  setPersistence(auth, browserLocalPersistence).catch(console.error);

  onAuthStateChanged(auth, user => {
    if (user) {
      currentUser = { role: 'admin', name: 'Manajemen', username: 'admin' };
      loginSuccess();
    } else {
      const s = localStorage.getItem('mytic_emp_session');
      if (s) { currentUser = JSON.parse(s); loginSuccess(); }
      else doLogout(false);
    }
  });

  // Global real-time listeners per node
  const nodes = ['users', 'transactions', 'leaves', 'savings', 'violations', 'ratings', 'criteria', 'leave_types', 'settings', 'pin_history'];
  nodes.forEach(node => {
    onValue(ref(db, node), snap => {
      allData[node] = snap.exists() ? snap.val() : {};
      
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
      }

      if (currentUser) renderCurrentSection();
    }, error => {
      console.error(`Error reading ${node}:`, error);
      showToast(`Akses ditolak pada data ${node}. Periksa Firebase Rules!`, 'error');
    });
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
          localStorage.setItem('mytic_emp_session', JSON.stringify(currentUser));
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
  localStorage.removeItem('mytic_emp_session');
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
  { id: 'leaderboard', label: 'Leaderboard', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' }
];

const EMP_MENU = [
  { id: 'dashboard', label: 'Beranda', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1' },
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
  let dHTML = '';
  menu.forEach(m => {
    dHTML += `<a class="nav-item" data-target="${m.id}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg>${m.label}</a>`;
  });
  $('nav-desktop').innerHTML = dHTML;

  // Mobile: show max 4 items + "Lainnya" button
  const MAX_MOBILE = 4;
  const mobileMain = menu.slice(0, MAX_MOBILE);
  const mobileMore = menu.slice(MAX_MOBILE);
  let mHTML = '';
  mobileMain.forEach(m => {
    mHTML += `<a class="mobile-nav-item" data-target="${m.id}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg><span>${m.label}</span></a>`;
  });
  if (mobileMore.length > 0) {
    mHTML += `<a class="mobile-nav-item" onclick="window._toggleMoreMenu()"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg><span>Lainnya</span></a>`;
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
        <div style="padding:0.75rem">${mobileMore.map(m =>
          `<a class="more-menu-item" data-target="${m.id}" onclick="window._toggleMoreMenu()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${m.icon}"/></svg>
            <span>${m.label}</span>
          </a>`
        ).join('')}</div>
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
      default: html = renderAdminDashboard();
    }
  } else {
    switch (currentSection) {
      case 'dashboard': html = renderEmpDashboard(); break;
      case 'emp-debits': html = renderEmpDebits(); break;
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
    users.map(e => `<div class="card" style="margin-bottom:0.75rem">
      <div style="display:flex;align-items:center;gap:1rem">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem">${(e.name || '?')[0]}</div>
        <div style="flex:1;min-width:0"><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)} • ${esc(e.emp_id)} • ${esc(e.username)}</span></div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-secondary" style="padding:0.5rem 0.75rem;font-size:0.75rem" onclick="window._showEmpDetail('${e._key}')">Detail</button>
          <button class="btn btn-secondary" style="padding:0.5rem 0.75rem;font-size:0.75rem" onclick="window._showEmpForm('${e._key}')">Edit</button>
          <button class="btn btn-outline-danger" style="padding:0.5rem 0.75rem;font-size:0.75rem" onclick="window._deleteEmp('${e._key}')">Hapus</button>
        </div>
      </div>
    </div>`).join('')}
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
            <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800">${(e.name||'?')[0]}</div>
            <div><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)}</span></div>
          </div>
          <div style="text-align:right"><strong style="color:${bal>0?'var(--danger)':bal<0?'var(--success)':'var(--text-muted)'}">${fmt(bal)}</strong><br><span class="text-xs text-muted">${txns.length} transaksi</span></div>
        </div>
        <div id="txn-${e.emp_id}" class="hidden" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
          <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
            <button class="btn btn-danger" style="flex:1;padding:0.5rem;font-size:0.75rem" onclick="window._showTxnForm('${e.emp_id}','debit')">+ Debit</button>
            <button class="btn btn-primary" style="flex:1;padding:0.5rem;font-size:0.75rem;background:var(--success)" onclick="window._showTxnForm('${e.emp_id}','credit')">+ Kredit</button>
          </div>
          <div id="txn-form-${e.emp_id}"></div>
          ${txns.length === 0 ? '<p class="text-xs text-muted" style="text-align:center">Belum ada transaksi.</p>' :
          txns.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-color);border-radius:var(--radius-md);margin-bottom:0.25rem;font-size:0.8rem">
            <div><strong style="color:${t.type==='debit'?'var(--danger)':'var(--success)'}">${t.type==='debit'?'+':'-'}${fmt(t.amount)}</strong> <span class="text-muted">${esc(t.note||'')}</span></div>
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
function renderMgmtLeaves() {
  const leaves = getLeaves();
  return `<div class="fade-in">
    <h3 class="text-xl font-bold mb-4">Pengajuan Izin/Cuti</h3>
    ${leaves.length === 0 ? '<div class="card"><p class="text-muted">Belum ada pengajuan.</p></div>' :
    leaves.map(l => {
      const emp = getUserByEmpId(l.emp_id);
      const sc = l.status === 'Disetujui' ? 'badge-success' : l.status === 'Ditolak' ? 'badge-danger' : 'badge-warning';
      return `<div class="card" style="margin-bottom:0.75rem;border-left:4px solid ${l.status==='Disetujui'?'var(--success)':l.status==='Ditolak'?'var(--danger)':'var(--warning)'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <strong>${esc(emp?emp.name:l.emp_id)}</strong><br>
            <span class="text-xs text-muted">${esc(l.leave_type)} • ${fmtDate(l.start_date)} - ${fmtDate(l.end_date)}</span><br>
            <span class="text-xs text-muted">${esc(l.reason||'-')}</span>
            ${l.feedback ? `<br><span class="text-xs mt-1" style="display:inline-block;padding:0.25rem 0.5rem;background:var(--bg-color);border-radius:var(--radius-sm);color:var(--primary);font-weight:600">Catatan: ${esc(l.feedback)}</span>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;align-items:flex-end">
            <select onchange="window._updateLeaveStatus('${l._key}',this.value)" class="form-input form-select" style="padding:0.4rem 2rem 0.4rem 0.6rem;font-size:0.75rem;font-weight:700;width:auto">
              <option value="Menunggu" ${l.status==='Menunggu'?'selected':''}>Menunggu</option>
              <option value="Disetujui" ${l.status==='Disetujui'?'selected':''}>Disetujui</option>
              <option value="Ditolak" ${l.status==='Ditolak'?'selected':''}>Ditolak</option>
            </select>
            <div style="display:flex;gap:0.5rem">
              <button class="btn btn-secondary" style="padding:0.3rem 0.6rem;font-size:0.7rem" onclick="window._addLeaveNote('${l._key}')">Catatan</button>
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
            <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800">${(e.name||'?')[0]}</div>
            <div><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)}</span></div>
          </div>
          <div style="text-align:right"><strong style="color:var(--danger)">${vios.length}</strong><br><span class="text-xs text-muted">pelanggaran</span></div>
        </div>
        <div id="vio-${e.emp_id}" class="hidden" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
          <button class="btn btn-danger" style="width:100%;margin-bottom:1rem;padding:0.5rem;font-size:0.75rem" onclick="window._showVioForm('${e.emp_id}')">+ Tambah Pelanggaran</button>
          <div id="vio-form-${e.emp_id}"></div>
          ${vios.length===0?'<p class="text-xs text-muted" style="text-align:center">Bersih 👍</p>':
          vios.map(v => {
            const lc = v.level==='SP3'?'var(--danger)':v.level==='SP2'?'var(--warning)':v.level==='SP1'?'#EAB308':'var(--info)';
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
    ${users.length===0?'<div class="card"><p class="text-muted">Tambahkan karyawan dahulu.</p></div>':
    users.map(e => {
      const svs = getSavings(e.emp_id);
      const total = svs.reduce((s, x) => s + (x.amount || 0), 0);
      return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="document.getElementById('sav-${e.emp_id}').classList.toggle('hidden')">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-weight:800">${(e.name||'?')[0]}</div>
            <div><strong>${esc(e.name)}</strong><br><span class="text-xs text-muted">${esc(e.position)}</span></div>
          </div>
          <div style="text-align:right"><strong style="color:var(--success)">${fmt(total)}</strong><br><span class="text-xs text-muted">${svs.length} entri</span></div>
        </div>
        <div id="sav-${e.emp_id}" class="hidden" style="border-top:1px solid var(--border);padding-top:1rem;margin-top:1rem">
          <button class="btn btn-primary" style="width:100%;margin-bottom:1rem;padding:0.5rem;font-size:0.75rem;background:var(--success)" onclick="window._showSavingForm('${e.emp_id}')">+ Tambah Tabungan</button>
          <div id="sav-form-${e.emp_id}"></div>
          ${svs.length===0?'<p class="text-xs text-muted" style="text-align:center">Belum ada tabungan.</p>':
          svs.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:var(--bg-color);border-radius:var(--radius-md);margin-bottom:0.25rem;font-size:0.8rem">
            <div><strong style="color:var(--success)">${fmt(s.amount)}</strong> <span class="text-muted">${esc(s.month||'')}</span></div>
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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Penilaian Kinerja</h3>
      <button class="btn btn-primary" onclick="window._showRatingForm()">+ Tambah Penilaian</button>
    </div>
    ${ratings.length===0?'<div class="card"><p class="text-muted">Belum ada penilaian.</p></div>':
    ratings.map(r => {
      const emp = getUserByEmpId(r.emp_id);
      const avg = r.scores ? (Object.values(r.scores).reduce((s,v)=>s+v,0)/Object.values(r.scores).length).toFixed(1) : '0';
      const color = avg >= 4.5 ? 'var(--success)' : avg >= 3.5 ? 'var(--info)' : avg >= 2.5 ? 'var(--warning)' : 'var(--danger)';
      return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(emp?emp.name:r.emp_id)}</strong><br><span class="text-xs text-muted">Periode: ${fmtMonthYear(r.date)}</span></div>
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
  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Kriteria Penilaian</h3>
      <button class="btn btn-primary" onclick="window._showCriteriaForm()">+ Tambah</button>
    </div>
    <div id="crit-form-area"></div>
    ${criteria.length===0?'<div class="card"><p class="text-muted">Belum ada kriteria.</p></div>':
    criteria.map(c => `<div class="card" style="margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center">
      <div><strong>${esc(c.name)}</strong><br><span class="text-xs text-muted">Berlaku: ${esc(c.position||'Semua')}</span></div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-secondary" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._showCriteriaForm('${c._key}')">Edit</button>
        <button class="btn btn-outline-danger" style="padding:0.4rem 0.6rem;font-size:0.7rem" onclick="window._deleteCriteria('${c._key}')">Hapus</button>
      </div>
    </div>`).join('')}
  </div>`;
}

// ==========================================
// LEADERBOARD (ADMIN)
// ==========================================
function renderLeaderboard() {
  const users = getUsers();
  const allRatings = getRatings();
  if (users.length === 0) return '<div class="fade-in"><div class="card"><p class="text-muted">Tambahkan karyawan terlebih dahulu.</p></div></div>';
  
  const scores = users.map(u => {
    const r = allRatings.filter(x => x.emp_id === u.emp_id);
    let avg = 0;
    if (r.length > 0) {
      let totalScores = 0; let totalCount = 0;
      r.forEach(rt => {
        if (rt.scores) {
          const vals = Object.values(rt.scores);
          totalScores += vals.reduce((a,b)=>a+b,0);
          totalCount += vals.length;
        }
      });
      if (totalCount > 0) avg = totalScores / totalCount;
    }
    return { ...u, avg: parseFloat(avg.toFixed(2)), evalCount: r.length };
  }).sort((a,b) => b.avg - a.avg);

  return `<div class="fade-in">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
      <h3 class="text-xl font-bold">Peringkat Kinerja Karyawan</h3>
    </div>
    ${scores.length === 0 ? '<div class="card"><p class="text-muted">Belum ada data penilaian.</p></div>' :
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
      <div class="stat-card"><div class="stat-title">Tunggakan Saya</div><div class="stat-value" style="color:${bal>0?'var(--danger)':'var(--success)'}">${fmt(bal)}</div></div>
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

function renderEmpDebits() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';
  const bal = calcBalance(emp.emp_id);
  const txns = getTxns(emp.emp_id);
  return `<div class="fade-in">
    <div class="card mb-4" style="text-align:center"><p class="form-label">Saldo Tunggakan</p><p style="font-size:2rem;font-weight:800;color:${bal>0?'var(--danger)':'var(--success)'}">${fmt(bal)}</p></div>
    <div class="card"><h3 class="card-title mb-4">Riwayat Transaksi</h3>
    ${txns.length===0?'<p class="text-muted text-sm">Belum ada transaksi.</p>':
    txns.map(t => `<div style="display:flex;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border);font-size:0.85rem">
      <div><strong style="color:${t.type==='debit'?'var(--danger)':'var(--success)'}">${t.type==='debit'?'+':'-'}${fmt(t.amount)}</strong> <span class="text-muted">${esc(t.note||'')}</span></div>
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
    ${leaves.length===0?'<div class="card"><p class="text-muted">Belum ada pengajuan.</p></div>':
    leaves.map(l => {
      const sc = l.status==='Disetujui'?'badge-success':l.status==='Ditolak'?'badge-danger':'badge-warning';
      return `<div class="card" style="margin-bottom:0.75rem;border-left:4px solid ${l.status==='Disetujui'?'var(--success)':l.status==='Ditolak'?'var(--danger)':'var(--warning)'}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${esc(l.leave_type)}</strong><br><span class="text-xs text-muted">${fmtDate(l.start_date)} - ${fmtDate(l.end_date)}</span><br><span class="text-xs text-muted">${esc(l.reason||'')}</span></div>
          <span class="badge ${sc}">${esc(l.status)}</span>
        </div>
        ${l.feedback?`<p class="text-xs text-muted mt-2" style="border-top:1px solid var(--border);padding-top:0.5rem">Feedback: ${esc(l.feedback)}</p>`:''}
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
    ${vios.length===0?'<div class="card" style="text-align:center;padding:2rem"><p class="text-muted">Bersih! Tidak ada pelanggaran 👍</p></div>':
    vios.map(v => {
      const lc = v.level==='SP3'?'var(--danger)':v.level==='SP2'?'var(--warning)':v.level==='SP1'?'#EAB308':'var(--info)';
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
    ${svs.length===0?'<p class="text-muted text-sm">Belum ada.</p>':
    svs.map(s => `<div style="display:flex;justify-content:space-between;padding:0.75rem 0;border-bottom:1px solid var(--border);font-size:0.85rem">
      <div><strong style="color:var(--success)">${fmt(s.amount)}</strong> <span class="text-muted">${esc(s.month||'')}</span></div>
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
    ${ratings.length===0?'<div class="card"><p class="text-muted">Belum ada penilaian.</p></div>':
    ratings.map(r => {
      const avg = r.scores ? (Object.values(r.scores).reduce((s,v)=>s+v,0)/Object.values(r.scores).length).toFixed(1) : '0';
      const color = avg >= 4.5 ? 'var(--success)' : avg >= 3.5 ? 'var(--info)' : avg >= 2.5 ? 'var(--warning)' : 'var(--danger)';
      return `<div class="card" style="margin-bottom:0.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="text-muted text-sm">Periode: ${fmtMonthYear(r.date)}</span>
          <span style="font-size:1.5rem;font-weight:800;color:${color}">${avg}/5</span>
        </div>
        ${r.note?`<p class="text-xs text-muted mt-2" style="border-top:1px solid var(--border);padding-top:0.5rem">"${esc(r.note)}"</p>`:''}
      </div>`;
    }).join('')}
  </div>`;
}

function renderEmpProfile() {
  const emp = getUserByUsername(currentUser.username);
  if (!emp) return '<div class="card"><p class="text-muted">Data tidak ditemukan.</p></div>';
  return `<div class="fade-in">
    <div class="card" style="text-align:center;padding:2rem;margin-bottom:1rem">
      <div style="width:80px;height:80px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;margin:0 auto 1rem">${(emp.name||'?')[0]}</div>
      <h2 class="text-xl font-bold">${esc(emp.name)}</h2>
      <p class="text-muted">${esc(emp.position)} • ${esc(emp.emp_id)}</p>
    </div>
    <div class="card"><h3 class="card-title mb-4">Informasi Detail</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div><p class="form-label">Username</p><p class="font-semibold text-sm">${esc(emp.username)}</p></div>
        <div><p class="form-label">Jenis Kelamin</p><p class="font-semibold text-sm">${esc(emp.gender||'-')}</p></div>
        <div><p class="form-label">Tanggal Lahir</p><p class="font-semibold text-sm">${fmtDate(emp.date_of_birth)}</p></div>
        <div><p class="form-label">No. Telepon</p><p class="font-semibold text-sm">${esc(emp.phone||'-')}</p></div>
        <div><p class="form-label">Email</p><p class="font-semibold text-sm">${esc(emp.email||'-')}</p></div>
        <div><p class="form-label">Jenis Kontrak</p><p class="font-semibold text-sm">${esc(emp.contract_type||'-')}</p></div>
        <div><p class="form-label">Kontrak Mulai</p><p class="font-semibold text-sm">${fmtDate(emp.contract_start)}</p></div>
        <div><p class="form-label">Kontrak Berakhir</p><p class="font-semibold text-sm">${fmtDate(emp.contract_end)}</p></div>
      </div>
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
      <div class="form-group"><label class="form-label">Nama Lengkap</label><input id="ef-name" class="form-input" value="${esc(emp?.name||'')}"></div>
      <div class="form-group"><label class="form-label">Jenis Kelamin</label><select id="ef-gender" class="form-input form-select"><option value="Laki-Laki" ${emp?.gender==='Laki-Laki'?'selected':''}>Laki-Laki</option><option value="Perempuan" ${emp?.gender==='Perempuan'?'selected':''}>Perempuan</option></select></div>
      <div class="form-group"><label class="form-label">Jabatan</label><select id="ef-pos" class="form-input form-select">${positions.map(p=>`<option ${emp?.position===p?'selected':''}>${p}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">PIN (6 digit)</label><div class="password-wrapper"><input id="ef-pin" type="password" inputmode="numeric" maxlength="6" class="form-input" value="${esc(emp?.pin||'')}" placeholder="••••••"><button type="button" class="password-toggle" onclick="window._togglePassword(this)">👁️</button></div></div>
      <div class="form-group"><label class="form-label">Jenis Kontrak</label><select id="ef-ctype" class="form-input form-select"><option value="Training" ${emp?.contract_type==='Training'?'selected':''}>Training (3 Bulan)</option><option value="Tetap" ${emp?.contract_type==='Tetap'?'selected':''}>Tetap (1 Tahun)</option></select></div>
      <div class="form-group"><label class="form-label">Mulai Kontrak</label><input id="ef-cstart" type="date" class="form-input" value="${emp?.contract_start||''}"></div>
      <div class="form-group"><label class="form-label">Telepon</label><input id="ef-phone" class="form-input" value="${esc(emp?.phone||'')}"></div>
      <div class="form-group"><label class="form-label">Email</label><input id="ef-email" type="email" class="form-input" value="${esc(emp?.email||'')}"></div>
      <div class="form-group"><label class="form-label">Tanggal Lahir</label><input id="ef-dob" type="date" class="form-input" value="${emp?.date_of_birth||''}"></div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:1rem">
      <button class="btn btn-primary" onclick="window._saveEmp('${key||''}')">${emp?'Perbarui':'Simpan'}</button>
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
          <p class="font-bold text-sm" style="color:${remaining<=0?'var(--danger)':'var(--success)'}">${remaining} <span class="text-xs font-normal text-muted">dari ${t.quota} hari</span></p>
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
        <div><p class="form-label">Kelamin</p><p class="font-semibold text-sm">${esc(emp.gender||'-')}</p></div>
        <div><p class="form-label">Kontrak</p><p class="font-semibold text-sm">${esc(emp.contract_type||'-')}</p></div>
        <div><p class="form-label">Berakhir</p><p class="font-semibold text-sm">${fmtDate(emp.contract_end)}</p></div>
        <div><p class="form-label">Tunggakan</p><p class="font-semibold text-sm" style="color:${bal>0?'var(--danger)':'var(--success)'}">${fmt(bal)}</p></div>
        <div><p class="form-label">Telepon</p><p class="font-semibold text-sm">${esc(emp.phone||'-')}</p></div>
      </div>
      ${leaveQuotaHtml}
      <div class="mt-4">
        <p class="form-label mb-2">Riwayat Perubahan PIN</p>
        ${pinHistHtml}
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="window._hideModal()">Tutup</button></div>`);
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

// --- TRANSACTION CRUD ---
window._showTxnForm = (empId, type) => {
  const area = $('txn-form-' + empId); if (!area) return;
  area.innerHTML = `<div style="padding:0.75rem;background:var(--bg-color);border-radius:var(--radius-lg);margin-bottom:1rem;border:1px solid var(--border)">
    <p class="text-xs font-bold mb-2" style="color:${type==='debit'?'var(--danger)':'var(--success)'}">${type==='debit'?'Tambah Debit':'Tambah Kredit'}</p>
    <input id="tf-amt" type="number" inputmode="numeric" class="form-input mb-2" placeholder="Jumlah (Rp)" style="font-size:0.85rem;padding:0.5rem">
    <input id="tf-date" type="date" value="${today()}" class="form-input mb-2" style="font-size:0.85rem;padding:0.5rem">
    <input id="tf-note" class="form-input mb-2" placeholder="Keterangan" style="font-size:0.85rem;padding:0.5rem">
    <div style="display:flex;gap:0.5rem">
      <button class="btn ${type==='debit'?'btn-danger':'btn-primary'}" style="padding:0.5rem 1rem;font-size:0.75rem;${type==='credit'?'background:var(--success)':''}" onclick="window._saveTxn('${empId}','${type}')">Simpan</button>
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

window._addLeaveNote = (key) => {
  const l = allData.leaves[key];
  if (!l) return;
  showModal(`<div class="modal-header"><h3 class="modal-title">Catatan Manajemen</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Tulis Catatan / Feedback</label>
        <textarea id="ln-note" class="form-input" rows="3" placeholder="Masukkan catatan...">${esc(l.feedback||'')}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="window._saveLeaveNote('${key}')">Simpan</button>
      <button class="btn btn-secondary" onclick="window._hideModal()">Batal</button>
    </div>`);
};

window._saveLeaveNote = async (key) => {
  const feedback = $('ln-note').value.trim();
  await update(ref(db, 'leaves/' + key), { feedback });
  showToast('Catatan disimpan!', 'success');
  hideModal();
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

// --- LEAVE TYPE CRUD ---
window._showLeaveTypeForm = (key) => {
  const lt = key ? (() => { const v = allData.leave_types[key]; return v ? { ...v, _key: key } : null; })() : null;
  const area = $('lt-form-area'); if (!area) return;
  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--primary)">
    <h3 class="card-title mb-4">${lt?'Edit':'Tambah'} Jenis Cuti</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem">
      <div class="form-group"><label class="form-label">Nama Jenis Cuti</label><input id="ltf-name" class="form-input" value="${esc(lt?.name||'')}"></div>
      <div class="form-group"><label class="form-label">Jatah (hari)</label><input id="ltf-quota" type="number" class="form-input" value="${lt?.quota||''}"></div>
      <div class="form-group"><label class="form-label">Jenis Kelamin</label><select id="ltf-gender" class="form-input form-select">
        <option value="Semua" ${lt?.gender==='Semua'?'selected':''}>Semua</option>
        <option value="Laki-Laki" ${lt?.gender==='Laki-Laki'?'selected':''}>Laki-Laki</option>
        <option value="Perempuan" ${lt?.gender==='Perempuan'?'selected':''}>Perempuan</option>
      </select></div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:0.5rem">
      <button class="btn btn-primary" onclick="window._saveLeaveType('${key||''}')">${lt?'Perbarui':'Simpan'}</button>
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
  const area = $('mass-sav-form-area'); if(!area) return;
  const users = getUsers();
  const cm = new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' });
  area.innerHTML = `<div class="card mb-4" style="background:var(--success-bg);border:1px solid var(--success)">
    <h3 class="card-title mb-4" style="color:#065F46">Input Tabungan Massal</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem">
      <div class="form-group"><label class="form-label">Jumlah (Rp)</label><input id="msf-amt" type="number" inputmode="numeric" class="form-input" placeholder="Misal: 50000"></div>
      <div class="form-group"><label class="form-label">Bulan</label><input id="msf-month" class="form-input" value="${cm}"></div>
      <div class="form-group"><label class="form-label">Tanggal</label><input id="msf-date" type="date" class="form-input" value="${today()}"></div>
    </div>
    <div class="form-group">
      <label class="form-label" style="display:flex;justify-content:space-between"><span>Pilih Karyawan</span><label style="cursor:pointer;font-weight:normal"><input type="checkbox" onchange="document.querySelectorAll('.msf-emp-cb').forEach(c=>c.checked=this.checked)"> Pilih Semua</label></label>
      <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;background:var(--bg-color)">
        ${users.map(u=>`<label style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;cursor:pointer"><input type="checkbox" class="msf-emp-cb" value="${u.emp_id}"> <strong>${esc(u.name)}</strong> (${esc(u.position)})</label>`).join('')}
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
  
  if(amt <= 0) { showToast('Jumlah harus > 0', 'error'); return; }
  if(!month || !date) { showToast('Bulan dan tanggal wajib diisi!', 'error'); return; }
  if(cbs.length === 0) { showToast('Pilih minimal 1 karyawan!', 'error'); return; }
  
  for(const cb of cbs) {
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
  const criteria = getCriteria();
  if (users.length === 0) { showToast('Tambahkan karyawan dulu!', 'warning'); return; }
  if (criteria.length === 0) { showToast('Buat kriteria penilaian dulu!', 'warning'); return; }
  showModal(`<div class="modal-header"><h3 class="modal-title">Tambah Penilaian</h3><button class="modal-close" onclick="window._hideModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Pilih Karyawan</label><select id="rf-emp" class="form-input form-select">${users.map(u=>`<option value="${u.emp_id}">${esc(u.name)} (${esc(u.position)})</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Bulan Penilaian</label><input id="rf-date" type="month" value="${today().substring(0,7)}" class="form-input"></div>
      <p class="form-label">Skor Kriteria (1-5)</p>
      ${criteria.map(c => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--border)">
        <span class="text-sm">${esc(c.name)}</span>
        <input type="number" min="1" max="5" value="3" class="form-input rf-score" data-name="${esc(c.name)}" style="width:70px;padding:0.4rem;text-align:center;font-size:0.85rem">
      </div>`).join('')}
      <div class="form-group mt-4"><label class="form-label">Catatan</label><textarea id="rf-note" class="form-input" rows="2" placeholder="Catatan tambahan..."></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="window._saveRating()">Simpan Penilaian</button><button class="btn btn-secondary" onclick="window._hideModal()">Batal</button></div>`);
};
window._saveRating = async () => {
  const empId = $('rf-emp').value;
  const date = $('rf-date').value;
  const note = $('rf-note').value.trim();
  const scores = {};
  document.querySelectorAll('.rf-score').forEach(el => { scores[el.dataset.name] = Math.min(5, Math.max(1, parseInt(el.value) || 1)); });
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
  const avg = rating.scores ? (Object.values(rating.scores).reduce((s,v)=>s+v,0)/Object.values(rating.scores).length).toFixed(1) : '0';
  
  let html = `
    <div style="text-align:center;margin-bottom:20px;border-bottom:2px solid #000;padding-bottom:10px;">
      <h2>Laporan Evaluasi Kinerja Karyawan</h2>
      <p style="font-size:1.2rem;font-weight:bold;">SPBU GONTOR</p>
    </div>
    
    <table style="width:100%;margin-bottom:20px;font-family:sans-serif;font-size:0.9rem;">
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

    <table style="width:100%;border-collapse:collapse;margin-top:10px;font-family:sans-serif;font-size:0.9rem;">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:8px;text-align:left;background:#f0f0f0;">Kriteria Penilaian</th>
          <th style="border:1px solid #000;padding:8px;text-align:center;width:100px;background:#f0f0f0;">Skor (1-5)</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  if (rating.scores) {
    Object.entries(rating.scores).forEach(([crit, score]) => {
      html += `
        <tr>
          <td style="border:1px solid #000;padding:8px;">${esc(crit)}</td>
          <td style="border:1px solid #000;padding:8px;text-align:center;">${score}</td>
        </tr>
      `;
    });
  }
  
  html += `
        <tr>
          <td style="border:1px solid #000;padding:8px;text-align:right;"><strong>Rata-Rata:</strong></td>
          <td style="border:1px solid #000;padding:8px;text-align:center;font-size:1.1rem;"><strong>${avg}</strong></td>
        </tr>
      </tbody>
    </table>
    
    <div style="margin-top:20px;font-family:sans-serif;font-size:0.9rem;">
      <strong>Catatan Evaluasi:</strong>
      <p style="border:1px solid #000;padding:10px;min-height:50px;margin-top:5px;">${esc(rating.note || 'Tidak ada catatan.')}</p>
    </div>

    <table style="width:100%;margin-top:50px;text-align:center;font-family:sans-serif;font-size:0.9rem;">
      <tr>
        <td style="width:50%;">
          <p>Karyawan,</p>
          <br><br><br><br>
          <p><strong>(${esc(empName)})</strong></p>
        </td>
        <td style="width:50%;">
          <p>Manajemen SPBU GONTOR,</p>
          <br><br><br><br>
          <p><strong>(..................................)</strong></p>
        </td>
      </tr>
    </table>
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
    margin:       10,
    filename:     filename,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
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

// --- CRITERIA CRUD ---
window._showCriteriaForm = (key) => {
  const c = key ? (() => { const v = allData.criteria[key]; return v ? { ...v, _key: key } : null; })() : null;
  const area = $('crit-form-area'); if (!area) return;
  area.innerHTML = `<div class="card mb-4 fade-in" style="border:2px solid var(--primary)">
    <h3 class="card-title mb-4">${c?'Edit':'Tambah'} Kriteria</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
      <div class="form-group"><label class="form-label">Nama Kriteria</label><input id="cf-name" class="form-input" value="${esc(c?.name||'')}"></div>
      <div class="form-group"><label class="form-label">Berlaku Untuk</label><select id="cf-pos" class="form-input form-select">
        <option value="Semua" ${c?.position==='Semua'?'selected':''}>Semua Jabatan</option>
        <option value="Manager" ${c?.position==='Manager'?'selected':''}>Manager</option>
        <option value="Admin" ${c?.position==='Admin'?'selected':''}>Admin</option>
        <option value="Supervisor" ${c?.position==='Supervisor'?'selected':''}>Supervisor</option>
        <option value="Operator" ${c?.position==='Operator'?'selected':''}>Operator</option>
        <option value="Cleaning Service" ${c?.position==='Cleaning Service'?'selected':''}>Cleaning Service</option>
      </select></div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:0.5rem">
      <button class="btn btn-primary" onclick="window._saveCriteria('${key||''}')">${c?'Perbarui':'Simpan'}</button>
      <button class="btn btn-secondary" onclick="document.getElementById('crit-form-area').innerHTML=''">Batal</button>
    </div>
  </div>`;
};
window._saveCriteria = async (key) => {
  const name = $('cf-name').value.trim();
  if (!name) { showToast('Nama wajib!', 'error'); return; }
  const data = { name, position: $('cf-pos').value };
  if (key) await update(ref(db, 'criteria/' + key), data);
  else await set(push(ref(db, 'criteria')), data);
  showToast('Kriteria disimpan!', 'success');
  $('crit-form-area').innerHTML = '';
};
window._deleteCriteria = async (key) => { if (confirm('Hapus kriteria?')) { await remove(ref(db, 'criteria/' + key)); showToast('Dihapus!', 'success'); } };

// --- CHANGE PIN (Employee) ---
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
  localStorage.setItem('mytic_emp_session', JSON.stringify(currentUser));
  showToast('PIN berhasil diubah!', 'success');
  $('cp-old').value = ''; $('cp-new').value = ''; $('cp-confirm').value = '';
};

// ==========================================
// START
// ==========================================
document.addEventListener('DOMContentLoaded', init);

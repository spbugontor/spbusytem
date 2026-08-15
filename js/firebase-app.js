import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, onValue, set, push, remove, update } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

/**
 * ---------------------------------------------------------
 * KONFIGURASI FIREBASE (USER HARUS MENGISI INI)
 * ---------------------------------------------------------
 */
const firebaseConfig = {
  // Ganti dengan konfigurasi dari Firebase Console Anda!
  apiKey: "AIzaSyBBcb3lbQJQ30BZZoBV4j5l1mTwPfsVh2o",
  authDomain: "spbu-system.firebaseapp.com",
  databaseURL: "https://spbu-system-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "spbu-system",
  storageBucket: "spbu-system.firebasestorage.app",
  messagingSenderId: "397973887906",
  appId: "1:397973887906:web:7e7a2f502db9efa3df70fb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// ─────────────────────────────────────────────
// STATE & VARIABLES
// ─────────────────────────────────────────────
let orders = [];
let settings = {};
let countdownTimer = null;
let pendingPaymentId = null;
let pendingPaymentState = true;
let pendingDeleteId = null;
let pendingDeleteName = '';
let pendingPermDeleteId = null;
let pendingPermDeleteName = '';
let isAdmin = false;
let inactivityTimer = null;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 Menit

// Format Tanggal Hari Ini (YYYY-MM-DD)
function getTodayString() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ─────────────────────────────────────────────
// INIT & FIREBASE LISTENERS
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
  initTheme();
  setupEventListeners();

  // Pastikan sesi tersimpan di browser meski tab ditutup
  setPersistence(auth, browserLocalPersistence).catch(console.error);

  // Dengarkan status Auth (Login/Logout)
  onAuthStateChanged(auth, (user) => {
    isAdmin = !!user;
    if (isAdmin) {
      document.getElementById('page-order').classList.remove('active');
      document.getElementById('page-admin').classList.add('active');
      switchAdminSection('dashboard');
      resetInactivityTimer(); // Mulai timer 30 menit
    } else {
      document.getElementById('page-admin').classList.remove('active');
      document.getElementById('page-order').classList.add('active');
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
    updateAllUI();
  });

  // REALTIME LISTENER: Pengaturan
  const settingsRef = ref(db, 'settings');
  onValue(settingsRef, (snapshot) => {
    settings = snapshot.val() || {};
    populateSettingsUI();
    updateAllUI();
    showLoader(false);
  });

  // REALTIME LISTENER: Pesanan (Hanya Pesanan Hari Ini yang kita render di user)
  const ordersRef = ref(db, 'orders');
  onValue(ordersRef, (snapshot) => {
    const data = snapshot.val();
    orders = [];
    if (data) {
      // Ubah dari object Firebase ke array
      Object.keys(data).forEach(key => {
        orders.push({
          id: key,
          ...data[key]
        });
      });
    }
    updateAllUI();
  });
}

// ─────────────────────────────────────────────
// UI RENDERERS
// ─────────────────────────────────────────────
function updateAllUI() {
  updateCountdown();
  updateFormLock();
  updateStats();
  renderOrderList();

  if (isAdmin) {
    updateDashboard();
    renderAdminList();
    renderLaporanList();
    renderSampahList();
  }
}

// -- SAMPAH (TRASH) --
function renderSampahList() {
  const container = document.getElementById('sampah-list');
  if (!container) return;

  const trashedOrders = orders.filter(o => o.is_deleted);
  
  if (trashedOrders.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">🗑️</div>' +
      '<p>Keranjang sampah kosong</p></div>';
    return;
  }

  container.innerHTML = trashedOrders.map(o => {
    return '<div class="admin-order-card" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;">' +
    '<div><div style="font-weight: 700; color: var(--text);">' + esc(o.nama) + '</div>' +
    '<div style="font-size: 12px; color: var(--text-secondary);">KK: ' + esc(o.kk) + ' | NIK: ' + esc(o.nik) + '</div></div>' +
    '<div style="display: flex; gap: 8px;">' +
    '<button class="btn btn-success-sm" onclick="onRestoreOrder(\'' + o.id + '\')">Pulihkan</button>' +
    '<button class="btn btn-danger-sm" onclick="onPermanentDeleteOrder(\'' + o.id + '\', \'' + esc(o.nama) + '\')">Hapus Permanen</button>' +
    '</div></div>';
  }).join('');
}

// -- COUNTDOWN --
function updateCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  const display = document.getElementById('countdown-display');

  if (!settings.tanggal_buka || !settings.jam_buka) {
    display.innerHTML = '<span class="countdown-waiting">Belum diatur</span>';
    return;
  }

  function tick() {
    const target = new Date(settings.tanggal_buka + 'T' + settings.jam_buka + ':00');

    if (isNaN(target.getTime())) {
      display.innerHTML = '<span class="countdown-waiting">Format waktu salah</span>';
      clearInterval(countdownTimer);
      return;
    }

    const diff = target - new Date();

    if (diff <= 0) {
      display.innerHTML = '<span class="countdown-open">BUKA</span>';
      updateFormLock();
      return;
    }

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    display.innerHTML =
      '<div class="countdown-block"><span class="countdown-number">' + pad(h) + '</span><span class="countdown-unit">Jam</span></div>' +
      '<span class="countdown-separator">:</span>' +
      '<div class="countdown-block"><span class="countdown-number">' + pad(m) + '</span><span class="countdown-unit">Menit</span></div>' +
      '<span class="countdown-separator">:</span>' +
      '<div class="countdown-block"><span class="countdown-number">' + pad(s) + '</span><span class="countdown-unit">Detik</span></div>';
  }

  tick();
  countdownTimer = setInterval(tick, 1000);
}

function pad(n) { return n < 10 ? '0' + n : String(n); }

// -- FORM LOCK & QUOTA --
function isOpen() {
  if (!settings.tanggal_buka || !settings.jam_buka) return false;
  const target = new Date(settings.tanggal_buka + 'T' + settings.jam_buka + ':00');
  return new Date() >= target;
}

// Mengambil semua data pesanan yang aktif (belum dihapus ke sampah)
function getTodayOrders() {
  return orders.filter(o => !o.is_deleted);
}

function getQuotaLeft() {
  const kuota = parseInt(settings.kuota) || 0;
  return Math.max(0, kuota - getTodayOrders().length);
}

function updateFormLock() {
  const canOrder = isOpen() && getQuotaLeft() > 0;
  const inputs = ['inp-nama', 'inp-tempat-lahir', 'inp-kk', 'inp-nik'];

  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canOrder;
  });

  const btn = document.getElementById('btn-submit');
  if (btn) btn.disabled = !canOrder;

  const stockNotice = document.getElementById('stock-empty-notice');
  if (stockNotice) {
    if (isOpen() && getQuotaLeft() <= 0) {
      stockNotice.classList.add('show');
    } else {
      stockNotice.classList.remove('show');
    }
  }
}

// -- STATS --
function updateStats() {
  const qLeft = document.getElementById('quota-remaining');
  if (qLeft) qLeft.textContent = getQuotaLeft();

  const price = document.getElementById('price-display');
  const harga = parseInt(settings.harga) || 0;
  if (price) price.textContent = harga > 0 ? 'Rp ' + harga.toLocaleString('id-ID') : '-';

  const maxNik = document.getElementById('max-nik-value');
  if (maxNik) maxNik.textContent = settings.max_per_kk || '2';
}

// -- ORDER LIST (User) --
function renderOrderList() {
  const container = document.getElementById('order-list');
  if (!container) return;

  const todayOrders = getTodayOrders();

  if (todayOrders.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">📋</div><p>Belum ada pemesanan</p></div>';
    return;
  }

  container.innerHTML = todayOrders.map(o =>
    '<div class="order-item item-enter">' +
    '<span class="order-name">' + esc(o.nama) + '</span>' +
    '<span class="badge ' + (o.sudah_bayar ? 'badge-success' : 'badge-warning') + '">' +
    (o.sudah_bayar ? '✓ Lunas' : 'Belum') +
    '</span></div>'
  ).join('');
}

// -- DASHBOARD ADMIN --
function updateDashboard() {
  const totalKuota = parseInt(settings.kuota) || 0;
  const harga = parseInt(settings.harga) || 0;
  const todayOrders = getTodayOrders();

  const paid = todayOrders.filter(o => o.sudah_bayar).length;
  const unpaid = todayOrders.length - paid;

  setText('recap-total', totalKuota);
  setText('recap-orders', todayOrders.length);
  setText('recap-remaining', Math.max(0, totalKuota - todayOrders.length));
  setText('recap-paid', paid);
  setText('recap-unpaid', unpaid);
  setText('recap-revenue', 'Rp ' + (paid * harga).toLocaleString('id-ID'));

  // Unpaid list
  const unpaidOrders = todayOrders.filter(o => !o.sudah_bayar);
  const unpaidContainer = document.getElementById('unpaid-list');
  setText('unpaid-count', unpaidOrders.length);

  if (!unpaidContainer) return;

  if (unpaidOrders.length === 0) {
    unpaidContainer.innerHTML = '<div class="empty-state"><p>✓ Semua sudah bayar</p></div>';
    return;
  }

  unpaidContainer.innerHTML = unpaidOrders.map(o =>
    '<div class="unpaid-item item-enter">' +
    '<span class="unpaid-name">' + esc(o.nama) + '</span>' +
    '<span class="badge badge-warning">Belum</span>' +
    '</div>'
  ).join('');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// -- ADMIN KELOLA LIST --
function renderAdminList() {
  const containerUnpaid = document.getElementById('admin-order-list-unpaid');
  const containerPaid = document.getElementById('admin-order-list-paid');
  if (!containerUnpaid || !containerPaid) return;

  const search = (document.getElementById('admin-search') || {}).value || '';
  const query = search.toLowerCase();

  const filtered = getTodayOrders().filter(o => 
    (o.nama || '').toLowerCase().includes(query) ||
    (o.kk || '').includes(query) ||
    (o.nik || '').includes(query)
  );

  const unpaid = filtered.filter(o => !o.sudah_bayar);
  const paid = filtered.filter(o => o.sudah_bayar);

  const sortFn = (a, b) => {
    const timeA = a.sudah_bayar ? ((a.tanggal_bayar || a.tanggal) + ' ' + (a.waktu_bayar || '00:00')) : (a.tanggal + ' ' + (a.waktu || '00:00'));
    const timeB = b.sudah_bayar ? ((b.tanggal_bayar || b.tanggal) + ' ' + (b.waktu_bayar || '00:00')) : (b.tanggal + ' ' + (b.waktu || '00:00'));
    return timeB.localeCompare(timeA);
  };

  unpaid.sort(sortFn);
  paid.sort(sortFn);

  const renderCard = (o) => {
    const parsed = parseNIK(o.nik || '');
    const gender = o.jenis_kelamin || (parsed.isValid ? parsed.gender : '');
    const age = o.umur || (parsed.isValid ? parsed.age : '');
    const badgeHtml = gender ? `<span class="nik-badge ${gender === 'Pria' ? 'nik-badge-male' : 'nik-badge-female'}">${gender === 'Pria' ? '👨 Pria' : '👩 Wanita'}${age ? `, ${age}th` : ''}</span>` : '';

    return '<div class="admin-order-card item-enter">' +
    '<div class="admin-order-header">' +
    '<span class="admin-order-name">' + esc(o.nama) + ' ' + badgeHtml + '</span>' +
    '<span class="badge ' + (o.sudah_bayar ? 'badge-success' : 'badge-warning') + '">' +
    (o.sudah_bayar ? '✓ Lunas' + (o.waktu_bayar ? ` (${o.waktu_bayar})` : '') : 'Belum') +
    '</span></div>' +
    '<div class="admin-order-details">' +
    '<span class="admin-order-detail"><strong>KK:</strong> ' + esc(o.kk) + '</span>' +
    '<span class="admin-order-detail"><strong>NIK:</strong> ' + esc(o.nik) + (o.tanggal_lahir ? ` (${o.tanggal_lahir})` : (parsed.isValid ? ` (${parsed.tglFormatted})` : '')) + '</span>' +
    '</div>' +
    '<div class="admin-order-actions">' +
    (o.sudah_bayar
      ? '<button class="btn btn-success-sm" onclick="onMarkPaid(\'' + o.id + '\')">✓ Lunas (Ubah)</button>'
      : '<button class="btn btn-warning-sm" onclick="onMarkPaid(\'' + o.id + '\')">Tandai Bayar</button>'
    ) +
    '<button class="btn btn-danger-sm" onclick="onDeleteOrder(\'' + o.id + '\', \'' + esc(o.nama) + '\')">Hapus</button>' +
    '</div></div>';
  };

  if (unpaid.length === 0) {
    containerUnpaid.innerHTML = '<div class="empty-state"><p>' + (query ? 'Tidak ditemukan' : 'Semua sudah bayar') + '</p></div>';
  } else {
    containerUnpaid.innerHTML = unpaid.map(renderCard).join('');
  }

  if (paid.length === 0) {
    containerPaid.innerHTML = '<div class="empty-state"><p>' + (query ? 'Tidak ditemukan' : 'Belum ada yang lunas') + '</p></div>';
  } else {
    containerPaid.innerHTML = paid.map(renderCard).join('');
  }
}

function renderLaporanList() {
  const container = document.getElementById('laporan-list');
  if (!container) return;

  // Menampilkan semua pesanan lunas, termasuk data lama yang belum punya tanggal_bayar
  const paidOrders = orders.filter(o => o.sudah_bayar);

  if (paidOrders.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 20px;"><div class="empty-state-icon">📊</div><p>Belum ada riwayat penjualan lunas</p></div>';
    return;
  }

  const groups = {};
  paidOrders.forEach(o => {
    // Gunakan tanggal_bayar, jika tidak ada (data lama), gunakan tanggal pesanan
    const date = o.tanggal_bayar || o.tanggal || "Data Lama";
    if (!groups[date]) groups[date] = { count: 0, revenue: 0 };
    groups[date].count++;
    groups[date].revenue += parseInt(settings.harga) || 0;
  });

  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  container.innerHTML = sortedDates.map(date => {
    const g = groups[date];
    return '<div class="admin-order-card item-enter" onclick="openLaporanDetail(\'' + date + '\')" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer;">' +
      '<div>' +
        '<div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">' + esc(date) + '</div>' +
        '<div style="font-size: 12px; color: var(--text-secondary);">' + g.count + ' Tabung Terjual</div>' +
      '</div>' +
      '<div style="font-weight: 700; color: var(--success);">' +
        'Rp ' + g.revenue.toLocaleString('id-ID') +
      '</div>' +
    '</div>';
  }).join('');
}

// -- SETTINGS POPULATE --
function populateSettingsUI() {
  const el = id => document.getElementById(id);
  if (el('set-tanggal')) el('set-tanggal').value = settings.tanggal_buka || '';
  if (el('set-jam')) el('set-jam').value = settings.jam_buka || '';
  if (el('set-kuota')) el('set-kuota').value = settings.kuota || '';
  if (el('set-harga')) el('set-harga').value = settings.harga || '';
  if (el('set-max-kk')) el('set-max-kk').value = settings.max_per_kk || '2';
}

// ─────────────────────────────────────────────
// EVENT LISTENERS & LOGIC
// ─────────────────────────────────────────────
function setupEventListeners() {
  // Reset session timer untuk admin pada setiap interaksi
  ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer);
  });

  // Help Modals
  on('btn-help-order', 'click', () => showModal('modal-help-order'));
  on('btn-help-admin', 'click', () => showModal('modal-help-admin'));
  on('btn-help-admin-mobile', 'click', () => showModal('modal-help-admin'));

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) hideModal(overlay.id); });
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) hideModal(modal.id);
    });
  });

  // Admin Login / Navigasi
  on('btn-admin', 'click', () => {
    if (isAdmin) {
      document.getElementById('page-order').classList.remove('active');
      document.getElementById('page-admin').classList.add('active');
      switchAdminSection('dashboard');
    } else {
      showModal('modal-admin-login');
      document.getElementById('inp-admin-email').value = '';
      document.getElementById('inp-admin-password').value = '';
      document.getElementById('login-error').textContent = '';
    }
  });

  on('btn-login-submit', 'click', handleAdminLogin);
  on('inp-admin-password', 'keypress', e => { if (e.key === 'Enter') handleAdminLogin(); });

  // Admin Logout
  on('btn-logout', 'click', () => {
    signOut(auth).then(() => {
      toast('Berhasil keluar', 'info');
    });
  });

  // Halaman Depan
  on('btn-home', 'click', () => {
    document.getElementById('page-admin').classList.remove('active');
    document.getElementById('page-order').classList.add('active');
  });

  // Admin Navigation
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', function () {
      switchAdminSection(this.dataset.section);
    });
  });

  // Swipe Gestures for Admin Sections (Mobile)
  let touchStartX = 0;
  let touchStartY = 0;
  const adminMain = document.querySelector('.admin-main');
  const sections = ['dashboard', 'kelola', 'laporan', 'pengaturan', 'password'];

  if (adminMain) {
    adminMain.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    adminMain.addEventListener('touchend', e => {
      const targetTag = e.target.tagName.toLowerCase();
      if (['input', 'textarea', 'select', 'button', 'a'].includes(targetTag) || e.target.closest('input, textarea, select, button, a')) {
        return;
      }
      
      const touchEndX = e.changedTouches[0].screenX;
      const touchEndY = e.changedTouches[0].screenY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;
      
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
        const activeNav = document.querySelector('.nav-item.active');
        if (!activeNav) return;
        
        const currentSection = activeNav.dataset.section;
        const currentIndex = sections.indexOf(currentSection);
        if (currentIndex === -1) return;
        
        if (diffX < 0) {
          if (currentIndex < sections.length - 1) {
            switchAdminSection(sections[currentIndex + 1]);
          }
        } else {
          if (currentIndex > 0) {
            switchAdminSection(sections[currentIndex - 1]);
          }
        }
      }
    }, { passive: true });
  }

  // Export PDF & Excel
  on('btn-export-pdf', 'click', handleExportPDF);
  on('btn-export-excel', 'click', handleExportExcel);

  // Theme Toggles
  on('btn-theme-toggle-user', 'click', toggleTheme);
  on('btn-theme-toggle-admin', 'click', toggleTheme);

  // Auto capitalize
  on('inp-nama', 'input', function () {
    const pos = this.selectionStart;
    this.value = this.value.replace(/\b\w/g, c => c.toUpperCase());
    this.setSelectionRange(pos, pos);
  });

  // Digits only & NIK Live Parser
  ['inp-kk', 'inp-nik'].forEach(id => {
    on(id, 'input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 16);
      if (id === 'inp-nik') updateNIKInfoUI();
    });
  });

  // Form Submit User
  on('order-form', 'submit', handleOrderSubmit);

  // Admin Actions
  on('btn-cancel-paid', 'click', () => { hideModal('modal-verify-payment'); pendingPaymentId = null; });
  on('btn-confirm-paid', 'click', handleConfirmPaid);
  
  on('btn-edit-order', 'click', () => {
    hideModal('modal-verify-payment');
    const o = orders.find(x => x.id === pendingPaymentId);
    if (!o) return;
    document.getElementById('edit-order-id').value = o.id;
    document.getElementById('edit-nama').value = o.nama;
    document.getElementById('edit-tempat-lahir').value = o.tempat_lahir || '';
    document.getElementById('edit-kk').value = o.kk;
    document.getElementById('edit-nik').value = o.nik;
    showModal('modal-edit-order');
  });
  on('edit-order-form', 'submit', handleEditOrderSubmit);

  on('btn-delete-yes', 'click', handleConfirmDelete);
  on('btn-delete-no', 'click', () => { hideModal('modal-delete-confirm'); pendingDeleteId = null; });
  
  on('btn-permanent-delete-yes', 'click', handlePermanentDeleteConfirm);
  on('btn-permanent-delete-no', 'click', () => { hideModal('modal-permanent-delete-confirm'); pendingPermDeleteId = null; });

  on('settings-form', 'submit', handleSaveSettings);
  on('btn-reset', 'click', () => document.getElementById('reset-confirm').classList.add('show'));
  on('btn-reset-no', 'click', () => document.getElementById('reset-confirm').classList.remove('show'));
  on('btn-reset-yes', 'click', handleResetOrders);

  on('password-form', 'submit', handleChangePassword);

  // Admin Search
  on('admin-search', 'input', renderAdminList);

  // Alert Modals Close
  on('btn-success-ok', 'click', () => hideModal('modal-success'));
  on('btn-duplicate-ok', 'click', () => hideModal('modal-duplicate'));
  on('btn-underage-ok', 'click', () => hideModal('modal-underage'));
}

function switchAdminSection(sectionId) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');

  const section = document.getElementById('section-' + sectionId);
  if (section) section.classList.add('active');

  const titles = { dashboard: 'Dashboard', kelola: 'Kelola Pesanan', laporan: 'Riwayat Penjualan', sampah: 'Keranjang Sampah', pengaturan: 'Pengaturan', password: 'Ganti Password' };
  setText('admin-page-title', titles[sectionId] || '');
}

// ─────────────────────────────────────────────
// FIREBASE OPERATIONS
// ─────────────────────────────────────────────

async function handleAdminLogin() {
  const email = document.getElementById('inp-admin-email').value;
  const password = document.getElementById('inp-admin-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login-submit');

  if (!email || !password) { errorEl.textContent = 'Lengkapi email & password'; return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span>';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    hideModal('modal-admin-login');
    toast('Login berhasil', 'success');
  } catch (error) {
    console.error(error);
    errorEl.textContent = 'Email atau password salah';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Masuk';
  }
}

async function handleOrderSubmit(e) {
  e.preventDefault();

  if (!isOpen()) { toast('Pemesanan belum dibuka', 'error'); return; }
  if (getQuotaLeft() <= 0) { toast('Kuota habis', 'error'); return; }

  const nama = document.getElementById('inp-nama').value.trim();
  const tempatLahir = document.getElementById('inp-tempat-lahir').value.trim();
  const kk = document.getElementById('inp-kk').value.trim();
  const nik = document.getElementById('inp-nik').value.trim();

  if (kk.length !== 16 || nik.length !== 16) { toast('KK dan NIK harus 16 digit', 'error'); return; }

  // Validasi Parsing NIK
  const parsedNIK = parseNIK(nik);
  if (!parsedNIK.isValid) {
    toast('NIK tidak valid: ' + parsedNIK.reason, 'error');
    return;
  }
  if (parsedNIK.age < 17) {
    showModal('modal-underage');
    return;
  }

  // Client-side Duplicate Check
  const todayOrders = getTodayOrders();
  if (todayOrders.some(o => o.nik === nik)) {
    showModal('modal-duplicate'); return;
  }
  const maxKK = parseInt(settings.max_per_kk) || 2;
  const kkCount = todayOrders.filter(o => o.kk === kk).length;
  if (kkCount >= maxKK) {
    showModal('modal-duplicate'); return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span> Memproses...';

  try {
    const newOrderRef = push(ref(db, 'orders'));
    await set(newOrderRef, {
      nama: nama,
      tempat_lahir: tempatLahir,
      kk: kk,
      nik: nik,
      jenis_kelamin: parsedNIK.gender,
      tanggal_lahir: parsedNIK.tglFormatted,
      umur: parsedNIK.age,
      jumlah: 1,
      sudah_bayar: false,
      tanggal: getTodayString(),
      waktu: new Date().toLocaleTimeString('id-ID')
    });

    document.getElementById('order-form').reset();
    document.getElementById('inp-jumlah').value = '1';
    updateNIKInfoUI();
    showModal('modal-success');
  } catch (error) {
    console.error(error);
    toast('Gagal menyimpan pesanan', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Pesan Sekarang';
  }
}

async function handleEditOrderSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('edit-order-id').value;
  const nama = document.getElementById('edit-nama').value.trim();
  const tempatLahir = document.getElementById('edit-tempat-lahir').value.trim();
  const kk = document.getElementById('edit-kk').value.trim();
  const nik = document.getElementById('edit-nik').value.trim();

  if (kk.length !== 16 || nik.length !== 16) { toast('KK dan NIK harus 16 digit', 'error'); return; }

  const parsedNIK = parseNIK(nik);
  if (!parsedNIK.isValid) {
    toast('NIK tidak valid: ' + parsedNIK.reason, 'error');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  const origText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner spinner-white"></span> Menyimpan...';
  btn.disabled = true;

  try {
    await update(ref(db, `orders/${id}`), {
      nama: nama,
      tempat_lahir: tempatLahir,
      kk: kk,
      nik: nik,
      jenis_kelamin: parsedNIK.gender,
      tanggal_lahir: parsedNIK.tglFormatted,
      umur: parsedNIK.age
    });
    hideModal('modal-edit-order');
    toast('Data berhasil diperbarui', 'success');
  } catch (error) {
    console.error(error);
    toast('Gagal memperbarui data', 'error');
  } finally {
    btn.innerHTML = origText;
    btn.disabled = false;
  }
}

async function handleConfirmPaid() {
  if (!pendingPaymentId) return;

  if (pendingPaymentState) {
    const chkKK = document.getElementById('chk-verify-kk');
    const chkMoney = document.getElementById('chk-verify-money');
    if (chkKK && !chkKK.checked) {
      toast('Mohon centang konfirmasi verifikasi fisik KK/KTP', 'warning');
      return;
    }
    if (chkMoney && !chkMoney.checked) {
      toast('Mohon centang konfirmasi penerimaan uang pembayaran', 'warning');
      return;
    }
  }

  const btn = document.getElementById('btn-confirm-paid');
  btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-white"></span>';

  try {
    const updateData = { sudah_bayar: pendingPaymentState };
    if (pendingPaymentState) {
      updateData.waktu_bayar = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      updateData.tanggal_bayar = getTodayString();
    } else {
      updateData.waktu_bayar = null;
      updateData.tanggal_bayar = null;
    }
    await update(ref(db, `orders/${pendingPaymentId}`), updateData);
    toast(pendingPaymentState ? 'Pembayaran & Verifikasi Fisik Dikonfirmasi' : 'Pembayaran dibatalkan', 'success');
    hideModal('modal-verify-payment');
  } catch (error) {
    console.error(error);
    toast('Gagal mengupdate database. Anda Admin?', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Ya, Konfirmasi Lunas';
    pendingPaymentId = null;
  }
}

async function handleConfirmDelete() {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('btn-delete-yes');
  const origText = btn.innerHTML;
  btn.innerHTML = '<div class="spinner spinner-white"></div>';
  btn.disabled = true;

  try {
    // Soft delete: set is_deleted = true
    await update(ref(db, `orders/${pendingDeleteId}`), {
      is_deleted: true,
      waktu_hapus: new Date().toISOString()
    });

    hideModal('modal-delete-confirm');
    toast('Pesanan dipindahkan ke keranjang sampah', 'success');
  } catch (e) {
    toast('Gagal menghapus: ' + e.message, 'error');
  } finally {
    btn.innerHTML = origText;
    btn.disabled = false;
    pendingDeleteId = null;
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-white"></span> Menyimpan...';

  const data = {
    tanggal_buka: document.getElementById('set-tanggal').value,
    jam_buka: document.getElementById('set-jam').value,
    kuota: parseInt(document.getElementById('set-kuota').value) || 0,
    harga: parseInt(document.getElementById('set-harga').value) || 0,
    max_per_kk: parseInt(document.getElementById('set-max-kk').value) || 2
  };

  try {
    await update(ref(db, 'settings'), data);
    toast('Pengaturan tersimpan!', 'success');
  } catch (error) {
    console.error(error);
    toast('Gagal menyimpan pengaturan', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan Pengaturan';
  }
}

async function handleResetOrders() {
  const btn = document.getElementById('btn-reset-yes');
  btn.disabled = true; btn.textContent = 'Menghapus...';

  try {
    await remove(ref(db, 'orders'));
    toast('Semua pesanan berhasil dihapus', 'success');
  } catch (error) {
    console.error(error);
    toast('Gagal menghapus data', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Ya, Hapus Semua Data';
    document.getElementById('reset-confirm').classList.remove('show');
  }
}

async function handleChangePassword(e) {
  e.preventDefault();

  // Dalam Firebase Auth, user harus sign-in ulang jika sesi sudah lama untuk ganti password.
  // Kode ini asumsi sesi masih baru. Jika error 'requires-recent-login', admin harus re-auth.

  const newPw = document.getElementById('inp-new-password').value;
  const confirmPw = document.getElementById('inp-confirm-password').value;

  if (newPw.length < 6) { toast('Firebase: Password minimal 6 karakter', 'error'); return; }
  if (newPw !== confirmPw) { toast('Konfirmasi password tidak cocok', 'error'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-white"></span>';

  const user = auth.currentUser;
  if (user) {
    try {
      await updatePassword(user, newPw);
      toast('Password berhasil diubah!', 'success');
      e.target.reset();
    } catch (error) {
      console.error(error);
      toast(error.message, 'error');
    }
  }

  btn.disabled = false; btn.textContent = 'Ubah Password';
}

// ─────────────────────────────────────────────
// EXPORT PDF FEATURE (ADVANCED)
// ─────────────────────────────────────────────
function handleExportPDF() {
  const todayOrders = getTodayOrders();
  if (todayOrders.length === 0) {
    toast('Tidak ada data untuk diunduh', 'error');
    return;
  }

  // Create a temporary element to hold the report HTML
  const element = document.createElement('div');
  
  let tableRows = todayOrders.map((o, idx) => {
    const status = o.sudah_bayar ? "Lunas" : "Belum Bayar";
    const statusStyle = o.sudah_bayar ? "background-color: #DEF7EC; color: #03543F; border: 1px solid #86EFAC;" : "background-color: #FDE8E8; color: #9B1C1C; border: 1px solid #FCA5A5;";
    
    const parsed = parseNIK(o.nik || '');
    const jk = parsed.isValid ? (parsed.gender === 'Pria' ? 'L' : 'P') : '-';
    const tglLahir = parsed.isValid ? `${String(parsed.day).padStart(2,'0')}/${String(parsed.month).padStart(2,'0')}/${parsed.year}` : '-';
    const ttl = o.tempat_lahir ? `${esc(o.tempat_lahir)}, ${tglLahir}` : tglLahir;
    
    return `
      <tr style="page-break-inside: avoid; break-inside: avoid;">
        <td style="text-align: center; border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">${idx + 1}</td>
        <td style="border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">${esc(o.nama)}</td>
        <td style="text-align: center; border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">${jk}</td>
        <td style="text-align: center; border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">${ttl}</td>
        <td style="text-align: center; font-family: monospace; border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">${esc(o.kk)}</td>
        <td style="text-align: center; font-family: monospace; border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">${esc(o.nik)}</td>
        <td style="text-align: center; border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">
          <span style="display: inline-block; padding: 3px 8px; border-radius: 9999px; font-weight: 700; font-size: 9px; ${statusStyle}">${status}</span>
        </td>
        <td style="text-align: center; border: 1px solid #D1D5DB; padding: 8px 10px; font-size: 11px;">
          <div style="display: inline-block; width: 14px; height: 14px; border: 1.5px solid #4B5563; border-radius: 3px; margin: 0 auto;"></div>
        </td>
      </tr>
    `;
  }).join('');

  element.innerHTML = `
    <div style="font-family: 'Plus Jakarta Sans', Arial, sans-serif; color: #1C1917; padding: 20px; line-height: 1.4;">
      <div style="text-align: center; margin-bottom: 20px; border-bottom: 3px double #0D9488; padding-bottom: 12px;">
        <h1 style="margin: 0; font-size: 20px; color: #0D9488; text-transform: uppercase; letter-spacing: 0.5px;">Rekap Pemesanan LPG 3 KG</h1>
        <p style="margin: 6px 0 0; color: #57534E; font-size: 12px; font-weight: 500;">Tanggal Laporan: ${getTodayString()} | Total Pemesan Hari Ini: ${todayOrders.length} Orang</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr>
            <th style="width: 30px; text-align: center; border: 1px solid #D1D5DB; padding: 8px 5px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">No</th>
            <th style="border: 1px solid #D1D5DB; padding: 8px 10px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">Nama Pemesan</th>
            <th style="width: 35px; text-align: center; border: 1px solid #D1D5DB; padding: 8px 5px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">L/P</th>
            <th style="width: 100px; text-align: center; border: 1px solid #D1D5DB; padding: 8px 5px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">Tempat, Tgl Lahir</th>
            <th style="width: 110px; text-align: center; border: 1px solid #D1D5DB; padding: 8px 5px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">Nomor KK</th>
            <th style="width: 110px; text-align: center; border: 1px solid #D1D5DB; padding: 8px 5px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">NIK KTP</th>
            <th style="width: 80px; text-align: center; border: 1px solid #D1D5DB; padding: 8px 5px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">Status</th>
            <th style="width: 45px; text-align: center; border: 1px solid #D1D5DB; padding: 8px 5px; background-color: #F3F4F6; color: #1F2937; font-weight: 700; text-transform: uppercase; font-size: 10px;">Ceklis</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <div style="margin-top: 30px; text-align: right; font-size: 10px; color: #6B7280; border-top: 1px solid #E5E7EB; padding-top: 8px;">
        Diunduh melalui Sistem Agen LPG 3 KG pada ${new Date().toLocaleString('id-ID')}
      </div>
    </div>
  `;

  const opt = {
    margin:       10,
    filename:     `Rekap_Pemesanan_LPG_${getTodayString()}.pdf`,
    image:        { type: 'jpeg', quality: 1.0 },
    html2canvas:  { scale: 4, useCORS: true, letterRendering: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak:    { mode: 'css', avoid: 'tr' }
  };

  // Generate and download PDF
  html2pdf().set(opt).from(element).save().then(() => {
    toast('PDF berhasil diunduh', 'success');
  }).catch(err => {
    console.error(err);
    toast('Gagal mengekspor PDF', 'error');
  });
}

function handleExportExcel() {
  const todayOrders = getTodayOrders();
  if (todayOrders.length === 0) {
    toast('Tidak ada data untuk diunduh', 'error');
    return;
  }

  const namaBulan = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  if (typeof XLSX !== 'undefined') {
    const data = [
      ['No', 'Nama Pemesan', 'L/P', 'Tempat, Tgl Lahir', 'Nomor KK', 'NIK KTP', 'Status']
    ];

    todayOrders.forEach((o, idx) => {
      const status = o.sudah_bayar ? "Lunas" : "Belum Bayar";
      const parsed = parseNIK(o.nik || '');
      const jk = parsed.isValid ? (parsed.gender === 'Pria' ? 'L' : 'P') : '-';
      const tglLahir = parsed.isValid 
        ? `${String(parsed.day).padStart(2, '0')} ${namaBulan[parsed.month - 1]} ${parsed.year}` 
        : (o.tanggal_lahir || '-');
      const ttl = o.tempat_lahir ? `${o.tempat_lahir}, ${tglLahir}` : tglLahir;

      data.push([
        idx + 1,
        o.nama || '',
        jk,
        ttl,
        String(o.kk || ''),
        String(o.nik || ''),
        status
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Atur lebar kolom otomatis rapi
    ws['!cols'] = [
      { wch: 6 },   // No
      { wch: 28 },  // Nama Pemesan
      { wch: 6 },   // L/P
      { wch: 28 },  // Tempat, Tgl Lahir
      { wch: 22 },  // Nomor KK
      { wch: 22 },  // NIK KTP
      { wch: 14 }   // Status
    ];

    // Format sel teks murni agar tidak terpotong atau terkonversi angka
    for (let r = 1; r < data.length; r++) {
      ['B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
        const cellRef = col + (r + 1);
        if (ws[cellRef]) {
          ws[cellRef].t = 's';
          ws[cellRef].z = '@';
        }
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Pemesanan");

    XLSX.writeFile(wb, `Rekap_Pemesanan_LPG_${getTodayString()}.xlsx`);
    toast('Excel (.xlsx) berhasil diunduh', 'success');
    return;
  }

  // Fallback jika library belum termuat
  let csvContent = "No;Nama Pemesan;L/P;Tempat, Tgl Lahir;Nomor KK;NIK KTP;Status\r\n";
  todayOrders.forEach((o, idx) => {
    const status = o.sudah_bayar ? "Lunas" : "Belum Bayar";
    const parsed = parseNIK(o.nik || '');
    const jk = parsed.isValid ? (parsed.gender === 'Pria' ? 'L' : 'P') : '-';
    const tglLahir = parsed.isValid 
      ? `${String(parsed.day).padStart(2, '0')} ${namaBulan[parsed.month - 1]} ${parsed.year}` 
      : (o.tanggal_lahir || '-');
    const ttl = o.tempat_lahir ? `${o.tempat_lahir}, ${tglLahir}` : tglLahir;
    csvContent += `${idx + 1};"${(o.nama||'').replace(/"/g, '""')}";${jk};"${ttl.replace(/"/g, '""')}";'${o.kk||''}';'${o.nik||''}';${status}\r\n`;
  });
  const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Rekap_Pemesanan_LPG_${getTodayString()}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast('File CSV berhasil diunduh', 'success');
}

// ─────────────────────────────────────────────
// THEME MANAGEMENT
// ─────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const isDark = savedTheme === 'dark';
  if (isDark) {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
  updateThemeToggleIcons(isDark);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeToggleIcons(isDark);
  toast(`Tema ${isDark ? 'Gelap' : 'Terang'} aktif`, 'info');
}

function updateThemeToggleIcons(isDark) {
  const sunIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  `;
  const moonIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  `;

  const userBtn = document.getElementById('btn-theme-toggle-user');
  const adminBtn = document.getElementById('btn-theme-toggle-admin');

  if (userBtn) userBtn.innerHTML = isDark ? sunIcon : moonIcon;
  if (adminBtn) adminBtn.innerHTML = isDark ? sunIcon : moonIcon;
}

// ─────────────────────────────────────────────
// UTILITIES & GLOBAL EXPORTS
// ─────────────────────────────────────────────
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

function showModal(id) { const el = document.getElementById(id); if (el) el.classList.add('show'); }
function hideModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('show'); }

function showLoader(show) {
  const loader = document.getElementById('page-loader');
  const content = document.getElementById('page-content');
  if (loader) loader.style.display = show ? 'flex' : 'none';
  if (content) content.style.display = show ? 'none' : 'block';
}

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠️' };
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${esc(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-hide');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// Timer ketidakaktifan (Auto logout 30 menit)
function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (isAdmin) {
    inactivityTimer = setTimeout(() => {
      signOut(auth).then(() => {
        toast('Sesi berakhir karena tidak ada aktivitas selama 30 menit', 'warning');
      });
    }, SESSION_TIMEOUT_MS);
  }
}

// Global functions for inline onclick in HTML string renders
window.onMarkPaid = (id) => {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  pendingPaymentId = id;
  pendingPaymentState = !o.sudah_bayar;

  const title = document.querySelector('#modal-verify-payment .modal-title');
  const alertBox = document.querySelector('#modal-verify-payment .modal-alert');
  const confirmBtn = document.getElementById('btn-confirm-paid');

  if (pendingPaymentState) {
    if (title) title.textContent = 'Verifikasi Pembayaran';
    if (alertBox) {
      alertBox.className = 'modal-alert modal-alert-info';
      alertBox.textContent = 'Pastikan pemesan telah membayar dan menunjukkan bukti foto/fotokopi KK sebelum melanjutkan.';
    }
    if (confirmBtn) confirmBtn.textContent = 'Ya, Konfirmasi Lunas';
  } else {
    if (title) title.textContent = 'Batalkan Pembayaran';
    if (alertBox) {
      alertBox.className = 'modal-alert modal-alert-error';
      alertBox.textContent = 'Apakah Anda yakin ingin membatalkan status lunas dan mengubahnya kembali menjadi belum bayar?';
    }
    if (confirmBtn) confirmBtn.textContent = 'Ya, Batalkan Lunas';
  }

  setText('verify-nama', o.nama);
  setText('verify-kk', o.kk);
  setText('verify-nik', o.nik);

  const parsed = parseNIK(o.nik || '');
  const tglLahir = parsed.isValid ? `${String(parsed.day).padStart(2,'0')}/${String(parsed.month).padStart(2,'0')}/${parsed.year}` : '-';
  const ttl = o.tempat_lahir ? `${esc(o.tempat_lahir)}, ${tglLahir}` : tglLahir;
  setText('verify-ttl', ttl);

  showModal('modal-verify-payment');
};

window.onDeleteOrder = (id, nama) => {
  pendingDeleteId = id;
  setText('delete-confirm-name', nama);
  showModal('modal-delete-confirm');
};

window.onRestoreOrder = async (id) => {
  try {
    await update(ref(db, `orders/${id}`), { is_deleted: null, waktu_hapus: null });
    toast('Pesanan berhasil dipulihkan', 'success');
  } catch (e) {
    toast('Gagal memulihkan: ' + e.message, 'error');
  }
};

window.onPermanentDeleteOrder = (id, nama) => {
  pendingPermDeleteId = id;
  setText('permanent-delete-confirm-name', nama);
  showModal('modal-permanent-delete-confirm');
};

async function handlePermanentDeleteConfirm() {
  if (!pendingPermDeleteId) return;
  const btn = document.getElementById('btn-permanent-delete-yes');
  const origText = btn.innerHTML;
  btn.innerHTML = '<div class="spinner spinner-white"></div>';
  btn.disabled = true;

  try {
    await remove(ref(db, `orders/${pendingPermDeleteId}`));
    hideModal('modal-permanent-delete-confirm');
    toast('Pesanan berhasil dihapus permanen', 'success');
  } catch (e) {
    toast('Gagal menghapus: ' + e.message, 'error');
  } finally {
    btn.innerHTML = origText;
    btn.disabled = false;
    pendingPermDeleteId = null;
  }
}

window.openLaporanDetail = (date) => {
  const paidOrders = orders.filter(o => o.sudah_bayar && (o.tanggal_bayar || o.tanggal || "Data Lama") === date);
  const body = document.getElementById('modal-laporan-body');
  document.getElementById('modal-laporan-title').textContent = 'Rincian Penjualan ' + date;
  
  if (paidOrders.length === 0) {
    body.innerHTML = '<div class="empty-state">Data tidak ditemukan</div>';
  } else {
    paidOrders.sort((a, b) => {
      const timeA = (a.tanggal_bayar || a.tanggal) + ' ' + (a.waktu_bayar || '00:00');
      const timeB = (b.tanggal_bayar || b.tanggal) + ' ' + (b.waktu_bayar || '00:00');
      return timeB.localeCompare(timeA);
    });

    body.innerHTML = paidOrders.map((o, idx) => `
      <div style="border-bottom: 1px solid var(--border-light); padding: 12px 0;">
        <div style="font-weight: 600; font-size: 14px; color: var(--text); display: flex; justify-content: space-between;">
          <span>${idx + 1}. ${esc(o.nama)}</span>
          <span style="font-size: 12px; font-weight: 700; color: var(--success);">${o.waktu_bayar ? '✓ ' + esc(o.waktu_bayar) : '✓ Lunas'}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
          ${o.tempat_lahir ? esc(o.tempat_lahir) + ' | ' : ''}KK: ${esc(o.kk)} | NIK: ${esc(o.nik)}
        </div>
      </div>
    `).join('');
  }
  
  showModal('modal-laporan-detail');
};

// ─────────────────────────────────────────────
// NIK PARSER & LIVE UI
// ─────────────────────────────────────────────
function parseNIK(nik) {
  if (!nik || typeof nik !== 'string') return { isValid: false, reason: 'NIK kosong' };
  const clean = nik.replace(/\D/g, '');
  if (clean.length !== 16) return { isValid: false, reason: 'NIK harus 16 digit' };

  let rawDay = parseInt(clean.substring(6, 8), 10);
  let month = parseInt(clean.substring(8, 10), 10);
  let yearTwo = parseInt(clean.substring(10, 12), 10);

  let gender = 'Pria';
  let day = rawDay;
  if (rawDay > 40) {
    gender = 'Wanita';
    day = rawDay - 40;
  }

  if (month < 1 || month > 12) {
    return { isValid: false, reason: 'Bulan lahir di NIK tidak valid' };
  }

  const now = new Date();
  const currentTwoDigitYear = now.getFullYear() % 100;
  const fullYear = (yearTwo > currentTwoDigitYear) ? (1900 + yearTwo) : (2000 + yearTwo);

  const daysInMonth = new Date(fullYear, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return { isValid: false, reason: `Tanggal lahir (${day}/${month}/${fullYear}) tidak valid` };
  }

  const birthDate = new Date(fullYear, month - 1, day);
  if (isNaN(birthDate.getTime())) {
    return { isValid: false, reason: 'Tanggal lahir tidak valid' };
  }

  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age--;
  }

  const namaBulan = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const tglFormatted = `${day} ${namaBulan[month - 1]} ${fullYear}`;

  return {
    isValid: true,
    day,
    month,
    year: fullYear,
    gender,
    age,
    tglFormatted,
    birthDate
  };
}

function updateNIKInfoUI() {
  const infoBox = document.getElementById('nik-info-box');
  if (infoBox) {
    infoBox.style.display = 'none';
    infoBox.innerHTML = '';
  }
}

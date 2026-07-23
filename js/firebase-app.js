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
let pendingDeleteId = null;
let pendingDeleteName = '';
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
  }
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

// Mengambil semua data pesanan yang aktif (belum di-reset oleh admin)
// Ini memperbaiki masalah data yang hilang pada pergantian hari
function getTodayOrders() {
  return orders;
}

function getQuotaLeft() {
  const kuota = parseInt(settings.kuota) || 0;
  return Math.max(0, kuota - getTodayOrders().length);
}

function updateFormLock() {
  const canOrder = isOpen() && getQuotaLeft() > 0;
  const inputs = ['inp-nama', 'inp-kk', 'inp-nik'];

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
  const container = document.getElementById('admin-order-list');
  if (!container) return;

  const search = (document.getElementById('admin-search') || {}).value || '';
  const query = search.toLowerCase();

  const filtered = getTodayOrders().filter(o => 
    (o.nama || '').toLowerCase().includes(query) ||
    (o.kk || '').includes(query) ||
    (o.nik || '').includes(query)
  );

  if (filtered.length === 0) {
    container.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">🔍</div>' +
      '<p>' + (query ? 'Tidak ditemukan' : 'Belum ada data pesanan hari ini') + '</p></div>';
    return;
  }

  container.innerHTML = filtered.map(o =>
    '<div class="admin-order-card item-enter">' +
    '<div class="admin-order-header">' +
    '<span class="admin-order-name">' + esc(o.nama) + '</span>' +
    '<span class="badge ' + (o.sudah_bayar ? 'badge-success' : 'badge-warning') + '">' +
    (o.sudah_bayar ? '✓ Lunas' : 'Belum') +
    '</span></div>' +
    '<div class="admin-order-details">' +
    '<span class="admin-order-detail"><strong>KK:</strong> ' + esc(o.kk) + '</span>' +
    '<span class="admin-order-detail"><strong>NIK:</strong> ' + esc(o.nik) + '</span>' +
    '</div>' +
    '<div class="admin-order-actions">' +
    (o.sudah_bayar
      ? '<button class="btn btn-success-sm" disabled>✓ Lunas</button>'
      : '<button class="btn btn-warning-sm" onclick="onMarkPaid(\'' + o.id + '\', \'' + esc(o.nama) + '\', \'' + esc(o.kk) + '\', \'' + esc(o.nik) + '\')">Tandai Bayar</button>'
    ) +
    '<button class="btn btn-danger-sm" onclick="onDeleteOrder(\'' + o.id + '\', \'' + esc(o.nama) + '\')">Hapus</button>' +
    '</div></div>'
  ).join('');
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

  // Export PDF
  on('btn-export-pdf', 'click', handleExportPDF);

  // Theme Toggles
  on('btn-theme-toggle-user', 'click', toggleTheme);
  on('btn-theme-toggle-admin', 'click', toggleTheme);

  // Auto capitalize
  on('inp-nama', 'input', function () {
    const pos = this.selectionStart;
    this.value = this.value.replace(/\b\w/g, c => c.toUpperCase());
    this.setSelectionRange(pos, pos);
  });

  // Digits only
  ['inp-kk', 'inp-nik'].forEach(id => {
    on(id, 'input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 16); });
  });

  // Form Submit User
  on('order-form', 'submit', handleOrderSubmit);

  // Admin Actions
  on('btn-confirm-paid', 'click', handleConfirmPayment);
  on('btn-cancel-paid', 'click', () => { hideModal('modal-verify-payment'); pendingPaymentId = null; });
  on('btn-delete-yes', 'click', handleConfirmDelete);
  on('btn-delete-no', 'click', () => { hideModal('modal-delete-confirm'); pendingDeleteId = null; });

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
}

function switchAdminSection(sectionId) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));

  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');

  const section = document.getElementById('section-' + sectionId);
  if (section) section.classList.add('active');

  const titles = { dashboard: 'Dashboard', kelola: 'Kelola Pesanan', pengaturan: 'Pengaturan', password: 'Ganti Password' };
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
  const kk = document.getElementById('inp-kk').value.trim();
  const nik = document.getElementById('inp-nik').value.trim();

  if (kk.length !== 16 || nik.length !== 16) { toast('KK dan NIK harus 16 digit', 'error'); return; }

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
      kk: kk,
      nik: nik,
      jumlah: 1,
      sudah_bayar: false,
      tanggal: getTodayString(),
      waktu: new Date().toLocaleTimeString('id-ID')
    });

    document.getElementById('order-form').reset();
    document.getElementById('inp-jumlah').value = '1';
    showModal('modal-success');
  } catch (error) {
    console.error(error);
    toast('Gagal menyimpan pesanan', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Pesan Sekarang';
  }
}

async function handleConfirmPayment() {
  if (!pendingPaymentId) return;
  const btn = document.getElementById('btn-confirm-paid');
  btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-white"></span>';

  try {
    await update(ref(db, `orders/${pendingPaymentId}`), { sudah_bayar: true });
    toast('Pembayaran dikonfirmasi', 'success');
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
  btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-white"></span>';

  try {
    await remove(ref(db, `orders/${pendingDeleteId}`));
    toast('Pesanan dihapus', 'success');
    hideModal('modal-delete-confirm');
  } catch (error) {
    console.error(error);
    toast('Gagal menghapus', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Ya, Hapus';
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
    toast('Tidak ada data untuk dicetak', 'error');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast('Gagal membuka jendela cetak. Pastikan pop-up diperbolehkan.', 'error');
    return;
  }

  let tableRows = todayOrders.map((o, idx) => {
    const status = o.sudah_bayar ? "Lunas" : "Belum Bayar";
    const statusClass = o.sudah_bayar ? "status-paid" : "status-unpaid";
    return `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td>${esc(o.nama)}</td>
        <td style="text-align: center; font-family: monospace;">${esc(o.kk)}</td>
        <td style="text-align: center; font-family: monospace;">${esc(o.nik)}</td>
        <td style="text-align: center;"><span class="badge ${statusClass}">${status}</span></td>
        <td style="text-align: center;"><div class="check-box"></div></td>
      </tr>
    `;
  }).join('');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <title>Rekap Pemesanan LPG 3 KG - ${getTodayString()}</title>
      <style>
        body {
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, Arial, sans-serif;
          color: #1C1917;
          margin: 30px;
          line-height: 1.4;
        }
        .header {
          text-align: center;
          margin-bottom: 25px;
          border-bottom: 3px double #0D9488;
          padding-bottom: 15px;
        }
        .header h1 {
          margin: 0;
          font-size: 22px;
          color: #0D9488;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .header p {
          margin: 6px 0 0;
          color: #57534E;
          font-size: 13px;
          font-weight: 500;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        th, td {
          border: 1px solid #D1D5DB;
          padding: 8px 10px;
          font-size: 12px;
          text-align: left;
        }
        th {
          background-color: #F3F4F6;
          color: #1F2937;
          font-weight: 700;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.3px;
        }
        tr:nth-child(even) {
          background-color: #F9FAFB;
        }
        .badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 9999px;
          font-size: 10px;
          font-weight: 700;
        }
        .status-paid {
          background-color: #DEF7EC;
          color: #03543F;
          border: 1px solid #86EFAC;
        }
        .status-unpaid {
          background-color: #FDE8E8;
          color: #9B1C1C;
          border: 1px solid #FCA5A5;
        }
        .check-box {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 1.5px solid #4B5563;
          border-radius: 4px;
          margin: 0 auto;
        }
        .footer {
          margin-top: 40px;
          text-align: right;
          font-size: 11px;
          color: #6B7280;
          border-top: 1px solid #E5E7EB;
          padding-top: 10px;
        }
        @media print {
          body { margin: 10px; }
          tr { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Rekap Pemesanan LPG 3 KG</h1>
        <p>Tanggal Laporan: ${getTodayString()} | Total Pemesan Hari Ini: ${todayOrders.length} Orang</p>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 40px; text-align: center;">No</th>
            <th>Nama Pemesan</th>
            <th style="width: 140px; text-align: center;">Nomor KK</th>
            <th style="width: 140px; text-align: center;">NIK KTP</th>
            <th style="width: 110px; text-align: center;">Status Bayar</th>
            <th style="width: 70px; text-align: center;">Ceklis</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <div class="footer">
        Dicetak melalui Sistem Agen LPG 3 KG pada ${new Date().toLocaleString('id-ID')}
      </div>
      <script>
        window.onload = function() {
          window.print();
          setTimeout(function() { window.close(); }, 500);
        };
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
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
window.onMarkPaid = (id, nama, kk, nik) => {
  pendingPaymentId = id;
  setText('verify-nama', nama);
  setText('verify-kk', kk);
  setText('verify-nik', nik);
  showModal('modal-verify-payment');
};

window.onDeleteOrder = (id, nama) => {
  pendingDeleteId = id;
  setText('delete-confirm-name', nama);
  showModal('modal-delete-confirm');
};

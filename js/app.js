/**
 * APP.JS — Logic utama Pemesanan LPG 3 KG
 * Mengelola UI, event handlers, rendering, dan komunikasi API
 */

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let orders = [];
let settings = {};
let countdownTimer = null;
let refreshTimer = null;
let pendingPaymentId = null;
let pendingDeleteId = null;
let pendingDeleteName = '';
let isAdmin = false;

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupEventListeners();
  showLoader(true);
  await loadData();
  showLoader(false);
  startAutoRefresh();
}

async function loadData() {
  const [ordersRes, settingsRes] = await Promise.all([
    API.getOrders(),
    API.getSettings()
  ]);

  if (ordersRes.success) orders = ordersRes.orders;
  if (settingsRes.success) settings = settingsRes.settings;

  updateAll();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    const [ordersRes, settingsRes] = await Promise.all([
      API.getOrders(),
      API.getSettings()
    ]);
    if (ordersRes.success) orders = ordersRes.orders;
    if (settingsRes.success) settings = settingsRes.settings;
    updateAll();
  }, CONFIG.REFRESH_INTERVAL);
}

// ─────────────────────────────────────────────
// UPDATE ALL UI
// ─────────────────────────────────────────────
function updateAll() {
  updateCountdown();
  updateFormLock();
  updateStats();
  renderOrderList();
  if (isAdmin) {
    renderAdminList();
    updateDashboard();
    populateSettings();
  }
}

// ─────────────────────────────────────────────
// COUNTDOWN
// ─────────────────────────────────────────────
function updateCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);

  const display = document.getElementById('countdown-display');
  const tanggal = settings.tanggal_buka;
  const jam = settings.jam_buka;

  if (!tanggal || !jam) {
    display.innerHTML = '<span class="countdown-waiting">Belum diatur</span>';
    return;
  }

  function tick() {
    const target = new Date(tanggal + 'T' + jam + ':00');
    
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

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

// ─────────────────────────────────────────────
// FORM LOCK / UNLOCK
// ─────────────────────────────────────────────
function isOpen() {
  if (!settings.tanggal_buka || !settings.jam_buka) return false;
  const target = new Date(settings.tanggal_buka + 'T' + settings.jam_buka + ':00');
  return new Date() >= target;
}

function getQuotaLeft() {
  const kuota = parseInt(settings.kuota) || 0;
  return Math.max(0, kuota - orders.length);
}

function updateFormLock() {
  const canOrder = isOpen() && getQuotaLeft() > 0;
  const inputs = ['inp-nama', 'inp-kk', 'inp-nik'];

  inputs.forEach(id => {
    document.getElementById(id).disabled = !canOrder;
  });
  document.getElementById('btn-submit').disabled = !canOrder;

  const stockNotice = document.getElementById('stock-empty-notice');
  if (isOpen() && getQuotaLeft() <= 0) {
    stockNotice.classList.add('show');
  } else {
    stockNotice.classList.remove('show');
  }
}

// ─────────────────────────────────────────────
// STATS (User Page)
// ─────────────────────────────────────────────
function updateStats() {
  document.getElementById('quota-remaining').textContent = getQuotaLeft();

  const harga = parseInt(settings.harga) || 0;
  document.getElementById('price-display').textContent =
    harga > 0 ? 'Rp ' + harga.toLocaleString('id-ID') : '-';

  document.getElementById('max-nik-value').textContent =
    settings.max_per_kk || '2';
}

// ─────────────────────────────────────────────
// RENDER ORDER LIST (User Page)
// ─────────────────────────────────────────────
function renderOrderList() {
  const container = document.getElementById('order-list');

  if (orders.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
      '<div class="empty-state-icon">📋</div>' +
      '<p>Belum ada pemesanan</p>' +
      '</div>';
    return;
  }

  container.innerHTML = orders.map(o =>
    '<div class="order-item item-enter">' +
    '<span class="order-name">' + esc(o.nama) + '</span>' +
    '<span class="badge ' + (o.sudah_bayar ? 'badge-success' : 'badge-warning') + '">' +
    (o.sudah_bayar ? '✓ Lunas' : 'Belum') +
    '</span>' +
    '</div>'
  ).join('');
}

// ─────────────────────────────────────────────
// ADMIN — DASHBOARD
// ─────────────────────────────────────────────
function updateDashboard() {
  const totalKuota = parseInt(settings.kuota) || 0;
  const harga = parseInt(settings.harga) || 0;
  const paid = orders.filter(o => o.sudah_bayar).length;
  const unpaid = orders.length - paid;

  document.getElementById('recap-total').textContent = totalKuota;
  document.getElementById('recap-orders').textContent = orders.length;
  document.getElementById('recap-remaining').textContent = Math.max(0, totalKuota - orders.length);
  document.getElementById('recap-paid').textContent = paid;
  document.getElementById('recap-unpaid').textContent = unpaid;
  document.getElementById('recap-revenue').textContent = 'Rp ' + (paid * harga).toLocaleString('id-ID');

  // List belum bayar
  const unpaidOrders = orders.filter(o => !o.sudah_bayar);
  const unpaidContainer = document.getElementById('unpaid-list');
  const unpaidCount = document.getElementById('unpaid-count');

  if (unpaidCount) unpaidCount.textContent = unpaidOrders.length;

  if (unpaidOrders.length === 0) {
    unpaidContainer.innerHTML =
      '<div class="empty-state"><p>✓ Semua sudah bayar</p></div>';
    return;
  }

  unpaidContainer.innerHTML = unpaidOrders.map(o =>
    '<div class="unpaid-item item-enter">' +
    '<span class="unpaid-name">' + esc(o.nama) + '</span>' +
    '<span class="badge badge-warning">Belum</span>' +
    '</div>'
  ).join('');
}

// ─────────────────────────────────────────────
// ADMIN — ORDER LIST (Kelola)
// ─────────────────────────────────────────────
function renderAdminList() {
  const container = document.getElementById('admin-order-list');
  const search = (document.getElementById('admin-search') || {}).value || '';
  const query = search.toLowerCase();

  const filtered = orders.filter(o =>
    (o.nama || '').toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    container.innerHTML =
      '<div class="empty-state">' +
      '<div class="empty-state-icon">🔍</div>' +
      '<p>' + (query ? 'Tidak ditemukan' : 'Belum ada data pesanan') + '</p>' +
      '</div>';
    return;
  }

  container.innerHTML = filtered.map(o =>
    '<div class="admin-order-card item-enter">' +
    '<div class="admin-order-header">' +
    '<span class="admin-order-name">' + esc(o.nama) + '</span>' +
    '<span class="badge ' + (o.sudah_bayar ? 'badge-success' : 'badge-warning') + '">' +
    (o.sudah_bayar ? '✓ Lunas' : 'Belum') +
    '</span>' +
    '</div>' +
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
    '</div>' +
    '</div>'
  ).join('');
}

// ─────────────────────────────────────────────
// ADMIN — SETTINGS
// ─────────────────────────────────────────────
function populateSettings() {
  const el = id => document.getElementById(id);
  if (el('set-tanggal')) el('set-tanggal').value = settings.tanggal_buka || '';
  if (el('set-jam')) el('set-jam').value = settings.jam_buka || '';
  if (el('set-kuota')) el('set-kuota').value = settings.kuota || '';
  if (el('set-harga')) el('set-harga').value = settings.harga || '';
  if (el('set-max-kk')) el('set-max-kk').value = settings.max_per_kk || '2';
}

// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────
function setupEventListeners() {
  // ── Help Modals ──
  on('btn-help-order', 'click', () => showModal('modal-help-order'));
  on('btn-help-admin', 'click', () => showModal('modal-help-admin'));
  on('btn-help-admin-mobile', 'click', () => showModal('modal-help-admin'));

  // ── Close modals on overlay click ──
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) hideModal(overlay.id);
    });
  });

  // ── Close modal buttons ──
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) hideModal(modal.id);
    });
  });

  // ── Admin Login ──
  on('btn-admin', 'click', () => {
    showModal('modal-admin-login');
    const inp = document.getElementById('inp-admin-password');
    inp.value = '';
    document.getElementById('login-error').textContent = '';
    setTimeout(() => inp.focus(), 200);
  });

  on('btn-login-submit', 'click', handleAdminLogin);
  document.getElementById('inp-admin-password').addEventListener('keypress', e => {
    if (e.key === 'Enter') handleAdminLogin();
  });

  // ── Back to Order Page ──
  on('btn-back', 'click', () => {
    isAdmin = false;
    document.getElementById('page-admin').classList.remove('active');
    document.getElementById('page-order').classList.add('active');
  });

  // ── Sidebar Navigation ──
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', function () {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      this.classList.add('active');
      const section = document.getElementById('section-' + this.dataset.section);
      if (section) section.classList.add('active');

      // Update title
      const titles = {
        dashboard: 'Dashboard',
        kelola: 'Kelola Pesanan',
        pengaturan: 'Pengaturan',
        password: 'Ganti Password'
      };
      document.getElementById('admin-page-title').textContent = titles[this.dataset.section] || '';
    });
  });

  // ── Form: Auto capitalize nama ──
  document.getElementById('inp-nama').addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.replace(/\b\w/g, c => c.toUpperCase());
    this.setSelectionRange(pos, pos);
  });

  // ── Form: Digits only for KK & NIK ──
  ['inp-kk', 'inp-nik'].forEach(id => {
    document.getElementById(id).addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 16);
    });
  });

  // ── Form Submit (Pesan) ──
  document.getElementById('order-form').addEventListener('submit', handleOrderSubmit);

  // ── Verify Payment Confirm ──
  on('btn-confirm-paid', 'click', handleConfirmPayment);
  on('btn-cancel-paid', 'click', () => {
    hideModal('modal-verify-payment');
    pendingPaymentId = null;
  });

  // ── Delete Confirm ──
  on('btn-delete-yes', 'click', handleConfirmDelete);
  on('btn-delete-no', 'click', () => {
    hideModal('modal-delete-confirm');
    pendingDeleteId = null;
  });

  // ── Settings Submit ──
  document.getElementById('settings-form').addEventListener('submit', handleSaveSettings);

  // ── Reset Orders ──
  on('btn-reset', 'click', () => {
    document.getElementById('reset-confirm').classList.add('show');
  });
  on('btn-reset-no', 'click', () => {
    document.getElementById('reset-confirm').classList.remove('show');
  });
  on('btn-reset-yes', 'click', handleResetOrders);

  // ── Password Change ──
  document.getElementById('password-form').addEventListener('submit', handleChangePassword);

  // ── Admin Search ──
  const searchInput = document.getElementById('admin-search');
  if (searchInput) {
    searchInput.addEventListener('input', renderAdminList);
  }

  // ── Success modal close ──
  on('btn-success-ok', 'click', () => hideModal('modal-success'));

  // ── Duplicate modal close ──
  on('btn-duplicate-ok', 'click', () => hideModal('modal-duplicate'));
}

// ─────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────

async function handleAdminLogin() {
  const password = document.getElementById('inp-admin-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login-submit');

  if (!password) {
    errorEl.textContent = 'Masukkan password';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span>';

  const result = await API.login(password);

  btn.disabled = false;
  btn.textContent = 'Masuk';

  if (result.success) {
    hideModal('modal-admin-login');
    isAdmin = true;
    document.getElementById('page-order').classList.remove('active');
    document.getElementById('page-admin').classList.add('active');

    // Reset ke dashboard
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    document.querySelector('.nav-item[data-section="dashboard"]').classList.add('active');
    document.getElementById('section-dashboard').classList.add('active');
    document.getElementById('admin-page-title').textContent = 'Dashboard';

    await loadData();
    populateSettings();
  } else {
    errorEl.textContent = result.error || 'Password salah';
  }
}

async function handleOrderSubmit(e) {
  e.preventDefault();

  if (!isOpen()) { toast('Pemesanan belum dibuka', 'error'); return; }
  if (getQuotaLeft() <= 0) { toast('Kuota habis', 'error'); return; }

  const nama = document.getElementById('inp-nama').value.trim();
  const kk = document.getElementById('inp-kk').value.trim();
  const nik = document.getElementById('inp-nik').value.trim();

  if (!nama || !kk || !nik) { toast('Lengkapi semua data', 'error'); return; }
  if (kk.length !== 16) { toast('No KK harus 16 digit', 'error'); return; }
  if (nik.length !== 16) { toast('NIK harus 16 digit', 'error'); return; }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span> Memproses...';

  const result = await API.addOrder(nama, kk, nik);

  btn.disabled = false;
  btn.innerHTML = 'Pesan Sekarang';

  if (result.success) {
    document.getElementById('order-form').reset();
    document.getElementById('inp-jumlah').value = '1';
    showModal('modal-success');
    await loadData();
  } else if (result.duplicate) {
    showModal('modal-duplicate');
  } else {
    toast(result.error || 'Gagal memesan', 'error');
  }
}

function onMarkPaid(id, nama, kk, nik) {
  pendingPaymentId = id;
  document.getElementById('verify-nama').textContent = nama;
  document.getElementById('verify-kk').textContent = kk;
  document.getElementById('verify-nik').textContent = nik;
  showModal('modal-verify-payment');
}

async function handleConfirmPayment() {
  if (!pendingPaymentId) return;

  const btn = document.getElementById('btn-confirm-paid');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span>';

  const result = await API.markPaid(pendingPaymentId);

  btn.disabled = false;
  btn.textContent = 'Ya, Konfirmasi';

  hideModal('modal-verify-payment');
  pendingPaymentId = null;

  if (result.success) {
    toast('Pembayaran dikonfirmasi', 'success');
    await loadData();
  } else {
    toast(result.error || 'Gagal update', 'error');
  }
}

function onDeleteOrder(id, nama) {
  pendingDeleteId = id;
  pendingDeleteName = nama;
  document.getElementById('delete-confirm-name').textContent = nama;
  showModal('modal-delete-confirm');
}

async function handleConfirmDelete() {
  if (!pendingDeleteId) return;

  const btn = document.getElementById('btn-delete-yes');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span>';

  const result = await API.deleteOrder(pendingDeleteId);

  btn.disabled = false;
  btn.textContent = 'Ya, Hapus';

  hideModal('modal-delete-confirm');
  pendingDeleteId = null;

  if (result.success) {
    toast('Pesanan dihapus', 'success');
    await loadData();
  } else {
    toast(result.error || 'Gagal menghapus', 'error');
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();

  const data = {
    tanggal_buka: document.getElementById('set-tanggal').value,
    jam_buka: document.getElementById('set-jam').value,
    kuota: document.getElementById('set-kuota').value,
    harga: document.getElementById('set-harga').value,
    max_per_kk: document.getElementById('set-max-kk').value
  };

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span> Menyimpan...';

  const result = await API.saveSettings(data);

  btn.disabled = false;
  btn.textContent = 'Simpan Pengaturan';

  if (result.success) {
    toast('Pengaturan tersimpan!', 'success');
    await loadData();
  } else {
    toast(result.error || 'Gagal menyimpan', 'error');
  }
}

async function handleResetOrders() {
  const btn = document.getElementById('btn-reset-yes');
  btn.disabled = true;
  btn.textContent = 'Menghapus...';

  const result = await API.resetOrders();

  btn.disabled = false;
  btn.textContent = 'Ya, Hapus Semua';
  document.getElementById('reset-confirm').classList.remove('show');

  if (result.success) {
    toast('Semua pesanan dihapus', 'success');
    await loadData();
  } else {
    toast(result.error || 'Gagal reset', 'error');
  }
}

async function handleChangePassword(e) {
  e.preventDefault();

  const oldPw = document.getElementById('inp-old-password').value;
  const newPw = document.getElementById('inp-new-password').value;
  const confirmPw = document.getElementById('inp-confirm-password').value;

  if (!oldPw) { toast('Masukkan password lama', 'error'); return; }
  if (newPw.length < 4) { toast('Password baru minimal 4 karakter', 'error'); return; }
  if (newPw !== confirmPw) { toast('Konfirmasi password tidak cocok', 'error'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-white"></span>';

  const result = await API.changePassword(oldPw, newPw);

  btn.disabled = false;
  btn.textContent = 'Ubah Password';

  if (result.success) {
    toast('Password berhasil diubah!', 'success');
    e.target.reset();
  } else {
    toast(result.error || 'Gagal mengubah password', 'error');
  }
}

// ─────────────────────────────────────────────
// MODAL HELPERS
// ─────────────────────────────────────────────
function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('show');
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

// ─────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ─────────────────────────────────────────────
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };

  el.innerHTML = '<span>' + (icons[type] || '') + '</span><span>' + esc(message) + '</span>';
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-hide');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─────────────────────────────────────────────
// UTILITY
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

function showLoader(show) {
  const loader = document.getElementById('page-loader');
  const content = document.getElementById('page-content');
  if (loader) loader.style.display = show ? 'flex' : 'none';
  if (content) content.style.display = show ? 'none' : 'block';
}

// Expose to global for onclick handlers in rendered HTML
window.onMarkPaid = onMarkPaid;
window.onDeleteOrder = onDeleteOrder;

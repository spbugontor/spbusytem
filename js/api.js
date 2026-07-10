/**
 * API Wrapper — Komunikasi ke Google Spreadsheet via Apps Script
 * Semua request menggunakan GET untuk menghindari masalah CORS/redirect.
 */
const API = {

  _loading: false,

  async call(action, params = {}) {
    const url = new URL(CONFIG.SCRIPT_URL);
    url.searchParams.set('action', action);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    try {
      this._loading = true;
      document.body.classList.add('api-loading');

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const data = await response.json();
      return data;

    } catch (err) {
      console.error('[API] ' + action + ':', err);
      return {
        success: false,
        error: 'Gagal terhubung ke server. Periksa koneksi internet.'
      };
    } finally {
      this._loading = false;
      document.body.classList.remove('api-loading');
    }
  },

  // ── Read ──
  getOrders() {
    return this.call('getOrders');
  },

  getSettings() {
    return this.call('getSettings');
  },

  // ── Write ──
  addOrder(nama, kk, nik) {
    return this.call('addOrder', { nama, kk, nik });
  },

  markPaid(id) {
    return this.call('markPaid', { id });
  },

  deleteOrder(id) {
    return this.call('deleteOrder', { id });
  },

  saveSettings(data) {
    return this.call('saveSettings', data);
  },

  resetOrders() {
    return this.call('resetOrders');
  },

  // ── Auth ──
  login(password) {
    return this.call('login', { password });
  },

  changePassword(old_password, new_password) {
    return this.call('changePassword', { old_password, new_password });
  }
};

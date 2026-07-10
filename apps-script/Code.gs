/**
 * ================================================
 * PEMESANAN LPG 3 KG — Google Apps Script Backend
 * ================================================
 * 
 * CARA SETUP:
 * 1. Buat Google Spreadsheet baru (kosong)
 * 2. Buka menu Extensions > Apps Script
 * 3. Hapus semua kode bawaan, paste SELURUH kode ini
 * 4. Klik tombol Run ▶ pilih fungsi "setupSheet" → jalankan
 *    (Izinkan permission yang diminta)
 * 5. Kembali ke Spreadsheet — pastikan ada 2 sheet: "Pesanan" & "Pengaturan"
 * 6. Di Apps Script, klik Deploy > New Deployment
 *    - Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 7. Copy URL deployment → paste ke file js/config.js
 * 
 * SELESAI! Website sudah terkoneksi ke Spreadsheet.
 * ================================================
 */

const ORDERS_SHEET = 'Pesanan';
const SETTINGS_SHEET = 'Pengaturan';

// ─────────────────────────────────────────────
// SETUP — Jalankan 1x untuk buat & format sheet
// ─────────────────────────────────────────────

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.rename('📦 Database Pemesanan LPG 3 KG');

  // ── Sheet Pesanan ──
  let orders = ss.getSheetByName(ORDERS_SHEET);
  if (!orders) {
    orders = ss.insertSheet(ORDERS_SHEET);
  } else {
    orders.clear();
    orders.clearConditionalFormatRules();
  }

  const orderHeaders = [
    'ID', 'Nama Lengkap', 'No KK', 'NIK',
    'Jumlah', 'Sudah Bayar', 'Tanggal Pesan', 'Waktu Pesan'
  ];
  orders.getRange(1, 1, 1, orderHeaders.length).setValues([orderHeaders]);

  // Format header pesanan
  const oh = orders.getRange(1, 1, 1, orderHeaders.length);
  oh.setFontWeight('bold')
    .setFontSize(10)
    .setBackground('#0D9488')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(false);

  // Lebar kolom optimal
  orders.setRowHeight(1, 38);
  orders.setColumnWidth(1, 55);   // ID
  orders.setColumnWidth(2, 220);  // Nama
  orders.setColumnWidth(3, 175);  // KK
  orders.setColumnWidth(4, 175);  // NIK
  orders.setColumnWidth(5, 75);   // Jumlah
  orders.setColumnWidth(6, 115);  // Sudah Bayar
  orders.setColumnWidth(7, 125);  // Tanggal
  orders.setColumnWidth(8, 115);  // Waktu
  orders.setFrozenRows(1);

  // Checkbox untuk kolom Sudah Bayar (F2:F1000)
  const checkboxRule = SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .setAllowInvalid(false)
    .build();
  orders.getRange('F2:F1000').setDataValidation(checkboxRule);

  // Conditional formatting: hijau jika sudah bayar
  const greenRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$F2=TRUE')
    .setBackground('#D1FAE5')
    .setRanges([orders.getRange('A2:H1000')])
    .build();

  // Kuning jika belum bayar
  const yellowRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($F2=FALSE, $A2<>"")')
    .setBackground('#FEF9C3')
    .setRanges([orders.getRange('A2:H1000')])
    .build();

  orders.setConditionalFormatRules([greenRule, yellowRule]);

  // Alignment untuk data area
  orders.getRange('A2:A1000').setHorizontalAlignment('center');  // ID
  orders.getRange('C2:D1000').setHorizontalAlignment('center');  // KK & NIK
  orders.getRange('E2:E1000').setHorizontalAlignment('center');  // Jumlah
  orders.getRange('G2:H1000').setHorizontalAlignment('center');  // Tanggal & Waktu

  // ── Sheet Pengaturan ──
  let settings = ss.getSheetByName(SETTINGS_SHEET);
  if (!settings) {
    settings = ss.insertSheet(SETTINGS_SHEET);
  } else {
    settings.clear();
  }

  const settingsHeaders = ['Pengaturan', 'Nilai', 'Keterangan'];
  settings.getRange(1, 1, 1, 3).setValues([settingsHeaders]);

  // Format header pengaturan
  const sh = settings.getRange(1, 1, 1, 3);
  sh.setFontWeight('bold')
    .setFontSize(10)
    .setBackground('#D97706')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  // Data default + keterangan
  const defaults = [
    ['tanggal_buka', '', 'Format: YYYY-MM-DD (misal 2026-07-15)'],
    ['jam_buka', '', 'Format: HH:MM (misal 08:00)'],
    ['kuota', '50', 'Jumlah tabung LPG yang tersedia'],
    ['harga', '18000', 'Harga per tabung dalam Rupiah'],
    ['max_per_kk', '2', 'Maks jumlah NIK per 1 No KK per hari'],
    ['admin_password', 'admin123', '⚠️ Ganti password ini segera!']
  ];

  settings.getRange(2, 1, defaults.length, 3).setValues(defaults);

  // Format kolom pengaturan
  const labelRange = settings.getRange(2, 1, defaults.length, 1);
  labelRange.setFontWeight('bold').setFontColor('#374151');

  const keteranganRange = settings.getRange(2, 3, defaults.length, 1);
  keteranganRange.setFontColor('#9CA3AF').setFontStyle('italic').setFontSize(9);

  // Highlight password row
  const pwRow = settings.getRange(defaults.length + 1, 1, 1, 3);
  pwRow.setBackground('#FEF2F2');

  settings.setColumnWidth(1, 180);
  settings.setColumnWidth(2, 200);
  settings.setColumnWidth(3, 300);
  settings.setRowHeight(1, 38);
  settings.setFrozenRows(1);

  // Hapus sheet default (Sheet1 / Lembar1)
  ['Sheet1', 'Lembar1', 'Sheet 1'].forEach(name => {
    const s = ss.getSheetByName(name);
    if (s && ss.getSheets().length > 1) {
      try { ss.deleteSheet(s); } catch (e) { /* ignore */ }
    }
  });

  // Set sheet Pesanan sebagai aktif
  ss.setActiveSheet(orders);
  SpreadsheetApp.flush();

  SpreadsheetApp.getUi().alert(
    '✅ Setup Selesai!',
    'Sheet "Pesanan" dan "Pengaturan" sudah dibuat dan diformat.\n\n' +
    'Langkah selanjutnya:\n' +
    '1. Deploy > New Deployment > Web App\n' +
    '2. Execute as: Me\n' +
    '3. Who has access: Anyone\n' +
    '4. Copy URL ke config.js',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ─────────────────────────────────────────────
// API ENDPOINT
// ─────────────────────────────────────────────

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    let result;

    switch (action) {
      case 'getOrders':
        result = handleGetOrders();
        break;
      case 'getSettings':
        result = handleGetSettings();
        break;
      case 'addOrder':
        result = handleAddOrder(e.parameter);
        break;
      case 'markPaid':
        result = handleMarkPaid(e.parameter);
        break;
      case 'deleteOrder':
        result = handleDeleteOrder(e.parameter);
        break;
      case 'saveSettings':
        result = handleSaveSettings(e.parameter);
        break;
      case 'resetOrders':
        result = handleResetOrders();
        break;
      case 'login':
        result = handleLogin(e.parameter);
        break;
      case 'changePassword':
        result = handleChangePassword(e.parameter);
        break;
      default:
        result = { success: false, error: 'Action tidak dikenal: ' + action };
    }

    return respond(result);
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

function doPost(e) {
  return doGet(e);
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
// HANDLER FUNCTIONS
// ─────────────────────────────────────────────

function handleGetOrders() {
  const sheet = getSheet(ORDERS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, orders: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const tz = Session.getScriptTimeZone();

  const orders = data
    .filter(row => row[0] !== '' && row[0] !== null)
    .map(row => {
      // Normalize tanggal (bisa Date atau String)
      let tanggal = row[6];
      if (tanggal instanceof Date) {
        tanggal = Utilities.formatDate(tanggal, tz, 'yyyy-MM-dd');
      }

      return {
        id: String(row[0]),
        nama: String(row[1]),
        kk: String(row[2]),
        nik: String(row[3]),
        jumlah: Number(row[4]) || 1,
        sudah_bayar: row[5] === true || row[5] === 'TRUE',
        tanggal: String(tanggal),
        waktu: String(row[7])
      };
    });

  return { success: true, orders: orders };
}

function handleGetSettings() {
  const sheet = getSheet(SETTINGS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, settings: {} };

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const tz = Session.getScriptTimeZone();
  const settings = {};

  data.forEach(row => {
    let key = String(row[0]);
    let value = row[1];
    // Convert Date ke string
    if (value instanceof Date) {
      if (key === 'jam_buka') {
        value = Utilities.formatDate(value, tz, 'HH:mm');
      } else {
        value = Utilities.formatDate(value, tz, 'yyyy-MM-dd');
      }
    }
    settings[key] = value;
  });

  // Jangan kirim password ke client
  delete settings.admin_password;

  return { success: true, settings: settings };
}

function handleAddOrder(params) {
  const nama = (params.nama || '').trim();
  const kk = (params.kk || '').trim();
  const nik = (params.nik || '').trim();

  // Validasi input
  if (!nama || !kk || !nik) {
    return { success: false, error: 'Data tidak lengkap. Isi semua kolom.' };
  }
  if (!/^\d{16}$/.test(kk)) {
    return { success: false, error: 'No KK harus tepat 16 digit angka' };
  }
  if (!/^\d{16}$/.test(nik)) {
    return { success: false, error: 'NIK harus tepat 16 digit angka' };
  }

  // Ambil data existing
  const allSettings = getAllSettings();
  const ordersResult = handleGetOrders();
  const orders = ordersResult.orders;
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // Cek kuota
  const kuota = parseInt(allSettings.kuota) || 0;
  if (orders.length >= kuota) {
    return { success: false, error: 'Kuota habis' };
  }

  // Cek duplikasi hari ini
  const todayOrders = orders.filter(o => o.tanggal === today);

  // NIK tidak boleh sama dalam 1 hari
  if (todayOrders.some(o => o.nik === nik)) {
    return { success: false, error: 'NIK sudah terdaftar hari ini', duplicate: true };
  }

  // KK dibatasi sesuai max_per_kk
  const maxPerKK = parseInt(allSettings.max_per_kk) || 2;
  const kkCount = todayOrders.filter(o => o.kk === kk).length;
  if (kkCount >= maxPerKK) {
    return {
      success: false,
      error: 'No KK sudah mencapai batas ' + maxPerKK + ' NIK per hari',
      duplicate: true
    };
  }

  // Generate ID (max existing + 1)
  const maxId = orders.reduce((max, o) => Math.max(max, parseInt(o.id) || 0), 0);
  const newId = maxId + 1;
  const waktu = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');

  // Simpan ke sheet
  const sheet = getSheet(ORDERS_SHEET);
  sheet.appendRow([newId, nama, kk, nik, 1, false, today, waktu]);

  return {
    success: true,
    message: 'Pesanan berhasil!',
    id: newId
  };
}

function handleMarkPaid(params) {
  const id = String(params.id || '');
  if (!id) return { success: false, error: 'ID tidak valid' };

  const sheet = getSheet(ORDERS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: 'Tidak ada data pesanan' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      sheet.getRange(i + 2, 6).setValue(true);
      return { success: true, message: 'Status pembayaran diperbarui' };
    }
  }

  return { success: false, error: 'Pesanan ID ' + id + ' tidak ditemukan' };
}

function handleDeleteOrder(params) {
  const id = String(params.id || '');
  if (!id) return { success: false, error: 'ID tidak valid' };

  const sheet = getSheet(ORDERS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: 'Tidak ada data pesanan' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      sheet.deleteRow(i + 2);
      return { success: true, message: 'Pesanan dihapus' };
    }
  }

  return { success: false, error: 'Pesanan ID ' + id + ' tidak ditemukan' };
}

function handleSaveSettings(params) {
  const sheet = getSheet(SETTINGS_SHEET);
  const keys = ['tanggal_buka', 'jam_buka', 'kuota', 'harga', 'max_per_kk'];

  keys.forEach(key => {
    if (params[key] !== undefined && params[key] !== '') {
      updateSetting(sheet, key, params[key]);
    }
  });

  return { success: true, message: 'Pengaturan tersimpan' };
}

function handleResetOrders() {
  const sheet = getSheet(ORDERS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  return { success: true, message: 'Semua pesanan berhasil dihapus' };
}

function handleLogin(params) {
  const password = params.password || '';
  const settings = getAllSettings();

  if (password === String(settings.admin_password)) {
    return { success: true, message: 'Login berhasil' };
  }
  return { success: false, error: 'Password salah' };
}

function handleChangePassword(params) {
  const oldPw = params.old_password || '';
  const newPw = params.new_password || '';
  const settings = getAllSettings();

  if (oldPw !== String(settings.admin_password)) {
    return { success: false, error: 'Password lama salah' };
  }
  if (newPw.length < 4) {
    return { success: false, error: 'Password baru minimal 4 karakter' };
  }

  const sheet = getSheet(SETTINGS_SHEET);
  updateSetting(sheet, 'admin_password', newPw);

  return { success: true, message: 'Password berhasil diubah' };
}

// ─────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error(
      'Sheet "' + name + '" tidak ditemukan. Jalankan fungsi setupSheet() dulu.'
    );
  }
  return sheet;
}

function getAllSettings() {
  const sheet = getSheet(SETTINGS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const tz = Session.getScriptTimeZone();
  const settings = {};

  data.forEach(row => {
    let key = String(row[0]);
    let value = row[1];
    if (value instanceof Date) {
      if (key === 'jam_buka') {
        value = Utilities.formatDate(value, tz, 'HH:mm');
      } else {
        value = Utilities.formatDate(value, tz, 'yyyy-MM-dd');
      }
    }
    settings[key] = value;
  });

  return settings;
}

function updateSetting(sheet, key, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    sheet.appendRow([key, value]);
    return;
  }

  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === key) {
      sheet.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  // Key belum ada, tambahkan
  sheet.appendRow([key, value, '']);
}

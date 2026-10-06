/**
 * ============================================================================
 * WEDDING FUND TRACKER - GOOGLE APPS SCRIPT BACKEND
 * ============================================================================
 * Backend API & Spreadsheet Engine untuk Wedding Fund Tracker App.
 * Terhubung dengan Google Sheets dan aman diakses dari GitHub Pages via JSONP/POST.
 *
 * FITUR UTAMA:
 * 1. Otentikasi dua mempelai (Cowo & Cewe) via Script Properties & Session Token (6 Jam).
 * 2. CRUD penuh untuk 7 Tabel: Categories, Budget, Transactions, Savings, Vendors, Checklist, Settings.
 * 3. Otomatisasi setupDatabase(): membuat tabel, format header, dropdown validasi, & trigger.
 * 4. Kompatibel mode container-bound (Extensions > Apps Script) maupun standalone (SPREADSHEET_ID).
 * 5. Proteksi injeksi formula (=+@), pembatasan rate limit login, dan komparasi password konstan.
 * ============================================================================
 */

const SHEETS = {
  Categories: ['id', 'name', 'priority', 'kind', 'color', 'active', 'sortOrder', 'updatedAt'],
  Budget: ['id', 'categoryId', 'categoryName', 'plannedAmount', 'owner', 'notes', 'updatedAt'],
  Transactions: ['id', 'date', 'type', 'categoryId', 'categoryName', 'description', 'amount', 'owner', 'paymentMethod', 'vendorId', 'vendorName', 'proofLink', 'notes', 'updatedAt'],
  Savings: ['id', 'date', 'source', 'amount', 'account', 'owner', 'description', 'verified', 'proofLink', 'updatedAt'],
  Vendors: ['id', 'name', 'categoryId', 'categoryName', 'contact', 'contractAmount', 'invoiceLink', 'nextDueDate', 'notes', 'updatedAt'],
  Checklist: ['id', 'title', 'categoryId', 'categoryName', 'status', 'dueDate', 'owner', 'estimatedAmount', 'vendorId', 'vendorName', 'notes', 'updatedAt'],
  Settings: ['key', 'value', 'updatedAt'],
};

const DEFAULT_CATEGORIES = [
  ['Venue & Lokasi', 'Wajib'],
  ['Catering & Jamuan', 'Wajib'],
  ['Dekorasi & Tata Panggung', 'Penting'],
  ['Busana Pengantin & Keluarga', 'Penting'],
  ['MUA & Hairdo', 'Penting'],
  ['Dokumentasi Foto & Video', 'Penting'],
  ['Undangan & Web RSVP', 'Opsional'],
  ['Mahar & Seserahan', 'Wajib'],
  ['Cincin Pernikahan', 'Wajib'],
  ['Bulan Madu (Honeymoon)', 'Opsional'],
  ['Transportasi & Akomodasi', 'Penting'],
  ['Administrasi & KUA', 'Wajib'],
  ['Dana Darurat & Lain-lain', 'Wajib']
];

var API_REQUEST_USER_ = '';

/* ==========================================================================
   WEB APP HTTP HANDLERS (doGet & doPost)
   ========================================================================== */

function doGet(e) {
  if (e && e.parameter && e.parameter.api === '1') {
    return apiGet_(e);
  }
  return ContentService.createTextOutput(
    'Wedding Fund API Backend aktif. Buka antarmuka aplikasi melalui GitHub Pages Anda.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    let p = (e && e.parameter) || {};
    if (e && e.postData && e.postData.contents) {
      try {
        const bodyJson = JSON.parse(e.postData.contents);
        p = Object.assign({}, p, bodyJson);
      } catch (ignore) {}
    }

    const payload = typeof p.payload === 'string' ? JSON.parse(p.payload) : (p.payload || {});
    let result;

    if (p.action === 'login') {
      result = loginUser_(p.username, p.password);
    } else {
      API_REQUEST_USER_ = requireSession_(p.sessionToken);
      if (p.action === 'save') {
        result = saveRecord(String(payload.sheet || ''), payload.record || {});
      } else if (p.action === 'delete') {
        result = deleteRecord(String(payload.sheet || ''), String(payload.id || ''));
      } else if (p.action === 'saveSettings') {
        result = saveSettings(payload.values || {});
      } else {
        throw new Error('Aksi API tidak dikenal: ' + p.action);
      }
    }

    const output = { ok: true, result: result };
    if (p.requestId) {
      CacheService.getScriptCache().put('wf:' + p.requestId, JSON.stringify(output), 60);
    }
    return jsonOutput_(output);
  } catch (err) {
    const output = { ok: false, error: String(err && err.message || err) };
    const requestId = e && e.parameter && e.parameter.requestId;
    if (requestId && /^[a-f0-9-]{20,50}$/i.test(requestId)) {
      CacheService.getScriptCache().put('wf:' + requestId, JSON.stringify(output), 60);
    }
    return jsonOutput_(output);
  }
}

function apiGet_(e) {
  const callback = String(e.parameter.callback || '');
  if (callback && !/^[A-Za-z_$][0-9A-Za-z_$\.]{0,80}$/.test(callback)) {
    return jsonOutput_({ ok: false, error: 'Nama callback tidak valid.' });
  }

  try {
    let result;
    if (e.parameter.action === 'result') {
      const saved = CacheService.getScriptCache().get('wf:' + String(e.parameter.requestId || ''));
      if (!saved) throw new Error('Operasi belum selesai, silakan coba lagi.');
      result = JSON.parse(saved);
      return callback ? jsonpOutput_(callback, result) : jsonOutput_(result);
    } else {
      API_REQUEST_USER_ = requireSession_(e.parameter.sessionToken);
      if (e.parameter.action === 'snapshot') result = getAppSnapshot();
      else if (e.parameter.action === 'status') result = getAppStatus();
      else throw new Error('Aksi API tidak dikenal: ' + e.parameter.action);
    }

    const output = { ok: true, result: result };
    return callback ? jsonpOutput_(callback, output) : jsonOutput_(output);
  } catch (err) {
    const output = { ok: false, error: String(err && err.message || err) };
    return callback ? jsonpOutput_(callback, output) : jsonOutput_(output);
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpOutput_(callback, value) {
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(value) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ==========================================================================
   OTENTIKASI & KEAMANAN SESI
   ========================================================================== */

function loginUser_(username, password) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) throw new Error('Silakan masukkan username dan password.');

  const cache = CacheService.getScriptCache();
  const throttle = 'wf:login:' + Utilities.base64EncodeWebSafe(u.toLowerCase());
  const attempts = Number(cache.get(throttle) || 0);
  if (attempts >= 8) throw new Error('Terlalu banyak percobaan salah. Tunggu 10 menit sebelum mencoba lagi.');

  const props = PropertiesService.getScriptProperties();
  let u1 = props.getProperty('APP_LOGIN_USER_1');
  let p1 = props.getProperty('APP_LOGIN_PASS_1');
  let u2 = props.getProperty('APP_LOGIN_USER_2');
  let p2 = props.getProperty('APP_LOGIN_PASS_2');

  // Inisialisasi kredensial default jika belum diatur
  if (!u1 && !p1) {
    u1 = 'dika'; p1 = 'nikah2025';
    u2 = 'nisa'; p2 = 'nikah2025';
    props.setProperty('APP_LOGIN_USER_1', u1);
    props.setProperty('APP_LOGIN_PASS_1', p1);
    props.setProperty('APP_LOGIN_USER_2', u2);
    props.setProperty('APP_LOGIN_PASS_2', p2);
  }

  let matched = false;
  const accounts = [
    { name: u1, pass: p1 },
    { name: u2, pass: p2 }
  ];

  accounts.forEach(function(acc) {
    if (acc.name && acc.pass && acc.name.toLowerCase() === u.toLowerCase() && constantTimeEqual_(p, acc.pass)) {
      matched = true;
    }
  });

  if (!matched) {
    cache.put(throttle, String(attempts + 1), 600);
    throw new Error('Username atau password salah.');
  }

  cache.remove(throttle);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('wf:session:' + token, u, 21600); // Sesi aktif 6 jam
  return { sessionToken: token, username: u, expiresIn: 21600 };
}

function requireSession_(token) {
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) {
    throw new Error('Silakan login kembali.');
  }
  const username = CacheService.getScriptCache().get('wf:session:' + token);
  if (!username) {
    throw new Error('Sesi telah berakhir. Silakan login kembali.');
  }
  return username;
}

function constantTimeEqual_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  }
  return diff === 0;
}

/**
 * Fungsi pembantu untuk mengatur kredensial login via Apps Script Editor
 */
function setLoginCredentials(user1, pass1, user2, pass2) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('APP_LOGIN_USER_1', user1 || 'dika');
  props.setProperty('APP_LOGIN_PASS_1', pass1 || 'nikah2025');
  props.setProperty('APP_LOGIN_USER_2', user2 || 'nisa');
  props.setProperty('APP_LOGIN_PASS_2', pass2 || 'nikah2025');
  Logger.log('Kredensial login berhasil disimpan!');
  return { ok: true, user1: user1 || 'dika', user2: user2 || 'nisa' };
}

/* ==========================================================================
   SETUP DATABASE & FORMAT SPREADSHEET
   ========================================================================== */

function setupDatabase() {
  requireAllowed_();
  const ss = spreadsheet_();

  Object.keys(SHEETS).forEach(function(name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);

    if (sheet.getLastRow() <= 1) {
      if (sheet.getLastColumn()) sheet.getRange(1, 1, 1, sheet.getLastColumn()).clearContent();
      sheet.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
    } else {
      const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].filter(String);
      const missing = SHEETS[name].filter(function(header) { return existing.indexOf(header) === -1; });
      if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }

    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, SHEETS[name].length)
      .setFontWeight('bold')
      .setBackground('#8e464c')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, SHEETS[name].length);
  });

  Object.keys(SHEETS).forEach(function(name) {
    applySheetValidation_(ss.getSheetByName(name), name);
  });

  seedCategories_();
  seedSettings_();
  migrateLegacyCategoryLinks_();
  installSheetEditTrigger_(ss);

  // Pastikan kredensial awal tersimpan di Script Properties
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_LOGIN_USER_1')) {
    props.setProperty('APP_LOGIN_USER_1', 'dika');
    props.setProperty('APP_LOGIN_PASS_1', 'nikah2025');
    props.setProperty('APP_LOGIN_USER_2', 'nisa');
    props.setProperty('APP_LOGIN_PASS_2', 'nikah2025');
  }

  Logger.log('Database Wedding Fund berhasil disiapkan di: ' + ss.getUrl());
  return {
    spreadsheet: ss.getUrl(),
    tabs: Object.keys(SHEETS),
    defaultUsers: ['dika', 'nisa'],
    instructions: 'Database siap digunakan. Deploy Web App melalui Deploy > New deployment > Web app (Execute as me, Who has access: Anyone).'
  };
}

function getAppStatus() {
  const user = requireAllowed_();
  const ss = spreadsheet_();
  return {
    user: user,
    connected: true,
    spreadsheetUrl: ss.getUrl(),
    timezone: Session.getScriptTimeZone()
  };
}

function getAppSnapshot() {
  requireAllowed_();
  const data = {};
  Object.keys(SHEETS).filter(function(name) { return name !== 'Settings'; }).forEach(function(name) {
    data[name] = readRecords_(name);
  });
  data.Settings = readSettings_();
  data.summary = summarize_(data);
  return data;
}

function getDashboardSummary() {
  return getAppSnapshot().summary;
}

/* ==========================================================================
   CRUD OPERASI DATA
   ========================================================================== */

function listRecords(sheetName) {
  requireAllowed_();
  if (sheetName === 'Settings') return readSettings_();
  return readRecords_(sheetName);
}

function saveRecord(sheetName, record) {
  requireAllowed_();
  if (!Object.prototype.hasOwnProperty.call(SHEETS, sheetName) || sheetName === 'Settings') {
    throw new Error('Jenis data tidak diizinkan: ' + sheetName);
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Data tidak valid.');
  }

  validateRecord_(sheetName, record);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet_(sheetName);
    const headers = headers_(sheet);
    const rows = sheet.getDataRange().getValues();
    const id = String(record.id || Utilities.getUuid());
    const now = new Date();
    let existingRecord = {};

    if (record.id) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][headers.indexOf('id')]) === String(record.id)) {
          existingRecord = headers.reduce(function(out, key, index) {
            out[key] = serializeCell_(rows[i][index]);
            return out;
          }, {});
          break;
        }
      }
    }

    const merged = Object.assign({}, existingRecord, record);

    if (merged.categoryId) {
      const category = readRecords_('Categories').filter(function(x) { return String(x.id) === String(merged.categoryId); })[0];
      merged.categoryName = category ? category.name : '';
    } else if (Object.prototype.hasOwnProperty.call(merged, 'categoryName')) {
      merged.categoryName = '';
    }

    if (merged.vendorId) {
      const vendor = readRecords_('Vendors').filter(function(x) { return String(x.id) === String(merged.vendorId); })[0];
      merged.vendorName = vendor ? vendor.name : '';
    } else if (Object.prototype.hasOwnProperty.call(merged, 'vendorName')) {
      merged.vendorName = '';
    }

    if (sheetName === 'Transactions') validateVendorPayment_(merged, record.id);

    const row = headers.map(function(key) {
      if (key === 'id') return id;
      if (key === 'updatedAt') return now;
      return merged[key] == null ? '' : sanitizeCell_(merged[key]);
    });

    const idIndex = headers.indexOf('id');
    let rowNumber = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idIndex]) === id) {
        rowNumber = i + 1;
        break;
      }
    }

    if (rowNumber > 0) {
      sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    if (sheetName === 'Categories' || sheetName === 'Vendors') {
      syncRelatedNames_(sheetName, id, String(merged.name || ''));
    }

    return { id: id, updatedAt: now.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function deleteRecord(sheetName, id) {
  requireAllowed_();
  if (!Object.prototype.hasOwnProperty.call(SHEETS, sheetName) || sheetName === 'Settings') {
    throw new Error('Jenis data tidak diizinkan: ' + sheetName);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet_(sheetName);
    const headers = headers_(sheet);
    const rows = sheet.getDataRange().getValues();
    const iId = headers.indexOf('id');

    if (sheetName === 'Categories') assertUnreferenced_('categoryId', id);
    if (sheetName === 'Vendors') assertUnreferenced_('vendorId', id);

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][iId]) === String(id)) {
        sheet.deleteRow(i + 1);
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function getSettings() {
  requireAllowed_();
  return readSettings_();
}

function saveSettings(values) {
  requireAllowed_();
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Pengaturan tidak valid.');
  }

  const allowed = [
    'partnerOneName', 'partnerTwoName', 'weddingDate', 'guestTarget',
    'budgetTarget', 'motto', 'currency', 'remindersEnabled', 'reminderDays', 'roleLabels'
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getSheet_('Settings');
    const rows = sheet.getDataRange().getValues();
    const h = headers_(sheet);
    const ki = h.indexOf('key');
    const vi = h.indexOf('value');
    const ui = h.indexOf('updatedAt');

    Object.keys(values).filter(function(k) { return allowed.indexOf(k) !== -1; }).forEach(function(key) {
      const value = sanitizeCell_(values[key] == null ? '' : String(values[key]));
      let found = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][ki]) === key) { found = i + 1; break; }
      }
      if (found > 0) {
        sheet.getRange(found, vi + 1).setValue(value);
        sheet.getRange(found, ui + 1).setValue(new Date());
      } else {
        const row = h.map(function(col) {
          return col === 'key' ? key : col === 'value' ? value : col === 'updatedAt' ? new Date() : '';
        });
        sheet.appendRow(row);
      }
    });
    return readSettings_();
  } finally {
    lock.releaseLock();
  }
}

/* ==========================================================================
   HELPER BACA SPREADSHEET & AGREGASI
   ========================================================================== */

function readRecords_(name) {
  if (!Object.prototype.hasOwnProperty.call(SHEETS, name) || name === 'Settings') {
    throw new Error('Jenis data tidak diizinkan: ' + name);
  }
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values.shift();
  return values.filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  }).map(function(row) {
    return headers.reduce(function(out, key, i) {
      out[key] = serializeCell_(row[i]);
      return out;
    }, {});
  });
}

function readSettings_() {
  const sheet = getSheet_('Settings');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};
  const h = values.shift();
  const ki = h.indexOf('key');
  const vi = h.indexOf('value');
  const out = {};
  values.forEach(function(row) {
    if (row[ki]) out[String(row[ki])] = row[vi];
  });
  return out;
}

function summarize_(data) {
  const budgets = data.Budget || [];
  const tx = data.Transactions || [];
  const savings = data.Savings || [];
  const vendors = data.Vendors || [];
  const tasks = data.Checklist || [];

  const expenses = tx.filter(function(r) { return normalizedType_(r.type) === 'expense'; });
  const income = tx.filter(function(r) { return normalizedType_(r.type) === 'income'; });

  const paid = {};
  expenses.forEach(function(r) {
    if (r.vendorId) paid[r.vendorId] = (paid[r.vendorId] || 0) + (Number(r.amount) || 0);
  });

  const categoryActual = {};
  expenses.forEach(function(r) {
    if (r.categoryId) categoryActual[r.categoryId] = (categoryActual[r.categoryId] || 0) + (Number(r.amount) || 0);
  });

  const planned = budgets.reduce(function(s, r) { return s + (Number(r.plannedAmount) || 0); }, 0);

  return {
    planned: planned,
    expenses: expenses.reduce(function(s, r) { return s + (Number(r.amount) || 0); }, 0),
    income: income.reduce(function(s, r) { return s + (Number(r.amount) || 0); }, 0),
    savings: savings.reduce(function(s, r) { return s + (Number(r.amount) || 0); }, 0),
    vendorDue: vendors.reduce(function(s, v) { return s + Math.max(0, (Number(v.contractAmount) || 0) - (paid[v.id] || 0)); }, 0),
    openTasks: tasks.filter(function(r) { return !/done|selesai/i.test(String(r.status)); }).length,
    categoryActual: categoryActual,
    vendorPaid: paid,
    recentTransactions: tx.slice().sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 5)
  };
}

/* ==========================================================================
   VALIDASI DATA & INTEGRITAS RELASI
   ========================================================================== */

function validateRecord_(sheetName, r) {
  const required = {
    Categories: ['name'],
    Budget: ['categoryId'],
    Transactions: ['date', 'type', 'description', 'amount'],
    Savings: ['date', 'source', 'amount'],
    Vendors: ['name'],
    Checklist: ['title', 'status']
  }[sheetName] || [];

  required.forEach(function(key) {
    if (r[key] === undefined || r[key] === null || String(r[key]).trim() === '') {
      throw new Error('Kolom wajib belum diisi: ' + key);
    }
  });

  ['amount', 'plannedAmount', 'contractAmount', 'estimatedAmount'].forEach(function(key) {
    if (r[key] !== undefined && r[key] !== '' && (!isFinite(Number(r[key])) || Number(r[key]) < 0)) {
      throw new Error('Nominal harus berupa angka nol atau lebih.');
    }
  });

  if (sheetName === 'Transactions' && ['income', 'expense'].indexOf(normalizedType_(r.type)) < 0) {
    throw new Error('Jenis transaksi harus pemasukan atau pengeluaran.');
  }

  if (sheetName === 'Categories' && ['Wajib', 'Penting', 'Opsional'].indexOf(r.priority) < 0) {
    throw new Error('Pilih prioritas kategori: Wajib, Penting, atau Opsional.');
  }

  if (r.categoryId && !readRecords_('Categories').some(function(x) {
    return String(x.id) === String(r.categoryId) && String(x.active) !== 'FALSE';
  })) {
    throw new Error('Kategori tidak ditemukan atau sudah dinonaktifkan.');
  }

  if (r.vendorId && !readRecords_('Vendors').some(function(x) {
    return String(x.id) === String(r.vendorId);
  })) {
    throw new Error('Vendor tidak ditemukan.');
  }

  if (r.owner && ['Cowo', 'Cewe', 'Bersama', 'Keluarga'].indexOf(r.owner) < 0) {
    throw new Error('PIC penanggung jawab tidak valid.');
  }
}

function validateVendorPayment_(record, id) {
  if (normalizedType_(record.type) !== 'expense' || !record.vendorId) return;
  const vendor = readRecords_('Vendors').filter(function(x) { return String(x.id) === String(record.vendorId); })[0];
  if (!vendor) throw new Error('Vendor tidak ditemukan.');
  const contract = Number(vendor.contractAmount || 0);
  if (contract > 0) {
    const paid = readRecords_('Transactions').filter(function(x) {
      return String(x.vendorId) === String(record.vendorId) && String(x.id) !== String(id) && normalizedType_(x.type) === 'expense';
    }).reduce(function(s, x) { return s + (Number(x.amount) || 0); }, 0);
    if (paid + (Number(record.amount) || 0) > contract) {
      throw new Error('Pembayaran melebihi total nilai kontrak vendor (' + contract + ').');
    }
  }
}

function normalizedType_(value) {
  const s = String(value || '').toLowerCase();
  return ['income', 'pemasukan', 'masuk'].indexOf(s) >= 0 ? 'income' : ['expense', 'pengeluaran', 'keluar'].indexOf(s) >= 0 ? 'expense' : s;
}

/* ==========================================================================
   SEED DATA & PENGISIAN AWAL
   ========================================================================== */

function seedCategories_() {
  const existing = readRecords_('Categories');
  if (existing.length) return;
  const sheet = getSheet_('Categories');
  const h = headers_(sheet);
  DEFAULT_CATEGORIES.forEach(function(item, index) {
    const row = {
      id: Utilities.getUuid(),
      name: item[0],
      priority: item[1],
      kind: 'budget',
      color: '',
      active: true,
      sortOrder: index + 1,
      updatedAt: new Date()
    };
    sheet.appendRow(h.map(function(key) { return row[key] === undefined ? '' : row[key]; }));
  });
}

function seedSettings_() {
  const existing = readSettings_();
  if (existing && Object.keys(existing).length > 2) return;
  saveSettings({
    partnerOneName: 'Dika',
    partnerTwoName: 'Nisa',
    weddingDate: '2025-10-18',
    budgetTarget: 185000000,
    guestTarget: 500,
    motto: 'Menuju Hari Bahagia Bersama',
    currency: 'IDR',
    remindersEnabled: 'true',
    reminderDays: 7
  });
}

/**
 * Mengisi data contoh realistis untuk memulai pengujian di Google Sheets
 */
function seedSampleData() {
  requireAllowed_();
  setupDatabase();
  const cats = readRecords_('Categories');
  if (!cats.length) return { ok: false, error: 'Kategori belum tersedia.' };

  const getCatId = function(name) {
    const f = cats.filter(function(c) { return c.name.toLowerCase().includes(name.toLowerCase()); })[0];
    return f ? f.id : (cats[0] ? cats[0].id : '');
  };

  // 1. Plafon Anggaran (Budget)
  const existingBudget = readRecords_('Budget');
  if (!existingBudget.length) {
    const budgetData = [
      { categoryId: getCatId('Venue'), plannedAmount: 50000000, owner: 'Bersama', notes: 'Sewa gedung ballroom & fasilitas' },
      { categoryId: getCatId('Catering'), plannedAmount: 65000000, owner: 'Bersama', notes: 'Paket prasmanan 500 porsi + 5 gubukan' },
      { categoryId: getCatId('Dekorasi'), plannedAmount: 25000000, owner: 'Cewe', notes: 'Pelaminan modern botanical & ambient lighting' },
      { categoryId: getCatId('Busana'), plannedAmount: 15000000, owner: 'Cewe', notes: 'Busana akad, resepsi & beskap orang tua' },
      { categoryId: getCatId('MUA'), plannedAmount: 12000000, owner: 'Cewe', notes: 'MUA pengantin, ibu & pendamping' },
      { categoryId: getCatId('Dokumentasi'), plannedAmount: 10000000, owner: 'Cowo', notes: 'Foto all-day, cinematic video & album kolase' },
      { categoryId: getCatId('Undangan'), plannedAmount: 3000000, owner: 'Cowo', notes: 'Website undangan digital & cetak fisik' },
      { categoryId: getCatId('Mahar'), plannedAmount: 5000000, owner: 'Cowo', notes: 'Logam mulia antam & mahar bingkai' }
    ];
    budgetData.forEach(function(b) { saveRecord('Budget', b); });
  }

  // 2. Vendor Rekanan
  const existingVendors = readRecords_('Vendors');
  if (!existingVendors.length) {
    const vendorData = [
      { name: 'Grand Royal Hall Ballroom', categoryId: getCatId('Venue'), contact: 'Mbak Indah (0812-3456-7890)', contractAmount: 45000000, nextDueDate: '2025-06-05', notes: 'Termin 2 jatuh tempo 5 Juni' },
      { name: 'Larasati Catering Nusantara', categoryId: getCatId('Catering'), contact: 'Pak Budi (0813-9876-5432)', contractAmount: 38000000, nextDueDate: '2025-06-15', notes: 'DP 40% setelah test food' },
      { name: 'House of Sekar Attire & MUA', categoryId: getCatId('MUA'), contact: 'Teh Sekar (0878-1122-3344)', contractAmount: 12000000, nextDueDate: '2025-06-20', notes: 'Booking fee sudah masuk' },
      { name: 'Lensa Cerita Visuals', categoryId: getCatId('Dokumentasi'), contact: 'Mas Aldi (0811-2233-4455)', contractAmount: 10000000, nextDueDate: '2025-07-01', notes: 'Prewedding + Dokumentasi Hari H' }
    ];
    vendorData.forEach(function(v) { saveRecord('Vendors', v); });
  }

  // 3. Checklist Tugas
  const existingChecklist = readRecords_('Checklist');
  if (!existingChecklist.length) {
    const checkData = [
      { title: 'Pelunasan DP Gedung (Termin 1)', status: 'Selesai', dueDate: '2025-05-10', owner: 'Bersama', estimatedAmount: 20000000, notes: 'Kuitansi aman tersimpan' },
      { title: 'Pilih Menu Catering & Test Food Final', status: 'Berjalan', dueDate: '2025-05-25', owner: 'Cewe', estimatedAmount: 0, notes: 'Ajak kedua orang tua' },
      { title: 'Fitting Busana Pengantin Perdana', status: 'Belum mulai', dueDate: '2025-06-05', owner: 'Cewe', estimatedAmount: 3000000, notes: 'Penyesuaian ukuran' },
      { title: 'Daftar Berkas Nikah ke KUA', status: 'Belum mulai', dueDate: '2025-06-15', owner: 'Cowo', estimatedAmount: 600000, notes: 'Surat N1, N2, N4 dari kelurahan' },
      { title: 'Pembelian Logam Mulia Mahar', status: 'Selesai', dueDate: '2025-05-01', owner: 'Cowo', estimatedAmount: 12500000, notes: 'Antam 10 gram sudah dibeli' }
    ];
    checkData.forEach(function(c) { saveRecord('Checklist', c); });
  }

  // 4. Tabungan
  const existingSavings = readRecords_('Savings');
  if (!existingSavings.length) {
    const savingsData = [
      { date: '2025-04-25', source: 'Gaji Bulanan Dika (April)', amount: 15000000, account: 'Rekening Bersama BCA', owner: 'Cowo', description: 'Setoran rutin bulanan', verified: true },
      { date: '2025-04-25', source: 'Gaji Bulanan Nisa (April)', amount: 12500000, account: 'Rekening Bersama BCA', owner: 'Cewe', description: 'Setoran rutin bulanan', verified: true },
      { date: '2025-03-10', source: 'Tabungan Awal Bersama', amount: 45000000, account: 'Rekening Bersama Mandiri', owner: 'Bersama', description: 'Modal awal komitmen bersama', verified: true }
    ];
    savingsData.forEach(function(s) { saveRecord('Savings', s); });
  }

  Logger.log('Sample data berhasil diisi ke dalam Google Spreadsheet!');
  return { ok: true, message: 'Data contoh berhasil dimuat ke Google Spreadsheet!' };
}

/* ==========================================================================
   TRIGGERS & SINKRONISASI EDIT SPREADSHEET
   ========================================================================== */

function migrateLegacyCategoryLinks_() {
  ['Budget', 'Transactions', 'Vendors', 'Checklist'].forEach(function(name) {
    const sheet = getSheet_(name);
    const h = headers_(sheet);
    const legacy = h.indexOf('category');
    const idCol = h.indexOf('categoryId');
    const nameCol = h.indexOf('categoryName');
    if (idCol < 0 || legacy < 0) return;
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][idCol]) continue;
      const label = String(values[i][legacy] || '').trim();
      if (!label) continue;
      const id = resolveNamedId_('Categories', label);
      if (id) {
        sheet.getRange(i + 1, idCol + 1).setValue(id);
        if (nameCol >= 0) sheet.getRange(i + 1, nameCol + 1).setValue(label);
      }
    }
  });
}

function installSheetEditTrigger_(ss) {
  const exists = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'onWeddingFundEdit' && t.getTriggerSourceId() === ss.getId();
  });
  if (!exists) {
    ScriptApp.newTrigger('onWeddingFundEdit').forSpreadsheet(ss).onEdit().create();
  }
}

function onWeddingFundEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();
  if (!Object.prototype.hasOwnProperty.call(SHEETS, name)) return;

  const headers = headers_(sheet);
  const first = Math.max(2, e.range.getRow());
  const last = Math.max(first, e.range.getRow() + ((e.range.getNumRows && e.range.getNumRows()) || 1) - 1);
  const index = function(key) { return headers.indexOf(key) + 1; };

  for (let row = first; row <= last; row++) {
    const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    if (!values.some(function(value) { return value !== ''; })) continue;

    const set = function(key, value) {
      if (index(key) > 0) sheet.getRange(row, index(key)).setValue(value);
    };

    if (index('id') && !sheet.getRange(row, index('id')).getValue()) {
      set('id', Utilities.getUuid());
    }
    if (index('updatedAt')) {
      set('updatedAt', new Date());
    }

    const categoryName = index('categoryName') ? String(sheet.getRange(row, index('categoryName')).getDisplayValue()).trim() : '';
    if (categoryName && index('categoryId')) {
      set('categoryId', resolveNamedId_('Categories', categoryName));
    }

    const vendorName = index('vendorName') ? String(sheet.getRange(row, index('vendorName')).getDisplayValue()).trim() : '';
    if (vendorName && index('vendorId')) {
      set('vendorId', resolveNamedId_('Vendors', vendorName));
    }

    if (name === 'Categories' || name === 'Vendors') {
      const labelColumn = index('name');
      syncRelatedNames_(
        name,
        sheet.getRange(row, index('id')).getValue(),
        labelColumn ? String(sheet.getRange(row, labelColumn).getDisplayValue()) : ''
      );
    }
  }
}

function syncRelatedNames_(source, id, label) {
  const isCategory = source === 'Categories';
  const key = isCategory ? 'categoryId' : 'vendorId';
  const display = isCategory ? 'categoryName' : 'vendorName';
  const targets = isCategory ? ['Budget', 'Transactions', 'Vendors', 'Checklist'] : ['Transactions', 'Checklist'];

  targets.forEach(function(n) {
    const s = getSheet_(n);
    const h = headers_(s);
    const ki = h.indexOf(key);
    const di = h.indexOf(display);
    if (ki < 0 || di < 0) return;
    const values = s.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][ki]) === String(id)) {
        s.getRange(i + 1, di + 1).setValue(label);
      }
    }
  });
}

function resolveNamedId_(sheetName, name) {
  const key = 'name';
  const found = readRecords_(sheetName).filter(function(x) {
    return String(x[key] || '').trim().toLowerCase() === name.toLowerCase();
  })[0];
  return found ? found.id : '';
}

function applySheetValidation_(sheet, name) {
  const h = headers_(sheet);
  const last = Math.max(sheet.getMaxRows(), 500);
  const rangeFor = function(col) {
    const i = h.indexOf(col);
    return i < 0 ? null : sheet.getRange(2, i + 1, last - 1, 1);
  };
  const list = function(col, values) {
    const r = rangeFor(col);
    if (r) {
      r.setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build()
      );
    }
  };

  list('owner', ['Cowo', 'Cewe', 'Bersama', 'Keluarga']);
  list('priority', ['Wajib', 'Penting', 'Opsional']);
  list('status', ['Belum mulai', 'Berjalan', 'Menunggu', 'Selesai']);
  list('type', ['Pengeluaran', 'Pemasukan']);
  list('paymentMethod', ['Transfer Bank', 'QRIS / E-Wallet', 'Tunai', 'Kartu Kredit']);
  list('kind', ['budget', 'checklist']);

  const categoryCol = h.indexOf('categoryName');
  const categorySheet = spreadsheet_().getSheetByName('Categories');
  if (categoryCol >= 0 && categorySheet) {
    const r = sheet.getRange(2, categoryCol + 1, last - 1, 1);
    const source = categorySheet.getRange('B2:B500');
    r.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(source, true).setAllowInvalid(true).build());
  }

  const vendorCol = h.indexOf('vendorName');
  const vendorSheet = spreadsheet_().getSheetByName('Vendors');
  if (vendorCol >= 0 && vendorSheet) {
    const vh = headers_(vendorSheet);
    const nameCol = vh.indexOf('name');
    if (nameCol >= 0) {
      sheet.getRange(2, vendorCol + 1, last - 1, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInRange(vendorSheet.getRange(2, nameCol + 1, Math.max(1, vendorSheet.getMaxRows() - 1), 1), true).setAllowInvalid(true).build()
      );
    }
  }

  sheet.getRange(1, 1, 1, h.length).setFontWeight('bold').setBackground('#8e464c').setFontColor('#ffffff');
}

/* ==========================================================================
   UTILITAS TEKNIS SPREADSHEET
   ========================================================================== */

function validateRecordHeaders_(name) {
  if (!SHEETS[name]) throw new Error('Jenis data tidak diizinkan: ' + name);
}

function getSheet_(name) {
  validateRecordHeaders_(name);
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Tab ' + name + ' belum dibuat di Google Sheets. Silakan jalankan setupDatabase().');
  return sheet;
}

function headers_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
}

function spreadsheet_() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {}
  if (ss) return ss;

  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('Spreadsheet belum dikonfigurasi. Atur SPREADSHEET_ID pada Script Properties atau buka Script Editor langsung dari spreadsheet terkait (Extensions > Apps Script).');
  }
  return SpreadsheetApp.openById(id);
}

function assertUnreferenced_(field, id) {
  ['Budget', 'Transactions', 'Vendors', 'Checklist'].forEach(function(name) {
    readRecords_(name).forEach(function(r) {
      if (String(r[field] || '') === String(id)) {
        throw new Error('Data masih digunakan pada tabel ' + name + '. Hapus atau ubah relasi data terlebih dahulu.');
      }
    });
  });
}

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

function requireAllowed_() {
  return API_REQUEST_USER_ || currentEmail_() || 'Pengguna Terverifikasi';
}

function sanitizeCell_(value) {
  if (typeof value === 'string' && /^[=+@\-]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function serializeCell_(value) {
  return value instanceof Date
    ? Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX")
    : value;
}

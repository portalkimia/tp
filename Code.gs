/**
 * ============================================================================
 * WEDDING FUND TRACKER - GOOGLE APPS SCRIPT BACKEND
 * ============================================================================
 * Backend API & Spreadsheet Engine untuk Wedding Fund Tracker App.
 * Terhubung dengan Google Sheets dan aman diakses dari GitHub Pages via JSONP/POST.
 *
 * FITUR UTAMA:
 * 1. Otentikasi dua mempelai (Cowo & Cewe) via Script Properties & Session Token (6 Jam).
 * 2. CRUD penuh untuk data keuangan, vendor, checklist, moodboard, dan pengaturan.
 * 3. Otomatisasi setupDatabase(): membuat tabel, format header, dropdown validasi, & trigger.
 * 4. Kompatibel mode container-bound (Extensions > Apps Script) maupun standalone (SPREADSHEET_ID).
 * 5. Proteksi injeksi formula (=+@), pembatasan rate limit login, dan komparasi password konstan.
 * ============================================================================
 */

const SHEETS = {
  Categories: ['id', 'name', 'priority', 'kind', 'color', 'active', 'sortOrder', 'updatedAt'],
  Budget: ['id', 'categoryId', 'categoryName', 'plannedAmount', 'owner', 'notes', 'updatedAt'],
  BudgetItems: ['id', 'categoryId', 'categoryName', 'group', 'title', 'qty', 'unitPrice', 'plannedAmount', 'actualAmount', 'vendorName', 'dpPaid', 'checked', 'owner', 'notes', 'updatedAt'],
  Transactions: ['id', 'date', 'type', 'categoryId', 'categoryName', 'description', 'amount', 'owner', 'paymentMethod', 'vendorId', 'vendorName', 'proofLink', 'notes', 'updatedAt'],
  Savings: ['id', 'date', 'source', 'amount', 'account', 'owner', 'description', 'verified', 'proofLink', 'updatedAt'],
  Vendors: ['id', 'name', 'categoryId', 'categoryName', 'contact', 'contractAmount', 'invoiceLink', 'nextDueDate', 'stage', 'contractSigned', 'notes', 'updatedAt'],
  Checklist: ['id', 'title', 'group', 'phase', 'priority', 'categoryId', 'categoryName', 'status', 'dueDate', 'owner', 'estimatedAmount', 'actualAmount', 'vendorId', 'vendorName', 'notes', 'updatedAt'],
  Seserahan: ['id', 'name', 'tab', 'group', 'shopUrl', 'qty', 'unitPrice', 'estimatedAmount', 'actualAmount', 'specs', 'purchased', 'dueDate', 'owner', 'notes', 'updatedAt'],
  Rundown: ['id', 'time', 'duration', 'session', 'activity', 'pic', 'equipment', 'completed', 'notes', 'sortOrder', 'updatedAt'],
  Guests: ['id', 'name', 'group', 'pax', 'relation', 'phone', 'address', 'eventScope', 'inviteSent', 'rsvpStatus', 'notes', 'updatedAt'],
  Moodboard: ['id', 'title', 'section', 'imageUrl', 'sourceUrl', 'color', 'notes', 'vendorId', 'sortOrder', 'updatedAt'],
  Settings: ['key', 'value', 'updatedAt']
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
    } else if (p.action === 'redeemInvitationHandoff') {
      result = redeemInvitationHandoff_(p.ticket);
    } else {
      API_REQUEST_USER_ = requireSession_(p.sessionToken);
      if (p.action === 'logout') {
        CacheService.getScriptCache().remove('wf:session:' + p.sessionToken);
        result = true;
      } else if (p.action === 'save') {
        result = saveRecord(String(payload.sheet || ''), payload.record || {});
      } else if (p.action === 'delete') {
        result = deleteRecord(String(payload.sheet || ''), String(payload.id || ''));
      } else if (p.action === 'saveSettings') {
        result = saveSettings(payload.values || {});
      } else if (p.action === 'seedPlanner') {
        result = seedPlannerTemplates(payload.scope || 'all');
      } else if (p.action === 'createInvitationHandoff') {
        result = createInvitationHandoff_(API_REQUEST_USER_);
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

  if (!u1 || !p1 || !u2 || !p2) {
    throw new Error('Akun belum dikonfigurasi. Lengkapi dua pasangan username/password di Script Properties.');
  }
  if (p1 === 'nikah2025' || p2 === 'nikah2025') {
    throw new Error('Password bawaan lama harus diganti di Script Properties sebelum login.');
  }

  let matched = false;
  let matchedRole = '';
  const accounts = [
    { name: u1, pass: p1, role: 'cowo' },
    { name: u2, pass: p2, role: 'cewe' }
  ];

  accounts.forEach(function(acc) {
    if (acc.name && acc.pass && acc.name.toLowerCase() === u.toLowerCase() && constantTimeEqual_(p, acc.pass)) {
      matched = true;
      matchedRole = acc.role;
    }
  });

  if (!matched) {
    cache.put(throttle, String(attempts + 1), 600);
    throw new Error('Username atau password salah.');
  }

  cache.remove(throttle);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('wf:session:' + token, u, 21600); // Sesi aktif 6 jam
  return { sessionToken: token, username: u, role: matchedRole, expiresIn: 21600 };
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

function createInvitationHandoff_(username) {
  const ticket = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('wf:invitation:' + ticket, String(username), 90);
  return { ticket: ticket, expiresIn: 90 };
}

function redeemInvitationHandoff_(ticket) {
  if (!/^[a-f0-9]{64}$/i.test(String(ticket || ''))) throw new Error('Tiket undangan tidak valid.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const key = 'wf:invitation:' + ticket;
    const username = CacheService.getScriptCache().get(key);
    if (!username) throw new Error('Tiket undangan telah digunakan atau kedaluwarsa.');
    CacheService.getScriptCache().remove(key);
    return { username: username };
  } finally {
    lock.releaseLock();
  }
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
  if (!user1 || !pass1 || !user2 || !pass2) {
    throw new Error('Dua pasangan username dan password wajib diisi.');
  }
  if (pass1 === 'nikah2025' || pass2 === 'nikah2025') {
    throw new Error('Gunakan password baru yang berbeda dari password bawaan lama.');
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('APP_LOGIN_USER_1', user1);
  props.setProperty('APP_LOGIN_PASS_1', pass1);
  props.setProperty('APP_LOGIN_USER_2', user2);
  props.setProperty('APP_LOGIN_PASS_2', pass2);
  Logger.log('Kredensial login berhasil disimpan!');
  return { ok: true, user1: user1, user2: user2 };
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

  Logger.log('Database Wedding Fund berhasil disiapkan di: ' + ss.getUrl());
  return {
    spreadsheet: ss.getUrl(),
    tabs: Object.keys(SHEETS),
    instructions: 'Atur dua pasangan APP_LOGIN_USER/PASS di Script Properties sebelum deploy Web App.'
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

    if (sheetName === 'Budget' && merged.categoryId) {
      const duplicate = rows.slice(1).some(function(row) {
        return String(row[headers.indexOf('categoryId')]) === String(merged.categoryId) &&
          String(row[headers.indexOf('id')]) !== id;
      });
      if (duplicate) throw new Error('Kategori ini sudah memiliki anggaran. Ubah anggaran yang ada.');
    }

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
    if (sheetName === 'Vendors') validateVendorContract_(merged, id);

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
    'budgetTarget', 'motto', 'currency', 'remindersEnabled', 'reminderDays', 'roleLabels',
    'moodboardTheme', 'moodboardBrief', 'moodboardPalette',
    'venueLocation', 'rundownNotes', 'emergencyPic'
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
   SEEDER TEMPLATE PLANNER LENGKAP (IDEMPOTENT)
   ========================================================================== */

const PLANNER_TEMPLATES = {
  "Seserahan": [
    {
      "name": "Mahar (Mas Kawin)",
      "tab": "Seserahan",
      "group": "Ibadah & Mahar",
      "specs": "Uang tunai / emas perhiasan sesuai kesepakatan",
      "qty": 1,
      "unitPrice": 0,
      "estimatedAmount": 0,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Sesuai kesepakatan keluarga"
    },
    {
      "name": "Mukena",
      "tab": "Seserahan",
      "group": "Ibadah & Mahar",
      "specs": "dr tunangan",
      "qty": 1,
      "unitPrice": 0,
      "estimatedAmount": 0,
      "actualAmount": 0,
      "purchased": true,
      "owner": "Cowo",
      "notes": "Sudah ada dari tunangan"
    },
    {
      "name": "Al Qur'an",
      "tab": "Seserahan",
      "group": "Ibadah & Mahar",
      "specs": "Dari kado Ultah",
      "qty": 1,
      "unitPrice": 0,
      "estimatedAmount": 0,
      "actualAmount": 0,
      "purchased": true,
      "owner": "Cowo",
      "notes": "Kado ulang tahun sebelumnya"
    },
    {
      "name": "Sajadah",
      "tab": "Seserahan",
      "group": "Ibadah & Mahar",
      "specs": "couple",
      "shopUrl": "https://id.shp.ee/63ZYLfAA",
      "qty": 1,
      "unitPrice": 129600,
      "estimatedAmount": 129600,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Model couple turki"
    },
    {
      "name": "Piyama",
      "tab": "Seserahan",
      "group": "Pakaian",
      "specs": "couple",
      "shopUrl": "https://id.shp.ee/njVRFq3g",
      "qty": 1,
      "unitPrice": 110400,
      "estimatedAmount": 110400,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Satin silk couple"
    },
    {
      "name": "Dress",
      "tab": "Seserahan",
      "group": "Pakaian",
      "specs": "Warna pastel / earth tone",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 250000,
      "estimatedAmount": 250000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Gaun kasual elegan"
    },
    {
      "name": "Pakaian Dalam (Lingerie)",
      "tab": "Seserahan",
      "group": "Pakaian",
      "specs": "Set lingerie satin",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 150000,
      "estimatedAmount": 150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "1 set lengkap"
    },
    {
      "name": "Kerudung / Hijab",
      "tab": "Seserahan",
      "group": "Pakaian",
      "specs": "Pashmina / Voal premium",
      "shopUrl": "",
      "qty": 2,
      "unitPrice": 75000,
      "estimatedAmount": 150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Warna netral/earth tone"
    },
    {
      "name": "CD",
      "tab": "Seserahan",
      "group": "Pakaian",
      "specs": "Seamless nyaman",
      "shopUrl": "",
      "qty": 3,
      "unitPrice": 25000,
      "estimatedAmount": 75000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Paket 3 pcs"
    },
    {
      "name": "Bra",
      "tab": "Seserahan",
      "group": "Pakaian",
      "specs": "Set kawat / busa lembut",
      "shopUrl": "",
      "qty": 2,
      "unitPrice": 60000,
      "estimatedAmount": 120000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Warna nude/hitam"
    },
    {
      "name": "Tas",
      "tab": "Seserahan",
      "group": "Aksesoris",
      "specs": "sevine cream",
      "shopUrl": "https://id.shp.ee/CWmnXitz",
      "qty": 1,
      "unitPrice": 44720,
      "estimatedAmount": 44720,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Sling bag kasual"
    },
    {
      "name": "Sepatu",
      "tab": "Seserahan",
      "group": "Aksesoris",
      "specs": "cream white no 37",
      "shopUrl": "https://id.shp.ee/WESPcFix",
      "qty": 1,
      "unitPrice": 51600,
      "estimatedAmount": 51600,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Heels 5cm"
    },
    {
      "name": "Sandal",
      "tab": "Seserahan",
      "group": "Aksesoris",
      "specs": "cream coklat 37",
      "shopUrl": "https://id.shp.ee/AJyXKu39",
      "qty": 1,
      "unitPrice": 60000,
      "estimatedAmount": 60000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Sandal selop empuk"
    },
    {
      "name": "Foundation / Cushion",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "maybelline 128",
      "shopUrl": "https://id.shp.ee/jsRPNMoW",
      "qty": 1,
      "unitPrice": 100048,
      "estimatedAmount": 100048,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Shade 128 Warm Nude"
    },
    {
      "name": "Lip Tinted",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "wardah glasting",
      "shopUrl": "https://id.shp.ee/oVpbpcCu",
      "qty": 1,
      "unitPrice": 75000,
      "estimatedAmount": 75000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Glossy finish tahan lama"
    },
    {
      "name": "Kuas Make up",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "satu set",
      "shopUrl": "https://id.shp.ee/FjPqzC7E",
      "qty": 1,
      "unitPrice": 16125,
      "estimatedAmount": 16125,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Brush set isi 8"
    },
    {
      "name": "Powder",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "sea makeup",
      "shopUrl": "https://id.shp.ee/G4pfzrrS",
      "qty": 1,
      "unitPrice": 61100,
      "estimatedAmount": 61100,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Acne cover loose powder"
    },
    {
      "name": "Lip Cream",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "omg nude 11",
      "shopUrl": "https://id.shp.ee/BH9qoxNa",
      "qty": 1,
      "unitPrice": 20246,
      "estimatedAmount": 20246,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Matte finish nude"
    },
    {
      "name": "Eyeliner",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "pinkflash",
      "shopUrl": "https://id.shp.ee/FKyj8ZME",
      "qty": 1,
      "unitPrice": 24500,
      "estimatedAmount": 24500,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Waterproof hitam pekat"
    },
    {
      "name": "Eye Shadow",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "mgl",
      "shopUrl": "https://id.shp.ee/u6TyDLg1",
      "qty": 1,
      "unitPrice": 22152,
      "estimatedAmount": 22152,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Palette 9 warna warm"
    },
    {
      "name": "Setting Spray",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "seamakeup",
      "shopUrl": "https://id.shp.ee/cxmAr1iT",
      "qty": 1,
      "unitPrice": 71447,
      "estimatedAmount": 71447,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Lock makeup 16 jam"
    },
    {
      "name": "Blush On",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "hanasui",
      "shopUrl": "https://id.shp.ee/tSFFaSMW",
      "qty": 1,
      "unitPrice": 32175,
      "estimatedAmount": 32175,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Peach blush natural"
    },
    {
      "name": "Eye Brow",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "pinkflash",
      "shopUrl": "https://id.shp.ee/vbZMUuTJ",
      "qty": 1,
      "unitPrice": 18800,
      "estimatedAmount": 18800,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Pensil alis presisi cokelat"
    },
    {
      "name": "Maskara",
      "tab": "Seserahan",
      "group": "Make Up",
      "specs": "dazzle me pink",
      "shopUrl": "https://id.shp.ee/nFqb8RGt",
      "qty": 1,
      "unitPrice": 33187,
      "estimatedAmount": 33187,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Volumizing waterproof"
    },
    {
      "name": "Moisturizer",
      "tab": "Seserahan",
      "group": "Skin Care",
      "specs": "skin1004",
      "shopUrl": "https://id.shp.ee/4RzNLdZL",
      "qty": 1,
      "unitPrice": 332100,
      "estimatedAmount": 332100,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Centella soothing cream"
    },
    {
      "name": "Serum",
      "tab": "Seserahan",
      "group": "Skin Care",
      "specs": "Niacinamide / Hyaluronic",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 85000,
      "estimatedAmount": 85000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Mencerahkan dan melembabkan"
    },
    {
      "name": "Sunscreen",
      "tab": "Seserahan",
      "group": "Skin Care",
      "specs": "wardah acne calm",
      "shopUrl": "https://id.shp.ee/L4duyEYX",
      "qty": 1,
      "unitPrice": 94000,
      "estimatedAmount": 94000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "SPF 50 PA++++ ringan"
    },
    {
      "name": "Lotion",
      "tab": "Seserahan",
      "group": "Skin Care",
      "specs": "vaseline",
      "shopUrl": "https://id.shp.ee/6djkpsp4",
      "qty": 1,
      "unitPrice": 42500,
      "estimatedAmount": 42500,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Gluta-Hya Flawless Bright"
    },
    {
      "name": "Acne Spot",
      "tab": "Seserahan",
      "group": "Skin Care",
      "specs": "dr leo",
      "shopUrl": "https://id.shp.ee/HB7WiMU1",
      "qty": 1,
      "unitPrice": 72000,
      "estimatedAmount": 72000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Salep jerawat cepat kempes"
    },
    {
      "name": "Cleanser Micellar",
      "tab": "Seserahan",
      "group": "Skin Care",
      "specs": "npure",
      "shopUrl": "https://id.shp.ee/TJAN9YBj",
      "qty": 1,
      "unitPrice": 47000,
      "estimatedAmount": 47000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Pembersih wajah centella"
    },
    {
      "name": "Handuk",
      "tab": "Seserahan",
      "group": "Toiletries",
      "specs": "couple isi 2",
      "shopUrl": "https://id.shp.ee/kkKvF7NT",
      "qty": 1,
      "unitPrice": 94410,
      "estimatedAmount": 94410,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Handuk mandi bordir couple"
    },
    {
      "name": "Parfum",
      "tab": "Seserahan",
      "group": "Toiletries",
      "specs": "Eau de Parfum aroma manis",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 150000,
      "estimatedAmount": 150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Aroma vanila floral"
    },
    {
      "name": "Deodorant",
      "tab": "Seserahan",
      "group": "Toiletries",
      "specs": "rexona",
      "shopUrl": "https://id.shp.ee/Yo9v2JdH",
      "qty": 1,
      "unitPrice": 29429,
      "estimatedAmount": 29429,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Roll-on dry serum"
    },
    {
      "name": "Body Wash and Shampoo",
      "tab": "Seserahan",
      "group": "Toiletries",
      "specs": "cindynal",
      "shopUrl": "https://id.shp.ee/aSrH2UN5",
      "qty": 1,
      "unitPrice": 67620,
      "estimatedAmount": 67620,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Set sabun dan shampo wangi"
    },
    {
      "name": "Tempat kunci + box (Shopee)",
      "tab": "Souvenir",
      "group": "Souvenir Utama",
      "specs": "Gantungan kunci kayu eksklusif",
      "shopUrl": "https://s.shopee.co.id/6pxtxe1bCv?share_channel_code=1",
      "qty": 500,
      "unitPrice": 4300,
      "estimatedAmount": 2150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Kandidat 1 souvenir pernikahan lengkap dengan boks pita"
    },
    {
      "name": "Gelas plastik warna-warni (Shopee)",
      "tab": "Souvenir",
      "group": "Souvenir Utama",
      "specs": "Tumbler mini pastel",
      "shopUrl": "https://s.shopee.co.id/17ZpGrlGo?share_channel_code=1",
      "qty": 500,
      "unitPrice": 3000,
      "estimatedAmount": 1500000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Kandidat 2 souvenir alternatif murah meriah"
    },
    {
      "name": "Kebaya / Gaun Akad & Resepsi",
      "tab": "Belanja",
      "group": "Busana Mempelai Wanita",
      "specs": "Sewa/Jahit custom",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 3500000,
      "estimatedAmount": 3500000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Fitting di boutique"
    },
    {
      "name": "Manset & Daleman Kebaya",
      "tab": "Belanja",
      "group": "Busana Mempelai Wanita",
      "specs": "Warna kulit / senada",
      "shopUrl": "",
      "qty": 2,
      "unitPrice": 75000,
      "estimatedAmount": 150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Bahan adem tidak gerah"
    },
    {
      "name": "Sepatu Hak / Selop Pengantin",
      "tab": "Belanja",
      "group": "Busana Mempelai Wanita",
      "specs": "Payet mewah hak 5cm",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 350000,
      "estimatedAmount": 350000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Nyaman berdiri lama"
    },
    {
      "name": "Hijab Segiempat / Pashmina Silk & Ciput",
      "tab": "Belanja",
      "group": "Busana Mempelai Wanita",
      "specs": "Silk shimmer premium",
      "shopUrl": "",
      "qty": 2,
      "unitPrice": 100000,
      "estimatedAmount": 200000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Cadangan 1 pcs"
    },
    {
      "name": "Veil & Headpiece / Tiara",
      "tab": "Belanja",
      "group": "Busana Mempelai Wanita",
      "specs": "Mutiara zircon",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 250000,
      "estimatedAmount": 250000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Aksen rambut / hijab"
    },
    {
      "name": "Henna & Fake Nails Pengantin",
      "tab": "Belanja",
      "group": "Busana Mempelai Wanita",
      "specs": "White henna + kuku palsu",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 300000,
      "estimatedAmount": 300000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Dipasang H-1 sore"
    },
    {
      "name": "Jas / Beskap Akad & Resepsi",
      "tab": "Belanja",
      "group": "Busana Mempelai Pria",
      "specs": "Sewa lengkap celana",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 2500000,
      "estimatedAmount": 2500000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Fitting pas badan"
    },
    {
      "name": "Kemeja Putih & Dasi",
      "tab": "Belanja",
      "group": "Busana Mempelai Pria",
      "specs": "Katun premium",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 350000,
      "estimatedAmount": 350000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Dasi kupu/panjang senada tema"
    },
    {
      "name": "Celana Kain & Sabuk Kulit",
      "tab": "Belanja",
      "group": "Busana Mempelai Pria",
      "specs": "Hitam formal",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 400000,
      "estimatedAmount": 400000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Bahan wool touch"
    },
    {
      "name": "Sepatu Pantofel Pria",
      "tab": "Belanja",
      "group": "Busana Mempelai Pria",
      "specs": "Kulit asli hitam kilap",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 450000,
      "estimatedAmount": 450000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Ukuran pas & nyaman"
    },
    {
      "name": "Kaos Kaki & Manset Pria",
      "tab": "Belanja",
      "group": "Busana Mempelai Pria",
      "specs": "Hitam pekat tebal",
      "shopUrl": "",
      "qty": 2,
      "unitPrice": 37500,
      "estimatedAmount": 75000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Beli 2 pasang cadangan"
    },
    {
      "name": "Peci / Kopiah Hitam / Beludru",
      "tab": "Belanja",
      "group": "Busana Mempelai Pria",
      "specs": "Tinggi 9cm",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 120000,
      "estimatedAmount": 120000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Dipakai saat akad nikah"
    },
    {
      "name": "Facial Treatment & Peeling (H-1 Bulan)",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Wanita",
      "specs": "Klinik estetika",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 500000,
      "estimatedAmount": 500000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Membersihkan komedo & mencerahkan"
    },
    {
      "name": "Body Spa & Lulur Pengantin (H-1 Minggu)",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Wanita",
      "specs": "Paket pengantin tradisional",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 400000,
      "estimatedAmount": 400000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Relaksasi sebelum hari H"
    },
    {
      "name": "Hair Spa / Creambath",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Wanita",
      "specs": "Nutrisi rambut",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 250000,
      "estimatedAmount": 250000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Agar rambut berkilau"
    },
    {
      "name": "Manicure & Pedicure",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Wanita",
      "specs": "Kuku rapi dan bersih",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 200000,
      "estimatedAmount": 200000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Sebelum pasang fake nail"
    },
    {
      "name": "Waxing & Perawatan Ketiak / Kaki",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Wanita",
      "specs": "Sugar waxing",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 250000,
      "estimatedAmount": 250000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Bersih mulus tanpa iritasi"
    },
    {
      "name": "Vitamin Kulit & Suplemen Sehat",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Wanita",
      "specs": "Vitamin C & Glutathione",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 200000,
      "estimatedAmount": 200000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cewe",
      "notes": "Konsumsi rutin 2 bulan"
    },
    {
      "name": "Potong Rambut / Hair Styling (H-3 Hari)",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Pria",
      "specs": "Barbershop premium",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 80000,
      "estimatedAmount": 80000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Model rapi dan maskulin"
    },
    {
      "name": "Perawatan Wajah / Facial Bersih Pria",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Pria",
      "specs": "Deep cleansing",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 250000,
      "estimatedAmount": 250000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Menghilangkan kusam"
    },
    {
      "name": "Parfum & Body Mist Pria",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Pria",
      "specs": "Aroma segar maskulin woody",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 300000,
      "estimatedAmount": 300000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Tahan 8-12 jam"
    },
    {
      "name": "Vitamin & Suplemen Stamina",
      "tab": "Belanja",
      "group": "Perawatan Pra-Nikah Pria",
      "specs": "Zinc & B-Complex",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 150000,
      "estimatedAmount": 150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Jaga kebugaran menjelang hari H"
    },
    {
      "name": "Kotak Cincin Pernikahan (Custom Akrilik/Kayu)",
      "tab": "Belanja",
      "group": "Perlengkapan Akad & Ijab Kabul",
      "specs": "Ukiran nama & tanggal",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 200000,
      "estimatedAmount": 200000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Untuk cincin kawin sepasang"
    },
    {
      "name": "Buku Nikah & Map Dokumen KUA",
      "tab": "Belanja",
      "group": "Perlengkapan Akad & Ijab Kabul",
      "specs": "Sampul beludru emas",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 100000,
      "estimatedAmount": 100000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Menjaga dokumen aman rapi"
    },
    {
      "name": "Meja & Kursi Akad + Taplak Putih",
      "tab": "Belanja",
      "group": "Perlengkapan Akad & Ijab Kabul",
      "specs": "Sewa meja khusus akad",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 300000,
      "estimatedAmount": 300000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Jika tidak termasuk paket venue"
    },
    {
      "name": "Pulpen Tanda Tangan Ijab Kabul Eksklusif",
      "tab": "Belanja",
      "group": "Perlengkapan Akad & Ijab Kabul",
      "specs": "Warna gold mewah",
      "shopUrl": "",
      "qty": 2,
      "unitPrice": 25000,
      "estimatedAmount": 50000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Untuk dokumentasi foto"
    },
    {
      "name": "Nampan & Kain Alas Cincin / Mahar",
      "tab": "Belanja",
      "group": "Perlengkapan Akad & Ijab Kabul",
      "specs": "Nampan kuningan / kayu jati",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 150000,
      "estimatedAmount": 150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Alas penyerahan resmi"
    },
    {
      "name": "Box Seserahan Akrilik / Rotan (Sewa/Beli 8 Box)",
      "tab": "Belanja",
      "group": "Hantaran & Kemasan Seserahan",
      "specs": "Sewa 8 box hias",
      "shopUrl": "",
      "qty": 8,
      "unitPrice": 75000,
      "estimatedAmount": 600000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Termasuk rumput sintetis & alas"
    },
    {
      "name": "Jasa Hias & Tata Seserahan",
      "tab": "Belanja",
      "group": "Hantaran & Kemasan Seserahan",
      "specs": "Dekorasi bunga artifisial",
      "shopUrl": "",
      "qty": 8,
      "unitPrice": 50000,
      "estimatedAmount": 400000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Dikerjakan H-5 hari"
    },
    {
      "name": "Pita, Kertas Serut, & Bunga Hiasan",
      "tab": "Belanja",
      "group": "Hantaran & Kemasan Seserahan",
      "specs": "Warna senada tema",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 150000,
      "estimatedAmount": 150000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Perlengkapan finishing"
    },
    {
      "name": "Plastik Wrapping & Dust Bag Pengaman",
      "tab": "Belanja",
      "group": "Hantaran & Kemasan Seserahan",
      "specs": "Pelindung debu & hujan",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 75000,
      "estimatedAmount": 75000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Cowo",
      "notes": "Pengaman saat pengiriman"
    },
    {
      "name": "Plastik OPP & Label Undangan Fisik",
      "tab": "Belanja",
      "group": "Undangan & Souvenir",
      "specs": "Plastik bening + stiker label",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 120000,
      "estimatedAmount": 120000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Untuk 300 undangan cetak"
    },
    {
      "name": "Thank You Card Souvenir",
      "tab": "Belanja",
      "group": "Undangan & Souvenir",
      "specs": "Cetak kartu ucapan terima kasih",
      "shopUrl": "",
      "qty": 500,
      "unitPrice": 200,
      "estimatedAmount": 100000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Disematkan pada souvenir"
    },
    {
      "name": "Paper Bag / Goodie Bag Souvenir & Seragam",
      "tab": "Belanja",
      "group": "Undangan & Souvenir",
      "specs": "Tas kertas cokelat eksklusif",
      "shopUrl": "",
      "qty": 100,
      "unitPrice": 3000,
      "estimatedAmount": 300000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Untuk bingkisan panitia & VIP"
    },
    {
      "name": "Biaya Ongkir / Ekspedisi Pengiriman Undangan",
      "tab": "Belanja",
      "group": "Undangan & Souvenir",
      "specs": "JNE / J&T pengiriman luar kota",
      "shopUrl": "",
      "qty": 1,
      "unitPrice": 250000,
      "estimatedAmount": 250000,
      "actualAmount": 0,
      "purchased": false,
      "owner": "Bersama",
      "notes": "Kirim ke kerabat jauh"
    }
  ],
  "Checklist": [
    {
      "title": "Menentukan tanggal dan hari baik pernikahan",
      "group": "Timeline",
      "phase": "H-12 Bulan",
      "priority": "Wajib",
      "status": "Selesai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Konsultasi keluarga besar kedua belah pihak"
    },
    {
      "title": "Diskusi awal anggaran dan plafon biaya antar kedua keluarga",
      "group": "Timeline",
      "phase": "H-12 Bulan",
      "priority": "Wajib",
      "status": "Selesai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Menentukan kontribusi dan batas maksimal pengeluaran"
    },
    {
      "title": "Menentukan konsep pernikahan (tradisional/modern/intimate)",
      "group": "Timeline",
      "phase": "H-12 Bulan",
      "priority": "Penting",
      "status": "Selesai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Tema warna, adat budaya, dan format acara"
    },
    {
      "title": "Memilih dan booking venue / gedung pernikahan",
      "group": "Timeline",
      "phase": "H-12 Bulan",
      "priority": "Wajib",
      "status": "Berjalan",
      "owner": "Bersama",
      "estimatedAmount": 15000000,
      "notes": "Kunci tanggal sebelum slot penuh"
    },
    {
      "title": "Membuat estimasi jumlah tamu undangan (pax)",
      "group": "Timeline",
      "phase": "H-12 Bulan",
      "priority": "Wajib",
      "status": "Selesai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Target 500 tamu / 250 undangan"
    },
    {
      "title": "Mulai survei Wedding Organizer (WO) atau perencana",
      "group": "Timeline",
      "phase": "H-12 Bulan",
      "priority": "Penting",
      "status": "Berjalan",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Cari WO berpengalaman di venue terkait"
    },
    {
      "title": "Memilih dan booking katering pernikahan",
      "group": "Timeline",
      "phase": "H-9 Bulan",
      "priority": "Wajib",
      "status": "Berjalan",
      "owner": "Bersama",
      "estimatedAmount": 30000000,
      "notes": "Test food menu buffet dan gubukan"
    },
    {
      "title": "Memilih vendor dekorasi dan pelaminan",
      "group": "Timeline",
      "phase": "H-9 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 12000000,
      "notes": "Konsultasi sketsa pelaminan sesuai warna tema"
    },
    {
      "title": "Memilih fotografer dan videografer dokumentasi",
      "group": "Timeline",
      "phase": "H-9 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 8000000,
      "notes": "Paket foto akad, resepsi, dan cinematic video"
    },
    {
      "title": "Memilih MUA (Make Up Artist) dan busana pengantin",
      "group": "Timeline",
      "phase": "H-9 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "estimatedAmount": 10000000,
      "notes": "Booking tanggal MUA favorit"
    },
    {
      "title": "Menentukan model cincin kawin dan memesannya",
      "group": "Timeline",
      "phase": "H-9 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 6000000,
      "notes": "Custom grafir nama dan ukuran jari"
    },
    {
      "title": "Mengumpulkan daftar panitia dan keluarga inti",
      "group": "Timeline",
      "phase": "H-9 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Penerima tamu, saksi, dan penanggung jawab seserahan"
    },
    {
      "title": "Membeli seserahan dan hantaran bertahap",
      "group": "Timeline",
      "phase": "H-6 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "estimatedAmount": 3000000,
      "notes": "Beli saat promo belanja untuk hemat anggaran"
    },
    {
      "title": "Menentukan seragam keluarga dan bridesmaid / groomsmen",
      "group": "Timeline",
      "phase": "H-6 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 2000000,
      "notes": "Beli bahan kain seragam"
    },
    {
      "title": "Melakukan sesi foto pre-wedding",
      "group": "Timeline",
      "phase": "H-6 Bulan",
      "priority": "Opsional",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 4000000,
      "notes": "Outdoor / studio sesuai konsep"
    },
    {
      "title": "Memilih vendor undangan cetak dan undangan digital",
      "group": "Timeline",
      "phase": "H-6 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 2000000,
      "notes": "Desain undangan fisik dan link website"
    },
    {
      "title": "Memilih dan memesan souvenir pernikahan",
      "group": "Timeline",
      "phase": "H-6 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 2150000,
      "notes": "Pesan minimal 500 pcs dengan kemasan boks"
    },
    {
      "title": "Memilih vendor entertainment / musik / sound system",
      "group": "Timeline",
      "phase": "H-6 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 5000000,
      "notes": "Band akustik dan sound 5000 watt"
    },
    {
      "title": "Mengurus pendaftaran nikah di RT/RW, Kelurahan, & KUA",
      "group": "Timeline",
      "phase": "H-3 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 600000,
      "notes": "Surat pengantar N1-N4 dan berkas KUA"
    },
    {
      "title": "Mengikuti bimbingan pranikah (Suscatin) di KUA/Puskesmas",
      "group": "Timeline",
      "phase": "H-3 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Sertifikat bimbingan perkawinan"
    },
    {
      "title": "Tes kesehatan calon pengantin (Catin) di Puskesmas",
      "group": "Timeline",
      "phase": "H-3 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 150000,
      "notes": "Cek darah, vaksin TT, dan konseling gizi"
    },
    {
      "title": "Finalisasi daftar tamu dan alamat pengiriman undangan",
      "group": "Timeline",
      "phase": "H-3 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Kategori keluarga, kolega, dan teman"
    },
    {
      "title": "Fitting busana pengantin pertama",
      "group": "Timeline",
      "phase": "H-3 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Penyesuaian ukuran kebaya & jas"
    },
    {
      "title": "Menyusun rundown kasar hari-H bersama WO / keluarga",
      "group": "Timeline",
      "phase": "H-3 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Draft alur waktu akad sampai resepsi"
    },
    {
      "title": "Memilih MC akad dan resepsi",
      "group": "Timeline",
      "phase": "H-3 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 1500000,
      "notes": "MC berpengalaman memandu adat & protokoler"
    },
    {
      "title": "Distribusi kain seragam panitia dan keluarga",
      "group": "Timeline",
      "phase": "H-1 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Beri waktu 3-4 minggu untuk menjahit"
    },
    {
      "title": "Menyebarkan undangan cetak dan digital",
      "group": "Timeline",
      "phase": "H-1 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 250000,
      "notes": "Kirim undangan fisik & bagikan link web"
    },
    {
      "title": "Fitting busana pengantin terakhir (final fitting)",
      "group": "Timeline",
      "phase": "H-1 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Coba lengkap dengan selop dan aksesoris"
    },
    {
      "title": "Rapat koordinasi keluarga dan panitia (Technical Meeting)",
      "group": "Timeline",
      "phase": "H-1 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 500000,
      "notes": "Pembagian tugas detail tiap pos acara"
    },
    {
      "title": "Technical meeting bersama seluruh vendor di lokasi",
      "group": "Timeline",
      "phase": "H-1 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Cek alur listrik, tata letak, dan rundown"
    },
    {
      "title": "Finalisasi rundown acara detik-ke-detik",
      "group": "Timeline",
      "phase": "H-1 Bulan",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Disetujui kedua keluarga dan WO"
    },
    {
      "title": "Menyiapkan boks dan hiasan seserahan",
      "group": "Timeline",
      "phase": "H-1 Bulan",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Cowo",
      "estimatedAmount": 600000,
      "notes": "Antar barang ke jasa hias seserahan"
    },
    {
      "title": "Konfirmasi kehadiran tamu (RSVP tracking)",
      "group": "Timeline",
      "phase": "H-1 Minggu",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Penyesuaian porsi katering final"
    },
    {
      "title": "Pelunasan pembayaran seluruh vendor pernikahan",
      "group": "Timeline",
      "phase": "H-1 Minggu",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Simpan semua bukti kuitansi transfer"
    },
    {
      "title": "Menyiapkan koper seserahan dan mahar tunai/emas",
      "group": "Timeline",
      "phase": "H-1 Minggu",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "estimatedAmount": 0,
      "notes": "Simpan aman di tempat terkunci"
    },
    {
      "title": "Menyiapkan tas darurat pengantin (Emergency Kit)",
      "group": "Timeline",
      "phase": "H-1 Minggu",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "estimatedAmount": 0,
      "notes": "Obat, jarum, benang, touchup makeup"
    },
    {
      "title": "Gladi resik akad nikah dan serah terima pengantin",
      "group": "Timeline",
      "phase": "H-1 Minggu",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 0,
      "notes": "Latihan simulasi ijab kabul dan posisi duduk"
    },
    {
      "title": "Surat Pengantar RT/RW (N1-N4) Cewe",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Wanita",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Minta ke ketua RT dan RW domisili"
    },
    {
      "title": "Fotokopi KTP, KK, dan Akta Kelahiran Cewe",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Wanita",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Siapkan masing-masing 4 rangkap"
    },
    {
      "title": "Pas Foto Cewe background biru (2x3, 3x4, 4x6)",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Wanita",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Background biru polos berbusana rapi / hijab"
    },
    {
      "title": "Surat Keterangan Sehat & Vaksin TT Puskesmas Cewe",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Wanita",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Pemeriksaan kesehatan catin di Puskesmas terdekat"
    },
    {
      "title": "Fotokopi Ijazah Terakhir Cewe",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Wanita",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Untuk validasi kecocokan ejaan nama"
    },
    {
      "title": "Surat Izin Orang Tua (N5) jika usia di bawah 21 th",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Wanita",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Khusus catin berusia di bawah 21 tahun"
    },
    {
      "title": "Surat Pengantar RT/RW (N1-N4) Cowo",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Pria",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Minta ke pengurus RT/RW domisili pria"
    },
    {
      "title": "Surat Rekomendasi Nikah (N8) dari KUA Domisili Pria",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Pria",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Surat numpang nikah ke KUA tempat wanita menikah"
    },
    {
      "title": "Fotokopi KTP, KK, dan Akta Kelahiran Cowo",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Pria",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Siapkan masing-masing 4 rangkap"
    },
    {
      "title": "Pas Foto Cowo background biru (2x3, 3x4, 4x6)",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Pria",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Kemeja berkerah background biru polos"
    },
    {
      "title": "Surat Keterangan Sehat & Bebas Narkoba/Laboratorium Pria",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Pria",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Dari puskesmas atau faskes pemerintah"
    },
    {
      "title": "Fotokopi KTP Orang Tua / Wali Pria",
      "group": "Dokumen",
      "phase": "Dokumen Mempelai Pria",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Untuk verifikasi nasab & perwalian"
    },
    {
      "title": "Pendaftaran online Simkah (Kemenag)",
      "group": "Dokumen",
      "phase": "Prosedur KUA",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Akses portal simkah.kemenag.go.id"
    },
    {
      "title": "Pemeriksaan berkas dan validasi oleh penghulu KUA",
      "group": "Dokumen",
      "phase": "Prosedur KUA",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Kedua calon pengantin hadir langsung di KUA"
    },
    {
      "title": "Pembayaran biaya nikah luar KUA (PNBP Rp 600.000 ke Bank)",
      "group": "Dokumen",
      "phase": "Prosedur KUA",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "estimatedAmount": 600000,
      "notes": "Bayar via kode billing SIMPONI di bank/kantor pos"
    },
    {
      "title": "Mengikuti Kursus Calon Pengantin (Suscatin) KUA",
      "group": "Dokumen",
      "phase": "Prosedur KUA",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Bimbingan pranikah resmi Kemenag"
    },
    {
      "title": "Penentuan dan konfirmasi saksi nikah dari kedua belah pihak",
      "group": "Dokumen",
      "phase": "Prosedur KUA",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Fotokopi KTP saksi diserahkan ke KUA"
    },
    {
      "title": "Konfirmasi kehadiran penghulu di venue akad",
      "group": "Dokumen",
      "phase": "Prosedur KUA",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Hubungi penghulu tugas H-7 hari"
    },
    {
      "title": "Verifikasi berkas akta perkawinan (Catatan Sipil)",
      "group": "Dokumen",
      "phase": "Catatan Sipil",
      "priority": "Opsional",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Khusus pernikahan non-muslim di Disdukcapil"
    },
    {
      "title": "Penyiapan surat keterangan belum pernah menikah dari kelurahan",
      "group": "Dokumen",
      "phase": "Catatan Sipil",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Status lajang resmi dari kelurahan"
    },
    {
      "title": "Salinan putusan pengadilan/surat cerai mati (jika pernikahan ke-2)",
      "group": "Dokumen",
      "phase": "Catatan Sipil",
      "priority": "Opsional",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Akta cerai asli atau surat kematian"
    },
    {
      "title": "Surat perjanjian pra-nikah (Prenup) jika ada dari notaris",
      "group": "Dokumen",
      "phase": "Catatan Sipil",
      "priority": "Opsional",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Didaftarkan ke KUA sebelum akad nikah"
    },
    {
      "title": "Mengurus penerbitan Kartu Keluarga (KK) baru pasangan",
      "group": "Dokumen",
      "phase": "Update Dokumen Setelah Menikah",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Pemisahan KK dari orang tua ke Dukcapil"
    },
    {
      "title": "Update status perkawinan pada KTP Suami & Istri",
      "group": "Dokumen",
      "phase": "Update Dokumen Setelah Menikah",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Ubah status menjadi 'Kawin'"
    },
    {
      "title": "Update data kepesertaan BPJS Kesehatan keluarga",
      "group": "Dokumen",
      "phase": "Update Dokumen Setelah Menikah",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Gabungkan tanggungan suami istri"
    },
    {
      "title": "Update data NPWP / Pajak penghasilan bersama",
      "group": "Dokumen",
      "phase": "Update Dokumen Setelah Menikah",
      "priority": "Opsional",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Gabung NPWP atau pisah harta"
    },
    {
      "title": "Pembuatan Paspor baru (jika ganti nama/honeymoon luar negeri)",
      "group": "Dokumen",
      "phase": "Update Dokumen Setelah Menikah",
      "priority": "Opsional",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Permohonan e-paspor baru"
    },
    {
      "title": "Sterilisasi dan dekorasi venue akad & resepsi selesai",
      "group": "HariH",
      "phase": "Malam H-1",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pengecekan panggung pelaminan dan tata kursi"
    },
    {
      "title": "Cek sound system, mic wireless, dan pencahayaan",
      "group": "HariH",
      "phase": "Malam H-1",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pastikan frekuensi mic tidak bentrok"
    },
    {
      "title": "Pengantaran kotak seserahan & mahar ke lokasi",
      "group": "HariH",
      "phase": "Malam H-1",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Keluarga",
      "notes": "Disimpan aman di ruang VIP berkunci"
    },
    {
      "title": "Penyerahan busana dan aksesoris ke kamar rias pengantin",
      "group": "HariH",
      "phase": "Malam H-1",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Gaun, jas, selop, dan mahkota standby"
    },
    {
      "title": "Kedua mempelai istirahat dan tidur maksimal pukul 22.00",
      "group": "HariH",
      "phase": "Malam H-1",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Menjaga kebugaran dan kesegaran wajah"
    },
    {
      "title": "MUA tiba di lokasi / hotel pengantin",
      "group": "HariH",
      "phase": "Pagi 04.00–08.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "MUA",
      "notes": "Standby pukul 04.30 tepat"
    },
    {
      "title": "Sarapan pagi pengantin dan keluarga inti",
      "group": "HariH",
      "phase": "Pagi 04.00–08.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Sarapan bergizi sebelum makeup dimulai"
    },
    {
      "title": "Make-up dan tata busana mempelai wanita & pria",
      "group": "HariH",
      "phase": "Pagi 04.00–08.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "MUA",
      "notes": "Rias pengantin dilanjutkan keluarga inti"
    },
    {
      "title": "Fotografer standby untuk sesi foto persiapan (getting ready)",
      "group": "HariH",
      "phase": "Pagi 04.00–08.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Dokumentasi",
      "notes": "Foto gaun, cincin, sepatu, dan proses makeup"
    },
    {
      "title": "Briefing singkat panitia, saksi, dan penghulu",
      "group": "HariH",
      "phase": "Pagi 04.00–08.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pengecekan akhir saksi dan berkas KUA"
    },
    {
      "title": "Cek kelengkapan buku nikah, pulpen emas, dan meja akad",
      "group": "HariH",
      "phase": "Pagi 04.00–08.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pastikan mic penghulu berfungsi jelas"
    },
    {
      "title": "Mempelai pria dan keluarga tiba di lokasi akad",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Penyambutan di lobi depan"
    },
    {
      "title": "Prosesi penyambutan keluarga pria oleh keluarga wanita",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "MC",
      "notes": "Kalung bunga melati dan hantaran simbolis"
    },
    {
      "title": "Mempelai duduk di meja akad bersama wali dan saksi",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Posisi duduk sesuai arahan penghulu"
    },
    {
      "title": "Pembacaan ayat suci Al-Qur'an dan khutbah nikah",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Penghulu",
      "notes": "Suasana hening dan khidmat"
    },
    {
      "title": "Ijab kabul di depan penghulu dan para saksi",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Pengucapan ijab kabul tegas dan lancar"
    },
    {
      "title": "Penyerahan mahar dan cincin kawin",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Pemasangan cincin di jari manis"
    },
    {
      "title": "Penandatanganan buku nikah dan dokumen KUA",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Tanda tangan suami, istri, wali, dan saksi"
    },
    {
      "title": "Doa bersama dan sesi foto resmi buku nikah",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Dokumentasi",
      "notes": "Foto pamer buku nikah dan kartu nikah digital"
    },
    {
      "title": "Sungkeman kepada kedua orang tua",
      "group": "HariH",
      "phase": "Akad Nikah 08.00–10.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "MC",
      "notes": "Momen permohonan doa restu khidmat"
    },
    {
      "title": "Retouch makeup dan ganti busana resepsi",
      "group": "HariH",
      "phase": "Resepsi 10.00–14.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "MUA",
      "notes": "Jeda waktu 30 menit di ruang rias"
    },
    {
      "title": "Tim katering standby dan hidangan buffet mulai dibuka",
      "group": "HariH",
      "phase": "Resepsi 10.00–14.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Katering",
      "notes": "Makanan hangat siap dinikmati tamu"
    },
    {
      "title": "Kirab pengantin / grand entrance memasuki pelaminan",
      "group": "HariH",
      "phase": "Resepsi 10.00–14.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Diringi lagu romantis pilihan mempelai"
    },
    {
      "title": "Sambutan perwakilan keluarga dan doa bersama",
      "group": "HariH",
      "phase": "Resepsi 10.00–14.00",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "MC",
      "notes": "Ucapan terima kasih kepada para undangan"
    },
    {
      "title": "Ramah tamah, pemberian selamat di pelaminan, dan foto bersama",
      "group": "HariH",
      "phase": "Resepsi 10.00–14.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Antrean teratur dipandu tim WO"
    },
    {
      "title": "Live music / penampilan hiburan mengiringi resepsi",
      "group": "HariH",
      "phase": "Resepsi 10.00–14.00",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Entertainment",
      "notes": "Playlist lagu santai dan romantis"
    },
    {
      "title": "Lempar bunga / doorprize / games santai",
      "group": "HariH",
      "phase": "Resepsi 10.00–14.00",
      "priority": "Opsional",
      "status": "Belum mulai",
      "owner": "MC",
      "notes": "Momen seru bersama sahabat"
    },
    {
      "title": "Penutupan acara dan pelepasan tamu kehormatan",
      "group": "HariH",
      "phase": "Setelah Acara 14.00–16.00",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "MC",
      "notes": "Acara resepsi resmi berakhir"
    },
    {
      "title": "Makan siang santai keluarga besar dan panitia",
      "group": "HariH",
      "phase": "Setelah Acara 14.00–16.00",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Makan bersama melepas lelah"
    },
    {
      "title": "Serah terima amplop, kado, dan sisa katering ke keluarga",
      "group": "HariH",
      "phase": "Setelah Acara 14.00–16.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Keluarga",
      "notes": "Kotak amplop dibuka oleh penanggung jawab keluarga"
    },
    {
      "title": "Pembongkaran dekorasi dan pelunasan tip petugas gedung",
      "group": "HariH",
      "phase": "Setelah Acara 14.00–16.00",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pembersihan area ballroom"
    },
    {
      "title": "Pengembalian sewa busana dan properti yang disewa",
      "group": "HariH",
      "phase": "Pasca-Acara H+1..H+14",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pengecekan kelengkapan sewaan agar deposit cair"
    },
    {
      "title": "Pembagian souvenir sisa kepada kerabat terdekat",
      "group": "HariH",
      "phase": "Pasca-Acara H+1..H+14",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Bingkisan untuk tetangga dan panitia"
    },
    {
      "title": "Pengiriman ucapan terima kasih digital kepada tamu",
      "group": "HariH",
      "phase": "Pasca-Acara H+1..H+14",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Broadcast WhatsApp ucapan terima kasih & link foto"
    },
    {
      "title": "Review dan penerimaan teaser foto/video pernikahan",
      "group": "HariH",
      "phase": "Pasca-Acara H+1..H+14",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Dokumentasi",
      "notes": "Koreksi warna dan klip highlight"
    },
    {
      "title": "KTP Asli Mempelai & Fotokopi KK",
      "group": "EmergencyKit",
      "phase": "Dokumen Penting",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Wajib standby di tas panitia/WO"
    },
    {
      "title": "Fotokopi Berkas KUA & N1-N4",
      "group": "EmergencyKit",
      "phase": "Dokumen Penting",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Antisipasi verifikasi dadakan pihak KUA"
    },
    {
      "title": "Amplop Uang Cash Operasional / Tips",
      "group": "EmergencyKit",
      "phase": "Dokumen Penting",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Keluarga",
      "notes": "Uang pecahan Rp 10rb, 20rb, 50rb untuk tip"
    },
    {
      "title": "Printout Rundown Acara & Nomor Kontak Vendor",
      "group": "EmergencyKit",
      "phase": "Dokumen Penting",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pegang minimal 3 rangkap oleh PIC lapangan"
    },
    {
      "title": "Bukti Booking Venue & Surat Izin Keramaian",
      "group": "EmergencyKit",
      "phase": "Dokumen Penting",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Bila ada pemeriksaan aparat/pengelola gedung"
    },
    {
      "title": "Bedak Padat / Compact Powder & Spons Bersih",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Untuk usap keringat dan kilap minyak di wajah"
    },
    {
      "title": "Lipstik & Lip Gloss Touch-Up",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Warna sama dengan rekomendasi MUA"
    },
    {
      "title": "Kertas Minyak (Oil Blotting Paper)",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Menyerap minyak tanpa merusak riasan dasar"
    },
    {
      "title": "Lem Bulu Mata Tambahan (Eyelash Glue)",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "MUA",
      "notes": "Bila bulu mata copot terkena air mata haru"
    },
    {
      "title": "Cotton Bud (Korekan Kuping) & Kapas",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "MUA",
      "notes": "Koreksi maskara luntur di sudut mata"
    },
    {
      "title": "Jepit Lidi Hitam & Karet Rambut Cadangan",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "MUA",
      "notes": "Amankan sanggul atau hijab yang longgar"
    },
    {
      "title": "Jarum Pentul & Peniti Aneka Ukuran",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Darurat kain kebaya sobek / hijab melorot"
    },
    {
      "title": "Hair Spray Travel Size",
      "group": "EmergencyKit",
      "phase": "Makeup & Touch-up",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "MUA",
      "notes": "Merapikan anak rambut yang mencuat"
    },
    {
      "title": "Obat Pereda Sakit Kepala / Paracetamol",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Mencegah pusing akibat kelelahan dan kurang tidur"
    },
    {
      "title": "Obat Maag & Lambung (Antasida / Promag)",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Pengantin sering telat makan karena gugup"
    },
    {
      "title": "Minyak Angin Aromaterapi / Roll-on",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Mencegah mual atau masuk angin"
    },
    {
      "title": "Plester Luka (Hansaplast)",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Kaki lecet terkena sepatu heels baru"
    },
    {
      "title": "Obat Tetes Mata Steril",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Meredakan mata merah atau kelilipan debu"
    },
    {
      "title": "Tisu Basah Antiseptik & Tisu Kering",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Membersihkan noda kuah katering mendadak"
    },
    {
      "title": "Obat Antidiare / Norit",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Antisipasi perut kembung atau mules"
    },
    {
      "title": "Salep Pereda Pegal / Balsam",
      "group": "EmergencyKit",
      "phase": "Kesehatan & Darurat",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Untuk betis yang tegang berdiri lama di pelaminan"
    },
    {
      "title": "Sendal Selop Jepit Empuk",
      "group": "EmergencyKit",
      "phase": "Pakaian & Aksesoris Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Dipakai saat jeda akad ke resepsi agar kaki istirahat"
    },
    {
      "title": "Kaos Kaki & Manset Cadangan",
      "group": "EmergencyKit",
      "phase": "Pakaian & Aksesoris Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Bila kotor terkena cipratan air atau lumpur"
    },
    {
      "title": "Jarum & Benang Jahit Warna Senada",
      "group": "EmergencyKit",
      "phase": "Pakaian & Aksesoris Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Jahit darurat kancing jas lepas atau jahitan sobek"
    },
    {
      "title": "Gunting Kecil Lipat",
      "group": "EmergencyKit",
      "phase": "Pakaian & Aksesoris Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Potong benang atau tag label busana"
    },
    {
      "title": "Selotip Bolak-balik (Fashion Tape)",
      "group": "EmergencyKit",
      "phase": "Pakaian & Aksesoris Darurat",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Rekatkan kerah baju agar tidak tersingkap"
    },
    {
      "title": "Pembalut Wanita Cadangan",
      "group": "EmergencyKit",
      "phase": "Pakaian & Aksesoris Darurat",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Cewe",
      "notes": "Antisipasi siklus haid mendadak"
    },
    {
      "title": "Lint Roller / Pembersih Debu Jas",
      "group": "EmergencyKit",
      "phase": "Pakaian & Aksesoris Darurat",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "Cowo",
      "notes": "Bersihkan bulu/debu pada jas hitam pengantin pria"
    },
    {
      "title": "Air Mineral Botol Kecil dengan Sedotan",
      "group": "EmergencyKit",
      "phase": "Makanan & Minuman",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Wajib minum pakai sedotan agar lipstik tidak luntur"
    },
    {
      "title": "Permen Mint Penyegar Nafas",
      "group": "EmergencyKit",
      "phase": "Makanan & Minuman",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "Bersama",
      "notes": "Mencegah bau mulut saat menyapa ratusan tamu"
    },
    {
      "title": "Coklat Bar / Biskuit Energi",
      "group": "EmergencyKit",
      "phase": "Makanan & Minuman",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Ganjal perut cepat saat lapar di pelaminan"
    },
    {
      "title": "Minuman Isotonik",
      "group": "EmergencyKit",
      "phase": "Makanan & Minuman",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Kembalikan cairan tubuh saat lelah"
    },
    {
      "title": "Powerbank Kapasitas Besar & Kabel Charger",
      "group": "EmergencyKit",
      "phase": "Elektronik & Lain-lain",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Baterai HP pengantin, WO, dan keluarga harus aman"
    },
    {
      "title": "Kipas Angin Portabel Mini Rechargeable",
      "group": "EmergencyKit",
      "phase": "Elektronik & Lain-lain",
      "priority": "Wajib",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Sangat krusial saat pelaminan gerah dan AC drop"
    },
    {
      "title": "Payung Lipat",
      "group": "EmergencyKit",
      "phase": "Elektronik & Lain-lain",
      "priority": "Penting",
      "status": "Belum mulai",
      "owner": "WO",
      "notes": "Antisipasi hujan saat perpindahan mobil ke lobi gedung"
    }
  ],
  "Rundown": [
    {
      "time": "05.00 - 06.30",
      "duration": "90 m",
      "session": "Persiapan Pagi",
      "activity": "Makeup dan Busana Pengantin (Mempelai Wanita & Pria)",
      "pic": "MUA & WO",
      "equipment": "Kamar rias, gaun, jas, perlengkapan makeup",
      "completed": false,
      "notes": "Mempelai wanita mulai makeup pukul 05.00, pria pukul 06.00",
      "sortOrder": 1
    },
    {
      "time": "06.30 - 07.15",
      "duration": "45 m",
      "session": "Persiapan Pagi",
      "activity": "Sarapan & Getting Ready Photoshoot",
      "pic": "Fotografer & WO",
      "equipment": "Kamera, lighting, sarapan bergizi",
      "completed": false,
      "notes": "Sesi foto detail cincin, gaun, dan potret pengantin siap",
      "sortOrder": 2
    },
    {
      "time": "07.15 - 07.45",
      "duration": "30 m",
      "session": "Persiapan Pagi",
      "activity": "Briefing Panitia & Final Check Meja Akad",
      "pic": "Ketua Panitia / WO",
      "equipment": "Sound system, meja akad, buku nikah, pulpen emas",
      "completed": false,
      "notes": "Pastikan saksi kedua pihak sudah hadir di lokasi",
      "sortOrder": 3
    },
    {
      "time": "07.45 - 08.00",
      "duration": "15 m",
      "session": "Akad Nikah",
      "activity": "Kedatangan Calon Mempelai Pria & Rombongan Keluarga",
      "pic": "Penerima Tamu & MC",
      "equipment": "Musik instrumen sambutan, kalung melati",
      "completed": false,
      "notes": "Rombongan pria disambut keluarga wanita di pintu masuk",
      "sortOrder": 4
    },
    {
      "time": "08.00 - 08.15",
      "duration": "15 m",
      "session": "Akad Nikah",
      "activity": "Prosesi Penyambutan & Penyerahan Seserahan Simbolis",
      "pic": "MC & Jubir Keluarga",
      "equipment": "Kotak seserahan simbolis, mikrofon",
      "completed": false,
      "notes": "Sambutan hangat kedua juru bicara keluarga",
      "sortOrder": 5
    },
    {
      "time": "08.15 - 08.25",
      "duration": "10 m",
      "session": "Akad Nikah",
      "activity": "Pembacaan Ayat Suci Al-Qur'an & Saritilawah",
      "pic": "Qori & Saritilawah",
      "equipment": "Al-Qur'an, stand mic",
      "completed": false,
      "notes": "Surat An-Nisa / Ar-Rum",
      "sortOrder": 6
    },
    {
      "time": "08.25 - 08.35",
      "duration": "10 m",
      "session": "Akad Nikah",
      "activity": "Khutbah Nikah oleh Penghulu KUA",
      "pic": "Penghulu KUA",
      "equipment": "Meja akad, mic wireless",
      "completed": false,
      "notes": "Nasihat pentingnya ikatan suci pernikahan",
      "sortOrder": 7
    },
    {
      "time": "08.35 - 08.45",
      "duration": "10 m",
      "session": "Akad Nikah",
      "activity": "Prosesi Ijab Kabul & Pengesahan oleh Para Saksi",
      "pic": "Wali Nikah & Mempelai Pria",
      "equipment": "Meja akad, para saksi",
      "completed": false,
      "notes": "Momen puncak ijab kabul dalam satu tarikan nafas",
      "sortOrder": 8
    },
    {
      "time": "08.45 - 09.00",
      "duration": "15 m",
      "session": "Akad Nikah",
      "activity": "Penyerahan Mahar & Pemasangan Cincin Kawin",
      "pic": "Mempelai Pria & Wanita",
      "equipment": "Boks mahar, kotak cincin",
      "completed": false,
      "notes": "Mempelai wanita dihadirkan ke meja akad nikah",
      "sortOrder": 9
    },
    {
      "time": "09.00 - 09.15",
      "duration": "15 m",
      "session": "Akad Nikah",
      "activity": "Penandatanganan Buku Nikah & Dokumen KUA",
      "pic": "Penghulu & Mempelai",
      "equipment": "Buku nikah resmi, pulpen emas",
      "completed": false,
      "notes": "Foto bersama buku nikah resmi",
      "sortOrder": 10
    },
    {
      "time": "09.15 - 09.30",
      "duration": "15 m",
      "session": "Akad Nikah",
      "activity": "Nasihat Perkawinan Singkat & Doa Bersama",
      "pic": "Tokoh Agama / Sesepuh",
      "equipment": "Mic wireless",
      "completed": false,
      "notes": "Doa memohon keluarga sakinah mawaddah warahmah",
      "sortOrder": 11
    },
    {
      "time": "09.30 - 09.50",
      "duration": "20 m",
      "session": "Akad Nikah",
      "activity": "Prosesi Sungkeman kepada Kedua Orang Tua",
      "pic": "MC & Kedua Orang Tua",
      "equipment": "Kursi sungkem, musik instrumental haru",
      "completed": false,
      "notes": "Momen emosional memohon maaf dan restu orang tua",
      "sortOrder": 12
    },
    {
      "time": "09.50 - 10.15",
      "duration": "25 m",
      "session": "Akad Nikah",
      "activity": "Foto Bersama Keluarga Inti Akad",
      "pic": "Fotografer & WO",
      "equipment": "Kamera, backdrop akad",
      "completed": false,
      "notes": "Keluarga inti pria, wanita, saksi, dan penghulu",
      "sortOrder": 13
    },
    {
      "time": "10.15 - 10.45",
      "duration": "30 m",
      "session": "Pembukaan Resepsi",
      "activity": "Retouch Makeup & Ganti Busana Resepsi",
      "pic": "MUA & Wardrobe",
      "equipment": "Gaun resepsi, aksesoris pengantin",
      "completed": false,
      "notes": "Istirahat sejenak sambil minum air kelapa/mineral",
      "sortOrder": 14
    },
    {
      "time": "10.45 - 11.00",
      "duration": "15 m",
      "session": "Pembukaan Resepsi",
      "activity": "Standby Katering, Penerima Tamu, & Audio Musik",
      "pic": "Tim Katering & Penerima Tamu",
      "equipment": "Buku tamu, souvenir, buffet makanan",
      "completed": false,
      "notes": "Pintu ballroom dibuka untuk menyambut para tamu undangan",
      "sortOrder": 15
    },
    {
      "time": "11.00 - 11.15",
      "duration": "15 m",
      "session": "Pembukaan Resepsi",
      "activity": "Grand Entrance / Kirab Pengantin Masuk Pelaminan",
      "pic": "MC & Pengiring Pengantin",
      "equipment": "Lagu grand entrance, confetti",
      "completed": false,
      "notes": "Diiringi bridesmaid & groomsmen menuju panggung pelaminan",
      "sortOrder": 16
    },
    {
      "time": "11.15 - 11.25",
      "duration": "10 m",
      "session": "Pembukaan Resepsi",
      "activity": "Sambutan Selamat Datang Perwakilan Keluarga",
      "pic": "Juru Bicara Keluarga",
      "equipment": "Mic wireless",
      "completed": false,
      "notes": "Ucapan terima kasih atas kehadiran para tamu kehormatan",
      "sortOrder": 17
    },
    {
      "time": "11.25 - 11.35",
      "duration": "10 m",
      "session": "Pembukaan Resepsi",
      "activity": "Doa Berkah untuk Mempelai & Jamuan",
      "pic": "Pemimpin Doa",
      "equipment": "Mic wireless",
      "completed": false,
      "notes": "Mempersilakan tamu menikmati hidangan yang disediakan",
      "sortOrder": 18
    },
    {
      "time": "11.35 - 12.30",
      "duration": "55 m",
      "session": "Acara Inti",
      "activity": "Ramah Tamah, Makan Siang, & Pemberian Ucapan Selamat Sesi 1",
      "pic": "MC & WO",
      "equipment": "Buffet katering, musik pengiring",
      "completed": false,
      "notes": "Tamu VIP dan keluarga bersalaman di pelaminan",
      "sortOrder": 19
    },
    {
      "time": "12.30 - 12.45",
      "duration": "15 m",
      "session": "Acara Inti",
      "activity": "Penampilan Spesial / Duet Pengantin / Musik",
      "pic": "Pengantin & Akustik Band",
      "equipment": "Alat musik, audio visual",
      "completed": false,
      "notes": "Lagu romantis persembahan mempelai",
      "sortOrder": 20
    },
    {
      "time": "12.45 - 13.30",
      "duration": "45 m",
      "session": "Acara Inti",
      "activity": "Ramah Tamah, Makan Siang, & Foto Bersama Tamu Sesi 2",
      "pic": "Fotografer & WO",
      "equipment": "Kamera, panggung pelaminan",
      "completed": false,
      "notes": "Sesi foto bergantian rombongan tamu rekan kantor & teman",
      "sortOrder": 21
    },
    {
      "time": "13.30 - 13.45",
      "duration": "15 m",
      "session": "Acara Inti",
      "activity": "Lempar Hand Bouquet / Doorprize Tamu",
      "pic": "MC & Pengantin",
      "equipment": "Buket bunga segar, merchandise",
      "completed": false,
      "notes": "Momen seru untuk teman-teman lajang",
      "sortOrder": 22
    },
    {
      "time": "13.45 - 14.15",
      "duration": "30 m",
      "session": "Acara Inti",
      "activity": "Foto Bersama Teman Kerja, Komunitas, & Sahabat",
      "pic": "MC & Fotografer",
      "equipment": "Kamera, panggung pelaminan",
      "completed": false,
      "notes": "Foto gaya bebas bersama bridesmaid & groomsmen",
      "sortOrder": 23
    },
    {
      "time": "14.15 - 14.30",
      "duration": "15 m",
      "session": "Penutupan",
      "activity": "Sesi Foto Terakhir Pengantin & Seluruh Panitia WO",
      "pic": "Fotografer & Seluruh Panitia",
      "equipment": "Kamera",
      "completed": false,
      "notes": "Foto bersama seluruh kru yang bertugas",
      "sortOrder": 24
    },
    {
      "time": "14.30 - 15.00",
      "duration": "30 m",
      "session": "Penutupan",
      "activity": "Pengantin Meninggalkan Pelaminan & Makan Santai",
      "pic": "WO & Keluarga",
      "equipment": "Ruang istirahat pengantin",
      "completed": false,
      "notes": "Pengantin makan siang dengan tenang di ruang VIP",
      "sortOrder": 25
    },
    {
      "time": "15.00 - 15.30",
      "duration": "30 m",
      "session": "Penutupan",
      "activity": "Serah Terima Kotak Amplop, Kado, & Sisa Souvenir",
      "pic": "Keluarga Inti & WO",
      "equipment": "Mobil keluarga, brankas amplop",
      "completed": false,
      "notes": "Pengecekan keamanan dan penghitungan jumlah kotak amplop",
      "sortOrder": 26
    },
    {
      "time": "15.30 - 16.00",
      "duration": "30 m",
      "session": "Penutupan",
      "activity": "Pembongkaran Dekorasi & Pamitan Vendor",
      "pic": "Seluruh Vendor & WO",
      "equipment": "Truk angkut perlengkapan",
      "completed": false,
      "notes": "Pemeriksaan venue bebas dari barang tertinggal",
      "sortOrder": 27
    }
  ],
  "BudgetItems": [
    {
      "title": "Sewa Gedung / Aula Pernikahan",
      "group": "Venue & Gedung",
      "qty": 1,
      "unitPrice": 15000000,
      "plannedAmount": 15000000,
      "actualAmount": 0,
      "vendorName": "Pengelola Gedung",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Kapasitas 600 orang termasuk AC & listrik dasar"
    },
    {
      "title": "Biaya Listrik & Tambahan Genset",
      "group": "Venue & Gedung",
      "qty": 1,
      "unitPrice": 2000000,
      "plannedAmount": 2000000,
      "actualAmount": 0,
      "vendorName": "Vendor Genset",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Backup genset 60 KVA antisipasi mati lampu"
    },
    {
      "title": "Biaya Kebersihan & Keamanan Gedung",
      "group": "Venue & Gedung",
      "qty": 1,
      "unitPrice": 1000000,
      "plannedAmount": 1000000,
      "actualAmount": 0,
      "vendorName": "Pengelola Gedung",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Jasa kebersihan sebelum dan sesudah acara"
    },
    {
      "title": "Sewa Kursi & Meja Ekstra Tamu",
      "group": "Venue & Gedung",
      "qty": 100,
      "unitPrice": 10000,
      "plannedAmount": 1000000,
      "actualAmount": 0,
      "vendorName": "Persewaan Tenda",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Kursi futura + cover putih ketat"
    },
    {
      "title": "Paket Prasmanan Utama (Buffet 500 Pax)",
      "group": "Catering & Konsumsi",
      "qty": 500,
      "unitPrice": 45000,
      "plannedAmount": 22500000,
      "actualAmount": 0,
      "vendorName": "Berkah Catering",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Menu 6 lauk utama + sup + salad + buah segar"
    },
    {
      "title": "Pondokan 1 - Kambing Guling (2 Ekor)",
      "group": "Catering & Konsumsi",
      "qty": 2,
      "unitPrice": 2000000,
      "plannedAmount": 4000000,
      "actualAmount": 0,
      "vendorName": "Berkah Catering",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Lengkap lontong, acar, dan kecap pedas"
    },
    {
      "title": "Pondokan 2 - Bakso Malang (300 Porsi)",
      "group": "Catering & Konsumsi",
      "qty": 300,
      "unitPrice": 12000,
      "plannedAmount": 3600000,
      "actualAmount": 0,
      "vendorName": "Berkah Catering",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Pangsit goreng, bakso urat, dan kuah sedap"
    },
    {
      "title": "Pondokan 3 - Es Krim & Aneka Dessert (300 Cup)",
      "group": "Catering & Konsumsi",
      "qty": 300,
      "unitPrice": 8000,
      "plannedAmount": 2400000,
      "actualAmount": 0,
      "vendorName": "Berkah Catering",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Es krim 3 rasa dan pudding buah segar"
    },
    {
      "title": "Makanan Keluarga & Panitia Pagi Akad (50 Pax)",
      "group": "Catering & Konsumsi",
      "qty": 50,
      "unitPrice": 25000,
      "plannedAmount": 1250000,
      "actualAmount": 0,
      "vendorName": "Dapur Bu Siti",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Nasi kotak lengkap sarapan sebelum acara dimulai"
    },
    {
      "title": "Air Mineral Gelas & Botol Ekstra",
      "group": "Catering & Konsumsi",
      "qty": 20,
      "unitPrice": 30000,
      "plannedAmount": 600000,
      "actualAmount": 0,
      "vendorName": "Agen Minuman",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "20 dus air mineral gelas cadangan"
    },
    {
      "title": "Dekorasi Pelaminan Resepsi Modern",
      "group": "Dekorasi & Tata Panggung",
      "qty": 1,
      "unitPrice": 12000000,
      "plannedAmount": 12000000,
      "actualAmount": 0,
      "vendorName": "Pesona Dekor",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Pelaminan bunga segar kombinasi artificial elegan lebar 8 meter"
    },
    {
      "title": "Dekorasi Lorong Masuk & Gazebo Kirab",
      "group": "Dekorasi & Tata Panggung",
      "qty": 1,
      "unitPrice": 3500000,
      "plannedAmount": 3500000,
      "actualAmount": 0,
      "vendorName": "Pesona Dekor",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Gazebo bunga jalan menuju pelaminan"
    },
    {
      "title": "Meja Akad Nikah + Bunga Segar",
      "group": "Dekorasi & Tata Panggung",
      "qty": 1,
      "unitPrice": 1500000,
      "plannedAmount": 1500000,
      "actualAmount": 0,
      "vendorName": "Pesona Dekor",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Taplak putih mewah & centerpiece bunga segar"
    },
    {
      "title": "Photobooth Corner Tamu + Lampu",
      "group": "Dekorasi & Tata Panggung",
      "qty": 1,
      "unitPrice": 2000000,
      "plannedAmount": 2000000,
      "actualAmount": 0,
      "vendorName": "Pesona Dekor",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Backdrop foto instagramable untuk tamu"
    },
    {
      "title": "Karpet Jalan & Janur Kuning Pintu Masuk",
      "group": "Dekorasi & Tata Panggung",
      "qty": 1,
      "unitPrice": 1000000,
      "plannedAmount": 1000000,
      "actualAmount": 0,
      "vendorName": "Pesona Dekor",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Karpet merah / rose gold 20 meter + 2 janur kuning kembar mayang"
    },
    {
      "title": "Sewa Gaun Pengantin Akad & Resepsi (2 Pasang)",
      "group": "Busana Pengantin & Riasan",
      "qty": 2,
      "unitPrice": 3000000,
      "plannedAmount": 6000000,
      "actualAmount": 0,
      "vendorName": "Griya Pengantin Cantik",
      "dpPaid": false,
      "checked": false,
      "owner": "Cewe",
      "notes": "Kebaya akad putih bersih & gaun resepsi warna pastel"
    },
    {
      "title": "Sewa Jas Pengantin Pria Lengkap (2 Pasang)",
      "group": "Busana Pengantin & Riasan",
      "qty": 2,
      "unitPrice": 1500000,
      "plannedAmount": 3000000,
      "actualAmount": 0,
      "vendorName": "Griya Pengantin Cantik",
      "dpPaid": false,
      "checked": false,
      "owner": "Cowo",
      "notes": "Beskap akad & setelan jas modern resepsi"
    },
    {
      "title": "Makeup Pengantin (Akad + Retouch Resepsi)",
      "group": "Busana Pengantin & Riasan",
      "qty": 1,
      "unitPrice": 4000000,
      "plannedAmount": 4000000,
      "actualAmount": 0,
      "vendorName": "MUA Cantika",
      "dpPaid": false,
      "checked": false,
      "owner": "Cewe",
      "notes": "Makeup flawless tahan lama anti luntur"
    },
    {
      "title": "Rias & Busana Orang Tua (2 Pasang Ayah & Ibu)",
      "group": "Busana Pengantin & Riasan",
      "qty": 4,
      "unitPrice": 500000,
      "plannedAmount": 2000000,
      "actualAmount": 0,
      "vendorName": "MUA Cantika",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Kebaya ibu & beskap bapak kedua mempelai"
    },
    {
      "title": "Rias & Busana Bridesmaid / Pagar Ayu (6 Orang)",
      "group": "Busana Pengantin & Riasan",
      "qty": 6,
      "unitPrice": 250000,
      "plannedAmount": 1500000,
      "actualAmount": 0,
      "vendorName": "MUA Asisten",
      "dpPaid": false,
      "checked": false,
      "owner": "Cewe",
      "notes": "Makeup natural & pasang hijab"
    },
    {
      "title": "Aksesoris & Hand Bouquet Melati Asli",
      "group": "Busana Pengantin & Riasan",
      "qty": 1,
      "unitPrice": 800000,
      "plannedAmount": 800000,
      "actualAmount": 0,
      "vendorName": "Florist Cantik",
      "dpPaid": false,
      "checked": false,
      "owner": "Cewe",
      "notes": "Ronce melati akad & hand bouquet mawar segar resepsi"
    },
    {
      "title": "Jasa Fotografer (2 Kamera) & Album Kolase",
      "group": "Dokumentasi Foto & Video",
      "qty": 1,
      "unitPrice": 4500000,
      "plannedAmount": 4500000,
      "actualAmount": 0,
      "vendorName": "Lensa Abadi Studio",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "2 fotografer profesional, all raw photos + 1 album kolase mewah"
    },
    {
      "title": "Cinematic Video Teaser & Full Documentation",
      "group": "Dokumentasi Foto & Video",
      "qty": 1,
      "unitPrice": 4000000,
      "plannedAmount": 4000000,
      "actualAmount": 0,
      "vendorName": "Lensa Abadi Studio",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Video teaser 1 menit (Reels/IG) & video dokumentasi 30 menit"
    },
    {
      "title": "Drone Aerial Video Footage",
      "group": "Dokumentasi Foto & Video",
      "qty": 1,
      "unitPrice": 1500000,
      "plannedAmount": 1500000,
      "actualAmount": 0,
      "vendorName": "Pilot Drone",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Pengambilan gambar udara venue dan prosesi kirab"
    },
    {
      "title": "Live Acoustic Band / Musik Pengiring",
      "group": "Entertainment & Sound",
      "qty": 1,
      "unitPrice": 3500000,
      "plannedAmount": 3500000,
      "actualAmount": 0,
      "vendorName": "Harmoni Band",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "1 vokalis wanita, 1 gitar, 1 keyboard, 1 bass/cajon (3 jam)"
    },
    {
      "title": "Sound System 5000 Watt + Operator",
      "group": "Entertainment & Sound",
      "qty": 1,
      "unitPrice": 2500000,
      "plannedAmount": 2500000,
      "actualAmount": 0,
      "vendorName": "Audio Pro",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "4 speaker aktif, 4 mic wireless, mixer & kabel lengkap"
    },
    {
      "title": "Master of Ceremony (MC) Akad & Resepsi",
      "group": "Entertainment & Sound",
      "qty": 1,
      "unitPrice": 1500000,
      "plannedAmount": 1500000,
      "actualAmount": 0,
      "vendorName": "MC Profesional",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "MC berpengalaman memandu adat dan formal resepsi"
    },
    {
      "title": "Cetak Undangan Fisik Hardcover/Softcover (300 Pcs)",
      "group": "Undangan & Souvenir",
      "qty": 300,
      "unitPrice": 6000,
      "plannedAmount": 1800000,
      "actualAmount": 0,
      "vendorName": "Percetakan Amanah",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Desain custom gold foil + amplop + plastik opp"
    },
    {
      "title": "Website Undangan Digital RSVP",
      "group": "Undangan & Souvenir",
      "qty": 1,
      "unitPrice": 250000,
      "plannedAmount": 250000,
      "actualAmount": 0,
      "vendorName": "Katalog Nikah",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Domain aktif 1 tahun, galeri foto, lagu autoplay, RSVP WhatsApp"
    },
    {
      "title": "Souvenir Cantik + Kemasan Box (500 Pcs)",
      "group": "Undangan & Souvenir",
      "qty": 500,
      "unitPrice": 4300,
      "plannedAmount": 2150000,
      "actualAmount": 0,
      "vendorName": "Shopee Souvenir",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Gantungan kunci kayu eksklusif lengkap boks pita & thank you card"
    },
    {
      "title": "Mahar Emas Logam Mulia / Uang Bingkai",
      "group": "Mahar & Seserahan",
      "qty": 1,
      "unitPrice": 5000000,
      "plannedAmount": 5000000,
      "actualAmount": 0,
      "vendorName": "Toko Emas Mulia",
      "dpPaid": false,
      "checked": false,
      "owner": "Cowo",
      "notes": "Logam mulia 5 gram dibingkai kaca akrilik 3D"
    },
    {
      "title": "Boks & Jasa Hias Seserahan Hantaran (8 Box)",
      "group": "Mahar & Seserahan",
      "qty": 8,
      "unitPrice": 125000,
      "plannedAmount": 1000000,
      "actualAmount": 0,
      "vendorName": "Hantaran Cantik",
      "dpPaid": false,
      "checked": false,
      "owner": "Cowo",
      "notes": "Box akrilik tutup bening dihias bunga cantik"
    },
    {
      "title": "Cincin Kawin Sepasang (Emas & Palladium)",
      "group": "Mahar & Seserahan",
      "qty": 1,
      "unitPrice": 6000000,
      "plannedAmount": 6000000,
      "actualAmount": 0,
      "vendorName": "Jewelry Art",
      "dpPaid": false,
      "checked": false,
      "owner": "Cowo",
      "notes": "Emas wanita 3 gram, palladium pria 4 gram + grafir nama"
    },
    {
      "title": "Mobil Pengantin + Hiasan Pita Bunga",
      "group": "Transportasi & Akomodasi",
      "qty": 1,
      "unitPrice": 1200000,
      "plannedAmount": 1200000,
      "actualAmount": 0,
      "vendorName": "Rental Mobil Mewah",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Sewa sedan hitam + driver + bensin + dekorasi bunga mobil"
    },
    {
      "title": "Sewa Bus/Elf Rombongan Keluarga",
      "group": "Transportasi & Akomodasi",
      "qty": 1,
      "unitPrice": 1500000,
      "plannedAmount": 1500000,
      "actualAmount": 0,
      "vendorName": "Trans Wisata",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Antar jemput rombongan keluarga dari rumah ke gedung"
    },
    {
      "title": "Kamar Hotel Persiapan Pengantin (2 Malam)",
      "group": "Transportasi & Akomodasi",
      "qty": 2,
      "unitPrice": 750000,
      "plannedAmount": 1500000,
      "actualAmount": 0,
      "vendorName": "Hotel Mitra Venue",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Kamar rias dan istirahat dekat gedung pernikahan"
    },
    {
      "title": "Biaya Penghulu KUA Luar Kantor (PNBP)",
      "group": "Administrasi & Lain-lain",
      "qty": 1,
      "unitPrice": 600000,
      "plannedAmount": 600000,
      "actualAmount": 0,
      "vendorName": "Kemenag KUA",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Tarif resmi PNBP akad nikah di luar jam kerja/luar kantor KUA"
    },
    {
      "title": "Dana Darurat & Tips Kru Gedung/Katering",
      "group": "Administrasi & Lain-lain",
      "qty": 1,
      "unitPrice": 3000000,
      "plannedAmount": 3000000,
      "actualAmount": 0,
      "vendorName": "Kas Bersama",
      "dpPaid": false,
      "checked": false,
      "owner": "Bersama",
      "notes": "Kas siap pakai hari-H untuk uang tip parkir, kebersihan, & kebutuhan mendadak"
    }
  ],
  "Guests": [
    {
      "name": "Keluarga Inti Mempelai Wanita",
      "group": "Keluarga",
      "pax": 15,
      "relation": "Keluarga Inti Cewe",
      "phone": "",
      "address": "Kota Asal",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Meja VIP Depan"
    },
    {
      "name": "Keluarga Besar Mempelai Wanita",
      "group": "Keluarga",
      "pax": 40,
      "relation": "Famili Cewe",
      "phone": "",
      "address": "Kota Asal",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Rombongan paman, bibi, dan sepupu"
    },
    {
      "name": "Keluarga Inti Mempelai Pria",
      "group": "Keluarga",
      "pax": 15,
      "relation": "Keluarga Inti Cowo",
      "phone": "",
      "address": "Kota Asal",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Meja VIP Depan"
    },
    {
      "name": "Keluarga Besar Mempelai Pria",
      "group": "Keluarga",
      "pax": 40,
      "relation": "Famili Cowo",
      "phone": "",
      "address": "Kota Asal",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Rombongan besan"
    },
    {
      "name": "Sahabat Kuliah Wanita",
      "group": "Teman",
      "pax": 12,
      "relation": "Almamater Cewe",
      "phone": "",
      "address": "Jakarta",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Teman seangkatan kampus"
    },
    {
      "name": "Teman Kantor Wanita",
      "group": "Teman Kantor",
      "pax": 20,
      "relation": "Rekan Kerja Cewe",
      "phone": "",
      "address": "Kantor",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Divisi & manajemen"
    },
    {
      "name": "Sahabat Kuliah Pria",
      "group": "Teman",
      "pax": 12,
      "relation": "Almamater Cowo",
      "phone": "",
      "address": "Bandung",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Teman kampus cowo"
    },
    {
      "name": "Teman Kantor Pria",
      "group": "Teman Kantor",
      "pax": 20,
      "relation": "Rekan Kerja Cowo",
      "phone": "",
      "address": "Kantor",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Rekan kerja tim IT / engineering"
    },
    {
      "name": "Teman SMA Wanita",
      "group": "Teman",
      "pax": 10,
      "relation": "Alumni SMA Cewe",
      "phone": "",
      "address": "Kota Asal",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Grup alumni SMA"
    },
    {
      "name": "Teman SMA Pria",
      "group": "Teman",
      "pax": 10,
      "relation": "Alumni SMA Cowo",
      "phone": "",
      "address": "Kota Asal",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Grup futsal / alumni SMA"
    },
    {
      "name": "Tetangga RT / RW Rumah Wanita",
      "group": "Tetangga",
      "pax": 30,
      "relation": "Warga Lingkungan Cewe",
      "phone": "",
      "address": "Lingkungan Rumah",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Warga RT setempat"
    },
    {
      "name": "Tetangga RT / RW Rumah Pria",
      "group": "Tetangga",
      "pax": 25,
      "relation": "Warga Lingkungan Cowo",
      "phone": "",
      "address": "Lingkungan Rumah",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Warga RT setempat pria"
    },
    {
      "name": "Tokoh Masyarakat & Pemuka Agama",
      "group": "VIP",
      "pax": 6,
      "relation": "Sesepuh Lingkungan",
      "phone": "",
      "address": "Domisili",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Saksi kehormatan & pendoa"
    },
    {
      "name": "Rekan Bisnis / Mitra Kerja Orang Tua",
      "group": "VIP",
      "pax": 20,
      "relation": "Kolega Orang Tua",
      "phone": "",
      "address": "Berbagai Kota",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Tamu kehormatan orang tua"
    },
    {
      "name": "Bridesmaid & Sahabat Dekat",
      "group": "Bridesmaid",
      "pax": 6,
      "relation": "Pendamping Pengantin Cewe",
      "phone": "",
      "address": "Jakarta",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Standby sejak pagi sesi makeup"
    },
    {
      "name": "Groomsmen & Sahabat Dekat",
      "group": "Groomsmen",
      "pax": 6,
      "relation": "Pendamping Pengantin Cowo",
      "phone": "",
      "address": "Jakarta",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Pengiring pengantin pria"
    },
    {
      "name": "Panitia Pelaksana Keluarga",
      "group": "Panitia",
      "pax": 15,
      "relation": "Keluarga Pembantu Acara",
      "phone": "",
      "address": "Venue",
      "eventScope": "Akad & Resepsi",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Bertugas di meja penerima tamu & katering"
    },
    {
      "name": "Rekan Komunitas Hobi / Relawan",
      "group": "Komunitas",
      "pax": 10,
      "relation": "Teman Komunitas",
      "phone": "",
      "address": "Jakarta",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Komunitas fotografi / sepeda"
    },
    {
      "name": "Dosen Pembimbing & Guru Favorit",
      "group": "VIP",
      "pax": 4,
      "relation": "Pendidik",
      "phone": "",
      "address": "Kampus",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Tamu undangan kehormatan"
    },
    {
      "name": "Kerabat Jauh Luar Kota Wanita",
      "group": "Keluarga",
      "pax": 15,
      "relation": "Famili Luar Daerah",
      "phone": "",
      "address": "Luar Kota",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Tentatif",
      "notes": "Konfirmasi akomodasi hotel"
    },
    {
      "name": "Kerabat Jauh Luar Kota Pria",
      "group": "Keluarga",
      "pax": 15,
      "relation": "Famili Luar Daerah",
      "phone": "",
      "address": "Luar Kota",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Tentatif",
      "notes": "Konfirmasi transportasi"
    },
    {
      "name": "Pimpinan & Direksi Kantor Wanita",
      "group": "VIP",
      "pax": 4,
      "relation": "Manajemen Kantor Cewe",
      "phone": "",
      "address": "Kantor",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Meja VIP khusus direksi"
    },
    {
      "name": "Pimpinan & Direksi Kantor Pria",
      "group": "VIP",
      "pax": 4,
      "relation": "Manajemen Kantor Cowo",
      "phone": "",
      "address": "Kantor",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Menunggu",
      "notes": "Meja VIP khusus direksi"
    },
    {
      "name": "Teman Pengajian / Majelis Taklim Ibu",
      "group": "Komunitas",
      "pax": 20,
      "relation": "Majelis Taklim",
      "phone": "",
      "address": "Lingkungan Rumah",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Pengajian rutin ibu"
    },
    {
      "name": "Rekan Paguyuban / Arisan Ayah",
      "group": "Komunitas",
      "pax": 15,
      "relation": "Paguyuban Warga",
      "phone": "",
      "address": "Lingkungan Rumah",
      "eventScope": "Resepsi Saja",
      "inviteSent": false,
      "rsvpStatus": "Hadir",
      "notes": "Paguyuban warga perumahan"
    }
  ]
};

function seedPlannerTemplates(scope) {
  requireAllowed_();
  scope = String(scope || 'all').toLowerCase();

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const seeded = {};
    const scopesToRun = (scope === 'all')
      ? ['Seserahan', 'Checklist', 'Rundown', 'BudgetItems', 'Guests']
      : [scope.charAt(0).toUpperCase() + scope.slice(1)];

    scopesToRun.forEach(function(sheetName) {
      if (!PLANNER_TEMPLATES[sheetName]) return;
      const sheet = getSheet_(sheetName);
      const headers = headers_(sheet);
      const existing = readRecords_(sheetName);

      // Create lookup keys to ensure idempotency (never duplicate or overwrite user edits)
      const existingKeys = {};
      existing.forEach(function(r) {
        var k = '';
        if (sheetName === 'Seserahan') k = String(r.name || '').trim().toLowerCase() + ':::' + String(r.tab || '').trim().toLowerCase();
        else if (sheetName === 'BudgetItems') k = String(r.title || '').trim().toLowerCase() + ':::' + String(r.group || '').trim().toLowerCase();
        else if (sheetName === 'Checklist') k = String(r.title || '').trim().toLowerCase() + ':::' + String(r.group || '').trim().toLowerCase();
        else if (sheetName === 'Rundown') k = String(r.time || '').trim().toLowerCase() + ':::' + String(r.activity || '').trim().toLowerCase();
        else if (sheetName === 'Guests') k = String(r.name || '').trim().toLowerCase() + ':::' + String(r.group || '').trim().toLowerCase();
        if (k) existingKeys[k] = true;
      });

      const itemsToInsert = PLANNER_TEMPLATES[sheetName].filter(function(item) {
        var k = '';
        if (sheetName === 'Seserahan') k = String(item.name || '').trim().toLowerCase() + ':::' + String(item.tab || '').trim().toLowerCase();
        else if (sheetName === 'BudgetItems') k = String(item.title || '').trim().toLowerCase() + ':::' + String(item.group || '').trim().toLowerCase();
        else if (sheetName === 'Checklist') k = String(item.title || '').trim().toLowerCase() + ':::' + String(item.group || '').trim().toLowerCase();
        else if (sheetName === 'Rundown') k = String(item.time || '').trim().toLowerCase() + ':::' + String(item.activity || '').trim().toLowerCase();
        else if (sheetName === 'Guests') k = String(item.name || '').trim().toLowerCase() + ':::' + String(item.group || '').trim().toLowerCase();
        return !existingKeys[k];
      });

      if (itemsToInsert.length > 0) {
        const rows = itemsToInsert.map(function(item) {
          const rec = Object.assign({}, item);
          rec.id = sheetName.toLowerCase().slice(0, 3) + '-' + Utilities.getUuid().slice(0, 8);
          rec.updatedAt = new Date();
          return headers.map(function(col) {
            return sanitizeCell_(rec[col] !== undefined ? rec[col] : '');
          });
        });
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
      }
      seeded[sheetName] = itemsToInsert.length;
    });

    return { success: true, seeded: seeded };
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
    if (row[ki]) out[String(row[ki])] = serializeCell_(row[vi]);
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
    Checklist: ['title'],
    Moodboard: ['title', 'section'],
    Seserahan: ['name'],
    BudgetItems: ['title'],
    Rundown: ['time', 'activity'],
    Guests: ['name']
  }[sheetName] || [];

  required.forEach(function(key) {
    if (r[key] === undefined || r[key] === null || String(r[key]).trim() === '') {
      throw new Error('Kolom wajib belum diisi: ' + key);
    }
  });

  ['amount', 'plannedAmount', 'actualAmount', 'contractAmount', 'estimatedAmount', 'qty', 'unitPrice', 'pax', 'sortOrder'].forEach(function(key) {
    if (r[key] !== undefined && r[key] !== '' && (!isFinite(Number(r[key])) || Number(r[key]) < 0)) {
      throw new Error('Nominal ' + key + ' harus berupa angka nol atau lebih.');
    }
  });

  if (sheetName === 'Transactions' && ['income', 'expense'].indexOf(normalizedType_(r.type)) < 0) {
    throw new Error('Jenis transaksi harus pemasukan atau pengeluaran.');
  }

  if (sheetName === 'Categories' && ['Wajib', 'Penting', 'Opsional'].indexOf(r.priority) < 0) {
    throw new Error('Pilih prioritas kategori: Wajib, Penting, atau Opsional.');
  }

  if (r.categoryId && !readRecords_('Categories').some(function(x) {
    return String(x.id) === String(r.categoryId) && x.active !== false && String(x.active).toLowerCase() !== 'false';
  })) {
    throw new Error('Kategori tidak ditemukan atau sudah dinonaktifkan.');
  }

  if (r.vendorId && !readRecords_('Vendors').some(function(x) {
    return String(x.id) === String(r.vendorId);
  })) {
    throw new Error('Vendor tidak ditemukan.');
  }

  if (sheetName === 'Seserahan' && r.shopUrl) {
    const urls = String(r.shopUrl).split(/[\s,]+/).filter(Boolean);
    if (urls.length && !urls.every(function(u) { return /^https:\/\/[^\s<>"']+$/i.test(u); })) {
      throw new Error('Tautan toko seserahan harus memakai HTTPS.');
    }
  }

  if (sheetName === 'Moodboard') {
    ['imageUrl', 'sourceUrl'].forEach(function(key) {
      if (r[key]) {
        const urls = String(r[key]).split(/[\s,]+/).filter(Boolean);
        if (!urls.length || !urls.every(function(u) {
          return /^https:\/\/[^\s<>"']+$/i.test(u) || (key === 'imageUrl' && /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i.test(u) && u.length <= 48000);
        })) {
          throw new Error('Tautan moodboard harus memakai HTTPS.');
        }
      }
    });
    if (r.color && !/^#[0-9a-f]{6}$/i.test(String(r.color))) {
      throw new Error('Warna harus berformat #RRGGBB.');
    }
    if (r.sortOrder !== undefined && r.sortOrder !== '' && (!Number.isInteger(Number(r.sortOrder)) || Number(r.sortOrder) < 0)) {
      throw new Error('Urutan moodboard harus bilangan bulat nol atau lebih.');
    }
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

function validateVendorContract_(vendor, id) {
  const paid = readRecords_('Transactions').filter(function(x) {
    return String(x.vendorId) === String(id) && normalizedType_(x.type) === 'expense';
  }).reduce(function(sum, x) { return sum + (Number(x.amount) || 0); }, 0);
  if (Number(vendor.contractAmount || 0) < paid) {
    throw new Error('Nilai kontrak vendor tidak boleh kurang dari pembayaran tercatat (' + paid + ').');
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
    } else if (index('categoryName') && index('categoryId')) {
      set('categoryId', '');
    }

    const vendorName = index('vendorName') ? String(sheet.getRange(row, index('vendorName')).getDisplayValue()).trim() : '';
    if (vendorName && index('vendorId')) {
      set('vendorId', resolveNamedId_('Vendors', vendorName));
    } else if (index('vendorName') && index('vendorId')) {
      set('vendorId', '');
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
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(name);
  const expected = SHEETS[name];
  if (!sheet) {
    try {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, expected.length).setFontWeight('bold').setBackground('#8e464c').setFontColor('#ffffff');
    } catch (err) {
      sheet = ss.getSheetByName(name);
      if (!sheet) throw err;
    }
  } else if (sheet.getLastColumn() > 0) {
    try {
      const existingHeaders = headers_(sheet);
      const missing = expected.filter(function(col) { return existingHeaders.indexOf(col) === -1; });
      if (missing.length > 0) {
        const startCol = existingHeaders.length + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
        sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold').setBackground('#8e464c').setFontColor('#ffffff');
      }
    } catch (ignore) {}
  }
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
  ['Budget', 'Transactions', 'Vendors', 'Checklist', 'Moodboard'].forEach(function(name) {
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
  return (value instanceof Date || Object.prototype.toString.call(value) === '[object Date]')
    ? Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX")
    : value;
}

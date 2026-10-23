import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendSource = await readFile(resolve(root, 'Code.gs'), 'utf8');
const clientSource = (await readFile(resolve(root, 'Client.html'), 'utf8')).match(/<script>([\s\S]*?)<\/script>/i)[1];
const props = new Map();
const cache = new Map();
const tables = {
  Categories: [['id', 'name', 'priority', 'active'], ['c1', 'Venue', 'Wajib', true]],
  Budget: [['id', 'categoryId', 'plannedAmount', 'owner', 'updatedAt']],
  Transactions: [['id', 'type', 'vendorId', 'categoryId', 'amount'], ['t1', 'Pengeluaran', 'v1', 'c1', 8000000]],
  Vendors: [['id', 'name', 'categoryId', 'contractAmount', 'updatedAt'], ['v1', 'Vendor', 'c1', 10000000, '']],
  Checklist: [['id', 'title', 'status']]
};
const sheet = name => ({
  getLastColumn: () => tables[name][0].length,
  getDataRange: () => ({ getValues: () => tables[name].map(row => row.slice()) }),
  setFrozenRows() {},
  getRange: (r, c, height = 1, width = 1) => ({
    getDisplayValues: () => tables[name].slice(r - 1, r - 1 + height).map(row => row.slice(c - 1, c - 1 + width).map(String)),
    setValues: values => values.forEach((value, i) => {
      tables[name][r - 1 + i] ??= [];
      value.forEach((cell, j) => { tables[name][r - 1 + i][c - 1 + j] = cell; });
    }),
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }
  }),
  appendRow: row => tables[name].push(row)
});
const backend = {
  Utilities: { getUuid: () => crypto.randomUUID(), base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'), formatDate: date => date.toISOString() },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key) || null, setProperty: (key, value) => props.set(key, value) }) },
  CacheService: { getScriptCache: () => ({ get: key => cache.get(key) || null, put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
  Session: { getActiveUser: () => ({ getEmail: () => '' }), getScriptTimeZone: () => 'Asia/Jakarta' },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: name => tables[name] ? sheet(name) : null,
    insertSheet: name => { tables[name] = []; return sheet(name); }
  }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
};
vm.createContext(backend);
vm.runInContext(backendSource, backend);
backend.jsonOutput_ = value => value;

assert.throws(() => backend.loginUser_('test', 'anything'), /belum dikonfigurasi/);
assert.equal(props.size, 0, 'login must not create default credentials');
for (const [key, value] of Object.entries({ APP_LOGIN_USER_1: 'one', APP_LOGIN_PASS_1: 'nikah2025', APP_LOGIN_USER_2: 'two', APP_LOGIN_PASS_2: 'long-private-password' })) props.set(key, value);
assert.throws(() => backend.loginUser_('one', 'nikah2025'), /bawaan lama/);
props.set('APP_LOGIN_PASS_1', 'another-private-password');
const loginRes = backend.loginUser_('one', 'another-private-password');
assert.equal(loginRes.role, 'cowo', 'first account should map to cowo role');
assert.equal(backend.loginUser_('two', 'long-private-password').role, 'cewe', 'second account should map to cewe role');
const token = loginRes.sessionToken;
assert.equal(backend.requireSession_(token), 'one');
assert.equal(backend.doPost({ parameter: { action: 'createInvitationHandoff' } }).ok, false, 'handoff requires login');
const handoff = backend.doPost({ parameter: { action: 'createInvitationHandoff', sessionToken: token } }).result;
assert.match(handoff.ticket, /^[a-f0-9]{64}$/);
assert.equal(backend.doPost({ parameter: { action: 'redeemInvitationHandoff', ticket: handoff.ticket } }).result.username, 'one');
assert.throws(() => backend.redeemInvitationHandoff_(handoff.ticket), /digunakan/);
assert.throws(() => backend.redeemInvitationHandoff_('invalid'), /tidak valid/);
assert.equal(backend.doPost({ parameter: { action: 'logout', sessionToken: token } }).ok, true);
assert.throws(() => backend.requireSession_(token), /berakhir/);

tables.Settings = [['key', 'value'], ['weddingDate', new Date('2026-10-18T00:00:00Z')]];
assert.equal(typeof backend.readSettings_().weddingDate, 'string', 'Date in Settings should be serialized to string');

tables.Categories.push(['c2', 'Inactive Cat', 'Opsional', false]);
assert.throws(() => backend.saveRecord('Budget', { categoryId: 'c2', plannedAmount: 1000000, owner: 'Cowo' }), /dinonaktifkan/);

backend.saveRecord('Budget', { categoryId: 'c1', plannedAmount: 10000000, owner: 'Cowo' });
assert.throws(() => backend.saveRecord('Budget', { categoryId: 'c1', plannedAmount: 20000000, owner: 'Cewe' }), /sudah memiliki anggaran/);
assert.throws(() => backend.saveRecord('Vendors', { id: 'v1', name: 'Vendor', categoryId: 'c1', contractAmount: 5000000 }), /kurang dari pembayaran/);
assert.equal(tables.Vendors[1][3], 10000000);
assert.equal(tables.Moodboard, undefined, 'new moodboard tab should be created on first use');
assert.throws(() => backend.saveRecord('Moodboard', { title: 'Panggung', section: 'Dekorasi', imageUrl: 'javascript:alert(1)' }), /HTTPS/);
backend.saveRecord('Moodboard', { title: 'Panggung', section: 'Dekorasi', imageUrl: 'https://example.com/dekorasi.jpg, https://example.com/dekorasi2.jpg', sourceUrl: 'https://example.com/ref1\nhttps://example.com/ref2', color: '#D7BFA7', vendorId: 'v1', notes: 'Bunga putih' });
assert.equal(tables.Moodboard[0][0], 'id');
assert.equal(backend.readRecords_('Moodboard')[0].notes, 'Bunga putih');

const element = () => ({ innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {}, querySelectorAll: () => [], querySelector: () => ({ disabled: false }), setAttribute() {} });
const nodes = Object.fromEntries(['wf-root', 'wf-login', 'wf-demo-btn', 'wf-login-error'].map(key => [key, element()]));
const main = element();
const session = new Map();
const storage = { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) };
const errors = [];
const client = {
  URL, URLSearchParams, console, crypto: crypto.webcrypto, location: { href: 'https://local.invalid/', pathname: '/' },
  history: { pushState() {} }, sessionStorage: storage, localStorage: storage, setTimeout, clearTimeout,
  alert: value => errors.push(value), document: {
    addEventListener() {}, querySelector: query => query === 'main' ? main : null, querySelectorAll: () => [],
    getElementById: id => nodes[id] || null, createElement: element, body: element()
  }
};
client.window = client;
client.addEventListener = () => {};
client.scrollTo = () => {};
const startup = clientSource.lastIndexOf('\nbindOwner();');
vm.createContext(client);
vm.runInContext(clientSource.slice(0, startup) + `
window.audit = {
  setDb: value => db = value, getDb: () => db, act, demoApi_, home, reports, budget, moodboard,
  setMoodboardVendor: value => moodboardVendor = value,
  setReport: value => report = value, setDownload: fn => download = fn,
  markLoggedIn: () => sessionToken = 'old-token', DEMO_DB
};
})();`, client);
const app = client.audit;

app.setDb({ Categories: [], Budget: [], Transactions: [{ id: 'private', description: 'PRIVATE PAYMENT', type: 'Pengeluaran', amount: 10 }], Vendors: [], Savings: [], Checklist: [], Settings: { partnerOneName: 'PRIVATE NAME' } });
app.markLoggedIn();
storage.setItem('wedding_session_v2_admin', 'invitation-session');
await app.act('logout');
assert.equal(app.getDb(), null);
assert.equal(storage.getItem('wedding_session_v2_admin'), null, 'Wedding Fund logout clears invitation admin session in this browser');
assert.equal((await app.demoApi_('getAppSnapshot')).Settings.partnerOneName, app.DEMO_DB.Settings.partnerOneName);

const demo = JSON.parse(JSON.stringify(app.DEMO_DB));
app.setDb(demo);
app.setReport({ from: '2025-05-01', to: '2025-05-31', owner: 'Cewe' });
let exported = [];
app.setDownload((_name, rows) => { exported = rows; });
await app.act('export-Reports');
assert.equal(exported.length, 2);
assert.ok(exported.every(row => row.PIC === 'Cewe' && row.Tanggal >= '2025-05-01' && row.Tanggal <= '2025-05-31'));

const due = new Date(Date.now() + 2 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
demo.Checklist = [{ id: 'next', title: 'Upcoming Task', status: 'Belum mulai', dueDate: due }];
demo.Settings.remindersEnabled = true;
demo.Settings.reminderDays = 7;
assert.match(app.home(), /H-2 Hari/);
demo.Settings.reminderDays = 1;
assert.doesNotMatch(app.home(), /H-2 Hari/);
demo.Settings.remindersEnabled = false;
assert.doesNotMatch(app.home(), /H-2 Hari/);

await app.act('toggle-task', { dataset: { id: 'next', status: 'Belum mulai' } });
assert.equal(demo.Checklist[0].status, 'Belum mulai', 'failed save must revert optimistic UI');
assert.ok(errors.length > 0);

demo.Moodboard = [
  { id: 'a', title: '<script>alert(1)</script>', section: 'Dekorasi', notes: 'Umum', imageUrl: 'javascript:alert(1)', vendorId: '' },
  { id: 'b', title: 'Khusus vendor', section: 'Venue', notes: 'Lampu hangat', imageUrl: 'https://example.com/1.jpg, https://example.com/2.jpg', sourceUrl: 'https://example.com/s1\nhttps://example.com/s2', vendorId: 'ven-1' },
  { id: 'c', title: 'Vendor lain', section: 'Catering', notes: 'Bukan untuk venue', vendorId: 'ven-2' }
];
app.setMoodboardVendor('ven-1');
const brief = app.moodboard();
assert.match(brief, /Khusus vendor/);
assert.doesNotMatch(brief, /Vendor lain/);
assert.match(brief, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(brief, /src="javascript:/);
assert.match(brief, /Lihat sumber 1/);
assert.match(brief, /Lihat sumber 2/);

const budgetHtml = app.budget();
assert.match(budgetHtml, /PIC:/);
assert.match(budgetHtml, /Ubah Anggaran/);

console.log('Semua pengujian perbaikan berhasil.');

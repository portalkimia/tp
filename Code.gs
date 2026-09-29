const SHEETS = {
  Categories: ['id','name','priority','kind','color','active','sortOrder','updatedAt'],
  Budget: ['id','categoryId','categoryName','plannedAmount','owner','notes','updatedAt'],
  Transactions: ['id','date','type','categoryId','categoryName','description','amount','owner','paymentMethod','vendorId','vendorName','proofLink','notes','updatedAt'],
  Savings: ['id','date','source','amount','account','owner','description','verified','proofLink','updatedAt'],
  Vendors: ['id','name','categoryId','categoryName','contact','contractAmount','invoiceLink','nextDueDate','notes','updatedAt'],
  Checklist: ['id','title','categoryId','categoryName','status','dueDate','owner','estimatedAmount','vendorId','vendorName','notes','updatedAt'],
  Settings: ['key','value','updatedAt'],
};
const DEFAULT_CATEGORIES = [
  ['Venue & Lokasi','Wajib'],['Catering & Jamuan','Wajib'],['Dekorasi','Penting'],['Busana Pengantin','Penting'],
  ['MUA & Hairdo','Penting'],['Foto & Video','Penting'],['Undangan & Web','Opsional'],['Mahar & Seserahan','Wajib'],
  ['Cincin Pernikahan','Wajib'],['Honeymoon','Opsional'],['Transportasi & Hotel','Penting'],['Administrasi & KUA','Wajib'],['Dana Darurat','Wajib']
];
// Apps Script is the spreadsheet API. The public GitHub Pages frontend must
// authenticate with Google Identity Services; never trust an email from HTML.
var API_REQUEST_EMAIL_ = '';

function doGet(e) {
  if (e && e.parameter && e.parameter.api === '1') return apiGet_(e);
  return ContentService.createTextOutput('Wedding Fund API. Buka frontend dari GitHub Pages.').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    const user = verifyGoogleIdToken_(p.idToken);
    API_REQUEST_EMAIL_ = user.email;
    const payload = p.payload ? JSON.parse(p.payload) : {};
    let result;
    if (p.action === 'save') result = saveRecord(String(payload.sheet || ''), payload.record || {});
    else if (p.action === 'delete') result = deleteRecord(String(payload.sheet || ''), String(payload.id || ''));
    else if (p.action === 'saveSettings') result = saveSettings(payload.values || {});
    else throw new Error('Aksi API tidak dikenal.');
    const output = {ok:true,result:result};
    if (p.requestId) CacheService.getScriptCache().put('wf:'+p.requestId, JSON.stringify(output), 60);
    return jsonOutput_(output);
  } catch (err) {
    const output = {ok:false,error:String(err && err.message || err)};
    const requestId = e && e.parameter && e.parameter.requestId;
    if (requestId && /^[a-f0-9-]{20,50}$/i.test(requestId)) CacheService.getScriptCache().put('wf:'+requestId, JSON.stringify(output), 60);
    return jsonOutput_(output);
  }
}

function apiGet_(e) {
  const callback = String(e.parameter.callback || '');
  if (!/^[A-Za-z_$][0-9A-Za-z_$\.]{0,80}$/.test(callback)) return jsonOutput_({ok:false,error:'Callback tidak valid.'});
  try {
    const user = verifyGoogleIdToken_(e.parameter.idToken);
    API_REQUEST_EMAIL_ = user.email;
    let result;
    if (e.parameter.action === 'snapshot') result = getAppSnapshot();
    else if (e.parameter.action === 'status') result = getAppStatus();
    else if (e.parameter.action === 'result') { const saved=CacheService.getScriptCache().get('wf:'+String(e.parameter.requestId||'')); if(!saved)throw new Error('Operasi belum selesai, coba lagi.'); result=JSON.parse(saved); }
    else throw new Error('Aksi API tidak dikenal.');
    return ContentService.createTextOutput(callback+'('+JSON.stringify({ok:true,result:result})+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (err) { return ContentService.createTextOutput(callback+'('+JSON.stringify({ok:false,error:String(err && err.message || err)})+');').setMimeType(ContentService.MimeType.JAVASCRIPT); }
}

function verifyGoogleIdToken_(token) {
  if (!token) throw new Error('Silakan masuk dengan akun Google.');
  const clientId = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID');
  if (!clientId) throw new Error('OAUTH_CLIENT_ID belum disetel di Script Properties.');
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(token), {muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw new Error('Sesi Google tidak valid atau sudah berakhir.');
  const claims = JSON.parse(response.getContentText());
  if (claims.aud !== clientId || claims.iss !== 'https://accounts.google.com' || Number(claims.exp) * 1000 <= Date.now() || claims.email_verified !== 'true') throw new Error('Identitas Google tidak dapat diverifikasi.');
  const email = String(claims.email || '').trim().toLowerCase();
  if (!isAllowed_(email)) throw new Error('Akun Google ini tidak diizinkan.');
  return {email:email};
}

function jsonOutput_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function setupDatabase() {
  requireAllowed_();
  const ss = spreadsheet_();
  Object.keys(SHEETS).forEach(function(name) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() <= 1) {
      if (sheet.getLastColumn()) sheet.getRange(1,1,1,sheet.getLastColumn()).clearContent();
      sheet.getRange(1,1,1,SHEETS[name].length).setValues([SHEETS[name]]);
    } else {
      const existing = sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0].filter(String);
      const missing = SHEETS[name].filter(function(header) { return existing.indexOf(header) === -1; });
      if (missing.length) sheet.getRange(1,existing.length+1,1,missing.length).setValues([missing]);
    }
    sheet.setFrozenRows(1);
  });
  Object.keys(SHEETS).forEach(function(name){applySheetValidation_(ss.getSheetByName(name),name);});
  seedCategories_();
  migrateLegacyCategoryLinks_();
  installSheetEditTrigger_(ss);
  return {spreadsheet:ss.getUrl(), tabs:Object.keys(SHEETS)};
}

function getAppStatus() {
  const email = requireAllowed_();
  const ss = spreadsheet_();
  return {email:email, connected:true, spreadsheetUrl:ss.getUrl(), timezone:Session.getScriptTimeZone()};
}

function getAppSnapshot() {
  requireAllowed_();
  const data = {};
  Object.keys(SHEETS).filter(function(name) { return name !== 'Settings'; }).forEach(function(name) { data[name] = readRecords_(name); });
  data.Settings = readSettings_();
  data.summary = summarize_(data);
  return data;
}

function getDashboardSummary() { return getAppSnapshot().summary; }

function listRecords(sheetName) {
  requireAllowed_();
  if (sheetName === 'Settings') return readSettings_();
  return readRecords_(sheetName);
}

function saveRecord(sheetName, record) {
  requireAllowed_();
  if (!Object.prototype.hasOwnProperty.call(SHEETS,sheetName) || sheetName === 'Settings') throw new Error('Jenis data tidak diizinkan.');
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Data tidak valid.');
  validateRecord_(sheetName,record);
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = getSheet_(sheetName); const headers = headers_(sheet); const rows = sheet.getDataRange().getValues();
    const id = String(record.id || Utilities.getUuid()); const now = new Date();
    let existingRecord = {};
    if (record.id) {
      for (let i=1;i<rows.length;i++) if (String(rows[i][headers.indexOf('id')]) === String(record.id)) {
        existingRecord = headers.reduce(function(out,key,index){out[key]=serializeCell_(rows[i][index]);return out;},{});
        break;
      }
    }
    const merged = Object.assign({}, existingRecord, record);
    if (merged.categoryId) {
      const category = readRecords_('Categories').filter(function(x){return String(x.id)===String(merged.categoryId);})[0];
      merged.categoryName = category ? category.name : '';
    } else if (Object.prototype.hasOwnProperty.call(merged,'categoryName')) merged.categoryName = '';
    if (merged.vendorId) {
      const vendor = readRecords_('Vendors').filter(function(x){return String(x.id)===String(merged.vendorId);})[0];
      merged.vendorName = vendor ? vendor.name : '';
    } else if (Object.prototype.hasOwnProperty.call(merged,'vendorName')) merged.vendorName = '';
    if (sheetName === 'Transactions') validateVendorPayment_(merged, record.id);
    const row = headers.map(function(key) {
      if (key === 'id') return id;
      if (key === 'updatedAt') return now;
      return merged[key] == null ? '' : sanitizeCell_(merged[key]);
    });
    const idIndex = headers.indexOf('id'); let rowNumber = -1;
    for (let i=1;i<rows.length;i++) if (String(rows[i][idIndex]) === id) { rowNumber=i+1; break; }
    if (rowNumber > 0) sheet.getRange(rowNumber,1,1,row.length).setValues([row]); else sheet.appendRow(row);
    if (sheetName === 'Categories' || sheetName === 'Vendors') syncRelatedNames_(sheetName,id,String(merged.name || ''));
    return {id:id, updatedAt:now.toISOString()};
  } finally { lock.releaseLock(); }
}

function deleteRecord(sheetName,id) {
  requireAllowed_();
  if (!Object.prototype.hasOwnProperty.call(SHEETS,sheetName) || sheetName === 'Settings') throw new Error('Jenis data tidak diizinkan.');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = getSheet_(sheetName); const headers = headers_(sheet); const rows = sheet.getDataRange().getValues(); const iId = headers.indexOf('id');
    if (sheetName === 'Categories') assertUnreferenced_('categoryId',id);
    if (sheetName === 'Vendors') assertUnreferenced_('vendorId',id);
    for(let i=1;i<rows.length;i++) if(String(rows[i][iId])===String(id)){sheet.deleteRow(i+1);return true;}
    return false;
  } finally { lock.releaseLock(); }
}

function getSettings() { requireAllowed_(); return readSettings_(); }
function saveSettings(values) {
  requireAllowed_();
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Pengaturan tidak valid.');
  const allowed = ['partnerOneName','partnerTwoName','weddingDate','guestTarget','budgetTarget','motto','currency','remindersEnabled','reminderDays','roleLabels'];
  const lock=LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet=getSheet_('Settings'); const rows=sheet.getDataRange().getValues(); const h=headers_(sheet); const ki=h.indexOf('key'),vi=h.indexOf('value'),ui=h.indexOf('updatedAt');
    Object.keys(values).filter(function(k){return allowed.indexOf(k)!==-1;}).forEach(function(key){
      const value=sanitizeCell_(values[key] == null ? '' : String(values[key])); let found=-1;
      for(let i=1;i<rows.length;i++)if(String(rows[i][ki])===key){found=i+1;break;}
      if(found>0){sheet.getRange(found,vi+1).setValue(value);sheet.getRange(found,ui+1).setValue(new Date());}
      else {const row=h.map(function(col){return col==='key'?key:col==='value'?value:col==='updatedAt'?new Date():'';});sheet.appendRow(row);}
    });
    return readSettings_();
  } finally {lock.releaseLock();}
}

function readRecords_(name) {
  if (!Object.prototype.hasOwnProperty.call(SHEETS,name) || name==='Settings') throw new Error('Jenis data tidak diizinkan.');
  const sheet=getSheet_(name); const values=sheet.getDataRange().getValues(); if(values.length<2)return [];
  const headers=values.shift(); return values.filter(function(row){return row.some(function(cell){return cell!=='';});}).map(function(row){return headers.reduce(function(out,key,i){out[key]=serializeCell_(row[i]);return out;},{});});
}
function readSettings_(){const sheet=getSheet_('Settings');const values=sheet.getDataRange().getValues();if(values.length<2)return {};const h=values.shift();const ki=h.indexOf('key'),vi=h.indexOf('value');const out={};values.forEach(function(row){if(row[ki])out[String(row[ki])]=row[vi];});return out;}
function summarize_(data) {
  const budgets=data.Budget||[], tx=data.Transactions||[], savings=data.Savings||[], vendors=data.Vendors||[], tasks=data.Checklist||[];
  const expenses=tx.filter(function(r){return normalizedType_(r.type)==='expense';});
  const income=tx.filter(function(r){return normalizedType_(r.type)==='income';});
  const paid={}; expenses.forEach(function(r){if(r.vendorId)paid[r.vendorId]=(paid[r.vendorId]||0)+(Number(r.amount)||0);});
  const categoryActual={}; expenses.forEach(function(r){if(r.categoryId)categoryActual[r.categoryId]=(categoryActual[r.categoryId]||0)+(Number(r.amount)||0);});
  const planned=budgets.reduce(function(s,r){return s+(Number(r.plannedAmount)||0);},0);
  return {planned:planned,expenses:expenses.reduce(function(s,r){return s+(Number(r.amount)||0);},0),income:income.reduce(function(s,r){return s+(Number(r.amount)||0);},0),savings:savings.reduce(function(s,r){return s+(Number(r.amount)||0);},0),vendorDue:vendors.reduce(function(s,v){return s+Math.max(0,(Number(v.contractAmount)||0)-(paid[v.id]||0));},0),openTasks:tasks.filter(function(r){return !/done|selesai/i.test(String(r.status));}).length,categoryActual:categoryActual,vendorPaid:paid,recentTransactions:tx.slice().sort(function(a,b){return String(b.date).localeCompare(String(a.date));}).slice(0,5)};
}
function validateRecord_(sheetName,r) {
  const required={Categories:['name'],Budget:['categoryId'],Transactions:['date','type','description','amount'],Savings:['date','source','amount'],Vendors:['name'],Checklist:['title','status']}[sheetName]||[];
  required.forEach(function(key){if(r[key]===undefined||r[key]===null||String(r[key]).trim()==='')throw new Error('Kolom wajib belum diisi: '+key);});
  ['amount','plannedAmount','contractAmount','estimatedAmount'].forEach(function(key){if(r[key]!==undefined&&r[key]!==''&&(!isFinite(Number(r[key]))||Number(r[key])<0))throw new Error('Nominal harus angka nol atau lebih.');});
  if(sheetName==='Transactions'&&['income','expense'].indexOf(normalizedType_(r.type))<0)throw new Error('Jenis transaksi harus pemasukan atau pengeluaran.');
  if(sheetName==='Categories'&&['Wajib','Penting','Opsional'].indexOf(r.priority)<0)throw new Error('Pilih prioritas kategori.');
  if(r.categoryId&&!readRecords_('Categories').some(function(x){return String(x.id)===String(r.categoryId)&&String(x.active)!=='FALSE';}))throw new Error('Kategori tidak ditemukan atau sudah nonaktif.');
  if(r.vendorId&&!readRecords_('Vendors').some(function(x){return String(x.id)===String(r.vendorId);}))throw new Error('Vendor tidak ditemukan.');
  if(r.owner&&['Cowo','Cewe','Bersama','Keluarga'].indexOf(r.owner)<0)throw new Error('PIC tidak valid.');
}
function validateVendorPayment_(record,id){
  if(normalizedType_(record.type)!=='expense'||!record.vendorId)return;
  const vendor=readRecords_('Vendors').filter(function(x){return String(x.id)===String(record.vendorId);})[0];
  if(!vendor)throw new Error('Vendor tidak ditemukan.');
  const paid=readRecords_('Transactions').filter(function(x){return String(x.vendorId)===String(record.vendorId)&&String(x.id)!==String(id)&&normalizedType_(x.type)==='expense';}).reduce(function(s,x){return s+(Number(x.amount)||0);},0);
  if(paid+(Number(record.amount)||0)>Number(vendor.contractAmount||0))throw new Error('Pembayaran melebihi sisa nilai kontrak vendor.');
}
function normalizedType_(value){const s=String(value||'').toLowerCase();return ['income','pemasukan','masuk'].indexOf(s)>=0?'income':['expense','pengeluaran','keluar'].indexOf(s)>=0?'expense':s;}
function seedCategories_(){const existing=readRecords_('Categories');if(existing.length)return;const sheet=getSheet_('Categories');const h=headers_(sheet);DEFAULT_CATEGORIES.forEach(function(item,index){const row={id:Utilities.getUuid(),name:item[0],priority:item[1],kind:'budget',color:'',active:true,sortOrder:index+1,updatedAt:new Date()};sheet.appendRow(h.map(function(key){return row[key]===undefined?'':row[key];}));});}
function migrateLegacyCategoryLinks_(){['Budget','Transactions','Vendors','Checklist'].forEach(function(name){const sheet=getSheet_(name),h=headers_(sheet),legacy=h.indexOf('category'),idCol=h.indexOf('categoryId'),nameCol=h.indexOf('categoryName');if(idCol<0||legacy<0)return;const values=sheet.getDataRange().getValues();for(let i=1;i<values.length;i++){if(values[i][idCol])continue;const label=String(values[i][legacy]||'').trim();if(!label)continue;const id=resolveNamedId_('Categories',label);if(id){sheet.getRange(i+1,idCol+1).setValue(id);if(nameCol>=0)sheet.getRange(i+1,nameCol+1).setValue(label);}}});}
function installSheetEditTrigger_(ss){const exists=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='onWeddingFundEdit'&&t.getTriggerSourceId()===ss.getId();});if(!exists)ScriptApp.newTrigger('onWeddingFundEdit').forSpreadsheet(ss).onEdit().create();}
function onWeddingFundEdit(e){
  if(!e||!e.range)return;
  const sheet=e.range.getSheet(),name=sheet.getName();
  if(!Object.prototype.hasOwnProperty.call(SHEETS,name))return;
  const headers=headers_(sheet),first=Math.max(2,e.range.getRow()),last=Math.max(first,e.range.getRow()+((e.range.getNumRows&&e.range.getNumRows())||1)-1);
  const index=function(key){return headers.indexOf(key)+1;};
  for(let row=first;row<=last;row++){
    const values=sheet.getRange(row,1,1,headers.length).getValues()[0];
    if(!values.some(function(value){return value!=='';}))continue;
    const set=function(key,value){if(index(key)>0)sheet.getRange(row,index(key)).setValue(value);};
    if(index('id')&&!sheet.getRange(row,index('id')).getValue())set('id',Utilities.getUuid());
    if(index('updatedAt'))set('updatedAt',new Date());
    const categoryName=index('categoryName')?String(sheet.getRange(row,index('categoryName')).getDisplayValue()).trim():'';
    if(categoryName&&index('categoryId'))set('categoryId',resolveNamedId_('Categories',categoryName));
    const vendorName=index('vendorName')?String(sheet.getRange(row,index('vendorName')).getDisplayValue()).trim():'';
    if(vendorName&&index('vendorId'))set('vendorId',resolveNamedId_('Vendors',vendorName));
    if(name==='Categories'||name==='Vendors'){
      const labelColumn=index('name');
      syncRelatedNames_(name,sheet.getRange(row,index('id')).getValue(),labelColumn?String(sheet.getRange(row,labelColumn).getDisplayValue()):'');
    }
  }
}
function syncRelatedNames_(source,id,label){const isCategory=source==='Categories';const key=isCategory?'categoryId':'vendorId',display=isCategory?'categoryName':'vendorName',targets=isCategory?['Budget','Transactions','Vendors','Checklist']:['Transactions','Checklist'];targets.forEach(function(n){const s=getSheet_(n),h=headers_(s),ki=h.indexOf(key),di=h.indexOf(display);if(ki<0||di<0)return;const values=s.getDataRange().getValues();for(let i=1;i<values.length;i++)if(String(values[i][ki])===String(id))s.getRange(i+1,di+1).setValue(label);});}
function resolveNamedId_(sheetName,name){const key=sheetName==='Categories'?'name':'name';const found=readRecords_(sheetName).filter(function(x){return String(x[key]||'').trim().toLowerCase()===name.toLowerCase();})[0];return found?found.id:'';}
function applySheetValidation_(sheet,name){const h=headers_(sheet),last=Math.max(sheet.getMaxRows(),500),rangeFor=function(col){const i=h.indexOf(col);return i<0?null:sheet.getRange(2,i+1,last-1,1);};const list=function(col,values){const r=rangeFor(col);if(r)r.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values,true).setAllowInvalid(true).build());};list('owner',['Cowo','Cewe','Bersama','Keluarga']);list('priority',['Wajib','Penting','Opsional']);list('status',['Belum mulai','Berjalan','Menunggu','Selesai']);list('type',['Pengeluaran','Pemasukan']);list('paymentMethod',['Transfer Bank','QRIS / E-Wallet','Tunai','Kartu Kredit']);list('kind',['budget','checklist']);
  const categoryCol=h.indexOf('categoryName'),categorySheet=spreadsheet_().getSheetByName('Categories');if(categoryCol>=0&&categorySheet){const r=sheet.getRange(2,categoryCol+1,last-1,1),source=categorySheet.getRange('B2:B500');r.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(source,true).setAllowInvalid(true).build());}
  const vendorCol=h.indexOf('vendorName'),vendorSheet=spreadsheet_().getSheetByName('Vendors');if(vendorCol>=0&&vendorSheet){const vh=headers_(vendorSheet),nameCol=vh.indexOf('name');if(nameCol>=0)sheet.getRange(2,vendorCol+1,last-1,1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(vendorSheet.getRange(2,nameCol+1,Math.max(1,vendorSheet.getMaxRows()-1),1),true).setAllowInvalid(true).build());}
  sheet.getRange(1,1,1,h.length).setFontWeight('bold').setBackground('#8e464c').setFontColor('#ffffff');
}
function validateRecordHeaders_(name){if(!SHEETS[name])throw new Error('Jenis data tidak diizinkan.');}
function getSheet_(name){validateRecordHeaders_(name);const sheet=spreadsheet_().getSheetByName(name);if(!sheet)throw new Error('Tab '+name+' belum dibuat. Jalankan setupDatabase().');return sheet;}
function headers_(sheet){return sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];}
function spreadsheet_(){const id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');if(!id)throw new Error('Spreadsheet belum dikonfigurasi.');return SpreadsheetApp.openById(id);}
function assertUnreferenced_(field,id){['Budget','Transactions','Vendors','Checklist'].forEach(function(name){readRecords_(name).forEach(function(r){if(String(r[field]||'')===String(id))throw new Error('Data masih dipakai di '+name+'. Hapus atau ubah relasinya dahulu.');});});}
function currentEmail_(){return String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();}
function isAllowed_(email){const configured=PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS')||'';const allowed=configured.split(',').map(function(x){return x.trim().toLowerCase();}).filter(Boolean);return Boolean(email&&allowed.indexOf(email.toLowerCase())!==-1);}
function requireAllowed_(){const email=API_REQUEST_EMAIL_||currentEmail_();if(!isAllowed_(email))throw new Error('Akun Google ini tidak diizinkan.');return email;}
function sanitizeCell_(value){if(typeof value==='string'&&/^[=+@]/.test(value))return "'"+value;return value;}
function serializeCell_(value){return value instanceof Date?Utilities.formatDate(value,Session.getScriptTimeZone(),"yyyy-MM-dd'T'HH:mm:ssXXX"):value;}
function accessDenied_(){return '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Akses dibatasi</title><body style="font:16px Arial,sans-serif;background:#faf7f5;color:#2d3748;display:grid;min-height:90vh;place-items:center"><main style="max-width:480px;padding:32px;background:white;border-radius:20px"><h1>Akses dibatasi</h1><p>Aplikasi ini hanya tersedia untuk akun Google yang diizinkan.</p><p>Pastikan Anda masuk dengan akun yang sudah didaftarkan oleh pemilik aplikasi.</p></main></body></html>';}

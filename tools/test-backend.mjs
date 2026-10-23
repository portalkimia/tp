import assert from 'node:assert';

// Test Schema & Validation Logic from Code.gs
const SHEETS = {
  Categories: ['id','name','priority','kind','color','active','sortOrder','updatedAt'],
  Budget: ['id','categoryId','categoryName','plannedAmount','owner','notes','updatedAt'],
  Transactions: ['id','date','type','categoryId','categoryName','description','amount','owner','paymentMethod','vendorId','vendorName','proofLink','notes','updatedAt'],
  Savings: ['id','date','source','amount','account','owner','description','verified','proofLink','updatedAt'],
  Vendors: ['id','name','categoryId','categoryName','contact','contractAmount','invoiceLink','nextDueDate','notes','updatedAt'],
  Checklist: ['id','title','categoryId','categoryName','status','dueDate','owner','estimatedAmount','vendorId','vendorName','notes','updatedAt'],
  Settings: ['key','value','updatedAt'],
};

function normalizedType_(value) {
  const s = String(value || '').toLowerCase();
  return ['income','pemasukan','masuk'].indexOf(s) >= 0 ? 'income' : ['expense','pengeluaran','keluar'].indexOf(s) >= 0 ? 'expense' : s;
}

function summarize_(data) {
  const budgets = data.Budget || [], tx = data.Transactions || [], savings = data.Savings || [], vendors = data.Vendors || [], tasks = data.Checklist || [];
  const expenses = tx.filter(r => normalizedType_(r.type) === 'expense');
  const income = tx.filter(r => normalizedType_(r.type) === 'income');
  const paid = {};
  expenses.forEach(r => {
    if (r.vendorId) paid[r.vendorId] = (paid[r.vendorId] || 0) + (Number(r.amount) || 0);
  });
  const categoryActual = {};
  expenses.forEach(r => {
    if (r.categoryId) categoryActual[r.categoryId] = (categoryActual[r.categoryId] || 0) + (Number(r.amount) || 0);
  });
  const planned = budgets.reduce((s, r) => s + (Number(r.plannedAmount) || 0), 0);
  return {
    planned: planned,
    expenses: expenses.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    income: income.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    savings: savings.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    vendorDue: vendors.reduce((s, v) => s + Math.max(0, (Number(v.contractAmount) || 0) - (paid[v.id] || 0)), 0),
    openTasks: tasks.filter(r => !/done|selesai/i.test(String(r.status))).length,
    categoryActual: categoryActual,
    vendorPaid: paid
  };
}

function constantTimeEqual_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length, n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  }
  return diff === 0;
}

console.log('--- Menjalankan Uji Logika Backend ---');

// Test 1: Normalization
assert.strictEqual(normalizedType_('Pengeluaran'), 'expense');
assert.strictEqual(normalizedType_('Pemasukan'), 'income');
assert.strictEqual(normalizedType_('EXPENSE'), 'expense');
console.log('✓ Normalisasi jenis transaksi berhasil');

// Test 2: Constant time password comparison
assert.strictEqual(constantTimeEqual_('nikah2025', 'nikah2025'), true);
assert.strictEqual(constantTimeEqual_('nikah2025', 'salah123'), false);
assert.strictEqual(constantTimeEqual_('', 'nikah2025'), false);
console.log('✓ Komparasi password konstan aman');

// Test 3: Summarize computation
const mockDb = {
  Budget: [{ id: 'b1', plannedAmount: 10000000 }, { id: 'b2', plannedAmount: 5000000 }],
  Transactions: [
    { id: 't1', type: 'Pengeluaran', amount: 3000000, categoryId: 'c1', vendorId: 'v1' },
    { id: 't2', type: 'Pengeluaran', amount: 2000000, categoryId: 'c1', vendorId: 'v1' },
    { id: 't3', type: 'Pemasukan', amount: 8000000 }
  ],
  Vendors: [{ id: 'v1', contractAmount: 10000000 }],
  Checklist: [{ id: 'k1', status: 'Selesai' }, { id: 'k2', status: 'Belum mulai' }],
  Savings: [{ id: 's1', amount: 7000000 }]
};

const summary = summarize_(mockDb);
assert.strictEqual(summary.planned, 15000000);
assert.strictEqual(summary.expenses, 5000000);
assert.strictEqual(summary.income, 8000000);
assert.strictEqual(summary.savings, 7000000);
assert.strictEqual(summary.vendorDue, 5000000);
assert.strictEqual(summary.openTasks, 1);
assert.strictEqual(summary.vendorPaid['v1'], 5000000);
assert.strictEqual(summary.categoryActual['c1'], 5000000);
console.log('✓ Kalkulasi summary dashboard & KPI valid 100%');

console.log('Semua pengujian logika backend berhasil lolos!');

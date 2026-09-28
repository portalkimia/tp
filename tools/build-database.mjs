import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = 'C:\\Users\\Tito\\Desktop\\Wedding-Fund-Tracker-App\\outputs\\01a0e6f4-971f-7b13-be3d-2716fc8b06fb';
const workbook = Workbook.create();
const schema = {
  Budget: ['id', 'name', 'category', 'plannedAmount', 'actualAmount', 'owner', 'notes', 'updatedAt'],
  Transactions: ['id', 'date', 'type', 'category', 'description', 'amount', 'owner', 'vendorId', 'notes', 'updatedAt'],
  Savings: ['id', 'date', 'source', 'amount', 'account', 'description', 'verified', 'updatedAt'],
  Vendors: ['id', 'name', 'category', 'contact', 'contractAmount', 'paidAmount', 'nextDueDate', 'notes', 'updatedAt'],
  Checklist: ['id', 'title', 'category', 'status', 'dueDate', 'owner', 'estimatedAmount', 'actualAmount', 'vendorId', 'notes', 'updatedAt'],
  Settings: ['key', 'value', 'updatedAt'],
};

for (const [name, headers] of Object.entries(schema)) {
  const sheet = workbook.worksheets.add(name);
  sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: '#F1F2F4',
    font: { name: 'Arial', size: 10, bold: true, color: '#273141' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
  };
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format.rowHeight = 30;
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format.autofitColumns();
  sheet.freezePanes.freezeRows(1);
}

await fs.mkdir(outputDir, { recursive: true });
const inspect = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 5000, tableMaxRows: 3, tableMaxCols: 12 });
console.log(inspect.ndjson);
for (const name of Object.keys(schema)) {
  const preview = await workbook.render({ sheetName: name, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(path.join(outputDir, `${name}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const file = await SpreadsheetFile.exportXlsx(workbook);
const workbookPath = path.join(outputDir, 'Wedding-Fund-Database.xlsx');
await file.save(workbookPath);
console.log(`Saved: ${workbookPath}`);

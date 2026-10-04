import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'tools', 'index-shell.html');
const output = resolve(root, 'github-pages');
const upload = resolve(root, 'github-upload');
const clientPath = resolve(root, 'Client.html');
let html = await readFile(htmlPath, 'utf8');
const client = await readFile(clientPath, 'utf8');
const clientMatch = client.match(/<script>([\s\S]*?)<\/script>/i);
if (!clientMatch) throw new Error('Tidak menemukan script aplikasi di Client.html');
const configMarker = /<!-- WF_GITHUB_CONFIG -->[\s\S]*?<!-- \/WF_GITHUB_CONFIG -->/;
const clientMarker = /<!-- WF_CLIENT_BUNDLE -->[\s\S]*?<!-- \/WF_CLIENT_BUNDLE -->/;
if (!configMarker.test(html) || !clientMarker.test(html)) {
  throw new Error('Marker build hilang di index.html. Source tidak diubah.');
}
html = html.replace(configMarker, '<script src="./config.js"></script>')
  .replace(clientMarker, '<script>\n' + clientMatch[1] + '\n</script>')
  .replace(/(<main\b[^>]*>)[\s\S]*?(<\/main>)/i, '$1<div id="wf-root" class="w-full"></div>$2')
  .replace('</head>', '<style>body:not(.wf-authenticated) aside,body:not(.wf-authenticated) header,body:not(.wf-authenticated) #wedding-fund-connection{display:none!important}body:not(.wf-authenticated) .pl-64{padding-left:0!important}main{visibility:hidden}.wf-authenticated main{visibility:visible}body:not(.wf-authenticated) main{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1.5rem!important}</style></head>');
await mkdir(output, { recursive: true });
await writeFile(resolve(root, 'index.html'), html, 'utf8');
await writeFile(resolve(output, 'index.html'), html, 'utf8');
await writeFile(resolve(output, 'config.js'), await readFile(resolve(root, 'config.js'), 'utf8'), 'utf8');
const uploadFiles = [
  'index.html','config.js','Code.gs','Client.html','appsscript.json','README.md',
  '.gitignore','.claspignore','package.json','start-server.bat','build.bat',
  'Budget.html','Transactions.html','Checklist.html','Vendors.html','Savings.html','Reports.html','Settings.html'
];
await mkdir(upload, { recursive: true });
for (const file of uploadFiles) await copyFile(resolve(root, file), resolve(upload, file));
for (const dir of ['tools','docs']) await mkdir(resolve(upload, dir), { recursive: true });
for (const file of ['build-github-pages.mjs','build-database.mjs','index-shell.html','serve.mjs'])
  await copyFile(resolve(root, 'tools', file), resolve(upload, 'tools', file));
await copyFile(resolve(root, 'docs', 'design.md'), resolve(upload, 'docs', 'design.md'));
console.log('Build selesai. Root index.html, github-pages/, dan github-upload/ sudah disinkronkan. Unggah ISI github-upload/ ke root repo.');

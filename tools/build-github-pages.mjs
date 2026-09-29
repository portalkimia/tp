import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'index.html');
const output = resolve(root, 'github-pages');
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
  .replace(clientMarker, '<script>\n' + clientMatch[1] + '\n</script>');
html = html.replace('</head>', '<style>body:not(.wf-authenticated) aside,body:not(.wf-authenticated) header{display:none!important}body:not(.wf-authenticated) .pl-64{padding-left:0}main{visibility:hidden}</style></head>');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.html'), html, 'utf8');
await writeFile(resolve(output, 'config.js'), await readFile(resolve(root, 'config.js'), 'utf8'), 'utf8');
console.log('GitHub Pages siap di folder github-pages/. Pilih folder ini sebagai publishing source atau unggah isinya ke root repository.');

// Exporta los diagramas mermaid de entrega/ como PNG para el informe (Overleaf).
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
for (const [mmd, png, w, h] of [['modelo-er.mmd', 'er.png', 1700, 1150], ['modelo-relacional.mmd', 'relacional.png', 2000, 1750]]) {
  const src = await readFile(path.join(root, 'entrega', mmd), 'utf8');
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:8px;background:#fff}</style><pre class="mermaid">${src.replace(/</g, '&lt;')}</pre>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script><script>mermaid.initialize({startOnLoad:true,theme:'neutral',er:{useMaxWidth:true}})</script>`;
  const f = path.join(root, 'entrega', png.replace('.png', '.html'));
  await writeFile(f, html);
  execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, '--virtual-time-budget=10000',
    `--screenshot=${path.join(root, 'docs', 'informe', 'figuras', png)}`, pathToFileURL(f).href], {stdio: 'ignore'});
}
console.log('figuras listas');

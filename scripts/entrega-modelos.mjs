// Genera entrega/modelos.html y entrega/modelos.pdf (E-R, relacional y normalizado).
// El relacional se obtiene del catálogo de una base recién creada, no a mano.
import {PGlite} from '@electric-sql/pglite';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {files} from './db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'entrega');
await mkdir(out, {recursive: true});
const db = new PGlite();
for (const f of files) await db.exec(await readFile(path.join(root, 'sql', f), 'utf8'));

const cols = (await db.query(`SELECT table_name t, column_name c, data_type d, ordinal_position o
  FROM information_schema.columns WHERE table_schema='biblioteca'
  AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='biblioteca' AND table_type='BASE TABLE')
  ORDER BY table_name, ordinal_position`)).rows;
const cons = (await db.query(`SELECT c.conrelid::regclass::text t, c.contype k, a.attname c,
  c.confrelid::regclass::text ref, array_length(c.conkey,1) n
  FROM pg_constraint c JOIN pg_namespace s ON s.oid=c.connamespace
  JOIN LATERAL unnest(c.conkey) u(x) ON true JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.x
  WHERE s.nspname='biblioteca' AND c.contype IN ('p','f','u')`)).rows;
const nn = (await db.query(`SELECT table_name t, column_name c FROM information_schema.columns
  WHERE table_schema='biblioteca' AND is_nullable='NO'`)).rows;
const bare = s => s.replace(/^biblioteca\./, '');
const keys = {};
for (const r of cons) {
  const k = `${bare(r.t)}.${r.c}`;
  (keys[k] ||= new Set()).add(r.k === 'p' ? 'PK' : r.k === 'f' ? 'FK' : (r.n === 1 ? 'UK' : 'UK'));
}
const notNull = new Set(nn.map(r => `${r.t}.${r.c}`));
const tipo = d => ({'integer': 'int', 'bigint': 'bigint', 'text': 'text', 'date': 'date', 'boolean': 'bool',
  'jsonb': 'jsonb', 'numeric': 'numeric', 'timestamp with time zone': 'timestamptz', 'smallint': 'smallint',
  'character varying': 'varchar'}[d] || d.replace(/\s+/g, '_'));
const tables = [...new Set(cols.map(c => c.t))];
let rel = 'erDiagram\n';
for (const t of tables) {
  rel += `  ${t.toUpperCase()} {\n`;
  for (const c of cols.filter(c => c.t === t)) {
    const k = [...(keys[`${t}.${c.c}`] || [])].sort((a, b) => ['PK', 'FK', 'UK'].indexOf(a) - ['PK', 'FK', 'UK'].indexOf(b));
    rel += `    ${tipo(c.d)} ${c.c}${k.length ? ' ' + k.join(',') : ''}${notNull.has(`${t}.${c.c}`) || k.includes('PK') ? '' : ' "NULL"'}\n`;
  }
  rel += '  }\n';
}
// Relaciones a partir de las FK: cardinalidad según NOT NULL y UNIQUE de la columna FK.
const fks = cons.filter(r => r.k === 'f');
for (const f of fks) {
  const t = bare(f.t), ref = bare(f.ref);
  const k = keys[`${t}.${f.c}`];
  const uniq = k.has('UK') || (k.has('PK') && cons.filter(x => x.k === 'p' && bare(x.t) === t).length === 1);
  const obligatorio = notNull.has(`${t}.${f.c}`);
  const lado1 = obligatorio ? '||' : 'o|';
  const ladoN = uniq ? 'o|' : 'o{';
  rel += `  ${ref.toUpperCase()} ${lado1}--${ladoN} ${t.toUpperCase()} : "${f.c}"\n`;
}

const md = await readFile(path.join(root, 'docs', 'normalizacion.md'), 'utf8');
const er = md.match(/```mermaid\n([\s\S]*?)```/)[1];
const seccion = (desde, hasta) => md.slice(md.indexOf(desde), hasta ? md.indexOf(hasta) : undefined);
const mdTabla = txt => {
  const lines = txt.trim().split('\n').filter(l => l.startsWith('|'));
  const cel = l => l.slice(1, -1).split('|').map(s => s.trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'));
  return `<table><thead><tr>${cel(lines[0]).map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
    lines.slice(2).map(l => `<tr>${cel(l).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
};
const para = s => s.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*(.+?)\*/g, '<i>$1</i>');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Modelos — Biblioteca Escolar</title>
<style>
@page{size:A3 landscape;margin:12mm}
body{font-family:Segoe UI,Arial,sans-serif;color:#1d2433;font-size:12px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 6px;border-bottom:2px solid #2f5d8a;padding-bottom:3px}
.sub{color:#5b6475;margin:0 0 10px}.page{page-break-after:always}.page:last-child{page-break-after:auto}
.mermaid svg{max-width:100%;height:auto;max-height:240mm}
table{border-collapse:collapse;width:100%;margin:6px 0 12px;font-size:11px}th,td{border:1px solid #c9cfda;padding:3px 6px;text-align:left;vertical-align:top}
th{background:#e8eef6}code{font-family:Consolas,monospace;font-size:10.5px}
.ley{font-size:11px;color:#3b4456}
</style></head><body>
<section class="page"><h1>Diagrama 1 · Modelo entidad-relación (notación pata de gallo)</h1>
<p class="sub">Biblioteca Escolar — Colegio Siglo XXI de Lampa. Ambos extremos de cada relación muestran cardinalidad mínima y máxima.
<span class="ley">Lectura: <b>||</b> exactamente uno · <b>o|</b> cero o uno · <b>o{</b> cero o muchos · <b>|{</b> uno o muchos. Las N:M se indican con su tabla intermedia entre paréntesis.</span></p>
<pre class="mermaid">${er}</pre></section>
<section class="page"><h1>Diagrama 2 · Modelo relacional</h1>
<p class="sub">Generado del catálogo de una base recién creada con <code>scripts.sql</code> (${tables.length} tablas, ${fks.length} claves foráneas). PK = clave primaria, FK = clave foránea, UK = única, "NULL" = admite nulos.</p>
<pre class="mermaid">${rel}</pre></section>
<section class="page"><h1>Diagrama 3 · Modelo normalizado (1FN → 3FN/FNBC)</h1>
<p class="sub">El esquema relacional del diagrama 2 es el resultado de la normalización. Aquí se muestran las dependencias funcionales de cada relación y la forma normal que alcanza.</p>
<h2>Transformación E-R → relacional</h2>${mdTabla(seccion('## 2. Transformación', '## 3. Esquema'))}
<h2>1FN</h2><ul>${seccion('### 4.1', '### 4.2').split('\n').filter(l => l.startsWith('- ')).map(l => `<li>${para(l.slice(2))}</li>`).join('')}</ul>
</section>
<section class="page"><h2>Dependencias funcionales por relación</h2>${mdTabla(seccion('### 4.2', '**2FN.**'))}
<p>${para(seccion('**2FN.**', '**3FN.**'))}</p><p>${para(seccion('**3FN.**', '### 4.3'))}</p></section>
<section class="page"><h2>Atributos que parecen redundantes y por qué no violan 3FN</h2>${mdTabla(seccion('### 4.3', 'Ninguno de estos'))}
<p>${para(seccion('Ninguno de estos', '## 5.'))}</p></section>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'neutral',er:{useMaxWidth:true,layoutDirection:'TB'},securityLevel:'loose'});</script>
</body></html>`;
const htmlPath = path.join(out, 'modelos.html');
await writeFile(htmlPath, html);
await writeFile(path.join(out, 'modelo-relacional.mmd'), rel);
await writeFile(path.join(out, 'modelo-er.mmd'), er);
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
execFileSync(edge, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=15000',
  `--print-to-pdf=${path.join(out, 'modelos.pdf')}`, pathToFileURL(htmlPath).href], {stdio: 'inherit'});
console.log('listo', tables.length, 'tablas', fks.length, 'FK');

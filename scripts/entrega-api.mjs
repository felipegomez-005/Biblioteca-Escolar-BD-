// Genera entrega/api.pdf: pantallazos reales de la aplicación y llamadas a la API REST.
// Levanta el servidor en memoria (BIBLIOTECA_PRUEBA=1, datos ficticios) y usa Edge sin interfaz por CDP.
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'entrega');
const img = path.join(out, 'pantallazos');
await mkdir(img, {recursive: true});
const PORT = 3177, base = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn(process.execPath, ['server/start.mjs'], {cwd: root, env: {...process.env, BIBLIOTECA_PRUEBA: '1', PORT: String(PORT), SMTP_HOST: ''}, stdio: 'ignore'});
const userDir = await mkdtemp(path.join(tmpdir(), 'edge-entrega-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333', `--user-data-dir=${userDir}`, '--window-size=1366,900', 'about:blank'], {stdio: 'ignore'});
try {
  for (let i = 0; ; i++) { try { await fetch(base + '/api/sesion'); break; } catch { if (i > 60) throw new Error('servidor no inició'); await sleep(250); } }

  // --- Llamadas a la API (se registran para el PDF) ---
  const log = [];
  let cookie = '';
  async function api(method, p, body, nota) {
    const r = await fetch(base + p, {method, headers: {'content-type': 'application/json', 'x-biblioteca-request': '1', cookie}, body: body ? JSON.stringify(body) : undefined});
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const json = await r.json().catch(() => null);
    log.push({method, p, body, status: r.status, json, nota});
    return json;
  }
  await api('GET', '/api/sesion', null, 'Estado de la sesión antes de configurar: no hay cuentas.');
  const sinSesion = await fetch(base + '/api/usuarios');
  log.push({method: 'GET', p: '/api/usuarios', status: sinSesion.status, json: await sinSesion.json(), nota: 'Sin iniciar sesión la API rechaza la consulta (control de acceso).'});
  await api('POST', '/api/sesion/inicial', {usuario: 'admin', nombre: 'Administración de prueba', clave: 'Entrega-Prueba-2026'}, 'Primera cuenta de administración (solo se permite una vez). La clave se guarda con hash scrypt.');
  await api('GET', '/api/resumen', null, 'Resumen del día para la pantalla de inicio.');
  await api('GET', '/api/contexto', null, 'Datos de contexto: cursos (Pre-kínder a 8.º básico, siempre presentes para el año actual y el siguiente), géneros y fecha de atención.');
  const disp = (await api('GET', '/api/ejemplares?disponibles=1', null, 'Copias disponibles para prestar.')) || [];
  const usuarios = (await api('GET', '/api/usuarios?q=Estudiante ficticio 7', null, 'Búsqueda de usuario.')) || [];
  const u = usuarios[0]?.id;
  const ids = disp.map(e => e.ejemplar_id ?? e.id);
  await api('POST', '/api/prestamos', {usuario_id: u, ejemplares: ids.slice(0, 4)}, 'Intento de préstamo con 4 copias: se rechaza por la regla de máximo 3 ejemplares por préstamo (RN03; en la base también la impone el trigger validar_detalle).');
  const prest = await api('POST', '/api/prestamos', {usuario_id: u, ejemplares: ids.slice(0, 2)}, 'Préstamo válido de 2 copias: el procedimiento sp_prestar calcula el vencimiento en días hábiles.');
  await api('GET', `/api/pendientes`, null, 'Ejemplares pendientes de devolución, con su vencimiento vigente.');
  await api('GET', '/api/estadisticas?anio=2026', null, 'KPI anuales (sp_kpis_anuales): préstamos por curso y ediciones más prestadas.');
  await api('GET', '/api/auditoria', null, 'Registro de auditoría inmutable: quién hizo cada operación.');

  // --- Pantallazos con Edge por CDP ---
  let ws;
  for (let i = 0; !ws; i++) {
    try { const list = await (await fetch('http://127.0.0.1:9333/json/list')).json(); const pg = list.find(t => t.type === 'page'); if (pg) ws = pg.webSocketDebuggerUrl; } catch {}
    if (!ws) { if (i > 60) throw new Error('Edge no respondió'); await sleep(250); }
  }
  const sock = new WebSocket(ws);
  await new Promise(r => sock.onopen = r);
  let seq = 0; const pend = new Map();
  sock.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)); sock.send(JSON.stringify({id, method, params})); });
  await cdp('Page.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {width: 1366, height: 900, deviceScaleFactor: 1, mobile: false});
  const shots = [];
  async function shot(nombre, titulo, texto, maxH = 1500) {
    await sleep(1600);
    const {cssContentSize} = await cdp('Page.getLayoutMetrics');
    const h = Math.min(Math.ceil(cssContentSize.height), maxH);
    const {data} = await cdp('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {x: 0, y: 0, width: 1366, height: h, scale: 1}});
    await writeFile(path.join(img, nombre + '.png'), Buffer.from(data, 'base64'));
    shots.push({nombre, titulo, texto});
  }
  await cdp('Page.navigate', {url: 'about:blank'});
  await cdp('Page.navigate', {url: base + '/'});
  await shot('01-login', 'Inicio de sesión', 'Cada persona entra con su cuenta. Hay dos roles: administración y bibliotecaria/o. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.', 900);
  const name = cookie.slice(0, cookie.indexOf('=')), value = cookie.slice(cookie.indexOf('=') + 1);
if (!value) throw new Error('sin cookie: ' + JSON.stringify(log.map(c => [c.p, c.status, c.json?.error])));
  await cdp('Network.setCookie', {name, value, domain: '127.0.0.1', path: '/'});
  const vistas = [
    ['inicio', '02-inicio', 'Inicio', 'Resumen del día: préstamos activos, atrasos, sanciones vigentes y estado del calendario.'],
    ['catalogo', '03-catalogo', 'Catálogo', 'Libros y copias físicas. Se puede registrar un libro a mano o completarlo con Google Books por ISBN o título.'],
    ['usuarios', '04-usuarios', 'Usuarios', 'Estudiantes, docentes y asistentes, con RUT validado y curso del año (Pre-kínder a 8.º básico).'],
    ['prestamos', '05-prestamo', 'Nuevo préstamo', 'Se elige el usuario y hasta 3 copias. El vencimiento se calcula en días hábiles según el calendario.'],
    ['devoluciones', '06-devoluciones', 'Devoluciones y renovaciones', 'Cada copia se devuelve o renueva por separado, indicando su condición al recibirla.'],
    ['pendientes', '07-pendientes', 'Pendientes', 'Copias por devolver, ordenadas por vencimiento; los atrasos se destacan.'],
    ['estadisticas', '08-estadisticas', 'Estadísticas (KPI)', 'Los dos indicadores acordados: préstamos por curso y ediciones más prestadas, por año.'],
    ['calendario', '09-calendario', 'Calendario', 'Días de atención, feriados, vacaciones y semanas solo de devolución. Los cambios se previsualizan antes de aplicarlos.'],
    ['avisos', '10-avisos', 'Avisos por correo', 'Cola de avisos de vencimiento y atraso. Se envían por SMTP cuando está configurado en .env.'],
    ['administracion', '11-administracion', 'Administración', 'Cuentas, auditoría, anulación de préstamos con motivo, respaldos y conservación por 10 años (solo rol admin).'],
  ];
  for (const [ruta, nombre, titulo, texto] of vistas) {
    await cdp('Page.navigate', {url: `${base}/?v=${ruta}#${ruta}`});
    await shot(nombre, titulo, texto);
  }

  // --- PDF ---
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const corto = j => { let s = JSON.stringify(j, null, 2); const l = s.split('\n'); return l.length > 28 ? l.slice(0, 28).join('\n') + '\n  …' : s; };
  const md = await readFile(path.join(root, 'docs', 'api.md'), 'utf8');
  const filas = md.split('\n').filter(l => /^\| `/.test(l)).map(l => l.slice(1, -1).split('|').map(s => esc(s.trim()).replace(/`([^`]+)`/g, '<code>$1</code>')));
  const gb = path.join(root, 'docs', 'evidencias', 'google-books-real.jpg');
  const gbData = (await readFile(gb)).toString('base64');
  const imgs = await Promise.all(shots.map(async s => ({...s, b64: (await readFile(path.join(img, s.nombre + '.png'))).toString('base64')})));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>API y aplicación</title><style>
@page{size:A4;margin:14mm}body{font-family:Segoe UI,Arial,sans-serif;color:#1d2433;font-size:11px;line-height:1.45}
h1{font-size:22px;margin:0}h2{font-size:15px;border-bottom:2px solid #2f5d8a;padding-bottom:3px;margin:16px 0 6px}
.sub{color:#5b6475}figure{margin:10px 0 16px;page-break-inside:avoid}figure img{width:100%;border:1px solid #c9cfda}
figcaption{font-size:10.5px;color:#3b4456;margin-top:3px}table{border-collapse:collapse;width:100%;font-size:9.5px}
th,td{border:1px solid #c9cfda;padding:2px 5px;text-align:left;vertical-align:top}th{background:#e8eef6}
pre{background:#f4f6fa;border:1px solid #d8dde6;padding:6px;font-size:8.5px;white-space:pre-wrap;word-break:break-word;margin:3px 0}
.call{page-break-inside:avoid;margin-bottom:10px}.ok{color:#1d7a3a;font-weight:600}.err{color:#b3261e;font-weight:600}.brk{page-break-before:always}
code{font-family:Consolas,monospace}
</style></head><body>
<h1>API y aplicación — Biblioteca Escolar</h1>
<p class="sub">Colegio Siglo XXI de Lampa · Base de Datos (CIT-2007) · Todos los datos que aparecen son ficticios.</p>
<h2>1. Cómo funciona</h2>
<p>La aplicación es un servidor web en Node.js que expone una API REST en JSON (<code>/api/…</code>) sobre la base PostgreSQL (PGlite, esquema <code>biblioteca</code>). La interfaz web solo llama a esa API. Las reglas de negocio no están en la interfaz: las imponen los triggers y procedimientos almacenados de la base, así que una petición inválida es rechazada aunque se haga directo a la API. Cada escritura queda en la tabla de auditoría.</p>
<p><b>Ejecución:</b> <code>npm install</code>, <code>npm run db:init</code> y <code>npm start</code>; luego abrir <code>http://localhost:3000</code>. La clave de Google Books y el SMTP se configuran en <code>.env</code>.</p>
<h2>2. Pantallas de la aplicación</h2>
${imgs.map((s, i) => `<figure${i === 1 ? ' class="brk"' : ''}><img src="data:image/png;base64,${s.b64}"><figcaption><b>Figura ${i + 1}. ${esc(s.titulo)}.</b> ${esc(s.texto)}</figcaption></figure>`).join('')}
<figure><img src="data:image/jpeg;base64,${gbData}"><figcaption><b>Figura ${imgs.length + 1}. Google Books.</b> Búsqueda real en la API de Google Books desde el formulario de catálogo; los datos se revisan antes de guardar.</figcaption></figure>
<h2 class="brk">3. Llamadas a la API (ejecutadas al generar este documento)</h2>
<p>Cada bloque muestra la petición, el código HTTP y la respuesta (recortada si es larga).</p>
${log.map(c => `<div class="call"><b>${c.method} <code>${esc(c.p)}</code></b> → <span class="${c.status < 400 ? 'ok' : 'err'}">${c.status}</span><br>${esc(c.nota || '')}
${c.body ? `<pre>${esc(JSON.stringify({...c.body, ...(c.body.clave ? {clave: '••••••'} : {})}))}</pre>` : ''}<pre>${esc(corto(c.json))}</pre></div>`).join('')}
<h2 class="brk">4. Referencia de endpoints</h2>
<table><thead><tr><th>Ruta</th><th>Descripción</th></tr></thead><tbody>${filas.map(f => `<tr><td>${f[0]}</td><td>${f.slice(1).join(' ')}</td></tr>`).join('')}</tbody></table>
</body></html>`;
  await writeFile(path.join(out, 'api.html'), html);
  sock.close(); edge.kill(); await sleep(800);
  const {execFileSync} = await import('node:child_process');
  const {pathToFileURL} = await import('node:url');
  execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=5000', `--print-to-pdf=${path.join(out, 'api.pdf')}`, pathToFileURL(path.join(out, 'api.html')).href], {stdio: 'ignore'});
  console.log('api.pdf listo;', shots.length, 'pantallazos;', log.map(c => `${c.method} ${c.p} ${c.status}`).join(' | '));
} finally {
  server.kill(); edge.kill();
  await sleep(500); await rm(userDir, {recursive: true, force: true}).catch(() => {});
}

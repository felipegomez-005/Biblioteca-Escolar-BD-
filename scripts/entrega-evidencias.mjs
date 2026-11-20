// Genera entrega/evidencias.pdf: pruebas con alias, objetivo, pasos, código, resultado real y análisis.
// Cada caso se ejecuta aquí mismo sobre una base nueva con datos ficticios; el resultado no se escribe a mano.
import {PGlite} from '@electric-sql/pglite';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {files} from './db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'entrega');
const db = new PGlite();
for (const f of files) await db.exec(await readFile(path.join(root, 'sql', f), 'utf8'));
await db.exec('SET search_path TO biblioteca, public');

async function run(sql) {
  const res = [];
  for (const s of sql.split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) {
    try { const r = await db.query(s); res.push({s, rows: r.rows}); }
    catch (e) { res.push({s, error: e.message}); }
  }
  return res;
}
const casos = [
  {alias: 'P-01 · Máximo tres ejemplares', regla: 'RN10', objetivo: 'Comprobar que un préstamo no puede incluir más de tres copias.',
   pasos: ['Elegir un estudiante sin préstamos (id 8).', 'Intentar prestar cuatro copias disponibles en un día hábil.', 'Verificar que no quedó ningún préstamo guardado.'],
   sql: `CALL sp_prestar(8, ARRAY[25,26,27,28], date '2026-11-19');
SELECT count(*) AS prestamos_del_usuario FROM prestamo WHERE usuario_id = 8`,
   analisis: 'La base rechaza la operación completa y no deja un préstamo a medias: el usuario sigue con 0 préstamos. La regla vive en la base (procedimiento sp_prestar y trigger validar_detalle), así que se cumple aunque la petición no venga desde la aplicación.'},
  {alias: 'P-02 · Una copia no se presta dos veces', regla: 'RN04', objetivo: 'Impedir que una copia física que ya está prestada salga en otro préstamo.',
   pasos: ['La copia 16 está prestada desde el 01-06-2026 (datos de demostración).', 'Intentar prestarla a otro estudiante.'],
   sql: `SELECT dp.ejemplar_id, p.usuario_id, dp.fecha_cierre FROM detalle_prestamo dp JOIN prestamo p ON p.id = dp.prestamo_id WHERE dp.ejemplar_id = 16;
CALL sp_prestar(9, ARRAY[16], date '2026-11-19')`,
   analisis: 'El préstamo abierto (fecha_cierre nula) bloquea la copia. El índice único parcial de "un préstamo activo por copia" y el trigger de validación lo impiden.'},
  {alias: 'P-03 · Día cerrado según calendario', regla: 'RN16', objetivo: 'No permitir préstamos en feriados ni en días sin atención.',
   pasos: ['El 03-06-2026 es feriado en el calendario de prueba.', 'Intentar prestar ese día.'],
   sql: `SELECT fecha, abierto, permite_prestamo, motivo FROM calendario WHERE fecha = '2026-06-03';
CALL sp_prestar(8, ARRAY[25], date '2026-06-03')`,
   analisis: 'El calendario es una tabla explícita: la biblioteca define qué días atiende. El préstamo se rechaza porque ese día no permite préstamos.'},
  {alias: 'P-04 · Renovación y atributos calculados', regla: 'RN05–RN06', objetivo: 'Verificar que renovar actualiza el vencimiento y el contador de renovaciones mediante triggers.',
   pasos: ['Prestar la copia 25 el lunes 02-11-2026.', 'Consultar el vencimiento vigente.', 'Renovar ese detalle (id 11) el 04-11-2026, antes del vencimiento, y volver a consultar.'],
   sql: `CALL sp_prestar(8, ARRAY[25], date '2026-11-02');
SELECT id AS detalle, vencimiento_vigente, cantidad_renovaciones FROM detalle_prestamo WHERE ejemplar_id = 25 AND fecha_cierre IS NULL;
CALL sp_renovar(ARRAY[11], date '2026-11-04');
SELECT id AS detalle, vencimiento_vigente, cantidad_renovaciones FROM detalle_prestamo WHERE ejemplar_id = 25 AND fecha_cierre IS NULL`,
   analisis: 'vencimiento_vigente y cantidad_renovaciones son atributos derivados: los escribe el trigger actualizar_vencimiento al insertar en renovacion, contando solo días hábiles. No se pueden modificar a mano.'},
  {alias: 'P-05 · Historial inmutable', regla: 'RN09', objetivo: 'Impedir que se cambie o borre el historial de préstamos.',
   pasos: ['Intentar cambiar la fecha de un préstamo existente.', 'Intentar borrarlo.'],
   sql: `UPDATE prestamo SET fecha = '2026-01-01' WHERE id = 1;
DELETE FROM prestamo WHERE id = 1`,
   analisis: 'El trigger impedir_cambio_historial rechaza ambas operaciones. Un error se corrige con una anulación (tabla correccion) que guarda motivo y operador, sin perder el registro original.'},
  {alias: 'P-06 · Indicadores anuales (KPI)', regla: 'RN18', objetivo: 'Obtener los dos indicadores acordados: préstamos por curso y ediciones más prestadas.',
   pasos: ['Llamar al procedimiento con el año 2026.'],
   sql: `CALL sp_kpis_anuales(2026)`,
   analisis: 'El curso se toma de curso_al_prestar (el curso que tenía el estudiante ese día), así que el indicador no cambia cuando el estudiante pasa de curso.'},
  {alias: 'P-07 · COMMIT y ROLLBACK explícitos', regla: 'Requisito de la guía', objetivo: 'Mostrar un procedimiento que confirma o revierte su transacción.',
   pasos: ['Cambiar el correo del usuario 1 con confirmar = false (ROLLBACK).', 'Consultar el correo.', 'Repetir con confirmar = true (COMMIT) y consultar.'],
   sql: `CALL sp_actualizar_correo(1, 'revertido@example.invalid', false);
SELECT id, correo FROM usuario WHERE id = 1;
CALL sp_actualizar_correo(1, 'confirmado@example.invalid', true);
SELECT id, correo FROM usuario WHERE id = 1`,
   analisis: 'Con ROLLBACK el correo queda igual; con COMMIT el cambio se guarda.'},
  {alias: 'P-08 · Cursos del colegio por defecto', regla: 'Estructura del cliente', objetivo: 'Comprobar que Pre-kínder a 8.º básico existen siempre, sin letras.',
   pasos: ['Contar los cursos por año.', 'Volver a ejecutar la función que asegura los cursos.'],
   sql: `SELECT anio_escolar, count(*) AS cursos, string_agg(nombre, ', ' ORDER BY id) AS nombres FROM curso GROUP BY anio_escolar ORDER BY 1;
SELECT asegurar_cursos_colegio(2026) AS cursos_creados_de_nuevo`,
   analisis: 'Hay 10 cursos por año y la función es repetible: al ejecutarla otra vez no crea duplicados (devuelve 0).'},
];
for (const c of casos) c.res = await run(c.sql);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const tabla = rows => {
  if (!rows.length) return '<i>Sin filas (CALL ejecutado sin error).</i>';
  const k = Object.keys(rows[0]);
  const v = x => typeof x === 'object' && x !== null ? (x instanceof Date ? x.toISOString().slice(0, 10) : JSON.stringify(x)) : String(x);
  return `<table><tr>${k.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${k.map(h => `<td>${esc(v(r[h]))}</td>`).join('')}</tr>`).join('')}</table>`;
};
const salida = await readFile(path.join(out, '.salida-pruebas.txt'), 'utf8').catch(() => '');
const resumen = salida.split('\n').filter(l => /^ℹ (tests|suites|pass|fail|cancelled|skipped|duration_ms)/.test(l)).join('\n');
const nombres = salida.split('\n').filter(l => /^\s*✔/.test(l)).map(l => l.replace(/\s*\([\d.]+ms\)\s*$/, '').trim());
const fallas = salida.split('\n').filter(l => /^\s*✖/.test(l));
const pr = await readFile(path.join(root, 'docs', 'pruebas.md'), 'utf8');
const tablaMd = pr.split('\n').filter(l => /^\| (\d|CURSOS)/.test(l)).map(l => l.slice(1, -1).split('|').map(s => esc(s.trim())));

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Evidencias de pruebas</title><style>
@page{size:A4;margin:14mm}body{font-family:Segoe UI,Arial,sans-serif;color:#1d2433;font-size:11px;line-height:1.45}
h1{font-size:22px;margin:0}h2{font-size:15px;border-bottom:2px solid #2f5d8a;padding-bottom:3px;margin:18px 0 6px}
.sub{color:#5b6475}.caso{page-break-inside:avoid;border:1px solid #c9cfda;border-radius:4px;padding:8px 10px;margin:10px 0}
.caso h3{margin:0 0 4px;font-size:13px}.tag{font-size:10px;background:#e8eef6;padding:1px 6px;border-radius:3px;margin-left:6px}
pre{background:#f4f6fa;border:1px solid #d8dde6;padding:6px;font-size:9px;white-space:pre-wrap;margin:3px 0}
.err{background:#fdecea;border:1px solid #f1b8b2;color:#8a1c14;padding:4px 6px;font-size:10px;margin:3px 0}
table{border-collapse:collapse;width:100%;font-size:9.5px;margin:3px 0}th,td{border:1px solid #c9cfda;padding:2px 5px;text-align:left;vertical-align:top}th{background:#e8eef6}
ol{margin:2px 0 4px 18px;padding:0}.brk{page-break-before:always}.cols{columns:2;font-size:9px}
</style></head><body>
<h1>Evidencias de pruebas — Biblioteca Escolar</h1>
<p class="sub">Colegio Siglo XXI de Lampa · Base de Datos (CIT-2007) · Datos ficticios. Generado el ${new Date().toLocaleString('es-CL')} sobre una base recién creada con <code>scripts.sql</code>.</p>
<h2>1. Resumen de la batería automatizada</h2>
<p>El proyecto incluye pruebas automáticas (<code>npm test</code>) para la base de datos, la API, los respaldos, los avisos, Google Books y la seguridad. Resultado de la última ejecución:</p>
<pre>${esc(resumen || 'Sin salida registrada')}</pre>
${fallas.length ? `<div class="err">${fallas.map(esc).join('<br>')}</div>` : ''}
<h2>2. Casos de prueba sobre la base de datos</h2>
<p>Cada caso indica alias, objetivo, pasos, código ejecutado, resultado obtenido y análisis. Los resultados de abajo son la salida real de la base.</p>
${casos.map(c => `<div class="caso"><h3>${esc(c.alias)}<span class="tag">${esc(c.regla)}</span></h3>
<b>Objetivo:</b> ${esc(c.objetivo)}<br><b>Pasos:</b><ol>${c.pasos.map(p => `<li>${esc(p)}</li>`).join('')}</ol>
<b>Código:</b><pre>${esc(c.sql)}</pre><b>Resultado:</b>
${c.res.map(r => r.error ? `<div class="err"><b>Rechazado por la base:</b> ${esc(r.error)}</div>` : tabla(r.rows)).join('')}
<b>Análisis:</b> ${esc(c.analisis)}</div>`).join('')}
<h2 class="brk">3. Cobertura de las pruebas de la base</h2>
<table><tr><th>Casos</th><th>Objetivo y resultado esperado</th></tr>${tablaMd.map(f => `<tr><td>${f[0]}</td><td>${f[1]}</td></tr>`).join('')}</table>
<h2>4. Pruebas automatizadas aprobadas (${nombres.length})</h2>
<div class="cols">${nombres.map(n => esc(n)).join('<br>')}</div>
<p>Las capturas de la aplicación y las llamadas a la API están en el documento de la API.</p>
</body></html>`;
const htmlPath = path.join(out, 'evidencias.html');
await writeFile(htmlPath, html);
execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-pdf-header-footer',
  '--virtual-time-budget=3000', `--print-to-pdf=${path.join(out, 'evidencias.pdf')}`, pathToFileURL(htmlPath).href], {stdio: 'ignore'});
console.log('evidencias.pdf listo;', casos.map(c => c.alias.slice(0, 4) + ':' + c.res.map(r => r.error ? 'ERR' : r.rows.length).join('/')).join(' '));

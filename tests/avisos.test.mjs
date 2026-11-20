import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, initialize } from '../scripts/db.mjs';
import { enviarAvisos, construirTexto } from '../scripts/avisos-lib.mjs';

let db;
before(async () => { db = await openDb(); await initialize(db); });
after(async () => { await db?.close(); });
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
const loan = async (user, copies, date = '2026-05-04') =>
  (await rows('CALL biblioteca.sp_prestar($1,$2,$3)', [user, copies, date]))[0].p_prestamo;
const details = async id => (await rows('SELECT id FROM biblioteca.detalle_prestamo WHERE prestamo_id=$1 ORDER BY id', [id])).map(x => x.id);
const estado = async prestamoId => scalar('SELECT estado FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [prestamoId]);
function check(name, fn) {
  test(name, async () => {
    await db.exec('BEGIN');
    try { await fn(); }
    finally { await db.exec('ROLLBACK'); }
  });
}

check('AVISOS 01 - prepara, envía y registra enviado con el detalle del atraso', async () => {
  const p = await loan(1, [25], '2026-06-01'); // vence antes del 08-06
  const enviados = [];
  const res = await enviarAvisos(db, { sendMail: async m => enviados.push(m), fecha: '2026-06-08' });
  const mio = enviados.find(m => m.prestamo_id === p);
  assert.ok(mio, 'debe enviar el aviso del préstamo creado');
  assert.equal(mio.destinatario, 'estudiante1@example.invalid');
  assert.match(mio.asunto, /Recordatorio/);
  assert.match(mio.texto, /Obra ficticia 9/);
  assert.match(mio.texto, /DEMO-009-1/);
  assert.equal(await estado(p), 'enviado');
  assert.equal(await scalar('SELECT enviado_en IS NOT NULL FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), true);
  assert.ok(res.enviados >= 1);
});

check('AVISOS 02 - cancela el aviso pendiente si el ejemplar ya fue devuelto', async () => {
  const p = await loan(1, [25], '2026-06-01');
  await db.query('CALL biblioteca.sp_preparar_avisos($1)', ['2026-06-08']);
  assert.equal(await estado(p), 'pendiente');
  const [d] = await details(p);
  await db.query('CALL biblioteca.sp_devolver($1,$2,$3)', [1, [d], '2026-06-08']);
  const enviados = [];
  const res = await enviarAvisos(db, { sendMail: async m => enviados.push(m), fecha: '2026-06-08' });
  assert.equal(await estado(p), 'cancelado');
  assert.equal(await scalar('SELECT enviado_en IS NULL FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), true);
  assert.ok(!enviados.some(m => m.prestamo_id === p), 'no debe enviar un aviso ya resuelto');
  assert.ok(res.cancelados >= 1);
});

check('AVISOS 03 - registra el error sin marcar enviado', async () => {
  const p = await loan(1, [25], '2026-06-01');
  const res = await enviarAvisos(db, { sendMail: async () => { throw new Error('SMTP no disponible'); }, fecha: '2026-06-08' });
  assert.equal(await estado(p), 'error');
  assert.equal(await scalar('SELECT error_detalle FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), 'SMTP no disponible');
  assert.equal(await scalar('SELECT enviado_en IS NULL FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), true);
  assert.ok(res.errores >= 1);
});

check('AVISOS 04 - no reenvía un aviso ya enviado ni duplica el registro', async () => {
  const p = await loan(1, [25], '2026-06-01');
  const enviados = [];
  await enviarAvisos(db, { sendMail: async m => enviados.push(m), fecha: '2026-06-08' });
  assert.equal(enviados.filter(m => m.prestamo_id === p).length, 1);
  await enviarAvisos(db, { sendMail: async m => enviados.push(m), fecha: '2026-06-08' });
  assert.equal(enviados.filter(m => m.prestamo_id === p).length, 1, 'no debe reenviar lo ya enviado');
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), 1);
});

test('AVISOS 05 - el texto incluye destinatario, títulos y códigos', () => {
  const texto = construirTexto('Estudiante A', [
    { titulo: 'Obra X', codigo: 'DEMO-001-1', vencimiento: '2026-06-05' },
    { titulo: 'Obra Y', codigo: 'DEMO-002-2', vencimiento: '2026-06-04' },
  ]);
  assert.match(texto, /Estudiante A/);
  assert.match(texto, /Obra X/);
  assert.match(texto, /DEMO-002-2/);
  assert.match(texto, /05-06-2026/);
});

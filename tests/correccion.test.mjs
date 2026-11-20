import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, initialize } from '../scripts/db.mjs';

let db;
before(async () => { db = await openDb(); await initialize(db); });
after(async () => { await db?.close(); });
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
const loan = async (user, copies, date = '2026-05-04') =>
  (await rows('CALL biblioteca.sp_prestar($1,$2,$3)', [user, copies, date]))[0].p_prestamo;
const details = async id => (await rows('SELECT id FROM biblioteca.detalle_prestamo WHERE prestamo_id=$1 ORDER BY id', [id])).map(x => x.id);
async function rejected(sql, args, pattern) {
  await db.exec('SAVEPOINT anul');
  try { await assert.rejects(db.query(sql, args), pattern); }
  finally { await db.exec('ROLLBACK TO SAVEPOINT anul; RELEASE SAVEPOINT anul'); }
}
function check(name, fn) {
  test(name, async () => {
    await db.exec('BEGIN');
    try { await fn(); }
    finally { await db.exec('ROLLBACK'); }
  });
}

// Orden de parámetros: (prestamo, motivo, fecha, operador, observaciones).
check('CORR 01 - anula un préstamo abierto y conserva historial y motivo', async () => {
  const p = await loan(1, [25], '2026-05-04');
  const d = await details(p);
  await db.query('CALL biblioteca.sp_anular_prestamo($1,$2,$3,$4,$5)',
    [p, 'Préstamo a la persona equivocada', '2026-05-05', 'Operador de prueba', null]);
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.correccion WHERE prestamo_id=$1', [p]), 1);
  assert.equal(await scalar('SELECT motivo FROM biblioteca.correccion WHERE prestamo_id=$1', [p]), 'Préstamo a la persona equivocada');
  assert.equal(await scalar('SELECT operador FROM biblioteca.correccion WHERE prestamo_id=$1', [p]), 'Operador de prueba');
  assert.equal(await scalar('SELECT fecha_cierre::text FROM biblioteca.detalle_prestamo WHERE id=$1', [d[0]]), '2026-05-05');
  assert.equal(await scalar('SELECT disponible FROM biblioteca.v_disponibilidad WHERE ejemplar_id=25'), true);
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.prestamo WHERE id=$1', [p]), 1, 'el préstamo original se conserva');
  assert.equal(await scalar('SELECT observaciones FROM biblioteca.detalle_devolucion WHERE detalle_prestamo_id=$1', [d[0]]), 'Anulación: Préstamo a la persona equivocada');
});

check('CORR 02 - exige motivo y rechaza préstamos ya cerrados', async () => {
  const p = await loan(1, [25], '2026-05-04');
  await rejected('CALL biblioteca.sp_anular_prestamo($1,$2,$3)', [p, '', '2026-05-05'], /motivo/);
  await db.query('CALL biblioteca.sp_anular_prestamo($1,$2,$3)', [p, 'Motivo válido', '2026-05-05']);
  await rejected('CALL biblioteca.sp_anular_prestamo($1,$2,$3)', [p, 'Otra vez', '2026-05-06'], /abiertos/);
});

check('CORR 03 - no anula ejemplares con incidencia pendiente', async () => {
  const p = await loan(1, [25], '2026-05-04');
  const [d] = await details(p);
  await db.query('CALL biblioteca.sp_registrar_incidencia($1,$2,$3,$4)', [d, 'perdida', '2026-05-05', 'Extraviado']);
  await rejected('CALL biblioteca.sp_anular_prestamo($1,$2,$3)', [p, 'Motivo', '2026-05-06'], /incidencias/);
});

check('CORR 04 - la corrección es inmutable', async () => {
  const p = await loan(1, [25], '2026-05-04');
  await db.query('CALL biblioteca.sp_anular_prestamo($1,$2,$3)', [p, 'Motivo', '2026-05-05']);
  await rejected('UPDATE biblioteca.correccion SET motivo=\'otro\' WHERE prestamo_id=$1', [p], /inmutable|historial/);
});

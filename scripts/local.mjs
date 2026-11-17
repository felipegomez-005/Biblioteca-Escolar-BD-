import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { root, openDb, initialize } from './db.mjs';

const command = process.argv[2];
if (!['init','resumen','sql'].includes(command)) throw new Error('Use db:init, db:resumen o db:sql -- archivo.sql');
const local = path.join(root, '.local');
await mkdir(local, { recursive: true });
// PGlite tiene una conexión exclusiva: dos procesos no deben abrir el mismo directorio.
const lockPath = path.join(local, 'biblioteca.lock');
let lock;
try { lock = await open(lockPath, 'wx'); }
catch { throw new Error('La base local está en uso. Cierre la otra consulta antes de continuar.'); }
let db;
try {
  db = await openDb(path.join(local, 'biblioteca'));
  if (command === 'init') {
    await initialize(db);
    console.log('Base local creada con calendario y datos ficticios.');
  } else {
    const { rows } = await db.query("SELECT to_regnamespace('biblioteca') IS NOT NULL AS existe");
    if (!rows[0].existe) throw new Error('Ejecute npm run db:init primero.');
    if (command === 'resumen') {
      console.table((await db.query(`SELECT prestamo_id,detalle_id,codigo,
        vencimiento_vigente::text AS vencimiento,cantidad_renovaciones AS renovaciones,
        estado FROM biblioteca.v_movimientos ORDER BY detalle_id`)).rows);
      const [kpi] = (await db.query('CALL biblioteca.sp_kpis_anuales(2026)')).rows;
      console.log('Operaciones de préstamo por curso (2026)');
      console.table(kpi.p_por_curso);
      console.log('Ejemplares prestados por libro (2026)');
      console.table(kpi.p_libros_mas_prestados);
    } else {
      if (!process.argv[3]) throw new Error('Indique un archivo SQL.');
      const sql = await readFile(path.resolve(process.argv[3]), 'utf8');
      const results = await db.exec(sql);
      for (const result of results) if (result.rows?.length) console.table(result.rows);
    }
  }
} finally {
  try { if (db) await db.close(); }
  finally { await lock.close(); await unlink(lockPath); }
}

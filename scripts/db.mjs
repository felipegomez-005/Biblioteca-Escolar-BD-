import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const root = fileURLToPath(new URL('../', import.meta.url));
const upgrades = ['06_administracion_calendario.sql', '07_devolucion_condiciones.sql', '08_avisos_detalle.sql', '09_anulacion_prestamo.sql', '10_seguridad_auditoria.sql'];
export const files = ['01_esquema.sql', '02_reglas.sql', '03_operaciones.sql', '04_datos_demo.sql', ...upgrades];
export async function upgrade(db) {
  for(const file of upgrades)await db.exec(await readFile(path.join(root,'sql',file),'utf8'));
}
export async function openDb(dataDir) {
  const db = await PGlite.create(dataDir);
  await db.exec("SET TIME ZONE 'America/Santiago'; SET search_path TO biblioteca, public;");
  return db;
}
export async function initialize(db) {
  const { rows } = await db.query("SELECT to_regnamespace('biblioteca') IS NOT NULL AS existe");
  if (rows[0].existe) throw new Error('La base ya existe. No se sobrescribió ningún dato.');
  for (const file of files) {
    await db.exec(await readFile(path.join(root, 'sql', file), 'utf8'));
  }
}

import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { openDb, root } from './db.mjs';
import { enviarAvisos, smtpConfig, crearEnviador } from './avisos-lib.mjs';

try { loadEnvFile(path.join(root, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const args = process.argv.slice(2);
const command = args[0];
const simular = args.includes('--simular');
if (!['enviar', 'preparar'].includes(command) || (command === 'preparar' && simular))
  throw new Error('Use avisos:enviar [--simular] o avisos:preparar.');

const local = path.join(root, '.local');
await mkdir(local, { recursive: true });
const lockPath = path.join(local, 'biblioteca.lock');
let lock;
try { lock = await open(lockPath, 'wx'); }
catch { throw new Error('La base local está en uso (¿la aplicación está abierta?). Use «Enviar ahora» en la pantalla Avisos o cierre la aplicación.'); }

let db;
try {
  db = await openDb(path.join(local, 'biblioteca'));
  const { rows } = await db.query("SELECT to_regnamespace('biblioteca') IS NOT NULL AS existe");
  if (!rows[0].existe) throw new Error('Ejecute npm run db:init primero.');
  const fecha = process.env.AVISOS_FECHA || (await db.query('SELECT CURRENT_DATE::text AS d')).rows[0].d;

  if (command === 'preparar') {
    await db.query('CALL biblioteca.sp_preparar_avisos($1)', [fecha]);
    const [{ n }] = (await db.query("SELECT count(*)::integer AS n FROM biblioteca.aviso_correo WHERE estado = 'pendiente'")).rows;
    console.log(`Avisos pendientes preparados: ${n}.`);
  } else if (simular) {
    await db.exec('BEGIN');
    try {
      await db.query('CALL biblioteca.sp_preparar_avisos($1)', [fecha]);
      const pendientes = (await db.query(
        `SELECT a.destinatario, a.asunto, a.estado FROM biblioteca.aviso_correo a
         WHERE a.estado IN ('pendiente','error') ORDER BY a.id`)).rows;
      console.log(`Simulación (${fecha}): ${pendientes.length} avisos por enviar o reintentar. No se envió ni guardó nada.`);
      for (const p of pendientes) console.log(`  - ${p.destinatario} · ${p.asunto} (${p.estado})`);
    } finally { await db.exec('ROLLBACK'); }
  } else {
    const sendMail = await crearEnviador(smtpConfig());
    if (!sendMail) throw new Error('Configure SMTP_HOST y SMTP_FROM en .env para enviar avisos (o use --simular).');
    const res = await enviarAvisos(db, { sendMail, fecha });
    if (res.cerrada) console.log('Hoy la biblioteca no atiende: no se generaron avisos nuevos.');
    console.log(`Avisos procesados: ${res.pendientes}. Enviados: ${res.enviados}. Cancelados: ${res.cancelados}. Errores: ${res.errores}.`);
  }
} catch (error) {
  if (/Biblioteca cerrada/.test(error?.message || '')) console.log('Hoy la biblioteca está cerrada: no se generan ni envían avisos.');
  else throw error;
} finally {
  try { if (db) await db.close(); }
  finally { await lock.close(); await unlink(lockPath); }
}

import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import nodemailer from 'nodemailer';
import { openDb, root } from './db.mjs';
import { enviarAvisos } from './avisos-lib.mjs';

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
catch { throw new Error('La base local está en uso. Cierre la otra operación antes de continuar.'); }

function crearTransporter() {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) throw new Error('Configure SMTP_HOST y SMTP_FROM en .env para enviar avisos (o use --simular).');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = (process.env.SMTP_SECURE || 'false') === 'true';
  const auth = process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined;
  return nodemailer.createTransport({ host, port, secure, auth });
}

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
    await db.query('CALL biblioteca.sp_preparar_avisos($1)', [fecha]);
    const pendientes = (await db.query(
      `SELECT a.prestamo_id, a.destinatario, a.asunto
       FROM biblioteca.aviso_correo a
       WHERE a.estado = 'pendiente' ORDER BY a.id`)).rows;
    console.log(`Simulación (${fecha}): ${pendientes.length} avisos pendientes. No se envió ni modificó nada.`);
    for (const p of pendientes) console.log(`  - ${p.destinatario} · ${p.asunto}`);
  } else {
    const transporter = crearTransporter();
    const sendMail = async m => {
      await transporter.sendMail({ from: process.env.SMTP_FROM, to: m.destinatario, subject: m.asunto, text: m.texto });
    };
    const res = await enviarAvisos(db, { sendMail, fecha });
    console.log(`Avisos procesados: ${res.pendientes}. Enviados: ${res.enviados}. Cancelados: ${res.cancelados}. Errores: ${res.errores}.`);
  }
} catch (error) {
  if (/Biblioteca cerrada/.test(error?.message || '')) {
    console.log('Hoy la biblioteca está cerrada: no se generan ni envían avisos.');
  } else {
    throw error;
  }
} finally {
  try { if (db) await db.close(); }
  finally { await lock.close(); await unlink(lockPath); }
}

// Preparación y envío de avisos por correo.
// Separado del CLI y del servidor para poder probarlo con un transporte simulado.

const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows;
const fechaEs = iso => iso.split('-').reverse().join('-');
export const MAX_INTENTOS = 3;

export function construirTexto(nombre, detalles) {
  const lineas = detalles.map(d => `- ${d.titulo} (código ${d.codigo}) · vencía el ${fechaEs(d.vencimiento)}`);
  return `Hola ${nombre}:\n\n` +
    'Tienes ejemplares pendientes de devolución en la biblioteca del Colegio Siglo XXI de Lampa:\n\n' +
    `${lineas.join('\n')}\n\n` +
    'Por favor devuélvelos o renueva a la brevedad. Si ya los devolviste, ignora este mensaje.\n\n' +
    'Biblioteca · Colegio Siglo XXI de Lampa';
}

// Configuración SMTP desde variables de entorno. Devuelve null si falta lo mínimo.
export function smtpConfig(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  return {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: (env.SMTP_SECURE || 'false') === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
    from: env.SMTP_FROM,
  };
}

// Crea la función sendMail usada por enviarAvisos a partir de nodemailer.
export async function crearEnviador(config) {
  if (!config) return null;
  const { default: nodemailer } = await import('nodemailer');
  const { from, ...transport } = config;
  const transporter = nodemailer.createTransport({ ...transport, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
  return async m => { await transporter.sendMail({ from, to: m.destinatario, subject: m.asunto, text: m.texto }); };
}

// Envía todos los avisos que sigan correspondiendo.
// - Prepara los avisos del día (deduplicados por préstamo y fecha), si la biblioteca atiende.
// - Cancela los que ya quedaron resueltos (ejemplares devueltos, renovados o con incidencia).
// - Reintenta los que fallaron antes, hasta MAX_INTENTOS intentos en total.
// - Envía con `sendMail` y registra el resultado en aviso_correo.
export async function enviarAvisos(db, { sendMail, fecha, preparar = true, reintentar = true } = {}) {
  if (typeof sendMail !== 'function') throw new Error('Se requiere una función sendMail para enviar avisos.');
  const dia = fecha || new Date().toISOString().slice(0, 10);
  let cerrada = false;
  if (preparar) {
    // Se consulta antes de llamar al procedimiento para no abortar una transacción en curso.
    // Día cerrado o sin calendario: no se generan avisos nuevos, pero se procesan los existentes.
    const [cal] = await rows(db, 'SELECT abierto FROM biblioteca.calendario WHERE fecha = $1', [dia]);
    cerrada = !cal?.abierto;
    if (!cerrada) await db.query('CALL biblioteca.sp_preparar_avisos($1)', [dia]);
  }

  // Un aviso pendiente que nunca se envió y ya tiene uno más reciente del mismo préstamo se cancela:
  // la persona recibe un solo correo con la situación actual.
  const reemplazados = (await db.query(
    `UPDATE biblioteca.aviso_correo a SET estado = 'cancelado'
     WHERE a.estado = 'pendiente'
       AND EXISTS (SELECT 1 FROM biblioteca.aviso_correo b
                   WHERE b.prestamo_id = a.prestamo_id AND b.fecha_generacion > a.fecha_generacion)`)).affectedRows || 0;

  const pendientes = await rows(db,
    `SELECT a.id, a.prestamo_id, a.destinatario, a.asunto, u.nombre AS usuario_nombre
     FROM biblioteca.aviso_correo a
     JOIN biblioteca.prestamo p ON p.id = a.prestamo_id
     JOIN biblioteca.usuario u ON u.id = p.usuario_id
     WHERE a.estado = 'pendiente'
        OR ($1 AND a.estado = 'error' AND a.intentos < $2
            -- Un aviso más reciente del mismo préstamo reemplaza al que falló: no se duplica el correo.
            AND NOT EXISTS (SELECT 1 FROM biblioteca.aviso_correo b
                            WHERE b.prestamo_id = a.prestamo_id AND b.fecha_generacion > a.fecha_generacion))
     ORDER BY a.id`, [reintentar, MAX_INTENTOS]);
  if (!pendientes.length) return { pendientes: 0, enviados: 0, cancelados: reemplazados, errores: 0, cerrada };

  const ids = pendientes.map(a => a.prestamo_id);
  const detalles = await rows(db,
    `SELECT d.prestamo_id, e.codigo, l.titulo, d.vencimiento_vigente::text AS vencimiento
     FROM biblioteca.detalle_prestamo d
     JOIN biblioteca.ejemplar e ON e.id = d.ejemplar_id
     JOIN biblioteca.libro l ON l.id = e.libro_id
     WHERE d.prestamo_id = ANY($1)
       AND d.fecha_cierre IS NULL
       AND d.vencimiento_vigente < $2
       AND NOT EXISTS (SELECT 1 FROM biblioteca.incidencia i WHERE i.detalle_id = d.id)
     ORDER BY d.prestamo_id, d.id`, [ids, dia]);

  const porPrestamo = new Map();
  for (const d of detalles) {
    if (!porPrestamo.has(d.prestamo_id)) porPrestamo.set(d.prestamo_id, []);
    porPrestamo.get(d.prestamo_id).push(d);
  }

  let enviados = 0, cancelados = reemplazados, errores = 0;
  for (const aviso of pendientes) {
    const detalle = porPrestamo.get(aviso.prestamo_id) || [];
    if (!detalle.length) {
      await db.query(`UPDATE biblioteca.aviso_correo SET estado = 'cancelado' WHERE id = $1`, [aviso.id]);
      cancelados++;
      continue;
    }
    try {
      await sendMail({
        prestamo_id: aviso.prestamo_id,
        destinatario: aviso.destinatario,
        asunto: aviso.asunto,
        texto: construirTexto(aviso.usuario_nombre, detalle),
      });
      await db.query(`UPDATE biblioteca.aviso_correo SET estado = 'enviado', enviado_en = now(), error_detalle = NULL,
        intentos = intentos + 1, ultimo_intento = now() WHERE id = $1`, [aviso.id]);
      enviados++;
    } catch (error) {
      await db.query(`UPDATE biblioteca.aviso_correo SET estado = 'error', enviado_en = NULL, error_detalle = $2,
        intentos = intentos + 1, ultimo_intento = now() WHERE id = $1`, [aviso.id, String(error?.message || error).slice(0, 1000)]);
      errores++;
    }
  }
  return { pendientes: pendientes.length, enviados, cancelados, errores, cerrada };
}

// Programación diaria dentro del servidor (PGlite admite un solo proceso).
// `hora` en formato HH:MM, hora local del equipo. Devuelve un objeto con la próxima ejecución.
export function programarDiario(hora, tarea, { now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora || '');
  if (!m) throw new Error('AVISOS_HORA debe tener formato HH:MM, por ejemplo 08:30.');
  let timer, detenido = false;
  const programacion = { hora, proxima: null, detener() { detenido = true; clearTimer(timer); } };
  const agendar = () => {
    if (detenido) return;
    const ahora = now(), objetivo = new Date(ahora);
    objetivo.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (objetivo <= ahora) objetivo.setDate(objetivo.getDate() + 1);
    programacion.proxima = objetivo;
    timer = setTimer(async () => { try { await tarea(); } catch (e) { console.error('Avisos automáticos:', e.message); } finally { agendar(); } }, objetivo - ahora);
    timer?.unref?.();
  };
  agendar();
  return programacion;
}

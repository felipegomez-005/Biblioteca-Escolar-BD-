// Preparación y envío de avisos por correo.
// Separado del CLI para poder probarlo con un transporte simulado.

const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows;
const fechaEs = iso => iso.split('-').reverse().join('-');

export function construirTexto(nombre, detalles) {
  const lineas = detalles.map(d => `- ${d.titulo} (código ${d.codigo}) · vencía el ${fechaEs(d.vencimiento)}`);
  return `Hola ${nombre}:\n\n` +
    'Tienes ejemplares pendientes de devolución en la biblioteca escolar:\n\n' +
    `${lineas.join('\n')}\n\n` +
    'Por favor devuélvelos o renueva a la brevedad. Si ya los devolviste, ignora este mensaje.\n\n' +
    'Biblioteca escolar';
}

// Envía todos los avisos pendientes que sigan correspondiendo.
// - Prepara los avisos del día (deduplicados por préstamo y fecha).
// - Cancela los que ya quedaron resueltos (ejemplares devueltos o con incidencia).
// - Envía el resto con `sendMail` y registra el resultado en aviso_correo.
export async function enviarAvisos(db, { sendMail, fecha, preparar = true } = {}) {
  if (typeof sendMail !== 'function') throw new Error('Se requiere una función sendMail para enviar avisos.');
  const dia = fecha || new Date().toISOString().slice(0, 10);
  if (preparar) await db.query('CALL biblioteca.sp_preparar_avisos($1)', [dia]);

  const pendientes = await rows(db,
    `SELECT a.id, a.prestamo_id, a.destinatario, a.asunto, u.nombre AS usuario_nombre
     FROM biblioteca.aviso_correo a
     JOIN biblioteca.prestamo p ON p.id = a.prestamo_id
     JOIN biblioteca.usuario u ON u.id = p.usuario_id
     WHERE a.estado = 'pendiente'
     ORDER BY a.id`);
  if (!pendientes.length) return { pendientes: 0, enviados: 0, cancelados: 0, errores: 0 };

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

  let enviados = 0, cancelados = 0, errores = 0;
  for (const aviso of pendientes) {
    const detalle = porPrestamo.get(aviso.prestamo_id) || [];
    if (!detalle.length) {
      await db.query(`UPDATE biblioteca.aviso_correo SET estado = 'cancelado', error_detalle = NULL WHERE id = $1`, [aviso.id]);
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
      await db.query(`UPDATE biblioteca.aviso_correo SET estado = 'enviado', enviado_en = now(), error_detalle = NULL WHERE id = $1`, [aviso.id]);
      enviados++;
    } catch (error) {
      await db.query(`UPDATE biblioteca.aviso_correo SET estado = 'error', enviado_en = NULL, error_detalle = $2 WHERE id = $1`, [aviso.id, String(error?.message || error)]);
      errores++;
    }
  }
  return { pendientes: pendientes.length, enviados, cancelados, errores };
}

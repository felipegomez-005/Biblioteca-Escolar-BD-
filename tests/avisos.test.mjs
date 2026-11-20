import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, initialize } from '../scripts/db.mjs';
import net from 'node:net';
import { enviarAvisos, construirTexto, crearEnviador, smtpConfig, programarDiario, MAX_INTENTOS } from '../scripts/avisos-lib.mjs';
import { createApp } from '../server/app.mjs';

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

check('AVISOS 06 - reintenta un aviso con error y lo marca enviado al segundo intento', async () => {
  const p = await loan(1, [25], '2026-06-01');
  await enviarAvisos(db, { sendMail: async () => { throw new Error('Timeout'); }, fecha: '2026-06-08' });
  assert.equal(await estado(p), 'error');
  const enviados = [];
  await enviarAvisos(db, { sendMail: async m => enviados.push(m), fecha: '2026-06-08' });
  assert.equal(await estado(p), 'enviado');
  assert.equal(enviados.filter(m => m.prestamo_id === p).length, 1);
  assert.equal(await scalar('SELECT intentos FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), 2);
  assert.equal(await scalar('SELECT error_detalle IS NULL FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), true);
});

check('AVISOS 07 - deja de reintentar al alcanzar el máximo de intentos', async () => {
  const p = await loan(1, [25], '2026-06-01');
  const falla = async () => { throw new Error('Credenciales SMTP rechazadas'); };
  for (let i = 0; i < MAX_INTENTOS + 2; i++) await enviarAvisos(db, { sendMail: falla, fecha: '2026-06-08' });
  assert.equal(await scalar('SELECT intentos FROM biblioteca.aviso_correo WHERE prestamo_id=$1', [p]), MAX_INTENTOS);
  assert.equal(await estado(p), 'error');
});

check('AVISOS 08 - un aviso fallido no se duplica cuando ya existe el del día siguiente', async () => {
  const p = await loan(1, [25], '2026-06-01');
  await enviarAvisos(db, { sendMail: async () => { throw new Error('Caída'); }, fecha: '2026-06-08' });
  const enviados = [];
  await enviarAvisos(db, { sendMail: async m => enviados.push(m), fecha: '2026-06-09' });
  assert.equal(enviados.filter(m => m.prestamo_id === p).length, 1, 'un solo correo por préstamo');
  const estados = await rows('SELECT fecha_generacion::text f, estado FROM biblioteca.aviso_correo WHERE prestamo_id=$1 ORDER BY f', [p]);
  assert.deepEqual(estados.map(x => x.estado), ['error', 'enviado']);
});

check('AVISOS 13 - dos avisos pendientes del mismo préstamo: se envía solo el más reciente', async () => {
  const p = await loan(1, [25], '2026-06-01');
  await db.query('CALL biblioteca.sp_preparar_avisos($1)', ['2026-06-08']);
  await db.query('CALL biblioteca.sp_preparar_avisos($1)', ['2026-06-09']);
  const enviados = [];
  const res = await enviarAvisos(db, { sendMail: async m => enviados.push(m), fecha: '2026-06-09', preparar: false });
  assert.equal(enviados.filter(m => m.prestamo_id === p).length, 1, 'un solo correo por préstamo');
  const estados = await rows('SELECT fecha_generacion::text f, estado FROM biblioteca.aviso_correo WHERE prestamo_id=$1 ORDER BY f', [p]);
  assert.deepEqual(estados.map(x => x.estado), ['cancelado', 'enviado']);
  assert.ok(res.cancelados >= 1);
});

check('AVISOS 09 - día sin atención: no genera avisos nuevos y no falla', async () => {
  const cerrado = await scalar("SELECT min(fecha)::text FROM biblioteca.calendario WHERE NOT abierto AND fecha > '2026-06-01'");
  const res = await enviarAvisos(db, { sendMail: async () => {}, fecha: cerrado });
  assert.equal(res.cerrada, true);
});

// Servidor SMTP mínimo en memoria para probar el envío real con nodemailer.
function fakeSmtp() {
  const mensajes = [];
  const server = net.createServer(socket => {
    let data = false, buffer = '', actual = { rcpt: [] };
    socket.write('220 prueba ESMTP\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let i;
      while ((i = data ? buffer.indexOf('\r\n.\r\n') : buffer.indexOf('\r\n')) >= 0) {
        if (data) {
          actual.cuerpo = buffer.slice(0, i); buffer = buffer.slice(i + 5); data = false;
          mensajes.push(actual); actual = { rcpt: [] }; socket.write('250 OK\r\n'); continue;
        }
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-prueba\r\n250 8BITMIME\r\n');
        else if (cmd === 'MAIL') { actual.from = line; socket.write('250 OK\r\n'); }
        else if (cmd === 'RCPT') { actual.rcpt.push(line); socket.write('250 OK\r\n'); }
        else if (cmd === 'DATA') { data = true; socket.write('354 Fin con punto\r\n'); }
        else if (cmd === 'QUIT') { socket.end('221 Cierre\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
  });
  return { server, mensajes };
}

check('AVISOS 10 - envío SMTP real con nodemailer contra un servidor local de prueba', async () => {
  const { server, mensajes } = fakeSmtp();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    assert.equal(smtpConfig({}), null, 'sin host no hay configuración');
    const config = smtpConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_FROM: 'Biblioteca <biblioteca@example.invalid>' });
    const sendMail = await crearEnviador({ ...config, ignoreTLS: true });
    const p = await loan(1, [25], '2026-06-01');
    const res = await enviarAvisos(db, { sendMail, fecha: '2026-06-08' });
    assert.ok(res.enviados >= 1);
    assert.equal(await estado(p), 'enviado');
    const m = mensajes.find(x => x.rcpt.some(r => r.includes('estudiante1@example.invalid')));
    assert.ok(m, 'el servidor SMTP recibió el mensaje');
    assert.match(m.from, /biblioteca@example\.invalid/);
    assert.match(m.cuerpo, /Recordatorio_de_devoluci/);
    assert.match(m.cuerpo, /DEMO-009-1/);
  } finally { await new Promise(r => server.close(r)); }
});

test('AVISOS 11 - programación diaria calcula la próxima ejecución y se reprograma', async () => {
  const timers = [];
  let ahora = new Date(2026, 5, 8, 9, 0, 0);
  let ejecuciones = 0;
  const prog = programarDiario('08:30', async () => { ejecuciones++; }, {
    now: () => ahora, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
  });
  assert.equal(prog.proxima.getDate(), 9, 'pasada la hora, programa para mañana');
  assert.equal(timers[0].ms, 23.5 * 3600 * 1000);
  ahora = new Date(2026, 5, 9, 8, 30, 0);
  await timers[0].fn();
  assert.equal(ejecuciones, 1);
  assert.equal(timers.length, 2, 'se reprograma para el día siguiente');
  assert.throws(() => programarDiario('8:30', () => {}), /HH:MM/);
  prog.detener();
});

test('AVISOS 12 - panel de avisos por API: estados, envío manual y SMTP sin configurar', async () => {
  const local = await openDb(); await initialize(local);
  const enviados = [];
  const sin = createApp(local, { today: '2026-06-08' });
  const con = createApp(local, { today: '2026-06-08', sendMail: async m => enviados.push(m) });
  await new Promise(r => sin.listen(0, '127.0.0.1', r));
  await new Promise(r => con.listen(0, '127.0.0.1', r));
  const call = (srv, url, body) => fetch(`http://127.0.0.1:${srv.address().port}/api${url}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Biblioteca-Request': '1' }, body: body && JSON.stringify(body),
  }).then(async r => ({ status: r.status, data: await r.json() }));
  try {
    await local.query('CALL biblioteca.sp_prestar($1,$2,$3)', [1, [25], '2026-06-01']);
    const panel = await call(sin, '/avisos');
    assert.equal(panel.status, 200); assert.equal(panel.data.smtp, false);
    const fallo = await call(sin, '/avisos/enviar', {});
    assert.equal(fallo.status, 409); assert.match(fallo.data.error, /SMTP/);
    const prep = await call(sin, '/avisos/preparar', {});
    assert.equal(prep.status, 201); assert.ok(prep.data.pendientes >= 1);
    const ok = await call(con, '/avisos/enviar', {});
    assert.equal(ok.status, 201); assert.ok(ok.data.enviados >= 1);
    const despues = await call(con, '/avisos?estado=enviado');
    assert.ok(despues.data.avisos.length >= 1);
    assert.equal(despues.data.ultimo.origen, 'manual');
    assert.equal(despues.data.resumen.find(r => r.estado === 'enviado').cantidad, despues.data.avisos.length);
    assert.equal((await call(con, '/avisos?estado=otro')).status, 400);
  } finally {
    for (const s of [sin, con]) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
    await local.close();
  }
});

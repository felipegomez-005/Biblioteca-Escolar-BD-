import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, initialize } from '../scripts/db.mjs';

let db;
before(async () => { db = await openDb(); await initialize(db); });
after(async () => { await db?.close(); });
const rows = async (sql, args=[]) => (await db.query(sql,args)).rows;
const scalar = async (sql, args=[]) => Object.values((await rows(sql,args))[0])[0];
const loan = async (user, copies, date='2026-05-04') =>
  (await rows('CALL biblioteca.sp_prestar($1,$2,$3)',[user,copies,date]))[0].p_prestamo;
const details = async id => (await rows('SELECT id FROM biblioteca.detalle_prestamo WHERE prestamo_id=$1 ORDER BY id',[id])).map(x=>x.id);
async function rejected(sql,args,pattern) {
  await db.exec('SAVEPOINT rechazo');
  try { await assert.rejects(db.query(sql,args),pattern); }
  finally { await db.exec('ROLLBACK TO SAVEPOINT rechazo; RELEASE SAVEPOINT rechazo'); }
}
function check(name, fn) {
  test(name, async () => {
    await db.exec('BEGIN');
    try { await fn(); }
    finally { await db.exec('ROLLBACK'); }
  });
}

check('01 - tres ejemplares son una operación con tres detalles', async () => {
  const id=await loan(7,[25,26,27]);
  assert.equal((await details(id)).length,3);
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.prestamo WHERE id=$1',[id]),1);
});
check('02 - límite simultáneo incluye préstamos separados y rechaza toda la operación',async()=>{
  await loan(7,[25,26]);
  const antes=await scalar('SELECT count(*) FROM biblioteca.prestamo');
  await rejected('CALL biblioteca.sp_prestar(7,ARRAY[27,28],date \'2026-05-04\')',[],/tres ejemplares simultáneos/);
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.prestamo'),antes);
  assert.equal(await scalar('SELECT disponible FROM biblioteca.v_disponibilidad WHERE ejemplar_id=27'),true);
});
check('03 - una copia no puede prestarse dos veces simultáneamente',async()=>{
  await loan(7,[25]);
  await rejected('CALL biblioteca.sp_prestar(8,ARRAY[25],date \'2026-05-04\')',[],/ejemplar_un_prestamo_abierto/);
});
check('04 - devolución parcial libera solo la copia entregada',async()=>{
  const id=await loan(7,[25,26,27]); const d=await details(id);
  await db.query('CALL biblioteca.sp_devolver($1,$2,$3)',[7,[d[0]],'2026-05-05']);
  assert.deepEqual((await rows('SELECT disponible FROM biblioteca.v_disponibilidad WHERE ejemplar_id IN (25,26,27) ORDER BY ejemplar_id')).map(x=>x.disponible),[true,false,false]);
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.detalle_prestamo WHERE prestamo_id=$1 AND vencimiento_vigente=date \'2026-05-07\'',[id]),3);
  await loan(7,[28],'2026-05-05');
});
check('05 - renovación desde vencimiento, independiente por copia y con atributo calculado',async()=>{
  const d=await details(await loan(7,[25,26]));
  await db.query('CALL biblioteca.sp_renovar($1,$2)',[[d[0]],'2026-05-05']);
  assert.deepEqual(await rows('SELECT vencimiento_vigente::text AS fecha,cantidad_renovaciones AS n FROM biblioteca.detalle_prestamo WHERE id=ANY($1) ORDER BY id',[d]),
    [{fecha:'2026-05-12',n:1},{fecha:'2026-05-07',n:0}]);
});
check('06 - tercera renovación se rechaza sin cambiar el vencimiento',async()=>{
  const [d]=await details(await loan(7,[25]));
  await db.query('CALL biblioteca.sp_renovar($1,$2)',[[d],'2026-05-05']);
  await db.query('CALL biblioteca.sp_renovar($1,$2)',[[d],'2026-05-06']);
  await rejected('CALL biblioteca.sp_renovar($1,$2)',[[d],'2026-05-07'],/dos renovaciones/);
  assert.equal(await scalar('SELECT cantidad_renovaciones FROM biblioteca.detalle_prestamo WHERE id=$1',[d]),2);
});
check('07 - no se renueva un ejemplar atrasado',async()=>{
  const [d]=await details(await loan(7,[25]));
  await rejected('CALL biblioteca.sp_renovar($1,$2)',[[d],'2026-05-08'],/atrasado/);
});
check('08 - fines de semana y feriados se excluyen de los tres días hábiles',async()=>{
  assert.equal(await scalar("SELECT biblioteca.sumar_habiles(date '2026-06-01',3)::text"),'2026-06-05');
  assert.equal(await scalar("SELECT biblioteca.sumar_habiles(date '2026-05-08',3)::text"),'2026-05-13');
});
check('09 - última semana permite devoluciones pero rechaza préstamos y renovaciones',async()=>{
  const [d]=await details(await loan(7,[25],'2026-06-26'));
  await rejected('CALL biblioteca.sp_prestar(8,ARRAY[26],date \'2026-06-29\')',[],/No se permiten préstamos/);
  await rejected('CALL biblioteca.sp_renovar($1,$2)',[[d],'2026-06-29'],/No se permiten renovaciones/);
  await db.query('CALL biblioteca.sp_devolver($1,$2,$3)',[7,[d],'2026-06-29']);
});
check('10 - se rechaza renovación que cruza vacaciones aunque se pida antes',async()=>{
  const [d]=await details(await loan(7,[25],'2026-06-26'));
  await rejected('CALL biblioteca.sp_renovar($1,$2)',[[d],'2026-06-26'],/vacaciones/);
});
check('11 - sanción por atraso permanece tras devolver y termina una semana desde el atraso',async()=>{
  const [d]=await details(await loan(7,[25],'2026-05-04'));
  await db.query('CALL biblioteca.sp_devolver($1,$2,$3)',[7,[d],'2026-05-08']);
  assert.equal(await scalar("SELECT count(*) FROM biblioteca.motivos_bloqueo(7,date '2026-05-14')"),1);
  assert.equal(await scalar("SELECT count(*) FROM biblioteca.motivos_bloqueo(7,date '2026-05-15')"),0);
});
check('12 - terminar sanción no habilita mientras siga el ejemplar atrasado',async()=>{
  await loan(7,[25]);
  assert.deepEqual(await rows("SELECT DISTINCT motivo FROM biblioteca.motivos_bloqueo(7,date '2026-05-18')"),[{motivo:'ejemplar_atrasado'}]);
  await rejected('CALL biblioteca.sp_prestar(7,ARRAY[26],date \'2026-05-18\')',[],/bloqueado/);
});
check('13 - conducta grave dura dos semanas e incluye feriados internos',async()=>{
  await db.query("CALL biblioteca.sp_sancionar_conducta(7,date '2026-05-28')");
  // Fin nominal 11/06, feriado ficticio: se habilita el viernes 12/06.
  assert.equal(await scalar('SELECT habilitado_desde::text FROM biblioteca.sancion WHERE usuario_id=7'),'2026-06-12');
  assert.equal(await scalar("SELECT count(*) FROM biblioteca.motivos_bloqueo(7,date '2026-06-10')"),1);
  assert.equal(await scalar("SELECT count(*) FROM biblioteca.motivos_bloqueo(7,date '2026-06-12')"),0);
});
check('14 - pérdida bloquea y reposición conserva historial con una copia nueva',async()=>{
  const [d]=await details(await loan(7,[25]));
  await db.query('CALL biblioteca.sp_registrar_incidencia($1,$2,$3)',[d,'perdida','2026-05-05']);
  const i=await scalar('SELECT id FROM biblioteca.incidencia WHERE detalle_id=$1',[d]);
  await rejected('CALL biblioteca.sp_prestar(7,ARRAY[26],date \'2026-05-06\')',[],/bloqueado/);
  await db.query('CALL biblioteca.sp_resolver_incidencia($1,$2,$3,$4)',[i,'2026-05-06','reposicion','TEST-REPOSICION']);
  assert.equal(await scalar('SELECT condicion FROM biblioteca.ejemplar WHERE id=25'),'baja');
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.detalle_prestamo WHERE id=$1',[d]),1);
  assert.equal(await scalar("SELECT disponible FROM biblioteca.v_disponibilidad WHERE codigo='TEST-REPOSICION'"),true);
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.detalle_devolucion WHERE detalle_prestamo_id=$1',[d]),0);
});
check('15 - reembolso requiere importe positivo y no borra la copia',async()=>{
  const [d]=await details(await loan(7,[25]));
  await db.query('CALL biblioteca.sp_registrar_incidencia($1,$2,$3)',[d,'dano_permanente','2026-05-05']);
  const i=await scalar('SELECT id FROM biblioteca.incidencia WHERE detalle_id=$1',[d]);
  await rejected('CALL biblioteca.sp_resolver_incidencia($1,$2,$3,NULL,$4)',[i,'2026-05-06','reembolso',0],/monto positivo/);
  await db.query('CALL biblioteca.sp_resolver_incidencia($1,$2,$3,NULL,$4)',[i,'2026-05-06','reembolso',10000]);
  assert.equal(await scalar('SELECT solucion FROM biblioteca.incidencia WHERE id=$1',[i]),'reembolso');
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.ejemplar WHERE id=25'),1);
});
check('16 - no se devuelve dos veces ni a nombre de otro usuario',async()=>{
  const [d]=await details(await loan(7,[25]));
  await rejected('CALL biblioteca.sp_devolver($1,$2,$3)',[8,[d],'2026-05-05'],/incompatible/);
  await db.query('CALL biblioteca.sp_devolver($1,$2,$3)',[7,[d],'2026-05-05']);
  await rejected('CALL biblioteca.sp_devolver($1,$2,$3)',[7,[d],'2026-05-06'],/incompatible/);
});
check('17 - curso histórico se conserva al cambiar curso actual',async()=>{
  const id=await loan(7,[25]);
  const anterior=await scalar('SELECT curso_al_prestar_id FROM biblioteca.prestamo WHERE id=$1',[id]);
  await db.query('UPDATE biblioteca.usuario SET curso_actual_id=3 WHERE id=7');
  assert.equal(await scalar('SELECT curso_al_prestar_id FROM biblioteca.prestamo WHERE id=$1',[id]),anterior);
});
check('18 - KPI cuenta operaciones por curso y ejemplares por libro; renovar no suma',async()=>{
  const antes=(await rows('CALL biblioteca.sp_kpis_anuales(2026)'))[0];
  const d=await details(await loan(7,[25,26,27]));
  await db.query('CALL biblioteca.sp_renovar($1,$2)',[[d[0]],'2026-05-05']);
  const despues=(await rows('CALL biblioteca.sp_kpis_anuales(2026)'))[0];
  const suma=(obj,campo)=>obj.reduce((n,x)=>n+Number(x[campo]),0);
  assert.equal(suma(despues.p_por_curso,'prestamos')-suma(antes.p_por_curso,'prestamos'),1);
  assert.equal(suma(despues.p_libros_mas_prestados,'ejemplares_prestados')-suma(antes.p_libros_mas_prestados,'ejemplares_prestados'),3);
});
check('19 - estudiantes requieren correo y el formato se valida',async()=>{
  await rejected('UPDATE biblioteca.usuario SET correo=NULL WHERE id=7',[],/check constraint/);
  await rejected("UPDATE biblioteca.usuario SET correo='incorrecto' WHERE id=7",[],/check constraint/);
});
check('20 - avisos se deduplican y quedan pendientes; no se envían correos',async()=>{
  await loan(7,[25]);
  await db.query("CALL biblioteca.sp_preparar_avisos(date '2026-05-08')");
  const n=await scalar('SELECT count(*) FROM biblioteca.aviso_correo');
  await db.query("CALL biblioteca.sp_preparar_avisos(date '2026-05-08')");
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.aviso_correo'),n);
  assert.equal(await scalar("SELECT count(*) FROM biblioteca.aviso_correo WHERE estado<>'pendiente'"),0);
});
check('21 - no se asume calendario para fechas desconocidas',async()=>{
  await rejected("SELECT biblioteca.sumar_habiles(date '2028-01-01',3)",[],/Falta calendario/);
});
check('22 - calendario cerrado impide préstamo',async()=>{
  await rejected("CALL biblioteca.sp_prestar(7,ARRAY[25],date '2026-05-09')",[],/cerrada/);
});
check('23 - una renovación fallida revierte todo el grupo',async()=>{
  const [d]=await details(await loan(7,[25]));
  await rejected('CALL biblioteca.sp_renovar($1,$2)',[[d,999999],'2026-05-05'],/no rows/);
  assert.equal(await scalar('SELECT cantidad_renovaciones FROM biblioteca.detalle_prestamo WHERE id=$1',[d]),0);
});
check('24 - historial y atributos calculados no se pueden sobrescribir directamente',async()=>{
  await rejected('DELETE FROM biblioteca.prestamo WHERE id=1',[],/historial/);
  await rejected('UPDATE biblioteca.detalle_prestamo SET cantidad_renovaciones=0 WHERE id=3',[],/inmutable/);
});
check('25 - préstamo vacío o lista repetida no genera operaciones',async()=>{
  await rejected("CALL biblioteca.sp_prestar(7,ARRAY[]::integer[],date '2026-05-04')",[],/uno a tres/);
  await rejected("CALL biblioteca.sp_prestar(7,ARRAY[25,25],date '2026-05-04')",[],/uno a tres/);
});
check('26 - cabecera sola se rechaza al comprobar restricciones diferidas',async()=>{
  await db.exec('SAVEPOINT vacio');
  await db.query("INSERT INTO biblioteca.prestamo(usuario_id,fecha) VALUES(7,date '2026-05-04')");
  await assert.rejects(db.exec('SET CONSTRAINTS ALL IMMEDIATE'),/al menos un ejemplar/);
  await db.exec('ROLLBACK TO SAVEPOINT vacio; RELEASE SAVEPOINT vacio');
});
check('27 - modelo incluye relación uno a uno opcional y varios autores',async()=>{
  assert.equal(await scalar('SELECT count(*) FROM biblioteca.libro_autor WHERE libro_id=1'),2);
  await rejected("INSERT INTO biblioteca.detalle_devolucion(devolucion_id,detalle_prestamo_id,condicion_recibida) VALUES(1,1,'bueno')",[],/incompatible|unique/);
});

// Estos CALL controlan la transacción; deben ejecutarse fuera de BEGIN.
test('28 - procedimiento revierte con ROLLBACK una actualización de correo',async()=>{
  const old=await scalar('SELECT correo FROM biblioteca.usuario WHERE id=7');
  await db.query('CALL biblioteca.sp_actualizar_correo($1,$2,$3)',[7,'cambio@example.invalid',false]);
  assert.equal(await scalar('SELECT correo FROM biblioteca.usuario WHERE id=7'),old);
});
test('29 - procedimiento confirma el correo y permite restaurar el dato de prueba',async()=>{
  const old=await scalar('SELECT correo FROM biblioteca.usuario WHERE id=7');
  try {
    await db.query('CALL biblioteca.sp_actualizar_correo($1,$2,$3)',[7,'cambio@example.invalid',true]);
    assert.equal(await scalar('SELECT correo FROM biblioteca.usuario WHERE id=7'),'cambio@example.invalid');
  } finally { await db.query('CALL biblioteca.sp_actualizar_correo($1,$2,$3)',[7,old,true]); }
});

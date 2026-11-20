// Login, roles, auditoría, RUT y conservación.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openDb,initialize} from '../scripts/db.mjs';
import {createApp,normalizeIdentifier} from '../server/app.mjs';
import {hashPassword,verifyPassword,createSessions,authorize,auditDetail} from '../server/auth.mjs';

let db,server,base;
before(async()=>{
  db=await openDb();await initialize(db);
  server=createApp(db,{today:'2026-05-04',requireAuth:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db?.close();});

async function request(url,data,{method='POST',cookie}={}) {
  const response=await fetch(base+'/api'+url,{method:data===undefined?'GET':method,
    headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1',...(cookie?{Cookie:cookie}:{})},
    body:data===undefined?undefined:JSON.stringify(data)});
  const set=response.headers.get('set-cookie');
  return {status:response.status,data:await response.json(),cookie:set?set.split(';')[0]:null,setCookie:set};
}
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
let admin,biblio,consulta;

test('SEG 01 - sin sesión no se accede a datos y se ofrece crear la cuenta inicial',async()=>{
  assert.equal((await request('/resumen')).status,401);
  assert.equal((await request('/prestamos',{usuario_id:1,ejemplares:[1]})).status,401);
  const s=await request('/sesion');
  assert.equal(s.status,200);
  assert.deepEqual([s.data.requiere,s.data.configurado,s.data.operador],[true,false,null]);
});

test('SEG 02 - cuenta inicial: crea admin una sola vez, con cookie HttpOnly y clave cifrada',async()=>{
  assert.equal((await request('/sesion/inicial',{usuario:'admin',nombre:'Administración',clave:'corta'})).status,400);
  const r=await request('/sesion/inicial',{usuario:'admin',nombre:'Administración',clave:'clave-admin-2026'});
  assert.equal(r.status,201);
  assert.match(r.setCookie,/HttpOnly/);assert.match(r.setCookie,/SameSite=Strict/);
  admin=r.cookie;
  const hash=await scalar("SELECT clave_hash FROM biblioteca.operador WHERE usuario='admin'");
  assert.match(hash,/^scrypt\$/);assert.ok(!hash.includes('clave-admin-2026'));
  assert.equal((await request('/sesion/inicial',{usuario:'otro',nombre:'Otro',clave:'clave-otro-2026'})).status,409);
  assert.equal((await request('/resumen',undefined,{cookie:admin})).status,200);
});

test('SEG 03 - admin crea operadores por rol; login incorrecto se rechaza y queda auditado',async()=>{
  assert.equal((await request('/operadores',{usuario:'bibliotecaria',nombre:'Bibliotecaria Demo',rol:'bibliotecaria',clave:'clave-biblio-2026'},{cookie:admin})).status,201);
  assert.equal((await request('/operadores',{usuario:'consulta',nombre:'Consulta Demo',rol:'consulta',clave:'clave-consulta-2026'},{cookie:admin})).status,201);
  assert.equal((await request('/operadores',{usuario:'mal',nombre:'X',rol:'superusuario',clave:'clave-mala-2026'},{cookie:admin})).status,400);
  const bad=await request('/sesion',{usuario:'bibliotecaria',clave:'incorrecta'});
  assert.equal(bad.status,401);assert.equal(bad.cookie,null);
  assert.equal(await scalar("SELECT count(*)::int FROM biblioteca.auditoria WHERE operador='bibliotecaria' AND resultado='rechazado'"),1);
  biblio=(await request('/sesion',{usuario:'Bibliotecaria',clave:'clave-biblio-2026'})).cookie;
  consulta=(await request('/sesion',{usuario:'consulta',clave:'clave-consulta-2026'})).cookie;
  assert.ok(biblio && consulta);
});

test('SEG 04 - permisos: consulta solo lee; bibliotecaria no administra; admin sí',async()=>{
  assert.equal((await request('/libros',undefined,{cookie:consulta})).status,200);
  const denied=await request('/cursos',{nombre:'Curso consulta',anio_escolar:2026},{cookie:consulta});
  assert.equal(denied.status,403);
  assert.equal(await scalar("SELECT count(*)::int FROM biblioteca.curso WHERE nombre='Curso consulta'"),0);
  assert.equal(await scalar("SELECT count(*)::int FROM biblioteca.auditoria WHERE operador='consulta' AND resultado='rechazado' AND ruta='/api/cursos'"),1);
  assert.equal((await request('/operadores',undefined,{cookie:biblio})).status,403);
  assert.equal((await request('/auditoria',undefined,{cookie:biblio})).status,403);
  assert.equal((await request('/anulaciones',{prestamo_id:1,motivo:'x'},{cookie:biblio})).status,403);
  assert.equal((await request('/cursos',{nombre:'Curso bibliotecaria',anio_escolar:2026},{cookie:biblio})).status,201);
  assert.equal((await request('/auditoria',undefined,{cookie:admin})).status,200);
});

test('SEG 05 - cada escritura registra quién la hizo, sin guardar contraseñas',async()=>{
  const p=await request('/prestamos',{usuario_id:1,ejemplares:[25]},{cookie:biblio});
  assert.equal(p.status,201);
  const row=(await db.query("SELECT operador_id,operador,detalle FROM biblioteca.auditoria WHERE ruta='/api/prestamos' AND resultado='ok' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(row.operador,'bibliotecaria');
  assert.deepEqual(row.detalle,{usuario_id:1,ejemplares:[25]});
  const log=(await request('/auditoria',undefined,{cookie:admin})).data;
  assert.ok(log.some(x=>x.ruta==='/api/operadores' && x.operador==='admin'));
  assert.ok(!JSON.stringify(log).includes('clave-'),'la auditoría no debe contener contraseñas');
  // La anulación toma el operador desde la sesión, no desde el formulario.
  const a=await request('/anulaciones',{prestamo_id:p.data.p_prestamo,motivo:'Ingresado por error en prueba',operador:'Otra persona'},{cookie:admin});
  assert.equal(a.status,201);
  assert.equal(await scalar('SELECT operador FROM biblioteca.correccion WHERE prestamo_id=$1',[p.data.p_prestamo]),'Administración (admin)');
});

test('SEG 06 - la auditoría es inmutable',async()=>{
  await assert.rejects(db.query("UPDATE biblioteca.auditoria SET operador='otro'"));
  await assert.rejects(db.query('DELETE FROM biblioteca.auditoria'));
});

test('SEG 07 - siempre queda una cuenta admin activa; desactivar cierra la sesión',async()=>{
  const ops=(await request('/operadores',undefined,{cookie:admin})).data;
  const adminId=ops.find(o=>o.usuario==='admin').id,biblioId=ops.find(o=>o.usuario==='bibliotecaria').id;
  assert.equal((await request('/operadores/'+adminId,{nombre:'Administración',rol:'consulta',activo:true},{method:'PATCH',cookie:admin})).status,409);
  assert.equal((await request('/operadores/'+biblioId,{nombre:'Bibliotecaria Demo',rol:'bibliotecaria',activo:false},{method:'PATCH',cookie:admin})).status,200);
  assert.equal((await request('/resumen',undefined,{cookie:biblio})).status,401);
  assert.equal((await request('/sesion',{usuario:'bibliotecaria',clave:'clave-biblio-2026'})).status,401);
});

test('SEG 08 - cerrar sesión invalida la cookie',async()=>{
  const c=(await request('/sesion',{usuario:'consulta',clave:'clave-consulta-2026'})).cookie;
  assert.equal((await request('/resumen',undefined,{cookie:c})).status,200);
  const out=await request('/sesion/salir',{},{cookie:c});
  assert.match(out.setCookie,/Max-Age=0/);
  assert.equal((await request('/resumen',undefined,{cookie:c})).status,401);
});

test('SEG 09 - bloqueo temporal tras cinco intentos fallidos',async()=>{
  let t=0;const s=createSessions(()=>t);
  for(let i=0;i<5;i++) { s.checkLock('x'); s.fail('x'); }
  assert.throws(()=>s.checkLock('x'),/Demasiados intentos/);
  t+=5*60*1000+1; s.checkLock('x');
  const token=s.create({id:1,usuario:'x',nombre:'X',rol:'admin'});
  t+=8*60*60*1000+1; assert.equal(s.get(token),null,'la sesión expira por inactividad');
});

test('SEG 10 - scrypt verifica y rechaza; auditDetail quita claves; authorize por rol',async()=>{
  const h=await hashPassword('una-clave-larga');
  assert.equal(await verifyPassword('una-clave-larga',h),true);
  assert.equal(await verifyPassword('otra-clave-larga',h),false);
  assert.notEqual(h,await hashPassword('una-clave-larga'),'la sal es aleatoria');
  assert.deepEqual(auditDetail({usuario:'a',clave:'x',consulta_id:'t'}),{usuario:'a'});
  assert.doesNotThrow(()=>authorize('consulta','GET','/api/libros'));
  assert.throws(()=>authorize('consulta','POST','/api/prestamos'));
  assert.throws(()=>authorize('bibliotecaria','GET','/api/auditoria'));
  assert.doesNotThrow(()=>authorize('bibliotecaria','POST','/api/devoluciones'));
});

test('RUT 01 - normaliza y valida el dígito verificador; otros identificadores pasan',()=>{
  assert.equal(normalizeIdentifier('12.345.678-5'),'12345678-5');
  assert.equal(normalizeIdentifier('7.654.321-6'),'7654321-6');
  assert.equal(normalizeIdentifier('123456785'),'12345678-5');
  assert.throws(()=>normalizeIdentifier('12.345.678-9'),/dígito verificador/);
  assert.throws(()=>normalizeIdentifier('123-4'),/cantidad de dígitos/);
  assert.equal(normalizeIdentifier('DEMO-EST-099'),'DEMO-EST-099');
  assert.equal(normalizeIdentifier('PAS-AB123456'),'PAS-AB123456');
});

test('RUT 02 - API y base de datos rechazan un RUT inválido',async()=>{
  const bad=await request('/usuarios',{identificador:'11.111.111-2',nombre:'Docente RUT',tipo:'docente'},{cookie:admin});
  assert.equal(bad.status,400);assert.match(bad.data.error,/RUT/);
  const ok=await request('/usuarios',{identificador:'11.111.111-1',nombre:'Docente RUT',tipo:'docente'},{cookie:admin});
  assert.equal(ok.status,201);
  assert.equal(await scalar('SELECT identificador FROM biblioteca.usuario WHERE id=$1',[ok.data.id]),'11111111-1');
  await assert.rejects(db.query("INSERT INTO biblioteca.usuario(identificador,nombre,tipo) VALUES('22222222-3','X','docente')"),/usuario_rut_valido/);
});

test('RET 01 - conservación de 10 años: vista y consulta solo para admin',async()=>{
  const r=await request('/retencion',undefined,{cookie:admin});
  assert.equal(r.status,200);assert.equal(r.data.politica_anios,10);
  assert.ok(Array.isArray(r.data.prestamos));
  // Los préstamos de prueba son recientes: ninguno supera el plazo.
  assert.equal(r.data.prestamos.length,0);
  assert.equal((await request('/retencion',undefined,{cookie:consulta})).status,403);
});

test('RET 02 - un préstamo cerrado hace más de 10 años aparece; uno abierto igual de antiguo no',async()=>{
  // Calendario mínimo de 2014 solo para esta prueba (días hábiles abiertos).
  await db.query(`INSERT INTO biblioteca.calendario(fecha,abierto,permite_prestamo,permite_renovacion,motivo)
    SELECT d::date,extract(isodow from d)<6,extract(isodow from d)<6,extract(isodow from d)<6,'Prueba de conservación'
    FROM generate_series('2014-03-01'::date,'2014-03-31'::date,'1 day') d ON CONFLICT (fecha) DO NOTHING`);
  const usuario=await scalar(`SELECT id FROM biblioteca.usuario WHERE tipo<>'estudiante' AND activo ORDER BY id LIMIT 1`);
  const libres=(await db.query(`SELECT e.id FROM biblioteca.ejemplar e WHERE NOT EXISTS (SELECT 1 FROM biblioteca.detalle_prestamo d
    WHERE d.ejemplar_id=e.id AND d.fecha_cierre IS NULL) AND NOT EXISTS (SELECT 1 FROM biblioteca.incidencia i JOIN biblioteca.detalle_prestamo d
    ON d.id=i.detalle_id WHERE d.ejemplar_id=e.id) ORDER BY e.id LIMIT 2`)).rows.map(r=>r.id);
  const cerrado=await scalar(`CALL biblioteca.sp_prestar($1,$2,'2014-03-03')`,[usuario,[libres[0]]]);
  const detalle=await scalar('SELECT id FROM biblioteca.detalle_prestamo WHERE prestamo_id=$1',[cerrado]);
  await db.query(`CALL biblioteca.sp_devolver($1,$2,'2014-03-05')`,[usuario,[detalle]]);
  const abierto=await scalar(`CALL biblioteca.sp_prestar($1,$2,'2014-03-04')`,[usuario,[libres[1]]]);
  const r=await request('/retencion',undefined,{cookie:admin});
  assert.equal(r.status,200);
  const fila=r.data.prestamos.find(p=>p.prestamo_id===cerrado);
  assert.deepEqual([fila?.fecha_cierre,fila?.conservar_hasta],['2014-03-05','2024-03-05']);
  assert.ok(!r.data.prestamos.some(p=>p.prestamo_id===abierto));
  // La vista solo informa: el historial sigue protegido contra borrados.
  await assert.rejects(db.query('DELETE FROM biblioteca.detalle_prestamo WHERE id=$1',[detalle]));
});

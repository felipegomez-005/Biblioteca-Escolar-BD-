import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openDb,initialize} from '../scripts/db.mjs';
import {createApp} from '../server/app.mjs';

let db,server,base,user,book,copies=[];
before(async()=>{
  db=await openDb();await initialize(db);
  server=createApp(db,{today:'2026-05-04'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db?.close();});
async function request(url,data,method='POST',extra={}) {
  const response=await fetch(base+'/api'+url,{method:data===undefined?'GET':method,
    headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1',...extra},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,data:await response.json()};
}

test('API 01 - interfaz y consultas de lectura responden desde HTTP',async()=>{
  const response=await fetch(base);assert.equal(response.status,200);assert.match(await response.text(),/Biblioteca escolar/);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  for(const route of ['/contexto','/resumen','/libros','/ejemplares','/usuarios','/pendientes','/estadisticas?anio=2026'])
    assert.equal((await request(route)).status,200,route);
});
test('API 02 - registrar libro con autores, género y primera copia',async()=>{
  const result=await request('/libros',{titulo:'Libro API de prueba',autores:'Autor de prueba; Segunda autora',editorial:'Editorial API',generos:'Ensayo',codigo:'API-COPIA-1'});
  assert.equal(result.status,201);book=result.data.id;
  const list=(await request('/libros?q=Libro%20API')).data;
  assert.equal(list.length,1);assert.equal(list[0].copias,1);assert.match(list[0].autores,/Segunda autora/);
  copies=(await request('/ejemplares?libro='+book)).data.map(x=>x.ejemplar_id);
});
test('API 03 - un código duplicado revierte libro y autor de la misma transacción',async()=>{
  const result=await request('/libros',{titulo:'No debe guardarse',autores:'Autor que debe revertirse',codigo:'API-COPIA-1'});
  assert.equal(result.status,409);
  assert.equal((await request('/libros?q=No%20debe%20guardarse')).data.length,0);
  assert.equal((await db.query("SELECT count(*) AS n FROM biblioteca.autor WHERE nombre='Autor que debe revertirse'")).rows[0].n,0);
});
test('API 04 - agregar ejemplares y rechazar códigos repetidos',async()=>{
  for(let n=2;n<=4;n++) {
    const r=await request('/ejemplares',{libro_id:book,codigo:'API-COPIA-'+n});assert.equal(r.status,201);copies.push(r.data.id);
  }
  assert.equal((await request('/ejemplares',{libro_id:book,codigo:'API-COPIA-1'})).status,409);
});
test('API 05 - estudiantes requieren correo y curso; se puede crear un curso',async()=>{
  assert.equal((await request('/usuarios',{nombre:'Estudiante API',identificador:'API-EST-1',tipo:'estudiante'})).status,400);
  const course=await request('/cursos',{nombre:'Curso de prueba API',anio_escolar:2026});assert.equal(course.status,201);
  const r=await request('/usuarios',{nombre:'Estudiante API',identificador:'API-EST-1',tipo:'estudiante',correo:'api@example.invalid',curso_actual_id:course.data.id});
  assert.equal(r.status,201);user=r.data.id;
});
test('API 06 - préstamo usa fecha del servidor y aplica máximo simultáneo',async()=>{
  const r=await request('/prestamos',{usuario_id:user,ejemplares:copies.slice(0,3),fecha:'1999-01-01'});assert.equal(r.status,201);
  assert.equal((await db.query('SELECT fecha::text FROM biblioteca.prestamo WHERE id=$1',[r.data.p_prestamo])).rows[0].fecha,'2026-05-04');
  const excess=await request('/prestamos',{usuario_id:user,ejemplares:[copies[3]]});assert.equal(excess.status,409);
  const current=await request('/usuarios/'+user+'/resumen');assert.equal(current.data.prestamos.length,3);
});
test('API 07 - devolución parcial y renovación cambian solo los detalles seleccionados',async()=>{
  const d=(await request('/usuarios/'+user+'/resumen')).data.prestamos;
  assert.equal((await request('/devoluciones',{usuario_id:user,detalles:[d[0].detalle_id]})).status,201);
  assert.equal((await request('/renovaciones',{usuario_id:user,detalles:[d[1].detalle_id]})).status,201);
  const current=(await request('/usuarios/'+user+'/resumen')).data.prestamos;assert.equal(current.length,2);
  assert.equal(current.find(x=>x.detalle_id===d[1].detalle_id).vencimiento,'2026-05-12');
  assert.equal(current.find(x=>x.detalle_id===d[2].detalle_id).vencimiento,'2026-05-07');
});
test('API 08 - no se devuelven ni renuevan detalles de otra persona',async()=>{
  const [d]=(await request('/usuarios/'+user+'/resumen')).data.prestamos;
  for(const op of ['/renovaciones','/devoluciones']) assert.equal((await request(op,{usuario_id:1,detalles:[d.detalle_id]})).status,409);
});
test('API 09 - registrar pérdida y resolver por reposición conserva historial',async()=>{
  const [d]=(await request('/usuarios/'+user+'/resumen')).data.prestamos;
  assert.equal((await request('/incidencias',{detalle_id:d.detalle_id,tipo:'perdida'})).status,201);
  const pending=(await request('/pendientes')).data.find(x=>x.detalle_id===d.detalle_id);assert.ok(pending.incidencia_id);
  assert.equal((await request('/incidencias/'+pending.incidencia_id+'/resolver',{solucion:'reposicion',codigo:'API-REEMPLAZO'})).status,201);
  assert.ok((await request('/ejemplares?libro='+book)).data.some(x=>x.codigo==='API-REEMPLAZO'&&x.disponible));
});
test('API 10 - edición de usuario cambia correo sin alterar préstamos históricos',async()=>{
  const u=(await request('/usuarios?q=API-EST-1')).data[0];
  const r=await request('/usuarios/'+user,{...u,correo:'actualizado@example.invalid',curso_actual_id:3},'PATCH');assert.equal(r.status,200);
  const historic=(await db.query('SELECT curso_al_prestar_id FROM biblioteca.prestamo WHERE usuario_id=$1',[user])).rows[0];
  assert.notEqual(historic.curso_al_prestar_id,3);
});
test('API 11 - rechaza solicitudes desde otro origen y formularios externos',async()=>{
  assert.equal((await request('/cursos',{nombre:'No crear',anio_escolar:2026},'POST',{Origin:'https://externo.example'})).status,403);
  const response=await fetch(base+'/api/cursos',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
});
test('API 12 - consultas parametrizadas y archivos privados inaccesibles',async()=>{
  const result=await request('/libros?q='+encodeURIComponent("' OR 1=1 --"));assert.equal(result.status,200);assert.equal(result.data.length,0);
  assert.equal((await fetch(base+'/package.json')).status,404);
  assert.equal((await request('/estadisticas?anio=texto')).status,400);
  assert.equal((await request('/usuarios/999999/resumen')).status,404);
});
test('API 13 - libro sin ISBN se admite y el ISBN repetido se rechaza',async()=>{
  const payload={titulo:'ISBN de prueba',isbn:'978-0-306-40615-7'};
  assert.equal((await request('/libros',payload)).status,201);
  assert.equal((await request('/libros',payload)).status,409);
  assert.equal((await request('/libros',{titulo:'ISBN inválido',isbn:'123'})).status,400);
});

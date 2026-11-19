import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {openDb,initialize,upgrade} from '../scripts/db.mjs';
import {createApp} from '../server/app.mjs';

let db,server,base,sequence=0;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
before(async()=>{
  db=await openDb();await initialize(db);
  server=createApp(db,{today:'2026-05-04'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}/api`;
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db?.close();});
async function request(route,data,method='POST') {
  const response=await fetch(base+route,{method:data===undefined?'GET':method,
    headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1'},body:data===undefined?undefined:JSON.stringify(data)});
  return {status:response.status,data:await response.json()};
}
async function bookData(id) {
  const r=await request('/libros/'+id);assert.equal(r.status,200);
  const b=r.data;return {...b,autores:b.autores_detalle.map(a=>a.nombre).join('; '),generos:b.generos_detalle.join('; ')};
}
async function fixture() {
  const suffix=++sequence;
  const b=await request('/libros',{titulo:'Edición administración '+suffix,autores:'Autora compartida ADM',editorial:'Editorial compartida ADM',generos:'Prueba ADM'});
  assert.equal(b.status,201);
  const u=await request('/usuarios',{nombre:'Estudiante ficticio ADM '+suffix,identificador:'ADM-'+suffix,tipo:'estudiante',correo:`adm${suffix}@example.invalid`,curso_actual_id:1});
  assert.equal(u.status,201);
  const copies=[];
  for(let n=1;n<=3;n++) {
    const e=await request('/ejemplares',{libro_id:b.data.id,codigo:`ADM-${suffix}-${n}`,condicion:n===2?'desgastado':'bueno'});
    assert.equal(e.status,201);copies.push(e.data.id);
  }
  return {book:b.data.id,user:u.data.id,copies};
}

test('ADM 01 - editar una edición prestada conserva copias, curso y movimientos; devolución con estados distintos',async()=>{
  const {book,user,copies}=await fixture();
  const loan=await request('/prestamos',{usuario_id:user,ejemplares:copies});assert.equal(loan.status,201);
  const details=(await request('/usuarios/'+user+'/resumen')).data.prestamos;
  assert.equal(details.find(d=>d.codigo.endsWith('-2')).condicion,'desgastado');
  assert.equal((await request('/renovaciones',{usuario_id:user,detalles:[details[0].detalle_id]})).status,201);
  const old=await bookData(book);
  const saved=await request('/libros/'+book,{...old,titulo:'Título corregido <ADM>',autores:'Autora compartida ADM; Nueva autora ADM',editorial:'Nueva editorial ADM',generos:'Ensayo; Escolar',anio_publicacion:2020},'PATCH');
  assert.equal(saved.status,200);assert.equal(saved.data.id,book);
  assert.deepEqual(saved.data.autores_detalle.map(a=>a.nombre),['Autora compartida ADM','Nueva autora ADM']);
  assert.equal((await request('/ejemplares?libro='+book)).data.length,3);
  const returned=await request('/devoluciones',{usuario_id:user,detalles:details.slice(0,2).map(d=>d.detalle_id),condiciones:['bueno','desgastado'],observaciones:'Recepción ficticia <texto>'});
  assert.equal(returned.status,201);
  const courseBefore=(await q('SELECT curso_al_prestar_id FROM biblioteca.prestamo WHERE id=$1',[loan.data.p_prestamo]))[0].curso_al_prestar_id;
  await q('UPDATE biblioteca.usuario SET curso_actual_id=2 WHERE id=$1',[user]);
  const history=(await request('/usuarios/'+user+'/historial')).data.movimientos;
  assert.equal(history.length,3);assert.equal(new Set(history.map(m=>m.prestamo_id)).size,1);
  const first=history.find(m=>m.detalle_id===details[0].detalle_id),second=history.find(m=>m.detalle_id===details[1].detalle_id);
  assert.equal(first.renovaciones.length,1);assert.equal(first.renovaciones[0].vencimiento_anterior,'2026-05-07');
  assert.equal(first.renovaciones[0].nuevo_vencimiento,'2026-05-12');
  assert.equal(first.titulo,'Título corregido <ADM>');assert.equal(first.devolucion.observaciones,'Recepción ficticia <texto>');
  assert.equal(first.devolucion.id,second.devolucion.id);assert.equal(second.devolucion.condicion,'desgastado');
  assert.equal(history.filter(m=>m.fecha_cierre===null).length,1);
  assert.equal(first.curso_al_prestar,(await q('SELECT nombre FROM biblioteca.curso WHERE id=$1',[courseBefore]))[0].nombre);
  const copyHistory=await request('/ejemplares/'+second.ejemplar_id+'/historial');
  assert.equal(copyHistory.data.sujeto.condicion,'desgastado');assert.equal(copyHistory.data.movimientos.length,1);
  assert.equal(copyHistory.data.movimientos[0].usuario_id,user);
});

test('ADM 02 - edición valida ISBN, duplicados y versiones; conserva autores compartidos y procedencia',async()=>{
  const a=await fixture(),b=await fixture();
  const old=await bookData(a.book);
  const changed=await request('/libros/'+a.book,{...old,isbn:'0-306-40615-2',autores:'Otra autora ADM',editorial:'Otra editorial ADM'},'PATCH');
  assert.equal(changed.status,200);assert.equal(changed.data.isbn,'9780306406157');
  assert.equal((await request('/libros/'+a.book,{...old,titulo:'Obsoleto'},'PATCH')).status,409);
  const bBefore=await bookData(b.book);
  assert.equal((await request('/libros/'+b.book,{...bBefore,isbn:'9780306406157'},'PATCH')).status,409);
  for(const bad of [{isbn:'9780306406158'},{titulo:''},{anio_publicacion:0},{anio_publicacion:10000}])
    assert.equal((await request('/libros/'+b.book,{...bBefore,...bad},'PATCH')).status,400);
  assert.deepEqual(await bookData(b.book),bBefore);
  assert.equal(bBefore.autores,'Autora compartida ADM');assert.equal(bBefore.editorial,'Editorial compartida ADM');
  // Simula una procedencia ya validada por el módulo Google Books, sin llamada externa.
  await q("UPDATE biblioteca.libro SET origen_datos='google_books',google_books_id='ADM-volume' WHERE id=$1",[a.book]);
  const external=await bookData(a.book);
  const same=await request('/libros/'+a.book,{...external,isbn:'0306406152',titulo:'Corrección manual del título'},'PATCH');
  assert.equal(same.data.origen_datos,'google_books');assert.equal(same.data.google_books_id,'ADM-volume');
  const other=await request('/libros/'+a.book,{...await bookData(a.book),isbn:'9780140328721'},'PATCH');
  assert.equal(other.status,200);assert.equal(other.data.origen_datos,'manual');assert.equal(other.data.google_books_id,null);
  assert.equal((await request('/libros/'+b.book,{...bBefore,autores:'',generos:'',editorial:'',anio_publicacion:'',isbn:''},'PATCH')).status,200);
  const cleared=await bookData(b.book);assert.equal(cleared.autores,'');assert.equal(cleared.generos,'');assert.equal(cleared.editorial,null);
});

test('ADM 03 - devolución rechaza selección inválida y revierte todo ante incidencia; actualización repetible',async()=>{
  const {book,user,copies}=await fixture();
  assert.equal((await request('/prestamos',{usuario_id:user,ejemplares:copies})).status,201);
  const details=(await request('/usuarios/'+user+'/resumen')).data.prestamos.map(d=>d.detalle_id);
  const before=(await q('SELECT count(*) AS n FROM biblioteca.devolucion'))[0].n;
  for(const conditions of [[],['bueno'],['bueno','perdido'],['bueno',null]])
    assert.equal((await request('/devoluciones',{usuario_id:user,detalles:details.slice(0,2),condiciones:conditions})).status,400);
  assert.equal((await request('/devoluciones',{usuario_id:user,detalles:[details[0],details[0]],condiciones:['bueno','bueno']})).status,400);
  assert.equal((await request('/devoluciones',{usuario_id:1,detalles:[details[0]],condiciones:['bueno']})).status,409);
  assert.equal((await request('/incidencias',{detalle_id:details[1],tipo:'dano_permanente',observaciones:'Prueba de reversión'})).status,201);
  const failed=await request('/devoluciones',{usuario_id:user,detalles:details.slice(0,2),condiciones:['desgastado','bueno']});
  assert.equal(failed.status,409);
  assert.equal((await q('SELECT count(*) AS n FROM biblioteca.devolucion'))[0].n,before);
  assert.equal((await q('SELECT condicion FROM biblioteca.ejemplar WHERE id=$1',[copies[0]]))[0].condicion,'bueno');
  assert.equal((await q('SELECT fecha_cierre FROM biblioteca.detalle_prestamo WHERE id=$1',[details[0]]))[0].fecha_cierre,null);
  await upgrade(db);await upgrade(db);
  assert.equal((await request('/libros/'+book)).status,200);
  assert.equal((await request('/devoluciones',{usuario_id:user,detalles:[details[0]],condiciones:['desgastado']})).status,201);
  assert.equal((await request('/devoluciones',{usuario_id:user,detalles:[details[0]],condiciones:['bueno']})).status,409);
});

test('ADM 04 - historial conserva pérdidas, reposiciones y reembolsos sin inventar devoluciones',async()=>{
  const {user,copies}=await fixture();
  await request('/prestamos',{usuario_id:user,ejemplares:copies.slice(0,2)});
  const details=(await request('/usuarios/'+user+'/resumen')).data.prestamos;
  for(const d of details)assert.equal((await request('/incidencias',{detalle_id:d.detalle_id,tipo:'perdida'})).status,201);
  let movements=(await request('/usuarios/'+user+'/historial')).data.movimientos;
  assert.ok(movements.every(m=>m.incidencia && !m.incidencia.fecha_resolucion && !m.devolucion));
  assert.equal((await request('/incidencias/'+movements[0].incidencia.id+'/resolver',{solucion:'reposicion',codigo:'ADM-REPOSICION'})).status,201);
  assert.equal((await request('/incidencias/'+movements[1].incidencia.id+'/resolver',{solucion:'reembolso',monto:5000})).status,201);
  movements=(await request('/usuarios/'+user+'/historial')).data.movimientos;
  assert.ok(movements.every(m=>m.fecha_cierre==='2026-05-04' && !m.devolucion));
  assert.equal(movements[0].incidencia.codigo_reemplazo,'ADM-REPOSICION');assert.equal(Number(movements[1].incidencia.monto_reembolso),5000);
  const original=(await request('/ejemplares/'+movements[0].ejemplar_id+'/historial')).data;
  assert.equal(original.sujeto.condicion,'baja');assert.equal(original.movimientos.length,1);
  const replacement=(await request('/ejemplares/'+movements[0].incidencia.ejemplar_reemplazo_id+'/historial')).data;
  assert.equal(replacement.movimientos.length,0);
});

test('ADM 05 - consultas de historial sin movimientos y registros ausentes',async()=>{
  const {book,user,copies}=await fixture();
  for(const route of ['/usuarios/'+user+'/historial','/ejemplares/'+copies[0]+'/historial']) {
    const r=await request(route);assert.equal(r.status,200);assert.deepEqual(r.data.movimientos,[]);
  }
  for(const route of ['/usuarios/999999/historial','/ejemplares/999999/historial','/libros/999999'])assert.equal((await request(route)).status,404);
  assert.equal((await request('/libros/999999',await bookData(book),'PATCH')).status,404);
});

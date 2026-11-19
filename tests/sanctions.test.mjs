import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDb,initialize} from '../scripts/db.mjs';
import {createApp} from '../server/app.mjs';

function scenario(name,fn,today='2026-05-28') {
  test(name,async()=>{
    const db=await openDb();let server,base;
    const close=async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;}};
    const changeDate=async day=>{
      await close();server=createApp(db,{today:day});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}/api`;
    };
    try {
      await initialize(db);await changeDate(today);
      const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
      const request=async(route,data)=>{
        const r=await fetch(base+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1'},body:data?JSON.stringify(data):undefined});
        return {status:r.status,data:await r.json()};
      };
      const payload=async(uid=7,observaciones='Decisión ficticia del colegio')=>{
        const info=await request('/usuarios/'+uid+'/sanciones');assert.equal(info.status,200);
        return {usuario_id:uid,observaciones,inicio_esperado:info.data.inicio,habilitado_desde_esperado:info.data.habilitado_desde};
      };
      await fn({db,q,request,payload,changeDate});
    } finally {await close();await db.close();}
  });
}

scenario('SAN 01 - consulta no registra y muestra dos semanas con feriado al término',async({q,request})=>{
  const info=await request('/usuarios/7/sanciones');assert.equal(info.status,200);
  assert.equal(info.data.inicio,'2026-05-28');assert.equal(info.data.habilitado_desde,'2026-06-12');
  assert.equal(info.data.puede_registrar,true);assert.deepEqual(info.data.sanciones,[]);
  assert.equal((await q('SELECT count(*) AS n FROM biblioteca.sancion WHERE usuario_id=7'))[0].n,0);
});

scenario('SAN 02 - alta bloquea nuevos préstamos del usuario y permite devolver y renovar',async({q,request,payload})=>{
  const loan=await request('/prestamos',{usuario_id:7,ejemplares:[25]});assert.equal(loan.status,201);
  const [detail]=await q('SELECT id FROM biblioteca.detalle_prestamo WHERE prestamo_id=$1',[loan.data.p_prestamo]);
  const saved=await request('/sanciones',{...await payload(),fecha:'1999-01-01',habilitado_desde:'2099-12-31'});
  assert.equal(saved.status,201);assert.equal(saved.data.inicio,'2026-05-28');assert.equal(saved.data.habilitado_desde,'2026-06-12');
  const summary=await request('/usuarios/7/resumen');assert.ok(summary.data.bloqueos.some(b=>b.motivo==='conducta_grave'));
  assert.equal(summary.data.sanciones_conducta[0].habilitado_desde,'2026-06-12');
  assert.equal((await request('/usuarios?q=DEMO-EST-7')).data[0].sancion_hasta,'2026-06-12');
  assert.equal((await request('/prestamos',{usuario_id:7,ejemplares:[26]})).status,409);
  assert.equal((await request('/prestamos',{usuario_id:8,ejemplares:[26]})).status,201);
  assert.equal((await request('/renovaciones',{usuario_id:7,detalles:[detail.id]})).status,201);
  assert.equal((await request('/devoluciones',{usuario_id:7,detalles:[detail.id]})).status,201);
});

scenario('SAN 03 - reenvíos simultáneos idénticos conservan un solo registro',async({q,request,payload})=>{
  const data=await payload();
  const results=await Promise.all(Array.from({length:4},()=>request('/sanciones',data)));
  assert.ok(results.every(r=>r.status===201));assert.equal(new Set(results.map(r=>r.data.id)).size,1);
  assert.equal(results.filter(r=>!r.data.repetida).length,1);
  assert.equal((await q('SELECT count(*) AS n FROM biblioteca.sancion WHERE usuario_id=7'))[0].n,1);
});

scenario('SAN 04 - término habilita nuevos préstamos sin borrar el historial',async({request,payload,changeDate})=>{
  assert.equal((await request('/sanciones',await payload())).status,201);
  await changeDate('2026-06-11');
  assert.equal((await request('/usuarios/7/sanciones')).data.sanciones[0].estado,'vigente');
  await changeDate('2026-06-12');
  const list=(await request('/usuarios/7/sanciones')).data.sanciones;
  assert.equal(list.length,1);assert.equal(list[0].estado,'finalizada');
  assert.deepEqual((await request('/usuarios/7/resumen')).data.bloqueos,[]);
  assert.equal((await request('/usuarios?q=DEMO-EST-7')).data[0].sancion_hasta,null);
  assert.equal((await request('/prestamos',{usuario_id:7,ejemplares:[25]})).status,201);
});

scenario('SAN 05 - terminar conducta no levanta una incidencia pendiente',async({request,payload,changeDate})=>{
  assert.equal((await request('/sanciones',await payload(3))).status,201);
  await changeDate('2026-06-12');
  const info=(await request('/usuarios/3/resumen')).data;
  assert.ok(info.bloqueos.some(b=>b.motivo==='reposicion_o_reembolso_pendiente'));
  assert.ok(!info.bloqueos.some(b=>b.motivo==='conducta_grave'));
  assert.equal((await request('/prestamos',{usuario_id:3,ejemplares:[25]})).status,409);
});

scenario('SAN 06 - día cerrado permite consultar historial pero impide nuevas sanciones',async({request,q})=>{
  const info=await request('/usuarios/6/sanciones');assert.equal(info.status,200);
  assert.ok(info.data.sanciones.length);assert.equal(info.data.puede_registrar,false);assert.match(info.data.impedimento,/cerrada/);
  const result=await request('/sanciones',{usuario_id:7,observaciones:'Prueba',inicio_esperado:'2026-05-30',habilitado_desde_esperado:'2026-06-15'});
  assert.equal(result.status,409);assert.equal((await q('SELECT count(*) AS n FROM biblioteca.sancion WHERE usuario_id=7'))[0].n,0);
},'2026-05-30');

scenario('SAN 07 - falta de cobertura de calendario se informa sin inventar fechas',async({request,changeDate})=>{
  for(const day of ['2028-01-03','2027-12-20']) {
    await changeDate(day);
    const result=await request('/usuarios/7/sanciones');assert.equal(result.status,200);
    assert.equal(result.data.puede_registrar,false);assert.equal(result.data.habilitado_desde,null);assert.match(result.data.impedimento,/Falta calendario/);
  }
});

scenario('SAN 08 - un calendario modificado exige volver a revisar antes de confirmar',async({request,payload,q})=>{
  const old=await payload();
  const change={tipo:'cerrado',desde:'2026-06-12',hasta:'2026-06-12',motivo:'Cierre ficticio'};
  const review=await request('/calendario/previsualizar',change);assert.equal(review.status,201);
  assert.equal((await request('/calendario/configurar',{...change,version:review.data.version})).status,201);
  const stale=await request('/sanciones',old);assert.equal(stale.status,409);assert.match(stale.data.error,/fechas cambiaron/);
  assert.equal((await q('SELECT count(*) AS n FROM biblioteca.sancion WHERE usuario_id=7'))[0].n,0);
  const refreshed=await payload();assert.equal(refreshed.habilitado_desde_esperado,'2026-06-15');
  assert.equal((await request('/sanciones',refreshed)).status,201);
});

scenario('SAN 09 - motivo obligatorio, usuario existente y fechas revisadas se validan',async({request,payload,q})=>{
  const data=await payload();
  for(const observaciones of ['',null,'   ','x'.repeat(1001),{}])
    assert.equal((await request('/sanciones',{...data,observaciones})).status,400);
  assert.equal((await request('/usuarios/999999/sanciones')).status,404);
  assert.equal((await request('/sanciones',{...data,usuario_id:999999})).status,404);
  assert.equal((await request('/sanciones',{...data,inicio_esperado:'2026-05-27'})).status,409);
  assert.equal((await request('/sanciones',{...data,habilitado_desde_esperado:'2099-01-01'})).status,409);
  assert.equal((await q('SELECT count(*) AS n FROM biblioteca.sancion WHERE usuario_id=7'))[0].n,0);
});

scenario('SAN 10 - días internos feriados no alargan la sanción y el motivo se conserva',async({request,payload,q})=>{
  const data=await payload(7,'Decisión ficticia: observación con acentos, ñ y <texto>.');
  const saved=await request('/sanciones',data);assert.equal(saved.status,201);
  // El 3/6 es feriado interno; el 11/6 es el término nominal feriado.
  assert.equal(saved.data.habilitado_desde,'2026-06-12');
  assert.equal((await q('SELECT observaciones FROM biblioteca.sancion WHERE id=$1',[saved.data.id]))[0].observaciones,data.observaciones);
  assert.equal((await request('/usuarios/7/sanciones')).data.sanciones[0].observaciones,data.observaciones);
});

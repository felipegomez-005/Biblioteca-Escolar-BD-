import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDb,initialize,upgrade} from '../scripts/db.mjs';
import {createApp} from '../server/app.mjs';

function scenario(name,fn,today='2026-08-03') {
  test(name,async()=>{
    const db=await openDb();let server;
    try {
      await initialize(db);server=createApp(db,{today});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const base=`http://127.0.0.1:${server.address().port}/api`;
      const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
      const request=async(route,data)=>{
        const r=await fetch(base+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1'},body:data?JSON.stringify(data):undefined});
        return {status:r.status,data:await r.json()};
      };
      const preview=async op=>{const r=await request('/calendario/previsualizar',op);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
      const apply=async op=>{const p=await preview(op);const r=await request('/calendario/configurar',{...op,version:p.version});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
      await fn({db,q,request,preview,apply});
    } finally {if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db.close();}
  });
}
const period=(desde,hasta=desde,tipo='cerrado')=>({desde,hasta,tipo,motivo:'Configuración ficticia de prueba'});

scenario('CAL 01 - vista mensual incluye fines de semana y fechas todavía no configuradas',async({request})=>{
  const month=await request('/calendario?mes=2026-08');assert.equal(month.status,200);assert.equal(month.data.dias.length,31);
  assert.equal(month.data.dias.find(d=>d.fecha==='2026-08-08').abierto,false);
  const missing=await request('/calendario?mes=2028-02');assert.equal(missing.data.dias.length,29);assert.ok(missing.data.dias.every(d=>!d.configurado));
  assert.equal((await request('/calendario?mes=2026-13')).status,400);
});

scenario('CAL 02 - completar año bisiesto crea solo faltantes y registra antes/después',async({apply,q})=>{
  const result=await apply({tipo:'completar',anio:2028});assert.equal(result.guardados,366);
  assert.equal((await q("SELECT abierto FROM biblioteca.calendario WHERE fecha='2028-02-29'"))[0].abierto,true);
  assert.equal((await q("SELECT abierto FROM biblioteca.calendario WHERE fecha='2028-01-01'"))[0].abierto,false);
  await apply(period('2028-03-06'));
  assert.equal((await apply({tipo:'completar',anio:2028})).guardados,0);
  assert.equal((await q("SELECT abierto FROM biblioteca.calendario WHERE fecha='2028-03-06'"))[0].abierto,false);
  const log=(await q('SELECT cambios,cantidad FROM biblioteca.cambio_calendario ORDER BY id LIMIT 1'))[0];
  assert.equal(log.cantidad,366);assert.equal(log.cambios[0].antes,null);assert.ok(log.cambios[0].despues);
});

scenario('CAL 03 - rechaza fechas inválidas, pasadas, períodos excesivos y vacaciones incoherentes',async({request})=>{
  const bad=[period('2026-02-30'),period('2026-08-02'),period('2026-09-02','2026-09-01'),period('2026-08-03','2028-01-01'),
    {...period('2026-09-01'),tipo:'inventado'}, {...period('2026-09-01'),motivo:''},
    {...period('2026-09-01'),motivo:'x'.repeat(251)}, {tipo:'completar',anio:2025},
    {...period('2026-08-17','2026-08-28','vacaciones'),ultima_semana:'2026-08-11'},
    {...period('2026-08-17','2026-08-28','vacaciones'),ultima_semana:'2026-08-17'},
    {...period('2026-08-17','2026-08-28','vacaciones'),ultima_semana:'2026-07-27'},
    {...period('2026-08-02'),hoy:'2026-01-01'}];
  for(const op of bad) assert.equal((await request('/calendario/previsualizar',op)).status,400,JSON.stringify(op));
  assert.equal((await request('/calendario/configurar',period('2026-08-10'))).status,400);
});

scenario('CAL 04 - vista previa no guarda; un feriado desplaza el vencimiento del préstamo nuevo',async({q,request,preview,apply})=>{
  const op=period('2026-08-05');const p=await preview(op);assert.equal(p.cambios.length,1);
  assert.equal((await q("SELECT abierto FROM biblioteca.calendario WHERE fecha='2026-08-05'"))[0].abierto,true);
  await apply(op);
  const loan=await request('/prestamos',{usuario_id:7,ejemplares:[25]});assert.equal(loan.status,201);
  assert.equal((await q('SELECT vencimiento_inicial::text AS fecha FROM biblioteca.prestamo WHERE id=$1',[loan.data.p_prestamo]))[0].fecha,'2026-08-07');
  assert.equal((await request('/contexto')).data.vencimiento,'2026-08-07');
});

scenario('CAL 05 - día cerrado impide préstamos y devoluciones',async({apply,request})=>{
  await apply(period('2026-08-03'));
  assert.equal((await request('/prestamos',{usuario_id:7,ejemplares:[25]})).status,409);
  const returned=await request('/devoluciones',{usuario_id:5,detalles:[7]});assert.equal(returned.status,409);assert.match(returned.data.error,/cerrada/);
  assert.equal((await request('/contexto')).data.vencimiento,null);
});

scenario('CAL 06 - vacaciones configuran última semana, conservan feriados y permiten devoluciones',async({apply,q,request})=>{
  await apply(period('2026-08-12'));
  await apply({...period('2026-08-17','2026-08-28','vacaciones'),ultima_semana:'2026-08-10'});
  const month=(await request('/calendario?mes=2026-08')).data.dias;
  assert.equal(month.find(d=>d.fecha==='2026-08-12').abierto,false);
  assert.equal(month.find(d=>d.fecha==='2026-08-10').permite_prestamo,false);
  assert.equal(month.find(d=>d.fecha==='2026-08-10').permite_renovacion,false);
  assert.equal(month.find(d=>d.fecha==='2026-08-10').abierto,true);
  assert.ok(month.filter(d=>d.fecha>='2026-08-17'&&d.fecha<='2026-08-28').every(d=>d.vacaciones&&!d.abierto));
  const loan=(await q("CALL biblioteca.sp_prestar(7,ARRAY[25],date '2026-08-07')"))[0].p_prestamo;
  const detail=(await q('SELECT id,vencimiento_vigente::text AS fecha FROM biblioteca.detalle_prestamo WHERE prestamo_id=$1',[loan]))[0];
  assert.equal(detail.fecha,'2026-08-13');
  await assert.rejects(q("CALL biblioteca.sp_prestar(8,ARRAY[26],date '2026-08-10')"),/No se permiten préstamos/);
  await assert.rejects(q("CALL biblioteca.sp_renovar($1,date '2026-08-10')",[[detail.id]]),/No se permiten renovaciones/);
  await assert.rejects(q("CALL biblioteca.sp_renovar($1,date '2026-08-07')",[[detail.id]]),/vacaciones/);
  await q("CALL biblioteca.sp_devolver(7,$1,date '2026-08-10')",[[detail.id]]);
});

scenario('CAL 07 - no cambia intervalos usados por préstamos y rechaza todo el período',async({request,preview,q})=>{
  const loan=await request('/prestamos',{usuario_id:7,ejemplares:[25]});assert.equal(loan.status,201);
  const op=period('2026-08-05','2026-08-07');const p=await preview(op);assert.ok(p.conflictos.length);
  const result=await request('/calendario/configurar',{...op,version:p.version});assert.equal(result.status,409);
  assert.ok((await q("SELECT abierto FROM biblioteca.calendario WHERE fecha BETWEEN '2026-08-05' AND '2026-08-07'")).every(d=>d.abierto));
  assert.equal((await q('SELECT count(*) AS n FROM biblioteca.cambio_calendario'))[0].n,0);
  assert.equal((await q('SELECT vencimiento_inicial::text AS fecha FROM biblioteca.prestamo WHERE id=$1',[loan.data.p_prestamo]))[0].fecha,'2026-08-06');
});

scenario('CAL 08 - una vista previa desactualizada no sobrescribe cambios posteriores',async({preview,apply,request,q})=>{
  const op=period('2026-09-10');const old=await preview(op);
  await apply(period('2026-09-10','2026-09-10','solo_devoluciones'));
  assert.equal((await request('/calendario/configurar',{...op,version:old.version})).status,409);
  const day=(await q("SELECT abierto,permite_prestamo FROM biblioteca.calendario WHERE fecha='2026-09-10'"))[0];
  assert.deepEqual(day,{abierto:true,permite_prestamo:false});
});

scenario('CAL 09 - un préstamo posterior a la revisión impide guardar un cierre incompatible',async({preview,request})=>{
  const op=period('2026-08-06');const p=await preview(op);assert.equal(p.conflictos.length,0);
  assert.equal((await request('/prestamos',{usuario_id:7,ejemplares:[25]})).status,201);
  const result=await request('/calendario/configurar',{...op,version:p.version});assert.equal(result.status,409);assert.match(result.data.error,/protegida/);
});

scenario('CAL 10 - protege el término de una sanción por conducta',async({q,preview,request})=>{
  await q("CALL biblioteca.sp_sancionar_conducta(7,date '2026-08-03','Prueba')");
  const op=period('2026-08-17');const p=await preview(op);assert.ok(p.conflictos.some(c=>/sanción/i.test(c.motivo)));
  assert.equal((await request('/calendario/configurar',{...op,version:p.version})).status,409);
  assert.equal((await q('SELECT habilitado_desde::text AS fecha FROM biblioteca.sancion WHERE usuario_id=7'))[0].fecha,'2026-08-17');
});

scenario('CAL 11 - protege el término calculado de una sanción por atraso vigente',async({q,preview,request})=>{
  await q("CALL biblioteca.sp_prestar(7,ARRAY[25],date '2026-07-27')");
  const op=period('2026-08-07');const p=await preview(op);assert.ok(p.conflictos.some(c=>/atraso/.test(c.motivo)));
  assert.equal((await request('/calendario/configurar',{...op,version:p.version})).status,409);
  assert.equal((await q("SELECT biblioteca.proximo_habil(date '2026-07-31'+7)::text AS fecha"))[0].fecha,'2026-08-07');
});

scenario('CAL 12 - completar año actual respeta fechas pasadas y configuraciones existentes',async({q,apply})=>{
  await q("DELETE FROM biblioteca.calendario WHERE fecha IN ('2026-01-15','2026-08-05')");
  const before=await q("SELECT * FROM biblioteca.calendario WHERE fecha='2026-06-03'");
  assert.equal((await apply({tipo:'completar',anio:2026})).guardados,1);
  assert.equal((await q("SELECT count(*) AS n FROM biblioteca.calendario WHERE fecha='2026-01-15'"))[0].n,0);
  assert.deepEqual(await q("SELECT * FROM biblioteca.calendario WHERE fecha='2026-06-03'"),before);
});

scenario('CAL 13 - una última semana parcialmente pasada cambia solo días desde hoy',async({apply,request})=>{
  const before=(await request('/calendario?mes=2026-08')).data.dias.filter(d=>d.fecha<'2026-08-05');
  await apply({...period('2026-08-10','2026-08-21','vacaciones'),ultima_semana:'2026-08-03'});
  const after=(await request('/calendario?mes=2026-08')).data.dias;
  assert.deepEqual(after.filter(d=>d.fecha<'2026-08-05'),before);
  assert.equal(after.find(d=>d.fecha==='2026-08-05').permite_prestamo,false);
},'2026-08-05');

scenario('CAL 14 - actualización aditiva sobre base existente es repetible y conserva registros',async({db,q})=>{
  const before=await q('SELECT count(*) AS n FROM biblioteca.prestamo');
  await db.exec('DROP TABLE biblioteca.cambio_calendario');
  await upgrade(db);await upgrade(db);
  assert.deepEqual(await q('SELECT count(*) AS n FROM biblioteca.prestamo'),before);
  assert.equal((await q('SELECT count(*) AS n FROM biblioteca.cambio_calendario'))[0].n,0);
});

scenario('CAL 15 - feriados internos cuentan en las sanciones y no cambian su término',async({q,apply})=>{
  await q("CALL biblioteca.sp_sancionar_conducta(7,date '2026-08-03','Prueba')");
  await q("CALL biblioteca.sp_prestar(8,ARRAY[25],date '2026-07-27')");
  await apply(period('2026-08-05'));
  assert.equal((await q('SELECT habilitado_desde::text AS fecha FROM biblioteca.sancion WHERE usuario_id=7'))[0].fecha,'2026-08-17');
  assert.equal((await q("SELECT biblioteca.proximo_habil(date '2026-07-31'+7)::text AS fecha"))[0].fecha,'2026-08-07');
});

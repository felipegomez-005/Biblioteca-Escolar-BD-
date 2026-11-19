import {createHash} from 'node:crypto';

export class CalendarError extends Error {
  constructor(message,status=400) {super(message);this.status=status;}
}
function date(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value<'2000-01-01' || value>'9998-12-31')
    throw new CalendarError('Ingrese una fecha válida entre los años 2000 y 9998.');
  const parsed=new Date(value+'T12:00:00Z');
  if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) throw new CalendarError('La fecha indicada no existe.');
  return value;
}
const add=(value,days)=>new Date(new Date(value+'T12:00:00Z').getTime()+days*86400000).toISOString().slice(0,10);
const weekday=value=>new Date(value+'T12:00:00Z').getUTCDay();
const fields=['abierto','permite_prestamo','permite_renovacion','vacaciones','motivo'];
const rows=async(db,sql,args=[])=>(await db.query(sql,args)).rows;

function operation(input,today) {
  if(!['normal','cerrado','solo_devoluciones','vacaciones','completar'].includes(input.tipo)) throw new CalendarError('Seleccione un tipo de atención válido.');
  if(input.tipo==='completar') {
    const year=Number(input.anio);
    if(!Number.isInteger(year) || year<Number(today.slice(0,4)) || year>9998) throw new CalendarError('Solo se puede completar el año actual o uno futuro, hasta 9998.');
    return {tipo:'completar',desde:year===Number(today.slice(0,4))?today:year+'-01-01',hasta:year+'-12-31',motivo:'Horario base pendiente de revisar'};
  }
  const desde=date(input.desde),hasta=date(input.hasta);
  if(desde<today) throw new CalendarError('Los días anteriores a hoy son de solo lectura.');
  if(hasta<desde || (new Date(hasta)-new Date(desde))/86400000>365) throw new CalendarError('El período debe tener entre 1 y 366 días y terminar después de su inicio.');
  if(typeof input.motivo!=='string' || !input.motivo.trim() || input.motivo.trim().length>250) throw new CalendarError('Indique un motivo de hasta 250 caracteres.');
  const result={tipo:input.tipo,desde,hasta,motivo:input.motivo.trim()};
  if(input.tipo==='vacaciones') {
    const monday=date(input.ultima_semana),friday=add(monday,4);
    if(weekday(monday)!==1 || friday>=desde || add(friday,7)<desde) throw new CalendarError('Indique el lunes de la última semana de clases; su viernes debe estar dentro de los siete días anteriores al inicio de vacaciones.');
    result.ultima_semana=monday;
  }
  return result;
}

export async function readCalendar(db,month,today) {
  if(typeof month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new CalendarError('Seleccione un mes válido.');
  const from=date(month+'-01');
  const data=await rows(db,`SELECT g.d::date::text AS fecha,c.fecha IS NOT NULL AS configurado,
    c.abierto,c.permite_prestamo,c.permite_renovacion,c.vacaciones,c.motivo
    FROM generate_series($1::date,($1::date+interval '1 month'-interval '1 day')::date,interval '1 day') g(d)
    LEFT JOIN biblioteca.calendario c ON c.fecha=g.d::date ORDER BY g.d`,[from]);
  const history=await rows(db,`SELECT id,registrado_en::text,desde::text,hasta::text,tipo,motivo,cantidad
    FROM biblioteca.cambio_calendario ORDER BY id DESC LIMIT 8`);
  return {mes:month,hoy:today,dias:data,historial:history};
}

async function protection(db,from,to,today) {
  // Proteger intervalos de cálculo, fechas de movimientos y sanciones vigentes.
  // Se comprueba de nuevo al guardar: un préstamo posterior a la vista previa
  // puede convertir una fecha editable en una fecha protegida.
  return rows(db,`SELECT p.fecha::text AS desde,max(dp.vencimiento_vigente)::text AS hasta,
      'plazo' AS alcance,'Plazo del préstamo #'||p.id AS motivo
      FROM biblioteca.prestamo p JOIN biblioteca.detalle_prestamo dp ON dp.prestamo_id=p.id
      GROUP BY p.id HAVING p.fecha<=$2 AND max(dp.vencimiento_vigente)>=$1
    UNION ALL SELECT fecha::text,fecha::text,'movimiento','Préstamo #'||id FROM biblioteca.prestamo WHERE fecha BETWEEN $1 AND $2
    UNION ALL SELECT fecha::text,fecha::text,'movimiento','Renovación #'||id FROM biblioteca.renovacion WHERE fecha BETWEEN $1 AND $2
    UNION ALL SELECT fecha::text,fecha::text,'movimiento','Devolución #'||id FROM biblioteca.devolucion WHERE fecha BETWEEN $1 AND $2
    UNION ALL SELECT (inicio+14)::text,habilitado_desde::text,'plazo','Término de sanción por conducta #'||id FROM biblioteca.sancion WHERE inicio+14<=$2 AND habilitado_desde>=$1
    UNION ALL SELECT inicio::text,inicio::text,'movimiento','Registro de sanción #'||id FROM biblioteca.sancion WHERE inicio BETWEEN $1 AND $2
    UNION ALL SELECT fecha::text,fecha::text,'movimiento','Incidencia #'||id FROM biblioteca.incidencia WHERE fecha BETWEEN $1 AND $2
    UNION ALL SELECT fecha_resolucion::text,fecha_resolucion::text,'movimiento','Resolución de incidencia #'||id FROM biblioteca.incidencia WHERE fecha_resolucion BETWEEN $1 AND $2
    UNION ALL SELECT r.desde::text,r.hasta::text,'plazo','Sanción por atraso del detalle #'||s.id FROM (
      SELECT id,vencimiento_vigente+1 AS nominal,biblioteca.proximo_habil(vencimiento_vigente+1) AS inicio,
      biblioteca.proximo_habil(biblioteca.proximo_habil(vencimiento_vigente+1)+7) AS fin
      FROM biblioteca.detalle_prestamo WHERE vencimiento_vigente<$3
      AND (fecha_cierre IS NULL OR fecha_cierre>vencimiento_vigente)
    ) s CROSS JOIN LATERAL (VALUES (s.nominal,s.inicio),(s.inicio+7,s.fin)) r(desde,hasta)
      WHERE r.desde<=$2 AND r.hasta>=$1`,[from,to,today]);
}

export async function previewCalendar(db,input,today) {
  const op=operation(input,today);
  const start=op.ultima_semana && op.ultima_semana<op.desde?(op.ultima_semana<today?today:op.ultima_semana):op.desde;
  const existing=await rows(db,`SELECT fecha::text,abierto,permite_prestamo,permite_renovacion,vacaciones,motivo
    FROM biblioteca.calendario WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha`,[start,op.hasta]);
  const map=new Map(existing.map(day=>[day.fecha,day]));
  const changes=[];
  for(let day=start;day<=op.hasta;day=add(day,1)) {
    const previous=map.get(day)||null;
    let type=op.tipo,reason=op.motivo;
    if(day<op.desde) {
      if(!op.ultima_semana || day>add(op.ultima_semana,4)) continue;
      type='solo_devoluciones';reason='Última semana antes de vacaciones: '+op.motivo;
    }
    if(type==='completar' && previous) continue;
    const business=weekday(day)!==0 && weekday(day)!==6;
    let open=['normal','completar'].includes(type)&&business;
    if(type==='solo_devoluciones') {
      // Un feriado, cierre o vacaciones previos nunca se reabren por este modo.
      if(previous && !previous.abierto) continue;
      open=business && (previous?.abierto??true);
    }
    const next={fecha:day,abierto:open,permite_prestamo:open&&type!=='solo_devoluciones',
      permite_renovacion:open&&type!=='solo_devoluciones',vacaciones:type==='vacaciones',motivo:reason};
    if(!previous || fields.some(field=>previous[field]!==next[field])) changes.push({fecha:day,antes:previous,despues:next});
  }
  const ranges=changes.length?await protection(db,start,op.hasta,today):[];
  const conflicts=[];
  for(const change of changes) {
    for(const range of ranges) {
      if(change.fecha<range.desde || change.fecha>range.hasta) continue;
      const relevant=range.alcance==='plazo'?['abierto','vacaciones']:fields.filter(x=>x!=='motivo');
      if(!change.antes || relevant.some(f=>change.antes[f]!==change.despues[f])) {
        conflicts.push({fecha:change.fecha,motivo:range.motivo});break;
      }
    }
  }
  const version=createHash('sha256').update(JSON.stringify({op,today,existing})).digest('hex');
  return {version,operacion:op,cambios:changes,conflictos:conflicts,
    resumen:{nuevos:changes.filter(x=>!x.antes).length,actualizados:changes.filter(x=>x.antes).length}};
}

export async function saveCalendar(db,input,today) {
  if(typeof input.version!=='string') throw new CalendarError('Revise los cambios antes de confirmar.');
  return db.transaction(async tx=>{
    await tx.query('SELECT biblioteca.bloquear_operaciones()');
    const preview=await previewCalendar(tx,input,today);
    if(preview.version!==input.version) throw new CalendarError('El calendario cambió desde la revisión. Revise nuevamente antes de guardar.',409);
    if(preview.conflictos.length) {
      const conflict=preview.conflictos[0];
      throw new CalendarError(`No se guardaron cambios: ${conflict.fecha} está protegida (${conflict.motivo}). Los plazos existentes se conservan.`,409);
    }
    if(!preview.cambios.length) return {guardados:0};
    for(const {despues:next} of preview.cambios) {
      await tx.query(`INSERT INTO biblioteca.calendario(fecha,abierto,permite_prestamo,permite_renovacion,vacaciones,motivo)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(fecha) DO UPDATE SET abierto=excluded.abierto,
        permite_prestamo=excluded.permite_prestamo,permite_renovacion=excluded.permite_renovacion,
        vacaciones=excluded.vacaciones,motivo=excluded.motivo`,[next.fecha,...fields.map(f=>next[f])]);
    }
    const op=preview.operacion;
    const [record]=await rows(tx,`INSERT INTO biblioteca.cambio_calendario(desde,hasta,tipo,motivo,cantidad,cambios)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,[preview.cambios[0].fecha,preview.cambios.at(-1).fecha,op.tipo,op.motivo,preview.cambios.length,JSON.stringify(preview.cambios)]);
    return {guardados:preview.cambios.length,cambio_id:record.id};
  });
}

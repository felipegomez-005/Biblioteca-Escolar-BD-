import {CatalogError} from './google-books.mjs';
const rows=async(db,sql,args=[])=>(await db.query(sql,args)).rows;

export async function readHistory(db,type,id) {
  const isUser=type==='usuarios';
  const [subject]=await rows(db,isUser
    ? 'SELECT id,nombre,identificador FROM biblioteca.usuario WHERE id=$1'
    : `SELECT e.id,e.codigo,e.condicion,l.titulo FROM biblioteca.ejemplar e JOIN biblioteca.libro l ON l.id=e.libro_id WHERE e.id=$1`,[id]);
  if(!subject)throw new CatalogError(isUser?'Usuario no encontrado.':'Ejemplar no encontrado.',404);
  const movimientos=await rows(db,`SELECT dp.id AS detalle_id,p.id AS prestamo_id,p.fecha::text,
    p.vencimiento_inicial::text,dp.vencimiento_vigente::text,dp.fecha_cierre::text,
    u.id AS usuario_id,u.nombre,u.identificador,e.id AS ejemplar_id,e.codigo,l.titulo,
    c.nombre AS curso_al_prestar,c.anio_escolar,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'fecha',r.fecha::text,
      'vencimiento_anterior',r.vencimiento_anterior::text,'nuevo_vencimiento',r.nuevo_vencimiento::text) ORDER BY r.fecha,r.id)
      FROM biblioteca.renovacion r WHERE r.detalle_id=dp.id),'[]') AS renovaciones,
    (SELECT jsonb_build_object('id',dv.id,'fecha',dv.fecha::text,'condicion',dd.condicion_recibida,'observaciones',dd.observaciones)
      FROM biblioteca.detalle_devolucion dd JOIN biblioteca.devolucion dv ON dv.id=dd.devolucion_id
      WHERE dd.detalle_prestamo_id=dp.id) AS devolucion,
    (SELECT jsonb_build_object('id',i.id,'fecha',i.fecha::text,'tipo',i.tipo,'observaciones',i.observaciones,
      'fecha_resolucion',i.fecha_resolucion::text,'solucion',i.solucion,'monto_reembolso',i.monto_reembolso,
      'ejemplar_reemplazo_id',i.ejemplar_reemplazo_id,'codigo_reemplazo',er.codigo)
      FROM biblioteca.incidencia i LEFT JOIN biblioteca.ejemplar er ON er.id=i.ejemplar_reemplazo_id
      WHERE i.detalle_id=dp.id) AS incidencia
    FROM biblioteca.detalle_prestamo dp JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id
    JOIN biblioteca.usuario u ON u.id=p.usuario_id JOIN biblioteca.ejemplar e ON e.id=dp.ejemplar_id
    JOIN biblioteca.libro l ON l.id=e.libro_id LEFT JOIN biblioteca.curso c ON c.id=p.curso_al_prestar_id
    WHERE ${isUser?'p.usuario_id':'dp.ejemplar_id'}=$1 ORDER BY p.fecha DESC,p.id DESC,dp.id`,[id]);
  return {tipo:type,sujeto:subject,movimientos};
}

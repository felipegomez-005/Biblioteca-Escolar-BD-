export class SanctionError extends Error {
  constructor(message,status=400) {super(message);this.status=status;}
}
const rows=async(db,sql,args=[])=>(await db.query(sql,args)).rows;
const columns='id,usuario_id,inicio::text,habilitado_desde::text,motivo,observaciones';

async function user(db,uid) {
  const [result]=await rows(db,'SELECT id,nombre,identificador,activo FROM biblioteca.usuario WHERE id=$1',[uid]);
  if(!result) throw new SanctionError('Usuario no encontrado.',404);
  return result;
}
async function endDate(db,today) {
  await db.query("SELECT biblioteca.validar_atencion($1::date,'sancion')",[today]);
  return (await rows(db,'SELECT biblioteca.proximo_habil($1::date+14)::text AS fecha',[today]))[0].fecha;
}
export async function readSanctions(db,uid,today) {
  const usuario=await user(db,uid);
  const sanciones=await rows(db,`SELECT ${columns},CASE WHEN inicio>$2 THEN 'programada'
    WHEN habilitado_desde>$2 THEN 'vigente' ELSE 'finalizada' END AS estado
    FROM biblioteca.sancion WHERE usuario_id=$1 ORDER BY inicio DESC,id DESC`,[uid,today]);
  let habilitado_desde=null,impedimento=null;
  try {habilitado_desde=await endDate(db,today);}
  catch(error) {if(error.code!=='P0001')throw error;impedimento=error.message;}
  return {usuario,sanciones,inicio:today,habilitado_desde,puede_registrar:habilitado_desde!==null,impedimento};
}
export async function registerSanction(db,{usuario_id,observaciones,inicio_esperado,habilitado_desde_esperado},today) {
  return db.transaction(async tx=>{
    await tx.query('SELECT biblioteca.bloquear_operaciones()');
    await user(tx,usuario_id);
    const [existing]=await rows(tx,`SELECT ${columns} FROM biblioteca.sancion
      WHERE usuario_id=$1 AND inicio=$2 AND observaciones=$3 ORDER BY id DESC LIMIT 1`,[usuario_id,today,observaciones]);
    // Reintentar una solicitud ya guardada no crea otra sanción ni modifica la anterior.
    if(existing && inicio_esperado===existing.inicio && habilitado_desde_esperado===existing.habilitado_desde)
      return {...existing,repetida:true};
    const expected=await endDate(tx,today);
    if(inicio_esperado!==today || habilitado_desde_esperado!==expected)
      throw new SanctionError('Las fechas cambiaron desde que abrió el formulario. Cierre y vuelva a abrir Sanciones para revisar el plazo actualizado.',409);
    await tx.query('CALL biblioteca.sp_sancionar_conducta($1,$2,$3)',[usuario_id,today,observaciones]);
    const [record]=await rows(tx,`SELECT ${columns} FROM biblioteca.sancion
      WHERE usuario_id=$1 AND inicio=$2 AND observaciones=$3 ORDER BY id DESC LIMIT 1`,[usuario_id,today,observaciones]);
    return {...record,repetida:false};
  });
}

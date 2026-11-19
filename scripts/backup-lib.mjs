import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,stat,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {openDb,root} from './db.mjs';

const MAX_BYTES=256*1024*1024;
const runtime=JSON.parse(await readFile(path.join(root,'node_modules','@electric-sql','pglite','package.json'),'utf8')).version;
const digest=value=>createHash('sha256').update(value).digest('hex');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const rows=async(db,sql,args=[])=>(await db.query(sql,args)).rows;

export async function fingerprint(db) {
  await db.exec("SET TIME ZONE 'America/Santiago'; SET search_path TO biblioteca, public;");
  const tables=await rows(db,"SELECT tablename FROM pg_tables WHERE schemaname='biblioteca' ORDER BY tablename");
  const names=tables.map(t=>t.tablename);
  for(const required of ['usuario','libro','ejemplar','prestamo','detalle_prestamo','calendario'])
    if(!names.includes(required))throw new Error('El archivo no contiene una base de biblioteca completa.');
  const result={};
  for(const name of names) {
    const [summary]=await rows(db,`SELECT count(*)::integer AS filas,
      md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) AS contenido
      FROM biblioteca.${quote(name)} t`);
    result[name]=summary;
  }
  return result;
}

export async function exportBackup(db) {
  // El llamador debe mantener el acceso exclusivo a esta base durante la operación.
  const tables=await fingerprint(db);
  const archive=Buffer.from(await (await db.dumpDataDir('gzip')).arrayBuffer());
  const payload={formato:'biblioteca-pglite',version:1,pglite:runtime,creado_en:new Date().toISOString(),tablas:tables,datos:archive.toString('base64')};
  const serialized=JSON.stringify(payload);
  const buffer=Buffer.from(JSON.stringify({sha256:digest(serialized),respaldo:payload}));
  if(buffer.length>MAX_BYTES)throw new Error('El respaldo excede el límite local de 256 MB. Se requiere otro mecanismo para este volumen.');
  return buffer;
}

export function decodeBackup(buffer) {
  if(buffer.length>MAX_BYTES)throw new Error('El respaldo excede el límite local de 256 MB.');
  let wrapper;
  try {wrapper=JSON.parse(buffer.toString('utf8'));}catch {throw new Error('No se pudo leer el archivo de respaldo.');}
  const p=wrapper?.respaldo;
  if(!p || p.formato!=='biblioteca-pglite' || p.version!==1 || typeof p.datos!=='string' || !p.tablas)
    throw new Error('Formato de respaldo no compatible.');
  if(wrapper.sha256!==digest(JSON.stringify(p)))throw new Error('El respaldo está incompleto o fue modificado: no coincide su comprobación de integridad.');
  if(p.pglite!==runtime)throw new Error(`El respaldo requiere PGlite ${p.pglite}; esta instalación usa ${runtime}.`);
  const archive=Buffer.from(p.datos,'base64');
  if(!archive.length || archive.toString('base64')!==p.datos)throw new Error('El contenido del respaldo no es válido.');
  return {metadata:p,archive};
}

async function loadChecked(decoded,dataDir) {
  let db;
  try {
    db=await PGlite.create({...(dataDir?{dataDir}:{}),loadDataDir:new Blob([decoded.archive])});
    const actual=await fingerprint(db);
    if(JSON.stringify(actual)!==JSON.stringify(decoded.metadata.tablas))throw new Error('Los datos restaurados no coinciden con el respaldo.');
    return db;
  }catch(error){await db?.close();throw error;}
}

export async function verifyBackup(buffer) {
  const decoded=decodeBackup(buffer);
  const db=await loadChecked(decoded);
  await db.close();
  return {creado_en:decoded.metadata.creado_en,pglite:decoded.metadata.pglite,tablas:decoded.metadata.tablas};
}

export async function readBackup(file) {
  const info=await stat(file);
  if(!info.isFile() || info.size>MAX_BYTES)throw new Error('Seleccione un archivo de respaldo de hasta 256 MB.');
  return readFile(file);
}

export async function restoreBackup(buffer,target) {
  const decoded=decodeBackup(buffer);
  // Nunca acepta una carpeta existente, ni siquiera vacía: no pisa bases anteriores.
  try {await mkdir(target);}catch(error){
    if(error.code==='EEXIST')throw new Error('La carpeta de restauración ya existe. No se modificó su contenido.');
    throw error;
  }
  const db=await loadChecked(decoded,target);
  await db.close();
  // Verifica también la persistencia después de cerrar y volver a abrir.
  const reopened=await openDb(target);
  try {
    if(JSON.stringify(await fingerprint(reopened))!==JSON.stringify(decoded.metadata.tablas))
      throw new Error('La restauración no conservó los datos al volver a abrirse.');
  }finally {await reopened.close();}
  return {carpeta:target,creado_en:decoded.metadata.creado_en,tablas:decoded.metadata.tablas};
}

export async function backupLocal(local=path.join(root,'.local')) {
  await mkdir(local,{recursive:true});
  const lockPath=path.join(local,'biblioteca.lock');
  let lock;
  try {lock=await open(lockPath,'wx');}catch {throw new Error('La base está en uso. Detenga la aplicación con Ctrl+C antes de crear el respaldo.');}
  let db;
  try {
    const dataDir=path.join(local,'biblioteca');
    try {await stat(path.join(dataDir,'PG_VERSION'));}catch {throw new Error('No existe una base local inicializada para respaldar.');}
    db=await openDb(dataDir);
    const buffer=await exportBackup(db);
    await db.close();db=null;
    const checked=await verifyBackup(buffer);
    const directory=path.join(local,'respaldos');await mkdir(directory,{recursive:true});
    const file=path.join(directory,'biblioteca-'+stamp()+'.biblioteca');
    await writeFile(file,buffer,{flag:'wx'});
    return {archivo:file,...checked};
  }finally {
    try {await db?.close();}finally {await lock.close();await unlink(lockPath);}
  }
}

export async function restoreLocal(file,local=path.join(root,'.local')) {
  const buffer=await readBackup(file);
  // Comprobar antes de crear la carpeta reduce restos de restauraciones inválidas.
  await verifyBackup(buffer);
  const directory=path.join(local,'restauraciones');await mkdir(directory,{recursive:true});
  return restoreBackup(buffer,path.join(directory,'biblioteca-'+stamp()));
}

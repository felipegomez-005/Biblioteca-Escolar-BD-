import { mkdir,open,unlink } from 'node:fs/promises';
import path from 'node:path';
import { root,openDb,initialize,upgrade } from '../scripts/db.mjs';
import { createApp } from './app.mjs';
import { loadEnvFile } from 'node:process';
import { smtpConfig,crearEnviador,programarDiario } from '../scripts/avisos-lib.mjs';

try {loadEnvFile(path.join(root,'.env'));}
catch(error) {if(error.code!=='ENOENT') throw error;}

const memory=process.env.BIBLIOTECA_PRUEBA==='1';
const local=path.join(root,'.local');
const lockPath=path.join(local,'biblioteca.lock');
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Puerto inválido. Use un puerto entre 1024 y 65535.');
let lock,db,server;
async function release() {
  if(db) {await db.close(); db=null;}
  if(lock) {await lock.close(); lock=null; await unlink(lockPath);}
}
try {
  if(!memory) {
    await mkdir(local,{recursive:true});
    try {lock=await open(lockPath,'wx');}
    catch {throw new Error('La base está en uso por otro comando o aplicación. Cierre esa operación antes de iniciar.');}
  }
  db=await openDb(memory?undefined:path.join(local,'biblioteca'));
  if(memory) await initialize(db);
  else if(!(await db.query("SELECT to_regnamespace('biblioteca') IS NOT NULL AS existe")).rows[0].existe) throw new Error('Primero ejecute npm.cmd run db:init.');
  if(!memory) await upgrade(db);
  const sendMail=await crearEnviador(smtpConfig());
  server=createApp(db,{requireAuth:true,sendMail});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  console.log(`Biblioteca · Colegio Siglo XXI de Lampa: http://127.0.0.1:${port}`);
  console.log(sendMail?'Correo SMTP configurado.':'Correo SMTP sin configurar: los avisos se pueden preparar, pero no enviar.');
  if(process.env.AVISOS_AUTOMATICOS==='1') {
    if(!sendMail) console.log('AVISOS_AUTOMATICOS=1 se ignora hasta configurar SMTP.');
    else {
      server.avisosEstado.programacion=programarDiario(process.env.AVISOS_HORA||'08:30',async()=>{
        const r=await server.enviarAvisosProgramados();
        console.log(`Avisos automáticos: ${r.enviados} enviados, ${r.cancelados} cancelados, ${r.errores} con error.`);
      });
      console.log(`Avisos automáticos activados todos los días a las ${server.avisosEstado.programacion.hora}.`);
    }
  }
  console.log(memory?'Prueba temporal: los cambios no afectan la base local.':'Base local conectada. Use Ctrl+C para cerrar y liberar la base.');
  let closing=false;
  const stop=()=>{
    if(closing) return; closing=true;
    server.close(async()=>{await release();process.exit(0);});
    server.closeIdleConnections();
  };
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
} catch(error) {
  await release();
  console.error(error.code==='EADDRINUSE'?`El puerto ${port} ya está ocupado. Compruebe si la aplicación ya está abierta.`:error.message);
  process.exitCode=1;
}

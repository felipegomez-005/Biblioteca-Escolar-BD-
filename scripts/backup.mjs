import path from 'node:path';
import {backupLocal,restoreLocal,readBackup,verifyBackup} from './backup-lib.mjs';

try {
  const [command,file,...extra]=process.argv.slice(2);
  if(extra.length || !['crear','verificar','restaurar'].includes(command) || (command==='crear' && file) || (command!=='crear' && !file))
    throw new Error('Use db:backup, db:verificar -- "archivo.biblioteca" o db:restaurar -- "archivo.biblioteca".');
  if(command==='crear') {
    const result=await backupLocal();
    console.log('Respaldo creado y comprobado restaurándolo en memoria.');
    console.log(result.archivo);
  }else if(command==='verificar') {
    const result=await verifyBackup(await readBackup(path.resolve(file)));
    console.log(`Respaldo válido del ${result.creado_en}. Se comprobaron ${Object.keys(result.tablas).length} tablas.`);
  }else {
    const result=await restoreLocal(path.resolve(file));
    console.log('Restauración comprobada en una carpeta nueva. La base activa no se ha reemplazado.');
    console.log(result.carpeta);
  }
}catch(error){console.error(error.message);process.exitCode=1;}

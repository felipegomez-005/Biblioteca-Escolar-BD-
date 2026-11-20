import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,unlink,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import {openDb,initialize,root} from '../scripts/db.mjs';
import {exportBackup,verifyBackup,decodeBackup,restoreBackup,backupLocal,readBackup,fingerprint} from '../scripts/backup-lib.mjs';

let db,buffer,temp,original;
before(async()=>{
  await mkdir(path.join(root,'.local'),{recursive:true});
  temp=await mkdtemp(path.join(root,'.local','backup-test-'));
  db=await openDb();await initialize(db);
  await db.query("INSERT INTO biblioteca.genero(nombre) VALUES('Respaldo: ñ y acentos')");
  original=await fingerprint(db);buffer=await exportBackup(db);
});
after(async()=>{await db?.close();if(temp)await rm(temp,{recursive:true,force:true});});

test('BACKUP 01 - archivo íntegro restaura datos, reglas y secuencias; respaldo local vuelve a abrirse',async()=>{
  assert.deepEqual((await verifyBackup(buffer)).tablas,original);
  await db.query("INSERT INTO biblioteca.genero(nombre) VALUES('Posterior al respaldo')");
  const target=path.join(temp,'biblioteca');
  await restoreBackup(buffer,target);
  const copy=await openDb(target);
  try {
    assert.deepEqual(await fingerprint(copy),original);
    assert.equal((await copy.query("SELECT count(*)::integer AS n FROM biblioteca.genero WHERE nombre='Posterior al respaldo'")).rows[0].n,0);
    const max=(await copy.query('SELECT max(id) AS n FROM biblioteca.genero')).rows[0].n;
    const inserted=(await copy.query("INSERT INTO biblioteca.genero(nombre) VALUES('Después de restaurar') RETURNING id")).rows[0].id;
    assert.ok(inserted>max);
    await assert.rejects(copy.query("CALL biblioteca.sp_prestar(7,ARRAY[25,26,27,28],DATE '2026-05-04')"));
    await copy.query("CALL biblioteca.sp_prestar(7,ARRAY[25],DATE '2026-05-04')");
  }finally {await copy.close();}
  const saved=await backupLocal(temp);
  assert.ok(saved.archivo.startsWith(path.join(temp,'respaldos')));
  assert.deepEqual((await verifyBackup(await readBackup(saved.archivo))).tablas,saved.tablas);
  assert.equal(saved.tablas.prestamo.filas,original.prestamo.filas+1);
  await assert.rejects(stat(path.join(temp,'biblioteca.lock')),{code:'ENOENT'});
});

test('BACKUP 02 - rechaza contenido alterado, formato y versiones incompatibles',async()=>{
  assert.throws(()=>decodeBackup(Buffer.from('archivo cortado')),/leer/);
  const damaged=JSON.parse(buffer.toString());damaged.respaldo.datos='AAAA';
  assert.throws(()=>decodeBackup(Buffer.from(JSON.stringify(damaged))),/integridad/);
  const other=JSON.parse(buffer.toString());other.respaldo.pglite='0.0.0';
  other.sha256=createHash('sha256').update(JSON.stringify(other.respaldo)).digest('hex');
  assert.throws(()=>decodeBackup(Buffer.from(JSON.stringify(other))),/requiere PGlite/);
  assert.throws(()=>decodeBackup(Buffer.from('{}')),/Formato/);
  // La verificación restaura el contenido, no confía solo en la suma del archivo.
  const wrongCounts=JSON.parse(buffer.toString());wrongCounts.respaldo.tablas.libro.filas++;
  wrongCounts.sha256=createHash('sha256').update(JSON.stringify(wrongCounts.respaldo)).digest('hex');
  await assert.rejects(verifyBackup(Buffer.from(JSON.stringify(wrongCounts))),/no coinciden/);
});

test('BACKUP 03 - no sobrescribe destinos ni abre bases en uso o inexistentes',async()=>{
  const occupied=path.join(temp,'ocupado');await mkdir(occupied);
  await writeFile(path.join(occupied,'conservar.txt'),'Sin modificaciones');
  await assert.rejects(restoreBackup(buffer,occupied),/ya existe/);
  assert.equal(await readFile(path.join(occupied,'conservar.txt'),'utf8'),'Sin modificaciones');
  const empty=path.join(temp,'sin-base');await mkdir(empty);
  const lock=path.join(empty,'biblioteca.lock');await writeFile(lock,'Prueba de otro proceso');
  await assert.rejects(backupLocal(empty),/en uso/);
  assert.equal(await readFile(lock,'utf8'),'Prueba de otro proceso');
  await unlink(lock);
  await assert.rejects(backupLocal(empty),/No existe una base/);
  await assert.rejects(stat(path.join(empty,'biblioteca')),{code:'ENOENT'});
  await assert.rejects(stat(lock),{code:'ENOENT'});
});

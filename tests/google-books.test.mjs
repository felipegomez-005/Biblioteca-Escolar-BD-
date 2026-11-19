import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleBooks,normalizeIsbn,isbnVariants} from '../server/google-books.mjs';
import {openDb,initialize} from '../scripts/db.mjs';
import {createApp} from '../server/app.mjs';

const isbn='9780306406157';
const volume=(code=isbn,overrides={})=>({id:'vol-'+code,volumeInfo:{title:'Título de prueba',authors:['Autora Uno','Autor Dos'],publisher:'Editorial de prueba',publishedDate:'2001-04-01',categories:['Ciencia'],industryIdentifiers:[{type:'ISBN_13',identifier:code}],...overrides}});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('ISBN 01 - dígito verificador, espacios, guiones y equivalencia 10/13',()=>{
  assert.equal(normalizeIsbn(' 0-306-40615-2 '),isbn);
  assert.equal(normalizeIsbn('978-0-306-40615-7'),isbn);
  assert.deepEqual(isbnVariants(isbn),[isbn,'0306406152']);
  assert.equal(normalizeIsbn('080442957x'),'9780804429573');
  for(const bad of ['123','9780306406158','0306406153','1234567890128',null,{},'x'.repeat(50)]) assert.throws(()=>normalizeIsbn(bad));
  assert.equal(normalizeIsbn('',{optional:true}),null);
});

test('BOOKS 01 - consulta exacta, datos incompletos y filtrado de otras ediciones',async()=>{
  let urlSeen;
  const books=createGoogleBooks({apiKey:'clave-ficticia',fetchImpl:async url=>{
    urlSeen=url;
    return json({items:[volume(),volume('9780140328721'),volume(isbn,{title:'',publisher:null}),{id:'incompleto',volumeInfo:{title:'Edición incompleta',industryIdentifiers:[{type:'ISBN_10',identifier:'0306406152'}]}}]});
  }});
  const results=await books.lookup('0306406152');
  assert.equal(urlSeen.origin,'https://www.googleapis.com');assert.equal(urlSeen.searchParams.get('q'),'isbn:'+isbn);
  assert.equal(results.length,2);assert.equal(results[0].autores,'Autora Uno; Autor Dos');assert.equal(results[0].anio_publicacion,2001);
  assert.equal(results[1].editorial,'');assert.equal(results[1].anio_publicacion,null);
  assert.ok(!JSON.stringify(results).includes('clave-ficticia'));
});

test('BOOKS 02 - sin resultados no inventa datos',async()=>{
  const books=createGoogleBooks({apiKey:'prueba',fetchImpl:async()=>json({totalItems:0})});
  assert.deepEqual(await books.lookup(isbn),[]);
});

test('BOOKS 03 - falta de clave, cuotas, permisos y errores no exponen secretos',async()=>{
  let calls=0;
  await assert.rejects(createGoogleBooks({apiKey:'',fetchImpl:async()=>{calls++;}}).lookup(isbn),e=>e.status===503&&/clave/.test(e.message));
  assert.equal(calls,0);
  for(const status of [401,403,429,500]) {
    const books=createGoogleBooks({apiKey:'secreto-no-exponer',fetchImpl:async()=>json({error:{message:'secreto-no-exponer'}},status)});
    await assert.rejects(books.lookup(isbn),e=>e.status>=500&&!e.message.includes('secreto-no-exponer'));
  }
  for(const fetchImpl of [async()=>{throw new Error('secreto-no-exponer');},async()=>new Response('no es JSON'),async()=>json({items:'inválido'})]) {
    await assert.rejects(createGoogleBooks({apiKey:'prueba',fetchImpl}).lookup(isbn),e=>e.status===502&&!e.message.includes('secreto-no-exponer'));
  }
});

test('BOOKS 04 - una consulta que no responde tiene plazo máximo',async()=>{
  const books=createGoogleBooks({apiKey:'prueba',timeoutMs:20,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>{
    // Mantener un temporizador activo permite observar AbortSignal.timeout en Node.
    const timer=setTimeout(()=>reject(new Error('La prueba excedió su plazo')),1000);
    signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
  })});
  await assert.rejects(books.lookup(isbn),e=>e.status===502);
});

test('BOOKS 05 - procedencia exige consulta vigente y del mismo ISBN',async()=>{
  let now=0;
  const books=createGoogleBooks({apiKey:'prueba',now:()=>now,fetchImpl:async()=>json({items:[volume()]})});
  const [preview]=await books.lookup(isbn);
  books.validatePreview(preview.consulta_id,isbn,preview.google_books_id);
  assert.throws(()=>books.validatePreview('inventada',isbn,preview.google_books_id));
  assert.throws(()=>books.validatePreview(preview.consulta_id,'9780140328721',preview.google_books_id));
  assert.throws(()=>books.validatePreview(preview.consulta_id,isbn,'otro-volumen'));
  now=30*60*1000;
  assert.throws(()=>books.validatePreview(preview.consulta_id,isbn,preview.google_books_id));
});

let db,server,base,providerMode='ok',providerCalls=0;
before(async()=>{
  db=await openDb();await initialize(db);
  const googleBooks=createGoogleBooks({apiKey:'clave-simulada',fetchImpl:async url=>{
    providerCalls++;
    if(providerMode==='quota') return json({},429);
    if(providerMode==='empty') return json({totalItems:0});
    return json({items:[volume(url.searchParams.get('q').slice(5))]});
  }});
  server=createApp(db,{today:'2026-05-04',googleBooks});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${server.address().port}/api`;
});
after(async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db?.close();});
async function request(route,data) {
  const response=await fetch(base+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1'},body:data?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json()};
}

test('BOOKS API 01 - buscar no guarda; selección revisada conserva procedencia y autores',async()=>{
  const initial=(await db.query('SELECT count(*) AS n FROM biblioteca.libro')).rows[0].n;
  const response=await request('/libros/isbn?isbn=0-306-40615-2');assert.equal(response.status,200);
  assert.equal((await db.query('SELECT count(*) AS n FROM biblioteca.libro')).rows[0].n,initial);
  const preview=response.data.resultados[0];
  const saved=await request('/libros',{...preview,titulo:'Título revisado por bibliotecaria',codigo:'BOOKS-01'});
  assert.equal(saved.status,201);
  const [row]=(await request('/libros?q='+isbn)).data;
  assert.equal(row.origen_datos,'google_books');assert.equal(row.google_books_id,preview.google_books_id);
  assert.equal(row.titulo,'Título revisado por bibliotecaria');assert.match(row.autores,/Autora Uno/);assert.match(row.autores,/Autor Dos/);
  assert.equal(row.copias,1);assert.equal(row.isbn,isbn);
});

test('BOOKS API 02 - existente se detecta sin consultar al proveedor ni duplicar edición',async()=>{
  const beforeCalls=providerCalls;
  const existing=await request('/libros/isbn?isbn=0306406152');
  assert.ok(existing.data.existente);assert.equal(existing.data.resultados.length,0);assert.equal(providerCalls,beforeCalls);
  assert.equal(existing.data.existente.origen_datos,'google_books');assert.match(existing.data.existente.autores,/Autora Uno/);
  assert.equal(existing.data.existente.editorial,'Editorial de prueba');
  assert.equal((await request('/libros',{titulo:'Duplicado',isbn:'0306406152'})).status,409);
});

test('BOOKS API 03 - detecta ISBN-10 almacenado previamente con su ISBN-13',async()=>{
  await db.query("INSERT INTO biblioteca.libro(titulo,isbn) VALUES('Registro anterior','0140328726')");
  const existing=await request('/libros/isbn?isbn=9780140328721');assert.ok(existing.data.existente);
  assert.equal((await request('/libros',{titulo:'Duplicado anterior',isbn:'9780140328721'})).status,409);
});

test('BOOKS API 04 - ISBN inválido y procedencia inventada no guardan datos',async()=>{
  const calls=providerCalls;
  assert.equal((await request('/libros/isbn?isbn=9780306406158')).status,400);assert.equal(providerCalls,calls);
  assert.equal((await request('/libros',{titulo:'ISBN incorrecto',isbn:'9780306406158'})).status,400);
  assert.equal((await request('/libros',{titulo:'Origen falso',isbn:'9780131103627',origen_datos:'google_books',google_books_id:'falso',consulta_id:'falsa'})).status,409);
  assert.equal((await request('/libros',{titulo:'Incoherente',google_books_id:'falso'})).status,400);
});

test('BOOKS API 05 - falla de Google permite ingreso manual y campos vacíos',async()=>{
  providerMode='quota';
  const failed=await request('/libros/isbn?isbn=9780131103627');assert.equal(failed.status,503);assert.match(failed.data.error,/cuota/);
  const saved=await request('/libros',{titulo:'Ingreso manual tras error',isbn:'0-13-110362-8'});assert.equal(saved.status,201);
  const [row]=(await request('/libros?q=9780131103627')).data;assert.equal(row.origen_datos,'manual');assert.equal(row.google_books_id,null);
  providerMode='empty';assert.deepEqual((await request('/libros/isbn?isbn=9780201633610')).data.resultados,[]);
  providerMode='ok';
});

test('BOOKS API 06 - alta externa es atómica y se puede reintentar tras corregir código',async()=>{
  const [preview]=(await request('/libros/isbn?isbn=9780201633610')).data.resultados;
  assert.equal((await request('/libros',{...preview,codigo:'BOOKS-01'})).status,409);
  assert.equal((await request('/libros?q=9780201633610')).data.length,0);
  assert.equal((await request('/libros',{...preview,codigo:'BOOKS-02'})).status,201);
});

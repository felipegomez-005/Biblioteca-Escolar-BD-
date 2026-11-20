import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../scripts/db.mjs';
import { CatalogError,createGoogleBooks,normalizeIsbn,isbnVariants } from './google-books.mjs';
import { CalendarError,readCalendar,previewCalendar,saveCalendar } from './calendar.mjs';
import { SanctionError,readSanctions,registerSanction } from './sanctions.mjs';
import {readBook,editBook} from './catalog-edit.mjs';
import {readHistory} from './history.mjs';

class InputError extends Error { constructor(message,status=400) { super(message); this.status=status; } }
function text(value,label,max=250,required=true) {
  if (value==null && !required) return null;
  if (typeof value!=='string' || value.trim().length>max || (required && !value.trim())) throw new InputError(`${label}: ingrese un valor válido.`);
  return value.trim() || null;
}
function id(value,label='Identificador') {
  const result=Number(value);
  if (!Number.isSafeInteger(result) || result<1) throw new InputError(`${label} inválido.`);
  return result;
}
function ids(value) {
  if (!Array.isArray(value) || !value.length || value.length>3) throw new InputError('Seleccione entre uno y tres ejemplares.');
  const list=value.map(x=>id(x));
  if (new Set(list).size!==list.length) throw new InputError('La selección contiene ejemplares repetidos.');
  return list;
}
function oneOf(value,values,label) {
  if (!values.includes(value)) throw new InputError(`${label} inválido.`);
  return value;
}
function year(value) {
  const n=id(value,'Año');
  if(n<2000 || n>9998) throw new InputError('El año debe estar entre 2000 y 9998.');
  return n;
}
function email(value,required) {
  const result=text(value,'Correo',254,required);
  if(result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new InputError('Ingrese un correo válido.');
  return result;
}
async function body(req) {
  const chunks=[];let size=0;
  for await (const part of req) {
    chunks.push(part);size+=part.length;
    if(size>65536) throw new InputError('Formulario demasiado grande.',413);
  }
  try {
    const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new InputError('No se pudo leer el formulario.'); }
}
function friendly(error) {
  if(error instanceof InputError || error instanceof CatalogError || error instanceof CalendarError || error instanceof SanctionError) return {status:error.status,message:error.message};
  if(error.code==='23505') return {status:409,message:'Ya existe un registro con ese ISBN, código o identificación. Revise los datos antes de guardar.'};
  if(error.code==='23503' || error.code==='P0002') return {status:404,message:'El registro seleccionado ya no está disponible. Actualice la página.'};
  if(error.code==='23514' || error.code==='23502') return {status:400,message:'Revise los campos obligatorios y sus valores.'};
  if(error.code==='P0001') return {status:409,message:error.message};
  console.error('Error de aplicación:',error.message);
  return {status:500,message:'No se pudo completar la operación. Los cambios de esta operación no se guardaron.'};
}

export function createApp(db,{today,googleBooks=createGoogleBooks()}={}) {
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const date=async()=>today || (await q('SELECT CURRENT_DATE::text AS fecha'))[0].fecha;
  let tail=Promise.resolve();
  // Una sola cola para la conexión local: los formularios no intercalan transacciones.
  const exclusive=fn=>{ const next=tail.then(fn); tail=next.catch(()=>{}); return next; };

  async function api(method,url,b) {
    const p=url.pathname, d=await date();
    const history=p.match(/^\/api\/(usuarios|ejemplares)\/(\d+)\/historial$/);
    if(method==='GET' && history)return readHistory(db,history[1],id(history[2]));
    const edit=p.match(/^\/api\/libros\/(\d+)$/);
    if(method==='GET' && edit)return readBook(db,id(edit[1]));
    if(method==='PATCH' && edit) {
      let publication=null;
      if(b.anio_publicacion!==null && b.anio_publicacion!==undefined && b.anio_publicacion!=='') {
        publication=id(b.anio_publicacion,'Año de publicación');
        if(publication>9999)throw new InputError('Año de publicación inválido.');
      }
      return editBook(db,id(edit[1]),{
        titulo:text(b.titulo,'Título'),isbn:normalizeIsbn(b.isbn,{optional:true}),
        editorial:text(b.editorial,'Editorial',150,false),anio_publicacion:publication,
        autores:(text(b.autores,'Autores',1000,false)||'').split(';').map(s=>s.trim()).filter(Boolean),
        generos:(text(b.generos,'Géneros',500,false)||'').split(';').map(s=>s.trim()).filter(Boolean),
        version:text(b.version,'Versión del libro',64)
      });
    }
    const sanctionUser=p.match(/^\/api\/usuarios\/(\d+)\/sanciones$/);
    if(method==='GET' && sanctionUser) return readSanctions(db,id(sanctionUser[1]),d);
    if(method==='POST' && p==='/api/sanciones') return registerSanction(db,{
      usuario_id:id(b.usuario_id),observaciones:text(b.observaciones,'Motivo de la sanción',1000),
      inicio_esperado:text(b.inicio_esperado,'Fecha de inicio revisada',10),
      habilitado_desde_esperado:text(b.habilitado_desde_esperado,'Fecha de término revisada',10)
    },d);
    if(method==='GET' && p==='/api/calendario') return readCalendar(db,url.searchParams.get('mes')||d.slice(0,7),d);
    if(method==='POST' && p==='/api/calendario/previsualizar') return previewCalendar(db,b,d);
    if(method==='POST' && p==='/api/calendario/configurar') return saveCalendar(db,b,d);
    if(method==='GET' && p==='/api/libros/isbn') {
      const isbn=normalizeIsbn(url.searchParams.get('isbn'));
      const existing=(await q(`SELECT l.id,l.titulo,l.isbn,l.origen_datos,e.nombre AS editorial,
        coalesce((SELECT string_agg(a.nombre,' · ' ORDER BY a.nombre) FROM biblioteca.libro_autor la JOIN biblioteca.autor a ON a.id=la.autor_id WHERE la.libro_id=l.id),'') AS autores
        FROM biblioteca.libro l LEFT JOIN biblioteca.editorial e ON e.id=l.editorial_id WHERE l.isbn=ANY($1::text[])`,[isbnVariants(isbn)]))[0];
      if(existing) return {isbn,existente:existing,resultados:[]};
      return {isbn,existente:null,resultados:await googleBooks.lookup(isbn)};
    }
    if(method==='GET' && p==='/api/contexto') {
      const cal=(await q('SELECT * FROM biblioteca.calendario WHERE fecha=$1',[d]))[0]||null;
      let vencimiento=null;
      if(cal?.permite_prestamo) {
        try {
          vencimiento=(await q('SELECT biblioteca.sumar_habiles($1::date,3)::text AS fecha',[d]))[0].fecha;
          await q('SELECT biblioteca.validar_plazo($1::date,$2::date)',[d,vencimiento]);
        } catch { vencimiento=null; }
      }
      return {fecha:d,calendario:cal,vencimiento,cursos:await q('SELECT * FROM biblioteca.curso ORDER BY anio_escolar,nombre')};
    }
    if(method==='GET' && p==='/api/resumen') return (await q(`SELECT
      (SELECT count(*)::integer FROM biblioteca.libro) AS libros,
      (SELECT count(*)::integer FROM biblioteca.v_disponibilidad WHERE disponible) AS disponibles,
      (SELECT count(*)::integer FROM biblioteca.detalle_prestamo WHERE fecha_cierre IS NULL) AS en_prestamo,
      (SELECT count(*)::integer FROM biblioteca.usuario WHERE activo) AS usuarios,
      (SELECT count(*)::integer FROM biblioteca.detalle_prestamo dp WHERE dp.fecha_cierre IS NULL
        AND dp.vencimiento_vigente<$1 AND NOT EXISTS(SELECT 1 FROM biblioteca.incidencia i WHERE i.detalle_id=dp.id)) AS atrasados`,[d]))[0];
    if(method==='GET' && p==='/api/libros') {
      const search='%'+(url.searchParams.get('q')||'').slice(0,150)+'%';
      return q(`SELECT l.*,e.nombre AS editorial,
        coalesce((SELECT string_agg(a.nombre,' · ' ORDER BY a.nombre) FROM biblioteca.libro_autor la JOIN biblioteca.autor a ON a.id=la.autor_id WHERE la.libro_id=l.id),'') AS autores,
        coalesce((SELECT string_agg(g.nombre,' · ' ORDER BY g.nombre) FROM biblioteca.libro_genero lg JOIN biblioteca.genero g ON g.id=lg.genero_id WHERE lg.libro_id=l.id),'') AS generos,
        (SELECT count(*)::integer FROM biblioteca.ejemplar ex WHERE ex.libro_id=l.id) AS copias,
        (SELECT count(*)::integer FROM biblioteca.v_disponibilidad v WHERE v.libro_id=l.id AND v.disponible) AS disponibles
        FROM biblioteca.libro l LEFT JOIN biblioteca.editorial e ON e.id=l.editorial_id
        WHERE l.titulo ILIKE $1 OR l.isbn ILIKE $1 OR EXISTS(SELECT 1 FROM biblioteca.libro_autor la JOIN biblioteca.autor a ON a.id=la.autor_id WHERE la.libro_id=l.id AND a.nombre ILIKE $1)
        ORDER BY l.titulo,l.id`,[search]);
    }
    if(method==='GET' && p==='/api/ejemplares') {
      const book=url.searchParams.get('libro');
      return q(`SELECT * FROM biblioteca.v_disponibilidad
        WHERE ($1::integer IS NULL OR libro_id=$1) AND (NOT $2::boolean OR disponible) ORDER BY titulo,codigo`,
      [book?id(book):null,url.searchParams.get('disponibles')==='1']);
    }
    if(method==='GET' && p==='/api/usuarios') {
      const search='%'+(url.searchParams.get('q')||'').slice(0,150)+'%';
      return q(`SELECT u.*,c.nombre AS curso,c.anio_escolar,
        (SELECT max(s.habilitado_desde)::text FROM biblioteca.sancion s WHERE s.usuario_id=u.id AND s.inicio<=$2 AND s.habilitado_desde>$2) AS sancion_hasta,
        (SELECT count(*)::integer FROM biblioteca.detalle_prestamo dp JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id WHERE p.usuario_id=u.id AND dp.fecha_cierre IS NULL) AS pendientes
        FROM biblioteca.usuario u LEFT JOIN biblioteca.curso c ON c.id=u.curso_actual_id
        WHERE u.nombre ILIKE $1 OR u.identificador ILIKE $1 ORDER BY u.nombre,u.id`,[search,d]);
    }
    const userMatch=p.match(/^\/api\/usuarios\/(\d+)\/resumen$/);
    if(method==='GET' && userMatch) {
      const uid=id(userMatch[1]);
      const user=(await q('SELECT * FROM biblioteca.usuario WHERE id=$1',[uid]))[0];
      if(!user) throw new InputError('Usuario no encontrado.',404);
      return {usuario:user,bloqueos:await q('SELECT DISTINCT motivo FROM biblioteca.motivos_bloqueo($1,$2)',[uid,d]),
        sanciones_conducta:await q('SELECT id,habilitado_desde::text FROM biblioteca.sancion WHERE usuario_id=$1 AND inicio<=$2 AND habilitado_desde>$2 ORDER BY habilitado_desde',[uid,d]),
        prestamos:await q(`SELECT dp.id AS detalle_id,p.id AS prestamo_id,e.codigo,e.condicion,l.titulo,dp.vencimiento_vigente::text AS vencimiento,
          dp.cantidad_renovaciones,dp.vencimiento_vigente<$2 AS atrasado,i.id AS incidencia_id,i.tipo AS incidencia,
          CASE WHEN dp.cantidad_renovaciones<2 AND dp.vencimiento_vigente>=$2 AND i.id IS NULL THEN true ELSE false END AS puede_renovar
          FROM biblioteca.detalle_prestamo dp JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id
          JOIN biblioteca.ejemplar e ON e.id=dp.ejemplar_id JOIN biblioteca.libro l ON l.id=e.libro_id
          LEFT JOIN biblioteca.incidencia i ON i.detalle_id=dp.id
          WHERE p.usuario_id=$1 AND dp.fecha_cierre IS NULL ORDER BY dp.vencimiento_vigente,dp.id`,[uid,d])};
    }
    if(method==='GET' && p==='/api/pendientes') return q(`SELECT p.usuario_id,u.nombre,u.correo,p.id AS prestamo_id,dp.id AS detalle_id,
      e.codigo,l.titulo,dp.vencimiento_vigente::text AS vencimiento,($1::date-dp.vencimiento_vigente) AS dias_atraso,
      i.id AS incidencia_id,i.tipo AS incidencia FROM biblioteca.detalle_prestamo dp
      JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id JOIN biblioteca.usuario u ON u.id=p.usuario_id
      JOIN biblioteca.ejemplar e ON e.id=dp.ejemplar_id JOIN biblioteca.libro l ON l.id=e.libro_id
      LEFT JOIN biblioteca.incidencia i ON i.detalle_id=dp.id
      WHERE dp.fecha_cierre IS NULL AND (dp.vencimiento_vigente<$1 OR i.id IS NOT NULL) ORDER BY dp.vencimiento_vigente,dp.id`,[d]);
    if(method==='GET' && p==='/api/estadisticas') {
      const result=(await q('CALL biblioteca.sp_kpis_anuales($1)',[year(url.searchParams.get('anio')||d.slice(0,4))]))[0];
      return {por_curso:result.p_por_curso,por_libro:result.p_libros_mas_prestados};
    }
    if(method==='POST' && p==='/api/libros') {
      const title=text(b.titulo,'Título'), publisher=text(b.editorial,'Editorial',150,false);
      const isbn=normalizeIsbn(b.isbn,{optional:true});
      const origin=oneOf(b.origen_datos||'manual',['manual','google_books'],'Origen de los datos');
      const googleId=origin==='google_books'?text(b.google_books_id,'Identificador de Google Books',150):null;
      if(origin==='google_books') googleBooks.validatePreview(b.consulta_id,isbn,googleId);
      else if(b.google_books_id || b.consulta_id) throw new InputError('La procedencia del libro no coincide con sus datos. Repita la consulta.');
      if(isbn && (await q('SELECT id FROM biblioteca.libro WHERE isbn=ANY($1::text[])',[isbnVariants(isbn)])).length)
        throw new InputError('Este ISBN ya está en el catálogo. Abra «Ver copias» para agregar otro ejemplar.',409);
      const authors=(text(b.autores,'Autores',1000,false)||'').split(';').map(s=>s.trim()).filter(Boolean);
      const genres=(text(b.generos,'Géneros',500,false)||'').split(';').map(s=>s.trim()).filter(Boolean);
      let publication=null;
      if(b.anio_publicacion) {publication=id(b.anio_publicacion,'Año de publicación'); if(publication>9999) throw new InputError('Año de publicación inválido.');}
      const code=text(b.codigo,'Código de ejemplar',80,false);
      return db.transaction(async tx=>{
        const query=async(sql,args)=>(await tx.query(sql,args)).rows;
        let eid=null;
        if(publisher) eid=(await query('INSERT INTO biblioteca.editorial(nombre) VALUES($1) ON CONFLICT(nombre) DO UPDATE SET nombre=excluded.nombre RETURNING id',[publisher]))[0].id;
        const book=(await query('INSERT INTO biblioteca.libro(titulo,isbn,editorial_id,anio_publicacion,origen_datos,google_books_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[title,isbn,eid,publication,origin,googleId]))[0];
        for(const name of [...new Set(authors)]) {
          const existing=(await query('SELECT id FROM biblioteca.autor WHERE nombre=$1 ORDER BY id LIMIT 1',[name]))[0];
          const author=existing||(await query('INSERT INTO biblioteca.autor(nombre) VALUES($1) RETURNING id',[name]))[0];
          await query('INSERT INTO biblioteca.libro_autor VALUES($1,$2)',[book.id,author.id]);
        }
        for(const name of [...new Set(genres)]) {
          const g=(await query('INSERT INTO biblioteca.genero(nombre) VALUES($1) ON CONFLICT(nombre) DO UPDATE SET nombre=excluded.nombre RETURNING id',[name]))[0];
          await query('INSERT INTO biblioteca.libro_genero VALUES($1,$2)',[book.id,g.id]);
        }
        if(code) await query('INSERT INTO biblioteca.ejemplar(libro_id,codigo) VALUES($1,$2)',[book.id,code]);
        return book;
      });
    }
    if(method==='POST' && p==='/api/ejemplares') return (await q('INSERT INTO biblioteca.ejemplar(libro_id,codigo,condicion,observaciones) VALUES($1,$2,$3,$4) RETURNING id',
      [id(b.libro_id),text(b.codigo,'Código',80),oneOf(b.condicion||'bueno',['bueno','desgastado'],'Condición'),text(b.observaciones,'Observaciones',1000,false)]))[0];
    if(method==='POST' && p==='/api/cursos') return (await q('INSERT INTO biblioteca.curso(nombre,anio_escolar) VALUES($1,$2) RETURNING id',[text(b.nombre,'Nombre del curso',80),year(b.anio_escolar)]))[0];
    const editUser=p.match(/^\/api\/usuarios\/(\d+)$/);
    if((method==='POST' && p==='/api/usuarios') || (method==='PATCH' && editUser)) {
      const tipo=oneOf(b.tipo,['estudiante','docente','asistente'],'Tipo de usuario');
      const values=[text(b.identificador,'Identificación',60),text(b.nombre,'Nombre',150),tipo,email(b.correo,tipo==='estudiante'),
        tipo==='estudiante'?id(b.curso_actual_id,'Curso'):null,tipo==='estudiante'?null:text(b.cargo,'Cargo',150,false)];
      if(method==='POST') return (await q('INSERT INTO biblioteca.usuario(identificador,nombre,tipo,correo,curso_actual_id,cargo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',values))[0];
      if(typeof b.activo!=='boolean') throw new InputError('Estado de usuario inválido.');
      const updated=(await q('UPDATE biblioteca.usuario SET identificador=$1,nombre=$2,tipo=$3,correo=$4,curso_actual_id=$5,cargo=$6,activo=$7 WHERE id=$8 RETURNING id',[...values,b.activo,id(editUser[1])]))[0];
      if(!updated) throw new InputError('Usuario no encontrado.',404);
      return updated;
    }
    if(method==='POST' && p==='/api/prestamos') return (await q('CALL biblioteca.sp_prestar($1,$2,$3)',[id(b.usuario_id),ids(b.ejemplares),d]))[0];
    if(method==='POST' && ['/api/devoluciones','/api/renovaciones'].includes(p)) {
      const uid=id(b.usuario_id), selected=ids(b.detalles);
      const owned=await q('SELECT dp.id FROM biblioteca.detalle_prestamo dp JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id WHERE dp.id=ANY($1) AND p.usuario_id=$2 AND dp.fecha_cierre IS NULL',[selected,uid]);
      if(owned.length!==selected.length) throw new InputError('La selección ya no corresponde a los préstamos abiertos de esta persona.',409);
      if(p==='/api/devoluciones') {
        const observations=text(b.observaciones,'Observaciones',1000,false);
        if(b.condiciones===undefined)return (await q('CALL biblioteca.sp_devolver($1,$2,$3,$4)',[uid,selected,d,observations]))[0];
        if(!Array.isArray(b.condiciones) || b.condiciones.length!==selected.length)throw new InputError('Indique una condición por cada ejemplar seleccionado.');
        const conditions=b.condiciones.map(c=>oneOf(c,['bueno','desgastado'],'Condición recibida'));
        return (await q('CALL biblioteca.sp_devolver_condiciones($1,$2,$3,$4,$5)',[uid,selected,conditions,d,observations]))[0];
      }
      await q('CALL biblioteca.sp_renovar($1,$2)',[selected,d]); return {renovados:selected.length};
    }
    if(method==='POST' && p==='/api/incidencias') {
      await q('CALL biblioteca.sp_registrar_incidencia($1,$2,$3,$4)',[id(b.detalle_id),oneOf(b.tipo,['perdida','dano_permanente'],'Incidencia'),d,text(b.observaciones,'Observaciones',1000,false)]);
      return {registrada:true};
    }
    const resolve=p.match(/^\/api\/incidencias\/(\d+)\/resolver$/);
    if(method==='POST' && resolve) {
      const solution=oneOf(b.solucion,['reposicion','reembolso'],'Solución');
      const amount=solution==='reembolso'?Number(b.monto):null;
      if(solution==='reembolso' && (!Number.isFinite(amount)||amount<=0||amount>9999999999.99)) throw new InputError('Ingrese un monto positivo válido.');
      await q('CALL biblioteca.sp_resolver_incidencia($1,$2,$3,$4,$5)',[id(resolve[1]),d,solution,solution==='reposicion'?text(b.codigo,'Código nuevo',80):null,amount]);
      return {resuelta:true};
    }
    if(method==='POST' && p==='/api/anulaciones') {
      await q('CALL biblioteca.sp_anular_prestamo($1,$2,$3,$4,$5)',[
        id(b.prestamo_id),text(b.motivo,'Motivo',1000),d,text(b.operador,'Operador',120,false),text(b.observaciones,'Observaciones',1000,false)]);
      return {anulado:true};
    }
    throw new InputError('Ruta no encontrada.',404);
  }

  const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
  const server=http.createServer(async(req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const port=server.address()?.port;
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)) throw new InputError('Host no autorizado.',403);
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(req.headers.origin && req.headers.origin!==url.origin) throw new InputError('Origen no autorizado.',403);
      if(req.headers['sec-fetch-site']==='cross-site') throw new InputError('Solicitud externa no autorizada.',403);
      if(!url.pathname.startsWith('/api/')) {
        const asset=assets[url.pathname];
        if(!asset || req.method!=='GET') throw new InputError('Página no encontrada.',404);
        const data=await readFile(path.join(root,'web',asset[0]));
        res.writeHead(200,{'Content-Type':asset[1]}); res.end(data); return;
      }
      let input={};
      if(req.method!=='GET') {
        if(!['POST','PATCH'].includes(req.method)) throw new InputError('Método no permitido.',405);
        if(req.headers['x-biblioteca-request']!=='1' || !req.headers['content-type']?.startsWith('application/json')) throw new InputError('Solicitud de formulario no válida.',403);
        input=await body(req);
      }
      const data=await exclusive(()=>api(req.method,url,input));
      json(req.method==='POST'?201:200,data);
    } catch(error) { const problem=friendly(error); json(problem.status,{error:problem.message}); }
  });
  server.requestTimeout=15000;
  return server;
}

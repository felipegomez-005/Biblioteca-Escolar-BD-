import {createHash} from 'node:crypto';
import {CatalogError,isbnVariants,normalizeIsbn} from './google-books.mjs';

const rows=async(db,sql,args=[])=>(await db.query(sql,args)).rows;
export async function readBook(db,id) {
  const [book]=await rows(db,`SELECT l.*,e.nombre AS editorial,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'nombre',a.nombre) ORDER BY a.nombre,a.id)
      FROM biblioteca.libro_autor la JOIN biblioteca.autor a ON a.id=la.autor_id WHERE la.libro_id=l.id),'[]') AS autores_detalle,
    coalesce((SELECT jsonb_agg(g.nombre ORDER BY g.nombre) FROM biblioteca.libro_genero lg
      JOIN biblioteca.genero g ON g.id=lg.genero_id WHERE lg.libro_id=l.id),'[]') AS generos_detalle
    FROM biblioteca.libro l LEFT JOIN biblioteca.editorial e ON e.id=l.editorial_id WHERE l.id=$1`,[id]);
  if(!book)throw new CatalogError('Libro no encontrado.',404);
  return {...book,version:createHash('sha256').update(JSON.stringify(book)).digest('hex')};
}

export async function editBook(db,id,data) {
  return db.transaction(async tx=>{
    await tx.query('SELECT biblioteca.bloquear_operaciones()');
    const before=await readBook(tx,id);
    if(before.version!==data.version)throw new CatalogError('El libro cambió desde que abrió el formulario. Ciérrelo y vuelva a abrir Editar para revisar los datos actuales.',409);
    if(data.isbn && (await rows(tx,'SELECT id FROM biblioteca.libro WHERE isbn=ANY($1::text[]) AND id<>$2',[isbnVariants(data.isbn),id])).length)
      throw new CatalogError('Este ISBN corresponde a otro libro del catálogo. Revise la edición; no se fusionaron los registros.',409);
    let publisher=null;
    if(data.editorial)publisher=(await rows(tx,'INSERT INTO biblioteca.editorial(nombre) VALUES($1) ON CONFLICT(nombre) DO UPDATE SET nombre=excluded.nombre RETURNING id',[data.editorial]))[0].id;
    let oldIsbn;
    try {oldIsbn=normalizeIsbn(before.isbn,{optional:true});}catch {oldIsbn=before.isbn;}
    // Cambiar la edición identificada invalida su vínculo anterior a Google Books.
    const sameEdition=oldIsbn===data.isbn;
    await tx.query(`UPDATE biblioteca.libro SET titulo=$1,isbn=$2,editorial_id=$3,anio_publicacion=$4,
      origen_datos=$5,google_books_id=$6 WHERE id=$7`,[data.titulo,data.isbn,publisher,data.anio_publicacion,
      sameEdition?before.origen_datos:'manual',sameEdition?before.google_books_id:null,id]);
    await tx.query('DELETE FROM biblioteca.libro_autor WHERE libro_id=$1',[id]);
    for(const name of new Set(data.autores)) {
      let authors=before.autores_detalle.filter(a=>a.nombre===name);
      if(!authors.length)authors=await rows(tx,'SELECT id FROM biblioteca.autor WHERE nombre=$1 ORDER BY id LIMIT 1',[name]);
      if(!authors.length)authors=await rows(tx,'INSERT INTO biblioteca.autor(nombre) VALUES($1) RETURNING id',[name]);
      for(const author of authors)await tx.query('INSERT INTO biblioteca.libro_autor VALUES($1,$2)',[id,author.id]);
    }
    await tx.query('DELETE FROM biblioteca.libro_genero WHERE libro_id=$1',[id]);
    for(const name of new Set(data.generos)) {
      const [genre]=await rows(tx,'INSERT INTO biblioteca.genero(nombre) VALUES($1) ON CONFLICT(nombre) DO UPDATE SET nombre=excluded.nombre RETURNING id',[name]);
      await tx.query('INSERT INTO biblioteca.libro_genero VALUES($1,$2)',[id,genre.id]);
    }
    return readBook(tx,id);
  });
}

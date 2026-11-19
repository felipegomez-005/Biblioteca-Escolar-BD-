import { randomUUID } from 'node:crypto';

export class CatalogError extends Error {
  constructor(message,status=400) { super(message); this.status=status; }
}

// ISBN-10 y su equivalente ISBN-13 representan la misma edición.
export function normalizeIsbn(value,{optional=false}={}) {
  if(optional && (value==null || value==='')) return null;
  if(typeof value!=='string' || value.length>40) throw new CatalogError('Ingrese un ISBN de 10 o 13 caracteres.');
  let isbn=value.replace(/[\s-]/g,'').toUpperCase();
  if(!isbn && optional) return null;
  if(/^\d{9}[\dX]$/.test(isbn)) {
    const sum=[...isbn].reduce((n,c,i)=>n+(c==='X'?10:Number(c))*(10-i),0);
    if(sum%11) throw new CatalogError('El dígito verificador del ISBN no es válido. Revise el número.');
    isbn='978'+isbn.slice(0,9);
    isbn+=String((10-[...isbn].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10)%10);
  }
  if(!/^97[89]\d{10}$/.test(isbn)) throw new CatalogError('Ingrese un ISBN válido de 10 o 13 caracteres; puede incluir guiones.');
  if([...isbn].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0)%10) throw new CatalogError('El dígito verificador del ISBN no es válido. Revise el número.');
  return isbn;
}

export function isbnVariants(isbn) {
  if(!isbn?.startsWith('978')) return isbn?[isbn]:[];
  const stem=isbn.slice(3,12);
  const digit=(11-[...stem].reduce((n,c,i)=>n+Number(c)*(10-i),0)%11)%11;
  return [isbn,stem+(digit===10?'X':digit)];
}

const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const names=(value,max)=>Array.isArray(value)?[...new Set(value.filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean))].join('; ').slice(0,max):'';

export function createGoogleBooks({apiKey=process.env.GOOGLE_BOOKS_API_KEY||'',fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=8000}={}) {
  const previews=new Map();
  function prune() {
    for(const [token,entry] of previews) if(entry.expires<=now()) previews.delete(token);
    while(previews.size>=100) previews.delete(previews.keys().next().value);
  }
  return {
    async lookup(isbn) {
      isbn=normalizeIsbn(isbn);
      if(!apiKey.trim()) throw new CatalogError('Falta configurar la clave de Google Books. Consulte docs/google-books.md. Puede registrar el libro manualmente.',503);
      const url=new URL('https://www.googleapis.com/books/v1/volumes');
      url.searchParams.set('q','isbn:'+isbn);
      url.searchParams.set('maxResults','5');
      url.searchParams.set('key',apiKey);
      let data;
      try {
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
        if(response.status===429) throw new CatalogError('Google Books agotó su cuota de consultas. Intente más tarde o ingrese los datos manualmente.',503);
        if([401,403].includes(response.status)) throw new CatalogError('Google Books rechazó la clave o sus permisos. Revise su configuración; el ingreso manual sigue disponible.',503);
        if(!response.ok) throw new CatalogError('Google Books no está disponible en este momento. Puede registrar el libro manualmente.',502);
        data=await response.json();
        if(!data || typeof data!=='object' || (data.items!==undefined && !Array.isArray(data.items))) throw new Error('Respuesta inválida');
      } catch(error) {
        if(error instanceof CatalogError) throw error;
        throw new CatalogError('No se pudo consultar Google Books. Compruebe la conexión o complete el libro manualmente.',502);
      }
      prune();
      const results=[];
      for(const item of (data.items||[]).slice(0,5)) {
        const info=item?.volumeInfo;
        if(!info || !Array.isArray(info.industryIdentifiers)) continue;
        const matches=info.industryIdentifiers.some(x=>{
          if(!['ISBN_10','ISBN_13'].includes(x?.type)) return false;
          try { return normalizeIsbn(x.identifier)===isbn; } catch {return false;}
        });
        const gid=clean(item.id,150),title=clean(info.title,250);
        if(!matches || !gid || !title || results.some(x=>x.google_books_id===gid)) continue;
        const publication=/^(\d{4})(?:-|$)/.exec(clean(info.publishedDate,30));
        const preview={consulta_id:randomUUID(),google_books_id:gid,isbn,titulo:title,
          autores:names(info.authors,1000),editorial:clean(info.publisher,150),
          generos:names(info.categories,500),anio_publicacion:publication&&Number(publication[1])>0?Number(publication[1]):null,
          origen_datos:'google_books'};
        previews.set(preview.consulta_id,{isbn,google_books_id:gid,expires:now()+30*60*1000});
        results.push(preview);
      }
      return results;
    },
    validatePreview(token,isbn,googleId) {
      const saved=previews.get(token);
      if(!saved || saved.expires<=now() || saved.isbn!==isbn || saved.google_books_id!==googleId)
        throw new CatalogError('La consulta de Google Books cambió o venció. Busque nuevamente el ISBN antes de guardar.',409);
    }
  };
}

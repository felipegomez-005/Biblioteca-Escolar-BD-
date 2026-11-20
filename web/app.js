const $=(s,scope=document)=>scope.querySelector(s);
const $$=(s,scope=document)=>[...scope.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(String(d).slice(0,10)+'T12:00:00Z')):'—';
const types={estudiante:'Estudiante',docente:'Docente',asistente:'Asistente'};
const reasons={usuario_inactivo:'Usuario inactivo',ejemplar_atrasado:'Tiene ejemplares atrasados',sancion_por_atraso:'Sanción por atraso vigente',conducta_grave:'Sanción por conducta grave vigente',reposicion_o_reembolso_pendiente:'Reposición o reembolso pendiente'};
let context,routeVersion=0,modalBusy=false,toastTimer,selectedUser=null,detailRequest=0,session=null;
const roles={admin:'Administración',bibliotecaria:'Bibliotecaria',consulta:'Consulta'};
const fmtTime=d=>d?new Intl.DateTimeFormat('es-CL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(d)):'—';
const main=$('#contenido'),dialog=$('#modal');

async function api(url,options={}) {
  let response;
  try {response=await fetch('/api'+url,{...options,headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1',...options.headers}});}
  catch {throw new Error('No hay conexión con la aplicación. Compruebe que la terminal siga ejecutando npm.cmd start.');}
  const result=await response.json().catch(()=>({}));
  if(response.status===401 && !url.startsWith('/sesion')) {showAuth();throw new Error('Tu sesión terminó. Inicia sesión nuevamente.');}
  if(!response.ok) throw new Error(result.error||'No se pudo completar la operación.');
  return result;
}
const post=(url,data,method='POST')=>api(url,{method,body:JSON.stringify(data)});
function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function empty(title,description='') {return `<div class="empty"><strong>${esc(title)}</strong>${esc(description)}</div>`;}
function heading(title,subtitle,buttons='') {return `<div class="page-head"><div><p class="eyebrow">BIBLIOTECA · COLEGIO SIGLO XXI DE LAMPA</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${buttons}</div>`;}
function search(placeholder,id='search') {return `<div class="search"><input id="${id}" type="search" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off"></div>`;}
function field(name,label,content,full=false) {return `<div class="field ${full?'full':''}"><label for="${name}">${label}</label>${content}</div>`;}
function input(name,label,value='',{required=true,type='text',max=150,help='',full=false}={}) {
  return field(name,label,`<input id="${name}" name="${name}" type="${type}" value="${esc(value)}" maxlength="${max}" ${required?'required':''}>${help?`<small>${help}</small>`:''}`,full);
}
function select(name,label,options) {return field(name,label,`<select id="${name}" name="${name}" required>${options}</select>`);}
function actions(label) {return `<div class="form-error" role="alert"></div><div class="dialog-foot"><button class="button secondary" type="button" data-close>Cancelar</button><button class="button" type="submit">${label}</button></div>`;}
function showModal(title,content,submit) {
  ++detailRequest;
  $('#modal-title').textContent=title;$('#modal-body').innerHTML=content;
  $$('[data-close]',dialog).forEach(b=>b.onclick=()=>{if(!modalBusy)dialog.close();});
  const form=$('form',dialog);
  if(form && submit) form.onsubmit=async event=>{
    event.preventDefault();if(modalBusy)return;
    const error=$('.form-error',form);error.textContent='';
    const button=$('button[type=submit]',form);const old=button.textContent;
    modalBusy=true;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Guardando…';
    try {await submit(Object.fromEntries(new FormData(form)),form);dialog.close();}
    catch(e){error.textContent=e.message;error.scrollIntoView({block:'nearest'});}
    finally {modalBusy=false;button.disabled=false;button.removeAttribute('aria-busy');button.textContent=old;}
  };
  if(!dialog.open)dialog.showModal();
}
$('#close-modal').onclick=()=>{if(!modalBusy)dialog.close();};
dialog.addEventListener('close',()=>{++detailRequest;});
dialog.addEventListener('cancel',e=>{if(modalBusy)e.preventDefault();});
function watchSearch(fn,id='search') {let timer;$('#'+id).oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>fn(e.target.value),180);};}
function filterRows(rows,term,keys) {const t=term.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'');return rows.filter(r=>keys.map(k=>r[k]||'').join(' ').toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'').includes(t));}
function booksCell(book) {return `<div class="book-cell"><span class="book-tile tone${book.id%3}" aria-hidden="true">${esc(book.titulo[0])}</span><div><strong>${esc(book.titulo)}</strong><small>${esc(book.autores||'Autor sin registrar')}</small></div></div>`;}
async function loadContext(){context=await api('/contexto');$('#today').textContent=fmt(context.fecha);}

async function home(version) {
  const [stats,pending]=await Promise.all([api('/resumen'),api('/pendientes')]);if(version!==routeVersion)return;
  main.innerHTML=heading('Un buen día para leer.','Todo lo que necesitas para acompañar el movimiento de la biblioteca.',`<a class="button" href="#prestamos">＋ Nuevo préstamo</a>`)+
    `<div class="metrics">${[['Libros en el catálogo',stats.libros,'Ediciones registradas'],['Ejemplares disponibles',stats.disponibles,'Listos para prestar'],['Ejemplares pendientes',stats.en_prestamo,'Préstamos e incidencias abiertos'],['Usuarios activos',stats.usuarios,'Comunidad de la biblioteca']].map(([l,n,f])=>`<div class="card metric"><div class="metric-label">${l}</div><div class="metric-value number">${n}</div><p class="metric-foot">${f}</p></div>`).join('')}</div>
    <div class="two-columns"><section class="card"><div class="card-head"><h2>Atención de hoy</h2><span class="badge ${stats.atrasados?'warn':'neutral'}">${stats.atrasados} atrasados</span></div>
      ${!context.calendario?'<div class="notice danger">Falta configurar el calendario de hoy. Las operaciones de circulación no están disponibles.</div>':!context.calendario.abierto?'<div class="notice warn">Hoy la biblioteca está cerrada según el calendario de prueba. Puedes consultar el catálogo y registrar usuarios.</div>':!context.calendario.permite_prestamo?'<div class="notice warn">Hoy se reciben devoluciones, pero no se permiten nuevos préstamos.</div>':''}
      ${pending.length?`<p class="help">Estos ejemplares requieren seguimiento.</p><div class="table-wrap"><table><thead><tr><th>Usuario / libro</th><th>Estado</th></tr></thead><tbody>${pending.slice(0,4).map(x=>`<tr><td><strong>${esc(x.nombre)}</strong><small>${esc(x.titulo)} · ${esc(x.codigo)}</small></td><td><span class="badge ${x.incidencia?'neutral':'warn'}">${x.incidencia?'Incidencia':x.dias_atraso+' días de atraso'}</span></td></tr>`).join('')}</tbody></table></div><p class="mini-note"><a href="#pendientes" class="text-button">Ver todos los pendientes →</a></p>`:empty('Todo al día','No hay devoluciones atrasadas ni incidencias pendientes.')}
    </section><section class="card"><div class="card-head"><h2>Accesos rápidos</h2></div>
      ${[['prestamos','↗','Registrar un préstamo','Selecciona al usuario y sus ejemplares.'],['devoluciones','↙','Recibir o renovar libros','Gestiona cada copia por separado.'],['catalogo','▤','Ampliar el catálogo','Agrega un libro o una nueva copia.']].map(([r,i,t,s])=>`<a class="quick-action" href="#${r}"><span class="quick-icon" aria-hidden="true">${i}</span><div><strong>${t}</strong><small>${s}</small></div><span class="arrow" aria-hidden="true">→</span></a>`).join('')}
      <hr class="divider"><p class="help">Cada movimiento conserva su historial. Una devolución parcial mantiene pendientes los demás ejemplares.</p></section></div>`;
}

async function catalog(version) {
  const books=await api('/libros');if(version!==routeVersion)return;
  main.innerHTML=heading('Catálogo','Libros, autores y cada una de sus copias físicas.',`<button class="button" id="add-book">＋ Registrar libro</button>`)+
    `<div class="toolbar">${search('Buscar por título, autor o ISBN')}<span class="count" id="result-count"></span></div><div id="book-results"></div>`;
  const render=term=>{
    const list=filterRows(books,term,['titulo','autores','isbn']);$('#result-count').textContent=`${list.length} libros`;
    $('#book-results').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Libro / autor</th><th>Editorial</th><th>ISBN</th><th>Disponibilidad</th><th></th></tr></thead><tbody>${list.map(b=>`<tr><td>${booksCell(b)}</td><td>${esc(b.editorial||'Sin registrar')}</td><td><small>${esc(b.isbn||'Sin ISBN')}</small></td><td><span class="badge ${b.disponibles?'':'neutral'}">${b.disponibles} de ${b.copias} disponibles</span></td><td><div class="actions"><button class="text-button" data-edit-book="${b.id}">Editar</button><button class="text-button" data-copies="${b.id}">Ver copias →</button></div></td></tr>`).join('')}</tbody></table></div>`:empty('No encontramos libros','Prueba con otro título o registra el primer libro.');
    $$('[data-copies]').forEach(button=>button.onclick=()=>viewCopies(books.find(b=>b.id===Number(button.dataset.copies))));
    $$('[data-edit-book]').forEach(button=>button.onclick=()=>editBookForm(Number(button.dataset.editBook)));
  };render('');watchSearch(render);$('#add-book').onclick=addBook;
}
function addBook() {
  let source=null;
  showModal('Registrar libro',`<form><p class="help">Registra la edición una sola vez. Busca su ISBN para completar los datos o ingrésalos manualmente.</p>
    <section class="isbn-lookup" aria-label="Búsqueda por ISBN">
      ${input('isbn','ISBN (opcional)','',{required:false,max:40,help:'Acepta ISBN de 10 o 13 caracteres, con o sin guiones.'})}
      <button class="button secondary" type="button" id="lookup-isbn">Buscar en Google Books</button>
      <div id="isbn-status" class="help" role="status" aria-live="polite"></div><div id="isbn-results"></div>
    </section><p class="help" id="book-source">Origen de los datos: ingreso manual.</p><button type="button" class="text-button" id="use-manual" hidden>Continuar con ingreso manual</button><div class="fields">
    ${input('titulo','Título','',{full:true,max:250})}${input('autores','Autor o autores','',{required:false,full:true,max:1000,help:'Si hay varios, sepáralos con punto y coma (;).'})}
    ${input('editorial','Editorial (opcional)','',{required:false})}
    ${input('anio_publicacion','Año de publicación (opcional)','',{required:false,type:'number'})}${input('generos','Género (opcional)','',{required:false,max:500})}
    ${input('codigo','Código de la primera copia (opcional)','',{required:false,full:true,max:80,help:'Debe identificar un único ejemplar físico. Puedes añadir las copias más adelante.'})}</div>${actions('Guardar libro')}</form>`,async data=>{
      await post('/libros',{...data,origen_datos:source?'google_books':'manual',...(source?{google_books_id:source.google_books_id,consulta_id:source.consulta_id}:{})});
      toast('Libro registrado en el catálogo.');await renderRoute();
    });
  const form=$('form',dialog),isbnField=$('#isbn',form),lookup=$('#lookup-isbn',form),status=$('#isbn-status',form),results=$('#isbn-results',form),sourceLabel=$('#book-source',form),save=$('button[type=submit]',form);
  const manual=$('#use-manual',form);
  manual.onclick=()=>{source=null;manual.hidden=true;sourceLabel.textContent='Origen de los datos: ingreso manual. Revisa la información antes de guardar.';};
  let sequence=0,requestController;
  isbnField.oninput=()=>{
    sequence++;requestController?.abort();source=null;manual.hidden=true;results.innerHTML='';status.textContent='';
    sourceLabel.textContent='Origen de los datos: ingreso manual. Si cambiaste el ISBN, revisa también el título y los demás campos.';
    lookup.disabled=false;lookup.textContent='Buscar en Google Books';save.disabled=false;
  };
  lookup.onclick=async()=>{
    const key=++sequence;requestController?.abort();requestController=new AbortController();
    lookup.disabled=true;save.disabled=true;lookup.textContent='Buscando…';results.innerHTML='';
    status.textContent='Consultando el ISBN. Los datos no se guardarán hasta que confirmes el formulario.';
    try {
      const response=await api('/libros/isbn?isbn='+encodeURIComponent(isbnField.value),{signal:requestController.signal});
      if(key!==sequence || !form.isConnected || !dialog.open)return;
      if(response.existente) {
        status.textContent='Este ISBN ya existe en el catálogo. Puedes agregar una copia a ese libro.';
        results.innerHTML=`<button type="button" class="text-button" id="existing-book">Ver copias de ${esc(response.existente.titulo)} →</button>`;
        $('#existing-book',form).onclick=()=>viewCopies(response.existente);return;
      }
      if(!response.resultados.length) {
        status.textContent='No se encontró una edición con ese ISBN exacto. Puedes completar los datos manualmente.';return;
      }
      status.textContent='Selecciona el resultado correspondiente y revisa sus datos antes de guardar.';
      results.innerHTML=response.resultados.map((book,index)=>`<article class="isbn-result"><strong>${esc(book.titulo)}</strong><p class="help">${esc(book.autores||'Autores sin información')}<br>${esc(book.editorial||'Editorial sin información')} · ${esc(book.anio_publicacion||'Año sin información')}</p><button class="button small secondary" type="button" data-result="${index}">Usar estos datos</button></article>`).join('');
      $$('[data-result]',results).forEach(button=>button.onclick=()=>{
        source=response.resultados[Number(button.dataset.result)];
        manual.hidden=false;
        for(const name of ['isbn','titulo','autores','editorial','anio_publicacion','generos']) form.elements[name].value=source[name]??'';
        sourceLabel.textContent='Origen de los datos: Google Books. Revisa y corrige la información; los campos sin datos se completan manualmente.';
        status.textContent='Datos cargados en el formulario. Todavía no se han guardado.';
        results.innerHTML='';form.elements.titulo.focus();
      });
    } catch(error) {
      if(key===sequence && form.isConnected && dialog.open)status.textContent=error.message;
    } finally {
      if(key===sequence && form.isConnected){lookup.disabled=false;save.disabled=false;lookup.textContent='Buscar en Google Books';}
    }
  };
}
async function editBookForm(id) {
  const key=++detailRequest,version=routeVersion;
  try {
    const book=await api('/libros/'+id);if(key!==detailRequest || version!==routeVersion)return;
    showModal('Editar libro',`<form><p class="help">Corrige los datos de esta edición. Sus copias y movimientos conservarán sus identificadores. Para registrar otra edición, utiliza Registrar libro.</p>
      <div class="fields">${input('titulo','Título',book.titulo,{max:250,full:true})}
      ${input('isbn','ISBN (opcional)',book.isbn||'',{required:false,max:40,full:true})}
      ${input('autores','Autor o autores',book.autores_detalle.map(a=>a.nombre).join('; '),{required:false,max:1000,full:true,help:'Separa los nombres con punto y coma (;).'})}
      ${input('editorial','Editorial (opcional)',book.editorial||'',{required:false})}
      ${input('anio_publicacion','Año de publicación (opcional)',book.anio_publicacion||'',{required:false,type:'number'})}
      ${input('generos','Géneros (opcional)',book.generos_detalle.join('; '),{required:false,max:500,full:true,help:'Separa los géneros con punto y coma (;).'})}</div>
      <p class="help">${book.origen_datos==='google_books'?'El registro proviene de Google Books. Si cambias el ISBN por otro, se quitará ese vínculo y quedará como ingreso manual.':'Origen de los datos: ingreso manual.'}</p>
      ${actions('Guardar cambios')}</form>`,async data=>{
        await post('/libros/'+id,{...data,version:book.version},'PATCH');toast('Datos del libro actualizados.');await renderRoute();
      });
  }catch(error){toast(error.message);}
}
async function viewCopies(book) {
  const key=++detailRequest,version=routeVersion;
  try {
    const copies=await api('/ejemplares?libro='+book.id);
    if(key!==detailRequest || version!==routeVersion)return;
    showModal(book.titulo,`<p class="help">${esc(book.autores||'Autor sin registrar')} · ${esc(book.editorial||'Editorial sin registrar')}</p>
      <p class="help">Origen de los datos: ${book.origen_datos==='google_books'?'Google Books (revisados al registrar)':'ingreso manual'}.</p>
      ${copies.length?`<div class="table-wrap"><table><thead><tr><th>Código</th><th>Condición</th><th>Disponibilidad</th><th></th></tr></thead><tbody>${copies.map(c=>`<tr><td>${esc(c.codigo)}</td><td>${esc(c.condicion)}</td><td><span class="badge ${c.disponible?'':'neutral'}">${c.disponible?'Disponible':'No disponible'}</span></td><td><button class="text-button" data-copy-history="${c.ejemplar_id}">Historial</button></td></tr>`).join('')}</tbody></table></div>`:empty('Sin copias registradas')}
      <div class="dialog-foot"><button class="button" id="add-copy">＋ Agregar copia</button></div>`);
    $('#add-copy').onclick=()=>addCopy(book);
    $$('[data-copy-history]',dialog).forEach(b=>b.onclick=()=>historyModal('ejemplares',Number(b.dataset.copyHistory)));
  }catch(e){toast(e.message);}
}
function addCopy(book) {
  showModal('Agregar copia',`<form><div class="notice"><strong>${esc(book.titulo)}</strong>La información del libro se comparte; el código identifica esta nueva copia.</div>
    ${input('codigo','Código único de ejemplar','',{max:80})}${select('condicion','Condición','<option value="bueno">Bueno</option><option value="desgastado">Desgastado, apto para préstamo</option>')}
    ${field('observaciones','Observaciones (opcional)','<textarea id="observaciones" name="observaciones" maxlength="1000"></textarea>')}${actions('Guardar copia')}</form>`,async data=>{await post('/ejemplares',{...data,libro_id:book.id});toast('Nueva copia registrada.');await renderRoute();});
}

async function usersPage(version) {
  const users=await api('/usuarios');if(version!==routeVersion)return;
  main.innerHTML=heading('Usuarios','Estudiantes, docentes y asistentes de la comunidad escolar.',`<div class="actions"><button class="button secondary" id="add-course">Nuevo curso</button><button class="button" id="add-user">＋ Registrar usuario</button></div>`)+
    `<div class="toolbar">${search('Buscar por nombre o identificación')}<span class="count" id="result-count"></span></div><div id="user-results"></div>`;
  const render=term=>{
    const list=filterRows(users,term,['nombre','identificador']);$('#result-count').textContent=`${list.length} usuarios`;
    $('#user-results').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Tipo / curso</th><th>Correo</th><th>Pendientes</th><th></th></tr></thead><tbody>${list.map(u=>`<tr><td><strong>${esc(u.nombre)}</strong><small>${esc(u.identificador)}${u.activo?'':' · Inactivo'}</small>${u.sancion_hasta?`<small class="sanction-label">Conducta grave: bloqueo hasta ${fmt(u.sancion_hasta)}</small>`:''}</td><td>${types[u.tipo]}<small>${esc(u.curso?u.curso+' · '+u.anio_escolar:u.cargo||'')}</small></td><td>${esc(u.correo||'Sin registrar')}</td><td><span class="badge ${u.pendientes?'warn':'neutral'}">${u.pendientes} ejemplares</span></td><td><div class="actions"><button class="text-button" data-user="${u.id}">Editar</button><button class="text-button" data-sanctions="${u.id}">Sanciones</button><button class="text-button" data-user-history="${u.id}">Historial</button></div></td></tr>`).join('')}</tbody></table></div>`:empty('No encontramos usuarios','Revisa la búsqueda o registra una nueva persona.');
    $$('[data-user]').forEach(btn=>btn.onclick=()=>userForm(users.find(u=>u.id===Number(btn.dataset.user))));
    $$('[data-sanctions]').forEach(btn=>btn.onclick=()=>sanctionsModal(Number(btn.dataset.sanctions)));
    $$('[data-user-history]').forEach(btn=>btn.onclick=()=>historyModal('usuarios',Number(btn.dataset.userHistory)));
  };render('');watchSearch(render);$('#add-user').onclick=()=>userForm();$('#add-course').onclick=courseForm;
}
async function historyModal(type,id) {
  const key=++detailRequest,version=routeVersion;
  try {
    const info=await api('/'+type+'/'+id+'/historial');
    if(key!==detailRequest || version!==routeVersion)return;
    const isUser=type==='usuarios';
    showModal(isUser?'Historial del usuario':'Historial del ejemplar',`
      <div class="notice"><strong>${esc(isUser?info.sujeto.nombre:info.sujeto.titulo)}</strong>${esc(isUser?info.sujeto.identificador:info.sujeto.codigo)}</div>
      <p class="help">Movimientos por ejemplar, del préstamo más reciente al más antiguo. Los títulos y nombres corresponden al catálogo y usuarios actuales; el curso corresponde al momento del préstamo.</p>
      ${info.movimientos.length?info.movimientos.map(m=>{
        const i=m.incidencia,d=m.devolucion;
        const status=d?'Devuelto':i?(i.fecha_resolucion?'Incidencia resuelta':'Incidencia pendiente'):'Préstamo abierto';
        return `<details class="history-entry"><summary><strong>Préstamo Nº ${m.prestamo_id} · ${esc(m.codigo)}</strong><br>${esc(isUser?m.titulo:m.nombre)} · ${fmt(m.fecha)}<br><span class="badge ${m.fecha_cierre?'neutral':'warn'}">${status}</span></summary>
          <p class="help">${esc(m.nombre)} · ${esc(m.identificador)}<br>${esc(m.titulo)}<br>Curso al prestar: ${esc(m.curso_al_prestar?m.curso_al_prestar+' · '+m.anio_escolar:'No corresponde')}</p>
          <p>Préstamo: ${fmt(m.fecha)}<br>Vencimiento inicial: ${fmt(m.vencimiento_inicial)}<br>Último vencimiento: ${fmt(m.vencimiento_vigente)}</p>
          ${m.renovaciones.length?`<p><strong>Renovaciones</strong></p><ul>${m.renovaciones.map(r=>`<li>${fmt(r.fecha)}: del ${fmt(r.vencimiento_anterior)} al ${fmt(r.nuevo_vencimiento)}</li>`).join('')}</ul>`:'<p class="help">Sin renovaciones.</p>'}
          ${d?`<p><strong>Devolución Nº ${d.id}</strong><br>${fmt(d.fecha)} · ${d.condicion==='desgastado'?'Desgastado':'Bueno'}<br>${esc(d.observaciones||'Sin observaciones')}</p>`:''}
          ${i?`<p><strong>${i.tipo==='perdida'?'Pérdida':'Daño permanente'}</strong><br>${fmt(i.fecha)} · ${esc(i.observaciones||'Sin observaciones')}</p>
            ${i.fecha_resolucion?`<p>Resuelta el ${fmt(i.fecha_resolucion)} por ${i.solucion==='reposicion'?`reposición: ${esc(i.codigo_reemplazo)}`:`reembolso: ${esc(i.monto_reembolso)} CLP`}.</p>`:'<p class="help">Reposición o reembolso pendiente.</p>'}`:''}
          ${!d && !i && (!session || session.rol==='admin') ? `<div class="actions"><button class="text-button" data-anular="${m.prestamo_id}">Anular préstamo</button></div>` : ''}
        </details>`;
      }).join(''):empty('Sin movimientos registrados')}
      ${isUser?'<p class="help">Las sanciones por conducta grave se consultan desde el botón Sanciones de este usuario.</p>':''}`);
    $$('[data-anular]',dialog).forEach(b=>b.onclick=()=>anularForm(Number(b.dataset.anular)));
  }catch(error){toast(error.message);}
}
function anularForm(prestamoId) {
  showModal('Anular préstamo',`<form>
    <div class="notice warn"><strong>Préstamo Nº ${prestamoId}</strong>Se cerrarán todos los ejemplares abiertos de este préstamo y se registrará el motivo. El historial se conserva.</div>
    ${field('motivo','Motivo de la anulación','<textarea id="motivo" name="motivo" maxlength="1000" required></textarea>',true)}
    ${field('observaciones','Observaciones (opcional)','<textarea id="observaciones" name="observaciones" maxlength="1000"></textarea>',true)}
    ${session?`<p class="help">La anulación quedará registrada a nombre de ${esc(session.nombre)} (${esc(session.usuario)}).</p>`:''}
    ${actions('Anular préstamo')}</form>`,async data=>{
      await post('/anulaciones',{prestamo_id:prestamoId,motivo:data.motivo,observaciones:data.observaciones});
      toast('Préstamo anulado. El historial conserva la corrección.');
      await renderRoute();
    });
}
async function sanctionsModal(uid) {
  const key=++detailRequest,version=routeVersion;
  try {
    const info=await api('/usuarios/'+uid+'/sanciones');if(version!==routeVersion || key!==detailRequest)return;
    showModal('Sanciones por conducta grave',`<p><strong>${esc(info.usuario.nombre)}</strong><br><span class="help">${esc(info.usuario.identificador)}</span></p>
      <p class="help">Aquí se registran decisiones ya comunicadas por el colegio. Los atrasos y las incidencias generan otros bloqueos independientes.</p>
      ${info.sanciones.length?`<div class="table-wrap"><table><thead><tr><th>Inicio</th><th>Habilitado desde</th><th>Estado / motivo</th></tr></thead><tbody>${info.sanciones.map(s=>`<tr><td>${fmt(s.inicio)}</td><td>${fmt(s.habilitado_desde)}</td><td><span class="badge ${s.estado==='vigente'?'warn':'neutral'}">${({vigente:'Vigente',finalizada:'Finalizada',programada:'Programada'})[s.estado]}</span><small>${esc(s.observaciones||'Sin observaciones')}</small></td></tr>`).join('')}</tbody></table></div>`:empty('Sin sanciones por conducta grave')}
      ${info.impedimento?`<div class="notice warn">No se puede registrar una sanción hoy: ${esc(info.impedimento)}.</div>`:''}
      <div class="dialog-foot"><button class="button" type="button" id="new-sanction" ${info.puede_registrar?'':'disabled'}>Registrar sanción</button></div>`);
    $('#new-sanction').onclick=()=>sanctionForm(info);
  } catch(error) {toast(error.message);}
}
function sanctionForm(info) {
  const active=info.sanciones.filter(s=>s.estado==='vigente');
  showModal('Registrar sanción por conducta grave',`<form>
    <div class="notice"><strong>${esc(info.usuario.nombre)}</strong>${esc(info.usuario.identificador)}</div>
    <div class="summary-line"><span>Inicio del bloqueo</span><strong>${fmt(info.inicio)}</strong></div>
    <div class="summary-line"><span>Esta sanción termina el</span><strong>${fmt(info.habilitado_desde)}</strong></div>
    <p class="help">Dos semanas desde hoy. Los feriados internos cuentan; si el término cae en un día cerrado, se desplaza al siguiente día de atención.</p>
    ${active.length?'<div class="notice warn">Esta persona ya tiene una sanción vigente. Registra otra solamente si corresponde a una nueva decisión del colegio.</div>':''}
    ${field('observaciones','Motivo de la sanción','<textarea id="observaciones" name="observaciones" maxlength="1000" required placeholder="Describe brevemente la decisión comunicada por el colegio."></textarea>')}
    <p class="help">Se bloquearán los nuevos préstamos. Las devoluciones seguirán permitidas en días de atención. Al terminar esta sanción, los atrasos, incidencias y demás bloqueos seguirán aplicándose si están pendientes.</p>
    ${actions('Confirmar sanción')}</form>`,async data=>{
      const result=await post('/sanciones',{usuario_id:info.usuario.id,observaciones:data.observaciones,inicio_esperado:info.inicio,habilitado_desde_esperado:info.habilitado_desde});
      toast(result.repetida?'Esta sanción ya estaba registrada; se conservó un solo registro.':`Sanción registrada. Termina el ${fmt(result.habilitado_desde)}.`);
      await renderRoute();
    });
}
function courseForm() {
  showModal('Registrar curso',`<form><div class="fields">${input('nombre','Nombre del curso','',{max:80,help:'Por ejemplo: 3.º básico A.'})}${input('anio_escolar','Año escolar',context.fecha.slice(0,4),{type:'number'})}</div>${actions('Guardar curso')}</form>`,async data=>{await post('/cursos',data);await loadContext();toast('Curso registrado.');});
}
function userForm(user={}) {
  showModal(user.id?'Editar usuario':'Registrar usuario',`<form><div class="fields">
    ${input('nombre','Nombre completo',user.nombre||'',{full:true})}${input('identificador','Identificación',user.identificador||'',{max:60,help:'Usa un identificador ficticio en esta versión de prueba.'})}
    ${select('tipo','Tipo de usuario',Object.entries(types).map(([v,n])=>`<option value="${v}" ${user.tipo===v?'selected':''}>${n}</option>`).join(''))}
    ${input('correo','Correo electrónico',user.correo||'',{type:'email',max:254,full:true})}
    <div id="course-field">${select('curso_actual_id','Curso actual',`<option value="">Seleccionar curso</option>${context.cursos.map(c=>`<option value="${c.id}" ${user.curso_actual_id===c.id?'selected':''}>${esc(c.nombre)} · ${c.anio_escolar}</option>`).join('')}`)}</div>
    <div id="job-field">${input('cargo','Cargo (opcional)',user.cargo||'',{required:false})}</div>
    ${user.id?`<div class="field full"><label class="option"><input type="checkbox" name="activo" ${user.activo?'checked':''}> Usuario activo</label><small>Desactivar impide nuevos préstamos y conserva el historial.</small></div>`:''}</div>${actions('Guardar usuario')}</form>`,async(data,form)=>{
      if(user.id)data.activo=$('[name=activo]',form).checked;
      await post('/usuarios'+(user.id?'/'+user.id:''),data,user.id?'PATCH':'POST');toast(user.id?'Datos del usuario actualizados.':'Usuario registrado.');await renderRoute();
    });
  const sync=()=>{const student=$('#tipo').value==='estudiante';$('#course-field').hidden=!student;$('#curso_actual_id').required=student;$('#job-field').hidden=student;$('#correo').required=student;};
  $('#tipo').onchange=sync;sync();
}

function userOptions(users,current=selectedUser) {return `<option value="">Selecciona una persona</option>${users.map(u=>`<option value="${u.id}" ${current===u.id?'selected':''}>${esc(u.nombre)} · ${esc(u.identificador)}${u.activo?'':' (inactivo)'}</option>`).join('')}`;}
function userSelect(users) {
  return field('user-search','Buscar alumno o usuario','<input id="user-search" type="search" placeholder="Nombre o identificación" autocomplete="off" aria-controls="user-matches usuario"><small>Escribe parte del nombre o su identificación y selecciona el resultado.</small>')+
    '<div id="user-search-status" class="help" role="status" aria-live="polite"></div><div id="user-matches" class="user-matches" hidden></div>'+
    select('usuario','Usuario seleccionado',userOptions(users));
}
function bindUserSearch(users) {
  const input=$('#user-search'),picker=$('#usuario'),matches=$('#user-matches'),status=$('#user-search-status');
  input.oninput=()=>{
    const term=input.value.trim(),list=filterRows(users,term,['nombre','identificador']);
    // Buscar a otra persona invalida la selección y sus bloqueos consultados.
    picker.innerHTML=userOptions(list,null);picker.dispatchEvent(new Event('change'));
    status.textContent=term?(list.length?`${list.length} coincidencias${list.length>8?'. Afina la búsqueda o utiliza la lista inferior.':'. Selecciona una persona.'}`:'No hay usuarios que coincidan con la búsqueda.'):'';
    matches.hidden=!term || !list.length;
    matches.innerHTML=term?list.slice(0,8).map(u=>`<button type="button" class="user-match" data-match-user="${u.id}"><strong>${esc(u.nombre)}</strong><small>${esc(u.identificador)} · ${esc(types[u.tipo])}${u.activo?'':' · Inactivo'}</small></button>`).join(''):'';
    $$('[data-match-user]',matches).forEach(button=>button.onclick=()=>{
      picker.value=button.dataset.matchUser;picker.dispatchEvent(new Event('change'));picker.focus();
    });
  };
  picker.addEventListener('change',()=>{
    if(picker.value){matches.hidden=true;status.textContent='Usuario seleccionado: '+picker.selectedOptions[0].textContent;}
  });
}
function userNotice(info) {
  if(info.bloqueos.length)return `<div class="notice danger"><strong>Nuevos préstamos bloqueados</strong>${info.bloqueos.map(b=>esc(reasons[b.motivo]||b.motivo)).join('<br>')}${info.sanciones_conducta?.length?`<br>Último término de sanción por conducta: ${fmt(info.sanciones_conducta.at(-1).habilitado_desde)}.`:''}</div>`;
  return `<div class="notice"><strong>${esc(info.usuario.nombre)}</strong>${info.prestamos.length} de 3 ejemplares pendientes.</div>`;
}
async function loans(version) {
  const [users,copies]=await Promise.all([api('/usuarios'),api('/ejemplares?disponibles=1')]);if(version!==routeVersion)return;
  main.innerHTML=heading('Nuevo préstamo','Selecciona una persona y hasta tres ejemplares disponibles.')+
    `<div class="split"><section class="card"><p class="panel-step">01 / USUARIO</p>${userSelect(users)}<div id="user-info"></div><hr class="divider">
    <p class="panel-step">02 / EJEMPLARES</p>${search('Buscar libro o código de ejemplar','copy-search')}<div id="copy-options" class="selection-list"></div></section>
    <aside class="card sticky-card"><p class="panel-step">03 / CONFIRMACIÓN</p><h2>Resumen del préstamo</h2><div id="loan-summary"></div><div class="summary-line"><span>Fecha de préstamo</span><strong>${fmt(context.fecha)}</strong></div><div class="summary-line"><span>Devolución prevista</span><strong>${fmt(context.vencimiento)}</strong></div><hr class="divider">
    <p class="help">Tres días hábiles. Cada ejemplar puede devolverse o renovarse por separado.</p><div class="form-error" role="alert" id="loan-error"></div><button class="button wide" id="submit-loan" disabled>Registrar préstamo</button></aside></div>`;
  const selected=new Set();let info=null,loadingUser=false,sequence=0,saving=false;
  const update=()=>{
    const chosen=copies.filter(c=>selected.has(c.ejemplar_id));
    $('#loan-summary').innerHTML=chosen.length?`<ul class="selected-books">${chosen.map(c=>`<li>${esc(c.titulo)}<small class="help"> · ${esc(c.codigo)}</small></li>`).join('')}</ul>`:'<p class="help">Todavía no has seleccionado ejemplares.</p>';
    const available=info?Math.max(0,3-info.prestamos.length):0;
    $('#submit-loan').disabled=saving||loadingUser||!info||info.bloqueos.length>0||selected.size===0||selected.size>available||!context.vencimiento||!context.calendario?.permite_prestamo;
    $$('.copy-check').forEach(c=>c.disabled=!selected.has(Number(c.value))&&selected.size>=Math.min(3,available));
  };
  const showCopies=term=>{
    const list=filterRows(copies,term,['titulo','codigo']);
    $('#copy-options').innerHTML=list.length?list.map(c=>`<label class="copy-option"><input class="copy-check" type="checkbox" value="${c.ejemplar_id}" ${selected.has(c.ejemplar_id)?'checked':''}><span><strong>${esc(c.titulo)}</strong><small>${esc(c.codigo)}</small></span></label>`).join(''):empty('Sin ejemplares disponibles','Prueba con otra búsqueda.');
    $$('.copy-check').forEach(check=>check.onchange=()=>{check.checked?selected.add(Number(check.value)):selected.delete(Number(check.value));update();});update();
  };showCopies('');watchSearch(showCopies,'copy-search');
  $('#usuario').onchange=async()=>{
    const key=++sequence;selected.clear();info=null;selectedUser=Number($('#usuario').value)||null;loadingUser=true;update();
    $('#user-info').innerHTML=selectedUser?'<p class="help">Consultando préstamos y bloqueos…</p>':'';
    try {
      const result=selectedUser?await api('/usuarios/'+selectedUser+'/resumen'):null;
      if(key!==sequence||version!==routeVersion)return;
      info=result;$('#user-info').innerHTML=info?userNotice(info):'';
    }catch(e){if(key===sequence)$('#user-info').innerHTML=`<div class="notice danger">${esc(e.message)}</div>`;}
    finally {if(key===sequence&&version===routeVersion){loadingUser=false;showCopies($('#copy-search').value);}}
  };
  if(!context.calendario?.permite_prestamo||!context.vencimiento)$('#loan-error').textContent='El calendario no permite registrar un préstamo con esta fecha. Puedes consultar las demás secciones.';
  $('#submit-loan').onclick=async()=>{
    if(saving)return;saving=true;update();$('#loan-error').textContent='';
    try {const result=await post('/prestamos',{usuario_id:selectedUser,ejemplares:[...selected]});toast(`Préstamo Nº ${result.p_prestamo} registrado. Devolución: ${fmt(context.vencimiento)}.`);await renderRoute();}
    catch(e){$('#loan-error').textContent=e.message;saving=false;update();}
  };
  bindUserSearch(users);
  if(selectedUser)$('#usuario').dispatchEvent(new Event('change'));
}

async function returns(version) {
  const users=await api('/usuarios');if(version!==routeVersion)return;
  main.innerHTML=heading('Devoluciones y renovaciones','Gestiona los ejemplares de cada usuario sin alterar el resto del préstamo.')+
    `<section class="card"><div class="toolbar"><div class="user-picker">${userSelect(users)}</div><span class="count">Selecciona los ejemplares que deseas gestionar</span></div><div id="return-content">${empty('Selecciona un usuario','Verás sus ejemplares pendientes y las fechas de devolución.')}</div></section>`;
  let sequence=0;
  $('#usuario').onchange=async()=>{
    const key=++sequence;selectedUser=Number($('#usuario').value)||null;
    if(!selectedUser){$('#return-content').innerHTML=empty('Selecciona un usuario');return;}
    $('#return-content').innerHTML='<p class="help">Consultando préstamos…</p>';
    try {
      const info=await api('/usuarios/'+selectedUser+'/resumen');if(key!==sequence||version!==routeVersion)return;
      const list=info.prestamos;
      $('#return-content').innerHTML=userNotice(info)+(list.length?`<div class="table-wrap"><table><thead><tr><th class="table-check"></th><th>Libro / ejemplar</th><th>Vencimiento</th><th>Renovaciones</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(d=>`<tr><td><input type="checkbox" class="return-check" value="${d.detalle_id}" aria-label="Seleccionar ${esc(d.codigo)}" ${d.incidencia_id?'disabled':''}></td><td><strong>${esc(d.titulo)}</strong><small>${esc(d.codigo)} · Préstamo Nº ${d.prestamo_id}</small></td><td>${fmt(d.vencimiento)}</td><td>${d.cantidad_renovaciones} de 2</td><td><span class="badge ${d.incidencia_id?'neutral':d.atrasado?'warn':''}">${d.incidencia_id?'Incidencia':d.atrasado?'Atrasado':'Dentro del plazo'}</span></td><td>${!d.incidencia_id?`<button class="text-button" data-incident="${d.detalle_id}">Informar pérdida / daño</button>`:''}</td></tr>`).join('')}</tbody></table></div>
      <div class="selection-bar"><span id="selected-count">0 ejemplares seleccionados</span><div class="actions"><button class="button secondary" id="renew" disabled>Renovar selección</button><button class="button" id="return" disabled>Devolver selección</button></div></div><p class="history-note">Al devolver, indica si cada ejemplar está bueno o desgastado. Para daño permanente o pérdida, usa “Informar pérdida / daño”.</p>`:empty('Sin ejemplares pendientes','Este usuario no tiene libros por devolver.'));
      if(!list.length)return;
      const chosen=()=>list.filter(d=>$$('.return-check:checked').some(c=>Number(c.value)===d.detalle_id));
      const update=()=>{const sel=chosen();$('#selected-count').textContent=`${sel.length} ejemplares seleccionados`;
        $('#return').disabled=!sel.length||!context.calendario?.abierto;
        $('#renew').disabled=!sel.length||sel.some(d=>!d.puede_renovar)||!context.calendario?.permite_renovacion;};
      $$('.return-check').forEach(c=>c.onchange=update);
      $('#return').onclick=()=>confirmMovement('devoluciones',selectedUser,chosen());
      $('#renew').onclick=()=>confirmMovement('renovaciones',selectedUser,chosen());
      $$('[data-incident]').forEach(b=>b.onclick=()=>incidentForm(list.find(d=>d.detalle_id===Number(b.dataset.incident))));
    }catch(e){if(key===sequence&&version===routeVersion)$('#return-content').innerHTML=`<div class="notice danger">${esc(e.message)}</div>`;}
  };bindUserSearch(users);if(selectedUser)$('#usuario').dispatchEvent(new Event('change'));
}
function confirmMovement(operation,user,list) {
  const isReturn=operation==='devoluciones';
  showModal(isReturn?'Confirmar devolución':'Confirmar renovación',`<form><p>${isReturn?'Se registrará la entrega de estos ejemplares:':'Se añadirán tres días hábiles desde el vencimiento vigente de cada ejemplar:'}</p><ul class="selected-books">${list.map(d=>`<li>${esc(d.titulo)} · ${esc(d.codigo)}</li>`).join('')}</ul>
    ${isReturn?list.map(d=>select('condicion_'+d.detalle_id,`Estado recibido · ${esc(d.codigo)}`,`<option value="bueno" ${d.condicion==='desgastado'?'':'selected'}>Bueno</option><option value="desgastado" ${d.condicion==='desgastado'?'selected':''}>Desgastado, apto para préstamo</option>`)).join('')+field('observaciones','Observaciones (opcional)','<textarea id="observaciones" name="observaciones" maxlength="1000"></textarea>'):'<p class="help">El sistema comprobará que el nuevo plazo no cruce las vacaciones.</p>'}${actions(isReturn?'Confirmar devolución':'Confirmar renovación')}</form>`,async data=>{
      await post('/'+operation,{observaciones:data.observaciones,usuario_id:user,detalles:list.map(d=>d.detalle_id),...(isReturn?{condiciones:list.map(d=>data['condicion_'+d.detalle_id])}:{})});toast(isReturn?'Devolución registrada.':'Renovación registrada.');await renderRoute();
    });
}
function incidentForm(detail) {
  showModal('Informar pérdida o daño',`<form><div class="notice"><strong>${esc(detail.titulo)}</strong>${esc(detail.codigo)}</div>
    ${select('tipo','Situación','<option value="perdida">Pérdida del ejemplar</option><option value="dano_permanente">Daño permanente</option>')}
    ${field('observaciones','Observaciones (opcional)','<textarea id="observaciones" name="observaciones" maxlength="1000"></textarea>')}<p class="help">La copia quedará no disponible y el usuario tendrá un bloqueo hasta resolver la reposición o el reembolso.</p>${actions('Registrar incidencia')}</form>`,async data=>{await post('/incidencias',{...data,detalle_id:detail.detalle_id});toast('Incidencia registrada.');await renderRoute();});
}
async function pendingPage(version) {
  const pending=await api('/pendientes');if(version!==routeVersion)return;
  main.innerHTML=heading('Pendientes','Seguimiento de atrasos, pérdidas y reposiciones.')+
    `<div class="notice"><strong>Seguimiento por correo</strong>Los correos de contacto están disponibles para consulta. El envío automático aún no está activado.</div>`+
    (pending.length?`<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Libro / ejemplar</th><th>Vencimiento</th><th>Situación</th><th></th></tr></thead><tbody>${pending.map(p=>`<tr><td><strong>${esc(p.nombre)}</strong><small>${esc(p.correo||'Sin correo')}</small></td><td>${esc(p.titulo)}<small>${esc(p.codigo)}</small></td><td>${fmt(p.vencimiento)}</td><td><span class="badge ${p.incidencia?'neutral':'warn'}">${p.incidencia?(p.incidencia==='perdida'?'Pérdida':'Daño permanente'):p.dias_atraso+' días de atraso'}</span></td><td>${p.incidencia_id?`<button class="text-button" data-resolve="${p.incidencia_id}">Resolver</button>`:`<button class="text-button" data-attend="${p.usuario_id}">Gestionar →</button>`}</td></tr>`).join('')}</tbody></table></div>`:empty('Todo al día','No hay atrasos ni incidencias pendientes.'));
  $$('[data-attend]').forEach(b=>b.onclick=()=>{selectedUser=Number(b.dataset.attend);location.hash='devoluciones';});
  $$('[data-resolve]').forEach(b=>b.onclick=()=>resolveForm(pending.find(p=>p.incidencia_id===Number(b.dataset.resolve))));
}
function resolveForm(incident) {
  showModal('Resolver incidencia',`<form><div class="notice"><strong>${esc(incident.titulo)}</strong>${esc(incident.nombre)} · ${esc(incident.codigo)}</div>
    ${select('solucion','Solución aceptada','<option value="reposicion">Reposición: se recibió una copia nueva</option><option value="reembolso">Reembolso: se recibió el pago</option>')}
    <div id="replace-field">${input('codigo','Código de la nueva copia','',{max:80,help:'Debe ser una copia nueva de la misma edición.'})}</div>
    <div id="amount-field" hidden>${input('monto','Monto recibido (CLP)','',{required:false,type:'number'})}</div><p class="help">Confirma únicamente cuando la biblioteca haya recibido y aceptado la reposición o el pago. El historial se conservará.</p>${actions('Confirmar resolución')}</form>`,async data=>{await post('/incidencias/'+incident.incidencia_id+'/resolver',data);toast('Incidencia resuelta. Se conservó su historial.');await renderRoute();});
  $('#monto').min='1';$('#monto').step='1';
  $('#solucion').onchange=()=>{const replace=$('#solucion').value==='reposicion';$('#replace-field').hidden=!replace;$('#amount-field').hidden=replace;$('#codigo').required=replace;$('#monto').required=!replace;};
}
async function statsPage(version) {
  main.innerHTML=heading('Estadísticas','Consulta anual de operaciones de préstamo y libros más utilizados.')+
    `<div class="toolbar">${field('year','Año de consulta',`<input class="year-select" id="year" type="number" min="2000" max="9998" value="${context.fecha.slice(0,4)}">`)}<button class="button secondary" id="query-year">Consultar año</button></div><div id="stats-results"></div>`;
  let sequence=0;
  const update=async()=>{const key=++sequence;$('#stats-results').innerHTML='<p class="help">Calculando indicadores…</p>';
    try {
      const stats=await api('/estadisticas?anio='+encodeURIComponent($('#year').value));if(key!==sequence||version!==routeVersion)return;
      const chart=(items,label,value)=>{
        const max=Math.max(1,...items.map(x=>Number(x[value])));
        return items.length?items.map(x=>`<div class="chart-row"><span>${esc(x[label])}</span><strong class="number">${x[value]}</strong><meter min="0" max="${max}" value="${x[value]}" aria-label="${esc(x[label])}: ${x[value]}"></meter></div>`).join(''):empty('Sin préstamos en este año');
      };
      $('#stats-results').innerHTML=`<div class="two-columns"><section class="card"><div class="card-head"><h2>Préstamos por curso</h2></div>${chart(stats.por_curso,'curso','prestamos')}<p class="mini-note">Tres ejemplares retirados juntos cuentan como una operación. Se conserva el curso del momento del préstamo.</p></section><section class="card"><div class="card-head"><h2>Libros más prestados</h2></div>${chart(stats.por_libro,'titulo','ejemplares_prestados')}<p class="mini-note">Se cuentan los ejemplares retirados de cada edición. Las renovaciones no suman préstamos nuevos.</p></section></div>`;
    }catch(e){if(key===sequence&&version===routeVersion)$('#stats-results').innerHTML=`<div class="notice danger">${esc(e.message)}</div>`;}
  };$('#query-year').onclick=update;await update();
}

let calendarMonth;
function calendarState(day) {
  if(!day || day.configurado===false)return ['missing','Sin configurar'];
  if(day.vacaciones)return ['vacation','Vacaciones'];
  if(!day.abierto)return ['closed','Cerrado'];
  if(!day.permite_prestamo && !day.permite_renovacion)return ['returns','Solo devoluciones'];
  if(day.permite_prestamo && day.permite_renovacion)return ['open','Atención normal'];
  return ['returns','Atención limitada'];
}
async function calendarPage(version) {
  calendarMonth ||= context.fecha.slice(0,7);
  main.innerHTML=heading('Calendario de atención','Configura los días que se utilizan para calcular préstamos, renovaciones y sanciones.',
    '<button class="button" id="configure-period">＋ Configurar período</button>')+
    `<div class="toolbar">${field('calendar-month','Mes',`<input id="calendar-month" type="month" min="2000-01" max="9998-12" value="${calendarMonth}">`)}
    <button class="button secondary" id="complete-year">Completar días faltantes del año</button></div>
    <div class="notice"><strong>Planifica antes de prestar</strong>Los días pasados son de solo lectura. Si un cambio afecta fechas utilizadas en préstamos o sanciones, se rechazará para conservar sus condiciones.</div>
    <div id="calendar-results"></div>`;
  let sequence=0;
  const update=async()=>{
    const key=++sequence,month=$('#calendar-month').value;
    $('#calendar-results').innerHTML='<p class="help">Consultando calendario…</p>';
    try {
      const data=await api('/calendario?mes='+encodeURIComponent(month));if(key!==sequence||version!==routeVersion)return;
      calendarMonth=month;
      $('#complete-year').disabled=Number(month.slice(0,4))<Number(context.fecha.slice(0,4));
      const offset=(new Date(month+'-01T12:00:00Z').getUTCDay()+6)%7;
      const missing=data.dias.filter(d=>!d.configurado).length;
      $('#calendar-results').innerHTML=`${missing?`<div class="notice warn">Hay ${missing} días sin configurar en este mes. Completa los días faltantes y luego registra feriados y vacaciones.</div>`:''}
        <div class="calendar-legend">${[['open','Atención normal'],['returns','Solo devoluciones'],['closed','Cerrado'],['vacation','Vacaciones'],['missing','Sin configurar']].map(([kind,label])=>`<span><i class="calendar-dot ${kind}" aria-hidden="true"></i>${label}</span>`).join('')}</div>
        <div class="calendar-grid">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}
        ${'<div aria-hidden="true"></div>'.repeat(offset)}${data.dias.map(day=>{
          const [kind,label]=calendarState(day),past=day.fecha<data.hoy;
          return `<button class="calendar-day ${kind}" type="button" data-calendar-day="${day.fecha}" ${past?'disabled':''} aria-label="${esc(fmt(day.fecha)+' · '+label+(past?' · Solo lectura':''))}" title="${esc(day.motivo||'Todavía no existe configuración')}"><strong>${Number(day.fecha.slice(-2))}</strong><span>${label}</span><small>${esc(day.motivo||'Configurar atención')}</small></button>`;
        }).join('')}</div><p class="help">Selecciona un día para configurarlo. Los fines de semana permanecen cerrados en el horario normal.</p>
        <section class="card calendar-history"><h2>Últimos cambios guardados</h2>${data.historial.length?`<div class="table-wrap"><table><thead><tr><th>Período</th><th>Motivo</th><th>Días</th></tr></thead><tbody>${data.historial.map(h=>`<tr><td>${fmt(h.desde)} → ${fmt(h.hasta)}</td><td>${esc(h.motivo)}</td><td>${h.cantidad}</td></tr>`).join('')}</tbody></table></div>`:'<p class="help">Todavía no se han guardado cambios desde esta pantalla.</p>'}</section>`;
      $$('[data-calendar-day]').forEach(button=>button.onclick=()=>calendarForm({desde:button.dataset.calendarDay,hasta:button.dataset.calendarDay}));
    } catch(error) {if(key===sequence && version===routeVersion)$('#calendar-results').innerHTML=`<div class="notice danger">${esc(error.message)}</div>`;}
  };
  $('#calendar-month').onchange=update;
  $('#configure-period').onclick=()=>calendarForm();
  $('#complete-year').onclick=()=>calendarForm({tipo:'completar',anio:calendarMonth.slice(0,4)});
  await update();
}
function calendarForm(initial={}) {
  const completing=initial.tipo==='completar';
  showModal(completing?'Completar días faltantes':'Configurar período',`<form>
    ${completing?`<div class="notice">Agrega solo fechas que faltan, desde hoy en adelante. Propone atención de lunes a viernes y fines de semana cerrados. Conserva todos los días ya configurados. Después debes indicar los feriados y vacaciones del colegio.</div>
      ${input('anio','Año',initial.anio,{type:'number'})}<input type="hidden" name="tipo" value="completar">`:
      `<div class="fields">${input('desde','Desde',initial.desde||context.fecha,{type:'date'})}${input('hasta','Hasta',initial.hasta||initial.desde||context.fecha,{type:'date'})}
      ${select('tipo','Tipo de atención','<option value="normal">Atención normal</option><option value="cerrado">Feriado o cierre</option><option value="solo_devoluciones">Solo devoluciones</option><option value="vacaciones">Vacaciones</option>')}
      ${input('motivo','Motivo','',{max:250,full:true,help:'Por ejemplo: feriado del colegio o vacaciones de invierno.'})}
      <div class="field full" id="last-week-field" hidden>${input('ultima_semana','Lunes de la última semana de clases','',{type:'date',required:false,help:'Esa semana, de lunes a viernes, quedará solo para devoluciones. Se conservan sus feriados y cierres; no se cambian días pasados.'})}</div></div>
      <p class="help">“Solo devoluciones” conserva los días cerrados. “Atención normal” reemplaza la configuración del período; revisa los cambios para evitar reabrir un feriado.</p>`}
    <div id="calendar-preview"></div>${actions('Revisar cambios')}</form>`);
  const form=$('form',dialog),submit=$('button[type=submit]',form),error=$('.form-error',form),previewBox=$('#calendar-preview',form);
  let preview=null;
  const invalidate=()=>{preview=null;previewBox.innerHTML='';error.textContent='';submit.textContent='Revisar cambios';submit.disabled=false;};
  form.oninput=invalidate;
  if(completing) {form.elements.anio.min=context.fecha.slice(0,4);form.elements.anio.max='9998';}
  else {
    form.elements.desde.min=context.fecha;form.elements.hasta.min=context.fecha;
    form.elements.tipo.onchange=()=>{
      invalidate();const vacation=form.elements.tipo.value==='vacaciones';
      $('#last-week-field',form).hidden=!vacation;form.elements.ultima_semana.required=vacation;
    };
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(modalBusy)return;
    if(preview && (preview.conflictos.length || !preview.cambios.length))return;
    const data=Object.fromEntries(new FormData(form));
    const controls=$$('input,select,button',form);
    modalBusy=true;controls.forEach(control=>control.disabled=true);error.textContent='';submit.textContent=preview?'Guardando…':'Revisando…';
    try {
      if(!preview) {
        preview=await post('/calendario/previsualizar',data);
        previewBox.innerHTML=`<div class="notice"><strong>${preview.cambios.length} días cambiarán</strong>${preview.resumen.nuevos} nuevos y ${preview.resumen.actualizados} actualizados. Todavía no se ha guardado nada.</div>
          ${preview.conflictos.length?`<div class="notice danger"><strong>Hay fechas protegidas. Ajusta el período.</strong>${preview.conflictos.map(c=>`${fmt(c.fecha)}: ${esc(c.motivo)}`).join('<br>')}</div>`:''}
          ${preview.cambios.length?`<div class="table-wrap calendar-review"><table><thead><tr><th>Fecha</th><th>Antes</th><th>Después</th></tr></thead><tbody>${preview.cambios.map(c=>`<tr><td>${fmt(c.fecha)}</td><td>${calendarState(c.antes)[1]}<small>${esc(c.antes?.motivo||'')}</small></td><td>${calendarState(c.despues)[1]}<small>${esc(c.despues.motivo)}</small></td></tr>`).join('')}</tbody></table></div>`:''}`;
      } else {
        const result=await post('/calendario/configurar',{...data,version:preview.version});
        calendarMonth=completing?data.anio+'-01':data.desde.slice(0,7);
        toast(`Calendario actualizado: ${result.guardados} días guardados.`);dialog.close();await renderRoute();
      }
    } catch(e) {error.textContent=e.message;preview=null;previewBox.innerHTML='';}
    finally {
      modalBusy=false;controls.forEach(control=>control.disabled=false);
      submit.textContent=preview?'Confirmar cambios':'Revisar cambios';
      submit.disabled=Boolean(preview && (preview.conflictos.length || !preview.cambios.length));
    }
  };
}

// ---------- Avisos por correo ----------
const noticeStates={pendiente:['Pendiente','warn'],enviado:['Enviado',''],error:['Con error','danger'],cancelado:['Cancelado','neutral']};
let noticeFilter='';
async function noticesPage(version) {
  const data=await api('/avisos'+(noticeFilter?'?estado='+noticeFilter:''));if(version!==routeVersion)return;
  const canWrite=!session || session.rol!=='consulta';
  const count=state=>data.resumen.find(r=>r.estado===state)?.cantidad||0;
  const last=data.ultimo;
  main.innerHTML=heading('Avisos por correo','Recordatorios de devolución para préstamos atrasados, con su estado, reintentos y errores.',
    canWrite?`<div class="head-actions"><button class="button secondary" id="prepare-notices">Preparar avisos de hoy</button><button class="button" id="send-notices" ${data.smtp?'':'disabled title="Configura SMTP para enviar"'}>Enviar ahora</button></div>`:'')+
    `<div class="status-grid">
      <section class="card"><div class="metric-label">Correo SMTP</div><p><span class="badge ${data.smtp?'':'warn'}">${data.smtp?'Configurado':'Sin configurar'}</span></p>
        <p class="help">${data.smtp?'Los avisos salen desde la cuenta definida en el archivo .env.':'Completa SMTP_HOST y SMTP_FROM en .env y reinicia la aplicación. Mientras tanto los avisos se preparan, pero no se envían.'}</p></section>
      <section class="card"><div class="metric-label">Envío automático</div><p><span class="badge ${data.automatico?'':'neutral'}">${data.automatico?'Activo · '+esc(data.automatico.hora):'Desactivado'}</span></p>
        <p class="help">${data.automatico?'Próximo envío: '+fmtTime(data.automatico.proxima)+'.':'Para activarlo usa AVISOS_AUTOMATICOS=1 y AVISOS_HORA en .env (requiere SMTP).'}</p></section>
      <section class="card"><div class="metric-label">Último envío</div>
        <p class="help">${last?`${fmtTime(last.en)} · ${last.origen==='manual'?'manual':'automático'}<br>${last.enviados} enviados, ${last.cancelados} cancelados, ${last.errores} con error${last.cerrada?'<br>La biblioteca estaba cerrada: no se generaron avisos nuevos.':''}`:'Todavía no hay envíos desde que se abrió la aplicación.'}</p></section>
    </div>
    <div class="toolbar">${field('notice-filter','Estado',`<select id="notice-filter"><option value="">Todos (${data.resumen.reduce((n,r)=>n+r.cantidad,0)})</option>${Object.entries(noticeStates).map(([k,[label]])=>`<option value="${k}" ${noticeFilter===k?'selected':''}>${label} (${count(k)})</option>`).join('')}</select>`)}
      <span class="count">${data.avisos.length} avisos${data.avisos.length===300?' (se muestran los 300 más recientes)':''}</span></div>
    ${data.avisos.length?`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Préstamo</th><th>Estado</th><th>Intentos</th><th>Detalle</th></tr></thead><tbody>${data.avisos.map(a=>{
      const [label,tone]=noticeStates[a.estado]||[a.estado,'neutral'];
      return `<tr><td>${fmt(a.fecha)}</td><td><strong>${esc(a.nombre)}</strong><small>${esc(a.destinatario)}</small></td><td>Nº ${a.prestamo_id}</td>
        <td><span class="badge ${tone}">${label}</span></td><td class="number">${a.intentos} / ${data.max_intentos}</td>
        <td>${a.estado==='enviado'?'Enviado '+fmtTime(a.enviado_en):a.error_detalle?`<span class="code-detail">${esc(a.error_detalle)}</span>`:a.ultimo_intento?'Último intento '+fmtTime(a.ultimo_intento):'—'}</td></tr>`;}).join('')}</tbody></table></div>`:empty('Sin avisos','No hay avisos con este estado.')}
    <p class="help">Un aviso con error se reintenta en el siguiente envío, hasta ${data.max_intentos} intentos. Si los ejemplares ya se devolvieron, renovaron o tienen una incidencia, el aviso se cancela y no se envía.</p>`;
  $('#notice-filter').onchange=e=>{noticeFilter=e.target.value;renderRoute();};
  const run=async(button,work)=>{button.disabled=true;button.setAttribute('aria-busy','true');try{toast(await work());await renderRoute();}catch(e){toast(e.message);button.disabled=false;button.removeAttribute('aria-busy');}};
  if(canWrite) {
    $('#prepare-notices').onclick=e=>run(e.currentTarget,async()=>{const r=await post('/avisos/preparar',{});return `Avisos preparados: ${r.pendientes} pendientes de envío.`;});
    $('#send-notices').onclick=e=>run(e.currentTarget,async()=>{const r=await post('/avisos/enviar',{});return r.pendientes?`${r.enviados} enviados, ${r.cancelados} cancelados, ${r.errores} con error.`:'No había avisos por enviar.';});
  }
}

// ---------- Administración ----------
async function adminPage(version) {
  if(session && session.rol!=='admin') {main.innerHTML=heading('Administración','Esta sección es solo para cuentas de administración.')+'<div class="notice warn">Tu cuenta no tiene permiso para administrar accesos.</div>';return;}
  const [operators,log,retention]=await Promise.all([api('/operadores'),api('/auditoria?limite=200'),api('/retencion')]);if(version!==routeVersion)return;
  main.innerHTML=heading('Administración','Cuentas de acceso, registro de operaciones y conservación de datos.','<button class="button" id="add-operator">＋ Nueva cuenta</button>')+
    `<section class="card admin-section"><div class="card-head"><h2>Cuentas de acceso</h2><span class="count">${operators.length} cuentas</span></div>
      <div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Creada</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>
      ${operators.map(o=>`<tr><td><strong>${esc(o.nombre)}</strong><small>${esc(o.usuario)}${session?.usuario===o.usuario?' · tu cuenta':''}</small></td><td>${roles[o.rol]||esc(o.rol)}</td>
        <td><span class="badge ${o.activo?'':'neutral'}">${o.activo?'Activa':'Desactivada'}</span></td><td>${new Intl.DateTimeFormat('es-CL',{dateStyle:'medium'}).format(new Date(o.creado_en))}</td>
        <td><button class="text-button" data-operator="${o.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>
      <p class="help"><strong>Administración</strong>: todo, incluidas cuentas, auditoría, calendario y anulaciones. <strong>Bibliotecaria</strong>: catálogo, usuarios y circulación. <strong>Consulta</strong>: solo lectura.</p></section>
    <section class="card admin-section"><div class="card-head"><h2>Registro de operaciones</h2><span class="count" id="audit-count"></span></div>
      ${search('Filtrar por operador, operación o resultado','audit-search')}<div id="audit-results"></div>
      <p class="help">Cada inicio de sesión, escritura y acceso rechazado queda registrado. El registro no se puede modificar ni borrar. No guarda contraseñas.</p></section>
    <section class="card admin-section"><div class="card-head"><h2>Conservación de datos</h2><span class="badge neutral">${retention.politica_anios} años</span></div>
      ${retention.prestamos.length?`<div class="notice warn"><strong>${retention.prestamos.length} préstamos superaron el plazo de conservación</strong>Antes de archivarlos o eliminarlos, genera y verifica un respaldo (npm.cmd run db:backup).</div>
        <div class="table-wrap"><table><thead><tr><th>Préstamo</th><th>Fecha</th><th>Cerrado</th><th>Conservar hasta</th></tr></thead><tbody>${retention.prestamos.map(r=>`<tr><td>Nº ${r.prestamo_id}</td><td>${fmt(r.fecha_prestamo)}</td><td>${fmt(r.fecha_cierre)}</td><td>${fmt(r.conservar_hasta)}</td></tr>`).join('')}</tbody></table></div>`
        :'<div class="notice"><strong>Ningún préstamo superó el plazo</strong>Los préstamos cerrados se conservan 10 años desde su cierre. Esta lista solo identifica candidatos: no borra nada.</div>'}
      ${retention.auditoria_antigua?`<p class="help">${retention.auditoria_antigua} registros de auditoría tienen más de 10 años.</p>`:''}</section>`;
  const renderLog=term=>{
    const rows=filterRows(log.map(x=>({...x,texto:`${x.accion} ${x.ruta} ${x.resultado}`})),term,['operador','texto']);
    $('#audit-count').textContent=`${rows.length} de las últimas ${log.length} operaciones`;
    $('#audit-results').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Operador</th><th>Operación</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${fmtTime(x.registrado_en)}</td><td>${esc(x.operador)}</td><td><span class="code-detail">${esc(x.accion)} ${esc(x.ruta)}</span></td>
      <td><span class="badge ${x.resultado==='ok'?'':'danger'}">${x.resultado==='ok'?'Correcto':'Rechazado'}</span></td><td><span class="code-detail">${esc(JSON.stringify(x.detalle||{}).slice(0,180))}</span></td></tr>`).join('')}</tbody></table></div>`:empty('Sin operaciones','No hay registros que coincidan.');
  };
  renderLog('');watchSearch(renderLog,'audit-search');
  $('#add-operator').onclick=()=>operatorForm();
  $$('[data-operator]').forEach(b=>b.onclick=()=>operatorForm(operators.find(o=>o.id===Number(b.dataset.operator))));
}
function operatorForm(op) {
  const editing=Boolean(op);
  showModal(editing?'Editar cuenta':'Nueva cuenta',`<form><div class="fields">
    ${editing?`<div class="field"><label for="op-user">Usuario</label><input id="op-user" value="${esc(op.usuario)}" disabled></div>`:input('usuario','Usuario','',{max:40,help:'3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.'})}
    ${input('nombre','Nombre',op?.nombre||'',{max:120})}
    ${select('rol','Rol',Object.entries(roles).map(([k,v])=>`<option value="${k}" ${(op?.rol||'bibliotecaria')===k?'selected':''}>${v}</option>`).join(''))}
    ${input('clave',editing?'Nueva contraseña (opcional)':'Contraseña inicial','',{type:'password',required:!editing,max:200,help:'Mínimo 10 caracteres.'+(editing?' Déjala vacía para mantener la actual.':'')})}
    ${editing?`<div class="field full"><label class="check"><input type="checkbox" name="activo" ${op.activo?'checked':''}> Cuenta activa</label><small>Al guardar se cierran las sesiones abiertas de esta cuenta.</small></div>`:''}
    </div>${actions(editing?'Guardar cambios':'Crear cuenta')}</form>`,async data=>{
      if(editing) await post('/operadores/'+op.id,{nombre:data.nombre,rol:data.rol,activo:data.activo==='on',...(data.clave?{clave:data.clave}:{})},'PATCH');
      else await post('/operadores',data);
      toast(editing?'Cuenta actualizada.':'Cuenta creada.');
      await renderRoute();
    });
  $('#clave',dialog).autocomplete='new-password';
}

// ---------- Sesión ----------
function applySession() {
  document.body.classList.remove('locked');$('#auth').hidden=true;$('#auth').innerHTML='';
  $$('[data-admin]').forEach(a=>a.hidden=Boolean(session) && session.rol!=='admin');
  // Consulta: se ocultan los botones de registro. El servidor igual rechaza cualquier escritura.
  document.body.classList.toggle('readonly',session?.rol==='consulta');
  $('#session-box').innerHTML=session?`<span><strong>${esc(session.nombre)}</strong> · ${roles[session.rol]||esc(session.rol)}${session.rol==='consulta'?' <span class="badge neutral">Solo lectura</span>':''}</span><button class="text-button" id="logout" type="button">Cerrar sesión</button>`:'';
  if(session) $('#logout').onclick=async()=>{try{await post('/sesion/salir',{});}catch{}session=null;showAuth(true);};
}
async function showAuth(configured) {
  if(document.body.classList.contains('locked') && configured===undefined) return;
  if(configured===undefined) {try{configured=(await api('/sesion')).configurado;}catch{configured=true;}}
  session=null;++routeVersion;if(dialog.open)dialog.close();
  // Al cerrar la sesión no deben quedar datos de la pantalla anterior en la página.
  main.innerHTML='';$('#modal-body').innerHTML='';$('#session-box').innerHTML='';
  document.body.classList.add('locked');
  const box=$('#auth');box.hidden=false;
  box.innerHTML=`<form class="auth-card" novalidate><span class="brand-mark" aria-hidden="true">B<span>·</span></span><p class="eyebrow">BIBLIOTECA · COLEGIO SIGLO XXI DE LAMPA</p>
    <h1>${configured?'Iniciar sesión':'Crear la cuenta de administración'}</h1>
    <p class="help">${configured?'Ingresa con tu cuenta para gestionar la biblioteca. Cada operación queda registrada a tu nombre.':'Es la primera vez que se abre esta base. Crea la cuenta que administrará los accesos; luego podrás crear las cuentas del resto del equipo.'}</p>
    ${configured?'':input('nombre','Nombre de la persona','',{max:120})}
    ${input('usuario','Usuario','',{max:40,help:configured?'':'3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.'})}
    ${input('clave','Contraseña','',{type:'password',max:200,help:configured?'':'Mínimo 10 caracteres.'})}
    <div class="form-error" role="alert"></div><button class="button" type="submit">${configured?'Entrar':'Crear cuenta y entrar'}</button></form>`;
  const form=$('form',box);
  form.elements.usuario.autocomplete='username';form.elements.clave.autocomplete=configured?'current-password':'new-password';
  (form.elements.nombre||form.elements.usuario).focus();
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=$('button[type=submit]',form),error=$('.form-error',form),old=button.textContent;
    button.disabled=true;button.textContent='Ingresando…';error.textContent='';
    try {
      const r=await post(configured?'/sesion':'/sesion/inicial',Object.fromEntries(new FormData(form)));
      session=r.operador;applySession();await renderRoute();
    } catch(e) {error.textContent=e.message;form.elements.clave.value='';form.elements.clave.focus();}
    finally {button.disabled=false;button.textContent=old;}
  };
}

const routes={inicio:home,catalogo:catalog,usuarios:usersPage,prestamos:loans,devoluciones:returns,pendientes:pendingPage,estadisticas:statsPage,calendario:calendarPage,avisos:noticesPage,administracion:adminPage};
const titles={inicio:'Inicio',catalogo:'Catálogo',usuarios:'Usuarios',prestamos:'Nuevo préstamo',devoluciones:'Devoluciones',pendientes:'Pendientes',estadisticas:'Estadísticas',calendario:'Calendario',avisos:'Avisos',administracion:'Administración'};
async function renderRoute() {
  if(document.body.classList.contains('locked'))return;
  const version=++routeVersion;
  window.scrollTo(0,0);
  const route=location.hash.slice(1)||'inicio';
  $$('nav a').forEach(a=>{if(a.dataset.route===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  main.innerHTML='<div class="loading" role="status">Cargando…</div>';
  try {
    await loadContext();if(version!==routeVersion)return;
    document.title=(titles[route]||'Inicio')+' · Biblioteca Siglo XXI de Lampa';
    await (routes[route]||home)(version);
  } catch(e) {if(version!==routeVersion)return;main.innerHTML=`${heading('No pudimos cargar la biblioteca','Revisa que la aplicación esté abierta en la terminal.')}<div class="notice danger">${esc(e.message)}</div><button class="button" id="retry">Volver a intentar</button>`;$('#retry').onclick=renderRoute;}
}
async function boot() {
  try {
    const s=await api('/sesion');
    if(s.requiere && !s.operador) return showAuth(s.configurado);
    session=s.operador;applySession();await renderRoute();
  } catch(e) {main.innerHTML=`${heading('No pudimos cargar la biblioteca','Revisa que la aplicación esté abierta en la terminal.')}<div class="notice danger">${esc(e.message)}</div><button class="button" id="retry">Volver a intentar</button>`;$('#retry').onclick=boot;}
}
window.addEventListener('hashchange',()=>{if(location.hash==='#contenido'){main.focus();return;}renderRoute();});
await boot();

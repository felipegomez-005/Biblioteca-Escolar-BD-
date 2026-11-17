const $=(s,scope=document)=>scope.querySelector(s);
const $$=(s,scope=document)=>[...scope.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>d?new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(String(d).slice(0,10)+'T12:00:00Z')):'—';
const types={estudiante:'Estudiante',docente:'Docente',asistente:'Asistente'};
const reasons={usuario_inactivo:'Usuario inactivo',ejemplar_atrasado:'Tiene ejemplares atrasados',sancion_por_atraso:'Sanción por atraso vigente',conducta_grave:'Sanción por conducta grave vigente',reposicion_o_reembolso_pendiente:'Reposición o reembolso pendiente'};
let context,routeVersion=0,modalBusy=false,toastTimer,selectedUser=null;
const main=$('#contenido'),dialog=$('#modal');

async function api(url,options={}) {
  let response;
  try {response=await fetch('/api'+url,{...options,headers:{'Content-Type':'application/json','X-Biblioteca-Request':'1',...options.headers}});}
  catch {throw new Error('No hay conexión con la aplicación. Compruebe que la terminal siga ejecutando npm.cmd start.');}
  const result=await response.json();
  if(!response.ok) throw new Error(result.error||'No se pudo completar la operación.');
  return result;
}
const post=(url,data,method='POST')=>api(url,{method,body:JSON.stringify(data)});
function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function empty(title,description='') {return `<div class="empty"><strong>${esc(title)}</strong>${esc(description)}</div>`;}
function heading(title,subtitle,buttons='') {return `<div class="page-head"><div><p class="eyebrow">BIBLIOTECA ESCOLAR</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${buttons}</div>`;}
function search(placeholder,id='search') {return `<div class="search"><input id="${id}" type="search" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off"></div>`;}
function field(name,label,content,full=false) {return `<div class="field ${full?'full':''}"><label for="${name}">${label}</label>${content}</div>`;}
function input(name,label,value='',{required=true,type='text',max=150,help='',full=false}={}) {
  return field(name,label,`<input id="${name}" name="${name}" type="${type}" value="${esc(value)}" maxlength="${max}" ${required?'required':''}>${help?`<small>${help}</small>`:''}`,full);
}
function select(name,label,options) {return field(name,label,`<select id="${name}" name="${name}" required>${options}</select>`);}
function actions(label) {return `<div class="form-error" role="alert"></div><div class="dialog-foot"><button class="button secondary" type="button" data-close>Cancelar</button><button class="button" type="submit">${label}</button></div>`;}
function showModal(title,content,submit) {
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
    $('#book-results').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Libro / autor</th><th>Editorial</th><th>ISBN</th><th>Disponibilidad</th><th></th></tr></thead><tbody>${list.map(b=>`<tr><td>${booksCell(b)}</td><td>${esc(b.editorial||'Sin registrar')}</td><td><small>${esc(b.isbn||'Sin ISBN')}</small></td><td><span class="badge ${b.disponibles?'':'neutral'}">${b.disponibles} de ${b.copias} disponibles</span></td><td><button class="text-button" data-copies="${b.id}">Ver copias →</button></td></tr>`).join('')}</tbody></table></div>`:empty('No encontramos libros','Prueba con otro título o registra el primer libro.');
    $$('[data-copies]').forEach(button=>button.onclick=()=>viewCopies(books.find(b=>b.id===Number(button.dataset.copies))));
  };render('');watchSearch(render);$('#add-book').onclick=addBook;
}
function addBook() {
  showModal('Registrar libro',`<form><p class="help">Registra la edición una sola vez. Después puedes agregar todas sus copias.</p><div class="fields">
    ${input('titulo','Título','',{full:true,max:250})}${input('autores','Autor o autores','',{required:false,full:true,max:1000,help:'Si hay varios, sepáralos con punto y coma (;).'})}
    ${input('isbn','ISBN (opcional)','',{required:false,max:30})}${input('editorial','Editorial (opcional)','',{required:false})}
    ${input('anio_publicacion','Año de publicación (opcional)','',{required:false,type:'number'})}${input('generos','Género (opcional)','',{required:false,max:500})}
    ${input('codigo','Código de la primera copia (opcional)','',{required:false,full:true,max:80,help:'Debe identificar un único ejemplar físico. Puedes añadir las copias más adelante.'})}</div>${actions('Guardar libro')}</form>`,async data=>{await post('/libros',data);toast('Libro registrado en el catálogo.');await renderRoute();});
}
async function viewCopies(book) {
  try {
    const copies=await api('/ejemplares?libro='+book.id);
    showModal(book.titulo,`<p class="help">${esc(book.autores||'Autor sin registrar')} · ${esc(book.editorial||'Editorial sin registrar')}</p>
      ${copies.length?`<div class="table-wrap"><table><thead><tr><th>Código</th><th>Condición</th><th>Disponibilidad</th></tr></thead><tbody>${copies.map(c=>`<tr><td>${esc(c.codigo)}</td><td>${esc(c.condicion)}</td><td><span class="badge ${c.disponible?'':'neutral'}">${c.disponible?'Disponible':'No disponible'}</span></td></tr>`).join('')}</tbody></table></div>`:empty('Sin copias registradas')}
      <div class="dialog-foot"><button class="button" id="add-copy">＋ Agregar copia</button></div>`);
    $('#add-copy').onclick=()=>addCopy(book);
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
    $('#user-results').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Tipo / curso</th><th>Correo</th><th>Pendientes</th><th></th></tr></thead><tbody>${list.map(u=>`<tr><td><strong>${esc(u.nombre)}</strong><small>${esc(u.identificador)}${u.activo?'':' · Inactivo'}</small></td><td>${types[u.tipo]}<small>${esc(u.curso?u.curso+' · '+u.anio_escolar:u.cargo||'')}</small></td><td>${esc(u.correo||'Sin registrar')}</td><td><span class="badge ${u.pendientes?'warn':'neutral'}">${u.pendientes} ejemplares</span></td><td><button class="text-button" data-user="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`:empty('No encontramos usuarios','Revisa la búsqueda o registra una nueva persona.');
    $$('[data-user]').forEach(btn=>btn.onclick=()=>userForm(users.find(u=>u.id===Number(btn.dataset.user))));
  };render('');watchSearch(render);$('#add-user').onclick=()=>userForm();$('#add-course').onclick=courseForm;
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

function userSelect(users) {return select('usuario','Seleccionar usuario',`<option value="">Busca y selecciona una persona</option>${users.map(u=>`<option value="${u.id}" ${selectedUser===u.id?'selected':''}>${esc(u.nombre)} · ${esc(u.identificador)}${u.activo?'':' (inactivo)'}</option>`).join('')}`);}
function userNotice(info) {
  if(info.bloqueos.length)return `<div class="notice danger"><strong>Nuevos préstamos bloqueados</strong>${info.bloqueos.map(b=>esc(reasons[b.motivo]||b.motivo)).join('<br>')}</div>`;
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
      <div class="selection-bar"><span id="selected-count">0 ejemplares seleccionados</span><div class="actions"><button class="button secondary" id="renew" disabled>Renovar selección</button><button class="button" id="return" disabled>Devolver selección</button></div></div><p class="history-note">Para daño permanente o pérdida, usa “Informar pérdida / daño”. Las devoluciones de esta pantalla registran ejemplares en buen estado.</p>`:empty('Sin ejemplares pendientes','Este usuario no tiene libros por devolver.'));
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
  };if(selectedUser)$('#usuario').dispatchEvent(new Event('change'));
}
function confirmMovement(operation,user,list) {
  const isReturn=operation==='devoluciones';
  showModal(isReturn?'Confirmar devolución':'Confirmar renovación',`<form><p>${isReturn?'Se registrará la entrega de estos ejemplares:':'Se añadirán tres días hábiles desde el vencimiento vigente de cada ejemplar:'}</p><ul class="selected-books">${list.map(d=>`<li>${esc(d.titulo)} · ${esc(d.codigo)}</li>`).join('')}</ul>
    ${isReturn?field('observaciones','Observaciones (opcional)','<textarea id="observaciones" name="observaciones" maxlength="1000"></textarea>'):'<p class="help">El sistema comprobará que el nuevo plazo no cruce las vacaciones.</p>'}${actions(isReturn?'Confirmar devolución':'Confirmar renovación')}</form>`,async data=>{
      await post('/'+operation,{...data,usuario_id:user,detalles:list.map(d=>d.detalle_id)});toast(isReturn?'Devolución registrada.':'Renovación registrada.');await renderRoute();
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

const routes={inicio:home,catalogo:catalog,usuarios:usersPage,prestamos:loans,devoluciones:returns,pendientes:pendingPage,estadisticas:statsPage};
async function renderRoute() {
  const version=++routeVersion;
  window.scrollTo(0,0);
  const route=location.hash.slice(1)||'inicio';
  $$('nav a').forEach(a=>{if(a.dataset.route===route)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  main.innerHTML='<div class="loading" role="status">Cargando…</div>';
  try {
    await loadContext();if(version!==routeVersion)return;
    document.title=({inicio:'Inicio',catalogo:'Catálogo',usuarios:'Usuarios',prestamos:'Nuevo préstamo',devoluciones:'Devoluciones',pendientes:'Pendientes',estadisticas:'Estadísticas'}[route]||'Inicio')+' · Biblioteca escolar';
    await (routes[route]||home)(version);
  } catch(e) {if(version!==routeVersion)return;main.innerHTML=`${heading('No pudimos cargar la biblioteca','Revisa que la aplicación esté abierta en la terminal.')}<div class="notice danger">${esc(e.message)}</div><button class="button" id="retry">Volver a intentar</button>`;$('#retry').onclick=renderRoute;}
}
window.addEventListener('hashchange',()=>{if(location.hash==='#contenido'){main.focus();return;}renderRoute();});
await renderRoute();

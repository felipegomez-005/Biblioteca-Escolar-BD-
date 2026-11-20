# Aplicación y API local

## Iniciar y detener

1. Abrir la carpeta del repositorio en VSCode.
2. Si es una copia nueva del repositorio: `npm.cmd ci` y `npm.cmd run db:init`. No repetir la inicialización en una base existente.
3. Ejecutar `npm.cmd start`.
4. Abrir `http://127.0.0.1:3000` en el navegador.
5. Terminar con `Ctrl+C` en la terminal para cerrar la base y liberar el archivo de bloqueo.

El servidor utiliza la base persistente existente. La terminal debe permanecer abierta. El modo interno `BIBLIOTECA_PRUEBA=1` usa memoria y se destina exclusivamente a la verificación; los datos de ese modo desaparecen al detenerlo. La aplicación normal se inicia sin esa variable.

Si aparece “base en uso”, cerrar primero el otro comando o servidor que la tenga abierta. Si hubo un cierre abrupto, comprobar que ningún proceso utilice la base antes de retirar `.local/biblioteca.lock`. No se elimina automáticamente un bloqueo de propietario desconocido.

## Recorrido de la bibliotecaria

**Catálogo:** “Registrar libro” guarda su título y los datos bibliográficos. Autores y géneros se separan con punto y coma. Puede registrar la primera copia en el mismo formulario. “Ver copias” muestra cada código y permite agregar más ejemplares. La edición no se duplica para registrar cada copia.

**Editar libro:** “Editar” permite corregir título, ISBN, autores, editorial, año y géneros de esa edición. Conserva las copias y movimientos. Rechaza un ISBN de otra edición ya registrada y una revisión desactualizada. No renombra autores o editoriales compartidos: modifica las asociaciones de ese libro. Si cambia el ISBN por uno distinto, se elimina su vínculo previo con Google Books y queda como origen manual; una conversión equivalente ISBN-10/13 conserva el vínculo. Registrar una edición diferente requiere un libro nuevo.

**Buscar por ISBN:** dentro de “Registrar libro”, consultar Google Books, seleccionar “Usar estos datos”, revisar y guardar. Requiere una clave configurada en `.env`; si no está disponible se puede continuar manualmente. [Configuración y límites](google-books.md). Buscar no crea registros en la base.

**Usuarios:** registrar identificación ficticia, nombre, tipo y contacto. Los estudiantes requieren curso y correo. “Nuevo curso” agrega el curso y el año escolar. “Editar” permite cambiar contacto/curso y desactivar a una persona, conservando su historial.

**Sanciones:** en la fila de un usuario, “Sanciones” muestra su historial por conducta grave. “Registrar sanción” presenta las fechas calculadas y exige un motivo antes de confirmar. Empieza en la fecha del servidor y termina dos semanas después, desplazándose al siguiente día de atención si corresponde. [Guía y límites](sanciones.md).

**Nuevo préstamo:** seleccionar usuario, revisar bloqueos y seleccionar copias disponibles. La pantalla muestra el vencimiento previsto; al guardar, la base vuelve a comprobar todas las reglas. No se envía una fecha elegida por el navegador: la operación usa la fecha del servidor en America/Santiago.

La búsqueda situada encima del selector permite escribir nombre o identificación, sin distinguir mayúsculas ni tildes. Muestra hasta ocho coincidencias seleccionables directamente y filtra la lista inferior. Si hay más resultados, se puede precisar el texto. Escribir otra búsqueda borra la selección anterior para evitar prestar a una persona distinta de la buscada. También está disponible en devoluciones y renovaciones. La búsqueda usa los usuarios ya cargados; todavía no es una búsqueda paginada en el servidor.

**Devoluciones:** seleccionar usuario y marcar los ejemplares a entregar o renovar. Al devolver se elige “Bueno” o “Desgastado, apto para préstamo” para cada copia; el formulario propone su condición actual. El conjunto se registra como una sola devolución. Si un ejemplar falla, no se guarda ninguno. Los ejemplares restantes mantienen su propio plazo. Para pérdida o daño permanente se registra una incidencia.

**Historial:** en Usuarios → Historial o Catálogo → Ver copias → Historial, desplegar cada movimiento para consultar préstamo, curso al prestar, renovaciones, devolución e incidencia con su resolución. Una reposición o reembolso no figura como devolución. Los nombres de personas y títulos son los actuales; el curso corresponde al momento del préstamo. Las sanciones por conducta grave conservan su consulta separada en Usuarios → Sanciones.

**Pendientes:** revisar atrasos e incidencias, ir a la devolución o registrar una reposición/reembolso ya aceptado por la biblioteca. La resolución no cobra dinero: registra un hecho externo. Los correos se muestran como datos de contacto; no se envían mensajes.

**Estadísticas:** seleccionar año y consultar ambos indicadores. Se cuentan operaciones por curso y ejemplares por edición; una renovación no agrega préstamos.

**Calendario:** consultar el mes, configurar períodos y revisar sus cambios antes de confirmar. Permite atención normal, feriados/cierres, solo devoluciones y vacaciones con su última semana de clases. Completar año agrega exclusivamente fechas faltantes desde hoy, sin sobrescribir las existentes. [Guía y límites](calendario.md).

## Consultas GET

Estas direcciones se pueden abrir directamente en el navegador mientras la aplicación esté funcionando. Devuelven JSON obtenido mediante consultas a la base; no aceptan SQL libre.

| Ruta | Resultado |
|---|---|
| `/api/contexto` | Fecha, calendario, vencimiento previsto y cursos. |
| `/api/resumen` | Totales del panel inicial. |
| `/api/libros?q=texto` | Libros, autores, géneros, editorial y disponibilidad. |
| `/api/libros/:id` | Datos editables, listas de autores/géneros y `version` para confirmar cambios. |
| `/api/libros/isbn?isbn=9780306406157` | Libro local existente o propuestas de Google Books con ISBN exacto. |
| `/api/ejemplares?libro=1` | Copias de un libro. |
| `/api/ejemplares?disponibles=1` | Copias disponibles. |
| `/api/usuarios?q=texto` | Usuarios y cantidad de ejemplares pendientes. |
| `/api/usuarios/1/resumen` | Préstamos abiertos y motivos de bloqueo del usuario. |
| `/api/usuarios/1/sanciones` | Historial por conducta grave y fechas previstas para registrar una sanción hoy; informa impedimentos de calendario sin ocultar el historial. |
| `/api/usuarios/:id/historial` | Circulación completa del usuario, con renovaciones, devoluciones e incidencias por detalle. |
| `/api/ejemplares/:id/historial` | Datos actuales y circulación de la copia física seleccionada. |
| `/api/pendientes` | Ejemplares atrasados o con incidencia pendiente. |
| `/api/estadisticas?anio=2026` | Los dos KPIs del procedimiento almacenado. |
| `/api/calendario?mes=2026-11` | Fechas del mes, configuración y últimos cambios. |

Ejemplo: `http://127.0.0.1:3000/api/estadisticas?anio=2026`.

## Escrituras

Los formularios usan JSON con `Content-Type: application/json` y `X-Biblioteca-Request: 1`. El servidor solo acepta el mismo origen local, limita el tamaño del cuerpo y usa parámetros SQL. Las rutas no constituyen una API pública autenticada: este prototipo no tiene cuentas de bibliotecarios.

| Método / ruta | Datos principales |
|---|---|
| `POST /api/libros` | `titulo`, `isbn`, `autores`, `editorial`, `generos`, `anio_publicacion`, `codigo` opcional de primera copia. |
| `PATCH /api/libros/:id` | Formulario completo: `titulo`, `isbn`, `autores`, `editorial`, `generos`, `anio_publicacion`, `version`. Los campos opcionales vacíos se eliminan. No agrega copias ni acepta cambiar la procedencia desde el cliente. |
| `POST /api/ejemplares` | `libro_id`, `codigo`, `condicion`, `observaciones`. |
| `POST /api/cursos` | `nombre`, `anio_escolar`. |
| `POST /api/usuarios` | `identificador`, `nombre`, `tipo`, `correo`, `curso_actual_id` o `cargo`. |
| `PATCH /api/usuarios/:id` | Mismos campos y `activo` booleano. |
| `POST /api/sanciones` | `usuario_id`, `observaciones` obligatorias (máximo 1000 caracteres), `inicio_esperado`, `habilitado_desde_esperado` obtenidos de la consulta previa. |
| `POST /api/prestamos` | `usuario_id`, `ejemplares` (lista de identificadores de copias). |
| `POST /api/devoluciones` | `usuario_id`, `detalles`, `condiciones` (lista de `bueno`/`desgastado` en el mismo orden), `observaciones`. Omitir `condiciones` conserva la compatibilidad anterior: todos buenos. |
| `POST /api/renovaciones` | `usuario_id`, `detalles`. |
| `POST /api/incidencias` | `detalle_id`, `tipo` (`perdida`/`dano_permanente`), `observaciones`. |
| `POST /api/incidencias/:id/resolver` | `solucion` (`reposicion`/`reembolso`), `codigo` nuevo o `monto` recibido. |
| `POST /api/anulaciones` | `prestamo_id`, `motivo` obligatorio, `operador` y `observaciones` opcionales. Cierra los ejemplares abiertos y registra la corrección conservando el historial. |
| `POST /api/calendario/previsualizar` | `tipo`, `desde`, `hasta`, `motivo`; vacaciones añade `ultima_semana`. Para completar faltantes: `tipo='completar'`, `anio`. No escribe datos. |
| `POST /api/calendario/configurar` | La misma propuesta y su `version`. Revalida conflictos y guarda todo junto con su historial. |

Las escrituras devuelven 201 (alta/operación) o 200 (edición). Los errores se presentan como `{ "error": "mensaje" }` con 400 (datos), 403 (origen), 404 (registro/ruta), 409 (conflicto/regla), 413 (tamaño), 500 (error interno), 502 (conexión/respuesta del proveedor) o 503 (configuración/cuota del proveedor). No se exponen consultas SQL ni credenciales en la respuesta.

El alta de libro desde una propuesta incluye `origen_datos='google_books'`, `google_books_id` y `consulta_id` devueltos por la búsqueda. La API exige que la consulta siga vigente y corresponda al ISBN. Se permite revisar el resto de los datos antes de guardar. En el ingreso manual se omiten esos identificadores. Los nuevos ISBN se validan y normalizan a ISBN-13; también se comprueba la equivalencia con ISBN-10 de registros anteriores.

Las transacciones de alta de libro incluyen autores, géneros y primera copia: si falla el código del ejemplar se revierte el conjunto. Los procedimientos de circulación aplican sus triggers; la API no sustituye las restricciones por validaciones visuales.

El registro de sanción vuelve a calcular el plazo en el servidor. Las fechas esperadas solo comprueban que la persona confirmó el plazo vigente; no permiten elegir otro inicio o término. Si cambian las fechas desde la revisión devuelve 409 y requiere abrir nuevamente el formulario. Repetir exactamente usuario, motivo y fechas de una solicitud guardada ese día devuelve el mismo registro con `repetida: true`. La API local serializa estas solicitudes; esto no demuestra concurrencia entre conexiones de PostgreSQL nativo.

La anulación de un préstamo (`POST /api/anulaciones`) exige un motivo y conserva el historial: registra la corrección en `correccion` y cierra los ejemplares abiertos como una devolución marcada "Anulación: …". Requiere un día de atención y rechaza préstamos ya cerrados o con incidencias pendientes.

## Alcance técnico

Node.js sirve archivos HTML/CSS/JavaScript y las rutas HTTP sin nuevas dependencias de servidor. PGlite permanece abierto durante la ejecución y una cola serializa solicitudes sobre su conexión. La API incluye consultas SELECT requeridas por la guía y operaciones adicionales para la interfaz.

La consulta real de Google Books, revisión y guardado se verificaron el 19 de noviembre de 2026. La clave se configura localmente en cada instalación.

El administrador de calendario está implementado y sus pruebas automáticas pasaron. La comprobación visual quedó pendiente por un bloqueo de la herramienta de control del navegador. El calendario real todavía debe suministrarlo el colegio.

El registro de sanciones y sus bloqueos pasaron las pruebas HTTP y de base de datos. La interacción visual con el nuevo formulario todavía requiere comprobación.

La edición, el historial y la condición de devolución se verifican en conjunto en `tests/administration.test.mjs`. La revisión visual de estas pantallas sigue pendiente. El historial consulta todos los movimientos de ese usuario o ejemplar; aún no tiene paginación. La edición bibliográfica no conserva versiones anteriores de títulos/autores ni registra al operador; sí conserva los identificadores de préstamos y copias.

Pendiente: autenticación de operadores, permisos en un servidor de producción, paginación para grandes catálogos, corrección administrativa de otros movimientos (la anulación de préstamos ya está implementada), integración con ABIES (pospuesta), configuración de la cuenta SMTP real de avisos y fechas reales del calendario. No se ha publicado el sitio.

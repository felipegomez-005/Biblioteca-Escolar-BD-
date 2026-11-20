# Verificación de la primera base

## Ejecución

`npm.cmd test` ejecuta 118 pruebas: 29 de base de datos, 13 de API general, 12 de ISBN/Google Books, 15 de calendario, 10 de sanciones, 5 escenarios de administración, 3 de respaldos, 13 de avisos, 4 de corrección y 14 de seguridad, RUT y conservación. Se crean bases nuevas en memoria y se ejecutan los scripts de inicialización, incluidas las actualizaciones aditivas. Cada caso ordinario de base se revierte al terminar; los casos de COMMIT/ROLLBACK se ejecutan por separado porque prueban control explícito de transacciones. Las pruebas HTTP usan un puerto local libre y su propia base temporal. Las pruebas de respaldo usan carpetas independientes `.local/backup-test-*`; no modifican `.local/biblioteca/`.

## Casos cubiertos

| Casos | Objetivo y resultado esperado |
|---|---|
| 01–03 | Agrupar tres copias, impedir superar tres simultáneas en operaciones distintas e impedir doble préstamo de una copia. |
| 04 | Devolución parcial libera solo la copia devuelta y permite completar el cupo. |
| 05–07 | Renovar desde vencimiento, actualizar atributos calculados, impedir tercera renovación y renovación atrasada. |
| 08–10 | Excluir feriados/fines de semana; última semana solo devoluciones; impedir cruzar vacaciones. |
| 11–13 | Sanción desde atraso, bloqueo independiente por deuda y dos semanas por conducta grave con feriado al término. |
| 14–15 | Pérdida/reposición y daño/reembolso mantienen el historial y no crean devoluciones falsas. |
| 16–18 | Impedir devolución duplicada/ajena, preservar curso histórico y calcular correctamente los dos indicadores. |
| 19–20 | Correo obligatorio del estudiante; avisos pendientes deduplicados y sin envío. |
| 21–23 | Rechazar calendario desconocido/día cerrado; reversión completa si falla un elemento de una renovación múltiple. |
| 24–27 | Proteger historial y atributos derivados, rechazar operaciones vacías/repetidas y comprobar asociaciones. |
| 28–29 | Comprobar ROLLBACK y COMMIT explícitos del procedimiento de actualización. |

Cada prueba tiene un nombre, pasos SQL y resultado verificable en `tests/biblioteca.test.mjs`. La salida de la ejecución identifica cuál pasó o falló. Las capturas y el análisis individual para el formato académico de la guía aún deben incorporarse a las evidencias finales.

## Límites

La prueba se ejecuta en PGlite, que utiliza PostgreSQL dentro de un proceso. Se verifica la API HTTP local y la integración de Google Books con respuestas simuladas, pero no un servidor PostgreSQL nativo, sesiones de base simultáneas ni ABIES. El correo SMTP se prueba contra un servidor SMTP local de prueba (AVISOS 10), no contra la cuenta del colegio. La consulta real de Google Books con clave propia se comprobó por separado, como se detalla más abajo. Los fallos de concurrencia/reintentos y el rendimiento con grandes volúmenes requieren pruebas adicionales cuando se configure un servidor.

## API e interfaz

Las 13 pruebas HTTP comprueban carga de la página, endpoints SELECT, alta de catálogo, transacción revertida por código duplicado, copias, cursos/usuarios, préstamo con fecha de servidor, límite de cupo, devolución parcial, renovación, pertenencia de los detalles al usuario, incidencia/reposición, actualización de usuario, rechazo de origen externo, consultas parametrizadas y restricciones de ISBN.

También se realizó una prueba manual en el navegador sobre una base temporal: registrar un libro con copia, registrar un estudiante, prestar dos ejemplares, renovar solo uno, devolver el otro y comprobar las fechas y el ejemplar restante. Se revisaron inicio, catálogo, usuarios, circulación y estadísticas. No se observaron errores de consola en ese recorrido. Esta comprobación visual no reemplaza las pruebas automatizadas ni es una certificación de accesibilidad.

## ISBN y Google Books — 19 de noviembre de 2026

`tests/google-books.test.mjs` verifica dígito verificador y equivalencia 10/13; coincidencia exacta de edición; campos incompletos; ausencia de resultados; clave ausente/rechazada, cuota y conexión; tiempo máximo de consulta; procedencia vigente; revisión antes de guardar; duplicados nuevos y registros ISBN-10 anteriores; ingreso manual tras fallar el proveedor; y reversión del alta cuando falla el código de copia.

Resultado: 54/54 pruebas aprobadas. Tras corregir la información mostrada al consultar un libro existente, se repitieron las 12 pruebas de ISBN/Google Books: 12/12 aprobadas.

Se comprobó en navegador con proveedor simulado y base temporal: error de ISBN, ausencia de resultados, selección/autocompletado, alternativa manual, corrección del título, guardado con copia y detección del mismo ISBN en formato de 10 caracteres. Se detectó y corrigió que el acceso desde un ISBN existente mostraba autor/editorial vacíos y origen manual; ahora muestra los valores guardados.

La consulta real inicial sin clave propia respondió HTTP 429 por cuota agotada. Tras configurar la clave se completó la siguiente verificación real, independiente de las pruebas simuladas.

### GB-REAL-01: consulta, revisión y guardado con proveedor real

- **Fecha:** 19 de noviembre de 2026.
- **Objetivo:** comprobar el recorrido completo con la clave local y una respuesta real de Google Books.
- **Entorno:** aplicación Node/PGlite con base temporal en memoria; `.env` local excluido de Git. Sin modificaciones a la base persistente.
- **Pasos:** consultar ISBN `9780140328721`; comprobar que la consulta no crea registros; seleccionar la propuesta; guardar el libro con una primera copia; consultar el equivalente ISBN-10 `0140328726` y comprobar que devuelve el registro existente sin otra consulta externa. Repetir búsqueda, autocompletado y guardado desde el formulario de la aplicación.
- **Resultado:** Google Books devolvió *Fantastic Mr. Fox*, Roald Dahl, Puffin, 1988. La API guardó el libro y una copia, conservó `origen_datos='google_books'` y su identificador de volumen. La consulta equivalente detectó el registro existente. El recorrido visual confirmó título, autor, editorial, año y género autocompletados; la copia `UI-REAL-ISBN-01` quedó disponible en la base temporal.
- **Evidencia:** [captura de libro y copia guardados desde el formulario](evidencias/google-books-real.jpg).
- **Código utilizado:** `server/google-books.mjs`, `server/app.mjs` y `web/app.js`; no se modificó código durante esta verificación.
- **Conclusión:** consulta real y guardado correctos en este entorno. La prueba no garantiza que Google disponga de todos los ISBN o todos los campos bibliográficos. Los casos de cuota, ausencia de resultados y fallos se mantienen cubiertos mediante simulación.

## Calendario — 19 de noviembre de 2026

Se ejecutó la suite completa después de la corrección de feriados internos de sanciones: **69/69 pruebas aprobadas**, incluidos los 15 casos de `tests/calendar.test.mjs`.

| Casos | Resultado comprobado |
|---|---|
| CAL 01–02 | Vista mensual, fechas ausentes y año bisiesto; completar crea únicamente faltantes y conserva los días ya configurados. |
| CAL 03–05 | Rechazo de fechas inválidas/pasadas; la revisión no escribe; un feriado desplaza el vencimiento de un préstamo nuevo; un cierre impide circulación. |
| CAL 06 | Vacaciones y última semana; conserva feriados, bloquea préstamos/renovaciones y permite devoluciones; rechaza renovación que cruza vacaciones. |
| CAL 07–09 | Protege plazos existentes, rechaza todo el período incompatible, detecta una revisión desactualizada y préstamos registrados entre revisión y confirmación. |
| CAL 10–11 | Conserva los términos de sanciones por conducta y por atraso. |
| CAL 12–14 | No cambia días pasados al completar año o configurar la última semana; actualización aditiva repetible sin borrar préstamos. |
| CAL 15 | Los feriados internos cuentan dentro de la sanción y pueden configurarse sin alterar su término. |

**Comprobación visual pendiente:** se inició una instancia temporal de la aplicación, pero la herramienta de control de Windows detuvo la interacción al no poder determinar la URL del navegador con suficiente confianza. No se verificó el formulario visualmente ni se obtuvo una captura del calendario. La instancia temporal se cerró. El recorrido manual está en `docs/calendario.md`.

## Sanciones por conducta grave — 19 de noviembre de 2026

Resultado de la suite completa: **79/79 pruebas aprobadas**, incluidos los 10 casos de `tests/sanctions.test.mjs`. Se comprobó también la sintaxis de `web/app.js`.

| Casos | Resultado comprobado |
|---|---|
| SAN 01–02 | Consultar no registra; el alta usa fecha del servidor, bloquea préstamos de esa persona y permite devolver y renovar conforme a las reglas existentes. |
| SAN 03 | Cuatro reenvíos idénticos conservan una sola sanción en la API local. |
| SAN 04–05 | El término permite pedir libros sin borrar el historial; una incidencia pendiente sigue bloqueando. |
| SAN 06–07 | Un día cerrado o un calendario incompleto impide registrar y permite consultar el historial. |
| SAN 08 | Un cambio de calendario entre consulta y confirmación exige revisar nuevamente el plazo. |
| SAN 09–10 | Motivo obligatorio, límites de texto, usuario existente y fechas revisadas; feriados internos cuentan y un término cerrado se desplaza. |

**Comprobación visual pendiente:** estas pruebas verifican el servidor y la base, no los clics ni la apariencia del formulario. El recorrido manual para completar esa revisión está en `docs/sanciones.md`.

## Bloque de catálogo, historial y devoluciones — 19 de noviembre de 2026

Se implementaron las tres funciones antes de ejecutar la suite completa una sola vez: **84/84 aprobadas**, sin fallos ni repeticiones. Durante la implementación se comprobó únicamente la sintaxis. Los cinco escenarios nuevos de `tests/administration.test.mjs` reutilizan una base temporal con registros distintos por escenario.

| Caso | Resultado comprobado |
|---|---|
| ADM 01 | Editar una edición prestada conserva copias y movimientos; historial con curso original, renovación y devolución parcial con condiciones diferentes. |
| ADM 02 | ISBN equivalente, inválido y duplicado; rechazo de formulario obsoleto; asociaciones compartidas intactas; conservación o eliminación del vínculo externo según ISBN; campos opcionales vacíos. |
| ADM 03 | Condiciones y selección inválidas, pertenencia del préstamo, devolución duplicada; reversión completa cuando una copia tiene incidencia; actualizaciones repetibles sin borrar datos. |
| ADM 04 | Pérdidas pendientes y resueltas por reposición/reembolso; código de reemplazo; copia original conservada sin crear devoluciones falsas. |
| ADM 05 | Historial vacío y respuesta para usuarios, copias o libros inexistentes. |

La comprobación visual sigue pendiente. Recorrido manual: abrir Catálogo → Editar; corregir datos de prueba y confirmar; abrir Usuarios → Historial y desplegar un movimiento; revisar también Catálogo → Ver copias → Historial; devolver dos copias de prueba eligiendo bueno/desgastado y consultar su historial. Esta interacción aún no se presenta como evidencia verificada.

**Actualización posterior:** el usuario informó que revisó la página y encontró correcto su funcionamiento, solicitando mejorar la búsqueda de alumnos. Esa revisión corresponde a la versión anterior a la nueva barra de búsqueda; no se adjuntaron capturas ni un registro de casos individuales.

## Búsqueda de usuarios y respaldos — 19 de noviembre de 2026

Resultado de una única ejecución conjunta al terminar el bloque: **87/87 pruebas aprobadas**. La barra nueva tiene comprobación de sintaxis; todavía no se ha verificado visualmente su interacción. La revisión indicada por el usuario ocurrió antes de este cambio.

| Caso | Resultado comprobado |
|---|---|
| BACKUP 01 | Exportación y apertura en memoria; restauración en disco y reapertura con todas las tablas coincidentes; secuencias y reglas operativas; creación de un nuevo respaldo local y comprobación del archivo guardado. |
| BACKUP 02 | Rechazo de archivos cortados, contenido alterado, formato y versión incompatibles; detección de diferencias de contenido al restaurar. |
| BACKUP 03 | Rechazo de carpetas de destino existentes, bases ocupadas y bases inexistentes; conservación de archivos previos y bloqueos ajenos. |

El ensayo usa datos ficticios y archivos locales de prueba. No se ha creado todavía un respaldo de la base utilizada por el usuario ni se ha ensayado su activación como base principal. La restauración automática escribe siempre en una carpeta nueva. Las instrucciones están en `docs/respaldos.md`.

Recorrido pendiente del buscador: en Nuevo préstamo escribir parte de un nombre (con o sin tilde) o una identificación; seleccionar una coincidencia; comprobar los bloqueos y cupo; escribir otra búsqueda y verificar que se borre la selección anterior; probar un texto sin resultados y limpiar la búsqueda. Repetir en devoluciones.

## Avisos, cuentas, auditoría, RUT y conservación — 19 de noviembre de 2026

Resultado de la suite completa: **118/118 pruebas aprobadas** (`npm.cmd test`).

| Casos | Resultado comprobado |
|---|---|
| AVISOS 01–05 | Prepara, envía y registra `enviado`; cancela si el ejemplar ya se devolvió; registra el error sin marcar enviado; no reenvía; el texto incluye nombre, títulos y códigos. |
| AVISOS 06–08 | Reintenta un error hasta 3 intentos y luego se detiene; un aviso fallido no se reintenta si ya existe el del día siguiente. |
| AVISOS 09 | Día sin atención: no genera avisos nuevos y no falla. |
| AVISOS 10 | Envío real con nodemailer contra un servidor SMTP local levantado por la prueba: el servidor recibe el mensaje con remitente, asunto y código del ejemplar, y el aviso queda `enviado`. |
| AVISOS 11 | La programación diaria calcula la próxima ejecución (hoy o mañana) y se reprograma tras ejecutar o fallar. |
| AVISOS 12 | Panel por API: listado por estado, preparación, envío manual y respuesta cuando SMTP no está configurado. |
| AVISOS 13 | Dos avisos pendientes del mismo préstamo: se envía un solo correo (el más reciente) y el antiguo queda `cancelado`. |
| CORR 01–04 | Anulación con motivo, sin borrar historial; rechaza préstamos cerrados y copias con incidencia; la corrección es inmutable. |
| SEG 01–02 | Sin sesión responde 401; la cuenta inicial se crea una sola vez, cookie `HttpOnly`/`SameSite=Strict`, contraseña guardada como hash scrypt. |
| SEG 03–04 | Altas de operadores por rol; login incorrecto rechazado y auditado; consulta solo lee, bibliotecaria no administra, admin sí. |
| SEG 05–06 | Cada escritura queda con el operador y sin contraseñas; la auditoría no admite `UPDATE` ni `DELETE`. |
| SEG 07–10 | Siempre queda un admin activo; desactivar cierra la sesión; cerrar sesión invalida la cookie; bloqueo tras 5 fallos; funciones de hash y permisos. |
| RUT 01–02 | Normaliza puntos y guion y valida el dígito verificador en la API y en la base; otros identificadores se aceptan. |
| RET 01–02 | Conservación solo para admin; un préstamo cerrado en 2014 aparece con `conservar_hasta = 2024-03-05`, uno abierto no, y el historial sigue sin admitir `DELETE`. |

### Recorrido en navegador

Sobre una base temporal (`BIBLIOTECA_PRUEBA=1`) en http://127.0.0.1:3100:

1. Primera apertura: aparece el formulario de cuenta inicial; se crea la cuenta admin y entra a Inicio.
2. Cerrar sesión e ingresar con contraseña incorrecta: mensaje de error, sin acceso.
3. Avisos: tarjetas de SMTP (sin configurar), envío automático y última ejecución; "Preparar avisos de hoy" genera los pendientes; "Enviar ahora" desactivado sin SMTP.
4. Administración: crear un operador de consulta; aparece en la tabla y en la auditoría; la fecha de creación se muestra en hora local.
5. Ingresar como consulta: insignia "Solo lectura", sin menú Administración ni botones de alta; una escritura forzada responde "Su perfil es de solo consulta." (403).
6. Recargar la página conserva la sesión; en ancho de teléfono la barra superior se reorganiza sin desbordar.

Durante el recorrido se corrigieron: fecha de creación desplazada un día por zona horaria, datos de administración que quedaban en el DOM tras cerrar sesión y botones del encabezado que se partían en dos líneas.

### No verificado

- Envío con la cuenta SMTP real del colegio (no se tienen credenciales).
- PostgreSQL nativo con varias sesiones simultáneas: en este equipo no hay servidor PostgreSQL ni Docker. Las escrituras de circulación se serializan con `control_operacion`; queda por ejecutar dos clientes `psql` que presten la misma copia a la vez y comprobar que uno recibe el error.

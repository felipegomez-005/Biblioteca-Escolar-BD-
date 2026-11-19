# Paso 1: consulta de libros por ISBN

## Estado

La consulta, revisión y guardado están implementados y verificados con Google Books real el 19 de noviembre de 2026. Tras configurar la clave local, el ISBN `9780140328721` devolvió *Fantastic Mr. Fox*, de Roald Dahl, editorial Puffin, año 1988. Se comprobó el autocompletado, guardado con primera copia, procedencia y detección del equivalente ISBN-10 `0140328726`. La prueba usó bases temporales y no modificó la base persistente del proyecto.

Las 54 pruebas automatizadas siguen utilizando respuestas simuladas para ser reproducibles y no consumir la cuota de Google. La consulta anterior sin clave devolvió HTTP 429; la verificación actual con clave propia fue exitosa. El contenido y disponibilidad del proveedor pueden variar. [Evidencia de la prueba real](evidencias/google-books-real.jpg).

## Configurar la clave

1. En [Google Cloud Console](https://console.cloud.google.com/), seleccionar o crear el proyecto que usará la biblioteca.
2. Habilitar **Books API** para ese proyecto.
3. Crear una clave de API desde las credenciales del proyecto y restringirla a **Books API**. La solicitud se hace desde Node.js, no desde el navegador: una restricción por referentes HTTP no corresponde a este servidor local.
4. En la raíz del repositorio, copiar `.env.example` como `.env` si todavía no existe. Completar localmente `GOOGLE_BOOKS_API_KEY=...` con la clave real. No compartirla en el chat, capturas ni GitHub.
5. Reiniciar la aplicación: detener con `Ctrl+C` y ejecutar `npm.cmd start`.

El servidor carga `.env` al iniciar; requiere Node.js 20.12 o posterior. Una variable de entorno ya definida tiene prioridad sobre el archivo. `.env` está excluido de Git. La clave se utiliza únicamente en la solicitud HTTPS a Google y no se devuelve en la API ni se incluye en JavaScript del navegador.

## Probar en la aplicación

1. Abrir **Catálogo → Registrar libro**.
2. Escribir el ISBN de un libro que todavía no esté registrado y pulsar **Buscar en Google Books**.
3. Elegir **Usar estos datos** en el resultado que corresponda.
4. Revisar título, autores, editorial, año y género. Completar los datos ausentes y corregir lo necesario.
5. Ingresar un código de ejemplar si se desea registrar la primera copia.
6. Pulsar **Guardar libro** y comprobar el registro en el catálogo y en **Ver copias**.
7. Buscar nuevamente el mismo ISBN. La aplicación debe mostrar el libro existente y permitir agregar copias, sin duplicar la edición.

Si no hay resultados, la cuota está agotada o la consulta falla, se pueden ingresar los datos manualmente. Si ya se habían seleccionado datos externos, **Continuar con ingreso manual** permite guardar sin vincularlos a una consulta externa vigente. Los resultados no se guardan solos.

## Comportamiento y límites

- Valida el dígito verificador del ISBN-10/13 y guarda los nuevos ISBN como ISBN-13. El ISBN sigue siendo opcional para el ingreso manual.
- Reconoce la equivalencia ISBN-10/13 al consultar y registrar mediante la API, incluso si un registro anterior conserva ISBN-10.
- Solo propone resultados cuyos identificadores coinciden exactamente con el ISBN consultado. No usa automáticamente una edición parecida.
- Google puede omitir autores, editorial, año o categorías. Esos campos quedan vacíos para revisión; no se inventan datos ni se promete recuperar toda la información.
- Guarda `origen_datos='google_books'` y `google_books_id` cuando se utiliza una consulta válida; admite correcciones de los datos antes de guardar.
- La selección vence a los 30 minutos o al reiniciar el servidor. Es necesario consultar de nuevo o continuar manualmente.
- Las copias y sus códigos son datos de la biblioteca; Google no los proporciona.
- No cambia tablas ni reescribe registros existentes. El SQL conserva su validación de formato y unicidad textual: la validación completa y equivalencia de ISBN se aplican en esta API; una carga directa por SQL debe cumplirlas por separado.
- No cambia préstamos, calendario, sanciones, correo ni ABIES.

## API

`GET /api/libros/isbn?isbn=9780306406157` devuelve `{isbn, existente, resultados}`. Si ya existe, no consulta a Google. Si no, devuelve hasta cinco propuestas coincidentes, sin guardar datos.

Para guardar una propuesta se utiliza `POST /api/libros` con sus campos revisados, `origen_datos`, `google_books_id` y `consulta_id`. El servidor comprueba que la selección proviene de una consulta vigente del mismo ISBN. El ingreso manual omite esos identificadores y utiliza origen `manual`.

Errores: 400 para ISBN inválido; 409 para duplicado o selección vencida/incoherente; 502 para error de conexión o respuesta inválida; 503 para clave ausente/rechazada o cuota agotada. Los mensajes no exponen claves ni errores privados del proveedor.

## Referencia

[Google Books: identificación de solicitudes y búsqueda de volúmenes](https://developers.google.com/books/docs/v1/using).

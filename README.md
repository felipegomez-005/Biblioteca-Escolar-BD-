# Biblioteca escolar — Base de datos

Base independiente de desarrollo para el proyecto semestral. Usa SQL de PostgreSQL y datos ficticios para probar catálogo, préstamos, devoluciones, renovaciones y sanciones. La biblioteca real utiliza un sistema que identificó como ABIES; su versión y sus mecanismos de integración siguen pendientes de comprobar.

**Esta versión no está conectada a ABIES ni modifica sus datos.** Ya incluye una aplicación web local y una API HTTP para trabajar con la base. La consulta por ISBN a Google Books está implementada y verificada con una consulta real, revisión y guardado desde el formulario. Cada instalación debe configurar su clave local según la guía. El envío efectivo de correos continúa pendiente.

## Abrir la aplicación

En la terminal de VSCode, dentro de esta carpeta:

```powershell
npm.cmd start
```

Después abre **http://127.0.0.1:3000**. Mantén la terminal abierta; para detener la aplicación, presiona **Ctrl+C**. Los formularios guardan en la misma base local de `.local/biblioteca/`. Cerrar la pestaña no borra los datos ni apaga el servidor.

La interfaz permite:

- Registrar libros, autores, géneros y copias físicas; buscar por título, autor o ISBN.
- Editar los datos de una edición existente conservando sus copias y movimientos.
- Buscar un ISBN en Google Books, seleccionar una propuesta, revisar sus datos y guardarla. Si el libro ya existe, permite ir a sus copias. [Configuración y prueba paso a paso](docs/google-books.md).
- Registrar cursos y usuarios, editar sus datos y desactivarlos conservando el historial.
- Registrar sanciones por conducta grave desde Usuarios → Sanciones, revisar su plazo y consultar su historial. [Uso y límites](docs/sanciones.md).
- Registrar préstamos y consultar bloqueos, cupo y vencimiento.
- Buscar a la persona por nombre o identificación y seleccionarla directamente en préstamos y devoluciones.
- Devolver parcialmente o renovar los ejemplares seleccionados.
- Elegir la condición recibida (bueno o desgastado) de cada ejemplar al devolverlo.
- Consultar el historial de circulación desde Usuarios → Historial o Catálogo → Ver copias → Historial.
- Registrar pérdidas/daños permanentes y resolver incidencias por reposición o reembolso recibido.
- Consultar pendientes y estadísticas anuales.
- Administrar el calendario mensual, feriados, vacaciones y períodos de solo devoluciones, con revisión previa e historial. [Uso y prueba del calendario](docs/calendario.md).

Las devoluciones permiten registrar ejemplares buenos o desgastados; los daños permanentes se gestionan como incidencias. Las sanciones por conducta grave bloquean nuevos préstamos durante dos semanas y conservan su historial al finalizar. No se envían correos ni se realizan pagos desde la aplicación.

La API escucha solamente en `127.0.0.1`. Es una aplicación local de prueba, sin cuentas de acceso de bibliotecarios ni despliegue público. [Documentación de la API](docs/api.md).

Mientras esté abierta, no ejecutes `db:resumen` ni `db:sql` contra la misma base: PGlite permite un solo proceso propietario. `npm.cmd test` sí se puede ejecutar, porque utiliza bases temporales independientes.

## Copias de seguridad

Con la aplicación detenida, `npm.cmd run db:backup` crea y verifica una copia en `.local/respaldos/`. Para comprobarla: `npm.cmd run db:verificar -- "ruta-del-archivo.biblioteca"`. Para restaurarla en una carpeta nueva: `npm.cmd run db:restaurar -- "ruta-del-archivo.biblioteca"`. La restauración conserva intacta la base activa. [Instrucciones y activación manual](docs/respaldos.md).

## Comenzar en VSCode

Abra la terminal en esta carpeta. Requiere Node.js 20.12 o posterior.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run db:init
npm.cmd run db:resumen
npm.cmd run db:sql -- sql/05_consultas.sql
```

En este equipo la dependencia ya fue instalada y la base local inicializada. `db:init` se ejecuta una sola vez: si la base existe se detiene, sin borrar ni reemplazar datos.

Al reiniciar con `npm.cmd start`, una base existente recibe automáticamente las actualizaciones del historial de calendario y del procedimiento de devolución con condiciones. No se reemplazan sus fechas ni movimientos.

En Windows usamos `npm.cmd` para evitar que PowerShell intente ejecutar `npm.ps1` si su política bloquea scripts. No hace falta cambiar esa política.

La opción local utiliza **PGlite**, PostgreSQL empaquetado para ejecutarse dentro de Node. Guarda los datos en `.local/biblioteca/`, fuera del control de versiones. No requiere instalar un servicio de PostgreSQL ni usa el puerto 5432. No admite abrir este directorio con dos procesos simultáneos; los comandos incorporan un archivo de bloqueo. Si un proceso termina abruptamente, comprobar primero que no quede otro comando activo antes de retirar `.local/biblioteca.lock`.

Las pruebas crean otra base en memoria y no modifican la copia local. Esta opción sirve para estudiar y probar SQL; no representa un servidor de producción ni una prueba de concurrencia entre conexiones.

## Archivos

| Archivo | Contenido |
|---|---|
| `sql/01_esquema.sql` | Tablas, claves, restricciones e índices. |
| `sql/02_reglas.sql` | Calendario, bloqueos y triggers de integridad y cálculo. |
| `sql/03_operaciones.sql` | Procedimientos, indicadores y vistas. |
| `sql/04_datos_demo.sql` | Personas, libros y movimientos completamente ficticios. |
| `sql/05_consultas.sql` | Consultas para estudiar los resultados. |
| `sql/06_administracion_calendario.sql` | Actualización aditiva: historial de cambios del calendario. |
| `sql/07_devolucion_condiciones.sql` | Procedimiento de devolución con condición individual por ejemplar. |
| `docs/reglas-y-decisiones.md` | Reglas confirmadas, convenciones de implementación y alcance pendiente. |
| `docs/modelo.md` | Diagrama relacional y explicación de las tablas. |
| `docs/pruebas.md` | Casos de prueba y límites de la verificación. |
| `tests/biblioteca.test.mjs` | Pruebas automáticas ejecutables. |
| `tests/api.test.mjs` | Pruebas HTTP de consultas, formularios y operaciones. |
| `tests/calendar.test.mjs` | Pruebas de períodos, vacaciones, feriados, conflictos y actualización aditiva. |
| `tests/sanctions.test.mjs` | Pruebas del registro de sanciones, plazos, bloqueos, reintentos y validaciones. |
| `tests/administration.test.mjs` | Verificación conjunta de edición del catálogo, historial y condiciones de devolución. |
| `scripts/backup.mjs` | Comandos de respaldo, comprobación y restauración independiente. |
| `tests/backup.test.mjs` | Integridad, persistencia, secuencias y rechazo de sobrescrituras o bases ocupadas. |
| `web/` | Pantallas, estilos y comportamiento de los formularios. |
| `server/` | Servidor local, rutas de la API y validaciones. |
| `docs/api.md` | Instrucciones de uso, endpoints y alcance de la aplicación. |

## Ejecutar en un servidor PostgreSQL

Los archivos SQL no dependen de PGlite. Para un servidor PostgreSQL 17 o posterior, crear una base vacía y ejecutar en orden:

```powershell
createdb -U postgres biblioteca_escolar
psql -U postgres -d biblioteca_escolar -v ON_ERROR_STOP=1 -f sql/01_esquema.sql
psql -U postgres -d biblioteca_escolar -v ON_ERROR_STOP=1 -f sql/02_reglas.sql
psql -U postgres -d biblioteca_escolar -v ON_ERROR_STOP=1 -f sql/03_operaciones.sql
psql -U postgres -d biblioteca_escolar -v ON_ERROR_STOP=1 -f sql/04_datos_demo.sql
psql -U postgres -d biblioteca_escolar -v ON_ERROR_STOP=1 -f sql/06_administracion_calendario.sql
psql -U postgres -d biblioteca_escolar -v ON_ERROR_STOP=1 -f sql/07_devolucion_condiciones.sql
psql -U postgres -d biblioteca_escolar -v ON_ERROR_STOP=1 -f sql/05_consultas.sql
```

Los comandos `createdb` y `psql` requieren instalar PostgreSQL y configurar una cuenta local. La ejecución comprobada en esta entrega es PGlite; la validación en servidor nativo queda pendiente. Si falla un archivo, se revierte ese archivo gracias a su transacción. Los anteriores permanecen y no se deben repetir a ciegas.

## Operaciones principales

Los ejemplos siguientes son ilustrativos: los identificadores deben corresponder a registros disponibles. Ejecutar cada `CALL` como una operación; no insertar cabeceras de préstamos sueltas.

```sql
-- Devuelve el identificador del nuevo préstamo.
CALL biblioteca.sp_prestar(7, ARRAY[25,26], DATE '2026-05-04');

-- Identificar los detalles antes de renovarlos o devolverlos.
SELECT * FROM biblioteca.v_movimientos WHERE usuario_id=7;

-- Sustituir 10 por el identificador real del detalle obtenido arriba.
-- CALL biblioteca.sp_renovar(ARRAY[10], DATE '2026-05-05');
-- CALL biblioteca.sp_devolver(7, ARRAY[10], DATE '2026-05-06');

CALL biblioteca.sp_kpis_anuales(2026);
SELECT * FROM biblioteca.v_disponibilidad WHERE disponible;
SELECT * FROM biblioteca.motivos_bloqueo(2, DATE '2026-05-12');
```

Puede guardar consultas en un archivo `.sql` y ejecutarlo con `npm.cmd run db:sql -- ruta/al/archivo.sql`. Este comando ejecuta el SQL del archivo, incluidas las modificaciones: no es un visor de solo lectura.

`sp_actualizar_correo(usuario, correo, confirmar)` demuestra una actualización con `COMMIT` o `ROLLBACK` explícito. Ejecutar ese `CALL` solo, fuera de una transacción `BEGIN` del cliente. Con `false`, revierte la modificación; con `true`, la confirma. Los procedimientos de circulación son atómicos y revierten la operación completa si falla un ejemplar.

## Datos de demostración

El calendario 2026–2027, sus vacaciones y los feriados incluidos son **ficticios para las pruebas**. Deben reemplazarse por el calendario validado de la escuela antes de cualquier uso real. Una fecha sin configuración provoca un error.

Los estudiantes usan identificadores `DEMO-EST-*` y correos `example.invalid`. No se han importado RUT, nombres, fotografías ni correos reales. Los estados actuales de las vistas dependen de `CURRENT_DATE`; para estudiar sanciones históricas se usa `motivos_bloqueo(usuario, fecha)` con una fecha explícita. Esa función usa el historial conservado de vencimientos y no reconstruye versiones anteriores a una renovación posterior.

## Próximas etapas

1. Completar la comprobación visual del administrador de calendario y cargar fechas validadas del colegio. Las pruebas automáticas del calendario ya pasaron. Validar también las convenciones del documento de reglas.
2. Documentar las capturas y demostración de la API de consulta ya implementada.
3. Mantener la clave de Google Books configurada localmente. La búsqueda real, revisión y guardado ya se verificaron; repetir la comprobación al instalar en otro equipo.
4. Configurar envío de avisos, frecuencia, remitente y cancelación de avisos que ya no correspondan.
5. Verificar versión, permisos y opciones de intercambio de ABIES; acordar qué sistema mantiene cada dato.
6. Completar el informe académico: transformación paso a paso, normalización formal, decisiones asociadas a KPIs y capturas de pruebas.

## Referencias técnicas

- [Procedimientos de PostgreSQL](https://www.postgresql.org/docs/current/sql-createprocedure.html)
- [Control de transacciones en procedimientos](https://www.postgresql.org/docs/current/plpgsql-transactions.html)
- [Triggers de PostgreSQL](https://www.postgresql.org/docs/current/trigger-definition.html)
- [Ejecución local con PGlite](https://pglite.dev/docs/)

# Biblioteca escolar — Base de datos

Base independiente de desarrollo para el proyecto semestral. Usa SQL de PostgreSQL y datos ficticios para probar catálogo, préstamos, devoluciones, renovaciones y sanciones. La biblioteca real utiliza un sistema que identificó como ABIES; su versión y sus mecanismos de integración siguen pendientes de comprobar.

**Esta versión no está conectada a ABIES ni modifica sus datos.** Ya incluye una aplicación web local y una API HTTP para trabajar con la base. La consulta a Google Books y el envío efectivo de correos son próximas etapas. Se incluyen campos para la procedencia bibliográfica y una cola de avisos pendientes.

## Abrir la aplicación

En la terminal de VSCode, dentro de esta carpeta:

```powershell
npm.cmd start
```

Después abre **http://127.0.0.1:3000**. Mantén la terminal abierta; para detener la aplicación, presiona **Ctrl+C**. Los formularios guardan en la misma base local de `.local/biblioteca/`. Cerrar la pestaña no borra los datos ni apaga el servidor.

La interfaz permite:

- Registrar libros, autores, géneros y copias físicas; buscar por título, autor o ISBN.
- Registrar cursos y usuarios, editar sus datos y desactivarlos conservando el historial.
- Registrar préstamos y consultar bloqueos, cupo y vencimiento.
- Devolver parcialmente o renovar los ejemplares seleccionados.
- Registrar pérdidas/daños permanentes y resolver incidencias por reposición o reembolso recibido.
- Consultar pendientes y estadísticas anuales.

Las devoluciones normales se registran en buen estado; los daños permanentes se gestionan como incidencias. La interfaz no registra sanciones graves manuales todavía, pero sí muestra y aplica las existentes en la base. No se envían correos ni se realizan pagos desde la aplicación.

La API escucha solamente en `127.0.0.1`. Es una aplicación local de prueba, sin cuentas de acceso de bibliotecarios ni despliegue público. [Documentación de la API](docs/api.md).

Mientras esté abierta, no ejecutes `db:resumen` ni `db:sql` contra la misma base: PGlite permite un solo proceso propietario. `npm.cmd test` sí se puede ejecutar, porque utiliza bases temporales independientes.

## Comenzar en VSCode

Abra la terminal en esta carpeta. Requiere Node.js 20 o posterior.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run db:init
npm.cmd run db:resumen
npm.cmd run db:sql -- sql/05_consultas.sql
```

En este equipo la dependencia ya fue instalada y la base local inicializada. `db:init` se ejecuta una sola vez: si la base existe se detiene, sin borrar ni reemplazar datos.

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
| `docs/reglas-y-decisiones.md` | Reglas confirmadas, convenciones de implementación y alcance pendiente. |
| `docs/modelo.md` | Diagrama relacional y explicación de las tablas. |
| `docs/pruebas.md` | Casos de prueba y límites de la verificación. |
| `tests/biblioteca.test.mjs` | Pruebas automáticas ejecutables. |
| `tests/api.test.mjs` | Pruebas HTTP de consultas, formularios y operaciones. |
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

1. Validar las convenciones del documento de reglas y el calendario real.
2. Documentar las capturas y demostración de la API de consulta ya implementada.
3. Implementar búsqueda bibliográfica por ISBN, revisión del resultado e ingreso manual alternativo.
4. Configurar envío de avisos, frecuencia, remitente y cancelación de avisos que ya no correspondan.
5. Verificar versión, permisos y opciones de intercambio de ABIES; acordar qué sistema mantiene cada dato.
6. Completar el informe académico: transformación paso a paso, normalización formal, decisiones asociadas a KPIs y capturas de pruebas.

## Referencias técnicas

- [Procedimientos de PostgreSQL](https://www.postgresql.org/docs/current/sql-createprocedure.html)
- [Control de transacciones en procedimientos](https://www.postgresql.org/docs/current/plpgsql-transactions.html)
- [Triggers de PostgreSQL](https://www.postgresql.org/docs/current/trigger-definition.html)
- [Ejecución local con PGlite](https://pglite.dev/docs/)

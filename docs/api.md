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

**Usuarios:** registrar identificación ficticia, nombre, tipo y contacto. Los estudiantes requieren curso y correo. “Nuevo curso” agrega el curso y el año escolar. “Editar” permite cambiar contacto/curso y desactivar a una persona, conservando su historial.

**Nuevo préstamo:** seleccionar usuario, revisar bloqueos y seleccionar copias disponibles. La pantalla muestra el vencimiento previsto; al guardar, la base vuelve a comprobar todas las reglas. No se envía una fecha elegida por el navegador: la operación usa la fecha del servidor en America/Santiago.

**Devoluciones:** seleccionar usuario y marcar los ejemplares a entregar o renovar. Confirmar la operación. Los ejemplares restantes mantienen su propio plazo. Las devoluciones normales de esta primera interfaz corresponden a ejemplares recibidos en buen estado; para pérdida o daño permanente se registra una incidencia. La condición “desgastado” sí puede registrarse al añadir una copia, pero no se selecciona en el formulario de devolución de esta versión.

**Pendientes:** revisar atrasos e incidencias, ir a la devolución o registrar una reposición/reembolso ya aceptado por la biblioteca. La resolución no cobra dinero: registra un hecho externo. Los correos se muestran como datos de contacto; no se envían mensajes.

**Estadísticas:** seleccionar año y consultar ambos indicadores. Se cuentan operaciones por curso y ejemplares por edición; una renovación no agrega préstamos.

## Consultas GET

Estas direcciones se pueden abrir directamente en el navegador mientras la aplicación esté funcionando. Devuelven JSON obtenido mediante consultas a la base; no aceptan SQL libre.

| Ruta | Resultado |
|---|---|
| `/api/contexto` | Fecha, calendario, vencimiento previsto y cursos. |
| `/api/resumen` | Totales del panel inicial. |
| `/api/libros?q=texto` | Libros, autores, géneros, editorial y disponibilidad. |
| `/api/ejemplares?libro=1` | Copias de un libro. |
| `/api/ejemplares?disponibles=1` | Copias disponibles. |
| `/api/usuarios?q=texto` | Usuarios y cantidad de ejemplares pendientes. |
| `/api/usuarios/1/resumen` | Préstamos abiertos y motivos de bloqueo del usuario. |
| `/api/pendientes` | Ejemplares atrasados o con incidencia pendiente. |
| `/api/estadisticas?anio=2026` | Los dos KPIs del procedimiento almacenado. |

Ejemplo: `http://127.0.0.1:3000/api/estadisticas?anio=2026`.

## Escrituras

Los formularios usan JSON con `Content-Type: application/json` y `X-Biblioteca-Request: 1`. El servidor solo acepta el mismo origen local, limita el tamaño del cuerpo y usa parámetros SQL. Las rutas no constituyen una API pública autenticada: este prototipo no tiene cuentas de bibliotecarios.

| Método / ruta | Datos principales |
|---|---|
| `POST /api/libros` | `titulo`, `isbn`, `autores`, `editorial`, `generos`, `anio_publicacion`, `codigo` opcional de primera copia. |
| `POST /api/ejemplares` | `libro_id`, `codigo`, `condicion`, `observaciones`. |
| `POST /api/cursos` | `nombre`, `anio_escolar`. |
| `POST /api/usuarios` | `identificador`, `nombre`, `tipo`, `correo`, `curso_actual_id` o `cargo`. |
| `PATCH /api/usuarios/:id` | Mismos campos y `activo` booleano. |
| `POST /api/prestamos` | `usuario_id`, `ejemplares` (lista de identificadores de copias). |
| `POST /api/devoluciones` | `usuario_id`, `detalles` (lista de detalles de préstamo), `observaciones`. |
| `POST /api/renovaciones` | `usuario_id`, `detalles`. |
| `POST /api/incidencias` | `detalle_id`, `tipo` (`perdida`/`dano_permanente`), `observaciones`. |
| `POST /api/incidencias/:id/resolver` | `solucion` (`reposicion`/`reembolso`), `codigo` nuevo o `monto` recibido. |

Las escrituras devuelven 201 (alta/operación) o 200 (edición). Los errores se presentan como `{ "error": "mensaje" }` con 400 (datos), 403 (origen), 404 (registro/ruta), 409 (conflicto/regla), 413 (tamaño) o 500 (error interno). No se exponen consultas SQL ni credenciales en la respuesta.

Las transacciones de alta de libro incluyen autores, géneros y primera copia: si falla el código del ejemplar se revierte el conjunto. Los procedimientos de circulación aplican sus triggers; la API no sustituye las restricciones por validaciones visuales.

## Alcance técnico

Node.js sirve archivos HTML/CSS/JavaScript y las rutas HTTP sin nuevas dependencias de servidor. PGlite permanece abierto durante la ejecución y una cola serializa solicitudes sobre su conexión. La API incluye consultas SELECT requeridas por la guía y operaciones adicionales para la interfaz.

Pendiente: autenticación de operadores, permisos en un servidor de producción, paginación para grandes catálogos, corrección administrativa de movimientos, integración con ABIES, consulta a Google Books, correo y calendario real. No se ha publicado el sitio ni subido cambios a GitHub automáticamente.

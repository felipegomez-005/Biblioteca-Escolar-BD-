# Acceso, permisos y auditoría

Desde esta versión la aplicación exige iniciar sesión. Cada operación de escritura queda registrada con el nombre de quien la hizo.

## Primer inicio

1. `npm.cmd start` y abrir http://127.0.0.1:3000.
2. Si no existe ninguna cuenta, la página pide crear la **cuenta inicial de administración** (usuario, nombre y contraseña de 10 caracteres o más). Esta pantalla solo aparece una vez: cuando ya existe una cuenta, `/api/sesion/inicial` responde 409.
3. Desde **Administración → Operadores** se crean las cuentas de las bibliotecarias y de consulta.

Las contraseñas no se guardan: se almacena un hash **scrypt** con sal aleatoria (`scrypt$sal$hash`). La comparación usa `timingSafeEqual`.

## Roles

| Función | admin | bibliotecaria | consulta |
|---|:-:|:-:|:-:|
| Ver catálogo, usuarios, pendientes, historial, estadísticas, calendario y avisos | ✔ | ✔ | ✔ |
| Registrar libros, copias, usuarios, préstamos, devoluciones, renovaciones, incidencias y sanciones | ✔ | ✔ | — |
| Preparar y enviar avisos | ✔ | ✔ | — |
| Revisar un cambio de calendario (sin guardar) | ✔ | ✔ | ✔ |
| Guardar cambios de calendario | ✔ | — | — |
| Anular un préstamo ingresado por error | ✔ | — | — |
| Administrar operadores, ver auditoría y conservación | ✔ | — | — |

La regla vive en `server/auth.mjs` (`authorize`) y se aplica en el servidor antes de cada ruta; la interfaz solo oculta los botones que el perfil no puede usar. Rutas exclusivas de administración: `/api/operadores*`, `/api/auditoria`, `/api/retencion`, `/api/calendario/configurar` y `/api/anulaciones`. El perfil de consulta solo puede hacer `GET`, salvo `/api/calendario/previsualizar`. Un intento no autorizado responde 403 y queda auditado como `rechazado`.

Siempre debe quedar al menos una cuenta admin activa: el servidor rechaza desactivar o cambiar de rol a la última.

## Sesiones

- Cookie `biblioteca_sesion` con `HttpOnly`, `SameSite=Strict` y `Path=/`. El token es aleatorio (32 bytes) y la sesión vive en memoria del servidor.
- Expira tras **8 horas sin actividad** y al reiniciar el servidor.
- **5 intentos fallidos** seguidos bloquean el usuario durante **5 minutos**.
- Desactivar una cuenta o cambiar su contraseña cierra sus sesiones abiertas.
- Las protecciones anteriores siguen activas: el servidor escucha solo en `127.0.0.1`, rechaza otros orígenes y exige `X-Biblioteca-Request` y JSON en las escrituras.

## Auditoría

La tabla `auditoria` registra cada escritura completada, cada intento rechazado por permisos, cada inicio y cierre de sesión (incluidos los fallidos) y cada envío automático de avisos (como `sistema (programado)`). Una escritura que falla por validación se revierte completa y no deja registro, porque no cambió datos.

| Columna | Contenido |
|---|---|
| `registrado_en` | Fecha y hora del servidor. |
| `operador_id`, `operador` | Cuenta que actuó. El nombre se copia para que el registro siga legible aunque la cuenta cambie. |
| `accion`, `ruta` | Método y ruta de la API. |
| `resultado` | `ok` o `rechazado`. |
| `detalle` | Datos enviados, **sin** contraseñas ni claves (`auditDetail` las elimina). |

Un trigger impide `UPDATE` y `DELETE` sobre la tabla. La anulación de préstamos también guarda el nombre del operador de la sesión en `correccion.operador`, en lugar de pedirlo en el formulario.

## Validación de RUT

`normalizeIdentifier` (API) y la función SQL `rut_valido` (base) aplican el módulo 11. Si un identificador tiene forma de RUT (dígitos, puntos opcionales, guion y dígito verificador) se normaliza a `12345678-5` y se rechaza si el dígito no corresponde. Otros identificadores (pasaporte, IPE o los códigos ficticios `DEMO-…`) se aceptan tal cual.

La restricción `usuario_rut_valido` se creó como `NOT VALID`: se aplica a cada fila nueva o editada sin rechazar bases ya existentes. Los ISBN siguen validados por dígito verificador y normalizados a ISBN-13 (ver [google-books.md](google-books.md)).

## Pruebas

`tests/seguridad.test.mjs`: SEG 01–10, RUT 01–02 y RET 01–02. También se recorrió en el navegador: crear la cuenta inicial, contraseña incorrecta, crear un operador, cerrar sesión, ingresar con perfil de consulta (botones ocultos y 403 del servidor) y conservar la sesión al recargar.

## Límites

- Las sesiones en memoria sirven para un solo servidor. Con varios servidores habría que guardarlas en la base.
- No hay recuperación de contraseña por correo: la administración asigna una nueva desde Operadores.
- La app sigue escuchando solo en `127.0.0.1`. Publicarla en la red del colegio requiere HTTPS (proxy inverso) y revisar `Host`/origen permitidos.

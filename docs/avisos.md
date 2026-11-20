# Avisos por correo

El proyecto ya genera avisos pendientes con `sp_preparar_avisos`, pero no los enviaba. Esta entrega agrega el envío real por SMTP, el registro de cada resultado y la cancelación de avisos que ya no corresponden.

## Cómo funciona

1. `sp_preparar_avisos` crea un aviso por préstamo y fecha cuando tiene ejemplares vencidos, abiertos y sin incidencia. La deduplicación por `(préstamo, fecha)` evita repetidos.
2. Antes de enviar, se vuelve a comprobar cada aviso: si el ejemplar ya fue devuelto, renovado o tiene una incidencia, el aviso pasa a `cancelado` y no se envía.
3. El resto se envía por SMTP. Cada intento queda registrado en `aviso_correo` con estado `enviado` (con `enviado_en`), `error` (con `error_detalle`) o `cancelado`.

El destinatario es el correo registrado del usuario. El mensaje es texto plano con el nombre, los títulos, los códigos y el vencimiento de cada ejemplar atrasado.

## Requisitos

- Node.js 20.12 o posterior (ya usado por la aplicación).
- Una cuenta o servicio SMTP. Funciona con Gmail, Outlook, el correo institucional del colegio o un proveedor como Resend o SendGrid.
- Credenciales configuradas en `.env` (excluido de Git).

## Configuración

En `.env`, junto a la clave de Google Books:

```dotenv
SMTP_HOST=servidor.de.correo
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario
SMTP_PASS=clave
SMTP_FROM=Biblioteca escolar <biblioteca@colegio.cl>
```

- `SMTP_HOST` y `SMTP_FROM` son obligatorios para enviar.
- `SMTP_PORT` por defecto `587`; usar `SMTP_SECURE=true` con `465` para SSL implícito.
- `SMTP_USER`/`SMTP_PASS` se omiten solo si el servidor no exige autenticación.

Para Gmail se recomienda una “contraseña de aplicación” (App Password), no la contraseña de la cuenta.

## Comandos

Con la aplicación detenida (la base no admite dos procesos):

```powershell
npm.cmd run avisos:enviar                # prepara y envía; registra enviado/error/cancelado
npm.cmd run avisos:enviar -- --simular   # prepara y lista, sin enviar ni modificar
npm.cmd run avisos:preparar              # solo genera los pendientes
```

Se puede fijar una fecha distinta a hoy con `AVISOS_FECHA=2026-06-08` para revisar un día concreto. Si hoy la biblioteca está cerrada, el comando no genera avisos y termina sin error.

## Frecuencia

El comando es idempotente por día: cada ejecución crea como máximo un aviso por préstamo y fecha. La frecuencia se controla programando la ejecución:

- Windows: una tarea del **Programador de tareas** que ejecute `npm.cmd run avisos:enviar` en la carpeta del repositorio, una vez al día a una hora de atención.
- Linux/macOS: una entrada de `cron`, por ejemplo `15 8 * * 1-5 cd /ruta/repo && npm run avisos:enviar`.

Con una ejecución diaria se envía un recordatorio por cada día de atraso; con una semanal, uno por semana. La frecuencia definitiva debe acordarse con la biblioteca.

## Registro y errores

La tabla `aviso_correo` conserva el estado y el detalle del error de cada intento. Para revisarla:

```powershell
npm.cmd run db:sql -- sql/05_consultas.sql
```

o con un archivo SQL propio que consulte `aviso_correo` (columnas `estado`, `enviado_en`, `error_detalle`). Un aviso en `error` puede reintentarse volviendo a ejecutar `avisos:enviar`; solo se reenvía si sigue pendiente y con ejemplares vencidos.

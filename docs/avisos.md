# Avisos por correo

La aplicación prepara, envía y registra recordatorios de devolución por SMTP. Se pueden enviar desde la pantalla **Avisos**, de forma automática una vez al día o con un comando.

## Cómo funciona

1. **Preparar.** `sp_preparar_avisos(fecha)` crea un aviso por préstamo y fecha cuando el préstamo tiene ejemplares vencidos, abiertos y sin incidencia. La clave única `(prestamo_id, fecha_generacion)` impide duplicados. Si la biblioteca no atiende ese día, o la fecha no está en el calendario, no se generan avisos nuevos (los existentes se siguen procesando).
2. **Reemplazar.** Si un préstamo tiene un aviso pendiente antiguo y otro más reciente, el antiguo pasa a `cancelado`: la persona recibe un solo correo con la situación actual.
3. **Revisar.** Antes de enviar se vuelven a leer los ejemplares. Si ya se devolvieron, se renovaron fuera del atraso o tienen una incidencia, el aviso pasa a `cancelado` y no se envía. **Nunca se avisa por un libro ya devuelto.**
4. **Enviar y registrar.** El resto se envía por SMTP. Cada intento suma `intentos` y guarda `ultimo_intento`. El resultado queda en `aviso_correo`:
   - `enviado`, con `enviado_en`;
   - `error`, con `error_detalle` (mensaje del servidor de correo, sin credenciales);
   - `cancelado`.
5. **Reintentar.** Un aviso en `error` se reintenta en la siguiente ejecución hasta completar **3 intentos** (`MAX_INTENTOS`). Si ya existe un aviso más reciente del mismo préstamo, el que falló no se reintenta (quedaría duplicado) y conserva su estado `error` como evidencia.

El destinatario es el correo registrado del usuario al momento de generar el aviso. El mensaje es texto plano con el nombre, los títulos, los códigos y el vencimiento de cada ejemplar atrasado.

## Configuración SMTP

En `.env` (excluido de Git), junto a la clave de Google Books:

```dotenv
SMTP_HOST=servidor.de.correo
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=usuario
SMTP_PASS=clave
SMTP_FROM=Biblioteca escolar <biblioteca@colegio.cl>

# Envío automático diario dentro de la aplicación
AVISOS_AUTOMATICOS=1
AVISOS_HORA=08:30
```

- `SMTP_HOST` y `SMTP_FROM` son obligatorios para enviar. Sin ellos se pueden preparar avisos, pero no enviarlos.
- `SMTP_PORT` por defecto `587`; usar `SMTP_SECURE=true` con `465` para SSL implícito.
- `SMTP_USER`/`SMTP_PASS` se omiten solo si el servidor no exige autenticación.
- Para Gmail u Outlook se recomienda una "contraseña de aplicación", no la contraseña de la cuenta.

La cuenta real del colegio **no está configurada en este repositorio**: debe entregarla la biblioteca. El envío se probó con un servidor SMTP local de prueba (AVISOS 10), no con una cuenta institucional.

## Frecuencia y automatización

Cada ejecución crea como máximo un aviso por préstamo y día. Con una ejecución diaria, una persona atrasada recibe un recordatorio por cada día de atención; con una semanal, uno por semana. **La frecuencia definitiva debe acordarse con la biblioteca**; la propuesta es diaria en días de atención.

Hay dos formas de automatizarla:

1. **Dentro de la aplicación (recomendada).** Con `AVISOS_AUTOMATICOS=1` y SMTP configurado, `npm.cmd start` programa el envío todos los días a `AVISOS_HORA` (hora local, formato `HH:MM`, por defecto `08:30`). La pantalla Avisos muestra la próxima ejecución y el resultado de la última. Si SMTP no está configurado, la programación se ignora y se informa en la consola.
2. **Tarea externa.** Con la aplicación detenida (PGlite admite un solo proceso), programar `npm.cmd run avisos:enviar` en el Programador de tareas de Windows o en `cron` (`30 8 * * 1-5 cd /ruta/repo && npm run avisos:enviar`).

## Pantalla Avisos

- Estado de SMTP, del envío automático y de la última ejecución.
- Tabla de avisos con filtro por estado, destinatario, intentos y detalle del error.
- **Preparar avisos de hoy:** genera los pendientes sin enviarlos.
- **Enviar ahora:** prepara, reemplaza, cancela, envía y reintenta. Se desactiva si SMTP no está configurado.
- Los perfiles de solo consulta ven la tabla, pero no los botones. Cada envío manual queda en la auditoría con el nombre del operador.

## Comandos

Con la aplicación detenida:

```powershell
npm.cmd run avisos:enviar                # prepara y envía; registra enviado/error/cancelado
npm.cmd run avisos:enviar -- --simular   # prepara y lista, sin enviar ni modificar
npm.cmd run avisos:preparar              # solo genera los pendientes
```

Se puede fijar otra fecha con `AVISOS_FECHA=2026-06-08` para revisar un día concreto.

## Pruebas

`tests/avisos.test.mjs` (AVISOS 01–13) cubre envío y registro, cancelación de devueltos, errores, no reenvío, contenido del mensaje, reintentos y su máximo, no duplicar al reintentar, día cerrado, SMTP real con nodemailer contra un servidor local, programación diaria, la API del panel y el reemplazo de un pendiente antiguo por uno más reciente.

## Pendiente

- Cuenta SMTP real del colegio y frecuencia acordada.
- Si docentes y asistentes también deben recibir avisos, registrar su correo (hoy es obligatorio solo para estudiantes).

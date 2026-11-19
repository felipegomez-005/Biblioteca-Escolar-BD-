# Sanciones por conducta grave

## Uso

1. Abrir la aplicación y entrar en **Usuarios**.
2. Buscar a la persona y pulsar **Sanciones** en su fila.
3. Revisar su historial y elegir **Registrar sanción**.
4. Comprobar el usuario, la fecha de inicio y la fecha de término. Escribir el motivo de la decisión comunicada por el colegio.
5. Pulsar **Confirmar sanción**. La lista de usuarios mostrará el bloqueo y su término.

El inicio corresponde a hoy, según la fecha del servidor en Chile. No se puede elegir una fecha pasada ni futura. Si la biblioteca está cerrada o faltan fechas necesarias en el calendario, se informa el impedimento y no se permite registrar.

Dos semanas equivalen al mismo día de la semana, dos semanas después. Los feriados intermedios cuentan. Si el día de término está cerrado, se mueve al siguiente día de atención. Por ejemplo, en el calendario ficticio, una sanción del jueves 28 de mayo de 2026 termina el viernes 12 de junio: el jueves 11 está configurado como feriado.

Desde el día de término deja de aplicarse esta sanción, pero una deuda, incidencia u otro bloqueo pendiente puede seguir impidiendo nuevos préstamos. Las devoluciones y renovaciones conservan sus propias reglas.

## Controles y límites

- El motivo es obligatorio, con un máximo de 1000 caracteres.
- Antes de guardar se recalculan las fechas. Si cambiaron desde que se abrió el formulario, hay que cerrarlo y volver a abrirlo para revisarlas.
- Reenviar la misma solicitud del mismo usuario, día y motivo conserva un solo registro. Un motivo diferente corresponde a otro registro y no reemplaza la sanción anterior.
- El historial sigue disponible cuando termina el bloqueo. Todavía no existe una operación de corrección o anulación.
- El sistema registra una decisión del colegio; no determina si una conducta merece sanción.
- Este prototipo local todavía no identifica al operador ni controla permisos mediante cuentas de acceso.

## Comprobación manual pendiente

Usar personas ficticias en la base de demostración. Registrar una sanción sí cambia los datos de esa base y todavía no se puede anular desde la pantalla.

1. Revisar que el historial muestre al usuario seleccionado y sus fechas sin cortes de texto.
2. Abrir el formulario y comprobar que no permite confirmar con el motivo vacío.
3. Registrar una sanción de prueba y comprobar que aparece en el historial y en la lista de usuarios.
4. En **Nuevo préstamo**, seleccionar a esa persona: debe mostrar el bloqueo y no permitir prestar.
5. Comprobar que otro usuario sin bloqueos puede pedir libros y que las devoluciones siguen disponibles para la persona sancionada.

El servidor y la base ya pasaron los 10 casos automáticos de sanciones. Los clics y la apariencia de esta pantalla siguen pendientes de verificación.

# Reglas y decisiones de la versión independiente

Origen de requisitos: cuestionario de la biblioteca y aclaraciones transmitidas por el grupo en la conversación. Los documentos de entrega deberán agregar sus fechas de entrevista y la confirmación de la contraparte. No se atribuyen a la biblioteca las decisiones de implementación señaladas aquí.

## Reglas confirmadas

| ID | Regla | Aplicación |
|---|---|---|
| RN01 | Piden libros estudiantes, docentes y asistentes. | Tipo de usuario y correo obligatorio para estudiantes. |
| RN02 | Máximo tres ejemplares simultáneos por persona, incluso en operaciones diferentes. | Trigger `validar_detalle`. |
| RN03 | Una operación contiene entre uno y tres ejemplares. | Procedimiento, trigger y comprobación diferida de cabecera no vacía. |
| RN04 | Cada copia física tiene un código único y no puede tener dos préstamos activos. | Código único e índice único parcial. |
| RN05 | Plazo inicial de tres días hábiles, igual para todos los detalles de la operación. | Calendario y vencimiento inicial. |
| RN06 | Se puede renovar uno, varios o todos los ejemplares, hasta dos veces cada uno. | Registros individuales de renovación. |
| RN07 | Cada renovación suma tres días hábiles desde el vencimiento vigente. | Trigger de cálculo actualiza plazo y contador. |
| RN08 | Un ejemplar atrasado no se renueva. | Validación de fecha. |
| RN09 | Se permiten devoluciones anticipadas y parciales. | Operación de devolución con uno o varios detalles. |
| RN10 | No se presta ni se renueva en la última semana antes de vacaciones de invierno y verano. | Banderas de calendario; sí se pueden recibir devoluciones. |
| RN11 | Se rechaza una renovación que dejaría la devolución en vacaciones. | El plazo no puede entrar ni cruzar un intervalo de vacaciones. |
| RN12 | Atraso suspende una semana desde el inicio del atraso; deuda pendiente sigue bloqueando. | Bloqueos calculados independientemente. |
| RN13 | Conducta grave suspende dos semanas. | Tabla sanción y formulario Usuarios → Sanciones; cada registro queda auditado con el operador. |
| RN14 | Una/dos semanas de sanción terminan el mismo día de semana siguiente/dos semanas después. Los feriados cuentan. | Sumar 7/14 días calendario y desplazar el término al siguiente día de atención. |
| RN15 | Feriados y fines de semana no son días hábiles del préstamo. | Calendario explícito. |
| RN16 | Pérdida o daño permanente se resuelve por reposición o reembolso. | Incidencia pendiente bloquea; se conserva el ejemplar original como baja. |
| RN17 | Historial de préstamos y devoluciones se conserva diez años. | Historial protegido; vista `v_retencion` de candidatos desde el cierre; sin purga automática ([retencion.md](retencion.md)). |
| RN18 | Indicadores anuales: operaciones de préstamo por curso y ejemplares prestados por libro. | `sp_kpis_anuales`; renovaciones no aumentan los conteos. |
| RN19 | Se requieren avisos por correo. | Cola deduplicada, envío SMTP, hasta 3 intentos, cancelación de resueltos, envío diario automático opcional y panel Avisos ([avisos.md](avisos.md)); quedan por acordar la cuenta real y la frecuencia. |

## Convenciones de esta implementación que deben validarse

- El día en que se presta no se cuenta: se suman tres días hábiles posteriores. Esta precisión no fue respondida expresamente.
- Como el grupo indicó que las sanciones comienzan en días de atención, el inicio de la sanción por atraso se calcula como el primer día hábil después del vencimiento. Un préstamo vencido el viernes bloquea por deuda desde el sábado, pero su semana de sanción empieza el lunes, si está abierto. Confirmar esta interpretación para ese caso límite.
- Se considera habilitado desde el día de término, no al día siguiente; los intervalos de sanción son `[inicio, habilitado_desde)`.
- El calendario informa días de atención y períodos de vacaciones. La última semana se configura por fechas, no se deduce de un supuesto calendario nacional.
- La pantalla de vacaciones pide el lunes de la última semana de clases y aplica lunes a viernes anteriores al inicio, conservando los cierres existentes. Esta selección debe corresponder al calendario entregado por el colegio. Solo se modifican días desde hoy; completar un año no incorpora feriados oficiales automáticamente.
- Una reposición requiere una copia nueva de la misma edición y código nuevo. Si la biblioteca acepta títulos equivalentes o reutiliza códigos, adaptar la regla.
- Resolver una incidencia no levanta una sanción independiente todavía vigente. No se genera automáticamente una sanción grave de dos semanas por toda pérdida: el bloqueo por incidencia es independiente y la sanción grave se registra cuando corresponda.
- La cola genera como máximo un aviso por préstamo y fecha. El envío automático propuesto es diario en días de atención (`AVISOS_HORA`, 08:30 por defecto); la frecuencia final debe acordarse con la biblioteca.
- El colegio imparte de Pre-kínder a 8.º básico con un curso por nivel. Esos diez cursos se crean siempre por defecto (año actual y siguiente, `sql/11_cursos_colegio.sql`); se pueden agregar otros a mano, pero no se borran ni renombran cursos anteriores para conservar el curso histórico de los préstamos.
- La conservación de diez años se cuenta desde el cierre del último ejemplar del préstamo.
- La fotografía del usuario no se almacena: no la exige ninguna regla y aumenta los datos personales tratados. Se puede agregar si el colegio la pide.
- El indicador por libro agrupa por edición (`libro.id`); si se quiere agrupar distintas ediciones de una obra, habrá que introducir esa distinción.
- La resolución de una incidencia registra lo aceptado por la bibliotecaria; el sistema no decide el precio de reembolso.

## Integridad y operación

Las funciones y procedimientos trabajan en el esquema `biblioteca`. El administrador de la base puede modificar el esquema; por eso estos controles no sustituyen roles y permisos de una aplicación futura. Para circulación se usan los procedimientos. Las fechas explícitas sirven para datos ficticios y pruebas; una futura API debe tomar la fecha del servidor y restringir la carga retrospectiva a un flujo administrativo.

Las escrituras de circulación actualizan una fila de control para serializar validaciones. Es una decisión simple para una sola biblioteca, no una optimización para alta concurrencia. Se requiere probar sesiones simultáneas en PostgreSQL nativo antes de ofrecer servicio multiusuario. Ante errores de serialización, la aplicación futura debe reintentar la operación completa.

El historial de movimientos es inmutable en esta versión. La corrección de préstamos se realiza mediante anulación: `sp_anular_prestamo` registra el motivo y el operador en `correccion` y cierra los ejemplares abiertos como una devolución marcada "Anulación: …". Otros tipos de corrección (por ejemplo, revertir una devolución) quedan pendientes. No borrar ejemplares prestados: se conserva su identidad y se registra la baja. La retención es de al menos diez años, sin borrado automático al cumplir ese plazo.

El formulario de sanciones registra una decisión del colegio con motivo obligatorio, inicio en la fecha del servidor y revisión del término calculado. Exigir el motivo y evitar duplicados exactos del mismo usuario, día y motivo son decisiones de implementación. Una sanción vigente no impide registrar otro hecho distinto; los bloqueos se evalúan de forma independiente. La sanción impide nuevos préstamos, pero no agrega restricciones a devoluciones o renovaciones, que mantienen sus reglas existentes. Todavía no se permite corregir ni borrar sanciones desde la aplicación.

La administración del calendario utiliza revisión previa, control de versión, revalidación al confirmar y una transacción que incluye el historial de cambios. Protege días pasados, intervalos usados para plazos y fechas que determinan sanciones. Los feriados internos de las sanciones pueden cambiar si no afectan otra fecha protegida, porque cuentan dentro de sus semanas. Estas protecciones adicionales se aplican en la API, no mediante un trigger sobre ediciones SQL directas. La pantalla aún requiere comprobación visual; las pruebas automáticas pasaron.

El catálogo acepta autores/editorial desconocidos, ISBN nulo y varios autores/géneros. La API valida el dígito verificador y normaliza nuevos ISBN a ISBN-13; también comprueba duplicados equivalentes ISBN-10/ISBN-13. La restricción SQL sigue validando formato y unicidad textual, por lo que las cargas directas requieren normalización y validación propias. No se reescriben ISBN anteriores. Google Books solo propone coincidencias exactas, sujetas a revisión antes de guardar. El nombre de autor no se supone único, para permitir homónimos.

La edición de un libro conserva sus identificadores y las copias asociadas. Revisa una huella de los datos leídos para evitar sobrescribir otra edición del formulario. Cambiar su ISBN a una edición distinta elimina el vínculo anterior a Google Books; las equivalencias 10/13 lo conservan. El formulario sirve para corregir datos, no para convertir ejemplares prestados en otra edición. Los nombres de autores y editoriales compartidos no se modifican globalmente. Todavía no se conserva una auditoría de las versiones bibliográficas anteriores.

Las devoluciones permiten elegir bueno o desgastado por copia mediante `sp_devolver_condiciones`; los triggers existentes conservan la validación y el cierre del movimiento. Pérdida y daño permanente continúan usando incidencias. El procedimiento original sigue disponible para clientes anteriores que registran todo en buen estado.

El historial visual muestra cada detalle del préstamo con sus renovaciones, devolución o incidencia y resolución. Una reposición conserva la copia original y presenta el código de reemplazo. El curso es histórico; títulos y nombres reflejan los datos actuales. Consultar estos movimientos no modifica la base.

La fotografía no se incluye en esta primera base: era un dato mencionado en la entrevista, pero no es necesario para probar los préstamos. La interfaz futura deberá decidir si la requiere. Los datos personales reales no forman parte del poblamiento académico.

## Pendiente para la integración y la entrega completa

ABIES: versión, instalación y permisos, formatos de intercambio, identificadores externos y sistema responsable de cada registro. No se promete escritura directa en su base ni sincronización automática. Propuesta y preguntas en [abies.md](abies.md).

Aplicación: interfaz local, API, Google Books (verificado con una consulta real), avisos SMTP con reintentos y envío diario, cuentas con roles, auditoría, validación de RUT e ISBN, respaldos y conservación están implementados y probados ([seguridad.md](seguridad.md), [avisos.md](avisos.md)). Falta: cuenta SMTP real del colegio y frecuencia acordada; calendario real validado; correo de docentes y asistentes si también deben recibir avisos; prueba con PostgreSQL nativo y varias sesiones simultáneas (en este equipo no hay servidor PostgreSQL ni Docker); HTTPS si se publica en la red del colegio.

Académico: la transformación E-R → relacional, las dependencias funcionales, la normalización, los KPIs y la trazabilidad están en [normalizacion.md](normalizacion.md). Falta que el grupo adjunte la evidencia del cliente (ficha, autorización, entrevistas), las capturas para el informe y la presentación.

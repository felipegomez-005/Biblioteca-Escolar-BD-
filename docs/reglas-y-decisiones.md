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
| RN13 | Conducta grave suspende dos semanas. | Tabla sanción; registro manual por persona autorizada. |
| RN14 | Una/dos semanas de sanción terminan el mismo día de semana siguiente/dos semanas después. Los feriados cuentan. | Sumar 7/14 días calendario y desplazar el término al siguiente día de atención. |
| RN15 | Feriados y fines de semana no son días hábiles del préstamo. | Calendario explícito. |
| RN16 | Pérdida o daño permanente se resuelve por reposición o reembolso. | Incidencia pendiente bloquea; se conserva el ejemplar original como baja. |
| RN17 | Historial de préstamos y devoluciones se conserva diez años. | Historial protegido; no se implementa purga automática. |
| RN18 | Indicadores anuales: operaciones de préstamo por curso y ejemplares prestados por libro. | `sp_kpis_anuales`; renovaciones no aumentan los conteos. |
| RN19 | Se requieren avisos por correo. | Correo en usuarios y cola pendiente; el envío externo aún no está implementado. |

## Convenciones de esta implementación que deben validarse

- El día en que se presta no se cuenta: se suman tres días hábiles posteriores. Esta precisión no fue respondida expresamente.
- Como el grupo indicó que las sanciones comienzan en días de atención, el inicio de la sanción por atraso se calcula como el primer día hábil después del vencimiento. Un préstamo vencido el viernes bloquea por deuda desde el sábado, pero su semana de sanción empieza el lunes, si está abierto. Confirmar esta interpretación para ese caso límite.
- Se considera habilitado desde el día de término, no al día siguiente; los intervalos de sanción son `[inicio, habilitado_desde)`.
- El calendario informa días de atención y períodos de vacaciones. La última semana se configura por fechas, no se deduce de un supuesto calendario nacional.
- Una reposición requiere una copia nueva de la misma edición y código nuevo. Si la biblioteca acepta títulos equivalentes o reutiliza códigos, adaptar la regla.
- Resolver una incidencia no levanta una sanción independiente todavía vigente. No se genera automáticamente una sanción grave de dos semanas por toda pérdida: el bloqueo por incidencia es independiente y la sanción grave se registra cuando corresponda.
- La cola permite generar como máximo un aviso por préstamo y fecha, solo cuando se llama al procedimiento. Esto no establece una frecuencia automática acordada con la biblioteca.
- El indicador por libro agrupa por edición (`libro.id`); si se quiere agrupar distintas ediciones de una obra, habrá que introducir esa distinción.
- La resolución de una incidencia registra lo aceptado por la bibliotecaria; el sistema no decide el precio de reembolso.

## Integridad y operación

Las funciones y procedimientos trabajan en el esquema `biblioteca`. El administrador de la base puede modificar el esquema; por eso estos controles no sustituyen roles y permisos de una aplicación futura. Para circulación se usan los procedimientos. Las fechas explícitas sirven para datos ficticios y pruebas; una futura API debe tomar la fecha del servidor y restringir la carga retrospectiva a un flujo administrativo.

Las escrituras de circulación actualizan una fila de control para serializar validaciones. Es una decisión simple para una sola biblioteca, no una optimización para alta concurrencia. Se requiere probar sesiones simultáneas en PostgreSQL nativo antes de ofrecer servicio multiusuario. Ante errores de serialización, la aplicación futura debe reintentar la operación completa.

El historial de movimientos es inmutable en esta versión; todavía no existe un flujo de corrección administrativa. No borrar ejemplares prestados: se conserva su identidad y se registra la baja. La retención es de al menos diez años, sin borrado automático al cumplir ese plazo.

El catálogo acepta autores/editorial desconocidos, ISBN nulo y varios autores/géneros. El ISBN se almacena sin guiones; la restricción valida formato y unicidad textual, no el dígito verificador ni equivalencia ISBN-10/ISBN-13. La importación futura debe normalizar y validar antes de guardar. El nombre de autor no se supone único, para permitir homónimos.

La fotografía no se incluye en esta primera base: era un dato mencionado en la entrevista, pero no es necesario para probar los préstamos. La interfaz futura deberá decidir si la requiere. Los datos personales reales no forman parte del poblamiento académico.

## Pendiente para la integración y la entrega completa

ABIES: versión, instalación y permisos, formatos de intercambio, identificadores externos y sistema responsable de cada registro. No se promete escritura directa en su base ni sincronización automática.

Aplicación: la interfaz local y la API de consulta/escritura ya están implementadas. La API toma la fecha del servidor para circulación y no admite fechas enviadas por los formularios. Siguen pendientes la consulta a Google Books, remitente/proveedor de correo, frecuencia de avisos, reintentos y cancelación de recordatorios resueltos. Los avisos de docentes y asistentes requerirán registrar su correo si también deben recibirlos. Antes de usar la aplicación fuera de este prototipo local se deben definir las cuentas de acceso y roles de operadores.

Académico: ficha/autorización y evidencias de entrevistas; explicación completa de transformación E-R a relacional, dependencias funcionales y normalización; decisiones del negocio que sustentan los dos indicadores; capturas de pruebas e informe final. Esta base inicial no equivale a la entrega completa.

# Paso 2: administración del calendario

## Estado de la función

Se implementaron la vista mensual, configuración por períodos, revisión antes de guardar e historial de cambios. Las 69 pruebas automatizadas pasaron el 19 de noviembre de 2026; 15 corresponden al calendario. La comprobación visual manual queda pendiente: la herramienta de control del navegador detuvo la sesión porque no pudo identificar con seguridad su dirección actual. No se presenta esa revisión visual como completada.

ABIES sigue fuera de esta etapa. Tampoco se han reemplazado las fechas ficticias por el calendario oficial del colegio.

## Abrir y actualizar

1. Si la aplicación estaba abierta, detenerla con `Ctrl+C`.
2. Ejecutar `npm.cmd start` y abrir `http://127.0.0.1:3000/#calendario`.
3. El arranque añade automáticamente la tabla de historial si no existe. No se necesita repetir `db:init` y no se borran datos.

La actualización está en `sql/06_administracion_calendario.sql`. En una instalación PostgreSQL administrada manualmente se debe ejecutar ese archivo una vez; es repetible. Los comandos de inicialización de una base nueva ya lo incluyen.

## Uso

- Seleccionar un mes para consultar sus días. Los días pasados se muestran como solo lectura.
- Pulsar un día futuro o **Configurar período** para indicar fechas, tipo de atención y motivo.
- Pulsar **Revisar cambios**. Se muestran el estado anterior, el estado propuesto y los conflictos detectados.
- Pulsar **Confirmar cambios** si la revisión es correcta. Se guarda todo el período y su historial en una misma transacción.
- Si se modifica un campo después de revisar, se exige revisar de nuevo. Si otro cambio o un préstamo vuelve incompatible la propuesta, se rechaza al guardar.

### Tipos de atención

| Tipo | Comportamiento |
|---|---|
| Atención normal | Abre de lunes a viernes y habilita préstamos, renovaciones y devoluciones. Cierra fines de semana. Reemplaza estados anteriores del período: revisar antes de reabrir un feriado. |
| Feriado o cierre | Cierra la biblioteca. No permite operaciones de circulación ese día. No se considera vacaciones. |
| Solo devoluciones | Impide préstamos y renovaciones. Conserva feriados, cierres y vacaciones existentes; no reabre días cerrados. |
| Vacaciones | Cierra todo el intervalo, incluidos fines de semana, y lo marca como vacaciones para impedir plazos que las atraviesen. |

Al configurar vacaciones se indica también el lunes de la última semana de clases. Su viernes debe terminar antes de las vacaciones y estar dentro de los siete días previos. Esa semana queda solo para devoluciones; se conservan los días ya cerrados. Si parte de esa semana ya pasó, solo se cambian los días desde hoy. Esta selección explícita evita deducir fechas oficiales que el colegio todavía no ha entregado.

**Completar días faltantes del año** agrega exclusivamente fechas que no existen, desde hoy en adelante. Propone lunes a viernes abiertos y fines de semana cerrados. No sobrescribe registros existentes ni incorpora automáticamente feriados nacionales o vacaciones. Después se deben revisar esos días con el calendario del colegio.

## Protección del historial

- No se editan días anteriores a la fecha del servidor en America/Santiago.
- Se rechazan cambios de apertura o vacaciones en intervalos ya usados para calcular préstamos. No se recalculan automáticamente vencimientos guardados.
- Se protegen fechas de movimientos registrados y los días que determinan el inicio o término de sanciones.
- Los feriados internos de una sanción siguen contando. Si no afectan un préstamo u otra fecha protegida, se permite configurarlos sin cambiar el término de la sanción.
- Una propuesta incompatible no se guarda parcialmente.
- El historial almacena fecha de registro, motivo y estados anterior/posterior de cada día. Todavía no identifica un operador porque las cuentas de acceso están pendientes.

Estas protecciones se aplican desde la API local. Las restricciones básicas de coherencia también están en SQL. Una persona con acceso administrativo directo a SQL puede modificar tablas fuera del flujo de la aplicación; los permisos de un servidor de producción siguen pendientes.

## API

| Ruta | Función |
|---|---|
| `GET /api/calendario?mes=2026-11` | Días del mes, fechas sin configurar e historial de los ocho últimos cambios. |
| `POST /api/calendario/previsualizar` | Valida la propuesta y devuelve cambios, conflictos y versión; no escribe datos. |
| `POST /api/calendario/configurar` | Revalida y guarda la propuesta con la versión recibida en la revisión. |

Un período incluye `desde`, `hasta`, `tipo` y `motivo`. Vacaciones añade `ultima_semana` (lunes). Completar año utiliza `tipo='completar'` y `anio`. La confirmación añade `version`. La fecha actual no se acepta del navegador.

## Prueba manual pendiente

Para probar sin alterar la base persistente, abrir una terminal aparte y ejecutar:

```powershell
$env:BIBLIOTECA_PRUEBA='1'
$env:PORT='3011'
npm.cmd start
```

Abrir `http://127.0.0.1:3011/#calendario`. Al terminar, detener con `Ctrl+C` y cerrar esa terminal para no reutilizar esas variables en el arranque normal.

1. Elegir un día hábil futuro sin préstamos asociados y configurarlo como feriado con un motivo ficticio.
2. Revisar los cambios y confirmar. Comprobar que figura cerrado y aparece en el historial.
3. Preparar unas vacaciones y su última semana. Revisar que las vacaciones cierren todos sus días y la semana anterior permita solo devoluciones, conservando cierres.
4. Consultar un año futuro sin configurar y completar sus días. Comprobar fines de semana cerrados.
5. Registrar un préstamo ficticio y tratar de cerrar su vencimiento. La revisión debe mostrar el conflicto e impedir confirmar.

Los datos de ese modo desaparecen al detener el servidor. Ninguno de estos cierres ficticios representa el calendario real del colegio.

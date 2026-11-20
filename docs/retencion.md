# Conservación de diez años (RN17)

La biblioteca pidió conservar el historial de préstamos y devoluciones durante **diez años**. La política implementada es:

- El plazo se cuenta **desde el cierre** del préstamo: la fecha en que se cerró su último ejemplar (devolución, anulación o resolución de la incidencia). Un préstamo con algún ejemplar abierto nunca es candidato.
- La vista `biblioteca.v_retencion` lista los préstamos cuyo plazo ya venció (`conservar_hasta < CURRENT_DATE`), con usuario, fecha del préstamo y fecha de cierre.
- **No hay purga automática.** El historial sigue protegido por triggers contra `UPDATE` y `DELETE`. Un borrado accidental de datos que el colegio debe conservar es peor que guardar registros de más.
- La consulta está en **Administración → Conservación de datos** y en `GET /api/retencion`, solo para el perfil admin. También informa cuántos registros de auditoría superan los diez años.

## Procedimiento para archivar (cuando haya candidatos)

1. Detener la aplicación y crear un respaldo: `npm.cmd run db:backup`.
2. Comprobarlo: `npm.cmd run db:verificar -- "ruta-del-archivo.biblioteca"`.
3. Guardar el archivo fuera del equipo (unidad del colegio), con la fecha en el nombre.
4. La eliminación de esos registros, si el colegio la decide, la hace la persona administradora de la base, dejando constancia escrita. Requiere desactivar temporalmente la protección del historial, por lo que no se ofrece desde la aplicación.

Con los datos de demostración (2026) la vista está vacía: ningún préstamo cumple diez años hasta 2036. RET 01 comprueba esa respuesta vacía y que el perfil de consulta recibe 403. RET 02 configura un calendario de prueba de marzo de 2014, presta y devuelve un ejemplar (cierre 2014-03-05) y comprueba que aparece con `conservar_hasta = 2024-03-05`; otro préstamo igual de antiguo pero abierto no aparece, y el historial sigue rechazando `DELETE`.

## Respaldos

Ver [respaldos.md](respaldos.md). Se recomienda un respaldo semanal y otro antes de cada cambio de versión, guardando al menos uno por año durante el mismo plazo de diez años.

## Datos personales

Conservar el historial implica conservar datos personales (Ley 19.628 y Ley 21.719 cuando entre en vigencia). Este repositorio solo contiene datos ficticios. Antes de usar datos reales, el colegio debe definir quién accede (roles de [seguridad.md](seguridad.md)), dónde se guardan los respaldos y cómo se atienden las solicitudes de los titulares.

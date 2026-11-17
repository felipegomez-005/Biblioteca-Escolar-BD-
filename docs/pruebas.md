# Verificación de la primera base

## Ejecución

`npm.cmd test` ejecuta 42 pruebas: 29 de base de datos y 13 de API. Cada archivo de pruebas crea una base nueva en memoria y ejecuta los cuatro scripts SQL. Cada caso ordinario de base se revierte al terminar; los casos de COMMIT/ROLLBACK se ejecutan por separado porque prueban control explícito de transacciones. Las pruebas HTTP usan un puerto local libre y su propia base temporal. No se modifica la base persistente de `.local/`.

## Casos cubiertos

| Casos | Objetivo y resultado esperado |
|---|---|
| 01–03 | Agrupar tres copias, impedir superar tres simultáneas en operaciones distintas e impedir doble préstamo de una copia. |
| 04 | Devolución parcial libera solo la copia devuelta y permite completar el cupo. |
| 05–07 | Renovar desde vencimiento, actualizar atributos calculados, impedir tercera renovación y renovación atrasada. |
| 08–10 | Excluir feriados/fines de semana; última semana solo devoluciones; impedir cruzar vacaciones. |
| 11–13 | Sanción desde atraso, bloqueo independiente por deuda y dos semanas por conducta grave con feriado al término. |
| 14–15 | Pérdida/reposición y daño/reembolso mantienen el historial y no crean devoluciones falsas. |
| 16–18 | Impedir devolución duplicada/ajena, preservar curso histórico y calcular correctamente los dos indicadores. |
| 19–20 | Correo obligatorio del estudiante; avisos pendientes deduplicados y sin envío. |
| 21–23 | Rechazar calendario desconocido/día cerrado; reversión completa si falla un elemento de una renovación múltiple. |
| 24–27 | Proteger historial y atributos derivados, rechazar operaciones vacías/repetidas y comprobar asociaciones. |
| 28–29 | Comprobar ROLLBACK y COMMIT explícitos del procedimiento de actualización. |

Cada prueba tiene un nombre, pasos SQL y resultado verificable en `tests/biblioteca.test.mjs`. La salida de la ejecución identifica cuál pasó o falló. Las capturas y el análisis individual para el formato académico de la guía aún deben incorporarse a las evidencias finales.

## Límites

La prueba se ejecuta en PGlite, que utiliza PostgreSQL dentro de un proceso. Se verifica la API HTTP local, pero no un servidor PostgreSQL nativo, sesiones de base simultáneas, correo SMTP, Google Books ni ABIES. Los fallos de concurrencia/reintentos y el rendimiento con grandes volúmenes requieren pruebas adicionales cuando se configure un servidor.

## API e interfaz

Las 13 pruebas HTTP comprueban carga de la página, endpoints SELECT, alta de catálogo, transacción revertida por código duplicado, copias, cursos/usuarios, préstamo con fecha de servidor, límite de cupo, devolución parcial, renovación, pertenencia de los detalles al usuario, incidencia/reposición, actualización de usuario, rechazo de origen externo, consultas parametrizadas y restricciones de ISBN.

También se realizó una prueba manual en el navegador sobre una base temporal: registrar un libro con copia, registrar un estudiante, prestar dos ejemplares, renovar solo uno, devolver el otro y comprobar las fechas y el ejemplar restante. Se revisaron inicio, catálogo, usuarios, circulación y estadísticas. No se observaron errores de consola en ese recorrido. Esta comprobación visual no reemplaza las pruebas automatizadas ni es una certificación de accesibilidad.

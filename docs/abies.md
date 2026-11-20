# Integración con ABIES (pendiente)

La biblioteca usa un programa que identificó como ABIES. Esta entrega **no se conecta a ABIES** ni modifica sus datos. Este documento deja definida la forma de integración propuesta y lo que falta averiguar.

## Decisión

- **Sin escritura directa en la base de ABIES.** ABIES suele usar una base local (Access en versiones antiguas) cuyo esquema no está documentado públicamente para terceros. Escribir en ella arriesga corromper el catálogo real.
- **Intercambio por archivos.** Importar el catálogo exportado por ABIES (MARC21/ISO 2709 o planilla) y, si se requiere, exportar desde este sistema en un formato que ABIES pueda importar.
- **Un dueño por dato.** Se acuerda qué sistema manda en cada entidad para no tener dos versiones distintas del mismo registro.

| Dato | Propuesta de sistema responsable |
|---|---|
| Catálogo bibliográfico (título, autores, ISBN, editorial) | ABIES, importado periódicamente. |
| Ejemplares y códigos de barra | ABIES; el código se conserva igual en ambos. |
| Lectores (estudiantes y personal) | Por definir: ABIES o el registro del colegio. |
| Préstamos, renovaciones, devoluciones, sanciones y avisos | Este sistema. |

## Correspondencia de campos (borrador)

| Este sistema | ABIES (por confirmar con la versión instalada) |
|---|---|
| `libro.isbn` | ISBN del fondo |
| `libro.titulo`, `autor.nombre`, `editorial.nombre`, `anio_publicacion` | Título, autor, editorial, año |
| `genero.nombre` | CDU o materia |
| `ejemplar.codigo` | Código de barras / número de registro |
| `usuario.identificador` | Número de lector o RUT |

Una importación nueva agregaría `libro.origen_datos = 'abies'` y un identificador externo, siguiendo el mismo patrón ya usado para Google Books (`origen_datos`, `google_books_id`).

## Preguntas para la biblioteca

1. ¿Qué versión de ABIES está instalada (2.x de escritorio, Abies Web u otra)?
2. ¿Quién la administra y con qué permisos se puede exportar?
3. ¿Qué formatos de exportación ofrece (MARC, CSV, Excel)? ¿Se puede entregar un archivo de ejemplo con datos ficticios o anonimizados?
4. ¿Los códigos de barra de los ejemplares ya están impresos y pegados? ¿Se mantienen?
5. ¿ABIES gestiona hoy los préstamos? Si es así, ¿se seguirá usando para eso o se reemplaza?
6. ¿Con qué frecuencia cambia el catálogo (compras, bajas)?

Con esas respuestas se puede implementar un comando `catalogo:importar` que lea el archivo, valide ISBN y códigos, muestre una revisión previa y cargue en una transacción, igual que el resto de las altas.

# Modelo de la base independiente

Este es el modelo relacional implementado. Evoluciona la propuesta de las diapositivas para representar calendario, sanciones, incidencias y avisos. Los rectángulos son tablas; PK identifica la clave primaria y FK la clave foránea. Las tablas intermedias resuelven las relaciones N:M del modelo conceptual.

```mermaid
erDiagram
    EDITORIAL o|--o{ LIBRO : publica
    LIBRO ||--o{ LIBRO_AUTOR : tiene
    AUTOR ||--o{ LIBRO_AUTOR : participa
    LIBRO ||--o{ LIBRO_GENERO : clasifica
    GENERO ||--o{ LIBRO_GENERO : agrupa
    LIBRO ||--o{ EJEMPLAR : posee
    CURSO o|--o{ USUARIO : curso_actual
    CURSO o|--o{ PRESTAMO : curso_historico
    USUARIO ||--o{ PRESTAMO : solicita
    PRESTAMO ||--|{ DETALLE_PRESTAMO : contiene
    EJEMPLAR ||--o{ DETALLE_PRESTAMO : historial
    DETALLE_PRESTAMO ||--o{ RENOVACION : amplia
    USUARIO ||--o{ DEVOLUCION : entrega
    DEVOLUCION ||--|{ DETALLE_DEVOLUCION : contiene
    DETALLE_PRESTAMO ||--o| DETALLE_DEVOLUCION : se_devuelve
    DETALLE_PRESTAMO ||--o| INCIDENCIA : puede_tener
    EJEMPLAR o|--o| INCIDENCIA : reemplazo
    USUARIO ||--o{ SANCION : recibe
    PRESTAMO ||--o{ AVISO_CORREO : genera
    EDITORIAL {
      int id PK
      text nombre UK
    }
    AUTOR {
      int id PK
      text nombre
    }
    LIBRO {
      int id PK
      text titulo
      text isbn UK
      int editorial_id FK
      text origen_datos
      text google_books_id UK
    }
    LIBRO_AUTOR {
      int libro_id PK,FK
      int autor_id PK,FK
    }
    GENERO {
      int id PK
      text nombre UK
    }
    LIBRO_GENERO {
      int libro_id PK,FK
      int genero_id PK,FK
    }
    EJEMPLAR {
      int id PK
      int libro_id FK
      text codigo UK
      text condicion
    }
    CURSO {
      int id PK
      text nombre
      int anio_escolar
    }
    USUARIO {
      int id PK
      text identificador UK
      text nombre
      text tipo
      text correo
      int curso_actual_id FK
      boolean activo
    }
    PRESTAMO {
      int id PK
      int usuario_id FK
      int curso_al_prestar_id FK
      date fecha
      date vencimiento_inicial
    }
    DETALLE_PRESTAMO {
      int id PK
      int prestamo_id FK
      int ejemplar_id FK
      date vencimiento_vigente
      int cantidad_renovaciones
      date fecha_cierre
    }
    RENOVACION {
      int id PK
      int detalle_id FK
      date fecha
      date vencimiento_anterior
      date nuevo_vencimiento
    }
    DEVOLUCION {
      int id PK
      int usuario_id FK
      date fecha
    }
    DETALLE_DEVOLUCION {
      int id PK
      int devolucion_id FK
      int detalle_prestamo_id FK,UK
      text condicion_recibida
      text observaciones
    }
    SANCION {
      int id PK
      int usuario_id FK
      date inicio
      date habilitado_desde
      text motivo
    }
    INCIDENCIA {
      int id PK
      int detalle_id FK,UK
      date fecha
      text tipo
      date fecha_resolucion
      text solucion
      int ejemplar_reemplazo_id FK,UK
      numeric monto_reembolso
    }
    AVISO_CORREO {
      int id PK
      int prestamo_id FK
      date fecha_generacion
      text destinatario
      text estado
    }
    CALENDARIO {
      date fecha PK
      boolean abierto
      boolean permite_prestamo
      boolean permite_renovacion
      boolean vacaciones
      text motivo
    }
```

## Cómo leerlo

- Libro describe una edición; Ejemplar identifica la copia física.
- Usuario es la persona que pide libros. No es una cuenta de acceso de la aplicación.
- Préstamo agrupa entre 1 y 3 detalles (la pata de gallo representa varios; el máximo 3 se aplica en SQL).
- Cada detalle admite 0 a 2 renovaciones y 0 a 1 devolución. La clave única de `detalle_devolucion.detalle_prestamo_id` materializa el 1:1 opcional.
- Una devolución puede agrupar varios ejemplares del mismo usuario, incluso de préstamos distintos.
- Una incidencia no es una devolución ficticia. Se resuelve con una reposición o un reembolso; se guarda el cierre del detalle sin crear una entrega del ejemplar perdido.
- La sanción por atraso se obtiene del historial al consultar. La tabla Sanción registra la conducta grave de dos semanas. La deuda y la sanción se comprueban independientemente.
- Calendario es una tabla de referencia consultada por funciones. Se exige cobertura de las fechas utilizadas, sin convertir todos los atributos de fecha en relaciones del diagrama.
- `control_operacion` es una tabla técnica de una fila para coordinar escrituras; no es una entidad del negocio y se omite del gráfico.
- `cambio_calendario` es una bitácora técnica añadida por `06_administracion_calendario.sql`: guarda identificador, instante de registro, período, tipo, motivo, cantidad de días y una captura JSON de los valores anteriores/posteriores. No es una entidad del préstamo y se omite del gráfico de negocio. Sus capturas documentan cambios; no sustituyen la tabla relacional `calendario` que utilizan las reglas.

## Transformación y normalización: base para el informe

Las entidades principales tienen claves propias. Las relaciones 1:N se materializan mediante claves foráneas en el lado N; las N:M Libro–Autor y Libro–Género mediante claves compuestas en tablas intermedias. El 1:1 opcional usa una FK `UNIQUE` en DetalleDevolución. No se requieren entidades débiles para este diseño.

La relación Curso–Préstamo guarda el curso en el momento del préstamo, mientras que Curso–Usuario representa el curso actual. Un cambio de nivel no reescribe el pasado.

Las claves determinan los atributos de su propia tabla: `libro.id → título, ISBN, editorial, año, origen`; `ejemplar.id → libro, código, condición`; `prestamo.id → usuario, fecha, curso histórico, vencimiento inicial`; `detalle.id → préstamo, ejemplar, vencimiento vigente, contador, cierre`. En las tablas de asociación no hay atributos que dependan de una sola parte de su clave. Nombres de editoriales, autores y cursos se separan de los movimientos para evitar duplicarlos.

`vencimiento_vigente`, `cantidad_renovaciones` y `fecha_cierre` son datos derivados materializados para las operaciones. Se conservan mediante triggers y se prohíbe su modificación directa. Su almacenamiento debe explicarse en el informe como decisión de consistencia y acceso, sin ocultar que existe información calculable a partir del historial.

El destinatario de un aviso es una captura del correo al generarlo, no el correo actual del usuario. El plazo de sanción guardado corresponde al calendario usado al registrarla. La nueva administración del calendario rechaza cambios que alterarían fechas utilizadas por movimientos o sanciones. No incluye una reprogramación de vencimientos históricos.

Esta explicación es una base de trabajo, no la justificación formal por cada relación ni los tres diagramas finales exigidos por la guía. El esquema SQL contiene todos los atributos y restricciones, incluidos los no mostrados para facilitar la lectura.

-- PostgreSQL. Ejecutar una sola vez en una base vacía; no elimina datos existentes.
BEGIN;
CREATE SCHEMA biblioteca;
SET search_path TO biblioteca, public;

CREATE TABLE editorial (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL UNIQUE CHECK (btrim(nombre) <> '')
);
CREATE TABLE autor (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL CHECK (btrim(nombre) <> '')
);
CREATE TABLE genero (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL UNIQUE
);
CREATE TABLE libro (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    titulo text NOT NULL CHECK (btrim(titulo) <> ''),
    isbn text UNIQUE CHECK (isbn ~ '^([0-9]{13}|[0-9]{9}[0-9X])$'),
    editorial_id integer REFERENCES editorial(id),
    anio_publicacion integer CHECK (anio_publicacion BETWEEN 1 AND 9999),
    origen_datos text NOT NULL DEFAULT 'manual' CHECK (origen_datos IN ('manual','google_books')),
    google_books_id text UNIQUE,
    CHECK (origen_datos <> 'google_books' OR google_books_id IS NOT NULL)
);
CREATE TABLE libro_autor (
    libro_id integer REFERENCES libro(id),
    autor_id integer REFERENCES autor(id),
    PRIMARY KEY (libro_id, autor_id)
);
CREATE TABLE libro_genero (
    libro_id integer REFERENCES libro(id),
    genero_id integer REFERENCES genero(id),
    PRIMARY KEY (libro_id, genero_id)
);
CREATE TABLE ejemplar (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    libro_id integer NOT NULL REFERENCES libro(id),
    codigo text NOT NULL UNIQUE CHECK (btrim(codigo) <> ''),
    condicion text NOT NULL DEFAULT 'bueno' CHECK (condicion IN ('bueno','desgastado','danado','perdido','baja')),
    observaciones text
);
CREATE TABLE curso (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL,
    anio_escolar integer NOT NULL CHECK (anio_escolar BETWEEN 2000 AND 9999),
    UNIQUE (nombre, anio_escolar)
);
CREATE TABLE usuario (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    identificador text NOT NULL UNIQUE,
    nombre text NOT NULL CHECK (btrim(nombre) <> ''),
    tipo text NOT NULL CHECK (tipo IN ('estudiante','docente','asistente')),
    correo text CHECK (correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    curso_actual_id integer REFERENCES curso(id),
    cargo text,
    activo boolean NOT NULL DEFAULT true,
    CHECK (tipo <> 'estudiante' OR (correo IS NOT NULL AND curso_actual_id IS NOT NULL)),
    CHECK (tipo = 'estudiante' OR curso_actual_id IS NULL)
);
-- Cobertura explícita: una fecha ausente provoca error; no se inventan feriados.
CREATE TABLE calendario (
    fecha date PRIMARY KEY,
    abierto boolean NOT NULL,
    permite_prestamo boolean NOT NULL,
    permite_renovacion boolean NOT NULL,
    vacaciones boolean NOT NULL DEFAULT false,
    motivo text NOT NULL,
    CHECK (NOT permite_prestamo OR abierto),
    CHECK (NOT permite_renovacion OR abierto),
    CHECK (NOT vacaciones OR (NOT abierto AND NOT permite_prestamo AND NOT permite_renovacion))
);
CREATE TABLE prestamo (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id integer NOT NULL REFERENCES usuario(id),
    fecha date NOT NULL,
    curso_al_prestar_id integer REFERENCES curso(id),
    vencimiento_inicial date NOT NULL,
    CHECK (vencimiento_inicial > fecha)
);
CREATE TABLE detalle_prestamo (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prestamo_id integer NOT NULL REFERENCES prestamo(id),
    ejemplar_id integer NOT NULL REFERENCES ejemplar(id),
    vencimiento_vigente date NOT NULL,
    cantidad_renovaciones integer NOT NULL DEFAULT 0 CHECK (cantidad_renovaciones BETWEEN 0 AND 2),
    fecha_cierre date,
    UNIQUE (prestamo_id, ejemplar_id)
);
CREATE UNIQUE INDEX ejemplar_un_prestamo_abierto ON detalle_prestamo(ejemplar_id) WHERE fecha_cierre IS NULL;
CREATE INDEX prestamo_por_usuario ON prestamo(usuario_id, fecha);
CREATE INDEX detalle_por_prestamo ON detalle_prestamo(prestamo_id);
CREATE TABLE renovacion (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    detalle_id integer NOT NULL REFERENCES detalle_prestamo(id),
    fecha date NOT NULL,
    vencimiento_anterior date NOT NULL,
    nuevo_vencimiento date NOT NULL,
    CHECK (nuevo_vencimiento > vencimiento_anterior)
);
CREATE INDEX renovacion_por_detalle ON renovacion(detalle_id);
CREATE TABLE devolucion (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id integer NOT NULL REFERENCES usuario(id),
    fecha date NOT NULL
);
CREATE TABLE detalle_devolucion (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    devolucion_id integer NOT NULL REFERENCES devolucion(id),
    detalle_prestamo_id integer NOT NULL UNIQUE REFERENCES detalle_prestamo(id),
    condicion_recibida text NOT NULL CHECK (condicion_recibida IN ('bueno','desgastado')),
    observaciones text
);
CREATE INDEX detalle_por_devolucion ON detalle_devolucion(devolucion_id);
CREATE TABLE sancion (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id integer NOT NULL REFERENCES usuario(id),
    inicio date NOT NULL,
    habilitado_desde date NOT NULL,
    motivo text NOT NULL DEFAULT 'conducta_grave' CHECK (motivo = 'conducta_grave'),
    observaciones text,
    CHECK (habilitado_desde > inicio)
);
CREATE INDEX sancion_por_usuario ON sancion(usuario_id);
CREATE TABLE incidencia (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    detalle_id integer NOT NULL UNIQUE REFERENCES detalle_prestamo(id),
    fecha date NOT NULL,
    tipo text NOT NULL CHECK (tipo IN ('perdida','dano_permanente')),
    observaciones text,
    fecha_resolucion date,
    solucion text CHECK (solucion IN ('reposicion','reembolso')),
    ejemplar_reemplazo_id integer UNIQUE REFERENCES ejemplar(id),
    monto_reembolso numeric(12,2) CHECK (monto_reembolso > 0),
    CHECK (fecha_resolucion IS NULL OR fecha_resolucion >= fecha),
    CHECK (
      (fecha_resolucion IS NULL AND solucion IS NULL AND ejemplar_reemplazo_id IS NULL AND monto_reembolso IS NULL)
      OR (fecha_resolucion IS NOT NULL AND solucion IS NOT NULL AND solucion = 'reposicion' AND ejemplar_reemplazo_id IS NOT NULL AND monto_reembolso IS NULL)
      OR (fecha_resolucion IS NOT NULL AND solucion IS NOT NULL AND solucion = 'reembolso' AND monto_reembolso IS NOT NULL AND ejemplar_reemplazo_id IS NULL)
    )
);
-- Cola de trabajo: estos registros no envían mensajes por sí solos.
CREATE TABLE aviso_correo (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prestamo_id integer NOT NULL REFERENCES prestamo(id),
    fecha_generacion date NOT NULL,
    destinatario text NOT NULL,
    asunto text NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','error','cancelado')),
    enviado_en timestamptz,
    UNIQUE (prestamo_id, fecha_generacion),
    CHECK ((estado = 'enviado') = (enviado_en IS NOT NULL))
);
-- Serializa operaciones de circulación en este prototipo de una sola biblioteca.
-- UPDATE, además del bloqueo de fila, detecta conflictos con snapshots antiguos.
CREATE TABLE control_operacion (id integer PRIMARY KEY CHECK (id=1), revision bigint NOT NULL);
INSERT INTO control_operacion VALUES (1,0);
COMMIT;

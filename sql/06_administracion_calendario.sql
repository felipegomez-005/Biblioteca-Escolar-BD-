-- Actualización aditiva: puede ejecutarse sobre una base existente.
-- No reemplaza el calendario ni cambia plazos de movimientos guardados.
BEGIN;
CREATE TABLE IF NOT EXISTS biblioteca.cambio_calendario (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    registrado_en timestamptz NOT NULL DEFAULT now(),
    desde date NOT NULL,
    hasta date NOT NULL CHECK (hasta >= desde),
    tipo text NOT NULL CHECK (tipo IN ('normal','cerrado','solo_devoluciones','vacaciones','completar')),
    motivo text NOT NULL CHECK (btrim(motivo) <> ''),
    cantidad integer NOT NULL CHECK (cantidad > 0),
    cambios jsonb NOT NULL CHECK (jsonb_typeof(cambios)='array')
);
COMMIT;

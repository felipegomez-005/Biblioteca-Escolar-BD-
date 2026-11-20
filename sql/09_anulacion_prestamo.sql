-- Actualización aditiva y repetible: corrección de préstamos ingresados por error.
-- Conserva el historial inmutable: la anulación registra el motivo y cierra los
-- ejemplares abiertos mediante una devolución cuyo detalle indica "Anulación: …".
BEGIN;
SET search_path TO biblioteca, public;

CREATE TABLE IF NOT EXISTS correccion (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prestamo_id integer NOT NULL REFERENCES prestamo(id),
    fecha date NOT NULL,
    motivo text NOT NULL CHECK (btrim(motivo) <> ''),
    operador text,
    observaciones text
);
CREATE INDEX IF NOT EXISTS correccion_por_prestamo ON correccion(prestamo_id);

CREATE OR REPLACE PROCEDURE sp_anular_prestamo(
    IN p_prestamo integer,
    IN p_motivo text,
    IN p_fecha date DEFAULT CURRENT_DATE,
    IN p_operador text DEFAULT NULL,
    IN p_observaciones text DEFAULT NULL
) LANGUAGE plpgsql AS $$
DECLARE
    usuario_prestamo integer;
    devolucion_id integer;
    d RECORD;
    cond text;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    PERFORM biblioteca.validar_atencion(p_fecha, 'anulacion');
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Indique el motivo de la anulación';
    END IF;
    SELECT usuario_id INTO STRICT usuario_prestamo FROM biblioteca.prestamo WHERE id = p_prestamo;
    IF NOT EXISTS (SELECT 1 FROM biblioteca.detalle_prestamo WHERE prestamo_id = p_prestamo AND fecha_cierre IS NULL) THEN
        RAISE EXCEPTION 'El préstamo no tiene ejemplares abiertos que anular';
    END IF;
    IF EXISTS (SELECT 1 FROM biblioteca.detalle_prestamo dp
               JOIN biblioteca.incidencia i ON i.detalle_id = dp.id
               WHERE dp.prestamo_id = p_prestamo AND dp.fecha_cierre IS NULL) THEN
        RAISE EXCEPTION 'Resuelva antes las incidencias de este préstamo';
    END IF;
    INSERT INTO biblioteca.correccion(prestamo_id, fecha, motivo, operador, observaciones)
      VALUES (p_prestamo, p_fecha, p_motivo, p_operador, p_observaciones);
    INSERT INTO biblioteca.devolucion(usuario_id, fecha) VALUES (usuario_prestamo, p_fecha)
      RETURNING id INTO devolucion_id;
    FOR d IN SELECT dp.id AS detalle, e.condicion
             FROM biblioteca.detalle_prestamo dp
             JOIN biblioteca.ejemplar e ON e.id = dp.ejemplar_id
             WHERE dp.prestamo_id = p_prestamo AND dp.fecha_cierre IS NULL
             ORDER BY dp.id
    LOOP
        cond := CASE WHEN d.condicion = 'desgastado' THEN 'desgastado' ELSE 'bueno' END;
        INSERT INTO biblioteca.detalle_devolucion(devolucion_id, detalle_prestamo_id, condicion_recibida, observaciones)
          VALUES (devolucion_id, d.detalle, cond, 'Anulación: ' || p_motivo);
    END LOOP;
END $$;

DROP TRIGGER IF EXISTS correccion_immutable ON correccion;
CREATE TRIGGER correccion_immutable BEFORE UPDATE OR DELETE ON correccion
  FOR EACH ROW EXECUTE FUNCTION biblioteca.impedir_cambio_historial();

COMMIT;

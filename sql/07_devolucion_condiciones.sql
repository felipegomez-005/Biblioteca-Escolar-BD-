-- Actualización repetible. Conserva el procedimiento anterior para sus clientes existentes.
BEGIN;
CREATE OR REPLACE PROCEDURE biblioteca.sp_devolver_condiciones(
    IN p_usuario integer, IN p_detalles integer[], IN p_condiciones text[],
    IN p_fecha date DEFAULT CURRENT_DATE, IN p_observaciones text DEFAULT NULL,
    INOUT p_devolucion integer DEFAULT NULL
) LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    IF p_detalles IS NULL OR cardinality(p_detalles) NOT BETWEEN 1 AND 3 OR
      (SELECT count(DISTINCT x) FROM unnest(p_detalles) x)<>cardinality(p_detalles) OR
      p_condiciones IS NULL OR cardinality(p_condiciones)<>cardinality(p_detalles) OR
      EXISTS(SELECT 1 FROM unnest(p_condiciones) x WHERE x IS NULL OR x NOT IN ('bueno','desgastado')) THEN
        RAISE EXCEPTION 'Seleccione entre uno y tres detalles distintos y una condición válida por ejemplar';
    END IF;
    IF array_ndims(p_detalles)<>1 OR array_ndims(p_condiciones)<>1 OR
       array_lower(p_detalles,1)<>1 OR array_lower(p_condiciones,1)<>1 THEN
        RAISE EXCEPTION 'Las listas de devolución deben ser unidimensionales y comenzar en uno';
    END IF;
    INSERT INTO biblioteca.devolucion(usuario_id,fecha) VALUES(p_usuario,p_fecha) RETURNING id INTO p_devolucion;
    FOR n IN 1..cardinality(p_detalles) LOOP
        INSERT INTO biblioteca.detalle_devolucion(devolucion_id,detalle_prestamo_id,condicion_recibida,observaciones)
          VALUES(p_devolucion,p_detalles[n],p_condiciones[n],p_observaciones);
    END LOOP;
END $$;
COMMIT;

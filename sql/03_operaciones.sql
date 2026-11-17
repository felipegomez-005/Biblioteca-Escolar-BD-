BEGIN;
SET search_path TO biblioteca, public;

CREATE PROCEDURE sp_prestar(
    IN p_usuario integer, IN p_ejemplares integer[], IN p_fecha date DEFAULT CURRENT_DATE,
    INOUT p_prestamo integer DEFAULT NULL
) LANGUAGE plpgsql AS $$
DECLARE e integer;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    IF p_ejemplares IS NULL OR cardinality(p_ejemplares) NOT BETWEEN 1 AND 3
      OR EXISTS (SELECT 1 FROM unnest(p_ejemplares) x WHERE x IS NULL)
      OR (SELECT count(DISTINCT x) FROM unnest(p_ejemplares) x)<>cardinality(p_ejemplares) THEN
        RAISE EXCEPTION 'Seleccione de uno a tres ejemplares distintos';
    END IF;
    INSERT INTO biblioteca.prestamo(usuario_id,fecha) VALUES(p_usuario,p_fecha) RETURNING id INTO p_prestamo;
    FOREACH e IN ARRAY p_ejemplares LOOP
        INSERT INTO biblioteca.detalle_prestamo(prestamo_id,ejemplar_id) VALUES(p_prestamo,e);
    END LOOP;
END $$;

CREATE PROCEDURE sp_renovar(IN p_detalles integer[], IN p_fecha date DEFAULT CURRENT_DATE)
LANGUAGE plpgsql AS $$
DECLARE d integer;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    IF p_detalles IS NULL OR cardinality(p_detalles)=0 OR
      (SELECT count(DISTINCT x) FROM unnest(p_detalles) x)<>cardinality(p_detalles) THEN
        RAISE EXCEPTION 'Seleccione detalles distintos para renovar';
    END IF;
    FOREACH d IN ARRAY p_detalles LOOP
        INSERT INTO biblioteca.renovacion(detalle_id,fecha) VALUES(d,p_fecha);
    END LOOP;
END $$;

CREATE PROCEDURE sp_devolver(
    IN p_usuario integer, IN p_detalles integer[], IN p_fecha date DEFAULT CURRENT_DATE,
    IN p_observaciones text DEFAULT NULL, INOUT p_devolucion integer DEFAULT NULL
) LANGUAGE plpgsql AS $$
DECLARE d integer;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    IF p_detalles IS NULL OR cardinality(p_detalles)=0 OR
      (SELECT count(DISTINCT x) FROM unnest(p_detalles) x)<>cardinality(p_detalles) THEN
        RAISE EXCEPTION 'Seleccione detalles distintos para devolver';
    END IF;
    INSERT INTO biblioteca.devolucion(usuario_id,fecha) VALUES(p_usuario,p_fecha) RETURNING id INTO p_devolucion;
    FOREACH d IN ARRAY p_detalles LOOP
        INSERT INTO biblioteca.detalle_devolucion(devolucion_id,detalle_prestamo_id,condicion_recibida,observaciones)
          VALUES(p_devolucion,d,'bueno',p_observaciones);
    END LOOP;
END $$;

CREATE PROCEDURE sp_registrar_incidencia(IN p_detalle integer, IN p_tipo text, IN p_fecha date,
    IN p_observaciones text DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO biblioteca.incidencia(detalle_id,tipo,fecha,observaciones)
      VALUES(p_detalle,p_tipo,p_fecha,p_observaciones);
END $$;

CREATE PROCEDURE sp_resolver_incidencia(IN p_incidencia integer, IN p_fecha date, IN p_solucion text,
    IN p_codigo_reemplazo text DEFAULT NULL, IN p_monto numeric DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE i biblioteca.incidencia%ROWTYPE; libro_original integer; nuevo integer;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    SELECT * INTO STRICT i FROM biblioteca.incidencia WHERE id=p_incidencia;
    IF i.fecha_resolucion IS NOT NULL THEN RAISE EXCEPTION 'Incidencia ya resuelta'; END IF;
    IF p_solucion IS NULL OR p_solucion NOT IN ('reposicion','reembolso') THEN
        RAISE EXCEPTION 'Solución inválida';
    END IF;
    IF p_solucion='reposicion' THEN
        IF p_codigo_reemplazo IS NULL OR btrim(p_codigo_reemplazo)='' OR p_monto IS NOT NULL THEN
            RAISE EXCEPTION 'Reposición requiere código nuevo y no un monto';
        END IF;
        SELECT e.libro_id INTO libro_original FROM biblioteca.ejemplar e
          JOIN biblioteca.detalle_prestamo d ON d.ejemplar_id=e.id WHERE d.id=i.detalle_id;
        INSERT INTO biblioteca.ejemplar(libro_id,codigo) VALUES(libro_original,p_codigo_reemplazo) RETURNING id INTO nuevo;
    ELSE
        IF p_codigo_reemplazo IS NOT NULL OR p_monto IS NULL OR p_monto<=0 THEN
            RAISE EXCEPTION 'Reembolso requiere un monto positivo';
        END IF;
    END IF;
    UPDATE biblioteca.incidencia SET fecha_resolucion=p_fecha,solucion=p_solucion,
      ejemplar_reemplazo_id=nuevo,monto_reembolso=p_monto WHERE id=p_incidencia;
END $$;

CREATE PROCEDURE sp_sancionar_conducta(IN p_usuario integer, IN p_fecha date, IN p_observaciones text DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO biblioteca.sancion(usuario_id,inicio,observaciones) VALUES(p_usuario,p_fecha,p_observaciones);
END $$;

CREATE PROCEDURE sp_kpis_anuales(IN p_anio integer, INOUT p_por_curso jsonb DEFAULT NULL,
    INOUT p_libros_mas_prestados jsonb DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_anio IS NULL OR p_anio NOT BETWEEN 2000 AND 9998 THEN RAISE EXCEPTION 'Año inválido'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.prestamos DESC,q.curso),'[]'::jsonb) INTO p_por_curso FROM (
      SELECT c.id AS curso_id,coalesce(c.nombre,'Sin curso: docentes/asistentes') AS curso,
        c.anio_escolar,count(*) AS prestamos
      FROM biblioteca.prestamo p LEFT JOIN biblioteca.curso c ON c.id=p.curso_al_prestar_id
      WHERE p.fecha>=make_date(p_anio,1,1) AND p.fecha<make_date(p_anio+1,1,1)
      GROUP BY c.id,c.nombre,c.anio_escolar
    ) q;
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.ejemplares_prestados DESC,q.libro_id),'[]'::jsonb)
      INTO p_libros_mas_prestados FROM (
      SELECT l.id AS libro_id,l.titulo,count(*) AS ejemplares_prestados
      FROM biblioteca.prestamo p JOIN biblioteca.detalle_prestamo d ON d.prestamo_id=p.id
        JOIN biblioteca.ejemplar e ON e.id=d.ejemplar_id JOIN biblioteca.libro l ON l.id=e.libro_id
      WHERE p.fecha>=make_date(p_anio,1,1) AND p.fecha<make_date(p_anio+1,1,1)
      GROUP BY l.id,l.titulo
    ) q;
END $$;

-- Generación explícita, no programada. Deduplicación por operación y fecha.
CREATE PROCEDURE sp_preparar_avisos(IN p_fecha date DEFAULT CURRENT_DATE)
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM biblioteca.validar_atencion(p_fecha,'avisos');
    INSERT INTO biblioteca.aviso_correo(prestamo_id,fecha_generacion,destinatario,asunto)
      SELECT p.id,p_fecha,u.correo,'Recordatorio de devolución de biblioteca'
      FROM biblioteca.prestamo p JOIN biblioteca.usuario u ON u.id=p.usuario_id
      WHERE p.fecha<=p_fecha AND u.correo IS NOT NULL AND EXISTS (
        SELECT 1 FROM biblioteca.detalle_prestamo d WHERE d.prestamo_id=p.id AND d.fecha_cierre IS NULL
          AND d.vencimiento_vigente<p_fecha
          AND NOT EXISTS(SELECT 1 FROM biblioteca.incidencia i WHERE i.detalle_id=d.id)
      ) ON CONFLICT (prestamo_id,fecha_generacion) DO NOTHING;
END $$;

-- Procedimiento con COMMIT/ROLLBACK explícitos, requisito de la guía.
-- CALL debe ser una sentencia independiente, fuera de BEGIN/COMMIT del cliente.
-- false sirve para demostrar que una actualización rechazada se revierte.
CREATE PROCEDURE sp_actualizar_correo(IN p_usuario integer, IN p_correo text, IN p_confirmar boolean)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_confirmar IS NULL THEN RAISE EXCEPTION 'Indique confirmar o revertir'; END IF;
    UPDATE biblioteca.usuario SET correo=p_correo WHERE id=p_usuario;
    IF NOT FOUND THEN RAISE EXCEPTION 'Usuario inexistente'; END IF;
    IF p_confirmar THEN COMMIT; ELSE ROLLBACK; END IF;
END $$;

CREATE VIEW v_disponibilidad AS
SELECT e.id AS ejemplar_id,e.codigo,l.id AS libro_id,l.titulo,e.condicion,
  (e.condicion IN ('bueno','desgastado') AND NOT EXISTS(
    SELECT 1 FROM detalle_prestamo d WHERE d.ejemplar_id=e.id AND d.fecha_cierre IS NULL
  )) AS disponible
FROM ejemplar e JOIN libro l ON l.id=e.libro_id;

CREATE VIEW v_movimientos AS
SELECT p.id AS prestamo_id,p.usuario_id,u.nombre,p.fecha,p.curso_al_prestar_id,
  d.id AS detalle_id,e.codigo,l.titulo,d.vencimiento_vigente,d.cantidad_renovaciones,d.fecha_cierre,
  CASE WHEN i.fecha_resolucion IS NOT NULL THEN 'resuelto_por_'||i.solucion
       WHEN i.id IS NOT NULL THEN 'incidencia_pendiente'
       WHEN d.fecha_cierre IS NOT NULL THEN 'devuelto'
       WHEN d.vencimiento_vigente<CURRENT_DATE THEN 'atrasado' ELSE 'prestado' END AS estado
FROM prestamo p JOIN usuario u ON u.id=p.usuario_id JOIN detalle_prestamo d ON d.prestamo_id=p.id
  JOIN ejemplar e ON e.id=d.ejemplar_id JOIN libro l ON l.id=e.libro_id LEFT JOIN incidencia i ON i.detalle_id=d.id;

CREATE VIEW v_atrasos AS
SELECT * FROM v_movimientos WHERE estado='atrasado';
COMMIT;

BEGIN;
SET search_path TO biblioteca, public;

CREATE FUNCTION bloquear_operaciones() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE biblioteca.control_operacion SET revision=revision+1 WHERE id=1;
END $$;

CREATE FUNCTION es_habil(d date) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE resultado boolean;
BEGIN
    IF d IS NULL THEN RAISE EXCEPTION 'Fecha obligatoria'; END IF;
    SELECT abierto INTO resultado FROM biblioteca.calendario WHERE fecha=d;
    IF NOT FOUND THEN RAISE EXCEPTION 'Falta calendario para %', d; END IF;
    RETURN resultado;
END $$;

CREATE FUNCTION proximo_habil(d date) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE resultado date := d;
BEGIN
    WHILE NOT biblioteca.es_habil(resultado) LOOP resultado := resultado + 1; END LOOP;
    RETURN resultado;
END $$;

CREATE FUNCTION sumar_habiles(d date, cantidad integer) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE resultado date := d; contador integer := 0;
BEGIN
    IF cantidad IS NULL OR cantidad < 0 THEN RAISE EXCEPTION 'Cantidad de días inválida'; END IF;
    PERFORM biblioteca.es_habil(d);
    WHILE contador < cantidad LOOP
        resultado := resultado+1;
        IF biblioteca.es_habil(resultado) THEN contador := contador+1; END IF;
    END LOOP;
    RETURN resultado;
END $$;

CREATE FUNCTION validar_atencion(d date, operacion text) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE c biblioteca.calendario%ROWTYPE;
BEGIN
    IF NOT biblioteca.es_habil(d) THEN RAISE EXCEPTION 'Biblioteca cerrada en %', d; END IF;
    SELECT * INTO c FROM biblioteca.calendario WHERE fecha=d;
    IF operacion='prestamo' AND NOT c.permite_prestamo THEN
        RAISE EXCEPTION 'No se permiten préstamos en %', d;
    ELSIF operacion='renovacion' AND NOT c.permite_renovacion THEN
        RAISE EXCEPTION 'No se permiten renovaciones en %', d;
    END IF;
END $$;

CREATE FUNCTION validar_plazo(inicio date, fin date) RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM biblioteca.calendario WHERE fecha>inicio AND fecha<=fin AND vacaciones) THEN
        RAISE EXCEPTION 'El plazo no puede entrar ni cruzar vacaciones';
    END IF;
END $$;

-- Calculado al consultar: el bloqueo existe aunque no se ejecute un trabajo nocturno.
-- La sanción por atraso empieza el primer día de atención posterior al vencimiento.
CREATE FUNCTION motivos_bloqueo(u integer, d date) RETURNS TABLE(motivo text)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    PERFORM biblioteca.es_habil(d);
    RETURN QUERY
    SELECT 'usuario_inactivo'::text FROM biblioteca.usuario WHERE id=u AND NOT activo
    UNION ALL
    SELECT 'ejemplar_atrasado' FROM biblioteca.detalle_prestamo dp
      JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id
      WHERE p.usuario_id=u AND p.fecha<=d AND dp.vencimiento_vigente<d
        AND (dp.fecha_cierre IS NULL OR dp.fecha_cierre>d)
    UNION ALL
    SELECT 'sancion_por_atraso' FROM biblioteca.detalle_prestamo dp
      JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id
      WHERE p.usuario_id=u AND p.fecha<=d AND dp.vencimiento_vigente<d
        AND (dp.fecha_cierre IS NULL OR dp.fecha_cierre>dp.vencimiento_vigente)
        AND d>=biblioteca.proximo_habil(dp.vencimiento_vigente+1)
        AND d<biblioteca.proximo_habil(biblioteca.proximo_habil(dp.vencimiento_vigente+1)+7)
    UNION ALL
    SELECT 'conducta_grave' FROM biblioteca.sancion
      WHERE usuario_id=u AND d>=inicio AND d<habilitado_desde
    UNION ALL
    SELECT 'reposicion_o_reembolso_pendiente' FROM biblioteca.incidencia i
      JOIN biblioteca.detalle_prestamo dp ON dp.id=i.detalle_id
      JOIN biblioteca.prestamo p ON p.id=dp.prestamo_id
      WHERE p.usuario_id=u AND i.fecha<=d AND (i.fecha_resolucion IS NULL OR i.fecha_resolucion>d);
END $$;

CREATE FUNCTION validar_prestamo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u biblioteca.usuario%ROWTYPE;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    PERFORM biblioteca.validar_atencion(NEW.fecha,'prestamo');
    SELECT * INTO STRICT u FROM biblioteca.usuario WHERE id=NEW.usuario_id;
    IF EXISTS (SELECT 1 FROM biblioteca.motivos_bloqueo(u.id, NEW.fecha)) THEN
        RAISE EXCEPTION 'Usuario bloqueado para préstamos';
    END IF;
    NEW.curso_al_prestar_id := u.curso_actual_id;
    NEW.vencimiento_inicial := biblioteca.sumar_habiles(NEW.fecha,3);
    PERFORM biblioteca.validar_plazo(NEW.fecha,NEW.vencimiento_inicial);
    RETURN NEW;
END $$;
CREATE TRIGGER validar_prestamo BEFORE INSERT ON prestamo FOR EACH ROW EXECUTE FUNCTION validar_prestamo();

CREATE FUNCTION validar_detalle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p biblioteca.prestamo%ROWTYPE; estado text;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    SELECT * INTO STRICT p FROM biblioteca.prestamo WHERE id=NEW.prestamo_id;
    SELECT condicion INTO STRICT estado FROM biblioteca.ejemplar WHERE id=NEW.ejemplar_id;
    IF estado NOT IN ('bueno','desgastado') THEN RAISE EXCEPTION 'Ejemplar no disponible por su condición'; END IF;
    IF EXISTS (SELECT 1 FROM biblioteca.motivos_bloqueo(p.usuario_id,p.fecha)) THEN
        RAISE EXCEPTION 'Usuario bloqueado para préstamos';
    END IF;
    IF (SELECT count(*) FROM biblioteca.detalle_prestamo WHERE prestamo_id=p.id)>=3 THEN
        RAISE EXCEPTION 'Máximo tres ejemplares por préstamo';
    END IF;
    IF (SELECT count(*) FROM biblioteca.detalle_prestamo dp JOIN biblioteca.prestamo op ON op.id=dp.prestamo_id
        WHERE op.usuario_id=p.usuario_id AND dp.fecha_cierre IS NULL)>=3 THEN
        RAISE EXCEPTION 'Máximo tres ejemplares simultáneos por usuario';
    END IF;
    NEW.vencimiento_vigente := p.vencimiento_inicial;
    NEW.cantidad_renovaciones := 0;
    NEW.fecha_cierre := NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER validar_detalle BEFORE INSERT ON detalle_prestamo FOR EACH ROW EXECUTE FUNCTION validar_detalle();

-- Atributos calculados: solo los triggers de renovación/devolución/resolución los cambian.
CREATE FUNCTION proteger_detalle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN
        RAISE EXCEPTION 'El historial es inmutable; use los procedimientos de circulación';
    END IF;
    IF (NEW.id,NEW.prestamo_id,NEW.ejemplar_id) IS DISTINCT FROM (OLD.id,OLD.prestamo_id,OLD.ejemplar_id) THEN
        RAISE EXCEPTION 'No se puede cambiar la identidad del detalle';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER proteger_detalle BEFORE UPDATE OR DELETE ON detalle_prestamo FOR EACH ROW EXECUTE FUNCTION proteger_detalle();

CREATE FUNCTION validar_renovacion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d biblioteca.detalle_prestamo%ROWTYPE; fecha_prestamo date;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    PERFORM biblioteca.validar_atencion(NEW.fecha,'renovacion');
    SELECT * INTO STRICT d FROM biblioteca.detalle_prestamo WHERE id=NEW.detalle_id;
    SELECT fecha INTO fecha_prestamo FROM biblioteca.prestamo WHERE id=d.prestamo_id;
    IF d.fecha_cierre IS NOT NULL OR NEW.fecha<fecha_prestamo THEN RAISE EXCEPTION 'Préstamo cerrado o fecha inválida'; END IF;
    IF NEW.fecha>d.vencimiento_vigente THEN RAISE EXCEPTION 'No se renueva un ejemplar atrasado'; END IF;
    IF d.cantidad_renovaciones>=2 THEN RAISE EXCEPTION 'Máximo dos renovaciones por ejemplar'; END IF;
    IF EXISTS (SELECT 1 FROM biblioteca.incidencia WHERE detalle_id=d.id) THEN RAISE EXCEPTION 'Ejemplar con incidencia'; END IF;
    IF EXISTS (SELECT 1 FROM biblioteca.renovacion WHERE detalle_id=d.id AND fecha>NEW.fecha) THEN
        RAISE EXCEPTION 'Fecha de renovación anterior al último movimiento';
    END IF;
    NEW.vencimiento_anterior := d.vencimiento_vigente;
    NEW.nuevo_vencimiento := biblioteca.sumar_habiles(d.vencimiento_vigente,3);
    PERFORM biblioteca.validar_plazo(d.vencimiento_vigente,NEW.nuevo_vencimiento);
    RETURN NEW;
END $$;
CREATE TRIGGER validar_renovacion BEFORE INSERT ON renovacion FOR EACH ROW EXECUTE FUNCTION validar_renovacion();

CREATE FUNCTION actualizar_vencimiento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE biblioteca.detalle_prestamo SET vencimiento_vigente=NEW.nuevo_vencimiento,
      cantidad_renovaciones=cantidad_renovaciones+1 WHERE id=NEW.detalle_id;
    RETURN NEW;
END $$;
CREATE TRIGGER actualizar_vencimiento AFTER INSERT ON renovacion FOR EACH ROW EXECUTE FUNCTION actualizar_vencimiento();

CREATE FUNCTION validar_devolucion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d biblioteca.detalle_prestamo%ROWTYPE; op biblioteca.devolucion%ROWTYPE; p biblioteca.prestamo%ROWTYPE;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    SELECT * INTO STRICT d FROM biblioteca.detalle_prestamo WHERE id=NEW.detalle_prestamo_id;
    SELECT * INTO STRICT op FROM biblioteca.devolucion WHERE id=NEW.devolucion_id;
    SELECT * INTO STRICT p FROM biblioteca.prestamo WHERE id=d.prestamo_id;
    PERFORM biblioteca.validar_atencion(op.fecha,'devolucion');
    IF op.usuario_id<>p.usuario_id OR op.fecha<p.fecha OR d.fecha_cierre IS NOT NULL THEN
        RAISE EXCEPTION 'Devolución incompatible con el préstamo';
    END IF;
    IF EXISTS (SELECT 1 FROM biblioteca.incidencia WHERE detalle_id=d.id) THEN
        RAISE EXCEPTION 'Use la resolución de incidencia para el ejemplar perdido o dañado';
    END IF;
    IF EXISTS (SELECT 1 FROM biblioteca.renovacion WHERE detalle_id=d.id AND fecha>op.fecha) THEN
        RAISE EXCEPTION 'Devolución anterior a la última renovación';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER validar_devolucion BEFORE INSERT ON detalle_devolucion FOR EACH ROW EXECUTE FUNCTION validar_devolucion();

CREATE FUNCTION cerrar_por_devolucion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE biblioteca.detalle_prestamo SET fecha_cierre=(SELECT fecha FROM biblioteca.devolucion WHERE id=NEW.devolucion_id)
      WHERE id=NEW.detalle_prestamo_id;
    UPDATE biblioteca.ejemplar SET condicion=NEW.condicion_recibida
      WHERE id=(SELECT ejemplar_id FROM biblioteca.detalle_prestamo WHERE id=NEW.detalle_prestamo_id);
    RETURN NEW;
END $$;
CREATE TRIGGER cerrar_por_devolucion AFTER INSERT ON detalle_devolucion FOR EACH ROW EXECUTE FUNCTION cerrar_por_devolucion();

CREATE FUNCTION validar_sancion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    PERFORM biblioteca.validar_atencion(NEW.inicio,'sancion');
    NEW.habilitado_desde := biblioteca.proximo_habil(NEW.inicio+14);
    RETURN NEW;
END $$;
CREATE TRIGGER validar_sancion BEFORE INSERT ON sancion FOR EACH ROW EXECUTE FUNCTION validar_sancion();

CREATE FUNCTION validar_incidencia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d biblioteca.detalle_prestamo%ROWTYPE; fecha_p date; libro_original integer; libro_nuevo integer; condicion_nueva text;
BEGIN
    PERFORM biblioteca.bloquear_operaciones();
    SELECT * INTO STRICT d FROM biblioteca.detalle_prestamo WHERE id=NEW.detalle_id;
    SELECT fecha INTO fecha_p FROM biblioteca.prestamo WHERE id=d.prestamo_id;
    IF TG_OP='INSERT' THEN
        PERFORM biblioteca.validar_atencion(NEW.fecha,'incidencia');
        IF d.fecha_cierre IS NOT NULL OR NEW.fecha<fecha_p OR NEW.fecha_resolucion IS NOT NULL THEN
            RAISE EXCEPTION 'Incidencia incompatible con el préstamo';
        END IF;
        IF EXISTS (SELECT 1 FROM biblioteca.renovacion WHERE detalle_id=d.id AND fecha>NEW.fecha) THEN
            RAISE EXCEPTION 'Incidencia anterior a la última renovación';
        END IF;
    ELSE
        IF (NEW.id,NEW.detalle_id,NEW.fecha,NEW.tipo,NEW.observaciones)
          IS DISTINCT FROM (OLD.id,OLD.detalle_id,OLD.fecha,OLD.tipo,OLD.observaciones)
          OR OLD.fecha_resolucion IS NOT NULL OR NEW.fecha_resolucion IS NULL THEN
            RAISE EXCEPTION 'Solo se permite resolver una incidencia pendiente';
        END IF;
        PERFORM biblioteca.validar_atencion(NEW.fecha_resolucion,'resolucion');
        IF NEW.solucion='reposicion' THEN
            SELECT libro_id INTO libro_original FROM biblioteca.ejemplar WHERE id=d.ejemplar_id;
            SELECT libro_id,condicion INTO STRICT libro_nuevo,condicion_nueva FROM biblioteca.ejemplar WHERE id=NEW.ejemplar_reemplazo_id;
            IF libro_original<>libro_nuevo OR NEW.ejemplar_reemplazo_id=d.ejemplar_id OR condicion_nueva<>'bueno'
              OR EXISTS(SELECT 1 FROM biblioteca.detalle_prestamo WHERE ejemplar_id=NEW.ejemplar_reemplazo_id) THEN
                RAISE EXCEPTION 'El reemplazo debe ser una copia nueva de la misma edición';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER validar_incidencia BEFORE INSERT OR UPDATE ON incidencia FOR EACH ROW EXECUTE FUNCTION validar_incidencia();

CREATE FUNCTION aplicar_incidencia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE biblioteca.ejemplar SET condicion=CASE WHEN NEW.fecha_resolucion IS NOT NULL THEN 'baja'
      WHEN NEW.tipo='perdida' THEN 'perdido' ELSE 'danado' END
      WHERE id=(SELECT ejemplar_id FROM biblioteca.detalle_prestamo WHERE id=NEW.detalle_id);
    IF NEW.fecha_resolucion IS NOT NULL THEN
        UPDATE biblioteca.detalle_prestamo SET fecha_cierre=NEW.fecha_resolucion WHERE id=NEW.detalle_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER aplicar_incidencia AFTER INSERT OR UPDATE ON incidencia FOR EACH ROW EXECUTE FUNCTION aplicar_incidencia();

CREATE FUNCTION impedir_cambio_historial() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'No se permite modificar ni borrar el historial de %', TG_TABLE_NAME; END $$;
CREATE TRIGGER historial_prestamo BEFORE UPDATE OR DELETE ON prestamo FOR EACH ROW EXECUTE FUNCTION impedir_cambio_historial();
CREATE TRIGGER historial_renovacion BEFORE UPDATE OR DELETE ON renovacion FOR EACH ROW EXECUTE FUNCTION impedir_cambio_historial();
CREATE TRIGGER historial_devolucion BEFORE UPDATE OR DELETE ON devolucion FOR EACH ROW EXECUTE FUNCTION impedir_cambio_historial();
CREATE TRIGGER historial_detalle_devolucion BEFORE UPDATE OR DELETE ON detalle_devolucion FOR EACH ROW EXECUTE FUNCTION impedir_cambio_historial();
CREATE TRIGGER historial_sancion BEFORE UPDATE OR DELETE ON sancion FOR EACH ROW EXECUTE FUNCTION impedir_cambio_historial();
CREATE TRIGGER historial_incidencia BEFORE DELETE ON incidencia FOR EACH ROW EXECUTE FUNCTION impedir_cambio_historial();

-- Una cabecera sin detalles tampoco es un préstamo/devolución válido.
CREATE FUNCTION comprobar_operacion_no_vacia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME='prestamo' AND NOT EXISTS(SELECT 1 FROM biblioteca.detalle_prestamo WHERE prestamo_id=NEW.id) THEN
        RAISE EXCEPTION 'Un préstamo necesita al menos un ejemplar';
    ELSIF TG_TABLE_NAME='devolucion' AND NOT EXISTS(SELECT 1 FROM biblioteca.detalle_devolucion WHERE devolucion_id=NEW.id) THEN
        RAISE EXCEPTION 'Una devolución necesita al menos un ejemplar';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER prestamo_no_vacio AFTER INSERT ON prestamo DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION comprobar_operacion_no_vacia();
CREATE CONSTRAINT TRIGGER devolucion_no_vacia AFTER INSERT ON devolucion DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION comprobar_operacion_no_vacia();
COMMIT;

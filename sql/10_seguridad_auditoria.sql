-- Actualización aditiva y repetible (se ejecuta en cada inicio):
--  * operadores con rol y contraseña cifrada (scrypt, calculado en la aplicación);
--  * auditoría inmutable de cada operación de escritura y cada inicio de sesión;
--  * reintentos controlados de avisos de correo;
--  * validación del dígito verificador del RUT chileno;
--  * vista de registros que superan el plazo de conservación de 10 años.
BEGIN;
SET search_path TO biblioteca, public;

CREATE TABLE IF NOT EXISTS operador (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario text NOT NULL UNIQUE CHECK (usuario ~ '^[a-z0-9._-]{3,40}$'),
    nombre text NOT NULL CHECK (btrim(nombre) <> ''),
    rol text NOT NULL CHECK (rol IN ('admin','bibliotecaria','consulta')),
    clave_hash text NOT NULL CHECK (clave_hash LIKE 'scrypt$%'),
    activo boolean NOT NULL DEFAULT true,
    creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auditoria (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    registrado_en timestamptz NOT NULL DEFAULT now(),
    operador_id integer REFERENCES operador(id),
    operador text NOT NULL,
    accion text NOT NULL,
    ruta text NOT NULL,
    resultado text NOT NULL CHECK (resultado IN ('ok','rechazado')),
    detalle jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS auditoria_por_fecha ON auditoria(registrado_en);
CREATE INDEX IF NOT EXISTS auditoria_por_operador ON auditoria(operador_id, registrado_en);

DROP TRIGGER IF EXISTS auditoria_inmutable ON auditoria;
CREATE TRIGGER auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION biblioteca.impedir_cambio_historial();

-- Avisos: contador de intentos para reintentar errores sin insistir indefinidamente.
ALTER TABLE aviso_correo ADD COLUMN IF NOT EXISTS intentos integer NOT NULL DEFAULT 0;
ALTER TABLE aviso_correo ADD COLUMN IF NOT EXISTS ultimo_intento timestamptz;

-- RUT: módulo 11. Formato aceptado: 12345678-5 (sin puntos, con guion, K mayúscula).
CREATE OR REPLACE FUNCTION rut_valido(p text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE cuerpo text; dv text; suma integer := 0; factor integer := 2; i integer; esperado text;
BEGIN
    IF p IS NULL OR p !~ '^[0-9]{7,8}-[0-9K]$' THEN RETURN false; END IF;
    cuerpo := split_part(p, '-', 1); dv := split_part(p, '-', 2);
    FOR i IN REVERSE length(cuerpo)..1 LOOP
        suma := suma + substr(cuerpo, i, 1)::integer * factor;
        factor := CASE WHEN factor = 7 THEN 2 ELSE factor + 1 END;
    END LOOP;
    esperado := CASE 11 - suma % 11 WHEN 11 THEN '0' WHEN 10 THEN 'K' ELSE (11 - suma % 11)::text END;
    RETURN dv = esperado;
END $$;

-- Si el identificador tiene forma de RUT (solo dígitos, puntos, guion y K) debe ser válido.
-- Otros identificadores (pasaporte, IPE, códigos ficticios DEMO-…) se aceptan tal cual.
-- NOT VALID: se aplica a los registros nuevos o editados sin bloquear bases ya existentes.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuario_rut_valido') THEN
        ALTER TABLE biblioteca.usuario ADD CONSTRAINT usuario_rut_valido
          CHECK (identificador !~ '^[0-9.]+-?[0-9kK]$' OR biblioteca.rut_valido(identificador)) NOT VALID;
    END IF;
END $$;

-- Política de conservación: 10 años desde el cierre del préstamo.
-- La vista solo identifica candidatos; el archivo se hace con un respaldo verificado
-- (ver docs/retencion.md). El historial sigue protegido contra borrados.
CREATE OR REPLACE VIEW v_retencion AS
SELECT p.id AS prestamo_id, p.usuario_id, p.fecha AS fecha_prestamo,
       max(d.fecha_cierre) AS fecha_cierre,
       (max(d.fecha_cierre) + interval '10 years')::date AS conservar_hasta
FROM prestamo p JOIN detalle_prestamo d ON d.prestamo_id = p.id
GROUP BY p.id, p.usuario_id, p.fecha
HAVING bool_and(d.fecha_cierre IS NOT NULL)
   AND max(d.fecha_cierre) + interval '10 years' < CURRENT_DATE;

COMMIT;

-- Actualización aditiva y repetible (se ejecuta al crear la base y en cada inicio).
-- El Colegio Siglo XXI de Lampa imparte de Pre-kínder a 8.º básico, con un solo
-- curso por nivel (sin letras). Estos cursos existen siempre por defecto para el
-- año escolar en curso y el siguiente, así que cada año nuevo aparecen solos.
-- No borra ni renombra cursos existentes: el curso histórico de los préstamos se conserva.
BEGIN;
SET search_path TO biblioteca, public;

CREATE OR REPLACE FUNCTION niveles_colegio()
RETURNS TABLE (orden integer, nombre text)
LANGUAGE sql IMMUTABLE AS $$
  VALUES (1,'Pre-kínder'),(2,'Kínder'),(3,'1.º básico'),(4,'2.º básico'),(5,'3.º básico'),
         (6,'4.º básico'),(7,'5.º básico'),(8,'6.º básico'),(9,'7.º básico'),(10,'8.º básico')
$$;

CREATE OR REPLACE FUNCTION asegurar_cursos_colegio(p_anio integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE creados integer;
BEGIN
  INSERT INTO curso(nombre, anio_escolar)
  SELECT n.nombre, p_anio FROM niveles_colegio() n ORDER BY n.orden
  ON CONFLICT (nombre, anio_escolar) DO NOTHING;
  GET DIAGNOSTICS creados = ROW_COUNT;
  RETURN creados;
END $$;

SELECT asegurar_cursos_colegio(extract(year FROM current_date)::integer);
SELECT asegurar_cursos_colegio(extract(year FROM current_date)::integer + 1);

COMMIT;

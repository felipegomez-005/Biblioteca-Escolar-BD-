-- TODOS los nombres, identificadores, obras y fechas de cierre son ficticios.
-- No representa el calendario oficial chileno ni el de una escuela real.
BEGIN;
SET search_path TO biblioteca, public;
INSERT INTO calendario(fecha,abierto,permite_prestamo,permite_renovacion,motivo)
SELECT d::date,extract(isodow FROM d)<6,extract(isodow FROM d)<6,extract(isodow FROM d)<6,'Calendario ficticio de demostración'
FROM generate_series(date '2026-01-01',date '2027-12-31',interval '1 day') d;
UPDATE calendario SET abierto=false,permite_prestamo=false,permite_renovacion=false,
  motivo='Feriado ficticio para pruebas' WHERE fecha IN ('2026-06-03','2026-06-11');
UPDATE calendario SET abierto=false,permite_prestamo=false,permite_renovacion=false,vacaciones=true,
  motivo='Vacaciones ficticias' WHERE fecha BETWEEN '2026-07-06' AND '2026-07-17'
  OR fecha BETWEEN '2026-12-21' AND '2027-02-28';
UPDATE calendario SET permite_prestamo=false,permite_renovacion=false,motivo='Última semana ficticia: solo devoluciones'
  WHERE fecha BETWEEN '2026-06-29' AND '2026-07-03' OR fecha BETWEEN '2026-12-14' AND '2026-12-18';

INSERT INTO editorial(nombre) VALUES ('Editorial de Prueba A'),('Editorial de Prueba B');
INSERT INTO autor(nombre) VALUES ('Autor Ficticio A'),('Autora Ficticia B'),('Autor Ficticio C');
INSERT INTO genero(nombre) VALUES ('Narrativa'),('Ciencias'),('Historia');
INSERT INTO libro(titulo,editorial_id,anio_publicacion)
SELECT 'Obra ficticia '||n,CASE WHEN n%2=0 THEN 1 ELSE 2 END,2020+n%6 FROM generate_series(1,12) n;
INSERT INTO libro_autor(libro_id,autor_id) SELECT id,1+(id%3) FROM libro;
INSERT INTO libro_autor(libro_id,autor_id) VALUES (1,1);
INSERT INTO libro_genero(libro_id,genero_id) SELECT id,1+(id%3) FROM libro;
INSERT INTO ejemplar(libro_id,codigo)
SELECT l.id,'DEMO-'||lpad(l.id::text,3,'0')||'-'||c FROM libro l CROSS JOIN generate_series(1,3) c ORDER BY l.id,c;
INSERT INTO curso(nombre,anio_escolar)
SELECT g.nombre || ' ' || s.seccion, y.anio
FROM (VALUES ('1.º medio',1),('2.º medio',2),('3.º medio',3),('4.º medio',4)) AS g(nombre,orden)
CROSS JOIN (VALUES ('A'),('B'),('C'),('D')) AS s(seccion)
CROSS JOIN (VALUES (2026),(2027)) AS y(anio)
ORDER BY y.anio, g.orden, s.seccion;
INSERT INTO usuario(identificador,nombre,tipo,correo,curso_actual_id)
SELECT 'DEMO-EST-'||n,'Estudiante ficticio '||n,'estudiante','estudiante'||n||'@example.invalid',
  (SELECT id FROM curso WHERE nombre=CASE WHEN n%2=1 THEN '1.º medio A' ELSE '2.º medio A' END AND anio_escolar=2026)
FROM generate_series(1,10) n;
INSERT INTO usuario(identificador,nombre,tipo,correo,cargo) VALUES
 ('DEMO-DOC-1','Docente ficticio','docente','docente@example.invalid','Docencia'),
 ('DEMO-ASIS-1','Asistente ficticio','asistente','asistente@example.invalid','Asistencia educativa');

-- Una operación de tres libros, devolución parcial y renovación independiente.
CALL sp_prestar(1,ARRAY[1,2,4],date '2026-05-04');
CALL sp_devolver(1,ARRAY[1],date '2026-05-05');
CALL sp_renovar(ARRAY[3],date '2026-05-06');
CALL sp_devolver(1,ARRAY[2],date '2026-05-07');
CALL sp_devolver(1,ARRAY[3],date '2026-05-12');
-- Atraso resuelto: la sanción sigue hasta su término original.
CALL sp_prestar(2,ARRAY[7],date '2026-05-04');
CALL sp_devolver(2,ARRAY[4],date '2026-05-11');
-- Pérdida pendiente y daño resuelto por reposición.
CALL sp_prestar(3,ARRAY[10],date '2026-05-04');
CALL sp_registrar_incidencia(5,'perdida',date '2026-05-06','Caso ficticio pendiente');
CALL sp_prestar(4,ARRAY[13],date '2026-05-04');
CALL sp_registrar_incidencia(6,'dano_permanente',date '2026-05-06','Caso ficticio repuesto');
CALL sp_resolver_incidencia(2,date '2026-05-07','reposicion','DEMO-REPOSICION-1');
CALL sp_prestar(5,ARRAY[16,19],date '2026-06-01');
CALL sp_prestar(11,ARRAY[22],date '2026-06-01');
CALL sp_devolver(11,ARRAY[9],date '2026-06-05');
CALL sp_sancionar_conducta(6,date '2026-05-07','Ejemplo ficticio');
CALL sp_preparar_avisos(date '2026-06-08');
COMMIT;

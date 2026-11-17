-- Consultas de lectura: npm run db:sql -- sql/05_consultas.sql
SET search_path TO biblioteca, public;
SELECT * FROM v_disponibilidad ORDER BY ejemplar_id;
SELECT * FROM v_movimientos ORDER BY prestamo_id,detalle_id;
SELECT * FROM motivos_bloqueo(2,date '2026-05-12');
CALL sp_kpis_anuales(2026);
SELECT id,prestamo_id,fecha_generacion,destinatario,estado FROM aviso_correo ORDER BY id;

-- Actualización aditiva: guarda el motivo del error al intentar enviar un aviso.
-- No cambia el historial de circulación ni los estados ya registrados.
BEGIN;
SET search_path TO biblioteca, public;
ALTER TABLE aviso_correo ADD COLUMN IF NOT EXISTS error_detalle text;
COMMIT;

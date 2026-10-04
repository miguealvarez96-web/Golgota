-- Terminador del dry-run automático. Debe ejecutarse en la MISMA conexión y
-- transacción que la migración y el postflight. No elimina objetos uno por uno:
-- revierte atómicamente también ALTER TYPE ... ADD VALUE 'alumno'.
ROLLBACK;

-- El dry-run abre una transaccion antes de incluir migracion y postflight.
-- No se ofrece rollback destructivo para una migracion ya aplicada.
ROLLBACK;

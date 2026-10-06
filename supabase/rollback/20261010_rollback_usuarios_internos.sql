-- Terminador del dry-run. Revierte columna, indices, permisos y objetos nuevos;
-- handle_new_user queda intacta porque la migracion nunca la reemplaza.
ROLLBACK;

-- Solo lectura: inspección del estado final de clientes.
SELECT a.attname AS columna, format_type(a.atttypid, a.atttypmod) AS tipo,
       NOT a.attnotnull AS nullable
FROM pg_attribute a
WHERE a.attrelid = 'public.clientes'::regclass
  AND a.attname = 'auth_user_id' AND NOT a.attisdropped;

SELECT ci.relname AS indice, i.indisunique AS unico, i.indisvalid AS valido,
       pg_get_indexdef(i.indexrelid) AS definicion
FROM pg_index i JOIN pg_class ci ON ci.oid = i.indexrelid
WHERE i.indrelid = 'public.clientes'::regclass
  AND pg_get_indexdef(i.indexrelid) LIKE '%auth_user_id%';

SELECT conname AS clave_foranea, pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.clientes'::regclass AND contype = 'f'
  AND pg_get_constraintdef(oid) LIKE '%auth_user_id%';

SELECT policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'clientes'
ORDER BY policyname;

SELECT rol,
       has_table_privilege(rol, 'public.clientes', 'SELECT') AS puede_consultar,
       has_table_privilege(rol, 'public.clientes', 'DELETE') AS puede_borrar,
       has_table_privilege(rol, 'public.clientes', 'TRUNCATE') AS puede_truncar,
       has_column_privilege(rol, 'public.clientes', 'auth_user_id', 'INSERT') AS puede_insertar_vinculo,
       has_column_privilege(rol, 'public.clientes', 'auth_user_id', 'UPDATE') AS puede_editar_vinculo
FROM (VALUES ('anon'), ('authenticated')) AS roles(rol);

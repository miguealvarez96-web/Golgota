-- Postflight de solo lectura para 20260925_endurece_permisos_membresias.sql.
-- La columna effective_* incluye privilegios heredados desde PUBLIC.

SELECT role_name, table_name,
       has_table_privilege(role_name, table_name, 'SELECT') AS effective_select,
       has_table_privilege(role_name, table_name, 'INSERT') AS effective_insert,
       has_table_privilege(role_name, table_name, 'DELETE') AS effective_delete,
       has_table_privilege(role_name, table_name, 'TRUNCATE') AS effective_truncate,
       has_table_privilege(role_name, table_name, 'REFERENCES') AS effective_references,
       has_table_privilege(role_name, table_name, 'TRIGGER') AS effective_trigger,
       CASE WHEN current_setting('server_version_num')::integer >= 170000
            THEN has_table_privilege(role_name, table_name, 'MAINTAIN')
            ELSE false
       END AS effective_maintain
FROM (
  VALUES ('anon'::name, 'public.membresias'::name),
         ('authenticated'::name, 'public.membresias'::name),
         ('anon'::name, 'public.pagos'::name),
         ('authenticated'::name, 'public.pagos'::name)
) AS targets(role_name, table_name)
ORDER BY table_name, role_name;

SELECT table_name, privilege_type, grantee, grantor
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('membresias', 'pagos')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT role_name, table_name,
       NOT has_table_privilege(role_name, table_name, 'TRUNCATE') AS truncate_revocado,
       NOT has_table_privilege(role_name, table_name, 'REFERENCES') AS references_revocado,
       NOT has_table_privilege(role_name, table_name, 'TRIGGER') AS trigger_revocado,
       CASE WHEN current_setting('server_version_num')::integer >= 170000
            THEN NOT has_table_privilege(role_name, table_name, 'MAINTAIN')
            ELSE true
       END AS maintain_revocado,
       NOT has_table_privilege(role_name, table_name, 'DELETE') AS delete_revocado
FROM (
  VALUES ('anon'::name, 'public.membresias'::name),
         ('authenticated'::name, 'public.membresias'::name),
         ('anon'::name, 'public.pagos'::name),
         ('authenticated'::name, 'public.pagos'::name)
) AS targets(role_name, table_name)
ORDER BY table_name, role_name;

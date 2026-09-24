-- Preflight de solo lectura para 20260923_negocio_membresias_pagos.sql.
-- Este archivo contiene exclusivamente SHOW, SELECT y consultas de catálogo.

SHOW server_version;
SHOW timezone;

SELECT current_database() AS database_name,
       current_schema() AS schema_name,
       current_user AS session_user,
       now() AS server_now,
       (now() AT TIME ZONE 'America/Guayaquil')::date AS business_date;

SELECT table_schema, table_name, column_name, ordinal_position,
       data_type, udt_schema, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'membresias'
ORDER BY ordinal_position;

SELECT n.nspname AS enum_schema, t.typname AS enum_name,
       e.enumsortorder, e.enumlabel
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname = 'public' AND t.typname = 'estado_pago_enum'
ORDER BY e.enumsortorder;

SELECT table_schema, table_name, column_name, data_type, udt_schema,
       udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'planes'
ORDER BY ordinal_position;

SELECT id, nombre, precio, duracion_dias, activo, created_at, updated_at
FROM public.planes
ORDER BY nombre, id;

SELECT upper(btrim(nombre)) AS nombre_normalizado, count(*) AS cantidad,
       array_agg(id ORDER BY id) AS ids
FROM public.planes
GROUP BY upper(btrim(nombre))
HAVING count(*) > 1
ORDER BY nombre_normalizado;

SELECT count(*) AS membresias_total
FROM public.membresias;

SELECT estado, count(*) AS cantidad
FROM public.membresias
GROUP BY estado
ORDER BY estado;

SELECT count(*) AS abono_negativo
FROM public.membresias
WHERE abono < 0;

SELECT count(*) AS saldo_negativo
FROM public.membresias
WHERE saldo < 0;

SELECT count(*) AS saldo_inconsistente
FROM public.membresias
WHERE saldo <> valor - abono;

SELECT count(*) AS fechas_invertidas
FROM public.membresias
WHERE fecha_vencimiento < fecha_inicio;

SELECT count(*) AS pagado_con_saldo_distinto_de_cero
FROM public.membresias
WHERE estado = 'PAGADO' AND saldo <> 0;

SELECT count(*) AS abonos_sin_historial_individual
FROM public.membresias
WHERE abono > 0;

SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'membresias'
ORDER BY policyname;

SELECT grantee, privilege_type, grantor
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'membresias'
ORDER BY grantee, privilege_type;

SELECT grantee, privilege_type, column_name, grantor
FROM information_schema.role_column_grants
WHERE table_schema = 'public' AND table_name = 'membresias'
ORDER BY grantee, column_name, privilege_type;

SELECT trigger_schema, trigger_name, event_manipulation,
       event_object_schema, event_object_table, action_timing,
       action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public' AND event_object_table = 'membresias'
ORDER BY trigger_name, event_manipulation;

SELECT dependent_ns.nspname AS dependent_schema,
       dependent_class.relname AS dependent_object,
       dependent_class.relkind AS dependent_kind,
       pg_get_viewdef(dependent_class.oid, true) AS view_definition
FROM pg_depend dep
JOIN pg_class referenced_class ON referenced_class.oid = dep.refobjid
JOIN pg_attribute referenced_attribute
  ON referenced_attribute.attrelid = referenced_class.oid
 AND referenced_attribute.attnum = dep.refobjsubid
JOIN pg_rewrite rw ON rw.oid = dep.objid
JOIN pg_class dependent_class ON dependent_class.oid = rw.ev_class
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_class.relnamespace
WHERE referenced_class.relnamespace = 'public'::regnamespace
  AND referenced_class.relname = 'membresias'
  AND referenced_attribute.attname = 'estado'
  AND dependent_class.relkind IN ('v', 'm', 'f')
ORDER BY dependent_schema, dependent_object;

SELECT routine_schema, routine_name, routine_type,
       data_type AS return_data_type, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_definition ILIKE '%membresias%estado%'
ORDER BY routine_name;

SELECT n.nspname AS schema_name, c.relname AS object_name,
       CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view'
                      WHEN 'r' THEN 'table' WHEN 'i' THEN 'index' ELSE c.relkind::text END AS object_kind,
       pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v', 'm')
  AND pg_get_viewdef(c.oid, true) ILIKE '%membresias%estado%'
ORDER BY object_name;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'membresias'
ORDER BY indexname;

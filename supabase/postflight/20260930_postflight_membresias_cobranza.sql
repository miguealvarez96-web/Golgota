-- Solo lectura. Ejecutar manualmente después de revisar y aplicar la migración.
SELECT current_setting('server_version') AS postgres_version,
       current_setting('TimeZone') AS zona_sesion;

SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN
  ('membresias', 'pagos', 'planes', 'membresias_verificacion')
ORDER BY tablename, policyname;

SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN
  ('crear_membresia', 'registrar_pago', 'validar_pago_membresia',
   'sincronizar_pago_membresia', 'sincronizar_membresia_verificacion',
   'sincronizar_nombre_plan_verificacion', 'evitar_solapamiento_membresias')
ORDER BY p.proname;

SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
WHERE t.tgrelid = 'public.membresias'::regclass
  AND t.tgname = 'zz_membresias_evitar_solapamiento';

SELECT count(*) AS pares_superpuestos_no_cancelados
FROM public.membresias a
JOIN public.membresias b ON b.cliente_id = a.cliente_id AND b.id > a.id
WHERE a.estado_pago <> 'CANCELADA' AND b.estado_pago <> 'CANCELADA'
  AND a.fecha_inicio <= b.fecha_vencimiento
  AND b.fecha_inicio <= a.fecha_vencimiento;

SELECT c.relname AS vista, c.reloptions,
       pg_get_viewdef(c.oid, true) AS definicion
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'v_membresias_verificacion';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'v_membresias_verificacion'
ORDER BY ordinal_position;

SELECT (SELECT count(*) FROM public.membresias) AS membresias,
       (SELECT count(*) FROM public.membresias_verificacion) AS filas_proyeccion,
       (SELECT count(*) FROM public.membresias m
        LEFT JOIN public.membresias_verificacion v ON v.membresia_id = m.id
        WHERE v.membresia_id IS NULL
           OR v.cliente_id IS DISTINCT FROM m.cliente_id
           OR v.plan_id IS DISTINCT FROM m.plan_id
           OR v.fecha_inicio IS DISTINCT FROM m.fecha_inicio
           OR v.fecha_fin IS DISTINCT FROM m.fecha_vencimiento
           OR v.cancelada IS DISTINCT FROM (m.estado_pago = 'CANCELADA'))
       AS proyecciones_incorrectas;

SELECT rol, has_table_privilege(rol, 'public.membresias_verificacion', 'INSERT') AS proyeccion_insert,
       has_table_privilege(rol, 'public.membresias_verificacion', 'UPDATE') AS proyeccion_update,
       has_table_privilege(rol, 'public.pagos', 'DELETE') AS pagos_delete
FROM (VALUES ('anon'), ('authenticated')) AS roles(rol);

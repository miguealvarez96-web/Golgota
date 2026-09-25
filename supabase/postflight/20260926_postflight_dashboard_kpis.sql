-- Postflight SOLO LECTURA para 20260926_dashboard_kpis.sql.
-- Ejecutar como usuario autenticado admin/owner para validar la fila de KPI.

SELECT to_regclass('public.v_dashboard_kpis') AS vista,
       to_regclass('public.v_dashboard_kpis') IS NOT NULL AS existe,
       c.reloptions,
       CASE WHEN c.reloptions @> ARRAY['security_invoker=true']
            THEN true ELSE false END AS security_invoker,
       current_setting('timezone') AS session_timezone,
       (now() AT TIME ZONE 'America/Guayaquil')::date AS fecha_negocio,
       public.mi_rol() AS rol_actual
FROM pg_class AS c
WHERE c.oid = to_regclass('public.v_dashboard_kpis');

SELECT ordinal_position, column_name, data_type, udt_schema, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'v_dashboard_kpis'
  AND column_name IN (
    'clientes_activos', 'membresias_vigentes', 'membresias_por_vencer',
    'ingresos_mes', 'pagos_pendientes'
  )
ORDER BY ordinal_position;

SELECT count(*) AS filas_de_la_vista,
       CASE WHEN public.mi_rol() IN ('admin', 'owner')
            THEN count(*) = 1 ELSE NULL END AS una_fila_para_rol_autorizado,
       count(*) FILTER (WHERE clientes_activos >= 0) = count(*) AS clientes_no_negativos,
       count(*) FILTER (WHERE membresias_vigentes >= 0) = count(*) AS vigentes_no_negativas,
       count(*) FILTER (WHERE membresias_por_vencer >= 0) = count(*) AS por_vencer_no_negativas,
       count(*) FILTER (WHERE ingresos_mes >= 0) = count(*) AS ingresos_no_negativos,
       count(*) FILTER (WHERE pagos_pendientes >= 0) = count(*) AS pendientes_no_negativos
FROM public.v_dashboard_kpis;

SELECT pg_get_viewdef('public.v_dashboard_kpis'::regclass, true) AS definicion,
       pg_get_viewdef('public.v_dashboard_kpis'::regclass, true)
         ILIKE '%America/Guayaquil%' AS usa_zona_horaria_ecuador,
       pg_get_viewdef('public.v_dashboard_kpis'::regclass, true)
         ILIKE '%fecha_pago%' AS usa_fecha_pago;

SELECT origen.*, dashboard.*
FROM (
  WITH business_clock AS (
    SELECT now() AT TIME ZONE 'America/Guayaquil' AS local_now
  ), month_bounds AS (
    SELECT date_trunc('month', local_now) AS month_start,
           date_trunc('month', local_now) + interval '1 month' AS month_end
    FROM business_clock
  )
  SELECT
    (SELECT count(*)::bigint FROM public.clientes WHERE estado_cliente = 'Activo') AS clientes_activos,
    (SELECT count(*)::bigint
       FROM public.v_membresias_estado
      WHERE estado_pago <> 'CANCELADA'
        AND estado_vigencia IN ('VIGENTE', 'POR_VENCER', 'VENCE_HOY')) AS membresias_vigentes,
    (SELECT count(*)::bigint
       FROM public.v_membresias_estado
      WHERE estado_pago <> 'CANCELADA'
        AND estado_vigencia = 'POR_VENCER') AS membresias_por_vencer,
    (SELECT coalesce(sum(p.monto), 0::numeric)
       FROM public.pagos AS p CROSS JOIN month_bounds AS b
      WHERE p.fecha_pago >= b.month_start AT TIME ZONE 'America/Guayaquil'
        AND p.fecha_pago < b.month_end AT TIME ZONE 'America/Guayaquil') AS ingresos_mes,
    (SELECT coalesce(sum(saldo), 0::numeric)
       FROM public.v_membresias_estado
      WHERE estado_pago = 'PENDIENTE') AS pagos_pendientes
) AS origen
CROSS JOIN public.v_dashboard_kpis AS dashboard;

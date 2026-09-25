-- Fase 4: cinco indicadores del Dashboard.
-- Preparada localmente; no ejecutada contra Supabase.
BEGIN;

CREATE OR REPLACE VIEW public.v_dashboard_kpis
WITH (security_invoker = true)
AS
WITH business_clock AS (
  SELECT now() AT TIME ZONE 'America/Guayaquil' AS local_now
),
month_bounds AS (
  SELECT date_trunc('month', local_now) AS month_start,
         date_trunc('month', local_now) + interval '1 month' AS month_end
  FROM business_clock
)
SELECT
  (
    SELECT count(*)::bigint
    FROM public.clientes
    WHERE estado_cliente = 'Activo'
  ) AS clientes_activos,
  (
    SELECT count(*)::bigint
    FROM public.v_membresias_estado
    WHERE estado_pago <> 'CANCELADA'
      AND estado_vigencia IN ('VIGENTE', 'POR_VENCER', 'VENCE_HOY')
  ) AS membresias_vigentes,
  (
    SELECT count(*)::bigint
    FROM public.v_membresias_estado
    WHERE estado_pago <> 'CANCELADA'
      AND estado_vigencia = 'POR_VENCER'
  ) AS membresias_por_vencer,
  (
    SELECT coalesce(sum(p.monto), 0::numeric)
    FROM public.pagos AS p
    CROSS JOIN month_bounds AS b
    WHERE p.fecha_pago >= b.month_start AT TIME ZONE 'America/Guayaquil'
      AND p.fecha_pago < b.month_end AT TIME ZONE 'America/Guayaquil'
  ) AS ingresos_mes,
  (
    SELECT coalesce(sum(saldo), 0::numeric)
    FROM public.v_membresias_estado
    WHERE estado_pago = 'PENDIENTE'
  ) AS pagos_pendientes
FROM (SELECT 1) AS dashboard_access
WHERE public.mi_rol() IN ('admin', 'owner');

COMMENT ON VIEW public.v_dashboard_kpis IS
  'Cinco KPI del Dashboard. Fecha de negocio: America/Guayaquil. security_invoker respeta RLS de tablas y vista de membresías.';

REVOKE ALL ON TABLE public.v_dashboard_kpis FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_dashboard_kpis TO authenticated;

COMMIT;

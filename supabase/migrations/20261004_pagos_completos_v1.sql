-- BLOQUE 2: flujo completo de pagos reportados.
-- Ejecutar después de 20261002_portal_alumno_v1.sql.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.reportes_pago_alumno
  ADD CONSTRAINT reportes_pago_alumno_rechazo_con_motivo
  CHECK (
    estado <> 'RECHAZADO'
    OR (motivo_rechazo IS NOT NULL AND length(btrim(motivo_rechazo)) BETWEEN 3 AND 500)
  );

CREATE INDEX IF NOT EXISTS reportes_pago_alumno_estado_fecha_idx
  ON public.reportes_pago_alumno (estado, created_at DESC);

-- La fila del reporte y la membresía se bloquean en un orden estable. La RPC
-- existente registrar_pago sigue siendo la única responsable de insertar el
-- pago real y sincronizar abono, saldo y estado_pago.
CREATE OR REPLACE FUNCTION public.aprobar_reporte_pago_alumno(p_reporte_id uuid)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_reporte public.reportes_pago_alumno%ROWTYPE;
  v_membresia public.membresias%ROWTYPE;
  v_pago public.pagos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para aprobar pagos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_reporte
  FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF v_reporte.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El reporte ya fue revisado.' USING ERRCODE = '55000';
  END IF;
  IF v_reporte.membresia_id IS NULL THEN
    RAISE EXCEPTION 'El reporte no tiene una membresía asociada.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_membresia
  FROM public.membresias
  WHERE id = v_reporte.membresia_id
    AND cliente_id = v_reporte.cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La membresía no existe o no pertenece al alumno.' USING ERRCODE = '22023';
  END IF;
  IF v_membresia.estado_pago = 'CANCELADA' THEN
    RAISE EXCEPTION 'No se puede aplicar un pago a una membresía cancelada.' USING ERRCODE = '22023';
  END IF;
  IF v_membresia.saldo <= 0 THEN
    RAISE EXCEPTION 'La membresía no tiene saldo pendiente.' USING ERRCODE = '22023';
  END IF;
  IF v_reporte.monto > v_membresia.saldo THEN
    RAISE EXCEPTION 'El pago reportado supera el saldo pendiente.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pago FROM public.registrar_pago(
    v_reporte.membresia_id,
    v_reporte.monto,
    'Transferencia'::public.metodo_pago_enum,
    (v_reporte.fecha_pago::timestamp + time '12:00') AT TIME ZONE 'America/Guayaquil'
  );

  IF v_pago.id IS NULL
     OR v_pago.membresia_id IS DISTINCT FROM v_reporte.membresia_id
     OR v_pago.monto IS DISTINCT FROM v_reporte.monto THEN
    RAISE EXCEPTION 'El pago real generado no coincide con el reporte.';
  END IF;

  UPDATE public.reportes_pago_alumno
  SET estado = 'APROBADO',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      motivo_rechazo = NULL,
      pago_real_id = v_pago.id
  WHERE id = v_reporte.id AND estado = 'PENDIENTE'
  RETURNING * INTO v_reporte;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El reporte cambió durante la aprobación.' USING ERRCODE = '55000';
  END IF;
  RETURN v_reporte;
END;
$$;

CREATE OR REPLACE FUNCTION public.rechazar_reporte_pago_alumno(
  p_reporte_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_reporte public.reportes_pago_alumno%ROWTYPE;
  v_motivo text := btrim(p_motivo);
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para rechazar pagos.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'El motivo debe tener entre 3 y 500 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reporte
  FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF v_reporte.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El reporte ya fue revisado.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.reportes_pago_alumno
  SET estado = 'RECHAZADO',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      motivo_rechazo = v_motivo,
      pago_real_id = NULL
  WHERE id = v_reporte.id AND estado = 'PENDIENTE'
  RETURNING * INTO v_reporte;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El reporte cambió durante el rechazo.' USING ERRCODE = '55000';
  END IF;
  RETURN v_reporte;
END;
$$;

-- Proyección de revisión: evita consultas parciales y permite que owner vea el
-- nombre del revisor sin ampliar la política general de public.usuarios.
CREATE OR REPLACE FUNCTION public.listar_reportes_pago_revision()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para consultar pagos reportados.' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id,
      'cliente_id', r.cliente_id,
      'usuario_id', r.usuario_id,
      'membresia_id', r.membresia_id,
      'monto', r.monto,
      'fecha_pago', r.fecha_pago,
      'banco_origen', r.banco_origen,
      'referencia', r.referencia,
      'observacion', r.observacion,
      'estado', r.estado,
      'created_at', r.created_at,
      'reviewed_at', r.reviewed_at,
      'reviewed_by', r.reviewed_by,
      'motivo_rechazo', r.motivo_rechazo,
      'pago_real_id', r.pago_real_id,
      'alumno', c.nombre_completo,
      'membresia', pl.nombre,
      'membresia_fecha_inicio', m.fecha_inicio,
      'membresia_fecha_fin', m.fecha_vencimiento,
      'saldo_membresia', m.saldo,
      'estado_pago_membresia', m.estado_pago,
      'revisor', u.nombre,
      'monto_aplicado', p.monto
    ) ORDER BY r.created_at DESC)
    FROM public.reportes_pago_alumno r
    JOIN public.clientes c ON c.id = r.cliente_id
    LEFT JOIN public.membresias m ON m.id = r.membresia_id
      AND m.cliente_id = r.cliente_id
    LEFT JOIN public.planes pl ON pl.id = m.plan_id
    LEFT JOIN public.usuarios u ON u.id = r.reviewed_by
    LEFT JOIN public.pagos p ON p.id = r.pago_real_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.aprobar_reporte_pago_alumno(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rechazar_reporte_pago_alumno(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_reportes_pago_revision()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_reporte_pago_alumno(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rechazar_reporte_pago_alumno(uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_reportes_pago_revision()
  TO authenticated;

COMMENT ON FUNCTION public.aprobar_reporte_pago_alumno(uuid) IS
  'Aplica una sola vez un reporte PENDIENTE mediante registrar_pago y conserva el vínculo al pago real.';
COMMENT ON FUNCTION public.rechazar_reporte_pago_alumno(uuid,text) IS
  'Rechaza un reporte PENDIENTE con motivo obligatorio, sin modificar pagos ni membresías.';
COMMENT ON FUNCTION public.listar_reportes_pago_revision() IS
  'Bandeja financiera de reportes con trazabilidad; exclusiva para admin y owner.';

COMMIT;

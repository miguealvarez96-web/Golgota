-- Portal del Alumno V1. Ejecutar después de 20260930_roles_solo_activos.sql.
-- Preparada para revisión/dry-run; la aplicación no ejecuta esta migración.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- PostgreSQL permite agregar un valor de enum transaccionalmente, pero no
-- convertir ese valor al enum antes del COMMIT. Toda autorización de esta
-- migración compara mi_rol() como text; así el archivo completo también puede
-- ejecutarse dentro de un dry-run y revertirse, incluido este ALTER TYPE.
ALTER TYPE public.rol_usuario_enum ADD VALUE IF NOT EXISTS 'alumno';

CREATE TYPE public.estado_reporte_pago_enum AS ENUM (
  'PENDIENTE',
  'APROBADO',
  'RECHAZADO'
);

CREATE TABLE public.reportes_pago_alumno (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  membresia_id uuid REFERENCES public.membresias(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  monto numeric(10,2) NOT NULL
    CHECK (monto > 0 AND monto <> 'NaN'::numeric AND monto = round(monto, 2)),
  fecha_pago date NOT NULL CHECK (isfinite(fecha_pago)),
  banco_origen varchar(120) NOT NULL CHECK (length(btrim(banco_origen)) BETWEEN 2 AND 120),
  referencia varchar(120) NOT NULL CHECK (length(btrim(referencia)) BETWEEN 2 AND 120),
  observacion text CHECK (observacion IS NULL OR length(observacion) <= 1000),
  estado public.estado_reporte_pago_enum NOT NULL DEFAULT 'PENDIENTE',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  motivo_rechazo text CHECK (motivo_rechazo IS NULL OR length(motivo_rechazo) <= 500),
  pago_real_id uuid UNIQUE REFERENCES public.pagos(id) ON DELETE RESTRICT,
  CONSTRAINT reporte_pago_revision_coherente CHECK (
    (estado = 'PENDIENTE' AND reviewed_at IS NULL AND reviewed_by IS NULL
      AND motivo_rechazo IS NULL AND pago_real_id IS NULL)
    OR
    (estado = 'APROBADO' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
      AND motivo_rechazo IS NULL AND pago_real_id IS NOT NULL)
    OR
    (estado = 'RECHAZADO' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL
      AND pago_real_id IS NULL)
  )
);

CREATE INDEX reportes_pago_alumno_cliente_fecha_idx
  ON public.reportes_pago_alumno (cliente_id, created_at DESC);
CREATE INDEX reportes_pago_alumno_pendientes_idx
  ON public.reportes_pago_alumno (created_at)
  WHERE estado = 'PENDIENTE';

COMMENT ON TABLE public.reportes_pago_alumno IS
  'Reportes informativos enviados por alumnos. Solo APROBADO enlaza un pago real; PENDIENTE y RECHAZADO nunca alteran finanzas.';
COMMENT ON COLUMN public.reportes_pago_alumno.pago_real_id IS
  'Vínculo único al pago aplicado por aprobar_reporte_pago_alumno; impide doble aplicación y conserva trazabilidad.';

-- Un alumno solo ve su ficha vinculada. La política operativa existente de
-- admin/owner/staff permanece intacta.
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY clientes_alumno_propio ON public.clientes FOR SELECT TO authenticated
USING (auth_user_id = auth.uid() AND public.mi_rol()::text = 'alumno');

-- Permite la lectura de las propias membresías. No se concede INSERT/UPDATE ni
-- acceso a pagos reales, planes o vistas financieras globales.
ALTER TABLE public.membresias ENABLE ROW LEVEL SECURITY;
CREATE POLICY membresias_alumno_propias ON public.membresias FOR SELECT TO authenticated
USING (
  public.mi_rol()::text = 'alumno'
  AND EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = membresias.cliente_id AND c.auth_user_id = auth.uid()
  )
);

ALTER TABLE public.reportes_pago_alumno ENABLE ROW LEVEL SECURITY;
CREATE POLICY reportes_pago_alumno_lectura_propia
ON public.reportes_pago_alumno FOR SELECT TO authenticated
USING (
  public.mi_rol()::text = 'alumno'
  AND usuario_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = reportes_pago_alumno.cliente_id AND c.auth_user_id = auth.uid()
  )
);
CREATE POLICY reportes_pago_alumno_lectura_revision
ON public.reportes_pago_alumno FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));
CREATE POLICY reportes_pago_alumno_creacion_propia
ON public.reportes_pago_alumno FOR INSERT TO authenticated
WITH CHECK (
  public.mi_rol()::text = 'alumno'
  AND usuario_id = auth.uid()
  AND estado = 'PENDIENTE'
  AND reviewed_at IS NULL AND reviewed_by IS NULL
  AND motivo_rechazo IS NULL AND pago_real_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.id = reportes_pago_alumno.cliente_id AND c.auth_user_id = auth.uid()
  )
  AND (
    membresia_id IS NULL OR EXISTS (
      SELECT 1 FROM public.membresias m
      WHERE m.id = reportes_pago_alumno.membresia_id
        AND m.cliente_id = reportes_pago_alumno.cliente_id
        AND m.estado_pago <> 'CANCELADA'
    )
  )
);

REVOKE ALL ON TABLE public.reportes_pago_alumno FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reportes_pago_alumno TO authenticated;
GRANT INSERT (cliente_id, membresia_id, usuario_id, monto, fecha_pago,
  banco_origen, referencia, observacion)
ON TABLE public.reportes_pago_alumno TO authenticated;

CREATE FUNCTION public.reportar_pago_alumno(
  p_monto numeric,
  p_fecha_pago date,
  p_banco_origen text,
  p_referencia text,
  p_observacion text DEFAULT NULL,
  p_membresia_id uuid DEFAULT NULL
)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_cliente_id uuid;
  v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN
    RAISE EXCEPTION 'No tiene permiso para reportar pagos.' USING ERRCODE = '42501';
  END IF;
  SELECT c.id INTO v_cliente_id
  FROM public.clientes c
  WHERE c.auth_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no está vinculada a un cliente.' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0
     OR p_monto::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_monto <> round(p_monto, 2) OR p_monto > 99999999.99 THEN
    RAISE EXCEPTION 'El monto debe ser positivo y tener máximo dos decimales.' USING ERRCODE = '22023';
  END IF;
  IF p_fecha_pago IS NULL OR NOT isfinite(p_fecha_pago)
     OR p_fecha_pago > (now() AT TIME ZONE 'America/Guayaquil')::date THEN
    RAISE EXCEPTION 'La fecha de pago no puede ser futura.' USING ERRCODE = '22023';
  END IF;
  IF p_banco_origen IS NULL OR length(btrim(p_banco_origen)) NOT BETWEEN 2 AND 120
     OR p_referencia IS NULL OR length(btrim(p_referencia)) NOT BETWEEN 2 AND 120
     OR (p_observacion IS NOT NULL AND length(btrim(p_observacion)) > 1000) THEN
    RAISE EXCEPTION 'Banco, referencia u observación no son válidos.' USING ERRCODE = '22023';
  END IF;
  IF p_membresia_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membresias m
    WHERE m.id = p_membresia_id AND m.cliente_id = v_cliente_id
      AND m.estado_pago <> 'CANCELADA'
  ) THEN
    RAISE EXCEPTION 'La membresía no pertenece al alumno o no está disponible.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.reportes_pago_alumno
    (cliente_id, membresia_id, usuario_id, monto, fecha_pago,
     banco_origen, referencia, observacion)
  VALUES
    (v_cliente_id, p_membresia_id, auth.uid(), p_monto, p_fecha_pago,
     btrim(p_banco_origen), btrim(p_referencia), nullif(btrim(p_observacion), ''))
  RETURNING * INTO v_reporte;
  RETURN v_reporte;
END;
$$;

CREATE FUNCTION public.aprobar_reporte_pago_alumno(p_reporte_id uuid)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_reporte public.reportes_pago_alumno%ROWTYPE;
  v_pago public.pagos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para aprobar pagos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_reporte
  FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.'; END IF;
  IF v_reporte.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El reporte ya fue revisado.' USING ERRCODE = '55000';
  END IF;
  IF v_reporte.membresia_id IS NULL THEN
    RAISE EXCEPTION 'El reporte no tiene una membresía asociada y no puede aplicarse.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.membresias m
    WHERE m.id = v_reporte.membresia_id
      AND m.cliente_id = v_reporte.cliente_id
      AND m.estado_pago <> 'CANCELADA'
  ) THEN
    RAISE EXCEPTION 'La membresía asociada no está disponible.' USING ERRCODE = '22023';
  END IF;

  -- El flujo existente valida monto/saldo, inserta en pagos y sincroniza la
  -- membresía. La fecha elegida se fija al mediodía de Ecuador.
  SELECT * INTO v_pago FROM public.registrar_pago(
    v_reporte.membresia_id,
    v_reporte.monto,
    'Transferencia'::public.metodo_pago_enum,
    (v_reporte.fecha_pago::timestamp + time '12:00') AT TIME ZONE 'America/Guayaquil'
  );

  UPDATE public.reportes_pago_alumno
  SET estado = 'APROBADO', reviewed_at = now(), reviewed_by = auth.uid(),
      motivo_rechazo = NULL, pago_real_id = v_pago.id
  WHERE id = v_reporte.id
  RETURNING * INTO v_reporte;
  RETURN v_reporte;
END;
$$;

CREATE FUNCTION public.rechazar_reporte_pago_alumno(
  p_reporte_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para rechazar pagos.' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NOT NULL AND length(btrim(p_motivo)) > 500 THEN
    RAISE EXCEPTION 'El motivo no puede superar 500 caracteres.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_reporte
  FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.'; END IF;
  IF v_reporte.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El reporte ya fue revisado.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.reportes_pago_alumno
  SET estado = 'RECHAZADO', reviewed_at = now(), reviewed_by = auth.uid(),
      motivo_rechazo = nullif(btrim(p_motivo), ''), pago_real_id = NULL
  WHERE id = v_reporte.id
  RETURNING * INTO v_reporte;
  RETURN v_reporte;
END;
$$;

-- Una sola llamada devuelve exclusivamente el portal del alumno autenticado.
-- La lista de campos evita exponer comentarios internos o created_by.
CREATE FUNCTION public.obtener_portal_alumno()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_cliente public.clientes%ROWTYPE;
  v_hoy date := (now() AT TIME ZONE 'America/Guayaquil')::date;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN
    RAISE EXCEPTION 'No tiene permiso para consultar el portal.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_cliente FROM public.clientes WHERE auth_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no está vinculada a un cliente.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object(
      'id', v_cliente.id,
      'nombre_completo', v_cliente.nombre_completo,
      'cedula', v_cliente.cedula,
      'celular', v_cliente.celular,
      'email', v_cliente.email
    ),
    'membresias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'plan', p.nombre,
        'fecha_inicio', m.fecha_inicio,
        'fecha_fin', m.fecha_vencimiento,
        'saldo', m.saldo,
        'estado_pago', m.estado_pago,
        'estado_vigencia', CASE
          WHEN v_hoy < m.fecha_inicio THEN 'POR_INICIAR'
          WHEN v_hoy > m.fecha_vencimiento THEN 'VENCIDA'
          WHEN v_hoy = m.fecha_vencimiento THEN 'VENCE_HOY'
          WHEN m.fecha_vencimiento - v_hoy <= 3 THEN 'POR_VENCER'
          ELSE 'VIGENTE'
        END,
        'dias_restantes', m.fecha_vencimiento - v_hoy
      ) ORDER BY m.fecha_inicio DESC, m.created_at DESC)
      FROM public.membresias m
      JOIN public.planes p ON p.id = m.plan_id
      WHERE m.cliente_id = v_cliente.id
    ), '[]'::jsonb),
    'reportes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'membresia_id', r.membresia_id,
        'monto', r.monto,
        'fecha_pago', r.fecha_pago,
        'banco_origen', r.banco_origen,
        'referencia', r.referencia,
        'observacion', r.observacion,
        'estado', r.estado,
        'created_at', r.created_at,
        'reviewed_at', r.reviewed_at,
        'motivo_rechazo', r.motivo_rechazo
      ) ORDER BY r.created_at DESC)
      FROM public.reportes_pago_alumno r
      WHERE r.usuario_id = auth.uid() AND r.cliente_id = v_cliente.id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reportar_pago_alumno(numeric,date,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aprobar_reporte_pago_alumno(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rechazar_reporte_pago_alumno(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.obtener_portal_alumno()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reportar_pago_alumno(numeric,date,text,text,text,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_reporte_pago_alumno(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rechazar_reporte_pago_alumno(uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_portal_alumno()
  TO authenticated;

COMMIT;

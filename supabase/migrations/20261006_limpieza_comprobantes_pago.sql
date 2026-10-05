-- Limpieza de comprobantes despues de resolver un reporte.
-- Ejecutar despues de 20261005_comprobantes_pago_v1.sql.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.reportes_pago_alumno') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.reportes_pago_alumno'::regclass
         AND attname = 'comprobante_path' AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'Debe aplicarse primero 20261005_comprobantes_pago_v1.sql.';
  END IF;
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage no esta disponible.';
  END IF;
END;
$$;

ALTER TABLE public.reportes_pago_alumno
  ADD COLUMN comprobante_original_mime text,
  ADD COLUMN comprobante_original_size bigint,
  ADD COLUMN comprobante_eliminado_at timestamptz,
  ADD COLUMN comprobante_limpieza_estado varchar(12) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN comprobante_limpieza_intentos integer NOT NULL DEFAULT 0,
  ADD COLUMN comprobante_limpieza_error_at timestamptz;

-- Todas las filas preexistentes quedan LEGACY y no se limpian por efecto de la
-- migracion. Solo las filas creadas o resueltas desde ahora pasan a PENDIENTE.
ALTER TABLE public.reportes_pago_alumno
  ALTER COLUMN comprobante_limpieza_estado SET DEFAULT 'PENDIENTE',
  DROP CONSTRAINT reportes_pago_alumno_comprobante_obligatorio,
  ADD CONSTRAINT reportes_pago_alumno_comprobante_obligatorio CHECK (
    NOT comprobante_requerido
    OR (comprobante_path IS NOT NULL AND comprobante_mime IS NOT NULL AND comprobante_size IS NOT NULL)
    OR (
      comprobante_limpieza_estado = 'ELIMINADO'
      AND comprobante_path IS NULL
      AND comprobante_original_mime IS NOT NULL
      AND comprobante_original_size IS NOT NULL
      AND comprobante_eliminado_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT reportes_pago_alumno_limpieza_estado_valido CHECK (
    comprobante_limpieza_estado IN ('LEGACY', 'PENDIENTE', 'ERROR', 'ELIMINADO')
  ),
  ADD CONSTRAINT reportes_pago_alumno_limpieza_intentos_valido CHECK (
    comprobante_limpieza_intentos >= 0
  ),
  ADD CONSTRAINT reportes_pago_alumno_limpieza_coherente CHECK (
    comprobante_limpieza_estado = 'LEGACY'
    OR (
      comprobante_limpieza_estado IN ('PENDIENTE', 'ERROR')
      AND comprobante_path IS NOT NULL
      AND comprobante_mime IS NOT NULL
      AND comprobante_size IS NOT NULL
      AND comprobante_eliminado_at IS NULL
    )
    OR (
      comprobante_limpieza_estado = 'ELIMINADO'
      AND comprobante_path IS NULL
      AND comprobante_mime IS NULL
      AND comprobante_size IS NULL
      AND comprobante_eliminado_at IS NOT NULL
      AND comprobante_original_mime IN ('image/jpeg', 'image/png', 'application/pdf')
      AND comprobante_original_size BETWEEN 1 AND 5242880
    )
  );

COMMENT ON COLUMN public.reportes_pago_alumno.comprobante_eliminado_at IS
  'Fecha en que el objeto privado fue eliminado despues de aprobar o rechazar el reporte.';
COMMENT ON COLUMN public.reportes_pago_alumno.comprobante_limpieza_estado IS
  'LEGACY no se limpia automaticamente; PENDIENTE/ERROR permiten reintento; ELIMINADO conserva trazabilidad sin ruta firmable.';

-- Desde que un reporte deja de estar PENDIENTE ningun rol puede firmar el
-- objeto. Admin/owner solo reciben DELETE para comprobantes resueltos marcados
-- para limpieza. Alumno no recibe DELETE manual.
DROP POLICY IF EXISTS payment_receipts_select ON storage.objects;
DROP POLICY IF EXISTS payment_receipts_cleanup_select ON storage.objects;
DROP POLICY IF EXISTS payment_receipts_cleanup ON storage.objects;

CREATE POLICY payment_receipts_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND EXISTS (
    SELECT 1
    FROM public.reportes_pago_alumno r
    WHERE r.comprobante_path = storage.objects.name
      AND r.estado = 'PENDIENTE'
      AND (
        public.mi_rol()::text IN ('admin', 'owner')
        OR (public.mi_rol()::text = 'alumno' AND r.usuario_id = auth.uid())
      )
  )
);

-- remove() requiere SELECT y DELETE. Esta politica SELECT solo se activa para
-- las operaciones DELETE del API de Storage; no permite descargar ni firmar.
CREATE POLICY payment_receipts_cleanup_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND storage.allow_any_operation(ARRAY[
    'storage.object.delete',
    'storage.object.delete_many'
  ])
  AND public.mi_rol()::text IN ('admin', 'owner')
  AND EXISTS (
    SELECT 1
    FROM public.reportes_pago_alumno r
    WHERE r.comprobante_path = storage.objects.name
      AND r.estado IN ('APROBADO', 'RECHAZADO')
      AND r.comprobante_limpieza_estado IN ('PENDIENTE', 'ERROR')
  )
);

CREATE POLICY payment_receipts_cleanup
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND public.mi_rol()::text IN ('admin', 'owner')
  AND EXISTS (
    SELECT 1
    FROM public.reportes_pago_alumno r
    WHERE r.comprobante_path = storage.objects.name
      AND r.estado IN ('APROBADO', 'RECHAZADO')
      AND r.comprobante_limpieza_estado IN ('PENDIENTE', 'ERROR')
  )
);

CREATE OR REPLACE FUNCTION public.reportar_pago_alumno(
  p_monto numeric,
  p_fecha_pago date,
  p_observacion text,
  p_membresia_id uuid,
  p_comprobante_path text,
  p_comprobante_mime text,
  p_comprobante_size bigint
)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_cliente_id uuid;
  v_reporte public.reportes_pago_alumno%ROWTYPE;
  v_storage_metadata jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN
    RAISE EXCEPTION 'No tiene permiso para reportar pagos.' USING ERRCODE = '42501';
  END IF;
  SELECT c.id INTO v_cliente_id FROM public.clientes c WHERE c.auth_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no esta vinculada a un cliente.' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0
     OR p_monto::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_monto <> round(p_monto, 2) OR p_monto > 99999999.99 THEN
    RAISE EXCEPTION 'El monto debe ser positivo y tener maximo dos decimales.' USING ERRCODE = '22023';
  END IF;
  IF p_fecha_pago IS NULL OR NOT isfinite(p_fecha_pago)
     OR p_fecha_pago > (now() AT TIME ZONE 'America/Guayaquil')::date THEN
    RAISE EXCEPTION 'La fecha de pago no puede ser futura.' USING ERRCODE = '22023';
  END IF;
  IF p_observacion IS NOT NULL AND length(btrim(p_observacion)) > 1000 THEN
    RAISE EXCEPTION 'La observacion no puede superar 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_membresia_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.membresias m
    WHERE m.id = p_membresia_id AND m.cliente_id = v_cliente_id
      AND m.estado_pago <> 'CANCELADA'
  ) THEN
    RAISE EXCEPTION 'La membresia no pertenece al alumno o no esta disponible.' USING ERRCODE = '42501';
  END IF;
  IF p_comprobante_path IS NULL
     OR split_part(p_comprobante_path, '/', 1) <> auth.uid()::text
     OR p_comprobante_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf)$'
     OR p_comprobante_mime NOT IN ('image/jpeg', 'image/png', 'application/pdf')
     OR p_comprobante_size NOT BETWEEN 1 AND 5242880
     OR (p_comprobante_mime = 'image/jpeg' AND p_comprobante_path !~ '\.jpg$')
     OR (p_comprobante_mime = 'image/png' AND p_comprobante_path !~ '\.png$')
     OR (p_comprobante_mime = 'application/pdf' AND p_comprobante_path !~ '\.pdf$') THEN
    RAISE EXCEPTION 'El comprobante no es valido.' USING ERRCODE = '22023';
  END IF;
  SELECT o.metadata INTO v_storage_metadata
  FROM storage.objects o
  WHERE o.bucket_id = 'payment-receipts'
    AND o.name = p_comprobante_path
    AND o.owner_id = auth.uid()::text;
  IF NOT FOUND
     OR lower(COALESCE(v_storage_metadata->>'mimetype', '')) <> p_comprobante_mime
     OR COALESCE(v_storage_metadata->>'size', '') !~ '^[0-9]+$'
     OR (v_storage_metadata->>'size')::bigint <> p_comprobante_size THEN
    RAISE EXCEPTION 'El comprobante no existe o sus metadatos no coinciden.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.reportes_pago_alumno
    (cliente_id, membresia_id, usuario_id, monto, fecha_pago, banco_origen,
     referencia, observacion, comprobante_path, comprobante_mime,
     comprobante_size, comprobante_requerido, comprobante_original_mime,
     comprobante_original_size, comprobante_limpieza_estado)
  VALUES
    (v_cliente_id, p_membresia_id, auth.uid(), p_monto, p_fecha_pago, NULL,
     NULL, nullif(btrim(p_observacion), ''), p_comprobante_path,
     p_comprobante_mime, p_comprobante_size, true, p_comprobante_mime,
     p_comprobante_size, 'PENDIENTE')
  RETURNING * INTO v_reporte;
  RETURN v_reporte;
END;
$$;

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
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE = 'P0002'; END IF;
  IF v_reporte.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El reporte ya fue revisado.' USING ERRCODE = '55000';
  END IF;
  IF v_reporte.membresia_id IS NULL THEN
    RAISE EXCEPTION 'El reporte no tiene una membresia asociada.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_membresia FROM public.membresias
  WHERE id = v_reporte.membresia_id AND cliente_id = v_reporte.cliente_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La membresia no existe o no pertenece al alumno.' USING ERRCODE = '22023'; END IF;
  IF v_membresia.estado_pago = 'CANCELADA' THEN RAISE EXCEPTION 'No se puede aplicar un pago a una membresia cancelada.' USING ERRCODE = '22023'; END IF;
  IF v_membresia.saldo <= 0 THEN RAISE EXCEPTION 'La membresia no tiene saldo pendiente.' USING ERRCODE = '22023'; END IF;
  IF v_reporte.monto > v_membresia.saldo THEN RAISE EXCEPTION 'El pago reportado supera el saldo pendiente.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_pago FROM public.registrar_pago(
    v_reporte.membresia_id, v_reporte.monto, 'Transferencia'::public.metodo_pago_enum,
    (v_reporte.fecha_pago::timestamp + time '12:00') AT TIME ZONE 'America/Guayaquil'
  );
  IF v_pago.id IS NULL OR v_pago.membresia_id IS DISTINCT FROM v_reporte.membresia_id
     OR v_pago.monto IS DISTINCT FROM v_reporte.monto THEN
    RAISE EXCEPTION 'El pago real generado no coincide con el reporte.';
  END IF;
  UPDATE public.reportes_pago_alumno
  SET estado = 'APROBADO', reviewed_at = now(), reviewed_by = auth.uid(),
      motivo_rechazo = NULL, pago_real_id = v_pago.id,
      comprobante_limpieza_estado = CASE WHEN comprobante_path IS NOT NULL THEN 'PENDIENTE' ELSE comprobante_limpieza_estado END,
      comprobante_limpieza_error_at = NULL
  WHERE id = v_reporte.id AND estado = 'PENDIENTE'
  RETURNING * INTO v_reporte;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte cambio durante la aprobacion.' USING ERRCODE = '55000'; END IF;
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
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE = 'P0002'; END IF;
  IF v_reporte.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El reporte ya fue revisado.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.reportes_pago_alumno
  SET estado = 'RECHAZADO', reviewed_at = now(), reviewed_by = auth.uid(),
      motivo_rechazo = v_motivo, pago_real_id = NULL,
      comprobante_limpieza_estado = CASE WHEN comprobante_path IS NOT NULL THEN 'PENDIENTE' ELSE comprobante_limpieza_estado END,
      comprobante_limpieza_error_at = NULL
  WHERE id = v_reporte.id AND estado = 'PENDIENTE'
  RETURNING * INTO v_reporte;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte cambio durante el rechazo.' USING ERRCODE = '55000'; END IF;
  RETURN v_reporte;
END;
$$;

CREATE FUNCTION public.obtener_comprobante_pago_limpieza(p_reporte_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para limpiar comprobantes.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE = 'P0002'; END IF;
  IF v_reporte.estado NOT IN ('APROBADO', 'RECHAZADO') THEN
    RAISE EXCEPTION 'El reporte sigue pendiente.' USING ERRCODE = '55000';
  END IF;
  IF v_reporte.comprobante_limpieza_estado = 'LEGACY' THEN
    RAISE EXCEPTION 'El comprobante historico no entra en limpieza automatica.' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'path', v_reporte.comprobante_path,
    'eliminado_at', v_reporte.comprobante_eliminado_at,
    'estado', v_reporte.comprobante_limpieza_estado
  );
END;
$$;

CREATE FUNCTION public.confirmar_limpieza_comprobante(
  p_reporte_id uuid,
  p_comprobante_path text
)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para confirmar la limpieza.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE = 'P0002'; END IF;
  IF v_reporte.comprobante_limpieza_estado = 'ELIMINADO'
     AND v_reporte.comprobante_path IS NULL THEN
    RETURN v_reporte;
  END IF;
  IF v_reporte.estado NOT IN ('APROBADO', 'RECHAZADO')
     OR v_reporte.comprobante_limpieza_estado NOT IN ('PENDIENTE', 'ERROR')
     OR v_reporte.comprobante_path IS DISTINCT FROM p_comprobante_path THEN
    RAISE EXCEPTION 'El reporte no esta listo para confirmar limpieza.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.reportes_pago_alumno
  SET comprobante_original_mime = COALESCE(comprobante_original_mime, comprobante_mime),
      comprobante_original_size = COALESCE(comprobante_original_size, comprobante_size),
      comprobante_path = NULL,
      comprobante_mime = NULL,
      comprobante_size = NULL,
      comprobante_eliminado_at = COALESCE(comprobante_eliminado_at, now()),
      comprobante_limpieza_estado = 'ELIMINADO',
      comprobante_limpieza_intentos = comprobante_limpieza_intentos + 1,
      comprobante_limpieza_error_at = NULL
  WHERE id = v_reporte.id
  RETURNING * INTO v_reporte;
  RETURN v_reporte;
END;
$$;

CREATE FUNCTION public.registrar_fallo_limpieza_comprobante(
  p_reporte_id uuid,
  p_comprobante_path text
)
RETURNS public.reportes_pago_alumno
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para registrar la limpieza.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno
  WHERE id = p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE = 'P0002'; END IF;
  IF v_reporte.comprobante_limpieza_estado = 'ELIMINADO' THEN RETURN v_reporte; END IF;
  IF v_reporte.estado NOT IN ('APROBADO', 'RECHAZADO')
     OR v_reporte.comprobante_limpieza_estado NOT IN ('PENDIENTE', 'ERROR')
     OR v_reporte.comprobante_path IS DISTINCT FROM p_comprobante_path THEN
    RAISE EXCEPTION 'El reporte no esta listo para registrar el fallo.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.reportes_pago_alumno
  SET comprobante_limpieza_estado = 'ERROR',
      comprobante_limpieza_intentos = comprobante_limpieza_intentos + 1,
      comprobante_limpieza_error_at = now()
  WHERE id = v_reporte.id
  RETURNING * INTO v_reporte;
  RETURN v_reporte;
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_portal_alumno()
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
  IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta no esta vinculada a un cliente.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'cliente', jsonb_build_object(
      'id', v_cliente.id, 'nombre_completo', v_cliente.nombre_completo,
      'cedula', v_cliente.cedula, 'celular', v_cliente.celular, 'email', v_cliente.email
    ),
    'membresias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'plan', p.nombre, 'fecha_inicio', m.fecha_inicio,
        'fecha_fin', m.fecha_vencimiento, 'saldo', m.saldo, 'estado_pago', m.estado_pago,
        'estado_vigencia', CASE
          WHEN v_hoy < m.fecha_inicio THEN 'POR_INICIAR'
          WHEN v_hoy > m.fecha_vencimiento THEN 'VENCIDA'
          WHEN v_hoy = m.fecha_vencimiento THEN 'VENCE_HOY'
          WHEN m.fecha_vencimiento - v_hoy <= 3 THEN 'POR_VENCER'
          ELSE 'VIGENTE'
        END,
        'dias_restantes', m.fecha_vencimiento - v_hoy
      ) ORDER BY m.fecha_inicio DESC, m.created_at DESC)
      FROM public.membresias m JOIN public.planes p ON p.id = m.plan_id
      WHERE m.cliente_id = v_cliente.id
    ), '[]'::jsonb),
    'reportes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'membresia_id', r.membresia_id, 'monto', r.monto,
        'fecha_pago', r.fecha_pago, 'banco_origen', r.banco_origen,
        'referencia', r.referencia, 'observacion', r.observacion,
        'comprobante_path', r.comprobante_path, 'comprobante_mime', r.comprobante_mime,
        'comprobante_size', r.comprobante_size,
        'comprobante_eliminado_at', r.comprobante_eliminado_at,
        'comprobante_limpieza_estado', r.comprobante_limpieza_estado,
        'estado', r.estado, 'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
        'motivo_rechazo', r.motivo_rechazo
      ) ORDER BY r.created_at DESC)
      FROM public.reportes_pago_alumno r
      WHERE r.usuario_id = auth.uid() AND r.cliente_id = v_cliente.id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_reportes_pago_revision()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para consultar pagos reportados.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'cliente_id', r.cliente_id, 'usuario_id', r.usuario_id,
      'membresia_id', r.membresia_id, 'monto', r.monto, 'fecha_pago', r.fecha_pago,
      'banco_origen', r.banco_origen, 'referencia', r.referencia,
      'observacion', r.observacion, 'comprobante_path', r.comprobante_path,
      'comprobante_mime', r.comprobante_mime, 'comprobante_size', r.comprobante_size,
      'comprobante_eliminado_at', r.comprobante_eliminado_at,
      'comprobante_original_mime', r.comprobante_original_mime,
      'comprobante_original_size', r.comprobante_original_size,
      'comprobante_limpieza_estado', r.comprobante_limpieza_estado,
      'comprobante_limpieza_intentos', r.comprobante_limpieza_intentos,
      'comprobante_limpieza_error_at', r.comprobante_limpieza_error_at,
      'estado', r.estado, 'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
      'reviewed_by', r.reviewed_by, 'motivo_rechazo', r.motivo_rechazo,
      'pago_real_id', r.pago_real_id, 'alumno', c.nombre_completo,
      'membresia', pl.nombre, 'membresia_fecha_inicio', m.fecha_inicio,
      'membresia_fecha_fin', m.fecha_vencimiento, 'saldo_membresia', m.saldo,
      'estado_pago_membresia', m.estado_pago, 'revisor', u.nombre,
      'monto_aplicado', p.monto
    ) ORDER BY r.created_at DESC)
    FROM public.reportes_pago_alumno r
    JOIN public.clientes c ON c.id = r.cliente_id
    LEFT JOIN public.membresias m ON m.id = r.membresia_id AND m.cliente_id = r.cliente_id
    LEFT JOIN public.planes pl ON pl.id = m.plan_id
    LEFT JOIN public.usuarios u ON u.id = r.reviewed_by
    LEFT JOIN public.pagos p ON p.id = r.pago_real_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_comprobante_pago_limpieza(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirmar_limpieza_comprobante(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_fallo_limpieza_comprobante(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_comprobante_pago_limpieza(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_limpieza_comprobante(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_fallo_limpieza_comprobante(uuid,text) TO authenticated;

COMMIT;

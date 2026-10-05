-- Comprobantes privados para reportes de pago de alumnos.
-- Ejecutar despues de 20261004_pagos_completos_v1.sql.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.reportes_pago_alumno') IS NULL
     OR to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN
    RAISE EXCEPTION 'Deben aplicarse primero Portal Alumno V1 y Pagos Completos V1.';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage no esta disponible en esta base.';
  END IF;
END;
$$;

ALTER TABLE public.reportes_pago_alumno
  ALTER COLUMN banco_origen DROP NOT NULL,
  ALTER COLUMN referencia DROP NOT NULL,
  ADD COLUMN comprobante_path text,
  ADD COLUMN comprobante_mime text,
  ADD COLUMN comprobante_size bigint,
  ADD COLUMN comprobante_requerido boolean NOT NULL DEFAULT false;

-- Los registros existentes quedan marcados como historicos. A partir de esta
-- migracion, cualquier fila nueva adopta true y debe incluir evidencia valida.
ALTER TABLE public.reportes_pago_alumno
  ALTER COLUMN comprobante_requerido SET DEFAULT true,
  ADD CONSTRAINT reportes_pago_alumno_comprobante_completo CHECK (
    (comprobante_path IS NULL AND comprobante_mime IS NULL AND comprobante_size IS NULL)
    OR (
      comprobante_path IS NOT NULL
      AND comprobante_mime IN ('image/jpeg', 'image/png', 'application/pdf')
      AND comprobante_size BETWEEN 1 AND 5242880
      AND comprobante_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf)$'
      AND (
        (comprobante_mime = 'image/jpeg' AND comprobante_path ~ '\.jpg$')
        OR (comprobante_mime = 'image/png' AND comprobante_path ~ '\.png$')
        OR (comprobante_mime = 'application/pdf' AND comprobante_path ~ '\.pdf$')
      )
    )
  ),
  ADD CONSTRAINT reportes_pago_alumno_comprobante_obligatorio CHECK (
    NOT comprobante_requerido
    OR (comprobante_path IS NOT NULL AND comprobante_mime IS NOT NULL AND comprobante_size IS NOT NULL)
  );

COMMENT ON COLUMN public.reportes_pago_alumno.comprobante_path IS
  'Ruta privada en payment-receipts. Nunca una URL publica permanente.';
COMMENT ON COLUMN public.reportes_pago_alumno.comprobante_requerido IS
  'False solo identifica reportes historicos previos a esta migracion; los nuevos reportes requieren comprobante.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS payment_receipts_select ON storage.objects;
DROP POLICY IF EXISTS payment_receipts_insert ON storage.objects;
DROP POLICY IF EXISTS payment_receipts_cleanup ON storage.objects;

CREATE POLICY payment_receipts_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND (
    public.mi_rol()::text IN ('admin', 'owner')
    OR (
      public.mi_rol()::text = 'alumno'
      AND split_part(name, '/', 1) = auth.uid()::text
      AND EXISTS (
        SELECT 1
        FROM public.reportes_pago_alumno r
        WHERE r.comprobante_path = storage.objects.name
          AND r.usuario_id = auth.uid()
      )
    )
  )
);

CREATE POLICY payment_receipts_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment-receipts'
  AND public.mi_rol()::text = 'alumno'
  AND split_part(name, '/', 1) = auth.uid()::text
  AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|pdf)$'
  AND EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.auth_user_id = auth.uid()
  )
);

-- Solo permite limpiar una carga fallida que aun no este enlazada a un reporte.
-- No se concede UPDATE: el comprobante no se reemplaza despues del reporte.
CREATE POLICY payment_receipts_cleanup
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND public.mi_rol()::text = 'alumno'
  AND split_part(name, '/', 1) = auth.uid()::text
  AND NOT EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno r
    WHERE r.comprobante_path = storage.objects.name
  )
);

-- Se elimina la insercion directa: todos los nuevos reportes pasan por la RPC,
-- que comprueba al alumno, la membresia y la existencia del objeto privado.
REVOKE INSERT ON TABLE public.reportes_pago_alumno FROM authenticated;
REVOKE INSERT (cliente_id, membresia_id, usuario_id, monto, fecha_pago,
  banco_origen, referencia, observacion)
ON TABLE public.reportes_pago_alumno FROM authenticated;
DROP POLICY IF EXISTS reportes_pago_alumno_creacion_propia ON public.reportes_pago_alumno;

REVOKE ALL ON FUNCTION public.reportar_pago_alumno(numeric,date,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reportar_pago_alumno(
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
  SELECT c.id INTO v_cliente_id
  FROM public.clientes c
  WHERE c.auth_user_id = auth.uid();
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
     comprobante_size, comprobante_requerido)
  VALUES
    (v_cliente_id, p_membresia_id, auth.uid(), p_monto, p_fecha_pago, NULL,
     NULL, nullif(btrim(p_observacion), ''), p_comprobante_path,
     p_comprobante_mime, p_comprobante_size, true)
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no esta vinculada a un cliente.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object(
      'id', v_cliente.id, 'nombre_completo', v_cliente.nombre_completo,
      'cedula', v_cliente.cedula, 'celular', v_cliente.celular, 'email', v_cliente.email
    ),
    'membresias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'plan', p.nombre, 'fecha_inicio', m.fecha_inicio,
        'fecha_fin', m.fecha_vencimiento, 'saldo', m.saldo,
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
      FROM public.membresias m JOIN public.planes p ON p.id = m.plan_id
      WHERE m.cliente_id = v_cliente.id
    ), '[]'::jsonb),
    'reportes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'membresia_id', r.membresia_id, 'monto', r.monto,
        'fecha_pago', r.fecha_pago, 'banco_origen', r.banco_origen,
        'referencia', r.referencia, 'observacion', r.observacion,
        'comprobante_path', r.comprobante_path, 'comprobante_mime', r.comprobante_mime,
        'comprobante_size', r.comprobante_size, 'estado', r.estado,
        'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
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

REVOKE ALL ON FUNCTION public.reportar_pago_alumno(numeric,date,text,uuid,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reportar_pago_alumno(numeric,date,text,uuid,text,text,bigint)
  TO authenticated;

COMMIT;

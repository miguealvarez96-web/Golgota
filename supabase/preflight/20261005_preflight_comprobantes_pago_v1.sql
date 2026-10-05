BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_receipt_columns integer;
BEGIN
  IF current_setting('server_version_num')::integer < 120000 THEN
    RAISE EXCEPTION 'PostgreSQL 12 o superior es obligatorio.';
  END IF;
  IF to_regclass('public.reportes_pago_alumno') IS NULL
     OR to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN
    RAISE EXCEPTION 'Faltan Portal Alumno V1 o Pagos Completos V1.';
  END IF;
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage no esta disponible.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname = 'banco_origen' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname = 'referencia' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'No existen las columnas historicas banco_origen/referencia.';
  END IF;

  SELECT count(*) INTO v_receipt_columns
  FROM pg_attribute
  WHERE attrelid = 'public.reportes_pago_alumno'::regclass
    AND attname IN ('comprobante_path', 'comprobante_mime', 'comprobante_size', 'comprobante_requerido')
    AND NOT attisdropped;
  IF v_receipt_columns NOT IN (0, 4) THEN
    RAISE EXCEPTION 'Se detecto una aplicacion parcial de columnas de comprobante.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno r
    WHERE (r.estado = 'PENDIENTE' AND (r.reviewed_at IS NOT NULL OR r.pago_real_id IS NOT NULL))
       OR (r.estado = 'RECHAZADO' AND r.pago_real_id IS NOT NULL)
       OR (r.estado = 'APROBADO' AND r.pago_real_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Hay reportes con trazabilidad financiera inconsistente.';
  END IF;
END;
$$;

ROLLBACK;

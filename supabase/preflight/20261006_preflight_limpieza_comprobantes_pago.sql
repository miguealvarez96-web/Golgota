BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE v_columns integer;
BEGIN
  IF to_regclass('public.reportes_pago_alumno') IS NULL
     OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Faltan reportes de pago o Supabase Storage.';
  END IF;
  IF to_regprocedure('storage.allow_any_operation(text[])') IS NULL THEN
    RAISE EXCEPTION 'Storage no expone allow_any_operation(text[]), requerido para borrar sin habilitar firmas.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname = 'comprobante_path' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'payment-receipts' AND public = false
  ) THEN
    RAISE EXCEPTION 'Debe aplicarse primero Comprobantes Pago V1 con bucket privado.';
  END IF;
  SELECT count(*) INTO v_columns
  FROM pg_attribute
  WHERE attrelid = 'public.reportes_pago_alumno'::regclass
    AND attname IN (
      'comprobante_original_mime', 'comprobante_original_size',
      'comprobante_eliminado_at', 'comprobante_limpieza_estado',
      'comprobante_limpieza_intentos', 'comprobante_limpieza_error_at'
    ) AND NOT attisdropped;
  IF v_columns NOT IN (0, 6) THEN
    RAISE EXCEPTION 'Se detecto una aplicacion parcial del ajuste de limpieza.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno r
    WHERE (r.estado = 'PENDIENTE' AND r.pago_real_id IS NOT NULL)
       OR (r.estado = 'RECHAZADO' AND r.pago_real_id IS NOT NULL)
       OR (r.estado = 'APROBADO' AND r.pago_real_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Hay reportes con trazabilidad financiera inconsistente.';
  END IF;
END;
$$;

ROLLBACK;

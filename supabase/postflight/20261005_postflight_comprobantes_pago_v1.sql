BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_bucket storage.buckets%ROWTYPE;
  v_definition text;
BEGIN
  SELECT * INTO v_bucket FROM storage.buckets WHERE id = 'payment-receipts';
  IF NOT FOUND OR v_bucket.public OR v_bucket.file_size_limit <> 5242880 THEN
    RAISE EXCEPTION 'El bucket payment-receipts no es privado o no limita a 5 MB.';
  END IF;
  IF v_bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[] THEN
    RAISE EXCEPTION 'El bucket no tiene la lista MIME esperada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname IN ('banco_origen', 'referencia') AND attnotnull
  ) THEN
    RAISE EXCEPTION 'Banco y referencia deben aceptar NULL para reportes nuevos.';
  END IF;
  IF (
    SELECT count(*) FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname IN ('comprobante_path', 'comprobante_mime', 'comprobante_size', 'comprobante_requerido')
      AND NOT attisdropped
  ) <> 4 THEN
    RAISE EXCEPTION 'Faltan columnas de comprobante.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno
    WHERE comprobante_requerido
      AND (comprobante_path IS NULL OR comprobante_mime IS NULL OR comprobante_size IS NULL)
  ) THEN
    RAISE EXCEPTION 'Hay reportes nuevos sin comprobante completo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno
    WHERE comprobante_size > 5242880
       OR comprobante_mime NOT IN ('image/jpeg', 'image/png', 'application/pdf')
  ) THEN
    RAISE EXCEPTION 'Hay metadatos de comprobante fuera de las reglas.';
  END IF;
  IF has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated conserva INSERT directo sobre reportes.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'cliente_id', 'membresia_id', 'usuario_id', 'monto', 'fecha_pago',
      'banco_origen', 'referencia', 'observacion', 'comprobante_path',
      'comprobante_mime', 'comprobante_size', 'comprobante_requerido'
    ]) AS columns_to_check(column_name)
    WHERE has_column_privilege(
      'authenticated',
      'public.reportes_pago_alumno',
      column_name,
      'INSERT'
    )
  ) THEN
    RAISE EXCEPTION 'authenticated conserva INSERT por columna sobre reportes.';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.reportar_pago_alumno(numeric,date,text,uuid,text,text,bigint)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated no puede ejecutar la RPC nueva.';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.reportar_pago_alumno(numeric,date,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'La RPC historica sin comprobante sigue habilitada.';
  END IF;
  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('payment_receipts_select', 'payment_receipts_insert', 'payment_receipts_cleanup')
  ) <> 3 THEN
    RAISE EXCEPTION 'Faltan politicas del bucket de comprobantes.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'payment_receipts_%' AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'No debe existir reemplazo UPDATE de comprobantes.';
  END IF;

  SELECT pg_get_functiondef('public.reportar_pago_alumno(numeric,date,text,uuid,text,text,bigint)'::regprocedure)
  INTO v_definition;
  IF v_definition !~* 'storage\.objects'
     OR v_definition !~* 'comprobante_requerido'
     OR v_definition ~* 'INSERT\s+INTO\s+public\.pagos'
     OR v_definition ~* 'UPDATE\s+public\.membresias'
     OR v_definition ~* 'registrar_pago\s*\(' THEN
    RAISE EXCEPTION 'La RPC nueva no valida Storage o contiene una operacion financiera.';
  END IF;

  SELECT pg_get_functiondef('public.obtener_portal_alumno()'::regprocedure) INTO v_definition;
  IF v_definition !~* 'comprobante_path' OR v_definition !~* 'comprobante_mime' THEN
    RAISE EXCEPTION 'El portal del alumno no proyecta comprobantes.';
  END IF;
  SELECT pg_get_functiondef('public.listar_reportes_pago_revision()'::regprocedure) INTO v_definition;
  IF v_definition !~* 'comprobante_path' OR v_definition !~* 'comprobante_mime' THEN
    RAISE EXCEPTION 'La bandeja de revision no proyecta comprobantes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno r
    WHERE (r.estado = 'PENDIENTE' AND (r.reviewed_at IS NOT NULL OR r.pago_real_id IS NOT NULL))
       OR (r.estado = 'RECHAZADO' AND r.pago_real_id IS NOT NULL)
       OR (r.estado = 'APROBADO' AND r.pago_real_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Hay reportes con trazabilidad inconsistente.';
  END IF;
END;
$$;

ROLLBACK;

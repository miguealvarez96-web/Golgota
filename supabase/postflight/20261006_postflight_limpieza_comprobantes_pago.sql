BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_definition text;
  v_select_policy text;
  v_cleanup_select_policy text;
  v_delete_policy text;
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'payment-receipts') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'payment-receipts debe seguir siendo privado.';
  END IF;
  IF (
    SELECT count(*) FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname IN (
        'comprobante_original_mime', 'comprobante_original_size',
        'comprobante_eliminado_at', 'comprobante_limpieza_estado',
        'comprobante_limpieza_intentos', 'comprobante_limpieza_error_at'
      ) AND NOT attisdropped
  ) <> 6 THEN
    RAISE EXCEPTION 'Faltan columnas de trazabilidad de limpieza.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno
    WHERE comprobante_limpieza_estado = 'ELIMINADO'
      AND (comprobante_path IS NOT NULL OR comprobante_eliminado_at IS NULL
        OR comprobante_original_mime IS NULL OR comprobante_original_size IS NULL)
  ) THEN
    RAISE EXCEPTION 'Hay comprobantes eliminados sin trazabilidad coherente.';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_definition
  FROM pg_constraint
  WHERE conrelid = 'public.reportes_pago_alumno'::regclass
    AND conname = 'reportes_pago_alumno_comprobante_obligatorio';
  IF v_definition IS NULL OR v_definition !~* 'ELIMINADO'
     OR v_definition !~* 'comprobante_original_mime'
     OR v_definition !~* 'comprobante_eliminado_at' THEN
    RAISE EXCEPTION 'La obligatoriedad del comprobante no admite la limpieza trazable.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno
    WHERE comprobante_limpieza_estado IN ('PENDIENTE', 'ERROR')
      AND (comprobante_path IS NULL OR comprobante_eliminado_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Hay reintentos de limpieza sin ruta coherente.';
  END IF;

  SELECT qual INTO v_select_policy FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'payment_receipts_select';
  IF v_select_policy IS NULL OR v_select_policy !~* 'PENDIENTE'
     OR v_select_policy !~* 'usuario_id' THEN
    RAISE EXCEPTION 'La lectura de comprobantes no esta limitada a reportes pendientes propios.';
  END IF;
  SELECT qual INTO v_cleanup_select_policy FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'payment_receipts_cleanup_select';
  IF v_cleanup_select_policy IS NULL
     OR v_cleanup_select_policy !~* 'allow_any_operation'
     OR v_cleanup_select_policy !~* 'object.delete'
     OR v_cleanup_select_policy ~* 'object.sign'
     OR v_cleanup_select_policy !~* 'APROBADO'
     OR v_cleanup_select_policy !~* 'RECHAZADO' THEN
    RAISE EXCEPTION 'El SELECT auxiliar no esta limitado a operaciones DELETE de reportes resueltos.';
  END IF;
  SELECT qual INTO v_delete_policy FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'payment_receipts_cleanup';
  IF v_delete_policy IS NULL OR v_delete_policy !~* 'admin'
     OR v_delete_policy !~* 'owner' OR v_delete_policy ~* '''alumno'''
     OR v_delete_policy !~* 'APROBADO' OR v_delete_policy !~* 'RECHAZADO' THEN
    RAISE EXCEPTION 'La politica DELETE no esta restringida a revision admin/owner.';
  END IF;

  FOR v_definition IN
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'obtener_comprobante_pago_limpieza',
        'confirmar_limpieza_comprobante',
        'registrar_fallo_limpieza_comprobante'
      )
  LOOP
    IF v_definition !~* 'mi_rol\(\).*admin.*owner' THEN
      RAISE EXCEPTION 'Una RPC de limpieza no restringe admin/owner.';
    END IF;
  END LOOP;
  IF (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'obtener_comprobante_pago_limpieza',
        'confirmar_limpieza_comprobante',
        'registrar_fallo_limpieza_comprobante'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Faltan RPC de limpieza.';
  END IF;

  SELECT pg_get_functiondef('public.confirmar_limpieza_comprobante(uuid,text)'::regprocedure)
  INTO v_definition;
  IF v_definition !~* 'comprobante_path\s*=\s*NULL'
     OR v_definition !~* 'comprobante_eliminado_at'
     OR v_definition !~* 'comprobante_original_mime'
     OR v_definition !~* 'ELIMINADO' THEN
    RAISE EXCEPTION 'La confirmacion no conserva trazabilidad o no anula la ruta.';
  END IF;

  SELECT pg_get_functiondef('public.aprobar_reporte_pago_alumno(uuid)'::regprocedure)
  INTO v_definition;
  IF v_definition !~* 'registrar_pago'
     OR v_definition !~* 'comprobante_limpieza_estado'
     OR v_definition ~* 'DELETE\s+FROM\s+storage\.objects' THEN
    RAISE EXCEPTION 'La aprobacion no conserva el orden financiero antes de la limpieza.';
  END IF;
  SELECT pg_get_functiondef('public.rechazar_reporte_pago_alumno(uuid,text)'::regprocedure)
  INTO v_definition;
  IF v_definition ~* 'registrar_pago|UPDATE\s+public\.membresias|DELETE\s+FROM\s+storage\.objects'
     OR v_definition !~* 'comprobante_limpieza_estado' THEN
    RAISE EXCEPTION 'El rechazo altera finanzas o no agenda limpieza.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno r
    WHERE (r.estado = 'PENDIENTE' AND r.pago_real_id IS NOT NULL)
       OR (r.estado = 'RECHAZADO' AND r.pago_real_id IS NOT NULL)
       OR (r.estado = 'APROBADO' AND r.pago_real_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'La trazabilidad financiera fue alterada.';
  END IF;
END;
$$;

ROLLBACK;

-- Verifica invariantes del Portal Alumno tanto en su version original como despues
-- de las evoluciones de pagos, comprobantes y limpieza. No depende de nombres de
-- politicas que una migracion posterior haya reemplazado legitimamente.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_tiene_comprobantes boolean;
  v_tiene_limpieza boolean;
  v_reportar_oid regprocedure;
  v_reportar text;
  v_aprobar text;
  v_rechazar text;
  v_policy text;
BEGIN
  IF to_regclass('public.reportes_pago_alumno') IS NULL THEN
    RAISE EXCEPTION 'No existe reportes_pago_alumno.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'rol_usuario_enum' AND e.enumlabel = 'alumno'
  ) THEN
    RAISE EXCEPTION 'No existe el rol alumno.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname = 'comprobante_path' AND NOT attisdropped
  ) INTO v_tiene_comprobantes;
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.reportes_pago_alumno'::regclass
      AND attname = 'comprobante_limpieza_estado' AND NOT attisdropped
  ) INTO v_tiene_limpieza;

  IF to_regprocedure('public.aprobar_reporte_pago_alumno(uuid)') IS NULL
     OR to_regprocedure('public.rechazar_reporte_pago_alumno(uuid,text)') IS NULL
     OR to_regprocedure('public.obtener_portal_alumno()') IS NULL THEN
    RAISE EXCEPTION 'Falta una RPC del Portal del Alumno.';
  END IF;

  IF v_tiene_comprobantes THEN
    v_reportar_oid := to_regprocedure('public.reportar_pago_alumno(numeric,date,text,uuid,text,text,bigint)');
  ELSE
    v_reportar_oid := to_regprocedure('public.reportar_pago_alumno(numeric,date,text,text,text,uuid)');
  END IF;
  IF v_reportar_oid IS NULL THEN
    RAISE EXCEPTION 'Falta la RPC vigente para reportar pagos.';
  END IF;

  IF has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'DELETE')
     OR has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated tiene permisos destructivos o de revision directa.';
  END IF;
  IF has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'estado', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'reviewed_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'reviewed_by', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'motivo_rechazo', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'pago_real_id', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated puede insertar columnas de revision protegidas.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'reportes_pago_alumno' AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Existe una politica de modificacion o borrado normal en reportes.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'reportes_pago_alumno' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS no esta habilitado en reportes_pago_alumno.';
  END IF;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'reportes_pago_alumno' AND cmd = 'SELECT') <> 2
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies WHERE schemaname = 'public'
         AND tablename = 'reportes_pago_alumno' AND cmd = 'SELECT'
         AND qual ~* 'alumno' AND qual ~* 'usuario_id' AND qual ~* 'auth.uid'
         AND qual ~* 'cliente_id' AND qual ~* 'auth_user_id'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies WHERE schemaname = 'public'
         AND tablename = 'reportes_pago_alumno' AND cmd = 'SELECT'
         AND qual ~* 'admin' AND qual ~* 'owner'
         AND qual !~* 'staff' AND qual !~* 'alumno'
     ) THEN
    RAISE EXCEPTION 'Las politicas SELECT no aislan alumno propio y revision admin/owner.';
  END IF;

  IF v_tiene_comprobantes THEN
    IF has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'INSERT')
       OR EXISTS (
         SELECT 1 FROM pg_policies WHERE schemaname = 'public'
           AND tablename = 'reportes_pago_alumno' AND cmd IN ('INSERT', 'ALL')
       ) THEN
      RAISE EXCEPTION 'La arquitectura con comprobantes permite INSERT directo de reportes.';
    END IF;
    IF has_function_privilege(
      'authenticated', 'public.reportar_pago_alumno(numeric,date,text,text,text,uuid)', 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'La RPC historica sin comprobante sigue habilitada.';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public'
        AND tablename = 'reportes_pago_alumno' AND cmd = 'INSERT'
        AND with_check ~* 'alumno' AND with_check ~* 'usuario_id'
        AND with_check ~* 'auth.uid' AND with_check ~* 'PENDIENTE'
    ) THEN
      RAISE EXCEPTION 'La version original no limita la creacion al alumno propio pendiente.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'clientes' AND policyname = 'clientes_alumno_propio'
      AND qual LIKE '%auth_user_id = auth.uid()%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'membresias' AND policyname = 'membresias_alumno_propias'
      AND qual LIKE '%auth_user_id = auth.uid()%'
  ) THEN
    RAISE EXCEPTION 'Las politicas del alumno no limitan clientes/membresias por auth.uid().';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clientes'
      AND policyname = 'clientes_lectura'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clientes'
      AND policyname = 'clientes_consulta' AND cmd = 'SELECT'
      AND qual ~* 'rol' AND qual ~* 'admin'
      AND qual ~* 'owner' AND qual ~* 'staff'
  ) THEN
    RAISE EXCEPTION 'Una politica heredada de clientes podria permitir lectura cruzada al alumno.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reportes_pago_alumno'::regclass
      AND conname = 'reportes_pago_alumno_pago_real_id_key' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'pago_real_id no tiene restriccion UNIQUE.';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.reportes_pago_alumno'::regclass
        AND contype = 'f' AND confdeltype = 'r') <> 5 THEN
    RAISE EXCEPTION 'Las cinco relaciones de reportes deben usar ON DELETE RESTRICT.';
  END IF;
  IF to_regprocedure('public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamptz)') IS NULL
     OR to_regclass('public.clientes') IS NULL
     OR to_regclass('public.membresias') IS NULL
     OR to_regclass('public.pagos') IS NULL THEN
    RAISE EXCEPTION 'Se altero una dependencia existente de clientes/membresias/pagos.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_reportar_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.aprobar_reporte_pago_alumno(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rechazar_reporte_pago_alumno(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.obtener_portal_alumno()', 'EXECUTE')
     OR has_function_privilege('anon', v_reportar_oid, 'EXECUTE')
     OR has_function_privilege('anon', 'public.aprobar_reporte_pago_alumno(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rechazar_reporte_pago_alumno(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Los permisos EXECUTE de las RPC no son los esperados.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN (
      v_reportar_oid::oid,
      'public.aprobar_reporte_pago_alumno(uuid)'::regprocedure::oid,
      'public.rechazar_reporte_pago_alumno(uuid,text)'::regprocedure::oid,
      'public.obtener_portal_alumno()'::regprocedure::oid
    ) AND (NOT p.prosecdef OR NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']))
  ) THEN
    RAISE EXCEPTION 'Una RPC no es SECURITY DEFINER o no fija search_path=pg_catalog.';
  END IF;

  SELECT pg_get_functiondef(v_reportar_oid::oid) INTO v_reportar;
  SELECT pg_get_functiondef('public.aprobar_reporte_pago_alumno(uuid)'::regprocedure) INTO v_aprobar;
  SELECT pg_get_functiondef('public.rechazar_reporte_pago_alumno(uuid,text)'::regprocedure) INTO v_rechazar;

  IF v_reportar ~* 'registrar_pago\s*\('
     OR v_reportar ~* 'insert\s+into\s+public\.pagos'
     OR v_reportar ~* 'update\s+public\.membresias' THEN
    RAISE EXCEPTION 'Reportar un pago contiene una operación financiera.';
  END IF;
  IF v_rechazar ~* 'registrar_pago\s*\('
     OR v_rechazar ~* 'insert\s+into\s+public\.pagos'
     OR v_rechazar ~* 'update\s+public\.membresias' THEN
    RAISE EXCEPTION 'Rechazar un pago contiene una operación financiera.';
  END IF;
  IF v_aprobar !~* 'for\s+update'
     OR v_aprobar !~* 'estado\s*<>\s*''PENDIENTE'''
     OR v_aprobar !~* 'public\.registrar_pago\s*\('
     OR v_aprobar !~* 'mi_rol\(\)\s+NOT\s+IN\s*\(''admin'',\s*''owner''\)'
     OR v_aprobar !~* 'pago_real_id\s*=\s*v_pago\.id' THEN
    RAISE EXCEPTION 'La aprobacion no conserva bloqueo, rol, idempotencia o trazabilidad.';
  END IF;

  IF v_tiene_comprobantes THEN
    IF NOT EXISTS (
      SELECT 1 FROM storage.buckets
      WHERE id = 'payment-receipts' AND NOT public
    ) THEN
      RAISE EXCEPTION 'El bucket de comprobantes no es privado.';
    END IF;
    SELECT qual INTO v_policy FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd = 'SELECT' AND qual ~* 'payment-receipts'
      AND qual ~* 'admin' AND qual ~* 'owner' AND qual ~* 'alumno'
      AND qual ~* 'usuario_id' AND qual ~* 'auth.uid'
    LIMIT 1;
    IF v_policy IS NULL OR v_policy ~* 'staff' THEN
      RAISE EXCEPTION 'La lectura privada de comprobantes no bloquea staff o acceso cruzado.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'INSERT'
        AND with_check ~* 'payment-receipts' AND with_check ~* 'auth.uid'
    ) THEN
      RAISE EXCEPTION 'La carga de comprobantes no esta limitada al alumno propietario.';
    END IF;
  END IF;

  IF v_tiene_limpieza THEN
    SELECT qual INTO v_policy FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd = 'DELETE' AND qual ~* 'payment-receipts'
    LIMIT 1;
    IF v_policy IS NULL OR v_policy !~* 'admin' OR v_policy !~* 'owner'
       OR v_policy !~* 'APROBADO' OR v_policy !~* 'RECHAZADO'
       OR v_policy ~* 'alumno' OR v_policy ~* 'staff' THEN
      RAISE EXCEPTION 'La limpieza no esta restringida a admin/owner despues de revision.';
    END IF;
  END IF;
END;
$$;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN ('clientes', 'membresias', 'reportes_pago_alumno'))
   OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'payment_receipts_%')
ORDER BY schemaname, tablename, policyname;

ROLLBACK;

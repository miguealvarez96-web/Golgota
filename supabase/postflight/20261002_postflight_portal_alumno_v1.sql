-- Verificación de estructura y permisos después de aplicar en el dry-run.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_reportar text;
  v_aprobar text;
  v_rechazar text;
BEGIN
  IF to_regclass('public.reportes_pago_alumno') IS NULL THEN
    RAISE EXCEPTION 'No se creó reportes_pago_alumno.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'rol_usuario_enum' AND e.enumlabel = 'alumno'
  ) THEN
    RAISE EXCEPTION 'No existe el rol alumno.';
  END IF;
  IF to_regprocedure('public.reportar_pago_alumno(numeric,date,text,text,text,uuid)') IS NULL
     OR to_regprocedure('public.aprobar_reporte_pago_alumno(uuid)') IS NULL
     OR to_regprocedure('public.rechazar_reporte_pago_alumno(uuid,text)') IS NULL
     OR to_regprocedure('public.obtener_portal_alumno()') IS NULL THEN
    RAISE EXCEPTION 'Falta una RPC del Portal del Alumno.';
  END IF;
  IF has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'DELETE')
     OR has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'TRUNCATE') THEN
    RAISE EXCEPTION 'authenticated tiene permisos destructivos o de revisión directa.';
  END IF;
  IF has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'estado', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'reviewed_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'reviewed_by', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'motivo_rechazo', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reportes_pago_alumno', 'pago_real_id', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated puede insertar columnas de revisión protegidas.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'reportes_pago_alumno' AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Existe una política de modificación o borrado normal en reportes.';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'reportes_pago_alumno'
      AND policyname IN (
        'reportes_pago_alumno_lectura_propia',
        'reportes_pago_alumno_lectura_revision',
        'reportes_pago_alumno_creacion_propia'
      )) <> 3 THEN
    RAISE EXCEPTION 'Falta una política esperada de reportes de pago.';
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
    RAISE EXCEPTION 'Las políticas del alumno no limitan clientes/membresías por auth.uid().';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'reportes_pago_alumno'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado en reportes_pago_alumno.';
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
    RAISE EXCEPTION 'Una política heredada de clientes podría permitir lectura cruzada al alumno.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reportes_pago_alumno'::regclass
      AND conname = 'reportes_pago_alumno_pago_real_id_key' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'pago_real_id no tiene restricción UNIQUE.';
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
    RAISE EXCEPTION 'Se alteró una dependencia existente de clientes/membresías/pagos.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.reportar_pago_alumno(numeric,date,text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.aprobar_reporte_pago_alumno(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rechazar_reporte_pago_alumno(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.obtener_portal_alumno()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reportar_pago_alumno(numeric,date,text,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aprobar_reporte_pago_alumno(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rechazar_reporte_pago_alumno(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Los permisos EXECUTE de las RPC no son los esperados.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN (
      'public.reportar_pago_alumno(numeric,date,text,text,text,uuid)'::regprocedure,
      'public.aprobar_reporte_pago_alumno(uuid)'::regprocedure,
      'public.rechazar_reporte_pago_alumno(uuid,text)'::regprocedure,
      'public.obtener_portal_alumno()'::regprocedure
    ) AND (NOT p.prosecdef OR NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']))
  ) THEN
    RAISE EXCEPTION 'Una RPC no es SECURITY DEFINER o no fija search_path=pg_catalog.';
  END IF;

  SELECT pg_get_functiondef('public.reportar_pago_alumno(numeric,date,text,text,text,uuid)'::regprocedure)
    INTO v_reportar;
  SELECT pg_get_functiondef('public.aprobar_reporte_pago_alumno(uuid)'::regprocedure)
    INTO v_aprobar;
  SELECT pg_get_functiondef('public.rechazar_reporte_pago_alumno(uuid,text)'::regprocedure)
    INTO v_rechazar;

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
    RAISE EXCEPTION 'La aprobación no conserva bloqueo, rol, idempotencia o trazabilidad.';
  END IF;
END;
$$;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('clientes', 'membresias', 'reportes_pago_alumno')
ORDER BY tablename, policyname;

ROLLBACK;

-- Verificación de solo lectura posterior a BLOQUE 6.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_function record;
BEGIN
  IF to_regclass('public.privacidad_aceptaciones') IS NULL
     OR to_regclass('public.privacidad_solicitudes') IS NULL
     OR to_regtype('public.tipo_solicitud_privacidad_enum') IS NULL
     OR to_regtype('public.estado_solicitud_privacidad_enum') IS NULL THEN
    RAISE EXCEPTION 'Faltan objetos principales de BLOQUE 6.';
  END IF;
  IF to_regprocedure('public.registrar_aceptacion_privacidad(text,text,boolean)') IS NULL
     OR to_regprocedure('public.crear_solicitud_privacidad(public.tipo_solicitud_privacidad_enum,text)') IS NULL
     OR to_regprocedure('public.revisar_solicitud_privacidad(uuid,public.estado_solicitud_privacidad_enum,text)') IS NULL
     OR to_regprocedure('public.listar_solicitudes_privacidad()') IS NULL THEN
    RAISE EXCEPTION 'Faltan RPC de privacidad.';
  END IF;
  IF (
    SELECT count(*) FROM pg_class
    WHERE oid IN ('public.privacidad_aceptaciones'::regclass, 'public.privacidad_solicitudes'::regclass)
      AND relrowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'RLS no está habilitado en ambas tablas de privacidad.';
  END IF;
  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('privacidad_aceptaciones', 'privacidad_solicitudes')
  ) <> 4 THEN
    RAISE EXCEPTION 'El conjunto de políticas de privacidad no coincide con el diseño.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('privacidad_aceptaciones', 'privacidad_solicitudes')
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) THEN
    RAISE EXCEPTION 'La API recibió privilegios de escritura directa sobre privacidad.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'privacidad_aceptaciones'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'privacidad_solicitudes'
      AND grantee = 'authenticated' AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'Faltan privilegios SELECT protegidos por RLS.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.privacidad_aceptaciones'::regclass
      AND tgname = 'audit_privacidad_aceptaciones' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.privacidad_solicitudes'::regclass
      AND tgname = 'audit_privacidad_solicitudes' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Faltan triggers de trazabilidad de privacidad.';
  END IF;

  FOR v_function IN
    SELECT p.oid::regprocedure AS signature, p.prosecdef, p.proconfig,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    WHERE p.oid IN (
      'public.registrar_aceptacion_privacidad(text,text,boolean)'::regprocedure,
      'public.crear_solicitud_privacidad(public.tipo_solicitud_privacidad_enum,text)'::regprocedure,
      'public.revisar_solicitud_privacidad(uuid,public.estado_solicitud_privacidad_enum,text)'::regprocedure,
      'public.listar_solicitudes_privacidad()'::regprocedure
    )
  LOOP
    IF NOT v_function.prosecdef
       OR NOT ('search_path=pg_catalog' = ANY(COALESCE(v_function.proconfig, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'La RPC % no conserva SECURITY DEFINER y search_path seguro.', v_function.signature;
    END IF;
    IF v_function.definition ~* '\mdelete\s+from\M' THEN
      RAISE EXCEPTION 'La RPC % contiene borrado automático no permitido.', v_function.signature;
    END IF;
  END LOOP;
END;
$$;

SELECT estado::text, count(*)
FROM public.privacidad_solicitudes
GROUP BY estado
ORDER BY estado::text;

SELECT aviso_version, count(*)
FROM public.privacidad_aceptaciones
GROUP BY aviso_version
ORDER BY aviso_version;

ROLLBACK;

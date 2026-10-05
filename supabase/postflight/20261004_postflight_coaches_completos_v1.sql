-- Verificación estructural y de permisos después de BLOQUE 3.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_publication_trigger text;
BEGIN
  IF to_regclass('public.wods') IS NULL
     OR to_regclass('public.comunicados') IS NULL THEN
    RAISE EXCEPTION 'Falta una tabla de BLOQUE 3.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.wods'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.comunicados'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'RLS no está habilitado en WOD o comunicados.';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wods') <> 4
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comunicados') <> 4 THEN
    RAISE EXCEPTION 'El conjunto de políticas de BLOQUE 3 no es el esperado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wods'
      AND policyname = 'wods_lectura_staff_publicados'
      AND qual ~* 'staff' AND qual ~* 'publicado'
      AND qual ~* 'America/Guayaquil'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'comunicados'
      AND policyname = 'comunicados_lectura_staff_publicados'
      AND qual ~* 'staff' AND qual ~* 'publicado'
      AND qual ~* 'fecha_publicacion'
  ) THEN
    RAISE EXCEPTION 'La lectura de staff no está limitada a contenido publicado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('wods', 'comunicados')
      AND (COALESCE(qual, '') ~* 'alumno' OR COALESCE(with_check, '') ~* 'alumno')
  ) THEN
    RAISE EXCEPTION 'Alumno obtuvo una política del portal coach.';
  END IF;
  IF has_table_privilege('authenticated', 'public.wods', 'DELETE')
     OR has_table_privilege('authenticated', 'public.comunicados', 'DELETE')
     OR has_column_privilege('authenticated', 'public.wods', 'created_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.comunicados', 'created_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.comunicados', 'fecha_publicacion', 'UPDATE') THEN
    RAISE EXCEPTION 'Hay permisos destructivos o de auditoría no permitidos.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.wods', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.comunicados', 'SELECT') THEN
    RAISE EXCEPTION 'Faltan permisos de lectura protegidos por RLS.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_membresias_verificacion'
      AND column_name IN ('valor', 'abono', 'saldo', 'estado_pago', 'metodo_pago')
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_membresias_verificacion'
      AND column_name = 'fecha_inicio'
  ) THEN
    RAISE EXCEPTION 'La proyección de vigencia expone finanzas o no incluye fecha de inicio.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.v_membresias_verificacion
    WHERE estado_vigencia NOT IN ('POR_INICIAR', 'VIGENTE', 'POR_VENCER', 'VENCE_HOY', 'VENCIDA')
       OR estado_vigencia IS NULL
  ) THEN
    RAISE EXCEPTION 'La proyección produjo un estado de vigencia inválido.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.set_comunicado_fecha_publicacion()'::regprocedure
      AND (
        NOT p.prosecdef
        OR NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog'])
      )
  ) THEN
    RAISE EXCEPTION 'El trigger de publicación no conserva SECURITY DEFINER y search_path seguro.';
  END IF;

  SELECT pg_get_functiondef('public.set_comunicado_fecha_publicacion()'::regprocedure)
  INTO v_publication_trigger;
  IF v_publication_trigger !~* 'NEW\.fecha_publicacion := now\(\)'
     OR v_publication_trigger !~* 'NEW\.fecha_publicacion := NULL' THEN
    RAISE EXCEPTION 'El control de publicación no conserva fecha y aislamiento esperados.';
  END IF;
END;
$$;

SELECT table_name, row_security_active(format('public.%I', table_name)::regclass)
FROM (VALUES ('wods'), ('comunicados')) AS tables(table_name)
ORDER BY table_name;

ROLLBACK;

-- Solo lectura. Validar antes de aplicar el bloque de operacion y UX.
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.wods') IS NULL OR to_regprocedure('public.mi_rol()') IS NULL THEN
    RAISE EXCEPTION 'Falta la base de WOD o la funcion de roles.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wods'
      AND column_name IN ('horario_grupo', 'youtube_url', 'notas')
  ) THEN
    RAISE EXCEPTION 'El bloque parece aplicado o parcialmente aplicado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wods'
      AND policyname = 'wods_creacion_gestion'
      AND COALESCE(with_check, '') ~* 'admin.*owner'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wods'
      AND policyname = 'wods_edicion_gestion'
      AND COALESCE(qual, '') ~* 'admin.*owner'
  ) THEN
    RAISE EXCEPTION 'Las politicas WOD base no coinciden con el estado esperado.';
  END IF;
  IF has_table_privilege('authenticated', 'public.wods', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated conserva DELETE inesperado sobre WOD.';
  END IF;
END;
$$;

SELECT count(*) AS wods_existentes FROM public.wods;

ROLLBACK;

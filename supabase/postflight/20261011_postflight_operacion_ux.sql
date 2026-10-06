-- Verificacion de estructura, permisos y RLS del bloque de operacion y UX.
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wods'
      AND column_name IN ('horario_grupo', 'youtube_url', 'notas')
  ) <> 3 THEN
    RAISE EXCEPTION 'Faltan columnas del WOD ampliado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.wods'::regclass AND conname = 'wods_youtube_url_check'
  ) THEN
    RAISE EXCEPTION 'Falta la validacion de URL del WOD.';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wods') <> 4 THEN
    RAISE EXCEPTION 'El conjunto de politicas WOD no es el esperado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wods'
      AND policyname = 'wods_creacion_gestion'
      AND COALESCE(with_check, '') ~* 'admin.*owner.*staff'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wods'
      AND policyname = 'wods_edicion_gestion'
      AND COALESCE(qual, '') ~* 'admin.*owner.*staff'
      AND COALESCE(with_check, '') ~* 'admin.*owner.*staff'
  ) THEN
    RAISE EXCEPTION 'Staff no tiene gestion WOD protegida por RLS.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wods'
      AND policyname = 'wods_lectura_alumno_publicados'
      AND COALESCE(qual, '') ~* 'alumno'
      AND COALESCE(qual, '') ~* 'publicado'
      AND COALESCE(qual, '') ~* 'America/Guayaquil'
  ) THEN
    RAISE EXCEPTION 'Alumno no tiene lectura limitada al WOD publicado del dia.';
  END IF;
  IF has_table_privilege('authenticated', 'public.wods', 'DELETE')
     OR has_column_privilege('authenticated', 'public.wods', 'created_by', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.wods', 'horario_grupo', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.wods', 'youtube_url', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.wods', 'notas', 'UPDATE') THEN
    RAISE EXCEPTION 'Los privilegios WOD no son los esperados.';
  END IF;
END;
$$;

SELECT id, fecha, publicado
FROM public.wods
ORDER BY fecha DESC
LIMIT 5;

ROLLBACK;

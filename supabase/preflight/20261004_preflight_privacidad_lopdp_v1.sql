-- Solo lectura. Validar antes de BLOQUE 6.
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.auditoria_logs') IS NULL THEN
    RAISE EXCEPTION 'Faltan public.usuarios o public.auditoria_logs.';
  END IF;
  IF to_regprocedure('public.mi_rol()') IS NULL
     OR to_regprocedure('public.registrar_auditoria()') IS NULL
     OR to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Faltan funciones base de rol, auditoría o updated_at.';
  END IF;
  IF to_regclass('public.privacidad_aceptaciones') IS NOT NULL
     OR to_regclass('public.privacidad_solicitudes') IS NOT NULL
     OR to_regtype('public.tipo_solicitud_privacidad_enum') IS NOT NULL
     OR to_regtype('public.estado_solicitud_privacidad_enum') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN (
           'version_aviso_privacidad_vigente', 'registrar_aceptacion_privacidad',
           'crear_solicitud_privacidad', 'revisar_solicitud_privacidad',
           'listar_solicitudes_privacidad'
         )
     ) THEN
    RAISE EXCEPTION 'BLOQUE 6 parece total o parcialmente aplicado; no repetir sin revisión.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'auditoria_logs'
      AND policyname = 'auditoria_admin'
  ) THEN
    RAISE EXCEPTION 'La auditoría existente no conserva su política restringida a admin.';
  END IF;
END;
$$;

SELECT count(*) AS usuarios_existentes FROM public.usuarios;
SELECT count(*) AS registros_auditoria_existentes FROM public.auditoria_logs;

ROLLBACK;

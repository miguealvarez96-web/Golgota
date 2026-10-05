BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.clientes') IS NULL
     OR to_regclass('public.privacidad_aceptaciones') IS NULL THEN
    RAISE EXCEPTION 'Faltan dependencias de usuarios, clientes o privacidad.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.clientes'::regclass
      AND attname = 'auth_user_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Falta clientes.auth_user_id.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'rol_usuario_enum' AND e.enumlabel = 'alumno'
  ) THEN
    RAISE EXCEPTION 'Falta el rol alumno.';
  END IF;
  IF to_regprocedure('public.version_aviso_privacidad_vigente()') IS NULL
     OR to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION 'Faltan funciones base de privacidad o Auth.';
  END IF;
  IF to_regclass('public.registro_alumno_intentos') IS NOT NULL
     OR to_regprocedure('public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'BLOQUE 8 parece total o parcialmente aplicado.';
  END IF;
END;
$$;

SELECT count(*) AS clientes_existentes FROM public.clientes;
SELECT count(*) AS clientes_vinculados FROM public.clientes WHERE auth_user_id IS NOT NULL;

ROLLBACK;

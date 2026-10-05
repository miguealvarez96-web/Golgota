BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_preparar text;
  v_trigger text;
BEGIN
  IF to_regclass('public.registro_alumno_intentos') IS NULL
     OR to_regprocedure('public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Faltan objetos de BLOQUE 8.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'registro_alumno_intentos' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS no esta habilitado en intentos de registro.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'registro_alumno_intentos'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) OR EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'registro_alumno_intentos'
  ) THEN
    RAISE EXCEPTION 'Los intentos tienen acceso directo no permitido.';
  END IF;
  IF NOT has_function_privilege('anon', 'public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Los permisos de preparacion publica no son los esperados.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.privacidad_aceptaciones'::regclass
      AND conname = 'privacidad_aceptaciones_contexto_check'
      AND pg_get_constraintdef(oid) ~ 'REGISTRO_PUBLICO'
  ) THEN
    RAISE EXCEPTION 'Privacidad no admite el contexto REGISTRO_PUBLICO.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_created' AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'El trigger de Auth no esta habilitado.';
  END IF;

  SELECT pg_get_functiondef('public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)'::regprocedure)
    INTO v_preparar;
  SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) INTO v_trigger;
  IF v_preparar !~* 'auth\.uid\(\) IS NOT NULL'
     OR v_preparar !~* 'auth\.users'
     OR v_preparar !~* 'auth_user_id IS NOT NULL'
     OR v_preparar !~* 'HELP_REQUIRED'
     OR v_preparar !~* 'RATE_LIMITED' THEN
    RAISE EXCEPTION 'La preparacion no cubre sesion, duplicados, apropiacion o abuso.';
  END IF;
  IF v_trigger !~* '''alumno'''
     OR v_trigger ~* '''admin''|''owner''|''staff'''
     OR v_trigger !~* 'activo,?\s*\)'
     OR v_trigger !~* 'false'
     OR v_trigger !~* 'INSERT INTO public\.clientes'
     OR v_trigger !~* 'auth_user_id'
     OR v_trigger !~* 'INSERT INTO public\.privacidad_aceptaciones'
     OR v_trigger !~* 'REGISTRO_PUBLICO'
     OR v_trigger !~* 'COMPLETADO' THEN
    RAISE EXCEPTION 'El trigger no fuerza alumno, cuarentena o finalizacion atomica.';
  END IF;
  IF v_trigger ~* 'INSERT INTO public\.membresias'
     OR v_trigger ~* 'INSERT INTO public\.pagos'
     OR v_trigger ~* 'service_role' THEN
    RAISE EXCEPTION 'El registro intenta crear membresias, pagos o usar service role.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.registro_alumno_intentos
    WHERE (estado = 'COMPLETADO' AND (auth_user_id IS NULL OR completed_at IS NULL))
       OR (estado <> 'COMPLETADO' AND auth_user_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Hay intentos con estado inconsistente.';
  END IF;
END;
$$;

SELECT p.proname, p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('preparar_registro_alumno', 'handle_new_user')
ORDER BY p.proname;

ROLLBACK;

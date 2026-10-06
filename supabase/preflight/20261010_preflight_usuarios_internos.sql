-- Solo lectura. Validar antes de preparar usuarios internos administrados.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_trigger_function text;
BEGIN
  IF to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.auditoria_logs') IS NULL
     OR to_regprocedure('public.mi_rol()') IS NULL
     OR to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION 'Faltan objetos base de usuarios, autorizacion o auditoria.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'login_username'
  ) OR to_regprocedure('public.normalize_login_username()') IS NOT NULL THEN
    RAISE EXCEPTION 'El bloque de usuarios internos parece aplicado o parcialmente aplicado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.usuarios'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS no esta habilitado en public.usuarios.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuarios'
      AND policyname = 'usuarios_admin'
      AND COALESCE(qual, '') ~* 'mi_rol.*admin'
      AND COALESCE(with_check, '') ~* 'mi_rol.*admin'
  ) THEN
    RAISE EXCEPTION 'La politica usuarios_admin no conserva control exclusivo de escritura.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuarios'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND policyname <> 'usuarios_admin'
  ) THEN
    RAISE EXCEPTION 'Existe otra politica de escritura sobre usuarios; revisar antes de continuar.';
  END IF;
  SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure)
  INTO v_trigger_function;
  IF v_trigger_function !~* 'raw_user_meta_data\s*->>\s*''student_registration_token'''
     OR v_trigger_function !~* 'v_token_text IS NULL'
     OR v_trigger_function !~* 'INSERT INTO public\.usuarios(.|\n)*''alumno''\s*,\s*false'
     OR v_trigger_function !~* 'INSERT INTO public\.usuarios(.|\n)*''alumno''\s*,\s*true'
     OR v_trigger_function !~* 'INSERT INTO public\.clientes'
     OR v_trigger_function !~* 'auth_user_id'
     OR v_trigger_function !~* 'INSERT INTO public\.privacidad_aceptaciones'
     OR v_trigger_function !~* 'REGISTRO_PUBLICO'
     OR v_trigger_function !~* 'COMPLETADO'
     OR v_trigger_function ~* 'raw_user_meta_data\s*->>?\s*''(rol|role|tipo_rol|account_type)'''
     OR v_trigger_function ~* '''(admin|owner|staff)''' THEN
    RAISE EXCEPTION 'handle_new_user no conserva el autorregistro seguro requerido.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE lower(email) LIKE '%@golgota.internal'
  ) THEN
    RAISE EXCEPTION 'Ya existen correos tecnicos internos; revisar manualmente antes de migrar.';
  END IF;
END;
$$;

SELECT rol::text, activo, count(*) AS cantidad
FROM public.usuarios
GROUP BY rol, activo
ORDER BY rol, activo;

ROLLBACK;

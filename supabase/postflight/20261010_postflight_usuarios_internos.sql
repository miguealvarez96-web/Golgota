-- Verificacion estructural y de permisos. No modifica datos.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_trigger_function text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usuarios'
      AND column_name = 'login_username' AND data_type = 'text' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Falta usuarios.login_username nullable de tipo text.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'usuarios'
      AND indexname = 'usuarios_login_username_lower_key'
      AND indexdef ~* 'UNIQUE.*lower\(login_username\).*WHERE.*login_username IS NOT NULL'
  ) THEN
    RAISE EXCEPTION 'Falta el indice unico case-insensitive de login_username.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.usuarios'::regclass
      AND conname = 'usuarios_login_username_format_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.usuarios'::regclass
      AND conname = 'usuarios_login_username_internal_check'
  ) THEN
    RAISE EXCEPTION 'Faltan restricciones de formato o identidad interna.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.usuarios'::regclass
      AND tgname = 'usuarios_normalize_login_username' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Falta el trigger de normalizacion de login_username.';
  END IF;
  SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) INTO v_trigger_function;
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
    RAISE EXCEPTION 'handle_new_user no conserva la cuarentena segura del autorregistro.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE login_username IS NOT NULL AND (
      login_username <> lower(login_username)
      OR login_username !~ '^[a-z0-9._-]{3,50}$'
      OR rol::text NOT IN ('owner', 'staff')
      OR lower(email) <> login_username || '@golgota.internal'
    )
  ) THEN
    RAISE EXCEPTION 'Hay usuarios internos que incumplen las invariantes.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuarios'
      AND policyname = 'usuarios_admin'
      AND COALESCE(qual, '') ~* 'mi_rol.*admin'
      AND COALESCE(with_check, '') ~* 'mi_rol.*admin'
  ) THEN
    RAISE EXCEPTION 'La escritura de usuarios no esta restringida a admin.';
  END IF;
  IF has_table_privilege('authenticated', 'public.usuarios', 'DELETE')
     OR has_table_privilege('authenticated', 'public.usuarios', 'INSERT')
     OR has_table_privilege('authenticated', 'public.usuarios', 'TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.usuarios', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.usuarios', 'login_username', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.usuarios', 'id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.usuarios', 'created_at', 'UPDATE') THEN
    RAISE EXCEPTION 'Los privilegios efectivos de usuarios no son los esperados.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuarios'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND policyname <> 'usuarios_admin'
  ) THEN
    RAISE EXCEPTION 'Existe una politica de escritura ajena a usuarios_admin.';
  END IF;
END;
$$;

SELECT count(*) AS cuentas_internas
FROM public.usuarios
WHERE login_username IS NOT NULL;

ROLLBACK;

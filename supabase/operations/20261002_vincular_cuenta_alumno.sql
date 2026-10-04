-- Operación manual para vincular una cuenta Auth existente con un cliente
-- existente. Ejecutar solamente después de aplicar Portal Alumno V1 y de
-- verificar presencialmente la identidad del titular.
--
-- Ejemplo (NO ejecutar como parte de la migración):
-- psql -X -v ON_ERROR_STOP=1 --dbname $env:SUPABASE_DB_URL `
--   -v auth_user_id='UUID_AUTH' -v cliente_id='UUID_CLIENTE' `
--   --file .\supabase\operations\20261002_vincular_cuenta_alumno.sql

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL app.student_auth_user_id = :'auth_user_id';
SET LOCAL app.student_client_id = :'cliente_id';

DO $$
DECLARE
  v_auth_user_id uuid := current_setting('app.student_auth_user_id')::uuid;
  v_cliente_id uuid := current_setting('app.student_client_id')::uuid;
  v_rol text;
  v_activo boolean;
  v_vinculo_actual uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'rol_usuario_enum'
      AND e.enumlabel = 'alumno'
  ) THEN
    RAISE EXCEPTION 'Primero debe aplicarse la migración Portal Alumno V1.';
  END IF;

  PERFORM 1 FROM auth.users WHERE id = v_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta auth indicada no existe.';
  END IF;

  SELECT u.rol::text, u.activo
  INTO v_rol, v_activo
  FROM public.usuarios u
  WHERE u.id = v_auth_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta auth no tiene perfil en public.usuarios.';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El perfil está inactivo; no se reactiva automáticamente.';
  END IF;
  IF v_rol NOT IN ('staff', 'alumno') THEN
    RAISE EXCEPTION 'No se puede convertir automáticamente un perfil % en alumno.', v_rol;
  END IF;

  SELECT c.auth_user_id
  INTO v_vinculo_actual
  FROM public.clientes c
  WHERE c.id = v_cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente indicado no existe.';
  END IF;
  IF v_vinculo_actual IS NOT NULL AND v_vinculo_actual <> v_auth_user_id THEN
    RAISE EXCEPTION 'El cliente ya está vinculado a otra cuenta auth.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.clientes c
    WHERE c.auth_user_id = v_auth_user_id AND c.id <> v_cliente_id
  ) THEN
    RAISE EXCEPTION 'La cuenta auth ya está vinculada a otro cliente.';
  END IF;

  -- Ambas relaciones cambian en la misma transacción: nunca queda una cuenta
  -- alumno confirmada sin cliente, ni un cliente apuntando a un rol operativo.
  UPDATE public.usuarios
  SET rol = 'alumno'::public.rol_usuario_enum,
      updated_at = now()
  WHERE id = v_auth_user_id;

  UPDATE public.clientes
  SET auth_user_id = v_auth_user_id
  WHERE id = v_cliente_id;
END;
$$;

COMMIT;

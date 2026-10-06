-- Cuentas internas owner/staff. No crea usuarios ni almacena contrasenas.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- Guardar la definicion exacta del trigger de autorregistro. Este bloque no la
-- reemplaza: las altas Auth internas entran primero en su cuarentena alumno/false.
CREATE TEMP TABLE usuarios_internos_handle_guard
ON COMMIT DROP
AS SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS definition;

ALTER TABLE public.usuarios
  ADD COLUMN login_username text;

CREATE FUNCTION public.normalize_login_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.login_username := NULLIF(lower(btrim(NEW.login_username)), '');
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_normalize_login_username
BEFORE INSERT OR UPDATE OF login_username ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.normalize_login_username();

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_login_username_format_check CHECK (
    login_username IS NULL OR (
      login_username = lower(login_username)
      AND login_username ~ '^[a-z0-9._-]{3,50}$'
    )
  ),
  ADD CONSTRAINT usuarios_login_username_internal_check CHECK (
    login_username IS NULL OR (
      rol IN ('owner', 'staff')
      AND lower(email) = login_username || '@golgota.internal'
    )
  );

CREATE UNIQUE INDEX usuarios_login_username_lower_key
  ON public.usuarios (lower(login_username))
  WHERE login_username IS NOT NULL;

COMMENT ON COLUMN public.usuarios.login_username IS
  'Identificador opcional de acceso para cuentas internas owner/staff. Nunca contiene correo real ni credenciales.';

-- La politica existente usuarios_admin sigue siendo la unica via authenticated
-- para UPDATE. La seleccion propia permite validar la cuenta tras login. Las
-- altas se originan exclusivamente en Auth y su trigger SECURITY DEFINER.
REVOKE ALL ON TABLE public.usuarios FROM PUBLIC, anon, authenticated;
DO $$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_columns
  FROM pg_attribute
  WHERE attrelid = 'public.usuarios'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format(
    'REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.usuarios FROM PUBLIC, anon, authenticated',
    v_columns, v_columns, v_columns, v_columns
  );
END;
$$;
GRANT SELECT ON TABLE public.usuarios TO authenticated;
GRANT UPDATE (email, nombre, rol, activo, login_username)
  ON public.usuarios TO authenticated;

DO $$
BEGIN
  IF pg_get_functiondef('public.handle_new_user()'::regprocedure)
     IS DISTINCT FROM (SELECT definition FROM usuarios_internos_handle_guard) THEN
    RAISE EXCEPTION 'La migracion altero handle_new_user; se cancela para preservar el autorregistro.';
  END IF;
END;
$$;

COMMIT;

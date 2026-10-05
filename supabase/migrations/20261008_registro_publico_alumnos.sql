BEGIN;

CREATE TABLE public.registro_alumno_intentos (
  id uuid PRIMARY KEY,
  nombres varchar(255) NOT NULL,
  apellidos varchar(255) NOT NULL,
  nombre_completo varchar(255) NOT NULL,
  cedula varchar(20) NOT NULL,
  celular varchar(20) NOT NULL,
  email varchar(255) NOT NULL,
  aviso_version varchar(32) NOT NULL,
  comunicaciones_promocionales boolean NOT NULL DEFAULT false,
  estado varchar(16) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'COMPLETADO', 'EXPIRADO')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT registro_alumno_intento_estado_coherente CHECK (
    (estado = 'PENDIENTE' AND auth_user_id IS NULL AND completed_at IS NULL)
    OR (estado = 'COMPLETADO' AND auth_user_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (estado = 'EXPIRADO' AND auth_user_id IS NULL AND completed_at IS NULL)
  )
);

CREATE INDEX registro_alumno_intentos_email_fecha_idx
  ON public.registro_alumno_intentos (email, created_at DESC);
CREATE INDEX registro_alumno_intentos_cedula_fecha_idx
  ON public.registro_alumno_intentos (cedula, created_at DESC);

ALTER TABLE public.registro_alumno_intentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registro_alumno_intentos FROM PUBLIC, anon, authenticated;

ALTER TABLE public.privacidad_aceptaciones
  DROP CONSTRAINT privacidad_aceptaciones_contexto_check;
ALTER TABLE public.privacidad_aceptaciones
  ADD CONSTRAINT privacidad_aceptaciones_contexto_check
  CHECK (contexto IN ('PORTAL_ALUMNO', 'REGISTRO_PUBLICO'));

CREATE FUNCTION public.preparar_registro_alumno(
  p_token uuid,
  p_nombres text,
  p_apellidos text,
  p_cedula text,
  p_celular text,
  p_email text,
  p_aviso_version text,
  p_comunicaciones_promocionales boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_nombres text := upper(btrim(p_nombres));
  v_apellidos text := upper(btrim(p_apellidos));
  v_cedula text := btrim(p_cedula);
  v_celular text := regexp_replace(btrim(p_celular), '[[:space:]()\-]', '', 'g');
  v_email text := lower(btrim(p_email));
  v_cliente public.clientes%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Cierre la sesion antes de registrarse.' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL OR p_nombres IS NULL OR p_apellidos IS NULL
     OR p_cedula IS NULL OR p_celular IS NULL OR p_email IS NULL
     OR p_comunicaciones_promocionales IS NULL
     OR p_aviso_version IS DISTINCT FROM public.version_aviso_privacidad_vigente()
     OR length(v_nombres) NOT BETWEEN 2 AND 255
     OR length(v_apellidos) NOT BETWEEN 2 AND 255
     OR v_nombres !~ '^[[:alpha:]ÁÉÍÓÚÜÑ]+([ ''’-][[:alpha:]ÁÉÍÓÚÜÑ]+)*$'
     OR v_apellidos !~ '^[[:alpha:]ÁÉÍÓÚÜÑ]+([ ''’-][[:alpha:]ÁÉÍÓÚÜÑ]+)*$'
     OR v_cedula !~ '^[0-9]{1,20}$'
     OR v_celular !~ '^\+?[0-9]{7,20}$'
     OR length(v_email) > 255
     OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Los datos de registro no son validos.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RETURN jsonb_build_object('code', 'EMAIL_EXISTS');
  END IF;

  SELECT * INTO v_cliente
  FROM public.clientes c
  WHERE c.cedula = v_cedula
  FOR UPDATE;
  IF FOUND THEN
    IF v_cliente.auth_user_id IS NOT NULL THEN
      RETURN jsonb_build_object('code', 'ALREADY_LINKED');
    END IF;
    -- No basta conocer cedula, correo y telefono: el vinculo de un registro
    -- historico requiere revision humana mediante la operacion administrativa.
    RETURN jsonb_build_object('code', 'HELP_REQUIRED');
  END IF;

  IF (
    SELECT count(*) FROM public.registro_alumno_intentos i
    WHERE i.created_at >= now() - interval '1 hour'
      AND (i.email = v_email OR i.cedula = v_cedula)
  ) >= 5 THEN
    RETURN jsonb_build_object('code', 'RATE_LIMITED');
  END IF;

  UPDATE public.registro_alumno_intentos
  SET estado = 'EXPIRADO'
  WHERE estado = 'PENDIENTE' AND expires_at <= now()
    AND (email = v_email OR cedula = v_cedula);

  INSERT INTO public.registro_alumno_intentos (
    id, nombres, apellidos, nombre_completo, cedula, celular, email,
    aviso_version, comunicaciones_promocionales
  ) VALUES (
    p_token, v_nombres, v_apellidos, v_nombres || ' ' || v_apellidos,
    v_cedula, v_celular, v_email, p_aviso_version, p_comunicaciones_promocionales
  );
  RETURN jsonb_build_object('code', 'READY');
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_token_text text := NEW.raw_user_meta_data->>'student_registration_token';
  v_intento public.registro_alumno_intentos%ROWTYPE;
  v_finalidades text[] := ARRAY['AVISO_PRIVACIDAD_LEIDO']::text[];
BEGIN
  IF v_token_text IS NULL OR v_token_text !~ '^[0-9a-fA-F-]{36}$' THEN
    -- Cualquier alta externa al flujo publico queda en cuarentena sin cliente.
    -- Nunca hereda el DEFAULT historico staff ni puede elegir un rol.
    INSERT INTO public.usuarios (id, email, nombre, rol, activo)
    VALUES (NEW.id, lower(NEW.email), COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'nombre'), ''), lower(NEW.email)), 'alumno', false)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  END IF;

  SELECT * INTO v_intento
  FROM public.registro_alumno_intentos i
  WHERE i.id = v_token_text::uuid
    AND i.estado = 'PENDIENTE'
    AND i.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND OR lower(NEW.email) IS DISTINCT FROM v_intento.email THEN
    RAISE EXCEPTION 'El intento de registro no es valido o ya vencio.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clientes c WHERE c.cedula = v_intento.cedula) THEN
    RAISE EXCEPTION 'La identificacion fue registrada durante el proceso.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.usuarios (id, email, nombre, rol, activo)
  VALUES (NEW.id, v_intento.email, v_intento.nombre_completo, 'alumno', true);

  INSERT INTO public.clientes (
    cedula, nombre_completo, fecha_registro, celular, email,
    estado_cliente, created_by, auth_user_id
  ) VALUES (
    v_intento.cedula, v_intento.nombre_completo,
    (now() AT TIME ZONE 'America/Guayaquil')::date,
    v_intento.celular, v_intento.email, 'Activo', NEW.id, NEW.id
  );

  IF v_intento.comunicaciones_promocionales THEN
    v_finalidades := v_finalidades || 'COMUNICACIONES_PROMOCIONALES'::text;
  END IF;
  INSERT INTO public.privacidad_aceptaciones (
    usuario_id, aviso_version, accepted_at, contexto,
    finalidades_aceptadas, comunicaciones_promocionales
  ) VALUES (
    NEW.id, v_intento.aviso_version, now(), 'REGISTRO_PUBLICO',
    v_finalidades, v_intento.comunicaciones_promocionales
  );

  UPDATE public.registro_alumno_intentos
  SET estado = 'COMPLETADO', auth_user_id = NEW.id, completed_at = now()
  WHERE id = v_intento.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)
  TO anon;

COMMIT;

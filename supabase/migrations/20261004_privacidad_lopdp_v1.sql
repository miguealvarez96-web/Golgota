-- BLOQUE 6: infraestructura técnica de privacidad y solicitudes del titular.
-- No declara cumplimiento legal total ni automatiza eliminación de datos.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.auditoria_logs') IS NULL
     OR to_regprocedure('public.mi_rol()') IS NULL
     OR to_regprocedure('public.registrar_auditoria()') IS NULL
     OR to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas o funciones base requeridas por BLOQUE 6.';
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
    RAISE EXCEPTION 'BLOQUE 6 parece total o parcialmente aplicado; revisar antes de repetir.';
  END IF;
END;
$$;

CREATE TYPE public.tipo_solicitud_privacidad_enum AS ENUM (
  'ACCESO',
  'RECTIFICACION',
  'ACTUALIZACION',
  'ELIMINACION',
  'OPOSICION',
  'PORTABILIDAD',
  'SUSPENSION',
  'OTRA'
);

CREATE TYPE public.estado_solicitud_privacidad_enum AS ENUM (
  'RECIBIDA',
  'EN_REVISION',
  'ATENDIDA',
  'RECHAZADA'
);

CREATE TABLE public.privacidad_aceptaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  aviso_version varchar(32) NOT NULL
    CHECK (aviso_version = btrim(aviso_version) AND length(aviso_version) BETWEEN 1 AND 32),
  accepted_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(accepted_at)),
  contexto varchar(40) NOT NULL CHECK (contexto = 'PORTAL_ALUMNO'),
  finalidades_aceptadas text[] NOT NULL,
  comunicaciones_promocionales boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT privacidad_aceptacion_finalidades_validas CHECK (
    cardinality(finalidades_aceptadas) BETWEEN 1 AND 2
    AND finalidades_aceptadas <@ ARRAY[
      'AVISO_PRIVACIDAD_LEIDO', 'COMUNICACIONES_PROMOCIONALES'
    ]::text[]
    AND 'AVISO_PRIVACIDAD_LEIDO' = ANY(finalidades_aceptadas)
    AND comunicaciones_promocionales =
      ('COMUNICACIONES_PROMOCIONALES' = ANY(finalidades_aceptadas))
  ),
  CONSTRAINT privacidad_aceptacion_usuario_version_unica
    UNIQUE (usuario_id, aviso_version)
);

COMMENT ON TABLE public.privacidad_aceptaciones IS
  'Evidencia inmutable de reconocimiento del aviso y, por separado, consentimiento opcional para comunicaciones. No sustituye la determinación jurídica de bases de tratamiento.';
COMMENT ON COLUMN public.privacidad_aceptaciones.comunicaciones_promocionales IS
  'Consentimiento opcional, nunca premarcado. false no equivale a consentimiento.';

CREATE TABLE public.privacidad_solicitudes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  tipo public.tipo_solicitud_privacidad_enum NOT NULL,
  descripcion text NOT NULL
    CHECK (length(btrim(descripcion)) BETWEEN 10 AND 2000),
  estado public.estado_solicitud_privacidad_enum NOT NULL DEFAULT 'RECIBIDA',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  respuesta text CHECK (respuesta IS NULL OR length(btrim(respuesta)) BETWEEN 3 AND 2000),
  CONSTRAINT privacidad_solicitud_revision_coherente CHECK (
    (estado = 'RECIBIDA' AND reviewed_at IS NULL AND reviewed_by IS NULL AND respuesta IS NULL)
    OR
    (estado = 'EN_REVISION' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    OR
    (estado IN ('ATENDIDA', 'RECHAZADA') AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL AND respuesta IS NOT NULL)
  )
);

COMMENT ON TABLE public.privacidad_solicitudes IS
  'Solicitudes del titular sujetas a revisión humana. No ejecutan eliminación, anonimización ni otra modificación automática de datos.';

CREATE INDEX privacidad_aceptaciones_usuario_fecha_idx
  ON public.privacidad_aceptaciones (usuario_id, accepted_at DESC);
CREATE INDEX privacidad_solicitudes_usuario_fecha_idx
  ON public.privacidad_solicitudes (usuario_id, created_at DESC);
CREATE INDEX privacidad_solicitudes_pendientes_idx
  ON public.privacidad_solicitudes (estado, created_at)
  WHERE estado IN ('RECIBIDA', 'EN_REVISION');

CREATE TRIGGER privacidad_solicitudes_updated_at
BEFORE UPDATE ON public.privacidad_solicitudes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER audit_privacidad_aceptaciones
AFTER INSERT ON public.privacidad_aceptaciones
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

CREATE TRIGGER audit_privacidad_solicitudes
AFTER INSERT OR UPDATE ON public.privacidad_solicitudes
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

ALTER TABLE public.privacidad_aceptaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacidad_solicitudes ENABLE ROW LEVEL SECURITY;

CREATE POLICY privacidad_aceptaciones_alumno_propias
ON public.privacidad_aceptaciones FOR SELECT TO authenticated
USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());

CREATE POLICY privacidad_aceptaciones_gestion
ON public.privacidad_aceptaciones FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));

CREATE POLICY privacidad_solicitudes_alumno_propias
ON public.privacidad_solicitudes FOR SELECT TO authenticated
USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());

CREATE POLICY privacidad_solicitudes_gestion
ON public.privacidad_solicitudes FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));

REVOKE ALL ON TABLE public.privacidad_aceptaciones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.privacidad_solicitudes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.privacidad_aceptaciones TO authenticated;
GRANT SELECT ON TABLE public.privacidad_solicitudes TO authenticated;

CREATE FUNCTION public.version_aviso_privacidad_vigente()
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$ SELECT '2026-10-04-v1'::text $$;

CREATE FUNCTION public.registrar_aceptacion_privacidad(
  p_aviso_version text,
  p_contexto text,
  p_comunicaciones_promocionales boolean DEFAULT false
)
RETURNS public.privacidad_aceptaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_aceptacion public.privacidad_aceptaciones%ROWTYPE;
  v_finalidades text[] := ARRAY['AVISO_PRIVACIDAD_LEIDO']::text[];
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN
    RAISE EXCEPTION 'No tiene permiso para registrar esta aceptación.' USING ERRCODE = '42501';
  END IF;
  IF p_aviso_version IS DISTINCT FROM public.version_aviso_privacidad_vigente()
     OR p_contexto IS DISTINCT FROM 'PORTAL_ALUMNO'
     OR p_comunicaciones_promocionales IS NULL THEN
    RAISE EXCEPTION 'La versión, contexto o preferencia no son válidos.' USING ERRCODE = '22023';
  END IF;
  IF p_comunicaciones_promocionales THEN
    v_finalidades := v_finalidades || 'COMUNICACIONES_PROMOCIONALES'::text;
  END IF;

  INSERT INTO public.privacidad_aceptaciones
    (usuario_id, aviso_version, contexto, finalidades_aceptadas,
     comunicaciones_promocionales)
  VALUES
    (auth.uid(), p_aviso_version, p_contexto, v_finalidades,
     p_comunicaciones_promocionales)
  ON CONFLICT (usuario_id, aviso_version) DO NOTHING
  RETURNING * INTO v_aceptacion;

  IF v_aceptacion.id IS NULL THEN
    SELECT * INTO v_aceptacion
    FROM public.privacidad_aceptaciones
    WHERE usuario_id = auth.uid() AND aviso_version = p_aviso_version;
  END IF;
  RETURN v_aceptacion;
END;
$$;

CREATE FUNCTION public.crear_solicitud_privacidad(
  p_tipo public.tipo_solicitud_privacidad_enum,
  p_descripcion text
)
RETURNS public.privacidad_solicitudes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_solicitud public.privacidad_solicitudes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN
    RAISE EXCEPTION 'No tiene permiso para crear esta solicitud.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_descripcion IS NULL
     OR length(btrim(p_descripcion)) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'Indique un tipo y una descripción válida.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.privacidad_solicitudes (usuario_id, tipo, descripcion)
  VALUES (auth.uid(), p_tipo, btrim(p_descripcion))
  RETURNING * INTO v_solicitud;
  RETURN v_solicitud;
END;
$$;

CREATE FUNCTION public.revisar_solicitud_privacidad(
  p_solicitud_id uuid,
  p_estado public.estado_solicitud_privacidad_enum,
  p_respuesta text DEFAULT NULL
)
RETURNS public.privacidad_solicitudes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_solicitud public.privacidad_solicitudes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para revisar solicitudes.' USING ERRCODE = '42501';
  END IF;
  IF p_estado IS NULL OR p_estado NOT IN ('EN_REVISION', 'ATENDIDA', 'RECHAZADA') THEN
    RAISE EXCEPTION 'El estado de revisión no es válido.' USING ERRCODE = '22023';
  END IF;
  IF p_respuesta IS NOT NULL AND length(btrim(p_respuesta)) > 2000 THEN
    RAISE EXCEPTION 'La respuesta no puede superar 2000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_estado IN ('ATENDIDA', 'RECHAZADA')
     AND (p_respuesta IS NULL OR length(btrim(p_respuesta)) < 3) THEN
    RAISE EXCEPTION 'La respuesta es obligatoria para cerrar la solicitud.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_solicitud
  FROM public.privacidad_solicitudes
  WHERE id = p_solicitud_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud no existe.'; END IF;
  IF v_solicitud.estado IN ('ATENDIDA', 'RECHAZADA') THEN
    RAISE EXCEPTION 'La solicitud ya fue cerrada.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.privacidad_solicitudes
  SET estado = p_estado,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      respuesta = CASE WHEN p_estado = 'EN_REVISION'
        THEN nullif(btrim(p_respuesta), '') ELSE btrim(p_respuesta) END
  WHERE id = p_solicitud_id
  RETURNING * INTO v_solicitud;
  RETURN v_solicitud;
END;
$$;

CREATE FUNCTION public.listar_solicitudes_privacidad()
RETURNS TABLE (
  id uuid,
  usuario_id uuid,
  solicitante_nombre text,
  solicitante_email text,
  tipo text,
  descripcion text,
  estado text,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  revisor_nombre text,
  respuesta text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para consultar solicitudes.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.usuario_id, u.nombre::text, u.email::text,
    s.tipo::text, s.descripcion, s.estado::text, s.created_at, s.updated_at,
    s.reviewed_at, s.reviewed_by, r.nombre::text, s.respuesta
  FROM public.privacidad_solicitudes s
  JOIN public.usuarios u ON u.id = s.usuario_id
  LEFT JOIN public.usuarios r ON r.id = s.reviewed_by
  ORDER BY CASE s.estado WHEN 'RECIBIDA' THEN 0 WHEN 'EN_REVISION' THEN 1 ELSE 2 END,
    s.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.version_aviso_privacidad_vigente()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_aceptacion_privacidad(text,text,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crear_solicitud_privacidad(public.tipo_solicitud_privacidad_enum,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revisar_solicitud_privacidad(uuid,public.estado_solicitud_privacidad_enum,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.listar_solicitudes_privacidad()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.registrar_aceptacion_privacidad(text,text,boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_solicitud_privacidad(public.tipo_solicitud_privacidad_enum,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revisar_solicitud_privacidad(uuid,public.estado_solicitud_privacidad_enum,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_solicitudes_privacidad()
  TO authenticated;

COMMIT;

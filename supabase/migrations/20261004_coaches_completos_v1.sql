-- BLOQUE 3: portal operativo de coaches, WOD y comunicados.
BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

-- La proyección de staff conserva únicamente datos operativos. Las columnas
-- existentes mantienen su orden para no romper consumidores ya desplegados.
CREATE OR REPLACE VIEW public.v_membresias_verificacion
WITH (security_invoker = true) AS
SELECT v.cliente_id,
       v.plan_nombre AS plan,
       v.fecha_fin,
       CASE
         WHEN reloj.hoy < v.fecha_inicio THEN 'POR_INICIAR'
         WHEN reloj.hoy > v.fecha_fin THEN 'VENCIDA'
         WHEN reloj.hoy = v.fecha_fin THEN 'VENCE_HOY'
         WHEN v.fecha_fin - reloj.hoy <= 3 THEN 'POR_VENCER'
         ELSE 'VIGENTE'
       END AS estado_vigencia,
       v.membresia_id,
       v.fecha_inicio
FROM public.membresias_verificacion v
CROSS JOIN (
  SELECT (now() AT TIME ZONE 'America/Guayaquil')::date AS hoy
) reloj
WHERE NOT v.cancelada;

REVOKE ALL ON TABLE public.v_membresias_verificacion FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_membresias_verificacion TO authenticated;

CREATE TABLE public.wods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL UNIQUE,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  contenido text NOT NULL CHECK (length(btrim(contenido)) BETWEEN 1 AND 10000),
  publicado boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wods_publicados_fecha_idx
  ON public.wods (fecha DESC) WHERE publicado;

CREATE TRIGGER wods_updated_at
BEFORE UPDATE ON public.wods
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.wods ENABLE ROW LEVEL SECURITY;

CREATE POLICY wods_lectura_gestion ON public.wods
FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));

CREATE POLICY wods_lectura_staff_publicados ON public.wods
FOR SELECT TO authenticated
USING (
  public.mi_rol() = 'staff'
  AND publicado
  AND fecha = (now() AT TIME ZONE 'America/Guayaquil')::date
);

CREATE POLICY wods_creacion_gestion ON public.wods
FOR INSERT TO authenticated
WITH CHECK (
  public.mi_rol() IN ('admin', 'owner')
  AND created_by = auth.uid()
);

CREATE POLICY wods_edicion_gestion ON public.wods
FOR UPDATE TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'))
WITH CHECK (public.mi_rol() IN ('admin', 'owner'));

REVOKE ALL ON TABLE public.wods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.wods TO authenticated;
GRANT INSERT (fecha, titulo, contenido, publicado, created_by),
      UPDATE (fecha, titulo, contenido, publicado)
ON TABLE public.wods TO authenticated;

CREATE TABLE public.comunicados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  contenido text NOT NULL CHECK (length(btrim(contenido)) BETWEEN 1 AND 10000),
  publicado boolean NOT NULL DEFAULT false,
  fecha_publicacion timestamptz,
  created_by uuid NOT NULL REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comunicados_publicados_con_fecha
    CHECK (NOT publicado OR fecha_publicacion IS NOT NULL)
);

CREATE INDEX comunicados_publicados_fecha_idx
  ON public.comunicados (fecha_publicacion DESC) WHERE publicado;

CREATE FUNCTION public.set_comunicado_fecha_publicacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'comunicados'
     OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Contexto de publicación no permitido.';
  END IF;

  IF NEW.publicado AND (TG_OP = 'INSERT' OR NOT OLD.publicado) THEN
    NEW.fecha_publicacion := now();
  ELSIF NOT NEW.publicado THEN
    NEW.fecha_publicacion := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER comunicados_fecha_publicacion
BEFORE INSERT OR UPDATE OF publicado ON public.comunicados
FOR EACH ROW EXECUTE FUNCTION public.set_comunicado_fecha_publicacion();

CREATE TRIGGER comunicados_updated_at
BEFORE UPDATE ON public.comunicados
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.comunicados ENABLE ROW LEVEL SECURITY;

CREATE POLICY comunicados_lectura_gestion ON public.comunicados
FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));

CREATE POLICY comunicados_lectura_staff_publicados ON public.comunicados
FOR SELECT TO authenticated
USING (
  public.mi_rol() = 'staff'
  AND publicado
  AND fecha_publicacion <= now()
);

CREATE POLICY comunicados_creacion_gestion ON public.comunicados
FOR INSERT TO authenticated
WITH CHECK (
  public.mi_rol() IN ('admin', 'owner')
  AND created_by = auth.uid()
);

CREATE POLICY comunicados_edicion_gestion ON public.comunicados
FOR UPDATE TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'))
WITH CHECK (public.mi_rol() IN ('admin', 'owner'));

REVOKE ALL ON TABLE public.comunicados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.comunicados TO authenticated;
GRANT INSERT (titulo, contenido, publicado, created_by),
      UPDATE (titulo, contenido, publicado)
ON TABLE public.comunicados TO authenticated;

REVOKE ALL ON FUNCTION public.set_comunicado_fecha_publicacion()
FROM PUBLIC, anon, authenticated;

COMMIT;

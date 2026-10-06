-- WOD ampliado y gestionable por admin, owner y staff.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.wods
  ADD COLUMN horario_grupo text,
  ADD COLUMN youtube_url text,
  ADD COLUMN notas text,
  ADD CONSTRAINT wods_horario_grupo_check CHECK (
    horario_grupo IS NULL OR length(btrim(horario_grupo)) BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT wods_youtube_url_check CHECK (
    youtube_url IS NULL OR (
      length(youtube_url) <= 2048
      AND youtube_url ~* '^https?://[^[:space:]]+$'
    )
  ),
  ADD CONSTRAINT wods_notas_check CHECK (
    notas IS NULL OR length(btrim(notas)) BETWEEN 1 AND 3000
  );

DROP POLICY wods_lectura_gestion ON public.wods;
DROP POLICY wods_lectura_staff_publicados ON public.wods;
DROP POLICY wods_creacion_gestion ON public.wods;
DROP POLICY wods_edicion_gestion ON public.wods;

CREATE POLICY wods_lectura_gestion ON public.wods
FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner', 'staff'));

CREATE POLICY wods_lectura_alumno_publicados ON public.wods
FOR SELECT TO authenticated
USING (
  public.mi_rol()::text = 'alumno'
  AND publicado
  AND fecha = (now() AT TIME ZONE 'America/Guayaquil')::date
);

CREATE POLICY wods_creacion_gestion ON public.wods
FOR INSERT TO authenticated
WITH CHECK (
  public.mi_rol() IN ('admin', 'owner', 'staff')
  AND created_by = auth.uid()
);

CREATE POLICY wods_edicion_gestion ON public.wods
FOR UPDATE TO authenticated
USING (public.mi_rol() IN ('admin', 'owner', 'staff'))
WITH CHECK (public.mi_rol() IN ('admin', 'owner', 'staff'));

GRANT INSERT (horario_grupo, youtube_url, notas),
      UPDATE (horario_grupo, youtube_url, notas)
ON TABLE public.wods TO authenticated;

COMMENT ON COLUMN public.wods.horario_grupo IS
  'Horario o grupo libre del WOD; no contiene datos personales.';
COMMENT ON COLUMN public.wods.youtube_url IS
  'Enlace HTTP(S) opcional a video, preferentemente YouTube; no almacena archivos.';
COMMENT ON COLUMN public.wods.notas IS
  'Notas operativas opcionales del entrenamiento.';

COMMIT;

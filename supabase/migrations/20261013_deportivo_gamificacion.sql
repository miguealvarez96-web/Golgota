-- Progreso deportivo privado, WOD por tiempo y desafíos simples.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '90s';

ALTER TABLE public.wods
  ADD COLUMN benchmark_ref varchar(80),
  ADD COLUMN permite_resultados boolean NOT NULL DEFAULT false,
  ADD COLUMN limite_tiempo_minutos smallint,
  ADD CONSTRAINT wods_benchmark_ref_check CHECK (benchmark_ref IS NULL OR length(btrim(benchmark_ref)) BETWEEN 1 AND 80),
  ADD CONSTRAINT wods_limite_tiempo_check CHECK (limite_tiempo_minutos IS NULL OR limite_tiempo_minutos BETWEEN 1 AND 1440),
  ADD CONSTRAINT wods_resultado_limite_check CHECK (permite_resultados OR limite_tiempo_minutos IS NULL);

GRANT INSERT (benchmark_ref, permite_resultados, limite_tiempo_minutos),
      UPDATE (benchmark_ref, permite_resultados, limite_tiempo_minutos)
ON TABLE public.wods TO authenticated;

CREATE TABLE public.progreso_fisico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  fecha date NOT NULL CHECK (isfinite(fecha)),
  peso_kg numeric(5,2) NOT NULL CHECK (peso_kg BETWEEN 20 AND 350),
  estatura_m numeric(3,2) NOT NULL CHECK (estatura_m BETWEEN 0.80 AND 2.50),
  imc numeric(6,2) GENERATED ALWAYS AS (round(peso_kg / (estatura_m * estatura_m), 2)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT progreso_fisico_usuario_fecha_unique UNIQUE (usuario_id, fecha)
);
CREATE INDEX progreso_fisico_usuario_fecha_idx ON public.progreso_fisico (usuario_id, fecha DESC);
CREATE TRIGGER progreso_fisico_updated_at BEFORE UPDATE ON public.progreso_fisico
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_progreso_fisico AFTER INSERT OR UPDATE ON public.progreso_fisico
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

CREATE TABLE public.records_personales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  ejercicio text NOT NULL CHECK (ejercicio IN ('BACK_SQUAT','FRONT_SQUAT','DEADLIFT','BENCH_PRESS','CLEAN','CLEAN_AND_JERK','SNATCH','PULL_UPS','OTRO')),
  nombre_personalizado varchar(100),
  valor numeric(10,2) NOT NULL CHECK (valor > 0 AND valor <= 999999.99),
  unidad text NOT NULL CHECK (unidad IN ('KG','REPETICIONES','TIEMPO')),
  fecha date NOT NULL CHECK (isfinite(fecha)),
  observacion varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT record_otro_coherente CHECK (
    (ejercicio = 'OTRO' AND nombre_personalizado IS NOT NULL AND length(btrim(nombre_personalizado)) BETWEEN 1 AND 100)
    OR (ejercicio <> 'OTRO' AND nombre_personalizado IS NULL)
  )
);
CREATE INDEX records_personales_usuario_fecha_idx ON public.records_personales (usuario_id, fecha DESC, created_at DESC);
CREATE INDEX records_personales_comparables_idx ON public.records_personales (usuario_id, ejercicio, nombre_personalizado, unidad, valor);
CREATE TRIGGER records_personales_updated_at BEFORE UPDATE ON public.records_personales
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_records_personales AFTER INSERT OR UPDATE ON public.records_personales
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

CREATE TABLE public.wod_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wod_id uuid NOT NULL REFERENCES public.wods(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tiempo_segundos integer NOT NULL CHECK (tiempo_segundos BETWEEN 1 AND 86400),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wod_resultados_unico UNIQUE (wod_id, usuario_id)
);
CREATE INDEX wod_resultados_ranking_idx ON public.wod_resultados (wod_id, tiempo_segundos, created_at);
CREATE INDEX wod_resultados_usuario_idx ON public.wod_resultados (usuario_id, created_at DESC);
CREATE TRIGGER wod_resultados_updated_at BEFORE UPDATE ON public.wod_resultados
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_wod_resultados AFTER INSERT OR UPDATE ON public.wod_resultados
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

CREATE TABLE public.desafios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo varchar(160) NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  descripcion varchar(3000) NOT NULL CHECK (length(btrim(descripcion)) BETWEEN 1 AND 3000),
  fecha_inicio date NOT NULL CHECK (isfinite(fecha_inicio)),
  fecha_fin date NOT NULL CHECK (isfinite(fecha_fin) AND fecha_fin >= fecha_inicio),
  objetivo_numero numeric(10,2) NOT NULL CHECK (objetivo_numero > 0 AND objetivo_numero <= 999999),
  unidad varchar(80) NOT NULL CHECK (length(btrim(unidad)) BETWEEN 1 AND 80),
  estado text NOT NULL CHECK (estado IN ('BORRADOR','ACTIVO','CERRADO')),
  created_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX desafios_estado_fechas_idx ON public.desafios (estado, fecha_inicio, fecha_fin);
CREATE TRIGGER desafios_updated_at BEFORE UPDATE ON public.desafios
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_desafios AFTER INSERT OR UPDATE ON public.desafios
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

CREATE TABLE public.desafio_participantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  desafio_id uuid NOT NULL REFERENCES public.desafios(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  progreso numeric(10,2) NOT NULL DEFAULT 0 CHECK (progreso >= 0),
  joined_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT desafio_participacion_unica UNIQUE (desafio_id, usuario_id)
);
CREATE INDEX desafio_participantes_usuario_idx ON public.desafio_participantes (usuario_id, joined_at DESC);
CREATE TRIGGER desafio_participantes_updated_at BEFORE UPDATE ON public.desafio_participantes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_desafio_participantes AFTER INSERT OR UPDATE ON public.desafio_participantes
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

ALTER TABLE public.progreso_fisico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records_personales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wod_resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desafios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desafio_participantes ENABLE ROW LEVEL SECURITY;

CREATE POLICY progreso_fisico_alumno_lectura ON public.progreso_fisico
FOR SELECT TO authenticated USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY progreso_fisico_alumno_creacion ON public.progreso_fisico
FOR INSERT TO authenticated WITH CHECK (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());

CREATE POLICY records_personales_alumno_lectura ON public.records_personales
FOR SELECT TO authenticated USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY records_personales_alumno_creacion ON public.records_personales
FOR INSERT TO authenticated WITH CHECK (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY records_personales_coach_lectura ON public.records_personales
FOR SELECT TO authenticated USING (public.mi_rol() IN ('admin','owner','staff'));

CREATE POLICY wod_resultados_alumno_lectura ON public.wod_resultados
FOR SELECT TO authenticated USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY wod_resultados_alumno_creacion ON public.wod_resultados
FOR INSERT TO authenticated WITH CHECK (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY wod_resultados_alumno_edicion ON public.wod_resultados
FOR UPDATE TO authenticated USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid())
WITH CHECK (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY wod_resultados_coach_lectura ON public.wod_resultados
FOR SELECT TO authenticated USING (public.mi_rol() IN ('admin','owner','staff'));

CREATE POLICY desafios_alumno_activos ON public.desafios
FOR SELECT TO authenticated USING (public.mi_rol()::text = 'alumno' AND estado = 'ACTIVO');
CREATE POLICY desafios_coach_lectura ON public.desafios
FOR SELECT TO authenticated USING (public.mi_rol() IN ('admin','owner','staff'));
CREATE POLICY desafios_coach_creacion ON public.desafios
FOR INSERT TO authenticated WITH CHECK (public.mi_rol() IN ('admin','owner','staff'));
CREATE POLICY desafios_coach_edicion ON public.desafios
FOR UPDATE TO authenticated USING (public.mi_rol() IN ('admin','owner','staff'))
WITH CHECK (public.mi_rol() IN ('admin','owner','staff'));

CREATE POLICY desafio_participantes_alumno_lectura ON public.desafio_participantes
FOR SELECT TO authenticated USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY desafio_participantes_alumno_creacion ON public.desafio_participantes
FOR INSERT TO authenticated WITH CHECK (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY desafio_participantes_alumno_edicion ON public.desafio_participantes
FOR UPDATE TO authenticated USING (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid())
WITH CHECK (public.mi_rol()::text = 'alumno' AND usuario_id = auth.uid());
CREATE POLICY desafio_participantes_coach_lectura ON public.desafio_participantes
FOR SELECT TO authenticated USING (public.mi_rol() IN ('admin','owner','staff'));
CREATE POLICY desafio_participantes_coach_edicion ON public.desafio_participantes
FOR UPDATE TO authenticated USING (public.mi_rol() IN ('admin','owner','staff'))
WITH CHECK (public.mi_rol() IN ('admin','owner','staff'));

REVOKE ALL ON TABLE public.progreso_fisico, public.records_personales, public.wod_resultados,
  public.desafios, public.desafio_participantes FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.registrar_progreso_fisico(p_fecha date, p_peso_kg numeric, p_estatura_m numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  IF p_fecha IS NULL OR p_fecha > (now() AT TIME ZONE 'America/Guayaquil')::date
     OR p_peso_kg NOT BETWEEN 20 AND 350 OR p_estatura_m NOT BETWEEN 0.80 AND 2.50 THEN
    RAISE EXCEPTION 'Datos de progreso invalidos.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.progreso_fisico(usuario_id,fecha,peso_kg,estatura_m)
  VALUES(auth.uid(),p_fecha,p_peso_kg,p_estatura_m) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.registrar_record_personal(p_ejercicio text, p_nombre_personalizado text, p_valor numeric, p_unidad text, p_fecha date, p_observacion text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  IF p_fecha IS NULL OR p_fecha > (now() AT TIME ZONE 'America/Guayaquil')::date OR p_valor <= 0
     OR p_ejercicio NOT IN ('BACK_SQUAT','FRONT_SQUAT','DEADLIFT','BENCH_PRESS','CLEAN','CLEAN_AND_JERK','SNATCH','PULL_UPS','OTRO')
     OR p_unidad NOT IN ('KG','REPETICIONES','TIEMPO') THEN RAISE EXCEPTION 'Record invalido.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.records_personales(usuario_id,ejercicio,nombre_personalizado,valor,unidad,fecha,observacion)
  VALUES(auth.uid(),p_ejercicio,CASE WHEN p_ejercicio='OTRO' THEN nullif(btrim(p_nombre_personalizado),'') ELSE NULL END,p_valor,p_unidad,p_fecha,nullif(btrim(p_observacion),''))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.registrar_resultado_wod(p_wod_id uuid, p_tiempo_segundos integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid; v_limite smallint;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT limite_tiempo_minutos INTO v_limite FROM public.wods
  WHERE id=p_wod_id AND publicado AND permite_resultados
    AND fecha=(now() AT TIME ZONE 'America/Guayaquil')::date FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El WOD no esta abierto para resultados.' USING ERRCODE='55000'; END IF;
  IF p_tiempo_segundos NOT BETWEEN 1 AND 86400 OR (v_limite IS NOT NULL AND p_tiempo_segundos > v_limite*60) THEN
    RAISE EXCEPTION 'Tiempo invalido.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.wod_resultados(wod_id,usuario_id,tiempo_segundos)
  VALUES(p_wod_id,auth.uid(),p_tiempo_segundos)
  ON CONFLICT (wod_id,usuario_id) DO UPDATE SET tiempo_segundos=EXCLUDED.tiempo_segundos, updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.unirse_desafio(p_desafio_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.desafios d WHERE d.id=p_desafio_id AND d.estado='ACTIVO' AND (now() AT TIME ZONE 'America/Guayaquil')::date BETWEEN d.fecha_inicio AND d.fecha_fin) THEN
    RAISE EXCEPTION 'El desafio no esta activo.' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.desafio_participantes(desafio_id,usuario_id,updated_by)
  VALUES(p_desafio_id,auth.uid(),auth.uid()) ON CONFLICT (desafio_id,usuario_id) DO NOTHING;
  SELECT id INTO v_id FROM public.desafio_participantes WHERE desafio_id=p_desafio_id AND usuario_id=auth.uid();
  RETURN v_id;
END; $$;

CREATE FUNCTION public.actualizar_progreso_desafio_alumno(p_desafio_id uuid, p_progreso numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_objetivo numeric; v_actual numeric; v_final numeric;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT d.objetivo_numero,p.progreso INTO v_objetivo,v_actual FROM public.desafios d JOIN public.desafio_participantes p ON p.desafio_id=d.id
  WHERE d.id=p_desafio_id AND p.usuario_id=auth.uid() AND d.estado='ACTIVO' FOR UPDATE OF p;
  IF NOT FOUND OR p_progreso < 0 THEN RAISE EXCEPTION 'Progreso invalido.' USING ERRCODE='22023'; END IF;
  v_final := least(v_objetivo,greatest(v_actual,p_progreso));
  UPDATE public.desafio_participantes SET progreso=v_final, completed_at=CASE WHEN v_final>=v_objetivo THEN coalesce(completed_at,now()) ELSE NULL END, updated_by=auth.uid()
  WHERE desafio_id=p_desafio_id AND usuario_id=auth.uid();
  RETURN v_final;
END; $$;

CREATE FUNCTION public.guardar_desafio(p_id uuid, p_titulo text, p_descripcion text, p_fecha_inicio date, p_fecha_fin date, p_objetivo_numero numeric, p_unidad text, p_estado text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin','owner','staff') THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  IF p_fecha_fin<p_fecha_inicio OR p_objetivo_numero<=0 OR p_estado NOT IN ('BORRADOR','ACTIVO','CERRADO') THEN RAISE EXCEPTION 'Desafio invalido.' USING ERRCODE='22023'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.desafios(titulo,descripcion,fecha_inicio,fecha_fin,objetivo_numero,unidad,estado,created_by)
    VALUES(btrim(p_titulo),btrim(p_descripcion),p_fecha_inicio,p_fecha_fin,p_objetivo_numero,btrim(p_unidad),p_estado,auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.desafios SET titulo=btrim(p_titulo),descripcion=btrim(p_descripcion),fecha_inicio=p_fecha_inicio,fecha_fin=p_fecha_fin,objetivo_numero=p_objetivo_numero,unidad=btrim(p_unidad),estado=p_estado
    WHERE id=p_id RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El desafio no existe.'; END IF;
    UPDATE public.desafio_participantes SET progreso=least(progreso,p_objetivo_numero), completed_at=CASE WHEN least(progreso,p_objetivo_numero)>=p_objetivo_numero THEN coalesce(completed_at,now()) ELSE NULL END, updated_by=auth.uid() WHERE desafio_id=p_id;
  END IF;
  RETURN v_id;
END; $$;

CREATE FUNCTION public.actualizar_progreso_desafio_coach(p_desafio_id uuid, p_usuario_id uuid, p_progreso numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_objetivo numeric; v_final numeric;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin','owner','staff') THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT objetivo_numero INTO v_objetivo FROM public.desafios WHERE id=p_desafio_id FOR SHARE;
  IF NOT FOUND OR p_progreso<0 THEN RAISE EXCEPTION 'Progreso invalido.' USING ERRCODE='22023'; END IF;
  v_final:=least(v_objetivo,p_progreso);
  UPDATE public.desafio_participantes SET progreso=v_final,completed_at=CASE WHEN v_final>=v_objetivo THEN coalesce(completed_at,now()) ELSE NULL END,updated_by=auth.uid()
  WHERE desafio_id=p_desafio_id AND usuario_id=p_usuario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participacion inexistente.'; END IF;
  RETURN v_final;
END; $$;

CREATE FUNCTION public.obtener_deportivo_alumno()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_wod public.wods%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol()::text <> 'alumno' THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_wod FROM public.wods WHERE publicado AND fecha=(now() AT TIME ZONE 'America/Guayaquil')::date LIMIT 1;
  RETURN jsonb_build_object(
    'progreso',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'fecha',p.fecha,'peso_kg',p.peso_kg,'estatura_m',p.estatura_m,'imc',p.imc,'created_at',p.created_at) ORDER BY p.fecha DESC,p.created_at DESC) FROM public.progreso_fisico p WHERE p.usuario_id=auth.uid()),'[]'::jsonb),
    'records',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'ejercicio',r.ejercicio,'nombre_personalizado',r.nombre_personalizado,'valor',r.valor,'unidad',r.unidad,'fecha',r.fecha,'observacion',r.observacion,'created_at',r.created_at) ORDER BY r.fecha DESC,r.created_at DESC) FROM public.records_personales r WHERE r.usuario_id=auth.uid()),'[]'::jsonb),
    'wod_actual',CASE WHEN v_wod.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_wod.id,'fecha',v_wod.fecha,'titulo',v_wod.titulo,'benchmark_ref',v_wod.benchmark_ref,'permite_resultados',v_wod.permite_resultados,'limite_tiempo_minutos',v_wod.limite_tiempo_minutos,
      'mi_tiempo_segundos',(SELECT wr.tiempo_segundos FROM public.wod_resultados wr WHERE wr.wod_id=v_wod.id AND wr.usuario_id=auth.uid()),
      'mi_posicion',(SELECT ranked.posicion FROM (SELECT wr.usuario_id,row_number() OVER(ORDER BY wr.tiempo_segundos,wr.created_at)::integer posicion FROM public.wod_resultados wr WHERE wr.wod_id=v_wod.id) ranked WHERE ranked.usuario_id=auth.uid()),
      'ranking',coalesce((SELECT jsonb_agg(jsonb_build_object('posicion',ranked.posicion,'nombre_visible',ranked.nombre_visible,'tiempo_segundos',ranked.tiempo_segundos) ORDER BY ranked.posicion) FROM (SELECT row_number() OVER(ORDER BY wr.tiempo_segundos,wr.created_at)::integer posicion,split_part(u.nombre,' ',1)||CASE WHEN split_part(u.nombre,' ',2)<>'' THEN ' '||left(split_part(u.nombre,' ',2),1)||'.' ELSE '' END nombre_visible,wr.tiempo_segundos FROM public.wod_resultados wr JOIN public.usuarios u ON u.id=wr.usuario_id WHERE wr.wod_id=v_wod.id) ranked),'[]'::jsonb)
    ) END,
    'historial_wod',coalesce((SELECT jsonb_agg(jsonb_build_object('wod_id',h.wod_id,'fecha',h.fecha,'titulo',h.titulo,'benchmark_ref',h.benchmark_ref,'tiempo_segundos',h.tiempo_segundos,'posicion',h.posicion,'mejor_tiempo_segundos',h.mejor_tiempo,'nuevo_pr',h.nuevo_pr) ORDER BY h.fecha DESC) FROM (
      SELECT w.id wod_id,w.fecha,w.titulo,w.benchmark_ref,wr.tiempo_segundos,
        (SELECT count(*)+1 FROM public.wod_resultados x WHERE x.wod_id=w.id AND x.tiempo_segundos<wr.tiempo_segundos)::integer posicion,
        CASE WHEN w.benchmark_ref IS NULL THEN wr.tiempo_segundos ELSE min(wr.tiempo_segundos) OVER(PARTITION BY w.benchmark_ref) END mejor_tiempo,
        CASE WHEN w.benchmark_ref IS NULL THEN false ELSE EXISTS (
          SELECT 1 FROM public.wod_resultados wr2 JOIN public.wods w2 ON w2.id=wr2.wod_id
          WHERE wr2.usuario_id=wr.usuario_id AND w2.benchmark_ref=w.benchmark_ref AND w2.fecha<w.fecha
        ) AND wr.tiempo_segundos < (
          SELECT min(wr3.tiempo_segundos) FROM public.wod_resultados wr3 JOIN public.wods w3 ON w3.id=wr3.wod_id
          WHERE wr3.usuario_id=wr.usuario_id AND w3.benchmark_ref=w.benchmark_ref AND w3.fecha<w.fecha
        ) END nuevo_pr
      FROM public.wod_resultados wr JOIN public.wods w ON w.id=wr.wod_id WHERE wr.usuario_id=auth.uid()
    ) h),'[]'::jsonb),
    'desafios',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'titulo',d.titulo,'descripcion',d.descripcion,'fecha_inicio',d.fecha_inicio,'fecha_fin',d.fecha_fin,'objetivo_numero',d.objetivo_numero,'unidad',d.unidad,'estado',d.estado,'unido',p.id IS NOT NULL,'progreso',coalesce(p.progreso,0),'porcentaje',least(100,round(coalesce(p.progreso,0)*100/d.objetivo_numero,2)),'completed_at',p.completed_at) ORDER BY d.fecha_fin,d.titulo) FROM public.desafios d LEFT JOIN public.desafio_participantes p ON p.desafio_id=d.id AND p.usuario_id=auth.uid() WHERE d.estado='ACTIVO' AND (now() AT TIME ZONE 'America/Guayaquil')::date BETWEEN d.fecha_inicio AND d.fecha_fin),'[]'::jsonb)
  );
END; $$;

CREATE FUNCTION public.listar_panel_deportivo_coach()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin','owner','staff') THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'resultados',coalesce((SELECT jsonb_agg(jsonb_build_object('wod_id',x.wod_id,'fecha',x.fecha,'wod',x.wod,'nombre_visible',x.nombre_visible,'tiempo_segundos',x.tiempo_segundos,'posicion',x.posicion) ORDER BY x.fecha DESC,x.posicion) FROM (SELECT w.id wod_id,w.fecha,w.titulo wod,split_part(u.nombre,' ',1)||CASE WHEN split_part(u.nombre,' ',2)<>'' THEN ' '||left(split_part(u.nombre,' ',2),1)||'.' ELSE '' END nombre_visible,wr.tiempo_segundos,row_number() OVER(PARTITION BY w.id ORDER BY wr.tiempo_segundos,wr.created_at)::integer posicion FROM public.wod_resultados wr JOIN public.wods w ON w.id=wr.wod_id JOIN public.usuarios u ON u.id=wr.usuario_id WHERE w.publicado ORDER BY w.fecha DESC LIMIT 300) x),'[]'::jsonb),
    'records',coalesce((SELECT jsonb_agg(jsonb_build_object('usuario_id',r.usuario_id,'nombre_visible',split_part(u.nombre,' ',1)||CASE WHEN split_part(u.nombre,' ',2)<>'' THEN ' '||left(split_part(u.nombre,' ',2),1)||'.' ELSE '' END,'ejercicio',r.ejercicio,'nombre_personalizado',r.nombre_personalizado,'valor',r.valor,'unidad',r.unidad,'fecha',r.fecha) ORDER BY r.fecha DESC,r.created_at DESC) FROM public.records_personales r JOIN public.usuarios u ON u.id=r.usuario_id),'[]'::jsonb)
  );
END; $$;

CREATE FUNCTION public.listar_desafios_gestion()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin','owner','staff') THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'titulo',d.titulo,'descripcion',d.descripcion,'fecha_inicio',d.fecha_inicio,'fecha_fin',d.fecha_fin,'objetivo_numero',d.objetivo_numero,'unidad',d.unidad,'estado',d.estado,'participantes',coalesce((SELECT jsonb_agg(jsonb_build_object('usuario_id',p.usuario_id,'nombre_visible',split_part(u.nombre,' ',1)||CASE WHEN split_part(u.nombre,' ',2)<>'' THEN ' '||left(split_part(u.nombre,' ',2),1)||'.' ELSE '' END,'progreso',p.progreso,'porcentaje',least(100,round(p.progreso*100/d.objetivo_numero,2)),'completed_at',p.completed_at) ORDER BY u.nombre) FROM public.desafio_participantes p JOIN public.usuarios u ON u.id=p.usuario_id WHERE p.desafio_id=d.id),'[]'::jsonb)) ORDER BY d.created_at DESC) FROM public.desafios d),'[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.registrar_progreso_fisico(date,numeric,numeric), public.registrar_record_personal(text,text,numeric,text,date,text), public.registrar_resultado_wod(uuid,integer), public.unirse_desafio(uuid), public.actualizar_progreso_desafio_alumno(uuid,numeric), public.guardar_desafio(uuid,text,text,date,date,numeric,text,text), public.actualizar_progreso_desafio_coach(uuid,uuid,numeric), public.obtener_deportivo_alumno(), public.listar_panel_deportivo_coach(), public.listar_desafios_gestion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_progreso_fisico(date,numeric,numeric), public.registrar_record_personal(text,text,numeric,text,date,text), public.registrar_resultado_wod(uuid,integer), public.unirse_desafio(uuid), public.actualizar_progreso_desafio_alumno(uuid,numeric), public.guardar_desafio(uuid,text,text,date,date,numeric,text,text), public.actualizar_progreso_desafio_coach(uuid,uuid,numeric), public.obtener_deportivo_alumno(), public.listar_panel_deportivo_coach(), public.listar_desafios_gestion() TO authenticated;

COMMENT ON TABLE public.progreso_fisico IS 'Peso, estatura e IMC orientativo privados del alumno. Nunca se usan en rankings ni se proyectan a coach.';
COMMENT ON FUNCTION public.listar_panel_deportivo_coach() IS 'Proyeccion deportiva minima sin peso, estatura, IMC, cedula, email, telefono ni finanzas.';

COMMIT;

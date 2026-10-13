BEGIN TRANSACTION READ ONLY;
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['progreso_fisico','records_personales','wod_resultados','desafios','desafio_participantes'] LOOP
    IF to_regclass('public.'||v_table) IS NULL THEN RAISE EXCEPTION 'Falta la tabla %.',v_table; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_table AND c.relrowsecurity) THEN RAISE EXCEPTION 'RLS no esta activo en %.',v_table; END IF;
    IF has_table_privilege('anon','public.'||v_table,'SELECT') OR has_table_privilege('authenticated','public.'||v_table,'SELECT')
       OR has_table_privilege('authenticated','public.'||v_table,'INSERT') OR has_table_privilege('authenticated','public.'||v_table,'UPDATE')
       OR has_table_privilege('authenticated','public.'||v_table,'DELETE') THEN RAISE EXCEPTION 'Hay privilegios directos inesperados en %.',v_table; END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='wods' AND column_name IN ('benchmark_ref','permite_resultados','limite_tiempo_minutos'))<>3 THEN RAISE EXCEPTION 'Falta la ampliacion del WOD.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='progreso_fisico' AND policyname='progreso_fisico_alumno_lectura' AND coalesce(qual,'')~*'usuario_id = auth.uid') THEN RAISE EXCEPTION 'El progreso no esta aislado por alumno.'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='progreso_fisico' AND coalesce(qual,'')~*'(staff|owner|admin)') THEN RAISE EXCEPTION 'Coach o gestion recibio acceso al progreso fisico.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wod_resultados_unico') THEN RAISE EXCEPTION 'Falta unicidad de resultado por alumno y WOD.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='desafio_participacion_unica') THEN RAISE EXCEPTION 'Falta unicidad de participacion.'; END IF;
  IF to_regprocedure('public.obtener_deportivo_alumno()') IS NULL OR to_regprocedure('public.listar_panel_deportivo_coach()') IS NULL OR to_regprocedure('public.guardar_desafio(uuid,text,text,date,date,numeric,text,text)') IS NULL THEN RAISE EXCEPTION 'Faltan RPC deportivas.'; END IF;
  IF pg_get_functiondef('public.listar_panel_deportivo_coach()'::regprocedure) ~* '(peso_kg|estatura_m|\mimc\M|cedula|email|celular|pagos)' THEN RAISE EXCEPTION 'La proyeccion coach contiene datos privados.'; END IF;
  IF NOT has_function_privilege('authenticated','public.obtener_deportivo_alumno()','EXECUTE') OR NOT has_function_privilege('authenticated','public.listar_panel_deportivo_coach()','EXECUTE') THEN RAISE EXCEPTION 'Faltan permisos RPC.'; END IF;
END; $$;
SELECT estado,count(*) FROM public.desafios GROUP BY estado ORDER BY estado;
ROLLBACK;

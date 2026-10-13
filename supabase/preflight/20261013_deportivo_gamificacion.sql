BEGIN TRANSACTION READ ONLY;
DO $$
BEGIN
  IF to_regclass('public.wods') IS NULL OR to_regclass('public.usuarios') IS NULL OR to_regprocedure('public.mi_rol()') IS NULL
     OR to_regprocedure('public.set_updated_at()') IS NULL OR to_regprocedure('public.registrar_auditoria()') IS NULL THEN
    RAISE EXCEPTION 'Falta la base de WOD, usuarios, roles o auditoria.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wods' AND column_name IN ('benchmark_ref','permite_resultados','limite_tiempo_minutos'))
     OR to_regclass('public.progreso_fisico') IS NOT NULL OR to_regclass('public.records_personales') IS NOT NULL
     OR to_regclass('public.wod_resultados') IS NOT NULL OR to_regclass('public.desafios') IS NOT NULL OR to_regclass('public.desafio_participantes') IS NOT NULL THEN
    RAISE EXCEPTION 'El bloque deportivo parece aplicado o parcialmente aplicado; revisar manualmente.';
  END IF;
END; $$;
SELECT count(*) AS wods_existentes FROM public.wods;
ROLLBACK;

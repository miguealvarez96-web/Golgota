-- Solo lectura. Comprueba el estado base antes del cierre operativo.
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.gastos') IS NULL
     OR to_regclass('public.auditoria_logs') IS NULL
     OR to_regprocedure('public.mi_rol()') IS NULL
     OR to_regprocedure('public.registrar_auditoria()') IS NULL THEN
    RAISE EXCEPTION 'Falta la estructura base de gastos, roles o auditoria.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gastos'
      AND column_name IN ('proveedor', 'observacion', 'estado', 'updated_by', 'anulado_por', 'anulado_at')
  ) THEN
    RAISE EXCEPTION 'La ampliacion de gastos parece aplicada o parcialmente aplicada.';
  END IF;
  IF to_regclass('public.inventario_items') IS NOT NULL
     OR to_regclass('public.inventario_incidencias') IS NOT NULL
     OR to_regclass('public.v_inventario_operativo') IS NOT NULL
     OR to_regclass('public.v_inventario_gestion') IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe una estructura de inventario; revisar antes de crear otra.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gastos'
      AND column_name = 'tipo_gasto' AND udt_name = 'tipo_gasto_enum'
  ) THEN
    RAISE EXCEPTION 'public.gastos no conserva la estructura base esperada.';
  END IF;
END;
$$;

SELECT count(*) AS gastos_existentes FROM public.gastos;
ROLLBACK;

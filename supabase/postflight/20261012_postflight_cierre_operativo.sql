-- Verificacion de estructura, permisos, vistas y RLS del cierre operativo.
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gastos'
      AND column_name IN ('proveedor', 'observacion', 'estado', 'updated_by', 'anulado_por', 'anulado_at')
  ) <> 6 THEN
    RAISE EXCEPTION 'Faltan columnas de anulacion o detalle en gastos.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'gastos'
      AND column_name = 'tipo_gasto' AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'La categoria de gastos no fue ampliada correctamente.';
  END IF;
  IF to_regclass('public.inventario_items') IS NULL
     OR to_regclass('public.inventario_incidencias') IS NULL
     OR to_regclass('public.v_inventario_operativo') IS NULL
     OR to_regclass('public.v_inventario_gestion') IS NULL
     OR to_regprocedure('public.resolver_incidencia_inventario(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Falta estructura del inventario interno.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_inventario_operativo'
      AND column_name IN ('costo', 'fecha_compra', 'created_by', 'updated_by')
  ) THEN
    RAISE EXCEPTION 'La vista operativa expone datos restringidos.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_inventario_gestion' AND column_name = 'costo'
  ) THEN
    RAISE EXCEPTION 'La vista de gestion no incluye costo.';
  END IF;
  IF has_table_privilege('authenticated', 'public.gastos', 'DELETE')
     OR has_table_privilege('authenticated', 'public.inventario_items', 'DELETE')
     OR has_table_privilege('authenticated', 'public.inventario_incidencias', 'DELETE')
     OR has_table_privilege('authenticated', 'public.inventario_items', 'SELECT')
     OR has_column_privilege('authenticated', 'public.inventario_items', 'costo', 'SELECT') THEN
    RAISE EXCEPTION 'Los privilegios operativos permiten lectura o borrado indebido.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.v_inventario_operativo', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.v_inventario_gestion', 'SELECT')
     OR NOT has_function_privilege('authenticated', 'public.resolver_incidencia_inventario(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Faltan privilegios minimos para inventario.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gastos'
      AND policyname = 'gastos_edicion' AND coalesce(qual, '') ~* 'admin.*owner'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inventario_incidencias'
      AND policyname = 'inventario_incidencias_creacion' AND coalesce(with_check, '') ~* 'admin.*owner.*staff'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'inventario_incidencias'
      AND policyname = 'inventario_incidencias_resolucion' AND coalesce(qual, '') ~* 'admin.*owner'
  ) THEN
    RAISE EXCEPTION 'Las politicas por rol no coinciden con el cierre operativo.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.gastos'::regclass AND tgname = 'audit_gastos' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.inventario_items'::regclass AND tgname = 'audit_inventario_items' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.inventario_incidencias'::regclass AND tgname = 'audit_inventario_incidencias' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Faltan triggers de auditoria.';
  END IF;
END;
$$;

SELECT estado, count(*) FROM public.gastos GROUP BY estado ORDER BY estado;
SELECT estado, count(*) FROM public.inventario_items GROUP BY estado ORDER BY estado;
SELECT estado, count(*) FROM public.inventario_incidencias GROUP BY estado ORDER BY estado;
ROLLBACK;

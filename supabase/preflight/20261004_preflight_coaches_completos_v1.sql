-- Solo lectura. Validar antes de aplicar BLOQUE 3.
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.clientes') IS NULL
     OR to_regclass('public.membresias_verificacion') IS NULL
     OR to_regclass('public.v_membresias_verificacion') IS NULL
     OR to_regclass('public.usuarios') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas o la proyección operativa de membresías requerida por BLOQUE 3.';
  END IF;
  IF to_regprocedure('public.mi_rol()') IS NULL
     OR to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Faltan funciones base de autorización o auditoría.';
  END IF;
  IF to_regclass('public.wods') IS NOT NULL
     OR to_regclass('public.comunicados') IS NOT NULL
     OR to_regprocedure('public.set_comunicado_fecha_publicacion()') IS NOT NULL THEN
    RAISE EXCEPTION 'BLOQUE 3 parece aplicado o existen objetos con nombres incompatibles.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.membresias_verificacion'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'La proyección material operativa no tiene RLS habilitado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_membresias_verificacion'
      AND column_name IN ('valor', 'abono', 'saldo', 'estado_pago', 'metodo_pago')
  ) THEN
    RAISE EXCEPTION 'La proyección operativa expone información financiera.';
  END IF;
  IF has_table_privilege('authenticated', 'public.pagos', 'DELETE')
     OR has_table_privilege('authenticated', 'public.membresias', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated conserva permisos destructivos financieros inesperados.';
  END IF;
END;
$$;

SELECT count(*) AS membresias_operativas
FROM public.membresias_verificacion
WHERE NOT cancelada;

ROLLBACK;


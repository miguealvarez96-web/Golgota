BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF to_regclass('public.clientes') IS NULL
     OR to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.auditoria_logs') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas requeridas para la eliminación segura de clientes.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.clientes'::regclass
      AND attname IN ('id', 'estado_cliente', 'auth_user_id')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'La estructura esperada de clientes no está disponible.';
  END IF;

  IF to_regprocedure('public.registrar_auditoria()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.clientes'::regclass
         AND tgname = 'audit_clientes'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'La auditoría de clientes no está disponible.';
  END IF;

  IF has_table_privilege('authenticated', 'public.clientes', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated conserva DELETE directo sobre clientes.';
  END IF;
END;
$$;

ROLLBACK;

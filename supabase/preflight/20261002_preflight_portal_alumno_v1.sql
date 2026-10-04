-- Solo lectura. Ejecutar antes del dry-run de Portal del Alumno V1.
BEGIN TRANSACTION READ ONLY;

DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 120000 THEN
    RAISE EXCEPTION 'Portal del Alumno requiere PostgreSQL 12 o superior para ALTER TYPE ADD VALUE transaccional.';
  END IF;
  IF to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.clientes') IS NULL
     OR to_regclass('public.membresias') IS NULL
     OR to_regclass('public.pagos') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas base requeridas.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.clientes'::regclass
      AND attname = 'auth_user_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Falta clientes.auth_user_id; aplicar antes la migración 20260929.';
  END IF;
  IF to_regprocedure('public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Falta la RPC registrar_pago compatible.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'rol_usuario_enum' AND t.typtype = 'e'
  ) THEN
    RAISE EXCEPTION 'Falta public.rol_usuario_enum o no es un enum.';
  END IF;
  IF to_regclass('public.reportes_pago_alumno') IS NOT NULL THEN
    RAISE EXCEPTION 'reportes_pago_alumno ya existe; revisar el estado antes de migrar.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'estado_reporte_pago_enum'
  ) THEN
    RAISE EXCEPTION 'estado_reporte_pago_enum ya existe; revisar un intento anterior.';
  END IF;
  IF to_regprocedure('public.reportar_pago_alumno(numeric,date,text,text,text,uuid)') IS NOT NULL
     OR to_regprocedure('public.aprobar_reporte_pago_alumno(uuid)') IS NOT NULL
     OR to_regprocedure('public.rechazar_reporte_pago_alumno(uuid,text)') IS NOT NULL
     OR to_regprocedure('public.obtener_portal_alumno()') IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe una RPC del Portal del Alumno; revisar un intento anterior.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND policyname IN (
      'clientes_alumno_propio', 'membresias_alumno_propias',
      'reportes_pago_alumno_lectura_propia',
      'reportes_pago_alumno_lectura_revision',
      'reportes_pago_alumno_creacion_propia'
    )
  ) THEN
    RAISE EXCEPTION 'Ya existe una política del Portal del Alumno; revisar un intento anterior.';
  END IF;
  IF EXISTS (
    SELECT auth_user_id FROM public.clientes
    WHERE auth_user_id IS NOT NULL
    GROUP BY auth_user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay cuentas vinculadas a más de un cliente.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clientes'
      AND policyname = 'clientes_lectura'
  ) THEN
    RAISE EXCEPTION 'Sigue activa la política heredada clientes_lectura; expondría otros clientes al rol alumno.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clientes'
      AND policyname = 'clientes_consulta'
      AND cmd = 'SELECT'
      AND qual ~* 'rol'
      AND qual ~* 'admin'
      AND qual ~* 'owner'
      AND qual ~* 'staff'
  ) THEN
    RAISE EXCEPTION 'clientes_consulta no conserva la restricción de lectura para admin/owner/staff.';
  END IF;
END;
$$;

SELECT count(*) AS clientes_vinculados FROM public.clientes WHERE auth_user_id IS NOT NULL;
SELECT rol::text, count(*) FROM public.usuarios GROUP BY rol ORDER BY rol::text;

ROLLBACK;

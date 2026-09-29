-- Fase 5: clientes. Admite tanto el esquema inicial como el estado objetivo.
-- Sin cambios en usuarios, auth, membresías, pagos ni sus políticas.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'clientes' AND policyname NOT IN (
               'clientes_lectura', 'clientes_admin',
               'clientes_consulta', 'clientes_creacion', 'clientes_edicion')) THEN
    RAISE EXCEPTION 'Hay políticas de clientes adicionales; revisar antes de reemplazar sus permisos.';
  END IF;
END;
$$;

-- Vínculo futuro explícito, nunca inferido por correo/teléfono ni editable desde
-- el navegador. UNIQUE permite varios NULL y como máximo un cliente por cuenta.
-- Vincular una cuenta a un cliente existente requerirá verificar identidad en
-- una operación posterior del servidor. No se crea registro público ni RPC aquí.
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS auth_user_id UUID;

DO $$
DECLARE v_column smallint;
BEGIN
  SELECT attnum INTO v_column FROM pg_attribute
  WHERE attrelid = 'public.clientes'::regclass
    AND attname = 'auth_user_id' AND NOT attisdropped;

  IF v_column IS NULL OR EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = 'public.clientes'::regclass
      AND attnum = v_column AND atttypid <> 'pg_catalog.uuid'::regtype
  ) THEN
    RAISE EXCEPTION 'clientes.auth_user_id debe ser UUID; revisar antes de continuar.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'public.clientes'::regclass
               AND attnum = v_column AND attnotnull) THEN
    ALTER TABLE public.clientes ALTER COLUMN auth_user_id DROP NOT NULL;
  END IF;

  -- Un índice respaldado por UNIQUE también satisface esta comprobación.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.clientes'::regclass
      AND i.indisunique AND i.indisvalid AND i.indnatts = 1
      AND i.indkey[0] = v_column AND i.indpred IS NULL AND i.indexprs IS NULL
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = 'clientes_auth_user_id_key') THEN
      RAISE EXCEPTION 'clientes_auth_user_id_key existe pero no asegura unicidad de auth_user_id.';
    END IF;
    CREATE UNIQUE INDEX clientes_auth_user_id_key ON public.clientes (auth_user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.clientes'::regclass AND c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND c.conkey = ARRAY[v_column]::smallint[]
      AND c.confkey = ARRAY[(
        SELECT attnum FROM pg_attribute WHERE attrelid = 'auth.users'::regclass
          AND attname = 'id' AND NOT attisdropped
      )]::smallint[]
      AND c.confdeltype = 'n'
  ) THEN
    ALTER TABLE public.clientes ADD CONSTRAINT clientes_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;
COMMENT ON COLUMN public.clientes.auth_user_id IS
  'Cuenta de alumno futura: vínculo opcional y único. Solo asignación confiable desde servidor tras verificar identidad; no autoasociar por email. No editable por anon/authenticated.';

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clientes_lectura ON public.clientes;
DROP POLICY IF EXISTS clientes_admin ON public.clientes;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'clientes' AND policyname = 'clientes_consulta') THEN
    CREATE POLICY clientes_consulta ON public.clientes FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
        AND u.rol IN ('admin', 'owner', 'staff')
    ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'clientes' AND policyname = 'clientes_creacion') THEN
    CREATE POLICY clientes_creacion ON public.clientes FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid() AND auth_user_id IS NULL AND EXISTS (
      SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
        AND u.rol IN ('admin', 'owner', 'staff')
    ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'clientes' AND policyname = 'clientes_edicion') THEN
    CREATE POLICY clientes_edicion ON public.clientes FOR UPDATE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
        AND u.rol IN ('admin', 'owner')
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
        AND u.rol IN ('admin', 'owner')
    ));
  END IF;
END;
$$;

-- No borrar clientes ni conceder permisos de DDL. Limpiar también concesiones
-- por columna: las concesiones de tabla y de columna se suman, no se restringen.
REVOKE ALL ON TABLE public.clientes FROM PUBLIC, anon, authenticated;
DO $$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_columns
  FROM pg_attribute WHERE attrelid = 'public.clientes'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.clientes FROM PUBLIC, anon, authenticated',
    v_columns, v_columns, v_columns, v_columns);
END;
$$;

GRANT SELECT ON TABLE public.clientes TO authenticated;
GRANT INSERT (cedula, nombre_completo, celular, email, estado_cliente, fecha_registro, created_by),
      UPDATE (cedula, nombre_completo, celular, email, estado_cliente, fecha_registro)
ON TABLE public.clientes TO authenticated;
-- RLS impide UPDATE a staff aunque comparte el rol SQL authenticated.
-- Permanecen los triggers clientes_updated_at y audit_clientes existentes.
-- La cédula conserva su UNIQUE y su CHECK numérico; no se hace único el correo
-- ni el teléfono porque pueden compartirse entre familiares.

DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.clientes', 'DELETE')
       OR has_table_privilege(v_role, 'public.clientes', 'TRUNCATE')
       OR has_column_privilege(v_role, 'public.clientes', 'auth_user_id', 'INSERT')
       OR has_column_privilege(v_role, 'public.clientes', 'auth_user_id', 'UPDATE') THEN
      RAISE EXCEPTION 'Permisos efectivos inesperados de % en clientes; revisar roles heredados.', v_role;
    END IF;
  END LOOP;
END;
$$;
COMMIT;

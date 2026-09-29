-- Fase 5: clientes. Archivo local pendiente de revisión; no ejecutado.
-- Sin cambios en usuarios, auth, membresías, pagos ni sus políticas.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'clientes' AND policyname NOT IN ('clientes_lectura', 'clientes_admin')) THEN
    RAISE EXCEPTION 'Hay políticas de clientes adicionales; revisar antes de reemplazar sus permisos.';
  END IF;
END;
$$;

-- Vínculo futuro explícito, nunca inferido por correo/teléfono ni editable desde
-- el navegador. UNIQUE permite varios NULL y como máximo un cliente por cuenta.
-- Vincular una cuenta a un cliente existente requerirá verificar identidad en
-- una operación posterior del servidor. No se crea registro público ni RPC aquí.
ALTER TABLE public.clientes
  ADD COLUMN auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.clientes.auth_user_id IS
  'Cuenta de alumno futura: vínculo opcional y único. Solo asignación confiable desde servidor tras verificar identidad; no autoasociar por email. No editable por anon/authenticated.';

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY clientes_lectura ON public.clientes;
DROP POLICY clientes_admin ON public.clientes;

CREATE POLICY clientes_consulta ON public.clientes FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
    AND u.rol IN ('admin', 'owner', 'staff')
));

CREATE POLICY clientes_creacion ON public.clientes FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND auth_user_id IS NULL AND EXISTS (
  SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
    AND u.rol IN ('admin', 'owner', 'staff')
));

CREATE POLICY clientes_edicion ON public.clientes FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
    AND u.rol IN ('admin', 'owner')
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo
    AND u.rol IN ('admin', 'owner')
));

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

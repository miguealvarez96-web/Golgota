-- GÓLGOTA: completar el estado parcial del 23/09, sin reejecutar esa migración.
-- Ejecutar ESTE ARCHIVO COMPLETO en una sola sesión/transacción, con rol postgres.
-- PostgreSQL >= 15. Preparado sin conectarse a la base ni ejecutar SQL.
-- No cambia filas de membresias/pagos ni rellena pagos históricos.
-- Si hay estructura/datos inesperados, aborta; no usar fragmentos para saltar errores.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;

DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'Se requiere PostgreSQL >= 15.';
  END IF;
  IF current_user IN ('anon', 'authenticated', 'authenticator', 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Ejecutar con el rol de migraciones confiable postgres y visibilidad completa (BYPASSRLS).';
  END IF;
  IF to_regclass('public.membresias') IS NULL OR to_regclass('public.planes') IS NULL
     OR to_regprocedure('public.mi_rol()') IS NULL
     OR to_regprocedure('public.registrar_auditoria()') IS NULL
     OR to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'Faltan dependencias del esquema inicial; no se reconstruyen automáticamente.';
  END IF;
END;
$$;

LOCK TABLE public.planes, public.membresias IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  v_labels text[];
BEGIN
  IF to_regtype('public.estado_pago_membresia_enum') IS NULL THEN
    CREATE TYPE public.estado_pago_membresia_enum AS ENUM ('PENDIENTE', 'PAGADO', 'CANCELADA');
  END IF;
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO v_labels
  FROM pg_enum e WHERE e.enumtypid = 'public.estado_pago_membresia_enum'::regtype;
  IF v_labels IS DISTINCT FROM ARRAY['PENDIENTE', 'PAGADO', 'CANCELADA']::text[] THEN
    RAISE EXCEPTION 'Enum incompatible: %. No se eliminan ni convierten valores automáticamente.', v_labels;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.membresias'::regclass
             AND attname = 'estado' AND attnum > 0 AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.membresias'::regclass
                    AND attname = 'estado_legacy' AND atttypid = 'public.estado_pago_enum'::regtype
                    AND attnum > 0 AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.membresias'::regclass
                    AND attname = 'estado_pago' AND atttypid = 'public.estado_pago_membresia_enum'::regtype
                    AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Esta reparación requiere estado_legacy y estado_pago ya migrados, sin columna estado. No renombra ni sobrescribe el historial.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membresia_id UUID NOT NULL REFERENCES public.membresias(id) ON DELETE RESTRICT,
  monto NUMERIC(10,2) NOT NULL CHECK (monto > 0 AND monto <> 'NaN'::numeric),
  fecha_pago TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(fecha_pago)),
  metodo_pago public.metodo_pago_enum NOT NULL,
  created_by UUID REFERENCES public.usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
LOCK TABLE public.pagos IN ACCESS EXCLUSIVE MODE;

-- IF NOT EXISTS por sí solo NO valida una tabla existente.
DO $$
DECLARE
  v_expected record;
  v_actual record;
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = 'public.pagos'::regclass) <> 'r' THEN
    RAISE EXCEPTION 'pagos debe ser una tabla ordinaria.';
  END IF;
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('id', 'uuid'::regtype, -1),
      ('membresia_id', 'uuid'::regtype, -1),
      ('monto', 'numeric'::regtype, 655366), -- typmod numeric(10,2)
      ('fecha_pago', 'timestamptz'::regtype, -1),
      ('metodo_pago', 'public.metodo_pago_enum'::regtype, -1),
      ('created_by', 'uuid'::regtype, -1),
      ('created_at', 'timestamptz'::regtype, -1)
    ) AS e(nombre, tipo, modificador)
  LOOP
    SELECT * INTO v_actual FROM pg_attribute
    WHERE attrelid = 'public.pagos'::regclass AND attname = v_expected.nombre
      AND attnum > 0 AND NOT attisdropped;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Falta pagos.%; revisar el esquema antes de continuar.', v_expected.nombre;
    END IF;
    IF v_actual.atttypid <> v_expected.tipo OR v_actual.atttypmod <> v_expected.modificador
       OR v_actual.attgenerated <> '' OR v_actual.attidentity <> '' THEN
      RAISE EXCEPTION 'Tipo/generación incompatible en pagos.%.', v_expected.nombre;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.pagos'::regclass
      AND attnum > 0 AND NOT attisdropped) <> 7 THEN
    RAISE EXCEPTION 'pagos contiene columnas adicionales no contempladas. Revisar sin eliminarlas.';
  END IF;

  -- El estado parcial esperado conserva tipos/NOT NULL del esquema inicial.
  -- No convertir dinero/fechas silenciosamente ni dejar huecos en los CHECK.
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('id', 'uuid'::regtype, -1),
      ('fecha_inicio', 'date'::regtype, -1), ('fecha_vencimiento', 'date'::regtype, -1),
      ('dias_duracion', 'integer'::regtype, -1),
      ('valor', 'numeric'::regtype, 655366),
      ('abono', 'numeric'::regtype, 655366), ('saldo', 'numeric'::regtype, 655366)
    ) AS e(nombre, tipo, modificador)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.membresias'::regclass AND attname = v_expected.nombre
        AND attnum > 0 AND NOT attisdropped AND attnotnull
        AND atttypid = v_expected.tipo AND atttypmod = v_expected.modificador
        AND attgenerated = '' AND attidentity = ''
    ) THEN
      RAISE EXCEPTION 'Estructura incompatible en membresias.%; requiere revisión.',v_expected.nombre;
    END IF;
  END LOOP;


  -- No conservar silenciosamente otra política permisiva ni disparar lógica duplicada.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND ((tablename = 'membresias' AND policyname NOT IN ('membresias_admin', 'membresias_lectura'))
        OR (tablename = 'pagos' AND policyname NOT IN ('pagos_lectura', 'pagos_registro')))) THEN
    RAISE EXCEPTION 'Hay políticas adicionales en membresias/pagos; requieren revisión explícita.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
      AND ((c.relname = 'membresias' AND t.tgname NOT IN
            ('membresias_validar_agregados', 'audit_membresias', 'membresias_updated_at'))
        OR (c.relname = 'pagos' AND t.tgname NOT IN ('pagos_validar', 'pagos_sincronizar', 'audit_pagos'))
        OR (c.relname = 'planes' AND t.tgname NOT IN ('audit_planes', 'planes_updated_at')))
  ) THEN
    RAISE EXCEPTION 'Hay triggers adicionales; no se eliminan ni se duplica su lógica automáticamente.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND ((p.proname = 'registrar_pago'
            AND (p.pronargs <> 4 OR p.proargtypes[0] <> 'uuid'::regtype OR p.proargtypes[1] <> 'numeric'::regtype OR p.proargtypes[2] <> 'public.metodo_pago_enum'::regtype OR p.proargtypes[3] <> 'timestamptz'::regtype))
        OR (p.proname IN ('validar_pago_membresia', 'validar_agregados_membresia',
                         'sincronizar_pago_membresia') AND p.pronargs <> 0)
        OR p.proname IN ('crear_membresia', 'sync_membresia_desde_pagos'))
  ) THEN
    RAISE EXCEPTION 'Hay firmas/funciones fuera del estado parcial descrito; revisar para no dejar RPC alternativas.';
  END IF;
END;
$$;

-- Comprobar todo el historial ANTES de instalar lógica o modificar el catálogo.
-- No se deriva estado_pago del legado aquí: la transición ya ocurrió.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.membresias m
    LEFT JOIN (SELECT membresia_id, sum(monto) AS total FROM public.pagos GROUP BY membresia_id) p
      ON p.membresia_id = m.id
    WHERE m.valor IS NULL OR m.valor <= 0 OR m.valor::text IN ('NaN', 'Infinity', '-Infinity')
       OR m.abono IS NULL OR m.abono::text IN ('NaN', 'Infinity', '-Infinity')
       OR m.saldo IS NULL OR m.saldo::text IN ('NaN', 'Infinity', '-Infinity')
       OR m.abono < 0 OR m.saldo < 0
       OR m.abono IS DISTINCT FROM coalesce(p.total, 0)
       OR m.saldo IS DISTINCT FROM m.valor - m.abono
       OR m.estado_pago IS NULL
       OR NOT (m.estado_pago = 'CANCELADA'
               OR (m.estado_pago = 'PAGADO' AND m.saldo = 0)
               OR (m.estado_pago = 'PENDIENTE' AND m.saldo > 0))
       OR m.fecha_inicio IS NULL OR m.fecha_vencimiento IS NULL
       OR m.dias_duracion IS NULL OR m.dias_duracion <= 0
       OR NOT isfinite(m.fecha_inicio) OR NOT isfinite(m.fecha_vencimiento)
       OR m.fecha_vencimiento <> m.fecha_inicio + m.dias_duracion - 1
  ) THEN
    RAISE EXCEPTION 'Membresías inconsistentes: conciliar manualmente. No se recalculan saldos, estados ni fechas históricas.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pagos p
    LEFT JOIN public.membresias m ON m.id = p.membresia_id
    LEFT JOIN public.usuarios u ON u.id = p.created_by
    WHERE p.id IS NULL OR m.id IS NULL OR p.monto IS NULL OR p.monto <= 0
       OR p.monto::text IN ('NaN', 'Infinity', '-Infinity')
       OR p.fecha_pago IS NULL OR NOT isfinite(p.fecha_pago)
       OR p.metodo_pago IS NULL OR p.created_at IS NULL
       OR (p.created_by IS NOT NULL AND u.id IS NULL)
  ) OR EXISTS (SELECT 1 FROM public.pagos GROUP BY id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Pagos inconsistentes/huérfanos/duplicados. No se modifica su historial.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.planes
    WHERE upper(btrim(nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL')
    GROUP BY upper(btrim(nombre)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Planes aprobados duplicados; no se eliminan ni reasignan referencias.';
  END IF;
END;
$$;

ALTER TABLE public.membresias
  ALTER COLUMN estado_legacy DROP DEFAULT,
  ALTER COLUMN estado_legacy DROP NOT NULL,
  ALTER COLUMN estado_pago SET DEFAULT 'PENDIENTE',
  ALTER COLUMN estado_pago SET NOT NULL,
  ALTER COLUMN abono SET DEFAULT 0;

-- Sustituir únicamente CHECK conocidos, sin CASCADE y sin alterar filas.
-- Si una fila incumple la regla, ADD CONSTRAINT aborta toda la transacción.
ALTER TABLE public.membresias
  DROP CONSTRAINT IF EXISTS membresias_estado_pago_permitido,
  DROP CONSTRAINT IF EXISTS membresias_estado_pago_saldo,
  DROP CONSTRAINT IF EXISTS membresias_fechas_inclusivas,
  DROP CONSTRAINT IF EXISTS membresias_valor_finito,
  ADD CONSTRAINT membresias_estado_pago_permitido
    CHECK (estado_pago IN ('PENDIENTE', 'PAGADO', 'CANCELADA')),
  ADD CONSTRAINT membresias_estado_pago_saldo
    CHECK (estado_pago = 'CANCELADA' OR (saldo = 0 AND estado_pago = 'PAGADO')
           OR (saldo > 0 AND estado_pago = 'PENDIENTE')),
  ADD CONSTRAINT membresias_fechas_inclusivas
    CHECK (isfinite(fecha_inicio) AND isfinite(fecha_vencimiento)
           AND fecha_vencimiento = fecha_inicio + dias_duracion - 1),
  ADD CONSTRAINT membresias_valor_finito CHECK (valor <> 'NaN'::numeric);

ALTER TABLE public.pagos
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN membresia_id SET NOT NULL,
  ALTER COLUMN monto SET NOT NULL,
  ALTER COLUMN fecha_pago SET DEFAULT now(),
  ALTER COLUMN fecha_pago SET NOT NULL,
  ALTER COLUMN metodo_pago SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  DROP CONSTRAINT IF EXISTS pagos_monto_check,
  DROP CONSTRAINT IF EXISTS pagos_fecha_pago_check,
  ADD CONSTRAINT pagos_monto_check CHECK (monto > 0 AND monto <> 'NaN'::numeric),
  ADD CONSTRAINT pagos_fecha_pago_check CHECK (isfinite(fecha_pago));

-- Detectar PK/FK equivalentes por estructura, aunque tengan otro nombre.
DO $$
DECLARE
  v_id smallint;
  v_membresia smallint;
  v_actor smallint;
  v_ref smallint;
  v_constraint record;
BEGIN
  SELECT attnum INTO v_id FROM pg_attribute WHERE attrelid = 'public.pagos'::regclass AND attname = 'id';
  SELECT attnum INTO v_membresia FROM pg_attribute WHERE attrelid = 'public.pagos'::regclass AND attname = 'membresia_id';
  SELECT attnum INTO v_actor FROM pg_attribute WHERE attrelid = 'public.pagos'::regclass AND attname = 'created_by';
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pagos'::regclass
             AND contype = 'p' AND (conkey <> ARRAY[v_id] OR condeferrable)) THEN
    RAISE EXCEPTION 'La PK de pagos no coincide con el diseño aprobado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pagos'::regclass AND contype = 'p') THEN
    ALTER TABLE public.pagos ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);
  END IF;
  SELECT attnum INTO v_ref FROM pg_attribute WHERE attrelid = 'public.membresias'::regclass AND attname = 'id';
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pagos'::regclass AND contype = 'f'
             AND v_membresia = ANY(conkey)
             AND (conkey <> ARRAY[v_membresia] OR confrelid <> 'public.membresias'::regclass
                  OR confkey <> ARRAY[v_ref] OR confdeltype <> 'r' OR confupdtype <> 'a' OR condeferrable)) THEN
    RAISE EXCEPTION 'FK pagos/membresias incompatible: se requiere ON DELETE RESTRICT.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pagos'::regclass
                 AND contype = 'f' AND conkey = ARRAY[v_membresia]) THEN
    ALTER TABLE public.pagos ADD CONSTRAINT pagos_membresia_id_fkey
      FOREIGN KEY (membresia_id) REFERENCES public.membresias(id) ON DELETE RESTRICT;
  END IF;
  SELECT attnum INTO v_ref FROM pg_attribute WHERE attrelid = 'public.usuarios'::regclass AND attname = 'id';
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pagos'::regclass AND contype = 'f'
             AND v_actor = ANY(conkey)
             AND (conkey <> ARRAY[v_actor] OR confrelid <> 'public.usuarios'::regclass
                  OR confkey <> ARRAY[v_ref] OR confdeltype <> 'a' OR confupdtype <> 'a' OR condeferrable)) THEN
    RAISE EXCEPTION 'FK pagos/usuarios incompatible.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.pagos'::regclass
                 AND contype = 'f' AND conkey = ARRAY[v_actor]) THEN
    ALTER TABLE public.pagos ADD CONSTRAINT pagos_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.usuarios(id);
  END IF;
  FOR v_constraint IN SELECT conrelid::regclass AS tabla, conname FROM pg_constraint
    WHERE conrelid IN ('public.pagos'::regclass, 'public.membresias'::regclass)
      AND contype IN ('f', 'c') AND NOT convalidated
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', v_constraint.tabla, v_constraint.conname);
  END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_membresias_estado_pago ON public.membresias (estado_pago);
CREATE INDEX IF NOT EXISTS idx_pagos_membresia_fecha ON public.pagos (membresia_id, fecha_pago);
CREATE UNIQUE INDEX IF NOT EXISTS planes_catalogo_aprobado_nombre
  ON public.planes (upper(btrim(nombre)))
  WHERE upper(btrim(nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL');

-- Comprobar los índices existentes; su nombre no demuestra su estructura.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_membresias_estado_pago')
      AND i.indrelid = 'public.membresias'::regclass
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'estado_pago'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_pagos_membresia_fecha')
      AND i.indrelid = 'public.pagos'::regclass
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnkeyatts = 2 AND i.indnatts = 2 AND i.indpred IS NULL AND i.indexprs IS NULL
      AND pg_get_indexdef(i.indexrelid, 1, true) = 'membresia_id'
      AND pg_get_indexdef(i.indexrelid, 2, true) = 'fecha_pago'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.planes_catalogo_aprobado_nombre')
      AND i.indrelid = 'public.planes'::regclass AND i.indisvalid AND i.indisready
      AND i.indisunique AND i.indnkeyatts = 1 AND i.indnatts = 1
      AND i.indpred IS NOT NULL AND i.indexprs IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Un índice conocido tiene una estructura incompatible. No se elimina automáticamente.';
  END IF;
  -- ON CONFLICT comprueba además la expresión/predicado del índice de planes.
END;
$$;


-- Asegurar auditoría antes de modificar planes; reemplaza el mismo trigger.
CREATE OR REPLACE TRIGGER audit_planes AFTER INSERT OR UPDATE OR DELETE ON public.planes
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE OR REPLACE TRIGGER planes_updated_at BEFORE UPDATE ON public.planes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.planes ENABLE TRIGGER audit_planes;
ALTER TABLE public.planes ENABLE TRIGGER planes_updated_at;

UPDATE public.planes SET activo = false
WHERE upper(btrim(nombre)) NOT IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL')
  AND activo IS DISTINCT FROM false;
INSERT INTO public.planes (nombre, duracion_dias, precio, activo)
VALUES ('DIARIO', 1, 4.00, true), ('SEMANAL', 7, 15.00, true),
       ('QUINCENAL', 15, 30.00, true), ('MENSUAL', 30, 50.00, true)
ON CONFLICT (upper(btrim(nombre)))
WHERE upper(btrim(nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL')
DO UPDATE SET nombre = EXCLUDED.nombre, duracion_dias = EXCLUDED.duracion_dias,
              precio = EXCLUDED.precio, activo = true
WHERE (planes.nombre, planes.duracion_dias, planes.precio, planes.activo)
  IS DISTINCT FROM (EXCLUDED.nombre, EXCLUDED.duracion_dias, EXCLUDED.precio, EXCLUDED.activo);

ALTER TABLE public.membresias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
-- DROP/CREATE del mismo nombre permite corregir también comando/roles/permisividad.
-- La transacción y los locks impiden un intervalo visible sin políticas.
DROP POLICY IF EXISTS membresias_admin ON public.membresias;
CREATE POLICY membresias_admin ON public.membresias FOR ALL TO authenticated
  USING (public.mi_rol() = 'admin') WITH CHECK (public.mi_rol() = 'admin');
DROP POLICY IF EXISTS membresias_lectura ON public.membresias;
CREATE POLICY membresias_lectura ON public.membresias FOR SELECT TO authenticated
  USING (public.mi_rol() IN ('admin', 'owner'));
DROP POLICY IF EXISTS pagos_lectura ON public.pagos;
CREATE POLICY pagos_lectura ON public.pagos FOR SELECT TO authenticated
  USING (public.mi_rol() IN ('admin', 'owner'));
DROP POLICY IF EXISTS pagos_registro ON public.pagos;
CREATE POLICY pagos_registro ON public.pagos FOR INSERT TO authenticated
  WITH CHECK (public.mi_rol() = 'admin' AND created_by = auth.uid());

-- Limpiar también ACL por columna: REVOKE de tabla no las elimina.
DO $$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_columns
  FROM pg_attribute WHERE attrelid = 'public.membresias'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.membresias FROM PUBLIC, anon, authenticated',
                 v_columns, v_columns);
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_columns
  FROM pg_attribute WHERE attrelid = 'public.pagos'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.pagos FROM PUBLIC, anon, authenticated',
                 v_columns, v_columns, v_columns, v_columns);
END;
$$;

REVOKE ALL ON TABLE public.pagos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.pagos TO authenticated;
-- RLS delimita filas, no columnas: quitar privilegios de tabla antes de conceder
-- solo las columnas editables. También retirar posibles concesiones por columna.
REVOKE INSERT, UPDATE ON TABLE public.membresias FROM PUBLIC, anon, authenticated;
REVOKE INSERT (abono, saldo, estado_legacy, metodo_pago),
       UPDATE (abono, saldo, estado_legacy, metodo_pago)
  ON TABLE public.membresias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.membresias TO authenticated;
GRANT INSERT (id, cliente_id, plan_id, horario_id, fecha_inicio,
              fecha_vencimiento, dias_duracion, valor, estado_pago, observaciones, created_by),
      UPDATE (cliente_id, plan_id, horario_id, fecha_inicio,
              fecha_vencimiento, dias_duracion, valor, estado_pago, observaciones)
  ON TABLE public.membresias TO authenticated;
-- FOR UPDATE en la RPC requiere UPDATE sobre al menos una columna, no sobre abono.
-- La política membresias_admin existente sigue reservando las escrituras a admin.
-- Futuro crear_membresia (misma transacción): insertar sin abono/saldo; el default
-- abono=0 y el trigger calculan saldo=valor. Si el abono inicial > 0, llamar a
-- registrar_pago con el nuevo ID. Si el pago falla, revertir también la creación.
-- Nunca insertar el abono inicial directamente en membresias.

CREATE OR REPLACE FUNCTION public.validar_pago_membresia()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_membresia public.membresias%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'El historial de pagos no permite modificar ni eliminar registros.';
  END IF;
  IF auth.uid() IS NULL OR public.mi_rol() IS DISTINCT FROM 'admin'::public.rol_usuario_enum THEN
    RAISE EXCEPTION 'No tiene permiso para registrar pagos.' USING ERRCODE = '42501';
  END IF;
  IF NEW.monto IS NULL OR NEW.monto <= 0 OR NEW.monto = 'NaN'::numeric THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor que cero.' USING ERRCODE = '22023';
  END IF;
  -- Todos los pagos de una membresía se serializan sobre la misma fila.
  SELECT * INTO v_membresia FROM public.membresias
  WHERE id = NEW.membresia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La membresía no existe o no está disponible para este usuario.';
  END IF;
  IF v_membresia.estado_pago = 'CANCELADA' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una membresía cancelada.';
  END IF;
  IF NEW.monto > v_membresia.saldo THEN
    RAISE EXCEPTION 'El pago supera el saldo pendiente de la membresía.' USING ERRCODE = '22023';
  END IF;
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER pagos_validar
BEFORE INSERT OR UPDATE OR DELETE ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.validar_pago_membresia();

CREATE OR REPLACE FUNCTION public.validar_agregados_membresia()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_abonado NUMERIC;
BEGIN
  -- Mantener una sola fuente de verdad aunque se escriba directamente en la tabla.
  SELECT COALESCE(sum(monto), 0) INTO v_abonado
  FROM public.pagos WHERE membresia_id = NEW.id;
  IF NEW.abono IS DISTINCT FROM v_abonado THEN
    RAISE EXCEPTION 'El abono debe coincidir con el historial. Registre los pagos mediante registrar_pago.';
  END IF;
  IF v_abonado > NEW.valor THEN
    RAISE EXCEPTION 'El valor de la membresía no puede ser menor que el total abonado.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado_legacy IS NOT NULL OR NEW.metodo_pago IS NOT NULL THEN
      RAISE EXCEPTION 'Use estado_pago y registre el método en cada pago; estado_legacy y metodo_pago de membresias son históricos.';
    END IF;
  ELSE
    IF NEW.estado_legacy IS DISTINCT FROM OLD.estado_legacy OR NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago THEN
      RAISE EXCEPTION 'No se pueden alterar los campos históricos estado_legacy y metodo_pago. Use estado_pago y pagos.';
    END IF;
  END IF;
  NEW.saldo := NEW.valor - v_abonado;
  IF NEW.estado_pago IS DISTINCT FROM 'CANCELADA'::public.estado_pago_membresia_enum THEN
    NEW.estado_pago := CASE WHEN NEW.saldo = 0 THEN 'PAGADO'::public.estado_pago_membresia_enum
                           ELSE 'PENDIENTE'::public.estado_pago_membresia_enum END;
  END IF;
  NEW.fecha_vencimiento := NEW.fecha_inicio + NEW.dias_duracion - 1;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER membresias_validar_agregados
BEFORE INSERT OR UPDATE ON public.membresias
FOR EACH ROW EXECUTE FUNCTION public.validar_agregados_membresia();

CREATE OR REPLACE FUNCTION public.sincronizar_pago_membresia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  -- Única elevación interna: los clientes no pueden escribir abono/saldo.
  -- Solo ejecutable como trigger AFTER INSERT de pagos; no es una RPC pública.
  -- Su propietario debe ser el rol de migraciones confiable, nunca authenticated.
  IF TG_OP <> 'INSERT' OR TG_WHEN <> 'AFTER'
     OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'pagos' THEN
    RAISE EXCEPTION 'Contexto de sincronización de pagos no permitido.';
  END IF;
  IF auth.uid() IS NULL OR public.mi_rol() IS DISTINCT FROM 'admin'::public.rol_usuario_enum
     OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No tiene permiso para sincronizar este pago.' USING ERRCODE = '42501';
  END IF;
  -- La fila ya está bloqueada por pagos_validar. El trigger de membresias deriva
  -- saldo/estado_pago y valida el total, incluso en INSERT de varios pagos a la vez.
  UPDATE public.membresias
  SET abono = (SELECT COALESCE(sum(monto), 0) FROM public.pagos WHERE membresia_id = NEW.membresia_id)
  WHERE id = NEW.membresia_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No fue posible actualizar la membresía; se revierte el pago.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER pagos_sincronizar
AFTER INSERT ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_pago_membresia();

CREATE OR REPLACE TRIGGER audit_pagos
AFTER INSERT OR UPDATE OR DELETE ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
-- Las actualizaciones de membresias y planes usan sus triggers de auditoría
-- y updated_at existentes; toda la auditoría revierte si falla el pago.

CREATE OR REPLACE FUNCTION public.registrar_pago(
  p_membresia_id UUID,
  p_monto NUMERIC,
  p_metodo_pago public.metodo_pago_enum,
  p_fecha_pago TIMESTAMPTZ DEFAULT now()
)
RETURNS public.pagos LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_membresia public.membresias%ROWTYPE;
  v_pago public.pagos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() IS DISTINCT FROM 'admin'::public.rol_usuario_enum THEN
    RAISE EXCEPTION 'No tiene permiso para registrar pagos.' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 OR p_monto::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_monto <> round(p_monto, 2) OR p_monto > 99999999.99 THEN
    RAISE EXCEPTION 'El monto debe ser positivo, finito, con máximo dos decimales y dentro del límite permitido.' USING ERRCODE = '22023';
  END IF;
  IF p_metodo_pago IS NULL OR p_fecha_pago IS NULL OR NOT isfinite(p_fecha_pago) THEN
    RAISE EXCEPTION 'Debe indicar un método de pago y una fecha válidos.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_membresia FROM public.membresias
  WHERE id = p_membresia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La membresía no existe o no está disponible para este usuario.';
  END IF;
  IF v_membresia.estado_pago = 'CANCELADA' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una membresía cancelada.';
  END IF;
  IF p_monto > v_membresia.saldo THEN
    RAISE EXCEPTION 'El pago supera el saldo pendiente de la membresía.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pagos (membresia_id, monto, fecha_pago, metodo_pago, created_by)
  VALUES (p_membresia_id, p_monto, p_fecha_pago, p_metodo_pago, auth.uid())
  RETURNING * INTO v_pago;
  -- INSERT + sincronización + auditoría pertenecen a la misma transacción.
  -- No capturar excepciones: cualquier fallo debe revertir la operación completa.
  RETURN v_pago;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_pago_membresia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_agregados_membresia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sincronizar_pago_membresia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_pago(UUID, NUMERIC, public.metodo_pago_enum, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pago(UUID, NUMERIC, public.metodo_pago_enum, TIMESTAMPTZ)
  TO authenticated;

CREATE OR REPLACE VIEW public.v_membresias_estado WITH (security_invoker = true) AS
SELECT m.id, m.cliente_id, m.plan_id, m.horario_id,
       m.fecha_inicio, m.fecha_vencimiento AS fecha_fin, m.dias_duracion,
       m.valor, m.abono AS total_abonado, m.saldo, m.estado_pago,
       m.observaciones, m.created_at, m.updated_at, m.created_by,
       m.fecha_inicio > reloj.hoy AS por_iniciar,
       CASE
         WHEN reloj.hoy < m.fecha_inicio THEN NULL::text
         WHEN reloj.hoy > m.fecha_vencimiento THEN 'VENCIDA'
         WHEN reloj.hoy = m.fecha_vencimiento THEN 'VENCE_HOY'
         WHEN m.fecha_vencimiento - reloj.hoy <= 3 THEN 'POR_VENCER'
         ELSE 'VIGENTE'
       END AS estado_vigencia
FROM public.membresias AS m
CROSS JOIN (SELECT (now() AT TIME ZONE 'America/Guayaquil')::date AS hoy) AS reloj;

COMMENT ON VIEW public.v_membresias_estado IS
  'Vigencia solo por fechas DATE y fecha de negocio de America/Guayaquil, independiente de deuda/cancelación. POR_VENCER: faltan 1 a 3 días. Antes del inicio: por_iniciar=true y estado_vigencia=NULL.';
REVOKE ALL ON TABLE public.v_membresias_estado FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_membresias_estado TO authenticated;


-- La elevación queda bajo el rol confiable que ejecuta la migración.
ALTER FUNCTION public.sincronizar_pago_membresia() OWNER TO CURRENT_USER;

CREATE OR REPLACE TRIGGER audit_membresias
AFTER INSERT OR UPDATE OR DELETE ON public.membresias
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE OR REPLACE TRIGGER membresias_updated_at
BEFORE UPDATE ON public.membresias
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.membresias ENABLE TRIGGER membresias_validar_agregados;
ALTER TABLE public.membresias ENABLE TRIGGER audit_membresias;
ALTER TABLE public.membresias ENABLE TRIGGER membresias_updated_at;
ALTER TABLE public.pagos ENABLE TRIGGER pagos_validar;
ALTER TABLE public.pagos ENABLE TRIGGER pagos_sincronizar;
ALTER TABLE public.pagos ENABLE TRIGGER audit_pagos;

-- Eliminar ACL por columna de una vista preexistente (además de las de tabla).
DO $$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO v_columns
  FROM pg_attribute WHERE attrelid = 'public.v_membresias_estado'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON public.v_membresias_estado FROM PUBLIC, anon, authenticated',
                 v_columns, v_columns, v_columns, v_columns);
END;
$$;

COMMENT ON COLUMN public.membresias.estado_legacy IS
  'LEGADO: valor anterior a la migración; solo conservación histórica. Nuevas filas NULL. Usar estado_pago y v_membresias_estado.estado_vigencia.';
COMMENT ON TABLE public.pagos IS
  'Historial de pagos individuales, solo inserciones. No inventar pagos a partir de abonos históricos. Anulaciones/reembolsos requieren un diseño posterior.';

-- Comprobaciones finales: herencia de roles/grants no debe saltarse las restricciones.
DO $$
DECLARE v_role text; v_column text; v_function text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_column IN ARRAY ARRAY['abono','saldo','estado_legacy','metodo_pago'] LOOP
      IF has_column_privilege(v_role,'public.membresias',v_column,'INSERT')
         OR has_column_privilege(v_role,'public.membresias',v_column,'UPDATE') THEN
        RAISE EXCEPTION 'Privilegios efectivos inesperados de % sobre membresias.%. Revisar herencia.', v_role,v_column;
      END IF;
    END LOOP;
    IF has_any_column_privilege(v_role,'public.pagos','UPDATE')
       OR has_table_privilege(v_role,'public.pagos','DELETE')
       OR has_table_privilege(v_role,'public.pagos','TRUNCATE')
       OR (v_role='anon' AND (has_any_column_privilege(v_role,'public.pagos','SELECT')
                             OR has_any_column_privilege(v_role,'public.pagos','INSERT'))) THEN
      RAISE EXCEPTION 'Privilegios efectivos inesperados de % sobre pagos.',v_role;
    END IF;
    FOREACH v_function IN ARRAY ARRAY['public.validar_pago_membresia()',
      'public.validar_agregados_membresia()','public.sincronizar_pago_membresia()'] LOOP
      IF has_function_privilege(v_role,v_function,'EXECUTE') THEN
        RAISE EXCEPTION 'La función interna % es ejecutable por %.',v_function,v_role;
      END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('anon','public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamptz)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'ACL efectiva de registrar_pago incompatible.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.v_membresias_estado'::regclass
                 AND 'security_invoker=true'=ANY(reloptions)) THEN
    RAISE EXCEPTION 'La vista debe respetar RLS mediante security_invoker=true.';
  END IF;
END;
$$;

-- No se instala crear_membresia. La sincronización aprobada es
-- sincronizar_pago_membresia(), ligada a pagos_sincronizar; no una RPC adicional.
COMMIT;


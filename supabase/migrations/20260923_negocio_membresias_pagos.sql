-- GÓLGOTA: catálogo aprobado, pagos transaccionales y vigencia por fechas.
-- Preparada contra 20260912_init.sql. Requiere PostgreSQL >= 15.
-- NO ejecutada. Revisar las precondiciones antes de aplicar en la base real.
BEGIN;

-- Evitar cambios concurrentes entre las comprobaciones y la instalación.
LOCK TABLE public.planes, public.membresias IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.membresias WHERE abono <> 0) THEN
    RAISE EXCEPTION 'Hay abonos históricos sin detalle transaccional. Conciliar e importar su historial mediante una migración revisada antes de continuar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.membresias WHERE estado = 'PAGADO' AND saldo > 0) THEN
    RAISE EXCEPTION 'Hay membresías marcadas PAGADO con saldo pendiente. Conciliar antes de continuar.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.membresias
    WHERE NOT isfinite(fecha_inicio) OR NOT isfinite(fecha_vencimiento)
       OR fecha_vencimiento <> fecha_inicio + dias_duracion - 1
       OR valor = 'NaN'::numeric
  ) THEN
    RAISE EXCEPTION 'Hay membresías con fechas no inclusivas, fechas infinitas o importes no válidos. Revisar sin modificar automáticamente el historial.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.planes
    WHERE upper(btrim(nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL')
    GROUP BY upper(btrim(nombre)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay nombres duplicados en los cuatro planes aprobados. Conciliar sus referencias antes de continuar.';
  END IF;
END;
$$;

-- Conservar IDs y referencias de planes históricos, retirándolos del catálogo activo.
-- No cambiar valor ni duración contratados en las membresías existentes.
UPDATE public.planes
SET activo = false
WHERE upper(btrim(nombre)) NOT IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL')
  AND activo IS DISTINCT FROM false;

CREATE UNIQUE INDEX planes_catalogo_aprobado_nombre
ON public.planes (upper(btrim(nombre)))
WHERE upper(btrim(nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL');

INSERT INTO public.planes (nombre, duracion_dias, precio, activo)
VALUES ('DIARIO', 1, 4.00, true), ('SEMANAL', 7, 15.00, true),
       ('QUINCENAL', 15, 30.00, true), ('MENSUAL', 30, 50.00, true)
ON CONFLICT (upper(btrim(nombre)))
WHERE upper(btrim(nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL')
DO UPDATE SET nombre = EXCLUDED.nombre,
              duracion_dias = EXCLUDED.duracion_dias,
              precio = EXCLUDED.precio,
              activo = true;

-- El enum original se comparte con ventas: no eliminar ni renombrar sus valores.
-- Tipo exclusivo de membresías: ACTIVA/VENCIDO se rechazan antes de los triggers.
CREATE TYPE public.estado_pago_membresia_enum AS ENUM ('PENDIENTE', 'PAGADO', 'CANCELADA');

-- Transición explícita: conservar el valor original bajo un nombre histórico,
-- sin default ni permisos de escritura. Ventas y su enum permanecen intactos.
ALTER TABLE public.membresias RENAME COLUMN estado TO estado_legacy;
ALTER TABLE public.membresias
  ADD COLUMN estado_pago public.estado_pago_membresia_enum,
  ALTER COLUMN estado_legacy DROP DEFAULT;

UPDATE public.membresias
SET estado_pago = CASE WHEN estado_legacy = 'CANCELADA' THEN 'CANCELADA'::public.estado_pago_membresia_enum
                       WHEN saldo = 0 THEN 'PAGADO'::public.estado_pago_membresia_enum
                       ELSE 'PENDIENTE'::public.estado_pago_membresia_enum END;

ALTER TABLE public.membresias
  ALTER COLUMN estado_pago SET DEFAULT 'PENDIENTE',
  ALTER COLUMN estado_pago SET NOT NULL,
  ADD CONSTRAINT membresias_estado_pago_permitido
    CHECK (estado_pago IN ('PENDIENTE', 'PAGADO', 'CANCELADA')),
  ADD CONSTRAINT membresias_estado_pago_saldo
    CHECK (estado_pago = 'CANCELADA'
           OR (saldo = 0 AND estado_pago = 'PAGADO')
           OR (saldo > 0 AND estado_pago = 'PENDIENTE')),
  ADD CONSTRAINT membresias_fechas_inclusivas
    CHECK (isfinite(fecha_inicio) AND isfinite(fecha_vencimiento)
           AND fecha_vencimiento = fecha_inicio + dias_duracion - 1),
  ADD CONSTRAINT membresias_valor_finito CHECK (valor <> 'NaN'::numeric);

COMMENT ON COLUMN public.membresias.estado_legacy IS
  'LEGADO: valor anterior a esta migración; solo conservación histórica. Nuevas filas NULL. Usar estado_pago y v_membresias_estado.estado_vigencia.';
COMMENT ON COLUMN public.membresias.metodo_pago IS
  'LEGADO: método original conservado; cada nuevo pago tiene su propio metodo_pago en pagos.';
COMMENT ON COLUMN public.membresias.fecha_vencimiento IS
  'Fecha de fin inclusiva: fecha_inicio + dias_duracion - 1. Se conserva el nombre existente.';

CREATE INDEX idx_membresias_estado_pago ON public.membresias (estado_pago);

CREATE TABLE public.pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membresia_id UUID NOT NULL REFERENCES public.membresias(id) ON DELETE RESTRICT,
  monto NUMERIC(10,2) NOT NULL CHECK (monto > 0 AND monto <> 'NaN'::numeric),
  fecha_pago TIMESTAMPTZ NOT NULL DEFAULT now() CHECK (isfinite(fecha_pago)),
  metodo_pago public.metodo_pago_enum NOT NULL,
  created_by UUID REFERENCES public.usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pagos_membresia_fecha ON public.pagos (membresia_id, fecha_pago);
COMMENT ON TABLE public.pagos IS
  'Historial de pagos individuales, solo inserciones. No inventar pagos a partir de abonos agregados históricos. Anulaciones/reembolsos requieren un diseño posterior.';

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
CREATE POLICY pagos_lectura ON public.pagos FOR SELECT TO authenticated
  USING (public.mi_rol() IN ('admin', 'owner'));
CREATE POLICY pagos_registro ON public.pagos FOR INSERT TO authenticated
  WITH CHECK (public.mi_rol() = 'admin' AND created_by = auth.uid());

-- Mismo modelo financiero que membresias: admin escribe, owner lee, staff sin acceso.
-- Sin UPDATE/DELETE/TRUNCATE: el historial no puede editarse ni borrarse por la API.
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

CREATE FUNCTION public.validar_pago_membresia()
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

CREATE TRIGGER pagos_validar
BEFORE INSERT OR UPDATE OR DELETE ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.validar_pago_membresia();

CREATE FUNCTION public.validar_agregados_membresia()
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

CREATE TRIGGER membresias_validar_agregados
BEFORE INSERT OR UPDATE ON public.membresias
FOR EACH ROW EXECUTE FUNCTION public.validar_agregados_membresia();

CREATE FUNCTION public.sincronizar_pago_membresia()
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
  -- saldo/estado y valida el total, incluso en INSERT de varios pagos a la vez.
  UPDATE public.membresias
  SET abono = (SELECT COALESCE(sum(monto), 0) FROM public.pagos WHERE membresia_id = NEW.membresia_id)
  WHERE id = NEW.membresia_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No fue posible actualizar la membresía; se revierte el pago.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pagos_sincronizar
AFTER INSERT ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_pago_membresia();

CREATE TRIGGER audit_pagos
AFTER INSERT OR UPDATE OR DELETE ON public.pagos
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
-- Las actualizaciones de membresias y planes usan sus triggers de auditoría
-- y updated_at existentes; toda la auditoría revierte si falla el pago.

CREATE FUNCTION public.registrar_pago(
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

CREATE VIEW public.v_membresias_estado WITH (security_invoker = true) AS
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

COMMIT;

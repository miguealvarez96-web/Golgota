-- Membresías y cobranza. Ejecutar después de 20260929_clientes_roles_y_cuenta.
-- Esta migración se prepara localmente; no se ejecuta desde la aplicación.
BEGIN;

-- Bloquear escrituras mientras se revisan históricos y se instala la barrera.
-- Los extremos son inclusivos: [inicio, fin] se superpone si ambos extremos
-- cruzan. No alterar períodos históricos automáticamente.
LOCK TABLE public.membresias IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.membresias a
    JOIN public.membresias b ON b.cliente_id = a.cliente_id AND b.id > a.id
    WHERE a.estado_pago <> 'CANCELADA' AND b.estado_pago <> 'CANCELADA'
      AND a.fecha_inicio <= b.fecha_vencimiento
      AND b.fecha_inicio <= a.fecha_vencimiento
  ) THEN
    RAISE EXCEPTION 'Existen membresías históricas no canceladas con fechas superpuestas; revisar antes de migrar.';
  END IF;
END;
$$;

-- Trigger interno: abarca RPC, INSERT/UPDATE directos autorizados y carreras
-- concurrentes. El lock de clientes se toma antes de insertar la membresía.
CREATE FUNCTION public.evitar_solapamiento_membresias()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_cliente_id uuid;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'membresias'
     OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Contexto de validación de membresías no permitido.';
  END IF;
  IF NEW.estado_pago = 'CANCELADA' THEN RETURN NEW; END IF;
  SELECT c.id INTO v_cliente_id FROM public.clientes c
    WHERE c.id = NEW.cliente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente no existe.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.membresias m
    WHERE m.cliente_id = NEW.cliente_id AND m.id <> NEW.id
      AND m.estado_pago <> 'CANCELADA'
      AND m.fecha_inicio <= NEW.fecha_inicio + NEW.dias_duracion - 1
      AND NEW.fecha_inicio <= m.fecha_vencimiento
  ) THEN
    RAISE EXCEPTION 'El cliente ya tiene una membresía que se superpone con estas fechas.'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER zz_membresias_evitar_solapamiento
BEFORE INSERT OR UPDATE OF cliente_id, fecha_inicio, fecha_vencimiento,
  dias_duracion, estado_pago ON public.membresias
FOR EACH ROW EXECUTE FUNCTION public.evitar_solapamiento_membresias();
REVOKE ALL ON FUNCTION public.evitar_solapamiento_membresias() FROM PUBLIC, anon, authenticated;

-- El catálogo incluye precio: staff obtiene solo el nombre desde la
-- proyección de verificación, no acceso directo a planes.
DROP POLICY planes_lectura ON public.planes;
CREATE POLICY planes_lectura ON public.planes FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));

-- Owner puede crear, pero no editar membresías existentes. La política también
-- protege la escritura directa con los mismos datos del catálogo vigente.
CREATE POLICY membresias_creacion_owner ON public.membresias FOR INSERT TO authenticated
WITH CHECK (
  public.mi_rol() = 'owner' AND created_by = auth.uid()
  AND abono = 0 AND saldo = valor AND estado_pago = 'PENDIENTE'
  AND estado_legacy IS NULL AND metodo_pago IS NULL
  AND EXISTS (SELECT 1 FROM public.planes p WHERE p.id = plan_id AND p.activo
    AND upper(btrim(p.nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL')
    AND p.precio = valor AND p.duracion_dias = dias_duracion)
);

DROP POLICY pagos_registro ON public.pagos;
CREATE POLICY pagos_registro ON public.pagos FOR INSERT TO authenticated
WITH CHECK (public.mi_rol() IN ('admin', 'owner') AND created_by = auth.uid());

-- El bloqueo de la fila se hace dentro del trigger, con privilegios del rol
-- confiable de migración. Owner no recibe UPDATE sobre membresías existentes.
CREATE OR REPLACE FUNCTION public.validar_pago_membresia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_membresia public.membresias%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' OR TG_WHEN <> 'BEFORE'
     OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'pagos' THEN
    RAISE EXCEPTION 'El historial de pagos no permite esta operación.';
  END IF;
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para registrar pagos.' USING ERRCODE = '42501';
  END IF;
  IF NEW.monto IS NULL OR NEW.monto <= 0 OR NEW.monto::text IN ('NaN', 'Infinity', '-Infinity')
     OR NEW.monto <> round(NEW.monto, 2) THEN
    RAISE EXCEPTION 'El monto debe ser positivo y tener máximo dos decimales.' USING ERRCODE = '22023';
  END IF;
  IF NEW.metodo_pago IS NULL OR NEW.fecha_pago IS NULL OR NOT isfinite(NEW.fecha_pago) THEN
    RAISE EXCEPTION 'Debe indicar método y fecha válidos.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_membresia FROM public.membresias WHERE id = NEW.membresia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La membresía no existe.'; END IF;
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

CREATE OR REPLACE FUNCTION public.sincronizar_pago_membresia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR TG_WHEN <> 'AFTER'
     OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'pagos' THEN
    RAISE EXCEPTION 'Contexto de sincronización de pagos no permitido.';
  END IF;
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner')
     OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No tiene permiso para sincronizar este pago.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.membresias
    SET abono = (SELECT COALESCE(sum(monto), 0) FROM public.pagos WHERE membresia_id = NEW.membresia_id)
    WHERE id = NEW.membresia_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No fue posible actualizar la membresía; se revierte el pago.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_pago(
  p_membresia_id uuid, p_monto numeric, p_metodo_pago public.metodo_pago_enum,
  p_fecha_pago timestamptz DEFAULT now()
)
RETURNS public.pagos LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE v_membresia public.membresias%ROWTYPE; v_pago public.pagos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para registrar pagos.' USING ERRCODE = '42501';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 OR p_monto::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_monto <> round(p_monto, 2) OR p_monto > 99999999.99 THEN
    RAISE EXCEPTION 'El monto debe ser positivo, finito y tener máximo dos decimales.' USING ERRCODE = '22023';
  END IF;
  IF p_metodo_pago IS NULL OR p_fecha_pago IS NULL OR NOT isfinite(p_fecha_pago) THEN
    RAISE EXCEPTION 'Debe indicar método y fecha válidos.' USING ERRCODE = '22023';
  END IF;
  -- Lectura sin FOR UPDATE: el trigger interno bloquea y valida de nuevo al
  -- insertar. Así owner no necesita permiso para UPDATE directo.
  SELECT * INTO v_membresia FROM public.membresias WHERE id = p_membresia_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La membresía no existe o no está disponible.'; END IF;
  IF v_membresia.estado_pago = 'CANCELADA' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una membresía cancelada.';
  END IF;
  INSERT INTO public.pagos (membresia_id, monto, fecha_pago, metodo_pago, created_by)
  VALUES (p_membresia_id, p_monto, p_fecha_pago, p_metodo_pago, auth.uid()) RETURNING * INTO v_pago;
  RETURN v_pago;
END;
$$;

CREATE FUNCTION public.crear_membresia(
  p_cliente_id uuid, p_plan_id uuid, p_fecha_inicio date,
  p_abono_inicial numeric DEFAULT 0,
  p_metodo_pago public.metodo_pago_enum DEFAULT NULL,
  p_fecha_pago timestamptz DEFAULT now(),
  p_observaciones text DEFAULT NULL
)
RETURNS public.membresias LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE v_plan public.planes%ROWTYPE; v_membresia public.membresias%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para crear membresías.' USING ERRCODE = '42501';
  END IF;
  IF p_fecha_inicio IS NULL OR NOT isfinite(p_fecha_inicio) THEN
    RAISE EXCEPTION 'Indique una fecha de inicio válida.' USING ERRCODE = '22023';
  END IF;
  IF p_abono_inicial IS NULL OR p_abono_inicial < 0
     OR p_abono_inicial::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_abono_inicial <> round(p_abono_inicial, 2) THEN
    RAISE EXCEPTION 'El abono inicial debe ser un valor válido no negativo.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_plan FROM public.planes WHERE id = p_plan_id AND activo
    AND upper(btrim(nombre)) IN ('DIARIO', 'SEMANAL', 'QUINCENAL', 'MENSUAL');
  IF NOT FOUND THEN RAISE EXCEPTION 'El plan no existe o no está disponible.'; END IF;
  IF p_abono_inicial > v_plan.precio THEN
    RAISE EXCEPTION 'El abono inicial supera el valor del plan.' USING ERRCODE = '22023';
  END IF;
  IF p_abono_inicial > 0 AND (p_metodo_pago IS NULL OR p_fecha_pago IS NULL OR NOT isfinite(p_fecha_pago)) THEN
    RAISE EXCEPTION 'Indique método y fecha para el abono inicial.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'El cliente no existe o no está disponible.';
  END IF;
  INSERT INTO public.membresias
    (cliente_id, plan_id, fecha_inicio, fecha_vencimiento, dias_duracion,
     valor, estado_pago, observaciones, created_by)
  VALUES (p_cliente_id, p_plan_id, p_fecha_inicio,
          p_fecha_inicio + v_plan.duracion_dias - 1, v_plan.duracion_dias,
          v_plan.precio, 'PENDIENTE', p_observaciones, auth.uid())
  RETURNING * INTO v_membresia;
  IF p_abono_inicial > 0 THEN
    PERFORM public.registrar_pago(v_membresia.id, p_abono_inicial, p_metodo_pago, p_fecha_pago);
    SELECT * INTO v_membresia FROM public.membresias WHERE id = v_membresia.id;
  END IF;
  RETURN v_membresia;
END;
$$;

-- Proyección aislada para staff: ni la tabla ni la vista financiera reciben
-- política SELECT para staff. La duplicación se justifica por ese aislamiento.
CREATE TABLE public.membresias_verificacion (
  membresia_id uuid PRIMARY KEY REFERENCES public.membresias(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  plan_id uuid NOT NULL REFERENCES public.planes(id),
  plan_nombre text NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  cancelada boolean NOT NULL
);
CREATE INDEX membresias_verificacion_cliente_idx ON public.membresias_verificacion(cliente_id);

INSERT INTO public.membresias_verificacion
  (membresia_id, cliente_id, plan_id, plan_nombre, fecha_inicio, fecha_fin, cancelada)
SELECT m.id, m.cliente_id, m.plan_id, p.nombre, m.fecha_inicio,
       m.fecha_vencimiento, m.estado_pago = 'CANCELADA'
FROM public.membresias m JOIN public.planes p ON p.id = m.plan_id;

CREATE FUNCTION public.sincronizar_membresia_verificacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'membresias'
     OR TG_WHEN <> 'AFTER' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Contexto de verificación no permitido.';
  END IF;
  INSERT INTO public.membresias_verificacion
    (membresia_id, cliente_id, plan_id, plan_nombre, fecha_inicio, fecha_fin, cancelada)
  VALUES (NEW.id, NEW.cliente_id, NEW.plan_id,
          (SELECT nombre FROM public.planes WHERE id = NEW.plan_id), NEW.fecha_inicio,
          NEW.fecha_vencimiento, NEW.estado_pago = 'CANCELADA')
  ON CONFLICT (membresia_id) DO UPDATE SET
    cliente_id = EXCLUDED.cliente_id, plan_id = EXCLUDED.plan_id,
    plan_nombre = EXCLUDED.plan_nombre,
    fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin,
    cancelada = EXCLUDED.cancelada;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membresias_actualizar_verificacion
AFTER INSERT OR UPDATE OF cliente_id, plan_id, fecha_inicio, fecha_vencimiento, estado_pago
ON public.membresias FOR EACH ROW EXECUTE FUNCTION public.sincronizar_membresia_verificacion();

CREATE FUNCTION public.sincronizar_nombre_plan_verificacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'planes'
     OR TG_WHEN <> 'AFTER' OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Contexto de sincronización de plan no permitido.';
  END IF;
  UPDATE public.membresias_verificacion SET plan_nombre = NEW.nombre WHERE plan_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER planes_actualizar_nombre_verificacion
AFTER UPDATE OF nombre ON public.planes FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_nombre_plan_verificacion();

ALTER TABLE public.membresias_verificacion ENABLE ROW LEVEL SECURITY;
CREATE POLICY membresias_verificacion_lectura ON public.membresias_verificacion
FOR SELECT TO authenticated USING (public.mi_rol() IN ('admin', 'owner', 'staff'));
REVOKE ALL ON public.membresias_verificacion FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.membresias_verificacion TO authenticated;

CREATE VIEW public.v_membresias_verificacion WITH (security_invoker = true) AS
SELECT v.cliente_id, v.plan_nombre AS plan, v.fecha_fin,
  CASE WHEN reloj.hoy < v.fecha_inicio THEN NULL::text
       WHEN reloj.hoy > v.fecha_fin THEN 'VENCIDA'
       WHEN reloj.hoy = v.fecha_fin THEN 'VENCE_HOY'
       WHEN v.fecha_fin - reloj.hoy <= 3 THEN 'POR_VENCER'
       ELSE 'VIGENTE' END AS estado_vigencia
FROM public.membresias_verificacion v
CROSS JOIN (SELECT (now() AT TIME ZONE 'America/Guayaquil')::date AS hoy) reloj
WHERE NOT v.cancelada;
REVOKE ALL ON public.v_membresias_verificacion FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_membresias_verificacion TO authenticated;

REVOKE ALL ON FUNCTION public.crear_membresia(uuid,uuid,date,numeric,public.metodo_pago_enum,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_membresia(uuid,uuid,date,numeric,public.metodo_pago_enum,timestamptz,text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.sincronizar_membresia_verificacion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sincronizar_nombre_plan_verificacion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_pago_membresia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sincronizar_pago_membresia() FROM PUBLIC, anon, authenticated;

COMMIT;

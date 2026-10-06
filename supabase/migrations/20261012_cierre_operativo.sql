-- Cierre operativo V1: gastos anulables, inventario interno e incidencias.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE public.gastos IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.gastos
  ALTER COLUMN tipo_gasto TYPE text USING tipo_gasto::text,
  ADD COLUMN proveedor text,
  ADD COLUMN observacion text,
  ADD COLUMN estado text NOT NULL DEFAULT 'ACTIVO',
  ADD COLUMN updated_by uuid REFERENCES public.usuarios(id),
  ADD COLUMN anulado_por uuid REFERENCES public.usuarios(id),
  ADD COLUMN anulado_at timestamptz;

ALTER TABLE public.gastos
  ADD CONSTRAINT gastos_tipo_gasto_valido CHECK (tipo_gasto IN (
    'Arriendo', 'Servicios basicos', 'Nomina', 'Mantenimiento', 'Equipamiento',
    'Limpieza', 'Marketing', 'Software', 'Compras', 'Otros',
    'Alquiler', 'Servicios Básicos', 'Internet', 'Pago del personal',
    'Campaña Publicitaria', 'Impresos', 'Mercadería', 'Compra de maquinaria', 'Otro'
  )),
  ADD CONSTRAINT gastos_descripcion_valida CHECK (length(btrim(descripcion)) BETWEEN 1 AND 500),
  ADD CONSTRAINT gastos_monto_valido CHECK (
    monto > 0 AND monto <> 'NaN'::numeric AND monto = round(monto, 2) AND monto <= 99999999.99
  ),
  ADD CONSTRAINT gastos_proveedor_valido CHECK (proveedor IS NULL OR length(btrim(proveedor)) BETWEEN 1 AND 160),
  ADD CONSTRAINT gastos_observacion_valida CHECK (observacion IS NULL OR length(btrim(observacion)) BETWEEN 1 AND 2000),
  ADD CONSTRAINT gastos_estado_valido CHECK (estado IN ('ACTIVO', 'ANULADO')),
  ADD CONSTRAINT gastos_anulacion_coherente CHECK (
    (estado = 'ACTIVO' AND anulado_por IS NULL AND anulado_at IS NULL)
    OR (estado = 'ANULADO' AND anulado_por IS NOT NULL AND anulado_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.preparar_gasto_operativo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'gastos'
     OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Contexto de gastos no permitido.';
  END IF;
  NEW.descripcion := btrim(regexp_replace(NEW.descripcion, '[[:space:]]+', ' ', 'g'));
  NEW.tipo_gasto := btrim(regexp_replace(NEW.tipo_gasto, '[[:space:]]+', ' ', 'g'));
  NEW.proveedor := nullif(btrim(regexp_replace(NEW.proveedor, '[[:space:]]+', ' ', 'g')), '');
  NEW.observacion := nullif(btrim(NEW.observacion), '');
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.estado := 'ACTIVO';
    NEW.anulado_por := NULL;
    NEW.anulado_at := NULL;
  ELSE
    IF OLD.estado = 'ANULADO' THEN
      RAISE EXCEPTION 'Un gasto anulado es inmutable.' USING ERRCODE = '23514';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    IF NEW.estado = 'ANULADO' THEN
      NEW.anulado_por := auth.uid();
      NEW.anulado_at := now();
    ELSE
      NEW.anulado_por := NULL;
      NEW.anulado_at := NULL;
    END IF;
  END IF;
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gastos_preparar_operativo ON public.gastos;
CREATE TRIGGER gastos_preparar_operativo
BEFORE INSERT OR UPDATE ON public.gastos
FOR EACH ROW EXECUTE FUNCTION public.preparar_gasto_operativo();
REVOKE ALL ON FUNCTION public.preparar_gasto_operativo() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS gastos_lectura ON public.gastos;
DROP POLICY IF EXISTS gastos_admin ON public.gastos;
CREATE POLICY gastos_consulta ON public.gastos FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));
CREATE POLICY gastos_creacion ON public.gastos FOR INSERT TO authenticated
WITH CHECK (public.mi_rol() IN ('admin', 'owner') AND created_by = auth.uid() AND updated_by = auth.uid());
CREATE POLICY gastos_edicion ON public.gastos FOR UPDATE TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'))
WITH CHECK (public.mi_rol() IN ('admin', 'owner') AND updated_by = auth.uid());

REVOKE ALL ON TABLE public.gastos FROM PUBLIC, anon, authenticated;
REVOKE DELETE ON TABLE public.gastos FROM authenticated;
GRANT SELECT ON TABLE public.gastos TO authenticated;
GRANT INSERT (tipo_gasto, descripcion, monto, fecha_gasto, metodo_pago, proveedor, observacion, created_by),
      UPDATE (tipo_gasto, descripcion, monto, fecha_gasto, metodo_pago, proveedor, observacion, estado, anulado_por, anulado_at)
ON TABLE public.gastos TO authenticated;
CREATE INDEX IF NOT EXISTS idx_gastos_estado_fecha ON public.gastos (estado, fecha_gasto DESC);

CREATE TABLE public.inventario_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  categoria text NOT NULL,
  cantidad integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'BUENO',
  fecha_compra date,
  costo numeric(10,2),
  ubicacion text,
  observacion text,
  created_by uuid NOT NULL REFERENCES public.usuarios(id),
  updated_by uuid NOT NULL REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventario_nombre_valido CHECK (length(btrim(nombre)) BETWEEN 1 AND 255),
  CONSTRAINT inventario_categoria_valida CHECK (length(btrim(categoria)) BETWEEN 1 AND 100),
  CONSTRAINT inventario_cantidad_valida CHECK (cantidad >= 0),
  CONSTRAINT inventario_estado_valido CHECK (estado IN ('BUENO', 'MANTENIMIENTO', 'DANADO', 'BAJA')),
  CONSTRAINT inventario_costo_valido CHECK (costo IS NULL OR (
    costo >= 0 AND costo <> 'NaN'::numeric AND costo = round(costo, 2) AND costo <= 99999999.99
  )),
  CONSTRAINT inventario_ubicacion_valida CHECK (ubicacion IS NULL OR length(btrim(ubicacion)) BETWEEN 1 AND 160),
  CONSTRAINT inventario_observacion_valida CHECK (observacion IS NULL OR length(btrim(observacion)) BETWEEN 1 AND 2000)
);

CREATE TABLE public.inventario_incidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_item_id uuid NOT NULL REFERENCES public.inventario_items(id),
  tipo text NOT NULL CHECK (tipo IN ('DANIO', 'MANTENIMIENTO', 'BAJA')),
  observacion text NOT NULL CHECK (length(btrim(observacion)) BETWEEN 1 AND 2000),
  reportado_por uuid NOT NULL REFERENCES public.usuarios(id),
  fecha timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'RESUELTO')),
  resuelto_por uuid REFERENCES public.usuarios(id),
  resuelto_at timestamptz,
  CONSTRAINT inventario_incidencia_resolucion CHECK (
    (estado = 'PENDIENTE' AND resuelto_por IS NULL AND resuelto_at IS NULL)
    OR (estado = 'RESUELTO' AND resuelto_por IS NOT NULL AND resuelto_at IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION public.preparar_inventario_item()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'inventario_items'
     OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Contexto de inventario no permitido.';
  END IF;
  NEW.nombre := btrim(regexp_replace(NEW.nombre, '[[:space:]]+', ' ', 'g'));
  NEW.categoria := btrim(regexp_replace(NEW.categoria, '[[:space:]]+', ' ', 'g'));
  NEW.ubicacion := nullif(btrim(regexp_replace(NEW.ubicacion, '[[:space:]]+', ' ', 'g')), '');
  NEW.observacion := nullif(btrim(NEW.observacion), '');
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := coalesce(NEW.created_at, now());
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventario_items_preparar
BEFORE INSERT OR UPDATE ON public.inventario_items
FOR EACH ROW EXECUTE FUNCTION public.preparar_inventario_item();
REVOKE ALL ON FUNCTION public.preparar_inventario_item() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preparar_inventario_incidencia()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'inventario_incidencias'
     OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Contexto de incidencias no permitido.';
  END IF;
  NEW.observacion := btrim(NEW.observacion);
  IF TG_OP = 'INSERT' THEN
    NEW.reportado_por := auth.uid();
    NEW.fecha := now();
    NEW.estado := 'PENDIENTE';
    NEW.resuelto_por := NULL;
    NEW.resuelto_at := NULL;
  ELSE
    NEW.reportado_por := OLD.reportado_por;
    NEW.fecha := OLD.fecha;
    NEW.inventario_item_id := OLD.inventario_item_id;
    NEW.tipo := OLD.tipo;
    NEW.observacion := OLD.observacion;
    IF OLD.estado = 'RESUELTO' THEN
      RAISE EXCEPTION 'Una incidencia resuelta es inmutable.' USING ERRCODE = '23514';
    END IF;
    IF NEW.estado = 'RESUELTO' THEN
      NEW.resuelto_por := auth.uid();
      NEW.resuelto_at := now();
    ELSE
      NEW.resuelto_por := NULL;
      NEW.resuelto_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventario_incidencias_preparar
BEFORE INSERT OR UPDATE ON public.inventario_incidencias
FOR EACH ROW EXECUTE FUNCTION public.preparar_inventario_incidencia();
REVOKE ALL ON FUNCTION public.preparar_inventario_incidencia() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_inventario_items AFTER INSERT OR UPDATE OR DELETE ON public.inventario_items
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();
CREATE TRIGGER audit_inventario_incidencias AFTER INSERT OR UPDATE OR DELETE ON public.inventario_incidencias
FOR EACH ROW EXECUTE FUNCTION public.registrar_auditoria();

CREATE INDEX inventario_items_nombre_idx ON public.inventario_items (nombre);
CREATE INDEX inventario_items_categoria_idx ON public.inventario_items (categoria);
CREATE INDEX inventario_items_estado_idx ON public.inventario_items (estado);
CREATE INDEX inventario_incidencias_item_estado_idx ON public.inventario_incidencias (inventario_item_id, estado);
CREATE INDEX inventario_incidencias_reportante_idx ON public.inventario_incidencias (reportado_por, fecha DESC);

ALTER TABLE public.inventario_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_incidencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventario_items_gestion_lectura ON public.inventario_items FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'));
CREATE POLICY inventario_items_creacion ON public.inventario_items FOR INSERT TO authenticated
WITH CHECK (public.mi_rol() IN ('admin', 'owner') AND created_by = auth.uid() AND updated_by = auth.uid());
CREATE POLICY inventario_items_edicion ON public.inventario_items FOR UPDATE TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'))
WITH CHECK (public.mi_rol() IN ('admin', 'owner') AND updated_by = auth.uid());

CREATE POLICY inventario_incidencias_lectura ON public.inventario_incidencias FOR SELECT TO authenticated
USING (public.mi_rol() IN ('admin', 'owner') OR (public.mi_rol() = 'staff' AND reportado_por = auth.uid()));
CREATE POLICY inventario_incidencias_creacion ON public.inventario_incidencias FOR INSERT TO authenticated
WITH CHECK (
  public.mi_rol() IN ('admin', 'owner', 'staff') AND reportado_por = auth.uid()
  AND estado = 'PENDIENTE' AND resuelto_por IS NULL AND resuelto_at IS NULL
);
CREATE POLICY inventario_incidencias_resolucion ON public.inventario_incidencias FOR UPDATE TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'))
WITH CHECK (public.mi_rol() IN ('admin', 'owner'));

REVOKE ALL ON TABLE public.inventario_items, public.inventario_incidencias FROM PUBLIC, anon, authenticated;
REVOKE DELETE ON TABLE public.inventario_items, public.inventario_incidencias FROM authenticated;
GRANT SELECT (id) ON TABLE public.inventario_items TO authenticated;
GRANT INSERT (nombre, categoria, cantidad, estado, fecha_compra, costo, ubicacion, observacion, created_by),
      UPDATE (nombre, categoria, cantidad, estado, fecha_compra, costo, ubicacion, observacion)
ON TABLE public.inventario_items TO authenticated;
GRANT SELECT ON TABLE public.inventario_incidencias TO authenticated;
GRANT INSERT (inventario_item_id, tipo, observacion, reportado_por),
      UPDATE (estado, resuelto_por, resuelto_at)
ON TABLE public.inventario_incidencias TO authenticated;

CREATE VIEW public.v_inventario_operativo WITH (security_barrier = true) AS
SELECT i.id, i.nombre, i.categoria, i.cantidad, i.estado, i.ubicacion, i.observacion, i.updated_at
FROM public.inventario_items i
WHERE public.mi_rol() IN ('admin', 'owner', 'staff');

CREATE VIEW public.v_inventario_gestion WITH (security_barrier = true) AS
SELECT i.id, i.nombre, i.categoria, i.cantidad, i.estado, i.fecha_compra, i.costo,
       i.ubicacion, i.observacion, i.created_by, i.updated_by, i.created_at, i.updated_at
FROM public.inventario_items i
WHERE public.mi_rol() IN ('admin', 'owner');

REVOKE ALL ON TABLE public.v_inventario_operativo, public.v_inventario_gestion FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.v_inventario_operativo, public.v_inventario_gestion TO authenticated;

CREATE OR REPLACE FUNCTION public.resolver_incidencia_inventario(
  p_incidencia_id uuid,
  p_estado_item text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_item_id uuid;
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'No tiene permiso para resolver incidencias.' USING ERRCODE = '42501';
  END IF;
  IF p_estado_item IS NOT NULL AND p_estado_item NOT IN ('BUENO', 'MANTENIMIENTO', 'DANADO', 'BAJA') THEN
    RAISE EXCEPTION 'Estado de inventario no valido.' USING ERRCODE = '22023';
  END IF;
  SELECT inventario_item_id INTO v_item_id
  FROM public.inventario_incidencias
  WHERE id = p_incidencia_id AND estado = 'PENDIENTE'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La incidencia no existe o ya fue resuelta.' USING ERRCODE = 'P0002';
  END IF;
  IF p_estado_item IS NOT NULL THEN
    UPDATE public.inventario_items SET estado = p_estado_item WHERE id = v_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El item de inventario no existe.'; END IF;
  END IF;
  UPDATE public.inventario_incidencias
  SET estado = 'RESUELTO', resuelto_por = auth.uid(), resuelto_at = now()
  WHERE id = p_incidencia_id;
  RETURN p_incidencia_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolver_incidencia_inventario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_incidencia_inventario(uuid, text) TO authenticated;

COMMENT ON TABLE public.inventario_items IS 'Inventario interno de equipos y activos del box; separado del catalogo comercial.';
COMMENT ON COLUMN public.inventario_items.costo IS 'Dato financiero visible solo mediante la vista de gestion para admin y owner.';
COMMENT ON TABLE public.inventario_incidencias IS 'Reportes operativos de dano, mantenimiento o baja sugerida.';

COMMIT;

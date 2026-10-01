-- Productos V1. Evoluciona la tabla existente sin reemplazar IDs ni romper
-- las referencias de ventas. Preparada para revision y dry-run con ROLLBACK.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.productos') IS NULL THEN
    RAISE EXCEPTION 'No existe public.productos; revisar el esquema antes de continuar.';
  END IF;
  IF to_regprocedure('public.mi_rol()') IS NULL THEN
    RAISE EXCEPTION 'No existe public.mi_rol(); revisar las migraciones previas.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.productos'::regclass
      AND attname = 'valor_unitario' AND NOT attisdropped
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.productos'::regclass
      AND attname = 'precio' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'La estructura de precio de public.productos no corresponde al esquema esperado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'productos'
      AND policyname NOT IN ('productos_lectura', 'productos_admin')
  ) THEN
    RAISE EXCEPTION 'Hay politicas adicionales en public.productos; revisar antes de reemplazar permisos.';
  END IF;
END;
$$;

LOCK TABLE public.productos IN SHARE ROW EXCLUSIVE MODE;

-- Un nombre compuesto solo por espacios no se puede normalizar sin inventar
-- informacion. El dry-run debe detenerse antes de modificar esas filas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.productos
    WHERE nombre IS NULL
       OR btrim(regexp_replace(nombre, '[[:space:]]+', ' ', 'g')) = ''
  ) THEN
    RAISE EXCEPTION 'Existen productos con nombre vacio o no normalizable.';
  END IF;
END;
$$;

ALTER TABLE public.productos
  RENAME COLUMN valor_unitario TO precio;

ALTER TABLE public.productos
  ADD COLUMN categoria text,
  ADD COLUMN imagen_path text,
  ADD COLUMN created_by uuid REFERENCES public.usuarios(id),
  ADD COLUMN updated_by uuid REFERENCES public.usuarios(id);

ALTER TABLE public.productos
  ALTER COLUMN nombre TYPE text,
  ALTER COLUMN precio TYPE numeric(10,2),
  ALTER COLUMN stock TYPE integer,
  ALTER COLUMN stock SET DEFAULT 0,
  ALTER COLUMN activo SET DEFAULT true,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE public.productos
SET nombre = btrim(regexp_replace(nombre, '[[:space:]]+', ' ', 'g'))
WHERE nombre IS DISTINCT FROM btrim(regexp_replace(nombre, '[[:space:]]+', ' ', 'g'));

UPDATE public.productos
SET activo = coalesce(activo, true),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now())
WHERE activo IS NULL OR created_at IS NULL OR updated_at IS NULL;

ALTER TABLE public.productos
  ALTER COLUMN nombre SET NOT NULL,
  ALTER COLUMN precio SET NOT NULL,
  ALTER COLUMN stock SET NOT NULL,
  ALTER COLUMN activo SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS productos_valor_unitario_check,
  DROP CONSTRAINT IF EXISTS productos_stock_check,
  ADD CONSTRAINT productos_nombre_normalizado CHECK (
    nombre <> ''
    AND nombre = btrim(regexp_replace(nombre, '[[:space:]]+', ' ', 'g'))
  ),
  ADD CONSTRAINT productos_precio_positivo CHECK (
    precio > 0 AND precio <> 'NaN'::numeric
  ),
  ADD CONSTRAINT productos_stock_no_negativo CHECK (stock >= 0);

-- Una sola columna representa la unica imagen principal admitida en V1.
COMMENT ON COLUMN public.productos.imagen_path IS
  'Ruta opcional de la unica imagen principal del producto en V1.';

CREATE OR REPLACE FUNCTION public.preparar_producto_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'productos'
     OR TG_WHEN <> 'BEFORE' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Contexto de normalizacion de productos no permitido.';
  END IF;

  NEW.nombre := btrim(regexp_replace(NEW.nombre, '[[:space:]]+', ' ', 'g'));
  IF NEW.nombre IS NULL OR NEW.nombre = '' THEN
    RAISE EXCEPTION 'El nombre del producto es obligatorio.' USING ERRCODE = '23514';
  END IF;

  NEW.categoria := nullif(btrim(regexp_replace(NEW.categoria, '[[:space:]]+', ' ', 'g')), '');
  NEW.imagen_path := nullif(btrim(NEW.imagen_path), '');

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

DROP TRIGGER IF EXISTS productos_updated_at ON public.productos;
DROP TRIGGER IF EXISTS productos_preparar_v1 ON public.productos;
CREATE TRIGGER productos_preparar_v1
BEFORE INSERT OR UPDATE ON public.productos
FOR EACH ROW EXECUTE FUNCTION public.preparar_producto_v1();

REVOKE ALL ON FUNCTION public.preparar_producto_v1()
  FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_productos_nombre ON public.productos (nombre);
CREATE INDEX IF NOT EXISTS idx_productos_categoria ON public.productos (categoria);

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS productos_lectura ON public.productos;
DROP POLICY IF EXISTS productos_admin ON public.productos;

CREATE POLICY productos_consulta
ON public.productos FOR SELECT TO authenticated
USING (
  public.mi_rol() IN ('admin', 'owner')
  OR (public.mi_rol() = 'staff' AND activo = true)
);

CREATE POLICY productos_creacion
ON public.productos FOR INSERT TO authenticated
WITH CHECK (
  public.mi_rol() IN ('admin', 'owner')
  AND created_by = auth.uid()
  AND updated_by = auth.uid()
);

CREATE POLICY productos_edicion
ON public.productos FOR UPDATE TO authenticated
USING (public.mi_rol() IN ('admin', 'owner'))
WITH CHECK (
  public.mi_rol() IN ('admin', 'owner')
  AND updated_by = auth.uid()
);

-- Limpiar privilegios de tabla y de columna antes de conceder solo lo minimo.
REVOKE ALL ON TABLE public.productos FROM PUBLIC, anon, authenticated;
DO $$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
  INTO v_columns
  FROM pg_attribute
  WHERE attrelid = 'public.productos'::regclass
    AND attnum > 0 AND NOT attisdropped;

  EXECUTE format(
    'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON public.productos FROM PUBLIC, anon, authenticated',
    v_columns
  );
END;
$$;

GRANT SELECT ON TABLE public.productos TO authenticated;
GRANT INSERT (nombre, categoria, descripcion, precio, stock, activo, imagen_path),
      UPDATE (nombre, categoria, descripcion, precio, stock, activo, imagen_path)
ON TABLE public.productos TO authenticated;

-- No existe politica DELETE ni privilegio DELETE para usuarios normales.
COMMIT;

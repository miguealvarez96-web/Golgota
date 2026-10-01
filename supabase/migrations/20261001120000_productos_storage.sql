-- Storage privado para la unica imagen principal de Productos V1.
-- Debe aplicarse despues de 20261001_productos_v1.sql.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage no esta disponible en esta base.';
  END IF;
  IF to_regclass('public.productos') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.productos'::regclass
      AND attname = 'imagen_path' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Debe aplicarse primero la migracion Productos V1.';
  END IF;
  IF to_regprocedure('public.mi_rol()') IS NULL THEN
    RAISE EXCEPTION 'No existe public.mi_rol(); revisar las migraciones previas.';
  END IF;
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'productos',
  'productos',
  false,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS productos_imagenes_consulta ON storage.objects;
DROP POLICY IF EXISTS productos_imagenes_creacion ON storage.objects;
DROP POLICY IF EXISTS productos_imagenes_edicion ON storage.objects;
DROP POLICY IF EXISTS productos_imagenes_eliminacion ON storage.objects;

-- El bucket es privado. Staff solo puede firmar/consultar la imagen asociada a
-- un producto activo que tambien sea visible por la RLS de public.productos.
CREATE POLICY productos_imagenes_consulta
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'productos'
  AND (
    public.mi_rol() IN ('admin', 'owner')
    OR (
      public.mi_rol() = 'staff'
      AND EXISTS (
        SELECT 1
        FROM public.productos AS p
        WHERE p.imagen_path = storage.objects.name
          AND p.activo = true
      )
    )
  )
);

CREATE POLICY productos_imagenes_creacion
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'productos'
  AND public.mi_rol() IN ('admin', 'owner')
  AND split_part(name, '/', 1) = auth.uid()::text
  AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
);

CREATE POLICY productos_imagenes_edicion
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'productos'
  AND public.mi_rol() IN ('admin', 'owner')
)
WITH CHECK (
  bucket_id = 'productos'
  AND public.mi_rol() IN ('admin', 'owner')
  AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
);

CREATE POLICY productos_imagenes_eliminacion
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'productos'
  AND public.mi_rol() IN ('admin', 'owner')
);

COMMIT;

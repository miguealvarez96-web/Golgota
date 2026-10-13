BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.eliminar_cliente_seguro(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_cliente record;
  v_fk record;
  v_tiene_historial boolean := false;
  v_existe boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.usuarios u
    WHERE u.id = auth.uid()
      AND u.activo
      AND u.rol IN ('admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'No tiene permiso para eliminar clientes.' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.nombre_completo, c.auth_user_id
  INTO v_cliente
  FROM public.clientes c
  WHERE c.id = p_cliente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente no existe.' USING ERRCODE = 'P0002';
  END IF;

  -- Se revisan todas las FK actuales que apunten a clientes.id. Esto mantiene
  -- la protección aunque en el futuro se agregue otra relación histórica.
  FOR v_fk IN
    SELECT child_ns.nspname AS schema_name,
           child.relname AS table_name,
           child_col.attname AS column_name
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY child_key(attnum, ord) ON true
    JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY parent_key(attnum, ord)
      ON parent_key.ord = child_key.ord
    JOIN pg_attribute child_col
      ON child_col.attrelid = fk.conrelid AND child_col.attnum = child_key.attnum
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = fk.confrelid AND parent_col.attnum = parent_key.attnum
    WHERE fk.contype = 'f'
      AND fk.confrelid = 'public.clientes'::regclass
      AND parent_col.attname = 'id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.column_name
    ) INTO v_existe USING p_cliente_id;
    IF v_existe THEN
      v_tiene_historial := true;
      EXIT;
    END IF;
  END LOOP;

  -- Una cuenta enlazada puede tener privacidad, WOD, récords, progreso,
  -- desafíos u otras relaciones por usuario, por lo que nunca se elimina.
  IF v_cliente.auth_user_id IS NOT NULL THEN
    v_tiene_historial := true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auditoria_logs a
    WHERE (a.tabla = 'clientes' AND a.registro_id = p_cliente_id::text)
       OR a.datos_anteriores @> jsonb_build_object('cliente_id', p_cliente_id::text)
       OR a.datos_nuevos @> jsonb_build_object('cliente_id', p_cliente_id::text)
  ) THEN
    v_tiene_historial := true;
  END IF;

  IF v_tiene_historial THEN
    UPDATE public.clientes
    SET estado_cliente = 'Inactivo'
    WHERE id = p_cliente_id;

    IF v_cliente.auth_user_id IS NOT NULL THEN
      UPDATE public.usuarios
      SET activo = false
      WHERE id = v_cliente.auth_user_id;
    END IF;

    INSERT INTO public.auditoria_logs (
      usuario_id, tabla, accion, registro_id, datos_nuevos
    ) VALUES (
      auth.uid(),
      'clientes',
      'BAJA_LOGICA',
      p_cliente_id::text,
      jsonb_build_object(
        'modo', 'LOGICA',
        'estado_cliente', 'Inactivo',
        'usuario_deshabilitado', v_cliente.auth_user_id IS NOT NULL
      )
    );

    RETURN jsonb_build_object('modo', 'LOGICA', 'cliente_id', p_cliente_id);
  END IF;

  -- Este camino solo se alcanza sin cuenta, FK, historial ni auditoría previa.
  INSERT INTO public.auditoria_logs (
    usuario_id, tabla, accion, registro_id, datos_nuevos
  ) VALUES (
    auth.uid(),
    'clientes',
    'BORRADO_FISICO',
    p_cliente_id::text,
    jsonb_build_object('modo', 'FISICA')
  );

  DELETE FROM public.clientes WHERE id = p_cliente_id;

  RETURN jsonb_build_object('modo', 'FISICA', 'cliente_id', p_cliente_id);
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_cliente_seguro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_cliente_seguro(uuid) TO authenticated;

COMMIT;

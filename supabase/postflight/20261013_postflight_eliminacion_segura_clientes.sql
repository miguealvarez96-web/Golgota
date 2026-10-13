BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.eliminar_cliente_seguro(uuid)') IS NULL THEN
    RAISE EXCEPTION 'No existe eliminar_cliente_seguro(uuid).';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.eliminar_cliente_seguro(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.eliminar_cliente_seguro(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Los permisos de la RPC de eliminación no son los esperados.';
  END IF;

  IF has_table_privilege('authenticated', 'public.clientes', 'DELETE') THEN
    RAISE EXCEPTION 'La RPC no debe habilitar DELETE directo sobre clientes.';
  END IF;

  SELECT pg_get_functiondef('public.eliminar_cliente_seguro(uuid)'::regprocedure)
  INTO v_definition;

  IF position('u.rol IN (''admin'', ''owner'')' in v_definition) = 0
     OR position('SET estado_cliente = ''Inactivo''' in v_definition) = 0
     OR position('SET activo = false' in v_definition) = 0
     OR position('''BAJA_LOGICA''' in v_definition) = 0
     OR position('''BORRADO_FISICO''' in v_definition) = 0
     OR position('FROM pg_constraint' in v_definition) = 0
     OR position('v_cliente.auth_user_id IS NOT NULL' in v_definition) = 0 THEN
    RAISE EXCEPTION 'La RPC no contiene todas las barreras de seguridad requeridas.';
  END IF;
END;
$$;

ROLLBACK;

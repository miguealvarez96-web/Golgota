BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE v_signature text; v_table text; v_role text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.eliminar_cliente_seguro(uuid)', 'public.restaurar_cliente(uuid)',
    'public.gestionar_membresia_segura(uuid,text)', 'public.gestionar_producto_seguro(uuid,text)',
    'public.gestionar_inventario_seguro(uuid,text)', 'public.gestionar_wod_seguro(uuid,text)',
    'public.gestionar_desafio_seguro(uuid,text)', 'public.gestionar_comunicado_seguro(uuid,text)',
    'public.anular_gasto_seguro(uuid)', 'public.cancelar_reporte_pago_pendiente(uuid)',
    'public.retirar_usuario_interno(uuid)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR NOT has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR has_function_privilege('anon',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'RPC ausente o con privilegios incorrectos: %', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.wods'::regclass AND attname='archivado' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.desafios'::regclass AND attname='archivado' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.comunicados'::regclass AND attname='archivado' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Faltan estados de archivo.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='estado_reporte_pago_enum' AND e.enumlabel='CANCELADO'
  ) THEN RAISE EXCEPTION 'Falta CANCELADO en pagos reportados.'; END IF;

  FOREACH v_role IN ARRAY ARRAY['authenticated','anon'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'clientes','membresias','pagos','productos','inventario_items','inventario_incidencias',
      'gastos','reportes_pago_alumno','wods','wod_resultados','desafios','desafio_participantes',
      'comunicados','usuarios','progreso_fisico','records_personales','privacidad_aceptaciones',
      'privacidad_solicitudes','auditoria_logs'
    ] LOOP
      IF has_table_privilege(v_role,'public.' || v_table,'DELETE') THEN
        RAISE EXCEPTION 'DELETE directo persiste para % en public.%', v_role, v_table;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

ROLLBACK;

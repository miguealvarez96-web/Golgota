BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE v_table text; v_role text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'clientes','membresias','pagos','productos','inventario_items','inventario_incidencias',
    'gastos','reportes_pago_alumno','wods','wod_resultados','desafios',
    'desafio_participantes','comunicados','usuarios','progreso_fisico','records_personales',
    'privacidad_aceptaciones','privacidad_solicitudes','auditoria_logs'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Falta la tabla requerida public.%', v_table;
    END IF;
  END LOOP;
  IF to_regprocedure('public.registrar_auditoria()') IS NULL THEN
    RAISE EXCEPTION 'La infraestructura de auditoría no está disponible.';
  END IF;
  -- El preflight describe el estado heredado. La migracion es la responsable
  -- de corregirlo; por eso un DELETE efectivo aqui genera NOTICE, no bloqueo.
  FOREACH v_role IN ARRAY ARRAY['authenticated','anon'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'clientes','membresias','pagos','productos','inventario_items','inventario_incidencias',
      'gastos','reportes_pago_alumno','wods','wod_resultados','desafios','desafio_participantes',
      'comunicados','usuarios','progreso_fisico','records_personales','privacidad_aceptaciones',
      'privacidad_solicitudes','auditoria_logs'
    ] LOOP
      IF has_table_privilege(v_role,'public.' || v_table,'DELETE') THEN
        RAISE NOTICE 'DELETE heredado detectado para % en public.%; la migracion lo revocara.', v_role, v_table;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

ROLLBACK;

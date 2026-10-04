-- Verificación estructural y de invariantes después de BLOQUE 2.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_aprobar text;
  v_rechazar text;
  v_listar text;
  v_registrar text;
BEGIN
  IF to_regprocedure('public.aprobar_reporte_pago_alumno(uuid)') IS NULL
     OR to_regprocedure('public.rechazar_reporte_pago_alumno(uuid,text)') IS NULL
     OR to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN
    RAISE EXCEPTION 'Falta una RPC de BLOQUE 2.';
  END IF;
  IF to_regclass('public.reportes_pago_alumno_estado_fecha_idx') IS NULL THEN
    RAISE EXCEPTION 'Falta el índice de estado y fecha de reportes.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reportes_pago_alumno'::regclass
      AND conname = 'reportes_pago_alumno_rechazo_con_motivo'
      AND contype = 'c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'Falta la restricción de motivo obligatorio para rechazos.';
  END IF;
  IF has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.reportes_pago_alumno', 'DELETE')
     OR has_table_privilege('authenticated', 'public.pagos', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.pagos', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated conserva permisos de modificación financiera no permitidos.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.aprobar_reporte_pago_alumno(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rechazar_reporte_pago_alumno(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.listar_reportes_pago_revision()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aprobar_reporte_pago_alumno(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rechazar_reporte_pago_alumno(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.listar_reportes_pago_revision()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Los permisos EXECUTE de BLOQUE 2 no son los esperados.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid IN (
      'public.aprobar_reporte_pago_alumno(uuid)'::regprocedure,
      'public.rechazar_reporte_pago_alumno(uuid,text)'::regprocedure,
      'public.listar_reportes_pago_revision()'::regprocedure
    )
      AND (NOT p.prosecdef
        OR NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog']))
  ) THEN
    RAISE EXCEPTION 'Una RPC de BLOQUE 2 no es SECURITY DEFINER o no fija search_path.';
  END IF;

  SELECT pg_get_functiondef('public.aprobar_reporte_pago_alumno(uuid)'::regprocedure)
    INTO v_aprobar;
  SELECT pg_get_functiondef('public.rechazar_reporte_pago_alumno(uuid,text)'::regprocedure)
    INTO v_rechazar;
  SELECT pg_get_functiondef('public.listar_reportes_pago_revision()'::regprocedure)
    INTO v_listar;
  SELECT pg_get_functiondef(
    'public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamptz)'::regprocedure
  ) INTO v_registrar;

  IF v_aprobar !~* 'from\s+public\.reportes_pago_alumno[\s\S]*for\s+update'
     OR v_aprobar !~* 'from\s+public\.membresias[\s\S]*for\s+update'
     OR v_aprobar !~* 'estado\s*<>\s*''PENDIENTE'''
     OR v_aprobar !~* 'saldo\s*<=\s*0'
     OR v_aprobar !~* 'v_reporte\.monto\s*>\s*v_membresia\.saldo'
     OR v_aprobar !~* 'public\.registrar_pago\s*\('
     OR v_aprobar !~* 'pago_real_id\s*=\s*v_pago\.id'
     OR v_aprobar !~* 'reviewed_by\s*=\s*auth\.uid\(\)'
     OR v_aprobar !~* 'mi_rol\(\)\s+NOT\s+IN\s*\(''admin'',\s*''owner''\)' THEN
    RAISE EXCEPTION 'La aprobación no conserva bloqueo, saldo, rol, pago real o trazabilidad.';
  END IF;
  IF v_rechazar !~* 'length\(v_motivo\)\s+NOT\s+BETWEEN\s+3\s+AND\s+500'
     OR v_rechazar !~* 'estado\s*=\s*''RECHAZADO'''
     OR v_rechazar !~* 'reviewed_by\s*=\s*auth\.uid\(\)'
     OR v_rechazar ~* 'registrar_pago\s*\('
     OR v_rechazar ~* 'insert\s+into\s+public\.pagos'
     OR v_rechazar ~* 'update\s+public\.membresias' THEN
    RAISE EXCEPTION 'El rechazo no conserva motivo, trazabilidad o aislamiento financiero.';
  END IF;
  IF v_listar !~* 'mi_rol\(\)\s+NOT\s+IN\s*\(''admin'',\s*''owner''\)'
     OR v_listar !~* '''usuario_id'''
     OR v_listar !~* '''reviewed_by'''
     OR v_listar !~* '''pago_real_id'''
     OR v_listar !~* '''monto_aplicado'''
     OR v_listar !~* 'join\s+public\.clientes'
     OR v_listar !~* 'left\s+join\s+public\.usuarios' THEN
    RAISE EXCEPTION 'La bandeja no conserva autorización o trazabilidad completa.';
  END IF;
  IF v_registrar !~* 'insert\s+into\s+public\.pagos' THEN
    RAISE EXCEPTION 'El flujo administrativo registrar_pago fue alterado de forma incompatible.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.membresias m
    LEFT JOIN (
      SELECT membresia_id, COALESCE(sum(monto), 0) AS abonado
      FROM public.pagos GROUP BY membresia_id
    ) p ON p.membresia_id = m.id
    WHERE m.abono IS DISTINCT FROM COALESCE(p.abonado, 0)
       OR m.saldo IS DISTINCT FROM m.valor - COALESCE(p.abonado, 0)
       OR NOT (
         m.estado_pago = 'CANCELADA'
         OR (m.saldo = 0 AND m.estado_pago = 'PAGADO')
         OR (m.saldo > 0 AND m.estado_pago = 'PENDIENTE')
       )
  ) THEN
    RAISE EXCEPTION 'BLOQUE 2 dejó membresías con agregados inconsistentes.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reportes_pago_alumno r
    LEFT JOIN public.membresias m ON m.id = r.membresia_id
    LEFT JOIN public.pagos p ON p.id = r.pago_real_id
    WHERE (r.membresia_id IS NOT NULL AND (m.id IS NULL OR m.cliente_id <> r.cliente_id))
       OR (r.estado = 'APROBADO' AND (
         p.id IS NULL OR p.membresia_id <> r.membresia_id
         OR p.monto <> r.monto OR p.created_by <> r.reviewed_by
       ))
       OR (r.estado <> 'APROBADO' AND r.pago_real_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'BLOQUE 2 dejó reportes con trazabilidad inconsistente.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno
    WHERE estado = 'RECHAZADO'
      AND (motivo_rechazo IS NULL OR length(btrim(motivo_rechazo)) < 3)
  ) THEN
    RAISE EXCEPTION 'BLOQUE 2 dejó reportes rechazados sin motivo válido.';
  END IF;
END;
$$;

SELECT p.proname, p.prosecdef, p.provolatile, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'aprobar_reporte_pago_alumno',
    'rechazar_reporte_pago_alumno',
    'listar_reportes_pago_revision',
    'registrar_pago'
  )
ORDER BY p.proname;

ROLLBACK;

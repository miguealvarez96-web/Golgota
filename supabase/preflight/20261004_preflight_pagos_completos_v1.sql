-- Solo lectura. Validar antes de aplicar BLOQUE 2.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  v_registrar text;
BEGIN
  IF to_regclass('public.reportes_pago_alumno') IS NULL
     OR to_regclass('public.pagos') IS NULL
     OR to_regclass('public.membresias') IS NULL THEN
    RAISE EXCEPTION 'Falta aplicar primero Portal Alumno V1 o las migraciones base de pagos.';
  END IF;
  IF to_regprocedure('public.aprobar_reporte_pago_alumno(uuid)') IS NULL
     OR to_regprocedure('public.rechazar_reporte_pago_alumno(uuid,text)') IS NULL
     OR to_regprocedure('public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Falta una RPC requerida para completar el flujo de pagos.';
  END IF;
  IF to_regprocedure('public.listar_reportes_pago_revision()') IS NOT NULL THEN
    RAISE EXCEPTION 'BLOQUE 2 parece aplicado; revisar el estado antes de repetirlo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.reportes_pago_alumno
    WHERE estado = 'RECHAZADO'
      AND (motivo_rechazo IS NULL OR length(btrim(motivo_rechazo)) < 3)
  ) THEN
    RAISE EXCEPTION 'Hay reportes rechazados sin motivo válido; conciliar manualmente antes de BLOQUE 2.';
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
    RAISE EXCEPTION 'Existen membresías con agregados financieros inconsistentes.';
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
    RAISE EXCEPTION 'Existen reportes con trazabilidad financiera inconsistente.';
  END IF;

  SELECT pg_get_functiondef(
    'public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamptz)'::regprocedure
  ) INTO v_registrar;
  IF v_registrar !~* 'mi_rol\(\)\s+NOT\s+IN\s*\(''admin'',\s*''owner''\)'
     OR v_registrar !~* 'insert\s+into\s+public\.pagos' THEN
    RAISE EXCEPTION 'registrar_pago no conserva el contrato admin/owner esperado.';
  END IF;
END;
$$;

SELECT estado::text, count(*)
FROM public.reportes_pago_alumno
GROUP BY estado
ORDER BY estado::text;

ROLLBACK;

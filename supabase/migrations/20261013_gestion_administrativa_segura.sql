BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.es_gestor_ciclo_vida()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = auth.uid() AND u.activo AND u.rol IN ('admin', 'owner')
  )
$$;

CREATE OR REPLACE FUNCTION public.tiene_dependencias_historicas(
  p_tabla regclass,
  p_id uuid,
  p_nombre_auditoria text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_fk record;
  v_existe boolean;
BEGIN
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
    WHERE fk.contype = 'f' AND fk.confrelid = p_tabla AND parent_col.attname = 'id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_fk.schema_name, v_fk.table_name, v_fk.column_name
    ) INTO v_existe USING p_id;
    IF v_existe THEN RETURN true; END IF;
  END LOOP;

  RETURN EXISTS (
    SELECT 1 FROM public.auditoria_logs a
    WHERE a.tabla = p_nombre_auditoria AND a.registro_id = p_id::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auditar_ciclo_vida(
  p_tabla text,
  p_id uuid,
  p_accion text,
  p_detalle jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  INSERT INTO public.auditoria_logs(usuario_id, tabla, accion, registro_id, datos_nuevos)
  VALUES (
    auth.uid(), p_tabla, p_accion, p_id::text,
    coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object(
      'actor_rol', (SELECT u.rol::text FROM public.usuarios u WHERE u.id = auth.uid()),
      'fecha_hora', now()
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.es_gestor_ciclo_vida(),
  public.tiene_dependencias_historicas(regclass,uuid,text),
  public.auditar_ciclo_vida(text,uuid,text,jsonb)
FROM PUBLIC, anon, authenticated;

-- Ningun rol de aplicacion puede borrar directamente historial operativo,
-- financiero, deportivo, legal o de auditoria. Los DELETE fisicos seguros
-- quedan exclusivamente detras de las RPC SECURITY DEFINER de este bloque.
REVOKE DELETE ON TABLE public.clientes, public.membresias, public.pagos,
  public.productos, public.inventario_items, public.inventario_incidencias,
  public.gastos, public.reportes_pago_alumno, public.wods, public.wod_resultados,
  public.desafios, public.desafio_participantes, public.comunicados, public.usuarios,
  public.progreso_fisico, public.records_personales, public.privacidad_aceptaciones,
  public.privacidad_solicitudes, public.auditoria_logs
FROM PUBLIC, anon, authenticated;

ALTER TABLE public.wods ADD COLUMN IF NOT EXISTS archivado boolean NOT NULL DEFAULT false;
ALTER TABLE public.comunicados ADD COLUMN IF NOT EXISTS archivado boolean NOT NULL DEFAULT false;
ALTER TABLE public.desafios ADD COLUMN IF NOT EXISTS archivado boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.proteger_contenido_archivado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.archivado AND NEW.archivado THEN
      RAISE EXCEPTION 'El contenido archivado debe restaurarse antes de editarse.' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_TABLE_NAME IN ('wods', 'comunicados') AND NEW.archivado THEN
    NEW.publicado := false;
  ELSIF TG_TABLE_NAME = 'desafios' AND NEW.archivado THEN
    NEW.estado := 'CERRADO';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wods_proteger_archivo ON public.wods;
CREATE TRIGGER wods_proteger_archivo BEFORE INSERT OR UPDATE ON public.wods
FOR EACH ROW EXECUTE FUNCTION public.proteger_contenido_archivado();
DROP TRIGGER IF EXISTS comunicados_proteger_archivo ON public.comunicados;
CREATE TRIGGER comunicados_proteger_archivo BEFORE INSERT OR UPDATE ON public.comunicados
FOR EACH ROW EXECUTE FUNCTION public.proteger_contenido_archivado();
DROP TRIGGER IF EXISTS desafios_proteger_archivo ON public.desafios;
CREATE TRIGGER desafios_proteger_archivo BEFORE INSERT OR UPDATE ON public.desafios
FOR EACH ROW EXECUTE FUNCTION public.proteger_contenido_archivado();
REVOKE ALL ON FUNCTION public.proteger_contenido_archivado() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bloquear_historial_archivado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE v_parent_id uuid;
BEGIN
  v_parent_id := CASE WHEN TG_OP='DELETE' THEN OLD.wod_id ELSE NEW.wod_id END;
  IF TG_TABLE_NAME='wod_resultados' AND EXISTS (SELECT 1 FROM public.wods w WHERE w.id=v_parent_id AND w.archivado) THEN
    RAISE EXCEPTION 'El WOD archivado es inmutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS wod_resultados_bloquear_archivado ON public.wod_resultados;
CREATE TRIGGER wod_resultados_bloquear_archivado BEFORE INSERT OR UPDATE OR DELETE ON public.wod_resultados
FOR EACH ROW EXECUTE FUNCTION public.bloquear_historial_archivado();

CREATE OR REPLACE FUNCTION public.bloquear_desafio_archivado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE v_parent_id uuid;
BEGIN
  v_parent_id := CASE WHEN TG_OP='DELETE' THEN OLD.desafio_id ELSE NEW.desafio_id END;
  IF EXISTS (SELECT 1 FROM public.desafios d WHERE d.id=v_parent_id AND d.archivado) THEN
    RAISE EXCEPTION 'El desafio archivado es inmutable.' USING ERRCODE='55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS desafio_participantes_bloquear_archivado ON public.desafio_participantes;
CREATE TRIGGER desafio_participantes_bloquear_archivado BEFORE INSERT OR UPDATE OR DELETE ON public.desafio_participantes
FOR EACH ROW EXECUTE FUNCTION public.bloquear_desafio_archivado();
REVOKE ALL ON FUNCTION public.bloquear_historial_archivado(), public.bloquear_desafio_archivado()
FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS wods_lectura_staff_publicados ON public.wods;
CREATE POLICY wods_lectura_staff_publicados ON public.wods FOR SELECT TO authenticated
USING (public.mi_rol() = 'staff' AND publicado AND NOT archivado
  AND fecha = (now() AT TIME ZONE 'America/Guayaquil')::date);
DROP POLICY IF EXISTS desafios_alumno_activos ON public.desafios;
CREATE POLICY desafios_alumno_activos ON public.desafios FOR SELECT TO authenticated
USING (public.mi_rol()::text = 'alumno' AND estado = 'ACTIVO' AND NOT archivado);

ALTER TYPE public.estado_reporte_pago_enum ADD VALUE IF NOT EXISTS 'CANCELADO';
ALTER TABLE public.reportes_pago_alumno
  ADD COLUMN IF NOT EXISTS cancelado_por uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cancelado_at timestamptz;

CREATE OR REPLACE FUNCTION public.eliminar_cliente_seguro(p_cliente_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_cliente record; v_historial boolean;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT id, auth_user_id INTO v_cliente FROM public.clientes WHERE id=p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente inexistente.' USING ERRCODE='P0002'; END IF;
  v_historial := v_cliente.auth_user_id IS NOT NULL OR public.tiene_dependencias_historicas('public.clientes',p_cliente_id,'clientes');
  IF v_historial THEN
    UPDATE public.clientes SET estado_cliente='Inactivo' WHERE id=p_cliente_id;
    IF v_cliente.auth_user_id IS NOT NULL THEN UPDATE public.usuarios SET activo=false WHERE id=v_cliente.auth_user_id; END IF;
    PERFORM public.auditar_ciclo_vida('clientes',p_cliente_id,'INACTIVAR',jsonb_build_object('modo','LOGICA'));
    RETURN jsonb_build_object('modo','LOGICA');
  END IF;
  PERFORM public.auditar_ciclo_vida('clientes',p_cliente_id,'DELETE_FISICO',jsonb_build_object('modo','FISICA'));
  DELETE FROM public.clientes WHERE id=p_cliente_id;
  RETURN jsonb_build_object('modo','FISICA');
END; $$;

CREATE OR REPLACE FUNCTION public.restaurar_cliente(p_cliente_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_auth_user_id uuid;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  UPDATE public.clientes SET estado_cliente='Activo' WHERE id=p_cliente_id AND estado_cliente='Inactivo'
  RETURNING auth_user_id INTO v_auth_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no restaurable.' USING ERRCODE='P0002'; END IF;
  IF v_auth_user_id IS NOT NULL THEN UPDATE public.usuarios SET activo=true WHERE id=v_auth_user_id AND rol::text='alumno'; END IF;
  PERFORM public.auditar_ciclo_vida('clientes',p_cliente_id,'REACTIVAR','{}'::jsonb);
  RETURN jsonb_build_object('modo','REACTIVADO');
END; $$;

CREATE OR REPLACE FUNCTION public.gestionar_membresia_segura(p_membresia_id uuid, p_accion text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_m public.membresias%ROWTYPE; v_historial boolean;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_m FROM public.membresias WHERE id=p_membresia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membresia inexistente.' USING ERRCODE='P0002'; END IF;
  IF p_accion='RESTAURAR' THEN
    IF v_m.estado_pago::text <> 'CANCELADA' THEN RAISE EXCEPTION 'Membresia no restaurable.' USING ERRCODE='55000'; END IF;
    IF EXISTS (SELECT 1 FROM public.membresias x WHERE x.cliente_id=v_m.cliente_id AND x.id<>v_m.id
      AND x.estado_pago::text<>'CANCELADA' AND daterange(x.fecha_inicio,x.fecha_vencimiento,'[]') && daterange(v_m.fecha_inicio,v_m.fecha_vencimiento,'[]')) THEN
      RAISE EXCEPTION 'La restauracion genera solapamiento.' USING ERRCODE='23P01';
    END IF;
    UPDATE public.membresias SET estado_pago=CASE WHEN saldo=0 THEN 'PAGADO'::public.estado_pago_membresia_enum ELSE 'PENDIENTE'::public.estado_pago_membresia_enum END WHERE id=p_membresia_id;
    PERFORM public.auditar_ciclo_vida('membresias',p_membresia_id,'RESTAURAR','{}'::jsonb);
    RETURN jsonb_build_object('modo','RESTAURADA');
  ELSIF p_accion<>'ELIMINAR' THEN RAISE EXCEPTION 'Accion invalida.' USING ERRCODE='22023'; END IF;
  v_historial := public.tiene_dependencias_historicas('public.membresias',p_membresia_id,'membresias');
  IF v_historial THEN
    UPDATE public.membresias SET estado_pago='CANCELADA' WHERE id=p_membresia_id;
    PERFORM public.auditar_ciclo_vida('membresias',p_membresia_id,'CANCELAR',jsonb_build_object('modo','LOGICA'));
    RETURN jsonb_build_object('modo','CANCELADA');
  END IF;
  PERFORM public.auditar_ciclo_vida('membresias',p_membresia_id,'DELETE_FISICO','{}'::jsonb);
  DELETE FROM public.membresias WHERE id=p_membresia_id;
  RETURN jsonb_build_object('modo','FISICA');
END; $$;

CREATE OR REPLACE FUNCTION public.gestionar_producto_seguro(p_producto_id uuid, p_accion text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_path text; v_historial boolean;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT imagen_path INTO v_path FROM public.productos WHERE id=p_producto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto inexistente.' USING ERRCODE='P0002'; END IF;
  IF p_accion='RESTAURAR' THEN
    UPDATE public.productos SET activo=true WHERE id=p_producto_id AND NOT activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no restaurable.' USING ERRCODE='55000'; END IF;
    PERFORM public.auditar_ciclo_vida('productos',p_producto_id,'REACTIVAR','{}'::jsonb);
    RETURN jsonb_build_object('modo','REACTIVADO');
  ELSIF p_accion<>'ELIMINAR' THEN RAISE EXCEPTION 'Accion invalida.' USING ERRCODE='22023'; END IF;
  v_historial := public.tiene_dependencias_historicas('public.productos',p_producto_id,'productos');
  IF v_historial THEN
    UPDATE public.productos SET activo=false WHERE id=p_producto_id;
    PERFORM public.auditar_ciclo_vida('productos',p_producto_id,'INACTIVAR',jsonb_build_object('modo','LOGICA'));
    RETURN jsonb_build_object('modo','LOGICA');
  END IF;
  PERFORM public.auditar_ciclo_vida('productos',p_producto_id,'DELETE_FISICO','{}'::jsonb);
  DELETE FROM public.productos WHERE id=p_producto_id;
  RETURN jsonb_build_object('modo','FISICA','imagen_path',v_path);
END; $$;

CREATE OR REPLACE FUNCTION public.gestionar_inventario_seguro(p_item_id uuid, p_accion text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_historial boolean;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.inventario_items WHERE id=p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item inexistente.' USING ERRCODE='P0002'; END IF;
  IF p_accion='RESTAURAR' THEN
    UPDATE public.inventario_items SET estado='BUENO' WHERE id=p_item_id AND estado='BAJA';
    IF NOT FOUND THEN RAISE EXCEPTION 'Item no restaurable.' USING ERRCODE='55000'; END IF;
    PERFORM public.auditar_ciclo_vida('inventario_items',p_item_id,'REACTIVAR','{}'::jsonb);
    RETURN jsonb_build_object('modo','REACTIVADO');
  ELSIF p_accion<>'ELIMINAR' THEN RAISE EXCEPTION 'Accion invalida.' USING ERRCODE='22023'; END IF;
  v_historial := public.tiene_dependencias_historicas('public.inventario_items',p_item_id,'inventario_items');
  IF v_historial THEN
    UPDATE public.inventario_items SET estado='BAJA' WHERE id=p_item_id;
    PERFORM public.auditar_ciclo_vida('inventario_items',p_item_id,'INACTIVAR',jsonb_build_object('modo','BAJA'));
    RETURN jsonb_build_object('modo','BAJA');
  END IF;
  PERFORM public.auditar_ciclo_vida('inventario_items',p_item_id,'DELETE_FISICO','{}'::jsonb);
  DELETE FROM public.inventario_items WHERE id=p_item_id;
  RETURN jsonb_build_object('modo','FISICA');
END; $$;

CREATE OR REPLACE FUNCTION public.anular_gasto_seguro(p_gasto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  UPDATE public.gastos
  SET estado='ANULADO', anulado_por=auth.uid(), anulado_at=now()
  WHERE id=p_gasto_id AND estado='ACTIVO';
  IF NOT FOUND THEN RAISE EXCEPTION 'Gasto inexistente o ya anulado.' USING ERRCODE='55000'; END IF;
  PERFORM public.auditar_ciclo_vida('gastos',p_gasto_id,'ANULAR',jsonb_build_object('modo','ANULADO'));
  RETURN jsonb_build_object('modo','ANULADO');
END; $$;

CREATE OR REPLACE FUNCTION public.gestionar_wod_seguro(p_wod_id uuid, p_accion text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_historial boolean;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.wods WHERE id=p_wod_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WOD inexistente.' USING ERRCODE='P0002'; END IF;
  IF p_accion='RESTAURAR' THEN
    UPDATE public.wods SET archivado=false, publicado=false WHERE id=p_wod_id AND archivado;
    IF NOT FOUND THEN RAISE EXCEPTION 'WOD no restaurable.' USING ERRCODE='55000'; END IF;
    PERFORM public.auditar_ciclo_vida('wods',p_wod_id,'RESTAURAR','{}'::jsonb);
    RETURN jsonb_build_object('modo','RESTAURADO');
  ELSIF p_accion<>'ELIMINAR' THEN RAISE EXCEPTION 'Accion invalida.' USING ERRCODE='22023'; END IF;
  v_historial := public.tiene_dependencias_historicas('public.wods',p_wod_id,'wods');
  IF v_historial THEN
    UPDATE public.wods SET archivado=true, publicado=false WHERE id=p_wod_id;
    PERFORM public.auditar_ciclo_vida('wods',p_wod_id,'ARCHIVAR',jsonb_build_object('modo','ARCHIVADO'));
    RETURN jsonb_build_object('modo','ARCHIVADO');
  END IF;
  PERFORM public.auditar_ciclo_vida('wods',p_wod_id,'DELETE_FISICO','{}'::jsonb);
  DELETE FROM public.wods WHERE id=p_wod_id;
  RETURN jsonb_build_object('modo','FISICA');
END; $$;

CREATE OR REPLACE FUNCTION public.gestionar_desafio_seguro(p_desafio_id uuid, p_accion text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_historial boolean;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.desafios WHERE id=p_desafio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Desafio inexistente.' USING ERRCODE='P0002'; END IF;
  IF p_accion='RESTAURAR' THEN
    UPDATE public.desafios SET archivado=false, estado='BORRADOR' WHERE id=p_desafio_id AND archivado;
    IF NOT FOUND THEN RAISE EXCEPTION 'Desafio no restaurable.' USING ERRCODE='55000'; END IF;
    PERFORM public.auditar_ciclo_vida('desafios',p_desafio_id,'RESTAURAR','{}'::jsonb);
    RETURN jsonb_build_object('modo','RESTAURADO');
  ELSIF p_accion<>'ELIMINAR' THEN RAISE EXCEPTION 'Accion invalida.' USING ERRCODE='22023'; END IF;
  v_historial := public.tiene_dependencias_historicas('public.desafios',p_desafio_id,'desafios');
  IF v_historial THEN
    UPDATE public.desafios SET archivado=true, estado='CERRADO' WHERE id=p_desafio_id;
    PERFORM public.auditar_ciclo_vida('desafios',p_desafio_id,'ARCHIVAR',jsonb_build_object('modo','ARCHIVADO'));
    RETURN jsonb_build_object('modo','ARCHIVADO');
  END IF;
  PERFORM public.auditar_ciclo_vida('desafios',p_desafio_id,'DELETE_FISICO','{}'::jsonb);
  DELETE FROM public.desafios WHERE id=p_desafio_id;
  RETURN jsonb_build_object('modo','FISICA');
END; $$;

CREATE OR REPLACE FUNCTION public.gestionar_comunicado_seguro(p_comunicado_id uuid, p_accion text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_historial boolean;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.comunicados WHERE id=p_comunicado_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comunicado inexistente.' USING ERRCODE='P0002'; END IF;
  IF p_accion='RESTAURAR' THEN
    UPDATE public.comunicados SET archivado=false, publicado=false WHERE id=p_comunicado_id AND archivado;
    IF NOT FOUND THEN RAISE EXCEPTION 'Comunicado no restaurable.' USING ERRCODE='55000'; END IF;
    PERFORM public.auditar_ciclo_vida('comunicados',p_comunicado_id,'RESTAURAR','{}'::jsonb);
    RETURN jsonb_build_object('modo','RESTAURADO');
  ELSIF p_accion<>'ELIMINAR' THEN RAISE EXCEPTION 'Accion invalida.' USING ERRCODE='22023'; END IF;
  v_historial := public.tiene_dependencias_historicas('public.comunicados',p_comunicado_id,'comunicados');
  IF v_historial THEN
    UPDATE public.comunicados SET archivado=true, publicado=false WHERE id=p_comunicado_id;
    PERFORM public.auditar_ciclo_vida('comunicados',p_comunicado_id,'ARCHIVAR',jsonb_build_object('modo','ARCHIVADO'));
    RETURN jsonb_build_object('modo','ARCHIVADO');
  END IF;
  PERFORM public.auditar_ciclo_vida('comunicados',p_comunicado_id,'DELETE_FISICO','{}'::jsonb);
  DELETE FROM public.comunicados WHERE id=p_comunicado_id;
  RETURN jsonb_build_object('modo','FISICA');
END; $$;

CREATE OR REPLACE FUNCTION public.cancelar_reporte_pago_pendiente(p_reporte_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno WHERE id=p_reporte_id FOR UPDATE;
  IF NOT FOUND OR v_reporte.estado::text<>'PENDIENTE' THEN RAISE EXCEPTION 'Solo se cancela un reporte pendiente.' USING ERRCODE='55000'; END IF;
  UPDATE public.reportes_pago_alumno SET estado='CANCELADO', reviewed_by=auth.uid(), reviewed_at=now(),
    motivo_rechazo='Cancelado administrativamente: reporte creado por error.', cancelado_por=auth.uid(), cancelado_at=now(),
    comprobante_limpieza_estado=CASE WHEN comprobante_path IS NOT NULL THEN 'PENDIENTE' ELSE comprobante_limpieza_estado END
  WHERE id=p_reporte_id;
  PERFORM public.auditar_ciclo_vida('reportes_pago_alumno',p_reporte_id,'CANCELAR','{}'::jsonb);
  RETURN jsonb_build_object('modo','CANCELADO');
END; $$;

CREATE OR REPLACE FUNCTION public.obtener_comprobante_pago_limpieza(p_reporte_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno WHERE id=p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE='P0002'; END IF;
  IF v_reporte.estado::text NOT IN ('APROBADO','RECHAZADO','CANCELADO') THEN RAISE EXCEPTION 'El reporte sigue pendiente.' USING ERRCODE='55000'; END IF;
  IF v_reporte.comprobante_limpieza_estado='LEGACY' THEN RAISE EXCEPTION 'Comprobante historico no automatizable.' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('path',v_reporte.comprobante_path,'eliminado_at',v_reporte.comprobante_eliminado_at,'estado',v_reporte.comprobante_limpieza_estado);
END; $$;

CREATE OR REPLACE FUNCTION public.confirmar_limpieza_comprobante(p_reporte_id uuid,p_comprobante_path text)
RETURNS public.reportes_pago_alumno LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno WHERE id=p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE='P0002'; END IF;
  IF v_reporte.comprobante_limpieza_estado='ELIMINADO' AND v_reporte.comprobante_path IS NULL THEN RETURN v_reporte; END IF;
  IF v_reporte.estado::text NOT IN ('APROBADO','RECHAZADO','CANCELADO')
     OR v_reporte.comprobante_limpieza_estado NOT IN ('PENDIENTE','ERROR')
     OR v_reporte.comprobante_path IS DISTINCT FROM p_comprobante_path THEN
    RAISE EXCEPTION 'El reporte no esta listo para limpieza.' USING ERRCODE='55000';
  END IF;
  UPDATE public.reportes_pago_alumno SET
    comprobante_original_mime=coalesce(comprobante_original_mime,comprobante_mime),
    comprobante_original_size=coalesce(comprobante_original_size,comprobante_size),
    comprobante_path=NULL, comprobante_mime=NULL, comprobante_size=NULL,
    comprobante_eliminado_at=coalesce(comprobante_eliminado_at,now()),
    comprobante_limpieza_estado='ELIMINADO', comprobante_limpieza_intentos=comprobante_limpieza_intentos+1,
    comprobante_limpieza_error_at=NULL
  WHERE id=p_reporte_id RETURNING * INTO v_reporte;
  RETURN v_reporte;
END; $$;

CREATE OR REPLACE FUNCTION public.registrar_fallo_limpieza_comprobante(p_reporte_id uuid,p_comprobante_path text)
RETURNS public.reportes_pago_alumno LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_reporte public.reportes_pago_alumno%ROWTYPE;
BEGIN
  IF NOT public.es_gestor_ciclo_vida() THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_reporte FROM public.reportes_pago_alumno WHERE id=p_reporte_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El reporte no existe.' USING ERRCODE='P0002'; END IF;
  IF v_reporte.comprobante_limpieza_estado='ELIMINADO' THEN RETURN v_reporte; END IF;
  IF v_reporte.estado::text NOT IN ('APROBADO','RECHAZADO','CANCELADO')
     OR v_reporte.comprobante_limpieza_estado NOT IN ('PENDIENTE','ERROR')
     OR v_reporte.comprobante_path IS DISTINCT FROM p_comprobante_path THEN
    RAISE EXCEPTION 'El reporte no esta listo para registrar fallo.' USING ERRCODE='55000';
  END IF;
  UPDATE public.reportes_pago_alumno SET comprobante_limpieza_estado='ERROR',
    comprobante_limpieza_intentos=comprobante_limpieza_intentos+1, comprobante_limpieza_error_at=now()
  WHERE id=p_reporte_id RETURNING * INTO v_reporte;
  RETURN v_reporte;
END; $$;

CREATE OR REPLACE FUNCTION public.retirar_usuario_interno(p_usuario_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_rol text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id=auth.uid() AND u.activo AND u.rol::text='admin') THEN
    RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501';
  END IF;
  IF p_usuario_id=auth.uid() THEN RAISE EXCEPTION 'No puede retirar su propia cuenta.' USING ERRCODE='55000'; END IF;
  SELECT rol::text INTO v_rol FROM public.usuarios WHERE id=p_usuario_id AND login_username IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR v_rol NOT IN ('owner','staff') THEN RAISE EXCEPTION 'Usuario no administrable.' USING ERRCODE='P0002'; END IF;
  UPDATE public.usuarios SET activo=false WHERE id=p_usuario_id;
  PERFORM public.auditar_ciclo_vida('usuarios',p_usuario_id,'INACTIVAR',jsonb_build_object('modo','LOGICA'));
  RETURN jsonb_build_object('modo','LOGICA');
END; $$;

CREATE OR REPLACE FUNCTION public.listar_desafios_gestion()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL OR public.mi_rol() NOT IN ('admin','owner','staff') THEN RAISE EXCEPTION 'Acceso denegado.' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'titulo',d.titulo,'descripcion',d.descripcion,'fecha_inicio',d.fecha_inicio,'fecha_fin',d.fecha_fin,'objetivo_numero',d.objetivo_numero,'unidad',d.unidad,'estado',d.estado,'archivado',d.archivado,'participantes',coalesce((SELECT jsonb_agg(jsonb_build_object('usuario_id',p.usuario_id,'nombre_visible',split_part(u.nombre,' ',1)||CASE WHEN split_part(u.nombre,' ',2)<>'' THEN ' '||left(split_part(u.nombre,' ',2),1)||'.' ELSE '' END,'progreso',p.progreso,'porcentaje',least(100,round(p.progreso*100/d.objetivo_numero,2)),'completed_at',p.completed_at) ORDER BY u.nombre) FROM public.desafio_participantes p JOIN public.usuarios u ON u.id=p.usuario_id WHERE p.desafio_id=d.id),'[]'::jsonb)) ORDER BY d.created_at DESC) FROM public.desafios d),'[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.eliminar_cliente_seguro(uuid), public.restaurar_cliente(uuid),
  public.gestionar_membresia_segura(uuid,text), public.gestionar_producto_seguro(uuid,text),
  public.gestionar_inventario_seguro(uuid,text), public.gestionar_wod_seguro(uuid,text),
  public.gestionar_desafio_seguro(uuid,text), public.gestionar_comunicado_seguro(uuid,text),
  public.anular_gasto_seguro(uuid), public.cancelar_reporte_pago_pendiente(uuid),
  public.retirar_usuario_interno(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_cliente_seguro(uuid), public.restaurar_cliente(uuid),
  public.gestionar_membresia_segura(uuid,text), public.gestionar_producto_seguro(uuid,text),
  public.gestionar_inventario_seguro(uuid,text), public.gestionar_wod_seguro(uuid,text),
  public.gestionar_desafio_seguro(uuid,text), public.gestionar_comunicado_seguro(uuid,text),
  public.anular_gasto_seguro(uuid), public.cancelar_reporte_pago_pendiente(uuid),
  public.retirar_usuario_interno(uuid)
TO authenticated;

COMMIT;

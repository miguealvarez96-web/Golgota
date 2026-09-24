-- GÓLGOTA: postflight SOLO LECTURA. Ejecutar completo después de la reparación.
-- No llama RPC/funciones de negocio, no hace DDL/DML ni modifica secuencias.
-- Usar postgres/BYPASSRLS: los conteos de un usuario restringido pueden ser parciales.
-- Si faltan tablas/columnas base, las consultas de catálogo lo muestran; las consultas
-- de datos finales requieren el esquema reparado y fallarán sin modificar nada.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

SELECT current_user AS rol_revision,
       current_setting('transaction_read_only') AS solo_lectura,
       (now() AT TIME ZONE 'America/Guayaquil')::date AS fecha_ecuador,
       r.rolsuper OR r.rolbypassrls AS visibilidad_completa,
       CASE WHEN r.rolsuper OR r.rolbypassrls THEN 'OK'
            ELSE 'REVISAR: conteos sujetos a RLS' END AS resultado
FROM pg_roles r WHERE r.rolname = current_user;

-- 1. Todas las columnas, tipos, nulabilidad y defaults de ambas tablas.
SELECT c.table_name, c.ordinal_position, c.column_name, c.data_type,
       c.udt_schema, c.udt_name, c.numeric_precision, c.numeric_scale,
       c.is_nullable, c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.table_name IN ('membresias', 'pagos')
ORDER BY c.table_name, c.ordinal_position;

SELECT e.nombre, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
       pg_get_userbyid(c.relowner) AS propietario,
       CASE WHEN c.relkind = 'r' AND c.relrowsecurity THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM (VALUES ('membresias'), ('pagos')) e(nombre)
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.nombre);

SELECT
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'membresias' AND column_name = 'estado') AS sin_estado_antiguo,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'membresias' AND column_name = 'estado_legacy'
          AND udt_name = 'estado_pago_enum' AND column_default IS NULL
          AND is_nullable = 'YES') AS legado_conservado_sin_default,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
          AND table_name = 'membresias' AND column_name = 'estado_pago'
          AND udt_name = 'estado_pago_membresia_enum'
          AND is_nullable = 'NO') AS estado_pago_tipo_y_not_null;

-- 2. Enum exacto, sin ACTIVA/VENCIDO ni otros valores.
SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS valores,
       CASE WHEN array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
                   = ARRAY['PENDIENTE','PAGADO','CANCELADA']::text[]
            THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM (VALUES ('estado_pago_membresia_enum')) esperado(nombre)
LEFT JOIN pg_type t ON t.oid = to_regtype('public.' || esperado.nombre)
LEFT JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname;

-- 3. Planes aprobados: exactamente una fila por nombre, precio/duración/activo.
WITH esperado(nombre, dias, precio) AS (
  VALUES ('DIARIO',1,4.00::numeric), ('SEMANAL',7,15.00),
         ('QUINCENAL',15,30.00), ('MENSUAL',30,50.00)
)
SELECT e.nombre, e.dias AS dias_esperados, e.precio AS precio_esperado,
       count(p.id) AS coincidencias,
       coalesce(jsonb_agg(jsonb_build_object('id',p.id,'nombre',p.nombre,
         'dias',p.duracion_dias,'precio',p.precio,'activo',p.activo))
         FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) AS filas,
       CASE WHEN count(p.id) = 1 AND bool_and(p.activo IS TRUE
              AND p.duracion_dias = e.dias AND p.precio = e.precio)
            THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM esperado e LEFT JOIN public.planes p ON upper(btrim(p.nombre)) = e.nombre
GROUP BY e.nombre,e.dias,e.precio ORDER BY e.dias;

SELECT id,nombre,duracion_dias,precio,activo,
       CASE WHEN activo IS FALSE THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM public.planes
WHERE upper(btrim(nombre)) NOT IN ('DIARIO','SEMANAL','QUINCENAL','MENSUAL')
ORDER BY nombre;
SELECT count(*) FILTER (WHERE activo IS TRUE) AS total_planes_activos,
       count(*) FILTER (WHERE upper(btrim(nombre)) NOT IN ('DIARIO','SEMANAL','QUINCENAL','MENSUAL')
                         AND activo IS DISTINCT FROM false) AS antiguos_no_inactivos
FROM public.planes;

-- 4. Restricciones e índices (incluye FK RESTRICT, CHECK y validación).
SELECT conrelid::regclass AS tabla, conname, contype, convalidated, condeferrable,
       pg_get_constraintdef(oid, true) AS definicion
FROM pg_constraint
WHERE conrelid IN (to_regclass('public.membresias'), to_regclass('public.pagos'))
ORDER BY conrelid::regclass::text, conname;
SELECT i.indrelid::regclass AS tabla, ci.relname AS indice, i.indisvalid, i.indisready,
       i.indisunique, pg_get_indexdef(i.indexrelid) AS definicion
FROM pg_index i JOIN pg_class ci ON ci.oid = i.indexrelid
WHERE i.indrelid IN (to_regclass('public.membresias'), to_regclass('public.pagos'), to_regclass('public.planes'))
ORDER BY tabla, indice;

-- 5. Vista: security_invoker, definición y columnas.
SELECT c.oid::regclass AS vista, c.reloptions,
       pg_get_viewdef(c.oid, true) AS definicion,
       CASE WHEN c.relkind = 'v' AND 'security_invoker=true' = ANY(c.reloptions)
            THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM (VALUES ('public.v_membresias_estado')) e(nombre)
LEFT JOIN pg_class c ON c.oid = to_regclass(e.nombre);
SELECT ordinal_position,column_name,udt_name
FROM information_schema.columns
WHERE table_schema='public' AND table_name='v_membresias_estado' ORDER BY ordinal_position;

-- 6. RPC y funciones internas; crear_membresia NO debe instalarse todavía.
SELECT e.firma, p.oid IS NOT NULL AS existe, p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS propietario, p.proconfig AS configuracion,
       pg_get_function_result(p.oid) AS retorno,
       pg_get_functiondef(p.oid) AS definicion
FROM (VALUES
  ('public.registrar_pago(uuid,numeric,public.metodo_pago_enum,timestamp with time zone)'),
  ('public.validar_pago_membresia()'), ('public.validar_agregados_membresia()'),
  ('public.sincronizar_pago_membresia()'), ('public.registrar_auditoria()'), ('public.mi_rol()')
) e(firma) LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.firma);

SELECT p.proname, p.oid::regprocedure AS firma,
       CASE WHEN p.proname IN ('crear_membresia','sync_membresia_desde_pagos')
            THEN 'REVISAR: no forma parte de esta reparación'
            ELSE 'REVISAR FIRMA/DEFINICIÓN' END AS observacion
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('registrar_pago','crear_membresia','sync_membresia_desde_pagos',
  'sincronizar_pago_membresia','validar_pago_membresia','validar_agregados_membresia')
ORDER BY p.proname,p.oid;

-- 7. Cada trigger esperado: función, evento/timing, activación y definición.
WITH esperado(tabla,nombre,funcion,tipo) AS (VALUES
  ('membresias','membresias_validar_agregados','public.validar_agregados_membresia()',23),
  ('pagos','pagos_validar','public.validar_pago_membresia()',31),
  ('pagos','pagos_sincronizar','public.sincronizar_pago_membresia()',5),
  ('pagos','audit_pagos','public.registrar_auditoria()',29),
  ('membresias','audit_membresias','public.registrar_auditoria()',29),
  ('membresias','membresias_updated_at','public.set_updated_at()',19),
  ('planes','audit_planes','public.registrar_auditoria()',29),
  ('planes','planes_updated_at','public.set_updated_at()',19)
)
SELECT e.tabla,e.nombre,t.tgenabled,t.tgfoid::regprocedure AS funcion,
       pg_get_triggerdef(t.oid,true) AS definicion,
       CASE WHEN t.tgenabled IN ('O','A') AND t.tgfoid = to_regprocedure(e.funcion)
             AND t.tgtype = e.tipo AND t.tgqual IS NULL AND t.tgnargs = 0
             AND t.tgattr = ''::int2vector
            THEN 'OK' ELSE 'REVISAR' END AS resultado
FROM esperado e LEFT JOIN pg_trigger t
 ON t.tgrelid=to_regclass('public.'||e.tabla) AND t.tgname=e.nombre AND NOT t.tgisinternal
ORDER BY e.tabla,e.nombre;

-- Lista completa para detectar triggers adicionales o duplicados.
SELECT tgrelid::regclass AS tabla,tgname,tgenabled,pg_get_triggerdef(oid,true) AS definicion
FROM pg_trigger WHERE NOT tgisinternal
 AND tgrelid IN (to_regclass('public.membresias'),to_regclass('public.pagos'),to_regclass('public.planes'))
ORDER BY tabla,tgname;

-- 8. RLS/policies: cuatro políticas esperadas + lista completa para revisar expresiones.
WITH esperado(tabla,nombre,comando) AS (VALUES
 ('membresias','membresias_admin','ALL'),('membresias','membresias_lectura','SELECT'),
 ('pagos','pagos_lectura','SELECT'),('pagos','pagos_registro','INSERT')
)
SELECT e.*,p.roles,p.permissive,p.qual,p.with_check,
 CASE WHEN p.cmd=e.comando AND p.roles=ARRAY['authenticated']::name[]
           AND p.permissive='PERMISSIVE' THEN 'OK ESTRUCTURA; revisar expresiones'
      ELSE 'REVISAR' END AS resultado
FROM esperado e LEFT JOIN pg_policies p
 ON p.schemaname='public' AND p.tablename=e.tabla AND p.policyname=e.nombre;
SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN ('membresias','pagos')
ORDER BY tablename,policyname;

-- 9. ACL reales, incluyendo PUBLIC y concesiones por columna.
SELECT c.oid::regclass AS objeto,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS beneficiario,
       a.privilege_type,a.is_grantable
FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
WHERE c.oid IN (to_regclass('public.membresias'),to_regclass('public.pagos'),to_regclass('public.v_membresias_estado'))
ORDER BY objeto,beneficiario,a.privilege_type;
SELECT a.attrelid::regclass AS tabla,a.attname,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS beneficiario,
       x.privilege_type,x.is_grantable
FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
WHERE a.attrelid IN (to_regclass('public.membresias'),to_regclass('public.pagos'),to_regclass('public.v_membresias_estado'))
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY tabla,a.attname,beneficiario;
SELECT p.oid::regprocedure AS funcion,
       CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS beneficiario,
       a.privilege_type,a.is_grantable
FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
WHERE p.pronamespace='public'::regnamespace
 AND p.proname IN ('registrar_pago','validar_pago_membresia','validar_agregados_membresia','sincronizar_pago_membresia')
ORDER BY funcion,beneficiario;

SELECT r.rol,t.tabla,
       has_table_privilege(r.rol,to_regclass('public.'||t.tabla),'SELECT') AS puede_select,
       has_table_privilege(r.rol,to_regclass('public.'||t.tabla),'INSERT') AS insert_tabla,
       has_table_privilege(r.rol,to_regclass('public.'||t.tabla),'UPDATE') AS update_tabla,
       has_table_privilege(r.rol,to_regclass('public.'||t.tabla),'DELETE') AS puede_delete,
       has_table_privilege(r.rol,to_regclass('public.'||t.tabla),'TRUNCATE') AS puede_truncate
FROM (VALUES ('anon'),('authenticated')) r(rol)
CROSS JOIN (VALUES ('membresias'),('pagos'),('v_membresias_estado')) t(tabla);
SELECT r.rol,c.columna,
       has_column_privilege(r.rol,'public.membresias',c.columna,'INSERT') AS puede_insert,
       has_column_privilege(r.rol,'public.membresias',c.columna,'UPDATE') AS puede_update
FROM (VALUES ('anon'),('authenticated')) r(rol)
CROSS JOIN (VALUES ('abono'),('saldo'),('estado_legacy'),('metodo_pago'),('estado_pago')) c(columna);
SELECT r.rol,p.proname,p.oid::regprocedure AS firma,
       has_function_privilege(r.rol,p.oid,'EXECUTE') AS puede_ejecutar
FROM (VALUES ('anon'),('authenticated')) r(rol)
CROSS JOIN pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND p.proname IN ('registrar_pago','validar_pago_membresia','validar_agregados_membresia','sincronizar_pago_membresia');

-- 10. Conteos. Cero membresías es el estado reportado, no una condición permanente.
SELECT (SELECT count(*) FROM public.membresias) AS membresias,
       (SELECT count(*) FROM public.pagos) AS pagos,
       (SELECT count(*) FROM public.v_membresias_estado) AS filas_vista;

-- 11. Cero filas = sin inconsistencias financieras/estado/fechas.
WITH totales AS (
 SELECT membresia_id,count(*) AS numero_pagos,sum(monto) AS total FROM public.pagos GROUP BY membresia_id
)
SELECT m.id,m.estado_legacy,m.estado_pago,m.valor,m.abono,m.saldo,
       coalesce(t.total,0) AS total_pagos,coalesce(t.numero_pagos,0) AS numero_pagos,
       m.abono IS DISTINCT FROM coalesce(t.total,0) AS abono_inconsistente,
       m.saldo IS DISTINCT FROM m.valor-coalesce(t.total,0) AS saldo_inconsistente,
       m.fecha_inicio,m.fecha_vencimiento,m.dias_duracion
FROM public.membresias m LEFT JOIN totales t ON t.membresia_id=m.id
WHERE m.valor IS NULL OR m.valor<=0 OR m.valor::text IN ('NaN','Infinity','-Infinity')
 OR m.abono IS NULL OR m.abono<0 OR m.abono::text IN ('NaN','Infinity','-Infinity')
 OR m.saldo IS NULL OR m.saldo<0 OR m.saldo::text IN ('NaN','Infinity','-Infinity')
 OR m.abono IS DISTINCT FROM coalesce(t.total,0)
 OR m.saldo IS DISTINCT FROM m.valor-coalesce(t.total,0)
 OR m.estado_pago IS NULL
 OR NOT (m.estado_pago='CANCELADA' OR (m.estado_pago='PAGADO' AND m.saldo=0)
         OR (m.estado_pago='PENDIENTE' AND m.saldo>0))
 OR m.fecha_inicio IS NULL OR m.fecha_vencimiento IS NULL
 OR m.dias_duracion IS NULL OR m.dias_duracion<=0
 OR NOT isfinite(m.fecha_inicio) OR NOT isfinite(m.fecha_vencimiento)
 OR m.fecha_vencimiento<>m.fecha_inicio+m.dias_duracion-1
ORDER BY m.id;

SELECT p.id,p.membresia_id,p.monto,p.fecha_pago,p.created_by
FROM public.pagos p LEFT JOIN public.membresias m ON m.id=p.membresia_id
LEFT JOIN public.usuarios u ON u.id=p.created_by
WHERE p.id IS NULL OR m.id IS NULL OR p.monto IS NULL OR p.monto<=0
 OR p.monto::text IN ('NaN','Infinity','-Infinity') OR p.fecha_pago IS NULL
 OR NOT isfinite(p.fecha_pago) OR p.metodo_pago IS NULL OR p.created_at IS NULL
 OR (p.created_by IS NOT NULL AND u.id IS NULL);
SELECT id,count(*) AS duplicados FROM public.pagos GROUP BY id HAVING count(*)>1;

-- Comparación de los resultados de la vista con las reglas de fecha Ecuador.
WITH esperado AS (
 SELECT m.id,m.estado_pago,m.abono,m.saldo,
        m.fecha_inicio > reloj.hoy AS por_iniciar,
        CASE WHEN reloj.hoy<m.fecha_inicio THEN NULL::text
             WHEN reloj.hoy>m.fecha_vencimiento THEN 'VENCIDA'
             WHEN reloj.hoy=m.fecha_vencimiento THEN 'VENCE_HOY'
             WHEN m.fecha_vencimiento-reloj.hoy<=3 THEN 'POR_VENCER'
             ELSE 'VIGENTE' END AS estado_vigencia
 FROM public.membresias m
 CROSS JOIN (SELECT (now() AT TIME ZONE 'America/Guayaquil')::date AS hoy) reloj
)
SELECT e.id AS membresia_id,v.id AS vista_id,e.estado_vigencia AS esperado,v.estado_vigencia AS observado
FROM esperado e FULL JOIN public.v_membresias_estado v ON v.id=e.id
WHERE e.id IS NULL OR v.id IS NULL
 OR e.estado_pago IS DISTINCT FROM v.estado_pago
 OR e.abono IS DISTINCT FROM v.total_abonado OR e.saldo IS DISTINCT FROM v.saldo
 OR e.por_iniciar IS DISTINCT FROM v.por_iniciar OR e.estado_vigencia IS DISTINCT FROM v.estado_vigencia;

COMMIT;


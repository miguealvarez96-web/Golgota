const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

const sql = read('supabase/migrations/20261013_gestion_administrativa_segura.sql');
const preflight = read('supabase/preflight/20261013_gestion_administrativa_segura.sql');
const postflight = read('supabase/postflight/20261013_gestion_administrativa_segura.sql');
const rollback = read('supabase/rollback/20261013_gestion_administrativa_segura.sql');
const dryRun = read('scripts/dry-run-gestion-administrativa-segura.ps1');
const macro = read('scripts/cerrar-bloque-gestion-administrativa.ps1');

test('el servidor centraliza permisos admin/owner y detecta cualquier FK o auditoría', () => {
  assert.match(sql, /u\.activo AND u\.rol IN \('admin', 'owner'\)/);
  assert.match(sql, /FROM pg_constraint[\s\S]*fk\.confrelid = p_tabla/);
  assert.match(sql, /FROM public\.auditoria_logs[\s\S]*a\.registro_id = p_id::text/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.es_gestor_ciclo_vida/);
  assert.match(sql, /REVOKE DELETE ON TABLE public\.clientes[\s\S]*public\.auditoria_logs[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.es_gestor_ciclo_vida[\s\S]*authenticated/);
});

test('clientes hacen baja con historial, delete sin dependencias y restauración', () => {
  const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.eliminar_cliente_seguro[\s\S]*?END; \$\$;/)[0];
  assert.match(fn, /auth_user_id IS NOT NULL[\s\S]*tiene_dependencias_historicas/);
  assert.match(fn, /SET estado_cliente='Inactivo'/);
  assert.match(fn, /UPDATE public\.usuarios SET activo=false/);
  assert.match(fn, /DELETE FROM public\.clientes/);
  assert.match(sql, /FUNCTION public\.restaurar_cliente[\s\S]*estado_cliente='Activo'[\s\S]*'REACTIVAR'/);
});

test('membresías cancelan con historial, borran solo sin dependencias y restauran sin solapamiento', () => {
  const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.gestionar_membresia_segura[\s\S]*?END; \$\$;/)[0];
  assert.match(fn, /p_accion='RESTAURAR'[\s\S]*daterange[\s\S]*23P01/);
  assert.match(fn, /tiene_dependencias_historicas[\s\S]*estado_pago='CANCELADA'/);
  assert.match(fn, /DELETE FROM public\.membresias/);
  assert.doesNotMatch(fn, /DELETE FROM public\.pagos/);
});

test('productos e inventario alternan inactivo/baja, delete seguro y restauración', () => {
  assert.match(sql, /gestionar_producto_seguro[\s\S]*SET activo=false[\s\S]*DELETE FROM public\.productos/);
  assert.match(sql, /gestionar_producto_seguro[\s\S]*imagen_path/);
  assert.match(sql, /gestionar_inventario_seguro[\s\S]*SET estado='BAJA'[\s\S]*DELETE FROM public\.inventario_items/);
  assert.match(sql, /gestionar_inventario_seguro[\s\S]*SET estado='BUENO'/);
  assert.doesNotMatch(sql, /DELETE FROM public\.inventario_incidencias/);
});

test('gastos se anulan y reportes pendientes se cancelan sin tocar pagos aprobados', () => {
  const expensesActions = read('src/app/(app)/gastos/actions.ts');
  const reportsActions = read('src/app/(app)/pagos-reportados/actions.ts');
  assert.match(expensesActions, /rpc\("anular_gasto_seguro"/);
  assert.match(sql, /anular_gasto_seguro[\s\S]*SET estado='ANULADO'[\s\S]*'ANULAR'/);
  assert.doesNotMatch(expensesActions, /\.delete\(/);
  assert.match(sql, /cancelar_reporte_pago_pendiente[\s\S]*estado::text<>'PENDIENTE'/);
  assert.match(sql, /SET estado='CANCELADO'/);
  assert.doesNotMatch(sql, /DELETE FROM public\.(?:reportes_pago_alumno|pagos)/);
  assert.match(reportsActions, /cancelPendingPaymentReport[\s\S]*cancelar_reporte_pago_pendiente/);
});

test('WOD, desafíos y comunicados archivan historial y solo borran filas huérfanas', () => {
  for (const [name, table] of [['wod','wods'],['desafio','desafios'],['comunicado','comunicados']]) {
    const fn = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.gestionar_${name}_seguro[\\s\\S]*?END; \\$\\$;`))[0];
    assert.match(fn, /tiene_dependencias_historicas/);
    assert.match(fn, /archivado=true/);
    assert.match(fn, new RegExp(`DELETE FROM public\\.${table}`));
    assert.match(fn, /p_accion='RESTAURAR'/);
  }
  assert.match(sql, /wod_resultados_bloquear_archivado/);
  assert.match(sql, /desafio_participantes_bloquear_archivado/);
  assert.match(sql, /OLD\.archivado AND NEW\.archivado[\s\S]*debe restaurarse antes de editarse/);
});

test('UI ofrece eliminar/restaurar y bloquea staff en acciones destructivas', () => {
  const sources = [
    read('src/components/productos/products-manager.tsx'),
    read('src/components/inventario/inventory-manager.tsx'),
    read('src/components/coaches/wod-manager.tsx'),
    read('src/components/coaches/challenge-manager.tsx'),
    read('src/components/coaches/announcements-manager.tsx'),
  ].join('\n');
  assert.match(sources, /Eliminar/);
  assert.match(sources, /Restaurar/);
  assert.match(sources, /text-red-700/);
  assert.match(read('src/app/(app)/wod/actions.ts'), /\["admin", "owner"\]\.includes\(access\.role\)/);
  assert.match(read('src/app/(app)/desafios/actions.ts'), /\["admin", "owner"\]\.includes\(access\.role\)/);
});

test('los listados exponen filtros coherentes para estados activos y retirados', () => {
  const memberships = read('src/app/(app)/membresias/page.tsx');
  const products = read('src/components/productos/products-manager.tsx');
  const inventory = read('src/components/inventario/inventory-manager.tsx');
  const expenses = read('src/components/gastos/expenses-manager.tsx');
  const payments = read('src/components/alumnos/reported-payments-manager.tsx');
  assert.match(memberships, /activas[\s\S]*vencidas[\s\S]*canceladas/);
  assert.match(products, /Activos[\s\S]*Inactivos/);
  assert.match(inventory, /inventoryStates\.map/);
  assert.match(expenses, /ACTIVO[\s\S]*ANULADO/);
  assert.match(payments, /PENDIENTE[\s\S]*APROBADO[\s\S]*RECHAZADO[\s\S]*CANCELADO/);
});

test('usuarios internos solo los administra admin y eliminar conserva actoría', () => {
  const access = read('src/lib/usuarios-internos/access.ts');
  const actions = read('src/app/(app)/usuarios/actions.ts');
  assert.match(access, /profile\.rol !== "admin"/);
  assert.match(actions, /removeInternalUser[\s\S]*ban_duration: "876000h"[\s\S]*retirar_usuario_interno/);
  assert.match(sql, /retirar_usuario_interno[\s\S]*u\.rol::text='admin'[\s\S]*SET activo=false/);
  assert.doesNotMatch(actions.match(/removeInternalUser[\s\S]*$/)[0], /deleteUser/);
});

test('privacidad y reportes no reciben eliminación administrativa', () => {
  assert.doesNotMatch(read('src/components/privacidad/privacy-requests-manager.tsx'), />Eliminar</);
  assert.doesNotMatch(read('src/components/reportes/reports-dashboard.tsx'), />Eliminar</);
  assert.doesNotMatch(sql, /DELETE FROM public\.(?:privacidad_aceptaciones|privacidad_solicitudes|auditoria_logs|pagos)/);
});

test('SQL controlado, auditoría y macro mantienen cierre manual y staging aislado', () => {
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/);
  for (const action of ['DELETE_FISICO','INACTIVAR','REACTIVAR','ANULAR','CANCELAR','ARCHIVAR','RESTAURAR']) {
    assert.match(sql, new RegExp(`'${action}'`));
  }
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(preflight, /RAISE NOTICE 'DELETE heredado detectado/);
  assert.doesNotMatch(preflight, /RAISE EXCEPTION 'Existe DELETE directo incompatible/);
  assert.match(postflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(postflight, /RAISE EXCEPTION 'DELETE directo persiste/);
  assert.match(postflight, /ARRAY\['authenticated','anon'\]/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.match(dryRun, /BEGIN;[\s\S]*\$migrationBody[\s\S]*\$postflightBody[\s\S]*\$rollback/);
  assert.match(macro, /SUPABASE_DB_URL/);
  assert.match(macro, /Get-State[\s\S]*partial[\s\S]*already|Get-State[\s\S]*partial/);
  assert.match(macro, /feat: add safe administrative lifecycle controls/);
  assert.match(macro, /vercel[\s\S]*--prod/);
  assert.doesNotMatch(macro.match(/\$blockFiles=@\([\s\S]*?\n\)/)[0], /\.gitignore/);
});

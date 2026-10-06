const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

const preflight = read('supabase/preflight/20261012_preflight_cierre_operativo.sql');
const migration = read('supabase/migrations/20261012_cierre_operativo.sql');
const postflight = read('supabase/postflight/20261012_postflight_cierre_operativo.sql');
const rollback = read('supabase/rollback/20261012_rollback_cierre_operativo.sql');
const dryRun = read('scripts/dry-run-cierre-operativo.ps1');
const macro = read('scripts/cerrar-bloque-cierre-operativo.ps1');
const navigation = read('src/components/layout/portal-navigation.tsx');
const reportData = read('src/lib/reportes/data.ts');
const dashboard = read('src/components/reportes/reports-dashboard.tsx');

test('preflight y postflight son de solo lectura y el dry-run termina en rollback', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(postflight, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.doesNotMatch(rollback, /\b(?:DROP|DELETE|COMMIT)\b/i);
  assert.match(dryRun, /BEGIN;[\s\S]*\$migrationBody[\s\S]*\$postflightBody[\s\S]*\$rollback/);
  assert.match(dryRun, /finally[\s\S]*Remove-Item -LiteralPath \$temporaryPath/);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(preflight, /has_table_privilege\('authenticated', 'public\.gastos', 'DELETE'\)/);
  assert.match(migration, /REVOKE DELETE ON TABLE public\.gastos FROM authenticated;/);
  assert.match(migration, /REVOKE DELETE ON TABLE public\.inventario_items, public\.inventario_incidencias FROM authenticated;/);
  assert.match(postflight, /has_table_privilege\('authenticated', 'public\.gastos', 'DELETE'\)/);
  assert.match(postflight, /has_table_privilege\('authenticated', 'public\.inventario_items', 'DELETE'\)/);
  assert.match(postflight, /has_table_privilege\('authenticated', 'public\.inventario_incidencias', 'DELETE'\)/);
});

test('reportes usan ingresos confirmados, gastos activos y resumen de inventario sin costo', () => {
  assert.match(reportData, /from\("pagos"\)/);
  assert.match(reportData, /from\("gastos"\)[\s\S]*\.eq\("estado", "ACTIVO"\)/);
  assert.match(reportData, /from\("v_inventario_gestion"\)\.select\("id,estado"\)/);
  assert.doesNotMatch(reportData.match(/async function loadInventorySummary[\s\S]*?\n\}/)[0], /costo/);
  assert.match(dashboard, /Ingresos confirmados[\s\S]*Gastos[\s\S]*Resultado neto/);
  assert.match(dashboard, /Resumen de inventario[\s\S]*Total items[\s\S]*En mantenimiento[\s\S]*Dañados[\s\S]*De baja/);
});

test('navegación muestra gastos e inventario y staff recibe solo inventario', () => {
  assert.match(navigation, /href: "\/gastos"/);
  assert.match(navigation, /href: "\/inventario"/);
  assert.match(navigation, /staffSections = new Set\(\["\/", "\/clientes", "\/membresias", "\/inventario", "\/wod", "\/comunicados"\]\)/);
  const staffSet = navigation.match(/staffSections = new Set\(([^;]+)\)/)[1];
  assert.doesNotMatch(staffSet, /gastos|reportes/);
});

test('macro respeta el flujo, el staging aislado y el commit esperado', () => {
  assert.match(macro, /Preflight[\s\S]*Dry-run[\s\S]*Aplicar SQL real[\s\S]*Migracion[\s\S]*Postflight/);
  assert.match(macro, /node[\s\S]*tsc[\s\S]*build[\s\S]*diff[\s\S]*status/);
  assert.match(macro, /diff --cached --name-only[\s\S]*Staging contiene cambios ajenos/);
  assert.match(macro, /feat: add expenses inventory and final reporting/);
  assert.match(macro, /Hacer commit y push\?/);
  assert.match(macro, /Desplegar a produccion\?/);
});

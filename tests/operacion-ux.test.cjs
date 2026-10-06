const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const preflight = read('supabase/preflight/20261011_preflight_operacion_ux.sql');
const migration = read('supabase/migrations/20261011_operacion_ux.sql');
const postflight = read('supabase/postflight/20261011_postflight_operacion_ux.sql');
const rollback = read('supabase/rollback/20261011_rollback_operacion_ux.sql');
const dryRun = read('scripts/dry-run-operacion-ux.ps1');
const macro = read('scripts/cerrar-bloque-operacion-ux.ps1');
const clientsPage = read('src/app/(app)/clientes/page.tsx');
const coachData = read('src/lib/coaches/data.ts');
const membershipsPage = read('src/app/(app)/membresias/page.tsx');
const paymentsManager = read('src/components/alumnos/reported-payments-manager.tsx');
const paymentModel = read('src/lib/alumnos/model.ts');
const studentPortal = read('src/app/(student)/portal/page.tsx');

test('SQL preparado es transaccional, no destructivo y el dry-run termina en rollback', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(postflight, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(migration, /^--[^\n]*\nBEGIN;/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE)\b/i);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.doesNotMatch(rollback, /\b(?:DROP|DELETE|COMMIT)\b/i);
  assert.match(dryRun, /BEGIN;[\s\S]*\$migrationBody[\s\S]*\$postflightBody[\s\S]*\$rollback/);
  assert.match(dryRun, /finally[\s\S]*Remove-Item -LiteralPath \$temporaryPath/);
});

test('migracion amplia WOD y protege gestion y lectura por rol', () => {
  for (const column of ['horario_grupo', 'youtube_url', 'notas']) {
    assert.match(migration, new RegExp(`ADD COLUMN ${column}`));
  }
  assert.match(migration, /wods_youtube_url_check[\s\S]*\^https\?/);
  assert.match(migration, /wods_creacion_gestion[\s\S]*'admin', 'owner', 'staff'/);
  assert.match(migration, /wods_edicion_gestion[\s\S]*'admin', 'owner', 'staff'/);
  assert.match(migration, /wods_lectura_alumno_publicados[\s\S]*'alumno'[\s\S]*publicado[\s\S]*America\/Guayaquil/);
  assert.doesNotMatch(migration, /GRANT\s+DELETE/i);
});

test('staff usa proyecciones sin datos personales sensibles', () => {
  assert.match(clientsPage, /if \(staff\)[\s\S]*\.select\("id,nombre_completo,estado_cliente"/);
  assert.match(clientsPage, /if \(query\) request = request\.ilike\("nombre_completo", `%\$\{query\.replace/);
  assert.match(coachData, /from\("clientes"\)\s*\.select\("id,nombre_completo"\)/);
  assert.doesNotMatch(coachData, /\.select\("[^"\n]*(?:cedula|celular|email|saldo|abono)/i);
});

test('membresias y pagos usan filtros y tarjetas expandibles solicitadas', () => {
  for (const filter of ['vigentes', 'por_vencer', 'vence_hoy', 'vencidas', 'por_iniciar']) {
    assert.match(membershipsPage, new RegExp(filter));
  }
  assert.match(membershipsPage, /loadClientIdentities\(access\.supabase, ids, !staff\)/);
  assert.match(membershipsPage, /<details[\s\S]*<summary/);
  assert.match(paymentsManager, /Buscar alumno o fecha/);
  assert.match(paymentsManager, /<details[\s\S]*<summary/);
  assert.match(paymentModel, /report\.fecha_pago[\s\S]*report\.created_at/);
});

test('alumno carga solo WOD publicado del dia y el macro conserva cierres manuales', () => {
  assert.match(studentPortal, /select\("id,fecha,titulo,contenido,horario_grupo,youtube_url,notas,publicado"\)/);
  assert.match(studentPortal, /\.eq\("fecha", businessDate\(\)\)\.eq\("publicado", true\)/);
  assert.match(macro, /Preflight[\s\S]*dry-run[\s\S]*Aplicar SQL real/);
  assert.match(macro, /node[\s\S]*tsc[\s\S]*build[\s\S]*diff[\s\S]*status/);
  assert.match(macro, /feat: improve coach wod memberships and payments ux/);
  assert.match(macro, /Hacer commit y push\?/);
  assert.match(macro, /Desplegar a produccion\?/);
  for (const testFile of ['privacidad.test.cjs', 'produccion.test.cjs', 'reportes.test.cjs', 'operacion-ux.test.cjs']) {
    assert.match(macro, new RegExp(testFile.replaceAll('.', '\\.')));
  }
});

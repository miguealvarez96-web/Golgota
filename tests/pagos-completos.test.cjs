const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  module._compile(source, filename);
  return module.exports;
}

const clientModel = load('src/lib/clientes/model.ts');
const model = load('src/lib/alumnos/model.ts', { '@/lib/clientes/model': clientModel });
const migration = read('supabase/migrations/20261004_pagos_completos_v1.sql');
const portalMigration = read('supabase/migrations/20261002_portal_alumno_v1.sql');
const repairMigration = read('supabase/migrations/20260924_repara_membresias_pagos.sql');
const paymentsMigration = read('supabase/migrations/20260930_membresias_cobranza.sql');
const preflight = read('supabase/preflight/20261004_preflight_pagos_completos_v1.sql');
const postflight = read('supabase/postflight/20261004_postflight_pagos_completos_v1.sql');
const rollback = read('supabase/rollback/20261004_rollback_pagos_completos_v1.sql');
const dryRun = read('scripts/dry-run-pagos-completos-v1.ps1');
const manager = read('src/components/alumnos/reported-payments-manager.tsx');
const adminPage = read('src/app/(app)/pagos-reportados/page.tsx');
const studentDashboard = read('src/components/alumnos/student-dashboard.tsx');
const reportId = '24b14e94-4408-4ea9-bde0-44d867a2ae09';

function functionSection(name, next) {
  const end = next ? `(?=CREATE OR REPLACE FUNCTION public\\.${next})` : '(?=-- Proyección de revisión)';
  return migration.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?${end}`))[0];
}

test('pendiente y rechazo no crean pagos ni alteran la membresía', () => {
  const report = portalMigration.match(/CREATE FUNCTION public\.reportar_pago_alumno\([\s\S]*?(?=CREATE FUNCTION public\.aprobar_reporte_pago_alumno)/)[0];
  const reject = functionSection('rechazar_reporte_pago_alumno', 'listar_reportes_pago_revision');
  for (const sql of [report, reject]) {
    assert.doesNotMatch(sql, /INSERT INTO public\.pagos/i);
    assert.doesNotMatch(sql, /UPDATE public\.membresias/i);
    assert.doesNotMatch(sql, /registrar_pago\s*\(/i);
  }
  assert.match(reject, /estado = 'RECHAZADO'/);
  assert.match(reject, /length\(v_motivo\) NOT BETWEEN 3 AND 500/);
  assert.match(migration, /ADD CONSTRAINT reportes_pago_alumno_rechazo_con_motivo[\s\S]*motivo_rechazo IS NOT NULL/);
});

test('aprobar bloquea reporte y membresía, aplica una vez y enlaza el pago real', () => {
  const approve = functionSection('aprobar_reporte_pago_alumno', 'rechazar_reporte_pago_alumno');
  assert.match(approve, /reportes_pago_alumno[\s\S]*?FOR UPDATE/);
  assert.match(approve, /public\.membresias[\s\S]*?FOR UPDATE/);
  assert.match(approve, /v_reporte\.estado <> 'PENDIENTE'/);
  assert.match(approve, /WHERE id = v_reporte\.id AND estado = 'PENDIENTE'/);
  assert.match(approve, /public\.registrar_pago\(/);
  assert.match(approve, /pago_real_id = v_pago\.id/);
  assert.match(approve, /reviewed_by = auth\.uid\(\)/);
  assert.match(approve, /reviewed_at = now\(\)/);
});

test('pago parcial, pago total y varios abonos derivan saldo y estado desde el historial', () => {
  assert.match(paymentsMigration, /SET abono = \(SELECT COALESCE\(sum\(monto\), 0\) FROM public\.pagos/);
  assert.match(repairMigration, /NEW\.saldo := NEW\.valor - v_abonado/);
  assert.match(repairMigration, /WHEN NEW\.saldo = 0 THEN 'PAGADO'/);
  assert.match(repairMigration, /ELSE 'PENDIENTE'/);
  assert.match(preflight, /m\.abono IS DISTINCT FROM COALESCE\(p\.abonado, 0\)/);
  assert.match(postflight, /m\.saldo IS DISTINCT FROM m\.valor - COALESCE\(p\.abonado, 0\)/);
});

test('saldo cero, membresía cancelada y sobrepago quedan bloqueados', () => {
  const approve = functionSection('aprobar_reporte_pago_alumno', 'rechazar_reporte_pago_alumno');
  assert.match(approve, /v_membresia\.estado_pago = 'CANCELADA'/);
  assert.match(approve, /v_membresia\.saldo <= 0/);
  assert.match(approve, /v_reporte\.monto > v_membresia\.saldo/);
  assert.match(paymentsMigration, /NEW\.monto > v_membresia\.saldo/);
});

function reviewHarness(role) {
  const calls = [];
  const { reviewReportedPayment } = load('src/app/(app)/pagos-reportados/actions.ts', {
    '@/lib/clientes/access': {
      async getClientAccess() {
        if (role === 'alumno') return null;
        return { role, supabase: { async rpc(name, args) { calls.push({ name, args }); return { error: null }; } } };
      },
    },
    '@/lib/clientes/model': clientModel,
    '@/lib/alumnos/model': model,
    'next/cache': { revalidatePath() {} },
  });
  return { reviewReportedPayment, calls };
}

test('admin y owner revisan; staff y alumno no invocan RPC financieras', async () => {
  for (const role of ['admin', 'owner']) {
    const harness = reviewHarness(role);
    assert.equal((await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' })).ok, true);
    assert.equal(harness.calls[0].name, 'aprobar_reporte_pago_alumno');
  }
  for (const role of ['staff', 'alumno']) {
    const harness = reviewHarness(role);
    assert.equal((await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' })).ok, false);
    assert.equal(harness.calls.length, 0);
  }
  assert.match(migration, /mi_rol\(\) NOT IN \('admin', 'owner'\)/);
});

test('rechazar exige motivo válido antes de invocar PostgreSQL', async () => {
  const harness = reviewHarness('admin');
  const result = await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'rechazar', motivo: '' });
  assert.equal(result.ok, false);
  assert.equal(harness.calls.length, 0);
  assert.equal(model.reviewPaymentSchema.safeParse({ reporte_id: reportId, decision: 'rechazar', motivo: 'No coincide' }).success, true);
});

test('la bandeja segura contiene trazabilidad y solo admite admin/owner', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.listar_reportes_pago_revision\(\)/);
  for (const field of ['usuario_id', 'reviewed_by', 'pago_real_id', 'monto_aplicado', 'revisor', 'alumno', 'membresia']) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.listar_reportes_pago_revision\(\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(adminPage, /rpc\("listar_reportes_pago_revision"\)/);
  assert.doesNotMatch(adminPage, /from\("reportes_pago_alumno"\)/);
});

test('filtros por estado y búsqueda de alumno funcionan sin distinguir tildes', () => {
  const base = {
    id: reportId, cliente_id: reportId, usuario_id: reportId, membresia_id: null, monto: 20,
    fecha_pago: '2026-10-01', banco_origen: 'Pichincha', referencia: 'ABC-1',
    observacion: null, estado: 'PENDIENTE', created_at: '2026-10-01T12:00:00Z',
    reviewed_at: null, reviewed_by: null, motivo_rechazo: null, pago_real_id: null,
    alumno: 'MIGUEL ÁLVAREZ', membresia: 'MENSUAL', membresia_fecha_inicio: null,
    membresia_fecha_fin: null, saldo_membresia: 30, estado_pago_membresia: 'PENDIENTE',
    revisor: null, monto_aplicado: null,
  };
  const approved = { ...base, id: 'b98e5f70-849c-4df8-906a-2b20654fdb39', estado: 'APROBADO' };
  assert.deepEqual(model.filterAdminPaymentReports([base, approved], 'PENDIENTE', 'alvarez'), [base]);
  assert.deepEqual(model.filterAdminPaymentReports([base, approved], 'APROBADO', ''), [approved]);
});

test('UI protege doble envío y muestra todos los datos requeridos', () => {
  assert.match(manager, /activeReview\.current/);
  assert.match(manager, /window\.confirm/);
  assert.match(manager, /Buscar alumno/);
  for (const label of ['Membresía', 'Monto reportado', 'Fecha del pago', 'Banco / origen', 'Referencia', 'Saldo actual', 'Cuenta reportante', 'Revisor', 'Fecha de revisión', 'Pago real', 'Monto aplicado']) {
    assert.match(manager, new RegExp(label));
  }
  assert.match(studentDashboard, /Pago aprobado y aplicado a tu membresía/);
  assert.match(studentDashboard, /Pendiente de verificación\. Todavía no modifica tu saldo/);
  assert.doesNotMatch(studentDashboard, /editar|eliminar/i);
});

test('preflight, postflight y dry-run verifican invariantes y terminan en ROLLBACK', () => {
  assert.match(preflight, /reportes con trazabilidad financiera inconsistente/);
  assert.match(postflight, /reportes con trazabilidad inconsistente/);
  assert.match(dryRun, /reportes_pago_alumno'\) IS NULL THEN 'missing' ELSE 'applied'/);
  assert.match(dryRun, /Get-MigrationBody \$portalMigrationPath/);
  assert.match(dryRun, /Get-MigrationBody \$blockMigrationPath/);
  assert.match(dryRun, /Get-ReadOnlyBody \$blockPostflightPath/);
  assert.match(dryRun, /finally[\s\S]*Remove-Item -LiteralPath \$temporaryPath/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.doesNotMatch(rollback, /\b(?:DROP|DELETE|COMMIT)\b/i);
});

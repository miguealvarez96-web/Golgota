const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }
function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const source = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
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
const migration = read('supabase/migrations/20261006_limpieza_comprobantes_pago.sql');
const preflight = read('supabase/preflight/20261006_preflight_limpieza_comprobantes_pago.sql');
const postflight = read('supabase/postflight/20261006_postflight_limpieza_comprobantes_pago.sql');
const portalPostflight = read('supabase/postflight/20261002_postflight_portal_alumno_v1.sql');
const receiptsPostflight = read('supabase/postflight/20261005_postflight_comprobantes_pago_v1.sql');
const rollback = read('supabase/rollback/20261006_rollback_limpieza_comprobantes_pago.sql');
const dryRun = read('scripts/dry-run-limpieza-comprobantes-pago.ps1');
const closing = read('scripts/cerrar-ajuste-limpieza-comprobantes.ps1');
const actionsSource = read('src/app/(app)/pagos-reportados/actions.ts');
const signedAction = read('src/app/actions/payment-receipts.ts');
const adminUi = read('src/components/alumnos/reported-payments-manager.tsx');
const studentUi = read('src/components/alumnos/student-dashboard.tsx');
const reportId = '24b14e94-4408-4ea9-bde0-44d867a2ae09';

function reviewHarness({ role = 'admin', removalError = null, removalThrows = false, confirmationError = null } = {}) {
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args });
      if (name === 'obtener_comprobante_pago_limpieza') {
        return { data: { path: 'user/receipt.pdf', eliminado_at: null, estado: 'PENDIENTE' }, error: null };
      }
      if (name === 'confirmar_limpieza_comprobante') return { data: null, error: confirmationError };
      return { data: null, error: null };
    },
    storage: { from(bucket) { return { async remove(paths) {
      calls.push({ kind: 'storage', bucket, paths });
      if (removalThrows) throw new Error('private thrown detail');
      return { data: null, error: removalError };
    } }; } },
  };
  const actions = load('src/app/(app)/pagos-reportados/actions.ts', {
    '@/lib/clientes/access': { async getClientAccess() { return role === 'staff' ? { role, supabase } : { role, supabase, userId: reportId }; } },
    '@/lib/clientes/model': clientModel,
    '@/lib/alumnos/model': model,
    'next/cache': { revalidatePath() {} },
  });
  return { ...actions, calls };
}

test('un reporte pendiente conserva el archivo y solo habilita lectura privada', () => {
  const selectPolicy = migration.match(/CREATE POLICY payment_receipts_select[\s\S]*?(?=CREATE POLICY payment_receipts_cleanup_select)/)[0];
  assert.match(selectPolicy, /r\.estado = 'PENDIENTE'/);
  assert.match(selectPolicy, /r\.usuario_id = auth\.uid\(\)/);
  assert.match(adminUi, /report\.estado === "PENDIENTE"[\s\S]*PaymentReceiptButton/);
  assert.match(studentUi, /report\.estado === "PENDIENTE"[\s\S]*PaymentReceiptButton/);
});

test('aprobar aplica primero la RPC financiera y después elimina y confirma el archivo', async () => {
  const harness = reviewHarness();
  const result = await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls.map((call) => call.name ?? call.kind), [
    'aprobar_reporte_pago_alumno',
    'obtener_comprobante_pago_limpieza',
    'storage',
    'confirmar_limpieza_comprobante',
  ]);
});

test('rechazar registra primero el motivo, no afecta saldos y después elimina el archivo', async () => {
  const harness = reviewHarness({ role: 'owner' });
  const result = await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'rechazar', motivo: 'No coincide' });
  assert.equal(result.ok, true);
  assert.equal(harness.calls[0].name, 'rechazar_reporte_pago_alumno');
  assert.equal(harness.calls[2].kind, 'storage');
  const reject = migration.match(/CREATE OR REPLACE FUNCTION public\.rechazar_reporte_pago_alumno\([\s\S]*?(?=CREATE FUNCTION public\.obtener_comprobante_pago_limpieza)/)[0];
  assert.doesNotMatch(reject, /registrar_pago\s*\(|UPDATE\s+public\.membresias/i);
});

test('la limpieza conserva el reporte y la trazabilidad, pero anula la ruta firmable', () => {
  const confirm = migration.match(/CREATE FUNCTION public\.confirmar_limpieza_comprobante\([\s\S]*?(?=CREATE FUNCTION public\.registrar_fallo_limpieza_comprobante)/)[0];
  assert.match(confirm, /comprobante_original_mime = COALESCE/);
  assert.match(confirm, /comprobante_original_size = COALESCE/);
  assert.match(confirm, /comprobante_path = NULL/);
  assert.match(confirm, /comprobante_eliminado_at = COALESCE/);
  assert.match(migration, /DROP CONSTRAINT reportes_pago_alumno_comprobante_obligatorio/);
  assert.match(migration, /ADD CONSTRAINT reportes_pago_alumno_comprobante_obligatorio[\s\S]*ELIMINADO[\s\S]*comprobante_original_mime/);
  assert.doesNotMatch(confirm, /DELETE\s+FROM\s+public\.reportes_pago_alumno/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.reportes_pago_alumno/i);
});

test('el borrado y la confirmación son idempotentes', () => {
  assert.match(migration, /comprobante_limpieza_estado = 'ELIMINADO'[\s\S]*comprobante_path IS NULL[\s\S]*RETURN v_reporte/);
  assert.match(actionsSource, /if \(!receipt\?\.path\) return Boolean\(receipt\?\.eliminado_at\)/);
  assert.match(actionsSource, /remove\(\[receipt\.path\]\)[\s\S]*confirmar_limpieza_comprobante/);
});

test('si Storage falla no se revierte una aprobación y queda reintento controlado', async () => {
  const harness = reviewHarness({ removalError: { message: 'private detail' } });
  const result = await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' });
  assert.equal(result.ok, true);
  assert.match(result.message, /pendiente de reintento/);
  assert.equal(harness.calls.filter((call) => call.name === 'aprobar_reporte_pago_alumno').length, 1);
  assert.equal(harness.calls.at(-1).name, 'registrar_fallo_limpieza_comprobante');
  assert.doesNotMatch(result.message, /private detail/);
  assert.match(adminUi, /Reintentar limpieza/);
});

test('una confirmación fallida también queda marcada para reintento sin repetir el pago', async () => {
  const harness = reviewHarness({ confirmationError: { code: 'network' } });
  const result = await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' });
  assert.equal(result.ok, true);
  assert.equal(harness.calls.filter((call) => call.name === 'aprobar_reporte_pago_alumno').length, 1);
  assert.equal(harness.calls.at(-1).name, 'registrar_fallo_limpieza_comprobante');
});

test('una excepción de Storage tampoco convierte el pago ya aplicado en error', async () => {
  const harness = reviewHarness({ removalThrows: true });
  const result = await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' });
  assert.equal(result.ok, true);
  assert.match(result.message, /pendiente de reintento/);
  assert.doesNotMatch(result.message, /private thrown detail/);
});

test('después de resolver no se genera URL firmada', () => {
  assert.match(signedAction, /select\("comprobante_path, comprobante_mime, estado"\)/);
  assert.match(signedAction, /report\?\.estado !== "PENDIENTE"/);
  assert.match(migration, /payment_receipts_select[\s\S]*r\.estado = 'PENDIENTE'/);
});

test('alumno no puede borrar manualmente; admin/owner limpian solo reportes resueltos', () => {
  const deletePolicy = migration.match(/CREATE POLICY payment_receipts_cleanup\n[\s\S]*?(?=CREATE OR REPLACE FUNCTION)/)[0];
  assert.match(deletePolicy, /mi_rol\(\)::text IN \('admin', 'owner'\)/);
  assert.match(deletePolicy, /r\.estado IN \('APROBADO', 'RECHAZADO'\)/);
  assert.doesNotMatch(deletePolicy, /mi_rol\(\)::text\s*=\s*'alumno'/);
  assert.match(migration, /DROP POLICY IF EXISTS payment_receipts_cleanup/);
  const cleanupSelect = migration.match(/CREATE POLICY payment_receipts_cleanup_select[\s\S]*?(?=CREATE POLICY payment_receipts_cleanup\n)/)[0];
  assert.match(cleanupSelect, /allow_any_operation[\s\S]*storage\.object\.delete/);
  assert.doesNotMatch(cleanupSelect, /object\.sign/);
});

test('admin/owner controlan revisión y reintento; staff sigue bloqueado', async () => {
  for (const role of ['admin', 'owner']) {
    const harness = reviewHarness({ role });
    assert.equal((await harness.retryPaymentReceiptCleanup(reportId)).ok, true);
  }
  const staff = reviewHarness({ role: 'staff' });
  assert.equal((await staff.retryPaymentReceiptCleanup(reportId)).ok, false);
  assert.equal(staff.calls.length, 0);
  assert.match(migration, /mi_rol\(\) NOT IN \('admin', 'owner'\)/);
});

test('históricos quedan LEGACY y la migración no borra archivos ni registros', () => {
  assert.match(migration, /comprobante_limpieza_estado varchar\(12\) NOT NULL DEFAULT 'LEGACY'/);
  assert.match(migration, /ALTER COLUMN comprobante_limpieza_estado SET DEFAULT 'PENDIENTE'/);
  assert.match(migration, /comprobante_limpieza_estado = 'LEGACY'[\s\S]*comprobante historico no entra/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+storage\.objects/i);
});

test('UI informa la eliminación y nunca intenta abrir un resuelto', () => {
  for (const source of [adminUi, studentUi]) {
    assert.match(source, /Comprobante eliminado después de la revisión/);
    assert.match(source, /estado === "PENDIENTE"[\s\S]*PaymentReceiptButton/);
  }
});

test('preflight, postflight, rollback, dry-run y macro cierran el ajuste de forma controlada', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(postflight, /payment-receipts debe seguir siendo privado/);
  assert.match(postflight, /DELETE no esta restringida a revision admin\/owner/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.match(dryRun, /BEGIN;[\s\S]*\$transactionSql[\s\S]*\$rollback/);
  assert.match(closing, /dry-run-limpieza-comprobantes-pago\.ps1/);
  assert.match(closing, /se omite su postflight historico/);
  assert.match(closing, /Postflight final Limpieza Comprobantes/);
  assert.match(portalPostflight, /v_tiene_comprobantes/);
  assert.match(portalPostflight, /no depende de nombres de[\s\S]*politicas/i);
  assert.doesNotMatch(portalPostflight, /policyname IN \([\s\S]*reportes_pago_alumno_creacion_propia/);
  assert.match(receiptsPostflight, /comprobante_limpieza_estado = 'ELIMINADO'/);
  assert.match(receiptsPostflight, /comprobante_original_mime IS NOT NULL/);
  assert.match(closing, /fix: remove payment receipts after review/);
  assert.match(closing, /vercel --prod/);
  assert.doesNotMatch(closing.match(/\$blockFiles = @\([\s\S]*?\n  \)/)[0], /\.gitignore/);
});

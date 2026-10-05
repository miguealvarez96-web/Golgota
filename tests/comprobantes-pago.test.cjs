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
const migration = read('supabase/migrations/20261005_comprobantes_pago_v1.sql');
const preflight = read('supabase/preflight/20261005_preflight_comprobantes_pago_v1.sql');
const postflight = read('supabase/postflight/20261005_postflight_comprobantes_pago_v1.sql');
const rollback = read('supabase/rollback/20261005_rollback_comprobantes_pago_v1.sql');
const dryRun = read('scripts/dry-run-comprobantes-pago-v1.ps1');
const closing = read('scripts/cerrar-bloque-comprobantes-pago.ps1');
const form = read('src/components/alumnos/report-payment-form.tsx');
const receiptButton = read('src/components/alumnos/payment-receipt-button.tsx');
const signedAction = read('src/app/actions/payment-receipts.ts');
const nextConfig = read('next.config.mjs');

test('acepta metadatos JPG, JPEG, PNG y PDF y normaliza la extensión almacenada', () => {
  const valid = [
    ['pago.jpg', 'image/jpeg', 'jpg'],
    ['pago.jpeg', 'image/jpeg', 'jpg'],
    ['pago.png', 'image/png', 'png'],
    ['pago.pdf', 'application/pdf', 'pdf'],
  ];
  for (const [name, type, storedExtension] of valid) {
    const result = model.validatePaymentReceiptMetadata({ name, type, size: 1024 });
    assert.equal(result.ok, true);
    assert.equal(result.storedExtension, storedExtension);
  }
});

test('rechaza tamaño mayor a 5 MB, MIME/extensión discordantes y nombres inseguros', () => {
  assert.equal(model.validatePaymentReceiptMetadata({ name: 'pago.pdf', type: 'application/pdf', size: 5242881 }).ok, false);
  assert.equal(model.validatePaymentReceiptMetadata({ name: 'pago.jpg', type: 'application/pdf', size: 100 }).ok, false);
  assert.equal(model.validatePaymentReceiptMetadata({ name: '../pago.pdf', type: 'application/pdf', size: 100 }).ok, false);
  assert.equal(model.validatePaymentReceiptMetadata({ name: 'pago.exe', type: 'application/octet-stream', size: 100 }).ok, false);
});

test('valida la firma binaria y no confía solo en extensión o MIME declarado', () => {
  assert.equal(model.hasExpectedPaymentReceiptSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'), true);
  assert.equal(model.hasExpectedPaymentReceiptSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), true);
  assert.equal(model.hasExpectedPaymentReceiptSignature(Uint8Array.from(Buffer.from('%PDF-1.7')), 'application/pdf'), true);
  assert.equal(model.hasExpectedPaymentReceiptSignature(Uint8Array.from(Buffer.from('not a pdf')), 'application/pdf'), false);
});

test('el formulario nuevo exige comprobante y elimina banco y referencia', () => {
  assert.match(form, /Comprobante adjunto \*/);
  assert.match(form, /JPG, JPEG, PNG o PDF\. Máximo 5 MB/);
  assert.match(form, /nombre|receipt\.name/i);
  assert.match(form, /receipt\.size/);
  assert.doesNotMatch(form, /Banco u origen|Referencia o comprobante/);
  assert.deepEqual(Object.keys(model.reportPaymentSchema.shape).sort(), ['fecha_pago', 'membresia_id', 'monto', 'observacion'].sort());
  assert.match(nextConfig, /bodySizeLimit: "6mb"/);
});

test('la migración conserva históricos y obliga comprobante solo en filas nuevas', () => {
  assert.match(migration, /ALTER COLUMN banco_origen DROP NOT NULL/);
  assert.match(migration, /ALTER COLUMN referencia DROP NOT NULL/);
  assert.match(migration, /comprobante_requerido boolean NOT NULL DEFAULT false/);
  assert.match(migration, /ALTER COLUMN comprobante_requerido SET DEFAULT true/);
  assert.match(migration, /NOT comprobante_requerido[\s\S]*comprobante_path IS NOT NULL/);
  assert.match(migration, /'banco_origen', r\.banco_origen/);
  assert.match(migration, /'referencia', r\.referencia/);
});

test('Storage es privado, limita formatos/tamaño y usa rutas UUID por usuario', () => {
  assert.match(migration, /'payment-receipts'[\s\S]*false,[\s\S]*5242880/);
  for (const mime of ['image/jpeg', 'image/png', 'application/pdf']) assert.match(migration, new RegExp(mime.replace('/', '\\/')));
  assert.match(migration, /split_part\(name, '\/', 1\) = auth\.uid\(\)::text/);
  assert.match(migration, /\[0-9a-f\][\s\S]*\\\.\(jpg\|png\|pdf\)/);
  assert.doesNotMatch(migration, /public\s*=\s*true/i);
});

test('RLS permite alumno propio y admin/owner, bloquea staff y acceso cruzado', () => {
  const selectPolicy = migration.match(/CREATE POLICY payment_receipts_select[\s\S]*?(?=CREATE POLICY payment_receipts_insert)/)[0];
  assert.match(selectPolicy, /mi_rol\(\)::text IN \('admin', 'owner'\)/);
  assert.match(selectPolicy, /mi_rol\(\)::text = 'alumno'/);
  assert.match(selectPolicy, /r\.usuario_id = auth\.uid\(\)/);
  assert.match(selectPolicy, /r\.comprobante_path = storage\.objects\.name/);
  assert.doesNotMatch(selectPolicy, /staff/);
  assert.match(migration, /REVOKE INSERT ON TABLE public\.reportes_pago_alumno FROM authenticated/);
  assert.match(migration, /REVOKE INSERT \(cliente_id,[\s\S]*observacion\)[\s\S]*FROM authenticated/);
});

test('la RPC exige objeto propio y no altera finanzas al crear el reporte', () => {
  const reportFunction = migration.match(/CREATE FUNCTION public\.reportar_pago_alumno\([\s\S]*?(?=CREATE OR REPLACE FUNCTION public\.obtener_portal_alumno)/)[0];
  assert.match(reportFunction, /storage\.objects/);
  assert.match(reportFunction, /o\.owner_id = auth\.uid\(\)::text/);
  assert.match(reportFunction, /comprobante_requerido\)[\s\S]*true/);
  assert.match(reportFunction, /banco_origen,[\s\S]*referencia[\s\S]*VALUES[\s\S]*NULL,[\s\S]*NULL/);
  assert.doesNotMatch(reportFunction, /INSERT INTO public\.pagos|UPDATE public\.membresias|registrar_pago\s*\(/i);
});

test('los comprobantes se entregan con URL firmada temporal, nunca pública', () => {
  assert.match(signedAction, /createSignedUrl\(report\.comprobante_path, 120\)/);
  assert.match(signedAction, /\["alumno", "admin", "owner"\]/);
  assert.doesNotMatch(signedAction, /service.role|SUPABASE_SERVICE|getPublicUrl/i);
  assert.match(receiptButton, /application\/pdf[\s\S]*<iframe/);
  assert.match(receiptButton, /Abrir PDF en otra pestaña/);
  assert.match(receiptButton, /role="dialog"[\s\S]*<img/);
});

function signedUrlHarness(role, reportAllowed = true) {
  const calls = [];
  const supabase = {
    auth: { async getUser() { return { data: { user: { id: 'b98e5f70-849c-4df8-906a-2b20654fdb39' } }, error: null }; } },
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        async single() {
          if (table === 'usuarios') return { data: { rol: role, activo: true }, error: null };
          return reportAllowed
            ? { data: { comprobante_path: 'owner/file.pdf', comprobante_mime: 'application/pdf' }, error: null }
            : { data: null, error: { code: 'PGRST116' } };
        },
      };
      return chain;
    },
    storage: { from(bucket) { return { async createSignedUrl(path, seconds) {
      calls.push({ bucket, path, seconds });
      return { data: { signedUrl: 'https://signed.example/receipt' }, error: null };
    } }; } },
  };
  const action = load('src/app/actions/payment-receipts.ts', {
    '@/lib/supabase/server': { createClient() { return supabase; } },
  });
  return { ...action, calls };
}

test('la acción firma para alumno autorizado y admin/owner, pero no para staff ni acceso cruzado', async () => {
  const reportId = '24b14e94-4408-4ea9-bde0-44d867a2ae09';
  for (const role of ['alumno', 'admin', 'owner']) {
    const harness = signedUrlHarness(role);
    assert.equal((await harness.getPaymentReceiptUrl(reportId)).ok, true);
    assert.deepEqual(harness.calls, [{ bucket: 'payment-receipts', path: 'owner/file.pdf', seconds: 120 }]);
  }
  const staff = signedUrlHarness('staff');
  assert.equal((await staff.getPaymentReceiptUrl(reportId)).ok, false);
  assert.equal(staff.calls.length, 0);
  const crossStudent = signedUrlHarness('alumno', false);
  assert.equal((await crossStudent.getPaymentReceiptUrl(reportId)).ok, false);
  assert.equal(crossStudent.calls.length, 0);
});

test('preflight, postflight y rollback verifican seguridad sin ejecutar cambios persistentes', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(postflight, /v_bucket\.public/);
  assert.match(postflight, /has_table_privilege\('authenticated'[\s\S]*'INSERT'/);
  assert.match(postflight, /has_column_privilege\([\s\S]*'INSERT'/);
  assert.match(postflight, /payment_receipts_select/);
  assert.match(postflight, /contiene una operacion financiera/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.match(dryRun, /BEGIN;[\s\S]*\$transactionSql[\s\S]*\$rollback/);
  assert.match(dryRun, /finally[\s\S]*Remove-Item/);
});

test('el macro cierra el bloque con confirmaciones y excluye cambios ajenos', () => {
  assert.match(closing, /dry-run-comprobantes-pago-v1\.ps1/);
  assert.match(closing, /\?Aplicar SQL real|Aplicar SQL real/);
  assert.match(closing, /nodeCommand[\s\S]*--test/);
  assert.match(closing, /npxCommand[\s\S]*tsc/);
  assert.match(closing, /npmCommand[\s\S]*run', 'build/);
  assert.match(closing, /gitCommand[\s\S]*diff', '--check/);
  assert.match(closing, /feat: add payment receipt uploads/);
  assert.match(closing, /vercelCommand --prod/);
  assert.doesNotMatch(closing.match(/\$blockFiles = @\([\s\S]*?\n  \)/)[0], /\.gitignore/);
});

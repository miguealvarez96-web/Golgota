const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }
function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const code = ts.transpileModule(read(relative), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  module._compile(code, filename);
  return module.exports;
}

const model = load('src/lib/privacidad/model.ts');
const migration = read('supabase/migrations/20261004_privacidad_lopdp_v1.sql');
const preflight = read('supabase/preflight/20261004_preflight_privacidad_lopdp_v1.sql');
const postflight = read('supabase/postflight/20261004_postflight_privacidad_lopdp_v1.sql');
const rollback = read('supabase/rollback/20261004_rollback_privacidad_lopdp_v1.sql');
const dryRun = read('scripts/dry-run-privacidad-lopdp-v1.ps1');
const macro = read('scripts/cerrar-bloque-privacidad.ps1');
const notice = read('src/app/privacidad/page.tsx');
const studentPanel = read('src/components/alumnos/student-privacy-panel.tsx');
const managementPage = read('src/app/(app)/solicitudes-privacidad/page.tsx');
const navigation = read('src/components/layout/portal-navigation.tsx');
const serviceWorker = read('public/sw.js');
const privacyDocs = read('docs/PRIVACIDAD.md');
const id = 'b98e5f70-849c-4df8-906a-2b20654fdb39';

test('el aviso público es versionado, provisional y no declara cumplimiento total', () => {
  assert.equal(model.PRIVACY_NOTICE_VERSION, '2026-10-04-v1');
  assert.match(notice, /PENDIENTE DE DEFINICI[ÓO]N Y VALIDACI[ÓO]N LEGAL\/ADMINISTRATIVA/);
  assert.match(notice, /no constituye consentimiento indiscriminado/i);
  assert.match(notice, /no reemplaza asesor[ií]a jur[ií]dica/i);
  assert.match(notice, /Registro Oficial/);
  assert.match(notice, /spdp\.gob\.ec/);
});

test('la aceptación exige lectura y mantiene promociones opcionales sin premarcar', () => {
  const valid = { aviso_version: model.PRIVACY_NOTICE_VERSION, aviso_leido: true, comunicaciones_promocionales: false };
  assert.equal(model.acceptPrivacySchema.safeParse(valid).success, true);
  assert.equal(model.acceptPrivacySchema.safeParse({ ...valid, aviso_leido: false }).success, false);
  assert.equal(model.acceptPrivacySchema.safeParse({ ...valid, aviso_version: 'anterior' }).success, false);
  assert.match(studentPanel, /checked=\{promotions\}/);
  assert.doesNotMatch(studentPanel, /defaultChecked/);
  assert.match(studentPanel, /disabled=\{pending \|\| !noticeRead\}/);
});

function studentActionsHarness(hasAccess = true) {
  const calls = [], paths = [];
  const actions = load('src/app/(student)/portal/privacy-actions.ts', {
    '@/lib/alumnos/access': { async getStudentAccess() { return hasAccess ? { supabase: { async rpc(name, args) { calls.push({ name, args }); return { error: null }; } } } : null; } },
    '@/lib/privacidad/model': model,
    'next/cache': { revalidatePath(value) { paths.push(value); } },
  });
  return { ...actions, calls, paths };
}

test('acciones de alumno validan la entrada y escriben únicamente mediante RPC', async () => {
  const h = studentActionsHarness();
  assert.equal((await h.acceptPrivacyNotice({ aviso_version: model.PRIVACY_NOTICE_VERSION, aviso_leido: true, comunicaciones_promocionales: false })).ok, true);
  assert.equal(h.calls[0].name, 'registrar_aceptacion_privacidad');
  assert.equal(h.calls[0].args.p_comunicaciones_promocionales, false);
  assert.equal((await h.createPrivacyRequest({ tipo: 'ACCESO', descripcion: 'Solicito una copia de mis datos.' })).ok, true);
  assert.equal(h.calls[1].name, 'crear_solicitud_privacidad');
  const denied = studentActionsHarness(false);
  assert.equal((await denied.createPrivacyRequest({ tipo: 'ACCESO', descripcion: 'Solicito una copia de mis datos.' })).ok, false);
  assert.equal(denied.calls.length, 0);
});

test('la migración conserva versión, fecha, contexto y finalidades como evidencia', () => {
  assert.match(migration, /CREATE TABLE public\.privacidad_aceptaciones/);
  for (const field of ['aviso_version', 'accepted_at', 'contexto', 'finalidades_aceptadas', 'comunicaciones_promocionales']) assert.match(migration, new RegExp(field));
  assert.match(migration, /2026-10-04-v1/);
  assert.match(migration, /AVISO_PRIVACIDAD_LEIDO/);
  assert.match(migration, /COMUNICACIONES_PROMOCIONALES/);
  assert.match(migration, /UNIQUE \(usuario_id, aviso_version\)/);
});

test('RLS limita al alumno a sus filas, da gestión a admin/owner y no incluye staff', () => {
  assert.match(migration, /privacidad_aceptaciones_alumno_propias[\s\S]*usuario_id = auth\.uid\(\)/);
  assert.match(migration, /privacidad_solicitudes_alumno_propias[\s\S]*usuario_id = auth\.uid\(\)/);
  assert.match(migration, /privacidad_aceptaciones_gestion[\s\S]*mi_rol\(\) IN \('admin', 'owner'\)/);
  assert.match(migration, /privacidad_solicitudes_gestion[\s\S]*mi_rol\(\) IN \('admin', 'owner'\)/);
  assert.doesNotMatch(migration, /mi_rol\(\).*staff/);
  assert.match(navigation, /"\/solicitudes-privacidad"/);
  assert.match(navigation, /staffSections = new Set\(\["\/", "\/clientes", "\/membresias", "\/wod", "\/comunicados"\]\)/);
  assert.match(navigation, /role === "staff"[\s\S]*staffSections\.has\(href\)/);
});

test('las RPC revalidan titular y gestor y evitan acceso cruzado', () => {
  assert.match(migration, /registrar_aceptacion_privacidad[\s\S]*auth\.uid\(\) IS NULL[\s\S]*mi_rol\(\)::text <> 'alumno'/);
  assert.match(migration, /INSERT INTO public\.privacidad_aceptaciones[\s\S]*auth\.uid\(\)/);
  assert.match(migration, /crear_solicitud_privacidad[\s\S]*VALUES \(auth\.uid\(\), p_tipo/);
  assert.match(migration, /revisar_solicitud_privacidad[\s\S]*mi_rol\(\) NOT IN \('admin', 'owner'\)/);
  assert.match(migration, /listar_solicitudes_privacidad[\s\S]*mi_rol\(\) NOT IN \('admin', 'owner'\)/);
  assert.match(managementPage, /getPrivacyManagementAccess\(\)/);
});

function reviewActionHarness(hasManagementAccess) {
  const calls = [];
  const { reviewPrivacyRequest } = load('src/app/(app)/solicitudes-privacidad/actions.ts', {
    '@/lib/privacidad/access': { async getPrivacyManagementAccess() { return hasManagementAccess ? { supabase: { async rpc(name, args) { calls.push({ name, args }); return { error: null }; } } } : null; } },
    '@/lib/privacidad/model': model,
    'next/cache': { revalidatePath() {} },
  });
  return { reviewPrivacyRequest, calls };
}

test('admin/owner autorizados gestionan por RPC y un rol sin acceso no escribe', async () => {
  const allowed = reviewActionHarness(true);
  assert.equal((await allowed.reviewPrivacyRequest({ solicitud_id: id, estado: 'ATENDIDA', respuesta: 'Solicitud atendida.' })).ok, true);
  assert.equal(allowed.calls[0].name, 'revisar_solicitud_privacidad');
  const denied = reviewActionHarness(false);
  assert.equal((await denied.reviewPrivacyRequest({ solicitud_id: id, estado: 'ATENDIDA', respuesta: 'Solicitud atendida.' })).ok, false);
  assert.equal(denied.calls.length, 0);
});

test('la gestión exige respuesta al cerrar y registra revisor, fecha y auditoría', () => {
  assert.equal(model.reviewPrivacyRequestSchema.safeParse({ solicitud_id: id, estado: 'ATENDIDA', respuesta: '' }).success, false);
  assert.equal(model.reviewPrivacyRequestSchema.safeParse({ solicitud_id: id, estado: 'ATENDIDA', respuesta: 'Copia entregada.' }).success, true);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /reviewed_at = now\(\)[\s\S]*reviewed_by = auth\.uid\(\)/);
  assert.match(migration, /audit_privacidad_aceptaciones/);
  assert.match(migration, /audit_privacidad_solicitudes/);
  assert.match(migration, /La solicitud ya fue cerrada/);
});

test('no hay borrado automático ni privilegios directos de escritura', () => {
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE)/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.privacidad_aceptaciones FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.privacidad_solicitudes FROM PUBLIC, anon, authenticated/);
  assert.match(studentPanel, /no modifica ni elimina datos autom[aá]ticamente/i);
});

test('el service worker no precachea privacidad ni persiste navegaciones', () => {
  const precache = serviceWorker.match(/const PRECACHE_URLS = \[[\s\S]*?\];/)[0];
  assert.doesNotMatch(precache, /privacidad/);
  assert.match(serviceWorker, /request\.mode === "navigate"[\s\S]*fetch\(request, \{ cache: "no-store" \}\)/);
});

test('inventario y minimización documentan duplicación, legado, auditoría y proveedores', () => {
  assert.match(privacyDocs, /fecha_nacimiento/);
  assert.match(privacyDocs, /usuarios\.email.*clientes\.email/s);
  assert.match(privacyDocs, /estado_legacy/);
  assert.match(privacyDocs, /auditoria_logs\.old_data\/new_data/);
  assert.match(privacyDocs, /Supabase y Vercel/);
  assert.match(privacyDocs, /No se capturan IP/);
});

test('preflight, postflight, rollback y dry-run mantienen el flujo reversible', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(postflight, /privilege_type IN \('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'\)/);
  assert.match(postflight, /SECURITY DEFINER y search_path seguro/);
  assert.match(postflight, /borrado autom[aá]tico no permitido/i);
  assert.match(dryRun, /BEGIN;[\s\S]*\$migrationBody[\s\S]*\$postflightBody[\s\S]*\$rollback/);
  assert.match(dryRun, /finally[\s\S]*Remove-Item -LiteralPath \$temporaryPath/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.doesNotMatch(rollback, /\b(?:DROP|DELETE|COMMIT)\b/i);
});

test('el macro aborta estados parciales, limita staging y separa la salida de Vercel', () => {
  assert.match(macro, /SUPABASE_DB_URL/);
  assert.match(macro, /'missing', 'applied', 'partial'/);
  assert.match(macro, /DRY-RUN CORRECTO/);
  assert.match(macro, /ON_ERROR_STOP=1/);
  assert.match(macro, /feat: add privacy and data protection workflows/);
  assert.doesNotMatch(macro.match(/\$blockFiles = @\([\s\S]*?\n  \)/)[0], /\.gitignore/);
  assert.match(macro, /Start-Process[\s\S]*RedirectStandardOutput[\s\S]*RedirectStandardError/);
  assert.match(macro, /\$process\.ExitCode -ne 0/);
});

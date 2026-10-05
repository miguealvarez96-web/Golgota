// Pruebas locales sin credenciales ni conexión: validan modelos/acciones reales
// y las barreras declarativas de la migración preparada para dry-run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
if (typeof File === 'undefined') global.File = require('node:buffer').File;

function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
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
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261002_portal_alumno_v1.sql'), 'utf8');
const preflight = fs.readFileSync(path.join(__dirname, '..', 'supabase/preflight/20261002_preflight_portal_alumno_v1.sql'), 'utf8');
const postflight = fs.readFileSync(path.join(__dirname, '..', 'supabase/postflight/20261002_postflight_portal_alumno_v1.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(__dirname, '..', 'supabase/rollback/20261002_rollback_portal_alumno_v1.sql'), 'utf8');
const dryRunScript = fs.readFileSync(path.join(__dirname, '..', 'scripts/dry-run-portal-alumno-v1.ps1'), 'utf8');
const linkAccount = fs.readFileSync(path.join(__dirname, '..', 'supabase/operations/20261002_vincular_cuenta_alumno.sql'), 'utf8');
const internalLayout = fs.readFileSync(path.join(__dirname, '..', 'src/app/(app)/layout.tsx'), 'utf8');
const studentLayout = fs.readFileSync(path.join(__dirname, '..', 'src/app/(student)/layout.tsx'), 'utf8');
const studentAccess = fs.readFileSync(path.join(__dirname, '..', 'src/lib/alumnos/access.ts'), 'utf8');
const studentId = 'b98e5f70-849c-4df8-906a-2b20654fdb39';
const reportId = '24b14e94-4408-4ea9-bde0-44d867a2ae09';

test('valida monto, fecha y observación sin exigir banco ni referencia', () => {
  const valid = { monto: 25.5, fecha_pago: '2026-01-10', observacion: '', membresia_id: studentId };
  assert.equal(model.reportPaymentSchema.safeParse(valid).success, true);
  for (const change of [
    { monto: 0 }, { monto: -1 }, { monto: 1.001 },
    { fecha_pago: '2999-01-01' },
  ]) assert.equal(model.reportPaymentSchema.safeParse({ ...valid, ...change }).success, false, JSON.stringify(change));
  assert.equal(model.reportPaymentSchema.safeParse({ ...valid, banco_origen: 'Banco' }).success, false);
});

test('selecciona membresía vigente antes que futura o vencida', () => {
  const base = { id: studentId, plan: 'MENSUAL', fecha_inicio: '2026-01-01', fecha_fin: '2026-01-30', saldo: 10, estado_pago: 'PENDIENTE', dias_restantes: 3 };
  const expired = { ...base, id: reportId, estado_vigencia: 'VENCIDA', fecha_fin: '2025-12-31' };
  const current = { ...base, estado_vigencia: 'VIGENTE' };
  const future = { ...base, id: 'b9b6914b-946e-41a9-a5e1-e3fb9f8bd506', estado_vigencia: 'POR_INICIAR', fecha_inicio: '2026-02-01' };
  assert.equal(model.chooseStudentMembership([expired, future, current]).id, studentId);
});

function studentActionHarness({ access = true, rpcError = null } = {}) {
  const calls = [], refreshed = [], uploads = [], removals = [];
  const { reportStudentPayment } = load('src/app/(student)/portal/actions.ts', {
    '@/lib/alumnos/access': { async getStudentAccess() { return access ? { userId: studentId, supabase: {
      storage: { from() { return {
        async upload(path, bytes, options) { uploads.push({ path, bytes, options }); return { error: null }; },
        async remove(paths) { removals.push(paths); return { error: null }; },
      }; } },
      async rpc(name, args) { calls.push({ name, args }); return { error: rpcError }; },
    } } : null; } },
    '@/lib/alumnos/model': model,
    'next/cache': { revalidatePath(value) { refreshed.push(value); } },
  });
  return { reportStudentPayment, calls, refreshed, uploads, removals };
}

function paymentForm(overrides = {}) {
  const form = new FormData();
  form.set('monto', String(overrides.monto ?? 20));
  form.set('fecha_pago', overrides.fecha_pago ?? '2026-01-10');
  form.set('observacion', overrides.observacion ?? 'Pago mensual');
  form.set('membresia_id', studentId);
  form.set('comprobante', overrides.comprobante ?? new File([Buffer.from('%PDF-1.7')], 'pago.pdf', { type: 'application/pdf' }));
  return form;
}

test('alumno reporta mediante RPC y recibe estado pendiente, sin escribir pagos reales', async () => {
  const harness = studentActionHarness();
  const result = await harness.reportStudentPayment(paymentForm());
  assert.deepEqual(result, { ok: true, message: 'Pago reportado. Pendiente de verificación.' });
  assert.equal(harness.calls[0].name, 'reportar_pago_alumno');
  assert.equal(harness.calls[0].args.p_monto, 20);
  assert.equal(harness.calls[0].args.p_comprobante_mime, 'application/pdf');
  assert.equal(harness.uploads.length, 1);
  assert.deepEqual(harness.refreshed, ['/portal']);
});

test('monto o comprobante inválidos y sesión no alumno impiden invocar la RPC', async () => {
  const invalid = studentActionHarness();
  assert.equal((await invalid.reportStudentPayment(paymentForm({ monto: 0 }))).ok, false);
  assert.equal(invalid.calls.length, 0);
  const denied = studentActionHarness({ access: false });
  assert.equal((await denied.reportStudentPayment(paymentForm())).ok, false);
  assert.equal(denied.calls.length, 0);
});

function reviewHarness(role) {
  const calls = [];
  const { reviewReportedPayment } = load('src/app/(app)/pagos-reportados/actions.ts', {
    '@/lib/clientes/access': { async getClientAccess() { return { role, supabase: { async rpc(name, args) { calls.push({ name, args }); return { error: null }; } } }; } },
    '@/lib/clientes/model': clientModel,
    '@/lib/alumnos/model': model,
    'next/cache': { revalidatePath() {} },
  });
  return { reviewReportedPayment, calls };
}

test('admin y owner pueden aprobar; staff no puede invocar revisión', async () => {
  for (const role of ['admin', 'owner']) {
    const harness = reviewHarness(role);
    assert.equal((await harness.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' })).ok, true);
    assert.equal(harness.calls[0].name, 'aprobar_reporte_pago_alumno');
  }
  const staff = reviewHarness('staff');
  assert.equal((await staff.reviewReportedPayment({ reporte_id: reportId, decision: 'aprobar', motivo: '' })).ok, false);
  assert.equal(staff.calls.length, 0);
});

test('RLS limita perfil, membresías y reportes al alumno autenticado', () => {
  assert.match(migration, /clientes_alumno_propio[\s\S]*?auth_user_id = auth\.uid\(\)[\s\S]*?mi_rol\(\)::text = 'alumno'/);
  assert.match(migration, /membresias_alumno_propias[\s\S]*?c\.id = membresias\.cliente_id[\s\S]*?c\.auth_user_id = auth\.uid\(\)/);
  assert.match(migration, /reportes_pago_alumno_lectura_propia[\s\S]*?usuario_id = auth\.uid\(\)/);
  assert.match(migration, /reportes_pago_alumno_creacion_propia[\s\S]*?usuario_id = auth\.uid\(\)[\s\S]*?m\.cliente_id = reportes_pago_alumno\.cliente_id/);
  assert.doesNotMatch(migration, /GRANT\s+UPDATE[\s\S]*?reportes_pago_alumno\s+TO authenticated/i);
  assert.doesNotMatch(migration, /GRANT\s+DELETE[\s\S]*?reportes_pago_alumno\s+TO authenticated/i);
});

test('reporte pendiente y rechazo no modifican pagos, saldos ni membresías', () => {
  const reportFunction = migration.match(/CREATE FUNCTION public\.reportar_pago_alumno\([\s\S]*?(?=CREATE FUNCTION public\.aprobar_reporte_pago_alumno)/)[0];
  const rejectFunction = migration.match(/CREATE FUNCTION public\.rechazar_reporte_pago_alumno\([\s\S]*?(?=-- Una sola llamada)/)[0];
  for (const section of [reportFunction, rejectFunction]) {
    assert.doesNotMatch(section, /INSERT INTO public\.pagos/);
    assert.doesNotMatch(section, /UPDATE public\.membresias/);
    assert.doesNotMatch(section, /registrar_pago\(/);
  }
  assert.match(rejectFunction, /SET estado = 'RECHAZADO'/);
});

test('aprobación bloquea, exige PENDIENTE, aplica el flujo real una sola vez y traza el pago', () => {
  const approve = migration.match(/CREATE FUNCTION public\.aprobar_reporte_pago_alumno\([\s\S]*?(?=CREATE FUNCTION public\.rechazar_reporte_pago_alumno)/)[0];
  assert.match(approve, /FOR UPDATE/);
  assert.match(approve, /v_reporte\.estado <> 'PENDIENTE'/);
  assert.match(approve, /public\.registrar_pago\(/);
  assert.match(approve, /SET estado = 'APROBADO'[\s\S]*?pago_real_id = v_pago\.id/);
  assert.match(migration, /pago_real_id uuid UNIQUE REFERENCES public\.pagos/);
  assert.match(approve, /mi_rol\(\) NOT IN \('admin', 'owner'\)/);
});

test('el acceso cruzado y la aprobación por alumno/staff quedan bloqueados en PostgreSQL', () => {
  assert.match(migration, /m\.id = p_membresia_id AND m\.cliente_id = v_cliente_id/);
  assert.match(migration, /reportar_pago_alumno[\s\S]*?mi_rol\(\)::text <> 'alumno'/);
  assert.match(migration, /aprobar_reporte_pago_alumno[\s\S]*?mi_rol\(\) NOT IN \('admin', 'owner'\)/);
  assert.match(migration, /rechazar_reporte_pago_alumno[\s\S]*?mi_rol\(\) NOT IN \('admin', 'owner'\)/);
});

test('las rutas separan el portal alumno del portal administrativo en el servidor', () => {
  assert.match(internalLayout, /perfil\.rol === "alumno"[\s\S]*?redirect\("\/portal"\)/);
  assert.match(internalLayout, /!\["admin", "owner", "staff"\]\.includes\(perfil\.rol\)/);
  assert.match(studentLayout, /getStudentAccess\(\)[\s\S]*?if \(!access\) redirect\("\/"\)/);
  assert.match(studentAccess, /profile\.rol !== "alumno"/);
});

test('preflight y postflight rechazan una política heredada que exponga otros clientes', () => {
  for (const sql of [preflight, postflight]) {
    assert.match(sql, /policyname = 'clientes_lectura'/);
    assert.match(sql, /policyname = 'clientes_consulta'/);
    assert.match(sql, /qual ~\* 'admin'[\s\S]*?qual ~\* 'owner'[\s\S]*?qual ~\* 'staff'/);
  }
});

test('la vinculación reutiliza cuenta y cliente existentes de forma atómica y no duplica clientes', () => {
  assert.match(linkAccount, /BEGIN;[\s\S]*UPDATE public\.usuarios[\s\S]*rol = 'alumno'/);
  assert.match(linkAccount, /UPDATE public\.clientes[\s\S]*auth_user_id = v_auth_user_id[\s\S]*COMMIT;/);
  assert.match(linkAccount, /auth\.users WHERE id = v_auth_user_id/);
  assert.match(linkAccount, /auth_user_id = v_auth_user_id AND c\.id <> v_cliente_id/);
  assert.doesNotMatch(linkAccount, /INSERT\s+INTO\s+(?:public\.)?clientes/i);
  assert.doesNotMatch(linkAccount, /INSERT\s+INTO\s+auth\.users/i);
});

test('el enum alumno se agrega y se usa como texto dentro de una sola transacción reversible', () => {
  const begin = migration.indexOf('BEGIN;');
  const alter = migration.indexOf("ALTER TYPE public.rol_usuario_enum ADD VALUE IF NOT EXISTS 'alumno';");
  const commit = migration.lastIndexOf('COMMIT;');
  assert.ok(begin >= 0 && begin < alter && alter < commit);
  assert.equal((migration.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.doesNotMatch(migration.slice(alter, commit), /mi_rol\(\)\s*(?:=|<>)\s*'alumno'/);
  assert.ok((migration.match(/mi_rol\(\)::text\s*(?:=|<>)\s*'alumno'/g) ?? []).length >= 6);
  assert.match(preflight, /server_version_num[\s\S]*120000/);
});

test('el dry-run automático envuelve migración y postflight y termina únicamente con ROLLBACK', () => {
  assert.match(dryRunScript, /psql -X -v ON_ERROR_STOP=1/);
  assert.match(dryRunScript, /BEGIN;[\s\S]*\$migrationBody[\s\S]*\$postflightBody[\s\S]*\$rollback/);
  assert.match(dryRunScript, /exactamente un BEGIN y un COMMIT/);
  assert.match(dryRunScript, /finally[\s\S]*Remove-Item -LiteralPath \$temporaryPath/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.doesNotMatch(rollback, /\b(?:DROP|DELETE|COMMIT)\b/i);
});

test('postflight verifica privilegios, RLS, invariantes financieras e idempotencia', () => {
  assert.match(postflight, /has_table_privilege\('authenticated',[\s\S]*'DELETE'/);
  assert.match(postflight, /cmd IN \('UPDATE', 'DELETE', 'ALL'\)/);
  assert.match(postflight, /Reportar un pago contiene una operación financiera/);
  assert.match(postflight, /Rechazar un pago contiene una operación financiera/);
  assert.match(postflight, /for\\s\+update/);
  assert.match(postflight, /pago_real_id\\s\*=\\s\*v_pago/);
});

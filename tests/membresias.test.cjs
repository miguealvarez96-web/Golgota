// Pruebas locales de validación y límites de las acciones; nunca hay conexión.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  module._compile(code, filename);
  return module.exports;
}
const clientsModel = load('src/lib/clientes/model.ts');
const model = load('src/lib/membresias/model.ts', { '@/lib/clientes/model': clientsModel });
const id = 'b98e5f70-849c-4df8-906a-2b20654fdb39';
const otherId = 'bed87528-e7b8-4255-b88c-e4ba069819dc';
const input = { cliente_id: id, plan_id: otherId, fecha_inicio: '2026-09-29',
  abono_inicial: '0', metodo_pago: '', fecha_pago: '2026-09-29' };

function harness(role = 'admin', rpcError = null) {
  const calls = [], refreshed = [];
  const access = { role, supabase: { async rpc(name, args) {
    calls.push({ name, args });
    return rpcError ? { data: null, error: rpcError } : { data: { id }, error: null };
  } } };
  const actions = load('src/app/(app)/membresias/actions.ts', {
    '@/lib/clientes/access': { async getClientAccess() { return access; } },
    '@/lib/clientes/model': clientsModel,
    '@/lib/membresias/model': model,
    'next/cache': { revalidatePath(value) { refreshed.push(value); } },
  });
  return { ...actions, calls, refreshed };
}

test('abono inicial exige método y no admite campos financieros protegidos', () => {
  assert.equal(model.createMembershipSchema.safeParse({ ...input, abono_inicial: '4' }).success, false);
  assert.equal(model.createMembershipSchema.safeParse({ ...input, saldo: 0 }).success, false);
  assert.equal(model.createMembershipSchema.safeParse({ ...input, abono_inicial: '4.001', metodo_pago: 'Efectivo' }).success, false);
  assert.equal(model.createMembershipSchema.safeParse({ ...input, abono_inicial: '4', metodo_pago: 'Efectivo' }).success, true);
});

test('owner crea mediante la RPC con fecha Ecuador, nunca INSERT directo', async () => {
  const h = harness('owner');
  const result = await h.createMembership({ ...input, abono_inicial: '4', metodo_pago: 'Efectivo' });
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'crear_membresia');
  assert.equal(h.calls[0].args.p_abono_inicial, 4);
  assert.equal(h.calls[0].args.p_fecha_pago, '2026-09-29T12:00:00-05:00');
  assert.deepEqual(h.refreshed, ['/membresias', '/clientes', '/']);
});

test('staff no ejecuta crear_membresia ni registrar_pago', async () => {
  const h = harness('staff');
  assert.equal((await h.createMembership(input)).ok, false);
  assert.equal((await h.registerPayment({ membresia_id: id, monto: '1', metodo_pago: 'Efectivo', fecha_pago: '2026-09-29' })).ok, false);
  assert.equal(h.calls.length, 0);
});

test('pago parcial se envía por RPC; montos inválidos no generan llamada', async () => {
  const h = harness('owner');
  assert.equal((await h.registerPayment({ membresia_id: id, monto: '0', metodo_pago: 'Efectivo', fecha_pago: '2026-09-29' })).ok, false);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.registerPayment({ membresia_id: id, monto: '2.50', metodo_pago: 'Transferencia', fecha_pago: '2026-09-29' })).ok, true);
  assert.equal(h.calls[0].name, 'registrar_pago');
  assert.equal(h.calls[0].args.p_monto, 2.5);
});

test('fallos de RPC no filtran errores internos ni anuncian éxito', async () => {
  const h = harness('admin', { code: '22023', message: 'sensitive database details' });
  const result = await h.createMembership(input);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /sensitive|22023/);
  assert.equal(h.refreshed.length, 0);
});

test('la página de staff consulta solo la proyección sin importes', async () => {
  const tables = [];
  const supabase = { from(table) {
    tables.push(table);
    if (table === 'v_membresias_verificacion') return {
      select() { return this; }, order() { return this; },
      async range() { return { data: [{ cliente_id: id, plan: 'DIARIO', fecha_fin: '2026-09-29', estado_vigencia: 'VENCE_HOY' }], count: 1, error: null }; },
    };
    if (table === 'clientes') return { select() { return this; },
      async in() { return { data: [{ id, nombre_completo: 'Alumno de prueba' }], error: null }; } };
    throw Error(`Consulta financiera de staff: ${table}`);
  } };
  const { default: Page } = load('src/app/(app)/membresias/page.tsx', {
    '@/lib/clientes/access': { async getClientAccess() { return { role: 'staff', supabase }; } },
    '@/lib/membresias/model': model,
  });
  const rendered = await Page({ searchParams: {} });
  assert.deepEqual(tables, ['v_membresias_verificacion', 'clientes']);
  assert.equal(rendered.props.rows[0].cliente, 'Alumno de prueba');
  assert.equal(Object.hasOwn(rendered.props.rows[0], 'saldo'), false);
});

const october = { fecha_inicio: '2026-10-01', fecha_fin: '2026-10-30', estado_pago: 'PENDIENTE' };

test('permite crear sin solapamiento desde el día siguiente al fin inclusivo', () => {
  assert.equal(model.overlapsMembership(october, '2026-10-31', 30), false);
});

test('rechaza períodos superpuestos, incluidos sus extremos', () => {
  assert.equal(model.overlapsMembership(october, '2026-10-20', 30), true);
  assert.equal(model.overlapsMembership(october, '2026-10-30', 1), true);
});

test('renovación anticipada sugiere el día posterior al vencimiento', () => {
  assert.equal(model.suggestedRenewalStart(october, '2026-10-20'), '2026-10-31');
});

test('tras una membresía vencida permite comenzar hoy', () => {
  assert.equal(model.suggestedRenewalStart(october, '2026-10-31'), '2026-10-31');
  assert.equal(model.overlapsMembership(october, '2026-10-31', 7), false);
});

test('permite una membresía futura que no se cruza con la anterior', () => {
  assert.equal(model.overlapsMembership(october, '2026-12-01', 30), false);
});

test('ignora las membresías canceladas al evaluar el período', () => {
  assert.equal(model.overlapsMembership({ ...october, estado_pago: 'CANCELADA' }, '2026-10-20', 30), false);
  assert.equal(model.suggestedRenewalStart({ ...october, estado_pago: 'CANCELADA' }, '2026-10-20'), '2026-10-20');
});

test('la RPC informa el conflicto sin filtrar detalles internos', async () => {
  const h = harness('owner', { code: '23P01', message: 'private SQL detail' });
  const result = await h.createMembership(input);
  assert.deepEqual(result, { ok: false, message: 'El cliente ya tiene una membresía que se superpone con estas fechas.' });
});

test('la migración protege INSERT y UPDATE con lock por cliente y fechas inclusivas', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20260930_membresias_cobranza.sql'), 'utf8');
  const trigger = sql.match(/CREATE FUNCTION public\.evitar_solapamiento_membresias\(\)([\s\S]*?)CREATE TRIGGER zz_membresias_evitar_solapamiento/);
  assert.ok(trigger, 'falta la función de protección');
  assert.match(trigger[1], /FROM public\.clientes c[\s\S]*?FOR UPDATE/);
  assert.match(trigger[1], /m\.estado_pago <> 'CANCELADA'/);
  assert.match(trigger[1], /m\.fecha_inicio <= NEW\.fecha_inicio \+ NEW\.dias_duracion - 1/);
  assert.match(trigger[1], /NEW\.fecha_inicio <= m\.fecha_vencimiento/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF cliente_id, fecha_inicio, fecha_vencimiento,/);
  assert.match(sql, /ERRCODE = '23P01'/);
});

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
  assert.equal((await h.createMembership({ ...input, abono_inicial: '4', metodo_pago: 'Efectivo' })).ok, false);
  assert.equal((await h.registerPayment({ membresia_id: id, monto: '1', metodo_pago: 'Efectivo', fecha_pago: '2026-09-29' })).ok, false);
  assert.equal(h.calls.length, 0);
});

test('staff no puede abrir directamente las páginas financieras de membresías', async () => {
  const access = { role: 'staff', supabase: { from() { throw Error('consulta financiera'); } } };
  const mocks = {
    '@/lib/clientes/access': { async getClientAccess() { return access; } },
    '@/lib/clientes/model': clientsModel,
    '@/lib/membresias/model': model,
    '@/components/membresias/payment-form': () => null,
    '@/components/membresias/membership-form': () => null,
  };
  const detail = load('src/app/(app)/membresias/[id]/page.tsx', mocks).default;
  const create = load('src/app/(app)/membresias/nueva/page.tsx', mocks).default;
  assert.match((await detail({ params: { id }, searchParams: {} })).props.text, /permiso/);
  assert.match((await create({ searchParams: { cliente: id } })).props.text, /permiso/);
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

test('la carga de staff consulta solo la proyección sin importes', async () => {
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
  const data = load('src/lib/membresias/data.ts', { 'server-only': {} });
  const rows = await data.loadOperationalMemberships(supabase);
  const clients = await data.loadClientIdentities(supabase, [id]);
  assert.deepEqual(tables, ['v_membresias_verificacion', 'clientes']);
  assert.equal(clients.get(id).nombre_completo, 'Alumno de prueba');
  assert.equal(Object.hasOwn(rows[0], 'saldo'), false);
});

test('la página de membresías de staff ignora filtros financieros y no carga importes', async () => {
  const calls = [];
  const operational = [{ cliente_id: id, plan: 'DIARIO', fecha_fin: '2026-09-30', estado_vigencia: 'VENCE_HOY' }];
  const grouping = load('src/lib/membresias/grouping.ts');
  const { default: Page } = load('src/app/(app)/membresias/page.tsx', {
    '@/components/membresias/vigency-badge': () => null,
    '@/lib/clientes/access': { async getClientAccess() { return { role: 'staff', supabase: {} }; } },
    '@/lib/membresias/model': model,
    '@/lib/membresias/grouping': grouping,
    '@/lib/membresias/data': {
      async loadOperationalMemberships() { calls.push('operativa'); return operational; },
      async loadClientIdentities() { calls.push('clientes'); return new Map([[id, { id, nombre_completo: 'Alumno', cedula: '001' }]]); },
      async loadFinancialMemberships() { throw Error('consulta financiera'); },
      async loadPlanNames() { throw Error('consulta de precios'); },
    },
  });
  const page = await Page({ searchParams: { filtro: 'saldo_pendiente' } });
  assert.deepEqual(calls, ['operativa', 'clientes']);
  assert.equal(page.props.staff, true);
  assert.equal(page.props.filter, '');
  assert.equal(Object.hasOwn(page.props.groups[0].overview, 'saldo'), false);
});

test('owner carga membresías financieras e historial de pagos', async () => {
  const calls = [];
  const financial = [{ id: otherId, cliente_id: id, plan_id: otherId, fecha_inicio: '2026-09-01',
    fecha_fin: '2026-09-30', estado_vigencia: 'VENCE_HOY', estado_pago: 'PENDIENTE', saldo: 5 }];
  const data = {
    async loadFinancialMemberships(_db, clientId) { calls.push('financieras'); assert.equal(clientId, undefined); return financial; },
    async loadClientIdentities() { calls.push('clientes'); return new Map([[id, { id, nombre_completo: 'Alumno', cedula: '001' }]]); },
    async loadPlanNames() { calls.push('planes'); return new Map([[otherId, 'MENSUAL']]); },
    async loadOperationalMemberships() { throw Error('owner no debe recibir proyección reducida'); },
  };
  const { default: ListPage } = load('src/app/(app)/membresias/page.tsx', {
    '@/components/membresias/vigency-badge': () => null,
    '@/lib/clientes/access': { async getClientAccess() { return { role: 'owner', supabase: {} }; } },
    '@/lib/membresias/model': model,
    '@/lib/membresias/grouping': grouping,
    '@/lib/membresias/data': data,
  });
  const list = await ListPage({ searchParams: { filtro: 'saldo_pendiente' } });
  assert.equal(list.props.staff, false);
  assert.equal(list.props.filter, 'saldo_pendiente');
  assert.equal(list.props.groups[0].overview.saldo, 5);
  assert.deepEqual(calls, ['financieras', 'clientes', 'planes']);

  const supabase = { from(table) {
    assert.equal(table, 'clientes');
    return { select() { return this; }, eq() { return this; }, async maybeSingle() {
      return { data: { id, nombre_completo: 'Alumno', cedula: '001' }, error: null };
    } };
  } };
  const { default: HistoryPage } = load('src/app/(app)/membresias/cliente/[id]/page.tsx', {
    '@/components/membresias/vigency-badge': () => null,
    '@/lib/clientes/access': { async getClientAccess() { return { role: 'owner', supabase }; } },
    '@/lib/membresias/model': model,
    '@/lib/membresias/grouping': grouping,
    '@/lib/membresias/data': {
      async loadFinancialMemberships() { calls.push('historial financiero'); return financial; },
      async loadPlanNames() { calls.push('historial planes'); return new Map([[otherId, 'MENSUAL']]); },
      async loadMembershipPayments() { calls.push('pagos'); return new Map([[otherId, [{ id: 'pago', monto: 5, fecha_pago: '2026-09-30', metodo_pago: 'Efectivo' }]]]); },
      async loadOperationalMemberships() { throw Error('owner no debe recibir proyección reducida'); },
    },
  });
  const history = await HistoryPage({ params: { id } });
  assert.equal(history.props.staff, false);
  assert.equal(history.props.payments.get(otherId)[0].monto, 5);
  assert.deepEqual(calls.slice(3), ['historial financiero', 'historial planes', 'pagos']);
});

test('Dashboard consulta cinco KPI solo para admin y owner; staff carga solo panel operativo', async () => {
  const kpis = { clientes_activos: 1, membresias_vigentes: 2, membresias_por_vencer: 3, ingresos_mes: 4, pagos_pendientes: 5 };
  for (const role of ['admin', 'owner', 'staff', 'otro']) {
    const calls = [];
    const supabase = {
      auth: { async getUser() { return { data: { user: { id } } }; } },
      from(table) {
        calls.push(table);
        if (table === 'usuarios') return { select() { return this; }, eq() { return this; }, async single() { return { data: { rol: role }, error: null }; } };
        if (table === 'v_dashboard_kpis') return { select() { return this; }, async single() { return { data: kpis, error: null }; } };
        throw Error(`tabla inesperada: ${table}`);
      },
    };
    const { default: Page } = load('src/app/(app)/page.tsx', {
      '@/lib/supabase/server': { createClient() { return supabase; } },
      '@/lib/clientes/model': clientsModel,
      '@/lib/coaches/data': { async loadCoachDashboard() { calls.push('coach_dashboard'); return { expiring: [], expired: [], wod: null, announcements: [] }; } },
      '@/components/coaches/coach-dashboard': () => null,
    });
    const rendered = JSON.stringify(await Page());
    assert.deepEqual(calls, role === 'admin' || role === 'owner' ? ['usuarios', 'v_dashboard_kpis'] : role === 'staff' ? ['usuarios', 'coach_dashboard'] : ['usuarios']);
    if (role === 'admin' || role === 'owner') {
      for (const label of ['Clientes activos', 'Membresías vigentes', 'Membresías por vencer', 'Ingresos del mes', 'Pagos pendientes']) {
        assert.ok(rendered.includes(label), `${role}: falta ${label}`);
      }
    } else {
      assert.doesNotMatch(rendered, /Ingresos del mes|Pagos pendientes/);
    }
  }
});

const grouping = load('src/lib/membresias/grouping.ts');
function member(cliente_id, id, estado_vigencia, fecha_fin, extra = {}) {
  return { cliente_id, id, estado_vigencia, fecha_fin, fecha_inicio: '2026-10-01',
    plan_id: otherId, saldo: 0, estado_pago: 'PAGADO', ...extra };
}

test('agrupa una sola vez por cliente y elige la vigencia actual frente a una futura', () => {
  const rows = [
    member(id, 'anterior', 'VENCIDA', '2026-09-30'),
    member(id, 'actual', 'POR_VENCER', '2026-10-30'),
    member(id, 'futura', null, '2026-11-30'),
  ];
  const clients = new Map([[id, { id, nombre_completo: 'Alumno', cedula: '001' }]]);
  const groups = grouping.groupByClient(rows, clients);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].memberships.length, 3);
  assert.equal(groups[0].overview.id, 'actual');
});

test('sin vigencia actual señala la última vencida; una futura sola aparece POR INICIAR', () => {
  const expired = member(id, 'vencida', 'VENCIDA', '2026-09-30');
  const future = member(id, 'futura', null, '2026-11-30');
  assert.equal(grouping.chooseOverview([expired, future]).id, 'vencida');
  assert.equal(grouping.chooseOverview([expired]).id, 'vencida');
  assert.equal(grouping.chooseOverview([future]).id, 'futura');
  assert.equal(grouping.chooseOverview([{ ...expired, estado_pago: 'CANCELADA' }]), null);
});

test('ordena clientes por VENCIDA, VENCE HOY, POR VENCER, VIGENTE y POR INICIAR', () => {
  const states = [null, 'VIGENTE', 'POR_VENCER', 'VENCE_HOY', 'VENCIDA'];
  const rows = states.map((state, index) => member(String(index), String(index), state, '2026-10-30'));
  const clients = new Map(states.map((_, index) => [String(index), { id: String(index), nombre_completo: String(index), cedula: String(index) }]));
  const ordered = grouping.groupByClient(rows, clients).map((group) => grouping.vigencyOf(group.overview));
  assert.deepEqual(ordered, ['VENCIDA', 'VENCE_HOY', 'POR_VENCER', 'VIGENTE', 'POR_INICIAR']);
});

test('filtra por nombre o cédula y por estado del resumen, sin exponer finanzas a staff', () => {
  const rows = [member(id, 'a', 'VENCE_HOY', '2026-10-30', { saldo: 5, estado_pago: 'PENDIENTE' }),
    member(otherId, 'b', 'VENCIDA', '2026-09-30')];
  const clients = new Map([[id, { id, nombre_completo: 'José', cedula: '001234' }],
    [otherId, { id: otherId, nombre_completo: 'Ana', cedula: '009876' }]]);
  const groups = grouping.groupByClient(rows, clients);
  assert.equal(grouping.filterClientGroups(groups, 'jose', 'vigentes').length, 1);
  assert.equal(grouping.filterClientGroups(groups, '009876', 'vencidas').length, 1);
  assert.equal(grouping.filterClientGroups(groups, '', 'por_vencer').length, 0);
  assert.equal(grouping.filterClientGroups(groups, '', 'saldo_pendiente').length, 1);
  assert.equal(grouping.filterClientGroups(groups, '', 'pagadas').length, 1);
});

test('el historial de staff no consulta membresías financieras ni pagos', async () => {
  const calls = [];
  const supabase = { from(table) {
    calls.push(table);
    assert.equal(table, 'clientes');
    return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { id, nombre_completo: 'Alumno', cedula: '001' }, error: null }; } };
  } };
  const { default: Page } = load('src/app/(app)/membresias/cliente/[id]/page.tsx', {
    '@/components/membresias/vigency-badge': () => null,
    '@/lib/clientes/access': { async getClientAccess() { return { role: 'staff', supabase }; } },
    '@/lib/membresias/model': model,
    '@/lib/membresias/grouping': grouping,
    '@/lib/membresias/data': {
      async loadOperationalMemberships(_db, clientId) { assert.equal(clientId, id); calls.push('v_membresias_verificacion'); return [{ cliente_id: id, plan: 'MENSUAL', fecha_fin: '2026-09-30', estado_vigencia: 'VENCE_HOY' }]; },
      async loadFinancialMemberships() { throw Error('staff finance query'); },
      async loadMembershipPayments() { throw Error('staff payment query'); },
      async loadPlanNames() { throw Error('staff price query'); },
    },
  });
  const rendered = await Page({ params: { id } });
  assert.deepEqual(calls, ['clientes', 'v_membresias_verificacion']);
  assert.equal(rendered.props.staff, true);
  assert.equal(rendered.props.rows[0].plan, 'MENSUAL');
  assert.equal(Object.hasOwn(rendered.props.rows[0], 'saldo'), false);
  assert.equal(rendered.props.payments.size, 0);
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

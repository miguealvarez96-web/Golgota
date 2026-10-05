const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }
function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const code = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  module._compile(code, filename);
  return module.exports;
}

const model = load('src/lib/reportes/model.ts');
const memberships = load('src/lib/membresias/grouping.ts');
const accessSource = read('src/lib/reportes/access.ts');
const dataSource = read('src/lib/reportes/data.ts');
const page = read('src/app/(app)/reportes/page.tsx');
const dashboard = read('src/components/reportes/reports-dashboard.tsx');
const navigation = read('src/components/layout/portal-navigation.tsx');
const initialMigration = read('supabase/migrations/20260912_init.sql');
const paymentsMigration = read('supabase/migrations/20260930_membresias_cobranza.sql');
const macro = read('scripts/cerrar-bloque-reportes.ps1');

function accessFor(role, active = true) {
  const supabase = {
    auth: { async getUser() { return { data: { user: { id: 'user-id' } }, error: null }; } },
    from(name) {
      assert.equal(name, 'usuarios');
      return { select() { return this; }, eq() { return this; }, async single() {
        return { data: { rol: role, activo: active }, error: null };
      } };
    },
  };
  return load('src/lib/reportes/access.ts', {
    'server-only': {},
    '@/lib/supabase/server': { createClient() { return supabase; } },
  }).getReportAccess();
}

test('admin y owner acceden; staff, alumno e inactivos quedan bloqueados en servidor', async () => {
  assert.equal((await accessFor('admin')).role, 'admin');
  assert.equal((await accessFor('owner')).role, 'owner');
  assert.equal(await accessFor('staff'), null);
  assert.equal(await accessFor('alumno'), null);
  assert.equal(await accessFor('owner', false), null);
  assert.match(page, /getReportAccess\(\)[\s\S]*if \(!access\) redirect\("\/"\)/);
  assert.match(navigation, /role === "staff"[\s\S]*"\/reportes"/);
});

test('filtros Hoy, este mes, mes anterior y rango personalizado usan fechas Ecuador', () => {
  assert.deepEqual(model.resolveReportPeriod({ periodo: 'hoy' }, '2026-10-04').period,
    { key: 'hoy', label: 'Hoy', start: '2026-10-04', end: '2026-10-04' });
  assert.deepEqual(model.resolveReportPeriod({ periodo: 'mes_actual' }, '2026-10-04').period,
    { key: 'mes_actual', label: 'Este mes', start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(model.resolveReportPeriod({ periodo: 'mes_anterior' }, '2026-01-15').period,
    { key: 'mes_anterior', label: 'Mes anterior', start: '2025-12-01', end: '2025-12-31' });
  const custom = model.resolveReportPeriod({ periodo: 'personalizado', desde: '2026-09-02', hasta: '2026-09-23' }, '2026-10-04');
  assert.equal(custom.error, null);
  assert.deepEqual(model.periodTimestampBounds(custom.period), {
    start: '2026-09-02T00:00:00-05:00', endExclusive: '2026-09-24T00:00:00-05:00',
  });
  assert.match(read('src/lib/clientes/model.ts'), /timeZone: "America\/Guayaquil"/);
});

test('rango inválido o excesivo no dispara consultas arbitrarias', () => {
  assert.match(model.resolveReportPeriod({ periodo: 'personalizado', desde: '2026-10-10', hasta: '2026-10-01' }, '2026-10-04').error, /válidas y ordenadas/);
  assert.match(model.resolveReportPeriod({ periodo: 'personalizado', desde: '2025-01-01', hasta: '2026-10-01' }, '2026-10-04').error, /no puede superar/);
});

test('ingresos incluyen solo confirmados; pendientes, rechazados y saldo no cuentan', () => {
  const entries = [
    { amount: 80, status: 'CONFIRMADO' },
    { amount: 40, status: 'PENDIENTE' },
    { amount: 30, status: 'RECHAZADO' },
  ];
  assert.equal(model.confirmedIncomeTotal(entries), 80);
  assert.deepEqual(model.financialTotals(entries, [{ amount: 25 }], 500), {
    income: 80, expense: 25, net: 55, pendingBalance: 500,
  });
  assert.match(dataSource, /from\("pagos"\)/);
  assert.doesNotMatch(dataSource, /from\("reportes_pago"\)|from\("pagos_reportados"\)/);
});

test('gastos reducen el resultado neto y conservan categoría y detalle', () => {
  assert.equal(model.financialTotals([{ amount: 100, status: 'CONFIRMADO' }], [{ amount: 35 }, { amount: 5 }], 0).net, 60);
  assert.match(dataSource, /from\("gastos"\)[\s\S]*tipo_gasto,descripcion,monto,fecha_gasto/);
  assert.match(dashboard, /Gastos del período[\s\S]*item\.category[\s\S]*item\.description/);
});

test('estados de membresía reutilizan la lógica existente y la cobranza usa su prioridad', () => {
  const row = (state) => ({ cliente_id: 'c', fecha_fin: '2026-10-04', estado_vigencia: state });
  assert.equal(memberships.vigencyOf(row(null)), 'POR_INICIAR');
  for (const state of ['VIGENTE', 'POR_VENCER', 'VENCE_HOY', 'VENCIDA']) assert.equal(memberships.vigencyOf(row(state)), state);
  const ordered = ['VIGENTE', 'POR_INICIAR', 'VENCE_HOY', 'VENCIDA', 'POR_VENCER']
    .sort((a, b) => memberships.vigencyPriority(a) - memberships.vigencyPriority(b));
  assert.deepEqual(ordered, ['VENCIDA', 'VENCE_HOY', 'POR_VENCER', 'VIGENTE', 'POR_INICIAR']);
  assert.match(dataSource, /vigencyOf[\s\S]*vigencyPriority/);
  assert.match(dataSource, /collections = membershipItems\.filter\(\(membership\) => membership\.balance > 0\)/);
  assert.match(dataSource, /renewals = membershipItems\.filter\(\(membership\) => membership\.state === "VENCE_HOY" \|\| membership\.state === "POR_VENCER"\)/);
});

test('stock bajo considera activos, separa agotados y usa umbral de cinco', () => {
  assert.deepEqual(model.stockSummary([
    { stock: 0, activo: true }, { stock: 3, activo: true }, { stock: 8, activo: true }, { stock: 1, activo: false },
  ]), { units: 11, low: 1, out: 1 });
  assert.match(dataSource, /lowStockThreshold = 5/);
  assert.match(dashboard, /Stock bajo[\s\S]*Sin stock/);
});

test('ventas pagadas solo alimentan ranking y no se mezclan con ingresos de caja', () => {
  assert.match(dataSource, /from\("ventas"\)[\s\S]*\.eq\("estado", "PAGADO"\)/);
  assert.match(dashboard, /no se suman a caja sin un historial de cobros/);
  assert.doesNotMatch(dataSource, /confirmedIncomeTotal\([^)]*sales/i);
});

test('UI incluye KPI, gráficos útiles, tablas, búsqueda y CSV seguro', () => {
  for (const label of ['Clientes activos', 'Membresías vigentes', 'Por vencer', 'Vencidas', 'Ingresos confirmados', 'Saldo por cobrar', 'Gastos', 'Resultado neto']) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(dashboard, /BarChart[\s\S]*PieChart/);
  assert.match(dashboard, /Cobranza pendiente[\s\S]*collection-search/);
  assert.match(dashboard, /Exportar cobranza CSV/);
  assert.match(dashboard, /safeCsvCell[\s\S]*text\/csv;charset=utf-8/);
  assert.match(dashboard, /Próximas renovaciones[\s\S]*Stock bajo/);
});

test('RLS financiera existente limita gastos, ventas, membresías y pagos a admin/owner', () => {
  assert.match(initialMigration, /CREATE POLICY gastos_lectura[\s\S]*IN \('admin','owner'\)/);
  assert.match(initialMigration, /CREATE POLICY ventas_lectura[\s\S]*IN \('admin','owner'\)/);
  assert.match(paymentsMigration, /pagos_registro[\s\S]*mi_rol\(\) IN \('admin', 'owner'\)/);
  assert.match(accessSource, /!\["admin", "owner"\]\.includes\(profile\.rol\)/);
});

test('macro detecta SQL opcional, valida, aísla staging y despliega por ExitCode', () => {
  assert.match(macro, /\$hasSql = Test-Path/);
  assert.match(macro, /SUPABASE_DB_URL[\s\S]*psql[\s\S]*ON_ERROR_STOP=1/);
  assert.match(macro, /node[\s\S]*--test[\s\S]*tsc[\s\S]*--noEmit[\s\S]*npm[\s\S]*build/);
  assert.match(macro, /feat: add management reports/);
  assert.match(macro, /Start-Process[\s\S]*RedirectStandardOutput[\s\S]*RedirectStandardError/);
  assert.match(macro, /\$process\.ExitCode -ne 0/);
  assert.doesNotMatch(macro, /'\.gitignore'/);
});

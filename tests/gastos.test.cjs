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
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = new Module(filename); module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module); module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  module._compile(code, filename); return module.exports;
}

const model = load('src/lib/gastos/model.ts');
const migration = read('supabase/migrations/20261012_cierre_operativo.sql');
const postflight = read('supabase/postflight/20261012_postflight_cierre_operativo.sql');
const manager = read('src/components/gastos/expenses-manager.tsx');
const reportData = read('src/lib/reportes/data.ts');
const id = 'b98e5f70-849c-4df8-906a-2b20654fdb39';
const userId = '929bb513-5af2-4077-a651-80a106b1b32f';
const valid = { fecha: '2026-10-12', categoria: 'Mantenimiento', descripcion: 'Reparación de equipo', monto: '25.50', metodo_pago: 'Efectivo', proveedor: '', observacion: '' };

function harness(role) {
  const writes = [], refreshed = [];
  const query = {
    insert(data) { writes.push({ operation: 'insert', data }); return this; },
    update(data) { writes.push({ operation: 'update', data }); return this; },
    eq() { return this; }, select() { return this; }, async single() { return { data: { id }, error: null }; },
  };
  const actions = load('src/app/(app)/gastos/actions.ts', {
    '@/lib/gastos/access': { async getExpenseAccess() { return { role, userId, supabase: { from(table) { assert.equal(table, 'gastos'); return query; } } }; } },
    '@/lib/gastos/model': model,
    'next/cache': { revalidatePath(route) { refreshed.push(route); } },
  });
  return { ...actions, writes, refreshed };
}

test('valida campos obligatorios, categorías, monto y opcionales', () => {
  const parsed = model.expenseSchema.parse(valid);
  assert.equal(parsed.monto, 25.5);
  assert.equal(parsed.proveedor, null);
  for (const bad of [{ ...valid, categoria: 'Inventada' }, { ...valid, monto: '0' }, { ...valid, descripcion: ' ' }]) {
    assert.equal(model.expenseSchema.safeParse(bad).success, false);
  }
});

test('admin y owner crean y editan gastos con campos permitidos', async () => {
  for (const role of ['admin', 'owner']) {
    const create = harness(role);
    assert.equal((await create.saveExpense(null, valid)).ok, true);
    assert.deepEqual(create.writes[0], { operation: 'insert', data: {
      fecha_gasto: valid.fecha, tipo_gasto: valid.categoria, descripcion: valid.descripcion, monto: 25.5,
      metodo_pago: 'Efectivo', proveedor: null, observacion: null, created_by: userId,
    } });
    const edit = harness(role);
    assert.equal((await edit.saveExpense(id, { ...valid, monto: '30', proveedor: 'Proveedor' })).ok, true);
    assert.equal(edit.writes[0].operation, 'update');
    assert.equal(edit.writes[0].data.monto, 30);
  }
});

test('anulación conserva la fila y staff/alumno quedan bloqueados', async () => {
  const admin = harness('admin');
  assert.equal((await admin.voidExpense(id)).ok, true);
  assert.equal(admin.writes[0].operation, 'update');
  assert.equal(admin.writes[0].data.estado, 'ANULADO');
  assert.equal(admin.writes.some((entry) => entry.operation === 'delete'), false);
  for (const role of ['staff', 'alumno']) {
    const blocked = harness(role);
    assert.equal((await blocked.saveExpense(null, valid)).ok, false);
    assert.equal((await blocked.voidExpense(id)).ok, false);
    assert.equal(blocked.writes.length, 0);
  }
});

test('reportes excluyen gastos anulados y la UI es compacta y desplegable', () => {
  assert.match(reportData, /from\("gastos"\)[\s\S]*\.eq\("estado", "ACTIVO"\)/);
  assert.match(manager, /Total gastos activos/);
  assert.match(manager, /<details[\s\S]*<summary/);
  assert.match(manager, /Editar[\s\S]*Anular/);
  assert.doesNotMatch(manager, /deleteExpense|Eliminar gasto/);
});

test('PostgreSQL aplica anulación lógica, auditoría y RLS admin-owner sin DELETE', () => {
  assert.match(migration, /ALTER TABLE public\.gastos[\s\S]*ADD COLUMN estado text NOT NULL DEFAULT 'ACTIVO'/);
  assert.match(migration, /gastos_anulacion_coherente/);
  assert.match(migration, /OLD\.estado = 'ANULADO'[\s\S]*inmutable/);
  assert.match(migration, /gastos_creacion[\s\S]*'admin', 'owner'/);
  assert.match(migration, /gastos_edicion[\s\S]*'admin', 'owner'/);
  assert.match(postflight, /audit_gastos/);
  assert.doesNotMatch(migration, /GRANT\s+DELETE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+public\.gastos/i);
});

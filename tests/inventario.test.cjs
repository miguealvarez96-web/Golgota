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

const model = load('src/lib/inventario/model.ts');
const migration = read('supabase/migrations/20261012_cierre_operativo.sql');
const dataSource = read('src/lib/inventario/data.ts');
const manager = read('src/components/inventario/inventory-manager.tsx');
const id = 'b98e5f70-849c-4df8-906a-2b20654fdb39';
const userId = '929bb513-5af2-4077-a651-80a106b1b32f';
const itemInput = { nombre: 'Barra olímpica', categoria: 'Barras', cantidad: '4', estado: 'BUENO', fecha_compra: '', costo: '120.00', ubicacion: 'Rack', observacion: '' };

function harness(role) {
  const writes = [], rpcCalls = [];
  const query = { insert(data) { writes.push({ operation: 'insert', data }); return this; }, update(data) { writes.push({ operation: 'update', data }); return this; }, eq() { return this; }, select() { return this; }, async single() { return { data: { id }, error: null }; } };
  const actions = load('src/app/(app)/inventario/actions.ts', {
    '@/lib/inventario/access': { async getInventoryAccess() { return { role, userId, supabase: {
      from(table) { assert.ok(['inventario_items', 'inventario_incidencias'].includes(table)); return query; },
      async rpc(name, args) { rpcCalls.push([name, args]); return { data: id, error: null }; },
    } }; } },
    '@/lib/inventario/model': model,
    'next/cache': { revalidatePath() {} },
  });
  return { ...actions, writes, rpcCalls };
}

test('modelo valida estados, cantidades y costo opcional', () => {
  const parsed = model.inventoryItemSchema.parse(itemInput);
  assert.equal(parsed.cantidad, 4); assert.equal(parsed.costo, 120);
  for (const estado of ['BUENO', 'MANTENIMIENTO', 'DANADO', 'BAJA']) assert.equal(model.inventoryItemSchema.safeParse({ ...itemInput, estado }).success, true);
  assert.equal(model.inventoryItemSchema.safeParse({ ...itemInput, cantidad: '-1' }).success, false);
  assert.equal(model.inventoryItemSchema.safeParse({ ...itemInput, costo: '1.999' }).success, false);
});

test('admin y owner crean/editan; staff no cambia cantidad, estado ni costo', async () => {
  for (const role of ['admin', 'owner']) {
    const h = harness(role);
    assert.equal((await h.saveInventoryItem(null, itemInput)).ok, true);
    assert.equal((await h.saveInventoryItem(id, { ...itemInput, cantidad: '5', estado: 'MANTENIMIENTO' })).ok, true);
    assert.equal(h.writes[0].data.costo, 120);
    assert.equal(h.writes[1].data.cantidad, 5);
  }
  const staff = harness('staff');
  assert.equal((await staff.saveInventoryItem(id, { ...itemInput, cantidad: '999', costo: '0' })).ok, false);
  assert.equal(staff.writes.length, 0);
});

test('staff reporta incidencia pero no la resuelve; admin y owner resuelven por RPC', async () => {
  const staff = harness('staff');
  assert.equal((await staff.reportInventoryIncident({ inventario_item_id: id, tipo: 'DANIO', observacion: 'Disco fisurado' })).ok, true);
  assert.equal(staff.writes[0].operation, 'insert');
  assert.equal((await staff.resolveInventoryIncident(id)).ok, false);
  assert.equal(staff.rpcCalls.length, 0);
  for (const role of ['admin', 'owner']) {
    const h = harness(role);
    assert.equal((await h.resolveInventoryIncident(id, 'MANTENIMIENTO')).ok, true);
    assert.deepEqual(h.rpcCalls[0], ['resolver_incidencia_inventario', { p_incidencia_id: id, p_estado_item: 'MANTENIMIENTO' }]);
  }
  assert.match(manager, /Estado real al resolver/);
  assert.match(manager, /resolveInventoryIncident\(incident\.id, itemState\)/);
});

test('staff consulta únicamente la vista operativa sin costo', () => {
  assert.match(dataSource, /from\("v_inventario_operativo"\)[\s\S]*select\("id,nombre,categoria,cantidad,estado,ubicacion,observacion,updated_at"\)/);
  const staffBranch = dataSource.match(/let request = access\.supabase\.from\("v_inventario_operativo"\)[\s\S]*?return \{ items:[^\n]+/)[0];
  assert.doesNotMatch(staffBranch, /costo|fecha_compra|v_inventario_gestion/);
  assert.match(manager, /"costo" in item/);
  assert.match(manager, /Reportar incidencia/);
});

test('la carga real de staff devuelve items operativos sin propiedad costo', async () => {
  const selections = [];
  function query(table) {
    let selection = '';
    return {
      select(columns) { selection = columns; selections.push([table, columns]); return this; },
      order() { return this; }, limit() { return this; }, eq() { return this; }, or() { return this; },
      then(resolve) { return Promise.resolve(table === 'v_inventario_operativo'
        ? { data: [{ id, nombre: 'Barra', categoria: 'Barras', cantidad: 4, estado: 'BUENO', ubicacion: 'Rack', observacion: null, updated_at: '' }], error: null }
        : { data: [], error: null }).then(resolve); },
    };
  }
  const { loadInventory } = load('src/lib/inventario/data.ts', { 'server-only': {}, './model': model });
  const result = await loadInventory({ role: 'staff', userId, supabase: { from: query } }, { query: '', state: '' });
  assert.equal(result.canManage, false);
  assert.equal(Object.hasOwn(result.items[0], 'costo'), false);
  assert.deepEqual(selections[0], ['v_inventario_operativo', 'id,nombre,categoria,cantidad,estado,ubicacion,observacion,updated_at']);
  assert.equal(selections.some((entry) => entry[1].includes('costo')), false);
});

test('PostgreSQL separa costo, protege escrituras y audita incidencias', () => {
  const safeView = migration.match(/CREATE VIEW public\.v_inventario_operativo[\s\S]*?CREATE VIEW public\.v_inventario_gestion/)[0];
  assert.doesNotMatch(safeView, /\.costo|fecha_compra/);
  assert.match(migration, /inventario_items_gestion_lectura[\s\S]*'admin', 'owner'/);
  assert.match(migration, /inventario_incidencias_creacion[\s\S]*'admin', 'owner', 'staff'/);
  assert.match(migration, /inventario_incidencias_resolucion[\s\S]*'admin', 'owner'/);
  assert.match(migration, /resolver_incidencia_inventario[\s\S]*FOR UPDATE/);
  assert.match(migration, /audit_inventario_items[\s\S]*audit_inventario_incidencias/);
  assert.doesNotMatch(migration, /GRANT\s+DELETE/i);
});

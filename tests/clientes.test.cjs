// Pruebas sin red: transpila las funciones reales y sustituye solo sus límites
// de Supabase/Next. No carga .env ni escribe clientes en ninguna base de datos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  module._compile(source, filename);
  return module.exports;
}

const model = load('src/lib/clientes/model.ts');
const valid = { nombre_completo: 'Cliente de prueba', cedula: '0012345678', celular: '', email: '', estado_cliente: 'Activo', fecha_registro: '2026-01-01' };
const id = 'b98e5f70-849c-4df8-906a-2b20654fdb39';

function actionHarness({ role = 'admin', duplicate = null, writeError = null, denied = false, throws = false } = {}) {
  const writes = [], refreshed = [];
  const query = {
    select() { return this; }, eq() { return this; }, neq() { return this; },
    async maybeSingle() { return { data: duplicate, error: null }; },
    insert(data) { writes.push({ operation: 'insert', data }); return this; },
    update(data) { writes.push({ operation: 'update', data }); return this; },
    async single() { return { data: writeError ? null : { id }, error: writeError }; },
  };
  const access = denied ? null : { role, userId: id, supabase: { from(table) { assert.equal(table, 'clientes'); return query; } } };
  const { saveClient } = load('src/app/(app)/clientes/actions.ts', {
    '@/lib/clientes/model': model,
    '@/lib/clientes/access': { async getClientAccess() { if (throws) throw Error('private internal detail'); return access; } },
    'next/cache': { revalidatePath(route) { refreshed.push(route); } },
  });
  return { saveClient, writes, refreshed };
}

test('valida, normaliza y conserva ceros iniciales de identificación', () => {
  const row = model.clientSchema.parse({ ...valid, nombre_completo: '  Persona Ejemplo  ', email: 'PERSONA@EXAMPLE.COM' });
  assert.equal(row.nombre_completo, 'Persona Ejemplo');
  assert.equal(row.cedula, '0012345678');
  assert.equal(row.celular, null);
  assert.equal(row.email, 'persona@example.com');
});

test('rechaza datos inválidos y asignación de campos protegidos', () => {
  for (const input of [{ cedula: 'abc' }, { celular: '123' }, { email: 'no-es-correo' }, { nombre_completo: '' }, { fecha_registro: '2026-02-30' }, { fecha_registro: '2999-01-01' }, { estado_cliente: 'Desconocido' }, { auth_user_id: id }, { created_by: id }]) {
    assert.equal(model.clientSchema.safeParse({ ...valid, ...input }).success, false, JSON.stringify(input));
  }
});

test('el día de negocio cambia a medianoche de Ecuador', () => {
  assert.equal(model.businessDate(new Date('2026-09-30T04:59:59Z')), '2026-09-29');
  assert.equal(model.businessDate(new Date('2026-09-30T05:00:00Z')), '2026-09-30');
});

test('búsquedas con caracteres de filtro quedan dentro del literal', () => {
  const input = 'a%,cedula.eq.0)"_\\';
  const filter = model.clientSearchFilter(input);
  const literals = [...filter.matchAll(/(?:^|,)(nombre_completo|cedula|celular|email)\.ilike\.("(?:\\.|[^"\\])*")/g)];
  assert.equal(literals.length, 4);
  for (const [, , literal] of literals) assert.equal(JSON.parse(literal), '%a\\%,cedula.eq.0)"\\_\\\\%');
});

test('staff puede crear; autor real asignado en servidor y listas refrescadas', async () => {
  const h = actionHarness({ role: 'staff' });
  assert.equal((await h.saveClient(null, valid)).ok, true);
  assert.equal(h.writes[0].operation, 'insert');
  assert.equal(h.writes[0].data.created_by, id);
  assert.deepEqual(h.refreshed, ['/clientes', '/']);
});

test('staff no puede editar aunque invoque directamente la acción', async () => {
  const h = actionHarness({ role: 'staff' });
  assert.equal((await h.saveClient(id, valid)).ok, false);
  assert.equal(h.writes.length, 0);
});

test('admin y owner pueden editar e inactivar sin borrar historial', async () => {
  for (const role of ['admin', 'owner']) {
    const h = actionHarness({ role });
    assert.equal((await h.saveClient(id, { ...valid, estado_cliente: 'Inactivo' })).ok, true);
    assert.deepEqual(h.writes.map((w) => w.operation), ['update']);
    assert.equal(h.writes[0].data.estado_cliente, 'Inactivo');
    assert.equal(Object.hasOwn(h.writes[0].data, 'created_by'), false);
  }
});

test('sesión inválida y campos adicionales impiden toda escritura', async () => {
  const h = actionHarness({ denied: true });
  assert.equal((await h.saveClient(null, valid)).ok, false);
  assert.equal(h.writes.length, 0);
  const allowed = actionHarness();
  assert.equal((await allowed.saveClient(null, { ...valid, auth_user_id: id })).ok, false);
  assert.equal(allowed.writes.length, 0);
});

test('cédula duplicada se detecta antes de escribir y en carreras concurrentes', async () => {
  const existing = actionHarness({ duplicate: { id } });
  assert.equal((await existing.saveClient(null, valid)).errors.cedula.length, 1);
  assert.equal(existing.writes.length, 0);
  const concurrent = actionHarness({ writeError: { code: '23505', message: 'private detail' } });
  const result = await concurrent.saveClient(null, valid);
  assert.equal(result.ok, false);
  assert.equal(result.errors.cedula.length, 1);
  assert.equal(concurrent.refreshed.length, 0);
});

test('fallos de permisos, fila invisible o red no producen éxito ni filtran detalles', async () => {
  for (const options of [{ writeError: { code: '42501', message: 'private detail' } }, { writeError: { code: 'PGRST116' } }, { throws: true }]) {
    const h = actionHarness(options);
    const result = await h.saveClient(id, valid);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /private|PGRST|42501/);
    assert.equal(h.refreshed.length, 0);
  }
});

test('acceso rechaza perfiles inactivos y roles ajenos a la operación', async () => {
  for (const profile of [{ rol: 'staff', activo: false }, { rol: 'alumno', activo: true }, null]) {
    const { getClientAccess } = load('src/lib/clientes/access.ts', {
      'server-only': {}, './model': model,
      '@/lib/supabase/server': { createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id } }, error: null }) },
        from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({ data: profile, error: null }) }),
      }) },
    });
    assert.equal(await getClientAccess(), null);
  }
});

test('la página de staff no consulta ni entrega membresías o finanzas', async () => {
  const tables = [];
  const query = { select() { return this; }, order() { return this; }, range() { return this; },
    then(resolve) { return Promise.resolve({ data: [{ id, ...valid }], count: 1, error: null }).then(resolve); } };
  const { default: Page } = load('src/app/(app)/clientes/page.tsx', {
    '@/components/clientes/clients-manager': () => null,
    '@/lib/clientes/model': model,
    '@/lib/clientes/access': { getClientAccess: async () => ({ role: 'staff', userId: id, supabase: { from(table) { tables.push(table); return query; } } }) },
  });
  const element = await Page({ searchParams: {} });
  assert.deepEqual(tables, ['clientes']);
  assert.equal(element.props.canEdit, false);
  assert.deepEqual(element.props.memberships, {});
});

// Pruebas sin red: cargan el código real y sustituyen solo Supabase/Next.
// No leen .env, no ejecutan migraciones y no escriben datos reales.
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

const model = load('src/lib/productos/model.ts');
const productId = 'b98e5f70-849c-4df8-906a-2b20654fdb39';
const userId = '929bb513-5af2-4077-a651-80a106b1b32f';

function productForm(overrides = {}) {
  const data = new FormData();
  const values = { nombre: '  Camiseta   Gólgota  ', categoria: ' Ropa ', descripcion: ' Oficial ', precio: '30.00', stock: '10', activo: 'on', ...overrides };
  for (const [key, value] of Object.entries(values)) data.set(key, String(value));
  return data;
}

function actionHarness(role = 'owner') {
  const writes = [], storageCalls = [], refreshed = [];
  const query = {
    insert(data) { writes.push({ operation: 'insert', data }); return this; },
    update(data) { writes.push({ operation: 'update', data }); return this; },
    select() { return this; }, eq() { return this; },
    async single() { return { data: { id: productId, imagen_path: null }, error: null }; },
  };
  const supabase = {
    from(table) { assert.equal(table, 'productos'); return query; },
    storage: { from(bucket) { assert.equal(bucket, 'productos'); return {
      async upload(...args) { storageCalls.push(['upload', ...args]); return { data: {}, error: null }; },
      async remove(paths) { storageCalls.push(['remove', paths]); return { data: {}, error: null }; },
    }; } },
  };
  const access = { role, userId, supabase };
  const actions = load('src/app/(app)/productos/actions.ts', {
    '@/lib/productos/access': { async getProductAccess() { return access; } },
    '@/lib/productos/model': model,
    'next/cache': { revalidatePath(route) { refreshed.push(route); } },
  });
  return { ...actions, writes, storageCalls, refreshed };
}

test('normaliza nombre y textos; acepta precio positivo y stock cero', () => {
  const parsed = model.productSchema.parse({
    nombre: '  Camiseta   Gólgota  ', categoria: ' Ropa   deportiva ', descripcion: '  Línea oficial  ',
    precio: '0.01', stock: '0', activo: true,
  });
  assert.equal(parsed.nombre, 'Camiseta Gólgota');
  assert.equal(parsed.categoria, 'Ropa deportiva');
  assert.equal(parsed.descripcion, 'Línea oficial');
  assert.equal(parsed.precio, 0.01);
  assert.equal(parsed.stock, 0);
});

test('rechaza precio cero, negativos, más de dos decimales y stock inválido', () => {
  const valid = { nombre: 'Producto', categoria: '', descripcion: '', precio: '1', stock: '0', activo: true };
  for (const precio of ['0', '-1', '1.001', '100000000']) {
    assert.equal(model.productSchema.safeParse({ ...valid, precio }).success, false, precio);
  }
  for (const stock of ['-1', '1.5', '2147483648']) {
    assert.equal(model.productSchema.safeParse({ ...valid, stock }).success, false, stock);
  }
});

test('valida tipo, tamaño, extensión y contenido real de imágenes', async () => {
  function image(name, type, bytes, size = bytes.length) {
    return { name, type, size, slice() { return { async arrayBuffer() { return Uint8Array.from(bytes).buffer; } }; } };
  }
  assert.equal(await model.productImageContentError(image('foto.jpg', 'image/jpeg', [0xff, 0xd8, 0xff])), null);
  assert.equal(await model.productImageContentError(image('foto.png', 'image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
  assert.match(await model.productImageContentError(image('foto.jpg', 'image/jpeg', [1, 2, 3])), /contenido/);
  assert.match(model.productImageMetadataError(image('foto.gif', 'image/gif', [1])), /JPG/);
  assert.match(model.productImageMetadataError(image('foto.png', 'image/png', [1], model.PRODUCT_IMAGE_MAX_BYTES + 1)), /2 MB/);
});

test('staff no puede crear, editar ni activar aunque invoque acciones directamente', async () => {
  const h = actionHarness('staff');
  assert.equal((await h.saveProduct(null, productForm())).ok, false);
  assert.equal((await h.setProductActive(productId, false)).ok, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.storageCalls.length, 0);
  assert.equal(h.refreshed.length, 0);
});

test('owner crea y cambia estado usando únicamente campos permitidos', async () => {
  const h = actionHarness('owner');
  const created = await h.saveProduct(null, productForm());
  assert.equal(created.ok, true);
  assert.equal(h.writes[0].operation, 'insert');
  assert.deepEqual(h.writes[0].data, {
    nombre: 'Camiseta Gólgota', categoria: 'Ropa', descripcion: 'Oficial', precio: 30, stock: 10, activo: true, imagen_path: null,
  });
  for (const protectedField of ['id', 'created_by', 'updated_by', 'created_at', 'updated_at']) {
    assert.equal(Object.hasOwn(h.writes[0].data, protectedField), false);
  }
  assert.equal((await h.setProductActive(productId, false)).ok, true);
  assert.deepEqual(h.writes[1], { operation: 'update', data: { activo: false } });
  assert.deepEqual(h.refreshed, ['/productos', '/productos']);
});

test('la carga de staff fuerza activo=true y solo firma imágenes devueltas', async () => {
  const filters = [], selections = [];
  const product = { id: productId, nombre: 'Producto', categoria: 'Ropa', descripcion: null, precio: 10, stock: 2, activo: true, imagen_path: `${userId}/imagen.webp`, created_at: '', updated_at: '' };
  function query() {
    let kind = '';
    return {
      select(columns, options) { kind = options ? 'products' : 'categories'; selections.push(columns); return this; },
      order() { return this; }, range() { return this; }, not() { return this; }, limit() { return this; }, or() { return this; },
      eq(column, value) { filters.push([kind, column, value]); return this; },
      then(resolve) { return Promise.resolve(kind === 'products'
        ? { data: [product], count: 1, error: null }
        : { data: [{ categoria: 'Ropa' }], error: null }).then(resolve); },
    };
  }
  const signedPaths = [];
  const access = { role: 'staff', userId, supabase: {
    from(table) { assert.equal(table, 'productos'); return query(); },
    storage: { from(bucket) { assert.equal(bucket, 'productos'); return { async createSignedUrls(paths) { signedPaths.push(...paths); return { data: paths.map((item) => ({ path: item, signedUrl: `signed:${item}` })), error: null }; } }; } },
  } };
  const { loadProductCatalog } = load('src/lib/productos/data.ts', {
    'server-only': {}, './model': model,
  });
  const result = await loadProductCatalog(access, { query: '', category: '', state: '', page: 1, pageSize: 12 });
  assert.equal(filters.filter((entry) => entry[1] === 'activo' && entry[2] === true).length, 2);
  assert.equal(result.products[0].image_url, `signed:${product.imagen_path}`);
  assert.deepEqual(signedPaths, [product.imagen_path]);
});

test('las migraciones aplican precio positivo, RLS por rol y Storage privado', () => {
  const productsSql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261001_productos_v1.sql'), 'utf8');
  const storageSql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261001120000_productos_storage.sql'), 'utf8');
  assert.match(productsSql, /precio > 0 AND precio <> 'NaN'::numeric/);
  assert.match(productsSql, /mi_rol\(\) = 'staff' AND activo = true/);
  assert.doesNotMatch(productsSql, /GRANT\s+DELETE/i);
  assert.match(storageSql, /public,\s*file_size_limit,\s*allowed_mime_types[\s\S]*?false,[\s\S]*?2097152/);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) assert.match(storageSql, new RegExp(mime));
  assert.match(storageSql, /mi_rol\(\) = 'staff'[\s\S]*?p\.activo = true/);
  assert.match(storageSql, /FOR (?:INSERT|UPDATE|DELETE) TO authenticated[\s\S]*?mi_rol\(\) IN \('admin', 'owner'\)/);
});

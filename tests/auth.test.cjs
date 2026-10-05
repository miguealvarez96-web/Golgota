// Pruebas aisladas del handler y del middleware reales; no usan credenciales,
// no envían peticiones ni sustituyen la autenticación de la aplicación.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { NextRequest } = require('next/server');

function load(relative, mocks, source) {
  const filename = path.join(__dirname, '..', relative);
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  const compiled = ts.transpileModule(source ?? fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  module._compile('const window = require("test-window");\n' + compiled, filename);
  return module.exports;
}

function loginHarness(signIn, source) {
  const states = ['test@example.invalid', 'test-only-password', null, null, false, false];
  let cursor = 0;
  const navigations = [];
  const { default: Login } = load('src/app/(auth)/login/page.tsx', {
    react: { ...require('react'), useState: () => { const i = cursor++; return [states[i], (value) => { states[i] = value; }]; } },
    '@/components/layout/brand': () => null,
    '@/lib/supabase/client': { createClient: () => ({ auth: { signInWithPassword: signIn } }) },
    'test-window': { location: { replace: (url) => navigations.push(url) } },
    'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
  }, source);
  function findForm(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'form') return node;
    return [node.props?.children].flat().map(findForm).find(Boolean);
  }
  const form = findForm(Login());
  return { states, navigations, submit: () => form.props.onSubmit({ preventDefault() {} }) };
}

test('reproduce el bloqueo original ante una excepción y comprueba su corrección', async () => {
  const { execFileSync } = require('node:child_process');
  const stable = execFileSync('git', ['show', '5ec458d:src/app/(auth)/login/page.tsx'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const fail = async () => { throw Error('private detail'); };
  const before = loginHarness(fail, stable);
  await assert.rejects(before.submit());
  assert.equal(before.states[4], true);
  const after = loginHarness(fail);
  await after.submit();
  assert.equal(after.states[4], false);
  assert.match(after.states[2], /No fue posible iniciar sesión/);
  assert.doesNotMatch(after.states[2], /private detail/);
});

test('login espera al SDK antes de navegar a / y libera loading', async () => {
  let resolve;
  const h = loginHarness(() => new Promise((done) => { resolve = done; }));
  const pending = h.submit();
  assert.equal(h.states[4], true);
  assert.deepEqual(h.navigations, []);
  resolve({ data: { user: { id: 'test' }, session: {} }, error: null });
  await pending;
  assert.deepEqual(h.navigations, ['/']);
  assert.equal(h.states[4], false);
});

test('credenciales rechazadas, fallo de red o sesión incompleta liberan loading', async () => {
  for (const result of [
    { data: {}, error: { code: 'invalid_credentials' } },
    { data: {}, error: { name: 'AuthRetryableFetchError', message: 'private detail' } },
    { data: { user: null, session: null }, error: null },
  ]) {
    const h = loginHarness(async () => result);
    await h.submit();
    assert.equal(h.states[4], false);
    assert.deepEqual(h.navigations, []);
    assert.equal(typeof h.states[2], 'string');
    assert.doesNotMatch(h.states[2], /private detail/);
  }
});

function middlewareHarness(user, refresh = false) {
  return load('src/middleware.ts', {
    'test-window': {},
    '@supabase/ssr': { createServerClient: (_url, _key, options) => ({ auth: {
      getUser: async () => {
        if (refresh) options.cookies.setAll([{ name: 'test-session', value: 'test-only', options: { path: '/', maxAge: 60, httpOnly: true, sameSite: 'lax' } }]);
        return { data: { user } };
      },
    } }) },
  }).middleware;
}

test('login permanece público aun con sesión: no rebota hacia el layout', async () => {
  const middleware = middlewareHarness({ id: 'test' });
  const response = await middleware(new NextRequest('http://localhost:3000/login'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});

test('rutas privadas siguen protegidas y las rutas de acceso y privacidad son públicas', async () => {
  const middleware = middlewareHarness(null);
  for (const route of ['/login', '/reset-password', '/auth/callback', '/privacidad']) {
    assert.equal((await middleware(new NextRequest(`http://localhost:3000${route}`))).status, 200);
  }
  for (const route of ['/', '/clientes', '/membresias', '/asistencia', '/productos', '/gastos', '/reportes']) {
    const response = await middleware(new NextRequest(`http://localhost:3000${route}`));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location')).pathname, '/login');
  }
  assert.equal((await middlewareHarness({ id: 'test' })(new NextRequest('http://localhost:3000/'))).status, 200);
});

test('la redirección conserva las cookies actualizadas y sus atributos', async () => {
  const response = await middlewareHarness(null, true)(new NextRequest('http://localhost:3000/'));
  assert.equal(response.status, 307);
  const cookie = response.cookies.get('test-session');
  assert.equal(cookie.value, 'test-only');
  assert.equal(cookie.path, '/');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'lax');
  assert.equal(cookie.maxAge, 60);
});

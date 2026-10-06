const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  module._compile(compiled, filename);
  return module.exports;
}

const model = load('src/lib/usuarios-internos/model.ts');
const loginSource = read('src/app/(auth)/login/page.tsx');
const actionsSource = read('src/app/(app)/usuarios/actions.ts');
const migration = read('supabase/migrations/20261010_usuarios_internos.sql');
const preflight = read('supabase/preflight/20261010_preflight_usuarios_internos.sql');
const postflight = read('supabase/postflight/20261010_postflight_usuarios_internos.sql');
const rollback = read('supabase/rollback/20261010_rollback_usuarios_internos.sql');
const dryRun = read('scripts/dry-run-usuarios-internos.ps1');
const registrationMigration = read('supabase/migrations/20261008_registro_publico_alumnos.sql');
const navigation = read('src/components/layout/portal-navigation.tsx');
const adminClient = read('src/lib/supabase/admin.ts');
const macro = read('scripts/cerrar-bloque-usuarios-internos.ps1');

test('el login de alumno conserva email/password y la recuperacion por correo', () => {
  assert.match(loginSource, /identity\.includes\("@"\)[\s\S]*identity\.toLowerCase\(\)[\s\S]*signInWithPassword/);
  assert.match(loginSource, /resetPasswordForEmail/);
  assert.match(loginSource, /Crear cuenta de alumno/);
});

test('owner y staff autentican directo con email tecnico y validan su perfil propio', () => {
  assert.equal(model.internalEmail('carla'), 'carla@golgota.internal');
  assert.match(actionsSource, /const email = internalEmail\(parsed\.data\.username\)/);
  assert.match(loginSource, /usernameSchema\.parse\(validation\.data\.identity\)/);
  assert.match(loginSource, /internalEmail\(internalUsername\)/);
  assert.match(loginSource, /signInWithPassword\(\{[\s\S]*email,/);
  assert.match(loginSource, /\.from\("usuarios"\)[\s\S]*profile\?\.activo === true/);
  assert.match(loginSource, /profile\.rol === "owner"[\s\S]*profile\.rol === "staff"/);
  assert.match(loginSource, /auth\.signOut\(\)/);
  assert.doesNotMatch(loginSource, /\/api\/auth\/internal-login/);
});

test('solo owner y staff son roles aceptados y no pueden escalar a admin', () => {
  const base = { nombre: 'Coach Uno', username: 'coach1', password: '12345678', passwordConfirmation: '12345678', activo: true };
  assert.equal(model.createInternalUserSchema.safeParse({ ...base, rol: 'owner' }).success, true);
  assert.equal(model.createInternalUserSchema.safeParse({ ...base, rol: 'staff' }).success, true);
  assert.equal(model.createInternalUserSchema.safeParse({ ...base, rol: 'admin' }).success, false);
  assert.equal(model.updateInternalUserSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001', rol: 'alumno', activo: true }).success, false);
});

test('username y contrasenas aplican formato, normalizacion y confirmacion', () => {
  assert.equal(model.usernameSchema.parse(' Diego '), 'diego');
  assert.equal(model.usernameSchema.safeParse('diego+test').success, false);
  assert.equal(model.createInternalUserSchema.safeParse({ nombre: 'Diego', username: 'diego', rol: 'owner', password: '1234567', passwordConfirmation: '1234567', activo: true }).success, false);
  assert.equal(model.createInternalUserSchema.safeParse({ nombre: 'Diego', username: 'diego', rol: 'owner', password: '12345678', passwordConfirmation: 'otra-clave', activo: true }).success, false);
});

test('admin crea owner/staff, cambia estado/rol y restablece password por Admin API', () => {
  assert.match(actionsSource, /getInternalUsersAdminAccess/);
  assert.match(actionsSource, /auth\.admin\.createUser\([\s\S]*email_confirm:\s*true/);
  assert.match(actionsSource, /rol:\s*parsed\.data\.rol/);
  assert.match(actionsSource, /auth\.admin\.updateUserById\([\s\S]*password:/);
  assert.match(actionsSource, /PASSWORD_RESET/);
  assert.match(actionsSource, /ban_duration:\s*parsed\.data\.activo\s*\?\s*"none"/);
  assert.doesNotMatch(actionsSource, /datos_nuevos:[^\n]*password/i);
});

test('la accion de admin crea owner y staff sin enviar la contrasena a public.usuarios', async () => {
  for (const role of ['owner', 'staff']) {
    const publicUpdates = [];
    const authCreates = [];
    const access = {
      userId: '00000000-0000-4000-8000-000000000099',
      supabase: { from: () => ({
        select: () => ({ or: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        update: (values) => { publicUpdates.push(values); return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: 'new-user' }, error: null }) }) }) }; },
      }) },
    };
    const admin = { auth: { admin: {
      createUser: async (values) => { authCreates.push(values); return { data: { user: { id: 'new-user' } }, error: null }; },
      deleteUser: async () => ({ error: null }),
    } } };
    const actions = load('src/app/(app)/usuarios/actions.ts', {
      'next/cache': { revalidatePath() {} },
      '@/lib/supabase/admin': { createAdminClient: () => admin },
      '@/lib/usuarios-internos/access': { getInternalUsersAdminAccess: async () => access },
      '@/lib/usuarios-internos/model': model,
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({ nombre: 'Cuenta Interna', username: `${role}1`, rol: role, password: 'clave1234', passwordConfirmation: 'clave1234', activo: 'true' })) form.set(key, value);
    const result = await actions.createInternalUser(form);
    assert.equal(result.ok, true);
    assert.equal(authCreates[0].email_confirm, true);
    assert.equal(authCreates[0].password, 'clave1234');
    assert.equal(publicUpdates[0].rol, role);
    assert.equal('password' in publicUpdates[0], false);
  }
});

test('admin restablece la contrasena en Auth y audita sin guardar el secreto', async () => {
  const authUpdates = [];
  const audits = [];
  const access = {
    userId: '00000000-0000-4000-8000-000000000099',
    supabase: { from: () => ({ select: () => ({ eq: () => ({ not: () => ({ single: async () => ({ data: { id: '00000000-0000-4000-8000-000000000001', login_username: 'coach1', rol: 'staff' }, error: null }) }) }) }) }) },
  };
  const admin = {
    auth: { admin: { updateUserById: async (id, values) => { authUpdates.push({ id, values }); return { error: null }; } } },
    from: () => ({ insert: async (values) => { audits.push(values); return { error: null }; } }),
  };
  const actions = load('src/app/(app)/usuarios/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/usuarios-internos/access': { getInternalUsersAdminAccess: async () => access },
    '@/lib/usuarios-internos/model': model,
  });
  const result = await actions.resetInternalPassword({ id: '00000000-0000-4000-8000-000000000001', password: 'nueva1234', passwordConfirmation: 'nueva1234' });
  assert.equal(result.ok, true);
  assert.equal(authUpdates[0].values.password, 'nueva1234');
  assert.equal(JSON.stringify(audits).includes('nueva1234'), false);
  assert.equal(audits[0].accion, 'PASSWORD_RESET');
});

test('owner, staff y alumno quedan bloqueados por la comprobacion server-side de admin', () => {
  const access = read('src/lib/usuarios-internos/access.ts');
  assert.match(access, /profile\.rol !== "admin"/);
  assert.match(actionsSource, /if \(!access\)[\s\S]*No tienes permiso/);
  assert.match(navigation, /href === "\/usuarios"\) return role === "admin"/);
});

test('el helper server-side rechaza owner, staff, alumno e inactivos', async () => {
  for (const [role, active, allowed] of [['admin', true, true], ['owner', true, false], ['staff', true, false], ['alumno', true, false], ['admin', false, false]]) {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { rol: role, activo: active }, error: null }) }) }) }),
    };
    const accessModule = load('src/lib/usuarios-internos/access.ts', { '@/lib/supabase/server': { createClient: () => client } });
    assert.equal(Boolean(await accessModule.getInternalUsersAdminAccess()), allowed);
  }
});

test('RLS e invariantes SQL protegen username y no crean cuentas iniciales', () => {
  assert.match(migration, /UNIQUE INDEX usuarios_login_username_lower_key[\s\S]*lower\(login_username\)/);
  assert.match(migration, /\^\[a-z0-9\._-\]\{3,50\}\$/);
  assert.match(migration, /rol IN \('owner', 'staff'\)/);
  assert.match(postflight, /policyname = 'usuarios_admin'/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.usuarios FROM PUBLIC, anon, authenticated/);
  assert.match(postflight, /has_table_privilege\('authenticated', 'public\.usuarios', 'DELETE'\)/);
  assert.doesNotMatch(migration, /diego|carla|coach1|coach2/i);
  assert.doesNotMatch(migration, /(?:ADD COLUMN|INSERT INTO|UPDATE)[^;]*(?:password|contrasena)/i);
});

test('la validacion de cuarentena no confunde el comentario historico staff con metadata de rol', () => {
  const trigger = registrationMigration.match(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?(?=REVOKE ALL ON FUNCTION)/)[0];
  assert.match(trigger, /raw_user_meta_data[\s\S]*DEFAULT historico staff/i);
  assert.equal(/raw_user_meta_data[\s\S]*(?:admin|owner|staff)/i.test(trigger), true, 'reproduce el falso positivo anterior');
  assert.match(preflight, /raw_user_meta_data\\s\*->>\?\\s\*''\(rol\|role\|tipo_rol\|account_type\)''/);
  assert.match(postflight, /raw_user_meta_data\\s\*->>\?\\s\*''\(rol\|role\|tipo_rol\|account_type\)''/);
  assert.match(postflight, /'''\(admin\|owner\|staff\)'''/);
  assert.doesNotMatch(postflight, /raw_user_meta_data\.\*\(\?:admin\|owner\|staff\)/);
});

test('la migracion y el dry-run garantizan que handle_new_user queda byte a byte intacta', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.handle_new_user/);
  assert.match(migration, /usuarios_internos_handle_guard[\s\S]*pg_get_functiondef\('public\.handle_new_user\(\)'::regprocedure\)/);
  assert.match(migration, /IS DISTINCT FROM \(SELECT definition FROM usuarios_internos_handle_guard\)/);
  assert.match(dryRun, /dry_run_handle_new_user_guard[\s\S]*El dry-run detecto un cambio en handle_new_user/);
  assert.match(rollback, /handle_new_user queda intacta/);
});

test('SERVICE_ROLE queda solo en servidor y nunca usa prefijo NEXT_PUBLIC', () => {
  assert.match(adminClient, /import "server-only"/);
  assert.match(adminClient, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(adminClient, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/);
  for (const file of ['src/app/(auth)/login/page.tsx', 'src/components/usuarios-internos/internal-users-manager.tsx', 'src/lib/supabase/client.ts']) {
    assert.doesNotMatch(read(file), /SERVICE_ROLE|service_role/);
  }
});

test('macro exige dry-run, confirmaciones, pruebas, build y commit esperado', () => {
  assert.match(macro, /dry-run-usuarios-internos/);
  assert.match(macro, /Aplicar SQL real/);
  assert.match(macro, /node[\s\S]*--test[\s\S]*tsc[\s\S]*--noEmit[\s\S]*npm[\s\S]*build/);
  assert.match(macro, /feat: add managed internal users/);
  assert.match(macro, /Hacer commit y push/);
  assert.match(macro, /Desplegar a produccion/);
});

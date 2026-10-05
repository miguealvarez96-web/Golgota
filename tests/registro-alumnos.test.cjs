const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }
function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const source = ts.transpileModule(read(relative), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  module._compile(source, filename);
  return module.exports;
}

const clientModel = load('src/lib/clientes/model.ts');
const privacyModel = load('src/lib/privacidad/model.ts');
const model = load('src/lib/registro/model.ts', {
  '@/lib/clientes/model': clientModel,
  '@/lib/privacidad/model': privacyModel,
});
const migration = read('supabase/migrations/20261008_registro_publico_alumnos.sql');
const preflight = read('supabase/preflight/20261008_preflight_registro_publico_alumnos.sql');
const postflight = read('supabase/postflight/20261008_postflight_registro_publico_alumnos.sql');
const rollback = read('supabase/rollback/20261008_rollback_registro_publico_alumnos.sql');
const dryRun = read('scripts/dry-run-registro-publico-alumnos.ps1');
const macro = read('scripts/cerrar-bloque-registro-alumnos.ps1');
const middleware = read('src/middleware.ts');
const login = read('src/app/(auth)/login/page.tsx');
const callback = read('src/app/auth/callback/route.ts');
const page = read('src/app/(auth)/registro/page.tsx');
const form = read('src/components/auth/student-registration-form.tsx');

const valid = {
  nombres: ' María José ', apellidos: " Peña O'Connor ", cedula: '0012345678',
  celular: '+593 (99) 123-4567', email: ' ALUMNA@EXAMPLE.COM ',
  password: 'ClaveSegura9', confirmPassword: 'ClaveSegura9',
  aviso_version: privacyModel.PRIVACY_NOTICE_VERSION,
  aviso_leido: true, comunicaciones_promocionales: false,
};

test('/registro es pública, responsive y está enlazada desde login', () => {
  assert.match(middleware, /pathname === "\/registro"/);
  assert.match(login, /href="\/registro"[\s\S]*Crear cuenta de alumno/);
  assert.match(page, /Brand[\s\S]*Registro de alumnos/);
  assert.match(form, /grid gap-5 sm:grid-cols-2/);
  assert.match(form, /Ya tengo cuenta/);
  assert.match(form, /Recuperar contraseña/);
  assert.match(form, /href="\/privacidad"/);
});

test('normaliza como clientes y exige contraseña, confirmación y privacidad', () => {
  const parsed = model.studentRegistrationSchema.parse(valid);
  assert.equal(parsed.nombres, 'MARÍA JOSÉ');
  assert.equal(parsed.apellidos, "PEÑA O'CONNOR");
  assert.equal(parsed.cedula, '0012345678');
  assert.equal(parsed.celular, '+593991234567');
  assert.equal(parsed.email, 'alumna@example.com');
  assert.equal(model.studentRegistrationSchema.safeParse({ ...valid, confirmPassword: 'OtraClave9' }).success, false);
  assert.equal(model.studentRegistrationSchema.safeParse({ ...valid, aviso_leido: false }).success, false);
  assert.equal(model.studentRegistrationSchema.safeParse({ ...valid, password: 'abcdefgh', confirmPassword: 'abcdefgh' }).success, false);
});

test('rol y campos protegidos no pueden enviarse; el servidor usa una lista explícita', async () => {
  const calls = [];
  const actions = load('src/app/(auth)/registro/actions.ts', {
    '@/lib/registro/model': model,
    '@/lib/supabase/server': { createClient() { return { auth: { async getUser() { return { data: { user: null } }; } } }; } },
    '@supabase/supabase-js': { createClient() { return { async rpc(name, args) { calls.push({ name, args }); return { data: { code: 'READY' }, error: null }; } }; } },
  });
  assert.equal((await actions.prepareStudentRegistration({ ...valid, rol: 'admin' })).ok, false);
  assert.equal((await actions.prepareStudentRegistration({ ...valid, auth_user_id: 'b98e5f70-849c-4df8-906a-2b20654fdb39' })).ok, false);
  assert.equal(calls.length, 0);
  const result = await actions.prepareStudentRegistration(valid);
  assert.equal(result.ok, true);
  assert.equal(calls[0].name, 'preparar_registro_alumno');
  assert.equal(Object.hasOwn(calls[0].args, 'password'), false);
  assert.equal(Object.hasOwn(calls[0].args, 'rol'), false);
  assert.deepEqual(Object.keys(calls[0].args).sort(), [
    'p_apellidos', 'p_aviso_version', 'p_cedula', 'p_celular',
    'p_comunicaciones_promocionales', 'p_email', 'p_nombres', 'p_token',
  ].sort());
});

test('cliente nuevo se crea y vincula atómicamente con rol alumno y privacidad', () => {
  const trigger = migration.match(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?(?=REVOKE ALL ON FUNCTION)/)[0];
  assert.match(trigger, /INSERT INTO public\.usuarios[\s\S]*'alumno', true/);
  assert.match(trigger, /INSERT INTO public\.clientes[\s\S]*created_by, auth_user_id[\s\S]*NEW\.id, NEW\.id/);
  assert.match(trigger, /INSERT INTO public\.privacidad_aceptaciones/);
  assert.match(trigger, /'REGISTRO_PUBLICO'/);
  assert.match(trigger, /estado = 'COMPLETADO'[\s\S]*auth_user_id = NEW\.id/);
  assert.doesNotMatch(trigger, /INSERT INTO public\.(?:membresias|pagos)/);
});

test('cliente existente nunca se duplica ni se vincula solo por conocer su cédula', () => {
  const prepare = migration.match(/CREATE FUNCTION public\.preparar_registro_alumno[\s\S]*?(?=CREATE OR REPLACE FUNCTION)/)[0];
  assert.match(prepare, /FROM public\.clientes[\s\S]*WHERE c\.cedula = v_cedula[\s\S]*FOR UPDATE/);
  assert.match(prepare, /auth_user_id IS NOT NULL[\s\S]*ALREADY_LINKED/);
  assert.match(prepare, /HELP_REQUIRED/);
  assert.ok(prepare.indexOf('HELP_REQUIRED') < prepare.indexOf('INSERT INTO public.registro_alumno_intentos'));
  assert.doesNotMatch(prepare, /UPDATE public\.clientes/);
});

test('correo existente no duplica Auth y las respuestas no filtran datos privados', () => {
  assert.match(migration, /FROM auth\.users u WHERE lower\(u\.email\) = v_email[\s\S]*EMAIL_EXISTS/);
  assert.match(form, /user_already_exists/);
  assert.match(form, /data\.user\.identities\?\.length === 0/);
  assert.match(form, /Ya existe una cuenta con este correo\. Inicia sesión o recupera tu contraseña\./);
  assert.doesNotMatch(form, /signUpError\.(?:message|details|hint)/);
});

test('altas fuera del flujo nunca obtienen staff/admin/owner y quedan inactivas', () => {
  const trigger = migration.match(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?(?=REVOKE ALL ON FUNCTION)/)[0];
  const quarantine = trigger.match(/IF v_token_text IS NULL[\s\S]*?RETURN NEW;/)[0];
  assert.match(quarantine, /'alumno', false/);
  assert.doesNotMatch(quarantine, /'admin'|'owner'|'staff'/);
  assert.match(postflight, /v_trigger ~\* '''admin''\|''owner''\|''staff'''/);
});

test('privacidad obligatoria se registra y promociones siguen opcionales sin premarcar', () => {
  assert.match(migration, /aviso_version[\s\S]*accepted_at[\s\S]*REGISTRO_PUBLICO/);
  assert.match(migration, /AVISO_PRIVACIDAD_LEIDO/);
  assert.match(migration, /COMUNICACIONES_PROMOCIONALES/);
  const optional = form.match(/name="comunicaciones_promocionales"[\s\S]*?<\/label>/)[0];
  assert.doesNotMatch(optional, /defaultChecked|checked=/);
  assert.match(form, /name="aviso_leido"[\s\S]*required/);
});

test('fallos parciales no crean cliente suelto y el intento conserva coherencia', () => {
  const trigger = migration.match(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?(?=REVOKE ALL ON FUNCTION)/)[0];
  assert.match(trigger, /RAISE EXCEPTION[\s\S]*INSERT INTO public\.usuarios[\s\S]*INSERT INTO public\.clientes[\s\S]*INSERT INTO public\.privacidad_aceptaciones[\s\S]*COMPLETADO/);
  assert.match(migration, /registro_alumno_intento_estado_coherente/);
  assert.match(migration, /expires_at timestamptz[\s\S]*interval '30 minutes'/);
  assert.doesNotMatch(migration, /DELETE FROM auth\.users|service_role/i);
});

test('RLS impide acceso directo, membresías, pagos y acceso cruzado', () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.registro_alumno_intentos FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*registro_alumno_intentos/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*TO anon/);
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO authenticated/);
  assert.match(postflight, /INSERT INTO public\\\.membresias/);
  assert.match(postflight, /INSERT INTO public\\\.pagos/);
});

test('confirmación de correo y callback soportan sesión inmediata o correo pendiente', () => {
  assert.match(form, /emailRedirectTo: `\$\{window\.location\.origin\}\/auth\/callback\?next=\/portal`/);
  assert.match(form, /if \(data\.session\)[\s\S]*window\.location\.replace\("\/portal"\)/);
  assert.match(form, /Revisa tu correo para confirmar tu cuenta\./);
  assert.match(callback, /next === "\/portal" \? "\/portal" : "\/reset-password"/);
  assert.match(login, /signInWithPassword/);
  assert.match(login, /resetPasswordForEmail/);
});

test('rate limit básico, SQL reversible y macro controlado', () => {
  assert.match(migration, /interval '1 hour'[\s\S]*>= 5[\s\S]*RATE_LIMITED/);
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(postflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.match(dryRun, /BEGIN;[\s\S]*\$migrationBody[\s\S]*\$postflightBody[\s\S]*\$rollback/);
  assert.match(macro, /Aplicar SQL real/);
  assert.match(macro, /feat: add public student registration/);
  assert.match(macro, /https:\/\/golgota\.vercel\.app\/registro/);
  assert.doesNotMatch(macro.match(/\$blockFiles = @\([\s\S]*?\n  \)/)[0], /\.gitignore/);
});

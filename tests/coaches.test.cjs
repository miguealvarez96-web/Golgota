const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const code = ts.transpileModule(read(relative), {
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

const model = load('src/lib/coaches/model.ts');
const migration = read('supabase/migrations/20261004_coaches_completos_v1.sql');
const preflight = read('supabase/preflight/20261004_preflight_coaches_completos_v1.sql');
const postflight = read('supabase/postflight/20261004_postflight_coaches_completos_v1.sql');
const rollback = read('supabase/rollback/20261004_rollback_coaches_completos_v1.sql');
const dryRun = read('scripts/dry-run-coaches-completos-v1.ps1');
const macro = read('scripts/cerrar-bloque-coaches.ps1');
const wodPage = read('src/app/(app)/wod/page.tsx');
const announcementsPage = read('src/app/(app)/comunicados/page.tsx');
const dashboard = read('src/components/coaches/coach-dashboard.tsx');
const dashboardData = read('src/lib/coaches/data.ts');
const navigation = read('src/components/layout/portal-navigation.tsx');
const clientPage = read('src/app/(app)/clientes/page.tsx');
const clientManager = read('src/components/clientes/clients-manager.tsx');
const expensesPage = read('src/app/(app)/gastos/page.tsx');
const reportsPage = read('src/app/(app)/reportes/page.tsx');
const reportsAccess = read('src/lib/reportes/access.ts');
const id = 'b98e5f70-849c-4df8-906a-2b20654fdb39';

function actionHarness(role, relative, exportName, table) {
  const writes = [];
  const query = {
    insert(data) { writes.push({ operation: 'insert', data }); return this; },
    update(data) { writes.push({ operation: 'update', data }); return this; },
    eq() { return this; }, select() { return this; },
    async single() { return { data: { id }, error: null }; },
  };
  const actions = load(relative, {
    '@/lib/coaches/access': { async getCoachAccess() { return { role, userId: id, supabase: { from(name) { assert.equal(name, table); return query; } } }; } },
    '@/lib/coaches/model': model,
    'next/cache': { revalidatePath() {} },
  });
  return { action: actions[exportName], writes };
}

test('modelos validan contenido y rechazan campos protegidos', () => {
  assert.equal(model.wodSchema.safeParse({ fecha: '2026-10-04', titulo: ' Fuerza ', contenido: ' Trabajo ', publicado: true }).success, true);
  assert.equal(model.announcementSchema.safeParse({ titulo: '', contenido: 'Aviso', publicado: true }).success, false);
  assert.equal(model.wodSchema.safeParse({ fecha: '2026-10-04', titulo: 'WOD', contenido: 'Trabajo', publicado: true, created_by: id }).success, false);
});

test('staff y alumno no administran WOD ni comunicados aunque invoquen acciones', async () => {
  for (const role of ['staff', 'alumno']) {
    const wod = actionHarness(role, 'src/app/(app)/wod/actions.ts', 'saveWod', 'wods');
    const announcement = actionHarness(role, 'src/app/(app)/comunicados/actions.ts', 'saveAnnouncement', 'comunicados');
    assert.equal((await wod.action(null, { fecha: '2026-10-04', titulo: 'WOD', contenido: 'Trabajo', publicado: true })).ok, false);
    assert.equal((await announcement.action(null, { titulo: 'Aviso', contenido: 'Contenido', publicado: true })).ok, false);
    assert.equal(wod.writes.length + announcement.writes.length, 0);
  }
});

test('admin y owner crean y editan WOD y comunicados con campos permitidos', async () => {
  for (const role of ['admin', 'owner']) {
    const wod = actionHarness(role, 'src/app/(app)/wod/actions.ts', 'saveWod', 'wods');
    assert.equal((await wod.action(null, { fecha: '2026-10-04', titulo: 'WOD', contenido: 'Trabajo', publicado: true })).ok, true);
    assert.equal(wod.writes[0].data.created_by, id);
    const announcement = actionHarness(role, 'src/app/(app)/comunicados/actions.ts', 'saveAnnouncement', 'comunicados');
    assert.equal((await announcement.action(id, { titulo: 'Aviso', contenido: 'Contenido', publicado: false })).ok, true);
    assert.deepEqual(announcement.writes[0], { operation: 'update', data: { titulo: 'Aviso', contenido: 'Contenido', publicado: false } });
  }
});

test('RLS permite gestión a admin/owner, lectura publicada a staff y nada a alumno', () => {
  for (const table of ['wods', 'comunicados']) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`${table}_lectura_gestion[\\s\\S]*mi_rol\\(\\) IN \\('admin', 'owner'\\)`));
    assert.match(migration, new RegExp(`${table}_lectura_staff_publicados[\\s\\S]*mi_rol\\(\\) = 'staff'[\\s\\S]*publicado`));
  }
  assert.doesNotMatch(migration, /mi_rol\(\).*alumno/);
  assert.doesNotMatch(migration, /GRANT\s+DELETE/i);
  assert.match(postflight, /Alumno obtuvo una política del portal coach/);
});

test('staff ve solo WOD del día y comunicados publicados; no recibe controles de gestión', () => {
  assert.match(wodPage, /!canManage[\s\S]*\.eq\("fecha", today\)\.eq\("publicado", true\)/);
  assert.match(announcementsPage, /!canManage[\s\S]*\.eq\("publicado", true\)\.lte\("fecha_publicacion"/);
  assert.match(navigation, /WOD[\s\S]*Comunicados/);
  assert.match(dashboard, /Búsqueda rápida de alumno[\s\S]*Próximos a vencer[\s\S]*Membresías vencidas[\s\S]*WOD del día[\s\S]*Comunicados recientes/);
  assert.doesNotMatch(dashboard + dashboardData, /saldo|abono|ingresos|from\("pagos"\)/i);
});

test('búsqueda de alumnos muestra vigencia completa sin datos financieros', () => {
  assert.match(clientPage, /v_membresias_verificacion/);
  for (const field of ['plan', 'fecha_inicio', 'fecha_fin', 'estado_vigencia']) assert.match(clientPage, new RegExp(field));
  for (const state of ['POR_INICIAR', 'VIGENTE', 'POR_VENCER', 'VENCE_HOY', 'VENCIDA']) assert.match(migration, new RegExp(state));
  assert.match(clientManager, /Sin membresía[\s\S]*VigencyBadge/);
  assert.doesNotMatch(clientPage, /v_membresias_estado|\.select\("[^"]*(?:saldo|abono|estado_pago)/);
});

test('staff conserva alta de clientes pero rutas financieras siguen bloqueadas', () => {
  assert.match(expensesPage, /access\.role === "staff"[\s\S]*redirect\("\/"\)/);
  assert.match(reportsPage, /getReportAccess\(\)[\s\S]*if \(!access\) redirect\("\/"\)/);
  assert.match(reportsAccess, /!\["admin", "owner"\]\.includes\(profile\.rol\)[\s\S]*return null/);
  assert.match(navigation, /staffSections = new Set\(\["\/", "\/clientes", "\/wod", "\/comunicados"\]\)/);
  assert.match(navigation, /role === "staff"[\s\S]*staffSections\.has\(href\)/);
  assert.match(clientManager, /Nuevo cliente/);
  assert.match(clientManager, /\{canEdit && <td className="p-3[\s\S]*?editButton\(client\)/);
});

test('preflight, postflight y dry-run comprueban aislamiento y terminan en ROLLBACK', () => {
  assert.match(preflight, /proyección operativa expone información financiera/);
  assert.match(postflight, /fecha_inicio/);
  assert.match(dryRun, /Get-MigrationBody \$migrationPath/);
  assert.match(dryRun, /Get-ReadOnlyBody \$postflightPath/);
  assert.match(dryRun, /finally[\s\S]*Remove-Item -LiteralPath \$temporaryPath/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.doesNotMatch(rollback, /\b(?:DROP|DELETE|COMMIT)\b/i);
});

test('macro separa stderr de Vercel y decide por ExitCode', () => {
  assert.match(macro, /Start-Process[\s\S]*RedirectStandardOutput[\s\S]*RedirectStandardError/);
  assert.match(macro, /\$process\.ExitCode -ne 0/);
  assert.doesNotMatch(macro, /& \$vercelCommand --prod 2>&1/);
  assert.match(macro, /feat: complete coach portal/);
  assert.match(macro, /SUPABASE_DB_URL/);
});

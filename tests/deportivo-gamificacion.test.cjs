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
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = new Module(filename); module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = module.require.bind(module);
  module.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  module._compile(code, filename); return module.exports;
}

const clientModel = load('src/lib/clientes/model.ts');
const model = load('src/lib/deportivo/model.ts', { '@/lib/clientes/model': clientModel });
const migration = read('supabase/migrations/20261013_deportivo_gamificacion.sql');
const preflight = read('supabase/preflight/20261013_deportivo_gamificacion.sql');
const postflight = read('supabase/postflight/20261013_deportivo_gamificacion.sql');
const rollback = read('supabase/rollback/20261013_deportivo_gamificacion.sql');
const dryRun = read('scripts/dry-run-deportivo-gamificacion.ps1');
const macro = read('scripts/cerrar-bloque-deportivo-gamificacion.ps1');
const studentUi = read('src/components/alumnos/student-sports-panel.tsx');
const coachUi = read('src/components/coaches/wod-manager.tsx');
const privacy = read('src/app/privacidad/page.tsx');
const studentId = 'b98e5f70-849c-4df8-906a-2b20654fdb39';

test('progreso calcula IMC, conserva historial ordenado y queda aislado por alumno', () => {
  assert.equal(model.calculateBmi(80, 2), 20);
  assert.equal(model.calculateBmi(70, 1.75), 22.86);
  assert.match(migration, /imc numeric\(6,2\) GENERATED ALWAYS AS/);
  assert.match(migration, /progreso_fisico_alumno_lectura[\s\S]*usuario_id = auth\.uid\(\)/);
  assert.match(migration, /progreso_fisico_alumno_creacion[\s\S]*usuario_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /progreso_fisico_coach/);
  assert.match(migration, /ORDER BY p\.fecha DESC,p\.created_at DESC\) FROM public\.progreso_fisico p WHERE p\.usuario_id=auth\.uid\(\)/);
  assert.match(studentUi, /Índice de Masa Corporal \(IMC\) orientativo/);
  assert.doesNotMatch(studentUi, /peso ideal|dieta|diagnóstico médico[^<]*recomienda/i);
});

test('récords comparan solo ejercicio, nombre y unidad equivalentes', () => {
  const base = { id: studentId, ejercicio: 'DEADLIFT', nombre_personalizado: null, valor: 100, unidad: 'KG', fecha: '2026-10-10', observacion: null, created_at: '2026-10-10T00:00:00Z' };
  const rows = [base, { ...base, id: '24b14e94-4408-4ea9-bde0-44d867a2ae09', valor: 120 }, { ...base, id: 'b9b6914b-946e-41a9-a5e1-e3fb9f8bd506', valor: 20, unidad: 'REPETICIONES' }];
  assert.equal(model.bestComparableRecord(rows, base).valor, 120);
  assert.equal(model.bestComparableRecord(rows, rows[2]).valor, 20);
  assert.match(studentUi, /Último registro[\s\S]*Mejor registro[\s\S]*Historial/);
  assert.match(migration, /registrar_record_personal[\s\S]*mi_rol\(\)::text <> 'alumno'/);
  assert.match(migration, /records_personales_coach_lectura/);
  assert.match(coachUi, /Vista deportiva segura: no incluye peso corporal, estatura, IMC ni datos de contacto/);
});

test('WOD normaliza MM:SS y HH:MM:SS, limita un resultado y ordena menor tiempo primero', () => {
  assert.equal(model.parseWodTime('08:42'), 522);
  assert.equal(model.parseWodTime('01:08:42'), 4122);
  assert.equal(model.parseWodTime('08:99'), null);
  assert.equal(model.formatWodTime(522), '08:42');
  assert.match(migration, /CONSTRAINT wod_resultados_unico UNIQUE \(wod_id, usuario_id\)/);
  assert.match(migration, /ON CONFLICT \(wod_id,usuario_id\) DO UPDATE[\s\S]*updated_at=now\(\)/);
  assert.match(migration, /row_number\(\) OVER\(ORDER BY wr\.tiempo_segundos,wr\.created_at\)/);
  assert.match(migration, /public\.mi_rol\(\)::text <> 'alumno'[\s\S]*WHERE id=p_wod_id AND publicado AND permite_resultados/);
  assert.match(studentUi, /Registrar mi tiempo[\s\S]*MM:SS o HH:MM:SS[\s\S]*Ranking del WOD/);
});

test('ranking y panel coach proyectan únicamente identidad abreviada y datos deportivos', () => {
  const coachFunction = migration.match(/CREATE FUNCTION public\.listar_panel_deportivo_coach\(\)[\s\S]*?(?=CREATE FUNCTION public\.listar_desafios_gestion)/)[0];
  assert.match(coachFunction, /'admin','owner','staff'/);
  assert.match(coachFunction, /nombre_visible/);
  for (const privateField of ['peso_kg', 'estatura_m', 'imc', 'cedula', 'email', 'celular', 'pagos']) assert.doesNotMatch(coachFunction, new RegExp(privateField, 'i'));
  assert.match(migration, /wod_resultados_alumno_edicion[\s\S]*usuario_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[^;]*ON TABLE public\.wod_resultados/i);
});

test('historial compara solo benchmarks equivalentes y marca nuevo PR', () => {
  assert.match(migration, /PARTITION BY w\.benchmark_ref/);
  assert.match(migration, /CASE WHEN w\.benchmark_ref IS NULL THEN false/);
  assert.match(migration, /w2\.benchmark_ref=w\.benchmark_ref AND w2\.fecha<w\.fecha[\s\S]*wr\.tiempo_segundos <[\s\S]*w3\.benchmark_ref=w\.benchmark_ref AND w3\.fecha<w\.fecha/);
  assert.match(studentUi, /Mis WOD[\s\S]*NUEVO PR/);
});

test('desafíos permiten roles operativos, participación propia, clamp y cumplimiento', () => {
  assert.match(migration, /guardar_desafio[\s\S]*mi_rol\(\) NOT IN \('admin','owner','staff'\)/);
  assert.match(migration, /unirse_desafio[\s\S]*mi_rol\(\)::text <> 'alumno'/);
  assert.match(migration, /least\(v_objetivo,greatest\(v_actual,p_progreso\)\)/);
  assert.match(migration, /completed_at=CASE WHEN v_final>=v_objetivo/);
  assert.match(migration, /CONSTRAINT desafio_participacion_unica UNIQUE \(desafio_id, usuario_id\)/);
  assert.match(studentUi, /Desafíos/);
  assert.match(studentUi, /Marcar \+1/);
  assert.match(studentUi, /COMPLETADO/);
});

function studentActionsHarness(access = true) {
  const calls = [];
  const actions = load('src/app/(student)/portal/sports-actions.ts', {
    '@/lib/alumnos/access': { async getStudentAccess() { return access ? { supabase: { async rpc(name, args) { calls.push({ name, args }); return { error: null }; } } } : null; } },
    '@/lib/deportivo/model': model,
    'next/cache': { revalidatePath() {} },
  });
  return { ...actions, calls };
}

test('acciones alumno escriben solo mediante RPC propias y bloquean entradas inválidas', async () => {
  const h = studentActionsHarness();
  assert.equal((await h.savePhysicalProgress({ fecha: '2026-10-13', peso_kg: 70, estatura_m: 1.75 })).ok, true);
  assert.equal((await h.saveWodResult({ wod_id: studentId, tiempo: '08:42' })).ok, true);
  assert.equal(h.calls[0].name, 'registrar_progreso_fisico');
  assert.equal(h.calls[1].args.p_tiempo_segundos, 522);
  assert.equal((await h.savePhysicalProgress({ fecha: '2026-10-13', peso_kg: -1, estatura_m: 1.75 })).ok, false);
  assert.equal(h.calls.length, 2);
  const denied = studentActionsHarness(false);
  assert.equal((await denied.joinChallenge(studentId)).ok, false);
  assert.equal(denied.calls.length, 0);
});

test('privacidad informa uso voluntario y exclusión de rankings y coach', () => {
  assert.match(privacy, /peso y estatura cuando el alumno decide usar Mi progreso/);
  assert.match(privacy, /no se muestran en rankings ni se exponen públicamente/);
  assert.match(privacy, /Coach\/staff no recibe estos datos/);
  assert.match(privacy, /resultados WOD, récords deportivos y participación en desafíos/);
  assert.match(privacy, /Ley Orgánica de Protección de Datos Personales \(LOPDP\), su Reglamento y demás normativa aplicable/);
});

test('SQL controlado, dry-run y macro mantienen el cierre reversible y manual', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(postflight, /BEGIN TRANSACTION READ ONLY/);
  assert.match(rollback, /^\s*(?:--[^\r\n]*(?:\r?\n|$))*ROLLBACK;\s*$/);
  assert.doesNotMatch(rollback, /\b(?:DROP|DELETE|COMMIT)\b/i);
  assert.match(dryRun, /BEGIN;[\s\S]*\$migrationBody[\s\S]*\$postflightBody[\s\S]*\$rollback/);
  assert.match(macro, /SUPABASE_DB_URL[\s\S]*preflight[\s\S]*dryRun[\s\S]*Aplicar SQL real/);
  assert.match(macro, /npm[\s\S]*test[\s\S]*tsc[\s\S]*build[\s\S]*diff[\s\S]*status/);
  assert.match(macro, /feat: add student progress wod rankings and challenges/);
  assert.match(macro, /Start-Process[\s\S]*RedirectStandardOutput[\s\S]*RedirectStandardError/);
});

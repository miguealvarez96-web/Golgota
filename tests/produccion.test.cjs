const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) { return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'); }

const navigation = read('src/components/layout/portal-navigation.tsx');
const studentLayout = read('src/app/(student)/layout.tsx');
const login = read('src/app/(auth)/login/page.tsx');
const reset = read('src/app/(auth)/reset-password/page.tsx');
const notFound = read('src/app/not-found.tsx');
const appError = read('src/app/(app)/error.tsx');
const studentError = read('src/app/(student)/error.tsx');
const checklist = read('scripts/verificar-produccion.ps1');
const macro = read('scripts/cerrar-proyecto-golgota.ps1');
const finalState = read('docs/ESTADO-FINAL.md');

test('la navegación final coincide con cada rol y oculta placeholders', () => {
  for (const route of ['/clientes', '/membresias', '/productos', '/inventario', '/gastos', '/pagos-reportados', '/wod', '/comunicados', '/reportes', '/solicitudes-privacidad']) {
    assert.match(navigation, new RegExp(`href: "${route.replaceAll('/', '\\/')}"`));
  }
  assert.match(navigation, /staffSections = new Set\(\["\/", "\/clientes", "\/membresias", "\/inventario", "\/wod", "\/comunicados"\]\)/);
  assert.doesNotMatch(navigation, /href:\s*"\/asistencia"/);
  assert.match(studentLayout, /href="\/portal"[\s\S]*href="\/privacidad"[\s\S]*<LogoutButton/);
});

test('auth captura fallos de red sin filtrar detalles y muestra callbacks vencidos', () => {
  const recovery = login.match(/async function handlePasswordRecovery\(\)[\s\S]*?(?=\n  return \()/)[0];
  assert.match(recovery, /try \{[\s\S]*resetPasswordForEmail[\s\S]*catch \{[\s\S]*finally \{[\s\S]*setRecoveryLoading\(false\)/);
  assert.match(login, /error"\) === "callback"[\s\S]*enlace no es válido o ya venció/);
  const update = reset.match(/async function handleSubmit[\s\S]*?(?=\n  return \()/)[0];
  assert.match(update, /try \{[\s\S]*updateUser[\s\S]*catch \{[\s\S]*finally \{[\s\S]*setLoading\(false\)/);
  assert.doesNotMatch(recovery + update, /error\.message|updateError\.message|recoveryError\.message/);
  assert.match(reset, /role="alert"/);
});

test('404, carga y límites de error mantienen feedback simple en español', () => {
  assert.match(notFound, /404[\s\S]*Esta página no existe[\s\S]*Volver al portal/);
  assert.match(appError, /RouteError[\s\S]*Ir al Dashboard/);
  assert.match(studentError, /RouteError[\s\S]*Ir a mi portal/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'src/app/(student)/loading.tsx')));
  assert.doesNotMatch(appError + studentError, /\{error\.(?:message|stack|digest)/);
});

test('el checklist valida build, rutas, PWA, iconos, auth y secretos sin mostrar valores', () => {
  assert.match(checklist, /app-paths-manifest\.json/);
  assert.match(checklist, /requiredBuildRoutes/);
  assert.match(checklist, /request\\\.mode === "navigate"[\s\S]*cache: "no-store"/);
  assert.match(checklist, /System\.Drawing\.Image/);
  assert.match(checklist, /SUPABASE_SERVICE_ROLE_KEY\|service_role/);
  assert.match(checklist, /Get-ChildItem[\s\S]*Select-String/);
  assert.match(checklist, /NEXT_PUBLIC_SUPABASE_URL=\.\+\$/);
  assert.match(checklist, /valores no mostrados/);
  assert.match(checklist, /Git limpio/);
});

test('el macro final se detiene ante SQL y aísla cambios ajenos', () => {
  assert.match(macro, /status --porcelain=v1 --untracked-files=all/);
  assert.match(macro, /supabase\/\.\*\\\.sql/);
  assert.match(macro, /SQL nuevo o modificado inesperado/);
  assert.doesNotMatch(macro.match(/\$blockFiles = @\([\s\S]*?\n\)/)[0], /\.gitignore|\.sql'/);
  assert.match(macro, /diff --cached --name-only[\s\S]*Hay archivos ajenos en staging/);
  assert.match(macro, /chore: finalize production readiness/);
});

test('el deploy final separa stdout y stderr y decide por ExitCode', () => {
  assert.match(macro, /Start-Process[\s\S]*RedirectStandardOutput[\s\S]*RedirectStandardError/);
  assert.match(macro, /\$process\.ExitCode -ne 0/);
  assert.doesNotMatch(macro, /& \$vercelCommand --prod 2>&1/);
  assert.match(macro, /URL FINAL DE PRODUCCION/);
  assert.ok((macro.match(/Checklist final/g) ?? []).length >= 2);
});

test('el estado final distingue código listo de puertas externas pendientes', () => {
  for (const section of ['Módulos terminados', 'Roles y navegación', 'Supabase', 'Vercel y PWA', 'Seguridad verificada', 'Scripts de cierre', 'Pendientes reales']) {
    assert.match(finalState, new RegExp(section));
  }
  assert.match(finalState, /no ejecutó SQL/i);
  assert.match(finalState, /migraciones preparadas/);
  assert.match(finalState, /datos legales\/administrativos/);
});

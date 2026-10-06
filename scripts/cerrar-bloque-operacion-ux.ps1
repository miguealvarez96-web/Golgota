[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF

function Find-Command([string[]]$Names, [string]$Message) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
  }
  throw $Message
}
function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$Label) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label fallo con codigo $LASTEXITCODE." }
}
function Confirm-Step([string]$Prompt) { return (Read-Host $Prompt).Trim().ToUpperInvariant() -eq 'S' }
function Invoke-Sql([string]$Path, [string]$Label) {
  Invoke-Checked $script:Psql @('-X', '-v', 'ON_ERROR_STOP=1', '--dbname', $script:DatabaseUrl, '--file', $Path) $Label
}
function Get-State {
  $query = "SELECT CASE WHEN count(*) = 0 THEN 'missing' WHEN count(*) = 3 THEN 'applied' ELSE 'partial' END FROM information_schema.columns WHERE table_schema='public' AND table_name='wods' AND column_name IN ('horario_grupo','youtube_url','notas')"
  $result = (@(& $script:Psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align --dbname $script:DatabaseUrl --command $query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing', 'applied', 'partial')) { throw 'No se pudo determinar el estado del bloque.' }
  return $result
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) { throw 'SUPABASE_DB_URL no existe o esta vacia.' }
$script:DatabaseUrl = $env:SUPABASE_DB_URL
$script:Psql = Find-Command @('psql') 'psql no esta disponible en PATH.'
$git = Find-Command @('git') 'git no esta disponible en PATH.'
$node = Find-Command @('node') 'node no esta disponible en PATH.'
$npx = Find-Command @('npx.cmd', 'npx') 'npx no esta disponible en PATH.'
$npm = Find-Command @('npm.cmd', 'npm') 'npm no esta disponible en PATH.'

$preflight = Join-Path $projectRoot 'supabase\preflight\20261011_preflight_operacion_ux.sql'
$migration = Join-Path $projectRoot 'supabase\migrations\20261011_operacion_ux.sql'
$postflight = Join-Path $projectRoot 'supabase\postflight\20261011_postflight_operacion_ux.sql'
$dryRun = Join-Path $projectRoot 'scripts\dry-run-operacion-ux.ps1'

$state = Get-State
if ($state -eq 'partial') { throw 'El bloque esta parcialmente aplicado; se requiere revision manual.' }
if ($state -eq 'missing') {
  Invoke-Sql $preflight 'Preflight de operacion y UX'
  & $dryRun -DatabaseUrl $script:DatabaseUrl
  if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
  if (-not (Confirm-Step ('{0}Aplicar SQL real de operacion y UX? [S/N]' -f $invertedQuestionMark))) { Write-Host 'SQL real cancelado.'; exit 0 }
  Invoke-Sql $migration 'Migracion de operacion y UX'
} else {
  Write-Host 'La migracion ya estaba aplicada; no se repetira.'
}
Invoke-Sql $postflight 'Postflight de operacion y UX'

Invoke-Checked $node @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-Checked $npx @('tsc', '--noEmit') 'TypeScript'
Invoke-Checked $npm @('run', 'build') 'Build'
Invoke-Checked $git @('diff', '--check') 'git diff --check'
Invoke-Checked $git @('status') 'git status'

$blockFiles = @(
  'scripts/cerrar-bloque-operacion-ux.ps1', 'scripts/dry-run-operacion-ux.ps1',
  'src/app/(app)/clientes/page.tsx', 'src/app/(app)/membresias/page.tsx',
  'src/app/(app)/membresias/cliente/[id]/page.tsx', 'src/app/(app)/wod/actions.ts',
  'src/app/(app)/wod/page.tsx', 'src/app/(student)/portal/page.tsx',
  'src/components/alumnos/reported-payments-manager.tsx', 'src/components/alumnos/student-dashboard.tsx',
  'src/components/clientes/clients-manager.tsx', 'src/components/coaches/coach-dashboard.tsx',
  'src/components/coaches/wod-manager.tsx', 'src/components/layout/portal-navigation.tsx',
  'src/lib/alumnos/model.ts', 'src/lib/clientes/model.ts', 'src/lib/coaches/data.ts',
  'src/lib/coaches/model.ts', 'src/lib/membresias/data.ts', 'src/lib/membresias/grouping.ts',
  'src/lib/reportes/data.ts',
  'supabase/preflight/20261011_preflight_operacion_ux.sql',
  'supabase/migrations/20261011_operacion_ux.sql',
  'supabase/postflight/20261011_postflight_operacion_ux.sql',
  'supabase/rollback/20261011_rollback_operacion_ux.sql',
  'tests/clientes.test.cjs', 'tests/coaches.test.cjs', 'tests/membresias.test.cjs',
  'tests/pagos-completos.test.cjs', 'tests/privacidad.test.cjs', 'tests/produccion.test.cjs',
  'tests/reportes.test.cjs', 'tests/operacion-ux.test.cjs'
)

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $stagedBefore = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedBefore | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  Invoke-Checked $git (@('add', '--') + $blockFiles) 'git add'
  Invoke-Checked $git @('commit', '-m', 'feat: improve coach wod memberships and payments ux') 'git commit'
  Invoke-Checked $git @('push') 'git push'
} else { Write-Host 'Commit/push omitidos.' }

if (-not (Confirm-Step ('{0}Desplegar a produccion? [S/N]' -f $invertedQuestionMark))) { Write-Host 'Deploy omitido.'; exit 0 }
$vercel = Find-Command @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
Invoke-Checked $vercel @('--prod') 'Deploy de produccion'

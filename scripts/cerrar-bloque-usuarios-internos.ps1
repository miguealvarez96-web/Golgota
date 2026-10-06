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
  $query = "WITH state AS (SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='usuarios' AND column_name='login_username'))::int AS column_found, (to_regprocedure('public.normalize_login_username()') IS NOT NULL)::int AS function_found, (to_regclass('public.usuarios_login_username_lower_key') IS NOT NULL)::int AS index_found) SELECT CASE WHEN column_found=0 AND function_found=0 AND index_found=0 THEN 'missing' WHEN column_found=1 AND function_found=1 AND index_found=1 THEN 'applied' ELSE 'partial' END FROM state"
  $result = (@(& $script:Psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align --dbname $script:DatabaseUrl --command $query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing', 'applied', 'partial')) { throw 'No se pudo determinar el estado del bloque de usuarios internos.' }
  return $result
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) { throw 'SUPABASE_DB_URL no existe o esta vacia.' }
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_SERVICE_ROLE_KEY)) { throw 'SUPABASE_SERVICE_ROLE_KEY no existe o esta vacia. Debe configurarse solo en servidor.' }
$script:DatabaseUrl = $env:SUPABASE_DB_URL
$script:Psql = Find-Command @('psql') 'psql no esta disponible en PATH.'
$git = Find-Command @('git') 'git no esta disponible en PATH.'
$node = Find-Command @('node') 'node no esta disponible en PATH.'
$npx = Find-Command @('npx.cmd', 'npx') 'npx no esta disponible en PATH.'
$npm = Find-Command @('npm.cmd', 'npm') 'npm no esta disponible en PATH.'

$preflight = Join-Path $projectRoot 'supabase\preflight\20261010_preflight_usuarios_internos.sql'
$migration = Join-Path $projectRoot 'supabase\migrations\20261010_usuarios_internos.sql'
$postflight = Join-Path $projectRoot 'supabase\postflight\20261010_postflight_usuarios_internos.sql'
$dryRun = Join-Path $projectRoot 'scripts\dry-run-usuarios-internos.ps1'
foreach ($path in @($preflight, $migration, $postflight, $dryRun)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontro $path" }
}

$repositoryRoot = (@(& $git rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne [IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) { throw 'El script no se ejecuta en el repositorio esperado.' }

$state = Get-State
if ($state -eq 'partial') { throw 'El bloque de usuarios internos esta parcialmente aplicado; se requiere revision manual.' }
if ($state -eq 'missing') {
  Invoke-Sql $preflight 'Preflight de usuarios internos'
  & $dryRun -DatabaseUrl $script:DatabaseUrl
  if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
  if (-not (Confirm-Step ('{0}Aplicar SQL real de usuarios internos? [S/N]' -f $invertedQuestionMark))) { Write-Host 'SQL real cancelado.'; exit 0 }
  Invoke-Sql $migration 'Migracion de usuarios internos'
} else {
  Write-Host 'La migracion de usuarios internos ya estaba aplicada; no se repetira.'
}
Invoke-Sql $postflight 'Postflight de usuarios internos'

Invoke-Checked $node @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-Checked $npx @('tsc', '--noEmit') 'TypeScript'
Invoke-Checked $npm @('run', 'build') 'Build'
Invoke-Checked $git @('diff', '--check') 'git diff --check'
Invoke-Checked $git @('status') 'git status'

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $blockFiles = @(
    'scripts/cerrar-bloque-usuarios-internos.ps1', 'scripts/dry-run-usuarios-internos.ps1',
    'src/app/(auth)/login/page.tsx', 'src/app/api/auth/internal-login/route.ts',
    'src/app/(app)/usuarios/actions.ts', 'src/app/(app)/usuarios/page.tsx',
    'src/components/usuarios-internos/internal-users-manager.tsx',
    'src/components/layout/portal-icon.tsx', 'src/components/layout/portal-navigation.tsx',
    'src/lib/supabase/admin.ts', 'src/lib/usuarios-internos/access.ts', 'src/lib/usuarios-internos/model.ts',
    'supabase/migrations/20261010_usuarios_internos.sql',
    'supabase/preflight/20261010_preflight_usuarios_internos.sql',
    'supabase/postflight/20261010_postflight_usuarios_internos.sql',
    'supabase/rollback/20261010_rollback_usuarios_internos.sql',
    'tests/usuarios-internos.test.cjs'
  )
  $stagedBefore = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedBefore | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  Invoke-Checked $git (@('add', '--') + $blockFiles) 'git add'
  Invoke-Checked $git @('commit', '-m', 'feat: add managed internal users') 'git commit'
  Invoke-Checked $git @('push') 'git push'
} else { Write-Host 'Commit/push omitidos.' }

if (-not (Confirm-Step ('{0}Desplegar a produccion? [S/N]' -f $invertedQuestionMark))) { Write-Host 'Deploy omitido.'; exit 0 }
$vercel = Find-Command @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
Invoke-Checked $vercel @('--prod') 'Deploy de produccion'

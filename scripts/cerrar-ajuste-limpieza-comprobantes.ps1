[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$Label) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label fallo con codigo $LASTEXITCODE." }
}
function Confirm-Step([string]$Prompt) { return (Read-Host $Prompt).Trim().ToUpperInvariant() -eq 'S' }
function Find-Command([string[]]$Names, [string]$Message) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
  }
  throw $Message
}
function Get-State([string]$Query, [string]$Label) {
  $result = (@(& $script:Psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
    --dbname $script:DatabaseUrl --command $Query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing', 'applied', 'partial')) {
    throw "No fue posible consultar $Label."
  }
  return $result
}
function Invoke-Sql([string]$Path, [string]$Label) {
  Invoke-Checked $script:Psql @('-X', '-v', 'ON_ERROR_STOP=1', '--dbname', $script:DatabaseUrl, '--file', $Path) $Label
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

$dryRun = Join-Path $projectRoot 'scripts\dry-run-limpieza-comprobantes-pago.ps1'
$migrationFiles = @(
  @{ Name = 'Portal Alumno'; State = "SELECT CASE WHEN to_regclass('public.reportes_pago_alumno') IS NULL THEN 'missing' ELSE 'applied' END"; Migration = 'supabase\migrations\20261002_portal_alumno_v1.sql'; Postflight = 'supabase\postflight\20261002_postflight_portal_alumno_v1.sql' },
  @{ Name = 'Pagos Completos'; State = "SELECT CASE WHEN to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN 'missing' ELSE 'applied' END"; Migration = 'supabase\migrations\20261004_pagos_completos_v1.sql'; Postflight = 'supabase\postflight\20261004_postflight_pagos_completos_v1.sql' },
  @{ Name = 'Comprobantes Pago'; State = "SELECT CASE count(*) WHEN 0 THEN 'missing' WHEN 4 THEN 'applied' ELSE 'partial' END FROM pg_attribute WHERE attrelid = to_regclass('public.reportes_pago_alumno') AND attname IN ('comprobante_path','comprobante_mime','comprobante_size','comprobante_requerido') AND NOT attisdropped"; Migration = 'supabase\migrations\20261005_comprobantes_pago_v1.sql'; Postflight = 'supabase\postflight\20261005_postflight_comprobantes_pago_v1.sql' },
  @{ Name = 'Limpieza Comprobantes'; State = "SELECT CASE count(*) WHEN 0 THEN 'missing' WHEN 6 THEN 'applied' ELSE 'partial' END FROM pg_attribute WHERE attrelid = to_regclass('public.reportes_pago_alumno') AND attname IN ('comprobante_original_mime','comprobante_original_size','comprobante_eliminado_at','comprobante_limpieza_estado','comprobante_limpieza_intentos','comprobante_limpieza_error_at') AND NOT attisdropped"; Migration = 'supabase\migrations\20261006_limpieza_comprobantes_pago.sql'; Postflight = 'supabase\postflight\20261006_postflight_limpieza_comprobantes_pago.sql' }
)
if (-not (Test-Path -LiteralPath $dryRun -PathType Leaf)) { throw "No se encontro $dryRun" }
foreach ($item in $migrationFiles) {
  $item.Migration = Join-Path $projectRoot $item.Migration
  $item.Postflight = Join-Path $projectRoot $item.Postflight
  foreach ($path in @($item.Migration, $item.Postflight)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontro $path" }
  }
}

$repositoryRoot = (@(& $git rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne [IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw 'El script no se esta ejecutando en el repositorio esperado.'
}

$allowedSql = @(
  'supabase/postflight/20261002_postflight_portal_alumno_v1.sql',
  'supabase/migrations/20261005_comprobantes_pago_v1.sql',
  'supabase/preflight/20261005_preflight_comprobantes_pago_v1.sql',
  'supabase/postflight/20261005_postflight_comprobantes_pago_v1.sql',
  'supabase/rollback/20261005_rollback_comprobantes_pago_v1.sql',
  'supabase/migrations/20261006_limpieza_comprobantes_pago.sql',
  'supabase/preflight/20261006_preflight_limpieza_comprobantes_pago.sql',
  'supabase/postflight/20261006_postflight_limpieza_comprobantes_pago.sql',
  'supabase/rollback/20261006_rollback_limpieza_comprobantes_pago.sql'
)
$sqlStatus = @(& $git status --porcelain --untracked-files=all -- '*.sql')
if ($LASTEXITCODE -ne 0) { throw 'No fue posible detectar SQL.' }
$changedSql = @($sqlStatus | ForEach-Object { if ($_.Length -ge 4) { $_.Substring(3).Trim('"').Replace('\', '/') } } | Where-Object { $_ })
$foreignSql = @($changedSql | Where-Object { $_ -notin $allowedSql })
if ($foreignSql.Count -gt 0) { throw "SQL ajeno detectado: $($foreignSql -join ', ')" }
Write-Host "SQL detectado: $($changedSql -join ', ')"

Write-Host 'Ejecutando dry-run reversible...'
& $dryRun -DatabaseUrl $script:DatabaseUrl
if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
if (-not (Confirm-Step ('{0}Aplicar SQL real? [S/N]' -f $invertedQuestionMark))) {
  Write-Host 'SQL real cancelado.'
  exit 0
}

foreach ($item in $migrationFiles) {
  $state = Get-State $item.State $item.Name
  if ($state -eq 'partial') { throw "$($item.Name) esta parcialmente aplicado." }
  if ($state -eq 'missing') {
    Invoke-Sql $item.Migration "Migracion $($item.Name)"
    Invoke-Sql $item.Postflight "Postflight $($item.Name)"
  } else {
    Write-Host "$($item.Name) ya estaba aplicado; se omite su postflight historico."
  }
}

# El postflight vigente es la autoridad final para el estado acumulado, incluso
# cuando todas las migraciones ya estaban aplicadas antes de ejecutar el macro.
Invoke-Sql $migrationFiles[-1].Postflight 'Postflight final Limpieza Comprobantes'

Invoke-Checked $node @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-Checked $npx @('tsc', '--noEmit') 'TypeScript'
Invoke-Checked $npm @('run', 'build') 'Build'
Invoke-Checked $git @('diff', '--check') 'git diff --check'
Invoke-Checked $git @('status') 'git status'

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $blockFiles = @(
    'docs/CONTEXT.md', 'docs/DECISIONS.md', 'docs/ESTADO-FINAL.md', 'docs/PRIVACIDAD.md',
    'next.config.mjs',
    'scripts/cerrar-bloque-comprobantes-pago.ps1',
    'scripts/dry-run-comprobantes-pago-v1.ps1',
    'scripts/cerrar-ajuste-limpieza-comprobantes.ps1',
    'scripts/dry-run-limpieza-comprobantes-pago.ps1',
    'src/app/(app)/pagos-reportados/actions.ts',
    'src/app/(student)/portal/actions.ts',
    'src/app/actions/payment-receipts.ts',
    'src/components/alumnos/payment-receipt-button.tsx',
    'src/components/alumnos/report-payment-form.tsx',
    'src/components/alumnos/reported-payments-manager.tsx',
    'src/components/alumnos/student-dashboard.tsx',
    'src/lib/alumnos/model.ts',
    'supabase/postflight/20261002_postflight_portal_alumno_v1.sql',
    'supabase/migrations/20261005_comprobantes_pago_v1.sql',
    'supabase/preflight/20261005_preflight_comprobantes_pago_v1.sql',
    'supabase/postflight/20261005_postflight_comprobantes_pago_v1.sql',
    'supabase/rollback/20261005_rollback_comprobantes_pago_v1.sql',
    'supabase/migrations/20261006_limpieza_comprobantes_pago.sql',
    'supabase/preflight/20261006_preflight_limpieza_comprobantes_pago.sql',
    'supabase/postflight/20261006_postflight_limpieza_comprobantes_pago.sql',
    'supabase/rollback/20261006_rollback_limpieza_comprobantes_pago.sql',
    'tests/comprobantes-pago.test.cjs', 'tests/limpieza-comprobantes.test.cjs',
    'tests/pagos-completos.test.cjs', 'tests/portal-alumno.test.cjs'
  )
  $stagedBefore = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedBefore | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  Invoke-Checked $git (@('add', '--') + $blockFiles) 'git add'
  $stagedAfter = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedAfter | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  & $git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No fue posible revisar staging.' }
  Invoke-Checked $git @('commit', '-m', 'fix: remove payment receipts after review') 'git commit'
  Invoke-Checked $git @('push') 'git push'
} else {
  Write-Host 'Commit/push omitidos; .gitignore y otros cambios ajenos no se incluyeron.'
}

if (-not (Confirm-Step ('{0}Desplegar a produccion? [S/N]' -f $invertedQuestionMark))) {
  Write-Host 'Deploy omitido.'
  exit 0
}
$vercel = Find-Command @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
$output = @(& $vercel --prod 2>&1)
$exitCode = $LASTEXITCODE
$output | ForEach-Object { Write-Host $_ }
if ($exitCode -ne 0) { throw "vercel --prod fallo con codigo $exitCode." }
$urls = [regex]::Matches(($output -join "`n"), 'https://[^\s]+')
if ($urls.Count -eq 0) { throw 'Vercel no devolvio una URL reconocible.' }
Write-Host "URL FINAL DE PRODUCCION: $($urls[$urls.Count - 1].Value.TrimEnd('.', ',', ';'))"

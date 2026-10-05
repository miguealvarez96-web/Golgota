[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Label
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label fallo con codigo $LASTEXITCODE." }
}

function Confirm-Step([string]$Prompt) {
  return (Read-Host $Prompt).Trim().ToUpperInvariant() -eq 'S'
}

function Get-ExecutablePath([string[]]$Names, [string]$ErrorMessage) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
  }
  throw $ErrorMessage
}

function Get-DatabaseState([string]$Query, [string]$Label) {
  $output = @(& $script:PsqlCommand -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
    --dbname $script:DatabaseUrl --command $Query)
  if ($LASTEXITCODE -ne 0) { throw "No fue posible consultar $Label." }
  $state = ($output -join '').Trim()
  if ($state -notin @('missing', 'applied', 'partial')) {
    throw "Estado inesperado para $Label`: '$state'."
  }
  return $state
}

function Invoke-PsqlFile([string]$Path, [string]$Label) {
  Invoke-CheckedCommand -Command $script:PsqlCommand -Arguments @(
    '-X', '-v', 'ON_ERROR_STOP=1', '--dbname', $script:DatabaseUrl, '--file', $Path
  ) -Label $Label
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  throw 'SUPABASE_DB_URL no existe o esta vacia.'
}

$script:DatabaseUrl = $env:SUPABASE_DB_URL
$script:PsqlCommand = Get-ExecutablePath @('psql') 'psql no esta disponible en PATH.'
$gitCommand = Get-ExecutablePath @('git') 'git no esta disponible en PATH.'
$nodeCommand = Get-ExecutablePath @('node') 'node no esta disponible en PATH.'
$npxCommand = Get-ExecutablePath @('npx.cmd', 'npx') 'npx no esta disponible en PATH.'
$npmCommand = Get-ExecutablePath @('npm.cmd', 'npm') 'npm no esta disponible en PATH.'

$dryRunPath = Join-Path $projectRoot 'scripts\dry-run-comprobantes-pago-v1.ps1'
$portalMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261002_portal_alumno_v1.sql'
$portalPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261002_postflight_portal_alumno_v1.sql'
$paymentsMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_pagos_completos_v1.sql'
$paymentsPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_pagos_completos_v1.sql'
$receiptMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261005_comprobantes_pago_v1.sql'
$receiptPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261005_postflight_comprobantes_pago_v1.sql'

foreach ($path in @(
  $dryRunPath, $portalMigrationPath, $portalPostflightPath,
  $paymentsMigrationPath, $paymentsPostflightPath,
  $receiptMigrationPath, $receiptPostflightPath
)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "No se encontro el archivo requerido: $path"
  }
}

$repositoryRoot = (@(& $gitCommand rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or
    [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne
    [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw "El script debe ejecutarse en el repositorio esperado: $projectRoot"
}

$expectedSql = @(
  'supabase/migrations/20261005_comprobantes_pago_v1.sql',
  'supabase/preflight/20261005_preflight_comprobantes_pago_v1.sql',
  'supabase/postflight/20261005_postflight_comprobantes_pago_v1.sql',
  'supabase/rollback/20261005_rollback_comprobantes_pago_v1.sql'
)
$sqlStatus = @(& $gitCommand status --porcelain --untracked-files=all -- '*.sql')
if ($LASTEXITCODE -ne 0) { throw 'No fue posible detectar cambios SQL.' }
$changedSql = @($sqlStatus | ForEach-Object {
  if ($_.Length -ge 4) { $_.Substring(3).Trim('"').Replace('\', '/') }
} | Where-Object { $_ })
$unexpectedSql = @($changedSql | Where-Object { $_ -notin $expectedSql })
if ($unexpectedSql.Count -gt 0) {
  throw "Hay SQL ajeno al bloque; se aborta sin ejecutarlo: $($unexpectedSql -join ', ')"
}
Write-Host "SQL del bloque detectado: $($expectedSql -join ', ')"

Write-Host 'Ejecutando dry-run reversible de comprobantes de pago...'
& $dryRunPath -DatabaseUrl $script:DatabaseUrl
if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
Write-Host 'DRY-RUN CORRECTO'

if (-not (Confirm-Step ('{0}Aplicar SQL real? [S/N]' -f $invertedQuestionMark))) {
  Write-Host 'SQL real cancelado. No se aplicaron migraciones.'
  exit 0
}

$portalState = Get-DatabaseState `
  "SELECT CASE WHEN to_regclass('public.reportes_pago_alumno') IS NULL THEN 'missing' ELSE 'applied' END" `
  'Portal Alumno V1'
$paymentsState = Get-DatabaseState `
  "SELECT CASE WHEN to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN 'missing' ELSE 'applied' END" `
  'Pagos Completos V1'
$receiptStateQuery = @"
SELECT CASE count(*) WHEN 0 THEN 'missing' WHEN 4 THEN 'applied' ELSE 'partial' END
FROM pg_attribute
WHERE attrelid = to_regclass('public.reportes_pago_alumno')
  AND attname IN ('comprobante_path','comprobante_mime','comprobante_size','comprobante_requerido')
  AND NOT attisdropped
"@
$receiptState = Get-DatabaseState $receiptStateQuery 'Comprobantes Pago V1'
if ($receiptState -eq 'partial') { throw 'La migracion de comprobantes esta aplicada parcialmente.' }

if ($portalState -eq 'missing') {
  Invoke-PsqlFile $portalMigrationPath 'Migracion Portal Alumno V1'
  Invoke-PsqlFile $portalPostflightPath 'Postflight Portal Alumno V1'
}
if ($paymentsState -eq 'missing') {
  Invoke-PsqlFile $paymentsMigrationPath 'Migracion Pagos Completos V1'
  Invoke-PsqlFile $paymentsPostflightPath 'Postflight Pagos Completos V1'
}
if ($receiptState -eq 'missing') {
  Invoke-PsqlFile $receiptMigrationPath 'Migracion Comprobantes Pago V1 y politicas de Storage'
}
Invoke-PsqlFile $receiptPostflightPath 'Postflight Comprobantes Pago V1'

Write-Host 'Ejecutando validaciones del proyecto...'
Invoke-CheckedCommand $nodeCommand @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-CheckedCommand $npxCommand @('tsc', '--noEmit') 'Validacion de TypeScript'
Invoke-CheckedCommand $npmCommand @('run', 'build') 'Build de produccion'
Invoke-CheckedCommand $gitCommand @('diff', '--check') 'git diff --check'
Invoke-CheckedCommand $gitCommand @('status') 'git status'

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $blockFiles = @(
    'docs/CONTEXT.md',
    'docs/DECISIONS.md',
    'docs/ESTADO-FINAL.md',
    'docs/PRIVACIDAD.md',
    'next.config.mjs',
    'scripts/cerrar-bloque-comprobantes-pago.ps1',
    'scripts/dry-run-comprobantes-pago-v1.ps1',
    'src/app/(student)/portal/actions.ts',
    'src/app/actions/payment-receipts.ts',
    'src/components/alumnos/payment-receipt-button.tsx',
    'src/components/alumnos/report-payment-form.tsx',
    'src/components/alumnos/reported-payments-manager.tsx',
    'src/components/alumnos/student-dashboard.tsx',
    'src/lib/alumnos/model.ts',
    'supabase/migrations/20261005_comprobantes_pago_v1.sql',
    'supabase/preflight/20261005_preflight_comprobantes_pago_v1.sql',
    'supabase/postflight/20261005_postflight_comprobantes_pago_v1.sql',
    'supabase/rollback/20261005_rollback_comprobantes_pago_v1.sql',
    'tests/comprobantes-pago.test.cjs',
    'tests/pagos-completos.test.cjs',
    'tests/portal-alumno.test.cjs'
  )
  $alreadyStaged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible inspeccionar staging.' }
  $foreignStaged = @($alreadyStaged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) {
    throw "Hay archivos ajenos en staging; no se modificaron: $($foreignStaged -join ', ')"
  }
  Invoke-CheckedCommand $gitCommand (@('add', '--') + $blockFiles) 'git add del bloque'
  $staged = @(& $gitCommand diff --cached --name-only)
  $foreignStaged = @($staged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene archivos ajenos: $($foreignStaged -join ', ')" }
  & $gitCommand diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios del bloque para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No fue posible revisar el diff en staging.' }
  Invoke-CheckedCommand $gitCommand @('commit', '-m', 'feat: add payment receipt uploads') 'git commit'
  Invoke-CheckedCommand $gitCommand @('push') 'git push'
} else {
  Write-Host 'Commit y push omitidos. Los cambios ajenos, incluida .gitignore, permanecen fuera de staging.'
}

Invoke-CheckedCommand $gitCommand @('status') 'git status final'
if (-not (Confirm-Step ('{0}Desplegar a produccion en Vercel? [S/N]' -f $invertedQuestionMark))) {
  Write-Host 'Despliegue omitido.'
  exit 0
}

$vercelCommand = Get-ExecutablePath @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
$vercelOutput = @(& $vercelCommand --prod 2>&1)
$vercelExitCode = $LASTEXITCODE
$vercelOutput | ForEach-Object { Write-Host $_ }
if ($vercelExitCode -ne 0) { throw "vercel --prod fallo con codigo $vercelExitCode." }
$urlMatches = [regex]::Matches(($vercelOutput -join "`n"), 'https://[^\s]+')
if ($urlMatches.Count -eq 0) {
  throw 'Vercel termino correctamente, pero no devolvio una URL reconocible.'
}
$productionUrl = $urlMatches[$urlMatches.Count - 1].Value.TrimEnd('.', ',', ';')
Write-Host "URL FINAL DE PRODUCCION: $productionUrl"

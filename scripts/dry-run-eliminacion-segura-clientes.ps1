param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$preflightPath = Join-Path $projectRoot 'supabase\preflight\20261013_preflight_eliminacion_segura_clientes.sql'
$migrationPath = Join-Path $projectRoot 'supabase\migrations\20261013_eliminacion_segura_clientes.sql'
$postflightPath = Join-Path $projectRoot 'supabase\postflight\20261013_postflight_eliminacion_segura_clientes.sql'
$rollbackPath = Join-Path $projectRoot 'supabase\rollback\20261013_rollback_eliminacion_segura_clientes.sql'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql no está disponible en PATH.' }
foreach ($path in @($preflightPath, $migrationPath, $postflightPath, $rollbackPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontró: $path" }
}

& psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $preflightPath
if ($LASTEXITCODE -ne 0) { throw "El preflight falló con código $LASTEXITCODE." }

$migration = Get-Content -Raw -LiteralPath $migrationPath
$postflight = Get-Content -Raw -LiteralPath $postflightPath
$rollback = Get-Content -Raw -LiteralPath $rollbackPath
$beginPattern = '(?mi)^\s*BEGIN;\s*$'
$commitPattern = '(?mi)^\s*COMMIT;\s*$'
$readOnlyPattern = '(?mi)^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY;\s*$'
$rollbackPattern = '(?mi)^\s*ROLLBACK;\s*$'

if ([regex]::Matches($migration, $beginPattern).Count -ne 1 -or [regex]::Matches($migration, $commitPattern).Count -ne 1) {
  throw 'La migración debe contener exactamente un BEGIN y un COMMIT.'
}
if ([regex]::Matches($postflight, $readOnlyPattern).Count -ne 1 -or [regex]::Matches($postflight, $rollbackPattern).Count -ne 1) {
  throw 'El postflight debe ser una transacción de solo lectura.'
}
if ([regex]::Matches($rollback, $rollbackPattern).Count -ne 1 -or $rollback -match '(?i)\b(?:DROP|DELETE|COMMIT)\b') {
  throw 'El rollback del dry-run no es seguro.'
}

$migrationBody = [regex]::new($beginPattern).Replace($migration, '', 1)
$migrationBody = [regex]::new($commitPattern).Replace($migrationBody, '', 1)
$postflightBody = [regex]::new($readOnlyPattern).Replace($postflight, '', 1)
$postflightBody = [regex]::new($rollbackPattern).Replace($postflightBody, '', 1)
$temporaryPath = [System.IO.Path]::GetTempFileName()
try {
  $dryRunSql = @"
\set ON_ERROR_STOP on
BEGIN;
$migrationBody
$postflightBody
$rollback
"@
  Set-Content -LiteralPath $temporaryPath -Value $dryRunSql -Encoding utf8
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $temporaryPath
  if ($LASTEXITCODE -ne 0) { throw "El dry-run falló con código $LASTEXITCODE." }
  Write-Host 'Dry-run correcto. PostgreSQL ejecutó ROLLBACK; no se conservaron cambios.'
} finally {
  if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
}

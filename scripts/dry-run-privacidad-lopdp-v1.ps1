param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$preflightPath = Join-Path $projectRoot 'supabase\preflight\20261004_preflight_privacidad_lopdp_v1.sql'
$migrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_privacidad_lopdp_v1.sql'
$postflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_privacidad_lopdp_v1.sql'
$rollbackPath = Join-Path $projectRoot 'supabase\rollback\20261004_rollback_privacidad_lopdp_v1.sql'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'psql no esta disponible en PATH.'
}
foreach ($path in @($preflightPath, $migrationPath, $postflightPath, $rollbackPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "No se encontro el archivo requerido: $path"
  }
}

Write-Host '1/2 Ejecutando preflight de solo lectura...'
& psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $preflightPath
if ($LASTEXITCODE -ne 0) { throw "El preflight fallo con codigo $LASTEXITCODE." }

$migration = Get-Content -Raw -LiteralPath $migrationPath
$postflight = Get-Content -Raw -LiteralPath $postflightPath
$rollback = Get-Content -Raw -LiteralPath $rollbackPath
$beginPattern = '(?mi)^\s*BEGIN;\s*$'
$commitPattern = '(?mi)^\s*COMMIT;\s*$'
$postflightBeginPattern = '(?mi)^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY;\s*$'
$rollbackPattern = '(?mi)^\s*ROLLBACK;\s*$'

if ([regex]::Matches($migration, $beginPattern).Count -ne 1 -or
    [regex]::Matches($migration, $commitPattern).Count -ne 1) {
  throw 'La migracion debe contener exactamente un BEGIN y un COMMIT.'
}
if ([regex]::Matches($postflight, $postflightBeginPattern).Count -ne 1 -or
    [regex]::Matches($postflight, $rollbackPattern).Count -ne 1) {
  throw 'El postflight no tiene limites compatibles con el dry-run.'
}
if ([regex]::Matches($rollback, $rollbackPattern).Count -ne 1 -or
    $rollback -match '(?i)\b(?:DROP|DELETE|COMMIT)\b') {
  throw 'El rollback debe limitarse a ROLLBACK y no puede ser destructivo.'
}

$migrationBody = [regex]::new($beginPattern).Replace($migration, '', 1)
$migrationBody = [regex]::new($commitPattern).Replace($migrationBody, '', 1)
$postflightBody = [regex]::new($postflightBeginPattern).Replace($postflight, '', 1)
$postflightBody = [regex]::new($rollbackPattern).Replace($postflightBody, '', 1)
$dryRunSql = @"
\set ON_ERROR_STOP on
BEGIN;
$migrationBody
$postflightBody
$rollback
"@

$temporaryPath = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -LiteralPath $temporaryPath -Value $dryRunSql -Encoding utf8
  Write-Host '2/2 Ejecutando migracion y postflight dentro de una transaccion reversible...'
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $temporaryPath
  if ($LASTEXITCODE -ne 0) {
    throw "El dry-run fallo con codigo $LASTEXITCODE. La conexion revertira la transaccion abierta."
  }
  Write-Host 'Dry-run correcto. PostgreSQL ejecuto ROLLBACK; no se conservaron cambios.'
}
finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

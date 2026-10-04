param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$portalPreflightPath = Join-Path $projectRoot 'supabase\preflight\20261002_preflight_portal_alumno_v1.sql'
$portalMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261002_portal_alumno_v1.sql'
$portalPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261002_postflight_portal_alumno_v1.sql'
$blockPreflightPath = Join-Path $projectRoot 'supabase\preflight\20261004_preflight_pagos_completos_v1.sql'
$blockMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_pagos_completos_v1.sql'
$blockPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_pagos_completos_v1.sql'
$rollbackPath = Join-Path $projectRoot 'supabase\rollback\20261004_rollback_pagos_completos_v1.sql'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'psql no está disponible en PATH.'
}
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw 'DatabaseUrl está vacío.'
}

$requiredPaths = @(
  $portalPreflightPath, $portalMigrationPath, $portalPostflightPath,
  $blockPreflightPath, $blockMigrationPath, $blockPostflightPath, $rollbackPath
)
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "No se encontró el archivo requerido: $path"
  }
}

$portalState = (@(& psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
  --dbname $DatabaseUrl `
  --command "SELECT CASE WHEN to_regclass('public.reportes_pago_alumno') IS NULL THEN 'missing' ELSE 'applied' END") -join '').Trim()
if ($LASTEXITCODE -ne 0 -or $portalState -notin @('missing', 'applied')) {
  throw 'No fue posible determinar si Portal Alumno V1 está aplicado.'
}

$beginPattern = '(?mi)^\s*BEGIN;\s*$'
$commitPattern = '(?mi)^\s*COMMIT;\s*$'
$readOnlyPattern = '(?mi)^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY;\s*$'
$rollbackPattern = '(?mi)^\s*ROLLBACK;\s*$'

function Get-MigrationBody([string]$path) {
  $content = Get-Content -Raw -LiteralPath $path
  if ([regex]::Matches($content, $beginPattern).Count -ne 1 -or
      [regex]::Matches($content, $commitPattern).Count -ne 1) {
    throw "La migración $path no tiene exactamente un BEGIN y un COMMIT."
  }
  $content = [regex]::new($beginPattern).Replace($content, '', 1)
  return [regex]::new($commitPattern).Replace($content, '', 1)
}

function Get-ReadOnlyBody([string]$path) {
  $content = Get-Content -Raw -LiteralPath $path
  if ([regex]::Matches($content, $readOnlyPattern).Count -ne 1 -or
      [regex]::Matches($content, $rollbackPattern).Count -ne 1) {
    throw "El archivo $path no tiene los límites READ ONLY/ROLLBACK esperados."
  }
  $content = [regex]::new($readOnlyPattern).Replace($content, '', 1)
  return [regex]::new($rollbackPattern).Replace($content, '', 1)
}

$portalSql = ''
if ($portalState -eq 'missing') {
  Write-Host '1/3 Portal Alumno no está aplicado. Ejecutando su preflight de solo lectura...'
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $portalPreflightPath
  if ($LASTEXITCODE -ne 0) {
    throw "El preflight de Portal Alumno falló con código $LASTEXITCODE."
  }
  $portalSql = @"
$(Get-MigrationBody $portalMigrationPath)
$(Get-ReadOnlyBody $portalPostflightPath)
"@
} else {
  Write-Host '1/3 Portal Alumno ya está aplicado; se conservará sin cambios.'
}

if ($portalState -eq 'applied') {
  Write-Host '2/3 Ejecutando preflight de BLOQUE 2 en solo lectura...'
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $blockPreflightPath
  if ($LASTEXITCODE -ne 0) {
    throw "El preflight de BLOQUE 2 falló con código $LASTEXITCODE."
  }
  $blockPreflightSql = ''
} else {
  Write-Host '2/3 El preflight de BLOQUE 2 se ejecutará después de simular Portal Alumno.'
  $blockPreflightSql = Get-ReadOnlyBody $blockPreflightPath
}

$blockMigrationBody = Get-MigrationBody $blockMigrationPath
$blockPostflightBody = Get-ReadOnlyBody $blockPostflightPath
$rollback = Get-Content -Raw -LiteralPath $rollbackPath
if ([regex]::Matches($rollback, $rollbackPattern).Count -ne 1) {
  throw 'El rollback debe contener exactamente un ROLLBACK.'
}

$dryRunSql = @"
\set ON_ERROR_STOP on
BEGIN;
$portalSql
$blockPreflightSql
$blockMigrationBody
$blockPostflightBody
$rollback
"@

$temporaryPath = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -LiteralPath $temporaryPath -Value $dryRunSql -Encoding utf8
  Write-Host '3/3 Ejecutando BLOQUE 2 y postflight dentro de una transacción reversible...'
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $temporaryPath
  if ($LASTEXITCODE -ne 0) {
    throw "El dry-run falló con código $LASTEXITCODE. PostgreSQL revertirá la transacción abierta."
  }
  Write-Host 'Dry-run completo correcto. PostgreSQL ejecutó ROLLBACK; no se conservaron cambios.'
}
finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$steps = @(
  @{ Name = 'portal'; Preflight = 'supabase\preflight\20261002_preflight_portal_alumno_v1.sql'; Migration = 'supabase\migrations\20261002_portal_alumno_v1.sql'; Postflight = 'supabase\postflight\20261002_postflight_portal_alumno_v1.sql' },
  @{ Name = 'payments'; Preflight = 'supabase\preflight\20261004_preflight_pagos_completos_v1.sql'; Migration = 'supabase\migrations\20261004_pagos_completos_v1.sql'; Postflight = 'supabase\postflight\20261004_postflight_pagos_completos_v1.sql' },
  @{ Name = 'receipts'; Preflight = 'supabase\preflight\20261005_preflight_comprobantes_pago_v1.sql'; Migration = 'supabase\migrations\20261005_comprobantes_pago_v1.sql'; Postflight = 'supabase\postflight\20261005_postflight_comprobantes_pago_v1.sql' },
  @{ Name = 'cleanup'; Preflight = 'supabase\preflight\20261006_preflight_limpieza_comprobantes_pago.sql'; Migration = 'supabase\migrations\20261006_limpieza_comprobantes_pago.sql'; Postflight = 'supabase\postflight\20261006_postflight_limpieza_comprobantes_pago.sql' }
)
$rollbackPath = Join-Path $projectRoot 'supabase\rollback\20261006_rollback_limpieza_comprobantes_pago.sql'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql no esta disponible en PATH.' }
foreach ($step in $steps) {
  $step.Preflight = Join-Path $projectRoot $step.Preflight
  $step.Migration = Join-Path $projectRoot $step.Migration
  $step.Postflight = Join-Path $projectRoot $step.Postflight
  foreach ($path in @($step.Preflight, $step.Migration, $step.Postflight)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontro: $path" }
  }
}
if (-not (Test-Path -LiteralPath $rollbackPath -PathType Leaf)) { throw "No se encontro: $rollbackPath" }

function Get-State([string]$Query, [string]$Label) {
  $result = (@(& psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
    --dbname $DatabaseUrl --command $Query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing', 'applied', 'partial')) {
    throw "No fue posible consultar el estado de $Label."
  }
  return $result
}

$states = @{}
$states.portal = Get-State "SELECT CASE WHEN to_regclass('public.reportes_pago_alumno') IS NULL THEN 'missing' ELSE 'applied' END" 'Portal Alumno'
$states.payments = Get-State "SELECT CASE WHEN to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN 'missing' ELSE 'applied' END" 'Pagos Completos'
$receiptQuery = @"
SELECT CASE count(*) WHEN 0 THEN 'missing' WHEN 4 THEN 'applied' ELSE 'partial' END
FROM pg_attribute WHERE attrelid = to_regclass('public.reportes_pago_alumno')
AND attname IN ('comprobante_path','comprobante_mime','comprobante_size','comprobante_requerido') AND NOT attisdropped
"@
$states.receipts = Get-State $receiptQuery 'Comprobantes Pago V1'
$cleanupQuery = @"
SELECT CASE count(*) WHEN 0 THEN 'missing' WHEN 6 THEN 'applied' ELSE 'partial' END
FROM pg_attribute WHERE attrelid = to_regclass('public.reportes_pago_alumno')
AND attname IN ('comprobante_original_mime','comprobante_original_size','comprobante_eliminado_at','comprobante_limpieza_estado','comprobante_limpieza_intentos','comprobante_limpieza_error_at') AND NOT attisdropped
"@
$states.cleanup = Get-State $cleanupQuery 'Limpieza de comprobantes'

if ($states.Values -contains 'partial') { throw 'Existe una migracion parcialmente aplicada; se requiere revision manual.' }
if ($states.cleanup -eq 'applied' -and $states.receipts -ne 'applied') { throw 'Limpieza existe sin Comprobantes Pago V1.' }
if ($states.receipts -eq 'applied' -and $states.payments -ne 'applied') { throw 'Comprobantes existe sin Pagos Completos.' }
if ($states.payments -eq 'applied' -and $states.portal -ne 'applied') { throw 'Pagos Completos existe sin Portal Alumno.' }

$beginPattern = '(?mi)^\s*BEGIN;\s*$'
$commitPattern = '(?mi)^\s*COMMIT;\s*$'
$readOnlyPattern = '(?mi)^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY;\s*$'
$rollbackPattern = '(?mi)^\s*ROLLBACK;\s*$'

function Get-MigrationBody([string]$Path) {
  $content = Get-Content -Raw -LiteralPath $Path
  if ([regex]::Matches($content, $beginPattern).Count -ne 1 -or [regex]::Matches($content, $commitPattern).Count -ne 1) {
    throw "La migracion $Path no tiene exactamente un BEGIN y un COMMIT."
  }
  $content = [regex]::new($beginPattern).Replace($content, '', 1)
  return [regex]::new($commitPattern).Replace($content, '', 1)
}

function Get-ReadOnlyBody([string]$Path) {
  $content = Get-Content -Raw -LiteralPath $Path
  if ([regex]::Matches($content, $readOnlyPattern).Count -ne 1 -or [regex]::Matches($content, $rollbackPattern).Count -ne 1) {
    throw "El archivo $Path no tiene limites READ ONLY/ROLLBACK validos."
  }
  $content = [regex]::new($readOnlyPattern).Replace($content, '', 1)
  return [regex]::new($rollbackPattern).Replace($content, '', 1)
}

if ($states.cleanup -eq 'applied') {
  $cleanupStep = $steps | Where-Object Name -eq 'cleanup'
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $cleanupStep.Preflight
  if ($LASTEXITCODE -ne 0) { throw 'El preflight de limpieza fallo.' }
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $cleanupStep.Postflight
  if ($LASTEXITCODE -ne 0) { throw 'El postflight de limpieza fallo.' }
  Write-Host 'El ajuste ya esta aplicado y supera preflight/postflight.'
  exit 0
}

$transactionSql = ''
$priorMissing = $false
foreach ($step in $steps) {
  if ($states[$step.Name] -eq 'applied') { continue }
  if (-not $priorMissing) {
    & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $step.Preflight
    if ($LASTEXITCODE -ne 0) { throw "El preflight de $($step.Name) fallo." }
  } else {
    $transactionSql += "`n$(Get-ReadOnlyBody $step.Preflight)"
  }
  $transactionSql += "`n$(Get-MigrationBody $step.Migration)`n$(Get-ReadOnlyBody $step.Postflight)"
  $priorMissing = $true
}

$rollback = Get-Content -Raw -LiteralPath $rollbackPath
if ([regex]::Matches($rollback, $rollbackPattern).Count -ne 1) { throw 'El rollback debe contener exactamente un ROLLBACK.' }
$dryRunSql = @"
\set ON_ERROR_STOP on
BEGIN;
$transactionSql
$rollback
"@

$temporaryPath = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -LiteralPath $temporaryPath -Value $dryRunSql -Encoding utf8
  Write-Host 'Ejecutando dependencias pendientes y limpieza dentro de una transaccion reversible...'
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $temporaryPath
  if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
  Write-Host 'Dry-run correcto. PostgreSQL ejecuto ROLLBACK; no se conservaron cambios.'
}
finally {
  if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
}

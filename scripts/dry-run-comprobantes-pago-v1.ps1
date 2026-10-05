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
$paymentsPreflightPath = Join-Path $projectRoot 'supabase\preflight\20261004_preflight_pagos_completos_v1.sql'
$paymentsMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_pagos_completos_v1.sql'
$paymentsPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_pagos_completos_v1.sql'
$receiptPreflightPath = Join-Path $projectRoot 'supabase\preflight\20261005_preflight_comprobantes_pago_v1.sql'
$receiptMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261005_comprobantes_pago_v1.sql'
$receiptPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261005_postflight_comprobantes_pago_v1.sql'
$rollbackPath = Join-Path $projectRoot 'supabase\rollback\20261005_rollback_comprobantes_pago_v1.sql'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'psql no esta disponible en PATH.'
}
foreach ($path in @(
  $portalPreflightPath, $portalMigrationPath, $portalPostflightPath,
  $paymentsPreflightPath, $paymentsMigrationPath, $paymentsPostflightPath,
  $receiptPreflightPath, $receiptMigrationPath, $receiptPostflightPath, $rollbackPath
)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "No se encontro el archivo requerido: $path"
  }
}

function Invoke-StateQuery([string]$query, [string]$label) {
  $result = (@(& psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
    --dbname $DatabaseUrl --command $query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing', 'applied', 'partial')) {
    throw "No fue posible determinar el estado de $label."
  }
  return $result
}

$portalState = Invoke-StateQuery `
  "SELECT CASE WHEN to_regclass('public.reportes_pago_alumno') IS NULL THEN 'missing' ELSE 'applied' END" `
  'Portal Alumno V1'
$paymentsState = Invoke-StateQuery `
  "SELECT CASE WHEN to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN 'missing' ELSE 'applied' END" `
  'Pagos Completos V1'
$receiptStateQuery = @"
SELECT CASE count(*)
  WHEN 0 THEN 'missing'
  WHEN 4 THEN 'applied'
  ELSE 'partial'
END
FROM pg_attribute
WHERE attrelid = to_regclass('public.reportes_pago_alumno')
  AND attname IN ('comprobante_path','comprobante_mime','comprobante_size','comprobante_requerido')
  AND NOT attisdropped
"@
$receiptState = Invoke-StateQuery $receiptStateQuery 'Comprobantes Pago V1'

if ($receiptState -eq 'partial') {
  throw 'Comprobantes Pago V1 esta aplicado parcialmente; se requiere revision manual.'
}
if ($paymentsState -eq 'applied' -and $portalState -eq 'missing') {
  throw 'Estado inconsistente: Pagos Completos existe sin Portal Alumno.'
}
if ($receiptState -eq 'applied' -and $paymentsState -eq 'missing') {
  throw 'Estado inconsistente: Comprobantes existe sin Pagos Completos.'
}

if ($receiptState -eq 'applied') {
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $receiptPreflightPath
  if ($LASTEXITCODE -ne 0) { throw 'El preflight de comprobantes fallo.' }
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $receiptPostflightPath
  if ($LASTEXITCODE -ne 0) { throw 'El postflight de comprobantes fallo.' }
  Write-Host 'Comprobantes Pago V1 ya esta aplicado y supera preflight/postflight.'
  exit 0
}

$beginPattern = '(?mi)^\s*BEGIN;\s*$'
$commitPattern = '(?mi)^\s*COMMIT;\s*$'
$readOnlyPattern = '(?mi)^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY;\s*$'
$rollbackPattern = '(?mi)^\s*ROLLBACK;\s*$'

function Get-MigrationBody([string]$path) {
  $content = Get-Content -Raw -LiteralPath $path
  if ([regex]::Matches($content, $beginPattern).Count -ne 1 -or
      [regex]::Matches($content, $commitPattern).Count -ne 1) {
    throw "La migracion $path no tiene exactamente un BEGIN y un COMMIT."
  }
  $content = [regex]::new($beginPattern).Replace($content, '', 1)
  return [regex]::new($commitPattern).Replace($content, '', 1)
}

function Get-ReadOnlyBody([string]$path) {
  $content = Get-Content -Raw -LiteralPath $path
  if ([regex]::Matches($content, $readOnlyPattern).Count -ne 1 -or
      [regex]::Matches($content, $rollbackPattern).Count -ne 1) {
    throw "El archivo $path no tiene los limites READ ONLY/ROLLBACK esperados."
  }
  $content = [regex]::new($readOnlyPattern).Replace($content, '', 1)
  return [regex]::new($rollbackPattern).Replace($content, '', 1)
}

$transactionSql = ''
if ($portalState -eq 'missing') {
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $portalPreflightPath
  if ($LASTEXITCODE -ne 0) { throw 'El preflight de Portal Alumno fallo.' }
  $transactionSql += "`n$(Get-MigrationBody $portalMigrationPath)`n$(Get-ReadOnlyBody $portalPostflightPath)"
}
if ($paymentsState -eq 'missing') {
  if ($portalState -eq 'applied') {
    & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $paymentsPreflightPath
    if ($LASTEXITCODE -ne 0) { throw 'El preflight de Pagos Completos fallo.' }
  } else {
    $transactionSql += "`n$(Get-ReadOnlyBody $paymentsPreflightPath)"
  }
  $transactionSql += "`n$(Get-MigrationBody $paymentsMigrationPath)`n$(Get-ReadOnlyBody $paymentsPostflightPath)"
}
if ($portalState -eq 'applied' -and $paymentsState -eq 'applied') {
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $receiptPreflightPath
  if ($LASTEXITCODE -ne 0) { throw 'El preflight de comprobantes fallo.' }
} else {
  $transactionSql += "`n$(Get-ReadOnlyBody $receiptPreflightPath)"
}
$transactionSql += "`n$(Get-MigrationBody $receiptMigrationPath)`n$(Get-ReadOnlyBody $receiptPostflightPath)"

$rollback = Get-Content -Raw -LiteralPath $rollbackPath
if ([regex]::Matches($rollback, $rollbackPattern).Count -ne 1) {
  throw 'El rollback debe contener exactamente un ROLLBACK.'
}
$dryRunSql = @"
\set ON_ERROR_STOP on
BEGIN;
$transactionSql
$rollback
"@

$temporaryPath = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -LiteralPath $temporaryPath -Value $dryRunSql -Encoding utf8
  Write-Host 'Ejecutando migraciones pendientes y postflight dentro de una transaccion reversible...'
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $temporaryPath
  if ($LASTEXITCODE -ne 0) {
    throw "El dry-run fallo con codigo $LASTEXITCODE. PostgreSQL revertira la transaccion."
  }
  Write-Host 'Dry-run correcto. PostgreSQL ejecuto ROLLBACK; no se conservaron cambios.'
}
finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}

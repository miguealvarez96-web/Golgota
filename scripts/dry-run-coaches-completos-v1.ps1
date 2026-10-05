param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$preflightPath = Join-Path $projectRoot 'supabase\preflight\20261004_preflight_coaches_completos_v1.sql'
$migrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_coaches_completos_v1.sql'
$postflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_coaches_completos_v1.sql'
$rollbackPath = Join-Path $projectRoot 'supabase\rollback\20261004_rollback_coaches_completos_v1.sql'

$psql = Get-Command psql -ErrorAction SilentlyContinue
if ($null -eq $psql) { throw 'psql no esta disponible en PATH.' }
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { throw 'DatabaseUrl esta vacio.' }

foreach ($path in @($preflightPath, $migrationPath, $postflightPath, $rollbackPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "No se encontro el archivo requerido: $path"
  }
}

$state = (@(& $psql.Source -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
  --dbname $DatabaseUrl `
  --command "SELECT CASE WHEN to_regclass('public.wods') IS NULL AND to_regclass('public.comunicados') IS NULL THEN 'missing' WHEN to_regclass('public.wods') IS NOT NULL AND to_regclass('public.comunicados') IS NOT NULL THEN 'applied' ELSE 'partial' END") -join '').Trim()
if ($LASTEXITCODE -ne 0) { throw "No se pudo determinar el estado de BLOQUE 3 (codigo $LASTEXITCODE)." }
if ($state -eq 'partial') { throw 'BLOQUE 3 esta parcialmente aplicado; se requiere revision manual antes de continuar.' }
if ($state -notin @('missing', 'applied')) { throw "Estado inesperado de BLOQUE 3: '$state'." }

if ($state -eq 'applied') {
  Write-Host 'BLOQUE 3 ya esta aplicado. Ejecutando postflight de solo lectura...'
  & $psql.Source -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $postflightPath
  if ($LASTEXITCODE -ne 0) { throw "El postflight fallo con codigo $LASTEXITCODE." }
  Write-Host 'Dry-run correcto: la instalacion existente supero el postflight.'
  exit 0
}

Write-Host '1/2 Ejecutando preflight de solo lectura...'
& $psql.Source -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $preflightPath
if ($LASTEXITCODE -ne 0) { throw "El preflight fallo con codigo $LASTEXITCODE." }

$beginPattern = '(?mi)^\s*BEGIN;\s*$'
$commitPattern = '(?mi)^\s*COMMIT;\s*$'
$readOnlyPattern = '(?mi)^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY;\s*$'
$rollbackPattern = '(?mi)^\s*ROLLBACK;\s*$'

function Get-MigrationBody([string]$Path) {
  $content = Get-Content -Raw -LiteralPath $Path
  if ([regex]::Matches($content, $beginPattern).Count -ne 1 -or
      [regex]::Matches($content, $commitPattern).Count -ne 1) {
    throw "La migracion $Path no tiene exactamente un BEGIN y un COMMIT."
  }
  $content = [regex]::new($beginPattern).Replace($content, '', 1)
  return [regex]::new($commitPattern).Replace($content, '', 1)
}

function Get-ReadOnlyBody([string]$Path) {
  $content = Get-Content -Raw -LiteralPath $Path
  if ([regex]::Matches($content, $readOnlyPattern).Count -ne 1 -or
      [regex]::Matches($content, $rollbackPattern).Count -ne 1) {
    throw "El archivo $Path no tiene los limites READ ONLY/ROLLBACK esperados."
  }
  $content = [regex]::new($readOnlyPattern).Replace($content, '', 1)
  return [regex]::new($rollbackPattern).Replace($content, '', 1)
}

$rollback = Get-Content -Raw -LiteralPath $rollbackPath
if ([regex]::Matches($rollback, $rollbackPattern).Count -ne 1) {
  throw 'El rollback debe contener exactamente un ROLLBACK.'
}

$dryRunSql = @"
\set ON_ERROR_STOP on
BEGIN;
$(Get-MigrationBody $migrationPath)
$(Get-ReadOnlyBody $postflightPath)
$rollback
"@

$temporaryPath = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -LiteralPath $temporaryPath -Value $dryRunSql -Encoding utf8
  Write-Host '2/2 Ejecutando migracion y postflight dentro de una transaccion reversible...'
  & $psql.Source -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $temporaryPath
  if ($LASTEXITCODE -ne 0) {
    throw "El dry-run fallo con codigo $LASTEXITCODE. PostgreSQL revertira la transaccion abierta."
  }
  Write-Host 'Dry-run completo correcto. PostgreSQL ejecuto ROLLBACK; no se conservaron cambios.'
}
finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}


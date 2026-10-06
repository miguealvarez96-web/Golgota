param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$preflightPath = Join-Path $projectRoot 'supabase\preflight\20261010_preflight_usuarios_internos.sql'
$migrationPath = Join-Path $projectRoot 'supabase\migrations\20261010_usuarios_internos.sql'
$postflightPath = Join-Path $projectRoot 'supabase\postflight\20261010_postflight_usuarios_internos.sql'
$rollbackPath = Join-Path $projectRoot 'supabase\rollback\20261010_rollback_usuarios_internos.sql'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql no esta disponible en PATH.' }
foreach ($path in @($preflightPath, $migrationPath, $postflightPath, $rollbackPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontro: $path" }
}

& psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $preflightPath
if ($LASTEXITCODE -ne 0) { throw "El preflight fallo con codigo $LASTEXITCODE." }

$migration = Get-Content -Raw -LiteralPath $migrationPath
$postflight = Get-Content -Raw -LiteralPath $postflightPath
$rollback = Get-Content -Raw -LiteralPath $rollbackPath
$beginPattern = '(?mi)^\s*BEGIN;\s*$'
$commitPattern = '(?mi)^\s*COMMIT;\s*$'
$readOnlyPattern = '(?mi)^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY;\s*$'
$rollbackPattern = '(?mi)^\s*ROLLBACK;\s*$'

if ([regex]::Matches($migration, $beginPattern).Count -ne 1 -or [regex]::Matches($migration, $commitPattern).Count -ne 1) { throw 'La migracion debe contener un BEGIN y un COMMIT.' }
if ([regex]::Matches($postflight, $readOnlyPattern).Count -ne 1 -or [regex]::Matches($postflight, $rollbackPattern).Count -ne 1) { throw 'El postflight no tiene limites de solo lectura validos.' }
if ([regex]::Matches($rollback, $rollbackPattern).Count -ne 1 -or $rollback -match '(?i)\b(?:DROP|DELETE|COMMIT)\b') { throw 'El rollback del dry-run no es seguro.' }

$migrationBody = [regex]::new($beginPattern).Replace($migration, '', 1)
$migrationBody = [regex]::new($commitPattern).Replace($migrationBody, '', 1)
$postflightBody = [regex]::new($readOnlyPattern).Replace($postflight, '', 1)
$postflightBody = [regex]::new($rollbackPattern).Replace($postflightBody, '', 1)
$temporaryPath = [System.IO.Path]::GetTempFileName()
try {
  $dryRunSql = @"
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE dry_run_handle_new_user_guard ON COMMIT DROP
AS SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS definition;
$migrationBody
DO `$guard`$
BEGIN
  IF pg_get_functiondef('public.handle_new_user()'::regprocedure)
     IS DISTINCT FROM (SELECT definition FROM dry_run_handle_new_user_guard) THEN
    RAISE EXCEPTION 'El dry-run detecto un cambio en handle_new_user.';
  END IF;
END;
`$guard`$;
$postflightBody
$rollback
"@
  Set-Content -LiteralPath $temporaryPath -Value $dryRunSql -Encoding utf8
  & psql -X -v ON_ERROR_STOP=1 --dbname $DatabaseUrl --file $temporaryPath
  if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
  Write-Host 'Dry-run correcto. PostgreSQL ejecuto ROLLBACK; no se conservaron cambios.'
} finally {
  if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
}

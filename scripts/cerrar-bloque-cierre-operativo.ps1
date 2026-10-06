[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF

function Find-Command([string[]]$Names, [string]$Message) {
  foreach ($name in $Names) { $command = Get-Command $name -ErrorAction SilentlyContinue; if ($null -ne $command) { return $command.Source } }
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
  $query = "SELECT CASE WHEN to_regclass('public.inventario_items') IS NULL AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='gastos' AND column_name IN ('proveedor','observacion','estado','updated_by','anulado_por','anulado_at')) = 0 THEN 'missing' WHEN to_regclass('public.inventario_items') IS NOT NULL AND (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='gastos' AND column_name IN ('proveedor','observacion','estado','updated_by','anulado_por','anulado_at')) = 6 THEN 'applied' ELSE 'partial' END"
  $result = (@(& $script:Psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align --dbname $script:DatabaseUrl --command $query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing', 'applied', 'partial')) { throw 'No se pudo determinar el estado del cierre operativo.' }
  return $result
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
$powershell = Find-Command @('pwsh.exe', 'powershell.exe', 'pwsh', 'powershell') 'PowerShell no esta disponible en PATH.'

$preflight = Join-Path $projectRoot 'supabase\preflight\20261012_preflight_cierre_operativo.sql'
$migration = Join-Path $projectRoot 'supabase\migrations\20261012_cierre_operativo.sql'
$postflight = Join-Path $projectRoot 'supabase\postflight\20261012_postflight_cierre_operativo.sql'
$dryRun = Join-Path $projectRoot 'scripts\dry-run-cierre-operativo.ps1'

$state = Get-State
if ($state -eq 'partial') { throw 'El cierre operativo esta parcialmente aplicado; se requiere revision manual.' }
if ($state -eq 'missing') {
  Invoke-Sql $preflight 'Preflight del cierre operativo'
  Invoke-Checked $powershell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $dryRun, '-DatabaseUrl', $script:DatabaseUrl, '-SkipPreflight') 'Dry-run del cierre operativo'
  if (-not (Confirm-Step ('{0}Aplicar SQL real del cierre operativo? [S/N]' -f $invertedQuestionMark))) { Write-Host 'SQL real cancelado.'; exit 0 }
  Invoke-Sql $migration 'Migracion del cierre operativo'
} else { Write-Host 'La migracion ya estaba aplicada; no se repetira.' }
Invoke-Sql $postflight 'Postflight del cierre operativo'

Invoke-Checked $node @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-Checked $npx @('tsc', '--noEmit') 'TypeScript'
Invoke-Checked $npm @('run', 'build') 'Build'
Invoke-Checked $git @('diff', '--check') 'git diff --check'
Invoke-Checked $git @('status') 'git status'

$blockFiles = @(
  'scripts/cerrar-bloque-cierre-operativo.ps1', 'scripts/dry-run-cierre-operativo.ps1',
  'src/app/(app)/gastos/actions.ts', 'src/app/(app)/gastos/page.tsx',
  'src/app/(app)/inventario/actions.ts', 'src/app/(app)/inventario/page.tsx',
  'src/components/gastos/expense-form.tsx', 'src/components/gastos/expenses-manager.tsx',
  'src/components/inventario/inventory-incident-form.tsx', 'src/components/inventario/inventory-item-form.tsx',
  'src/components/inventario/inventory-manager.tsx', 'src/components/layout/portal-navigation.tsx',
  'src/components/reportes/reports-dashboard.tsx', 'src/lib/gastos/access.ts',
  'src/lib/gastos/data.ts', 'src/lib/gastos/model.ts', 'src/lib/inventario/access.ts',
  'src/lib/inventario/data.ts', 'src/lib/inventario/model.ts', 'src/lib/reportes/data.ts',
  'supabase/preflight/20261012_preflight_cierre_operativo.sql',
  'supabase/migrations/20261012_cierre_operativo.sql',
  'supabase/postflight/20261012_postflight_cierre_operativo.sql',
  'supabase/rollback/20261012_rollback_cierre_operativo.sql',
  'tests/gastos.test.cjs', 'tests/inventario.test.cjs', 'tests/cierre-operativo.test.cjs',
  'tests/coaches.test.cjs', 'tests/privacidad.test.cjs', 'tests/produccion.test.cjs', 'tests/reportes.test.cjs'
)

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $stagedBefore = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedBefore | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  Invoke-Checked $git (@('add', '--') + $blockFiles) 'git add'
  Invoke-Checked $git @('commit', '-m', 'feat: add expenses inventory and final reporting') 'git commit'
  Invoke-Checked $git @('push') 'git push'
} else { Write-Host 'Commit/push omitidos.' }

if (-not (Confirm-Step ('{0}Desplegar a produccion? [S/N]' -f $invertedQuestionMark))) { Write-Host 'Deploy omitido.'; exit 0 }
$vercel = Find-Command @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
Invoke-Checked $vercel @('--prod') 'Deploy de produccion'

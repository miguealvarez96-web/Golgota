[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF

function Find-Command([string[]]$Names, [string]$Message) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
  }
  throw $Message
}
function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$Label) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label fallo con codigo $LASTEXITCODE." }
}
function Confirm-Step([string]$Prompt) { return (Read-Host $Prompt).Trim().ToUpperInvariant() -eq 'S' }
function Invoke-Sql([string]$Path, [string]$Label) {
  Invoke-Checked $script:Psql @('-X','-v','ON_ERROR_STOP=1','--dbname',$script:DatabaseUrl,'--file',$Path) $Label
}
function Get-State {
  $query = "SELECT CASE WHEN count(*)=0 THEN 'missing' WHEN count(*)=8 THEN 'applied' ELSE 'partial' END FROM (SELECT table_name AS item FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('progreso_fisico','records_personales','wod_resultados','desafios','desafio_participantes') UNION ALL SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='wods' AND column_name IN ('benchmark_ref','permite_resultados','limite_tiempo_minutos')) s"
  $result = (@(& $script:Psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align --dbname $script:DatabaseUrl --command $query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing','applied','partial')) { throw 'No se pudo determinar el estado del bloque.' }
  return $result
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) { throw 'SUPABASE_DB_URL no existe o esta vacia.' }
$script:DatabaseUrl = $env:SUPABASE_DB_URL
$script:Psql = Find-Command @('psql') 'psql no esta disponible en PATH.'
$git = Find-Command @('git') 'git no esta disponible en PATH.'
$npm = Find-Command @('npm.cmd','npm') 'npm no esta disponible en PATH.'
$npx = Find-Command @('npx.cmd','npx') 'npx no esta disponible en PATH.'

$preflight = Join-Path $projectRoot 'supabase\preflight\20261013_deportivo_gamificacion.sql'
$migration = Join-Path $projectRoot 'supabase\migrations\20261013_deportivo_gamificacion.sql'
$postflight = Join-Path $projectRoot 'supabase\postflight\20261013_deportivo_gamificacion.sql'
$dryRun = Join-Path $projectRoot 'scripts\dry-run-deportivo-gamificacion.ps1'

$state = Get-State
if ($state -eq 'partial') { throw 'El bloque esta parcialmente aplicado; se requiere revision manual.' }
if ($state -eq 'missing') {
  Invoke-Sql $preflight 'Preflight deportivo'
  & $dryRun -DatabaseUrl $script:DatabaseUrl
  if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
  if (-not (Confirm-Step ('{0}Aplicar SQL real deportivo y gamificacion? [S/N]' -f $invertedQuestionMark))) { Write-Host 'SQL real cancelado.'; exit 0 }
  Invoke-Sql $migration 'Migracion deportiva'
} else { Write-Host 'La migracion ya estaba aplicada; no se repetira.' }
Invoke-Sql $postflight 'Postflight deportivo'

Invoke-Checked $npm @('test') 'Pruebas automatizadas'
Invoke-Checked $npx @('tsc','--noEmit') 'TypeScript'
Invoke-Checked $npm @('run','build') 'Build'
Invoke-Checked $git @('diff','--check') 'git diff --check'
Invoke-Checked $git @('status') 'git status'

$blockFiles = @(
  'scripts/cerrar-bloque-deportivo-gamificacion.ps1','scripts/dry-run-deportivo-gamificacion.ps1',
  'src/app/(app)/desafios/actions.ts','src/app/(app)/desafios/page.tsx','src/app/(app)/wod/actions.ts','src/app/(app)/wod/page.tsx',
  'src/app/(student)/portal/page.tsx','src/app/(student)/portal/sports-actions.ts','src/app/privacidad/page.tsx',
  'src/components/alumnos/student-dashboard.tsx','src/components/alumnos/student-sports-panel.tsx',
  'src/components/coaches/challenge-manager.tsx','src/components/coaches/wod-manager.tsx',
  'src/components/layout/portal-icon.tsx','src/components/layout/portal-navigation.tsx',
  'src/lib/coaches/model.ts','src/lib/deportivo/data.ts','src/lib/deportivo/model.ts',
  'supabase/preflight/20261013_deportivo_gamificacion.sql','supabase/migrations/20261013_deportivo_gamificacion.sql',
  'supabase/postflight/20261013_deportivo_gamificacion.sql','supabase/rollback/20261013_deportivo_gamificacion.sql',
  'tests/cierre-operativo.test.cjs','tests/coaches.test.cjs','tests/deportivo-gamificacion.test.cjs','tests/privacidad.test.cjs','tests/produccion.test.cjs','tests/reportes.test.cjs'
)

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $stagedBefore = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedBefore | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  Invoke-Checked $git (@('add','--')+$blockFiles) 'git add'
  Invoke-Checked $git @('commit','-m','feat: add student progress wod rankings and challenges') 'git commit'
  Invoke-Checked $git @('push') 'git push'
} else { Write-Host 'Commit/push omitidos.' }

if (-not (Confirm-Step ('{0}Desplegar a produccion? [S/N]' -f $invertedQuestionMark))) { Write-Host 'Deploy omitido.'; exit 0 }
$vercel = Find-Command @('vercel.cmd','vercel') 'vercel no esta disponible en PATH.'
$stdout = [System.IO.Path]::GetTempFileName()
$stderr = [System.IO.Path]::GetTempFileName()
try {
  $process = Start-Process -FilePath $vercel -ArgumentList @('--prod') -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Get-Content -LiteralPath $stdout
  Get-Content -LiteralPath $stderr
  if ($process.ExitCode -ne 0) { throw "Deploy de produccion fallo con codigo $($process.ExitCode)." }
} finally {
  Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
}

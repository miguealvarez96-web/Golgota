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
  Invoke-Checked $script:Psql @('-X', '-v', 'ON_ERROR_STOP=1', '--dbname', $script:DatabaseUrl, '--file', $Path) $Label
}
function Get-State {
  $query = "WITH state AS (SELECT (to_regclass('public.registro_alumno_intentos') IS NOT NULL)::int AS table_found, (to_regprocedure('public.preparar_registro_alumno(uuid,text,text,text,text,text,text,boolean)') IS NOT NULL)::int AS function_found) SELECT CASE WHEN table_found = 0 AND function_found = 0 THEN 'missing' WHEN table_found = 1 AND function_found = 1 THEN 'applied' ELSE 'partial' END FROM state"
  $result = (@(& $script:Psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align --dbname $script:DatabaseUrl --command $query) -join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing', 'applied', 'partial')) { throw 'No se pudo determinar el estado de BLOQUE 8.' }
  return $result
}
function Invoke-Vercel([string]$Command) {
  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath $Command -ArgumentList @('--prod') -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $output = @((Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue))
    $output | ForEach-Object { Write-Host $_ }
    if ($process.ExitCode -ne 0) { throw "vercel --prod fallo con codigo $($process.ExitCode)." }
    return $output
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
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

$dryRun = Join-Path $projectRoot 'scripts\dry-run-registro-publico-alumnos.ps1'
$migration = Join-Path $projectRoot 'supabase\migrations\20261008_registro_publico_alumnos.sql'
$postflight = Join-Path $projectRoot 'supabase\postflight\20261008_postflight_registro_publico_alumnos.sql'
foreach ($path in @($dryRun, $migration, $postflight)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontro $path" }
}

$repositoryRoot = (@(& $git rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne [IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw 'El script no se esta ejecutando en el repositorio esperado.'
}

$allowedSql = @(
  'supabase/migrations/20261008_registro_publico_alumnos.sql',
  'supabase/preflight/20261008_preflight_registro_publico_alumnos.sql',
  'supabase/postflight/20261008_postflight_registro_publico_alumnos.sql',
  'supabase/rollback/20261008_rollback_registro_publico_alumnos.sql'
)
$sqlStatus = @(& $git status --porcelain --untracked-files=all -- '*.sql')
$changedSql = @($sqlStatus | ForEach-Object { if ($_.Length -ge 4) { $_.Substring(3).Trim('"').Replace('\', '/') } } | Where-Object { $_ })
$foreignSql = @($changedSql | Where-Object { $_ -notin $allowedSql })
if ($foreignSql.Count -gt 0) { throw "SQL ajeno detectado: $($foreignSql -join ', ')" }
Write-Host "SQL detectado: $($changedSql -join ', ')"

$state = Get-State
if ($state -eq 'partial') { throw 'BLOQUE 8 esta parcialmente aplicado; se requiere revision manual.' }
if ($state -eq 'missing') {
  & $dryRun -DatabaseUrl $script:DatabaseUrl
  if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
  Write-Host 'DRY-RUN CORRECTO'
  if (-not (Confirm-Step ('{0}Aplicar SQL real? [S/N]' -f $invertedQuestionMark))) { Write-Host 'SQL real cancelado.'; exit 0 }
  Invoke-Sql $migration 'Migracion BLOQUE 8'
} else {
  Write-Host 'BLOQUE 8 ya estaba aplicado; no se repetira la migracion.'
}
Invoke-Sql $postflight 'Postflight BLOQUE 8'

Invoke-Checked $node @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-Checked $npx @('tsc', '--noEmit') 'TypeScript'
Invoke-Checked $npm @('run', 'build') 'Build'
Invoke-Checked $git @('diff', '--check') 'git diff --check'
Invoke-Checked $git @('status') 'git status'

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $blockFiles = @(
    'docs/CONTEXT.md', 'docs/DECISIONS.md', 'docs/ESTADO-FINAL.md', 'docs/PRIVACIDAD.md',
    'scripts/cerrar-bloque-registro-alumnos.ps1', 'scripts/dry-run-registro-publico-alumnos.ps1',
    'src/app/(auth)/login/page.tsx', 'src/app/(auth)/registro/actions.ts', 'src/app/(auth)/registro/page.tsx',
    'src/app/auth/callback/route.ts', 'src/components/auth/student-registration-form.tsx',
    'src/lib/clientes/model.ts', 'src/lib/registro/model.ts', 'src/middleware.ts',
    'supabase/migrations/20261008_registro_publico_alumnos.sql',
    'supabase/preflight/20261008_preflight_registro_publico_alumnos.sql',
    'supabase/postflight/20261008_postflight_registro_publico_alumnos.sql',
    'supabase/rollback/20261008_rollback_registro_publico_alumnos.sql',
    'tests/registro-alumnos.test.cjs'
  )
  $stagedBefore = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedBefore | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  Invoke-Checked $git (@('add', '--') + $blockFiles) 'git add'
  $stagedAfter = @(& $git diff --cached --name-only)
  $foreignStaged = @($stagedAfter | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  & $git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No se pudo revisar staging.' }
  Invoke-Checked $git @('commit', '-m', 'feat: add public student registration') 'git commit'
  Invoke-Checked $git @('push') 'git push'
} else { Write-Host 'Commit/push omitidos; .gitignore y cambios ajenos no se incluyeron.' }

if (-not (Confirm-Step ('{0}Desplegar a produccion? [S/N]' -f $invertedQuestionMark))) { Write-Host 'Deploy omitido.'; exit 0 }
$vercel = Find-Command @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
$output = Invoke-Vercel $vercel
if (-not (($output -join "`n") -match 'https://')) { throw 'Vercel no devolvio una URL reconocible.' }
Write-Host 'URL FINAL DE PRODUCCION: https://golgota.vercel.app/registro'

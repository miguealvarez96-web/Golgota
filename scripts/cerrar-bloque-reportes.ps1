[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF
$lowercaseOAcute = [char]0x00F3

function Get-ExecutablePath {
  param([string[]]$Names, [string]$ErrorMessage)
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) { return $command.Source }
  }
  throw $ErrorMessage
}

function Invoke-CheckedCommand {
  param([string]$Command, [string[]]$Arguments, [string]$Label)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label fallo con codigo $LASTEXITCODE." }
}

function Confirm-Step([string]$Prompt) {
  return (Read-Host $Prompt).Trim().ToUpperInvariant() -eq 'S'
}

function Invoke-VercelProduction([string]$Command) {
  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()
  try {
    $process = Start-Process -FilePath $Command -ArgumentList @('--prod') -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $stdout = @(Get-Content -LiteralPath $stdoutPath -ErrorAction SilentlyContinue)
    $stderr = @(Get-Content -LiteralPath $stderrPath -ErrorAction SilentlyContinue)
    $stdout | ForEach-Object { Write-Host $_ }
    $stderr | ForEach-Object { Write-Host $_ }
    if ($process.ExitCode -ne 0) { throw "vercel --prod fallo con codigo $($process.ExitCode)." }
    return @($stdout + $stderr)
  }
  finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$gitCommand = Get-ExecutablePath @('git') 'git no esta disponible en PATH.'
$nodeCommand = Get-ExecutablePath @('node') 'node no esta disponible en PATH.'
$npxCommand = Get-ExecutablePath @('npx.cmd', 'npx') 'npx no esta disponible en PATH.'
$npmCommand = Get-ExecutablePath @('npm.cmd', 'npm') 'npm no esta disponible en PATH.'
$repositoryRoot = (@(& $gitCommand rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne
    [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw 'El script no se esta ejecutando en el repositorio esperado.'
}

$migrationRelative = 'supabase/migrations/20261004_reportes_gestion_v1.sql'
$preflightRelative = 'supabase/preflight/20261004_preflight_reportes_gestion_v1.sql'
$postflightRelative = 'supabase/postflight/20261004_postflight_reportes_gestion_v1.sql'
$rollbackRelative = 'supabase/rollback/20261004_rollback_reportes_gestion_v1.sql'
$dryRunRelative = 'scripts/dry-run-reportes-gestion-v1.ps1'
$hasSql = Test-Path -LiteralPath (Join-Path $projectRoot $migrationRelative)

if ($hasSql) {
  foreach ($required in @($preflightRelative, $postflightRelative, $rollbackRelative, $dryRunRelative)) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $required))) {
      throw "Se detecto SQL de BLOQUE 5, pero falta $required."
    }
  }
  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
    throw 'SUPABASE_DB_URL no esta definida.'
  }
  $psqlCommand = Get-ExecutablePath @('psql') 'psql no esta disponible en PATH.'
  $powershellCommand = Get-ExecutablePath @('pwsh.exe', 'powershell.exe', 'pwsh', 'powershell') 'PowerShell no esta disponible en PATH.'
  Invoke-CheckedCommand $powershellCommand @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $projectRoot $dryRunRelative)) 'Dry-run SQL de BLOQUE 5'
  Write-Host 'DRY-RUN CORRECTO'
  if (-not (Confirm-Step ('{0}Aplicar SQL real? [S/N]' -f $invertedQuestionMark))) {
    Write-Host 'SQL real omitido.'
    exit 0
  }
  Invoke-CheckedCommand $psqlCommand @($env:SUPABASE_DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', (Join-Path $projectRoot $migrationRelative)) 'Migracion SQL de BLOQUE 5'
  Invoke-CheckedCommand $psqlCommand @($env:SUPABASE_DB_URL, '-v', 'ON_ERROR_STOP=1', '-f', (Join-Path $projectRoot $postflightRelative)) 'Postflight SQL de BLOQUE 5'
} else {
  Write-Host 'BLOQUE 5 no contiene SQL nuevo; se omiten dry-run, aplicacion y postflight.'
}

Invoke-CheckedCommand $nodeCommand @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-CheckedCommand $npxCommand @('tsc', '--noEmit') 'Validacion de TypeScript'
Invoke-CheckedCommand $npmCommand @('run', 'build') 'Build de produccion'
Invoke-CheckedCommand $gitCommand @('diff', '--check') 'git diff --check'
Invoke-CheckedCommand $gitCommand @('status') 'git status'

$blockFiles = @(
  'docs/CONTEXT.md',
  'docs/DECISIONS.md',
  'docs/ROADMAP.md',
  'scripts/cerrar-bloque-reportes.ps1',
  'src/app/(app)/reportes/page.tsx',
  'src/components/reportes/reports-dashboard.tsx',
  'src/lib/membresias/grouping.ts',
  'src/lib/reportes/access.ts',
  'src/lib/reportes/data.ts',
  'src/lib/reportes/model.ts',
  'tests/coaches.test.cjs',
  'tests/reportes.test.cjs'
)
if ($hasSql) {
  $blockFiles += @($migrationRelative, $preflightRelative, $postflightRelative, $rollbackRelative, $dryRunRelative)
}

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $alreadyStaged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar staging.' }
  $foreign = @($alreadyStaged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Hay archivos ajenos en staging: $($foreign -join ', ')" }
  Invoke-CheckedCommand $gitCommand (@('add', '--') + $blockFiles) 'git add de BLOQUE 5'
  $staged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar staging.' }
  $foreign = @($staged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Staging contiene archivos ajenos: $($foreign -join ', ')" }
  & $gitCommand diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios de BLOQUE 5 para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No se pudo comprobar el diff en staging.' }
  Invoke-CheckedCommand $gitCommand @('commit', '-m', 'feat: add management reports') 'git commit'
  Invoke-CheckedCommand $gitCommand @('push') 'git push'
} else {
  Write-Host 'Commit y push omitidos.'
}

Invoke-CheckedCommand $gitCommand @('status') 'git status final'
if (-not (Confirm-Step ('{0}Desplegar a producci{1}n en Vercel? [S/N]' -f $invertedQuestionMark, $lowercaseOAcute))) {
  Write-Host 'Despliegue a produccion omitido.'
  exit 0
}

$vercelCommand = Get-ExecutablePath @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
$vercelOutput = Invoke-VercelProduction $vercelCommand
$urlMatches = [regex]::Matches(($vercelOutput -join "`n"), 'https://[^\s]+')
if ($urlMatches.Count -eq 0) { throw 'Vercel termino con codigo 0, pero no devolvio una URL reconocible.' }
$productionUrl = $urlMatches[$urlMatches.Count - 1].Value.TrimEnd('.', ',', ';')
Write-Host "URL FINAL DE PRODUCCION: $productionUrl"

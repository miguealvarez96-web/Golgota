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

function Invoke-PsqlFile([string]$Path, [string]$Label) {
  Invoke-CheckedCommand -Command $script:PsqlCommand -Arguments @(
    '-X', '-v', 'ON_ERROR_STOP=1', '--dbname', $script:DatabaseUrl, '--file', $Path
  ) -Label $Label
}

function Get-BlockState {
  $query = "SELECT CASE WHEN to_regclass('public.wods') IS NULL AND to_regclass('public.comunicados') IS NULL THEN 'missing' WHEN to_regclass('public.wods') IS NOT NULL AND to_regclass('public.comunicados') IS NOT NULL THEN 'applied' ELSE 'partial' END"
  $output = @(& $script:PsqlCommand -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
    --dbname $script:DatabaseUrl --command $query)
  if ($LASTEXITCODE -ne 0) { throw "No se pudo consultar BLOQUE 3 (codigo $LASTEXITCODE)." }
  $state = ($output -join '').Trim()
  if ($state -notin @('missing', 'applied', 'partial')) { throw "Estado inesperado de BLOQUE 3: '$state'." }
  return $state
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

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  throw 'SUPABASE_DB_URL no existe o esta vacia.'
}

$script:DatabaseUrl = $env:SUPABASE_DB_URL
$script:PsqlCommand = Get-ExecutablePath @('psql') 'psql no esta disponible en PATH.'
$gitCommand = Get-ExecutablePath @('git') 'git no esta disponible en PATH.'
$nodeCommand = Get-ExecutablePath @('node') 'node no esta disponible en PATH.'
$npxCommand = Get-ExecutablePath @('npx.cmd', 'npx') 'npx no esta disponible en PATH.'
$npmCommand = Get-ExecutablePath @('npm.cmd', 'npm') 'npm no esta disponible en PATH.'

$dryRunPath = Join-Path $projectRoot 'scripts\dry-run-coaches-completos-v1.ps1'
$migrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_coaches_completos_v1.sql'
$postflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_coaches_completos_v1.sql'
foreach ($path in @($dryRunPath, $migrationPath, $postflightPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontro el archivo requerido: $path" }
}

$repositoryRoot = (@(& $gitCommand rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne
    [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw 'El script no se esta ejecutando en el repositorio esperado.'
}

Write-Host 'Ejecutando dry-run reversible de BLOQUE 3 - COACHES COMPLETOS...'
& $dryRunPath -DatabaseUrl $script:DatabaseUrl
if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
Write-Host 'DRY-RUN CORRECTO'

if (-not (Confirm-Step ('{0}Aplicar SQL real? [S/N]' -f $invertedQuestionMark))) {
  Write-Host 'SQL real cancelado.'
  exit 0
}

$blockState = Get-BlockState
if ($blockState -eq 'partial') { throw 'BLOQUE 3 esta parcialmente aplicado; se requiere revision manual.' }
if ($blockState -eq 'missing') {
  Invoke-PsqlFile $migrationPath 'Migracion de BLOQUE 3 - COACHES COMPLETOS'
} else {
  Write-Host 'BLOQUE 3 ya esta aplicado; no se volvera a aplicar.'
}
Invoke-PsqlFile $postflightPath 'Postflight de BLOQUE 3 - COACHES COMPLETOS'

Invoke-CheckedCommand $nodeCommand @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-CheckedCommand $npxCommand @('tsc', '--noEmit') 'Validacion de TypeScript'
Invoke-CheckedCommand $npmCommand @('run', 'build') 'Build de produccion'
Invoke-CheckedCommand $gitCommand @('diff', '--check') 'git diff --check'
Invoke-CheckedCommand $gitCommand @('status') 'git status'

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $blockFiles = @(
    'docs/CONTEXT.md',
    'docs/DECISIONS.md',
    'docs/ROADMAP.md',
    'scripts/cerrar-bloque-coaches.ps1',
    'scripts/dry-run-coaches-completos-v1.ps1',
    'src/app/(app)/clientes/page.tsx',
    'src/app/(app)/comunicados/actions.ts',
    'src/app/(app)/comunicados/page.tsx',
    'src/app/(app)/membresias/cliente/[id]/page.tsx',
    'src/app/(app)/membresias/page.tsx',
    'src/app/(app)/page.tsx',
    'src/app/(app)/wod/actions.ts',
    'src/app/(app)/wod/page.tsx',
    'src/components/clientes/clients-manager.tsx',
    'src/components/coaches/announcements-manager.tsx',
    'src/components/coaches/coach-dashboard.tsx',
    'src/components/coaches/wod-manager.tsx',
    'src/components/layout/portal-icon.tsx',
    'src/components/layout/portal-navigation.tsx',
    'src/lib/clientes/model.ts',
    'src/lib/coaches/access.ts',
    'src/lib/coaches/data.ts',
    'src/lib/coaches/model.ts',
    'src/lib/membresias/data.ts',
    'src/lib/membresias/grouping.ts',
    'supabase/migrations/20261004_coaches_completos_v1.sql',
    'supabase/postflight/20261004_postflight_coaches_completos_v1.sql',
    'supabase/preflight/20261004_preflight_coaches_completos_v1.sql',
    'supabase/rollback/20261004_rollback_coaches_completos_v1.sql',
    'tests/clientes.test.cjs',
    'tests/coaches.test.cjs',
    'tests/membresias.test.cjs'
  )

  $alreadyStaged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar staging.' }
  $foreign = @($alreadyStaged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Hay archivos ajenos en staging: $($foreign -join ', ')" }

  Invoke-CheckedCommand $gitCommand (@('add', '--') + $blockFiles) 'git add de BLOQUE 3'
  $staged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar staging.' }
  $foreign = @($staged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Staging contiene archivos ajenos: $($foreign -join ', ')" }

  & $gitCommand diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios de BLOQUE 3 para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No se pudo comprobar el diff en staging.' }
  Invoke-CheckedCommand $gitCommand @('commit', '-m', 'feat: complete coach portal') 'git commit'
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

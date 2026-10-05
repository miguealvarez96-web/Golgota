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
  Invoke-CheckedCommand $script:PsqlCommand @(
    '-X', '-v', 'ON_ERROR_STOP=1', '--dbname', $script:DatabaseUrl, '--file', $Path
  ) $Label
}

function Get-BlockState {
  $query = "WITH objects AS (SELECT (to_regclass('public.privacidad_aceptaciones') IS NOT NULL)::int + (to_regclass('public.privacidad_solicitudes') IS NOT NULL)::int AS tables_found, (to_regtype('public.tipo_solicitud_privacidad_enum') IS NOT NULL)::int + (to_regtype('public.estado_solicitud_privacidad_enum') IS NOT NULL)::int AS types_found, (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('version_aviso_privacidad_vigente','registrar_aceptacion_privacidad','crear_solicitud_privacidad','revisar_solicitud_privacidad','listar_solicitudes_privacidad')) AS functions_found) SELECT CASE WHEN tables_found = 0 AND types_found = 0 AND functions_found = 0 THEN 'missing' WHEN tables_found = 2 AND types_found = 2 AND functions_found = 5 THEN 'applied' ELSE 'partial' END FROM objects"
  $output = @(& $script:PsqlCommand -X -v ON_ERROR_STOP=1 --tuples-only --no-align --dbname $script:DatabaseUrl --command $query)
  if ($LASTEXITCODE -ne 0) { throw "No se pudo consultar BLOQUE 6 (codigo $LASTEXITCODE)." }
  $state = ($output -join '').Trim()
  if ($state -notin @('missing', 'applied', 'partial')) { throw "Estado inesperado de BLOQUE 6: '$state'." }
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
if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) { throw 'SUPABASE_DB_URL no existe o esta vacia.' }

$script:DatabaseUrl = $env:SUPABASE_DB_URL
$script:PsqlCommand = Get-ExecutablePath @('psql') 'psql no esta disponible en PATH.'
$gitCommand = Get-ExecutablePath @('git') 'git no esta disponible en PATH.'
$nodeCommand = Get-ExecutablePath @('node') 'node no esta disponible en PATH.'
$npxCommand = Get-ExecutablePath @('npx.cmd', 'npx') 'npx no esta disponible en PATH.'
$npmCommand = Get-ExecutablePath @('npm.cmd', 'npm') 'npm no esta disponible en PATH.'

$dryRunPath = Join-Path $projectRoot 'scripts\dry-run-privacidad-lopdp-v1.ps1'
$migrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_privacidad_lopdp_v1.sql'
$postflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_privacidad_lopdp_v1.sql'
foreach ($path in @($dryRunPath, $migrationPath, $postflightPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "No se encontro el archivo requerido: $path" }
}

$repositoryRoot = (@(& $gitCommand rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw 'El script no se esta ejecutando en el repositorio esperado.'
}

$blockState = Get-BlockState
if ($blockState -eq 'partial') { throw 'BLOQUE 6 esta parcialmente aplicado; se requiere revision manual.' }
if ($blockState -eq 'missing') {
  Write-Host 'Ejecutando dry-run reversible de BLOQUE 6 - PRIVACIDAD Y LOPDP...'
  & $dryRunPath -DatabaseUrl $script:DatabaseUrl
  if ($LASTEXITCODE -ne 0) { throw "El dry-run fallo con codigo $LASTEXITCODE." }
  Write-Host 'DRY-RUN CORRECTO'
  if (-not (Confirm-Step ('{0}Aplicar SQL real? [S/N]' -f $invertedQuestionMark))) { Write-Host 'SQL real cancelado.'; exit 0 }
  Invoke-PsqlFile $migrationPath 'Migracion de BLOQUE 6 - PRIVACIDAD Y LOPDP'
} else {
  Write-Host 'BLOQUE 6 ya esta aplicado; no se volvera a aplicar ni se pedira SQL real.'
}
Invoke-PsqlFile $postflightPath 'Postflight de BLOQUE 6 - PRIVACIDAD Y LOPDP'

Invoke-CheckedCommand $nodeCommand @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-CheckedCommand $npxCommand @('tsc', '--noEmit') 'Validacion de TypeScript'
Invoke-CheckedCommand $npmCommand @('run', 'build') 'Build de produccion'
Invoke-CheckedCommand $gitCommand @('diff', '--check') 'git diff --check'
Invoke-CheckedCommand $gitCommand @('status') 'git status'

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $blockFiles = @(
    'docs/CONTEXT.md', 'docs/DECISIONS.md', 'docs/PRIVACIDAD.md', 'docs/ROADMAP.md',
    'scripts/cerrar-bloque-privacidad.ps1', 'scripts/dry-run-privacidad-lopdp-v1.ps1',
    'src/app/(app)/solicitudes-privacidad/actions.ts', 'src/app/(app)/solicitudes-privacidad/page.tsx',
    'src/app/(auth)/login/page.tsx', 'src/app/(student)/portal/page.tsx',
    'src/app/(student)/portal/privacy-actions.ts', 'src/app/privacidad/page.tsx',
    'src/components/alumnos/student-dashboard.tsx', 'src/components/alumnos/student-privacy-panel.tsx',
    'src/components/layout/portal-icon.tsx', 'src/components/layout/portal-navigation.tsx',
    'src/components/privacidad/privacy-requests-manager.tsx', 'src/lib/privacidad/access.ts',
    'src/lib/privacidad/data.ts', 'src/lib/privacidad/model.ts', 'src/middleware.ts',
    'supabase/migrations/20261004_privacidad_lopdp_v1.sql',
    'supabase/postflight/20261004_postflight_privacidad_lopdp_v1.sql',
    'supabase/preflight/20261004_preflight_privacidad_lopdp_v1.sql',
    'supabase/rollback/20261004_rollback_privacidad_lopdp_v1.sql', 'tests/auth.test.cjs',
    'tests/coaches.test.cjs', 'tests/privacidad.test.cjs'
  )
  $alreadyStaged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar staging.' }
  $foreign = @($alreadyStaged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Hay archivos ajenos en staging: $($foreign -join ', ')" }
  Invoke-CheckedCommand $gitCommand (@('add', '--') + $blockFiles) 'git add de BLOQUE 6'
  $staged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar staging.' }
  $foreign = @($staged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Staging contiene archivos ajenos: $($foreign -join ', ')" }
  & $gitCommand diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios de BLOQUE 6 para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No se pudo comprobar el diff en staging.' }
  Invoke-CheckedCommand $gitCommand @('commit', '-m', 'feat: add privacy and data protection workflows') 'git commit'
  Invoke-CheckedCommand $gitCommand @('push') 'git push'
} else { Write-Host 'Commit y push omitidos.' }

Invoke-CheckedCommand $gitCommand @('status') 'git status final'
if (-not (Confirm-Step ('{0}Desplegar a producci{1}n en Vercel? [S/N]' -f $invertedQuestionMark, $lowercaseOAcute))) { Write-Host 'Despliegue a produccion omitido.'; exit 0 }
$vercelCommand = Get-ExecutablePath @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
$vercelOutput = Invoke-VercelProduction $vercelCommand
$urlMatches = [regex]::Matches(($vercelOutput -join "`n"), 'https://[^\s]+')
if ($urlMatches.Count -eq 0) { throw 'Vercel termino con codigo 0, pero no devolvio una URL reconocible.' }
$productionUrl = $urlMatches[$urlMatches.Count - 1].Value.TrimEnd('.', ',', ';')
Write-Host "URL FINAL DE PRODUCCION: $productionUrl"

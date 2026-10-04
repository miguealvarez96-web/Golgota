[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF
$lowercaseOAcute = [char]0x00F3

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label fallo con codigo $LASTEXITCODE."
  }
}

function Confirm-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt
  )

  return (Read-Host $Prompt).Trim().ToUpperInvariant() -eq 'S'
}

function Get-ExecutablePath {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Names,

    [Parameter(Mandatory = $true)]
    [string]$ErrorMessage
  )

  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
      return $command.Source
    }
  }

  throw $ErrorMessage
}

function Get-DatabaseState {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Query,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $output = @(& $script:PsqlCommand -X -v ON_ERROR_STOP=1 --tuples-only --no-align `
      --dbname $script:DatabaseUrl --command $Query)
  if ($LASTEXITCODE -ne 0) {
    throw "No fue posible consultar el estado de $Label (codigo $LASTEXITCODE)."
  }

  $state = ($output -join '').Trim()
  if ($state -notin @('missing', 'applied')) {
    throw "La consulta de estado de $Label devolvio un valor inesperado: '$state'."
  }

  return $state
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  Invoke-CheckedCommand -Command $script:PsqlCommand -Arguments @(
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '--dbname', $script:DatabaseUrl,
    '--file', $Path
  ) -Label $Label
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  throw 'SUPABASE_DB_URL no existe o esta vacia.'
}

$script:DatabaseUrl = $env:SUPABASE_DB_URL
$script:PsqlCommand = Get-ExecutablePath -Names @('psql') `
  -ErrorMessage 'psql no esta disponible en PATH.'
$gitCommand = Get-ExecutablePath -Names @('git') `
  -ErrorMessage 'git no esta disponible en PATH.'
$nodeCommand = Get-ExecutablePath -Names @('node') `
  -ErrorMessage 'node no esta disponible en PATH.'
$npxCommand = Get-ExecutablePath -Names @('npx.cmd', 'npx') `
  -ErrorMessage 'npx no esta disponible en PATH.'
$npmCommand = Get-ExecutablePath -Names @('npm.cmd', 'npm') `
  -ErrorMessage 'npm no esta disponible en PATH.'

$dryRunPath = Join-Path $projectRoot 'scripts\dry-run-pagos-completos-v1.ps1'
$portalMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261002_portal_alumno_v1.sql'
$portalPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261002_postflight_portal_alumno_v1.sql'
$blockMigrationPath = Join-Path $projectRoot 'supabase\migrations\20261004_pagos_completos_v1.sql'
$blockPostflightPath = Join-Path $projectRoot 'supabase\postflight\20261004_postflight_pagos_completos_v1.sql'

$requiredPaths = @(
  $dryRunPath,
  $portalMigrationPath,
  $portalPostflightPath,
  $blockMigrationPath,
  $blockPostflightPath
)
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "No se encontro el archivo requerido: $path"
  }
}

$repositoryRoot = (@(& $gitCommand rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0) {
  throw 'No fue posible identificar la raiz del repositorio Git.'
}
if ([System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne
    [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw "El script debe ejecutarse dentro del repositorio esperado: $projectRoot"
}

Write-Host 'Ejecutando dry-run reversible de PAGOS COMPLETOS...'
& $dryRunPath -DatabaseUrl $script:DatabaseUrl
if ($LASTEXITCODE -ne 0) {
  throw "El dry-run fallo con codigo $LASTEXITCODE."
}
Write-Host 'DRY-RUN CORRECTO'

if (-not (Confirm-Step ('{0}Aplicar SQL real? [S/N]' -f $invertedQuestionMark))) {
  Write-Host 'SQL real cancelado. No se aplicaron migraciones.'
  exit 0
}

$portalState = Get-DatabaseState `
  -Label 'Portal Alumno V1' `
  -Query "SELECT CASE WHEN to_regclass('public.reportes_pago_alumno') IS NULL THEN 'missing' ELSE 'applied' END"
$blockState = Get-DatabaseState `
  -Label 'BLOQUE 2 - PAGOS COMPLETOS' `
  -Query "SELECT CASE WHEN to_regprocedure('public.listar_reportes_pago_revision()') IS NULL THEN 'missing' ELSE 'applied' END"

if ($blockState -eq 'applied' -and $portalState -eq 'missing') {
  throw 'Estado inconsistente: BLOQUE 2 figura aplicado, pero Portal Alumno V1 no existe.'
}

if ($portalState -eq 'missing') {
  Write-Host 'Aplicando la migracion pendiente de Portal Alumno V1...'
  Invoke-PsqlFile -Path $portalMigrationPath -Label 'Migracion de Portal Alumno V1'
  Invoke-PsqlFile -Path $portalPostflightPath -Label 'Postflight de Portal Alumno V1'
} else {
  Write-Host 'Portal Alumno V1 ya esta aplicado; no se volvera a aplicar.'
}

if ($blockState -eq 'missing') {
  Write-Host 'Aplicando 20261004_pagos_completos_v1.sql...'
  Invoke-PsqlFile -Path $blockMigrationPath -Label 'Migracion de BLOQUE 2 - PAGOS COMPLETOS'
} else {
  Write-Host 'BLOQUE 2 - PAGOS COMPLETOS ya esta aplicado; no se volvera a aplicar.'
}

Write-Host 'Ejecutando postflight de BLOQUE 2 - PAGOS COMPLETOS...'
Invoke-PsqlFile -Path $blockPostflightPath -Label 'Postflight de BLOQUE 2 - PAGOS COMPLETOS'

Write-Host 'Ejecutando validaciones del proyecto...'
Invoke-CheckedCommand -Command $nodeCommand -Arguments @('--test', 'tests/*.test.cjs') `
  -Label 'Pruebas automatizadas'
Invoke-CheckedCommand -Command $npxCommand -Arguments @('tsc', '--noEmit') `
  -Label 'Validacion de TypeScript'
Invoke-CheckedCommand -Command $npmCommand -Arguments @('run', 'build') `
  -Label 'Build de produccion'
Invoke-CheckedCommand -Command $gitCommand -Arguments @('diff', '--check') `
  -Label 'git diff --check'

Invoke-CheckedCommand -Command $gitCommand -Arguments @('status') -Label 'git status'

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $blockFiles = @(
    'docs/CONTEXT.md',
    'docs/DECISIONS.md',
    'docs/ROADMAP.md',
    'scripts/cerrar-bloque-pagos.ps1',
    'scripts/dry-run-pagos-completos-v1.ps1',
    'src/app/(app)/pagos-reportados/actions.ts',
    'src/app/(app)/pagos-reportados/page.tsx',
    'src/components/alumnos/reported-payments-manager.tsx',
    'src/components/alumnos/student-dashboard.tsx',
    'src/lib/alumnos/model.ts',
    'supabase/migrations/20261004_pagos_completos_v1.sql',
    'supabase/postflight/20261004_postflight_pagos_completos_v1.sql',
    'supabase/preflight/20261004_preflight_pagos_completos_v1.sql',
    'supabase/rollback/20261004_rollback_pagos_completos_v1.sql',
    'tests/pagos-completos.test.cjs'
  )

  $alreadyStaged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) {
    throw 'No fue posible inspeccionar los archivos que ya estaban en staging.'
  }
  $foreignStaged = @($alreadyStaged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignStaged.Count -gt 0) {
    throw "Hay archivos ajenos al BLOQUE 2 en staging. Se aborta sin modificarlos: $($foreignStaged -join ', ')"
  }

  Invoke-CheckedCommand -Command $gitCommand -Arguments (@('add', '--') + $blockFiles) `
    -Label 'git add de archivos del BLOQUE 2'

  $stagedAfterAdd = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) {
    throw 'No fue posible verificar los archivos preparados para commit.'
  }
  $foreignAfterAdd = @($stagedAfterAdd | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreignAfterAdd.Count -gt 0) {
    throw "El staging contiene archivos ajenos al BLOQUE 2. Se aborta: $($foreignAfterAdd -join ', ')"
  }

  & $gitCommand diff --cached --quiet
  $stagedDiffExitCode = $LASTEXITCODE
  if ($stagedDiffExitCode -eq 0) {
    throw 'No hay cambios del BLOQUE 2 para confirmar.'
  }
  if ($stagedDiffExitCode -ne 1) {
    throw "No fue posible revisar el diff en staging (codigo $stagedDiffExitCode)."
  }

  Invoke-CheckedCommand -Command $gitCommand `
    -Arguments @('commit', '-m', 'feat: complete payments workflow') `
    -Label 'git commit'
  Invoke-CheckedCommand -Command $gitCommand -Arguments @('push') -Label 'git push'
} else {
  Write-Host 'Commit y push omitidos.'
}

Invoke-CheckedCommand -Command $gitCommand -Arguments @('status') -Label 'git status final'

if (-not (Confirm-Step ('{0}Desplegar a producci{1}n en Vercel? [S/N]' -f $invertedQuestionMark, $lowercaseOAcute))) {
  Write-Host 'Despliegue a produccion omitido.'
  exit 0
}

$vercelCommand = Get-ExecutablePath -Names @('vercel.cmd', 'vercel') `
  -ErrorMessage 'vercel no esta disponible en PATH.'
$vercelOutput = @(& $vercelCommand --prod 2>&1)
$vercelExitCode = $LASTEXITCODE
$vercelOutput | ForEach-Object { Write-Host $_ }
if ($vercelExitCode -ne 0) {
  throw "vercel --prod fallo con codigo $vercelExitCode."
}

$urlMatches = [regex]::Matches(($vercelOutput -join "`n"), 'https://[^\s]+')
if ($urlMatches.Count -eq 0) {
  throw 'Vercel termino correctamente, pero no devolvio una URL de produccion reconocible.'
}

$productionUrl = $urlMatches[$urlMatches.Count - 1].Value.TrimEnd('.', ',', ';')
Write-Host "URL FINAL DE PRODUCCION: $productionUrl"

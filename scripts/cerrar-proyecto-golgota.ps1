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
$powershellCommand = Get-ExecutablePath @('pwsh.exe', 'powershell.exe', 'pwsh', 'powershell') 'PowerShell no esta disponible en PATH.'
$checklistPath = Join-Path $projectRoot 'scripts\verificar-produccion.ps1'
if (-not (Test-Path -LiteralPath $checklistPath -PathType Leaf)) { throw "Falta el checklist: $checklistPath" }

$repositoryRoot = (@(& $gitCommand rev-parse --show-toplevel) -join '').Trim()
if ($LASTEXITCODE -ne 0 -or [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') -ne [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')) {
  throw 'El script no se esta ejecutando en el repositorio esperado.'
}

$statusLines = @(& $gitCommand status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar el estado Git.' }
$sqlChanges = @($statusLines | Where-Object { $_ -match 'supabase/.*\.sql(?:$|"| -> )' })
if ($sqlChanges.Count -gt 0) {
  throw "Se detecto SQL nuevo o modificado inesperado. El BLOQUE FINAL no lo aplicara: $($sqlChanges -join ', ')"
}

Write-Host 'Ejecutando validaciones finales de GOLGOTA...'
Invoke-CheckedCommand $nodeCommand @('--test', 'tests/*.test.cjs') 'Pruebas automatizadas'
Invoke-CheckedCommand $npxCommand @('tsc', '--noEmit') 'Validacion de TypeScript'
Invoke-CheckedCommand $npmCommand @('run', 'build') 'Build de produccion'
Invoke-CheckedCommand $gitCommand @('diff', '--check') 'git diff --check'
Invoke-CheckedCommand $powershellCommand @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $checklistPath) 'Checklist de produccion'
Invoke-CheckedCommand $gitCommand @('status') 'git status'

$blockFiles = @(
  'docs/CONTEXT.md', 'docs/DECISIONS.md', 'docs/ESTADO-FINAL.md', 'docs/ROADMAP.md',
  'scripts/cerrar-proyecto-golgota.ps1', 'scripts/verificar-produccion.ps1',
  'src/app/(app)/error.tsx', 'src/app/(auth)/login/page.tsx',
  'src/app/(auth)/reset-password/page.tsx', 'src/app/(student)/error.tsx',
  'src/app/(student)/layout.tsx', 'src/app/(student)/loading.tsx', 'src/app/not-found.tsx',
  'src/components/layout/portal-navigation.tsx', 'src/components/layout/route-error.tsx',
  'tests/auth.test.cjs', 'tests/coaches.test.cjs', 'tests/privacidad.test.cjs',
  'tests/produccion.test.cjs', 'tests/reportes.test.cjs'
)

if (Confirm-Step ('{0}Hacer commit y push? [S/N]' -f $invertedQuestionMark)) {
  $alreadyStaged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar staging.' }
  $foreign = @($alreadyStaged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Hay archivos ajenos en staging: $($foreign -join ', ')" }
  Invoke-CheckedCommand $gitCommand (@('add', '--') + $blockFiles) 'git add del BLOQUE FINAL'
  $staged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar staging.' }
  $foreign = @($staged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Staging contiene archivos ajenos: $($foreign -join ', ')" }
  & $gitCommand diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios del BLOQUE FINAL para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No se pudo comprobar el diff en staging.' }
  Invoke-CheckedCommand $gitCommand @('commit', '-m', 'chore: finalize production readiness') 'git commit'
  Invoke-CheckedCommand $gitCommand @('push') 'git push'
} else {
  Write-Host 'Commit y push omitidos.'
}

Invoke-CheckedCommand $gitCommand @('status') 'git status final'
if (-not (Confirm-Step ('{0}Desplegar a producci{1}n en Vercel? [S/N]' -f $invertedQuestionMark, $lowercaseOAcute))) {
  Write-Host 'Despliegue a produccion omitido.'
  Invoke-CheckedCommand $powershellCommand @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $checklistPath) 'Checklist final'
  exit 0
}

$vercelCommand = Get-ExecutablePath @('vercel.cmd', 'vercel') 'vercel no esta disponible en PATH.'
$vercelOutput = Invoke-VercelProduction $vercelCommand
$urlMatches = [regex]::Matches(($vercelOutput -join "`n"), 'https://[^\s]+')
if ($urlMatches.Count -eq 0) { throw 'Vercel termino con codigo 0, pero no devolvio una URL reconocible.' }
$productionUrl = $urlMatches[$urlMatches.Count - 1].Value.TrimEnd('.', ',', ';')
Write-Host "URL FINAL DE PRODUCCION: $productionUrl"
Invoke-CheckedCommand $powershellCommand @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $checklistPath) 'Checklist final'

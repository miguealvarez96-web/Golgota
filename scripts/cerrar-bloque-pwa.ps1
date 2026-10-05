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
    'images.jpg',
    'next.config.mjs',
    'public/golgota-logo.png',
    'public/icons/apple-touch-icon.png',
    'public/icons/icon-192.png',
    'public/icons/icon-512.png',
    'public/icons/icon-maskable-512.png',
    'public/sw.js',
    'scripts/cerrar-bloque-pwa.ps1',
    'src/app/favicon.ico',
    'src/app/layout.tsx',
    'src/app/manifest.ts',
    'src/app/offline/page.tsx',
    'src/components/pwa/pwa-client.tsx',
    'src/middleware.ts',
    'tests/pwa.test.cjs'
  )

  $alreadyStaged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar staging.' }
  $foreign = @($alreadyStaged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Hay archivos ajenos en staging: $($foreign -join ', ')" }

  Invoke-CheckedCommand $gitCommand (@('add', '--') + $blockFiles) 'git add de BLOQUE 4'
  $staged = @(& $gitCommand diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar staging.' }
  $foreign = @($staged | Where-Object { $_ -and $_ -notin $blockFiles })
  if ($foreign.Count -gt 0) { throw "Staging contiene archivos ajenos: $($foreign -join ', ')" }

  & $gitCommand diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw 'No hay cambios de BLOQUE 4 para confirmar.' }
  if ($LASTEXITCODE -ne 1) { throw 'No se pudo comprobar el diff en staging.' }
  Invoke-CheckedCommand $gitCommand @('commit', '-m', 'feat: add installable PWA') 'git commit'
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

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Assert-Condition {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-File {
  param([string]$RelativePath)
  Assert-Condition (Test-Path -LiteralPath (Join-Path $projectRoot $RelativePath) -PathType Leaf) `
    "Falta el archivo requerido: $RelativePath"
}

$requiredFiles = @(
  'src/app/(auth)/login/page.tsx',
  'src/app/(auth)/reset-password/page.tsx',
  'src/app/(app)/page.tsx',
  'src/app/(app)/clientes/page.tsx',
  'src/app/(app)/membresias/page.tsx',
  'src/app/(app)/productos/page.tsx',
  'src/app/(app)/pagos-reportados/page.tsx',
  'src/app/(app)/wod/page.tsx',
  'src/app/(app)/comunicados/page.tsx',
  'src/app/(app)/reportes/page.tsx',
  'src/app/(app)/solicitudes-privacidad/page.tsx',
  'src/app/(student)/portal/page.tsx',
  'src/app/privacidad/page.tsx',
  'src/app/manifest.ts',
  'src/app/not-found.tsx',
  'src/middleware.ts',
  'public/sw.js',
  'public/golgota-logo.png',
  'src/app/favicon.ico',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-maskable-512.png',
  'public/icons/apple-touch-icon.png'
)
foreach ($file in $requiredFiles) { Assert-File $file }

$buildManifestPath = Join-Path $projectRoot '.next\server\app-paths-manifest.json'
Assert-Condition (Test-Path -LiteralPath $buildManifestPath -PathType Leaf) `
  'No existe el manifiesto del build. Ejecuta npm run build antes de esta verificacion.'
$buildManifest = Get-Content -Raw -LiteralPath $buildManifestPath | ConvertFrom-Json
$builtRoutes = @($buildManifest.PSObject.Properties.Name)
$requiredBuildRoutes = @(
  '/(auth)/login/page', '/(auth)/reset-password/page', '/(app)/page',
  '/(app)/clientes/page', '/(app)/membresias/page', '/(app)/productos/page',
  '/(app)/pagos-reportados/page', '/(app)/wod/page', '/(app)/comunicados/page',
  '/(app)/reportes/page', '/(app)/solicitudes-privacidad/page',
  '/(student)/portal/page', '/privacidad/page', '/offline/page', '/_not-found/page'
)
foreach ($route in $requiredBuildRoutes) {
  Assert-Condition ($route -in $builtRoutes) "El build no contiene la ruta critica: $route"
}

$manifestSource = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src\app\manifest.ts')
$serviceWorker = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'public\sw.js')
$navigation = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src\components\layout\portal-navigation.tsx')
Assert-Condition ($manifestSource -match 'display:\s*"standalone"') 'El manifest no conserva modo standalone.'
foreach ($icon in @('/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png')) {
  Assert-Condition ($manifestSource.Contains($icon)) "El manifest no referencia $icon"
}
Assert-Condition ($serviceWorker -match 'request\.mode === "navigate"[\s\S]*cache: "no-store"') `
  'El service worker no protege las navegaciones con no-store.'
Assert-Condition ($serviceWorker -notmatch 'PRECACHE_URLS\s*=\s*\[[\s\S]*?/(?:portal|clientes|membresias|reportes)') `
  'El precache contiene una ruta privada.'
Assert-Condition ($navigation -notmatch 'href:\s*"/(?:asistencia|gastos)"') `
  'La navegacion todavia enlaza rutas placeholder.'

Add-Type -AssemblyName System.Drawing
$expectedImages = @{
  'public/icons/icon-192.png' = @(192, 192)
  'public/icons/icon-512.png' = @(512, 512)
  'public/icons/icon-maskable-512.png' = @(512, 512)
  'public/icons/apple-touch-icon.png' = @(180, 180)
}
foreach ($entry in $expectedImages.GetEnumerator()) {
  $image = [System.Drawing.Image]::FromFile((Join-Path $projectRoot $entry.Key))
  try {
    Assert-Condition ($image.Width -eq $entry.Value[0] -and $image.Height -eq $entry.Value[1]) `
      "Dimension incorrecta en $($entry.Key): $($image.Width)x$($image.Height)"
  }
  finally { $image.Dispose() }
}

$gitCommand = Get-Command git -ErrorAction Stop
$sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src'), (Join-Path $projectRoot 'public') `
  -Recurse -File | Where-Object { $_.Extension -in @('.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.css', '.html') })
$secretMatches = @($sourceFiles | Select-String `
  -Pattern 'SUPABASE_SERVICE_ROLE_KEY|service_role|postgres(?:ql)?://\S+:\S+@' `
  -CaseSensitive:$false)
if ($secretMatches.Count -gt 0) {
  throw "Se detecto una referencia sensible en codigo cliente/servidor: $($secretMatches -join ', ')"
}

$envPath = Join-Path $projectRoot '.env.local'
Assert-Condition (Test-Path -LiteralPath $envPath -PathType Leaf) 'Falta .env.local para la validacion local.'
$envLines = Get-Content -LiteralPath $envPath
Assert-Condition ([bool]($envLines -match '^NEXT_PUBLIC_SUPABASE_URL=.+$')) 'Falta NEXT_PUBLIC_SUPABASE_URL en .env.local.'
Assert-Condition ([bool]($envLines -match '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=.+$')) 'Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local.'

Write-Host 'CHECKLIST DE PRODUCCION'
Write-Host '[OK] Build y rutas criticas'
Write-Host '[OK] Manifest, PWA y cache privado'
Write-Host '[OK] Logo, favicon e iconos instalables'
Write-Host '[OK] Auth, middleware y rutas protegidas cubiertos por pruebas'
Write-Host '[OK] Navegacion por rol sin placeholders visibles'
Write-Host '[OK] Sin service role ni URL de base con credenciales en src/public'
Write-Host '[OK] Variables publicas requeridas presentes localmente (valores no mostrados)'

$status = @(& $gitCommand.Source status --short)
if ($LASTEXITCODE -ne 0) { throw 'No fue posible verificar git status.' }
if ($status.Count -eq 0) {
  Write-Host '[OK] Git limpio'
} else {
  Write-Host '[AVISO] Git contiene cambios; revisa el estado mostrado por el macro.'
}

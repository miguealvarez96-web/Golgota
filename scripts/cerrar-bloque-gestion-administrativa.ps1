[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$invertedQuestionMark = [char]0x00BF

function Find-Command([string[]]$Names,[string]$Message) {
  foreach ($name in $Names) { $command = Get-Command $name -ErrorAction SilentlyContinue; if ($null -ne $command) { return $command.Source } }
  throw $Message
}
function Invoke-Checked([string]$Command,[string[]]$Arguments,[string]$Label) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label falló con código $LASTEXITCODE." }
}
function Confirm-Step([string]$Prompt) { return (Read-Host $Prompt).Trim().ToUpperInvariant() -eq 'S' }
function Invoke-Sql([string]$Path,[string]$Label){Invoke-Checked $script:Psql @('-X','-v','ON_ERROR_STOP=1','--dbname',$script:DatabaseUrl,'--file',$Path) $Label}
function Get-State {
  $query=@"
SELECT CASE
  WHEN to_regprocedure('public.gestionar_producto_seguro(uuid,text)') IS NOT NULL
   AND to_regprocedure('public.gestionar_membresia_segura(uuid,text)') IS NOT NULL
   AND to_regprocedure('public.anular_gasto_seguro(uuid)') IS NOT NULL
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wods' AND column_name='archivado')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='comunicados' AND column_name='archivado')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='desafios' AND column_name='archivado')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reportes_pago_alumno' AND column_name='cancelado_por')
   AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reportes_pago_alumno' AND column_name='cancelado_at')
   AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='estado_reporte_pago_enum' AND e.enumlabel='CANCELADO')
    THEN 'applied'
  WHEN to_regprocedure('public.gestionar_producto_seguro(uuid,text)') IS NULL
   AND to_regprocedure('public.gestionar_membresia_segura(uuid,text)') IS NULL
   AND to_regprocedure('public.anular_gasto_seguro(uuid)') IS NULL
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wods' AND column_name='archivado')
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='comunicados' AND column_name='archivado')
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='desafios' AND column_name='archivado')
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reportes_pago_alumno' AND column_name='cancelado_por')
   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reportes_pago_alumno' AND column_name='cancelado_at')
   AND NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='estado_reporte_pago_enum' AND e.enumlabel='CANCELADO')
    THEN 'missing'
  ELSE 'partial' END;
"@
  $result=(@(& $script:Psql -X -v ON_ERROR_STOP=1 --tuples-only --no-align --dbname $script:DatabaseUrl --command $query)-join '').Trim()
  if ($LASTEXITCODE -ne 0 -or $result -notin @('missing','applied','partial')) { throw 'No se pudo determinar el estado del bloque.' }
  return $result
}

$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)){throw 'SUPABASE_DB_URL no existe o está vacía.'}
$script:DatabaseUrl=$env:SUPABASE_DB_URL
$script:Psql=Find-Command @('psql') 'psql no está disponible en PATH.'
$git=Find-Command @('git') 'git no está disponible en PATH.'
$npm=Find-Command @('npm.cmd','npm') 'npm no está disponible en PATH.'
$npx=Find-Command @('npx.cmd','npx') 'npx no está disponible en PATH.'
$preflight=Join-Path $projectRoot 'supabase\preflight\20261013_gestion_administrativa_segura.sql'
$migration=Join-Path $projectRoot 'supabase\migrations\20261013_gestion_administrativa_segura.sql'
$postflight=Join-Path $projectRoot 'supabase\postflight\20261013_gestion_administrativa_segura.sql'
$dryRun=Join-Path $projectRoot 'scripts\dry-run-gestion-administrativa-segura.ps1'

$state=Get-State
if ($state -eq 'partial') { throw 'El bloque está parcialmente aplicado; se requiere revisión manual.' }
if ($state -eq 'missing') {
  Invoke-Sql $preflight 'Preflight administrativo'
  & $dryRun -DatabaseUrl $script:DatabaseUrl
  if ($LASTEXITCODE -ne 0) { throw "El dry-run falló con código $LASTEXITCODE." }
  if(-not(Confirm-Step ('{0}Aplicar SQL real de gestión administrativa? [S/N]'-f $invertedQuestionMark))){Write-Host 'SQL real cancelado.';exit 0}
  Invoke-Sql $migration 'Migración administrativa'
}else{Write-Host 'La migración ya estaba aplicada; no se repetirá.'}
Invoke-Sql $postflight 'Postflight administrativo'

Invoke-Checked $npm @('test') 'Pruebas automatizadas'
Invoke-Checked $npx @('tsc','--noEmit') 'TypeScript'
Invoke-Checked $npm @('run','build') 'Build'
Invoke-Checked $git @('diff','--check') 'git diff --check'
Invoke-Checked $git @('status') 'git status'

$blockFiles=@(
  'scripts/cerrar-bloque-gestion-administrativa.ps1','scripts/dry-run-gestion-administrativa-segura.ps1',
  'supabase/preflight/20261013_gestion_administrativa_segura.sql','supabase/migrations/20261013_gestion_administrativa_segura.sql',
  'supabase/postflight/20261013_gestion_administrativa_segura.sql','supabase/rollback/20261013_gestion_administrativa_segura.sql',
  'src/app/(app)/clientes/actions.ts','src/app/(app)/clientes/page.tsx','src/components/clientes/clients-manager.tsx','src/lib/clientes/model.ts',
  'src/app/(app)/membresias/actions.ts','src/app/(app)/membresias/page.tsx','src/app/(app)/membresias/[id]/page.tsx','src/components/membresias/membership-lifecycle-actions.tsx','src/lib/membresias/grouping.ts',
  'src/app/(app)/productos/actions.ts','src/components/productos/products-manager.tsx',
  'src/app/(app)/inventario/actions.ts','src/components/inventario/inventory-manager.tsx',
  'src/app/(app)/gastos/actions.ts','src/app/(app)/gastos/page.tsx','src/components/gastos/expenses-manager.tsx','src/lib/gastos/data.ts',
  'src/app/(app)/pagos-reportados/actions.ts','src/components/alumnos/reported-payments-manager.tsx','src/components/alumnos/student-dashboard.tsx','src/lib/alumnos/model.ts',
  'src/app/(app)/wod/actions.ts','src/app/(app)/wod/page.tsx','src/components/coaches/wod-manager.tsx',
  'src/app/(app)/desafios/actions.ts','src/app/(app)/desafios/page.tsx','src/components/coaches/challenge-manager.tsx','src/lib/deportivo/data.ts',
  'src/app/(app)/comunicados/actions.ts','src/app/(app)/comunicados/page.tsx','src/components/coaches/announcements-manager.tsx','src/lib/coaches/model.ts',
  'src/app/(app)/usuarios/actions.ts','src/app/(app)/usuarios/page.tsx','src/components/usuarios-internos/internal-users-manager.tsx',
  'tests/clientes.test.cjs','tests/gestion-administrativa-segura.test.cjs',
  'scripts/dry-run-eliminacion-segura-clientes.ps1',
  'supabase/preflight/20261013_preflight_eliminacion_segura_clientes.sql',
  'supabase/migrations/20261013_eliminacion_segura_clientes.sql',
  'supabase/postflight/20261013_postflight_eliminacion_segura_clientes.sql',
  'supabase/rollback/20261013_rollback_eliminacion_segura_clientes.sql'
)

if(Confirm-Step ('{0}Hacer commit y push? [S/N]'-f $invertedQuestionMark)){
  $stagedBefore=@(& $git diff --cached --name-only)
  $foreignStaged=@($stagedBefore|Where-Object{$_-and $_-notin $blockFiles})
  if ($foreignStaged.Count -gt 0) { throw "Staging contiene cambios ajenos: $($foreignStaged -join ', ')" }
  Invoke-Checked $git (@('add','--')+$blockFiles) 'git add'
  Invoke-Checked $git @('commit','-m','feat: add safe administrative lifecycle controls') 'git commit'
  Invoke-Checked $git @('push') 'git push'
}else{Write-Host 'Commit/push omitidos.'}

if(-not(Confirm-Step ('{0}Desplegar a producción? [S/N]'-f $invertedQuestionMark))){Write-Host 'Deploy omitido.';exit 0}
$vercel=Find-Command @('vercel.cmd','vercel') 'vercel no está disponible en PATH.'
$stdout=[System.IO.Path]::GetTempFileName();$stderr=[System.IO.Path]::GetTempFileName()
try{
  $process=Start-Process -FilePath $vercel -ArgumentList @('--prod') -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  Get-Content -LiteralPath $stdout;Get-Content -LiteralPath $stderr
  if ($process.ExitCode -ne 0) { throw "Deploy falló con código $($process.ExitCode)." }
}finally{Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue}

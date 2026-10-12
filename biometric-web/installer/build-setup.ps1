# Builds BiometricAttendance_Setup.exe (no data included: a fresh install starts with the machines KE1, KE2 and b4).
#   powershell -ExecutionPolicy Bypass -File build-setup.ps1 [-Out <exe path>]
param([string]$Out = (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'BiometricAttendance_Setup.exe'))
$ErrorActionPreference = 'Stop'
$inst = $PSScriptRoot
$proj = Split-Path -Parent $inst
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$build = Join-Path $env:TEMP ('ba_build_' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $build 'BiometricAttendance'
New-Item -ItemType Directory -Force (Join-Path $stage 'node'), (Join-Path $stage 'app') | Out-Null
try {
  Write-Host '1/5 Running the protocol tests'
  Push-Location $proj; & $node tools/zk-test.mjs | Out-Host; $failed = $LASTEXITCODE; Pop-Location
  if ($failed) { throw 'Protocol tests failed' }
  Write-Host '2/5 Copying Node.js and the app'
  Copy-Item $node (Join-Path $stage 'node')
  foreach ($item in 'server.mjs', 'package.json', 'lib', 'public') { Copy-Item (Join-Path $proj $item) (Join-Path $stage 'app') -Recurse }
  if (-not (Test-Path (Join-Path $inst 'app.ico'))) { & (Join-Path $inst 'make-icon.ps1') | Out-Host }
  foreach ($f in 'Biometric Attendance.cmd', 'uninstall.ps1', 'README.txt', 'app.ico') { Copy-Item (Join-Path $inst $f) $stage }
  Write-Host '3/5 Compressing'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = Join-Path $build 'payload.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
  Write-Host '4/5 Compiling Setup.exe'
  $stub = Join-Path $build 'stub.exe'
  & $csc /nologo /target:winexe /platform:anycpu /optimize+ "/out:$stub" "/win32icon:$inst\app.ico" "/win32manifest:$inst\setup.manifest" "/resource:$inst\install.ps1,install.ps1" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $inst 'SetupStub.cs') | Out-Host
  if ($LASTEXITCODE) { throw 'Compiling the setup program failed' }
  Write-Host '5/5 Writing' $Out
  $fs = [IO.File]::Create($Out)
  try { $b = [IO.File]::ReadAllBytes($stub); $fs.Write($b, 0, $b.Length); $p = [IO.File]::OpenRead($zip); $len = $p.Length; $p.CopyTo($fs); $p.Close()
    $fs.Write([Text.Encoding]::ASCII.GetBytes('BASETUP1'), 0, 8); $fs.Write([BitConverter]::GetBytes([int64]$len), 0, 8) } finally { $fs.Close() }
  Write-Host ('Done: {0} ({1:N1} MB)' -f $Out, ((Get-Item $Out).Length / 1MB))
} finally {
  if (Test-Path $build) { Remove-Item -LiteralPath $build -Recurse -Force -ErrorAction SilentlyContinue }
}

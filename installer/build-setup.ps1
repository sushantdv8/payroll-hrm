# Build the self-contained Windows x64 installer from this checkout.
param(
  [string]$Out = (Join-Path (Split-Path -Parent $PSScriptRoot) 'PayrollWorkspace_Setup.exe'),
  [string]$NodePath,
  [string]$DataPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime-data'),
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$inst = $PSScriptRoot
$proj = Join-Path (Split-Path -Parent $inst) 'payroll-web'
if (-not $NodePath) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodePath = $nodeCommand.Source }
  else { $NodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
}
if (-not (Test-Path -LiteralPath $NodePath)) { throw 'Provide -NodePath pointing to Node.js 24 for Windows x64.' }
$runtime = & $NodePath -p 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})' | ConvertFrom-Json
if ($runtime.platform -ne 'win32' -or $runtime.arch -ne 'x64' -or [version]$runtime.version.TrimStart('v') -lt [version]'24.0.0') { throw 'Packaging requires Windows x64 Node.js 24 or newer.' }
foreach ($stateName in 'state', 'editable-state') {
  if (-not (Test-Path (Join-Path $DataPath $stateName))) { throw "Current $stateName is missing in $DataPath. No old data will be substituted." }
}
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'The Windows .NET Framework C# compiler was not found.' }
$build = Join-Path $env:TEMP ('pw_build_' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $build 'PayrollWorkspace'
New-Item -ItemType Directory -Force (Join-Path $stage 'node'), (Join-Path $stage 'app') | Out-Null
try {
  if (-not $SkipBuild) {
    Write-Host '1/6 Building the app (close the source app before building)'
    Push-Location $proj
    try { & $NodePath scripts/run-framework.mjs build | Out-Host; if ($LASTEXITCODE) { throw 'App build failed' } } finally { Pop-Location }
  }
  foreach ($file in 'server\index.js', 'server\wrangler.json', 'client') { if (-not (Test-Path (Join-Path $proj "dist\$file"))) { throw "Built app is missing: $file" } }
  Write-Host '2/6 Copying the bundled runtime and app'
  Copy-Item -LiteralPath $NodePath -Destination (Join-Path $stage 'node\node.exe')
  Copy-Item -LiteralPath (Join-Path $inst 'Node-LICENSE.txt') -Destination (Join-Path $stage 'node\LICENSE.txt')
  Copy-Item -LiteralPath (Join-Path $proj 'dist') -Destination (Join-Path $stage 'app\dist') -Recurse
  foreach ($cache in 'server\.wrangler', 'server\.vite') {
    $cachePath = [IO.Path]::GetFullPath((Join-Path $stage "app\dist\$cache"))
    if (-not $cachePath.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe build cache path' }
    if (Test-Path $cachePath) { Remove-Item -LiteralPath $cachePath -Recurse -Force }
  }
  & $NodePath (Join-Path $inst 'collect-deps.mjs') $proj (Join-Path $stage 'app') wrangler | Out-Host
  if ($LASTEXITCODE) { throw 'Runtime dependency collection failed' }
  $workerd = Get-ChildItem (Join-Path $stage 'app\node_modules\@cloudflare\workerd-windows-64') -Recurse -Filter workerd.exe | Select-Object -First 1
  if (-not $workerd) { throw 'Windows x64 workerd runtime was not copied' }
  foreach ($dll in 'msvcp140.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140.dll', 'vcruntime140_1.dll') { Copy-Item -LiteralPath (Join-Path $env:WINDIR "System32\$dll") -Destination $workerd.DirectoryName }
  foreach ($file in 'launcher.mjs', 'login-gate.mjs', 'snapshot-state.cjs', 'Payroll Workspace.cmd', 'uninstall.ps1', 'README.txt', 'app.ico') { Copy-Item -LiteralPath (Join-Path $inst $file) -Destination $stage }
  # The Biometric Attendance app travels inside this setup (run by the launcher with the same Node.js), so one setup does everything.
  $bio = Join-Path (Split-Path -Parent $inst) 'biometric-web'
  New-Item -ItemType Directory -Force (Join-Path $stage 'biometric') | Out-Null
  foreach ($item in 'server.mjs', 'package.json', 'lib', 'public') { Copy-Item -LiteralPath (Join-Path $bio $item) -Destination (Join-Path $stage 'biometric') -Recurse }
  Write-Host '   Biometric protocol tests'
  Push-Location $bio; try { & $NodePath tools/zk-test.mjs | Out-Host; if ($LASTEXITCODE) { throw 'Biometric protocol tests failed' } } finally { Pop-Location }
  Write-Host '3/6 Snapshotting BOTH current workspaces'
  foreach ($stateName in 'state', 'editable-state') {
    & $NodePath (Join-Path $inst 'snapshot-state.cjs') (Join-Path $DataPath $stateName) (Join-Path $stage "initial-data\$stateName") | Out-Host
    if ($LASTEXITCODE) { throw "Snapshot of $stateName failed" }
  }
  $bytes = (Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum
  @{ version = '2.0.0'; builtAt = [DateTime]::UtcNow.ToString('o'); platform = 'windows-x64'; node = $runtime.version; expandedBytes = $bytes; dataIncluded = $true; workspaces = @('state','editable-state') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'package-info.json') -Encoding UTF8
  Write-Host '4/6 Compressing'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = Join-Path $build 'payload.zip'
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
  Write-Host '5/6 Compiling Setup.exe'
  $stub = Join-Path $build 'stub.exe'
  & $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$stub" "/win32icon:$inst\app.ico" "/win32manifest:$inst\setup.manifest" "/resource:$inst\install.ps1,install.ps1" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $inst 'SetupStub.cs') | Out-Host
  if ($LASTEXITCODE) { throw 'Compiling the setup program failed' }
  Write-Host '6/6 Writing' $Out
  $Out = [IO.Path]::GetFullPath($Out)
  New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
  $hashStream = [IO.File]::OpenRead($zip)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $payloadHash = $hasher.ComputeHash($hashStream) } finally { $hashStream.Close(); $hasher.Dispose() }
  $fs = [IO.File]::Create($Out)
  try {
    $stubBytes = [IO.File]::ReadAllBytes($stub); $fs.Write($stubBytes, 0, $stubBytes.Length)
    $payload = [IO.File]::OpenRead($zip)
    try { $len = $payload.Length; $payload.CopyTo($fs) } finally { $payload.Close() }
    $fs.Write([Text.Encoding]::ASCII.GetBytes('PWSETUP2'), 0, 8)
    $fs.Write([BitConverter]::GetBytes([int64]$len), 0, 8)
    $fs.Write($payloadHash, 0, $payloadHash.Length)
  } finally { $fs.Close() }
  Write-Host ('Done: {0} ({1:N1} MB)' -f $Out, ((Get-Item $Out).Length / 1MB))
} finally {
  $resolvedBuild = [IO.Path]::GetFullPath($build)
  if ($resolvedBuild.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\pw_build_', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path $resolvedBuild)) { Remove-Item -LiteralPath $resolvedBuild -Recurse -Force -ErrorAction SilentlyContinue }
}

# Per-user installation. Existing normal AND editable data are never replaced.
param([switch]$Test, [string]$TestRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.IO.Compression.FileSystem
$title = 'Payroll Workspace Setup'
$form = $null; $label = $null; $work = $null; $previous = $null; $swapped = $false
function Show($text, $buttons = 'OK', $icon = 'Information') {
  if ($Test) { Write-Host $text; if ($buttons -eq 'YesNo') { return 'No' }; return 'OK' }
  [System.Windows.Forms.MessageBox]::Show($text, $title, $buttons, $icon)
}
function RemoveWithin([string]$path, [string]$parent) {
  $resolved = [IO.Path]::GetFullPath($path)
  $boundary = [IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe cleanup path: $resolved" }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
function Step($text) {
  Write-Host $text
  if ($label) { $label.Text = "Installing Payroll Workspace...`n`n$text"; $form.Refresh(); [System.Windows.Forms.Application]::DoEvents() }
}
function MoveDirectory([string]$source, [string]$target) {
  # Allow just-checked executable/DLL handles and antivirus scanning to settle.
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { [IO.Directory]::Move($source, $target); return }
    catch { if ($attempt -eq 19) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
try {
  if ($Test -and (-not $TestRoot -or -not [IO.Path]::IsPathRooted($TestRoot))) { throw 'A full -TestRoot path is required.' }
  $local = [IO.Path]::GetFullPath($(if ($Test) { $TestRoot } else { $env:LOCALAPPDATA }))
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if (-not [Environment]::Is64BitOperatingSystem -or $architecture -ne 'AMD64' -or [Environment]::OSVersion.Version.Major -lt 10) { throw 'Payroll Workspace needs Windows 10 or 11 on an Intel/AMD 64-bit computer.' }
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $zip = Join-Path $here 'payload.zip'
  $programs = Join-Path $local 'Programs'
  $dest = Join-Path $programs 'PayrollWorkspace'
  $data = Join-Path $local 'PayrollWorkspace'
  $firstInstall = -not (Test-Path (Join-Path $data 'state'))
  $msg = if ($firstInstall) { "Install Payroll Workspace with the current company data and its separate editable workspace?`n`nProgram: $dest`nData: $data`n`nRequired configuration is automatic." } else { "Update Payroll Workspace?`n`nYour existing original and editable data in $data will be kept." }
  if ((Show $msg 'OKCancel' 'Question') -ne 'OK') { exit 0 }
  if (-not $Test) {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $title; $form.Width = 460; $form.Height = 150; $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'; $form.ControlBox = $false; $form.TopMost = $true
    $label = New-Object System.Windows.Forms.Label
    $label.Dock = 'Fill'; $label.TextAlign = 'MiddleCenter'; $label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $form.Controls.Add($label); $form.Show(); [System.Windows.Forms.Application]::DoEvents()
  }
  Step 'Unpacking the application and bundled runtime'
  $work = Join-Path $env:TEMP ('PayrollWorkspaceFiles_' + [Guid]::NewGuid().ToString('N'))
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $work)
  $src = Join-Path $work 'PayrollWorkspace'
  foreach ($file in 'node\node.exe', 'app\dist\server\wrangler.json', 'app\node_modules\wrangler\bin\wrangler.js', 'initial-data\state', 'initial-data\editable-state', 'launcher.mjs', 'biometric\server.mjs', 'package-info.json') {
    if (-not (Test-Path (Join-Path $src $file))) { throw "The setup is incomplete: $file" }
  }
  $info = Get-Content -LiteralPath (Join-Path $src 'package-info.json') -Raw | ConvertFrom-Json
  $drive = New-Object IO.DriveInfo -ArgumentList ([IO.Path]::GetPathRoot($local))
  if ($drive.AvailableFreeSpace -lt ([int64]$info.expandedBytes + 100MB)) { throw 'Not enough free disk space to install Payroll Workspace.' }
  Step 'Checking the bundled runtime'
  $node = Join-Path $src 'node\node.exe'
  & $node -e "if(process.platform!=='win32'||process.arch!=='x64')process.exit(1)" | Out-Host
  if ($LASTEXITCODE) { throw 'The bundled Node.js runtime could not start.' }
  $workerd = Get-ChildItem (Join-Path $src 'app\node_modules\@cloudflare\workerd-windows-64') -Filter workerd.exe -Recurse | Select-Object -First 1
  if (-not $workerd) { throw 'The local database runtime is missing.' }
  & $workerd.FullName --version | Out-Host
  if ($LASTEXITCODE) { throw 'The bundled local server runtime could not start.' }
  Step 'Preparing data folders (existing records are kept)'
  New-Item -ItemType Directory -Force $data, $programs | Out-Null
  foreach ($stateName in 'state', 'editable-state') {
    $targetState = Join-Path $data $stateName
    if (-not (Test-Path -LiteralPath $targetState)) {
      # Upgrade from an older single-workspace version: clone ITS current data.
      if ($stateName -eq 'editable-state' -and -not $firstInstall) {
        & $node (Join-Path $src 'snapshot-state.cjs') (Join-Path $data 'state') $targetState | Out-Host
        if ($LASTEXITCODE) { throw 'The separate editable data copy could not be created.' }
      } else { Move-Item -LiteralPath (Join-Path $src "initial-data\$stateName") -Destination $targetState }
    }
  }
  RemoveWithin (Join-Path $src 'initial-data') $work
  foreach ($folder in 'config', 'registry', 'logs') { New-Item -ItemType Directory -Force (Join-Path $data $folder) | Out-Null }
  Step 'Installing the application'
  # Only processes launched from this exact installation directory are stopped.
  $consoleScript = Join-Path $dest 'Payroll Workspace.cmd'
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($consoleScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-Process node, workerd -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest + '\', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $dest) {
    Start-Sleep -Milliseconds 800
    $previous = Join-Path $programs ('PayrollWorkspace.previous-' + [Guid]::NewGuid().ToString('N'))
    MoveDirectory $dest $previous
  }
  MoveDirectory $src $dest
  $swapped = $true
  Step 'Creating desktop and Start menu shortcuts'
  $shell = New-Object -ComObject WScript.Shell
  $icon = Join-Path $dest 'app.ico'
  $links = if ($Test) { @((Join-Path $local 'Payroll Workspace.lnk')) } else { @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Payroll Workspace.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Payroll Workspace.lnk')) }
  foreach ($path in $links) {
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $link.Arguments = '/c ""' + (Join-Path $dest 'Payroll Workspace.cmd') + '""'
    $link.WorkingDirectory = $dest; $link.WindowStyle = 7; $link.IconLocation = "$icon,0"
    $link.Description = 'Payroll Workspace - attendance, salary and monthly Excel reports'; $link.Save()
  }
  if (-not $Test) {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PayrollWorkspace'
    New-Item -Path $key -Force | Out-Null
    $size = [int]((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
    $values = @{ DisplayName = 'Payroll Workspace'; DisplayVersion = $info.version; Publisher = 'Payroll Workspace'; InstallLocation = $dest; DisplayIcon = $icon; UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$dest\uninstall.ps1`""; NoModify = 1; NoRepair = 1; EstimatedSize = $size }
    foreach ($keyName in $values.Keys) { $type = if ($values[$keyName] -is [int]) { 'DWord' } else { 'String' }; New-ItemProperty -Path $key -Name $keyName -Value $values[$keyName] -PropertyType $type -Force | Out-Null }
  }
  if ($previous) { try { RemoveWithin $previous $programs } catch { Write-Host 'Previous program files retained for cleanup.' }; $previous = $null }
  if ($form) { $form.Close(); $form.Dispose(); $form = $null }
  if ((Show "Payroll Workspace is installed.`n`nOpen the Payroll Workspace desktop icon. Your default browser will open automatically.`n`nStart it now?" 'YesNo' 'Information') -eq 'Yes') {
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList ('/c ""' + (Join-Path $dest 'Payroll Workspace.cmd') + '""') -WorkingDirectory $dest -WindowStyle Minimized
  }
} catch {
  if ($form) { $form.Close(); $form = $null }
  if ($previous) {
    if (Test-Path -LiteralPath $dest) { RemoveWithin $dest $programs }
    MoveDirectory $previous $dest; $previous = $null
  }
  Show ("Setup could not finish:`n`n" + $_.Exception.Message) 'OK' 'Error' | Out-Null
  exit 1
} finally {
  if ($work) { try { RemoveWithin $work $env:TEMP } catch { Write-Host 'Temporary setup files could not be removed.' } }
}

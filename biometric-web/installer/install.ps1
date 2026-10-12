# Biometric Attendance installer (per user, no administrator rights needed).
# Program : %LOCALAPPDATA%\Programs\BiometricAttendance
# Data    : %LOCALAPPDATA%\BiometricAttendance   (kept on reinstall / update)
param([switch]$Test, [string]$TestRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.IO.Compression.FileSystem
$title = 'Biometric Attendance Setup'
# -Test installs into -TestRoot without dialogs, shortcuts on the real desktop or registry entries (used to check the setup).
function Show($text, $buttons = 'OK', $icon = 'Information') { if ($Test) { Write-Host $text; if ($buttons -eq 'YesNo') { return 'No' }; return 'OK' }; [System.Windows.Forms.MessageBox]::Show($text, $title, $buttons, $icon) }
$local = if ($Test) { $TestRoot } else { $env:LOCALAPPDATA }

try {
  if (-not [Environment]::Is64BitOperatingSystem) { Show 'Biometric Attendance needs 64-bit Windows 10 or 11.' 'OK' 'Error' | Out-Null; exit 1 }
  if ([Environment]::OSVersion.Version.Major -lt 10) { Show 'Biometric Attendance needs Windows 10 or Windows 11.' 'OK' 'Error' | Out-Null; exit 1 }

  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $zip = Join-Path $here 'payload.zip'
  $dest = Join-Path $local 'Programs\BiometricAttendance'
  $data = Join-Path $local 'BiometricAttendance'
  $update = Test-Path (Join-Path $data 'biometric.sqlite')
  $msg = if ($update) { "Biometric Attendance will be updated.`n`nDownloaded punches and machine settings in $data are kept.`n`nContinue?" } else { "Biometric Attendance will be installed on this computer.`n`nProgram: $dest`nData: $data`n`nIt downloads attendance from the eSSL machines KE1, KE2 and b4 (192.168.11.x). Install it on a PC that is on the same network as the machines.`n`nContinue?" }
  if ((Show $msg 'OKCancel' 'Question') -ne 'OK') { exit 0 }

  $form = $null; $label = $null
  if (-not $Test) {
    $form = New-Object System.Windows.Forms.Form; $form.Text = $title; $form.Width = 440; $form.Height = 140; $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'; $form.ControlBox = $false; $form.TopMost = $true
    $label = New-Object System.Windows.Forms.Label; $label.AutoSize = $false; $label.Dock = 'Fill'; $label.TextAlign = 'MiddleCenter'; $label.Font = New-Object System.Drawing.Font('Segoe UI', 10); $form.Controls.Add($label)
    $form.Show(); [System.Windows.Forms.Application]::DoEvents()
  }
  function Step($text) { Write-Host $text; if ($label) { $label.Text = "Installing Biometric Attendance...`n`n$text"; $form.Refresh(); [System.Windows.Forms.Application]::DoEvents() } }
  Step 'Preparing'

  # Stop a running copy of the program before replacing its files.
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  $work = Join-Path $env:TEMP ('BiometricAttendanceSetup_' + [Guid]::NewGuid().ToString('N'))
  Step 'Unpacking files'
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $work)
  Step 'Copying the program'
  $src = Join-Path $work 'BiometricAttendance'
  New-Item -ItemType Directory -Force $dest, $data | Out-Null
  foreach ($dir in 'node', 'app') {
    $target = Join-Path $dest $dir
    if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    Move-Item -LiteralPath (Join-Path $src $dir) -Destination $target
  }
  foreach ($file in 'Biometric Attendance.cmd', 'uninstall.ps1', 'README.txt', 'app.ico') { Copy-Item -LiteralPath (Join-Path $src $file) -Destination $dest -Force }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue

  Step 'Creating shortcuts'
  # The console window starts minimised; closing it stops the program.
  $shell = New-Object -ComObject WScript.Shell
  $icon = Join-Path $dest 'app.ico'
  $links = if ($Test) { @((Join-Path $local 'Biometric Attendance.lnk')) } else { @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Biometric Attendance.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Biometric Attendance.lnk')) }
  foreach ($path in $links) {
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $lnk.Arguments = '/c ""' + (Join-Path $dest 'Biometric Attendance.cmd') + '""'
    $lnk.WorkingDirectory = $dest
    $lnk.WindowStyle = 7
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = 'Biometric Attendance - download punches from the eSSL machines'
    $lnk.Save()
  }

  # Entry in Settings > Apps so it can be uninstalled normally.
  if (-not $Test) {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BiometricAttendance'
    New-Item -Path $key -Force | Out-Null
    $size = [int]((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
    $values = @{ DisplayName = 'Biometric Attendance'; DisplayVersion = '1.0.0'; Publisher = 'Biometric Attendance'; InstallLocation = $dest; DisplayIcon = "$icon";
      UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$dest\uninstall.ps1`""; NoModify = 1; NoRepair = 1; EstimatedSize = $size }
    foreach ($k in $values.Keys) { $type = if ($values[$k] -is [int]) { 'DWord' } else { 'String' }; New-ItemProperty -Path $key -Name $k -Value $values[$k] -PropertyType $type -Force | Out-Null }
  }

  if ($form) { $form.Close(); $form.Dispose(); $form = $null }
  if ((Show "Biometric Attendance is installed.`n`nOpen it from the 'Biometric Attendance' icon on the desktop.`n`nStart it now?" 'YesNo' 'Information') -eq 'Yes') {
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList ('/c ""' + (Join-Path $dest 'Biometric Attendance.cmd') + '""') -WorkingDirectory $dest -WindowStyle Minimized
  }
} catch {
  if ($form) { $form.Close() }
  Show ("Setup could not finish:`n`n" + $_.Exception.Message) 'OK' 'Error' | Out-Null
  exit 1
}

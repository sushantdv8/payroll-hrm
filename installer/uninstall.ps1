# Per-user uninstall; keep both workspaces unless deletion is explicitly chosen.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$title = 'Uninstall Payroll Workspace'
$programs = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
$dest = [IO.Path]::GetFullPath($PSScriptRoot)
$expected = [IO.Path]::GetFullPath((Join-Path $programs 'PayrollWorkspace'))
$data = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'PayrollWorkspace'))
if (-not $dest.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Run uninstall from the installed Payroll Workspace folder.' }
if ([System.Windows.Forms.MessageBox]::Show('Remove Payroll Workspace? Your payroll data can be kept.', $title, 'YesNo', 'Question') -ne 'Yes') { exit 0 }
$consoleScript = Join-Path $dest 'Payroll Workspace.cmd'
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($consoleScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process node, workerd -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest + '\', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
foreach ($link in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Payroll Workspace.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Payroll Workspace.lnk'))) { Remove-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue }
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PayrollWorkspace' -Recurse -Force -ErrorAction SilentlyContinue
$delete = [System.Windows.Forms.MessageBox]::Show("Also DELETE all original and editable payroll data?`n`nYes = permanently delete $data`nNo = keep data for a later reinstall.", $title, 'YesNo', 'Warning', 'Button2')
if ($delete -eq 'Yes') {
  if (-not $data.StartsWith([IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe data deletion path' }
  Remove-Item -LiteralPath $data -Recurse -Force
}
if (-not $dest.StartsWith($programs.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe program deletion path' }
Remove-Item -LiteralPath $dest -Recurse -Force
[System.Windows.Forms.MessageBox]::Show('Payroll Workspace has been removed.', $title, 'OK', 'Information') | Out-Null

$ErrorActionPreference = 'Stop'
$workCopyLauncher = Join-Path $PSScriptRoot 'installer\launcher.mjs'
$workCopyProcesses = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $workCopyLauncher + '*') }
foreach ($workCopyProcess in $workCopyProcesses) {
  & taskkill /PID $workCopyProcess.ProcessId /T /F | Out-Null
}
Write-Host 'Work-copy Payroll application stopped.'

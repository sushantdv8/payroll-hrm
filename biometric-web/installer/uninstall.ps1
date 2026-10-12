# Removes Biometric Attendance for the current user. The data folder is kept unless the user chooses to delete it.
Add-Type -AssemblyName System.Windows.Forms
$title = 'Uninstall Biometric Attendance'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\BiometricAttendance'
$data = Join-Path $env:LOCALAPPDATA 'BiometricAttendance'
if ([System.Windows.Forms.MessageBox]::Show('Remove Biometric Attendance from this computer?', $title, 'YesNo', 'Question') -ne 'Yes') { exit 0 }
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Biometric Attendance.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Biometric Attendance.lnk'))) { Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue }
Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\BiometricAttendance' -Recurse -Force -ErrorAction SilentlyContinue
$keep = [System.Windows.Forms.MessageBox]::Show("Keep the downloaded attendance data?`n`nYes = keep it in $data (a later install will use it again).`nNo = delete all downloaded punches and machine settings from this computer.", $title, 'YesNo', 'Warning')
if ($keep -eq 'No') { Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue }
# The running script lives inside the program folder, so remove the folder after this process exits.
Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$dest`"" -WindowStyle Hidden
[System.Windows.Forms.MessageBox]::Show('Biometric Attendance has been removed.', $title, 'OK', 'Information') | Out-Null

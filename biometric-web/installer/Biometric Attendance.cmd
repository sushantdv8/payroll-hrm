@echo off
title Biometric Attendance
cd /d "%~dp0app"
echo Starting Biometric Attendance... the browser will open in a moment.
echo Keep this window open while you work. Close this window to stop the program.
echo.
"%~dp0node\node.exe" --no-warnings server.mjs "--data=%LOCALAPPDATA%\BiometricAttendance" --open
if errorlevel 1 (
  echo.
  echo Biometric Attendance could not start. See the message above.
  pause
)

@echo off
title Payroll Workspace
cd /d "%~dp0"
echo Starting Payroll Workspace... the browser will open in a moment.
echo Keep this window open while you work. Use Exit in the menu or close this window to stop.
"%~dp0node\node.exe" "%~dp0launcher.mjs"
if errorlevel 1 (
  echo.
  echo Payroll Workspace could not start. Details are in %LOCALAPPDATA%\PayrollWorkspace\logs\server.log
  pause
)

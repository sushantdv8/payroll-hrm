@echo off
title Biometric Attendance
cd /d "%~dp0"
set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\PayrollWorkspace\node\node.exe" set "NODE=%LOCALAPPDATA%\Programs\PayrollWorkspace\node\node.exe"
if not defined NODE (
  where node >nul 2>nul && set "NODE=node"
)
if not defined NODE (
  echo Node.js 22.13 or newer is required. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
echo Keep this window open while using the app. Close it to stop.
"%NODE%" --no-warnings server.mjs --open
pause

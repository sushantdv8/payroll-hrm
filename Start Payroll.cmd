@echo off
setlocal
set "PAYROLL_NODE=C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%PAYROLL_NODE%" set "PAYROLL_NODE=node"
cd /d "%~dp0"
"%PAYROLL_NODE%" "%~dp0installer\launcher.mjs"
if errorlevel 1 pause

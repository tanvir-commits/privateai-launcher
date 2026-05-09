@echo off
cd /d "%~dp0"
REM Avoids npm.ps1 / PowerShell execution policy; same as: node scripts/task.mjs dev
if exist "%ProgramFiles%\nodejs\node.exe" (
  "%ProgramFiles%\nodejs\node.exe" "%~dp0scripts\task.mjs" dev
) else (
  node "%~dp0scripts\task.mjs" dev
)

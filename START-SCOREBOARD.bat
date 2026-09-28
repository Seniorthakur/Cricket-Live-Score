@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required. Install it from nodejs.org and run this file again.
  pause
  exit /b 1
)
start "" http://localhost:3000/
node server.js
pause

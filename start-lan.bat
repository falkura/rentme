@echo off
rem Start rentme so your phone on the same Wi-Fi can use it too (protected by an access key).
rem The phone link is printed below. Close this window (or press Ctrl+C) to stop.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo .venv not found. Run the Setup steps from README.md first.
  pause
  exit /b 1
)
if not exist "rentme\static\index.html" (
  echo Web UI is not built. Run:  cd web ^&^& npm install ^&^& npm run build
  pause
  exit /b 1
)
set PORT=%1
if "%PORT%"=="" set PORT=8000
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%"
.venv\Scripts\python -m rentme serve --lan --port %PORT%
pause

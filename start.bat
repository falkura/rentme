@echo off
rem Start rentme: web server + browser. Close this window (or press Ctrl+C) to stop.
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
echo rentme is running at http://127.0.0.1:%PORT%  (Ctrl+C to stop)
.venv\Scripts\python -m rentme serve --port %PORT%
pause

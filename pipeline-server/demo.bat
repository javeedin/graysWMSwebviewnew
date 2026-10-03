@echo off
rem Try the console with sample pipelines - no database or Fusion needed. Open http://localhost:8000/ui/
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run setup.ps1 first ^(or: py -3.12 -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt^).
  pause
  exit /b 1
)
set PIPELINE_HOME=%~dp0data-demo
.venv\Scripts\python.exe -m pipeline_server demo --port 8000
pause

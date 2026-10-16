@echo off
rem Gray's WMS pipeline server - runs in this window (close it or Ctrl+C to stop). Console: http://localhost:<port>/ui/
cd /d "%~dp0"
title Gray's WMS pipeline server
if not exist .venv\Scripts\python.exe (
  echo Not set up yet - run setup.ps1 first.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m pipeline_server run
echo.
echo The server stopped.
pause

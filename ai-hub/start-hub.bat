@echo off
rem Gray's WMS AI Hub - runs in this window (normally started from the WMS app: AI Hub › Start)
cd /d "%~dp0"
title Gray's WMS AI Hub
if not exist .venv\Scripts\python.exe (
  echo Not installed yet - open the WMS app, AI Hub, Install.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m ai_hub run
pause

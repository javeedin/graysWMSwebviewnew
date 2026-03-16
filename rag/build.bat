@echo off
REM ============================================================
REM  Gray's WMS RAG Service - Build Script
REM  Python 3.14+ compatible — no C++ / Rust compilation
REM ============================================================

echo [RAG Build] Fixing pip if needed...
python -m ensurepip --upgrade
python -m pip install --upgrade pip setuptools wheel

echo [RAG Build] Installing dependencies...
pip install --prefer-binary -r requirements.txt
pip install pyinstaller

echo [RAG Build] Building standalone exe...
pyinstaller --onefile ^
  --name rag_service ^
  --hidden-import=flask ^
  --hidden-import=flask_cors ^
  --hidden-import=fastembed ^
  --hidden-import=numpy ^
  --hidden-import=anthropic ^
  rag_service.py

echo [RAG Build] Done! Output: dist\rag_service.exe
pause

@echo off
REM ============================================================
REM  Gray's WMS RAG Service - Build Script
REM  Works with Python 3.14+ (Flask, no Rust required)
REM  Produces a single self-contained rag_service.exe
REM ============================================================

echo [RAG Build] Installing dependencies...
pip install --prefer-binary -r requirements.txt
pip install pyinstaller

echo [RAG Build] Building standalone exe...
pyinstaller --onefile ^
  --name rag_service ^
  --hidden-import=flask ^
  --hidden-import=flask_cors ^
  --hidden-import=chromadb ^
  --hidden-import=sentence_transformers ^
  --hidden-import=anthropic ^
  rag_service.py

echo [RAG Build] Done! Output: dist\rag_service.exe
pause

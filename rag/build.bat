@echo off
REM ============================================================
REM  Gray's WMS RAG Service - Build Script
REM  Produces a single self-contained rag_service.exe
REM  End users do NOT need Python installed.
REM ============================================================

echo [RAG Build] Installing dependencies (using Python 3.11)...
py -3.11 -m pip install --prefer-binary -r requirements.txt
py -3.11 -m pip install pyinstaller

echo [RAG Build] Building standalone exe...
pyinstaller --onefile ^
  --name rag_service ^
  --hidden-import=chromadb ^
  --hidden-import=sentence_transformers ^
  --hidden-import=anthropic ^
  --hidden-import=uvicorn.logging ^
  --hidden-import=uvicorn.loops ^
  --hidden-import=uvicorn.loops.auto ^
  --hidden-import=uvicorn.protocols ^
  --hidden-import=uvicorn.protocols.http ^
  --hidden-import=uvicorn.protocols.http.auto ^
  --hidden-import=uvicorn.lifespan ^
  --hidden-import=uvicorn.lifespan.on ^
  rag_service.py

echo [RAG Build] Done! Output: dist\rag_service.exe
pause

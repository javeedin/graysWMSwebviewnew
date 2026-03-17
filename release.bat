@echo off
REM ============================================================
REM  release.bat
REM  Full release: build RAG exe, build dist\, zip everything
REM ============================================================

echo.
echo ============================================================
echo   Gray's WMS - Release Builder
echo ============================================================
echo.
echo   Step 1: Build RAG service (rag_service.exe via PyInstaller)
echo   Step 2: Build distribution folder (dist\)
echo   Step 3: Package into fusionclientweb.zip
echo.
choice /M "Continue?"
if errorlevel 2 goto :eof

echo.
echo ============================================================
echo   STEP 1 - Building RAG service (Python ^> exe)...
echo ============================================================
echo.

REM Check if already built - allow skipping
if exist "%~dp0rag\dist\rag_service.exe" (
    echo   rag_service.exe already exists.
    choice /M "   Rebuild RAG service? (No = use existing exe)"
    if errorlevel 2 goto :skip_rag_build
)

REM Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo   WARNING: Python not found in PATH.
    echo   Cannot build rag_service.exe automatically.
    echo.
    if not exist "%~dp0rag\dist\rag_service.exe" (
        echo   ERROR: rag\dist\rag_service.exe does not exist.
        echo   Please run rag\build.bat manually on a machine with Python installed.
        pause
        exit /b 1
    )
    echo   Using existing rag_service.exe.
    goto :skip_rag_build
)

pushd "%~dp0rag"
call build.bat
if errorlevel 1 (
    popd
    echo.
    echo ERROR: RAG build failed. Aborting.
    pause
    exit /b 1
)
popd

:skip_rag_build

REM Verify the exe was produced
if not exist "%~dp0rag\dist\rag_service.exe" (
    echo.
    echo ERROR: rag\dist\rag_service.exe not found after build.
    echo        Run rag\build.bat manually first, then re-run release.bat.
    pause
    exit /b 1
)
echo   rag_service.exe OK.

echo.
echo ============================================================
echo   STEP 2 - Building distribution folder...
echo ============================================================
echo.

call create-distribution-folder.bat
if errorlevel 1 (
    echo.
    echo ERROR: Build step failed. Aborting.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   STEP 3 - Packaging into fusionclientweb.zip...
echo ============================================================
echo.

call package-release.bat
if errorlevel 1 (
    echo.
    echo ERROR: Package step failed.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   DONE - fusionclientweb.zip is ready to send to users
echo ============================================================
echo.
pause

@echo off
REM ============================================================
REM  build-installer.bat
REM  Builds GraysWMS_Setup.exe using Inno Setup
REM
REM  Prerequisites:
REM    1. Inno Setup 6 installed (https://jrsoftware.org/isinfo.php)
REM    2. Run this AFTER release.bat has been run (dist\ must exist)
REM
REM  Output: installer-output\GraysWMS_Setup_v1.2.0.exe
REM ============================================================

setlocal

REM --- Try common Inno Setup install locations ---
set "ISCC="
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
)

if "%ISCC%"=="" (
    echo.
    echo ============================================
    echo   ERROR: Inno Setup 6 not found
    echo ============================================
    echo.
    echo Please install Inno Setup 6 from:
    echo   https://jrsoftware.org/isinfo.php
    echo.
    echo After install, re-run this script.
    echo.
    pause
    exit /b 1
)

echo ============================================
echo   Gray's WMS - Installer Builder
echo ============================================
echo.
echo   Using Inno Setup: %ISCC%
echo.

REM --- Check dist folder exists ---
if not exist "dist\GraysWMS.exe" (
    echo ERROR: dist\GraysWMS.exe not found.
    echo Please run release.bat first to build the application.
    echo.
    pause
    exit /b 1
)

REM --- Check web files exist ---
if not exist "wms" (
    echo ERROR: wms folder not found.
    echo Please run release.bat first.
    echo.
    pause
    exit /b 1
)

if not exist "Home" (
    echo ERROR: Home folder not found.
    echo.
    pause
    exit /b 1
)

REM --- Create output folder ---
if not exist "installer-output" mkdir "installer-output"

REM --- Compile installer ---
echo Compiling installer...
echo.
"%ISCC%" installer.iss
if errorlevel 1 (
    echo.
    echo ============================================
    echo   ERROR: Installer build failed
    echo ============================================
    pause
    exit /b 1
)

echo.
echo ============================================
echo   SUCCESS: Installer created
echo ============================================
echo.
echo   Output: installer-output\GraysWMS_Setup_v1.2.0.exe
echo.
echo   Send this ONE file to users.
echo   They double-click it, click Next, done.
echo   No ZIP, no manual extraction needed.
echo.

REM --- Show file size ---
powershell -NoProfile -Command "$f = Get-Item 'installer-output\GraysWMS_Setup_v*.exe' | Select-Object -Last 1; if ($f) { $size = [math]::Round($f.Length / 1MB, 2); Write-Host ('Installer size: ' + $size + ' MB - ' + $f.Name) }"

echo.
pause

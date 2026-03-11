@echo off
REM ============================================================
REM  release.bat
REM  Full release: build dist\ then zip into fusionclientweb.zip
REM ============================================================

echo.
echo ============================================================
echo   Gray's WMS - Release Builder
echo ============================================================
echo.
echo   Step 1: Build distribution folder (dist\)
echo   Step 2: Package into fusionclientweb.zip
echo.
choice /M "Continue?"
if errorlevel 2 goto :eof

echo.
echo ============================================================
echo   STEP 1 - Building distribution folder...
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
echo   STEP 2 - Packaging into fusionclientweb.zip...
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

@echo off
REM ============================================================
REM  package-release.bat
REM  Creates a single zip: fusionclientweb.zip
REM  Extract to C:\fusion\ and it creates:
REM    C:\fusion\fusionclientweb\graysWMSwebviewnew\
REM       Home\         (Home dashboard)
REM       wms\          (web frontend files)
REM       dist\         (.NET build output + runtime)
REM       ap\, ar\, ca\, fa\, gl\, om\, pos\, sync\  (modules)
REM       app.js, config.js, index.html, styles.css, etc.
REM ============================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "STAGE_DIR=%TEMP%\fusionclientweb-stage"
set "APP_DIR=%STAGE_DIR%\fusionclientweb\graysWMSwebviewnew"
set "ZIP_NAME=fusionclientweb.zip"
set "OUTPUT=%SCRIPT_DIR%%ZIP_NAME%"

echo ============================================
echo   Gray's WMS - Package Release
echo ============================================
echo.
echo   Zip structure after extract to C:\fusion\:
echo   C:\fusion\fusionclientweb\graysWMSwebviewnew\
echo.

REM --- Clean previous staging ---
if exist "%STAGE_DIR%" (
    echo Cleaning previous staging folder...
    rmdir /s /q "%STAGE_DIR%"
)

REM --- Create staging structure ---
echo Creating staging folder...
mkdir "%APP_DIR%"

REM --- Copy Home folder ---
echo Copying Home folder...
if not exist "%SCRIPT_DIR%Home" (
    echo ERROR: Home folder not found at %SCRIPT_DIR%Home
    goto :error
)
mkdir "%APP_DIR%\Home"
xcopy "%SCRIPT_DIR%Home\*" "%APP_DIR%\Home\" /s /e /y /q
if errorlevel 1 (
    echo ERROR: Failed to copy Home folder
    goto :error
)

REM --- Copy wms folder ---
echo Copying wms folder...
if not exist "%SCRIPT_DIR%wms" (
    echo ERROR: wms folder not found. Run create-distribution-folder.bat first.
    goto :error
)
mkdir "%APP_DIR%\wms"
xcopy "%SCRIPT_DIR%wms\*" "%APP_DIR%\wms\" /s /e /y /q
if errorlevel 1 (
    echo ERROR: Failed to copy wms folder
    goto :error
)

REM --- Copy dist folder ---
echo Copying dist folder...
if not exist "%SCRIPT_DIR%dist" (
    echo ERROR: dist folder not found. Run create-distribution-folder.bat first.
    goto :error
)
mkdir "%APP_DIR%\dist"
xcopy "%SCRIPT_DIR%dist\*" "%APP_DIR%\dist\" /s /e /y /q
if errorlevel 1 (
    echo ERROR: Failed to copy dist folder
    goto :error
)

REM --- Copy module folders ---
for %%F in (ap ar ca fa gl om pos sync) do (
    if exist "%SCRIPT_DIR%%%F" (
        echo Copying %%F folder...
        mkdir "%APP_DIR%\%%F"
        xcopy "%SCRIPT_DIR%%%F\*" "%APP_DIR%\%%F\" /s /e /y /q
    ) else (
        echo   [SKIP] %%F folder not found, skipping...
    )
)

REM --- Copy root web files ---
echo Copying root web files...
for %%F in (app.js config.js styles.css index.html login.html monitor-printing.js printer-management-new.js api-log.js) do (
    if exist "%SCRIPT_DIR%%%F" (
        copy /y "%SCRIPT_DIR%%%F" "%APP_DIR%\%%F" >nul
        echo   - %%F
    ) else (
        echo   [SKIP] %%F not found
    )
)

REM --- Remove old zip if exists ---
if exist "%OUTPUT%" (
    echo.
    echo Removing old %ZIP_NAME%...
    del "%OUTPUT%"
)

REM --- Create zip using PowerShell ---
echo.
echo Creating %ZIP_NAME%...
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE_DIR%\fusionclientweb' -DestinationPath '%OUTPUT%' -CompressionLevel Optimal"
if errorlevel 1 (
    echo ERROR: Failed to create zip file
    goto :error
)

echo.
echo ============================================
echo   SUCCESS: %ZIP_NAME% created
echo   Location: %OUTPUT%
echo ============================================
echo.
echo   Instructions for deployment:
echo   1. Copy fusionclientweb.zip to target PC
echo   2. Place zip in C:\fusion\
echo   3. Extract here - creates:
echo      C:\fusion\fusionclientweb\graysWMSwebviewnew\
echo   4. Run: C:\fusion\fusionclientweb\graysWMSwebviewnew\dist\WMSApp.exe
echo.

REM --- Show zip size ---
powershell -NoProfile -Command "$size = [math]::Round((Get-Item '%OUTPUT%').Length / 1MB, 2); Write-Host ('Zip size: ' + $size + ' MB')"

goto :cleanup

:error
echo.
echo ============================================
echo   FAILED - See error above
echo ============================================

:cleanup
REM --- Clean staging ---
if exist "%STAGE_DIR%" (
    rmdir /s /q "%STAGE_DIR%"
)

echo.
pause

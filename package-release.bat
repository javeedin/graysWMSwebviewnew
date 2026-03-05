@echo off
REM ============================================================
REM  package-release.bat
REM  Creates a single zip: fusionclientweb.zip
REM  Extract structure:
REM    fusionclientweb\wms\   (web frontend files)
REM    fusionclientweb\dist\  (.NET build output + runtime)
REM ============================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "STAGE_DIR=%TEMP%\fusionclientweb-stage"
set "ZIP_NAME=fusionclientweb.zip"
set "OUTPUT=%SCRIPT_DIR%%ZIP_NAME%"

echo ============================================
echo   Gray's WMS - Package Release
echo ============================================
echo.

REM --- Clean previous staging ---
if exist "%STAGE_DIR%" (
    echo Cleaning previous staging folder...
    rmdir /s /q "%STAGE_DIR%"
)

REM --- Create staging structure ---
echo Creating staging folder...
mkdir "%STAGE_DIR%\fusionclientweb\wms"
mkdir "%STAGE_DIR%\fusionclientweb\dist"

REM --- Copy wms folder ---
echo Copying wms files...
xcopy "%SCRIPT_DIR%wms\*" "%STAGE_DIR%\fusionclientweb\wms\" /s /e /y /q
if errorlevel 1 (
    echo ERROR: Failed to copy wms folder
    goto :cleanup
)

REM --- Copy dist folder ---
echo Copying dist files...
xcopy "%SCRIPT_DIR%dist\*" "%STAGE_DIR%\fusionclientweb\dist\" /s /e /y /q
if errorlevel 1 (
    echo ERROR: Failed to copy dist folder
    goto :cleanup
)

REM --- Remove old zip if exists ---
if exist "%OUTPUT%" (
    echo Removing old %ZIP_NAME%...
    del "%OUTPUT%"
)

REM --- Create zip using PowerShell ---
echo Creating %ZIP_NAME%...
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE_DIR%\fusionclientweb' -DestinationPath '%OUTPUT%' -CompressionLevel Optimal"
if errorlevel 1 (
    echo ERROR: Failed to create zip file
    goto :cleanup
)

echo.
echo ============================================
echo   SUCCESS: %ZIP_NAME% created
echo   Location: %OUTPUT%
echo ============================================

REM --- Show zip contents summary ---
powershell -NoProfile -Command "$z = [System.IO.Compression.ZipFile]::OpenRead('%OUTPUT%'); $dirs = $z.Entries | ForEach-Object { Split-Path $_.FullName -Parent } | Sort-Object -Unique | Where-Object { $_ -ne '' }; Write-Host ''; Write-Host 'Folders in zip:'; $dirs | ForEach-Object { Write-Host ('  ' + $_) }; Write-Host ''; Write-Host ('Total files: ' + $z.Entries.Count); $size = [math]::Round((Get-Item '%OUTPUT%').Length / 1MB, 2); Write-Host ('Zip size: ' + $size + ' MB'); $z.Dispose()"

:cleanup
REM --- Clean staging ---
if exist "%STAGE_DIR%" (
    rmdir /s /q "%STAGE_DIR%"
)

echo.
pause

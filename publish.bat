@echo off
REM ============================================
REM Gray's WMS - Build & Publish Script
REM Creates a single-file executable with all
REM web content embedded
REM ============================================

echo.
echo ==========================================
echo Gray's WMS - Build Script v1.2.0
echo ==========================================
echo.

REM Set publish output folder
set OUTPUT_DIR=publish
set CONFIG=Release

REM Clean previous build
echo [1/4] Cleaning previous build...
if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"

REM Restore packages
echo [2/4] Restoring NuGet packages...
dotnet restore

REM Build the project
echo [3/4] Building project...
dotnet build -c %CONFIG%

REM Publish single-file executable
echo [4/4] Publishing single-file executable...
dotnet publish -c %CONFIG% -o "%OUTPUT_DIR%" --self-contained true -r win-x64 -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true -p:EnableCompressionInSingleFile=true

echo.
echo ==========================================
echo Build Complete!
echo ==========================================
echo.
echo Output location: %CD%\%OUTPUT_DIR%
echo.

REM List output files
echo Files created:
dir /b "%OUTPUT_DIR%"

echo.
echo The GraysWMS.exe file contains everything needed to run.
echo Just copy GraysWMS.exe to any Windows 64-bit machine.
echo.
echo NOTE: Target machine must have WebView2 Runtime installed.
echo Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
echo.

pause

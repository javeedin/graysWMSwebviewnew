@echo off
REM ========================================
REM WMS Auto-Release Builder - Simple Wrapper
REM ========================================

echo.
echo ========================================
echo WMS Auto-Release Builder
echo ========================================
echo.
echo This will:
echo   1. Auto-increment version (patch bump: 1.0.0 -^> 1.0.1)
echo   2. Create Wms-dist-X.X.X folder
echo   3. Create wms-webview-html-X.X.X.zip
echo   4. Update version.json and latest-release.json
echo   5. Commit and push to GitHub
echo.
echo ========================================
echo.

REM Check if user wants to continue
choice /M "Continue with PATCH version bump (1.0.0 -> 1.0.1)"
if errorlevel 2 goto :eof

echo.
echo Running PowerShell script...
echo.

powershell -ExecutionPolicy Bypass -File .\create-release.ps1 -VersionBump patch

if errorlevel 1 (
    echo.
    echo ERROR: Release creation failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo SUCCESS! Release created.
echo ========================================
echo.
echo Next: Create GitHub Release and upload the ZIP file
echo See instructions above
echo.
pause
@echo off
echo Building Gray's WMS Application...
echo.

dotnet build -c Release

if errorlevel 1 (
    echo.
    echo Build FAILED!
    pause
    exit /b 1
)

echo.
echo Build SUCCESS!
echo.
echo Output location: bin\Release\net8.0-windows\
echo.
pause

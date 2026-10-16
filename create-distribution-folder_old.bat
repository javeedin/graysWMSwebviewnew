@echo off
REM Batch script to create distribution folder for Gray's WMS WebView Application
REM This script builds the project and copies all necessary files to a dist folder

echo ========================================
echo Gray's WMS Distribution Builder
echo ========================================
echo.

set CONFIGURATION=Release
set OUTPUT_FOLDER=dist
set BUILD_PATH=bin\%CONFIGURATION%\net8.0-windows

echo Configuration: %CONFIGURATION%
echo Output Folder: %OUTPUT_FOLDER%
echo.

REM Step 1: Clean previous distribution folder
if exist %OUTPUT_FOLDER% (
    echo Cleaning previous distribution folder...
    rmdir /s /q %OUTPUT_FOLDER%
)

REM Create distribution folder
echo Creating distribution folder...
mkdir %OUTPUT_FOLDER%

REM Step 2: Build the project
echo.
echo Building project...
echo Running: dotnet build -c %CONFIGURATION%
echo.

dotnet build -c %CONFIGURATION%
if errorlevel 1 (
    echo.
    echo Build failed! Check the error messages above.
    pause
    exit /b 1
)

echo.
echo Build completed successfully!

REM Step 3: Check if build output exists
if not exist %BUILD_PATH% (
    echo.
    echo ERROR: Build output path not found: %BUILD_PATH%
    pause
    exit /b 1
)

REM Step 4: Copy build output
echo.
echo Copying application files...
xcopy /s /y /q "%BUILD_PATH%\*" "%OUTPUT_FOLDER%\"

REM Step 5: Copy additional files
echo Copying additional files...

if exist README.md (
    copy /y README.md %OUTPUT_FOLDER%\ >nul
    echo   - README.md
)

if exist apex_sql (
    if not exist %OUTPUT_FOLDER%\apex_sql mkdir %OUTPUT_FOLDER%\apex_sql
    xcopy /s /y /q apex_sql\* %OUTPUT_FOLDER%\apex_sql\ >nul
    echo   - apex_sql folder
)

if exist docs (
    if not exist %OUTPUT_FOLDER%\docs mkdir %OUTPUT_FOLDER%\docs
    xcopy /s /y /q docs\* %OUTPUT_FOLDER%\docs\ >nul
    echo   - docs folder
)

REM Step 6: Create startup instructions
echo Creating startup instructions...
(
echo # Gray's WMS WebView Application - Distribution Package
echo.
echo ## Quick Start
echo.
echo 1. Ensure you have .NET 8.0 Runtime installed:
echo    - Download from: https://dotnet.microsoft.com/download/dotnet/8.0
echo    - You need the ".NET Desktop Runtime" for Windows
echo.
echo 2. Ensure WebView2 Runtime is installed:
echo    - Usually pre-installed on Windows 11
echo    - Download from: https://developer.microsoft.com/microsoft-edge/webview2/
echo.
echo 3. Run the application:
echo    - Double-click WMSApp.exe
echo.
echo ## Setup
echo.
echo ### Configure API Connection
echo 1. Edit config.js and update the APEX_BASE_URL
echo 2. Point it to your Oracle APEX instance
echo.
echo ### Setup Database
echo Run the SQL scripts in the apex_sql folder in order:
echo 1. 01_tables.sql
echo 2. 02_procedures_get.sql
echo 3. 03_procedures_post.sql
echo 4. 04_apex_endpoints_get.sql
echo 5. 05_apex_endpoints_post.sql
echo 6. 06_additional_printer_procedures.sql
echo 7. 07_printer_management_endpoints.sql
echo.
echo ### Configure Printers
echo 1. Launch the application
echo 2. Go to "Printer Setup New" menu
echo 3. Add your printers with Oracle Fusion credentials
echo 4. Test and set as active
echo.
echo ## Files Included
echo.
echo - WMSApp.exe - Main application
echo - *.dll - Required libraries
echo - *.js, *.html, *.css - Web UI files
echo - apex_sql/ - Database setup scripts
echo - docs/ - Additional documentation
echo.
echo ## Support
echo.
echo For issues or questions, refer to README.md or contact the development team.
echo.
echo Built on: %date% %time%
echo Configuration: %CONFIGURATION%
) > %OUTPUT_FOLDER%\START_HERE.txt
echo   - START_HERE.txt

REM Step 7: Create version info
echo Creating version info...
(
echo Gray's WMS WebView Application
echo Build Date: %date% %time%
echo Configuration: %CONFIGURATION%
echo .NET Version: 8.0
) > %OUTPUT_FOLDER%\VERSION.txt
echo   - VERSION.txt

REM Step 8: Display summary
echo.
echo ========================================
echo Distribution Created Successfully!
echo ========================================
echo.
echo Location: %CD%\%OUTPUT_FOLDER%
echo.

echo To run the application:
echo   cd %OUTPUT_FOLDER%
echo   WMSApp.exe
echo.
echo Read START_HERE.txt for deployment instructions
echo.

pause

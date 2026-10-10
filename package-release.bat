@echo off
REM ============================================================
REM  package-release.bat
REM  Creates a single zip: fusionclientweb.zip  (v12.1.0 client package)
REM  Extract INTO C:\fusion\fusionclientweb\ and it creates:
REM    C:\fusion\fusionclientweb\graysWMSwebviewnew\
REM       Home\         (launcher - shows only the modules in this package)
REM       wms\          (Warehouse Management)
REM       Inventory\    (Inventory)
REM       aianalysis\   (AI Digital Employee  - TRIAL)
REM       fusionsql\    (Fusion SQL - always included; TRIAL)
REM       dataload\     (Data Loading - Fusion FBDI templates)
REM       dllexplorer\  (DLL Explorer - read a .dll/.exe, AI feature map)
REM       powerbi\      (Power BI - datasets from APEX, embedded reports)
REM       fusionmodel\  (Fusion Model - DuckDB module files, shared dataset)
REM       formsdesigner\form-engine.js  (runtime used by AI Digital Employee)
REM       dist\         (.NET build output + runtime)
REM       app.js, config.js, index.html, styles.css, etc.
REM
REM  AI Digital Employee and Fusion SQL share ONE trial period: the
REM  row in APEX table WMS_AI_TRIAL (apex_sql\67_trial_period.sql).
REM
REM  Options (set before calling, e.g. from release.bat):
REM    MODULES      module folders besides wms
REM                 default: Inventory aianalysis fusionsql dataload dllexplorer powerbi fusionmodel aihub aiagent finance wms2 teachme fieldapps bip debtors crm
REM    INCLUDE_RAG  Y to add the compiled RAG service (default N)
REM ============================================================

setlocal enabledelayedexpansion
REM Unattended mode (Admin > Create ZIP sets RELEASE_AUTO=1): no prompts, no pauses
set "PAUSE_CMD=pause"
if defined RELEASE_AUTO set "PAUSE_CMD=rem"
set "RC=0"
if not defined DIST_OUT set "DIST_OUT=dist"

set "SCRIPT_DIR=%~dp0"
set "STAGE_DIR=%TEMP%\fusionclientweb-stage"
set "APP_DIR=%STAGE_DIR%\graysWMSwebviewnew"
set "ZIP_NAME=fusionclientweb.zip"
set "OUTPUT=%SCRIPT_DIR%%ZIP_NAME%"

echo ============================================
echo   Gray's WMS - Package Release
echo ============================================
echo.
echo   Zip contains: graysWMSwebviewnew\ at root
echo   Extract INTO: C:\fusion\fusionclientweb\
echo   Result: C:\fusion\fusionclientweb\graysWMSwebviewnew\
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

REM --- Copy mobile folder (the FCPos picker app web build shown by WMS > Picker app; node tools\mobile\build-mobile.js writes it) ---
if exist "%SCRIPT_DIR%mobile" (
    echo Copying mobile folder...
    mkdir "%APP_DIR%\mobile"
    xcopy "%SCRIPT_DIR%mobile\*" "%APP_DIR%\mobile\" /s /e /y /q
) else (
    echo WARNING: mobile folder not found - the WMS Picker app page will say the app is not installed
)

REM --- Copy dist folder ---
echo Copying dist folder...
if not exist "%SCRIPT_DIR%%DIST_OUT%" (
    echo ERROR: dist folder not found. Run create-distribution-folder.bat first.
    goto :error
)
set "VERIFY_DIR=%SCRIPT_DIR%%DIST_OUT%"
REM --- Verify dist\ matches this build (a stale System.Text.Json.dll or deps.json
REM     makes the app fail with "The type initializer for 'WMSApp.Form1' threw an exception") ---
set "VERIFY_FAILED="
for %%F in (GraysWMS.exe GraysWMS.dll GraysWMS.deps.json Anthropic.dll System.Text.Json.dll System.IO.Pipelines.dll System.Text.Encodings.Web.dll Microsoft.Data.Sqlite.dll e_sqlite3.dll System.Security.Cryptography.ProtectedData.dll) do (
    if not exist "%VERIFY_DIR%\%%F" (
        echo ERROR: %%F is missing from %VERIFY_DIR%
        set "VERIFY_FAILED=1"
    )
)
findstr /c:"Anthropic" "%VERIFY_DIR%\GraysWMS.deps.json" >nul 2>&1 || (
    echo ERROR: %VERIFY_DIR%\GraysWMS.deps.json is from an old build
    set "VERIFY_FAILED=1"
)
if exist "%VERIFY_DIR%\System.Text.Json.dll" (
    powershell -NoProfile -Command "$v=(Get-Item '%VERIFY_DIR%\System.Text.Json.dll').VersionInfo; if ($v.FileMajorPart -lt 10) { Write-Host ('ERROR: System.Text.Json.dll is ' + $v.FileVersion + ' - GraysWMS needs 10.x'); exit 1 }" || set "VERIFY_FAILED=1"
)
if defined VERIFY_FAILED (
    echo ERROR: dist\ is stale or incomplete. Run create-distribution-folder.bat first.
    goto :error
)
mkdir "%APP_DIR%\dist"
xcopy "%SCRIPT_DIR%%DIST_OUT%\*" "%APP_DIR%\dist\" /s /e /y /q
if errorlevel 1 (
    echo ERROR: Failed to copy dist folder
    goto :error
)

REM --- Copy module folders ---
if not defined MODULES set "MODULES=Inventory aianalysis fusionsql dataload dllexplorer powerbi fusionmodel aihub aiagent finance wms2 teachme fieldapps bip debtors crm"
REM Fusion SQL is part of every release (the Fusion Model and Data Loading use its runner too)
echo " %MODULES% " | findstr /i /c:" fusionsql " >nul || set "MODULES=%MODULES% fusionsql"
REM the CRM loads the Debtors Control scripts (statements, balances): crm brings debtors
echo " %MODULES% " | findstr /i /c:" crm " >nul && (echo " %MODULES% " | findstr /i /c:" debtors " >nul || set "MODULES=%MODULES% debtors")
echo Modules in this release: wms %MODULES%
for %%F in (%MODULES%) do (
    if exist "%SCRIPT_DIR%%%F" (
        echo Copying %%F folder...
        mkdir "%APP_DIR%\%%F"
        xcopy "%SCRIPT_DIR%%%F\*" "%APP_DIR%\%%F\" /s /e /y /q
    ) else (
        echo ERROR: module folder %%F not found
        goto :error
    )
)

REM --- Fusion SQL must be complete: the page and every script it loads ---
for %%F in (index.html fusionsql.js fusionsql.css report.js datasets.js flows.js flows-seed.js flows-catalog.js setups.js setups-seed.js pipelines.js pipeline-setup.js tomodel.js knowledge.js knowledge-engine.js watchdogs.js watch-engine.js) do (
    if not exist "%APP_DIR%\fusionsql\%%F" (
        echo ERROR: fusionsql\%%F is missing from the package
        goto :error
    )
)
echo   - fusionsql\ verified (page + 16 scripts)

REM --- AI Digital Employee loads ..\formsdesigner\form-engine.js (engine only, not the designer) ---
if not exist "%APP_DIR%\formsdesigner\form-engine.js" (
    mkdir "%APP_DIR%\formsdesigner" 2>nul
    copy /y "%SCRIPT_DIR%formsdesigner\form-engine.js" "%APP_DIR%\formsdesigner\form-engine.js" >nul
    echo   - formsdesigner\form-engine.js
)

REM --- Pipeline server sources (Fusion SQL > Pipelines > This PC installs them to C:\fusion\pipeline-server) ---
REM     sources only: no .venv / data / runtime / tests - the app installs Python and the packages on the PC itself
if exist "%SCRIPT_DIR%pipeline-server\pipeline_server\__main__.py" (
    robocopy "%SCRIPT_DIR%pipeline-server" "%APP_DIR%\pipeline-server" /E /XD .venv data data-demo runtime tests __pycache__ .pytest_cache .nicegui /XF *.pyc /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 (
        echo ERROR: copying pipeline-server failed
        goto :error
    )
    if not exist "%APP_DIR%\pipeline-server\pipeline_server\app.py" (
        echo ERROR: pipeline-server\pipeline_server\app.py is missing from the package
        goto :error
    )
    echo   - pipeline-server\ ^(sources^)
)

REM --- AI Hub service sources (AI Hub page > Install copies them to C:\fusion\ai-hub), with the aihub or aiagent module ---
REM     (the AI Agent's brain runs in the AI Hub)
echo " %MODULES% " | findstr /i /c:" aihub " /c:" aiagent " >nul && if exist "%SCRIPT_DIR%ai-hub\ai_hub\__main__.py" (
    robocopy "%SCRIPT_DIR%ai-hub" "%APP_DIR%\ai-hub" /E /XD .venv data runtime tests __pycache__ .pytest_cache /XF *.pyc /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 (
        echo ERROR: copying ai-hub failed
        goto :error
    )
    echo   - ai-hub\ ^(sources^)
)

REM --- Admin page (Home shows its tile only on a PC where the source repo / release.bat is found) ---
if exist "%SCRIPT_DIR%admin" (
    mkdir "%APP_DIR%\admin" 2>nul
    xcopy "%SCRIPT_DIR%admin\*" "%APP_DIR%\admin\" /s /e /y /q >nul
    echo   - admin\
)

REM --- Copy RAG service (compiled exe only, not Python source) ---
if /i not "%INCLUDE_RAG%"=="Y" (
    echo [SKIP] RAG service excluded from this release.
) else (
    echo Copying RAG service...
    if not exist "%SCRIPT_DIR%rag\dist\rag_service\rag_service.exe" (
        echo ERROR: rag\dist\rag_service\rag_service.exe not found.
        echo        Run rag\build.bat first, or use release.bat which does this automatically.
        goto :error
    )
    mkdir "%APP_DIR%\rag"
    xcopy "%SCRIPT_DIR%rag\dist\rag_service\*" "%APP_DIR%\rag\" /s /e /y /q
    echo   - rag\ (all runtime files)
    if exist "%SCRIPT_DIR%rag\index.html" (
        copy /y "%SCRIPT_DIR%rag\index.html" "%APP_DIR%\rag\index.html" >nul
        echo   - rag\index.html
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

REM --- Tell Home which modules are in this package (hides the other tiles) ---
set "JSLIST='wms'"
for %%F in (%MODULES%) do set "JSLIST=!JSLIST!,'%%F'"
if /i "%INCLUDE_RAG%"=="Y" set "JSLIST=!JSLIST!,'rag'"
> "%APP_DIR%\Home\modules.js" echo window.RELEASE_MODULES = [!JSLIST!];
echo   - Home\modules.js: !JSLIST!

REM --- Remove old zip if exists ---
if exist "%OUTPUT%" (
    echo.
    echo Removing old %ZIP_NAME%...
    del "%OUTPUT%"
)

REM --- Create zip using .NET ZipFile (streams to disk, avoids OutOfMemoryException) ---
echo.
echo Creating %ZIP_NAME%...
powershell -NoProfile -Command "Add-Type -Assembly 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::CreateFromDirectory('%STAGE_DIR%\graysWMSwebviewnew', '%OUTPUT%', [System.IO.Compression.CompressionLevel]::Optimal, $true)"
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
echo   2. Open C:\fusion\fusionclientweb\ (create it if needed)
echo   3. Extract zip HERE - creates graysWMSwebviewnew\ inside
echo      Result: C:\fusion\fusionclientweb\graysWMSwebviewnew\
echo   4. Run: C:\fusion\fusionclientweb\graysWMSwebviewnew\dist\WMSApp.exe
echo.

REM --- Show zip size ---
powershell -NoProfile -Command "$size = [math]::Round((Get-Item '%OUTPUT%').Length / 1MB, 2); Write-Host ('Zip size: ' + $size + ' MB')"

goto :cleanup

:error
set "RC=1"
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
%PAUSE_CMD%
exit /b %RC%

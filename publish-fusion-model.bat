@echo off
REM Fusion Model product release: tests, then the server (Windows service) and the MCP server, self-contained
REM win-x64, with the installer and README, zipped into dist-model\. (The WMS app build is release.bat.)
setlocal
cd /d "%~dp0"
set OUT=%~dp0dist-model
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmm"') do set STAMP=%%d

findstr /c:"VendorPublicKey = \"\"" engine\FusionModel\Licensing\Licensing.cs >nul
if not errorlevel 1 (
  echo WARNING: no vendor public key in engine\FusionModel\Licensing\Licensing.cs - this is a DEVELOPMENT build:
  echo          licences cannot be verified and servers run in trial mode. See README "Licence".
  if not "%RELEASE_AUTO%"=="1" pause
)

if exist "%OUT%" rmdir /s /q "%OUT%"
echo [1/4] Tests
dotnet test engine\FusionModel.Tests\FusionModel.Tests.csproj -c Release --nologo || goto :fail
echo [2/4] Server
dotnet publish engine\FusionModel.Server\FusionModel.Server.csproj -c Release -r win-x64 --self-contained true -o "%OUT%\server" --nologo || goto :fail
echo [3/4] MCP server
dotnet publish engine\FusionModel.Mcp\FusionModel.Mcp.csproj -c Release -r win-x64 --self-contained true -o "%OUT%\mcp" --nologo || goto :fail
copy /y engine\FusionModel.Server\install-service.ps1 "%OUT%\server\" >nul
copy /y engine\FusionModel.Server\README.txt "%OUT%\" >nul
for %%F in (server\FusionModel.Server.exe server\FusionModel.dll server\duckdb.dll mcp\FusionModel.Mcp.exe mcp\duckdb.dll server\fusionmodel-server.sample.json) do (
  if not exist "%OUT%\%%F" ( echo MISSING %%F & goto :fail )
)
echo [4/4] Zip
powershell -NoProfile -Command "Compress-Archive -Path '%OUT%\server','%OUT%\mcp','%OUT%\README.txt' -DestinationPath '%OUT%\FusionModel_%STAMP%.zip' -Force" || goto :fail
echo.
echo Done: %OUT%\FusionModel_%STAMP%.zip
exit /b 0
:fail
echo.
echo RELEASE FAILED
exit /b 1

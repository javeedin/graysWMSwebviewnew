# Gray's WMS pipeline server - first-time setup on Windows (laptop or Windows Server)
#   Right-click › Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File setup.ps1
# 1. finds Python 3.11+ (offers to install it with winget)  2. creates .venv and installs the packages
# 3. asks the settings (python -m pipeline_server init)       4. optionally opens the port in the Windows firewall
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Step($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }

Step '1. Python'
$py = $null
foreach ($c in @('py -3.12', 'py -3.11', 'python')) {
    try {
        $v = & cmd /c "$c -c ""import sys; print(sys.version_info >= (3, 11))""" 2>$null
        if ($v -eq 'True') { $py = $c; break }
    } catch { }
}
if (-not $py) {
    Write-Host 'Python 3.11 or newer was not found.' -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $a = Read-Host 'Install Python 3.12 with winget now? (Y/n)'
        if ($a -ne 'n') {
            winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
            $py = 'py -3.12'
        }
    }
    if (-not $py) { throw 'Install Python 3.11+ from https://www.python.org/downloads/ (tick "Add to PATH") and run setup.ps1 again.' }
}
Write-Host "   using: $py"

Step '2. Packages (.venv)'
if (-not (Test-Path .venv\Scripts\python.exe)) { & cmd /c "$py -m venv .venv" }
& .venv\Scripts\python.exe -m pip install --upgrade pip --quiet
& .venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
Write-Host '   installed' -ForegroundColor Green

Step '3. Settings'
& .venv\Scripts\python.exe -m pipeline_server init

Step '4. Test'
& .venv\Scripts\python.exe -m pipeline_server test

$port = (Get-Content data\config.json | ConvertFrom-Json).port
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    $a = Read-Host "Open TCP port $port in the Windows firewall so other PCs (the WMS app) can reach this server? (y/N)"
    if ($a -eq 'y') { New-NetFirewallRule -DisplayName "Grays Pipeline Server $port" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null; Write-Host '   firewall rule added' -ForegroundColor Green }
} else {
    Write-Host "Other PCs need TCP $port open in the firewall (run setup.ps1 as administrator to add the rule)." -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'Done. Start the server:  start-server.bat     Console: http://localhost:'$port'/ui/' -ForegroundColor Green
Write-Host 'Run it in the background at boot:  install-service.ps1 (as administrator)'

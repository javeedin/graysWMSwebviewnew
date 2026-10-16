# Installs (or removes) FusionModel.Server as a Windows service. Run PowerShell as Administrator in the server folder.
#   .\install-service.ps1                 install + start (service account: LocalSystem by default)
#   .\install-service.ps1 -Account "DOMAIN\svc-fusionmodel" -Password "…"   run as a domain account (needed for a \\share)
#   .\install-service.ps1 -Remove
param([string]$Account, [string]$Password, [switch]$Remove, [int]$Port = 5088)
$ErrorActionPreference = 'Stop'
$name = 'FusionModelServer'
$exe = Join-Path $PSScriptRoot 'FusionModel.Server.exe'
if ($Remove) {
    if (Get-Service $name -ErrorAction SilentlyContinue) { Stop-Service $name -ErrorAction SilentlyContinue; sc.exe delete $name | Out-Null; Write-Host "Removed $name" }
    Get-NetFirewallRule -DisplayName 'Fusion Model server' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    return
}
if (-not (Test-Path $exe)) { throw "FusionModel.Server.exe not found next to this script" }
$cfg = Join-Path $PSScriptRoot 'fusionmodel-server.json'
if (-not (Test-Path $cfg)) { Copy-Item (Join-Path $PSScriptRoot 'fusionmodel-server.sample.json') $cfg; Write-Host "Created $cfg - set sharedRoot, then restart the service" }
$params = @{ Name = $name; BinaryPathName = "`"$exe`""; DisplayName = 'Fusion Model server'; Description = 'Fusion Model: the semantic model over HTTP and MCP'; StartupType = 'Automatic' }
if ($Account) { $params.Credential = New-Object PSCredential($Account, (ConvertTo-SecureString $Password -AsPlainText -Force)) }
if (Get-Service $name -ErrorAction SilentlyContinue) { Stop-Service $name; sc.exe delete $name | Out-Null; Start-Sleep 2 }
New-Service @params | Out-Null
sc.exe failure $name reset= 86400 actions= restart/60000/restart/60000/restart/300000 | Out-Null
if (-not (Get-NetFirewallRule -DisplayName 'Fusion Model server' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Fusion Model server' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}
Start-Service $name
Write-Host "Started $name on port $Port. Create a token:  .\FusionModel.Server.exe token add --user <login>"

# Runs the pipeline server in the background, started with Windows and restarted after a crash.
#   powershell -ExecutionPolicy Bypass -File install-service.ps1            (as administrator)
#   -Mode Service  Windows service through NSSM (nssm.exe on the PATH or in .\tools\) - Windows Server
#   -Mode Startup  scheduled task at boot, whether anyone is signed in or not (default when NSSM is missing)
#   -Mode Logon    scheduled task when you sign in - simplest on a laptop, no password needed
# The Fusion / database passwords live in the Windows Credential Manager of the account that ran setup.ps1,
# so the server must run as THAT account (you are asked for its password for Service / Startup).
param([ValidateSet('Service', 'Startup', 'Logon')][string]$Mode = '')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$name = 'GraysPipelineServer'
$py = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { throw 'Run setup.ps1 first.' }
$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
if (-not $nssm -and (Test-Path .\tools\nssm.exe)) { $nssm = (Resolve-Path .\tools\nssm.exe).Path }
if (-not $Mode) { $Mode = if ($nssm) { 'Service' } else { 'Startup' } }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and $Mode -ne 'Logon') { throw 'Run this as administrator (or use -Mode Logon).' }
New-Item -ItemType Directory -Force -Path data\logs | Out-Null

if ($Mode -eq 'Service') {
    if (-not $nssm) { throw 'nssm.exe not found - download it from https://nssm.cc, put nssm.exe in .\tools\ and run again (or use -Mode Startup).' }
    $cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message 'Account the service runs as (the one that ran setup.ps1)'
    & $nssm stop $name 2>$null | Out-Null
    & $nssm remove $name confirm 2>$null | Out-Null
    & $nssm install $name $py '-m' 'pipeline_server' 'run'
    & $nssm set $name AppDirectory $PSScriptRoot
    & $nssm set $name AppEnvironmentExtra "PIPELINE_HOME=$PSScriptRoot\data"
    & $nssm set $name DisplayName "Gray's WMS pipeline server"
    & $nssm set $name Start SERVICE_AUTO_START
    & $nssm set $name AppExit Default Restart
    & $nssm set $name AppRestartDelay 15000
    & $nssm set $name AppStdout "$PSScriptRoot\data\logs\service.log"
    & $nssm set $name AppStderr "$PSScriptRoot\data\logs\service.log"
    & $nssm set $name AppRotateFiles 1
    & $nssm set $name AppRotateBytes 10485760
    & $nssm set $name ObjectName $cred.UserName $cred.GetNetworkCredential().Password
    & $nssm start $name
    Write-Host "Service '$name' installed and started (Services.msc to stop / start)." -ForegroundColor Green
} else {
    $action = New-ScheduledTaskAction -Execute $py -Argument '-m pipeline_server run' -WorkingDirectory $PSScriptRoot
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
    if ($Mode -eq 'Startup') {
        $cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message 'Account the server runs as (the one that ran setup.ps1)'
        $trigger = New-ScheduledTaskTrigger -AtStartup
        Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
    } else {
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    }
    [Environment]::SetEnvironmentVariable('PIPELINE_HOME', "$PSScriptRoot\data", 'User')
    Start-ScheduledTask -TaskName $name
    Write-Host "Scheduled task '$name' registered ($Mode) and started (Task Scheduler to stop / start)." -ForegroundColor Green
}
$port = (Get-Content data\config.json | ConvertFrom-Json).port
Write-Host "Console: http://localhost:$port/ui/"

# Removes the background service / scheduled task installed by install-service.ps1 (as administrator).
$name = 'GraysPipelineServer'
$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
if (-not $nssm -and (Test-Path "$PSScriptRoot\tools\nssm.exe")) { $nssm = "$PSScriptRoot\tools\nssm.exe" }
if ($nssm) { & $nssm stop $name 2>$null | Out-Null; & $nssm remove $name confirm 2>$null | Out-Null }
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $name; Unregister-ScheduledTask -TaskName $name -Confirm:$false }
Write-Host 'Removed.'

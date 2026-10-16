@echo off
rem ============================================================================
rem  Gray's WMS - Claude CLI setup / repair (ClaudeCliSetup.bat)
rem  Installs and checks everything the AI Digital Employee needs on this PC:
rem    1. who runs it (Claude is installed for THIS Windows user)
rem    2. internet access to claude.ai
rem    3. Git for Windows (Claude Code needs Git Bash on Windows) - installed with winget if missing
rem    4. Claude Code (Claude CLI) - official installer https://claude.ai/install.ps1, npm as fallback
rem    5. PATH (%USERPROFILE%\.local\bin) and CLAUDE_CODE_GIT_BASH_PATH for this user
rem    6. test: claude --version and a real question (opens the sign-in when needed)
rem  Run it as the Windows user who runs Gray's WMS (double-click). Admin is only
rem  needed if Git must be installed - Windows asks for it then.
rem  Log: %TEMP%\GraysWMS\claude-cli-setup.log
rem  The PowerShell part (after the PSSTART marker line) is read and run by this file.
rem ============================================================================
setlocal
title Gray's WMS - Claude CLI setup
set "GRAYS_SETUP_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:GRAYS_SETUP_SELF); $i=$s.IndexOf('#PSSTART'+'#'); Invoke-Expression $s.Substring($i)"
echo.
pause
exit /b
#PSSTART#
$ErrorActionPreference = 'Continue'
$logDir = Join-Path $env:TEMP 'GraysWMS'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'claude-cli-setup.log'
try { Start-Transcript -Path $log -Append | Out-Null } catch { }
function Step($t) { Write-Host ''; Write-Host ('== ' + $t) -ForegroundColor Cyan }
function Ok($t)   { Write-Host ('   [OK] ' + $t) -ForegroundColor Green }
function Warn($t) { Write-Host ('   [!]  ' + $t) -ForegroundColor Yellow }
function Bad($t)  { Write-Host ('   [X]  ' + $t) -ForegroundColor Red }
$summary = @()

Write-Host ''
Write-Host '  Gray''s WMS - Claude CLI setup / repair' -ForegroundColor White
Write-Host ('  ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '   log: ' + $log) -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. user
Step '1. Windows user'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$console = $null
try { $console = (Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).UserName } catch { }
Write-Host ('   Running as ' + $me + '   (administrator: ' + $isAdmin + ')')
Write-Host ('   Profile:   ' + $env:USERPROFILE)
if ($console) { Write-Host ('   Signed in: ' + $console) }
if ($console -and ($console -ne $me)) {
    Warn ('This window runs as ' + $me + ' but ' + $console + ' is signed in.')
    Warn ('Claude is installed for ' + $me + '. If Gray''s WMS runs as ' + $console + ', close this and double-click the file as ' + $console + ' (no "Run as administrator").')
    $summary += 'Different user: installed for ' + $me
} else { Ok 'Installing for this user.' }

# ---------------------------------------------------------------- 2. internet
Step '2. Internet access'
$net = $true
foreach ($u in @('https://claude.ai/install.ps1', 'https://api.anthropic.com')) {
    try {
        $r = Invoke-WebRequest -Uri $u -UseBasicParsing -Method Head -TimeoutSec 20 -ErrorAction Stop
        Ok ($u + ' reachable')
    } catch {
        $code = $null
        try { $code = [int]$_.Exception.Response.StatusCode } catch { }
        if ($code) { Ok ($u + ' reachable (HTTP ' + $code + ')') }
        else { Bad ($u + ' not reachable: ' + $_.Exception.Message); $net = $false }
    }
}
if (-not $net) { Warn 'Ask IT to allow claude.ai, downloads.claude.ai, storage.googleapis.com and api.anthropic.com (proxy / firewall).'; $summary += 'Internet access blocked' }

# ---------------------------------------------------------------- 3. git bash
Step '3. Git for Windows (Claude Code needs Git Bash)'
function Find-Bash {
    $c = @($env:CLAUDE_CODE_GIT_BASH_PATH, (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe'))
    $g = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($g) { $c += (Join-Path (Split-Path (Split-Path $g.Source)) 'bin\bash.exe') }
    foreach ($p in $c) { if ($p -and (Test-Path $p)) { return (Resolve-Path $p).Path } }
    return $null
}
$bash = Find-Bash
if (-not $bash) {
    Warn 'Git for Windows is not installed - installing it now (Windows may ask for permission).'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --silent
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
        $bash = Find-Bash
    } else {
        Bad 'winget is not available on this PC.'
    }
}
if ($bash) {
    Ok ('Git Bash: ' + $bash)
    [Environment]::SetEnvironmentVariable('CLAUDE_CODE_GIT_BASH_PATH', $bash, 'User')
    $env:CLAUDE_CODE_GIT_BASH_PATH = $bash
} else {
    Bad 'Git Bash is missing. Install Git from https://git-scm.com/download/win and run this file again.'
    $summary += 'Git for Windows missing'
}

# ---------------------------------------------------------------- 4. claude
Step '4. Claude Code (Claude CLI)'
$bin = Join-Path $env:USERPROFILE '.local\bin'
$npmDir = Join-Path $env:APPDATA 'npm'
function Find-Claude {
    $exe = Join-Path $bin 'claude.exe'
    if (Test-Path $exe) { return $exe }
    $cmd = Get-Command claude -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $n = Join-Path $npmDir 'claude.cmd'
    if (Test-Path $n) { return $n }
    return $null
}
$claude = Find-Claude
if ($claude) {
    Ok ('Already installed: ' + $claude)
} else {
    Write-Host '   Installing with the official installer (https://claude.ai/install.ps1) ...'
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } catch { Bad ('The installer failed: ' + $_.Exception.Message) }
    $claude = Find-Claude
    if (-not $claude -and (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host '   Trying npm (Node.js is installed) ...'
        npm install -g @anthropic-ai/claude-code
        $claude = Find-Claude
    }
    if ($claude) { Ok ('Installed: ' + $claude) } else { Bad 'Claude CLI could not be installed.'; $summary += 'Claude CLI not installed' }
}

# ---------------------------------------------------------------- 5. path
Step '5. PATH'
foreach ($dir in @($bin, $npmDir)) {
    if (-not (Test-Path $dir)) { continue }
    if ($dir -eq $npmDir -and -not (Test-Path (Join-Path $npmDir 'claude.cmd'))) { continue }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($userPath -split ';' | Where-Object { $_ -and $_.Trim() })
    if ($parts -contains $dir) { Ok ($dir + ' is on your PATH') }
    else {
        [Environment]::SetEnvironmentVariable('Path', (($parts + $dir) -join ';'), 'User')
        Ok ('Added ' + $dir + ' to your PATH')
    }
    if (-not (($env:Path -split ';') -contains $dir)) { $env:Path += ';' + $dir }
}

# ---------------------------------------------------------------- 6. test
Step '6. Test'
$works = $false
function Ask-Claude($exe) {
    $job = Start-Job -ScriptBlock { param($c) & $c -p 'Reply with the single word OK' 2>&1 | Out-String } -ArgumentList $exe
    if (Wait-Job $job -Timeout 150) { $out = Receive-Job $job } else { Stop-Job $job; $out = 'no answer within 150 s' }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    return [string]$out
}
if ($claude) {
    $v = (& $claude --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $v) { Ok ('claude --version: ' + $v) } else { Bad ('claude --version failed: ' + $v) }
    Write-Host '   Asking Claude a test question (checks the sign-in) ...'
    $t = Ask-Claude $claude
    if ($t -match '\bOK\b') { Ok 'Claude answered - signed in and working.'; $works = $true }
    else {
        Warn ('Claude did not answer yet: ' + (($t.Trim() -split "`n")[0]))
        Write-Host ''
        Write-Host '   Claude starts now. Sign in (your browser opens), then type /exit to come back.' -ForegroundColor Yellow
        Write-Host ''
        & $claude
        $t = Ask-Claude $claude
        if ($t -match '\bOK\b') { Ok 'Claude answered - signed in and working.'; $works = $true }
        else { Bad ('Claude still does not answer: ' + (($t.Trim() -split "`n")[0])); $summary += 'Claude does not answer (sign-in?)' }
    }
}

# ---------------------------------------------------------------- summary
Step 'Summary'
if ($works) {
    Ok 'Claude CLI is ready for the AI Digital Employee.'
    Write-Host '   In Gray''s WMS click "Check again" on the AI page (or restart the app).' -ForegroundColor Green
} else {
    Bad 'Not ready yet:'
    foreach ($s in $summary) { Write-Host ('      - ' + $s) -ForegroundColor Red }
    Write-Host ('   Send the log to support: ' + $log) -ForegroundColor Yellow
}
try { Stop-Transcript | Out-Null } catch { }

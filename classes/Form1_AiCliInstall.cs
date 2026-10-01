using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// AI Digital Employee › "Install Claude CLI": opens a visible PowerShell window that installs Claude Code with
    /// Anthropic's official Windows installer (irm https://claude.ai/install.ps1 | iex; npm as a fallback when Node is
    /// there), then runs "claude" once so the user signs in. Nothing is installed silently; the page polls aiCliStatus
    /// and ClaudeCliService.RefreshCliPath() lets this running app find the new CLI without a restart.
    /// </summary>
    public partial class Form1
    {
        private const string CLAUDE_INSTALL_SCRIPT = @"$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = ""Gray's WMS - install Claude CLI""
function Find-Claude {
    $bin = Join-Path $env:USERPROFILE '.local\bin'
    if (Test-Path $bin) { $env:Path = ""$bin;$env:Path"" }
    $npm = Join-Path $env:APPDATA 'npm'
    if (Test-Path $npm) { $env:Path = ""$npm;$env:Path"" }
    return [bool](Get-Command claude -ErrorAction SilentlyContinue)
}
Write-Host ''
Write-Host '  Installing Claude Code (Claude CLI) for' $env:USERNAME -ForegroundColor Cyan
Write-Host '  Source: https://claude.ai/install.ps1 (Anthropic official installer)' -ForegroundColor DarkGray
Write-Host ''
if (-not (Find-Claude)) {
    try { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression }
    catch { Write-Host ('  The installer could not run: ' + $_) -ForegroundColor Yellow }
}
if (-not (Find-Claude) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host '  Trying npm (Node.js is installed) ...' -ForegroundColor Cyan
    npm install -g @anthropic-ai/claude-code
}
if (Find-Claude) {
    Write-Host ''
    claude --version
    Write-Host ''
    Write-Host '  Claude CLI is installed.' -ForegroundColor Green
    Write-Host '  Now sign in once: Claude starts below. Follow the login (it opens your browser),' -ForegroundColor Green
    Write-Host '  then type /exit to come back here.' -ForegroundColor Green
    Write-Host ''
    claude
    Write-Host ''
    Write-Host '  Done - go back to Gray''s WMS; the AI page picks the CLI up by itself.' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host '  Claude CLI could not be installed automatically.' -ForegroundColor Red
    Write-Host '  Check the internet / proxy access to claude.ai, or install it by hand:' -ForegroundColor Red
    Write-Host '  https://docs.claude.com/en/docs/claude-code/setup'
}
Write-Host ''
Read-Host '  Press Enter to close this window'
";

        private void HandleAiCliInstall(WebView2 wv, string requestId)
        {
            bool ok = true; string error = null;
            try
            {
                string dir = Path.Combine(Path.GetTempPath(), "GraysWMS");
                Directory.CreateDirectory(dir);
                string script = Path.Combine(dir, "install-claude-cli.ps1");
                File.WriteAllText(script, CLAUDE_INSTALL_SCRIPT, new System.Text.UTF8Encoding(true));
                Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"",
                    UseShellExecute = true,
                    WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                });
            }
            catch (Exception ex) { ok = false; error = ex.Message; Debug.WriteLine("[AiCliInstall] " + ex); }
            // the AI page hands the whole message to its callback, so the fields sit at the top level
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "aiCliInstallResponse", requestId, ok, error }));
        }
    }
}

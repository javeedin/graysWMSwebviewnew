using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// AI Digital Employee › Claude CLI setup. The setup file tools/claude-cli-setup.bat is embedded in the app
    /// (resource "ClaudeCliSetup.bat") — one file that checks the user, internet access, Git for Windows (installed
    /// with winget if missing — Claude Code needs Git Bash), installs Claude Code with the official installer
    /// (npm fallback), fixes the PATH / CLAUDE_CODE_GIT_BASH_PATH and tests a real answer (opening the sign-in).
    ///   aiCliInstall  → writes it to %TEMP%\GraysWMS and runs it in a visible console
    ///   aiCliSaveBat  → saves ClaudeCliSetup.bat to the user's Downloads folder and shows it (run by user or admin)
    ///   aiCliDiagnose → the same checks done here, without installing anything; test=true also asks Claude "OK"
    /// Nothing is installed silently. ClaudeCliService.RefreshCliPath() lets the running app find a new CLI.
    /// </summary>
    public partial class Form1
    {
        private static string ClaudeSetupBat()
        {
            using var s = typeof(Form1).Assembly.GetManifestResourceStream("ClaudeCliSetup.bat");
            if (s == null) throw new InvalidOperationException("The Claude CLI setup file is missing from this build.");
            using var r = new StreamReader(s, Encoding.UTF8);
            // cmd.exe wants CRLF; the repo may hold LF
            return r.ReadToEnd().Replace("\r\n", "\n").Replace("\n", "\r\n");
        }

        private static string WriteClaudeSetupBat(string folder)
        {
            Directory.CreateDirectory(folder);
            string path = Path.Combine(folder, "ClaudeCliSetup.bat");
            File.WriteAllText(path, ClaudeSetupBat(), new UTF8Encoding(false));
            return path;
        }

        private void HandleAiCliInstall(WebView2 wv, string requestId)
        {
            bool ok = true; string error = null, path = null;
            try
            {
                path = WriteClaudeSetupBat(Path.Combine(Path.GetTempPath(), "GraysWMS"));
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c \"\"" + path + "\"\"",
                    UseShellExecute = true,
                    WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                });
            }
            catch (Exception ex) { ok = false; error = ex.Message; Debug.WriteLine("[AiCliInstall] " + ex); }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "aiCliInstallResponse", requestId, ok, error, path }));
        }

        private void HandleAiCliSaveBat(WebView2 wv, string requestId)
        {
            bool ok = true; string error = null, path = null;
            try
            {
                string downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                if (!Directory.Exists(downloads)) downloads = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                path = WriteClaudeSetupBat(downloads);
                Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + path + "\"") { UseShellExecute = true });
            }
            catch (Exception ex) { ok = false; error = ex.Message; Debug.WriteLine("[AiCliSaveBat] " + ex); }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "aiCliSaveBatResponse", requestId, ok, error, path }));
        }

        /// <summary>Opens Claude in a console so the user signs in (then /exit).</summary>
        private void HandleAiCliLogin(WebView2 wv, string requestId)
        {
            bool ok = true; string error = null;
            try
            {
                ClaudeCliService.RefreshCliPath();
                string native = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");
                string exe = File.Exists(native) ? "\"" + native + "\"" : "claude";
                Process.Start(new ProcessStartInfo("cmd.exe", "/k \"title Sign in to Claude & echo Sign in (your browser opens), then type /exit and close this window. & echo. & " + exe + "\"")
                { UseShellExecute = true, WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) });
            }
            catch (Exception ex) { ok = false; error = ex.Message; }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "aiCliLoginResponse", requestId, ok, error }));
        }

        /// <summary>Runs a program (no window) and returns exit code + output, or (-1, message) on timeout / failure.</summary>
        private static async Task<(int Code, string Output)> RunQuietAsync(string file, string args, int timeoutMs)
        {
            try
            {
                var psi = new ProcessStartInfo(file, args)
                {
                    RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
                    UseShellExecute = false, CreateNoWindow = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                    WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                };
                using var p = Process.Start(psi);
                p.StandardInput.Close();
                var o = p.StandardOutput.ReadToEndAsync();
                var e = p.StandardError.ReadToEndAsync();
                var done = await Task.WhenAny(Task.WhenAll(o, e, p.WaitForExitAsync()), Task.Delay(timeoutMs));
                if (!p.HasExited) { try { p.Kill(true); } catch { } return (-1, "no answer within " + timeoutMs / 1000 + " s"); }
                return (p.ExitCode, ((await o) + "\n" + (await e)).Trim());
            }
            catch (Exception ex) { return (-1, ex.Message); }
        }

        private async Task HandleAiCliDiagnose(WebView2 wv, JsonElement root, string requestId)
        {
            var checks = new List<object>();
            void Add(string name, string state, string detail, string fix = null) => checks.Add(new { name, state, detail, fix });
            try
            {
                ClaudeCliService.RefreshCliPath();
                string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                Add("Windows user", "ok", Environment.UserDomainName + "\\" + Environment.UserName + " — " + profile);

                // Claude CLI location
                string native = Path.Combine(profile, ".local", "bin", "claude.exe");
                string npm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "claude.cmd");
                var (wc, wout) = await RunQuietAsync("where.exe", "claude", 15000);
                string found = File.Exists(native) ? native : File.Exists(npm) ? npm : (wc == 0 ? wout.Split('\n')[0].Trim() : null);
                if (found == null) Add("Claude CLI installed", "bad", "claude.exe not found (" + native + ")", "install");
                else Add("Claude CLI installed", "ok", found);

                // PATH
                string userPath = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "";
                string dir = found != null ? Path.GetDirectoryName(found) : null;
                if (dir != null)
                {
                    bool onPath = Array.Exists(userPath.Split(';'), x => string.Equals(x.Trim().TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                        || Array.Exists((Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "").Split(';'), x => string.Equals(x.Trim().TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase));
                    Add("Claude CLI on the PATH", onPath ? "ok" : "warn", onPath ? dir : dir + " is not on the user PATH (this app finds it anyway; other windows do not)", onPath ? null : "install");
                }

                // Git Bash
                string bash = Environment.GetEnvironmentVariable("CLAUDE_CODE_GIT_BASH_PATH");
                if (string.IsNullOrEmpty(bash) || !File.Exists(bash))
                {
                    foreach (var c in new[] {
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Git", "bin", "bash.exe"),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Git", "bin", "bash.exe"),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Git", "bin", "bash.exe") })
                        if (File.Exists(c)) { bash = c; break; }
                }
                if (string.IsNullOrEmpty(bash) || !File.Exists(bash)) Add("Git for Windows (Git Bash)", "bad", "Not found — Claude Code needs Git Bash on Windows", "install");
                else Add("Git for Windows (Git Bash)", "ok", bash);

                // version + a real answer
                if (found != null)
                {
                    var (vc, vout) = await RunQuietAsync("cmd.exe", "/c \"\"" + found + "\" --version\"", 30000);
                    Add("claude --version", vc == 0 ? "ok" : "bad", string.IsNullOrWhiteSpace(vout) ? "exit " + vc : vout.Split('\n')[0].Trim(), vc == 0 ? null : "install");
                    if (root.TryGetProperty("test", out var t) && t.ValueKind == JsonValueKind.True && vc == 0)
                    {
                        var (ac, aout) = await RunQuietAsync("cmd.exe", "/c \"\"" + found + "\" -p \"Reply with the single word OK\"\"", 150000);
                        bool answered = ac == 0 && System.Text.RegularExpressions.Regex.IsMatch(aout ?? "", @"\bOK\b");
                        Add("Claude answers (signed in)", answered ? "ok" : "bad",
                            answered ? "Claude replied OK" : (string.IsNullOrWhiteSpace(aout) ? "exit " + ac : aout.Split('\n')[0].Trim()), answered ? null : "login");
                    }
                }
            }
            catch (Exception ex) { Add("Checks", "bad", ex.Message); }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "aiCliDiagnoseResponse", requestId, ok = true, checks }));
        }
    }
}

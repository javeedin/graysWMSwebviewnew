using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Admin module (admin/index.html) — "Create ZIP file" runs release.bat in a visible
    /// PowerShell console (unattended: RELEASE_AUTO=1) and tees its output to a log the page
    /// polls, so the page can show the build stages while the console shows every line.
    /// Replies: { action: "adminResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private Process _adminReleaseProc;
        private string _adminReleaseLog;
        private DateTime _adminReleaseStarted;
        private int? _adminReleaseExit;
        private string _adminReleaseRepo;

        private static string AdminSettingsFile => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "admin.json");

        private static bool IsAdminAction(string action) =>
            action != null && action.StartsWith("admin", StringComparison.Ordinal);

        private void HandleAdminAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                switch (action)
                {
                    case "adminReleaseInfo":
                        data = AdminReleaseInfo();
                        break;
                    case "adminPickRepo":
                        {
                            using var dlg = new FolderBrowserDialog { Description = "Select the graysWMSwebviewnew repository folder (the one with release.bat)", UseDescriptionForTitle = true };
                            var cur = AdminRepoRoot();
                            if (cur != null) dlg.SelectedPath = cur;
                            if (dlg.ShowDialog(this) == DialogResult.OK)
                            {
                                if (!IsReleaseRepo(dlg.SelectedPath)) { data = new { ok = false, error = "That folder has no release.bat / WMSApp.csproj." }; break; }
                                Directory.CreateDirectory(Path.GetDirectoryName(AdminSettingsFile));
                                File.WriteAllText(AdminSettingsFile, JsonSerializer.Serialize(new { repoRoot = dlg.SelectedPath }));
                            }
                            data = AdminReleaseInfo();
                            break;
                        }
                    case "adminCreateZip":
                        data = AdminStartRelease(
                            root.TryGetProperty("includeRag", out var r) && r.ValueKind == JsonValueKind.True,
                            root.TryGetProperty("comment", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : "");
                        break;
                    case "adminReleaseStatus":
                        data = AdminReleaseStatus();
                        break;
                    case "adminOpenFolder":
                        {
                            var repo = AdminRepoRoot();
                            string zip = repo == null ? null : Path.Combine(repo, "fusionclientweb.zip");
                            if (zip != null && File.Exists(zip)) Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + zip + "\"") { UseShellExecute = true });
                            else if (repo != null) Process.Start(new ProcessStartInfo("explorer.exe", "\"" + repo + "\"") { UseShellExecute = true });
                            data = new { ok = repo != null };
                            break;
                        }
                    case "adminOpenLog":
                        if (_adminReleaseLog != null && File.Exists(_adminReleaseLog)) Process.Start(new ProcessStartInfo("notepad.exe", "\"" + _adminReleaseLog + "\"") { UseShellExecute = true });
                        data = new { ok = _adminReleaseLog != null };
                        break;
                    default:
                        data = new { ok = false, error = "Unknown admin action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Admin] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "adminResponse", requestId, data }));
        }

        private static bool IsReleaseRepo(string dir) =>
            !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "release.bat")) && File.Exists(Path.Combine(dir, "WMSApp.csproj"));

        /// <summary>Saved choice first, then the usual repo locations, then up from the exe.</summary>
        private string AdminRepoRoot()
        {
            try
            {
                if (File.Exists(AdminSettingsFile))
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(AdminSettingsFile));
                    if (doc.RootElement.TryGetProperty("repoRoot", out var p) && IsReleaseRepo(p.GetString())) return p.GetString();
                }
            }
            catch (Exception ex) { Debug.WriteLine("[Admin] settings: " + ex.Message); }

            var candidates = new[]
            {
                @"C:\fusion\fusionclientweb\graysWMSwebviewnew",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "source", "repos", "javeedin", "graysWMSwebviewnew"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "source", "repos", "graysWMSwebviewnew"),
            };
            foreach (var c in candidates) if (IsReleaseRepo(c)) return c;
            for (var d = Path.GetDirectoryName(Application.ExecutablePath); !string.IsNullOrEmpty(d); d = Path.GetDirectoryName(d))
                if (IsReleaseRepo(d)) return d;
            return null;
        }

        private static string AdminVersion(string repo)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(repo, "version.json")));
                return doc.RootElement.TryGetProperty("version", out var v) ? v.GetString() : null;
            }
            catch { return null; }
        }

        private static object AdminZipInfo(string repo)
        {
            var f = new FileInfo(Path.Combine(repo, "fusionclientweb.zip"));
            return f.Exists ? new { path = f.FullName, sizeMb = Math.Round(f.Length / 1048576.0, 1), modified = f.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss") } : null;
        }

        private object AdminReleaseInfo()
        {
            var repo = AdminRepoRoot();
            bool dotnet = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')
                .Any(p => { try { return File.Exists(Path.Combine(p.Trim(), "dotnet.exe")); } catch { return false; } });
            return new
            {
                ok = true,
                repoRoot = repo,
                version = repo == null ? null : AdminVersion(repo),
                zip = repo == null ? null : AdminZipInfo(repo),
                dotnet,
                ragExe = repo != null && File.Exists(Path.Combine(repo, "rag", "dist", "rag_service", "rag_service.exe")),
                running = _adminReleaseProc != null && !_adminReleaseProc.HasExited,
                exe = Application.ExecutablePath
            };
        }

        private object AdminStartRelease(bool includeRag, string comment)
        {
            if (_adminReleaseProc != null && !_adminReleaseProc.HasExited) return new { ok = false, error = "A build is already running — see its console window." };
            var repo = AdminRepoRoot();
            if (repo == null) return new { ok = false, error = "Repository folder not found. Use 'Change folder' to pick the folder with release.bat." };

            string dir = Path.Combine(Path.GetTempPath(), "GraysWMS", "release");
            Directory.CreateDirectory(dir);
            string stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
            _adminReleaseLog = Path.Combine(dir, "release_" + stamp + ".log");
            string script = Path.Combine(dir, "create_zip_" + stamp + ".ps1");
            string ps(string s) => "'" + (s ?? "").Replace("'", "''") + "'";
            comment = string.IsNullOrWhiteSpace(comment) ? "Release " + (AdminVersion(repo) ?? "") : comment.Replace("\r", " ").Replace("\n", " ");

            // The console the user watches. release.bat runs unattended and builds into dist-release\
            // (the running app locks its own dist\); cmd does the 2>&1 so PowerShell shows plain lines.
            var sb = new StringBuilder();
            sb.AppendLine("$Host.UI.RawUI.WindowTitle = \"Gray's WMS - Create ZIP file\"");
            sb.AppendLine("Set-Location -LiteralPath " + ps(repo));
            sb.AppendLine("$env:RELEASE_AUTO = '1'");
            sb.AppendLine("$env:INCLUDE_RAG = " + ps(includeRag ? "Y" : "N"));
            sb.AppendLine("$env:VERSION_COMMENT = " + ps(comment));
            sb.AppendLine("$env:DIST_OUT = 'dist-release'");
            sb.AppendLine("Write-Host ''; Write-Host '  Gray''s WMS - Create ZIP file' -ForegroundColor Cyan; Write-Host ('  Repository: ' + (Get-Location)) -ForegroundColor DarkGray; Write-Host ''");
            sb.AppendLine("cmd.exe /c \"release.bat 2>&1\" | Tee-Object -FilePath " + ps(_adminReleaseLog));
            sb.AppendLine("$rc = $LASTEXITCODE");
            sb.AppendLine("Set-Content -LiteralPath " + ps(_adminReleaseLog + ".exit") + " -Value $rc");   // page learns the result before Enter
            sb.AppendLine("Write-Host ''");
            sb.AppendLine("if ($rc -eq 0) { Write-Host '  ==== DONE - fusionclientweb.zip is ready ====' -ForegroundColor Green } else { Write-Host ('  ==== FAILED (exit code ' + $rc + ') - see the messages above ====') -ForegroundColor Red }");
            sb.AppendLine("Write-Host ''; Read-Host '  Press Enter to close this window' | Out-Null");
            sb.AppendLine("exit $rc");
            File.WriteAllText(script, sb.ToString(), new UTF8Encoding(true));

            _adminReleaseRepo = repo;
            _adminReleaseExit = null;
            _adminReleaseStarted = DateTime.Now;
            _adminReleaseProc = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"")
            {
                UseShellExecute = true,               // own, visible console window
                WorkingDirectory = repo
            });
            if (_adminReleaseProc == null) return new { ok = false, error = "Could not start PowerShell." };
            _adminReleaseProc.EnableRaisingEvents = true;
            _adminReleaseProc.Exited += (s, e) => { try { _adminReleaseExit = _adminReleaseProc.ExitCode; } catch { _adminReleaseExit = -1; } };
            return new { ok = true, log = _adminReleaseLog, repoRoot = repo, startedAt = _adminReleaseStarted.ToString("HH:mm:ss") };
        }

        private object AdminReleaseStatus()
        {
            if (_adminReleaseLog == null) return new { ok = true, state = "idle" };
            string text = "";
            try
            {
                if (File.Exists(_adminReleaseLog))
                    using (var fs = new FileStream(_adminReleaseLog, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var rd = new StreamReader(fs, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
                        text = rd.ReadToEnd();
            }
            catch (Exception ex) { Debug.WriteLine("[Admin] log read: " + ex.Message); }

            var lines = text.Replace("\r", "").Split('\n').Where(l => l.Trim().Length > 0).ToList();
            bool running = _adminReleaseProc != null && !_adminReleaseProc.HasExited;
            // The console stays open ("Press Enter") after release.bat ends, so "done" is read from the log
            if (!_adminReleaseExit.HasValue && File.Exists(_adminReleaseLog + ".exit")
                && int.TryParse(File.ReadAllText(_adminReleaseLog + ".exit").Trim(), out var rcFile)) _adminReleaseExit = rcFile;
            string state = _adminReleaseExit.HasValue ? (_adminReleaseExit == 0 ? "done" : "failed")
                         : text.Contains("DONE - fusionclientweb.zip is ready") ? "done"
                         : running ? "running" : "failed";
            return new
            {
                ok = true,
                state,
                exitCode = _adminReleaseExit,
                elapsedSec = (int)(DateTime.Now - _adminReleaseStarted).TotalSeconds,
                consoleOpen = running,
                tail = lines.Skip(Math.Max(0, lines.Count - 14)).ToArray(),
                errors = lines.Where(l => l.Contains("ERROR") || l.Contains(" error ")).Take(8).ToArray(),
                marks = new
                {
                    rag = text.Contains("STEP 1 - Building RAG"),
                    build = text.Contains("Building distribution folder") || text.Contains("Publishing project"),
                    published = text.Contains("Publish completed successfully"),
                    verified = text.Contains("Verified: GraysWMS"),
                    package = text.Contains("Packaging into fusionclientweb.zip"),
                    zipped = text.Contains("SUCCESS: fusionclientweb.zip created"),
                    done = text.Contains("DONE - fusionclientweb.zip is ready")
                },
                zip = _adminReleaseRepo == null ? null : AdminZipInfo(_adminReleaseRepo),
                log = _adminReleaseLog
            };
        }
    }
}

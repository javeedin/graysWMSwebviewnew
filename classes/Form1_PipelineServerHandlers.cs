using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Local pipeline server control (Fusion SQL › Pipelines › "This PC" panel): finds the pipeline-server
    /// folder on this PC, runs setup.ps1 / install-service.ps1 in a visible console, starts the server in the
    /// background (python -m pipeline_server run|demo, output appended to data\logs\server.log), stops it
    /// gracefully (data\stop.request → runs cancelled at their next page, re-queued at the next start) or kills
    /// it, tails the log and makes a new API token for "Connect this app".
    /// Works with the Windows service (NSSM) / scheduled task that install-service.ps1 creates.
    /// Replies: { action: "pipeSrvResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private Process _pipeSrvProc;
        private DateTime _pipeSrvAutoCheck;
        private string _pipeSrvAutoKind;

        private const string PIPE_SRV_NAME = "GraysPipelineServer";

        private static string PipeSrvSettingsFile => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "pipeline_server.json");

        private static bool IsPipeSrvAction(string action) =>
            action != null && action.StartsWith("pipeSrv", StringComparison.Ordinal);

        private async Task HandlePipeSrvAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                string dir = PipeSrvFolder();
                switch (action)
                {
                    case "pipeSrvStatus":
                        data = PipeSrvStatus(dir, PipeSrvInt(root, "lines", 80));
                        break;
                    case "pipeSrvPickFolder":
                        {
                            using var dlg = new FolderBrowserDialog { Description = "Select the pipeline-server folder (the one with setup.ps1 and the pipeline_server folder)", UseDescriptionForTitle = true };
                            if (dir != null) dlg.SelectedPath = dir;
                            if (dlg.ShowDialog(this) == DialogResult.OK)
                            {
                                if (!IsPipeSrvFolder(dlg.SelectedPath)) { data = new { ok = false, error = "That folder has no pipeline_server\\__main__.py — pick the pipeline-server folder." }; break; }
                                Directory.CreateDirectory(Path.GetDirectoryName(PipeSrvSettingsFile));
                                File.WriteAllText(PipeSrvSettingsFile, JsonSerializer.Serialize(new { folder = dlg.SelectedPath }));
                                dir = dlg.SelectedPath;
                            }
                            data = PipeSrvStatus(dir, 80);
                            break;
                        }
                    case "pipeSrvSetup":
                        data = PipeSrvConsole(dir, "setup.ps1", "", false);
                        break;
                    case "pipeSrvInstallService":
                        {
                            string mode = PipeSrvStr(root, "mode");
                            if (mode != "Service" && mode != "Startup" && mode != "Logon") mode = "Logon";
                            // Logon needs no administrator; Service / Startup do
                            data = PipeSrvConsole(dir, "install-service.ps1", "-Mode " + mode, mode != "Logon");
                            break;
                        }
                    case "pipeSrvUninstallService":
                        data = PipeSrvConsole(dir, "uninstall-service.ps1", "", true);
                        break;
                    case "pipeSrvStart":
                        data = PipeSrvStart(dir, root.TryGetProperty("demo", out var demo) && demo.ValueKind == JsonValueKind.True);
                        break;
                    case "pipeSrvStop":
                        data = await PipeSrvStopAsync(dir, root.TryGetProperty("force", out var f) && f.ValueKind == JsonValueKind.True);
                        break;
                    case "pipeSrvNewToken":
                        data = await PipeSrvNewTokenAsync(dir);
                        break;
                    case "pipeSrvOpenFolder":
                        if (dir != null) Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
                        data = new { ok = dir != null };
                        break;
                    case "pipeSrvOpenLog":
                        {
                            string log = dir == null ? null : PipeSrvLogFile(dir);
                            if (log != null && File.Exists(log)) Process.Start(new ProcessStartInfo("notepad.exe", "\"" + log + "\"") { UseShellExecute = true });
                            data = new { ok = log != null && File.Exists(log) };
                            break;
                        }
                    default:
                        data = new { ok = false, error = "Unknown pipeline server action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[PipeSrv] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "pipeSrvResponse", requestId, data }));
        }

        // ── folder ─────────────────────────────────────────────
        private static bool IsPipeSrvFolder(string dir) =>
            !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "pipeline_server", "__main__.py"));

        /// <summary>Saved choice, then next to the source repo, up from the exe, then the usual places.</summary>
        private string PipeSrvFolder()
        {
            try
            {
                if (File.Exists(PipeSrvSettingsFile))
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(PipeSrvSettingsFile));
                    if (doc.RootElement.TryGetProperty("folder", out var p) && p.ValueKind == JsonValueKind.String && IsPipeSrvFolder(p.GetString())) return p.GetString();
                }
            }
            catch (Exception ex) { Debug.WriteLine("[PipeSrv] settings: " + ex.Message); }

            var list = new List<string>();
            try { var repo = AdminRepoRoot(); if (repo != null) list.Add(Path.Combine(repo, "pipeline-server")); } catch { }
            for (var d = Path.GetDirectoryName(Application.ExecutablePath); !string.IsNullOrEmpty(d); d = Path.GetDirectoryName(d))
                list.Add(Path.Combine(d, "pipeline-server"));
            list.Add(@"C:\pipeline-server");
            list.Add(@"C:\fusion\pipeline-server");
            list.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "pipeline-server"));
            return list.FirstOrDefault(IsPipeSrvFolder);
        }

        private static string PipeSrvHome(string dir)
        {
            // install-service.ps1 sets PIPELINE_HOME=<folder>\data for the account; the default is the same folder
            var env = Environment.GetEnvironmentVariable("PIPELINE_HOME", EnvironmentVariableTarget.Process)
                      ?? Environment.GetEnvironmentVariable("PIPELINE_HOME", EnvironmentVariableTarget.User);
            return !string.IsNullOrWhiteSpace(env) && Directory.Exists(env) ? env : Path.Combine(dir, "data");
        }
        private static string PipeSrvLogFile(string dir) => Path.Combine(PipeSrvHome(dir), "logs", "server.log");
        private static string PipeSrvPython(string dir) => Path.Combine(dir, ".venv", "Scripts", "python.exe");

        // ── status ─────────────────────────────────────────────
        private object PipeSrvStatus(string dir, int lines)
        {
            if (dir == null)
                return new { ok = true, found = false, searched = new[] { "next to the source repo", "up from the app folder", @"C:\pipeline-server", @"C:\fusion\pipeline-server", "%USERPROFILE%\\pipeline-server" } };
            string home = PipeSrvHome(dir);
            bool venv = File.Exists(PipeSrvPython(dir));
            string cfgPath = Path.Combine(home, "config.json");
            JsonElement? cfg = null;
            try { if (File.Exists(cfgPath)) cfg = JsonDocument.Parse(File.ReadAllText(cfgPath)).RootElement.Clone(); } catch { }
            int port = 8000;
            if (cfg.HasValue && cfg.Value.TryGetProperty("port", out var pp) && pp.TryGetInt32(out var pv)) port = pv;
            string S(string k) => cfg.HasValue && cfg.Value.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            string Sub(string o, string k) => cfg.HasValue && cfg.Value.TryGetProperty(o, out var ob) && ob.ValueKind == JsonValueKind.Object && ob.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

            var (pid, pidPort, proc) = PipeSrvPid(home);
            int listenPort = pidPort ?? port;
            bool listening = PipeSrvListening(listenPort);
            string started = null;
            try { if (proc != null) started = proc.StartTime.ToString("yyyy-MM-dd HH:mm:ss"); } catch { }
            var auto = PipeSrvAutostart();
            string log = PipeSrvLogFile(dir);
            return new
            {
                ok = true,
                found = true,
                folder = dir,
                home,
                venv,
                configured = cfg.HasValue,
                hasToken = !string.IsNullOrEmpty(S("api_token_sha256")),
                serverName = S("server_name"),
                apiUser = S("api_user"),
                timezone = S("timezone"),
                control = Sub("control", "driver"),
                fusionUser = Sub("fusion", "username"),
                port = listenPort,
                running = proc != null || listening,
                pid = proc != null ? pid : (int?)null,
                listening,
                started,
                startedHere = _pipeSrvProc != null && !_pipeSrvProc.HasExited,
                autostart = auto,
                consoleUrl = "http://localhost:" + listenPort + "/ui/",
                log = PipeSrvTail(log, Math.Max(10, Math.Min(lines, 400))),
                logPath = log
            };
        }

        /// <summary>data\server.pid = "pid port" written by the server; the process must still be python.</summary>
        private static (int pid, int? port, Process proc) PipeSrvPid(string home)
        {
            try
            {
                string f = Path.Combine(home, "server.pid");
                if (!File.Exists(f)) return (0, null, null);
                var parts = File.ReadAllText(f).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 0 || !int.TryParse(parts[0], out var pid)) return (0, null, null);
                int? port = parts.Length > 1 && int.TryParse(parts[1], out var p) ? p : (int?)null;
                try
                {
                    var proc = Process.GetProcessById(pid);
                    if (!proc.HasExited && proc.ProcessName.IndexOf("python", StringComparison.OrdinalIgnoreCase) >= 0) return (pid, port, proc);
                }
                catch (ArgumentException) { }            // no such process: a stale pid file
                return (pid, port, null);
            }
            catch { return (0, null, null); }
        }

        private static bool PipeSrvListening(int port)
        {
            try
            {
                using var c = new TcpClient();
                var t = c.ConnectAsync("127.0.0.1", port);
                return t.Wait(400) && c.Connected;
            }
            catch { return false; }
        }

        /// <summary>"service" (NSSM), "task" (scheduled task) or null — cached for a minute (schtasks is slow).</summary>
        private string PipeSrvAutostart()
        {
            if ((DateTime.UtcNow - _pipeSrvAutoCheck).TotalSeconds < 60) return _pipeSrvAutoKind;
            _pipeSrvAutoCheck = DateTime.UtcNow;
            _pipeSrvAutoKind = null;
            try
            {
                using var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\" + PIPE_SRV_NAME);
                if (k != null) return _pipeSrvAutoKind = "service";
            }
            catch { }
            try
            {
                var (code, _) = PipeSrvRun("schtasks.exe", "/query /tn " + PIPE_SRV_NAME, 5000);
                if (code == 0) _pipeSrvAutoKind = "task";
            }
            catch { }
            return _pipeSrvAutoKind;
        }

        private static string[] PipeSrvTail(string path, int lines)
        {
            try
            {
                if (!File.Exists(path)) return Array.Empty<string>();
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                long take = Math.Min(fs.Length, 256 * 1024);
                fs.Seek(-take, SeekOrigin.End);
                var buf = new byte[take];
                int n = fs.Read(buf, 0, buf.Length);
                var text = Encoding.UTF8.GetString(buf, 0, n).Replace("\r", "");
                var all = text.Split('\n');
                return all.Skip(take < fs.Length ? 1 : 0).Where(l => l.Length > 0).TakeLast(lines).ToArray();
            }
            catch (Exception ex) { return new[] { "(log not readable: " + ex.Message + ")" }; }
        }

        // ── start / stop ───────────────────────────────────────
        private object PipeSrvStart(string dir, bool demo)
        {
            if (dir == null) return new { ok = false, error = "The pipeline-server folder was not found on this PC." };
            string py = PipeSrvPython(dir);
            if (!File.Exists(py)) return new { ok = false, error = "Not set up yet — press Set up (runs setup.ps1)." };
            string home = PipeSrvHome(dir);
            if (!demo && !File.Exists(Path.Combine(home, "config.json"))) return new { ok = false, error = "No settings yet — press Set up first (or start the demo)." };
            var st = PipeSrvPid(home);
            int port = PipeSrvConfigPort(home);
            if (st.proc != null || PipeSrvListening(st.port ?? port))
                return new { ok = false, error = "The server is already running on port " + (st.port ?? port) + "." };

            var auto = PipeSrvAutostart();
            if (!demo && auto == "task")
            {
                // the scheduled task runs it as the account it was registered for
                var (code, output) = PipeSrvRun("schtasks.exe", "/run /tn " + PIPE_SRV_NAME, 10000);
                return code == 0 ? new { ok = true, how = "scheduled task", message = "Started through the scheduled task " + PIPE_SRV_NAME + "." }
                                 : (object)new { ok = false, error = "schtasks /run failed: " + output.Trim() };
            }
            if (!demo && auto == "service")
            {
                Process.Start(new ProcessStartInfo("cmd.exe", "/c sc start " + PIPE_SRV_NAME) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
                return new { ok = true, how = "service", message = "Asked Windows to start the service " + PIPE_SRV_NAME + " (administrator)." };
            }

            string logDir = Path.Combine(home, "logs");
            Directory.CreateDirectory(logDir);
            string log = Path.Combine(logDir, "server.log");
            try
            {
                if (File.Exists(log) && new FileInfo(log).Length > 5 * 1024 * 1024)
                {
                    string old = log + ".1";
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(log, old);
                }
                File.AppendAllText(log, Environment.NewLine + "===== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " started from the WMS app by " +
                    Environment.UserName + (demo ? " (demo)" : "") + " =====" + Environment.NewLine);
            }
            catch (Exception ex) { Debug.WriteLine("[PipeSrv] log: " + ex.Message); }

            // cmd keeps the redirect; the server outlives the app (no job object), so closing WMS does not stop it
            string args = demo ? "-m pipeline_server demo --port " + port : "-m pipeline_server run";
            var psi = new ProcessStartInfo("cmd.exe", "/s /c \"\"" + py + "\" " + args + " >> \"" + log + "\" 2>&1\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = dir
            };
            psi.Environment["PYTHONUNBUFFERED"] = "1";
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            if (demo) psi.Environment["PIPELINE_SECRETS"] = "file";
            _pipeSrvProc = Process.Start(psi);
            return new { ok = true, how = "process", port, message = (demo ? "Demo" : "Server") + " starting on port " + port + " — the log follows below." };
        }

        private static int PipeSrvConfigPort(string home)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(home, "config.json")));
                if (doc.RootElement.TryGetProperty("port", out var p) && p.TryGetInt32(out var v)) return v;
            }
            catch { }
            return 8000;
        }

        /// <summary>Graceful: data\stop.request → the server cancels running runs at their next page and exits
        /// (up to ~35 s). force, or no exit in time → the process tree is killed (runs are re-queued at the next start).</summary>
        private async Task<object> PipeSrvStopAsync(string dir, bool force)
        {
            if (dir == null) return new { ok = false, error = "The pipeline-server folder was not found on this PC." };
            string home = PipeSrvHome(dir);
            var st = PipeSrvPid(home);
            if (PipeSrvAutostart() == "service" && !force)
            {
                // NSSM would restart a server that exits on its own — stop the service itself
                Process.Start(new ProcessStartInfo("cmd.exe", "/c sc stop " + PIPE_SRV_NAME) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
                return new { ok = true, how = "service", message = "Asked Windows to stop the service " + PIPE_SRV_NAME + " (administrator)." };
            }
            if (st.proc == null && !PipeSrvListening(st.port ?? PipeSrvConfigPort(home)))
                return new { ok = true, message = "The server is not running." };

            if (!force)
            {
                File.WriteAllText(Path.Combine(home, "stop.request"), "WMS app " + Environment.UserName + " " + DateTime.Now.ToString("s"));
                var until = DateTime.UtcNow.AddSeconds(35);
                while (DateTime.UtcNow < until)
                {
                    await Task.Delay(700);
                    if ((st.proc == null || st.proc.HasExited) && !PipeSrvListening(st.port ?? PipeSrvConfigPort(home)))
                        return new { ok = true, how = "graceful", message = "The server stopped." };
                }
            }
            bool killed = false;
            try { if (st.proc != null && !st.proc.HasExited) { st.proc.Kill(true); killed = true; } } catch (Exception ex) { Debug.WriteLine("[PipeSrv] kill: " + ex.Message); }
            try { if (_pipeSrvProc != null && !_pipeSrvProc.HasExited) { _pipeSrvProc.Kill(true); killed = true; } } catch { }
            try { File.Delete(Path.Combine(home, "stop.request")); } catch { }
            if (!killed && st.proc == null)
                return new { ok = false, error = "Something answers on the port but it was not started from here (no pid file) — stop it where it runs (the service / its window)." };
            return new { ok = true, how = "kill", message = force ? "The server was killed." : "The server did not stop within 35 s and was killed. Runs that were running are queued again at the next start." };
        }

        /// <summary>python -m pipeline_server new-token --json → a token the page saves on the server row (the running
        /// server accepts it at once). The old token stops working.</summary>
        private async Task<object> PipeSrvNewTokenAsync(string dir)
        {
            if (dir == null || !File.Exists(PipeSrvPython(dir))) return new { ok = false, error = "Not set up yet — press Set up first." };
            if (!File.Exists(Path.Combine(PipeSrvHome(dir), "config.json"))) return new { ok = false, error = "No settings yet — press Set up first." };
            var (code, output) = await Task.Run(() => PipeSrvRun(PipeSrvPython(dir), "-m pipeline_server new-token --json", 60000, dir));
            var line = output.Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith("{"));
            if (code != 0 || line == null) return new { ok = false, error = "new-token failed: " + (output.Length > 600 ? output.Substring(output.Length - 600) : output) };
            using var doc = JsonDocument.Parse(line);
            return new { ok = true, info = doc.RootElement.Clone() };
        }

        private object PipeSrvConsole(string dir, string script, string args, bool admin)
        {
            if (dir == null) return new { ok = false, error = "The pipeline-server folder was not found on this PC." };
            string path = Path.Combine(dir, script);
            if (!File.Exists(path)) return new { ok = false, error = script + " is missing in " + dir };
            var psi = new ProcessStartInfo("powershell.exe", "-NoExit -NoProfile -ExecutionPolicy Bypass -File \"" + path + "\" " + args)
            {
                UseShellExecute = true,
                WorkingDirectory = dir
            };
            if (admin) psi.Verb = "runas";
            try { Process.Start(psi); }
            catch (System.ComponentModel.Win32Exception) { return new { ok = false, error = "Cancelled (administrator rights are needed)." }; }
            _pipeSrvAutoCheck = DateTime.MinValue;          // re-check service / task on the next status
            return new { ok = true, message = script + " opened in a PowerShell window — follow it there." };
        }

        private static (int code, string output) PipeSrvRun(string exe, string args, int timeoutMs, string cwd = null)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            if (cwd != null) psi.WorkingDirectory = cwd;
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            using var p = Process.Start(psi);
            var o = p.StandardOutput.ReadToEndAsync();
            var e = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(timeoutMs)) { try { p.Kill(true); } catch { } return (-1, "no answer within " + timeoutMs / 1000 + " s"); }
            return (p.ExitCode, o.Result + e.Result);
        }

        private static int PipeSrvInt(JsonElement root, string name, int def) =>
            root.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : def;
        private static string PipeSrvStr(JsonElement root, string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }
}

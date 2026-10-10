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
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// Local pipeline server control (Fusion SQL › Pipelines › "This PC" panel): finds the pipeline-server
    /// folder on this PC, runs setup.ps1 / install-service.ps1 in a visible console, starts the server in the
    /// background (python -m pipeline_server run|demo, output appended to data\logs\server.log), stops it
    /// gracefully (data\stop.request → runs cancelled at their next page, re-queued at the next start) or kills
    /// it, tails the log and makes a new API token for "Connect this app".
    /// Works with the Windows service (NSSM) / scheduled task that install-service.ps1 creates.
    /// "Install everything" (pipeSrvInstall, a background job the page polls through pipeSrvStatus) needs no PowerShell:
    /// copies the server files shipped with the app to C:\fusion\pipeline-server, installs a private Python 3.12 there
    /// (python.org installer, per user, no admin) unless Python 3.11+ is already installed, creates .venv, installs
    /// requirements.txt, writes the settings (init --yes --json) and hands over the app's Fusion login through stdin
    /// (set-fusion-password --stdin — the password never reaches the page).
    /// Replies: { action: "pipeSrvResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private Process _pipeSrvProc;
        private DateTime _pipeSrvAutoCheck;
        private string _pipeSrvAutoKind;
        private PipeSrvJob _pipeSrvJob;

        private const string PIPE_SRV_PY_VERSION = "3.12.10";
        private const string PIPE_SRV_INSTALL_DIR = @"C:\fusion\pipeline-server";

        private sealed class PipeSrvJob
        {
            public readonly object Lock = new object();
            public bool Running = true, Ok;
            public string Error, Step;
            public DateTime Started = DateTime.Now;
            public readonly List<string> Lines = new List<string>();
            public readonly List<Dictionary<string, string>> Steps = new List<Dictionary<string, string>>();
            public JsonElement? Result;
            public void Add(string line)
            {
                if (line == null) return;
                lock (Lock) { Lines.Add(line.TrimEnd()); if (Lines.Count > 600) Lines.RemoveRange(0, Lines.Count - 600); }
            }
            public void Set(string key, string state, string detail = null)
            {
                lock (Lock)
                {
                    var st = Steps.FirstOrDefault(x => x["key"] == key);
                    if (st == null) return;
                    st["state"] = state;
                    if (detail != null) st["detail"] = detail;
                    if (state == "run") Step = key;
                }
            }
            public object Snapshot()
            {
                lock (Lock) return new { running = Running, ok = Ok, error = Error, step = Step, started = Started.ToString("HH:mm:ss"),
                    steps = Steps.Select(x => new Dictionary<string, string>(x)).ToList(), lines = Lines.Skip(Math.Max(0, Lines.Count - 200)).ToList(), result = Result };
            }
        }

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
                        data = PipeSrvStart(dir, root.TryGetProperty("demo", out var demo) && demo.ValueKind == JsonValueKind.True,
                                            root.TryGetProperty("visible", out var vis) && vis.ValueKind == JsonValueKind.True);
                        break;
                    case "pipeSrvInstall":
                        data = PipeSrvInstallStart(dir, root);
                        break;
                    case "pipeSrvOpenConsole":
                        data = await PipeSrvOpenConsoleAsync(dir, root.TryGetProperty("inApp", out var ia) && ia.ValueKind == JsonValueKind.True);
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
            list.Add(PIPE_SRV_INSTALL_DIR);
            list.Add(@"C:\pipeline-server");
            list.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "pipeline-server"));
            return list.FirstOrDefault(IsPipeSrvFolder);
        }

        /// <summary>The copy shipped with the app (release ZIP: &lt;app&gt;\pipeline-server, sources only). It is copied to
        /// C:\fusion\pipeline-server before use so .venv / data survive an app update.</summary>
        private static string PipeSrvBundled()
        {
            for (var d = Path.GetDirectoryName(Application.ExecutablePath); !string.IsNullOrEmpty(d); d = Path.GetDirectoryName(d))
            {
                var c = Path.Combine(d, "pipeline-server");
                if (IsPipeSrvFolder(c) && !string.Equals(Path.GetFullPath(c).TrimEnd('\\'), PIPE_SRV_INSTALL_DIR, StringComparison.OrdinalIgnoreCase)) return c;
            }
            return null;
        }

        private static string PipeSrvVersion(string dir)
        {
            try
            {
                var m = System.Text.RegularExpressions.Regex.Match(File.ReadAllText(Path.Combine(dir, "pipeline_server", "__init__.py")), "VERSION\\s*=\\s*\"([^\"]+)\"");
                return m.Success ? m.Groups[1].Value : null;
            }
            catch { return null; }
        }

        private static bool PipeSrvNewer(string a, string b) =>
            Version.TryParse(a ?? "", out var va) && Version.TryParse(b ?? "", out var vb) && va > vb;

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
            string bundled = PipeSrvBundled();
            if (dir == null)
                return new { ok = true, found = false, canInstall = bundled != null, bundled, installTo = PIPE_SRV_INSTALL_DIR, job = _pipeSrvJob?.Snapshot(),
                    searched = new[] { "next to the source repo", PIPE_SRV_INSTALL_DIR, @"C:\pipeline-server", "%USERPROFILE%\\pipeline-server" } };
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
                version = PipeSrvVersion(dir),
                bundledVersion = bundled == null ? null : PipeSrvVersion(bundled),
                update = bundled != null && PipeSrvNewer(PipeSrvVersion(bundled), PipeSrvVersion(dir)),
                runtime = File.Exists(Path.Combine(dir, "runtime", "python.exe")),
                job = _pipeSrvJob?.Snapshot(),
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
        private object PipeSrvStart(string dir, bool demo, bool visible)
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

            // the server writes data\\logs\\server.log itself (start_log), so the window can show it too
            string args = demo ? "-m pipeline_server demo --port " + port : "-m pipeline_server run";
            var psi = new ProcessStartInfo(py, args)
            {
                UseShellExecute = false,
                CreateNoWindow = !visible,              // visible: a console window of its own (closing it stops the server)
                WorkingDirectory = dir
            };
            psi.Environment["PYTHONUNBUFFERED"] = "1";
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            if (demo) psi.Environment["PIPELINE_SECRETS"] = "file";
            _pipeSrvProc = Process.Start(psi);          // no job object: the server outlives WMS
            return new { ok = true, how = "process", port, visible, message = (demo ? "Demo" : "Server") + " starting on port " + port + (visible ? " in its own window." : " in the background.") };
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
            if (killed) try { File.Delete(Path.Combine(home, "server.pid")); } catch { }
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

        // ── Install everything (background job, polled through pipeSrvStatus) ─────
        private object PipeSrvInstallStart(string dir, JsonElement root)
        {
            if (_pipeSrvJob != null && _pipeSrvJob.Running) return new { ok = false, error = "An install is already running." };
            string bundled = PipeSrvBundled();
            if (dir == null && bundled == null)
                return new { ok = false, error = "This app has no copy of the pipeline server (older release) and none was found on this PC — copy the pipeline-server folder to " + PIPE_SRV_INSTALL_DIR + " or pick it." };
            var job = new PipeSrvJob();
            foreach (var (k, l) in new[] { ("files", "Server files"), ("python", "Python " + PIPE_SRV_PY_VERSION.Substring(0, 4)), ("venv", "Virtual environment"),
                                             ("packages", "Packages"), ("settings", "Settings + API token"), ("fusion", "Fusion login"), ("test", "Check") })
                job.Steps.Add(new Dictionary<string, string> { ["key"] = k, ["label"] = l, ["state"] = "wait", ["detail"] = "" });
            _pipeSrvJob = job;
            var opt = new PipeSrvInstallOptions
            {
                ServerName = PipeSrvStr(root, "serverName"),
                Port = PipeSrvInt(root, "port", 8000),
                Timezone = PipeSrvStr(root, "timezone"),
                OrdsUrl = PipeSrvStr(root, "ordsUrl"),
                PodProd = PipeSrvStr(root, "podProd"),
                PodTest = PipeSrvStr(root, "podTest"),
                UseAppLogin = !(root.TryGetProperty("useAppLogin", out var ua) && ua.ValueKind == JsonValueKind.False),
                ForcePackages = root.TryGetProperty("forcePackages", out var fp) && fp.ValueKind == JsonValueKind.True
            };
            _ = Task.Run(() => PipeSrvInstallAsync(job, dir, bundled, opt));
            return new { ok = true, message = "Installing — follow the steps below." };
        }

        private sealed class PipeSrvInstallOptions
        {
            public string ServerName, Timezone, OrdsUrl, PodProd, PodTest;
            public int Port;
            public bool UseAppLogin, ForcePackages;
        }

        private async Task PipeSrvInstallAsync(PipeSrvJob job, string dir, string bundled, PipeSrvInstallOptions opt)
        {
            string step = "files";
            try
            {
                // 1. files: the shipped copy → C:\fusion\pipeline-server (new install or a newer version); a repo folder is used as is
                job.Set(step, "run");
                if (dir == null || (bundled != null && PipeSrvNewer(PipeSrvVersion(bundled), PipeSrvVersion(dir))
                                    && string.Equals(Path.GetFullPath(dir).TrimEnd('\\'), PIPE_SRV_INSTALL_DIR, StringComparison.OrdinalIgnoreCase)))
                {
                    if (dir != null && PipeSrvPid(PipeSrvHome(dir)).proc != null) throw new InvalidOperationException("Stop the server first — its files are being updated.");
                    dir = PIPE_SRV_INSTALL_DIR;
                    int n = PipeSrvCopy(bundled, dir);
                    job.Add($"Copied {n} files from {bundled} to {dir}");
                    Directory.CreateDirectory(Path.GetDirectoryName(PipeSrvSettingsFile));
                    File.WriteAllText(PipeSrvSettingsFile, JsonSerializer.Serialize(new { folder = dir }));
                    job.Set(step, "ok", dir + " · v" + PipeSrvVersion(dir));
                }
                else job.Set(step, "ok", dir + " · v" + PipeSrvVersion(dir));

                // 2. python: .venv already there → skip; else private runtime, the py launcher, or download python.org's installer
                step = "python";
                job.Set(step, "run");
                string venvPy = PipeSrvPython(dir), basePy = null;
                bool venvOk = File.Exists(venvPy) && (await PipeSrvExecAsync(job, venvPy, "-c \"import sys; print(sys.version)\"", dir, 30000, quiet: true)).code == 0;
                if (venvOk) job.Set(step, "ok", "using the existing .venv");
                else
                {
                    basePy = await PipeSrvFindPythonAsync(job, dir);
                    if (basePy == null)
                    {
                        basePy = await PipeSrvInstallPythonAsync(job, dir);
                        job.Set(step, "ok", "installed in " + Path.GetDirectoryName(basePy));
                    }
                    else job.Set(step, "ok", basePy);
                }

                // 3. venv
                step = "venv";
                job.Set(step, "run");
                if (venvOk) job.Set(step, "ok", "ready");
                else
                {
                    string venvDir = Path.Combine(dir, ".venv");
                    if (Directory.Exists(venvDir)) { job.Add("Removing a broken .venv"); Directory.Delete(venvDir, true); }
                    var (c, _) = await PipeSrvExecAsync(job, basePy, "-m venv \"" + venvDir + "\"", dir, 300000);
                    if (c != 0 || !File.Exists(venvPy)) throw new InvalidOperationException("python -m venv failed (exit " + c + ").");
                    job.Set(step, "ok", ".venv created");
                }

                // 4. packages (skipped when requirements.txt did not change since the last install)
                step = "packages";
                job.Set(step, "run");
                string req = Path.Combine(dir, "requirements.txt");
                string reqHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(req)));
                string mark = Path.Combine(dir, ".venv", "wms-requirements.sha256");
                if (!opt.ForcePackages && File.Exists(mark) && File.ReadAllText(mark).Trim() == reqHash) job.Set(step, "ok", "up to date");
                else
                {
                    await PipeSrvExecAsync(job, venvPy, "-m pip install --upgrade pip --disable-pip-version-check", dir, 600000);
                    var (c, _) = await PipeSrvExecAsync(job, venvPy, "-m pip install -r requirements.txt --disable-pip-version-check", dir, 1800000);
                    if (c != 0) throw new InvalidOperationException("pip install failed (exit " + c + ") — see the lines above (a proxy or no internet?).");
                    File.WriteAllText(mark, reqHash);
                    job.Set(step, "ok", "installed");
                }

                // 5. settings: init --yes --json (a token only on the first init; Connect makes a new one later)
                step = "settings";
                job.Set(step, "run");
                (string user, string pw) fusion = (null, null);
                if (opt.UseAppLogin)
                {
                    try
                    {
                        var cred = await GetFusionSqlService().GetCredentialsAsync(FusionSqlStore.LoadConfig());
                        fusion = (cred.Username, cred.Password);
                    }
                    catch (Exception ex) { job.Add("Fusion login of the app not available: " + ex.Message); }
                }
                var args = new StringBuilder("-m pipeline_server init --yes --json --control ords");
                void Arg(string name, string v) { if (!string.IsNullOrWhiteSpace(v)) args.Append(' ').Append(name).Append(" \"").Append(v.Replace("\"", "")).Append('"'); }
                Arg("--name", string.IsNullOrWhiteSpace(opt.ServerName) ? Environment.MachineName.ToUpperInvariant() : opt.ServerName);
                Arg("--port", (opt.Port is > 0 and < 65536 ? opt.Port : 8000).ToString());
                Arg("--timezone", opt.Timezone);
                Arg("--ords-url", opt.OrdsUrl);
                Arg("--pod-prod", opt.PodProd ?? FusionSqlService.PROD_ORIGIN);
                Arg("--pod-test", opt.PodTest ?? FusionSqlService.TEST_ORIGIN);
                Arg("--fusion-user", fusion.user);
                var (ic, iout) = await PipeSrvExecAsync(job, venvPy, args.ToString(), dir, 300000, hide: s => s.TrimStart().StartsWith("{"));
                var line = iout.Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith("{"));
                if (ic != 0 || line == null) throw new InvalidOperationException("init failed (exit " + ic + ").");
                using (var doc = JsonDocument.Parse(line)) job.Result = doc.RootElement.Clone();
                job.Set(step, "ok", "port " + (opt.Port > 0 ? opt.Port : 8000) + (job.Result.Value.TryGetProperty("api_token", out var t) && t.ValueKind == JsonValueKind.String ? " · new API token" : " · token kept"));

                // 6. Fusion password: from the app's login straight into the Windows Credential Manager (stdin, never the page)
                step = "fusion";
                job.Set(step, "run");
                if (!string.IsNullOrEmpty(fusion.user) && !string.IsNullOrEmpty(fusion.pw))
                {
                    var (fc, _) = await PipeSrvExecAsync(job, venvPy, "-m pipeline_server set-fusion-password --stdin", dir, 120000, stdin: fusion.pw);
                    if (fc != 0) throw new InvalidOperationException("Saving the Fusion password failed (exit " + fc + ").");
                    job.Set(step, "ok", fusion.user + " · saved in the Windows Credential Manager");
                }
                else job.Set(step, "skip", opt.UseAppLogin ? "the app's Fusion login was not available — set it in the console › Settings" : "not changed");

                // 7. check (control tables through the APEX gateway + Fusion) — a failure here is a warning
                step = "test";
                job.Set(step, "run");
                var (tc, _) = await PipeSrvExecAsync(job, venvPy, "-m pipeline_server test", dir, 300000);
                job.Set(step, tc == 0 ? "ok" : "warn", tc == 0 ? "control tables + Fusion reachable" : "see the lines above — the server still starts");
                job.Ok = true;
                job.Add("Done.");
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[PipeSrv] install: " + ex);
                job.Error = ex.Message;
                job.Set(step, "fail", ex.Message);
                job.Add("FAILED: " + ex.Message);
            }
            finally
            {
                job.Running = false;
                _pipeSrvAutoCheck = DateTime.MinValue;
            }
        }

        private static int PipeSrvCopy(string from, string to)
        {
            int n = 0;
            var skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".venv", "data", "data-demo", "runtime", "__pycache__", ".pytest_cache", ".nicegui", ".git" };
            void Walk(string src, string dst)
            {
                Directory.CreateDirectory(dst);
                foreach (var f in Directory.GetFiles(src)) { File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true); n++; }
                foreach (var d in Directory.GetDirectories(src))
                    if (!skip.Contains(Path.GetFileName(d))) Walk(d, Path.Combine(dst, Path.GetFileName(d)));
            }
            Walk(from, to);
            return n;
        }

        /// <summary>A Python 3.11+ that is already there: the private runtime, else the py launcher (3.13 / 3.12 / 3.11).
        /// The Microsoft Store "python.exe" alias is never used (it opens the Store).</summary>
        private async Task<string> PipeSrvFindPythonAsync(PipeSrvJob job, string dir)
        {
            string rt = Path.Combine(dir, "runtime", "python.exe");
            if (File.Exists(rt) && (await PipeSrvExecAsync(job, rt, "-c \"import sys; print(sys.version)\"", dir, 30000, quiet: true)).code == 0) return rt;
            foreach (var v in new[] { "3.13", "3.12", "3.11" })
            {
                try
                {
                    var (c, o) = await PipeSrvExecAsync(job, "py", "-" + v + " -c \"import sys; print(sys.executable)\"", dir, 30000, quiet: true);
                    var exe = o.Split('\n').Select(x => x.Trim()).LastOrDefault(x => x.EndsWith("python.exe", StringComparison.OrdinalIgnoreCase));
                    if (c == 0 && exe != null && File.Exists(exe)) { job.Add("Found Python " + v + ": " + exe); return exe; }
                }
                catch { /* no py launcher */ }
            }
            return null;
        }

        /// <summary>Downloads python.org's installer and installs it per user into &lt;dir&gt;\runtime (no admin, not on PATH).</summary>
        private async Task<string> PipeSrvInstallPythonAsync(PipeSrvJob job, string dir)
        {
            string url = $"https://www.python.org/ftp/python/{PIPE_SRV_PY_VERSION}/python-{PIPE_SRV_PY_VERSION}-amd64.exe";
            string tmp = Path.Combine(Path.GetTempPath(), "GraysWMS");
            Directory.CreateDirectory(tmp);
            string exe = Path.Combine(tmp, $"python-{PIPE_SRV_PY_VERSION}-amd64.exe");
            if (!File.Exists(exe) || new FileInfo(exe).Length < 10_000_000)
            {
                job.Add("Downloading " + url);
                using var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromMinutes(15) };
                using var resp = await http.GetAsync(url, System.Net.Http.HttpCompletionOption.ResponseHeadersRead);
                if (!resp.IsSuccessStatusCode) throw new InvalidOperationException("Python download failed: HTTP " + (int)resp.StatusCode + " — install Python 3.12 from python.org yourself, then press Install again.");
                long total = resp.Content.Headers.ContentLength ?? 0, got = 0; int lastPct = -10;
                string part = exe + ".part";
                using (var src = await resp.Content.ReadAsStreamAsync())
                using (var dst = File.Create(part))
                {
                    var buf = new byte[81920]; int r;
                    while ((r = await src.ReadAsync(buf, 0, buf.Length)) > 0)
                    {
                        await dst.WriteAsync(buf, 0, r); got += r;
                        int pct = total > 0 ? (int)(got * 100 / total) : 0;
                        if (pct >= lastPct + 10) { lastPct = pct; job.Set("python", "run", $"downloading {got / 1048576} / {total / 1048576} MB"); }
                    }
                }
                using (var fs = File.OpenRead(part)) if (fs.Length < 10_000_000 || fs.ReadByte() != 'M' || fs.ReadByte() != 'Z') throw new InvalidOperationException("The download is not the Python installer (a proxy page?).");
                if (File.Exists(exe)) File.Delete(exe);
                File.Move(part, exe);
            }
            string target = Path.Combine(dir, "runtime");
            job.Set("python", "run", "installing into " + target);
            job.Add("Installing Python " + PIPE_SRV_PY_VERSION + " into " + target + " (per user, no admin, not added to PATH)");
            var (c, _) = await PipeSrvExecAsync(job, exe, $"/quiet InstallAllUsers=0 TargetDir=\"{target}\" PrependPath=0 Include_launcher=0 InstallLauncherAllUsers=0 " +
                "Include_test=0 Include_doc=0 Include_tcltk=0 Shortcuts=0 AssociateFiles=0 Include_pip=1", dir, 900000);
            string py = Path.Combine(target, "python.exe");
            if (File.Exists(py)) return py;
            // the same version already installed elsewhere for this user: the installer does not install it twice
            var found = await PipeSrvFindPythonAsync(job, dir);
            if (found != null) return found;
            throw new InvalidOperationException("The Python installer ended with exit " + c + " and no python.exe was found — install Python 3.12 from python.org, then press Install again.");
        }

        /// <summary>Runs a process hidden, streaming its output into the job; returns exit code + all output.</summary>
        private static async Task<(int code, string output)> PipeSrvExecAsync(PipeSrvJob job, string exe, string args, string cwd, int timeoutMs,
            string stdin = null, bool quiet = false, Func<string, bool> hide = null)
        {
            var psi = new ProcessStartInfo(exe, args)
            {
                UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = cwd,
                RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = stdin != null,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["PYTHONUNBUFFERED"] = "1";
            psi.Environment["PIP_NO_INPUT"] = "1";
            if (!quiet) job.Add("> " + Path.GetFileName(exe) + " " + args);
            var all = new StringBuilder();
            using var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            DataReceivedEventHandler on = (s, e) =>
            {
                if (e.Data == null) return;
                lock (all) all.AppendLine(e.Data);
                if (!quiet && (hide == null || !hide(e.Data))) job.Add("  " + e.Data);
            };
            p.OutputDataReceived += on;
            p.ErrorDataReceived += on;
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            if (stdin != null) { await p.StandardInput.WriteLineAsync(stdin); p.StandardInput.Close(); }
            var done = p.WaitForExitAsync();
            if (await Task.WhenAny(done, Task.Delay(timeoutMs)) != done)
            {
                try { p.Kill(true); } catch { }
                job.Add("  (stopped: no end within " + timeoutMs / 1000 + " s)");
                return (-1, all.ToString());
            }
            p.WaitForExit();                              // flushes the redirected output
            lock (all) return (p.ExitCode, all.ToString());
        }

        // ── console: signed in through a one-time code (data\console.code, 2 minutes, used once) ─────
        private async Task<object> PipeSrvOpenConsoleAsync(string dir, bool inApp)
        {
            if (dir == null) return new { ok = false, error = "The pipeline-server folder was not found on this PC." };
            string home = PipeSrvHome(dir);
            var st = PipeSrvPid(home);
            int port = st.port ?? PipeSrvConfigPort(home);
            if (!PipeSrvListening(port)) return new { ok = false, error = "The server is not running." };
            string code = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
            File.WriteAllText(Path.Combine(home, "console.code"), code);
            string url = "http://localhost:" + port + "/ui/?code=" + code;
            if (!inApp)
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                return new { ok = true };
            }
            var f = new Form
            {
                Text = "Pipeline server console — localhost:" + port, Width = 1360, Height = 880,
                StartPosition = FormStartPosition.CenterScreen, Icon = this.Icon
            };
            var wv = new WebView2 { Dock = DockStyle.Fill };
            f.Controls.Add(wv);
            f.Show();
            await wv.EnsureCoreWebView2Async(await GetSharedEnvironmentAsync());
            wv.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var nu) && (nu.Scheme == Uri.UriSchemeHttps || nu.Scheme == Uri.UriSchemeHttp))
                    try { Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
            };
            wv.CoreWebView2.Navigate(url);
            return new { ok = true };
        }

        private static int PipeSrvInt(JsonElement root, string name, int def) =>
            root.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : def;
        private static string PipeSrvStr(JsonElement root, string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }
}

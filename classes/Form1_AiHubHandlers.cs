using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// AI Hub (aihub/ page + the Python service in ai-hub/): one model gateway for Claude (direct, Claude in Amazon
    /// Bedrock, Claude Platform on AWS), other Bedrock models and NVIDIA NIM, with routing / fallback / budget, a usage
    /// ledger, evals and the LangGraph Pipeline Doctor. hub* IPC actions, reply hubResponse.
    ///   hubStatus / hubInstall (background job, same steps as the pipeline server: files → Python → .venv → packages →
    ///   settings → optional Claude key → check) / hubStart / hubStop / hubOpenFolder / hubOpenLog / hubSaveClaudeKey /
    ///   hubApi = relay to http://127.0.0.1:&lt;port&gt; with the Bearer token this PC holds (DPAPI) - the page never sees it.
    /// The relay checks the AI kill switch before any call that runs a model, and writes WMS_AI_AUDIT (source AIHUB)
    /// with model, tokens and cost after it.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private PipeSrvJob _hubJob;
        private Process _hubProc;
        private HttpClient _hubHttp;

        private const string HUB_INSTALL_DIR = @"C:\fusion\ai-hub";

        private static string HubSettingsFile => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "AiHub", "hub.json");

        private static bool IsAiHubAction(string action) =>
            action != null && action.StartsWith("hub", StringComparison.Ordinal);

        private async Task HandleAiHubAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            string user = PipeSrvStr(root, "appUser");
            if (string.IsNullOrWhiteSpace(user) || user == "UNKNOWN") user = GetClaudeCliService().PolicyUser;
            try
            {
                string dir = HubFolder();
                switch (action)
                {
                    case "hubStatus":
                        data = HubStatus(dir, PipeSrvInt(root, "lines", 80));
                        break;
                    case "hubInstall":
                        data = HubInstallStart(dir, PipeSrvInt(root, "port", 8100),
                            root.TryGetProperty("useClaudeKey", out var uck) && uck.ValueKind == JsonValueKind.True, user);
                        break;
                    case "hubStart":
                        data = HubStart(dir, root.TryGetProperty("visible", out var vis) && vis.ValueKind == JsonValueKind.True);
                        break;
                    case "hubStop":
                        data = await HubStopAsync(dir, root.TryGetProperty("force", out var f) && f.ValueKind == JsonValueKind.True);
                        break;
                    case "hubSaveClaudeKey":
                        {
                            string key = FusionSqlStore.LoadAiKey();
                            if (string.IsNullOrWhiteSpace(key)) { data = new { ok = false, error = "This app has no Claude API key saved (AI settings)." }; break; }
                            if (dir == null || !File.Exists(PipeSrvPython(dir))) { data = new { ok = false, error = "Install the AI Hub first." }; break; }
                            var (c, _) = await PipeSrvExecAsync(new PipeSrvJob(), PipeSrvPython(dir), "-m ai_hub set-secret anthropic.api_key --stdin", dir, 60000, stdin: key, quiet: true);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIHUB", Action = "claude_key", Outcome = c == 0 ? "OK" : "FAILED", Detail = "app Claude key copied to the AI Hub" });
                            data = c == 0 ? new { ok = true, message = "The app's Claude key is now in the AI Hub (Windows Credential Manager)." } : (object)new { ok = false, error = "set-secret failed (exit " + c + ")" };
                            break;
                        }
                    case "hubOpenFolder":
                        if (dir != null) Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
                        data = new { ok = dir != null };
                        break;
                    case "hubOpenLog":
                        {
                            string log = dir == null ? null : HubLogFile(dir);
                            if (log != null && File.Exists(log)) Process.Start(new ProcessStartInfo("notepad.exe", "\"" + log + "\"") { UseShellExecute = true });
                            data = new { ok = log != null && File.Exists(log) };
                            break;
                        }
                    case "hubApi":
                        data = await HubApiAsync(dir, root, user);
                        break;
                    default:
                        data = new { ok = false, error = "Unknown AI Hub action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[AiHub] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "hubResponse", requestId, data }));
        }

        // ── folder / settings ──────────────────────────────────
        private static bool IsHubFolder(string dir) =>
            !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "ai_hub", "__main__.py"));

        private string HubFolder()
        {
            var s = HubSettings();
            if (s.TryGetValue("folder", out var f) && IsHubFolder(f)) return f;
            var list = new List<string>();
            try { var repo = AdminRepoRoot(); if (repo != null) list.Add(Path.Combine(repo, "ai-hub")); } catch { }
            list.Add(HUB_INSTALL_DIR);
            return list.FirstOrDefault(IsHubFolder);
        }

        /// <summary>The copy shipped with the app (&lt;app&gt;\ai-hub, sources only) - copied to C:\fusion\ai-hub before use.</summary>
        private static string HubBundled()
        {
            for (var d = Path.GetDirectoryName(System.Windows.Forms.Application.ExecutablePath); !string.IsNullOrEmpty(d); d = Path.GetDirectoryName(d))
            {
                var c = Path.Combine(d, "ai-hub");
                if (IsHubFolder(c) && !string.Equals(Path.GetFullPath(c).TrimEnd('\\'), HUB_INSTALL_DIR, StringComparison.OrdinalIgnoreCase)) return c;
            }
            return null;
        }

        private static Dictionary<string, string> HubSettings()
        {
            try
            {
                if (File.Exists(HubSettingsFile))
                    return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(HubSettingsFile)) ?? new Dictionary<string, string>();
            }
            catch (Exception ex) { Debug.WriteLine("[AiHub] settings: " + ex.Message); }
            return new Dictionary<string, string>();
        }

        private static void HubSaveSettings(Dictionary<string, string> s)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(HubSettingsFile));
            File.WriteAllText(HubSettingsFile, JsonSerializer.Serialize(s));
        }

        /// <summary>The hub's API token, DPAPI-encrypted for this Windows user.</summary>
        private static string HubToken()
        {
            var s = HubSettings();
            if (!s.TryGetValue("token", out var enc) || string.IsNullOrEmpty(enc)) return null;
            try
            {
                return Encoding.UTF8.GetString(System.Security.Cryptography.ProtectedData.Unprotect(Convert.FromBase64String(enc), null,
                    System.Security.Cryptography.DataProtectionScope.CurrentUser));
            }
            catch { return null; }
        }

        private static string HubHome(string dir)
        {
            var env = Environment.GetEnvironmentVariable("AIHUB_HOME");
            return !string.IsNullOrWhiteSpace(env) && Directory.Exists(env) ? env : Path.Combine(dir, "data");
        }
        private static string HubLogFile(string dir) => Path.Combine(HubHome(dir), "logs", "hub.log");

        private object HubStatus(string dir, int lines)
        {
            string bundled = HubBundled();
            if (dir == null)
                return new { ok = true, found = false, canInstall = bundled != null, installTo = HUB_INSTALL_DIR, job = _hubJob?.Snapshot() };
            string home = HubHome(dir);
            var (pid, pidPort, proc) = PipeSrvPid(home);
            int port = pidPort ?? PipeSrvConfigPort(home);
            bool listening = PipeSrvListening(port);
            string started = null;
            try { if (proc != null) started = proc.StartTime.ToString("yyyy-MM-dd HH:mm:ss"); } catch { }
            return new
            {
                ok = true, found = true, folder = dir, version = HubVersion(dir), bundledVersion = bundled == null ? null : HubVersion(bundled),
                update = bundled != null && PipeSrvNewer(HubVersion(bundled), HubVersion(dir)),
                venv = File.Exists(PipeSrvPython(dir)), configured = File.Exists(Path.Combine(home, "config.json")) && HubToken() != null,
                hasAppClaudeKey = !string.IsNullOrWhiteSpace(FusionSqlStore.LoadAiKey()),
                port, running = proc != null || listening, pid = proc != null ? pid : (int?)null, started,
                job = _hubJob?.Snapshot(), log = PipeSrvTail(HubLogFile(dir), Math.Max(10, Math.Min(lines, 400))), logPath = HubLogFile(dir)
            };
        }

        private static string HubVersion(string dir)
        {
            try
            {
                var m = Regex.Match(File.ReadAllText(Path.Combine(dir, "ai_hub", "__init__.py")), "VERSION\\s*=\\s*\"([^\"]+)\"");
                return m.Success ? m.Groups[1].Value : null;
            }
            catch { return null; }
        }

        // ── install (background job, polled through hubStatus.job) ──
        private object HubInstallStart(string dir, int port, bool useClaudeKey, string user)
        {
            if (_hubJob != null && _hubJob.Running) return new { ok = false, error = "An install is already running." };
            string bundled = HubBundled();
            if (dir == null && bundled == null) return new { ok = false, error = "This app has no copy of the AI Hub (older release) — copy the ai-hub folder to " + HUB_INSTALL_DIR + "." };
            var job = new PipeSrvJob();
            foreach (var (k, l) in new[] { ("files", "Hub files"), ("python", "Python 3.11+"), ("venv", "Virtual environment"), ("packages", "Packages (Anthropic SDK, boto3, LangGraph …)"),
                                             ("settings", "Settings + token"), ("claude", "Claude key"), ("test", "Check") })
                job.Steps.Add(new Dictionary<string, string> { ["key"] = k, ["label"] = l, ["state"] = "wait", ["detail"] = "" });
            _hubJob = job;
            _ = Task.Run(() => HubInstallAsync(job, dir, bundled, port is > 1023 and < 65536 ? port : 8100, useClaudeKey, user));
            return new { ok = true, message = "Installing the AI Hub — follow the steps." };
        }

        private async Task HubInstallAsync(PipeSrvJob job, string dir, string bundled, int port, bool useClaudeKey, string user)
        {
            string step = "files";
            try
            {
                job.Set(step, "run");
                if (dir == null || (bundled != null && PipeSrvNewer(HubVersion(bundled), HubVersion(dir))
                                    && string.Equals(Path.GetFullPath(dir).TrimEnd('\\'), HUB_INSTALL_DIR, StringComparison.OrdinalIgnoreCase)))
                {
                    if (dir != null && PipeSrvPid(HubHome(dir)).proc != null) throw new InvalidOperationException("Stop the AI Hub first — its files are being updated.");
                    dir = HUB_INSTALL_DIR;
                    job.Add($"Copied {PipeSrvCopy(bundled, dir)} files from {bundled} to {dir}");
                    var s0 = HubSettings(); s0["folder"] = dir; HubSaveSettings(s0);
                }
                job.Set(step, "ok", dir + " · v" + HubVersion(dir));

                // Python: the existing .venv, the hub's private runtime, the pipeline server's runtime, the py launcher, else python.org
                step = "python";
                job.Set(step, "run");
                string venvPy = PipeSrvPython(dir), basePy = null;
                bool venvOk = File.Exists(venvPy) && (await PipeSrvExecAsync(job, venvPy, "-c \"import sys; print(sys.version)\"", dir, 30000, quiet: true)).code == 0;
                if (venvOk) job.Set(step, "ok", "using the existing .venv");
                else
                {
                    foreach (var c in new[] { Path.Combine(PIPE_SRV_INSTALL_DIR, "runtime", "python.exe"), PipeSrvFolder() == null ? null : Path.Combine(PipeSrvFolder(), "runtime", "python.exe") })
                        if (c != null && File.Exists(c)) { basePy = c; job.Add("Using the pipeline server's Python: " + c); break; }
                    basePy ??= await PipeSrvFindPythonAsync(job, dir) ?? await PipeSrvInstallPythonAsync(job, dir);
                    job.Set(step, "ok", basePy);
                }

                step = "venv";
                job.Set(step, "run");
                if (venvOk) job.Set(step, "ok", "ready");
                else
                {
                    string venvDir = Path.Combine(dir, ".venv");
                    if (Directory.Exists(venvDir)) Directory.Delete(venvDir, true);
                    var (c, _) = await PipeSrvExecAsync(job, basePy, "-m venv \"" + venvDir + "\"", dir, 300000);
                    if (c != 0 || !File.Exists(venvPy)) throw new InvalidOperationException("python -m venv failed (exit " + c + ").");
                    job.Set(step, "ok", ".venv created");
                }

                step = "packages";
                job.Set(step, "run");
                string reqHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(Path.Combine(dir, "requirements.txt"))));
                string mark = Path.Combine(dir, ".venv", "wms-requirements.sha256");
                if (File.Exists(mark) && File.ReadAllText(mark).Trim() == reqHash) job.Set(step, "ok", "up to date");
                else
                {
                    await PipeSrvExecAsync(job, venvPy, "-m pip install --upgrade pip --disable-pip-version-check", dir, 600000);
                    var (c, _) = await PipeSrvExecAsync(job, venvPy, "-m pip install -r requirements.txt --disable-pip-version-check", dir, 1800000);
                    if (c != 0) throw new InvalidOperationException("pip install failed (exit " + c + ") — see the lines above (a proxy or no internet?).");
                    File.WriteAllText(mark, reqHash);
                    job.Set(step, "ok", "installed");
                }

                // settings: the app makes the token and keeps it (DPAPI); the hub stores only its SHA-256
                step = "settings";
                job.Set(step, "run");
                string token = HubToken();
                if (token == null)
                {
                    token = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
                    var s1 = HubSettings();
                    s1["token"] = Convert.ToBase64String(System.Security.Cryptography.ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null,
                        System.Security.Cryptography.DataProtectionScope.CurrentUser));
                    s1["folder"] = dir;
                    HubSaveSettings(s1);
                }
                var (ic, _) = await PipeSrvExecAsync(job, venvPy, $"-m ai_hub init --port {port} --token-stdin --json", dir, 120000, stdin: token, hide: l => true);
                if (ic != 0) throw new InvalidOperationException("ai_hub init failed (exit " + ic + ").");
                job.Set(step, "ok", "port " + port + " · local only (127.0.0.1)");

                step = "claude";
                job.Set(step, "run");
                string key = useClaudeKey ? FusionSqlStore.LoadAiKey() : null;
                if (!string.IsNullOrWhiteSpace(key))
                {
                    var (kc, _) = await PipeSrvExecAsync(job, venvPy, "-m ai_hub set-secret anthropic.api_key --stdin", dir, 60000, stdin: key, quiet: true);
                    job.Set(step, kc == 0 ? "ok" : "warn", kc == 0 ? "the app's Claude key → Windows Credential Manager" : "could not save it");
                }
                else job.Set(step, "skip", useClaudeKey ? "this app has no Claude key saved" : "not copied");

                step = "test";
                job.Set(step, "run");
                var (tc, _) = await PipeSrvExecAsync(job, venvPy, "-c \"import ai_hub, anthropic, boto3, langgraph, langchain_core; print('imports ok', anthropic.__version__)\"", dir, 120000);
                job.Set(step, tc == 0 ? "ok" : "warn", tc == 0 ? "Anthropic SDK, boto3, LangGraph, LangChain ready" : "an import failed — see above");
                job.Ok = tc == 0;
                if (tc != 0) job.Error = "The packages did not import — press Install again.";
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIHUB", Action = "install", Outcome = job.Ok ? "OK" : "FAILED", Detail = dir });
                job.Add("Done.");
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[AiHub] install: " + ex);
                job.Error = ex.Message;
                job.Set(step, "fail", ex.Message);
                job.Add("FAILED: " + ex.Message);
            }
            finally { job.Running = false; }
        }

        // ── start / stop ───────────────────────────────────────
        private object HubStart(string dir, bool visible)
        {
            if (dir == null || !File.Exists(PipeSrvPython(dir))) return new { ok = false, error = "Install the AI Hub first." };
            string home = HubHome(dir);
            if (HubToken() == null || !File.Exists(Path.Combine(home, "config.json"))) return new { ok = false, error = "Not set up yet — press Install." };
            int port = PipeSrvConfigPort(home);
            if (PipeSrvPid(home).proc != null || PipeSrvListening(port)) return new { ok = false, error = "The AI Hub is already running on port " + port + "." };
            var psi = new ProcessStartInfo(PipeSrvPython(dir), "-m ai_hub run") { UseShellExecute = false, CreateNoWindow = !visible, WorkingDirectory = dir };
            psi.Environment["PYTHONUNBUFFERED"] = "1";
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            _hubProc = Process.Start(psi);
            return new { ok = true, port, message = "AI Hub starting on 127.0.0.1:" + port + (visible ? " in its own window." : ".") };
        }

        private async Task<object> HubStopAsync(string dir, bool force)
        {
            if (dir == null) return new { ok = true, message = "Not installed." };
            string home = HubHome(dir);
            var st = PipeSrvPid(home);
            int port = st.port ?? PipeSrvConfigPort(home);
            if (st.proc == null && !PipeSrvListening(port)) return new { ok = true, message = "The AI Hub is not running." };
            if (!force)
            {
                File.WriteAllText(Path.Combine(home, "stop.request"), "WMS app " + Environment.UserName);
                var until = DateTime.UtcNow.AddSeconds(15);
                while (DateTime.UtcNow < until)
                {
                    await Task.Delay(500);
                    if ((st.proc == null || st.proc.HasExited) && !PipeSrvListening(port)) return new { ok = true, message = "The AI Hub stopped." };
                }
            }
            try { if (st.proc != null && !st.proc.HasExited) st.proc.Kill(true); } catch { }
            try { if (_hubProc != null && !_hubProc.HasExited) _hubProc.Kill(true); } catch { }
            try { File.Delete(Path.Combine(home, "stop.request")); } catch { }
            try { File.Delete(Path.Combine(home, "server.pid")); } catch { }
            return new { ok = true, message = "The AI Hub was stopped." };
        }

        // ── API relay ──────────────────────────────────────────
        private async Task<object> HubApiAsync(string dir, JsonElement root, string user)
        {
            if (dir == null) return new { ok = false, error = "The AI Hub is not installed." };
            string method = (PipeSrvStr(root, "method") ?? "GET").ToUpperInvariant();
            string path = PipeSrvStr(root, "path") ?? "/health";
            if (!Regex.IsMatch(path, @"^/[A-Za-z0-9/_\-\.]*(\?[A-Za-z0-9=&_\-\.]*)?$") || path.Contains("..")) return new { ok = false, error = "Bad path" };
            if (method != "GET" && method != "POST" && method != "PUT") return new { ok = false, error = "Bad method" };
            string token = HubToken();
            if (token == null) return new { ok = false, error = "Not set up yet — press Install." };
            int port = PipeSrvConfigPort(HubHome(dir));
            bool runsModel = method == "POST" && (path == "/v1/chat" || path == "/v1/compare" || path == "/agents/doctor/start" ||
                                                  Regex.IsMatch(path, @"^/agents/doctor/[^/]+/resume$") || Regex.IsMatch(path, @"^/providers/[^/]+/test$") ||
                                                  path == "/agent/threads" || Regex.IsMatch(path, @"^/agent/threads/[^/]+/(send|resume)$") ||
                                                  Regex.IsMatch(path, @"^/agent/jobs/[^/]+$"));
            if (runsModel && !await AiControl.IsEnabledAsync(user))
                return new { ok = false, paused = true, error = "AI is paused (AI Digital Employee › Control). Resume it there first." };

            string body = null;
            if (root.TryGetProperty("body", out var b) && b.ValueKind == JsonValueKind.Object)
            {
                // the hub records who asked: app_user goes into chat / doctor requests
                var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(b.GetRawText());
                if (path == "/v1/chat" || path == "/v1/compare" || path == "/agents/doctor/start" || path.StartsWith("/agent/", StringComparison.Ordinal))
                    dict["app_user"] = JsonSerializer.SerializeToElement(user);
                body = JsonSerializer.Serialize(dict);
            }
            _hubHttp ??= new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            using var req = new HttpRequestMessage(new HttpMethod(method), "http://127.0.0.1:" + port + path);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            // AI Agent conversations belong to the app login that started them; the hub filters by this header
            if (!string.IsNullOrWhiteSpace(user)) req.Headers.TryAddWithoutValidation("X-App-User", user);
            if (body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/json");
            var sw = Stopwatch.StartNew();
            HttpResponseMessage resp;
            try { resp = await _hubHttp.SendAsync(req); }
            catch (HttpRequestException ex) { return new { ok = false, offline = true, error = "The AI Hub is not running (" + ex.Message + ")." }; }
            catch (TaskCanceledException) { return new { ok = false, error = "The AI Hub did not answer in time." }; }
            string text = await resp.Content.ReadAsStringAsync();
            JsonElement json;
            try { json = JsonSerializer.Deserialize<JsonElement>(string.IsNullOrWhiteSpace(text) ? "{}" : text); }
            catch { json = JsonSerializer.SerializeToElement(new { text }); }
            if (runsModel) HubAudit(user, path, (int)resp.StatusCode, json, sw.ElapsedMilliseconds);
            if (!resp.IsSuccessStatusCode)
                return new { ok = false, status = (int)resp.StatusCode, error = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("detail", out var d) ? d.ToString() : text };
            return new { ok = true, status = (int)resp.StatusCode, result = json };
        }

        private static void HubAudit(string user, string path, int status, JsonElement j, long ms)
        {
            try
            {
                string S(string k) => j.ValueKind == JsonValueKind.Object && j.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
                long? L(string k) => long.TryParse(S(k), out var x) ? x : null;
                double? D(string k) => double.TryParse(S(k), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var x) ? x : null;
                string act = path == "/v1/chat" ? "chat" : path == "/v1/compare" ? "compare" : path.StartsWith("/providers/") ? "provider_test" :
                             path.StartsWith("/agent/") ? "agent_" + (S("status") ?? "call") : "doctor_" + (S("status") ?? "call");
                bool ok = status < 400 && S("ok") != "False";
                AiControl.Audit(new AiControl.AuditEvent
                {
                    User = user, Source = path.StartsWith("/agent/") ? "AIAGENT" : "AIHUB", Action = act, Outcome = ok ? "OK" : "FAILED",
                    Model = S("provider") != null ? S("provider") + "/" + S("model") : null, TokensIn = L("tokens_in"), TokensOut = L("tokens_out"), CostUsd = D("cost"),
                    DurationMs = ms, Ref = S("thread_id"), Detail = ok ? null : (S("error") ?? S("detail") ?? ("HTTP " + status))
                });
            }
            catch (Exception ex) { Debug.WriteLine("[AiHub] audit: " + ex.Message); }
        }
    }
}

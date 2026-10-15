using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using DuckDB.NET.Data;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Sales Lens (saleslens/ page) — Setup › Python: the Python the modelling needs, installed on this PC.
    /// salesLens* IPC actions, reply salesLensResponse:
    ///   salesLensStatus   — folder, Python, the last version check and self-test, the install job (polled while it runs)
    ///   salesLensInstall  — background job (same helpers as the pipeline server / AI Hub): files → Python (existing .venv,
    ///                        the pipeline server's or AI Hub's runtime, the py launcher, else python.org 3.12 per user, no admin)
    ///                        → C:\fusion\saleslens\.venv → pip install -r requirements.txt (skipped while unchanged unless
    ///                        upgrade) → version check → self-test
    ///   salesLensCheck    — python sl_check.py versions (JSON: required / installed / loads)
    ///   salesLensSelfTest — python sl_check.py selftest (synthetic data only: Holt-Winters, LightGBM with reasons,
    ///                        scikit-learn, Parquet + DuckDB)
    ///   salesLensOpenFolder
    /// Data and results (the module itself):
    ///   salesLensSettings {settings?}  — data\settings.json (read; with settings = save, audited)
    ///   salesLensSync {months, refresh, kinds, pod}  — background job: SalesLensSync.RunAsync (Fusion → raw\*.jsonl), then a build
    ///   salesLensPutRaw {name: oos, rows}  — rows the page read from APEX (the WMS cancellation log) → raw\oos.jsonl
    ///   salesLensBuild / salesLensDemo — background job: python -m sales_intel build | demo + build (PROGRESS lines → steps)
    ///   salesLensCancel {what: sync|build}
    ///   salesLensQuery {sql, max} / salesLensQueries {sqls} — one read-only statement each on data\saleslens.duckdb
    ///   salesLensSimulate {scenario}  — python -m sales_intel simulate (the result is kept in data\sims\)
    ///   salesLensFeedback {row} / salesLensFeedbackList — data\feedback.jsonl (Accept / Reject / outcome), audited
    ///   salesLensClear {what: raw|results|all} — AI admins, audited
    /// The scripts ship as saleslens\python next to the exe and are copied to C:\fusion\saleslens\python.
    /// A nightly run (settings nightly.on / at / refreshMonths) syncs the recent months and builds, while the app is open.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private PipeSrvJob _slJob;
        private PipeSrvJob _slDataJob;
        private CancellationTokenSource _slCts;
        private System.Threading.Timer _slTimer;

        private static string SL_DIR => SalesLensPaths.Home;

        private static bool IsSalesLensAction(string action) =>
            action != null && action.StartsWith("salesLens", StringComparison.Ordinal);

        private async Task HandleSalesLensAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            string user = PipeSrvStr(root, "appUser");
            if (string.IsNullOrWhiteSpace(user) || user == "UNKNOWN") user = GetClaudeCliService().PolicyUser;
            try
            {
                switch (action)
                {
                    case "salesLensStatus":
                        data = SlStatus();
                        break;
                    case "salesLensInstall":
                        data = SlInstallStart(root.TryGetProperty("upgrade", out var up) && up.ValueKind == JsonValueKind.True, user);
                        break;
                    case "salesLensCheck":
                        data = await SlRunCheckAsync("versions", new PipeSrvJob(), 120000);
                        break;
                    case "salesLensSelfTest":
                        {
                            var r = await SlRunCheckAsync("selftest", new PipeSrvJob(), 300000);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = "python_selftest",
                                Outcome = SlOk(r) ? "OK" : "FAILED", Detail = SL_DIR });
                            data = r;
                            break;
                        }
                    case "salesLensOpenFolder":
                        Directory.CreateDirectory(SL_DIR);
                        Process.Start(new ProcessStartInfo("explorer.exe", "\"" + SL_DIR + "\"") { UseShellExecute = true });
                        data = new { ok = true };
                        break;
                    case "salesLensSettings":
                        data = await SlSettingsAsync(root, user);
                        break;
                    case "salesLensSync":
                        data = SlSyncStart(root, user);
                        break;
                    case "salesLensBuild":
                        data = SlBuildStart(false, user, null);
                        break;
                    case "salesLensDemo":
                        data = SlBuildStart(true, user, null);
                        break;
                    case "salesLensCancel":
                        try { _slCts?.Cancel(); } catch { }
                        data = new { ok = true };
                        break;
                    case "salesLensPutRaw":
                        data = SlPutRaw(root);
                        break;
                    case "salesLensQuery":
                        {
                            var r = SlQuery(new[] { PipeSrvStr(root, "sql") }, PipeSrvInt(root, "max", 5000))[0];
                            data = r;
                            break;
                        }
                    case "salesLensQueries":
                        {
                            var list = root.TryGetProperty("sqls", out var qs) && qs.ValueKind == JsonValueKind.Array
                                ? qs.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() : "").ToList() : new List<string>();
                            data = new { ok = true, results = SlQuery(list, PipeSrvInt(root, "max", 5000)) };
                            break;
                        }
                    case "salesLensSimulate":
                        data = await SlSimulateAsync(root, user);
                        break;
                    case "salesLensFeedback":
                        data = SlFeedback(root, user);
                        break;
                    case "salesLensFeedbackList":
                        data = new { ok = true, rows = SalesLensSync.ReadJsonl(SlDataFile("feedback.jsonl")) };
                        break;
                    case "salesLensSims":
                        data = SlSims(PipeSrvStr(root, "id"));
                        break;
                    case "salesLensClear":
                        data = await SlClearAsync(PipeSrvStr(root, "what"), user);
                        break;
                    default:
                        data = new { ok = false, error = "Unknown Sales Lens action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[SalesLens] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "salesLensResponse", requestId, data }));
        }

        private static string SlPython => Path.Combine(SL_DIR, ".venv", "Scripts", "python.exe");
        private static string SlScripts => Path.Combine(SL_DIR, "python");
        private static string SlDataFile(string name) => Path.Combine(SL_DIR, "data", name);

        /// <summary>saleslens\python shipped with the app (or in the repo when run from a build there).</summary>
        private static string SlBundledScripts()
        {
            for (var d = Path.GetDirectoryName(System.Windows.Forms.Application.ExecutablePath); !string.IsNullOrEmpty(d); d = Path.GetDirectoryName(d))
            {
                var c = Path.Combine(d, "saleslens", "python");
                if (File.Exists(Path.Combine(c, "sl_check.py")) && !string.Equals(Path.GetFullPath(c).TrimEnd('\\'), SlScripts, StringComparison.OrdinalIgnoreCase))
                    return c;
            }
            return null;
        }

        private static JsonElement? SlReadJson(string file)
        {
            try { if (File.Exists(file)) return JsonDocument.Parse(File.ReadAllText(file)).RootElement.Clone(); }
            catch (Exception ex) { Debug.WriteLine("[SalesLens] read " + file + ": " + ex.Message); }
            return null;
        }

        private static bool SlOk(object r) =>
            r is JsonElement e && e.ValueKind == JsonValueKind.Object && e.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;

        private object SlStatus()
        {
            string bundled = SlBundledScripts();
            string at(string f) { try { return File.Exists(f) ? File.GetLastWriteTime(f).ToString("yyyy-MM-dd HH:mm") : null; } catch { return null; } }
            return new
            {
                ok = true, folder = SL_DIR, venv = File.Exists(SlPython), python = File.Exists(SlPython) ? SlPython : null,
                scripts = File.Exists(Path.Combine(SlScripts, "sl_check.py")), bundled = bundled != null,
                versions = SlReadJson(SlDataFile("versions.json")), versionsAt = at(SlDataFile("versions.json")),
                selftest = SlReadJson(SlDataFile("selftest.json")), selftestAt = at(SlDataFile("selftest.json")),
                job = _slJob?.Snapshot(), dataJob = _slDataJob?.Snapshot(), data = SlDataStatus()
            };
        }

        /// <summary>Copies the shipped scripts (sl_check.py, requirements.txt, the sales_intel package) over the installed ones.</summary>
        private static int SlCopyScripts()
        {
            string src = SlBundledScripts();
            if (src == null) return 0;
            int n = 0;
            foreach (var f in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(src, f);
                if (rel.Split(Path.DirectorySeparatorChar).Any(x => x == "tests" || x == "__pycache__" || x.StartsWith(".", StringComparison.Ordinal))) continue;
                var ext = Path.GetExtension(f).ToLowerInvariant();
                if (ext != ".py" && ext != ".txt" && ext != ".toml") continue;
                var dst = Path.Combine(SlScripts, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(dst));
                File.Copy(f, dst, true);
                n++;
            }
            return n;
        }

        /// <summary>Runs sl_check.py (versions | selftest) in the .venv, keeps the JSON in data\ and returns it.</summary>
        private async Task<object> SlRunCheckAsync(string mode, PipeSrvJob job, int timeoutMs)
        {
            if (!File.Exists(SlPython)) return new { ok = false, error = "Python is not installed for Sales Lens yet — press Install." };
            SlCopyScripts();
            string script = Path.Combine(SlScripts, "sl_check.py");
            if (!File.Exists(script)) return new { ok = false, error = "sl_check.py is missing — this release has no saleslens\\python folder." };
            var (code, output) = await PipeSrvExecAsync(job, SlPython, "\"" + script + "\" " + mode, SL_DIR, timeoutMs, quiet: true);
            string line = output.Split('\n').Select(x => x.Trim()).LastOrDefault(x => x.StartsWith("{"));
            if (line == null)
                return new { ok = false, error = (code == -1 ? "No answer within " + timeoutMs / 1000 + " s. " : "Python ended with exit " + code + ". ") + Tail(output) };
            var el = JsonDocument.Parse(line).RootElement.Clone();
            Directory.CreateDirectory(Path.Combine(SL_DIR, "data"));
            File.WriteAllText(SlDataFile(mode == "selftest" ? "selftest.json" : "versions.json"), line);
            return el;

            static string Tail(string s) { s = (s ?? "").Trim(); return s.Length > 600 ? "…" + s.Substring(s.Length - 600) : s; }
        }

        private object SlInstallStart(bool upgrade, string user)
        {
            if (_slJob != null && _slJob.Running) return new { ok = false, error = "An install is already running." };
            if (SlBundledScripts() == null && !File.Exists(Path.Combine(SlScripts, "requirements.txt")))
                return new { ok = false, error = "This release has no saleslens\\python folder — update the app." };
            var job = new PipeSrvJob();
            foreach (var (k, l) in new[] { ("files", "Sales Lens scripts"), ("python", "Python 3.11+"), ("venv", "Virtual environment"),
                                             ("packages", "Packages (pandas, statsmodels, scikit-learn, LightGBM, duckdb, pyarrow)"),
                                             ("versions", "Version check"), ("selftest", "Self-test") })
                job.Steps.Add(new Dictionary<string, string> { ["key"] = k, ["label"] = l, ["state"] = "wait", ["detail"] = "" });
            _slJob = job;
            _ = Task.Run(() => SlInstallAsync(job, upgrade, user));
            return new { ok = true, message = upgrade ? "Updating the Python packages — follow the steps." : "Installing Python for Sales Lens — follow the steps." };
        }

        private async Task SlInstallAsync(PipeSrvJob job, bool upgrade, string user)
        {
            string step = "files";
            string dir = SL_DIR;
            try
            {
                job.Set(step, "run");
                Directory.CreateDirectory(dir);
                int n = SlCopyScripts();
                job.Set(step, "ok", n > 0 ? n + " file(s) → " + SlScripts : "using the files already in " + SlScripts);

                step = "python";
                job.Set(step, "run");
                string venvPy = SlPython, basePy = null;
                bool venvOk = File.Exists(venvPy) && (await PipeSrvExecAsync(job, venvPy, "-c \"import sys; print(sys.version)\"", dir, 30000, quiet: true)).code == 0;
                if (venvOk) job.Set(step, "ok", "using the existing .venv");
                else
                {
                    // a Python this PC already has: our own runtime, the pipeline server's, the AI Hub's
                    foreach (var c in new[] { Path.Combine(dir, "runtime", "python.exe"), Path.Combine(PIPE_SRV_INSTALL_DIR, "runtime", "python.exe"),
                                              Path.Combine(HUB_INSTALL_DIR, "runtime", "python.exe") })
                        if (File.Exists(c) && (await PipeSrvExecAsync(job, c, "-c \"import sys; print(sys.version)\"", dir, 30000, quiet: true)).code == 0)
                        { basePy = c; job.Add("Using the Python already on this PC: " + c); break; }
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
                string req = Path.Combine(SlScripts, "requirements.txt");
                if (!File.Exists(req)) throw new InvalidOperationException("requirements.txt is missing in " + SlScripts + ".");
                string reqHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(req)));
                string mark = Path.Combine(dir, ".venv", "sl-requirements.sha256");
                if (!upgrade && File.Exists(mark) && File.ReadAllText(mark).Trim() == reqHash) job.Set(step, "ok", "up to date");
                else
                {
                    job.Set(step, "run", "downloading — about 250 MB the first time, a few minutes");
                    await PipeSrvExecAsync(job, venvPy, "-m pip install --upgrade pip --disable-pip-version-check", dir, 600000);
                    var (c, _) = await PipeSrvExecAsync(job, venvPy, "-m pip install " + (upgrade ? "--upgrade " : "") + "-r \"" + req + "\" --disable-pip-version-check", dir, 2400000);
                    if (c != 0) throw new InvalidOperationException("pip install failed (exit " + c + ") — see the lines above (a proxy or no internet?).");
                    File.WriteAllText(mark, reqHash);
                    job.Set(step, "ok", upgrade ? "updated" : "installed");
                }

                step = "versions";
                job.Set(step, "run");
                var v = await SlRunCheckAsync("versions", job, 120000);
                bool vOk = SlOk(v);
                job.Set(step, vOk ? "ok" : "warn", vOk ? "every package loads" : "a package is missing or does not load — see Packages");

                step = "selftest";
                job.Set(step, "run", "a small model on made-up data");
                var t = await SlRunCheckAsync("selftest", job, 300000);
                bool tOk = SlOk(t);
                job.Set(step, tOk ? "ok" : "warn", tOk ? "forecast, LightGBM with reasons, DuckDB — all working" : "a step failed — see Self-test");
                job.Ok = vOk && tOk;
                if (!job.Ok) job.Error = "Installed, but a check failed — see the tables below.";
                job.Add("Done.");
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[SalesLens] install: " + ex);
                job.Error = ex.Message;
                job.Set(step, "fail", ex.Message);
                job.Add("FAILED: " + ex.Message);
            }
            finally
            {
                job.Running = false;
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = upgrade ? "python_update" : "python_install",
                    Outcome = job.Ok ? "OK" : "FAILED", Detail = job.Error ?? dir });
            }
        }
    
        // ── data: settings, sync, build, queries, simulations, feedback ─────────────

        private static readonly JsonSerializerOptions SlJson = new() { WriteIndented = true };

        private static JsonElement SlSettingsRead()
        {
            try
            {
                if (File.Exists(SalesLensPaths.Settings)) return JsonDocument.Parse(File.ReadAllText(SalesLensPaths.Settings)).RootElement.Clone();
            }
            catch (Exception ex) { Debug.WriteLine("[SalesLens] settings: " + ex.Message); }
            return JsonDocument.Parse("{}").RootElement.Clone();
        }

        private async Task<object> SlSettingsAsync(JsonElement root, string user)
        {
            if (!root.TryGetProperty("settings", out var set) || set.ValueKind != JsonValueKind.Object)
                return new { ok = true, settings = SlSettingsRead(), path = SalesLensPaths.Settings };
            if (!await AiControl.IsAdminAsync(user)) return new { ok = false, error = "Only an AI admin changes the Sales Lens settings." };
            Directory.CreateDirectory(SalesLensPaths.Data);
            File.WriteAllText(SalesLensPaths.Settings + ".tmp", JsonSerializer.Serialize(set, SlJson));
            File.Move(SalesLensPaths.Settings + ".tmp", SalesLensPaths.Settings, true);
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = "settings_save", Detail = Trunc(set.GetRawText(), 1500) });
            return new { ok = true, settings = SlSettingsRead() };
        }

        private static string Trunc(string s, int n) => s == null ? null : s.Length > n ? s.Substring(0, n) : s;

        private static string SlSetStr(JsonElement s, string name, string def)
        {
            if (s.ValueKind == JsonValueKind.Object && s.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString())) return v.GetString();
            return def;
        }

        private static int SlSetInt(JsonElement s, string name, int def) =>
            s.ValueKind == JsonValueKind.Object && s.TryGetProperty(name, out var v) && v.TryGetInt32(out var i) ? i : def;

        private object SlDataStatus()
        {
            var man = SalesLensSync.ReadManifest();
            var months = SalesLensSync.MonthsOnPc().OrderBy(x => x).ToList();
            object lastRun = null;
            try
            {
                var dir = Path.Combine(SalesLensPaths.Data, "runs");
                var f = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.json").OrderByDescending(x => x).FirstOrDefault() : null;
                if (f != null) lastRun = JsonDocument.Parse(File.ReadAllText(f)).RootElement.Clone();
            }
            catch { }
            var db = new FileInfo(SalesLensPaths.Db);
            return new
            {
                folder = SalesLensPaths.Data, months, manifest = man, lastRun,
                db = db.Exists ? new { size = db.Length, modified = db.LastWriteTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) } : null,
                feedback = File.Exists(SlDataFile("feedback.jsonl")) ? File.ReadLines(SlDataFile("feedback.jsonl")).Count() : 0,
                nightly = SlReadJson(SlDataFile("nightly.json"))
            };
        }

        /// <summary>yyyymm list from the page, else the last monthsBack months (the running month included).</summary>
        private static List<int> SlMonths(JsonElement root, JsonElement settings)
        {
            var list = new List<int>();
            if (root.TryGetProperty("months", out var ms) && ms.ValueKind == JsonValueKind.Array)
                foreach (var m in ms.EnumerateArray())
                    if (m.TryGetInt32(out var ym) && ym > 200001 && ym < 210012 && ym % 100 is >= 1 and <= 12) list.Add(ym);
            if (list.Count > 0) return list.Distinct().OrderBy(x => x).ToList();
            int n = Math.Clamp(SlSetInt(settings, "monthsBack", 24), 3, 60);
            var t = DateTime.Today;
            for (int i = n - 1; i >= 0; i--) { var d = t.AddMonths(-i); list.Add(d.Year * 100 + d.Month); }
            return list;
        }

        private object SlSyncStart(JsonElement root, string user, bool nightly = false)
        {
            if (_slDataJob != null && _slDataJob.Running) return new { ok = false, error = "A Sales Lens sync or build is already running." };
            if (!File.Exists(SlPython)) return new { ok = false, error = "Install Python for Sales Lens first (Setup & data › Python)." };
            var set = SlSettingsRead();
            var o = new SalesLensSync.Options
            {
                Pod = PipeSrvStr(root, "pod") ?? SlSetStr(set, "pod", null),
                Months = SlMonths(root, set),
                Refresh = root.TryGetProperty("refresh", out var rf) && rf.ValueKind == JsonValueKind.True,
                PageSize = Math.Clamp(PipeSrvInt(root, "pageSize", SlSetInt(set, "pageSize", 5000)), 200, 20000),
                ReportingCurrency = SlSetStr(set, "reportingCurrency", "MUR"),
                CostSource = set.ValueKind == JsonValueKind.Object && set.TryGetProperty("costSource", out var cs) && cs.ValueKind == JsonValueKind.Object ? cs : (JsonElement?)null,
            };
            if (set.ValueKind == JsonValueKind.Object && set.TryGetProperty("itemDff", out var dff) && dff.ValueKind == JsonValueKind.Object)
            {
                o.ProfitCenterCol = SlSetStr(dff, "profitCenter", o.ProfitCenterCol);
                o.SupplierCol = SlSetStr(dff, "supplier", o.SupplierCol);
            }
            if (root.TryGetProperty("kinds", out var ks) && ks.ValueKind == JsonValueKind.Array)
                o.Kinds = ks.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrEmpty(x)).ToList();
            bool build = !(root.TryGetProperty("build", out var b) && b.ValueKind == JsonValueKind.False);
            var job = new PipeSrvJob();
            foreach (var (k, l) in new[] { ("lines", "Order lines (" + o.Months.Count + " months)"), ("items", "Items"), ("customers", "Customers"), ("costs", "Item costs"),
                                             ("bus", "Business units"), ("rates", "Exchange rates"), ("uom", "Units of measure"), ("onhand", "On hand today"),
                                             ("ar", "Receivables overdue") })
                job.Steps.Add(new Dictionary<string, string> { ["key"] = k, ["label"] = l, ["state"] = o.Kinds.Contains(k) ? "wait" : "skip", ["detail"] = "" });
            if (build) SlBuildSteps(job);
            _slDataJob = job;
            _slCts = new CancellationTokenSource();
            var ct = _slCts.Token;
            var run = FinRunner(o.Pod);
            _ = Task.Run(async () =>
            {
                string outcome = "OK";
                try
                {
                    job.Add("Reading " + o.Months.Count + " month(s) of order lines from Fusion (" + (string.IsNullOrWhiteSpace(o.Pod) ? "the logged-in pod" : o.Pod) + ")");
                    var r = await SalesLensSync.RunAsync(run, o, (k, st, d) => job.Set(k, st, d), job.Add, ct);
                    if (r.CostSource != null)
                    {
                        try
                        {
                            var doc = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(SlSettingsRead().GetRawText()) ?? new();
                            doc["costSource"] = JsonSerializer.SerializeToElement(r.CostSource);
                            Directory.CreateDirectory(SalesLensPaths.Data);
                            File.WriteAllText(SalesLensPaths.Settings, JsonSerializer.Serialize(doc, SlJson));
                        }
                        catch (Exception ex) { job.Add("could not keep the cost table in the settings: " + ex.Message); }
                    }
                    foreach (var e in r.Errors) job.Add("! " + e);
                    if (!r.Ok) { job.Error = "The order lines could not be read — see the log."; outcome = "FAILED"; return; }
                    if (build) await SlBuildRunAsync(job, false, ct);
                    else job.Ok = true;
                    if (!job.Ok) outcome = "FAILED";
                }
                catch (OperationCanceledException) { job.Error = "Stopped."; outcome = "STOPPED"; job.Add("Stopped — the months finished so far are kept."); }
                catch (Exception ex) { job.Error = ex.Message; outcome = "FAILED"; job.Add("FAILED: " + ex.Message); }
                finally
                {
                    job.Running = false;
                    AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = nightly ? "nightly_sync" : "fusion_sync", Outcome = outcome,
                        Instance = o.Pod, Detail = o.Months.Count + " month(s) " + (o.Months.Count > 0 ? o.Months.First() + "–" + o.Months.Last() : "") + (job.Error != null ? " · " + job.Error : "") });
                    if (nightly) SlNightlyMark(outcome, job.Error);
                }
            });
            return new { ok = true, message = "Reading Fusion — follow the steps." };
        }

        private static void SlBuildSteps(PipeSrvJob job)
        {
            foreach (var (k, l) in new[] { ("read", "Read the extracts"), ("clean", "Data quality"), ("history", "History"), ("baseline", "Expected demand"),
                                             ("opps", "Missed opportunities"), ("churn", "Customer risk model"), ("orders", "Order risk models"), ("xsell", "Cross-sell"),
                                             ("price", "Price response"), ("write", "Write DuckDB") })
                job.Steps.Add(new Dictionary<string, string> { ["key"] = "b_" + k, ["label"] = l, ["state"] = "wait", ["detail"] = "" });
        }

        private object SlBuildStart(bool demo, string user, JsonElement? unused)
        {
            if (_slDataJob != null && _slDataJob.Running) return new { ok = false, error = "A Sales Lens sync or build is already running." };
            if (!File.Exists(SlPython)) return new { ok = false, error = "Install Python for Sales Lens first (Setup & data › Python)." };
            var job = new PipeSrvJob();
            if (demo) job.Steps.Add(new Dictionary<string, string> { ["key"] = "demo", ["label"] = "Demo data", ["state"] = "wait", ["detail"] = "" });
            SlBuildSteps(job);
            _slDataJob = job;
            _slCts = new CancellationTokenSource();
            var ct = _slCts.Token;
            _ = Task.Run(async () =>
            {
                try { await SlBuildRunAsync(job, demo, ct); }
                catch (Exception ex) { job.Error = ex.Message; job.Add("FAILED: " + ex.Message); }
                finally
                {
                    job.Running = false;
                    AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = demo ? "demo_build" : "build", Outcome = job.Ok ? "OK" : "FAILED", Detail = job.Error });
                }
            });
            return new { ok = true, message = demo ? "Making demo data and building — follow the steps." : "Building — follow the steps." };
        }

        /// <summary>python -m sales_intel [demo +] build; PROGRESS lines move the steps, the last JSON line is the result.</summary>
        private async Task SlBuildRunAsync(PipeSrvJob job, bool demo, CancellationToken ct)
        {
            SlCopyScripts();
            Directory.CreateDirectory(SalesLensPaths.Data);
            if (demo)
            {
                if (SalesLensSync.MonthsOnPc().Count > 0 && SalesLensSync.ReadManifest().TryGetValue("kind", out var k) && Convert.ToString(k) != "demo")
                    throw new InvalidOperationException("This PC already holds Fusion data — clear it first (Storage › Clear everything) to try the demo.");
                job.Set("demo", "run", "a made-up wholesaler, 30 months");
                var (dc, dout) = await PipeSrvExecAsync(job, SlPython, "-m sales_intel demo --root \"" + SalesLensPaths.Data + "\"", SlScripts, 600000, quiet: true);
                if (dc != 0) throw new InvalidOperationException("demo data failed: " + LastJsonError(dout));
                job.Set("demo", "ok", "written to raw\\");
            }
            string current = null;
            bool Hide(string line)
            {
                if (!line.StartsWith("PROGRESS ", StringComparison.Ordinal)) return line.TrimStart().StartsWith("{", StringComparison.Ordinal);
                try
                {
                    var e = JsonDocument.Parse(line.Substring(9)).RootElement;
                    if (e.TryGetProperty("step", out var st))
                    {
                        var key = "b_" + st.GetString();
                        if (current != null) job.Set(current, "ok");
                        if (key == "b_done") { current = null; return true; }
                        job.Set(key, "run", e.TryGetProperty("detail", out var d) ? d.GetString() : null);
                        current = key;
                        job.Add(e.GetProperty("label").GetString() + (e.TryGetProperty("detail", out var d2) && !string.IsNullOrEmpty(d2.GetString()) ? " — " + d2.GetString() : ""));
                    }
                    else if (e.TryGetProperty("note", out var n)) job.Add("  " + n.GetString());
                }
                catch { }
                return true;
            }
            var (code, output) = await PipeSrvExecAsync(job, SlPython, "-m sales_intel build --root \"" + SalesLensPaths.Data + "\"", SlScripts, 3600000, hide: Hide);
            var last = output.Split('\n').Select(x => x.Trim()).LastOrDefault(x => x.StartsWith("{", StringComparison.Ordinal));
            if (last != null) { try { job.Result = JsonDocument.Parse(last).RootElement.Clone(); } catch { } }
            if (code != 0) { if (current != null) job.Set(current, "fail"); throw new InvalidOperationException(LastJsonError(output)); }
            job.Ok = true;
            job.Add("Done — " + (job.Result is JsonElement r && r.TryGetProperty("opportunities", out var n2) ? n2.GetRawText() : "?") + " opportunities.");
        }

        private static string LastJsonError(string output)
        {
            var last = (output ?? "").Split('\n').Select(x => x.Trim()).LastOrDefault(x => x.StartsWith("{", StringComparison.Ordinal));
            if (last != null)
            {
                try
                {
                    var e = JsonDocument.Parse(last).RootElement;
                    if (e.TryGetProperty("error", out var er)) return er.GetString();
                }
                catch { }
            }
            var t = (output ?? "").Trim();
            return t.Length > 500 ? "…" + t.Substring(t.Length - 500) : t;
        }

        private object SlPutRaw(JsonElement root)
        {
            string name = PipeSrvStr(root, "name");
            if (name != "oos") return new { ok = false, error = "Unknown raw file." };
            if (!root.TryGetProperty("rows", out var rows) || rows.ValueKind != JsonValueKind.Array) return new { ok = false, error = "No rows." };
            var path = Path.Combine(SalesLensPaths.Data, "raw", "oos.jsonl");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            int n = 0;
            using (var w = new StreamWriter(path + ".tmp", false, new UTF8Encoding(false)))
                foreach (var r in rows.EnumerateArray()) { if (r.ValueKind == JsonValueKind.Object) { w.WriteLine(r.GetRawText()); n++; } }
            File.Move(path + ".tmp", path, true);
            return new { ok = true, rows = n };
        }

        private static readonly object _slDbLock = new();

        /// <summary>Read-only statements on the Sales Lens DuckDB file (attached READ_ONLY, no other files, settings locked).</summary>
        private static List<object> SlQuery(IList<string> sqls, int maxRows)
        {
            var results = new List<object>();
            maxRows = Math.Clamp(maxRows <= 0 ? 5000 : maxRows, 1, 200000);
            if (!File.Exists(SalesLensPaths.Db))
            {
                foreach (var _ in sqls) results.Add(new { ok = false, missing = true, error = "No results on this PC yet — sync from Fusion (or try the demo) and build." });
                return results;
            }
            lock (_slDbLock)
            {
                DuckDBConnection c = null;
                try
                {
                    for (int attempt = 1; ; attempt++)
                    {
                        try
                        {
                            c = new DuckDBConnection("Data Source=:memory:");
                            c.Open();
                            using (var a = c.CreateCommand())
                            {
                                a.CommandText = "ATTACH '" + SalesLensPaths.Db.Replace("'", "''") + "' AS sl (READ_ONLY); USE sl; SET enable_external_access = false; SET lock_configuration = true";
                                a.ExecuteNonQuery();
                            }
                            break;
                        }
                        catch (Exception ex) when (attempt < 6 && ex.Message.IndexOf("lock", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            c?.Dispose(); c = null;
                            Thread.Sleep(500);      // the builder is swapping the file in
                        }
                    }
                    foreach (var sql in sqls)
                    {
                        var why = FusionModel.SqlGuard.Check(sql ?? "");
                        if (why != null) { results.Add(new { ok = false, error = why }); continue; }
                        var sw = Stopwatch.StartNew();
                        try
                        {
                            using var cmd = c.CreateCommand();
                            cmd.CommandText = sql.Trim().TrimEnd(';');
                            using var r = cmd.ExecuteReader();
                            var cols = new List<string>();
                            for (int i = 0; i < r.FieldCount; i++) cols.Add(r.GetName(i));
                            var rows = new List<object[]>();
                            bool cut = false;
                            while (r.Read())
                            {
                                if (rows.Count >= maxRows) { cut = true; break; }
                                var row = new object[r.FieldCount];
                                for (int i = 0; i < r.FieldCount; i++) row[i] = r.IsDBNull(i) ? null : FusionModel.ModelEngine.ToPlain(r.GetValue(i));
                                rows.Add(row);
                            }
                            results.Add(new { ok = true, columns = cols, rows, truncated = cut, ms = sw.ElapsedMilliseconds });
                        }
                        catch (Exception ex) { results.Add(new { ok = false, error = ex.Message }); }
                    }
                }
                catch (Exception ex)
                {
                    while (results.Count < sqls.Count) results.Add(new { ok = false, error = ex.Message, busy = ex.Message.IndexOf("lock", StringComparison.OrdinalIgnoreCase) >= 0 });
                }
                finally { c?.Dispose(); }
            }
            return results;
        }

        private async Task<object> SlSimulateAsync(JsonElement root, string user)
        {
            if (!File.Exists(SlPython)) return new { ok = false, error = "Install Python for Sales Lens first." };
            if (!root.TryGetProperty("scenario", out var sc) || sc.ValueKind != JsonValueKind.Object) return new { ok = false, error = "No scenario." };
            SlCopyScripts();
            var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(sc.GetRawText()) ?? new();
            dict["by"] = JsonSerializer.SerializeToElement(user ?? "");
            var (code, output) = await PipeSrvExecAsync(new PipeSrvJob(), SlPython, "-m sales_intel simulate --stdin --root \"" + SalesLensPaths.Data + "\"", SlScripts, 180000,
                stdin: JsonSerializer.Serialize(dict), quiet: true);
            var last = output.Split('\n').Select(x => x.Trim()).LastOrDefault(x => x.StartsWith("{", StringComparison.Ordinal));
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = "simulate", Outcome = code == 0 ? "OK" : "FAILED", Detail = Trunc(sc.GetRawText(), 1000) });
            if (last == null) return new { ok = false, error = LastJsonError(output) };
            return JsonDocument.Parse(last).RootElement.Clone();
        }

        private object SlFeedback(JsonElement root, string user)
        {
            if (!root.TryGetProperty("row", out var row) || row.ValueKind != JsonValueKind.Object) return new { ok = false, error = "No feedback." };
            var d = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(row.GetRawText()) ?? new();
            if (!d.TryGetValue("opp_id", out var id) || id.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(id.GetString())) return new { ok = false, error = "The opportunity id is missing." };
            d["by"] = JsonSerializer.SerializeToElement(user ?? "");
            d["at"] = JsonSerializer.SerializeToElement(DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture));
            Directory.CreateDirectory(SalesLensPaths.Data);
            File.AppendAllText(SlDataFile("feedback.jsonl"), JsonSerializer.Serialize(d) + "\n", new UTF8Encoding(false));
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = "opp_feedback", Ref = id.GetString(), Detail = Trunc(JsonSerializer.Serialize(d), 1000) });
            return new { ok = true, row = d };
        }

        private static object SlSims(string id)
        {
            var dir = Path.Combine(SalesLensPaths.Data, "sims");
            if (!Directory.Exists(dir)) return new { ok = true, sims = new List<object>() };
            if (!string.IsNullOrWhiteSpace(id))
            {
                if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[0-9a-z-]{6,40}$")) return new { ok = false, error = "Bad id." };
                var f = Path.Combine(dir, id + ".json");
                return File.Exists(f) ? new { ok = true, sim = (object)JsonDocument.Parse(File.ReadAllText(f)).RootElement.Clone() } : new { ok = false, sim = (object)null };
            }
            var list = new List<object>();
            foreach (var f in Directory.GetFiles(dir, "*.json").OrderByDescending(x => x).Take(100))
            {
                try { list.Add(JsonDocument.Parse(File.ReadAllText(f)).RootElement.Clone()); } catch { }
            }
            return new { ok = true, sims = list };
        }

        private async Task<object> SlClearAsync(string what, string user)
        {
            if (!await AiControl.IsAdminAsync(user)) return new { ok = false, error = "Only an AI admin clears Sales Lens data." };
            if (_slDataJob != null && _slDataJob.Running) return new { ok = false, error = "A sync or build is running." };
            what = (what ?? "").ToLowerInvariant();
            var data = SalesLensPaths.Data;
            int n = 0;
            void Del(string p) { if (File.Exists(p)) { File.Delete(p); n++; } else if (Directory.Exists(p)) { Directory.Delete(p, true); n++; } }
            lock (_slDbLock)
            {
                if (what == "raw" || what == "all") Del(Path.Combine(data, "raw"));
                if (what == "results" || what == "all") { Del(SalesLensPaths.Db); Del(SalesLensPaths.Db + ".wal"); Del(Path.Combine(data, "runs")); }
                if (what == "all") { Del(Path.Combine(data, "sims")); Del(Path.Combine(data, "feedback.jsonl")); }
            }
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "SALESLENS", Action = "clear_" + what, Detail = n + " item(s)" });
            return new { ok = true, removed = n };
        }

        // ── the nightly run (sync the recent months + build), while the app is open ──
        private void StartSalesLensScheduler()
        {
            _slTimer ??= new System.Threading.Timer(_ => { try { SlNightlyTick(); } catch (Exception ex) { Debug.WriteLine("[SalesLens] nightly: " + ex.Message); } },
                null, TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(5));
        }

        private void SlNightlyTick()
        {
            var set = SlSettingsRead();
            if (set.ValueKind != JsonValueKind.Object || !set.TryGetProperty("nightly", out var n) || n.ValueKind != JsonValueKind.Object) return;
            if (!(n.TryGetProperty("on", out var on) && on.ValueKind == JsonValueKind.True)) return;
            if (!File.Exists(SlPython) || (_slDataJob != null && _slDataJob.Running)) return;
            if (!TimeSpan.TryParse(SlSetStr(n, "at", "02:30"), CultureInfo.InvariantCulture, out var at)) at = new TimeSpan(2, 30, 0);
            if (DateTime.Now.TimeOfDay < at) return;
            var last = SlReadJson(SlDataFile("nightly.json"));
            string today = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (last is JsonElement l && l.TryGetProperty("day", out var day) && day.GetString() == today) return;
            int recent = Math.Clamp(SlSetInt(n, "refreshMonths", 2), 1, 6);
            var months = new List<int>();
            for (int i = recent - 1; i >= 0; i--) { var d = DateTime.Today.AddMonths(-i); months.Add(d.Year * 100 + d.Month); }
            // the recent months again (statuses change) + any month of the history not read yet
            var have = SalesLensSync.MonthsOnPc();
            foreach (var m in SlMonths(JsonDocument.Parse("{}").RootElement, set)) if (!have.Contains(m) && !months.Contains(m)) months.Add(m);
            var body = JsonSerializer.SerializeToElement(new { months, refresh = true });
            File.WriteAllText(SlDataFile("nightly.json"), JsonSerializer.Serialize(new { day = today, started = DateTime.Now.ToString("HH:mm", CultureInfo.InvariantCulture), state = "RUNNING" }));
            SlSyncStart(body, "NIGHTLY", nightly: true);
        }

        private static void SlNightlyMark(string outcome, string error)
        {
            try
            {
                File.WriteAllText(SlDataFile("nightly.json"), JsonSerializer.Serialize(new
                {
                    day = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ended = DateTime.Now.ToString("HH:mm", CultureInfo.InvariantCulture), state = outcome, error
                }));
            }
            catch { }
        }
}
}

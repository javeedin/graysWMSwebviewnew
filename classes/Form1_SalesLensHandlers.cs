using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
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
    /// The scripts ship as saleslens\python next to the exe and are copied to C:\fusion\saleslens\python.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private PipeSrvJob _slJob;

        private const string SL_DIR = @"C:\fusion\saleslens";

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
                job = _slJob?.Snapshot()
            };
        }

        /// <summary>Copies the shipped scripts over the installed ones (they are small; always the app's version).</summary>
        private static int SlCopyScripts()
        {
            string src = SlBundledScripts();
            if (src == null) return 0;
            Directory.CreateDirectory(SlScripts);
            int n = 0;
            foreach (var f in Directory.GetFiles(src))
            {
                string name = Path.GetFileName(f);
                if (!(name.EndsWith(".py", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".txt", StringComparison.OrdinalIgnoreCase))) continue;
                File.Copy(f, Path.Combine(SlScripts, name), true);
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
    }
}

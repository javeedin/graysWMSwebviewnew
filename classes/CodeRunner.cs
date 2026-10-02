using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// Code runner for the AI Agent: Python, C#, JavaScript and PowerShell, each run in its OWN process in a fresh work
    /// folder (%LOCALAPPDATA%\GraysWMS\coderun\…) with a time limit, capped output and no secret-looking environment
    /// variables. It runs with the Windows user's rights - the guard is around it: AI admins only, a confirm card with the
    /// full code for every run (the agent's run_code tool; policy run_code can never be AUTO), the kill switch and the
    /// audit (Form1_CodeRunnerHandlers.cs).
    /// Missing runtimes are downloaded into %LOCALAPPDATA%\GraysWMS\runtimes (no admin): Python from python.org, the .NET
    /// SDK through Microsoft's dotnet-install.ps1, Node.js as the official zip. PowerShell is part of Windows.
    /// Data in: input.csv (a result grid). Data out: stdout, output.csv (→ a result table), *.png (the first one goes back
    /// to the model as an image), other files listed.
    /// </summary>
    public static class CodeRunner
    {
        public static readonly string[] LANGS = { "python", "csharp", "javascript", "powershell" };
        private const string PY_VERSION = "3.12.10";
        private const string NODE_VERSION = "22.12.0";
        private const int MAX_OUT = 200_000;

        public static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GraysWMS");
        private static string Rt(params string[] p) => Path.Combine(new[] { Root, "runtimes" }.Concat(p).ToArray());
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(20) };
        private static readonly SemaphoreSlim _csLock = new SemaphoreSlim(1, 1);

        public sealed class Install { public string State = "idle", Log = "", Error; }
        public static readonly ConcurrentDictionary<string, Install> Installs = new ConcurrentDictionary<string, Install>();

        public static string Norm(string lang)
        {
            lang = (lang ?? "").Trim().ToLowerInvariant();
            return lang switch
            {
                "py" or "python3" => "python",
                "c#" or "cs" or "dotnet" => "csharp",
                "js" or "node" or "nodejs" => "javascript",
                "ps" or "ps1" or "pwsh" => "powershell",
                _ => lang
            };
        }

        // ── runtimes ───────────────────────────────────────
        /// <summary>Path of a working runtime, or null.</summary>
        public static async Task<string> FindAsync(string lang)
        {
            switch (Norm(lang))
            {
                case "powershell":
                    return Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
                case "python":
                    {
                        string venv = Rt("pyenv", "Scripts", "python.exe");
                        if (File.Exists(venv)) return venv;
                        foreach (var p in new[] { Rt("python", "python.exe"), @"C:\fusion\ai-hub\.venv\Scripts\python.exe" })
                            if (File.Exists(p) && (await ExecAsync(p, new[] { "-c", "print(1)" }, null, null, 30)).Code == 0) return p;
                        var r = await ExecAsync("py", new[] { "-3", "-c", "import sys;print(sys.executable)" }, null, null, 30);
                        return r.Code == 0 && File.Exists(r.Out.Trim()) ? r.Out.Trim() : null;
                    }
                case "csharp":
                    {
                        foreach (var d in new[] { Rt("dotnet", "dotnet.exe"), "dotnet" })
                        {
                            var r = await ExecAsync(d, new[] { "--list-sdks" }, null, null, 30);
                            if (r.Code == 0 && Regex.IsMatch(r.Out, @"^\d+\.", RegexOptions.Multiline)) return d;
                        }
                        return null;
                    }
                case "javascript":
                    {
                        foreach (var n in new[] { Rt("node", "node.exe"), "node" })
                            if ((await ExecAsync(n, new[] { "--version" }, null, null, 30)).Code == 0) return n;
                        return null;
                    }
            }
            return null;
        }

        public static async Task<List<object>> StatusAsync()
        {
            var list = new List<object>();
            foreach (var l in LANGS)
            {
                string p = await FindAsync(l);
                Installs.TryGetValue(l, out var ins);
                list.Add(new { lang = l, installed = p != null, path = p, install = ins == null ? null : new { ins.State, ins.Log, ins.Error },
                    download = l switch { "python" => "Python " + PY_VERSION + " (python.org, ~27 MB)", "csharp" => ".NET 8 SDK (Microsoft, ~200 MB)", "javascript" => "Node.js " + NODE_VERSION + " (nodejs.org, ~30 MB)", _ => "built into Windows" } });
            }
            return list;
        }

        /// <summary>Downloads and installs a runtime into the user's folder (background; poll Installs).</summary>
        public static Task InstallAsync(string lang)
        {
            lang = Norm(lang);
            var ins = Installs.AddOrUpdate(lang, _ => new Install(), (_, old) => old.State == "running" ? old : new Install());
            if (ins.State == "running") return Task.CompletedTask;
            ins.State = "running";
            return Task.Run(async () =>
            {
                void Log(string s) { lock (ins) ins.Log = (ins.Log + s + "\n").Length > 6000 ? (ins.Log + s + "\n")[^6000..] : ins.Log + s + "\n"; }
                try
                {
                    Directory.CreateDirectory(Rt());
                    string tmp = Path.Combine(Path.GetTempPath(), "GraysWMS"); Directory.CreateDirectory(tmp);
                    if (lang == "python")
                    {
                        string py = await FindAsync("python");
                        if (py == null || py.StartsWith(@"C:\fusion\ai-hub", StringComparison.OrdinalIgnoreCase))
                        {
                            string exe = Path.Combine(tmp, $"python-{PY_VERSION}-amd64.exe");
                            Log("Downloading Python " + PY_VERSION + " from python.org…");
                            await DownloadAsync($"https://www.python.org/ftp/python/{PY_VERSION}/python-{PY_VERSION}-amd64.exe", exe);
                            Log("Installing (for this Windows user only, no admin)…");
                            var r = await ExecAsync(exe, new[] { "/quiet", "InstallAllUsers=0", "TargetDir=" + Rt("python"), "PrependPath=0", "Include_launcher=0", "Include_test=0", "Shortcuts=0" }, null, null, 900);
                            if (!File.Exists(Rt("python", "python.exe"))) throw new Exception("Python installer exit " + r.Code + ": " + r.Err);
                            py = Rt("python", "python.exe");
                        }
                        Log("Creating the code-runner environment…");
                        var v = await ExecAsync(py, new[] { "-m", "venv", Rt("pyenv") }, null, null, 300);
                        if (!File.Exists(Rt("pyenv", "Scripts", "python.exe"))) throw new Exception("venv failed: " + v.Err);
                        Log("Adding pandas and matplotlib (charts, tables)…");
                        await ExecAsync(Rt("pyenv", "Scripts", "python.exe"), new[] { "-m", "pip", "install", "--disable-pip-version-check", "-q", "pandas", "matplotlib", "openpyxl" }, null, null, 900);
                    }
                    else if (lang == "csharp")
                    {
                        string ps1 = Path.Combine(tmp, "dotnet-install.ps1");
                        Log("Downloading Microsoft's dotnet-install script…");
                        await DownloadAsync("https://dot.net/v1/dotnet-install.ps1", ps1);
                        Log("Installing the .NET 8 SDK into your user folder (a few minutes)…");
                        var r = await ExecAsync(Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
                            new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Channel", "8.0", "-InstallDir", Rt("dotnet"), "-NoPath" }, null, null, 1800);
                        if (!File.Exists(Rt("dotnet", "dotnet.exe"))) throw new Exception("dotnet-install exit " + r.Code + ": " + Tail(r.Err + r.Out));
                    }
                    else if (lang == "javascript")
                    {
                        string zip = Path.Combine(tmp, $"node-v{NODE_VERSION}-win-x64.zip");
                        Log("Downloading Node.js " + NODE_VERSION + "…");
                        await DownloadAsync($"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-win-x64.zip", zip);
                        string stage = Rt("node-stage"); if (Directory.Exists(stage)) Directory.Delete(stage, true);
                        ZipFile.ExtractToDirectory(zip, stage);
                        if (Directory.Exists(Rt("node"))) Directory.Delete(Rt("node"), true);
                        Directory.Move(Path.Combine(stage, $"node-v{NODE_VERSION}-win-x64"), Rt("node"));
                        Directory.Delete(stage, true);
                    }
                    if (await FindAsync(lang) == null) throw new Exception("installed, but it does not start");
                    Log("Ready."); ins.State = "done";
                }
                catch (Exception ex) { ins.Error = ex.Message; ins.State = "error"; Log("Failed: " + ex.Message); }
            });
        }

        private static async Task DownloadAsync(string url, string file)
        {
            using var resp = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            resp.EnsureSuccessStatusCode();
            await using var fs = File.Create(file + ".part");
            await resp.Content.CopyToAsync(fs);
            fs.Close();
            File.Move(file + ".part", file, true);
        }

        // ── run ────────────────────────────────────────────
        public sealed class RunResult
        {
            public bool Ok; public int ExitCode; public long Ms; public string Stdout = "", Stderr = "", Folder, Error;
            public List<object> Files = new List<object>();
            public List<string> Columns; public List<List<string>> Rows;
            public string ImageName, ImageBase64;
        }

        /// <summary>Runs one snippet. grid = rows written to input.csv first; packages = pip / NuGet packages to add.</summary>
        public static async Task<RunResult> RunAsync(string lang, string code, string stdin, int timeoutS, List<string> packages,
            List<string> gridCols, List<List<string>> gridRows, CancellationToken ct = default,
            List<(string Name, List<string> Cols, List<List<string>> Rows)> extra = null)
        {
            lang = Norm(lang);
            var res = new RunResult();
            if (!LANGS.Contains(lang)) { res.Error = "Language must be one of: " + string.Join(", ", LANGS); return res; }
            if (string.IsNullOrWhiteSpace(code)) { res.Error = "No code."; return res; }
            timeoutS = Math.Clamp(timeoutS <= 0 ? 60 : timeoutS, 5, 600);
            string exe = await FindAsync(lang);
            if (exe == null) { res.Error = lang + " is not installed on this PC yet — install it in Code runner (one click) or confirm the download."; return res; }

            string dir = Path.Combine(Root, "coderun", DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..6]);
            Directory.CreateDirectory(dir);
            res.Folder = dir;
            if (gridCols != null && gridCols.Count > 0) WriteCsv(Path.Combine(dir, "input.csv"), gridCols, gridRows ?? new List<List<string>>());
            // the Code tab's Data sources: one <name>.csv each (names checked: letters, digits, _; never input / output)
            foreach (var x in (extra ?? new List<(string, List<string>, List<List<string>>)>()).Take(3))
                if (Regex.IsMatch(x.Name ?? "", @"^[A-Za-z_][A-Za-z0-9_]{0,39}$") && !x.Name.Equals("input", StringComparison.OrdinalIgnoreCase) && !x.Name.Equals("output", StringComparison.OrdinalIgnoreCase) && x.Cols != null && x.Cols.Count > 0)
                    WriteCsv(Path.Combine(dir, x.Name + ".csv"), x.Cols, x.Rows ?? new List<List<string>>());
            packages = (packages ?? new List<string>()).Where(p => Regex.IsMatch(p ?? "", @"^[A-Za-z0-9_.\-\[\]=<>~!,]{1,80}$")).Take(15).ToList();

            string[] args;
            switch (lang)
            {
                case "python":
                    if (packages.Count > 0 && exe.StartsWith(Rt("pyenv"), StringComparison.OrdinalIgnoreCase))
                    {
                        var pip = await ExecAsync(exe, new[] { "-m", "pip", "install", "--disable-pip-version-check", "-q" }.Concat(packages).ToArray(), null, dir, 600);
                        if (pip.Code != 0) res.Stderr += "[pip] " + Tail(pip.Err) + "\n";
                    }
                    File.WriteAllText(Path.Combine(dir, "main.py"), code, new UTF8Encoding(false));
                    args = new[] { "-X", "utf8", "main.py" };
                    break;
                case "javascript":
                    File.WriteAllText(Path.Combine(dir, "main.js"), code, new UTF8Encoding(false));
                    args = new[] { "main.js" };
                    break;
                case "powershell":
                    File.WriteAllText(Path.Combine(dir, "main.ps1"), code, new UTF8Encoding(true));
                    args = new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "main.ps1" };
                    break;
                default: // csharp: a console project with top-level statements
                    {
                        string refs = string.Join("", packages.Select(p => { var m = p.Split(new[] { '=', '@' }, 2); return $"<PackageReference Include=\"{m[0]}\" Version=\"{(m.Length > 1 ? m[1] : "*")}\" />"; }));
                        File.WriteAllText(Path.Combine(dir, "run.csproj"),
                            "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings>" +
                            "<Nullable>disable</Nullable><NoWarn>CS1998;CS8321</NoWarn></PropertyGroup><ItemGroup>" + refs + "</ItemGroup></Project>");
                        File.WriteAllText(Path.Combine(dir, "Program.cs"), code, new UTF8Encoding(false));
                        args = new[] { "run", "-c", "Release", "--nologo", "--project", "run.csproj" };
                        timeoutS = Math.Max(timeoutS, 180);    // the first build restores and compiles
                        break;
                    }
            }

            var sw = Stopwatch.StartNew();
            if (lang == "csharp") await _csLock.WaitAsync(ct);
            try
            {
                var r = await ExecAsync(exe, args, stdin, dir, timeoutS, ct);
                res.ExitCode = r.Code; res.Stdout = Cap(r.Out); res.Stderr += Cap(r.Err);
                res.Ok = r.Code == 0 && !r.TimedOut;
                if (r.TimedOut) res.Error = "Stopped after " + timeoutS + " s (time limit).";
            }
            finally { if (lang == "csharp") _csLock.Release(); }
            res.Ms = sw.ElapsedMilliseconds;

            foreach (var f in Directory.GetFiles(dir).Where(f => !Regex.IsMatch(Path.GetFileName(f), @"^(main\.(py|js|ps1)|Program\.cs|run\.csproj|input\.csv)$", RegexOptions.IgnoreCase)))
                res.Files.Add(new { name = Path.GetFileName(f), bytes = new FileInfo(f).Length });
            string outCsv = Path.Combine(dir, "output.csv");
            if (File.Exists(outCsv)) (res.Columns, res.Rows) = ReadCsv(outCsv, 5000);
            var png = Directory.GetFiles(dir, "*.png").OrderBy(f => f).FirstOrDefault();
            if (png != null && new FileInfo(png).Length < 3_000_000) { res.ImageName = Path.GetFileName(png); res.ImageBase64 = Convert.ToBase64String(File.ReadAllBytes(png)); }
            return res;
        }

        // ── helpers ────────────────────────────────────────
        public sealed class ExecResult { public int Code; public string Out = "", Err = ""; public bool TimedOut; }

        public static async Task<ExecResult> ExecAsync(string exe, string[] args, string stdin, string cwd, int timeoutS, CancellationToken ct = default)
        {
            var r = new ExecResult();
            var psi = new ProcessStartInfo(exe) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
            if (cwd != null) psi.WorkingDirectory = cwd;
            foreach (var a in args) psi.ArgumentList.Add(a);
            // the code never sees secret-looking environment variables
            foreach (var k in psi.Environment.Keys.ToList()) if (Regex.IsMatch(k, "token|secret|passw|pwd|apikey|api_key|credential|_key$", RegexOptions.IgnoreCase)) psi.Environment.Remove(k);
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
            psi.Environment["DOTNET_NOLOGO"] = "1";
            psi.Environment["MPLBACKEND"] = "Agg";
            Process p;
            try { p = Process.Start(psi); }
            catch (Exception ex) { r.Code = -1; r.Err = ex.Message; return r; }
            using (p)
            {
                var o = p.StandardOutput.ReadToEndAsync();
                var e = p.StandardError.ReadToEndAsync();
                try { if (stdin != null) await p.StandardInput.WriteAsync(stdin); p.StandardInput.Close(); } catch { }
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(timeoutS));
                try { await p.WaitForExitAsync(cts.Token); }
                catch (OperationCanceledException) { r.TimedOut = true; try { p.Kill(true); } catch { } }
                r.Out = await o; r.Err = await e;
                r.Code = r.TimedOut ? -1 : p.ExitCode;
            }
            return r;
        }

        private static string Cap(string s) => s == null ? "" : s.Length > MAX_OUT ? s.Substring(0, MAX_OUT) + "\n… (cut)" : s;
        private static string Tail(string s) => s == null ? "" : s.Length > 600 ? s[^600..] : s;

        private static void WriteCsv(string file, List<string> cols, List<List<string>> rows)
        {
            string Q(string v) { v ??= ""; return v.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v; }
            var sb = new StringBuilder(string.Join(",", cols.Select(Q))).Append('\n');
            foreach (var r in rows) sb.Append(string.Join(",", r.Select(Q))).Append('\n');
            File.WriteAllText(file, sb.ToString(), new UTF8Encoding(false));
        }

        private static (List<string>, List<List<string>>) ReadCsv(string file, int max)
        {
            var rows = new List<List<string>>();
            var text = File.ReadAllText(file);
            var cur = new List<string>(); var sb = new StringBuilder(); bool q = false;
            for (int i = 0; i < text.Length && rows.Count <= max; i++)
            {
                char c = text[i];
                if (q) { if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { sb.Append('"'); i++; } else if (c == '"') q = false; else sb.Append(c); }
                else if (c == '"') q = true;
                else if (c == ',') { cur.Add(sb.ToString()); sb.Clear(); }
                else if (c == '\n' || c == '\r') { if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++; cur.Add(sb.ToString()); sb.Clear(); if (cur.Count > 1 || cur[0] != "") rows.Add(cur); cur = new List<string>(); }
                else sb.Append(c);
            }
            if (sb.Length > 0 || cur.Count > 0) { cur.Add(sb.ToString()); rows.Add(cur); }
            if (rows.Count == 0) return (new List<string>(), rows);
            return (rows[0], rows.Skip(1).Take(max).ToList());
        }
    }
}

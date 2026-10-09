using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using WMSApp.Bip;

namespace WMSApp
{
    /// <summary>
    /// Oracle BIP Reporting (bip/index.html) — host side. Every action carries `instance` (PROD / TEST, else the logged-in pod).
    ///   bipStatus                                   pod, Fusion user, run folder, catalog index summary
    ///   bipCatalog     { path, refresh }            one folder of the catalog (CatalogService.getFolderContents, cached 10 min per pod)
    ///   bipIndex       { root, max }                walks the catalog for the search box (progress bipProgress), saved per pod; bipIndexGet reads it; bipIndexCancel
    ///   bipDefinition  { path }                     ReportService.getReportDefinition (templates, formats, data model, parameters)
    ///   bipParameters  { path }                     ReportService.getReportParameters (types, defaults, LOV labels)
    ///   bipDataModel   { path }                     the SQL behind a report: CatalogService.downloadObject of its data model (.xdm)
    ///   bipPreview     { path, format, params … }   the runReport envelope that would be sent (password masked)
    ///   bipRun         { path, name, format, template, locale, params, buckets, chunkBytes, timeoutMs, sample }
    ///                                               runs the report (streamed to disk, chunked when big) — with `buckets` once per bucket, the CSVs
    ///                                               appended into one file; progress bipProgress { runId, phase, bucket, buckets, label, bytes, rows, ms }
    ///   bipCancel      { runId }                    stops a run after the call in hand
    ///   bipRows        { runId, offset, limit }     a page of the result rows (csv / xml)
    ///   bipRuns, bipRunDelete { runId }, bipRunOpen { runId, file }, bipRunFolder { runId }, bipRunSaveAs { runId, file }
    /// Replies: { action: "bipResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        private static bool IsBipAction(string action) =>
            action != null && action.StartsWith("bip", StringComparison.Ordinal) && action.Length > 3 && char.IsUpper(action[3]);

        private static readonly string BipRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GraysWMS", "Bip");
        private static readonly string BipRunsRoot = Path.Combine(BipRoot, "runs");
        private static readonly string BipIndexRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "Bip");
        private readonly ConcurrentDictionary<string, CancellationTokenSource> _bipRunning = new ConcurrentDictionary<string, CancellationTokenSource>();
        private readonly ConcurrentDictionary<string, (DateTime At, List<BipCatalogItem> Items)> _bipFolderCache = new ConcurrentDictionary<string, (DateTime, List<BipCatalogItem>)>(StringComparer.OrdinalIgnoreCase);
        private static readonly JsonSerializerOptions BipJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
        private static readonly JsonSerializerOptions BipJsonCompact = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        private BipService BipFor(string instance)
        {
            string pod = (instance ?? "").ToUpperInvariant();
            if (pod != "PROD" && pod != "TEST") pod = string.IsNullOrWhiteSpace(_loggedInInstance) ? "PROD" : _loggedInInstance.ToUpperInvariant();
            return new BipService(async () =>
            {
                if (!_fusionCredentialsLoaded || string.IsNullOrEmpty(_fusionUsername) || string.IsNullOrEmpty(_fusionPassword))
                    await FetchFusionCredentialsOnStartup();
                return (_fusionUsername, _fusionPassword);
            }, pod);
        }

        private async Task HandleBipAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            string user = PStr(root, "appUser");
            if (string.IsNullOrWhiteSpace(user) || user == "UNKNOWN") user = Environment.UserName;
            var svc = BipFor(PStr(root, "instance"));
            void Progress(object o) { try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "bipProgress", requestId, data = o }, BipJsonCompact)); } catch { } }
            try
            {
                switch (action)
                {
                    case "bipStatus":
                    {
                        Directory.CreateDirectory(BipRunsRoot);
                        var idx = BipIndexSummary(svc.Pod);
                        int runs = 0; try { runs = Directory.GetDirectories(BipRunsRoot).Length; } catch { }
                        data = new { ok = true, pod = svc.Pod, origin = svc.Origin, user = _fusionUsername, runsRoot = BipRunsRoot, runs, index = idx, running = _bipRunning.Keys.ToArray() };
                        break;
                    }
                    case "bipCatalog":
                    {
                        string path = (PStr(root, "path") ?? "/").Trim(); if (path.Length > 1) path = path.TrimEnd('/');
                        string key = svc.Pod + "|" + path;
                        if (!PBool(root, "refresh") && _bipFolderCache.TryGetValue(key, out var c) && (DateTime.UtcNow - c.At).TotalMinutes < 10)
                        { data = new { ok = true, path, items = c.Items, cached = true, at = c.At.ToLocalTime().ToString("HH:mm:ss") }; break; }
                        var items = await svc.FolderContentsAsync(path);
                        _bipFolderCache[key] = (DateTime.UtcNow, items);
                        data = new { ok = true, path, items, cached = false, at = DateTime.Now.ToString("HH:mm:ss") };
                        break;
                    }
                    case "bipIndex":
                    {
                        string key = "index:" + svc.Pod;
                        if (_bipRunning.ContainsKey(key)) { data = new { ok = false, error = "The catalog of " + svc.Pod + " is already being indexed." }; break; }
                        var cts = new CancellationTokenSource(); _bipRunning[key] = cts;
                        try
                        {
                            string rootPath = PStr(root, "root") ?? "/";
                            int max = root.TryGetProperty("max", out var mx) && mx.TryGetInt32(out int m) ? Math.Clamp(m, 10, 5000) : 1500;
                            var sw = Stopwatch.StartNew();
                            var items = await Task.Run(() => svc.IndexAsync(rootPath, max, (done, left, p) => Progress(new { phase = "index", folders = done, queued = left, path = p, ms = sw.ElapsedMilliseconds }), cts.Token));
                            var file = new JsonObject
                            {
                                ["pod"] = svc.Pod, ["root"] = rootPath, ["at"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), ["ms"] = sw.ElapsedMilliseconds,
                                ["folders"] = items.Count(i => i.Type == "Folder"), ["reports"] = items.Count(i => i.Type == "Report"),
                                ["items"] = JsonSerializer.SerializeToNode(items, BipJsonCompact)
                            };
                            Directory.CreateDirectory(BipIndexRoot);
                            File.WriteAllText(BipIndexFile(svc.Pod), file.ToJsonString());
                            data = new { ok = true, at = file["at"].GetValue<string>(), folders = (int)file["folders"], reports = (int)file["reports"], items, ms = sw.ElapsedMilliseconds };
                        }
                        catch (OperationCanceledException) { data = new { ok = false, error = "Indexing stopped." }; }
                        finally { _bipRunning.TryRemove(key, out _); cts.Dispose(); }
                        break;
                    }
                    case "bipIndexCancel":
                        if (_bipRunning.TryGetValue("index:" + svc.Pod, out var ic)) ic.Cancel();
                        data = new { ok = true };
                        break;
                    case "bipIndexGet":
                    {
                        string f = BipIndexFile(svc.Pod);
                        if (!File.Exists(f)) { data = new { ok = true, items = Array.Empty<object>(), at = (string)null }; break; }
                        var node = JsonNode.Parse(File.ReadAllText(f)).AsObject();
                        data = new { ok = true, at = node["at"]?.GetValue<string>(), folders = node["folders"]?.GetValue<int>() ?? 0, reports = node["reports"]?.GetValue<int>() ?? 0, items = node["items"] };
                        break;
                    }
                    case "bipDefinition":
                        data = new { ok = true, def = await svc.DefinitionAsync(PStr(root, "path")) };
                        break;
                    case "bipParameters":
                        data = new { ok = true, prms = await svc.ParametersAsync(PStr(root, "path")) };
                        break;
                    case "bipDataModel":
                    {
                        string path = (PStr(root, "path") ?? "").Trim();
                        string dm = path;
                        if (Regex.IsMatch(path, @"\.xdo$", RegexOptions.IgnoreCase))
                        {
                            var def = await svc.DefinitionAsync(path);
                            dm = def.DataModelUrl;
                            if (string.IsNullOrWhiteSpace(dm)) { data = new { ok = false, error = "The report definition names no data model." }; break; }
                        }
                        var bytes = await svc.DownloadObjectAsync(dm);
                        var model = BipService.ParseDataModel(bytes);
                        data = new { ok = true, dataModel = dm, model, bytes = bytes.Length };
                        break;
                    }
                    case "bipPreview":
                        data = new { ok = true, envelope = svc.RunEnvelopePreview(BipReadRequest(root)) };
                        break;
                    case "bipRun":
                        data = await BipRunAsync(svc, root, user, Progress);
                        break;
                    case "bipCancel":
                    {
                        string id = PStr(root, "runId") ?? "";
                        if (_bipRunning.TryGetValue(id, out var rc)) { rc.Cancel(); data = new { ok = true, cancelled = true }; }
                        else data = new { ok = true, cancelled = false };
                        break;
                    }
                    case "bipRows":
                    {
                        string dir = BipRunDir(PStr(root, "runId"));
                        if (dir == null) { data = new { ok = false, error = "Unknown run." }; break; }
                        var run = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "run.json"))).AsObject();
                        string file = Path.Combine(dir, run["file"]?.GetValue<string>() ?? "output.csv");
                        if (!File.Exists(file)) { data = new { ok = false, error = "The result file is gone." }; break; }
                        long offset = root.TryGetProperty("offset", out var off) && off.TryGetInt64(out long o) ? Math.Max(0, o) : 0;
                        int limit = root.TryGetProperty("limit", out var lim) && lim.TryGetInt32(out int l) ? Math.Clamp(l, 1, 100_000) : 20_000;
                        string fmt = run["format"]?.GetValue<string>() ?? "csv";
                        var page = await Task.Run(() => fmt == "xml" ? BipService.ReadXml(file, offset, limit) : BipService.ReadCsv(file, offset, limit));
                        data = new { ok = true, columns = page.Columns, rows = page.Rows, total = page.Total, offset, file };
                        break;
                    }
                    case "bipRuns":
                        data = new { ok = true, runs = BipRuns() };
                        break;
                    case "bipRunDelete":
                    {
                        string dir = BipRunDir(PStr(root, "runId"));
                        if (dir != null && !_bipRunning.ContainsKey(Path.GetFileName(dir))) { try { Directory.Delete(dir, true); } catch (Exception ex) { data = new { ok = false, error = ex.Message }; break; } }
                        data = new { ok = true };
                        break;
                    }
                    case "bipRunOpen":
                    {
                        string f = BipRunFile(PStr(root, "runId"), PStr(root, "file"));
                        if (f == null) { data = new { ok = false, error = "The file is no longer on this PC." }; break; }
                        Process.Start(new ProcessStartInfo(f) { UseShellExecute = true });
                        data = new { ok = true };
                        break;
                    }
                    case "bipRunFolder":
                    {
                        string dir = BipRunDir(PStr(root, "runId")) ?? BipRunsRoot;
                        Directory.CreateDirectory(dir);
                        Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
                        data = new { ok = true, dir };
                        break;
                    }
                    case "bipRunSaveAs":
                    {
                        string f = BipRunFile(PStr(root, "runId"), PStr(root, "file"));
                        if (f == null) { data = new { ok = false, error = "The file is no longer on this PC." }; break; }
                        string target = null;
                        using (var dlg = new SaveFileDialog
                        {
                            FileName = PStr(root, "fileName") ?? Path.GetFileName(f),
                            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + "\\Downloads",
                            Filter = Path.GetExtension(f).TrimStart('.').ToUpperInvariant() + " file|*" + Path.GetExtension(f) + "|All files|*.*",
                            Title = "Save the report output"
                        })
                        {
                            if (dlg.ShowDialog(this) == DialogResult.OK) target = dlg.FileName;
                        }
                        if (target == null) { data = new { ok = true, cancelled = true }; break; }
                        File.Copy(f, target, true);
                        data = new { ok = true, path = target };
                        break;
                    }
                    default:
                        data = new { ok = false, error = "Unknown action " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[BIP] " + action + ": " + ex);
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "bipResponse", requestId, data }, BipJsonCompact));
        }

        private static string BipIndexFile(string pod) => Path.Combine(BipIndexRoot, "catalog_" + pod + ".json");

        private static object BipIndexSummary(string pod)
        {
            try
            {
                string f = BipIndexFile(pod);
                if (!File.Exists(f)) return null;
                var node = JsonNode.Parse(File.ReadAllText(f)).AsObject();
                return new { at = node["at"]?.GetValue<string>(), root = node["root"]?.GetValue<string>(), folders = node["folders"]?.GetValue<int>() ?? 0, reports = node["reports"]?.GetValue<int>() ?? 0 };
            }
            catch { return null; }
        }

        private static string BipRunDir(string runId)
        {
            if (string.IsNullOrWhiteSpace(runId) || !Regex.IsMatch(runId, @"^[A-Za-z0-9_\-]{6,60}$")) return null;
            string dir = Path.Combine(BipRunsRoot, runId);
            return Directory.Exists(dir) ? dir : null;
        }

        private static string BipRunFile(string runId, string file)
        {
            string dir = BipRunDir(runId); if (dir == null) return null;
            string name = string.IsNullOrWhiteSpace(file) ? null : Path.GetFileName(file);
            if (name == null)
            {
                try { name = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "run.json")))?["file"]?.GetValue<string>(); } catch { }
            }
            if (string.IsNullOrWhiteSpace(name)) return null;
            string f = Path.Combine(dir, name);
            return File.Exists(f) ? f : null;
        }

        private static List<JsonNode> BipRuns()
        {
            var list = new List<(DateTime At, JsonNode Node)>();
            if (!Directory.Exists(BipRunsRoot)) return new List<JsonNode>();
            foreach (var dir in Directory.GetDirectories(BipRunsRoot))
            {
                string f = Path.Combine(dir, "run.json");
                if (!File.Exists(f)) continue;
                try { list.Add((Directory.GetCreationTime(dir), JsonNode.Parse(File.ReadAllText(f)))); } catch { }
            }
            return list.OrderByDescending(x => x.At).Take(300).Select(x => x.Node).ToList();
        }

        private static Dictionary<string, List<string>> BipReadParams(JsonElement root, string prop)
        {
            var d = new Dictionary<string, List<string>>();
            if (!root.TryGetProperty(prop, out var p) || p.ValueKind != JsonValueKind.Object) return d;
            foreach (var kv in p.EnumerateObject())
            {
                var vals = new List<string>();
                if (kv.Value.ValueKind == JsonValueKind.Array) foreach (var v in kv.Value.EnumerateArray()) { if (v.ValueKind != JsonValueKind.Null) vals.Add(v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText()); }
                else if (kv.Value.ValueKind == JsonValueKind.String) vals.Add(kv.Value.GetString());
                else if (kv.Value.ValueKind != JsonValueKind.Null) vals.Add(kv.Value.GetRawText());
                d[kv.Name] = vals;
            }
            return d;
        }

        private static BipRunRequest BipReadRequest(JsonElement root)
        {
            var req = new BipRunRequest
            {
                Path = (PStr(root, "path") ?? "").Trim(),
                Format = (PStr(root, "format") ?? "csv").Trim().ToLowerInvariant(),
                Template = PStr(root, "template"),
                Locale = PStr(root, "locale"),
                Params = BipReadParams(root, "params")
            };
            if (root.TryGetProperty("chunkBytes", out var cb) && cb.TryGetInt32(out int c)) req.ChunkBytes = c <= 0 ? -1 : Math.Clamp(c, 500_000, 200_000_000);
            if (root.TryGetProperty("timeoutMs", out var tm) && tm.TryGetInt32(out int t)) req.TimeoutMs = Math.Clamp(t, 30_000, 6 * 3_600_000);
            return req;
        }

        private static string BipExt(string format) => format switch { "csv" => "csv", "xml" => "xml", "pdf" => "pdf", "xlsx" => "xlsx", "excel" => "xls", "excel2000" => "xls", "html" => "html", "rtf" => "rtf", "docx" => "docx", "pptx" => "pptx", "mhtml" => "mhtml", "data" => "xml", _ => format };

        /// <summary>One run, or one run per bucket with the CSVs appended into one output — everything written under runs\{runId}\ with run.json.</summary>
        private async Task<object> BipRunAsync(BipService svc, JsonElement root, string user, Action<object> progress)
        {
            var req = BipReadRequest(root);
            if (!BipService.PathOk(req.Path, out string why)) return new { ok = false, error = why };
            var buckets = new List<(string Label, Dictionary<string, List<string>> Params)>();
            if (root.TryGetProperty("buckets", out var bk) && bk.ValueKind == JsonValueKind.Array)
                foreach (var b in bk.EnumerateArray()) buckets.Add((PStr(b, "label") ?? ("bucket " + (buckets.Count + 1)), BipReadParams(b, "params")));
            if (buckets.Count > 2000) return new { ok = false, error = "At most 2,000 buckets in one run." };
            int sample = root.TryGetProperty("sample", out var sm) && sm.TryGetInt32(out int s) ? Math.Clamp(s, 0, 50_000) : 500;
            string name = PStr(root, "name") ?? Path.GetFileNameWithoutExtension(req.Path);
            string runId = DateTime.Now.ToString("yyyyMMdd_HHmmss") + "_" + Guid.NewGuid().ToString("N").Substring(0, 6);
            string dir = Path.Combine(BipRunsRoot, runId);
            Directory.CreateDirectory(dir);
            string ext = BipExt(req.Format);
            string outFile = "output." + ext;
            var cts = new CancellationTokenSource(); _bipRunning[runId] = cts;
            var sw = Stopwatch.StartNew();
            var run = new JsonObject
            {
                ["runId"] = runId, ["pod"] = svc.Pod, ["path"] = req.Path, ["name"] = name, ["format"] = req.Format, ["template"] = req.Template,
                ["params"] = JsonSerializer.SerializeToNode(req.Params, BipJsonCompact), ["buckets"] = buckets.Count, ["bucketList"] = JsonSerializer.SerializeToNode(buckets.Select(b => new { label = b.Label, prms = b.Params }), BipJsonCompact),
                ["startedAt"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), ["status"] = "RUNNING", ["file"] = outFile, ["user"] = user, ["pc"] = Environment.MachineName
            };
            void Save() { try { File.WriteAllText(Path.Combine(dir, "run.json"), run.ToJsonString(BipJson)); } catch { } }
            Save();
            var failed = new List<object>(); long bytes = 0, rows = 0; int done = 0, chunks = 0; var files = new List<string>();
            string error = null;
            try
            {
                if (buckets.Count == 0)
                {
                    var r = await Task.Run(() => svc.RunToFileAsync(req, Path.Combine(dir, outFile), new Progress<BipProgress>(p => progress(new { runId, phase = p.Phase, bucket = 1, buckets = 1, label = "", bytes = p.Bytes, chunks = p.Chunks, ms = sw.ElapsedMilliseconds, message = p.Message })), cts.Token));
                    if (!r.Ok) error = r.Error;
                    else { bytes = r.Bytes; chunks = r.Chunks; files.Add(outFile); if (req.Format == "csv") rows = await Task.Run(() => BipService.CountCsv(Path.Combine(dir, outFile))); done = 1; }
                }
                else
                {
                    bool headerWritten = false;
                    for (int i = 0; i < buckets.Count; i++)
                    {
                        cts.Token.ThrowIfCancellationRequested();
                        var (label, prms) = buckets[i];
                        var breq = new BipRunRequest { Path = req.Path, Format = req.Format, Template = req.Template, Locale = req.Locale, ChunkBytes = req.ChunkBytes, TimeoutMs = req.TimeoutMs, Params = new Dictionary<string, List<string>>(req.Params) };
                        foreach (var kv in prms) breq.Params[kv.Key] = kv.Value;
                        string part = "part_" + (i + 1).ToString("0000") + "." + ext;
                        int bi = i + 1; long rowsBefore = rows, bytesBefore = bytes;
                        progress(new { runId, phase = "bucket", bucket = bi, buckets = buckets.Count, label, bytes, rows, ms = sw.ElapsedMilliseconds, message = "Bucket " + bi + " of " + buckets.Count + " · " + label });
                        var r = await Task.Run(() => svc.RunToFileAsync(breq, Path.Combine(dir, part), new Progress<BipProgress>(p => progress(new { runId, phase = p.Phase, bucket = bi, buckets = buckets.Count, label, bytes = bytesBefore + p.Bytes, rows, chunks = p.Chunks, ms = sw.ElapsedMilliseconds, message = label + " · " + p.Message })), cts.Token));
                        if (!r.Ok) { failed.Add(new { bucket = bi, label, error = r.Error }); if (r.Error == "Cancelled.") break; continue; }
                        bytes += r.Bytes; chunks += r.Chunks; done++;
                        if (req.Format == "csv")
                        {
                            long n = await Task.Run(() => BipService.AppendCsv(Path.Combine(dir, part), Path.Combine(dir, outFile), !headerWritten));
                            headerWritten = true; rows += n;
                            try { File.Delete(Path.Combine(dir, part)); } catch { }
                        }
                        else files.Add(part);
                        progress(new { runId, phase = "bucketDone", bucket = bi, buckets = buckets.Count, label, bytes, rows, rowsAdded = rows - rowsBefore, ms = sw.ElapsedMilliseconds, message = label + " · " + (rows - rowsBefore).ToString("N0") + " rows" });
                    }
                    if (req.Format == "csv") { if (headerWritten) files.Add(outFile); else if (failed.Count > 0) error = "Every bucket failed: " + failed.Count + " of " + buckets.Count; }
                    else if (files.Count == 0) error = failed.Count > 0 ? "Every bucket failed." : "Nothing ran.";
                    else run["file"] = files[0];
                }
            }
            catch (OperationCanceledException) { error = "Cancelled after " + done + " of " + Math.Max(1, buckets.Count) + "."; }
            catch (Exception ex) { error = ex.Message; }
            finally { _bipRunning.TryRemove(runId, out _); cts.Dispose(); }

            run["status"] = error == null ? (failed.Count > 0 ? "PARTIAL" : "DONE") : (error.StartsWith("Cancelled") ? "CANCELLED" : "FAILED");
            run["error"] = error; run["endedAt"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"); run["ms"] = sw.ElapsedMilliseconds;
            run["bytes"] = bytes; run["rows"] = rows; run["chunks"] = chunks; run["done"] = done; run["files"] = JsonSerializer.SerializeToNode(files);
            run["failed"] = JsonSerializer.SerializeToNode(failed, BipJsonCompact);
            Save();
            try
            {
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "BIP", Action = "bip_run", Target = req.Path, Detail = JsonSerializer.Serialize(new { runId, pod = svc.Pod, format = req.Format, buckets = buckets.Count, done, failed = failed.Count, rows, bytes, ms = sw.ElapsedMilliseconds, status = run["status"].GetValue<string>(), error }) });
            }
            catch { }
            if (error != null && done == 0) return new { ok = false, error, runId, failed, ms = sw.ElapsedMilliseconds, status = run["status"].GetValue<string>() };

            List<string> columns = null; List<Dictionary<string, object>> first = null; long total = rows;
            if ((req.Format == "csv" || req.Format == "xml") && files.Count > 0 && sample > 0)
            {
                string f = Path.Combine(dir, req.Format == "xml" ? files[0] : outFile);
                var page = await Task.Run(() => req.Format == "xml" ? BipService.ReadXml(f, 0, sample) : BipService.ReadCsv(f, 0, sample));
                columns = page.Columns; first = page.Rows; total = page.Total; run["rows"] = total; Save();
            }
            return new { ok = true, runId, pod = svc.Pod, file = run["file"].GetValue<string>(), files, format = req.Format, rows = total, bytes, chunks, ms = sw.ElapsedMilliseconds, buckets = buckets.Count, done, failed, status = run["status"].GetValue<string>(), error, columns, sample = first, dir };
        }
    }
}

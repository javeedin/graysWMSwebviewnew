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
    /// The DuckDB file (BipStore) keeps the catalog, the report definitions and every result on this PC; Fusion is asked only when
    /// something is missing or the page says `refresh`.
    ///   bipStatus                                   pod, Fusion user, run folder, catalog index summary, the DuckDB file
    ///   bipCatalog     { path, refresh, local }     one folder — from DuckDB as last read, else CatalogService.getFolderContents (then kept);
    ///                                               `local` = DuckDB only (src "none" when not kept: the page then asks the APEX copy before Fusion)
    ///   bipCatalogKeep { path, items } | { index, root, items }   keeps a folder / a whole walk another user shared through APEX in DuckDB
    ///   bipIndex       { root, max }                walks the catalog (progress bipProgress) → DuckDB bip_catalog + a json copy; bipIndexGet reads it; bipIndexCancel
    ///   bipDefinition  { path, refresh }            ReportService.getReportDefinition (templates, formats, default format, data model) — kept in DuckDB
    ///   bipParameters  { path, refresh }            ReportService.getReportParameters (types, defaults, LOV labels) — kept in DuckDB
    ///   bipDataModel   { path }                     the SQL behind a report: CatalogService.downloadObject of its data model (.xdm)
    ///   bipPreview     { path, format, params … }   the runReport envelope that would be sent (password masked)
    ///   bipRun         { path, name, format, template, locale, params, buckets, chunkBytes, timeoutMs, sample }
    ///                                               runs the report (streamed to disk, chunked when big) — with `buckets` once per bucket; data output
    ///                                               (csv, or xml flattened to csv) ends in output.csv, loaded into DuckDB as res_<runId>; a layout that
    ///                                               refuses csv is run again as xml; progress bipProgress { runId, phase, bucket, buckets, label, bytes, rows, ms }
    ///   bipCancel      { runId }                    stops a run after the call in hand
    ///   bipRows        { runId, offset, limit }     a page of the result rows — from DuckDB when the run's table is there, else the file
    ///   bipQuery       { sql, max }                 one read-only SQL statement over the DuckDB file (results, catalog, runs)
    ///   bipTables                                   the result tables with their runs (Explore)
    ///   bipLastRun     { path, params, buckets }    the newest kept result of exactly these parameters (dashboard cards open instantly)
    ///   bipRuns, bipRunDelete { runId }, bipRunOpen { runId, file }, bipRunFolder { runId }, bipRunSaveAs { runId, file }, bipDuckClear { what }
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
        private static readonly Regex BipBadFormat = new Regex(@"invalid\s+format\s+requested", RegexOptions.IgnoreCase);

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
                        object duck = await Task.Run(() => BipStore.Status());
                        data = new { ok = true, pod = svc.Pod, origin = svc.Origin, user = _fusionUsername, runsRoot = BipRunsRoot, runs, index = idx, running = _bipRunning.Keys.ToArray(), duck, pc = Environment.MachineName };
                        break;
                    }
                    case "bipCatalog":
                    {
                        string path = (PStr(root, "path") ?? "/").Trim(); if (path.Length > 1) path = path.TrimEnd('/');
                        bool refresh = PBool(root, "refresh");
                        if (!refresh)
                        {
                            (List<BipCatalogItem> Items, string ReadAt) kept = (null, null);
                            try { kept = await Task.Run(() => BipStore.Folder(svc.Pod, path)); } catch (Exception ex) { Debug.WriteLine("[BIP] duck folder: " + ex.Message); }
                            if (kept.ReadAt != null) { data = new { ok = true, path, items = kept.Items, src = "duckdb", at = kept.ReadAt }; break; }
                            if (PBool(root, "local")) { data = new { ok = true, path, items = Array.Empty<BipCatalogItem>(), src = "none" }; break; }
                        }
                        var items = await svc.FolderContentsAsync(path);
                        _bipFolderCache[svc.Pod + "|" + path] = (DateTime.UtcNow, items);
                        string at = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                        bool kept2 = false;
                        try { await Task.Run(() => BipStore.SaveFolder(svc.Pod, path, items)); kept2 = true; } catch (Exception ex) { Debug.WriteLine("[BIP] duck save folder: " + ex.Message); }
                        data = new { ok = true, path, items, src = "fusion", at, kept = kept2 };
                        break;
                    }
                    case "bipCatalogKeep":
                    {
                        var items = new List<BipCatalogItem>();
                        if (root.TryGetProperty("items", out var arr) && arr.ValueKind == JsonValueKind.Array)
                            foreach (var it in arr.EnumerateArray())
                                items.Add(new BipCatalogItem { AbsolutePath = PStr(it, "absolutePath"), DisplayName = PStr(it, "displayName"), FileName = PStr(it, "fileName"), Type = PStr(it, "type"), ParentAbsolutePath = PStr(it, "parentAbsolutePath"), LastModified = PStr(it, "lastModified"), Owner = PStr(it, "owner") });
                        if (PBool(root, "index"))
                        {
                            string rootPath = PStr(root, "root") ?? "/";
                            int folders = items.Count(i => i.Type == "Folder"), reports = items.Count(i => i.Type == "Report");
                            await Task.Run(() => BipStore.SaveIndex(svc.Pod, rootPath, items, folders, reports, 0));
                            try
                            {
                                var file = new JsonObject { ["pod"] = svc.Pod, ["root"] = rootPath, ["at"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), ["ms"] = 0, ["folders"] = folders, ["reports"] = reports, ["items"] = JsonSerializer.SerializeToNode(items, BipJsonCompact) };
                                Directory.CreateDirectory(BipIndexRoot);
                                File.WriteAllText(BipIndexFile(svc.Pod), file.ToJsonString());
                            }
                            catch (Exception ex) { Debug.WriteLine("[BIP] index file: " + ex.Message); }
                            data = new { ok = true, kept = items.Count, folders, reports };
                        }
                        else
                        {
                            string path = (PStr(root, "path") ?? "/").Trim(); if (path.Length > 1) path = path.TrimEnd('/');
                            await Task.Run(() => BipStore.SaveFolder(svc.Pod, path, items));
                            data = new { ok = true, kept = items.Count };
                        }
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
                            int folders = items.Count(i => i.Type == "Folder"), reports = items.Count(i => i.Type == "Report");
                            string at = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
                            bool kept = false;
                            try { await Task.Run(() => BipStore.SaveIndex(svc.Pod, rootPath, items, folders, reports, sw.ElapsedMilliseconds)); kept = true; } catch (Exception ex) { Debug.WriteLine("[BIP] duck index: " + ex.Message); }
                            try
                            {
                                var file = new JsonObject { ["pod"] = svc.Pod, ["root"] = rootPath, ["at"] = at, ["ms"] = sw.ElapsedMilliseconds, ["folders"] = folders, ["reports"] = reports, ["items"] = JsonSerializer.SerializeToNode(items, BipJsonCompact) };
                                Directory.CreateDirectory(BipIndexRoot);
                                File.WriteAllText(BipIndexFile(svc.Pod), file.ToJsonString());
                            }
                            catch (Exception ex) { Debug.WriteLine("[BIP] index file: " + ex.Message); }
                            data = new { ok = true, at, folders, reports, items, ms = sw.ElapsedMilliseconds, kept };
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
                        (List<BipCatalogItem> Items, Dictionary<string, object> Log) idx = (null, null);
                        try { idx = await Task.Run(() => BipStore.Index(svc.Pod)); } catch (Exception ex) { Debug.WriteLine("[BIP] duck index get: " + ex.Message); }
                        if (idx.Log != null && idx.Items != null && idx.Items.Count > 0)
                        {
                            data = new { ok = true, src = "duckdb", at = idx.Log["read_at"] as string, root = idx.Log["root"] as string, folders = Convert.ToInt32(idx.Log["folders"] ?? 0), reports = Convert.ToInt32(idx.Log["reports"] ?? 0), items = idx.Items };
                            break;
                        }
                        string f = BipIndexFile(svc.Pod);
                        if (!File.Exists(f)) { data = new { ok = true, items = Array.Empty<object>(), at = (string)null }; break; }
                        var node = JsonNode.Parse(File.ReadAllText(f)).AsObject();
                        data = new { ok = true, src = "file", at = node["at"]?.GetValue<string>(), folders = node["folders"]?.GetValue<int>() ?? 0, reports = node["reports"]?.GetValue<int>() ?? 0, items = node["items"] };
                        break;
                    }
                    case "bipDefinition":
                    {
                        string path = (PStr(root, "path") ?? "").Trim();
                        if (!PBool(root, "refresh"))
                        {
                            var meta = BipMetaSafe(svc.Pod, path);
                            if (meta.DefJson != null) { data = new { ok = true, def = JsonNode.Parse(meta.DefJson), src = "duckdb", readAt = meta.ReadAt }; break; }
                        }
                        var def = await svc.DefinitionAsync(path);
                        BipMetaSave(svc.Pod, path, JsonSerializer.Serialize(def, BipJsonCompact), null);
                        data = new { ok = true, def, src = "fusion", readAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") };
                        break;
                    }
                    case "bipParameters":
                    {
                        string path = (PStr(root, "path") ?? "").Trim();
                        if (!PBool(root, "refresh"))
                        {
                            var meta = BipMetaSafe(svc.Pod, path);
                            if (meta.ParamsJson != null) { data = new { ok = true, prms = JsonNode.Parse(meta.ParamsJson), src = "duckdb", readAt = meta.ReadAt }; break; }
                        }
                        var prms = await svc.ParametersAsync(path);
                        BipMetaSave(svc.Pod, path, null, JsonSerializer.Serialize(prms, BipJsonCompact));
                        data = new { ok = true, prms, src = "fusion", readAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") };
                        break;
                    }
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
                        string runId = PStr(root, "runId");
                        long offset = root.TryGetProperty("offset", out var off) && off.TryGetInt64(out long o) ? Math.Max(0, o) : 0;
                        int limit = root.TryGetProperty("limit", out var lim) && lim.TryGetInt32(out int l) ? Math.Clamp(l, 1, 100_000) : 20_000;
                        bool duckHas = false;
                        try { duckHas = BipStore.TableOf(runId) != null && await Task.Run(() => BipStore.HasTable(runId)); } catch { }
                        if (duckHas)
                        {
                            var pg = await Task.Run(() => BipStore.Rows(runId, offset, limit));
                            data = new { ok = true, columns = pg.Columns, rows = pg.Rows, total = pg.Total, offset, src = "duckdb", tbl = BipStore.TableOf(runId) };
                            break;
                        }
                        string dir = BipRunDir(runId);
                        if (dir == null) { data = new { ok = false, error = "Unknown run." }; break; }
                        var run = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "run.json"))).AsObject();
                        string file = Path.Combine(dir, run["file"]?.GetValue<string>() ?? "output.csv");
                        if (!File.Exists(file)) { data = new { ok = false, error = "The result file is gone." }; break; }
                        var page = await Task.Run(() => file.EndsWith(".xml", StringComparison.OrdinalIgnoreCase) ? BipService.ReadXml(file, offset, limit) : BipService.ReadCsv(file, offset, limit));
                        data = new { ok = true, columns = page.Columns, rows = page.Rows, total = page.Total, offset, file, src = "file" };
                        break;
                    }
                    case "bipQuery":
                    {
                        int max = root.TryGetProperty("max", out var mq) && mq.TryGetInt32(out int mv) ? mv : 20_000;
                        var q = await Task.Run(() => BipStore.Query(PStr(root, "sql") ?? "", max));
                        data = q.Error != null ? new { ok = false, error = q.Error, busy = q.Busy } : (object)new { ok = true, columns = q.Columns, rows = q.Rows, truncated = q.Truncated, ms = q.Ms };
                        break;
                    }
                    case "bipTables":
                        data = new { ok = true, tables = await Task.Run(() => BipStore.Tables()), duck = BipStore.Status() };
                        break;
                    case "bipLastRun":
                    {
                        string path = (PStr(root, "path") ?? "").Trim();
                        string hash = BipStore.ParamsHash(path, JsonSerializer.Serialize(BipReadParams(root, "params"), BipJsonCompact), root.TryGetProperty("buckets", out var bk) ? bk.GetRawText() : "");
                        var last = await Task.Run(() => BipStore.LastRun(svc.Pod, path, hash));
                        if (last == null) { data = new { ok = true, found = false, hash }; break; }
                        int limit = root.TryGetProperty("limit", out var ll) && ll.TryGetInt32(out int lv) ? Math.Clamp(lv, 1, 50_000) : 5_000;
                        var pg = await Task.Run(() => BipStore.Rows((string)last["run_id"], 0, limit));
                        data = new { ok = true, found = true, hash, run = last, columns = pg.Columns, rows = pg.Rows, total = pg.Total };
                        break;
                    }
                    case "bipRuns":
                    {
                        var list = BipRuns();
                        var duckRuns = await Task.Run(() => BipStore.Runs());
                        var withTable = new HashSet<string>(duckRuns.Where(r => Convert.ToInt64(r["has_table"] ?? 0) > 0).Select(r => r["run_id"] as string).Where(x => x != null));
                        foreach (var r in list) { var o = r.AsObject(); o["duck"] = withTable.Contains(o["runId"]?.GetValue<string>() ?? ""); }
                        data = new { ok = true, runs = list };
                        break;
                    }
                    case "bipRunDelete":
                    {
                        string runId = PStr(root, "runId");
                        string dir = BipRunDir(runId);
                        if (dir != null && _bipRunning.ContainsKey(Path.GetFileName(dir))) { data = new { ok = false, error = "That run is still going." }; break; }
                        try { await Task.Run(() => BipStore.DeleteRun(runId)); } catch (Exception ex) { Debug.WriteLine("[BIP] duck delete: " + ex.Message); }
                        if (dir != null) { try { Directory.Delete(dir, true); } catch (Exception ex) { data = new { ok = false, error = ex.Message }; break; } }
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
                    case "bipDuckClear":
                    {
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can clear the DuckDB file." }; break; }
                        string what = PStr(root, "what") ?? "results";
                        data = await Task.Run(() => BipStore.Clear(what));
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "BIP", Action = "bip_duck_clear", Target = what, Detail = "" });
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

        private static (string DefJson, string ParamsJson, string ReadAt) BipMetaSafe(string pod, string path)
        {
            try { return BipStore.Meta(pod, path); } catch (Exception ex) { Debug.WriteLine("[BIP] duck meta: " + ex.Message); return (null, null, null); }
        }
        private static void BipMetaSave(string pod, string path, string defJson, string paramsJson)
        {
            try { BipStore.SaveMeta(pod, path, defJson, paramsJson); } catch (Exception ex) { Debug.WriteLine("[BIP] duck meta save: " + ex.Message); }
        }

        private static string BipIndexFile(string pod) => Path.Combine(BipIndexRoot, "catalog_" + pod + ".json");

        private static object BipIndexSummary(string pod)
        {
            try
            {
                var idx = BipStore.Index(pod);
                if (idx.Log != null) return new { at = idx.Log["read_at"] as string, root = idx.Log["root"] as string, folders = Convert.ToInt32(idx.Log["folders"] ?? 0), reports = Convert.ToInt32(idx.Log["reports"] ?? 0), src = "duckdb" };
            }
            catch { }
            try
            {
                string f = BipIndexFile(pod);
                if (!File.Exists(f)) return null;
                var node = JsonNode.Parse(File.ReadAllText(f)).AsObject();
                return new { at = node["at"]?.GetValue<string>(), root = node["root"]?.GetValue<string>(), folders = node["folders"]?.GetValue<int>() ?? 0, reports = node["reports"]?.GetValue<int>() ?? 0, src = "file" };
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
                Format = (PStr(root, "format") ?? "xml").Trim().ToLowerInvariant(),
                Template = PStr(root, "template"),
                Locale = PStr(root, "locale"),
                Params = BipReadParams(root, "params")
            };
            if (root.TryGetProperty("chunkBytes", out var cb) && cb.TryGetInt32(out int c)) req.ChunkBytes = c <= 0 ? -1 : Math.Clamp(c, 500_000, 200_000_000);
            if (root.TryGetProperty("timeoutMs", out var tm) && tm.TryGetInt32(out int t)) req.TimeoutMs = Math.Clamp(t, 30_000, 6 * 3_600_000);
            return req;
        }

        private static string BipExt(string format) => format switch { "csv" => "csv", "xml" => "xml", "data" => "xml", "pdf" => "pdf", "xlsx" => "xlsx", "excel" => "xls", "excel2000" => "xls", "html" => "html", "rtf" => "rtf", "docx" => "docx", "pptx" => "pptx", "mhtml" => "mhtml", _ => format };
        private static bool BipIsData(string format) => format == "csv" || format == "xml" || format == "data";

        /// <summary>
        /// One run, or one run per bucket. Data output (csv, or xml / data flattened to csv) always ends in output.csv, which is loaded into
        /// DuckDB as res_&lt;runId&gt;; a layout that refuses csv ("Invalid format requested") is run again as xml. Everything under runs\{runId}\ with run.json.
        /// </summary>
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
            string paramsJson = JsonSerializer.Serialize(req.Params, BipJsonCompact);
            string bucketsJson = root.TryGetProperty("buckets", out var bk2) ? bk2.GetRawText() : "";
            string hash = BipStore.ParamsHash(req.Path, paramsJson, bucketsJson);
            bool isData = BipIsData(req.Format);
            string outFile = isData ? "output.csv" : "output." + BipExt(req.Format);
            var cts = new CancellationTokenSource(); _bipRunning[runId] = cts;
            var sw = Stopwatch.StartNew();
            var run = new JsonObject
            {
                ["runId"] = runId, ["pod"] = svc.Pod, ["path"] = req.Path, ["name"] = name, ["format"] = req.Format, ["template"] = req.Template,
                ["params"] = JsonNode.Parse(paramsJson), ["buckets"] = buckets.Count, ["bucketList"] = JsonSerializer.SerializeToNode(buckets.Select(b => new { label = b.Label, prms = b.Params }), BipJsonCompact),
                ["startedAt"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), ["status"] = "RUNNING", ["file"] = outFile, ["user"] = user, ["pc"] = Environment.MachineName, ["paramsHash"] = hash
            };
            void Save() { try { File.WriteAllText(Path.Combine(dir, "run.json"), run.ToJsonString(BipJson)); } catch { } }
            Save();
            var failed = new List<object>(); long bytes = 0, rows = 0; int done = 0, chunks = 0; var files = new List<string>(); var notes = new List<string>();
            string error = null; List<string> header = null; bool headerWritten = false;

            // runs one part (the whole report or a bucket); a layout that refuses csv is asked again as xml, and the run carries on as xml
            async Task<BipRunOutcome> RunPart(BipRunRequest r, string file, IProgress<BipProgress> p)
            {
                var o = await svc.RunToFileAsync(r, file, p, cts.Token);
                if (!o.Ok && r.Format == "csv" && o.Error != null && BipBadFormat.IsMatch(o.Error))
                {
                    notes.Add("This report's layout does not offer CSV — it was run as XML data instead (same rows).");
                    req.Format = "xml"; r.Format = "xml"; run["format"] = "xml";
                    o = await svc.RunToFileAsync(r, Path.ChangeExtension(file, ".xml"), p, cts.Token);
                }
                return o;
            }
            // the data output of one part lands in output.csv: a csv part is appended, an xml part is flattened to csv
            async Task<long> Collect(string part)
            {
                string full = Path.Combine(dir, part);
                if (req.Format == "csv" && File.Exists(full))
                {
                    long n = await Task.Run(() => BipService.AppendCsv(full, Path.Combine(dir, outFile), !headerWritten));
                    headerWritten = true; return n;
                }
                string xml = File.Exists(full) ? full : Path.ChangeExtension(full, ".xml");
                if (!File.Exists(xml)) return 0;
                var conv = await Task.Run(() => BipService.XmlToCsv(xml, Path.Combine(dir, outFile), header, headerWritten));
                header = header ?? conv.Columns; headerWritten = true;
                return conv.Rows;
            }
            try
            {
                if (buckets.Count == 0)
                {
                    string part = isData ? "part." + BipExt(req.Format) : outFile;
                    var r = await Task.Run(() => RunPart(req, Path.Combine(dir, part), new Progress<BipProgress>(p => progress(new { runId, phase = p.Phase, bucket = 1, buckets = 1, label = "", bytes = p.Bytes, chunks = p.Chunks, ms = sw.ElapsedMilliseconds, message = p.Message }))));
                    if (!r.Ok) error = r.Error;
                    else
                    {
                        bytes = r.Bytes; chunks = r.Chunks; done = 1;
                        if (isData)
                        {
                            progress(new { runId, phase = "parsing", bucket = 1, buckets = 1, bytes, ms = sw.ElapsedMilliseconds, message = "Reading the rows…" });
                            rows = await Collect(part);
                            string kept = req.Format == "csv" ? Path.Combine(dir, "part.csv") : Path.Combine(dir, "part.xml");
                            if (File.Exists(kept)) { string raw = "output." + Path.GetExtension(kept).TrimStart('.'); if (raw != outFile) { File.Move(kept, Path.Combine(dir, raw), true); files.Add(raw); } else File.Delete(kept); }
                        }
                        files.Insert(0, outFile);
                    }
                }
                else
                {
                    for (int i = 0; i < buckets.Count; i++)
                    {
                        cts.Token.ThrowIfCancellationRequested();
                        var (label, prms) = buckets[i];
                        var breq = new BipRunRequest { Path = req.Path, Format = req.Format, Template = req.Template, Locale = req.Locale, ChunkBytes = req.ChunkBytes, TimeoutMs = req.TimeoutMs, Params = new Dictionary<string, List<string>>(req.Params) };
                        foreach (var kv in prms) breq.Params[kv.Key] = kv.Value;
                        string part = "part_" + (i + 1).ToString("0000") + "." + BipExt(req.Format);
                        int bi = i + 1; long rowsBefore = rows, bytesBefore = bytes;
                        progress(new { runId, phase = "bucket", bucket = bi, buckets = buckets.Count, label, bytes, rows, ms = sw.ElapsedMilliseconds, message = "Bucket " + bi + " of " + buckets.Count + " · " + label });
                        var r = await Task.Run(() => RunPart(breq, Path.Combine(dir, part), new Progress<BipProgress>(p => progress(new { runId, phase = p.Phase, bucket = bi, buckets = buckets.Count, label, bytes = bytesBefore + p.Bytes, rows, chunks = p.Chunks, ms = sw.ElapsedMilliseconds, message = label + " · " + p.Message }))));
                        if (!r.Ok) { failed.Add(new { bucket = bi, label, error = r.Error }); if (r.Error == "Cancelled.") break; continue; }
                        bytes += r.Bytes; chunks += r.Chunks; done++;
                        if (isData)
                        {
                            long n = await Collect(part);
                            rows += n;
                            foreach (var tmp in new[] { Path.Combine(dir, part), Path.ChangeExtension(Path.Combine(dir, part), ".xml") }) { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
                        }
                        else files.Add(part);
                        progress(new { runId, phase = "bucketDone", bucket = bi, buckets = buckets.Count, label, bytes, rows, rowsAdded = rows - rowsBefore, ms = sw.ElapsedMilliseconds, message = label + " · " + (rows - rowsBefore).ToString("N0") + " rows" });
                    }
                    if (isData) { if (headerWritten) files.Insert(0, outFile); else if (failed.Count > 0) error = "Every bucket failed: " + failed.Count + " of " + buckets.Count; }
                    else if (files.Count == 0) error = failed.Count > 0 ? "Every bucket failed." : "Nothing ran.";
                    else run["file"] = files[0];
                }
            }
            catch (OperationCanceledException) { error = "Cancelled after " + done + " of " + Math.Max(1, buckets.Count) + "."; }
            catch (Exception ex) { error = ex.Message; }
            finally { _bipRunning.TryRemove(runId, out _); cts.Dispose(); }

            // the rows into DuckDB
            string tbl = null; List<string> columns = null; bool duck = false;
            if (isData && error == null && files.Contains(outFile) && File.Exists(Path.Combine(dir, outFile)))
            {
                try
                {
                    progress(new { runId, phase = "duckdb", bucket = done, buckets = Math.Max(1, buckets.Count), bytes, rows, ms = sw.ElapsedMilliseconds, message = "Keeping the rows in DuckDB…" });
                    var loaded = await Task.Run(() => BipStore.LoadResult(runId, Path.Combine(dir, outFile)));
                    tbl = BipStore.TableOf(runId); columns = loaded.Columns; rows = loaded.Rows; duck = true;
                }
                catch (Exception ex) { notes.Add("The rows were not kept in DuckDB: " + ex.Message); Debug.WriteLine("[BIP] duck load: " + ex); }
            }
            run["status"] = error == null ? (failed.Count > 0 ? "PARTIAL" : "DONE") : (error.StartsWith("Cancelled") ? "CANCELLED" : "FAILED");
            run["error"] = error; run["endedAt"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"); run["ms"] = sw.ElapsedMilliseconds;
            run["bytes"] = bytes; run["rows"] = rows; run["chunks"] = chunks; run["done"] = done; run["files"] = JsonSerializer.SerializeToNode(files);
            run["failed"] = JsonSerializer.SerializeToNode(failed, BipJsonCompact); run["notes"] = JsonSerializer.SerializeToNode(notes); run["tbl"] = tbl; run["duck"] = duck;
            Save();
            try
            {
                BipStore.SaveRun(new BipStore.RunRow { RunId = runId, Pod = svc.Pod, Path = req.Path, Name = name, Format = req.Format, ParamsJson = paramsJson, ParamsHash = hash, Buckets = buckets.Count, Status = run["status"].GetValue<string>(), Rows = rows, Bytes = bytes, Ms = sw.ElapsedMilliseconds, StartedAt = run["startedAt"].GetValue<string>(), EndedAt = run["endedAt"].GetValue<string>(), Error = error, File = run["file"].GetValue<string>(), Tbl = tbl, User = user });
            }
            catch (Exception ex) { Debug.WriteLine("[BIP] duck run row: " + ex.Message); }
            try
            {
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "BIP", Action = "bip_run", Target = req.Path, Detail = JsonSerializer.Serialize(new { runId, pod = svc.Pod, format = req.Format, buckets = buckets.Count, done, failed = failed.Count, rows, bytes, ms = sw.ElapsedMilliseconds, status = run["status"].GetValue<string>(), error, duck }) });
            }
            catch { }
            if (error != null && done == 0) return new { ok = false, error, runId, failed, notes, ms = sw.ElapsedMilliseconds, status = run["status"].GetValue<string>() };

            List<Dictionary<string, object>> first = null; long total = rows;
            if (isData && files.Contains(outFile) && sample > 0)
            {
                if (duck) { var pg = await Task.Run(() => BipStore.Rows(runId, 0, sample)); columns = pg.Columns; first = pg.Rows; total = pg.Total; }
                else { var page = await Task.Run(() => BipService.ReadCsv(Path.Combine(dir, outFile), 0, sample)); columns = page.Columns; first = page.Rows; total = page.Total; }
                run["rows"] = total; Save();
            }
            return new { ok = true, runId, pod = svc.Pod, file = run["file"].GetValue<string>(), files, format = req.Format, rows = total, bytes, chunks, ms = sw.ElapsedMilliseconds, buckets = buckets.Count, done, failed, notes, status = run["status"].GetValue<string>(), error, columns, sample = first, dir, duck, tbl, hash };
        }
    }
}

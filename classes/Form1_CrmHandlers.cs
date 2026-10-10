using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.ML;
using Microsoft.ML.Data;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Customer CRM (crm/index.html) — crm* IPC actions. Everything that is recorded (tickets, calls, e-mails, contacts) is
    /// written by the page to APEX; the host does what a page cannot:
    ///   crmInfo           this PC's name, the CRM folder, what the softphone listener and the ML models are doing
    ///   crmSaveRecording  a call recording from the page (base64, webm / ogg / wav / mp3) → C:\fusion\crm\recordings\{yyyy-MM}\{callId}.{ext}
    ///                     with its SHA-256 (recorded with the call in APEX)
    ///   crmRecording      a recording back as base64 to play it (only files under C:\fusion\crm)
    ///   crmOpenFolder     Explorer on a CRM file / folder
    ///   crmDial           hand a number to the PC's softphone: tel: / sip: / sips: / callto: / im: links only (Teams, Zoiper, MicroSIP, 3CX …)
    ///   crmSend           an e-mail through the Finance Lens mail setup (Outlook / Microsoft 365 / SMTP) with attachments from the page
    ///                     (base64) and files already on this PC (statement PDFs under C:\fusion\debtors, CRM files); audited CRM
    ///   crmCtiStart / crmCtiStop / crmCtiPoll
    ///                     a small HTTP listener on 127.0.0.1 only (default port 8765) that a softphone calls on a call event:
    ///                     GET /call?event=ring|answer|hangup|missed|dial&amp;from=…&amp;to=…&amp;id=…&amp;name=…&amp;key=… — the key must match;
    ///                     the page polls the events (screen pop, call log)
    ///   crmMlTrain / crmMlPredict / crmMlStatus
    ///                     ML.NET text classifiers (SDCA maximum entropy on featurised text) for the ticket category and priority,
    ///                     trained on the page's resolved tickets, kept in %APPDATA%\GraysWMS\Crm\ml-{model}.zip
    /// Replies: { action: "crmResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        private const string CRM_ROOT = @"C:\fusion\crm";
        private static string CrmRecordingsRoot => Path.Combine(CRM_ROOT, "recordings");
        private static string CrmAppData => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "Crm");

        private static bool IsCrmAction(string action) =>
            action != null && action.Length > 3 && action.StartsWith("crm", StringComparison.Ordinal) && char.IsUpper(action[3]);

        private async Task HandleCrmAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                string user = OmUser(root);
                switch (action)
                {
                    case "crmInfo":
                        data = new { ok = true, machine = Environment.MachineName, root = CRM_ROOT, user, cti = CrmCti.Status(), ml = CrmMl.Status() };
                        break;

                    case "crmSaveRecording":
                        {
                            string b64 = OmStr(root, "base64");
                            if (string.IsNullOrEmpty(b64)) { data = new { ok = false, error = "No recording." }; break; }
                            byte[] bytes = Convert.FromBase64String(b64);
                            if (bytes.Length > 150L * 1024 * 1024) { data = new { ok = false, error = "The recording is larger than 150 MB." }; break; }
                            string ext = (OmStr(root, "ext") ?? "webm").ToLowerInvariant();
                            if (!Regex.IsMatch(ext, "^(webm|ogg|wav|mp3|m4a)$")) ext = "webm";
                            string dir = Path.Combine(CrmRecordingsRoot, DateTime.Now.ToString("yyyy-MM"));
                            Directory.CreateDirectory(dir);
                            string file = Path.Combine(dir, DcSafe(OmStr(root, "callId"), "call_" + DateTime.Now.ToString("yyyyMMdd_HHmmss")) + "." + ext);
                            await File.WriteAllBytesAsync(file, bytes);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "CRM", Action = "call_recording", Outcome = "OK", Detail = Path.GetFileName(file) + " · " + bytes.Length + " bytes" });
                            data = new { ok = true, path = file, bytes = bytes.Length, sha256 = DcSha(bytes) };
                            break;
                        }

                    case "crmRecording":
                        {
                            string file = CrmSafePath(OmStr(root, "path"));
                            if (file == null || !File.Exists(file)) { data = new { ok = false, error = "The recording is not on this PC (it was made on another PC, or moved)." }; break; }
                            var fi = new FileInfo(file);
                            if (fi.Length > 150L * 1024 * 1024) { data = new { ok = false, error = "The recording is too large to play here — open its folder." }; break; }
                            byte[] bytes = await File.ReadAllBytesAsync(file);
                            string ext = fi.Extension.TrimStart('.').ToLowerInvariant();
                            string mime = ext == "wav" ? "audio/wav" : ext == "mp3" ? "audio/mpeg" : ext == "ogg" ? "audio/ogg" : ext == "m4a" ? "audio/mp4" : "audio/webm";
                            data = new { ok = true, base64 = Convert.ToBase64String(bytes), mime, bytes = bytes.Length, sha256 = DcSha(bytes) };
                            break;
                        }

                    case "crmOpenFolder":
                        {
                            string p = CrmSafePath(OmStr(root, "path"));
                            if (p != null && File.Exists(p)) Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + p + "\"") { UseShellExecute = true });
                            else
                            {
                                string dir = p != null && Directory.Exists(p) ? p : CRM_ROOT;
                                Directory.CreateDirectory(dir);
                                Process.Start(new ProcessStartInfo(dir) { UseShellExecute = true });
                            }
                            data = new { ok = true };
                            break;
                        }

                    case "crmDial":
                        {
                            string uri = (OmStr(root, "uri") ?? "").Trim();
                            if (!Regex.IsMatch(uri, @"^(tel|sip|sips|callto|im):[+0-9A-Za-z@._\-*#%]{2,120}$", RegexOptions.IgnoreCase)) { data = new { ok = false, error = "Only tel:, sip:, sips:, callto: or im: links can be dialled." }; break; }
                            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "CRM", Action = "call_dial", Outcome = "OK", Detail = uri });
                            data = new { ok = true };
                            break;
                        }

                    case "crmSend":
                        {
                            var m = FinanceMail.FromJson(root);   // to, cc, bcc, subject, html, display, receipts, attachments (base64)
                            m.NoSignature = root.TryGetProperty("noSignature", out var ns) && ns.ValueKind == JsonValueKind.True;
                            var names = new List<string>();
                            if (root.TryGetProperty("files", out var fl) && fl.ValueKind == JsonValueKind.Array)
                                foreach (var f in fl.EnumerateArray())
                                {
                                    string path = f.ValueKind == JsonValueKind.String ? f.GetString() : (f.TryGetProperty("path", out var pp) ? pp.GetString() : null);
                                    string full = CrmAttachPath(path);
                                    if (full == null || !File.Exists(full)) throw new InvalidOperationException("The file " + Path.GetFileName(path ?? "") + " is not on this PC any more.");
                                    string nm = f.ValueKind == JsonValueKind.Object && f.TryGetProperty("name", out var nn) && nn.ValueKind == JsonValueKind.String ? nn.GetString() : Path.GetFileName(full);
                                    nm = Regex.Replace(nm ?? "file", @"[\\/:*?""<>|]+", "_");
                                    if (!Path.HasExtension(nm)) nm += Path.GetExtension(full);
                                    m.Attachments.Add(new FinanceMail.Attachment { Name = nm, ContentType = full.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? "application/pdf" : "application/octet-stream", Bytes = await File.ReadAllBytesAsync(full) });
                                }
                            if (m.Attachments.Sum(a => (long)a.Bytes.Length) > 25L * 1024 * 1024) { data = new { ok = false, error = "The attachments are larger than 25 MB." }; break; }
                            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(6));
                            var sw = Stopwatch.StartNew();
                            var r = await FinanceMail.SendAsync(user, m, OmStr(root, "method"), cts.Token);
                            AiControl.Audit(new AiControl.AuditEvent
                            {
                                User = user, Source = "CRM", Action = m.Display ? "crm_email_draft" : "crm_email", Outcome = "OK",
                                Detail = (OmStr(root, "account") ?? "") + " · " + m.Subject + " → " + string.Join("; ", FinanceMail.Addresses(m.To).Concat(FinanceMail.Addresses(m.Cc)))
                            });
                            var j = JsonSerializer.SerializeToElement(r);
                            data = new
                            {
                                ok = true,
                                via = j.TryGetProperty("via", out var v) ? v.GetString() : null,
                                result = j.TryGetProperty("result", out var rs) ? rs.GetString() : null,
                                attachments = m.Attachments.Where(a => string.IsNullOrEmpty(a.Cid)).Select(a => new { name = a.Name, bytes = a.Bytes.Length, sha256 = DcSha(a.Bytes) }).ToList(),
                                ms = sw.ElapsedMilliseconds
                            };
                            break;
                        }

                    case "crmCtiStart":
                        {
                            int port = root.TryGetProperty("port", out var po) && po.TryGetInt32(out var pv) ? pv : 8765;
                            data = CrmCti.Start(port, OmStr(root, "key"));
                            break;
                        }
                    case "crmCtiStop":
                        CrmCti.Stop();
                        data = new { ok = true, cti = CrmCti.Status() };
                        break;
                    case "crmCtiPoll":
                        {
                            long after = root.TryGetProperty("after", out var af) && af.TryGetInt64(out var av) ? av : 0;
                            data = new { ok = true, events = CrmCti.Since(after), cti = CrmCti.Status() };
                            break;
                        }

                    case "crmMlTrain":
                        {
                            string model = OmStr(root, "model") ?? "category";
                            var rows = new List<CrmMl.TextRow>();
                            if (root.TryGetProperty("rows", out var rr) && rr.ValueKind == JsonValueKind.Array)
                                foreach (var x in rr.EnumerateArray())
                                {
                                    string t = x.TryGetProperty("text", out var tt) ? tt.GetString() : null, l = x.TryGetProperty("label", out var ll) ? ll.GetString() : null;
                                    if (!string.IsNullOrWhiteSpace(t) && !string.IsNullOrWhiteSpace(l)) rows.Add(new CrmMl.TextRow { Text = t.Length > 4000 ? t.Substring(0, 4000) : t, Label = l });
                                }
                            data = await Task.Run(() => CrmMl.Train(model, rows));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "CRM", Action = "ml_train", Outcome = "OK", Detail = model + " · " + rows.Count + " tickets" });
                            break;
                        }
                    case "crmMlPredict":
                        data = CrmMl.Predict(OmStr(root, "model") ?? "category", OmStr(root, "text") ?? "");
                        break;
                    case "crmMlStatus":
                        data = new { ok = true, models = CrmMl.Status() };
                        break;

                    default:
                        data = new { ok = false, error = "Unknown CRM action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[CRM] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "crmResponse", requestId, data }));
        }

        private static string CrmUnder(string path, string rootDir)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            try
            {
                string full = Path.GetFullPath(path);
                return full.StartsWith(Path.GetFullPath(rootDir) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? full : null;
            }
            catch { return null; }
        }
        /// <summary>Only files and folders under C:\fusion\crm.</summary>
        private static string CrmSafePath(string path) => CrmUnder(path, CRM_ROOT);
        /// <summary>Files the CRM may attach: its own, the statement PDFs of Debtors Control, the Order Management PDFs.</summary>
        private static string CrmAttachPath(string path) => CrmUnder(path, CRM_ROOT) ?? CrmUnder(path, DC_ROOT) ?? CrmUnder(path, @"C:\fusion\OM");

        // ── the softphone listener ───────────────────────────────────
        internal static class CrmCti
        {
            public class Ev { public long seq { get; set; } public string at { get; set; } public string @event { get; set; } public string from { get; set; } public string to { get; set; } public string id { get; set; } public string name { get; set; } }
            private static readonly object _lock = new object();
            private static readonly List<Ev> _events = new List<Ev>();
            private static TcpListener _listener;
            private static CancellationTokenSource _cts;
            private static int _port;
            private static string _key = "";
            private static long _seq;
            private static string _error;
            private static int _hits;

            public static object Status()
            {
                lock (_lock) return new { running = _listener != null, port = _port, url = _listener != null ? "http://127.0.0.1:" + _port + "/call" : null, hits = _hits, error = _error, last = _seq };
            }

            public static object Start(int port, string key)
            {
                if (port < 1024 || port > 65535) return new { ok = false, error = "Choose a port between 1024 and 65535." };
                key = (key ?? "").Trim();
                if (key.Length < 8) return new { ok = false, error = "The listener key must have at least 8 characters." };
                lock (_lock)
                {
                    if (_listener != null && _port == port) { _key = key; return new { ok = true, cti = StatusUnlocked() }; }
                }
                Stop();
                try
                {
                    var l = new TcpListener(IPAddress.Loopback, port);
                    l.Start();
                    var cts = new CancellationTokenSource();
                    lock (_lock) { _listener = l; _cts = cts; _port = port; _key = key; _error = null; }
                    _ = Task.Run(() => AcceptLoop(l, cts.Token));
                    return new { ok = true, cti = Status() };
                }
                catch (Exception ex)
                {
                    lock (_lock) _error = ex.Message;
                    return new { ok = false, error = "The listener could not start on port " + port + ": " + ex.Message };
                }
            }
            private static object StatusUnlocked() => new { running = _listener != null, port = _port, url = "http://127.0.0.1:" + _port + "/call", hits = _hits, error = _error, last = _seq };

            public static void Stop()
            {
                TcpListener l; CancellationTokenSource c;
                lock (_lock) { l = _listener; c = _cts; _listener = null; _cts = null; }
                try { c?.Cancel(); } catch { }
                try { l?.Stop(); } catch { }
            }

            public static List<Ev> Since(long after)
            {
                lock (_lock) return _events.Where(e => e.seq > after).ToList();
            }

            private static async Task AcceptLoop(TcpListener l, CancellationToken ct)
            {
                while (!ct.IsCancellationRequested)
                {
                    TcpClient c;
                    try { c = await l.AcceptTcpClientAsync(ct); }
                    catch { break; }
                    _ = Task.Run(() => Serve(c));
                }
            }

            private static async Task Serve(TcpClient c)
            {
                using (c)
                {
                    try
                    {
                        c.ReceiveTimeout = 5000;
                        var ns = c.GetStream();
                        var buf = new byte[8192];
                        int n = await ns.ReadAsync(buf, 0, buf.Length);
                        string req = Encoding.ASCII.GetString(buf, 0, Math.Max(0, n));
                        string line = req.Split('\n').FirstOrDefault() ?? "";
                        var m = Regex.Match(line, @"^(GET|POST) (/[^ ]*) HTTP");
                        int code = 404; string body = "not found";
                        if (m.Success)
                        {
                            var uri = new Uri("http://127.0.0.1" + m.Groups[2].Value);
                            if (uri.AbsolutePath.Equals("/call", StringComparison.OrdinalIgnoreCase))
                            {
                                var q = Query(uri.Query);
                                string key; lock (_lock) key = _key;
                                if (!q.TryGetValue("key", out var k) || !string.Equals(k, key, StringComparison.Ordinal)) { code = 403; body = "wrong key"; }
                                else
                                {
                                    string evn = (Get(q, "event") ?? "ring").ToLowerInvariant();
                                    if (!Regex.IsMatch(evn, "^(ring|answer|hangup|missed|dial)$")) evn = "ring";
                                    lock (_lock)
                                    {
                                        _hits++;
                                        _events.Add(new Ev { seq = ++_seq, at = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), @event = evn, from = Clip(Get(q, "from"), 60), to = Clip(Get(q, "to"), 60), id = Clip(Get(q, "id"), 100), name = Clip(Get(q, "name"), 200) });
                                        if (_events.Count > 500) _events.RemoveRange(0, _events.Count - 500);
                                    }
                                    code = 200; body = "ok";
                                }
                            }
                            else if (uri.AbsolutePath == "/") { code = 200; body = "Gray's WMS CRM call listener"; }
                        }
                        string status = code == 200 ? "200 OK" : code == 403 ? "403 Forbidden" : "404 Not Found";
                        byte[] outb = Encoding.UTF8.GetBytes("HTTP/1.1 " + status + "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + Encoding.UTF8.GetByteCount(body) + "\r\nConnection: close\r\n\r\n" + body);
                        await ns.WriteAsync(outb, 0, outb.Length);
                    }
                    catch (Exception ex) { Debug.WriteLine("[CRM] listener: " + ex.Message); }
                }
            }
            private static string Clip(string s, int n) => s == null ? null : (s.Length > n ? s.Substring(0, n) : s);
            private static string Get(Dictionary<string, string> q, string k) => q.TryGetValue(k, out var v) ? v : null;
            private static Dictionary<string, string> Query(string qs)
            {
                var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var part in (qs ?? "").TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
                {
                    int i = part.IndexOf('=');
                    string k = Uri.UnescapeDataString((i < 0 ? part : part.Substring(0, i)).Replace('+', ' '));
                    string v = i < 0 ? "" : Uri.UnescapeDataString(part.Substring(i + 1).Replace('+', ' '));
                    d[k] = v;
                }
                return d;
            }
        }

        // ── ML.NET ticket classifiers ────────────────────────────────
        internal static class CrmMl
        {
            public class TextRow { public string Text { get; set; } public string Label { get; set; } }
            public class Prediction { public string PredictedLabel { get; set; } public float[] Score { get; set; } }
            private class Meta { public string model { get; set; } public string trainedAt { get; set; } public int rows { get; set; } public List<string> labels { get; set; } public double? accuracy { get; set; } public double? macroAccuracy { get; set; } public int testRows { get; set; } }

            private static readonly object _lock = new object();
            private static readonly Dictionary<string, (MLContext ml, ITransformer model, string[] labels)> _loaded = new Dictionary<string, (MLContext, ITransformer, string[])>();

            private static string Safe(string model) => Regex.IsMatch(model ?? "", "^[a-z]{3,20}$") ? model : "category";
            private static string ModelPath(string model) => Path.Combine(CrmAppData, "ml-" + Safe(model) + ".zip");
            private static string MetaPath(string model) => Path.Combine(CrmAppData, "ml-" + Safe(model) + ".json");

            public static object Train(string model, List<TextRow> rows)
            {
                model = Safe(model);
                var byLabel = rows.GroupBy(r => r.Label).Where(g => g.Count() >= 2).Select(g => g.Key).ToHashSet();
                rows = rows.Where(r => byLabel.Contains(r.Label)).ToList();
                if (byLabel.Count < 2 || rows.Count < 10) return new { ok = false, error = "Too few examples: at least 10 tickets in 2 or more " + model + " values (with 2 or more tickets each) are needed — " + rows.Count + " usable now." };
                var ml = new MLContext(seed: 7);
                var data = ml.Data.LoadFromEnumerable(rows);
                // the evaluator wants the predicted label as a key: measure on `core`, keep `pipe` (labels back as text)
                var core = ml.Transforms.Conversion.MapValueToKey("Label", nameof(TextRow.Label))
                    .Append(ml.Transforms.Text.FeaturizeText("Features", nameof(TextRow.Text)))
                    .Append(ml.MulticlassClassification.Trainers.SdcaMaximumEntropy("Label", "Features"));
                var pipe = core.Append(ml.Transforms.Conversion.MapKeyToValue("PredictedLabel"));
                double? acc = null, macro = null; int test = 0;
                if (rows.Count >= 40)
                {
                    var split = ml.Data.TrainTestSplit(data, testFraction: 0.2, seed: 7);
                    var trial = core.Fit(split.TrainSet);
                    var metrics = ml.MulticlassClassification.Evaluate(trial.Transform(split.TestSet), "Label");
                    acc = Math.Round(metrics.MicroAccuracy, 3); macro = Math.Round(metrics.MacroAccuracy, 3);
                    test = (int)(ml.Data.CreateEnumerable<TextRow>(split.TestSet, reuseRowObject: false).Count());
                }
                var fitted = pipe.Fit(data);
                Directory.CreateDirectory(CrmAppData);
                ml.Model.Save(fitted, data.Schema, ModelPath(model));
                var labels = LabelsOf(ml, fitted, data);
                var meta = new Meta { model = model, trainedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), rows = rows.Count, labels = labels.ToList(), accuracy = acc, macroAccuracy = macro, testRows = test };
                File.WriteAllText(MetaPath(model), JsonSerializer.Serialize(meta));
                lock (_lock) _loaded[model] = (ml, fitted, labels);
                return new { ok = true, model, rows = rows.Count, labels, accuracy = acc, macroAccuracy = macro, testRows = test, trainedAt = meta.trainedAt };
            }

            private static string[] LabelsOf(MLContext ml, ITransformer model, IDataView schemaSource)
            {
                var engine = ml.Model.CreatePredictionEngine<TextRow, Prediction>(model);
                VBuffer<ReadOnlyMemory<char>> names = default;
                engine.OutputSchema["Score"].GetSlotNames(ref names);
                return names.DenseValues().Select(x => x.ToString()).ToArray();
            }

            public static object Predict(string model, string text)
            {
                model = Safe(model);
                (MLContext ml, ITransformer model, string[] labels) m;
                lock (_lock)
                {
                    if (!_loaded.TryGetValue(model, out m))
                    {
                        if (!File.Exists(ModelPath(model))) return new { ok = false, error = "The " + model + " model is not trained on this PC yet.", trained = false };
                        var ml = new MLContext(seed: 7);
                        var t = ml.Model.Load(ModelPath(model), out _);
                        m = (ml, t, LabelsOf(ml, t, null));
                        _loaded[model] = m;
                    }
                }
                var engine = m.ml.Model.CreatePredictionEngine<TextRow, Prediction>(m.model);
                var p = engine.Predict(new TextRow { Text = text ?? "", Label = "" });
                var top = (p.Score ?? new float[0]).Select((s, i) => new { label = i < m.labels.Length ? m.labels[i] : "?", score = Math.Round(s, 4) })
                    .OrderByDescending(x => x.score).Take(5).ToList();
                return new { ok = true, trained = true, label = p.PredictedLabel, top };
            }

            public static object Status()
            {
                var list = new List<object>();
                foreach (var name in new[] { "category", "priority" })
                {
                    try { if (File.Exists(MetaPath(name))) list.Add(JsonSerializer.Deserialize<Meta>(File.ReadAllText(MetaPath(name)))); }
                    catch { }
                }
                return list;
            }
        }
    }
}

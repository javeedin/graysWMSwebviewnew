using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Xml;
using System.Xml.Linq;

namespace WMSApp.Bip
{
    // =====================================================================
    //  Oracle BIP Reporting — the BI Publisher catalog of an Oracle Fusion pod
    //  browsed, its reports' parameters read, the reports run (streamed to
    //  disk, in chunks when big, in date / value buckets when long) and the
    //  SQL behind a report pulled out of its data model.
    //
    //  Everything talks SOAP 1.1 to the v2 services of the pod with the
    //  application's Fusion credentials (never the page's):
    //    /xmlpserver/services/v2/CatalogService  getFolderContents, downloadObject
    //    /xmlpserver/services/v2/ReportService   getReportDefinition, getReportParameters,
    //                                            runReport, downloadReportDataChunk
    //  A generated WCF proxy is not needed: HttpClient has no message-size
    //  limit, the response is read with an XmlReader so reportBytes never
    //  sits in one string, and a report bigger than the chunk size is pulled
    //  with downloadReportDataChunk like the proxy did.
    // =====================================================================

    public sealed class BipCatalogItem
    {
        public string AbsolutePath { get; set; }
        public string DisplayName { get; set; }
        public string FileName { get; set; }
        public string Type { get; set; }
        public string ParentAbsolutePath { get; set; }
        public string CreationDate { get; set; }
        public string LastModified { get; set; }
        public string LastModifier { get; set; }
        public string Owner { get; set; }
    }

    public sealed class BipParam
    {
        public string Name { get; set; }
        public string Label { get; set; }
        public string DataType { get; set; }
        public string UiType { get; set; }
        public string DefaultValue { get; set; }
        public List<string> Values { get; set; } = new List<string>();
        public List<string> LovLabels { get; set; } = new List<string>();
        public bool MultiValuesAllowed { get; set; }
        public bool SelectAsAll { get; set; }
        public bool UseNullForAll { get; set; }
        public bool RefreshParamOnChange { get; set; }
        public int FieldSize { get; set; }
        public string DateFormatString { get; set; }
        public string DateFrom { get; set; }
        public string DateTo { get; set; }
    }

    public sealed class BipTemplate
    {
        public string Id { get; set; }
        public string Type { get; set; }
        public string Url { get; set; }
        public List<KeyValuePair<string, string>> Formats { get; set; } = new List<KeyValuePair<string, string>>();
    }

    public sealed class BipDefinition
    {
        public string ReportName { get; set; }
        public string Description { get; set; }
        public string ReportType { get; set; }
        public string DefaultOutputFormat { get; set; }
        public string DefaultTemplateId { get; set; }
        public string DataModelUrl { get; set; }
        public List<string> TemplateIds { get; set; } = new List<string>();
        public List<BipTemplate> Templates { get; set; } = new List<BipTemplate>();
        public List<string> ParameterNames { get; set; } = new List<string>();
        public List<BipParam> Parameters { get; set; } = new List<BipParam>();
    }

    public sealed class BipRunRequest
    {
        public string Path { get; set; }
        public string Format { get; set; } = "csv";
        public string Template { get; set; }
        public string Locale { get; set; }
        public Dictionary<string, List<string>> Params { get; set; } = new Dictionary<string, List<string>>();
        /// <summary>Bytes per download; the report comes whole when -1, else the first chunk arrives with runReport and the rest with downloadReportDataChunk.</summary>
        public int ChunkBytes { get; set; } = 8_000_000;
        public int TimeoutMs { get; set; } = 20 * 60_000;
    }

    public sealed class BipProgress
    {
        public string Phase { get; set; }
        public long Bytes { get; set; }
        public int Chunks { get; set; }
        public string Message { get; set; }
    }

    public sealed class BipRunOutcome
    {
        public bool Ok { get; set; }
        public string Error { get; set; }
        public string ContentType { get; set; }
        public long Bytes { get; set; }
        public int Chunks { get; set; }
        public long Ms { get; set; }
    }

    public sealed class BipDataSet
    {
        public string Name { get; set; }
        public string Sql { get; set; }
        public string Type { get; set; }
    }

    public sealed class BipDataModel
    {
        public List<BipDataSet> DataSets { get; set; } = new List<BipDataSet>();
        public List<Dictionary<string, string>> Parameters { get; set; } = new List<Dictionary<string, string>>();
        public string DefaultDataSource { get; set; }
        public string Description { get; set; }
    }

    public sealed class BipService
    {
        public const string PROD_ORIGIN = "https://efmh.fa.em3.oraclecloud.com";
        public const string TEST_ORIGIN = "https://efmh-test.fa.em3.oraclecloud.com";
        private const string V2_NS = "http://xmlns.oracle.com/oxp/service/v2";
        private const string REPORT_PATH = "/xmlpserver/services/v2/ReportService";
        private const string CATALOG_PATH = "/xmlpserver/services/v2/CatalogService";
        private static readonly HttpClient Http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        private static readonly Regex PasswordElement = new Regex(@"(<(?:[\w-]+:)?password>)[\s\S]*?(</(?:[\w-]+:)?password>)", RegexOptions.IgnoreCase);

        private readonly Func<Task<(string Username, string Password)>> _credentials;
        public string Origin { get; }
        public string Pod { get; }

        public BipService(Func<Task<(string Username, string Password)>> credentials, string pod, string origin = null)
        {
            _credentials = credentials;
            Pod = string.IsNullOrWhiteSpace(pod) ? "PROD" : pod.ToUpperInvariant();
            Origin = !string.IsNullOrWhiteSpace(origin) ? origin.TrimEnd('/') : (Pod == "TEST" ? TEST_ORIGIN : PROD_ORIGIN);
        }

        public static string Esc(string s) => System.Security.SecurityElement.Escape(s ?? "") ?? "";

        /// <summary>A catalog path: absolute, no traversal, no markup.</summary>
        public static bool PathOk(string path, out string why)
        {
            why = null;
            if (string.IsNullOrWhiteSpace(path) || !path.StartsWith("/")) { why = "The path must start with /"; return false; }
            if (path.Contains("..") || path.IndexOfAny(new[] { '<', '>', '"', '\\' }) >= 0) { why = "Not a catalog path: " + path; return false; }
            return true;
        }

        // ── SOAP plumbing ────────────────────────────────────────────
        private async Task<(string User, string Pass)> CredsAsync()
        {
            var c = await _credentials().ConfigureAwait(false);
            if (string.IsNullOrEmpty(c.Username) || string.IsNullOrEmpty(c.Password))
                throw new InvalidOperationException("Oracle Fusion credentials are not available. Check the network / credentials service.");
            return (c.Username, c.Password);
        }

        private static string Envelope(string op, string inner, string user, string pass) =>
$@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/"" xmlns:v2=""{V2_NS}"">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:{op}>
      {inner}
      <v2:userID>{Esc(user)}</v2:userID>
      <v2:password>{Esc(pass)}</v2:password>
    </v2:{op}>
  </soapenv:Body>
</soapenv:Envelope>";

        private static HttpRequestMessage Request(string url, string op, string envelope)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Content = new StringContent(envelope, Encoding.UTF8, "text/xml");
            req.Headers.Add("SOAPAction", "\"" + op + "\"");
            return req;
        }

        private static string FaultOf(string text, int status)
        {
            string fault = Regex.Match(text ?? "", @"<(?:\w+:)?faultstring[^>]*>([\s\S]*?)</(?:\w+:)?faultstring>").Groups[1].Value.Trim();
            if (fault.Length == 0) fault = Regex.Match(text ?? "", @"<(?:\w+:)?message[^>]*>([\s\S]*?)</(?:\w+:)?message>").Groups[1].Value.Trim();
            if (fault.Length > 0) return System.Net.WebUtility.HtmlDecode(Regex.Replace(fault, @"\s+", " "));
            if (status >= 400)
            {
                string title = Regex.Match(text ?? "", @"<title>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline).Groups[1].Value.Trim();
                return "HTTP " + status + (title.Length > 0 ? " · " + title : status == 401 || status == 403 ? " · the Fusion user may not have BI Publisher access" : "");
            }
            return null;
        }

        /// <summary>One SOAP call whose answer is small enough to hold as text (catalog, definition, parameters).</summary>
        private async Task<XDocument> CallAsync(string service, string op, string inner, int timeoutMs, CancellationToken ct)
        {
            var (user, pass) = await CredsAsync().ConfigureAwait(false);
            string url = Origin + service;
            using var req = Request(url, op, Envelope(op, inner, user, pass));
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromMilliseconds(Math.Clamp(timeoutMs, 5000, 3_600_000)));
            string text; int status;
            try
            {
                using var res = await Http.SendAsync(req, cts.Token).ConfigureAwait(false);
                status = (int)res.StatusCode;
                text = await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new TimeoutException(op + " did not answer within " + (timeoutMs / 1000) + " s"); }
            catch (HttpRequestException ex) { throw new InvalidOperationException("Could not reach " + new Uri(url).Host + ": " + ex.Message); }
            string fault = FaultOf(text, status);
            if (fault != null) throw new InvalidOperationException(op + ": " + fault);
            try { return XDocument.Parse(text); }
            catch (Exception ex) { throw new InvalidOperationException(op + " answered with something that is not XML: " + ex.Message); }
        }

        private static string L(XElement e, string name) => e?.Elements().FirstOrDefault(x => x.Name.LocalName == name)?.Value?.Trim();
        private static List<string> Items(XElement e, string name) =>
            e?.Elements().FirstOrDefault(x => x.Name.LocalName == name)?.Elements().Where(x => x.Name.LocalName == "item").Select(x => x.Value).ToList() ?? new List<string>();
        private static bool B(string s) => string.Equals(s, "true", StringComparison.OrdinalIgnoreCase);

        // ── Catalog ──────────────────────────────────────────────────
        public async Task<List<BipCatalogItem>> FolderContentsAsync(string path, CancellationToken ct = default)
        {
            if (!PathOk(path, out string why)) throw new ArgumentException(why);
            var doc = await CallAsync(CATALOG_PATH, "getFolderContents", "<v2:folderAbsolutePath>" + Esc(path) + "</v2:folderAbsolutePath>", 120_000, ct).ConfigureAwait(false);
            var list = new List<BipCatalogItem>();
            foreach (var it in doc.Descendants().Where(x => x.Name.LocalName == "item" && x.Elements().Any(c => c.Name.LocalName == "absolutePath")))
            {
                list.Add(new BipCatalogItem
                {
                    AbsolutePath = L(it, "absolutePath"), DisplayName = L(it, "displayName"), FileName = L(it, "fileName"), Type = L(it, "type"),
                    ParentAbsolutePath = L(it, "parentAbsolutePath"), CreationDate = L(it, "creationDate"), LastModified = L(it, "lastModified"),
                    LastModifier = L(it, "lastModifier"), Owner = L(it, "owner")
                });
            }
            return list.OrderBy(i => i.Type == "Folder" ? 0 : 1).ThenBy(i => i.DisplayName ?? i.FileName, StringComparer.OrdinalIgnoreCase).ToList();
        }

        /// <summary>Walks the catalog breadth-first from `root` (at most `maxFolders` folders) → every folder and report found, for the search box.</summary>
        public async Task<List<BipCatalogItem>> IndexAsync(string root, int maxFolders, Action<int, int, string> progress, CancellationToken ct = default)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var queue = new Queue<string>(); queue.Enqueue(string.IsNullOrWhiteSpace(root) ? "/" : root);
            var all = new List<BipCatalogItem>();
            int folders = 0;
            while (queue.Count > 0 && folders < maxFolders)
            {
                ct.ThrowIfCancellationRequested();
                string p = queue.Dequeue();
                if (!seen.Add(p)) continue;
                folders++;
                progress?.Invoke(folders, queue.Count, p);
                List<BipCatalogItem> items;
                try { items = await FolderContentsAsync(p, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex) { all.Add(new BipCatalogItem { AbsolutePath = p, DisplayName = System.IO.Path.GetFileName(p.TrimEnd('/')), Type = "Error", Owner = ex.Message }); continue; }
                foreach (var it in items)
                {
                    if (it.Type == "Folder")
                    {
                        if (!string.IsNullOrEmpty(it.AbsolutePath) && !seen.Contains(it.AbsolutePath)) queue.Enqueue(it.AbsolutePath);
                        if (p == "/" || p.EndsWith("/")) continue;
                    }
                    all.Add(it);
                }
            }
            return all;
        }

        // ── Definition and parameters ────────────────────────────────
        private static BipParam ReadParam(XElement it) => new BipParam
        {
            Name = L(it, "name"), Label = L(it, "label"), DataType = L(it, "dataType"), UiType = L(it, "UIType") ?? L(it, "uiType"),
            DefaultValue = L(it, "defaultValue"), Values = Items(it, "values"), LovLabels = Items(it, "lovLabels"),
            MultiValuesAllowed = B(L(it, "multiValuesAllowed")), SelectAsAll = B(L(it, "selectAsAll")), UseNullForAll = B(L(it, "useNullForAll")),
            RefreshParamOnChange = B(L(it, "refreshParamOnChange")), FieldSize = int.TryParse(L(it, "fieldSize"), out int fs) ? fs : 0,
            DateFormatString = L(it, "dateFormatString"), DateFrom = L(it, "dateFrom"), DateTo = L(it, "dateTo")
        };

        public async Task<BipDefinition> DefinitionAsync(string path, CancellationToken ct = default)
        {
            if (!PathOk(path, out string why)) throw new ArgumentException(why);
            var doc = await CallAsync(REPORT_PATH, "getReportDefinition", "<v2:reportAbsolutePath>" + Esc(path) + "</v2:reportAbsolutePath>", 120_000, ct).ConfigureAwait(false);
            var r = doc.Descendants().FirstOrDefault(x => x.Name.LocalName == "getReportDefinitionReturn") ?? doc.Root;
            var def = new BipDefinition
            {
                ReportName = L(r, "reportName"), Description = L(r, "reportDescription"), ReportType = L(r, "reportType"),
                DefaultOutputFormat = L(r, "defaultOutputFormat"), DefaultTemplateId = L(r, "defaultTemplateId"), DataModelUrl = L(r, "dataModelURL"),
                TemplateIds = Items(r, "templateIds"), ParameterNames = Items(r, "parameterNames")
            };
            var tf = r?.Elements().FirstOrDefault(x => x.Name.LocalName == "listOfTemplateFormatsLabelValues");
            if (tf != null)
                foreach (var it in tf.Elements().Where(x => x.Name.LocalName == "item"))
                {
                    var t = new BipTemplate { Id = L(it, "templateID"), Type = L(it, "templateType"), Url = L(it, "templateURL") };
                    var fl = it.Elements().FirstOrDefault(x => x.Name.LocalName == "templateFormatsLabelValues");
                    if (fl != null) foreach (var f in fl.Elements().Where(x => x.Name.LocalName == "item")) t.Formats.Add(new KeyValuePair<string, string>(L(f, "templateFormatLabel"), L(f, "templateFormatValue")));
                    def.Templates.Add(t);
                }
            var pv = r?.Elements().FirstOrDefault(x => x.Name.LocalName == "reportParameterNameValues");
            if (pv != null) foreach (var it in pv.Elements().Where(x => x.Name.LocalName == "item")) def.Parameters.Add(ReadParam(it));
            return def;
        }

        public async Task<List<BipParam>> ParametersAsync(string path, CancellationToken ct = default)
        {
            if (!PathOk(path, out string why)) throw new ArgumentException(why);
            string inner = "<v2:reportRequest><v2:attributeFormat>xml</v2:attributeFormat><v2:reportAbsolutePath>" + Esc(path) + "</v2:reportAbsolutePath><v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload></v2:reportRequest>";
            var doc = await CallAsync(REPORT_PATH, "getReportParameters", inner, 120_000, ct).ConfigureAwait(false);
            var ret = doc.Descendants().FirstOrDefault(x => x.Name.LocalName == "getReportParametersReturn");
            var list = new List<BipParam>();
            if (ret == null) return list;
            foreach (var it in ret.Elements().Where(x => x.Name.LocalName == "item" && x.Elements().Any(c => c.Name.LocalName == "name"))) list.Add(ReadParam(it));
            if (list.Count == 0 && ret.Elements().Any(c => c.Name.LocalName == "name")) list.Add(ReadParam(ret));
            return list;
        }

        // ── Running a report ─────────────────────────────────────────
        private static string ParamXml(Dictionary<string, List<string>> prms)
        {
            if (prms == null || prms.Count == 0) return "";
            var sb = new StringBuilder("<v2:parameterNameValues><v2:listOfParamNameValues>");
            foreach (var kv in prms)
            {
                if (string.IsNullOrWhiteSpace(kv.Key)) continue;
                sb.Append("<v2:item><v2:name>").Append(Esc(kv.Key)).Append("</v2:name>");
                var vals = (kv.Value ?? new List<string>()).Where(v => v != null).ToList();
                if (vals.Count > 1) sb.Append("<v2:multiValuesAllowed>true</v2:multiValuesAllowed>");
                sb.Append("<v2:values>");
                if (vals.Count == 0) sb.Append("<v2:item></v2:item>");
                foreach (var v in vals) sb.Append("<v2:item>").Append(Esc(v)).Append("</v2:item>");
                sb.Append("</v2:values></v2:item>");
            }
            return sb.Append("</v2:listOfParamNameValues></v2:parameterNameValues>").ToString();
        }

        /// <summary>The SOAP request of a run with the password masked — for the page's "show the call" box.</summary>
        public string RunEnvelopePreview(BipRunRequest req)
        {
            return PasswordElement.Replace(Envelope("runReport", RunInner(req), "<fusion user>", "***"), "$1***$2");
        }

        private static string RunInner(BipRunRequest req)
        {
            var sb = new StringBuilder("<v2:reportRequest>");
            sb.Append("<v2:attributeFormat>").Append(Esc(string.IsNullOrWhiteSpace(req.Format) ? "csv" : req.Format.Trim().ToLowerInvariant())).Append("</v2:attributeFormat>");
            if (!string.IsNullOrWhiteSpace(req.Locale)) sb.Append("<v2:attributeLocale>").Append(Esc(req.Locale)).Append("</v2:attributeLocale>");
            if (!string.IsNullOrWhiteSpace(req.Template)) sb.Append("<v2:attributeTemplate>").Append(Esc(req.Template)).Append("</v2:attributeTemplate>");
            sb.Append("<v2:byPassCache>true</v2:byPassCache><v2:flattenXML>false</v2:flattenXML>");
            sb.Append(ParamXml(req.Params));
            sb.Append("<v2:reportAbsolutePath>").Append(Esc(req.Path)).Append("</v2:reportAbsolutePath>");
            sb.Append("<v2:sizeOfDataChunkDownload>").Append(req.ChunkBytes > 0 ? req.ChunkBytes : -1).Append("</v2:sizeOfDataChunkDownload>");
            return sb.Append("</v2:reportRequest>").ToString();
        }

        /// <summary>
        /// Runs the report and writes its output to `file`: runReport streamed (the base64 of reportBytes is decoded on the fly
        /// with an XmlReader, so a 300 MB report never sits in memory), then downloadReportDataChunk until the report is complete.
        /// </summary>
        public async Task<BipRunOutcome> RunToFileAsync(BipRunRequest req, string file, IProgress<BipProgress> progress, CancellationToken ct = default)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var outcome = new BipRunOutcome();
            if (!PathOk(req.Path, out string why)) { outcome.Error = why; return outcome; }
            if (!Regex.IsMatch(req.Path, @"\.xdo$", RegexOptions.IgnoreCase)) { outcome.Error = "Not a report (.xdo): " + req.Path; return outcome; }
            string fmt = (req.Format ?? "csv").Trim().ToLowerInvariant();
            if (!Regex.IsMatch(fmt, @"^[a-z0-9]{1,10}$")) { outcome.Error = "Unknown output format " + req.Format; return outcome; }
            try
            {
                var (user, pass) = await CredsAsync().ConfigureAwait(false);
                string url = Origin + REPORT_PATH;
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(file));
                string fileId = null; long total = 0; int chunks = 0;
                progress?.Report(new BipProgress { Phase = "running", Message = "Fusion is running the report…" });
                using (var fs = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16))
                {
                    var first = await PostStreamedAsync(url, "runReport", Envelope("runReport", RunInner(req), user, pass), fs, req.TimeoutMs, ct, b =>
                    {
                        progress?.Report(new BipProgress { Phase = "downloading", Bytes = b, Chunks = 1, Message = "Receiving the output… " + Kb(b) });
                    }).ConfigureAwait(false);
                    if (first.Error != null) { outcome.Error = first.Error; return outcome; }
                    total = first.Bytes; chunks = 1; fileId = first.FileId; outcome.ContentType = first.ContentType;
                    // More to come? Only when the server gave a file id and the first chunk filled the requested size.
                    while (req.ChunkBytes > 0 && !string.IsNullOrEmpty(fileId) && first.Bytes >= req.ChunkBytes)
                    {
                        ct.ThrowIfCancellationRequested();
                        string inner = "<v2:fileID>" + Esc(fileId) + "</v2:fileID><v2:beginIdx>" + total.ToString(CultureInfo.InvariantCulture) + "</v2:beginIdx><v2:size>" + req.ChunkBytes + "</v2:size>";
                        var next = await PostStreamedAsync(url, "downloadReportDataChunk", Envelope("downloadReportDataChunk", inner, user, pass), fs, Math.Max(req.TimeoutMs, 300_000), ct, b =>
                        {
                            progress?.Report(new BipProgress { Phase = "downloading", Bytes = total + b, Chunks = chunks + 1, Message = "Receiving chunk " + (chunks + 1) + "… " + Kb(total + b) });
                        }).ConfigureAwait(false);
                        if (next.Error != null) { outcome.Error = "Chunk " + (chunks + 1) + ": " + next.Error; return outcome; }
                        chunks++; total += next.Bytes;
                        if (next.Bytes < req.ChunkBytes) break;
                        if (chunks > 10_000) { outcome.Error = "The report did not end after 10,000 chunks."; return outcome; }
                    }
                }
                outcome.Ok = true; outcome.Bytes = total; outcome.Chunks = chunks;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { outcome.Error = "Cancelled."; }
            catch (Exception ex) { outcome.Error = ex.Message; }
            outcome.Ms = sw.ElapsedMilliseconds;
            return outcome;
        }

        private static string Kb(long b) => b < 1024 ? b + " B" : b < 1024 * 1024 ? (b / 1024) + " KB" : (b / 1024.0 / 1024).ToString("0.0", CultureInfo.InvariantCulture) + " MB";

        private sealed class Streamed { public string Error; public long Bytes; public string FileId; public string ContentType; }

        /// <summary>Posts one envelope and streams the reportBytes of the answer into `output`; a fault or non-XML answer is read as text and returned as Error.</summary>
        private static async Task<Streamed> PostStreamedAsync(string url, string op, string envelope, Stream output, int timeoutMs, CancellationToken ct, Action<long> onBytes)
        {
            var r = new Streamed();
            using var req = Request(url, op, envelope);
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromMilliseconds(Math.Clamp(timeoutMs, 5000, 6 * 3_600_000)));
            try
            {
                using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false);
                int status = (int)res.StatusCode;
                if (!res.IsSuccessStatusCode)
                {
                    string text = await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
                    r.Error = FaultOf(text, status) ?? ("HTTP " + status);
                    return r;
                }
                using var stream = await res.Content.ReadAsStreamAsync(cts.Token).ConfigureAwait(false);
                var settings = new XmlReaderSettings { Async = true, DtdProcessing = DtdProcessing.Prohibit, IgnoreWhitespace = true, MaxCharactersFromEntities = 1024 };
                using var xr = XmlReader.Create(stream, settings);
                var buf = new byte[1 << 16];
                bool sawBytes = false; string fault = null;
                while (await xr.ReadAsync().ConfigureAwait(false))
                {
                    if (xr.NodeType != XmlNodeType.Element) continue;
                    string n = xr.LocalName;
                    if (n == "reportBytes")
                    {
                        if (xr.IsEmptyElement) { sawBytes = true; continue; }
                        sawBytes = true;
                        int got; long since = 0;
                        while ((got = await xr.ReadElementContentAsBase64Async(buf, 0, buf.Length).ConfigureAwait(false)) > 0)
                        {
                            await output.WriteAsync(buf, 0, got, cts.Token).ConfigureAwait(false);
                            r.Bytes += got; since += got;
                            if (since >= 1 << 20) { since = 0; onBytes?.Invoke(r.Bytes); }
                        }
                    }
                    else if (n == "reportFileID") r.FileId = (await xr.ReadElementContentAsStringAsync().ConfigureAwait(false))?.Trim();
                    else if (n == "reportContentType") r.ContentType = (await xr.ReadElementContentAsStringAsync().ConfigureAwait(false))?.Trim();
                    else if (n == "faultstring") fault = (await xr.ReadElementContentAsStringAsync().ConfigureAwait(false))?.Trim();
                }
                await output.FlushAsync(cts.Token).ConfigureAwait(false);
                if (fault != null) r.Error = Regex.Replace(fault, @"\s+", " ");
                else if (!sawBytes) r.Error = "The answer holds no reportBytes.";
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { r.Error = op + " did not answer within " + (timeoutMs / 60000) + " min. Narrow the parameters, use date buckets, or raise the time limit."; }
            catch (HttpRequestException ex) { r.Error = "Could not reach Fusion: " + ex.Message; }
            catch (XmlException ex) { r.Error = "The answer is not the SOAP envelope expected: " + ex.Message; }
            return r;
        }

        // ── The SQL behind a report: its data model ──────────────────
        public async Task<byte[]> DownloadObjectAsync(string path, CancellationToken ct = default)
        {
            if (!PathOk(path, out string why)) throw new ArgumentException(why);
            var doc = await CallAsync(CATALOG_PATH, "downloadObject", "<v2:reportAbsolutePath>" + Esc(path) + "</v2:reportAbsolutePath>", 300_000, ct).ConfigureAwait(false);
            string b64 = doc.Descendants().FirstOrDefault(x => x.Name.LocalName == "downloadObjectReturn")?.Value;
            if (string.IsNullOrWhiteSpace(b64)) throw new InvalidOperationException("downloadObject returned nothing for " + path);
            return Convert.FromBase64String(Regex.Replace(b64, @"\s+", ""));
        }

        /// <summary>The data sets (SQL) and parameters of a data model — from its XML, or from the .xdm inside the zip downloadObject returns.</summary>
        public static BipDataModel ParseDataModel(byte[] bytes)
        {
            string xml = null;
            if (bytes.Length > 4 && bytes[0] == 0x50 && bytes[1] == 0x4B)
            {
                using var ms = new MemoryStream(bytes);
                using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
                var entry = zip.Entries.FirstOrDefault(e => e.FullName.EndsWith(".xdm", StringComparison.OrdinalIgnoreCase)) ?? zip.Entries.FirstOrDefault(e => e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase));
                if (entry == null) throw new InvalidOperationException("The download holds no data model (.xdm): " + string.Join(", ", zip.Entries.Select(e => e.FullName).Take(10)));
                using var sr = new StreamReader(entry.Open(), Encoding.UTF8);
                xml = sr.ReadToEnd();
            }
            else xml = Encoding.UTF8.GetString(bytes).TrimStart('﻿');
            var m = new BipDataModel();
            var doc = XDocument.Parse(xml);
            var root = doc.Root;
            m.DefaultDataSource = root?.Attribute("defaultDataSourceRef")?.Value;
            m.Description = root?.Elements().FirstOrDefault(e => e.Name.LocalName == "description")?.Value?.Trim();
            foreach (var ds in doc.Descendants().Where(e => e.Name.LocalName == "dataSet"))
            {
                var sql = ds.Descendants().FirstOrDefault(e => e.Name.LocalName == "sql");
                if (sql == null) continue;
                m.DataSets.Add(new BipDataSet { Name = ds.Attribute("name")?.Value, Sql = sql.Value.Trim(), Type = sql.Attribute("dataSourceRef")?.Value ?? m.DefaultDataSource });
            }
            foreach (var p in doc.Descendants().Where(e => e.Name.LocalName == "parameter" && e.Attribute("name") != null))
            {
                var d = new Dictionary<string, string>();
                foreach (var a in p.Attributes()) d[a.Name.LocalName] = a.Value;
                var label = p.Descendants().FirstOrDefault(e => e.Name.LocalName == "label");
                if (label != null) d["label"] = label.Value.Trim();
                m.Parameters.Add(d);
            }
            return m;
        }

        // ── Reading the output ───────────────────────────────────────
        /// <summary>Streams the records of a CSV (RFC 4180: quotes, doubled quotes, newlines inside quotes), one list of fields per record.</summary>
        public static IEnumerable<List<string>> CsvRecords(TextReader sr)
        {
            var rec = new List<string>(); var field = new StringBuilder(); bool inQ = false, any = false;
            int c;
            while ((c = sr.Read()) >= 0)
            {
                char ch = (char)c; any = true;
                if (inQ)
                {
                    if (ch == '"') { if (sr.Peek() == '"') { field.Append('"'); sr.Read(); } else inQ = false; }
                    else field.Append(ch);
                }
                else if (ch == '"') inQ = true;
                else if (ch == ',') { rec.Add(field.ToString()); field.Clear(); }
                else if (ch == '\n' || ch == '\r')
                {
                    if (ch == '\r' && sr.Peek() == '\n') sr.Read();
                    rec.Add(field.ToString()); field.Clear();
                    if (!(rec.Count == 1 && rec[0].Length == 0)) yield return rec;
                    rec = new List<string>(); any = false;
                }
                else field.Append(ch);
            }
            if (any && (field.Length > 0 || rec.Count > 0)) { rec.Add(field.ToString()); if (!(rec.Count == 1 && rec[0].Length == 0)) yield return rec; }
        }

        private static string CsvField(string v)
        {
            if (v == null) return "";
            return v.IndexOfAny(new[] { ',', '"', '\n', '\r' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
        }

        /// <summary>Header + rows `offset`..`offset+limit` of a CSV file (values coerced like the Fusion SQL runner) and the total row count.</summary>
        public static (List<string> Columns, List<Dictionary<string, object>> Rows, long Total) ReadCsv(string file, long offset, int limit, bool coerce = true)
        {
            var cols = new List<string>(); var rows = new List<Dictionary<string, object>>(); long total = 0; bool first = true;
            using var sr = new StreamReader(file, Encoding.UTF8, true, 1 << 16);
            foreach (var rec in CsvRecords(sr))
            {
                if (first) { cols = rec.Select(h => h.Trim().TrimStart('﻿')).ToList(); first = false; continue; }
                if (total >= offset && rows.Count < limit)
                {
                    var d = new Dictionary<string, object>();
                    for (int i = 0; i < cols.Count; i++) d[cols[i]] = i < rec.Count && rec[i].Length > 0 ? (coerce ? WMSApp.FusionSql.RowsetParser.Coerce(rec[i]) : rec[i]) : null;
                    rows.Add(d);
                }
                total++;
            }
            return (cols, rows, total);
        }

        /// <summary>Appends the data records of `part` to `output` (its header too when `withHeader`); returns the rows appended.</summary>
        public static long AppendCsv(string part, string output, bool withHeader)
        {
            long rows = 0; bool first = true;
            using var sr = new StreamReader(part, Encoding.UTF8, true, 1 << 16);
            using var fs = new FileStream(output, FileMode.Append, FileAccess.Write, FileShare.Read, 1 << 16);
            using var w = new StreamWriter(fs, new UTF8Encoding(false), 1 << 16);
            foreach (var rec in CsvRecords(sr))
            {
                if (first) { first = false; if (withHeader) w.WriteLine(string.Join(",", rec.Select(h => CsvField(h.TrimStart('﻿'))))); continue; }
                w.WriteLine(string.Join(",", rec.Select(CsvField)));
                rows++;
            }
            return rows;
        }

        /// <summary>Counts the data rows of a CSV file.</summary>
        public static long CountCsv(string file) => ReadCsv(file, 0, 0).Total;

        // ── XML data output → rows ───────────────────────────────────
        /// <summary>
        /// Streams the rows of a BI Publisher data XML (DATA_DS / G_1 … or any layout): the first element that repeats at depth 1–3 is a
        /// row; inside it the leaf elements are columns, a single nested group adds its leaves, a REPEATING nested group (header → lines)
        /// gives one row per innermost element with the parent's values repeated — so a header / lines data model flattens like a join.
        /// </summary>
        public static IEnumerable<Dictionary<string, string>> XmlRows(string file)
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, IgnoreWhitespace = true };
            using var xr = XmlReader.Create(file, settings);
            string rowName = null; int rowDepth = -1; var counts = new Dictionary<string, int>();
            bool any = false;
            while (xr.Read())
            {
                if (xr.NodeType != XmlNodeType.Element) continue;
                if (rowName == null)
                {
                    if (xr.Depth >= 1 && xr.Depth <= 3)
                    {
                        string key = xr.Depth + ":" + xr.LocalName;
                        counts[key] = counts.TryGetValue(key, out int n) ? n + 1 : 1;
                        if (counts[key] == 2) { rowName = xr.LocalName; rowDepth = xr.Depth; }
                    }
                    if (rowName == null) continue;
                    // the first occurrence was passed already: the reader sits on the second — the first is lost only for the detection
                    // pass, so run the whole thing again knowing the row element
                    break;
                }
            }
            if (rowName == null)
            {
                // nothing repeats: the leaves of the document are one row
                XDocument doc; try { doc = XDocument.Load(file); } catch { yield break; }
                var leaves = doc.Root?.Descendants().Where(e => !e.HasElements).ToList() ?? new List<XElement>();
                if (leaves.Count == 0) yield break;
                var one = new Dictionary<string, string>();
                foreach (var l in leaves) one[l.Name.LocalName] = l.Value;
                yield return one;
                yield break;
            }
            using var xr2 = XmlReader.Create(file, settings);
            while (xr2.Read())
            {
                if (xr2.NodeType != XmlNodeType.Element || xr2.LocalName != rowName || xr2.Depth != rowDepth) continue;
                XElement el;
                using (var sub = xr2.ReadSubtree()) el = XElement.Load(sub);
                foreach (var row in Flatten(el, null)) { any = true; yield return row; }
            }
            if (!any) yield break;
        }

        private static IEnumerable<Dictionary<string, string>> Flatten(XElement el, Dictionary<string, string> inherited)
        {
            var row = inherited == null ? new Dictionary<string, string>() : new Dictionary<string, string>(inherited);
            var groups = new List<XElement>();
            foreach (var ch in el.Elements())
            {
                if (ch.HasElements) groups.Add(ch);
                else row[ch.Name.LocalName] = ch.Value;
            }
            if (groups.Count == 0) { yield return row; yield break; }
            var byName = groups.GroupBy(g => g.Name.LocalName).ToList();
            var singles = byName.Where(g => g.Count() == 1).Select(g => g.First()).ToList();
            var repeating = byName.Where(g => g.Count() > 1).ToList();
            foreach (var sgl in singles)
            {
                // a single nested group: its leaves join the row (deeper repeats come back as rows below)
                var inner = Flatten(sgl, null).ToList();
                if (inner.Count == 1) { foreach (var kv in inner[0]) if (!row.ContainsKey(kv.Key)) row[kv.Key] = kv.Value; }
                else repeating.Add(byName.First(g => g.Key == sgl.Name.LocalName));
            }
            if (repeating.Count == 0) { yield return row; yield break; }
            foreach (var grp in repeating)
                foreach (var item in grp)
                    foreach (var r in Flatten(item, row)) yield return r;
        }

        /// <summary>Writes the rows of a data XML as CSV (header = every column seen, in first-seen order) → rows written, columns.</summary>
        public static (long Rows, List<string> Columns) XmlToCsv(string xmlFile, string csvFile, List<string> header, bool append)
        {
            var cols = header != null ? new List<string>(header) : new List<string>();
            var set = new HashSet<string>(cols);
            if (header == null) foreach (var r in XmlRows(xmlFile)) foreach (var k in r.Keys) if (set.Add(k)) cols.Add(k);
            long n = 0;
            using var fs = new FileStream(csvFile, append ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
            using var w = new StreamWriter(fs, new UTF8Encoding(false), 1 << 16);
            if (!append) w.WriteLine(string.Join(",", cols.Select(CsvField)));
            foreach (var r in XmlRows(xmlFile))
            {
                w.WriteLine(string.Join(",", cols.Select(c => CsvField(r.TryGetValue(c, out var v) ? v : null))));
                n++;
            }
            return (n, cols);
        }

        /// <summary>A page of rows of a data XML (the CSV conversion is the normal path; this reads the XML itself).</summary>
        public static (List<string> Columns, List<Dictionary<string, object>> Rows, long Total) ReadXml(string file, long offset, int limit)
        {
            var cols = new List<string>(); var set = new HashSet<string>(); var rows = new List<Dictionary<string, object>>(); long total = 0;
            foreach (var r in XmlRows(file))
            {
                foreach (var k in r.Keys) if (set.Add(k)) cols.Add(k);
                if (total >= offset && rows.Count < limit)
                {
                    var d = new Dictionary<string, object>();
                    foreach (var kv in r) d[kv.Key] = kv.Value.Length > 0 ? WMSApp.FusionSql.RowsetParser.Coerce(kv.Value) : null;
                    rows.Add(d);
                }
                total++;
            }
            return (cols, rows, total);
        }
    }
}

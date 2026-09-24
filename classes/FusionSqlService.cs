using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;

namespace WMSApp.FusionSql
{
    // =====================================================================
    //  Fusion SQL — run read-only SQL against Oracle Fusion Cloud through a
    //  single BI Publisher "query runner" report (DBMS_XMLGEN data model).
    //  See the Fusion SQL RD for the full design; section numbers (§) below
    //  refer to it.
    // =====================================================================

    /// <summary>Persisted settings (§5.1). Stored at %APPDATA%\GraysWMS\FusionSql\config.json</summary>
    public sealed class FusionSqlConfig
    {
        /// <summary>Pod origin. Empty = derive from the logged-in instance (PROD / TEST).</summary>
        public string BaseUrl { get; set; } = "";
        public string FolderPath { get; set; } = "/Custom/GraysWMS";
        public string DataModelPath { get; set; } = "/Custom/GraysWMS/QueryRunnerDM.xdm";
        public string ReportPath { get; set; } = "/Custom/GraysWMS/QueryRunner.xdo";
        public string DataSource { get; set; } = "ApplicationDB_FSCM";
        public int RowLimit { get; set; } = 100;
        public int TimeoutMs { get; set; } = 120000;
        public string ReportServicePath { get; set; } = "/xmlpserver/services/v2/ReportService";
        public string CatalogServicePath { get; set; } = "/xmlpserver/services/v2/CatalogService";
        /// <summary>false = use the application's Fusion credentials; true = use the DPAPI-stored override.</summary>
        public bool UseCustomCredentials { get; set; } = false;
        public string AiModel { get; set; } = "claude-opus-5";
    }

    public sealed class FusionQueryResult
    {
        public bool Success { get; set; }
        public List<Dictionary<string, object>> Rows { get; set; } = new List<Dictionary<string, object>>();
        public List<string> Columns { get; set; } = new List<string>();
        public int RowCount { get; set; }
        public bool Capped { get; set; }
        public long ElapsedMs { get; set; }
        public string Error { get; set; }
        public string Raw { get; set; }
        public string Warning { get; set; }
        /// <summary>First part of the decoded report output — set when nothing was read, to diagnose the runner.</summary>
        public string Decoded { get; set; }

        public static FusionQueryResult Fail(string error, string raw = null) =>
            new FusionQueryResult { Success = false, Error = error, Raw = raw };
    }

    public sealed class FusionCallLogEntry
    {
        public string At { get; set; }
        public string Kind { get; set; }
        public string Protocol { get; set; }
        public string Url { get; set; }
        public int Status { get; set; }
        public string Headers { get; set; }
        public string Request { get; set; }
        public string Response { get; set; }
        public long DurationMs { get; set; }
        public string Decoded { get; set; }
    }

    internal sealed class SoapResult
    {
        public int Status;
        public string Bytes;   // base64 reportBytes, whitespace stripped
        public string Fault;
        public string Raw;
    }

    // ---------------------------------------------------------------------
    //  Local storage: config, DPAPI secrets, JSON schema cache (§5, §6)
    // ---------------------------------------------------------------------
    public static class FusionSqlStore
    {
        public static readonly string Root =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "FusionSql");

        private static string ConfigFile => Path.Combine(Root, "config.json");
        private static string CredsFile => Path.Combine(Root, "fusion-creds.json");
        private static string AiKeyFile => Path.Combine(Root, "ai-key.json");
        private static string CacheDir => Path.Combine(Root, "cache");
        public static string SchemaDbFile => Path.Combine(Root, "fusion-schema.db");

        private static readonly object _cacheLock = new object();
        private static readonly JsonSerializerOptions _json = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
            PropertyNameCaseInsensitive = true
        };

        private static void EnsureRoot() => Directory.CreateDirectory(Root);

        // ── Config ──
        public static FusionSqlConfig LoadConfig()
        {
            try
            {
                if (File.Exists(ConfigFile))
                    return JsonSerializer.Deserialize<FusionSqlConfig>(File.ReadAllText(ConfigFile), _json) ?? new FusionSqlConfig();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[FusionSql] Config load failed: " + ex.Message);
            }
            return new FusionSqlConfig();
        }

        public static FusionSqlConfig PatchConfig(JsonElement patch)
        {
            var cfg = LoadConfig();
            var node = JsonSerializer.SerializeToNode(cfg, _json).AsObject();
            foreach (var p in patch.EnumerateObject())
            {
                // Only known keys, matched case-insensitively
                var key = node.Select(k => k.Key).FirstOrDefault(k => string.Equals(k, p.Name, StringComparison.OrdinalIgnoreCase));
                if (key != null) node[key] = JsonNode.Parse(p.Value.GetRawText());
            }
            cfg = node.Deserialize<FusionSqlConfig>(_json) ?? cfg;

            if (!string.IsNullOrWhiteSpace(cfg.BaseUrl))
            {
                if (!Uri.TryCreate(cfg.BaseUrl.Trim(), UriKind.Absolute, out var u) || u.Scheme != "https")
                    throw new ArgumentException("Pod URL must start with https://");
                // Credentials are posted to this origin, so only allow Oracle Cloud pods (§8.4)
                if (!u.Host.EndsWith(".oraclecloud.com", StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("Pod URL must be an Oracle Cloud host (*.oraclecloud.com).");
                cfg.BaseUrl = u.GetLeftPart(UriPartial.Authority);   // origin only (§5.1)
            }
            cfg.RowLimit = Math.Clamp(cfg.RowLimit, 1, 100000);
            cfg.TimeoutMs = Math.Clamp(cfg.TimeoutMs, 5000, 600000);

            EnsureRoot();
            File.WriteAllText(ConfigFile, JsonSerializer.Serialize(cfg, _json));
            return cfg;
        }

        // ── DPAPI secrets (§5.2, §8.3) — never returned to the page ──
        private static string Protect(string plain) =>
            Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(plain ?? ""), null, DataProtectionScope.CurrentUser));

        private static string Unprotect(string b64) =>
            Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(b64), null, DataProtectionScope.CurrentUser));

        public static void SaveCredentials(string username, string password)
        {
            EnsureRoot();
            var existing = LoadCredentials();
            // Blank password keeps the saved one (so the user can change only the username)
            string pass = string.IsNullOrEmpty(password) ? existing.Password : password;
            var obj = new JsonObject
            {
                ["username"] = username ?? "",
                ["password"] = string.IsNullOrEmpty(pass) ? "" : Protect(pass),
                ["encrypted"] = true
            };
            File.WriteAllText(CredsFile, obj.ToJsonString());
        }

        public static (string Username, string Password) LoadCredentials()
        {
            try
            {
                if (!File.Exists(CredsFile)) return (null, null);
                var obj = JsonNode.Parse(File.ReadAllText(CredsFile))?.AsObject();
                string user = obj?["username"]?.GetValue<string>();
                string enc = obj?["password"]?.GetValue<string>();
                return (user, string.IsNullOrEmpty(enc) ? null : Unprotect(enc));
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[FusionSql] Credentials load failed: " + ex.Message);
                return (null, null);
            }
        }

        public static void SaveAiKey(string apiKey)
        {
            EnsureRoot();
            if (string.IsNullOrWhiteSpace(apiKey)) { if (File.Exists(AiKeyFile)) File.Delete(AiKeyFile); return; }
            File.WriteAllText(AiKeyFile, new JsonObject { ["key"] = Protect(apiKey.Trim()) }.ToJsonString());
        }

        public static string LoadAiKey()
        {
            try
            {
                if (!File.Exists(AiKeyFile)) return null;
                string enc = JsonNode.Parse(File.ReadAllText(AiKeyFile))?["key"]?.GetValue<string>();
                return string.IsNullOrEmpty(enc) ? null : Unprotect(enc);
            }
            catch { return null; }
        }

        // ── Schema cache: one JSON map per pod (§6) ──
        public static string CacheFileFor(string pod)
        {
            string safe = Regex.Replace(pod ?? "default", @"[^\w.-]", "_");
            if (safe.Length > 120) safe = safe.Substring(0, 120);
            return Path.Combine(CacheDir, "schema-" + safe + ".json");
        }

        private static JsonObject ReadCache(string pod)
        {
            string f = CacheFileFor(pod);
            try { if (File.Exists(f)) return JsonNode.Parse(File.ReadAllText(f))?.AsObject() ?? new JsonObject(); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FusionSql] Cache read failed: " + ex.Message); }
            return new JsonObject();
        }

        public static JsonNode CacheGet(string pod, string key)
        {
            lock (_cacheLock)
            {
                var map = ReadCache(pod);
                if (string.IsNullOrEmpty(key)) return map;
                return map.TryGetPropertyValue(key, out var v) ? v?.DeepClone() : null;
            }
        }

        public static void CacheSet(string pod, string key, JsonNode value)
        {
            lock (_cacheLock)
            {
                var map = ReadCache(pod);
                if (value == null) map.Remove(key); else map[key] = value.DeepClone();
                Directory.CreateDirectory(CacheDir);
                File.WriteAllText(CacheFileFor(pod), map.ToJsonString());
            }
        }

        public static void CacheClear(string pod)
        {
            lock (_cacheLock)
            {
                string f = CacheFileFor(pod);
                if (File.Exists(f)) File.Delete(f);
            }
        }
    }

    // ---------------------------------------------------------------------
    //  Core service: execute, deploy, call log (§3, §4)
    // ---------------------------------------------------------------------
    public sealed class FusionSqlService
    {
        public const string PROD_ORIGIN = "https://efmh.fa.em3.oraclecloud.com";
        public const string TEST_ORIGIN = "https://efmh-test.fa.em3.oraclecloud.com";
        private const string V2_NS = "http://xmlns.oracle.com/oxp/service/v2";
        private const int MAX_CALLS = 30;
        private const int MAX_LOGGED_CHARS = 20000;

        private static readonly HttpClient Http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };

        private static readonly Regex ReadOnlyStart = new Regex(@"^(select|with)\b", RegexOptions.IgnoreCase);
        private static readonly Regex InlinePlsql = new Regex(
            @"^\s*with\s+(function|procedure)\b|\bpragma\s+autonomous_transaction\b", RegexOptions.IgnoreCase);
        private static readonly Regex LeadingComments = new Regex(@"^(\s*(--[^\n]*\n?|/\*.*?\*/))*\s*", RegexOptions.Singleline);
        private static readonly Regex PasswordElement = new Regex(@"(<(?:[\w-]+:)?password>)[\s\S]*?(</(?:[\w-]+:)?password>)", RegexOptions.IgnoreCase);

        private readonly Func<Task<(string Username, string Password)>> _appCredentials;
        private readonly Func<string> _instance;
        private readonly LinkedList<FusionCallLogEntry> _calls = new LinkedList<FusionCallLogEntry>();
        private readonly object _callsLock = new object();

        public FusionSqlService(Func<Task<(string Username, string Password)>> appCredentials, Func<string> instance)
        {
            _appCredentials = appCredentials;
            _instance = instance;
        }

        public string InstanceName => string.IsNullOrWhiteSpace(_instance?.Invoke()) ? "PROD" : _instance().ToUpperInvariant();

        public string ResolveOrigin(FusionSqlConfig cfg) =>
            !string.IsNullOrWhiteSpace(cfg.BaseUrl) ? cfg.BaseUrl.TrimEnd('/')
            : (InstanceName == "TEST" ? TEST_ORIGIN : PROD_ORIGIN);

        /// <summary>Pod key used for the schema cache file name.</summary>
        public string PodKey(FusionSqlConfig cfg) => new Uri(ResolveOrigin(cfg)).Host;

        public async Task<(string Username, string Password, string Source)> GetCredentialsAsync(FusionSqlConfig cfg)
        {
            if (cfg.UseCustomCredentials)
            {
                var (u, p) = FusionSqlStore.LoadCredentials();
                return (u, p, "custom");
            }
            var app = await _appCredentials().ConfigureAwait(false);
            return (app.Username, app.Password, "application");
        }

        // ── Statement preparation (§4.1, §8.1) ──
        public static string ValidateStatement(string sql, out string stmt)
        {
            stmt = (sql ?? "").Trim();
            while (stmt.EndsWith(";")) stmt = stmt.Substring(0, stmt.Length - 1).TrimEnd();
            if (stmt.Length == 0) return "Empty statement.";
            string body = LeadingComments.Replace(stmt, "");
            if (!ReadOnlyStart.IsMatch(body))
                return "Only SELECT / WITH statements are allowed (Fusion SQL is read-only).";
            if (InlinePlsql.IsMatch(body))
                return "Inline PL/SQL (WITH FUNCTION/PROCEDURE, PRAGMA AUTONOMOUS_TRANSACTION) is not allowed.";
            return null;
        }

        public async Task<FusionQueryResult> ExecuteAsync(string sql, int? rowLimit, CancellationToken ct = default)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            string error = ValidateStatement(sql, out string stmt);
            if (error != null) return FusionQueryResult.Fail(error);

            var cfg = FusionSqlStore.LoadConfig();
            var cred = await GetCredentialsAsync(cfg).ConfigureAwait(false);
            if (string.IsNullOrEmpty(cred.Username) || string.IsNullOrEmpty(cred.Password))
                return FusionQueryResult.Fail(cred.Source == "custom"
                    ? "No custom Fusion credentials saved. Open Connection settings and save a username/password."
                    : "Oracle Fusion credentials are not available. Check the network / credentials service.");

            int cap = Math.Clamp(rowLimit ?? cfg.RowLimit, 1, 100000);
            string capped = BuildCappedSql(stmt, cap);
            string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(capped));

            // XML first; CSV only if XML returned neither data nor a fault (§4.3)
            var xml = await RunReportAsync(cfg, cred.Username, cred.Password, b64, "xml", ct).ConfigureAwait(false);
            List<Dictionary<string, object>> rows = null;
            string decoded = null;
            if (xml.Bytes != null)
            {
                decoded = DecodeBase64(xml.Bytes);
                AnnotateLastCall(decoded);
                rows = RowsetParser.Parse(decoded);
            }

            // CSV when XML gave no data and no fault — or gave output we could not read (§4.3)
            if (rows == null && xml.Fault == null)
            {
                var csv = await RunReportAsync(cfg, cred.Username, cred.Password, b64, "csv", ct).ConfigureAwait(false);
                if (csv.Bytes != null)
                {
                    string csvDecoded = DecodeBase64(csv.Bytes);
                    AnnotateLastCall(csvDecoded);
                    rows = RowsetParser.Parse(csvDecoded);
                    decoded = decoded ?? csvDecoded;
                }
                else if (xml.Bytes == null)
                    return Timed(FusionQueryResult.Fail(csv.Fault ?? "HTTP " + csv.Status, csv.Raw), sw);
            }
            if (rows == null)
            {
                var fail = FusionQueryResult.Fail(Hint(xml.Fault ?? (decoded != null
                    ? "The runner report answered, but its output has no DBMS_XMLGEN ROWSET. The report layout is probably transforming the data — redeploy the runner (Connection → Deploy runner report) so it is a data-only report."
                    : "HTTP " + xml.Status), b64), xml.Raw);
                fail.Decoded = Truncate(decoded, 3000);
                return Timed(fail, sw);
            }

            var result = new FusionQueryResult
            {
                Success = true,
                Rows = rows,
                Columns = RowsetParser.Columns(rows),
                RowCount = rows.Count,
                Capped = rows.Count >= cap,
                Decoded = rows.Count == 0 ? Truncate(decoded, 3000) : null
            };
            if (b64.Length > 4000)
                result.Warning = "Statement is long (" + b64.Length + " base64 bytes). Pods without MAX_STRING_SIZE=EXTENDED limit it to 4000.";
            return Timed(result, sw);
        }

        /// <summary>Wraps the statement in the row cap (§4.1). The line breaks matter: a statement whose
        /// last line ends in a -- comment would otherwise swallow the closing parenthesis (ORA-00907).</summary>
        public static string BuildCappedSql(string stmt, int cap) =>
            "SELECT * FROM (\n" + stmt + "\n) WHERE ROWNUM <= " + cap;

        private static FusionQueryResult Timed(FusionQueryResult r, System.Diagnostics.Stopwatch sw)
        {
            r.ElapsedMs = sw.ElapsedMilliseconds;
            return r;
        }

        private static string Hint(string error, string b64)
        {
            if (error == null) return null;
            if (error.Contains("ORA-17041")) return error + "\n\nHint: the data model uses a ref cursor. Redeploy the DBMS_XMLGEN runner (Connection → Deploy).";
            if (error.Contains("ORA-00942")) return error + "\n\nHint: the BI user's data roles don't cover this table/view.";
            if (b64.Length > 4000 && (error.Contains("ORA-06502") || error.Contains("ORA-01489") || error.Contains("too long")))
                return error + "\n\nHint: the statement is longer than the 4000-byte SQL limit. Shorten it.";
            return error;
        }

        private static string DecodeBase64(string b64)
        {
            try { return Encoding.UTF8.GetString(Convert.FromBase64String(b64)); }
            catch { return ""; }
        }

        // ── SOAP: ReportService.runReport (§4.2) ──
        private async Task<SoapResult> RunReportAsync(FusionSqlConfig cfg, string user, string pass, string b64, string format, CancellationToken ct)
        {
            string env =
$@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/"" xmlns:v2=""{V2_NS}"">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:attributeFormat>{format}</v2:attributeFormat>
        <v2:reportAbsolutePath>{Esc(cfg.ReportPath)}</v2:reportAbsolutePath>
        <v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>P_QRY_STMT</v2:name>
              <v2:values><v2:item>{b64}</v2:item></v2:values>
            </v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>{Esc(user)}</v2:userID>
      <v2:password>{Esc(pass)}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>";

            string url = ResolveOrigin(cfg) + cfg.ReportServicePath;
            var (status, text, netError) = await PostSoapAsync(url, "runReport", env, null, cfg.TimeoutMs, "runReport (" + format + ")", ct).ConfigureAwait(false);
            var r = new SoapResult { Status = status, Raw = Truncate(text, 1200) };
            if (netError != null) { r.Fault = netError; return r; }

            var (bytes, fault) = ReadSoap(text, "reportBytes");
            r.Bytes = string.IsNullOrWhiteSpace(bytes) ? null : Regex.Replace(bytes, @"\s", "");
            if (r.Bytes == null) r.Fault = fault ?? (status >= 400 ? "HTTP " + status : null);
            return r;
        }

        /// <summary>Parses a SOAP response. Returns the first element named <paramref name="valueElement"/> and any fault text.
        /// HTML error pages (proxy, SSO login redirect) come back as a readable fault rather than an exception.</summary>
        private static (string Value, string Fault) ReadSoap(string text, string valueElement)
        {
            if (string.IsNullOrWhiteSpace(text)) return (null, null);
            try
            {
                var doc = XDocument.Parse(text);
                string value = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == valueElement)?.Value;
                string fault = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "faultstring")?.Value
                            ?? doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "message")?.Value;
                return (value, string.IsNullOrWhiteSpace(fault) ? null : fault.Trim());
            }
            catch
            {
                string title = Regex.Match(text, @"<title>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline).Groups[1].Value.Trim();
                return (null, "Unexpected non-XML response" + (title.Length > 0 ? " (" + title + ")" : "") + ": " + Truncate(Regex.Replace(text, @"\s+", " "), 200));
            }
        }

        private async Task<(int Status, string Text, string NetError)> PostSoapAsync(
            string url, string soapAction, string envelope, string basicAuth, int timeoutMs, string kind, CancellationToken ct)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int status = 0;
            string text = null, netError = null;
            var headers = new StringBuilder("Content-Type: text/xml; charset=utf-8\nSOAPAction: \"" + soapAction + "\"");
            try
            {
                if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Only HTTPS pod URLs are allowed.");

                using (var req = new HttpRequestMessage(HttpMethod.Post, url))
                {
                    req.Content = new StringContent(envelope, Encoding.UTF8, "text/xml");
                    req.Headers.Add("SOAPAction", "\"" + soapAction + "\"");
                    if (basicAuth != null)
                    {
                        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basicAuth);
                        headers.Append("\nAuthorization: Basic <base64 user:password>");
                    }
                    using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
                    {
                        cts.CancelAfter(TimeSpan.FromMilliseconds(Math.Clamp(timeoutMs, 5000, 600000)));
                        using (var res = await Http.SendAsync(req, cts.Token).ConfigureAwait(false))
                        {
                            status = (int)res.StatusCode;
                            text = await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
                        }
                    }
                }
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                netError = "Timed out after " + (Math.Clamp(timeoutMs, 5000, 600000) / 1000) + " s. Narrow the query or raise the timeout.";
            }
            catch (Exception ex)
            {
                netError = "Network error: " + ex.Message;
            }

            Record(new FusionCallLogEntry
            {
                At = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                Kind = kind,
                Protocol = "SOAP 1.1",
                Url = url,
                Status = status,
                Headers = headers.ToString(),
                Request = Truncate(PasswordElement.Replace(envelope, "$1***$2"), MAX_LOGGED_CHARS),
                Response = Truncate(netError ?? PasswordElement.Replace(text ?? "", "$1***$2"), MAX_LOGGED_CHARS),
                DurationMs = sw.ElapsedMilliseconds
            });
            return (status, text, netError);
        }

        // ── Call inspector (§4.7) ──
        private void Record(FusionCallLogEntry e)
        {
            lock (_callsLock)
            {
                _calls.AddFirst(e);
                while (_calls.Count > MAX_CALLS) _calls.RemoveLast();
            }
        }

        /// <summary>Adds the decoded reportBytes to the newest inspector entry.</summary>
        private void AnnotateLastCall(string decoded)
        {
            lock (_callsLock)
            {
                if (_calls.First != null) _calls.First.Value.Decoded = Truncate(PasswordElement.Replace(decoded ?? "", "$1***$2"), MAX_LOGGED_CHARS);
            }
        }

                public List<FusionCallLogEntry> GetCalls(bool clear)
        {
            lock (_callsLock)
            {
                if (clear) _calls.Clear();
                return _calls.ToList();
            }
        }

        // ── Deploy the runner through CatalogService (§3.5 A) ──
        public async Task<(bool Success, List<string> Steps, string Error, string Raw)> DeployAsync(CancellationToken ct = default)
        {
            var steps = new List<string>();
            var cfg = FusionSqlStore.LoadConfig();
            var cred = await GetCredentialsAsync(cfg).ConfigureAwait(false);
            if (string.IsNullOrEmpty(cred.Username) || string.IsNullOrEmpty(cred.Password))
                return (false, steps, "No Fusion credentials available.", null);

            string url = ResolveOrigin(cfg) + cfg.CatalogServicePath;
            string basic = Convert.ToBase64String(Encoding.UTF8.GetBytes(cred.Username + ":" + cred.Password));
            steps.Add("Pod: " + ResolveOrigin(cfg) + "  ·  user " + cred.Username + " (" + cred.Source + " credentials)");

            // 1. Folder — "already exists" is fine
            var folder = await CatalogCallAsync(url, basic, cfg, "createFolder",
                "<pub:folderAbsolutePath>" + Esc(cfg.FolderPath) + "</pub:folderAbsolutePath>", cred, ct).ConfigureAwait(false);
            if (folder.Fault != null && !Regex.IsMatch(folder.Fault, "exist", RegexOptions.IgnoreCase))
                return (false, Add(steps, "✗ createFolder " + cfg.FolderPath), folder.Fault, folder.Raw);
            steps.Add(folder.Fault == null ? "✓ Folder created: " + cfg.FolderPath : "✓ Folder already exists: " + cfg.FolderPath);

            // 2. Data model, 3. Report
            var uploads = new[]
            {
                (Path: cfg.DataModelPath, Type: "xdmz", Entry: "_datamodel.xdm", Xml: BuildDataModelXml(cfg.DataSource), Label: "Data model"),
                (Path: cfg.ReportPath,    Type: "xdoz", Entry: "_report.xdo",    Xml: BuildReportXml(cfg.DataModelPath), Label: "Report")
            };
            foreach (var u in uploads)
            {
                string zipped = Convert.ToBase64String(ZipSingle(u.Entry, u.Xml));
                string body = "<pub:reportObjectAbsolutePathURL>" + Esc(u.Path) + "</pub:reportObjectAbsolutePathURL>" +
                              "<pub:objectType>" + u.Type + "</pub:objectType>" +
                              "<pub:objectDescription>Gray's WMS Fusion SQL runner</pub:objectDescription>" +
                              "<pub:objectZippedData>" + zipped + "</pub:objectZippedData>";
                var up = await CatalogCallAsync(url, basic, cfg, "uploadObject", body, cred, ct).ConfigureAwait(false);

                if (up.Fault != null && Regex.IsMatch(up.Fault, "exist", RegexOptions.IgnoreCase))
                {
                    // Replace the existing object
                    var del = await CatalogCallAsync(url, basic, cfg, "deleteObject",
                        "<pub:objectAbsolutePath>" + Esc(u.Path) + "</pub:objectAbsolutePath>", cred, ct).ConfigureAwait(false);
                    if (del.Fault != null) return (false, Add(steps, "✗ Replace " + u.Label + " (delete failed)"), del.Fault, del.Raw);
                    steps.Add("• Existing " + u.Label.ToLowerInvariant() + " removed");
                    up = await CatalogCallAsync(url, basic, cfg, "uploadObject", body, cred, ct).ConfigureAwait(false);
                }
                if (up.Fault != null) return (false, Add(steps, "✗ Upload " + u.Label + ": " + u.Path), up.Fault, up.Raw);
                steps.Add("✓ " + u.Label + " uploaded: " + u.Path);
            }

            // 4. Smoke test
            var test = await ExecuteAsync("SELECT 1 AS n FROM dual", 1, ct).ConfigureAwait(false);
            if (!test.Success) return (false, Add(steps, "✗ Test query SELECT 1 FROM dual"), test.Error, test.Raw);
            if (!IsSelectOne(test))
                return (false, Add(steps, "✗ Test query ran but did not return N = 1"),
                    "The report output was not the DBMS_XMLGEN ROWSET. Decoded output:\n" + (test.Decoded ?? "(empty)"), test.Raw);
            steps.Add("✓ Test query returned " + test.RowCount + " row in " + test.ElapsedMs + " ms");
            return (true, steps, null, null);
        }

        private static List<string> Add(List<string> l, string s) { l.Add(s); return l; }

        public static bool IsSelectOne(FusionQueryResult r) =>
            r.Success && r.RowCount == 1 && r.Rows[0].TryGetValue("N", out var n) && Convert.ToString(n, CultureInfo.InvariantCulture) == "1";

        private async Task<(string Fault, string Raw)> CatalogCallAsync(string url, string basic, FusionSqlConfig cfg, string op, string inner,
            (string Username, string Password, string Source) cred, CancellationToken ct)
        {
            string env =
$@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/"" xmlns:pub=""{V2_NS}"">
  <soapenv:Header/>
  <soapenv:Body>
    <pub:{op}>
      {inner}
      <pub:userID>{Esc(cred.Username)}</pub:userID>
      <pub:password>{Esc(cred.Password)}</pub:password>
    </pub:{op}>
  </soapenv:Body>
</soapenv:Envelope>";
            var (status, text, netError) = await PostSoapAsync(url, op, env, basic, cfg.TimeoutMs, "CatalogService." + op, ct).ConfigureAwait(false);
            if (netError != null) return (netError, null);
            string fault = Regex.Match(text ?? "", @"<(?:\w+:)?faultstring[^>]*>([\s\S]*?)</(?:\w+:)?faultstring>").Groups[1].Value.Trim();
            if (fault.Length == 0 && status >= 400) fault = "HTTP " + status;
            return (fault.Length == 0 ? null : System.Net.WebUtility.HtmlDecode(fault), Truncate(text, 1200));
        }

        private static byte[] ZipSingle(string entryName, string content)
        {
            using (var ms = new MemoryStream())
            {
                using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
                {
                    var entry = zip.CreateEntry(entryName, CompressionLevel.NoCompression);
                    using (var s = entry.Open())
                    {
                        var bytes = new UTF8Encoding(false).GetBytes(content);
                        s.Write(bytes, 0, bytes.Length);
                    }
                }
                return ms.ToArray();
            }
        }

        // ── BIP object definitions (§3.1–3.3) ──
        public const string RUNNER_SQL =
@"SELECT REGEXP_REPLACE(
         DBMS_XMLGEN.getxml(
           UTL_RAW.cast_to_varchar2(
             UTL_ENCODE.base64_decode(UTL_RAW.cast_to_raw(:P_QRY_STMT))
           )
         ),
         '<\?xml[^>]*\?>', ''
       ) AS result
FROM dual";

        public static string BuildDataModelXml(string dataSource)
        {
            string ds = Esc(string.IsNullOrWhiteSpace(dataSource) ? "ApplicationDB_FSCM" : dataSource);
            return
$@"<?xml version = '1.0' encoding = 'utf-8'?>
<dataModel xmlns=""http://xmlns.oracle.com/oxp/xmlp"" version=""2.0"" xmlns:xdm=""http://xmlns.oracle.com/oxp/xmlp"" xmlns:xsd=""http://www.w3.org/2001/XMLSchema"" defaultDataSourceRef=""{ds}"">
   <description><![CDATA[Gray's WMS Fusion SQL query runner (DBMS_XMLGEN)]]></description>
   <dataProperties>
      <property name=""include_parameters"" value=""true""/>
      <property name=""include_null_Element"" value=""false""/>
      <property name=""include_rowsettag"" value=""false""/>
      <property name=""xml_tag_case"" value=""upper""/>
      <property name=""generate_output_format"" value=""xml""/>
      <property name=""optimize_query_executions"" value=""false""/>
      <property name=""sql_monitor_report_generated"" value=""false""/>
      <property name=""db_fetch_size"" value=""500""/>
   </dataProperties>
   <dataSets>
      <dataSet name=""Q1"" type=""simple"">
         <sql dataSourceRef=""{ds}"" nsQuery=""false"" xmlRowTagName=""G_1""><![CDATA[{RUNNER_SQL}]]></sql>
      </dataSet>
   </dataSets>
   <output rootName=""DATA_DS"" uniqueRowName=""false"">
      <nodeList name=""data-structure"">
         <dataStructure tagName=""DATA_DS"">
            <group name=""G_1"" label=""G_1"" source=""Q1"">
               <element name=""RESULT"" value=""RESULT"" label=""RESULT"" dataType=""xsd:string"" breakOrder="""" fieldOrder=""1""/>
            </group>
         </dataStructure>
      </nodeList>
   </output>
   <eventTriggers/>
   <lexicals/>
   <valueSets/>
   <parameters>
      <parameter name=""P_QRY_STMT"" defaultValue="""" dataType=""xsd:string"" rowPlacement=""1"">
         <input label=""P_QRY_STMT""/>
      </parameter>
   </parameters>
   <bursting/>
   <display>
      <layouts>
         <layout name=""Q1"" left=""0px"" top=""0px""/>
         <layout name=""DATA_DS"" left=""0px"" top=""0px""/>
      </layouts>
      <groupLinks/>
   </display>
</dataModel>";
        }

        public static string BuildReportXml(string dataModelPath) =>
$@"<?xml version = '1.0' encoding = 'utf-8'?>
<report xmlns=""http://xmlns.oracle.com/oxp/xmlp"" xmlns:xsd=""http://www.w3.org/2001/XMLSchema"" version=""2.0"" dataModel=""true"" useSubTemplate=""false"" cachePerUser=""true"" cacheSmartRefresh=""false"" cacheUserRefresh=""false"">
   <dataModel url=""{Esc(dataModelPath)}""/>
   <description><![CDATA[Gray's WMS Fusion SQL query runner]]></description>
   <property name=""showControls"" value=""true""/>
   <property name=""showReportLinks"" value=""true""/>
   <property name=""openLinkInNewWindow"" value=""true""/>
   <property name=""autoRun"" value=""true""/>
   <property name=""cacheDocument"" value=""false""/>
   <property name=""onlineReport"" value=""true""/>
   <property name=""asyncReport"" value=""false""/>
   <property name=""enableBursting"" value=""false""/>
   <parameters paramPerLine=""3"" style=""parameterLocation:horizontal;"">
      <parameter id=""P_QRY_STMT"" defaultValue="""" dataType=""xsd:string"" rowPlacement=""1"">
         <input label=""P_QRY_STMT""/>
      </parameter>
   </parameters>
</report>";

        private static string Esc(string s) => System.Security.SecurityElement.Escape(s ?? "") ?? "";

        private static string Truncate(string s, int max) =>
            string.IsNullOrEmpty(s) || s.Length <= max ? s : s.Substring(0, max) + "…";
    }

    // ---------------------------------------------------------------------
    //  Parsers (§4.5)
    // ---------------------------------------------------------------------
    public static class RowsetParser
    {
        private static readonly Regex NumberLike = new Regex(@"^-?\d{1,15}(\.\d+)?$");

        /// <summary>Parses the decoded reportBytes of the XML attempt. Returns null when the output isn't understood.</summary>
        public static List<Dictionary<string, object>> ParseDecoded(string decoded) => Parse(decoded);

        /// <summary>CSV attempt: the ROWSET usually arrives with real tags inside a CSV field.</summary>
        public static List<Dictionary<string, object>> ParseXmlGenOrCsv(string text) => Parse(text);

        /// <summary>
        /// Finds the DBMS_XMLGEN ROWSET wherever the report put it (§4.5):
        /// XML output escapes it once inside RESULT, CSV output carries real tags in a (quoted) field.
        /// Returns null when the output is not understood — never the runner's own RESULT wrapper as data.
        /// </summary>
        public static List<Dictionary<string, object>> Parse(string decoded)
        {
            if (string.IsNullOrWhiteSpace(decoded)) return null;
            string t = decoded.TrimStart('\uFEFF');

            // 1. The ROWSET, unescaping the whole text at most twice
            for (int round = 0; round < 3; round++)
            {
                var rows = ExtractRowset(t);
                if (rows != null) return rows;
                if (t.IndexOf("lt;ROWSET", StringComparison.Ordinal) < 0) break;   // &lt; or &amp;lt;
                t = XmlUnescapeOnce(t);
            }

            // 2. No ROWSET: DBMS_XMLGEN returns NULL for zero rows, so an empty envelope = 0 rows
            if (IsEmptyEnvelope(t)) return new List<Dictionary<string, object>>();

            // 3. Generic BIP XML / CSV — but a lone RESULT column is the runner envelope, not data
            List<Dictionary<string, object>> generic = null;
            try { var d = XDocument.Parse(t); if (d.Root != null) generic = ParseGenericXml(d.Root); }
            catch { generic = ParseCsv(t); }
            if (generic == null || generic.Count == 0) return generic;
            var cols = Columns(generic);
            if (cols.Count == 0 || (cols.Count == 1 && cols[0] == "RESULT")) return null;
            return generic;
        }

        private static List<Dictionary<string, object>> ExtractRowset(string t)
        {
            int start = t.IndexOf("<ROWSET", StringComparison.Ordinal);
            if (start < 0) return null;
            int close = t.IndexOf('>', start);
            if (close > start && t[close - 1] == '/') return new List<Dictionary<string, object>>();   // <ROWSET/>
            int end = t.IndexOf("</ROWSET>", start, StringComparison.Ordinal);
            if (end < 0) return null;
            string frag = t.Substring(start, end - start + "</ROWSET>".Length);
            // Inside a quoted CSV field every " is doubled — undo that first
            int before = start - 1;
            while (before >= 0 && char.IsWhiteSpace(t[before])) before--;
            if (before >= 0 && t[before] == '"') frag = frag.Replace("\"\"", "\"");
            return ParseRowsetText(frag);
        }

        /// <summary>XML-unescape once: &amp;lt; &amp;gt; &amp;quot; &amp;apos; &amp;#n; first, &amp;amp; last (§4.5.2).</summary>
        public static string XmlUnescapeOnce(string s)
        {
            s = s.Replace("&lt;", "<").Replace("&gt;", ">").Replace("&quot;", "\"").Replace("&apos;", "'");
            s = Regex.Replace(s, @"&#(x?)([0-9A-Fa-f]+);", m =>
            {
                try { return char.ConvertFromUtf32(Convert.ToInt32(m.Groups[2].Value, m.Groups[1].Value.Length > 0 ? 16 : 10)); }
                catch { return m.Value; }
            });
            return s.Replace("&amp;", "&");
        }

        /// <summary>DATA_DS whose RESULT is missing/blank, or a CSV that is just the RESULT header.</summary>
        private static bool IsEmptyEnvelope(string t)
        {
            try
            {
                var d = XDocument.Parse(t);
                if (d.Root == null || d.Root.Name.LocalName != "DATA_DS") return false;
                return d.Root.Descendants().Where(e => e.Name.LocalName == "RESULT").All(e => string.IsNullOrWhiteSpace(e.Value));
            }
            catch
            {
                var lines = t.Split('\n').Select(l => l.Trim().Trim('"').Trim()).Where(l => l.Length > 0).ToList();
                return lines.Count >= 1 && lines[0] == "RESULT" && lines.Count == 1;
            }
        }

        private static List<Dictionary<string, object>> ParseRowsetText(string xml)
        {
            try
            {
                xml = Regex.Replace(xml, @"^\s*<\?xml[^>]*\?>", "");
                var d = XDocument.Parse(xml);
                return d.Root == null ? new List<Dictionary<string, object>>() : ReadRowset(d.Root);
            }
            catch { return null; }
        }

        private static List<Dictionary<string, object>> ReadRowset(XElement rowset)
        {
            var rows = new List<Dictionary<string, object>>();
            foreach (var row in rowset.Elements().Where(e => e.Name.LocalName == "ROW"))
            {
                var d = new Dictionary<string, object>();
                foreach (var c in row.Elements())
                    if (!c.HasElements) d[c.Name.LocalName] = Coerce(c.Value.Trim());
                rows.Add(d);
            }
            return rows;
        }

        private static List<Dictionary<string, object>> ParseGenericXml(XElement root)
        {
            // Most frequent element that has children = the row wrapper
            var wrapper = root.DescendantsAndSelf()
                .Where(e => e.HasElements && e.Elements().Any(c => !c.HasElements))
                .GroupBy(e => e.Name.LocalName)
                .OrderByDescending(g => g.Count())
                .FirstOrDefault();
            if (wrapper == null) return null;
            return wrapper.Select(e =>
            {
                var d = new Dictionary<string, object>();
                foreach (var c in e.Elements().Where(c => !c.HasElements)) d[c.Name.LocalName] = Coerce(c.Value.Trim());
                return d;
            }).ToList();
        }

        /// <summary>RFC-4180 CSV: quoted fields, "" escapes, embedded commas/newlines; BOM stripped; first line = header.</summary>
        public static List<Dictionary<string, object>> ParseCsv(string text)
        {
            text = text.TrimStart('﻿');
            var records = new List<List<string>>();
            var field = new StringBuilder();
            var rec = new List<string>();
            bool inQ = false;
            for (int i = 0; i < text.Length; i++)
            {
                char ch = text[i];
                if (inQ)
                {
                    if (ch == '"') { if (i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; } else inQ = false; }
                    else field.Append(ch);
                }
                else if (ch == '"') inQ = true;
                else if (ch == ',') { rec.Add(field.ToString()); field.Clear(); }
                else if (ch == '\n' || ch == '\r')
                {
                    if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                    rec.Add(field.ToString()); field.Clear();
                    if (!(rec.Count == 1 && rec[0].Length == 0)) records.Add(rec);
                    rec = new List<string>();
                }
                else field.Append(ch);
            }
            if (field.Length > 0 || rec.Count > 0) { rec.Add(field.ToString()); records.Add(rec); }
            if (records.Count == 0) return null;

            var header = records[0].Select(h => h.Trim()).ToList();
            return records.Skip(1).Select(r =>
            {
                var d = new Dictionary<string, object>();
                for (int i = 0; i < header.Count && i < r.Count; i++)
                    if (r[i].Length > 0) d[header[i]] = Coerce(r[i].Trim());
                return d;
            }).ToList();
        }

        /// <summary>Numbers with ≤15 significant digits become numbers; everything else (incl. long IDs) stays text.</summary>
        public static object Coerce(string v)
        {
            if (string.IsNullOrEmpty(v)) return "";
            string n = v.Replace(",", "");
            if (NumberLike.IsMatch(n))
            {
                int significant = n.TrimStart('-').Replace(".", "").TrimStart('0').Length;
                if (significant <= 15 && decimal.TryParse(n, NumberStyles.Number, CultureInfo.InvariantCulture, out var d))
                    return d;
            }
            return v;
        }

        /// <summary>Union of keys in first-seen order; when some row has every column (NULLs are omitted
        /// by DBMS_XMLGEN) its order is the true SELECT order, so use that.</summary>
        public static List<string> Columns(List<Dictionary<string, object>> rows)
        {
            var union = new List<string>();
            var seen = new HashSet<string>();
            foreach (var r in rows)
                foreach (var k in r.Keys)
                    if (seen.Add(k)) union.Add(k);
            var full = rows.FirstOrDefault(r => r.Count == union.Count);
            return full != null ? full.Keys.ToList() : union;
        }
    }
}

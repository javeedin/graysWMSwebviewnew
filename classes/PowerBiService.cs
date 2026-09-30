using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;

namespace WMSApp
{
    /// <summary>
    /// Power BI for the Power BI module (powerbi/ page, apex_sql/76_powerbi.sql).
    /// Sign-in: USER mode = each user signs in with their Microsoft account (Pro licence) through MSAL in the
    /// system browser; tokens are cached per Windows user, DPAPI-encrypted. APP mode = service principal
    /// (needs Premium / Embedded / Fabric capacity) with a client secret kept on this PC only.
    /// Datasets: a definition (APEX SQL tables with typed columns, DAX measures, relationships) becomes a
    /// PUSH dataset in the workspace; a refresh reads the SQL in pages and posts the rows in batches.
    /// </summary>
    public static class PowerBiService
    {
        private const string API = "https://api.powerbi.com/v1.0/myorg";
        private const string PBI_RESOURCE = "https://analysis.windows.net/powerbi/api/";
        private static readonly string[] USER_SCOPES =
        {
            PBI_RESOURCE + "Dataset.ReadWrite.All", PBI_RESOURCE + "Report.ReadWrite.All",
            PBI_RESOURCE + "Workspace.Read.All", PBI_RESOURCE + "Content.Create"
        };
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
        private static string LocalDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "PowerBI");

        // ------------------------------------------------------------------ settings (shared in WMS_AI_CONTROL)
        public class Config { public string TenantId, ClientId, WorkspaceId, Mode; public bool HasSecret; }
        public static async Task<Config> ConfigAsync(string user)
        {
            var s = await AiControl.SettingsAsync(user).ConfigureAwait(false);
            return new Config
            {
                TenantId = AiControl.Setting(s, "PBI_TENANT_ID"), ClientId = AiControl.Setting(s, "PBI_CLIENT_ID"),
                WorkspaceId = AiControl.Setting(s, "PBI_WORKSPACE_ID"),
                Mode = string.Equals(AiControl.Setting(s, "PBI_MODE"), "APP", StringComparison.OrdinalIgnoreCase) ? "APP" : "USER",
                HasSecret = !string.IsNullOrEmpty(LoadSecret())
            };
        }
        public static bool Ready(Config c) => !string.IsNullOrWhiteSpace(c.TenantId) && !string.IsNullOrWhiteSpace(c.ClientId);

        // APP mode secret: this PC only, DPAPI
        private static string SecretFile => Path.Combine(LocalDir, "app_secret.dat");
        public static void SaveSecret(string secret)
        {
            Directory.CreateDirectory(LocalDir);
            if (string.IsNullOrWhiteSpace(secret)) { if (File.Exists(SecretFile)) File.Delete(SecretFile); return; }
            File.WriteAllBytes(SecretFile, ProtectedData.Protect(Encoding.UTF8.GetBytes(secret.Trim()), null, DataProtectionScope.CurrentUser));
        }
        private static string LoadSecret()
        {
            try { return File.Exists(SecretFile) ? Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(SecretFile), null, DataProtectionScope.CurrentUser)) : null; }
            catch { return null; }
        }

        // ------------------------------------------------------------------ sign-in
        private static IPublicClientApplication _pca;
        private static string _pcaKey;
        private static readonly SemaphoreSlim _authGate = new SemaphoreSlim(1, 1);

        private static async Task<IPublicClientApplication> PcaAsync(Config c)
        {
            string key = c.TenantId + "|" + c.ClientId;
            if (_pca != null && _pcaKey == key) return _pca;
            var app = PublicClientApplicationBuilder.Create(c.ClientId.Trim())
                .WithAuthority(AzureCloudInstance.AzurePublic, c.TenantId.Trim())
                .WithRedirectUri("http://localhost")
                .Build();
            Directory.CreateDirectory(LocalDir);
            // token cache per Windows user, encrypted with DPAPI
            var storage = new StorageCreationPropertiesBuilder("msal_" + c.ClientId.Trim() + ".cache", LocalDir).Build();
            var helper = await MsalCacheHelper.CreateAsync(storage).ConfigureAwait(false);
            helper.RegisterCache(app.UserTokenCache);
            _pca = app; _pcaKey = key;
            return app;
        }

        public class Token { public string AccessToken; public DateTimeOffset ExpiresOn; public string Account; public string Mode; }

        /// <summary>A Power BI token without any prompt, or null when nobody has signed in on this PC (USER mode).</summary>
        public static async Task<Token> TokenSilentAsync(Config c)
        {
            if (!Ready(c)) return null;
            if (c.Mode == "APP")
            {
                string secret = LoadSecret();
                if (string.IsNullOrEmpty(secret)) return null;
                var cca = ConfidentialClientApplicationBuilder.Create(c.ClientId.Trim()).WithClientSecret(secret)
                    .WithAuthority($"https://login.microsoftonline.com/{c.TenantId.Trim()}").Build();
                var r = await cca.AcquireTokenForClient(new[] { PBI_RESOURCE + ".default" }).ExecuteAsync().ConfigureAwait(false);
                return new Token { AccessToken = r.AccessToken, ExpiresOn = r.ExpiresOn, Account = "app " + c.ClientId, Mode = "APP" };
            }
            await _authGate.WaitAsync().ConfigureAwait(false);
            try
            {
                var app = await PcaAsync(c).ConfigureAwait(false);
                var acct = (await app.GetAccountsAsync().ConfigureAwait(false)).FirstOrDefault();
                if (acct == null) return null;
                try
                {
                    var r = await app.AcquireTokenSilent(USER_SCOPES, acct).ExecuteAsync().ConfigureAwait(false);
                    return new Token { AccessToken = r.AccessToken, ExpiresOn = r.ExpiresOn, Account = r.Account?.Username, Mode = "USER" };
                }
                catch (MsalUiRequiredException) { return null; }
            }
            finally { _authGate.Release(); }
        }

        /// <summary>USER mode: opens the Microsoft sign-in page in the default browser (http://localhost redirect).</summary>
        public static async Task<Token> SignInAsync(Config c, CancellationToken ct)
        {
            var app = await PcaAsync(c).ConfigureAwait(false);
            var r = await app.AcquireTokenInteractive(USER_SCOPES).WithUseEmbeddedWebView(false)
                .WithPrompt(Prompt.SelectAccount).ExecuteAsync(ct).ConfigureAwait(false);
            return new Token { AccessToken = r.AccessToken, ExpiresOn = r.ExpiresOn, Account = r.Account?.Username, Mode = "USER" };
        }

        public static async Task SignOutAsync(Config c)
        {
            if (!Ready(c)) return;
            var app = await PcaAsync(c).ConfigureAwait(false);
            foreach (var a in await app.GetAccountsAsync().ConfigureAwait(false)) await app.RemoveAsync(a).ConfigureAwait(false);
        }

        // ------------------------------------------------------------------ REST
        public class PbiException : Exception
        {
            public int Status;
            public PbiException(int status, string msg) : base(msg) { Status = status; }
        }

        public static async Task<JsonNode> CallAsync(Token t, HttpMethod method, string path, object body = null, CancellationToken ct = default)
        {
            for (int attempt = 0; ; attempt++)
            {
                using var req = new HttpRequestMessage(method, path.StartsWith("http") ? path : API + path);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t.AccessToken);
                if (body != null) req.Content = new StringContent(body is string s ? s : JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
                using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
                string txt = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                if ((int)resp.StatusCode == 429 && attempt < 5)
                {
                    // push API limits requests per minute - wait as told
                    var wait = resp.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(10 * (attempt + 1));
                    await Task.Delay(wait, ct).ConfigureAwait(false);
                    continue;
                }
                if (!resp.IsSuccessStatusCode)
                {
                    string msg = txt;
                    try { var j = JsonNode.Parse(txt); msg = j?["error"]?["message"]?.GetValue<string>() ?? j?["error"]?["code"]?.GetValue<string>() ?? txt; } catch { }
                    if (resp.StatusCode == HttpStatusCode.Unauthorized) msg = "Power BI refused the sign-in (401) - sign in again, and check that the account has a Power BI licence. " + msg;
                    if (resp.StatusCode == HttpStatusCode.Forbidden) msg = "Power BI: no permission (403) - the account needs Contributor (or higher) on the workspace. " + msg;
                    throw new PbiException((int)resp.StatusCode, msg.Length > 600 ? msg.Substring(0, 600) : msg);
                }
                return string.IsNullOrWhiteSpace(txt) ? null : JsonNode.Parse(txt);
            }
        }

        public static async Task<JsonArray> WorkspacesAsync(Token t) =>
            (await CallAsync(t, HttpMethod.Get, "/groups?$top=500").ConfigureAwait(false))?["value"] as JsonArray ?? new JsonArray();
        public static async Task<JsonArray> ReportsAsync(Token t, string ws) =>
            (await CallAsync(t, HttpMethod.Get, "/groups/" + ws + "/reports").ConfigureAwait(false))?["value"] as JsonArray ?? new JsonArray();
        public static async Task<JsonArray> DatasetsAsync(Token t, string ws) =>
            (await CallAsync(t, HttpMethod.Get, "/groups/" + ws + "/datasets").ConfigureAwait(false))?["value"] as JsonArray ?? new JsonArray();

        /// <summary>APP mode: an embed token for a report (view or edit) or for create mode on a dataset.</summary>
        public static async Task<string> EmbedTokenAsync(Token t, string ws, string reportId, string datasetId, bool allowEdit)
        {
            var body = new JsonObject
            {
                ["datasets"] = new JsonArray(new JsonObject { ["id"] = datasetId }),
                ["targetWorkspaces"] = new JsonArray(new JsonObject { ["id"] = ws })
            };
            if (!string.IsNullOrEmpty(reportId)) body["reports"] = new JsonArray(new JsonObject { ["id"] = reportId, ["allowEdit"] = allowEdit });
            var r = await CallAsync(t, HttpMethod.Post, "/GenerateToken", body.ToJsonString()).ConfigureAwait(false);
            return r?["token"]?.GetValue<string>();
        }

        // ------------------------------------------------------------------ definitions
        public class ColumnDef { public string Name; public string DataType; }
        public class MeasureDef { public string Name; public string Expression; public string FormatString; }
        public class TableDef { public string Name; public string Sql; public int MaxRows = 200000; public List<ColumnDef> Columns = new List<ColumnDef>(); public List<MeasureDef> Measures = new List<MeasureDef>(); }
        public class RelDef { public string Name, FromTable, FromColumn, ToTable, ToColumn, CrossFilteringBehavior; }
        public class DatasetDef { public string Key, Name; public List<TableDef> Tables = new List<TableDef>(); public List<RelDef> Relationships = new List<RelDef>(); }

        private static readonly JsonSerializerOptions _json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, IncludeFields = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        public static DatasetDef ParseDef(string json)
        {
            var d = JsonSerializer.Deserialize<DatasetDef>(json, _json) ?? throw new InvalidOperationException("Empty definition");
            if (string.IsNullOrWhiteSpace(d.Name)) throw new InvalidOperationException("The dataset needs a name");
            if (d.Tables.Count == 0) throw new InvalidOperationException("The dataset needs at least one table");
            foreach (var t in d.Tables)
            {
                if (string.IsNullOrWhiteSpace(t.Name) || string.IsNullOrWhiteSpace(t.Sql)) throw new InvalidOperationException("Every table needs a name and a SQL query");
                if (t.Columns.Count == 0) throw new InvalidOperationException("Table " + t.Name + " has no columns - click Detect columns");
            }
            return d;
        }
        private static readonly HashSet<string> TYPES = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Int64", "Double", "Boolean", "DateTime", "String" };
        private static string PbiType(string t) => TYPES.Contains(t ?? "") ? TYPES.First(x => string.Equals(x, t, StringComparison.OrdinalIgnoreCase)) : "String";

        private static JsonObject TableSchema(TableDef t) => new JsonObject
        {
            ["name"] = t.Name,
            ["columns"] = new JsonArray(t.Columns.Select(c => (JsonNode)new JsonObject { ["name"] = c.Name, ["dataType"] = PbiType(c.DataType) }).ToArray()),
            ["measures"] = new JsonArray(t.Measures.Where(m => !string.IsNullOrWhiteSpace(m.Name) && !string.IsNullOrWhiteSpace(m.Expression))
                .Select(m =>
                {
                    var o = new JsonObject { ["name"] = m.Name, ["expression"] = m.Expression };
                    if (!string.IsNullOrWhiteSpace(m.FormatString)) o["formatString"] = m.FormatString;
                    return (JsonNode)o;
                }).ToArray())
        };
        public static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s ?? ""))).Substring(0, 32);
        public static string SchemaHash(DatasetDef d) => Hash(new JsonArray(d.Tables.Select(t => (JsonNode)TableSchema(t)).ToArray()).ToJsonString());
        public static string RelHash(DatasetDef d) => Hash(JsonSerializer.Serialize(d.Relationships.Select(r => new[] { r.FromTable, r.FromColumn, r.ToTable, r.ToColumn, r.CrossFilteringBehavior })));

        /// <summary>
        /// Creates the push dataset, or updates its tables when only columns / measures changed. Relationships
        /// cannot be changed on an existing push dataset - then recreate=true deletes and creates it again
        /// (reports on the old one must be rebound).
        /// </summary>
        public static async Task<(string DatasetId, string Note)> PublishAsync(Token t, string ws, DatasetDef d, string existingId, bool relationshipsChanged, bool recreate)
        {
            if (!string.IsNullOrEmpty(existingId))
            {
                bool exists = true;
                try { await CallAsync(t, HttpMethod.Get, "/groups/" + ws + "/datasets/" + existingId).ConfigureAwait(false); }
                catch (PbiException e) when (e.Status == 404) { exists = false; }
                if (exists && relationshipsChanged && !recreate)
                    throw new InvalidOperationException("Relationships changed. Power BI cannot change the relationships of an existing push dataset - use Recreate (reports built on it must then be pointed at the new dataset).");
                if (exists && !recreate)
                {
                    foreach (var tb in d.Tables)
                        await CallAsync(t, HttpMethod.Put, "/groups/" + ws + "/datasets/" + existingId + "/tables/" + Uri.EscapeDataString(tb.Name), TableSchema(tb).ToJsonString()).ConfigureAwait(false);
                    return (existingId, "Tables updated");
                }
                if (exists && recreate) await CallAsync(t, HttpMethod.Delete, "/groups/" + ws + "/datasets/" + existingId).ConfigureAwait(false);
            }
            var body = new JsonObject
            {
                ["name"] = d.Name,
                ["defaultMode"] = "Push",
                ["tables"] = new JsonArray(d.Tables.Select(tb => (JsonNode)TableSchema(tb)).ToArray()),
                ["relationships"] = new JsonArray(d.Relationships.Where(r => !string.IsNullOrWhiteSpace(r.FromTable) && !string.IsNullOrWhiteSpace(r.ToTable)).Select(r => (JsonNode)new JsonObject
                {
                    ["name"] = string.IsNullOrWhiteSpace(r.Name) ? r.FromTable + "_" + r.ToTable : r.Name,
                    ["fromTable"] = r.FromTable, ["fromColumn"] = r.FromColumn, ["toTable"] = r.ToTable, ["toColumn"] = r.ToColumn,
                    ["crossFilteringBehavior"] = string.IsNullOrWhiteSpace(r.CrossFilteringBehavior) ? "OneDirection" : r.CrossFilteringBehavior
                }).ToArray())
            };
            var created = await CallAsync(t, HttpMethod.Post, "/groups/" + ws + "/datasets?defaultRetentionPolicy=None", body.ToJsonString()).ConfigureAwait(false);
            return (created?["id"]?.GetValue<string>(), recreate ? "Dataset recreated" : "Dataset created");
        }

        // ------------------------------------------------------------------ APEX reads
        private const string APEX_QUERY = "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/executequery";
        private const int APEX_PAGE = 1000;

        public static async Task<(List<string> Cols, List<JsonElement[]> Rows)> ApexPageAsync(string sql, string user, CancellationToken ct = default)
        {
            var body = JsonSerializer.Serialize(new { sql, maxRows = APEX_PAGE, appUser = user });
            using var resp = await _http.PostAsync(APEX_QUERY, new StringContent(body, Encoding.UTF8, "application/json"), ct).ConfigureAwait(false);
            string txt = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(txt);
            var root = doc.RootElement;
            if (root.TryGetProperty("success", out var s) && s.ValueKind == JsonValueKind.False)
                throw new InvalidOperationException("APEX: " + (root.TryGetProperty("error", out var e) ? e.GetString() : "query failed"));
            var cols = new List<string>();
            if (root.TryGetProperty("columns", out var c) && c.ValueKind == JsonValueKind.Array)
                foreach (var x in c.EnumerateArray()) cols.Add(x.ValueKind == JsonValueKind.Object && x.TryGetProperty("name", out var n) ? n.GetString() : x.ToString());
            var rows = new List<JsonElement[]>();
            if (root.TryGetProperty("rows", out var r) && r.ValueKind == JsonValueKind.Array)
                foreach (var row in r.EnumerateArray())
                {
                    if (row.ValueKind == JsonValueKind.Array) rows.Add(row.EnumerateArray().Select(v => v.Clone()).ToArray());
                    else if (row.ValueKind == JsonValueKind.Object)
                        rows.Add(cols.Select(k => row.TryGetProperty(k, out var v) ? v.Clone() : row.TryGetProperty(k.ToUpperInvariant(), out var v2) ? v2.Clone() : default).ToArray());
                }
            return (cols, rows);
        }

        /// <summary>First rows of a query and a guessed Power BI type per column (Detect columns).</summary>
        public static async Task<List<ColumnDef>> DetectColumnsAsync(string sql, string user)
        {
            var (cols, rows) = await ApexPageAsync("SELECT * FROM (" + sql.Trim().TrimEnd(';') + ") WHERE ROWNUM <= 200", user).ConfigureAwait(false);
            var list = new List<ColumnDef>();
            for (int i = 0; i < cols.Count; i++)
            {
                var vals = rows.Select(r => i < r.Length ? r[i] : default).Where(v => v.ValueKind != JsonValueKind.Undefined && v.ValueKind != JsonValueKind.Null).ToList();
                string type = "String";
                if (vals.Count > 0 && vals.All(v => v.ValueKind == JsonValueKind.Number))
                    type = vals.All(v => v.TryGetInt64(out _)) ? "Int64" : "Double";
                else if (vals.Count > 0 && vals.All(v => v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)) type = "Boolean";
                else if (vals.Count > 0 && vals.All(v => v.ValueKind == JsonValueKind.String && IsoDate(v.GetString()))) type = "DateTime";
                list.Add(new ColumnDef { Name = cols[i], DataType = type });
            }
            return list;
        }
        private static bool IsoDate(string s) =>
            s != null && s.Length >= 10 && char.IsDigit(s[0]) && s[4] == '-' && s[7] == '-' &&
            DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out _);

        private static JsonNode Value(JsonElement v, string type)
        {
            if (v.ValueKind == JsonValueKind.Undefined || v.ValueKind == JsonValueKind.Null) return null;
            string s = v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText();
            switch (PbiType(type))
            {
                case "Int64":
                    if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var l)) return l;
                    return long.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var l2) ? l2 :
                           double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var d2) ? (JsonNode)(long)Math.Round(d2) : null;
                case "Double":
                    if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
                    return double.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
                case "Boolean":
                    if (v.ValueKind == JsonValueKind.True) return true;
                    if (v.ValueKind == JsonValueKind.False) return false;
                    return s != null && (s == "1" || s.Equals("Y", StringComparison.OrdinalIgnoreCase) || s.Equals("YES", StringComparison.OrdinalIgnoreCase) || s.Equals("TRUE", StringComparison.OrdinalIgnoreCase));
                case "DateTime":
                    return DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt) ? dt.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) : null;
                default:
                    return s != null && s.Length > 4000 ? s.Substring(0, 4000) : s;
            }
        }

        // ------------------------------------------------------------------ refresh
        public class RefreshResult { public long TotalRows; public List<string> PerTable = new List<string>(); public string Error; }

        /// <summary>
        /// Reloads every table: reads the APEX SQL in 1,000-row pages (up to the table's MaxRows), clears the
        /// Power BI table, posts the rows in batches of 5,000. progress(text) reports as it goes.
        /// </summary>
        public static async Task<RefreshResult> RefreshAsync(Token t, string ws, string datasetId, DatasetDef d, string user, Action<string> progress, CancellationToken ct = default)
        {
            var res = new RefreshResult();
            foreach (var tb in d.Tables)
            {
                progress?.Invoke("Reading " + tb.Name + " from APEX…");
                string baseSql = tb.Sql.Trim().TrimEnd(';');
                int max = Math.Max(1, Math.Min(tb.MaxRows <= 0 ? 200000 : tb.MaxRows, 2000000));
                var colIndex = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                var batch = new JsonArray();
                long tableRows = 0;
                bool cleared = false;

                async Task Flush()
                {
                    if (!cleared)
                    {
                        await CallAsync(t, HttpMethod.Delete, "/groups/" + ws + "/datasets/" + datasetId + "/tables/" + Uri.EscapeDataString(tb.Name) + "/rows", null, ct).ConfigureAwait(false);
                        cleared = true;
                    }
                    if (batch.Count == 0) return;
                    var body = new JsonObject { ["rows"] = batch };
                    await CallAsync(t, HttpMethod.Post, "/groups/" + ws + "/datasets/" + datasetId + "/tables/" + Uri.EscapeDataString(tb.Name) + "/rows", body.ToJsonString(), ct).ConfigureAwait(false);
                    batch = new JsonArray();
                }

                for (int from = 1; from <= max; from += APEX_PAGE)
                {
                    ct.ThrowIfCancellationRequested();
                    string q = "SELECT * FROM (SELECT q__.*, ROWNUM AS rn__ FROM (" + baseSql + ") q__) WHERE rn__ BETWEEN " + from + " AND " + Math.Min(max, from + APEX_PAGE - 1);
                    var (cols, rows) = await ApexPageAsync(q, user, ct).ConfigureAwait(false);
                    if (colIndex.Count == 0) for (int i = 0; i < cols.Count; i++) colIndex[cols[i]] = i;
                    foreach (var r in rows)
                    {
                        var o = new JsonObject();
                        foreach (var c in tb.Columns)
                            if (colIndex.TryGetValue(c.Name, out int ix) && ix < r.Length) o[c.Name] = Value(r[ix], c.DataType);
                        batch.Add(o);
                        tableRows++;
                        if (batch.Count >= 5000) { await Flush().ConfigureAwait(false); progress?.Invoke(tb.Name + ": " + tableRows.ToString("N0") + " rows sent…"); }
                    }
                    if (rows.Count < APEX_PAGE) break;
                }
                await Flush().ConfigureAwait(false);
                res.TotalRows += tableRows;
                res.PerTable.Add(tb.Name + " " + tableRows.ToString("N0") + (tableRows >= max ? " (limit)" : ""));
                progress?.Invoke(tb.Name + ": " + tableRows.ToString("N0") + " rows ✓");
            }
            return res;
        }

        // ------------------------------------------------------------------ APEX tables
        private static Task _ensure;
        public static Task EnsureTablesAsync(string user)
        {
            lock (typeof(PowerBiService))
            {
                if (_ensure == null || _ensure.IsFaulted) _ensure = EnsureCoreAsync(user);
                return _ensure;
            }
        }
        private static async Task EnsureCoreAsync(string user)
        {
            var have = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in await AiControl.QueryAsync("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_PBI_DATASETS','WMS_PBI_REFRESH_LOG')", user).ConfigureAwait(false))
                have.Add(r["TABLE_NAME"]);
            if (!have.Contains("WMS_PBI_DATASETS"))
                await AiControl.WriteAsync("CREATE TABLE wms_pbi_datasets (dataset_key VARCHAR2(60) PRIMARY KEY, name VARCHAR2(200) NOT NULL, definition_json CLOB, workspace_id VARCHAR2(60), pbi_dataset_id VARCHAR2(60), schema_hash VARCHAR2(64), rel_hash VARCHAR2(64), schedule_mode VARCHAR2(20) DEFAULT 'MANUAL', schedule_time VARCHAR2(5), last_refresh DATE, last_status VARCHAR2(20), last_rows NUMBER, last_error VARCHAR2(4000), lock_by VARCHAR2(100), lock_at DATE, created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(100), updated_date DATE DEFAULT SYSDATE)", user).ConfigureAwait(false);
            if (!have.Contains("WMS_PBI_REFRESH_LOG"))
            {
                await AiControl.WriteAsync("CREATE TABLE wms_pbi_refresh_log (log_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, dataset_key VARCHAR2(60), started_at DATE DEFAULT SYSDATE, finished_at DATE, run_by VARCHAR2(100), machine VARCHAR2(100), trigger_type VARCHAR2(20), status VARCHAR2(20), total_rows NUMBER, detail VARCHAR2(4000), error_text VARCHAR2(4000))", user).ConfigureAwait(false);
                try { await AiControl.WriteAsync("CREATE INDEX wms_pbi_refresh_log_n1 ON wms_pbi_refresh_log (dataset_key, started_at)", user).ConfigureAwait(false); } catch { }
            }
        }

        /// <summary>Loads a stored definition (CLOB read in 1,300-char pieces - the read gateway has no DBMS_LOB).</summary>
        public static async Task<(string Json, Dictionary<string, string> Row)> LoadDefinitionAsync(string key, string user)
        {
            await EnsureTablesAsync(user).ConfigureAwait(false);
            var rows = await AiControl.QueryAsync("SELECT dataset_key, name, workspace_id, pbi_dataset_id, schema_hash, rel_hash, schedule_mode, schedule_time, " +
                "TO_CHAR(last_refresh, 'YYYY-MM-DD HH24:MI:SS') AS last_refresh, NVL(LENGTH(definition_json), 0) AS len FROM wms_pbi_datasets WHERE dataset_key = " + AiControl.Lit(key, 60), user).ConfigureAwait(false);
            if (rows.Count == 0) throw new InvalidOperationException("Dataset definition " + key + " not found");
            int len = int.Parse(rows[0]["LEN"] ?? "0");
            var sb = new StringBuilder();
            for (int from = 1; from <= len; from += 1300 * 9)
            {
                var cols = string.Join(", ", Enumerable.Range(0, 9).Select(i => "TO_CHAR(SUBSTR(definition_json, " + (from + i * 1300) + ", 1300)) AS p" + i));
                var part = await AiControl.QueryAsync("SELECT " + cols + " FROM wms_pbi_datasets WHERE dataset_key = " + AiControl.Lit(key, 60), user).ConfigureAwait(false);
                if (part.Count > 0) for (int i = 0; i < 9; i++) sb.Append(part[0].GetValueOrDefault("P" + i) ?? "");
            }
            return (sb.ToString(), rows[0]);
        }

        public static async Task SaveStateAsync(string key, string user, string sqlSet)
        {
            await AiControl.WriteAsync("UPDATE wms_pbi_datasets SET " + sqlSet + ", updated_by = " + AiControl.Lit(user, 100) + ", updated_date = SYSDATE WHERE dataset_key = " + AiControl.Lit(key, 60), user).ConfigureAwait(false);
        }

        /// <summary>Full refresh of one stored dataset, logged in WMS_PBI_REFRESH_LOG and the AI audit.</summary>
        public static async Task<RefreshResult> RefreshStoredAsync(string key, string user, string trigger, Action<string> progress, CancellationToken ct = default)
        {
            var cfg = await ConfigAsync(user).ConfigureAwait(false);
            var tok = await TokenSilentAsync(cfg).ConfigureAwait(false) ?? throw new InvalidOperationException("Not signed in to Power BI on this PC.");
            var (json, row) = await LoadDefinitionAsync(key, user).ConfigureAwait(false);
            string ws = row.GetValueOrDefault("WORKSPACE_ID"), id = row.GetValueOrDefault("PBI_DATASET_ID");
            if (string.IsNullOrEmpty(ws) || string.IsNullOrEmpty(id)) throw new InvalidOperationException("Publish the dataset to Power BI first.");
            var def = ParseDef(json);
            var started = DateTime.Now;
            await SaveStateAsync(key, user, "last_status = 'RUNNING', lock_by = " + AiControl.Lit(Environment.MachineName, 100) + ", lock_at = SYSDATE").ConfigureAwait(false);
            RefreshResult res;
            try
            {
                res = await RefreshAsync(tok, ws, id, def, user, progress, ct).ConfigureAwait(false);
                await SaveStateAsync(key, user, "last_status = 'OK', last_refresh = SYSDATE, last_rows = " + res.TotalRows + ", last_error = NULL, lock_by = NULL, lock_at = NULL").ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                res = new RefreshResult { Error = ex.Message };
                try { await SaveStateAsync(key, user, "last_status = 'FAILED', last_error = " + AiControl.Lit(ex.Message, 4000) + ", lock_by = NULL, lock_at = NULL").ConfigureAwait(false); } catch { }
            }
            try
            {
                await AiControl.WriteAsync("INSERT INTO wms_pbi_refresh_log (dataset_key, started_at, finished_at, run_by, machine, trigger_type, status, total_rows, detail, error_text) VALUES (" +
                    string.Join(", ", AiControl.Lit(key, 60), "TO_DATE('" + started.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "', 'YYYY-MM-DD HH24:MI:SS')", "SYSDATE",
                        AiControl.Lit(user, 100), AiControl.Lit(Environment.MachineName, 100), AiControl.Lit(trigger, 20), res.Error == null ? "'OK'" : "'FAILED'",
                        res.TotalRows.ToString(CultureInfo.InvariantCulture), AiControl.Lit(string.Join(" · ", res.PerTable), 4000), AiControl.Lit(res.Error, 4000)) + ")", user).ConfigureAwait(false);
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[PowerBI] log: " + ex.Message); }
            AiControl.Audit(new AiControl.AuditEvent
            {
                User = user, Source = "POWERBI", Action = "dataset_refresh", Outcome = res.Error == null ? "OK" : "FAILED", Ref = key, Target = def.Name,
                Detail = res.Error ?? (res.TotalRows + " rows: " + string.Join(", ", res.PerTable)), DurationMs = (long)(DateTime.Now - started).TotalMilliseconds
            });
            return res;
        }

        // ------------------------------------------------------------------ schedule
        private static System.Threading.Timer _timer;
        private static int _running;

        /// <summary>
        /// Every 10 minutes: refresh datasets whose schedule is due. Any PC with a Power BI sign-in may run it;
        /// a 45-minute lease in WMS_PBI_DATASETS (lock_by / lock_at) makes sure only one PC does.
        /// </summary>
        public static void StartScheduler()
        {
            if (_timer != null) return;
            _timer = new System.Threading.Timer(_ => { _ = TickAsync(); }, null, TimeSpan.FromMinutes(3), TimeSpan.FromMinutes(10));
        }
        private static async Task TickAsync()
        {
            if (Interlocked.CompareExchange(ref _running, 1, 0) != 0) return;
            try
            {
                string user = Environment.UserName;
                var cfg = await ConfigAsync(user).ConfigureAwait(false);
                if (!Ready(cfg) || string.IsNullOrWhiteSpace(cfg.WorkspaceId)) return;
                var tok = await TokenSilentAsync(cfg).ConfigureAwait(false);
                if (tok == null) return;                                  // nobody signed in on this PC
                await EnsureTablesAsync(user).ConfigureAwait(false);
                var due = await AiControl.QueryAsync("SELECT dataset_key, schedule_mode, schedule_time, TO_CHAR(last_refresh, 'YYYY-MM-DD HH24:MI:SS') AS last_refresh FROM wms_pbi_datasets " +
                    "WHERE schedule_mode IN ('DAILY', 'HOURLY') AND pbi_dataset_id IS NOT NULL AND (lock_at IS NULL OR lock_at < SYSDATE - 45/1440)", user).ConfigureAwait(false);
                foreach (var r in due)
                {
                    DateTime? last = DateTime.TryParse(r.GetValueOrDefault("LAST_REFRESH"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var lr) ? lr : (DateTime?)null;
                    bool isDue;
                    if (r["SCHEDULE_MODE"] == "HOURLY") isDue = last == null || DateTime.Now - last.Value >= TimeSpan.FromMinutes(55);
                    else
                    {
                        var at = TimeSpan.TryParse(r.GetValueOrDefault("SCHEDULE_TIME") ?? "06:00", CultureInfo.InvariantCulture, out var ts) ? ts : new TimeSpan(6, 0, 0);
                        var slot = DateTime.Today + at;
                        isDue = DateTime.Now >= slot && (last == null || last.Value < slot);
                    }
                    if (!isDue) continue;
                    string key = r["DATASET_KEY"];
                    // take the lease; only the PC that wins it refreshes
                    await AiControl.WriteAsync("UPDATE wms_pbi_datasets SET lock_by = " + AiControl.Lit(Environment.MachineName, 100) + ", lock_at = SYSDATE WHERE dataset_key = " + AiControl.Lit(key, 60) +
                        " AND (lock_at IS NULL OR lock_at < SYSDATE - 45/1440)", user).ConfigureAwait(false);
                    var own = await AiControl.QueryAsync("SELECT lock_by FROM wms_pbi_datasets WHERE dataset_key = " + AiControl.Lit(key, 60), user).ConfigureAwait(false);
                    if (own.Count == 0 || !string.Equals(own[0]["LOCK_BY"], Environment.MachineName, StringComparison.OrdinalIgnoreCase)) continue;
                    await RefreshStoredAsync(key, user, "SCHEDULE", null).ConfigureAwait(false);
                }
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[PowerBI] scheduler: " + ex.Message); }
            finally { Interlocked.Exchange(ref _running, 0); }
        }
    }
}

using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace FusionModel
{
    /// <summary>One page of rows from a source (column name → value; values are strings, numbers, bools or null).</summary>
    public sealed class RowPage
    {
        public List<Dictionary<string, object>> Rows { get; } = new();
    }

    /// <summary>What to read: the table, and for partial loads the watermark / window start / resume point.</summary>
    public sealed class ReadRequest
    {
        public TableDef Table { get; set; }
        /// <summary>Incremental: only rows with IncrementalColumn ≥ watermark − overlap.</summary>
        public string Watermark { get; set; }
        /// <summary>Window: only rows with WindowColumn ≥ this date.</summary>
        public DateTime? WindowStart { get; set; }
        /// <summary>Keyset paging: continue after this key (a previous run stopped here).</summary>
        public string ResumeAfterKey { get; set; }
        /// <summary>Called after every page with the last key read (keyset paging) - the checkpoint.</summary>
        public Action<string> OnKey { get; set; }
        /// <summary>Retries and page-size changes, for the refresh log.</summary>
        public Action<string> Note { get; set; }
    }

    /// <summary>A place rows come from. The builder stages the rows in DuckDB.</summary>
    public interface ISource
    {
        string Kind { get; }
        IAsyncEnumerable<RowPage> ReadAsync(ReadRequest request, CancellationToken ct);
        /// <summary>COUNT(*) of what ReadAsync would return, or null when the source cannot count.</summary>
        Task<long?> CountAsync(ReadRequest request, CancellationToken ct);
    }

    /// <summary>Oracle SQL wrappers shared by APEX and Fusion: filters, keyset and ROWNUM paging, counts.</summary>
    public static class OracleSql
    {
        public const string RowNumColumn = "RN__";

        /// <summary>A column as Oracle knows it: plain names (trip_id, TRIP_ID) are upper-case; a mixed-case alias ("TripId") is kept as typed.</summary>
        public static string Col(string name)
        {
            name = (name ?? "").Trim().Trim('"');
            bool plain = name == name.ToUpperInvariant() || name == name.ToLowerInvariant();
            return Names.Q(plain ? name.ToUpperInvariant() : name);
        }

        public static string Incremental(string sql, TableDef t, string watermark) => Filtered(sql, t, watermark, null);

        /// <summary>The source SQL with the incremental and/or window filter applied.</summary>
        public static string Filtered(string sql, TableDef t, string watermark, DateTime? windowStart)
        {
            var where = new List<string>();
            if (!string.IsNullOrEmpty(watermark) && !string.IsNullOrWhiteSpace(t.IncrementalColumn))
            {
                string col = Col(t.IncrementalColumn);
                if (DateTime.TryParse(watermark, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
                {
                    dt = dt.AddMinutes(-Math.Max(0, t.OverlapMinutes));
                    where.Add(col + " >= TO_DATE('" + dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "', 'YYYY-MM-DD HH24:MI:SS')");
                }
                else if (decimal.TryParse(watermark, NumberStyles.Float, CultureInfo.InvariantCulture, out var n))
                    where.Add(col + " >= " + n.ToString(CultureInfo.InvariantCulture));
                else where.Add(col + " >= " + Names.Lit(watermark));
            }
            if (windowStart != null && !string.IsNullOrWhiteSpace(t.WindowColumn))
                where.Add(Col(t.WindowColumn) + " >= TO_DATE('" + windowStart.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "', 'YYYY-MM-DD')");
            return where.Count == 0 ? sql : "SELECT * FROM (\n" + sql + "\n) WHERE " + string.Join(" AND ", where);
        }

        /// <summary>Rows lo+1 … hi of the (ordered) statement. The line breaks keep a trailing -- comment from eating the parenthesis.</summary>
        public static string Page(string sql, IList<string> orderBy, long lo, long hi)
        {
            string ordered = orderBy != null && orderBy.Count > 0
                ? "SELECT * FROM (\n" + sql + "\n) ORDER BY " + string.Join(", ", orderBy.Select(Col))
                : sql;
            return "SELECT * FROM (SELECT q__.*, ROWNUM AS " + RowNumColumn + " FROM (\n" + ordered + "\n) q__ WHERE ROWNUM <= " + hi + ") WHERE " + RowNumColumn + " > " + lo;
        }

        /// <summary>
        /// The next <paramref name="n"/> rows after <paramref name="afterKey"/> by one key column. Each page is a range scan
        /// on the key, so page 500 costs the same as page 1 (ROWNUM paging re-reads every earlier row).
        /// </summary>
        public static string Keyset(string sql, string key, string afterKey, int n)
        {
            string k = Col(key);
            string inner = "SELECT * FROM (\n" + sql + "\n)" + (afterKey == null ? "" : " WHERE " + k + " > " + KeyLiteral(afterKey)) + " ORDER BY " + k;
            return "SELECT * FROM (" + inner + ") WHERE ROWNUM <= " + n;
        }

        public static string Count(string sql) => "SELECT COUNT(*) AS N__ FROM (\n" + sql + "\n)";

        /// <summary>Keys are carried as "n:123" (number) or "s:ABC" (text) so the next page compares with the right type.</summary>
        public static string KeyToken(object v) => v switch
        {
            null => null,
            long or int or short or double or decimal or float => "n:" + Convert.ToString(v, CultureInfo.InvariantCulture),
            _ => "s:" + v
        };

        public static string KeyLiteral(string token) =>
            token.StartsWith("n:", StringComparison.Ordinal) ? token.Substring(2) : Names.Lit(token.StartsWith("s:", StringComparison.Ordinal) ? token.Substring(2) : token);

        public static object ValueOf(Dictionary<string, object> row, string column)
        {
            foreach (var kv in row) if (string.Equals(kv.Key, column.Trim('"'), StringComparison.OrdinalIgnoreCase)) return kv.Value;
            return null;
        }

        public static void DropRowNum(Dictionary<string, object> row)
        {
            foreach (var k in row.Keys.Where(k => string.Equals(k, RowNumColumn, StringComparison.OrdinalIgnoreCase)).ToList()) row.Remove(k);
        }
    }

    /// <summary>
    /// Pages through an Oracle source (keyset when the table has one key column, otherwise ROWNUM), retries failed pages
    /// with back-off, halves the page after a timeout, and reports the last key after every page (the checkpoint).
    /// </summary>
    public sealed class OraclePager
    {
        public delegate Task<List<Dictionary<string, object>>> Runner(string sql, int maxRows, CancellationToken ct);

        public int DefaultPage { get; set; } = 1000;
        public int MaxPage { get; set; } = 1000;
        public int MinPage { get; set; } = 100;
        public int Retries { get; set; } = 3;
        public TimeSpan Backoff { get; set; } = TimeSpan.FromSeconds(2);

        public async IAsyncEnumerable<RowPage> ReadAsync(Runner run, ReadRequest req, [EnumeratorCancellation] CancellationToken ct)
        {
            var t = req.Table;
            string sql = OracleSql.Filtered((t.Source.Sql ?? "").Trim().TrimEnd(';'), t, req.Watermark, req.WindowStart);
            int size = Math.Clamp(t.PageSize > 0 ? t.PageSize : DefaultPage, 1, MaxPage);
            if (t.UsesKeyset)
            {
                string key = t.Key[0], last = req.ResumeAfterKey;
                while (true)
                {
                    ct.ThrowIfCancellationRequested();
                    string after = last;
                    var (rows, used) = await RunWithRetry(run, n => OracleSql.Keyset(sql, key, after, n), size, req, ct).ConfigureAwait(false);
                    size = used;
                    if (rows.Count == 0) yield break;
                    var page = ToPage(rows);
                    string next = OracleSql.KeyToken(OracleSql.ValueOf(page.Rows[^1], key));
                    if (next == null) throw new InvalidOperationException("Key column " + key + " is empty in the source rows - keyset paging needs a non-null key (set Paging to rownum).");
                    if (next == last) throw new InvalidOperationException("Key column " + key + " is not unique - keyset paging stalled at " + next + " (set Paging to rownum or use a unique key).");
                    last = next;
                    yield return page;
                    req.OnKey?.Invoke(last);
                    if (rows.Count < used) yield break;
                }
            }
            for (long lo = 0; ; )
            {
                ct.ThrowIfCancellationRequested();
                long from = lo;
                var (rows, used) = await RunWithRetry(run, n => OracleSql.Page(sql, t.Key, from, from + n), size, req, ct).ConfigureAwait(false);
                size = used;
                if (rows.Count > 0) yield return ToPage(rows);
                if (rows.Count < used) yield break;
                lo += rows.Count;
            }
        }

        public async Task<long?> CountAsync(Runner run, ReadRequest req, CancellationToken ct)
        {
            var t = req.Table;
            string sql = OracleSql.Filtered((t.Source.Sql ?? "").Trim().TrimEnd(';'), t, req.Watermark, req.WindowStart);
            var (rows, _) = await RunWithRetry(run, _ => OracleSql.Count(sql), 1, req, ct).ConfigureAwait(false);
            var v = rows.Count > 0 ? rows[0].Values.FirstOrDefault(x => x != null) : null;
            return v == null ? null : Convert.ToInt64(v is string s ? decimal.Parse(s, CultureInfo.InvariantCulture) : v, CultureInfo.InvariantCulture);
        }

        private async Task<(List<Dictionary<string, object>> Rows, int Size)> RunWithRetry(Runner run, Func<int, string> sqlFor, int size, ReadRequest req, CancellationToken ct)
        {
            for (int attempt = 0; ; attempt++)
            {
                try { return (await run(sqlFor(size), size, ct).ConfigureAwait(false) ?? new(), size); }
                catch (Exception ex) when (attempt < Retries && !ct.IsCancellationRequested)
                {
                    bool timeout = ex is TaskCanceledException || ex is TimeoutException || ex.Message.Contains("timed out", StringComparison.OrdinalIgnoreCase)
                                   || ex.Message.Contains("timeout", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("ORA-01013");
                    if (timeout && size > MinPage) size = Math.Max(MinPage, size / 2);
                    req.Note?.Invoke($"retry {attempt + 1}/{Retries} after: {Short(ex.Message)}{(timeout ? " (page now " + size + " rows)" : "")}");
                    if (Backoff > TimeSpan.Zero) await Task.Delay(TimeSpan.FromMilliseconds(Backoff.TotalMilliseconds * Math.Pow(2, attempt)), ct).ConfigureAwait(false);
                }
            }
        }

        private static RowPage ToPage(List<Dictionary<string, object>> rows)
        {
            var page = new RowPage();
            foreach (var r in rows)
            {
                var row = new Dictionary<string, object>(r, StringComparer.Ordinal);
                OracleSql.DropRowNum(row);
                page.Rows.Add(row);
            }
            return page;
        }

        private static string Short(string s) => s == null ? "" : s.Length > 160 ? s.Substring(0, 160) + "…" : s;
    }

    /// <summary>
    /// APEX tables through the app's read gateway (POST ai/executequery {sql, maxRows} → {columns, rows}).
    /// The gateway returns at most 1,000 rows per call and refuses DBMS_/UTL_ and words like UPDATE/DELETE.
    /// </summary>
    public sealed class ApexSource : ISource
    {
        private readonly HttpClient _http;
        private readonly string _queryUrl;
        private readonly string _appUser;
        public string Kind => "apex";
        public OraclePager Pager { get; } = new OraclePager { DefaultPage = 1000, MaxPage = 1000 };
        public int DefaultPageSize { get => Pager.DefaultPage; set => Pager.DefaultPage = value; }

        public ApexSource(HttpClient http, string queryUrl, string appUser = "FUSION_MODEL")
        {
            _http = http; _queryUrl = queryUrl; _appUser = appUser;
        }

        public IAsyncEnumerable<RowPage> ReadAsync(ReadRequest request, CancellationToken ct) =>
            Pager.ReadAsync(async (sql, max, c) => (await QueryAsync(sql, max, c).ConfigureAwait(false)).Rows, request, ct);

        public Task<long?> CountAsync(ReadRequest request, CancellationToken ct) =>
            Pager.CountAsync(async (sql, max, c) => (await QueryAsync(sql, max, c).ConfigureAwait(false)).Rows, request, ct);

        public async Task<RowPage> QueryAsync(string sql, int maxRows, CancellationToken ct)
        {
            var body = JsonSerializer.Serialize(new { sql, maxRows, appUser = _appUser });
            using var resp = await _http.PostAsync(_queryUrl, new StringContent(body, Encoding.UTF8, "application/json"), ct).ConfigureAwait(false);
            string text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) throw new InvalidOperationException("APEX HTTP " + (int)resp.StatusCode + ": " + Trim(text));
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (root.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.False)
                throw new InvalidOperationException("APEX: " + (root.TryGetProperty("error", out var e) ? e.ToString() : "query failed"));
            var page = new RowPage();
            var cols = new List<string>();
            if (root.TryGetProperty("columns", out var c) && c.ValueKind == JsonValueKind.Array)
                foreach (var x in c.EnumerateArray())
                    cols.Add(x.ValueKind == JsonValueKind.Object && x.TryGetProperty("name", out var n) ? n.GetString() : x.ToString());
            if (root.TryGetProperty("rows", out var rows) && rows.ValueKind == JsonValueKind.Array)
                foreach (var r in rows.EnumerateArray())
                {
                    var row = new Dictionary<string, object>(StringComparer.Ordinal);
                    if (r.ValueKind == JsonValueKind.Array)
                    {
                        int i = 0;
                        foreach (var v in r.EnumerateArray()) { if (i < cols.Count) row[cols[i]] = Value(v); i++; }
                    }
                    else if (r.ValueKind == JsonValueKind.Object)
                        foreach (var p in r.EnumerateObject()) row[p.Name] = Value(p.Value);
                    OracleSql.DropRowNum(row);
                    page.Rows.Add(row);
                }
            return page;
        }

        internal static object Value(JsonElement v) => v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.TryGetInt64(out var l) ? l : v.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => v.GetRawText()
        };

        private static string Trim(string s) => s == null ? "" : s.Length > 300 ? s.Substring(0, 300) + "…" : s;
    }

    /// <summary>
    /// Oracle Fusion through the host's Fusion SQL runner (BI Publisher). The engine never holds Fusion credentials:
    /// the host passes a function that runs one SELECT with a row cap.
    /// </summary>
    public sealed class FusionSource : ISource
    {
        public delegate Task<(bool Ok, string Error, List<Dictionary<string, object>> Rows)> Runner(string sql, int maxRows, CancellationToken ct);
        private readonly Runner _run;
        public string Kind { get; }
        public OraclePager Pager { get; } = new OraclePager { DefaultPage = 5000, MaxPage = 50000 };
        public int DefaultPageSize { get => Pager.DefaultPage; set => Pager.DefaultPage = value; }

        /// <param name="kind">"fusion", or "fusion:POD" for a second pod (phase 5: one source per pod).</param>
        public FusionSource(Runner run, string kind = "fusion") { _run = run; Kind = kind; }

        private async Task<List<Dictionary<string, object>>> Run(string sql, int max, CancellationToken ct)
        {
            var (ok, err, rows) = await _run(sql, max, ct).ConfigureAwait(false);
            if (!ok) throw new InvalidOperationException("Fusion: " + err);
            return rows ?? new();
        }

        public IAsyncEnumerable<RowPage> ReadAsync(ReadRequest request, CancellationToken ct) => Pager.ReadAsync(Run, request, ct);
        public Task<long?> CountAsync(ReadRequest request, CancellationToken ct) => Pager.CountAsync(Run, request, ct);
    }
}

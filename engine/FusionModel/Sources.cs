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

    /// <summary>A place rows come from. Implementations page through the source; the builder stages the rows in DuckDB.</summary>
    public interface ISource
    {
        string Kind { get; }
        /// <param name="watermark">null = full load; otherwise only rows with IncrementalColumn ≥ watermark − overlap.</param>
        IAsyncEnumerable<RowPage> ReadAsync(TableDef table, string watermark, CancellationToken ct);
    }

    /// <summary>Wraps a source SELECT for Oracle (APEX and Fusion): incremental filter, stable order, ROWNUM paging.</summary>
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

        public static string Incremental(string sql, TableDef t, string watermark)
        {
            if (string.IsNullOrEmpty(watermark) || string.IsNullOrWhiteSpace(t.IncrementalColumn)) return sql;
            string col = Col(t.IncrementalColumn);
            if (DateTime.TryParse(watermark, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var dt))
            {
                dt = dt.AddMinutes(-Math.Max(0, t.OverlapMinutes));
                return "SELECT * FROM (\n" + sql + "\n) WHERE " + col + " >= TO_DATE('" + dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "', 'YYYY-MM-DD HH24:MI:SS')";
            }
            if (decimal.TryParse(watermark, NumberStyles.Float, CultureInfo.InvariantCulture, out var n))
                return "SELECT * FROM (\n" + sql + "\n) WHERE " + col + " >= " + n.ToString(CultureInfo.InvariantCulture);
            return "SELECT * FROM (\n" + sql + "\n) WHERE " + col + " >= " + Names.Lit(watermark);
        }

        /// <summary>Rows lo+1 … hi of the (ordered) statement. The line breaks keep a trailing -- comment from eating the parenthesis.</summary>
        public static string Page(string sql, IList<string> orderBy, long lo, long hi)
        {
            string ordered = orderBy != null && orderBy.Count > 0
                ? "SELECT * FROM (\n" + sql + "\n) ORDER BY " + string.Join(", ", orderBy.Select(Col))
                : sql;
            return "SELECT * FROM (SELECT q__.*, ROWNUM AS " + RowNumColumn + " FROM (\n" + ordered + "\n) q__ WHERE ROWNUM <= " + hi + ") WHERE " + RowNumColumn + " > " + lo;
        }

        public static void DropRowNum(Dictionary<string, object> row)
        {
            foreach (var k in row.Keys.Where(k => string.Equals(k, RowNumColumn, StringComparison.OrdinalIgnoreCase)).ToList()) row.Remove(k);
        }
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
        public int DefaultPageSize { get; set; } = 1000;

        public ApexSource(HttpClient http, string queryUrl, string appUser = "FUSION_MODEL")
        {
            _http = http; _queryUrl = queryUrl; _appUser = appUser;
        }

        public async IAsyncEnumerable<RowPage> ReadAsync(TableDef table, string watermark, [EnumeratorCancellation] CancellationToken ct)
        {
            int size = Math.Clamp(table.PageSize > 0 ? table.PageSize : DefaultPageSize, 1, 1000);
            string sql = OracleSql.Incremental(table.Source.Sql.Trim().TrimEnd(';'), table, watermark);
            for (long lo = 0; ; lo += size)
            {
                ct.ThrowIfCancellationRequested();
                var page = await QueryAsync(OracleSql.Page(sql, table.Key, lo, lo + size), size, ct).ConfigureAwait(false);
                if (page.Rows.Count > 0) yield return page;
                if (page.Rows.Count < size) yield break;
            }
        }

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
        public string Kind => "fusion";
        public int DefaultPageSize { get; set; } = 5000;

        public FusionSource(Runner run) { _run = run; }

        public async IAsyncEnumerable<RowPage> ReadAsync(TableDef table, string watermark, [EnumeratorCancellation] CancellationToken ct)
        {
            int size = Math.Max(1, table.PageSize > 0 ? table.PageSize : DefaultPageSize);
            string sql = OracleSql.Incremental(table.Source.Sql.Trim().TrimEnd(';'), table, watermark);
            for (long lo = 0; ; lo += size)
            {
                ct.ThrowIfCancellationRequested();
                var (ok, err, rows) = await _run(OracleSql.Page(sql, table.Key, lo, lo + size), size + 1, ct).ConfigureAwait(false);
                if (!ok) throw new InvalidOperationException("Fusion: " + err);
                var page = new RowPage();
                foreach (var r in rows ?? new())
                {
                    var row = new Dictionary<string, object>(StringComparer.Ordinal);
                    foreach (var kv in r) row[kv.Key] = kv.Value;
                    OracleSql.DropRowNum(row);
                    page.Rows.Add(row);
                }
                if (page.Rows.Count > 0) yield return page;
                if (page.Rows.Count < size) yield break;
            }
        }
    }
}

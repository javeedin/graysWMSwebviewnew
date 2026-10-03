using System.Diagnostics;
using System.Text.Json;
using FusionModel.Semantic;

namespace FusionModel
{
    public sealed class ProbeResult
    {
        public string Table { get; set; }
        public bool Ok { get; set; }
        public string Error { get; set; }
        public int SampleRows { get; set; }
        public List<string> Columns { get; set; } = new();
        /// <summary>Declared columns the query did not return (the pack expects them).</summary>
        public List<string> Missing { get; set; } = new();
        public long Ms { get; set; }
    }

    /// <summary>A saved report: a semantic request plus how it is shown (pivot column, chart).</summary>
    public sealed class ReportDef
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Folder { get; set; }
        public SemanticRequest Request { get; set; } = new();
        /// <summary>A grouping column shown across (pivot); null = a flat table.</summary>
        public string Pivot { get; set; }
        public string Chart { get; set; } = "bar";      // table, bar, hbar, line, area, pie, kpi
        public string Description { get; set; }
        public string By { get; set; }
        public DateTime Utc { get; set; }
    }

    public sealed partial class ModelEngine
    {
        /// <summary>
        /// Runs a table's source query for its first rows (no key order, so it is cheap on big tables) and compares the
        /// columns with the declared ones - "does this pack fit this customer's pod?" before anything is loaded.
        /// </summary>
        public async Task<ProbeResult> ProbeTableAsync(TableDef t, CancellationToken ct = default)
        {
            var r = new ProbeResult { Table = t.Module + "." + t.Name };
            var sw = Stopwatch.StartNew();
            try
            {
                if (!_sources.TryGetValue(t.Source?.Kind ?? "", out var src)) throw new InvalidOperationException("No source '" + t.Source?.Kind + "' on this PC.");
                var copy = JsonSerializer.Deserialize<TableDef>(JsonSerializer.Serialize(t, Json.Options), Json.Options)!;
                copy.Key = new(); copy.Paging = "rownum"; copy.PageSize = 100; copy.Strategy = LoadStrategy.Full; copy.CountCheck = false;
                await foreach (var page in src.ReadAsync(new ReadRequest { Table = copy }, ct).WithCancellation(ct))
                {
                    r.SampleRows = page.Rows.Count;
                    var first = page.Rows.FirstOrDefault();
                    if (first != null) r.Columns = first.Keys.Where(k => !string.Equals(k, OracleSql.RowNumColumn, StringComparison.OrdinalIgnoreCase)).ToList();
                    break;
                }
                if (r.Columns.Count > 0)
                    r.Missing = (t.ColumnTypes?.Keys ?? Enumerable.Empty<string>()).Where(c => !r.Columns.Contains(c, StringComparer.OrdinalIgnoreCase)).ToList();
                r.Ok = r.Missing.Count == 0;
                if (!r.Ok) r.Error = "Missing columns: " + string.Join(", ", r.Missing);
            }
            catch (Exception ex) { r.Ok = false; r.Error = ex.Message; }
            r.Ms = sw.ElapsedMilliseconds;
            return r;
        }

        // ── saved reports (reports.json in the shared folder) ───────
        public string ReportsPath => Path.Combine(Root, "reports.json");

        public List<ReportDef> LoadReports()
        {
            var path = SharedReachable ? ReportsPath : Path.Combine(Settings.CacheRoot ?? "", "reports.json");
            return Json.Read<List<ReportDef>>(path) ?? new List<ReportDef>();
        }

        public ReportDef SaveReport(ReportDef r)
        {
            if (string.IsNullOrWhiteSpace(r?.Name)) throw new ArgumentException("A report needs a name.");
            if ((r.Request?.Measures?.Count ?? 0) == 0 && (r.Request?.GroupBy?.Count ?? 0) == 0) throw new ArgumentException("A report needs a measure or a column.");
            var list = LoadReports();
            if (string.IsNullOrWhiteSpace(r.Id)) r.Id = Guid.NewGuid().ToString("N").Substring(0, 12);
            r.Utc = DateTime.UtcNow;
            list.RemoveAll(x => x.Id == r.Id);
            list.Add(r);
            Json.WriteAtomic(ReportsPath, list);
            TryCopyToCache(ReportsPath);
            return r;
        }

        public bool DeleteReport(string id)
        {
            var list = LoadReports();
            int n = list.RemoveAll(x => x.Id == id);
            if (n > 0) { Json.WriteAtomic(ReportsPath, list); TryCopyToCache(ReportsPath); }
            return n > 0;
        }
    }
}

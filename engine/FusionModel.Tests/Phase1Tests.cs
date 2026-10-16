using System.Text.RegularExpressions;
using FusionModel;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>A fake Oracle: answers keyset / ROWNUM / COUNT SQL over an in-memory table, and can fail on purpose.</summary>
    internal sealed class FakeOracle
    {
        public List<Dictionary<string, object>> Table = new();
        public List<string> Sqls = new();
        public int FailTimes;            // next N calls throw
        public string FailMessage = "Timed out after 120 s";
        public int? FailAfterCalls;      // every call after N throws (simulates a load dying half way)

        public Task<List<Dictionary<string, object>>> Run(string sql, int max, CancellationToken ct)
        {
            Sqls.Add(sql);
            if (FailTimes > 0) { FailTimes--; throw new InvalidOperationException(FailMessage); }
            if (FailAfterCalls != null && Sqls.Count > FailAfterCalls) throw new InvalidOperationException("network down");
            IEnumerable<Dictionary<string, object>> rows = Table;
            var date = Regex.Match(sql, @"""(\w+)"" >= TO_DATE\('([\d-]+)");
            if (date.Success) rows = rows.Where(r => string.CompareOrdinal(Convert.ToString(r[date.Groups[1].Value]), date.Groups[2].Value) >= 0);
            if (sql.StartsWith("SELECT COUNT(*)")) return Task.FromResult(new List<Dictionary<string, object>> { new() { ["N__"] = (long)rows.Count() } });
            var after = Regex.Match(sql, @"WHERE ""ID"" > (\d+) ORDER BY");
            if (after.Success) rows = rows.Where(r => Convert.ToInt64(r["ID"]) > long.Parse(after.Groups[1].Value));
            var keyset = Regex.Match(sql, @"WHERE ROWNUM <= (\d+)$");
            var rownum = Regex.Match(sql, @"ROWNUM <= (\d+)\) WHERE RN__ > (\d+)");
            rows = rows.OrderBy(r => Convert.ToInt64(r["ID"]));
            if (rownum.Success) rows = rows.Skip(int.Parse(rownum.Groups[2].Value)).Take(int.Parse(rownum.Groups[1].Value) - int.Parse(rownum.Groups[2].Value));
            else if (keyset.Success) rows = rows.Take(int.Parse(keyset.Groups[1].Value));
            return Task.FromResult(rows.Select(r => new Dictionary<string, object>(r)).ToList());
        }

        public static FakeOracle WithRows(int n) => new()
        {
            Table = Enumerable.Range(1, n).Select(i => new Dictionary<string, object>
            {
                ["ID"] = (long)i, ["AMOUNT"] = i * 1.5, ["ACCOUNTING_DATE"] = new DateTime(2026, 1, 1).AddDays(i % 270).ToString("yyyy-MM-dd")
            }).ToList()
        };
    }

    public sealed class Phase1Tests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fm1_" + Guid.NewGuid().ToString("N"));

        private (ModelEngine e, FakeOracle ora, FusionSource src) Setup(int rows, Action<TableDef> table)
        {
            var e = new ModelEngine(Path.Combine(_dir, "s.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared"), CacheRoot = Path.Combine(_dir, "cache"), ReadMode = "DIRECT" });
            e.SaveSettings(e.Settings);
            var ora = FakeOracle.WithRows(rows);
            var src = new FusionSource(async (sql, max, ct) => (true, null, await ora.Run(sql, max, ct)));
            src.Pager.Backoff = TimeSpan.Zero;
            src.DefaultPageSize = 100;
            e.RegisterSource(src);
            var t = new TableDef { Module = "gl", Name = "lines", Source = new SourceDef { Kind = "fusion", Sql = "SELECT * FROM gl_je_lines" }, Key = { "ID" } };
            table(t);
            e.SaveModel(new ModelDefinition { Modules = { new ModuleDef { Name = "gl" } }, Tables = { t } });
            return (e, ora, src);
        }

        private static long Count(ModelEngine e) => Convert.ToInt64(e.Query("SELECT COUNT(*) FROM gl.lines").Rows[0][0]);

        [Fact]
        public async Task Keyset_paging_reads_every_row_once_by_key_range()
        {
            var (e, ora, _) = Setup(1050, _ => { });
            var r = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.True(r.Ok, r.Error);
            Assert.Equal(1050, Count(e));
            Assert.Equal(11, ora.Sqls.Count);                                   // 10 full pages + 1 short page
            Assert.Contains("WHERE \"ID\" > 1000 ORDER BY \"ID\"", ora.Sqls[^1]);
            Assert.DoesNotContain(ora.Sqls, s => s.Contains("RN__"));
            Assert.Equal(1050L, Convert.ToInt64(e.Query("SELECT COUNT(DISTINCT ID) FROM gl.lines").Rows[0][0]));
        }

        [Fact]
        public async Task Timeouts_are_retried_with_a_smaller_page()
        {
            var (e, ora, _) = Setup(250, _ => { });
            ora.FailTimes = 2;
            var r = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.True(r.Ok, r.Error);
            Assert.Equal(250, Count(e));
            Assert.Equal(2, r.Tables[0].Notes.Count(n => n.StartsWith("retry")));
            Assert.Contains("page now 100 rows", string.Join(" ", r.Tables[0].Notes));        // 100 is the minimum
        }

        [Fact]
        public async Task A_failed_full_load_resumes_from_its_checkpoint()
        {
            var (e, ora, _) = Setup(1000, _ => { });
            ora.FailAfterCalls = 4;                  // 4 pages (400 rows) succeed, then the network "dies"
            var r1 = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.False(r1.Ok);
            Assert.True(File.Exists(Path.Combine(_dir, "shared", "work", "gl.lines.checkpoint.json")));

            ora.FailAfterCalls = null; ora.Sqls.Clear();
            var r2 = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.True(r2.Ok, r2.Error);
            Assert.Equal("full (resumed)", r2.Tables[0].Mode);
            Assert.Contains("WHERE \"ID\" > 400 ORDER BY", ora.Sqls[0]);         // continued after the last good key
            Assert.Equal(1000, Count(e));
            Assert.Equal(1000L, Convert.ToInt64(e.Query("SELECT COUNT(DISTINCT ID) FROM gl.lines").Rows[0][0]));
            Assert.False(File.Exists(Path.Combine(_dir, "shared", "work", "gl.lines.checkpoint.json")));
        }

        [Fact]
        public async Task A_changed_definition_does_not_resume_an_old_checkpoint()
        {
            var (e, ora, _) = Setup(500, _ => { });
            ora.FailAfterCalls = 2;
            Assert.False((await e.RefreshAsync("gl", null, false, "t", null, default)).Ok);
            var m = e.LoadModel(); m.Tables[0].Source.Sql = "SELECT * FROM gl_je_lines WHERE 1 = 1"; e.SaveModel(m);
            ora.FailAfterCalls = null; ora.Sqls.Clear();
            var r = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.True(r.Ok, r.Error);
            Assert.Equal("full", r.Tables[0].Mode);
            Assert.DoesNotContain("\"ID\" >", ora.Sqls[0]);
            Assert.Equal(500, Count(e));
        }

        [Fact]
        public async Task Window_strategy_replaces_only_recent_months()
        {
            var (e, ora, _) = Setup(300, t => { t.Strategy = LoadStrategy.Window; t.WindowColumn = "ACCOUNTING_DATE"; t.WindowMonths = 2; });
            Assert.True((await e.RefreshAsync("gl", null, false, "t", null, default)).Ok);        // first load: everything
            Assert.Equal(300, Count(e));
            // the source changes: every row gets a new amount; a window refresh only picks up the recent months
            foreach (var r in ora.Table) r["AMOUNT"] = 0.0;
            ora.Sqls.Clear();
            var res = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.True(res.Ok, res.Error);
            Assert.Equal("window", res.Tables[0].Mode);
            Assert.Contains("\"ACCOUNTING_DATE\" >= TO_DATE(", ora.Sqls[0]);
            var start = new DateTime(DateTime.Now.Year, DateTime.Now.Month, 1).AddMonths(-1).ToString("yyyy-MM-dd");
            long recent = Convert.ToInt64(e.Query($"SELECT COUNT(*) FROM gl.lines WHERE ACCOUNTING_DATE >= DATE '{start}'").Rows[0][0]);
            long zeroed = Convert.ToInt64(e.Query("SELECT COUNT(*) FROM gl.lines WHERE AMOUNT = 0").Rows[0][0]);
            Assert.Equal(recent, zeroed);
            Assert.Equal(300, Count(e));
        }

        [Fact]
        public async Task Count_check_and_drift_are_reported()
        {
            var (e, ora, _) = Setup(120, t => t.CountCheck = true);
            var r1 = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.Equal(120L, r1.Tables[0].SourceCount);
            Assert.DoesNotContain(r1.Tables[0].Notes, n => n.StartsWith("COUNT CHECK"));
            foreach (var r in ora.Table) { r["NEW_COL"] = "x"; r.Remove("AMOUNT"); }
            var r2 = await e.RefreshAsync("gl", null, false, "t", null, default);
            Assert.Contains("added NEW_COL (VARCHAR)", r2.Tables[0].Drift);
            Assert.Contains("removed AMOUNT", r2.Tables[0].Drift);
            Assert.True(r2.Tables[0].RowsPerSecond > 0);
            var st = e.Status().Modules[0].Tables[0];
            Assert.Equal("keyset", st.Paging);
            Assert.Contains("removed AMOUNT", st.Drift);
        }

        [Fact]
        public void Oracle_filters_combine_incremental_and_window()
        {
            var t = new TableDef { IncrementalColumn = "last_update_date", WindowColumn = "accounting_date", OverlapMinutes = 0 };
            string sql = OracleSql.Filtered("SELECT * FROM x", t, "2026-09-30 10:00:00", new DateTime(2026, 8, 1));
            Assert.Contains("\"LAST_UPDATE_DATE\" >= TO_DATE('2026-09-30 10:00:00'", sql);
            Assert.Contains("\"ACCOUNTING_DATE\" >= TO_DATE('2026-08-01', 'YYYY-MM-DD')", sql);
            Assert.Equal("'O''Neil'", OracleSql.KeyLiteral(OracleSql.KeyToken("O'Neil")));
            Assert.Equal("42", OracleSql.KeyLiteral(OracleSql.KeyToken(42L)));
        }

        public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }
    }
}

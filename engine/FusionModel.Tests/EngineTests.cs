using System.Runtime.CompilerServices;
using FusionModel;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>A source whose rows the test decides; records the requests it was asked for.</summary>
    internal sealed class FakeSource : ISource
    {
        public string Kind => "fake";
        public Func<TableDef, string, List<Dictionary<string, object>>> Rows = (_, _) => new();
        public List<string> Watermarks { get; } = new();
        public List<ReadRequest> Requests { get; } = new();
        public long? Count;

        public async IAsyncEnumerable<RowPage> ReadAsync(ReadRequest req, [EnumeratorCancellation] CancellationToken ct)
        {
            Watermarks.Add(req.Watermark);
            Requests.Add(req);
            await Task.Yield();
            var all = Rows(req.Table, req.Watermark);
            for (int i = 0; i < all.Count; i += 2)          // pages of 2, to exercise paging
            {
                var p = new RowPage();
                p.Rows.AddRange(all.Skip(i).Take(2));
                yield return p;
            }
        }

        public Task<long?> CountAsync(ReadRequest req, CancellationToken ct) => Task.FromResult(Count);
    }

    public sealed class EngineTests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fmtest_" + Guid.NewGuid().ToString("N"));
        private string Shared => Path.Combine(_dir, "shared");

        private ModelEngine NewEngine(string name, string mode = "DIRECT", bool refresher = true)
        {
            var e = new ModelEngine(Path.Combine(_dir, name + "_settings.json"), new EngineSettings
            {
                SharedRoot = Shared, CacheRoot = Path.Combine(_dir, name + "_cache"), ReadMode = mode, IsRefresher = refresher
            });
            e.SaveSettings(e.Settings);
            return e;
        }

        private static Dictionary<string, object> Row(params (string k, object v)[] kv) => kv.ToDictionary(x => x.k, x => x.v);

        private static ModelDefinition WmsModel() => new()
        {
            Modules = { new ModuleDef { Name = "wms", Title = "WMS" }, new ModuleDef { Name = "common", Title = "Common" } },
            Tables =
            {
                new TableDef { Module = "wms", Name = "trips", Source = new SourceDef { Kind = "fake", Sql = "SELECT * FROM trips" },
                               Strategy = LoadStrategy.Incremental, Key = { "TRIP_ID" }, IncrementalColumn = "LAST_UPDATE_DATE" },
                new TableDef { Module = "common", Name = "customers", Source = new SourceDef { Kind = "fake", Sql = "SELECT * FROM customers" } }
            }
        };

        [Fact]
        public async Task Full_load_publishes_a_versioned_file_and_is_queryable()
        {
            using var e = NewEngine("w");
            var src = new FakeSource { Rows = (t, _) => t.Name == "trips"
                ? Enumerable.Range(1, 5).Select(i => Row(("TRIP_ID", (long)i), ("CUSTOMER", "C" + (i % 2)), ("QTY", 10.5 * i), ("LAST_UPDATE_DATE", $"2026-09-0{i}T10:00:00"))).ToList()
                : new() };
            e.RegisterSource(src);
            e.SaveModel(WmsModel());

            var r = await e.RefreshAsync("wms", null, false, "test", null, default);
            Assert.True(r.Ok, r.Error);
            var m = e.LoadManifest().Modules["wms"];
            Assert.True(File.Exists(Path.Combine(Shared, m.File)));
            Assert.Equal(5, m.Tables["trips"].Rows);
            Assert.Equal("2026-09-05 10:00:00", m.Tables["trips"].Watermark);
            Assert.Contains(m.Tables["trips"].Columns, c => c.Name == "LAST_UPDATE_DATE" && c.Type.StartsWith("TIMESTAMP"));

            var q = e.Query("SELECT CUSTOMER, SUM(QTY) AS q FROM wms.trips GROUP BY CUSTOMER ORDER BY CUSTOMER");
            Assert.Equal(2, q.Rows.Count);
            Assert.Equal("C0", q.Rows[0][0]);
            Assert.Equal(10.5 * (2 + 4), Convert.ToDouble(q.Rows[0][1]), 6);
        }

        [Fact]
        public async Task Incremental_refresh_merges_changed_and_new_rows()
        {
            using var e = NewEngine("w");
            var src = new FakeSource();
            e.RegisterSource(src);
            e.SaveModel(WmsModel());
            src.Rows = (t, wm) => Enumerable.Range(1, 3).Select(i => Row(("TRIP_ID", (long)i), ("STATUS", "OPEN"), ("QTY", (long)i), ("LAST_UPDATE_DATE", "2026-09-01T08:00:00"))).ToList();
            Assert.True((await e.RefreshAsync("wms", new[] { "trips" }, false, "t", null, default)).Ok);

            // second run: trip 2 changed (and its qty became a decimal), trip 4 is new
            src.Rows = (t, wm) => new() { Row(("TRIP_ID", 2L), ("STATUS", "SHIPPED"), ("QTY", 2.5), ("LAST_UPDATE_DATE", "2026-09-02T09:00:00"), ("NOTE", "late")),
                                          Row(("TRIP_ID", 4L), ("STATUS", "OPEN"), ("QTY", 4.0), ("LAST_UPDATE_DATE", "2026-09-02T09:30:00"), ("NOTE", null)) };
            var r = await e.RefreshAsync("wms", new[] { "trips" }, false, "t", null, default);
            Assert.True(r.Ok, r.Error);
            Assert.True(r.Tables[0].Incremental);
            Assert.Equal("2026-09-01 08:00:00", src.Watermarks.Last());

            var q = e.Query("SELECT TRIP_ID, STATUS, QTY, NOTE FROM wms.trips ORDER BY TRIP_ID");
            Assert.Equal(4, q.Rows.Count);
            Assert.Equal("SHIPPED", q.Rows[1][1]);
            Assert.Equal(2.5, Convert.ToDouble(q.Rows[1][2]), 6);
            Assert.Equal("late", q.Rows[1][3]);
            Assert.Equal("2026-09-02 09:30:00", e.LoadManifest().Modules["wms"].Tables["trips"].Watermark);
        }

        [Fact]
        public async Task Queries_join_across_module_files()
        {
            using var e = NewEngine("w");
            e.RegisterSource(new FakeSource { Rows = (t, _) => t.Name == "trips"
                ? new() { Row(("TRIP_ID", 1L), ("CUSTOMER", "C1"), ("LAST_UPDATE_DATE", "2026-09-01T00:00:00")) }
                : new() { Row(("CUSTOMER", "C1"), ("NAME", "Acme Ltd")) } });
            e.SaveModel(WmsModel());
            Assert.True((await e.RefreshAsync("wms", null, false, "t", null, default)).Ok);
            Assert.True((await e.RefreshAsync("common", null, false, "t", null, default)).Ok);
            var q = e.Query("SELECT c.NAME FROM wms.trips t JOIN common.customers c ON c.CUSTOMER = t.CUSTOMER");
            Assert.Equal("Acme Ltd", q.Rows.Single()[0]);
        }

        [Fact]
        public async Task Readers_cannot_touch_other_files_or_write()
        {
            using var e = NewEngine("w");
            e.RegisterSource(new FakeSource { Rows = (_, _) => new() { Row(("TRIP_ID", 1L), ("LAST_UPDATE_DATE", "2026-09-01T00:00:00")) } });
            e.SaveModel(WmsModel());
            Assert.True((await e.RefreshAsync("wms", new[] { "trips" }, false, "t", null, default)).Ok);
            string outside = Path.Combine(_dir, "secret.csv");
            File.WriteAllText(outside, "a\n1\n");
            Assert.ThrowsAny<Exception>(() => e.Query("SELECT * FROM read_csv_auto('" + outside + "')"));
            Assert.ThrowsAny<Exception>(() => e.Query("DELETE FROM wms.trips"));
            Assert.ThrowsAny<Exception>(() => e.Query("SELECT 1; DROP TABLE wms.trips"));
            Assert.ThrowsAny<Exception>(() => e.Query("WITH x AS (SELECT 1) SELECT * FROM x; ATTACH 'y.db'"));
        }

        [Fact]
        public void Sql_guard_allows_reads_only()
        {
            Assert.Null(SqlGuard.Check("SELECT 'a;b' AS x -- trailing; comment"));
            Assert.Null(SqlGuard.Check("with t as (select 1) select * from t;"));
            Assert.Null(SqlGuard.Check("SUMMARIZE wms.trips"));
            Assert.Null(SqlGuard.Check("(SELECT 1)"));
            Assert.NotNull(SqlGuard.Check("INSERT INTO x VALUES (1)"));
            Assert.NotNull(SqlGuard.Check("COPY wms.trips TO 'out.csv'"));
            Assert.NotNull(SqlGuard.Check("SELECT 1; SELECT 2"));
            Assert.NotNull(SqlGuard.Check("   "));
        }

        [Fact]
        public async Task Cache_readers_see_a_new_version_only_after_sync()
        {
            using var writer = NewEngine("w");
            var src = new FakeSource { Rows = (_, _) => new() { Row(("TRIP_ID", 1L), ("LAST_UPDATE_DATE", "2026-09-01T00:00:00")) } };
            writer.RegisterSource(src);
            writer.SaveModel(WmsModel());
            Assert.True((await writer.RefreshAsync("wms", new[] { "trips" }, false, "t", null, default)).Ok);

            using var reader = NewEngine("r", "CACHE", refresher: false);
            Assert.Single(reader.SyncCache());
            Assert.Equal(1L, Convert.ToInt64(reader.Query("SELECT COUNT(*) FROM wms.trips").Rows[0][0]));

            src.Rows = (_, _) => new() { Row(("TRIP_ID", 1L), ("LAST_UPDATE_DATE", "2026-09-01T00:00:00")), Row(("TRIP_ID", 2L), ("LAST_UPDATE_DATE", "2026-09-02T00:00:00")) };
            Assert.True((await writer.RefreshAsync("wms", new[] { "trips" }, true, "t", null, default)).Ok);
            Assert.Equal(1L, Convert.ToInt64(reader.Query("SELECT COUNT(*) FROM wms.trips").Rows[0][0]));   // still the cached copy
            Assert.Single(reader.SyncCache());
            Assert.Equal(2L, Convert.ToInt64(reader.Query("SELECT COUNT(*) FROM wms.trips").Rows[0][0]));
            Assert.Single(Directory.GetFiles(Path.Combine(_dir, "r_cache"), "*.duckdb"));
        }

        [Fact]
        public async Task A_lease_held_by_another_machine_blocks_the_refresh()
        {
            using var e = NewEngine("w");
            e.RegisterSource(new FakeSource());
            e.SaveModel(WmsModel());
            Json.WriteAtomic(Path.Combine(Shared, "refresher.lock"), new Lease { Machine = "OTHER-PC", Pid = 1, AcquiredUtc = DateTime.UtcNow, ExpiresUtc = DateTime.UtcNow.AddMinutes(10) });
            var r = await e.RefreshAsync("wms", null, false, "t", null, default);
            Assert.False(r.Ok);
            Assert.Contains("OTHER-PC", r.Error);
        }

        [Fact]
        public async Task An_empty_source_keeps_the_table_with_no_rows()
        {
            using var e = NewEngine("w");
            var src = new FakeSource { Rows = (_, _) => new() { Row(("CUSTOMER", "C1"), ("NAME", "Acme")) } };
            e.RegisterSource(src);
            e.SaveModel(WmsModel());
            Assert.True((await e.RefreshAsync("common", null, false, "t", null, default)).Ok);
            src.Rows = (_, _) => new();
            Assert.True((await e.RefreshAsync("common", null, false, "t", null, default)).Ok);
            var q = e.Query("SELECT * FROM common.customers");
            Assert.Empty(q.Rows);
            Assert.Equal(2, q.Columns.Count);
        }

        [Fact]
        public void Model_validation_catches_bad_definitions()
        {
            var m = WmsModel();
            m.Tables.Add(new TableDef { Module = "nope", Name = "Bad Name", Source = new SourceDef { Kind = "apex", Sql = "" }, Strategy = LoadStrategy.Incremental });
            var errors = m.Validate();
            Assert.Contains(errors, x => x.Contains("lowercase"));
            Assert.Contains(errors, x => x.Contains("module 'nope'"));
            Assert.Contains(errors, x => x.Contains("needs a key"));
            Assert.Contains(errors, x => x.Contains("SQL is empty"));
        }

        [Theory]
        [InlineData("DAILY", "06:00", "2026-10-01 06:30", "2026-10-01 07:00", false)]   // already ran after today's slot
        [InlineData("DAILY", "06:00", "2026-10-01 05:00", "2026-10-01 07:00", true)]    // last run before today's slot
        [InlineData("DAILY", "06:00", "2026-09-30 07:00", "2026-10-01 06:30", true)]    // yesterday's run, today's slot passed
        [InlineData("DAILY", "06:00", "2026-09-30 07:00", "2026-10-01 05:30", false)]   // today's slot not reached yet
        [InlineData("HOURLY", null, "2026-10-01 05:00", "2026-10-01 05:30", false)]
        [InlineData("HOURLY", null, "2026-10-01 04:00", "2026-10-01 05:30", true)]
        [InlineData("DAILY", "06:00", null, "2026-10-01 05:30", true)]                   // never published
        [InlineData("MANUAL", null, null, "2026-10-01 05:30", false)]
        public void Schedule_due(string mode, string time, string lastLocal, string nowLocal, bool expected)
        {
            DateTime? last = lastLocal == null ? null : DateTime.SpecifyKind(DateTime.Parse(lastLocal), DateTimeKind.Local).ToUniversalTime();
            Assert.Equal(expected, ModelEngine.Due(new ScheduleDef { Mode = mode, Time = time }, last, DateTime.Parse(nowLocal)));
        }

        [Theory]
        [InlineData("BIGINT", "DOUBLE", "DOUBLE")]
        [InlineData("DOUBLE", "BIGINT", null)]
        [InlineData("INTEGER", "BIGINT", "BIGINT")]
        [InlineData("BIGINT", "VARCHAR", "VARCHAR")]
        [InlineData("VARCHAR", "BIGINT", null)]
        [InlineData("DATE", "TIMESTAMP", "TIMESTAMP")]
        [InlineData("TIMESTAMP", "DATE", null)]
        [InlineData("DECIMAL(18,2)", "DOUBLE", "DOUBLE")]
        public void Type_widening(string target, string staged, string expected) => Assert.Equal(expected, Types.Wider(target, staged));

        [Fact]
        public async Task An_all_empty_column_in_one_batch_does_not_change_its_type()
        {
            using var e = NewEngine("w");
            var src = new FakeSource { Rows = (_, _) => new() { Row(("TRIP_ID", 1L), ("QTY", 5L), ("LAST_UPDATE_DATE", "2026-09-01T00:00:00")) } };
            e.RegisterSource(src);
            e.SaveModel(WmsModel());
            Assert.True((await e.RefreshAsync("wms", new[] { "trips" }, false, "t", null, default)).Ok);
            src.Rows = (_, _) => new() { Row(("TRIP_ID", 2L), ("QTY", null), ("LAST_UPDATE_DATE", "2026-09-02T00:00:00")) };
            Assert.True((await e.RefreshAsync("wms", new[] { "trips" }, false, "t", null, default)).Ok);
            Assert.Contains(e.LoadManifest().Modules["wms"].Tables["trips"].Columns, c => c.Name == "QTY" && c.Type == "BIGINT");
            Assert.Equal(2L, Convert.ToInt64(e.Query("SELECT COUNT(*) FROM wms.trips").Rows[0][0]));
        }

        [Fact]
        public void Oracle_paging_and_incremental_sql()
        {
            var t = new TableDef { IncrementalColumn = "last_update_date", OverlapMinutes = 60, Key = { "id" } };
            string inc = OracleSql.Incremental("SELECT * FROM x", t, "2026-09-30 10:00:00");
            Assert.Contains("\"LAST_UPDATE_DATE\" >= TO_DATE('2026-09-30 09:00:00', 'YYYY-MM-DD HH24:MI:SS')", inc);
            string page = OracleSql.Page("SELECT * FROM x -- note", t.Key, 1000, 2000);
            Assert.Contains("ORDER BY \"ID\"", page);
            Assert.Contains("ROWNUM <= 2000) WHERE RN__ > 1000", page);
            Assert.Contains("-- note\n)", page);
            Assert.Equal("\"TRIP_ID\"", OracleSql.Col("trip_id"));
            Assert.Equal("\"TripId\"", OracleSql.Col("TripId"));
        }

        public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }
    }
}

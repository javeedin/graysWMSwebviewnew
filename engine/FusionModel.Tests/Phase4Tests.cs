using System.Globalization;
using System.Text.Json;
using FusionModel;
using FusionModel.Packs;
using FusionModel.Semantic;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>
    /// Fusion packs and reconciliation checks. Every pack table is loaded from generated rows that follow its declared
    /// column types and relationships, so every measure and check of every pack really runs in DuckDB.
    /// </summary>
    public sealed class Phase4Tests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fm4_" + Guid.NewGuid().ToString("N"));
        public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }

        private ModelEngine NewEngine()
        {
            Directory.CreateDirectory(_dir);
            var e = new ModelEngine(Path.Combine(_dir, "s.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared"), CacheRoot = Path.Combine(_dir, "cache"), ReadMode = "DIRECT" });
            e.SaveSettings(e.Settings);
            return e;
        }

        [Fact]
        public void Packs_are_consistent()
        {
            var packs = FusionPacks.All;
            Assert.Equal(new[] { "gl", "ap", "ar", "po", "om", "inv" }, packs.Select(p => p.Id));
            var tables = packs.SelectMany(p => p.Tables).ToList();
            Assert.Equal(tables.Count, tables.Select(t => t.Name).Distinct().Count());          // bare names unique: measures can use them
            var measures = packs.SelectMany(p => p.Measures).ToList();
            Assert.Equal(measures.Count, measures.Select(x => x.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count());
            var byKey = tables.ToDictionary(t => t.Module + "." + t.Name, StringComparer.OrdinalIgnoreCase);
            foreach (var p in packs)
            {
                Assert.All(p.Tables, t => { Assert.Equal(p.Module.Name, t.Module); Assert.Contains(t.Key[0], t.ColumnTypes.Keys); Assert.True(t.Source.Sql.Length < 2500, t.Name); });
                foreach (var r in p.Relationships)
                {
                    Assert.True(byKey.ContainsKey(r.FromTable), r.FromTable);
                    Assert.Contains(r.FromColumn, byKey[r.FromTable].ColumnTypes.Keys);
                    if (r.ToTable != "calendar") { Assert.True(byKey.ContainsKey(r.ToTable), r.ToTable); Assert.Contains(r.ToColumn, byKey[r.ToTable].ColumnTypes.Keys); }
                }
                foreach (var ms in p.Measures) Assert.True(byKey.ContainsKey(ms.Table), ms.Name + " home " + ms.Table);
            }
            var model = new ModelDefinition();
            foreach (var p in packs) FusionPacks.Apply(model, p);
            Assert.Empty(model.Validate());
            Assert.Equal(6, model.Packs.Count);
        }

        [Fact]
        public void Apply_keeps_customer_changes_unless_overwrite()
        {
            var model = new ModelDefinition();
            var r1 = FusionPacks.Apply(model, FusionPacks.Get("ap"));
            Assert.Contains("module ap", r1.Added);
            model.Measures.First(x => x.Name == "AP Open Amount").Expression = "SUM(ap_schedules[GROSS_AMOUNT])";
            var r2 = FusionPacks.Apply(model, FusionPacks.Get("ap"));
            Assert.Empty(r2.Added);
            Assert.Equal("SUM(ap_schedules[GROSS_AMOUNT])", model.Measures.First(x => x.Name == "AP Open Amount").Expression);
            var r3 = FusionPacks.Apply(model, FusionPacks.Get("ap"), overwrite: true);
            Assert.Contains("measure [AP Open Amount]", r3.Updated);
            Assert.Equal("SUM(ap_schedules[AMOUNT_REMAINING])", model.Measures.First(x => x.Name == "AP Open Amount").Expression);
            // the catalog itself is never modified
            Assert.Equal("SUM(ap_schedules[AMOUNT_REMAINING])", FusionPacks.Get("ap").Measures.First(x => x.Name == "AP Open Amount").Expression);
        }

        [Fact]
        public void Every_pack_measure_and_check_runs_on_generated_data()
        {
            var e = NewEngine();
            var model = new ModelDefinition { Calendar = new CalendarDef { StartYear = 2025, EndYear = 2026 } };
            foreach (var p in FusionPacks.All) FusionPacks.Apply(model, p);
            GenerateFiles(model);
            e.SaveModel(model);
            foreach (var m in model.Modules)
            {
                var r = e.RefreshAsync(m.Name, null, false, "t", null, default).GetAwaiter().GetResult();
                Assert.True(r.Ok, m.Name + ": " + r.Error);
            }
            Assert.Empty(e.ValidateMeasures());
            var failures = new List<string>();
            foreach (var ms in model.Measures)
            {
                try
                {
                    e.EvaluateText("EVALUATE ROW(\"v\", [" + ms.Name + "])", "t");
                    e.EvaluateText("EVALUATE SUMMARIZECOLUMNS('calendar'[YearMonth], \"v\", [" + ms.Name + "])", "t");
                }
                catch (Exception ex) { failures.Add(ms.Name + ": " + ex.Message); }
            }
            Assert.True(failures.Count == 0, string.Join("\n", failures));
            var checks = e.RunChecks("t");
            Assert.Equal(model.Checks.Count, checks.Count);
            Assert.All(checks, c => Assert.True(c.Status != "ERROR", c.Name + ": " + c.Error));
        }

        [Fact]
        public void Gl_checks_pass_on_consistent_data_and_find_the_broken_account()
        {
            var e = NewEngine();
            var model = new ModelDefinition { Calendar = new CalendarDef { StartYear = 2025, EndYear = 2026 } };
            FusionPacks.Apply(model, FusionPacks.Get("gl"));
            string F(string n) => Path.Combine(_dir, n + ".csv");
            File.WriteAllLines(F("ledgers"), new[] { "LEDGER_ID,LEDGER_NAME,CURRENCY_CODE,PERIOD_SET_NAME,ACCOUNTED_PERIOD_TYPE,CHART_OF_ACCOUNTS_ID,LEDGER_CATEGORY_CODE", "1,MU Ledger,MUR,CAL,Month,101,PRIMARY" });
            File.WriteAllLines(F("gl_accounts"), new[] { "CODE_COMBINATION_ID,SEGMENT1,SEGMENT2,SEGMENT3,SEGMENT4,SEGMENT5,SEGMENT6,ACCOUNT_STRING,ACCOUNT_TYPE,ACCOUNT_CLASS,ENABLED_FLAG,LAST_UPDATE_DATE",
                "10,01,000,1100,00,00,00,01-000-1100-00-00-00,A,Asset,Y,2026-01-01 00:00:00", "20,01,000,4000,00,00,00,01-000-4000-00-00-00,R,Revenue,Y,2026-01-01 00:00:00",
                "30,01,000,5000,00,00,00,01-000-5000-00-00-00,E,Expense,Y,2026-01-01 00:00:00" });
            // Jan and Feb: cash sale 1,000 (Dr 1100 / Cr 4000) and expense 300 (Dr 5000 / Cr 1100)
            var bal = new List<string> { "BALANCE_KEY,LEDGER_ID,CODE_COMBINATION_ID,PERIOD_NAME,PERIOD_END_DATE,PERIOD_YEAR,PERIOD_NUM,ADJUSTMENT_PERIOD_FLAG,BEGIN_BALANCE_DR,BEGIN_BALANCE_CR,PERIOD_NET_DR,PERIOD_NET_CR" };
            var jl = new List<string> { "LINE_KEY,JE_HEADER_ID,JE_LINE_NUM,LEDGER_ID,CODE_COMBINATION_ID,PERIOD_NAME,PERIOD_END_DATE,EFFECTIVE_DATE,ACCOUNTED_DR,ACCOUNTED_CR,JE_SOURCE,JE_CATEGORY,STATUS,JOURNAL_NAME,DESCRIPTION,LAST_UPDATE_DATE" };
            var months = new[] { ("Jan-26", "2026-01-31", 1), ("Feb-26", "2026-02-28", 2) };
            int h = 0;
            foreach (var (pn, end, num) in months)
            {
                double open1100 = (num - 1) * 700, open4000 = (num - 1) * 1000, open5000 = (num - 1) * 300;
                bal.Add($"1-10-{pn},1,10,{pn},{end},2026,{num},N,{open1100},0,1000,300");
                bal.Add($"1-20-{pn},1,20,{pn},{end},2026,{num},N,0,{open4000},0,1000");
                bal.Add($"1-30-{pn},1,30,{pn},{end},2026,{num},N,{open5000},0,300,0");
                h++; jl.Add($"{h * 100000 + 1},{h},1,1,10,{pn},{end},{end},1000,0,Receivables,Sales,P,Sale {pn},,2026-03-01 00:00:00");
                jl.Add($"{h * 100000 + 2},{h},2,1,20,{pn},{end},{end},0,1000,Receivables,Sales,P,Sale {pn},,2026-03-01 00:00:00");
                h++; jl.Add($"{h * 100000 + 1},{h},1,1,30,{pn},{end},{end},300,0,Payables,Purchases,P,Exp {pn},,2026-03-01 00:00:00");
                jl.Add($"{h * 100000 + 2},{h},2,1,10,{pn},{end},{end},0,300,Payables,Purchases,P,Exp {pn},,2026-03-01 00:00:00");
            }
            File.WriteAllLines(F("gl_balances"), bal);
            File.WriteAllLines(F("gl_journal_lines"), jl);
            foreach (var t in model.Tables) { t.Source = new SourceDef { Kind = "file", Path = F(t.Name) }; t.Strategy = LoadStrategy.Full; }
            e.SaveModel(model);
            Assert.True(e.RefreshAsync("gl", null, false, "t", null, default).GetAwaiter().GetResult().Ok);

            var checks = e.RunChecks("t").ToDictionary(c => c.Name);
            Assert.Equal("PASS", checks["GL trial balance balances"].Status);
            Assert.Equal(2, checks["GL trial balance balances"].Groups);
            Assert.Equal("PASS", checks["GL journals agree to balances"].Status);
            Assert.Equal(6, checks["GL journals agree to balances"].Groups);

            // P&L and balances
            var pl = e.EvaluateText("EVALUATE SUMMARIZECOLUMNS('calendar'[YearMonth], \"Rev\", [Revenue], \"NI\", [Net Income], \"Cash\", CALCULATE([GL Closing Balance], gl_accounts[SEGMENT3] = \"1100\"))", "t");
            Assert.Equal(new object[] { "2026-01", 1000.0, 700.0, 700.0 }, pl.Rows[0].Select(Norm).ToArray());
            Assert.Equal(new object[] { "2026-02", 1000.0, 700.0, 1400.0 }, pl.Rows[1].Select(Norm).ToArray());
            var yearCash = e.EvaluateText("EVALUATE ROW(\"c\", CALCULATE([GL Closing Balance], gl_accounts[SEGMENT3] = \"1100\"), \"o\", CALCULATE([GL Opening Balance], gl_accounts[SEGMENT3] = \"1100\"))", "t");
            Assert.Equal(1400.0, Norm(yearCash.Rows[0][0]));      // closing = last period loaded
            Assert.Equal(0.0, Norm(yearCash.Rows[0][1]));         // opening = first period's opening

            // a journal line that never reached the balances: the check names the month and the account
            jl.Add($"{99 * 100000 + 1},99,1,1,30,Feb-26,2026-02-28,2026-02-15,50,0,Manual,Adjustment,P,Missing,,2026-03-01 00:00:00");
            File.WriteAllLines(F("gl_journal_lines"), jl);
            Assert.True(e.RefreshAsync("gl", null, true, "t", null, default).GetAwaiter().GetResult().Ok);
            var broken = e.RunChecks("t", new[] { "GL journals agree to balances" })[0];
            Assert.Equal("FAIL", broken.Status);
            Assert.Equal(1, broken.Failing);
            Assert.Equal(new object[] { "MU Ledger", "2026-02", "01-000-5000-00-00-00", 350.0, 300.0, 50.0 }, broken.Rows[0].Select(Norm).ToArray());
            Assert.Equal(new[] { "ledgers[LEDGER_NAME]", "calendar[YearMonth]", "gl_accounts[ACCOUNT_STRING]", "Journals", "Balances", "Difference" }, broken.Columns);
        }

        [Fact]
        public async Task Probe_reports_missing_columns_and_errors()
        {
            var e = NewEngine();
            e.RegisterSource(new ProbeSource());
            var ap = FusionPacks.Get("ap").Tables.First(t => t.Name == "suppliers");
            var t = JsonSerializer.Deserialize<TableDef>(JsonSerializer.Serialize(ap, Json.Options), Json.Options)!;
            t.Source.Kind = "probe";
            var ok = await e.ProbeTableAsync(t);
            Assert.False(ok.Ok);
            Assert.Equal(new[] { "ENABLED_FLAG" }, ok.Missing);                    // the fake pod has no ENABLED_FLAG
            Assert.Equal(2, ok.SampleRows);
            Assert.Null(ProbeSource.LastRequest.Table.Key.FirstOrDefault());         // no key order: cheap first rows
            t.Source.Sql = "BROKEN";
            var bad = await e.ProbeTableAsync(t);
            Assert.False(bad.Ok);
            Assert.Contains("ORA-00904", bad.Error);
        }

        [Fact]
        public void Reports_are_saved_in_the_shared_folder()
        {
            var e = NewEngine();
            e.SaveModel(new ModelDefinition());
            var r = e.SaveReport(new ReportDef { Name = "Sales by month", Request = new SemanticRequest { GroupBy = { "calendar[YearMonth]" }, Measures = { new MeasureSpec { Name = "Sales" } } }, Chart = "line" });
            Assert.Single(e.LoadReports());
            r.Name = "Sales by month (renamed)";
            e.SaveReport(r);
            Assert.Equal("Sales by month (renamed)", e.LoadReports().Single().Name);
            Assert.Throws<ArgumentException>(() => e.SaveReport(new ReportDef { Name = "empty" }));
            Assert.True(e.DeleteReport(r.Id));
            Assert.Empty(e.LoadReports());
        }

        private sealed class ProbeSource : ISource
        {
            public static ReadRequest LastRequest;
            public string Kind => "probe";
            public Task<long?> CountAsync(ReadRequest r, CancellationToken ct) => Task.FromResult<long?>(null);
            public async IAsyncEnumerable<RowPage> ReadAsync(ReadRequest r, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
            {
                LastRequest = r;
                await Task.Yield();
                if (r.Table.Source.Sql == "BROKEN") throw new InvalidOperationException("ORA-00904: \"X\": invalid identifier");
                var page = new RowPage();
                for (int i = 0; i < 2; i++)
                    page.Rows.Add(new Dictionary<string, object> { ["VENDOR_ID"] = i, ["SUPPLIER_NUMBER"] = "S" + i, ["SUPPLIER_NAME"] = "N", ["SUPPLIER_TYPE"] = "T", ["LAST_UPDATE_DATE"] = "2026-01-01", ["RN__"] = i });
                yield return page;
                throw new InvalidOperationException("the probe must stop after the first page");
            }
        }

        private static object Norm(object v) => v switch { null => null, string s => s, _ => (object)Convert.ToDouble(v, CultureInfo.InvariantCulture) };

        /// <summary>Rows for every pack table from its declared column types; keys and foreign keys line up.</summary>
        private void GenerateFiles(ModelDefinition model)
        {
            const int n = 40;
            var fks = model.Relationships.Where(r => r.ToTable != "calendar")
                .ToDictionary(r => r.FromTable + "|" + r.FromColumn, r => r, StringComparer.OrdinalIgnoreCase);
            foreach (var t in model.Tables)
            {
                var cols = t.ColumnTypes.ToList();
                var lines = new List<string> { string.Join(",", cols.Select(c => c.Key)) };
                for (int i = 1; i <= n; i++)
                    lines.Add(string.Join(",", cols.Select(c =>
                    {
                        string type = c.Value;
                        bool isKey = t.Key.Contains(c.Key);
                        int v = isKey ? i : fks.ContainsKey(t.Module + "." + t.Name + "|" + c.Key) ? 1 + i % 25 : i;
                        if (fks.TryGetValue(t.Module + "." + t.Name + "|" + c.Key, out var fk) || isKey)
                        {
                            string keyType = fk == null ? type : model.Table(fk.ToTable.Split('.')[0], fk.ToTable.Split('.')[1]).ColumnTypes[fk.ToColumn];
                            return keyType == "VARCHAR" ? "K" + v : v.ToString(CultureInfo.InvariantCulture);
                        }
                        return type switch
                        {
                            "BIGINT" or "INTEGER" => (i % 7).ToString(CultureInfo.InvariantCulture),
                            "DOUBLE" => ((i % 9) * 12.5 - 20).ToString(CultureInfo.InvariantCulture),
                            "DATE" => new DateTime(2025, 6, 1).AddDays(i * 11).ToString("yyyy-MM-dd"),
                            "TIMESTAMP" => new DateTime(2026, 1, 1).AddHours(i).ToString("yyyy-MM-dd HH:mm:ss"),
                            _ => c.Key switch
                            {
                                "ADJUSTMENT_PERIOD_FLAG" => "N", "STATUS" => i % 3 == 0 ? "U" : "P", "CANCELLED" => i % 5 == 0 ? "Y" : "N",
                                "CLASS" => new[] { "INV", "CM", "PMT", "DM" }[i % 4], "ACCOUNT_TYPE" => new[] { "A", "L", "R", "E" }[i % 4],
                                "ON_TIME" => i % 3 == 0 ? "" : i % 2 == 0 ? "Y" : "N", "IS_OPEN" => i % 2 == 0 ? "Y" : "N", "COMPLETE_FLAG" => "Y",
                                "TRANSACTION_TYPE" => i % 4 == 0 ? "RETURN TO VENDOR" : "RECEIVE",
                                _ => c.Key.ToLowerInvariant() + "_" + (i % 6)
                            }
                        };
                    })));
                string path = Path.Combine(_dir, t.Module + "_" + t.Name + ".csv");
                File.WriteAllLines(path, lines);
                t.Source = new SourceDef { Kind = "file", Path = path };
                t.Strategy = LoadStrategy.Full;
            }
        }
    }
}

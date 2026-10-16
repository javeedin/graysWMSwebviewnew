using System.Globalization;
using FusionModel;
using FusionModel.Semantic;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>
    /// The measure language against a small star schema. Every expected value is computed independently in C# (LINQ)
    /// from the same generated rows, so each test checks the compiler's filter-context semantics, not itself.
    /// </summary>
    public sealed class MeasureTests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fm2_" + Guid.NewGuid().ToString("N"));
        private readonly ModelEngine _e;
        private readonly List<Line> _lines = new();
        private readonly Dictionary<int, (string Name, string Region)> _cust = new();
        private readonly Dictionary<int, string> _itemCat = new();

        private sealed record Line(int Id, int Cust, int Item, DateTime Order, DateTime Ship, double Qty, double Price, string Status)
        {
            public double Sales => Qty * Price;
        }

        public MeasureTests()
        {
            Directory.CreateDirectory(_dir);
            string[] names = { "Acme", "Blue Bay", "Coral", "Dodo", "Emerald", "Flame", "Grove", "Harbor" };
            for (int c = 1; c <= 8; c++) _cust[c] = (names[c - 1], c % 2 == 0 ? "North" : "South");
            for (int i = 1; i <= 5; i++) _itemCat[i] = i <= 2 ? "A" : "B";
            var start = new DateTime(2025, 1, 1);
            string[] st = { "OPEN", "SHIPPED", "CLOSED", "CANCELLED" };
            for (int i = 1; i <= 400; i++)
            {
                var od = start.AddDays((i * 37) % 546);                   // 2025-01-01 .. 2026-06-30
                _lines.Add(new Line(i, 1 + i % 8, 1 + i % 5, od, od.AddDays(3 + i % 20), 1 + i % 9, Math.Round(2.5 + (i % 13) * 1.75, 2), st[i % 4]));
            }
            // customer 8 buys only a little, so "customers above 100" differs from "all customers"
            _lines.RemoveAll(l => l.Cust == 8 && l.Id % 5 != 0);
            File.WriteAllLines(Path.Combine(_dir, "lines.csv"), new[] { "ID,CUSTOMER_ID,ITEM_ID,ORDER_DATE,SHIP_DATE,QTY,PRICE,STATUS" }
                .Concat(_lines.Select(l => string.Join(",", l.Id, l.Cust, l.Item, l.Order.ToString("yyyy-MM-dd"), l.Ship.ToString("yyyy-MM-dd"),
                    l.Qty.ToString(CultureInfo.InvariantCulture), l.Price.ToString(CultureInfo.InvariantCulture), l.Status))));
            File.WriteAllLines(Path.Combine(_dir, "customers.csv"), new[] { "CUSTOMER_ID,NAME,REGION" }.Concat(_cust.Select(c => c.Key + "," + c.Value.Name + "," + c.Value.Region)));
            File.WriteAllLines(Path.Combine(_dir, "items.csv"), new[] { "ITEM_ID,CATEGORY" }.Concat(_itemCat.Select(i => i.Key + "," + i.Value)));

            _e = new ModelEngine(Path.Combine(_dir, "s.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared"), CacheRoot = Path.Combine(_dir, "cache"), ReadMode = "DIRECT" });
            _e.SaveSettings(_e.Settings);
            TableDef F(string name, string key) => new() { Module = "sales", Name = name, Source = new SourceDef { Kind = "file", Path = Path.Combine(_dir, name + ".csv") }, Key = { key } };
            var model = new ModelDefinition
            {
                Modules = { new ModuleDef { Name = "sales" } },
                Tables = { F("lines", "ID"), F("customers", "CUSTOMER_ID"), F("items", "ITEM_ID") },
                Calendar = new CalendarDef { StartYear = 2024, EndYear = 2027 },
                Relationships =
                {
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "CUSTOMER_ID", ToTable = "sales.customers", ToColumn = "CUSTOMER_ID" },
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "ITEM_ID", ToTable = "sales.items", ToColumn = "ITEM_ID" },
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "ORDER_DATE", ToTable = "calendar", ToColumn = "Date" },
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "SHIP_DATE", ToTable = "calendar", ToColumn = "Date", Active = false }
                },
                Measures =
                {
                    M("Sales", "SUMX(lines, lines[QTY] * lines[PRICE])"),
                    M("Qty", "SUM(lines[QTY])"),
                    M("Orders", "COUNTROWS(lines)"),
                    M("Customers", "DISTINCTCOUNT(lines[CUSTOMER_ID])"),
                    M("Sales North", "CALCULATE([Sales], customers[REGION] = \"North\")"),
                    M("Keep North", "CALCULATE([Sales], KEEPFILTERS(customers[REGION] = \"North\"))"),
                    M("Share", "DIVIDE([Sales], CALCULATE([Sales], ALL(customers)))"),
                    M("Sales LY", "CALCULATE([Sales], SAMEPERIODLASTYEAR('calendar'[Date]))"),
                    M("Sales YTD", "TOTALYTD([Sales], 'calendar'[Date])"),
                    M("Growth", "DIVIDE([Sales] - [Sales LY], [Sales LY])"),
                    M("Ship Sales", "CALCULATE([Sales], USERELATIONSHIP(lines[SHIP_DATE], 'calendar'[Date]))"),
                    M("Running", "CALCULATE([Sales], FILTER(ALL('calendar'[Date]), 'calendar'[Date] <= MAX('calendar'[Date])))"),
                    M("Big Customers", "COUNTROWS(FILTER(VALUES(lines[CUSTOMER_ID]), [Sales] > 1000))"),
                    M("Rank", "RANKX(ALL(customers[NAME]), [Sales])"),
                    M("Sales 3M", "CALCULATE([Sales], DATESINPERIOD('calendar'[Date], MAX('calendar'[Date]), -3, MONTH))"),
                    M("Avg per Customer", "AVERAGEX(VALUES(lines[CUSTOMER_ID]), [Sales])"),
                    M("Region", "SELECTEDVALUE(customers[REGION], \"Many\")"),
                    M("Done Orders", "CALCULATE([Orders], lines[STATUS] IN {\"SHIPPED\", \"CLOSED\"})"),
                    M("Price per Unit", "VAR s = [Sales] VAR q = [Qty] RETURN DIVIDE(s, q)"),
                    M("Size", "SWITCH(TRUE(), [Sales] > 20000, \"Large\", [Sales] > 5000, \"Medium\", \"Small\")"),
                    M("Customer Rows", "COUNTROWS(customers)"),
                    M("Prev Month", "CALCULATE([Sales], PREVIOUSMONTH('calendar'[Date]))"),
                    M("Items A Sales", "CALCULATE([Sales], FILTER(items, items[CATEGORY] = \"A\"))")
                },
                Roles = { new RoleDef { Name = "North team", Members = { "north.user" }, Filters = { new RoleFilter { Table = "sales.customers", Column = "REGION", Values = { "North" } } } } }
            };
            _e.SaveModel(model);
            var r = _e.RefreshAsync("sales", null, false, "t", null, default).GetAwaiter().GetResult();
            Assert.True(r.Ok, r.Error);
        }

        private static MeasureDef M(string n, string e) => new() { Table = "sales.lines", Name = n, Expression = e };

        private SemanticResult Q(IEnumerable<string> group, params string[] measures) => Q(group, null, measures);
        private SemanticResult Q(IEnumerable<string> group, List<FilterSpec> filters, params string[] measures) =>
            _e.Evaluate(new SemanticRequest { GroupBy = group.ToList(), Filters = filters ?? new(), Measures = measures.Select(m => new MeasureSpec { Name = m }).ToList(), Totals = true }, "tester");

        private static double D(object v) => v == null ? double.NaN : Convert.ToDouble(v, CultureInfo.InvariantCulture);
        private static Dictionary<string, object[]> ByKey(SemanticResult r, int keyCols = 1) => r.Rows.ToDictionary(x => string.Join("|", x.Take(keyCols).Select(v => Convert.ToString(v, CultureInfo.InvariantCulture))), x => x);
        /// <summary>DAX returns BLANK where there are no rows: an expected 0 matches a blank.</summary>
        private static void Near(double expected, object actual, double tol = 1e-6)
        {
            if (actual == null) { Assert.True(expected == 0, $"expected {expected}, got blank"); return; }
            Assert.True(Math.Abs(expected - D(actual)) <= tol * Math.Max(1, Math.Abs(expected)), $"expected {expected}, got {actual}");
        }

        [Fact]
        public void Aggregates_by_a_related_dimension_and_totals()
        {
            var r = Q(new[] { "customers[REGION]" }, "Sales", "Qty", "Orders", "Customers");
            var rows = ByKey(r);
            foreach (var g in _lines.GroupBy(l => _cust[l.Cust].Region))
            {
                Near(g.Sum(l => l.Sales), rows[g.Key][1]);
                Near(g.Sum(l => l.Qty), rows[g.Key][2]);
                Near(g.Count(), rows[g.Key][3]);
                Near(g.Select(l => l.Cust).Distinct().Count(), rows[g.Key][4]);
            }
            Near(_lines.Sum(l => l.Sales), r.Totals[1]);
            Near(_lines.Select(l => l.Cust).Distinct().Count(), r.Totals[4]);     // non-additive: computed, not summed
        }

        [Fact]
        public void Calculate_replaces_the_filter_and_keepfilters_intersects()
        {
            var r = ByKey(Q(new[] { "customers[REGION]" }, "Sales", "Sales North", "Keep North"));
            double north = _lines.Where(l => _cust[l.Cust].Region == "North").Sum(l => l.Sales);
            Near(north, r["North"][2]); Near(north, r["South"][2]);          // replaced: same value on every row
            Near(north, r["North"][3]); Assert.Null(r["South"][3]);          // intersected: blank for South
        }

        [Fact]
        public void All_removes_the_filter_for_share_of_total()
        {
            var r = Q(new[] { "customers[NAME]" }, "Share");
            double total = _lines.Sum(l => l.Sales);
            foreach (var row in r.Rows)
                Near(_lines.Where(l => _cust[l.Cust].Name == (string)row[0]).Sum(l => l.Sales) / total, row[1]);
            Near(1.0, r.Totals[1]);
        }

        [Fact]
        public void Time_intelligence_by_year_and_month()
        {
            var r = Q(new[] { "calendar[Year]", "calendar[Month]" }, new List<FilterSpec> { new() { Column = "calendar[Year]", Values = { "2026" } } },
                      "Sales", "Sales LY", "Sales YTD", "Running", "Prev Month", "Sales 3M");
            double S(Func<Line, bool> f) => _lines.Where(f).Sum(l => l.Sales);
            foreach (var row in r.Rows)
            {
                int y = Convert.ToInt32(row[0]), m = Convert.ToInt32(row[1]);
                var monthEnd = new DateTime(y, m, 1).AddMonths(1).AddDays(-1);
                Near(S(l => l.Order.Year == y && l.Order.Month == m), row[2]);
                Near(S(l => l.Order.Year == y - 1 && l.Order.Month == m), row[3]);
                Near(S(l => l.Order.Year == y && l.Order <= monthEnd), row[4]);
                Near(S(l => l.Order <= monthEnd), row[5]);
                var pm = new DateTime(y, m, 1).AddMonths(-1);
                Near(S(l => l.Order.Year == pm.Year && l.Order.Month == pm.Month), row[6]);
                Near(S(l => l.Order > monthEnd.AddMonths(-3) && l.Order <= monthEnd), row[7]);
            }
            Assert.Equal(12, r.Rows.Count);                                    // July–December 2026 only have last year's sales
        }

        [Fact]
        public void Growth_divides_this_year_by_last_year()
        {
            var r = ByKey(Q(new[] { "calendar[Year]" }, "Sales", "Growth"));
            double s25 = _lines.Where(l => l.Order.Year == 2025).Sum(l => l.Sales), s26 = _lines.Where(l => l.Order.Year == 2026).Sum(l => l.Sales);
            Near((s26 - s25) / s25, r["2026"][2]);
            Assert.Null(r["2025"][2]);                                         // no 2024 sales: blank, not an error
        }

        [Fact]
        public void Userelationship_switches_to_the_ship_date()
        {
            var r = ByKey(Q(new[] { "calendar[Year]" }, "Sales", "Ship Sales"));
            foreach (var y in new[] { 2025, 2026 })
            {
                Near(_lines.Where(l => l.Order.Year == y).Sum(l => l.Sales), r[y.ToString()][1]);
                Near(_lines.Where(l => l.Ship.Year == y).Sum(l => l.Sales), r[y.ToString()][2]);
            }
        }

        [Fact]
        public void Filter_with_a_measure_and_averagex_over_values()
        {
            var r = ByKey(Q(new[] { "customers[REGION]" }, "Big Customers", "Avg per Customer"));
            foreach (var g in _lines.GroupBy(l => _cust[l.Cust].Region))
            {
                var perCust = g.GroupBy(l => l.Cust).Select(c => c.Sum(l => l.Sales)).ToList();
                Near(perCust.Count(v => v > 1000), r[g.Key][1]);
                Near(perCust.Average(), r[g.Key][2]);
            }
        }

        [Fact]
        public void Rankx_ranks_customers_by_sales()
        {
            var r = Q(new[] { "customers[NAME]" }, "Sales", "Rank");
            var expected = _lines.GroupBy(l => _cust[l.Cust].Name).Select(g => (g.Key, S: g.Sum(l => l.Sales))).OrderByDescending(x => x.S).Select((x, i) => (x.Key, Rank: i + 1)).ToDictionary(x => x.Key, x => x.Rank);
            foreach (var row in r.Rows) Assert.Equal(expected[(string)row[0]], Convert.ToInt32(row[2]));
        }

        [Fact]
        public void Selectedvalue_row_filters_variables_and_switch()
        {
            var r = Q(new[] { "customers[NAME]" }, "Region", "Done Orders", "Price per Unit", "Size", "Items A Sales");
            foreach (var row in r.Rows)
            {
                var ls = _lines.Where(l => _cust[l.Cust].Name == (string)row[0]).ToList();
                Assert.Equal(ls.Select(l => _cust[l.Cust].Region).First(), row[1]);
                Near(ls.Count(l => l.Status is "SHIPPED" or "CLOSED"), row[2]);
                Near(ls.Sum(l => l.Sales) / ls.Sum(l => l.Qty), row[3]);
                double s = ls.Sum(l => l.Sales);
                Assert.Equal(s > 20000 ? "Large" : s > 5000 ? "Medium" : "Small", row[4]);
                var a = ls.Where(l => _itemCat[l.Item] == "A").ToList();
                if (a.Count == 0) Assert.Null(row[5]); else Near(a.Sum(l => l.Sales), row[5]);
            }
            Assert.Equal("Many", r.Totals[1]);
        }

        [Fact]
        public void An_unrelated_dimension_repeats_the_value()
        {
            // customers are not reached from items: every category shows all 8 customer rows (DAX behaviour)
            var r = Q(new[] { "items[CATEGORY]" }, "Sales", "Customer Rows");
            Assert.Equal(2, r.Rows.Count);
            Assert.All(r.Rows, row => Near(8, row[2]));
        }

        [Fact]
        public void Request_filters_and_role_security_apply()
        {
            var f = new List<FilterSpec> { new() { Column = "items[CATEGORY]", Values = { "B" } }, new() { Column = "calendar[Year]", Op = ">=", Values = { "2026" } } };
            var r = Q(new[] { "customers[REGION]" }, f, "Sales");
            foreach (var row in r.Rows)
                Near(_lines.Where(l => _itemCat[l.Item] == "B" && l.Order.Year >= 2026 && _cust[l.Cust].Region == (string)row[0]).Sum(l => l.Sales), row[1]);

            var north = _e.Evaluate(new SemanticRequest { GroupBy = { "customers[REGION]" }, Measures = { new MeasureSpec { Name = "Sales" } }, Totals = true }, "north.user");
            Assert.Single(north.Rows);
            Near(_lines.Where(l => _cust[l.Cust].Region == "North").Sum(l => l.Sales), north.Totals[1]);
        }

        [Fact]
        public void Evaluate_text_with_define_and_order_by()
        {
            var r = _e.EvaluateText(@"DEFINE
                MEASURE lines[Big Lines] = CALCULATE(COUNTROWS(lines), lines[QTY] >= 5)
                EVALUATE SUMMARIZECOLUMNS(customers[REGION], items[CATEGORY], ""Big"", [Big Lines], ""Sales"", [Sales])
                ORDER BY [Sales] DESC", "tester");
            Assert.Equal(4, r.Rows.Count);
            Assert.True(D(r.Rows[0][3]) >= D(r.Rows[1][3]));
            foreach (var row in r.Rows)
                Near(_lines.Count(l => l.Qty >= 5 && _cust[l.Cust].Region == (string)row[0] && _itemCat[l.Item] == (string)row[1]), row[2]);
            var one = _e.EvaluateText("EVALUATE ROW(\"Total\", [Sales], \"Lines\", COUNTROWS(lines))", "tester");
            Near(_lines.Sum(l => l.Sales), one.Rows[0][0]);
            Near(_lines.Count, one.Rows[0][1]);
        }

        [Fact]
        public void Errors_name_the_problem_and_position()
        {
            var e1 = Assert.Throws<MeasureException>(() => _e.EvaluateText("EVALUATE ROW(\"x\", [Nope])", "t"));
            Assert.Contains("Unknown measure [Nope]", e1.Message);
            var e2 = Assert.Throws<MeasureException>(() => Parser.Parse("SUM(lines[QTY]"));
            Assert.Contains("')'", e2.Message);
            var e3 = Assert.Throws<MeasureException>(() => _e.EvaluateText("EVALUATE ROW(\"x\", SUM(lines[NOPE]))", "t"));
            Assert.Contains("no column [NOPE]", e3.Message);
            var m = _e.LoadModel(); m.Measures.Add(M("Broken", "CALCULATE([Sales], FOO(1))")); _e.SaveModel(m);
            var bad = _e.ValidateMeasures();
            Assert.Single(bad);
            Assert.Contains("FOO", bad["Broken"]);
        }

        [Fact]
        public void Parser_precedence_and_literals()
        {
            var n = (BinaryNode)Parser.Parse("1 + 2 * 3 ^ 2 = 19 && NOT FALSE");
            Assert.Equal("&&", n.Op);
            var not = (UnaryNode)Parser.Parse("NOT T[c] IN {1, 2}");
            Assert.Equal("IN", ((BinaryNode)not.Operand).Op);
            var r = _e.EvaluateText("EVALUATE ROW(\"a\", 1 + 2 * 3 ^ 2, \"b\", \"x\" & 5, \"c\", IF(3 IN {1, 2, 3}, \"yes\", \"no\"), \"d\", DIVIDE(1, 0, -1))", "t");
            Near(19, r.Rows[0][0]);
            Assert.Equal("x5", r.Rows[0][1]);
            Assert.Equal("yes", r.Rows[0][2]);
            Near(-1, r.Rows[0][3]);
        }

        private object One(string expr) => _e.EvaluateText("EVALUATE ROW(\"x\", " + expr + ")", "t").Rows[0][0];

        [Fact]
        public void More_time_functions()
        {
            double S(Func<Line, bool> f) => _lines.Where(f).Sum(l => l.Sales);
            var r = _e.EvaluateText(@"EVALUATE SUMMARIZECOLUMNS('calendar'[Year], 'calendar'[Month], TREATAS({2026}, 'calendar'[Year]),
                ""Prev Month DA"", CALCULATE([Sales], DATEADD('calendar'[Date], -1, MONTH)),
                ""PY Quarter"", CALCULATE([Sales], PARALLELPERIOD('calendar'[Date], -4, QUARTER)),
                ""FYTD"", TOTALYTD([Sales], 'calendar'[Date], ""06-30""),
                ""Close"", CLOSINGBALANCEMONTH([Qty], 'calendar'[Date]))", "t");
            foreach (var row in r.Rows)
            {
                int y = Convert.ToInt32(row[0]), m = Convert.ToInt32(row[1]);
                var first = new DateTime(y, m, 1); var last = first.AddMonths(1).AddDays(-1);
                Near(S(l => l.Order >= first.AddMonths(-1) && l.Order < first), row[2]);
                var q0 = new DateTime(y - 1, ((m - 1) / 3) * 3 + 1, 1);
                Near(S(l => l.Order >= q0 && l.Order < q0.AddMonths(3)), row[3]);
                var fyStart = m >= 7 ? new DateTime(y, 7, 1) : new DateTime(y - 1, 7, 1);
                Near(S(l => l.Order >= fyStart && l.Order <= last), row[4]);
                Near(_lines.Where(l => l.Order.Date == last).Sum(l => l.Qty), row[5]);
            }
        }

        [Fact]
        public void Allexcept_allselected_hasonevalue_isinscope()
        {
            var r = _e.EvaluateText(@"EVALUATE SUMMARIZECOLUMNS(customers[REGION], customers[NAME], items[CATEGORY],
                ""Region Total"", CALCULATE([Sales], ALLEXCEPT(customers, customers[REGION])),
                ""Selected"", CALCULATE([Sales], ALLSELECTED(customers[NAME])),
                ""One Name"", HASONEVALUE(customers[NAME]),
                ""Scope"", ISINSCOPE(items[CATEGORY]))", "t");
            foreach (var row in r.Rows)
            {
                string region = (string)row[0], cat = (string)row[2];
                // ALLEXCEPT(customers, REGION) keeps REGION, removes NAME; the CATEGORY filter (items) stays
                Near(_lines.Where(l => _cust[l.Cust].Region == region && _itemCat[l.Item] == cat).Sum(l => l.Sales), row[3]);
                Near(_lines.Where(l => _cust[l.Cust].Region == region && _itemCat[l.Item] == cat).Sum(l => l.Sales), row[4]);
                Assert.Equal(true, row[5]);
                Assert.Equal(true, row[6]);
            }
        }

        [Fact]
        public void Iterators_counts_and_blanks()
        {
            Near(_lines.Count(l => l.Qty * l.Price > 50), One("COUNTX(FILTER(lines, lines[QTY] * lines[PRICE] > 50), lines[ID])"));
            Near(_lines.Min(l => l.Sales), One("MINX(lines, lines[QTY] * lines[PRICE])"));
            Near(_lines.GroupBy(l => l.Cust).Max(g => g.Sum(l => l.Sales)), One("MAXX(VALUES(lines[CUSTOMER_ID]), [Sales])"));
            Near(_lines.Where(l => l.Status == "OPEN").Sum(l => l.Sales), One("CALCULATE([Sales], lines[STATUS] = \"OPEN\")"));
            Near(_lines.Where(l => l.Status != "OPEN" && l.Status != "CANCELLED").Sum(l => l.Sales), One("CALCULATE([Sales], NOT lines[STATUS] IN {\"OPEN\", \"CANCELLED\"})"));
            Near(_lines.Where(l => l.Order >= new DateTime(2025, 3, 1) && l.Order <= new DateTime(2025, 3, 31)).Sum(l => l.Sales),
                 One("CALCULATE([Sales], DATESBETWEEN('calendar'[Date], DATE(2025, 3, 1), DATE(2025, 3, 31)))"));
            Near(_lines.Sum(l => l.Sales) / _lines.Count, One("AVERAGEX(lines, lines[QTY] * lines[PRICE])"));
            Near(Math.Round(_lines.Average(l => l.Price), 2), One("ROUND(AVERAGE(lines[PRICE]), 2)"));
            Near(6, One("DISTINCTCOUNT(customers[REGION]) + COUNTROWS(FILTER(items, items[CATEGORY] = \"B\")) + 1"));
            Assert.Null(One("CALCULATE([Sales], lines[STATUS] = \"NOPE\")"));
        }

        [Fact]
        public void Calendar_fiscal_columns()
        {
            var m = _e.LoadModel(); m.Calendar.FiscalYearStartMonth = 7; _e.SaveModel(m);
            var r = _e.Query("SELECT \"FiscalYear\", \"FiscalMonth\", \"FiscalQuarter\", CAST(\"FiscalYearStart\" AS VARCHAR) FROM calendar WHERE \"Date\" = DATE '2025-08-15'");
            Assert.Equal(2026, Convert.ToInt32(r.Rows[0][0]));
            Assert.Equal(2, Convert.ToInt32(r.Rows[0][1]));
            Assert.Equal(1, Convert.ToInt32(r.Rows[0][2]));
            Assert.Equal("2025-07-01", r.Rows[0][3]);
        }

        public void Dispose() { _e.Dispose(); try { Directory.Delete(_dir, true); } catch { } }
    }
}

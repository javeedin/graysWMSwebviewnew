using System.Text.Json.Nodes;
using FusionModel;
using FusionModel.Ai;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>Dashboards: storage, visual → semantic request, validation, the Copilot's answer check and Quick dashboard.</summary>
    public sealed class DashboardTests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fmd_" + Guid.NewGuid().ToString("N"));
        private readonly ModelEngine _e;

        public DashboardTests()
        {
            Directory.CreateDirectory(_dir);
            File.WriteAllLines(Path.Combine(_dir, "lines.csv"), new[] { "ID,CUSTOMER_ID,ORDER_DATE,QTY,PRICE,STATUS" }
                .Concat(Enumerable.Range(1, 80).Select(i => $"{i},{1 + i % 4},2026-0{1 + i % 6}-1{i % 9},{1 + i % 5},{10 + i % 7},{(i % 3 == 0 ? "OPEN" : "SHIPPED")}")));
            File.WriteAllLines(Path.Combine(_dir, "customers.csv"), new[] { "CUSTOMER_ID,NAME,REGION", "1,Acme Trading,North", "2,Blue Bay Hotel,South", "3,Coral Foods,North", "4,Dodo Retail,South" });
            _e = new ModelEngine(Path.Combine(_dir, "s.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared"), CacheRoot = Path.Combine(_dir, "cache"), ReadMode = "DIRECT" });
            _e.SaveSettings(_e.Settings);
            TableDef F(string n, string k) => new() { Module = "sales", Name = n, Source = new SourceDef { Kind = "file", Path = Path.Combine(_dir, n + ".csv") }, Key = { k } };
            _e.SaveModel(new ModelDefinition
            {
                Modules = { new ModuleDef { Name = "sales" } },
                Tables = { F("lines", "ID"), F("customers", "CUSTOMER_ID") },
                Calendar = new CalendarDef { StartYear = 2025, EndYear = 2026 },
                Relationships =
                {
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "CUSTOMER_ID", ToTable = "sales.customers", ToColumn = "CUSTOMER_ID" },
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "ORDER_DATE", ToTable = "calendar", ToColumn = "Date" }
                },
                Measures =
                {
                    new MeasureDef { Table = "sales.lines", Name = "Sales", Expression = "SUMX(lines, lines[QTY] * lines[PRICE])" },
                    new MeasureDef { Table = "sales.lines", Name = "Orders", Expression = "COUNTROWS(lines)" },
                    new MeasureDef { Table = "sales.lines", Name = "Open Orders", Expression = "CALCULATE(COUNTROWS(lines), lines[STATUS] = \"OPEN\")" }
                }
            });
            Assert.True(_e.RefreshAsync("sales", null, false, "t", null, default).GetAwaiter().GetResult().Ok);
        }

        public void Dispose() { _e.Dispose(); try { Directory.Delete(_dir, true); } catch { } }

        private static JsonObject Dash(params JsonObject[] visuals) => new()
        {
            ["name"] = "Sales",
            ["pages"] = new JsonArray(new JsonObject { ["id"] = "p1", ["name"] = "Overview", ["visuals"] = new JsonArray(visuals.Select(v => (JsonNode)v).ToArray()) })
        };

        private static JsonObject Vis(string type, string title, int x, int y, int w, int h, string[] cat, string series, params string[] values) => new()
        {
            ["id"] = title, ["type"] = type, ["title"] = title, ["x"] = x, ["y"] = y, ["w"] = w, ["h"] = h,
            ["fields"] = new JsonObject
            {
                ["category"] = new JsonArray(cat.Select(c => (JsonNode)c).ToArray()), ["series"] = series,
                ["values"] = new JsonArray(values.Select(v => (JsonNode)new JsonObject { ["name"] = v }).ToArray())
            }
        };

        [Fact]
        public void Dashboards_are_saved_for_everyone()
        {
            var d = _e.SaveDashboard(Dash(Vis("card", "Sales", 0, 0, 6, 4, new string[0], null, "Sales")), "khalid");
            Assert.NotNull((string)d["id"]);
            Assert.Equal("khalid", (string)d["by"]);
            d["name"] = "Sales v2";
            _e.SaveDashboard(d, "khalid");
            Assert.Equal("Sales v2", (string)_e.LoadDashboards().Single()["name"]);
            Assert.Throws<ArgumentException>(() => _e.SaveDashboard(new JsonObject { ["name"] = "x" }, "k"));
            Assert.True(_e.DeleteDashboard((string)d["id"]));
            Assert.Empty(_e.LoadDashboards());
        }

        [Fact]
        public void A_visual_maps_to_one_semantic_request_with_all_filters()
        {
            var v = Vis("matrix", "M", 0, 0, 12, 8, new[] { "customers[REGION]" }, "calendar[YearMonth]", "Sales", "Orders");
            ((JsonArray)v["fields"]!["values"]!).Add(new JsonObject { ["name"] = "Avg", ["expression"] = "DIVIDE([Sales], [Orders])" });
            v["sort"] = new JsonObject { ["by"] = "Sales", ["desc"] = true };
            v["top"] = 20;
            var req = ModelEngine.VisualRequest(v, new[] { new Semantic.FilterSpec { Column = "customers[NAME]", Op = "in", Values = { "Acme Trading" } } });
            Assert.Equal(new[] { "customers[REGION]", "calendar[YearMonth]" }, req.GroupBy);
            Assert.Equal(new[] { "Sales", "Orders", "Avg" }, req.Measures.Select(m => m.Name));
            Assert.Equal("DIVIDE([Sales], [Orders])", req.Measures[2].Expression);
            Assert.Single(req.Filters);
            Assert.Equal(20, req.Top);
            var r = _e.Evaluate(req, "t");
            Assert.All(r.Rows, row => Assert.Equal("North", row[0]));
        }

        [Fact]
        public void Validation_names_the_broken_visuals()
        {
            var d = Dash(
                Vis("card", "Good", 0, 0, 6, 4, new string[0], null, "Sales"),
                Vis("bar", "Bad measure", 6, 0, 6, 4, new[] { "customers[REGION]" }, null, "Nope"),
                Vis("bar", "Bad column", 12, 0, 6, 4, new[] { "customers[COUNTRY]" }, null, "Sales"),
                Vis("sunburst", "Bad type", 18, 0, 6, 4, new string[0], null, "Sales"),
                Vis("slicer", "Region", 0, 4, 6, 6, new[] { "customers[REGION]" }, null));
            var errors = _e.ValidateDashboard(d, "t");
            Assert.Equal(3, errors.Count);
            Assert.Contains(errors, e => e.StartsWith("Overview › Bad measure:"));
            Assert.Contains(errors, e => e.StartsWith("Overview › Bad column:"));
            Assert.Contains(errors, e => e.StartsWith("Overview › Bad type:"));
        }

        [Fact]
        public void Copilot_answers_are_checked_before_the_page_sees_them()
        {
            Assert.Contains("No ```dashboard", DashboardCopilot.Check(_e, "t", "Here is your dashboard!"));
            Assert.Contains("not valid JSON", DashboardCopilot.Check(_e, "t", "```dashboard\n{ nope\n```"));
            var overlap = Dash(Vis("card", "A", 0, 0, 6, 4, new string[0], null, "Sales"), Vis("card", "B", 4, 2, 6, 4, new string[0], null, "Orders"));
            Assert.Contains("B overlaps A", DashboardCopilot.Check(_e, "t", "```dashboard\n" + overlap.ToJsonString() + "\n```"));
            var wide = Dash(Vis("card", "W", 20, 0, 6, 4, new string[0], null, "Sales"));
            Assert.Contains("24 columns", DashboardCopilot.Check(_e, "t", "```dashboard\n" + wide.ToJsonString() + "\n```"));
            var ok = Dash(Vis("card", "A", 0, 0, 6, 4, new string[0], null, "Sales"), Vis("line", "Trend", 0, 4, 24, 8, new[] { "calendar[YearMonth]" }, null, "Sales"));
            string answer = "Done.\n```dashboard\n" + ok.ToJsonString() + "\n```\n- shows sales";
            Assert.Null(DashboardCopilot.Check(_e, "t", answer));
            Assert.Equal("Sales", (string)DashboardCopilot.Extract(answer)!["name"]);
            Assert.Contains("24 columns wide", DashboardCopilot.SystemPrompt("create"));
            Assert.DoesNotContain("24 columns wide", DashboardCopilot.SystemPrompt("insights"));
        }

        [Fact]
        public void Quick_dashboard_builds_a_valid_page_from_the_model()
        {
            var d = DashboardCopilot.Auto(_e, "t", "sales");
            var visuals = ((JsonArray)((JsonObject)((JsonArray)d["pages"]!)[0]!)["visuals"]!).OfType<JsonObject>().ToList();
            var types = visuals.Select(v => (string)v["type"]).ToList();
            Assert.Equal(3, types.Count(t => t == "card"));
            Assert.Contains("line", types);
            Assert.Contains("slicer", types);
            Assert.Contains("bar", types);
            Assert.Contains("table", types);
            Assert.StartsWith("customers[", visuals.First(v => (string)v["type"] == "bar")["fields"]!["category"]![0]!.ToString());   // a dimension, not the fact's STATUS
            Assert.Empty(_e.ValidateDashboard(d, "t"));
            Assert.Null(DashboardCopilot.Check(_e, "t", "```dashboard\n" + d.ToJsonString() + "\n```"));   // no overlaps either
            Assert.Throws<InvalidOperationException>(() => DashboardCopilot.Auto(_e, "t", "gl"));
        }
    }
}

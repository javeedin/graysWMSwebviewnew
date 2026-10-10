using System.Net;
using System.Text;
using System.Text.Json;
using FusionModel;
using FusionModel.Ai;
using Xunit;

namespace FusionModel.Tests
{
    /// <summary>Catalog, hybrid search, model tools, MCP and the embeddings provider.</summary>
    public sealed class Phase3Tests : IDisposable
    {
        private readonly string _dir = Path.Combine(Path.GetTempPath(), "fm3_" + Guid.NewGuid().ToString("N"));
        private readonly ModelEngine _e;

        public Phase3Tests()
        {
            Directory.CreateDirectory(_dir);
            File.WriteAllLines(Path.Combine(_dir, "lines.csv"), new[] { "ID,CUSTOMER_ID,ORDER_DATE,QTY,PRICE,STATUS" }
                .Concat(Enumerable.Range(1, 60).Select(i => $"{i},{1 + i % 4},2026-0{1 + i % 6}-1{i % 9},{1 + i % 5},{10 + i % 7},{(i % 3 == 0 ? "OPEN" : "SHIPPED")}")));
            File.WriteAllLines(Path.Combine(_dir, "customers.csv"), new[] { "CUSTOMER_ID,NAME,REGION", "1,Acme Trading,North", "2,Blue Bay Hotel,South", "3,Coral Foods,North", "4,Dodo Retail,South" });
            _e = new ModelEngine(Path.Combine(_dir, "s.json"), new EngineSettings { SharedRoot = Path.Combine(_dir, "shared"), CacheRoot = Path.Combine(_dir, "cache"), ReadMode = "DIRECT" });
            _e.SaveSettings(_e.Settings);
            TableDef F(string name, string key, string desc) => new() { Module = "sales", Name = name, Description = desc, Source = new SourceDef { Kind = "file", Path = Path.Combine(_dir, name + ".csv") }, Key = { key } };
            var lines = F("lines", "ID", "Order lines");
            lines.Columns["QTY"] = new ColumnDoc { Description = "Units ordered", Synonyms = { "quantity", "units" } };
            var cust = F("customers", "CUSTOMER_ID", "Customer master");
            cust.Synonyms.Add("clients");
            _e.SaveModel(new ModelDefinition
            {
                Modules = { new ModuleDef { Name = "sales", Title = "Sales" } },
                Tables = { lines, cust },
                Calendar = new CalendarDef { StartYear = 2025, EndYear = 2026 },
                Relationships =
                {
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "CUSTOMER_ID", ToTable = "sales.customers", ToColumn = "CUSTOMER_ID" },
                    new RelationshipDef { FromTable = "sales.lines", FromColumn = "ORDER_DATE", ToTable = "calendar", ToColumn = "Date" }
                },
                Measures =
                {
                    new MeasureDef { Table = "sales.lines", Name = "Sales", Expression = "SUMX(lines, lines[QTY] * lines[PRICE])", Description = "Order value", Synonyms = { "revenue", "turnover" } },
                    new MeasureDef { Table = "sales.lines", Name = "Open Orders", Expression = "CALCULATE(COUNTROWS(lines), lines[STATUS] = \"OPEN\")", Description = "Lines not shipped yet" }
                },
                Glossary =
                {
                    new GlossaryTerm { Term = "Backlog", Synonyms = { "order book" }, Definition = "Orders received but not shipped", Refs = { "[Open Orders]", "sales.lines[STATUS]" }, Rule = "Only STATUS = OPEN" }
                },
                Roles = { new RoleDef { Name = "North", Members = { "north.user" }, Filters = { new RoleFilter { Table = "sales.customers", Column = "REGION", Values = { "North" } } } } }
            });
            var r = _e.RefreshAsync("sales", null, false, "t", null, default).GetAwaiter().GetResult();
            Assert.True(r.Ok, r.Error);
        }

        public void Dispose() { _e.Dispose(); try { Directory.Delete(_dir, true); } catch { } }

        [Fact]
        public void Text_splits_and_stems()
        {
            Assert.Equal(new[] { "customer", "trx", "id" }, Text.Tokens("CUSTOMER_TRX_ID"));
            Assert.Equal(new[] { "invoice", "ship" }, Text.Tokens("show invoices shipped"));
            Assert.Equal(new[] { "order", "date" }, Text.Tokens("orderDate"));
            Assert.True(Text.Similar("custmer", "customer") > 0.45);
        }

        [Fact]
        public void Synonyms_find_the_measure()
        {
            var (hits, _) = _e.SearchAsync("what is our revenue by region").GetAwaiter().GetResult();
            Assert.Equal("m:Sales", hits[0].Entry.Id);
        }

        [Fact]
        public void Glossary_pulls_in_what_the_term_means()
        {
            var (hits, _) = _e.SearchAsync("how big is the order book").GetAwaiter().GetResult();
            var top = hits.Take(3).Select(h => h.Entry.Id).ToList();
            Assert.Contains("g:Backlog", top);
            Assert.Contains("m:Open Orders", top);
            Assert.Contains(hits, h => h.Why.Any(w => w.StartsWith("glossary")));
        }

        [Fact]
        public void Values_point_to_the_column_that_holds_them()
        {
            var (hits, _) = _e.SearchAsync("sales for blue bay hotel").GetAwaiter().GetResult();
            // customers is not filtered by a role? it is (North role) - so its values are not indexed
            Assert.DoesNotContain(hits, h => h.Entry.Kind == "value" && h.Entry.Title == "Blue Bay Hotel");
            // lines points to customers, so it is restricted too; STATUS values are therefore not indexed either
            Assert.Contains("sales.customers", ModelEngine.RestrictedTables(_e.Semantic()));
            Assert.Contains("sales.lines", ModelEngine.RestrictedTables(_e.Semantic()));
        }

        [Fact]
        public void Values_are_indexed_when_no_role_restricts_them()
        {
            var m = _e.LoadModel(); m.Roles.Clear(); _e.SaveModel(m);
            var (hits, _) = _e.SearchAsync("sales for blue bay hotel").GetAwaiter().GetResult();
            var v = hits.First(h => h.Entry.Kind == "value");
            Assert.Equal("Blue Bay Hotel", v.Entry.Title);
            Assert.Equal("customers[NAME]", v.Entry.Ref);
            Assert.Contains(hits.Take(4), h => h.Entry.Id == "m:Sales");
            // part of a name, as people type it
            (hits, _) = _e.SearchAsync("orders of coral").GetAwaiter().GetResult();
            Assert.Contains(hits, h => h.Entry.Kind == "value" && h.Entry.Title == "Coral Foods");
        }

        [Fact]
        public void Fuzzy_matches_typos()
        {
            var (hits, _) = _e.SearchAsync("custmers").GetAwaiter().GetResult();
            Assert.Contains(hits.Take(3), h => h.Entry.Id == "t:sales.customers");
        }

        [Fact]
        public void Verified_examples_are_found_first()
        {
            _e.SaveExample(new VerifiedExample { Question = "Top customers by sales this year", Query = "EVALUATE SUMMARIZECOLUMNS(customers[NAME], \"Sales\", [Sales]) ORDER BY [Sales] DESC", By = "t" });
            var (hits, _) = _e.SearchAsync("who are the top customers by sales").GetAwaiter().GetResult();
            Assert.Equal("example", hits[0].Entry.Kind);
            Assert.Single(_e.LoadExamples());
            Assert.True(_e.DeleteExample(_e.LoadExamples()[0].Id));
        }

        [Fact]
        public async Task Tools_answer_and_respect_roles()
        {
            var t = new ModelTools(_e);
            string ov = t.Overview("x");
            Assert.Contains("sales.lines", ov);
            Assert.Contains("[Sales]", ov);
            Assert.Contains("Backlog", ov);

            string d = await t.RunAsync("describe", Args(new { name = "[Sales]" }), "x");
            Assert.Contains("SUMX", d);
            d = await t.RunAsync("describe", Args(new { name = "customers[REGION]" }), "x");
            Assert.Contains("distinct 2", d);

            string all = await t.RunAsync("evaluate", Args(new { query = "EVALUATE SUMMARIZECOLUMNS(customers[REGION], \"Orders\", COUNTROWS(lines))" }), "x");
            Assert.Contains("North", all); Assert.Contains("South", all);
            string north = await t.RunAsync("evaluate", Args(new { query = "EVALUATE SUMMARIZECOLUMNS(customers[REGION], \"Orders\", COUNTROWS(lines))" }), "north.user");
            Assert.Contains("North", north); Assert.DoesNotContain("South", north);

            string vals = await t.RunAsync("lookup_values", Args(new { column = "customers[NAME]", search = "bay" }), "x");
            Assert.Equal("Blue Bay Hotel", vals.Trim());
            vals = await t.RunAsync("lookup_values", Args(new { column = "customers[NAME]", search = "bay" }), "north.user");
            Assert.StartsWith("(no values", vals);

            string sql = await t.RunAsync("run_sql", Args(new { sql = "SELECT COUNT(*) AS n FROM sales.lines" }), "x");
            Assert.Contains("60", sql);
            sql = await t.RunAsync("run_sql", Args(new { sql = "SELECT COUNT(*) AS n FROM sales.lines" }), "north.user");
            Assert.StartsWith("ERROR", sql);
            sql = await t.RunAsync("run_sql", Args(new { sql = "DELETE FROM sales.lines" }), "x");
            Assert.StartsWith("ERROR", sql);
            string bad = await t.RunAsync("evaluate", Args(new { query = "EVALUATE ROW(\"x\", [Nope])" }), "x");
            Assert.StartsWith("ERROR", bad);
        }

        [Fact]
        public async Task Mcp_speaks_json_rpc()
        {
            var h = new McpHandler(new ModelTools(_e), "x");
            var init = JsonDocument.Parse(await h.HandleAsync("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}}"));
            Assert.Equal("2025-03-26", init.RootElement.GetProperty("result").GetProperty("protocolVersion").GetString());
            Assert.Null(await h.HandleAsync("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"));
            var list = JsonDocument.Parse(await h.HandleAsync("{\"jsonrpc\":\"2.0\",\"id\":\"a\",\"method\":\"tools/list\"}"));
            var names = list.RootElement.GetProperty("result").GetProperty("tools").EnumerateArray().Select(x => x.GetProperty("name").GetString()).ToList();
            Assert.Contains("evaluate", names); Assert.Contains("search_model", names);
            Assert.Equal("object", list.RootElement.GetProperty("result").GetProperty("tools")[1].GetProperty("inputSchema").GetProperty("type").GetString());
            var call = JsonDocument.Parse(await h.HandleAsync("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"evaluate\",\"arguments\":{\"query\":\"EVALUATE ROW(\\\"n\\\", COUNTROWS(lines))\"}}}"));
            var res = call.RootElement.GetProperty("result");
            Assert.False(res.GetProperty("isError").GetBoolean());
            Assert.Contains("60", res.GetProperty("content")[0].GetProperty("text").GetString());
            var err = JsonDocument.Parse(await h.HandleAsync("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"nope\"}"));
            Assert.Equal(-32601, err.RootElement.GetProperty("error").GetProperty("code").GetInt32());
            var parse = JsonDocument.Parse(await h.HandleAsync("{not json"));
            Assert.Equal(-32700, parse.RootElement.GetProperty("error").GetProperty("code").GetInt32());

            // the stdio loop
            var input = new StringReader("{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"ping\"}\n\n");
            var output = new StringWriter();
            await h.ServeAsync(input, output);
            Assert.Equal("{\"jsonrpc\":\"2.0\",\"id\":9,\"result\":{}}", output.ToString().Trim());
        }

        [Fact]
        public async Task Voyage_embeddings_and_vector_search()
        {
            // a fake Voyage endpoint: each text becomes a bag-of-letters vector, so "revenue" is near "revenue …"
            string lastInputType = null;
            var handler = new FakeHandler(async req =>
            {
                Assert.Equal("Bearer k-123", req.Headers.Authorization.ToString());
                var body = JsonDocument.Parse(await req.Content.ReadAsStringAsync());
                lastInputType = body.RootElement.GetProperty("input_type").GetString();
                var data = body.RootElement.GetProperty("input").EnumerateArray().Select((t, i) => new { index = i, embedding = Bag(t.GetString()) }).Reverse().ToList();
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { data }), Encoding.UTF8, "application/json") };
            });
            var emb = new VoyageEmbedder(new HttpClient(handler), "k-123", "voyage-test", "https://fake/v1/embeddings");
            var v = await emb.EmbedAsync(new[] { "abc", "xyz" }, false, default);
            Assert.Equal(2, v.Count);
            Assert.Equal(Bag("abc"), v[0]);                 // reordered by index
            Assert.Equal("document", lastInputType);

            _e.Embedder = emb;
            var (hits, note) = await _e.SearchAsync("turnover");
            Assert.Null(note);
            Assert.Equal("query", lastInputType);
            Assert.Contains(hits, h => h.Why.Contains("meaning"));
            Assert.True(File.Exists(Path.Combine(_dir, "cache", "catalog_vectors.json")));
            int calls = handler.Calls;
            await _e.SearchAsync("turnover again");
            Assert.Equal(calls + 1, handler.Calls);          // only the question is embedded; entries come from the cache

            // a failing provider does not break search
            _e.Embedder = new VoyageEmbedder(new HttpClient(new FakeHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("bad key") }))), "x", "other");
            var (hits2, note2) = await _e.SearchAsync("revenue");
            Assert.Equal("m:Sales", hits2[0].Entry.Id);
            Assert.Contains("401", note2);
        }

        private static float[] Bag(string s)
        {
            var v = new float[26];
            foreach (var ch in s.ToLowerInvariant()) if (ch >= 'a' && ch <= 'z') v[ch - 'a']++;
            return v;
        }

        private static JsonElement Args(object o) => JsonSerializer.SerializeToElement(o);

        private sealed class FakeHandler : HttpMessageHandler
        {
            private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _f;
            public int Calls;
            public FakeHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> f) { _f = f; }
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) { Calls++; return _f(r); }
        }
    }
}

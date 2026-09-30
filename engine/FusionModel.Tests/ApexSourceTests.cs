using System.Net;
using System.Text;
using System.Text.Json;
using FusionModel;
using Xunit;

namespace FusionModel.Tests
{
    public sealed class ApexSourceTests
    {
        /// <summary>Answers ai/executequery like APEX: 5 rows in total, served page by page from the ROWNUM window in the SQL.</summary>
        private sealed class FakeApex : HttpMessageHandler
        {
            public List<string> Sqls { get; } = new();
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
            {
                using var doc = JsonDocument.Parse(await req.Content.ReadAsStringAsync(ct));
                string sql = doc.RootElement.GetProperty("sql").GetString();
                Sqls.Add(sql);
                var m = System.Text.RegularExpressions.Regex.Match(sql, @"ROWNUM <= (\d+)\) WHERE RN__ > (\d+)");
                int hi = int.Parse(m.Groups[1].Value), lo = int.Parse(m.Groups[2].Value);
                var ids = Enumerable.Range(1, 5).Where(i => i > lo && i <= hi).ToList();
                // first page as column arrays, later pages as objects - the gateway has returned both shapes
                string body = lo == 0
                    ? JsonSerializer.Serialize(new { success = true, columns = new[] { new { name = "ID" }, new { name = "NAME" }, new { name = "RN__" } }, rows = ids.Select(i => new object[] { i, "n" + i, i }) })
                    : JsonSerializer.Serialize(new { success = true, rows = ids.Select(i => new Dictionary<string, object> { ["ID"] = i, ["NAME"] = "n" + i, ["RN__"] = i }) });
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            }
        }

        [Fact]
        public async Task Pages_through_the_gateway_and_normalises_rows()
        {
            var fake = new FakeApex();
            var src = new ApexSource(new HttpClient(fake), "https://apex.example/ai/executequery");
            var t = new TableDef { Source = new SourceDef { Kind = "apex", Sql = "SELECT id, name FROM t;" }, PageSize = 2, Key = { "id" } };
            var rows = new List<Dictionary<string, object>>();
            await foreach (var p in src.ReadAsync(t, null, default)) rows.AddRange(p.Rows);
            Assert.Equal(5, rows.Count);
            Assert.Equal(3, fake.Sqls.Count);                                 // 2 + 2 + 1
            Assert.All(rows, r => Assert.False(r.ContainsKey("RN__")));
            Assert.Equal(new[] { "ID", "NAME" }, rows[4].Keys.ToArray());     // same names on every page, RN__ removed
            Assert.DoesNotContain(";", fake.Sqls[0]);
            Assert.Contains("ORDER BY \"ID\"", fake.Sqls[0]);
        }

        [Fact]
        public async Task A_gateway_error_is_reported()
        {
            var handler = new StubHandler("{\"success\":false,\"error\":\"ORA-00942: table or view does not exist\"}");
            var src = new ApexSource(new HttpClient(handler), "https://apex.example/q");
            var t = new TableDef { Source = new SourceDef { Kind = "apex", Sql = "SELECT * FROM nope" } };
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(async () => { await foreach (var _ in src.ReadAsync(t, null, default)) { } });
            Assert.Contains("ORA-00942", ex.Message);
        }

        private sealed class StubHandler : HttpMessageHandler
        {
            private readonly string _body;
            public StubHandler(string body) { _body = body; }
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) =>
                Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(_body) });
        }
    }
}

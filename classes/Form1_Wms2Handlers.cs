using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// WMS 2.0 IPC (wms2/index.html, classes/Wms2Store.cs): w2* actions, reply w2Response.
    /// w2Status (tables, rows, last write), w2Put (replace one scope of a w2_* table with the rows the page read from APEX /
    /// Fusion; columns = names to create even when no row has them yet), w2Query / w2Queries (read-only SQL over the local DuckDB copy), w2Clear (drop a cached table).
    /// The existing WMS module is not involved: WMS 2.0 calls the same ORDS endpoints and host actions (executeGet,
    /// executePost, executeOracleFusionGet / Patch, processMRAInterface …) the WMS pages use; only its local copy lives here.
    /// </summary>
    public partial class Form1
    {
        private static bool IsWms2Action(string action) =>
            action != null && action.Length > 2 && action.StartsWith("w2", StringComparison.Ordinal) && char.IsUpper(action[2]);

        private async Task HandleWms2Action(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                switch (action)
                {
                    case "w2Status":
                        data = await Task.Run(() => Wms2Store.Status());
                        break;

                    case "w2Put":
                        {
                            string table = PipeSrvStr(root, "table");
                            bool all = root.TryGetProperty("replaceAll", out var ra) && ra.ValueKind == JsonValueKind.True;
                            var scope = new Dictionary<string, List<string>>();
                            if (root.TryGetProperty("scope", out var sc) && sc.ValueKind == JsonValueKind.Object)
                                foreach (var p in sc.EnumerateObject())
                                    scope[p.Name] = p.Value.ValueKind == JsonValueKind.Array
                                        ? p.Value.EnumerateArray().Select(Wms2Text).ToList()
                                        : new List<string> { Wms2Text(p.Value) };
                            var rows = new List<Dictionary<string, string>>();
                            if (root.TryGetProperty("rows", out var rs) && rs.ValueKind == JsonValueKind.Array)
                                foreach (var r in rs.EnumerateArray())
                                    if (r.ValueKind == JsonValueKind.Object)
                                        rows.Add(r.EnumerateObject().ToDictionary(p => p.Name, p => Wms2Text(p.Value)));
                            var cols = root.TryGetProperty("columns", out var cs) && cs.ValueKind == JsonValueKind.Array
                                ? cs.EnumerateArray().Select(c => c.GetString()).Where(c => !string.IsNullOrWhiteSpace(c)).ToList() : null;
                            var res = await Task.Run(() => Wms2Store.Put(table, scope, rows, all, cols));
                            data = res.Ok ? new { ok = true, rows = res.Rows, ms = res.Ms } : (object)new { ok = false, error = res.Error };
                            break;
                        }

                    case "w2Query":
                        {
                            string sql = PipeSrvStr(root, "sql");
                            int max = root.TryGetProperty("maxRows", out var mx) && mx.TryGetInt32(out var m) ? m : 50000;
                            var r = await Task.Run(() => Wms2Store.Query(sql, max));
                            data = r.Error != null ? new { ok = false, error = r.Error } : new { ok = true, columns = r.Columns, rows = r.Rows, truncated = r.Truncated, ms = r.Ms };
                            break;
                        }

                    case "w2Queries":
                        {
                            var list = root.TryGetProperty("queries", out var qs) && qs.ValueKind == JsonValueKind.Array
                                ? qs.EnumerateArray().Select(q => q.GetString()).Take(30).ToList() : new List<string>();
                            var res = await Task.Run(() => list.Select(q => Wms2Store.Query(q, 200000)).ToList());
                            data = new
                            {
                                ok = res.All(r => r.Error == null),
                                error = res.Select(r => r.Error).FirstOrDefault(e => e != null),
                                results = res.Select(r => new { columns = r.Columns, rows = r.Rows, truncated = r.Truncated, ms = r.Ms, error = r.Error })
                            };
                            break;
                        }

                    case "w2Clear":
                        data = await Task.Run(() => Wms2Store.Clear(PipeSrvStr(root, "table")));
                        break;

                    default:
                        data = new { ok = false, error = "Unknown WMS 2.0 action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "w2Response", requestId, data }));
        }

        /// <summary>A JSON value as the text stored in DuckDB (null stays null; objects / arrays as JSON).</summary>
        private static string Wms2Text(JsonElement v) => v.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => v.GetString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Number => v.GetRawText(),
            _ => v.GetRawText()
        };
    }
}

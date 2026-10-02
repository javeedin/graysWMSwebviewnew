using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens IPC (finance/index.html, classes/FinanceLens.cs): fin* actions, reply finResponse.
    /// finStatus, finQuery (one read-only SELECT on the finance DuckDB file), finLoadSample, finDocGet / finDocSave
    /// (templates.json, config.json, notes.json next to the data), finSetRoot. Loading data and changing the folder are
    /// for AI admins; reading and editing statement templates is for everyone using the module.
    /// </summary>
    public partial class Form1
    {
        private static bool IsFinanceAction(string action) =>
            action != null && action.Length > 3 && action.StartsWith("fin", StringComparison.Ordinal) && char.IsUpper(action[3]);

        private async Task HandleFinanceAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                string user = GetClaudeCliService().PolicyUser;
                switch (action)
                {
                    case "finStatus":
                        data = await Task.Run(() => FinanceLens.Status());
                        break;
                    case "finQuery":
                        {
                            string sql = PipeSrvStr(root, "sql");
                            int max = root.TryGetProperty("maxRows", out var mx) && mx.TryGetInt32(out var m) ? m : 50000;
                            var r = await Task.Run(() => FinanceLens.Query(sql, max));
                            data = r.Error != null ? new { ok = false, error = r.Error } : new { ok = true, columns = r.Columns, rows = r.Rows, truncated = r.Truncated, ms = r.Ms };
                            break;
                        }
                    case "finQueries":     // several read-only queries in one round trip (a statement needs actuals, budget, prior year …)
                        {
                            var list = root.TryGetProperty("queries", out var qs) && qs.ValueKind == JsonValueKind.Array ? qs.EnumerateArray().Select(q => q.GetString()).Take(20).ToList() : new System.Collections.Generic.List<string>();
                            var res = await Task.Run(() => list.Select(q => FinanceLens.Query(q, 200000)).ToList());
                            data = new { ok = res.All(r => r.Error == null), error = res.Select(r => r.Error).FirstOrDefault(e => e != null),
                                results = res.Select(r => new { columns = r.Columns, rows = r.Rows, truncated = r.Truncated, ms = r.Ms, error = r.Error }) };
                            break;
                        }
                    case "finLoadSample":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                        {
                            int year = root.TryGetProperty("startYear", out var y) && y.TryGetInt32(out var yy) ? yy : DateTime.Now.Year - 1;
                            int months = root.TryGetProperty("months", out var mo) && mo.TryGetInt32(out var mm) ? mm : 24;
                            data = await Task.Run(() => FinanceLens.LoadSample(year, months));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_load_sample", Outcome = "OK", Target = year + " · " + months + " months" });
                            break;
                        }
                    case "finDocGet":
                        data = new { ok = true, json = FinanceLens.ReadDoc(PipeSrvStr(root, "name")) };
                        break;
                    case "finDocSave":
                        FinanceLens.SaveDoc(PipeSrvStr(root, "name"), PipeSrvStr(root, "json"));
                        data = new { ok = true };
                        break;
                    case "finSetRoot":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the finance folder." }; break; }
                        FinanceLens.SetRoot(PipeSrvStr(root, "root"));
                        data = new { ok = true, root = FinanceLens.Root };
                        break;
                    case "finWho":
                        data = new { ok = true, user, admin = await AiControl.IsAdminAsync(user) };
                        break;
                    default:
                        data = new { ok = false, error = "Unknown finance action " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[Finance] " + action + " failed: " + ex);
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "finResponse", requestId, data }));
        }
    }
}

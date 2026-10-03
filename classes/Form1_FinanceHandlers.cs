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
    /// (templates.json, config.json, notes.json next to the data), finSetRoot, finFusionDiscover / finFusionSync (Fusion GL
    /// through the Fusion SQL runner, classes/FinanceFusion.cs, progress finProgress, finCancel) and finAsk / finAskCancel
    /// (CFO Copilot, classes/FinanceAskAgent.cs: kill switch, audited with cost). Loading data and changing the folder are
    /// for AI admins; reading and editing statement templates is for everyone using the module.
    /// </summary>
    public partial class Form1
    {
        private System.Threading.CancellationTokenSource _finCts, _finAskCts;

        private System.Threading.CancellationTokenSource FinNewCts(TimeSpan limit)
        {
            try { _finCts?.Cancel(); } catch { }
            _finCts = new System.Threading.CancellationTokenSource(limit);
            return _finCts;
        }

        private Action<string> FinProgress(WebView2 wv, string requestId) =>
            msg => { try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "finProgress", requestId, message = msg })); } catch { } };

        /// <summary>The Fusion SQL runner for a pod (PROD / TEST) or, when empty, the pod the app is logged in to; credentials stay in the host.</summary>
        private FinanceFusion.Runner FinRunner(string pod)
        {
            if (string.IsNullOrWhiteSpace(pod)) return (sql, cap, ct) => GetFusionSqlService().ExecuteAsync(sql, cap, ct);
            string inst = pod.Trim().ToUpperInvariant() == "TEST" ? "TEST" : "PROD";
            var svc = new WMSApp.FusionSql.FusionSqlService(async () =>
            {
                if (!_fusionCredentialsLoaded || string.IsNullOrEmpty(_fusionUsername) || string.IsNullOrEmpty(_fusionPassword))
                    await FetchFusionCredentialsOnStartup();
                return (_fusionUsername, _fusionPassword);
            }, () => inst);
            return (sql, cap, ct) => svc.ExecuteAsync(sql, cap, ct);
        }

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
                    case "finFusionDiscover":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can connect Finance Lens to Fusion." }; break; }
                        {
                            var cts = FinNewCts(TimeSpan.FromMinutes(20));
                            string pod = PipeSrvStr(root, "pod");
                            var d = await FinanceFusion.DiscoverAsync(FinRunner(pod), FinProgress(wv, requestId), cts.Token);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_fusion_discover", Outcome = d.Ok ? "OK" : "FAILED", Target = pod, Detail = d.Ok ? d.Ledgers.Count + " ledgers" : d.Error });
                            var dj = JsonSerializer.SerializeToElement(d, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                            bool savedDuck = false;
                            if (d.Ok) { try { savedDuck = await Task.Run(() => FinanceLens.SaveDiscovery(pod ?? "", dj.GetRawText(), user)); } catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[Finance] discovery not saved: " + ex.Message); } }
                            data = new { ok = d.Ok, error = d.Error, discovery = dj, pod, savedDuck };
                            break;
                        }
                    case "finFusionSync":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                        {
                            var o = root.GetProperty("options").Deserialize<FinanceFusion.SyncOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            o.User = user;
                            var cts = FinNewCts(TimeSpan.FromHours(3));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            data = await Task.Run(() => FinanceFusion.SyncAsync(FinRunner(o.Pod), o, FinProgress(wv, requestId), cts.Token));
                            bool okSync = JsonSerializer.SerializeToElement(data).TryGetProperty("ok", out var okp) && okp.ValueKind == JsonValueKind.True;
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_fusion_sync", Outcome = okSync ? "OK" : "FAILED", DurationMs = sw.ElapsedMilliseconds,
                                Target = (o.Pod ?? "") + " · " + string.Join(", ", o.Ledgers.Select(l => l.Name)), Detail = o.FromSeq + "-" + o.ToSeq + (o.Incremental ? " incremental" : " full") });
                            break;
                        }
                    case "finSetClasses":
                        {
                            var map = new System.Collections.Generic.Dictionary<string, string>();
                            if (root.TryGetProperty("classes", out var cl) && cl.ValueKind == JsonValueKind.Object)
                                foreach (var p in cl.EnumerateObject()) map[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : null;
                            data = new { ok = true, updated = await Task.Run(() => FinanceLens.SetClasses(map)) };
                            break;
                        }
                    case "finDiscoveryGet":     // the discovery saved in the finance file (the page tries APEX first)
                        {
                            var sd = await Task.Run(() => FinanceLens.LoadDiscovery(PipeSrvStr(root, "pod") ?? ""));
                            data = sd == null ? new { ok = true, found = false } : (object)new { ok = true, found = true, json = sd.Value.Json, at = sd.Value.At, by = sd.Value.By };
                            break;
                        }
                    case "finDiscoverySave":    // the chosen roles after a change (no Fusion call)
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the Fusion setup." }; break; }
                        {
                            var roles = root.TryGetProperty("roles", out var rl) ? rl.Deserialize<System.Collections.Generic.Dictionary<string, System.Collections.Generic.Dictionary<string, string>>>() : null;
                            data = new { ok = true, savedDuck = await Task.Run(() => FinanceLens.SaveDiscovery(PipeSrvStr(root, "pod") ?? "", PipeSrvStr(root, "json"), user, roles)) };
                            break;
                        }
                    case "finCancel":
                        _finCts?.Cancel();
                        data = new { ok = true };
                        break;
                    case "finAsk":
                        {
                            if (!await AiControl.IsEnabledAsync(user)) { data = new { ok = false, error = "The AI is paused (AI Digital Employee › Control)." }; break; }
                            _finAskCts?.Dispose();
                            _finAskCts = new System.Threading.CancellationTokenSource(TimeSpan.FromMinutes(10));
                            var history = root.TryGetProperty("history", out var hh) ? hh.Clone() : default;
                            string question = PipeSrvStr(root, "question") ?? "";
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            var r = await FinanceAskAgent.AskAsync(question, history, PipeSrvStr(root, "context"), PipeSrvStr(root, "model"), FinProgress(wv, requestId), _finAskCts.Token);
                            double? cost = null;
                            try { cost = await AiControl.CostAsync(r.Model, r.TokensIn, r.TokensOut, r.CacheRead, r.CacheWrite, user); } catch { }
                            AiControl.Audit(new AiControl.AuditEvent
                            {
                                User = user, Source = "FINANCE", Action = "turn", Outcome = r.Ok ? "OK" : "FAILED", Model = r.Model,
                                TokensIn = r.TokensIn, TokensOut = r.TokensOut, CacheRead = r.CacheRead, CacheWrite = r.CacheWrite, CostUsd = cost, DurationMs = sw.ElapsedMilliseconds,
                                Detail = (question.Length > 300 ? question.Substring(0, 300) : question) + (r.Ok ? "" : " · " + r.Error)
                            });
                            data = new { ok = r.Ok, error = r.Error, answer = r.Answer, steps = r.Steps, queries = r.Queries, costUsd = cost };
                            break;
                        }
                    case "finAskCancel":
                        _finAskCts?.Cancel();
                        data = new { ok = true };
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

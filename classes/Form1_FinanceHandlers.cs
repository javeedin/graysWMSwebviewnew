using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens IPC (finance/index.html, classes/FinanceLens.cs): fin* actions, reply finResponse.
    /// finStatus, finQuery (one read-only SELECT on the finance DuckDB file), finClearData, finDocGet / finDocSave
    /// (templates.json, config.json, notes.json next to the data), finSetRoot, finTbSync / finTbSyncStatus / finTbSyncDelete (trial balance sync), finFusionDiscover / finFusionSync (Fusion GL
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

        /// <summary>Origin and credentials of a pod for UCM (kept in the host; the page never sees the password).</summary>
        private async Task<(string Origin, string User, string Password)> FinPodLogin(string pod)
        {
            var svc = string.IsNullOrWhiteSpace(pod) ? GetFusionSqlService() : new WMSApp.FusionSql.FusionSqlService(async () =>
            {
                if (!_fusionCredentialsLoaded || string.IsNullOrEmpty(_fusionUsername) || string.IsNullOrEmpty(_fusionPassword))
                    await FetchFusionCredentialsOnStartup();
                return (_fusionUsername, _fusionPassword);
            }, () => pod.Trim().ToUpperInvariant() == "TEST" ? "TEST" : "PROD");
            var cfg = WMSApp.FusionSql.FusionSqlStore.LoadConfig();
            var cred = await svc.GetCredentialsAsync(cfg);
            return (svc.ResolveOrigin(cfg), cred.Username, cred.Password);
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
                    case "finClearData":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can remove the finance data." }; break; }
                        await Task.Run(() => FinanceLens.ClearData());
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_clear_data", Outcome = "OK", Target = FinanceLens.Root });
                        data = new { ok = true };
                        break;
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
                            string src = PipeSrvStr(root, "source") == "USER" ? "USER" : "AUTO";
                            data = new { ok = true, updated = await Task.Run(() => FinanceLens.SetClasses(map, user, src)) };
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
                    case "finFusionCheck":      // which months are in sync: Fusion fingerprints against this PC
                        {
                            var co = root.GetProperty("options").Deserialize<FinanceFusion.CheckOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            var cts = FinNewCts(TimeSpan.FromMinutes(30));
                            data = await Task.Run(() => FinanceFusion.CheckAsync(FinRunner(PipeSrvStr(root, "pod")), co, FinProgress(wv, requestId), cts.Token));
                            break;
                        }
                    case "finFusionTb":         // trial balance of one ledger × period live from GL_BALANCES (read-only)
                        {
                            var to = root.GetProperty("options").Deserialize<FinanceFusion.TbOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            to.Pod = PipeSrvStr(root, "pod") ?? "";
                            var cts = FinNewCts(TimeSpan.FromMinutes(30));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            data = await Task.Run(() => FinanceFusion.TrialBalanceAsync(FinRunner(PipeSrvStr(root, "pod")), to, FinProgress(wv, requestId), cts.Token));
                            bool okTb = JsonSerializer.SerializeToElement(data).TryGetProperty("ok", out var okt) && okt.ValueKind == JsonValueKind.True;
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_fusion_tb", Outcome = okTb ? "OK" : "FAILED", DurationMs = sw.ElapsedMilliseconds,
                                Target = (PipeSrvStr(root, "pod") ?? "") + " · " + to.Ledger?.Name, Detail = to.PeriodSeq + (to.Companies?.Count > 0 ? " · " + string.Join(",", to.Companies) : "") });
                            break;
                        }
                    case "finTbSync":           // Data › Trial balance sync: periods of one ledger grouped by company × account → DuckDB, statements rebuilt from them
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                            var to = root.GetProperty("options").Deserialize<FinanceFusion.TbOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            to.Pod = PipeSrvStr(root, "pod") ?? "";
                            var cts = FinNewCts(TimeSpan.FromMinutes(60));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            data = await Task.Run(() => FinanceFusion.SyncTbAsync(FinRunner(PipeSrvStr(root, "pod")), to, FinProgress(wv, requestId), cts.Token));
                            bool okS = JsonSerializer.SerializeToElement(data).TryGetProperty("ok", out var oks) && oks.ValueKind == JsonValueKind.True;
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_tb_sync", Outcome = okS ? "OK" : "FAILED", DurationMs = sw.ElapsedMilliseconds,
                                Target = (PipeSrvStr(root, "pod") ?? "") + " · " + to.Ledger?.Name, Detail = string.Join(",", to.PeriodSeqs ?? new()) + (to.Companies?.Count > 0 ? " · " + string.Join(",", to.Companies) : "") });
                            break;
                        }
                    case "finTbSyncStatus":     // the synced trial balance periods on this PC
                        data = await Task.Run(() => FinanceLens.TbSyncStatus());
                        break;
                    case "finTbSyncDelete":     // forget synced periods (statements rebuilt)
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can remove finance data." }; break; }
                            var per = root.TryGetProperty("periods", out var pe) && pe.ValueKind == JsonValueKind.Array ? pe.EnumerateArray().Select(v => v.GetString()).Where(v => !string.IsNullOrEmpty(v)).ToList() : new List<string>();
                            long lid = root.TryGetProperty("ledgerId", out var li) && li.TryGetInt64(out var l2) ? l2 : 0;
                            data = await Task.Run(() => FinanceLens.TbSyncDelete(PipeSrvStr(root, "pod") ?? "", lid, per));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_tb_sync_delete", Outcome = "OK", Target = (PipeSrvStr(root, "pod") ?? "") + " · " + lid, Detail = string.Join(",", per) });
                            break;
                        }
                    case "finSegValuesSave":    // segment values kept elsewhere (APEX) → this PC (names / account types), statements rebuilt
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the finance data." }; break; }
                            var vals = root.TryGetProperty("values", out var vv) && vv.ValueKind == JsonValueKind.Array
                                ? vv.EnumerateArray().Select(v => new FinanceFusion.SegValue { Value = PipeSrvStr(v, "value"), Description = PipeSrvStr(v, "description"), AccountType = PipeSrvStr(v, "accountType"),
                                    Combinations = v.TryGetProperty("combinations", out var cb) && cb.TryGetInt64(out var cn) ? cn : 0 }).Where(v => !string.IsNullOrEmpty(v.Value)).ToList()
                                : new List<FinanceFusion.SegValue>();
                            string col = FinanceFusion.SegCol(PipeSrvStr(root, "column"));
                            if (col == null || vals.Count == 0) { data = new { ok = false, error = "No values." }; break; }
                            data = await Task.Run(() => { var w = FinanceLens.SaveSegmentValues(PipeSrvStr(root, "coaId"), col, vals); return (object)new { ok = true, saved = w, values = vals.Count, rebuilt = FinanceLens.RebuildTbIfActive() }; });
                            break;
                        }
                    case "finFusionRun":        // one read-only query in Fusion (the monitor's Run / Test query): first 50 rows, time
                        {
                            string sql = (PipeSrvStr(root, "sql") ?? "").Trim().TrimEnd(';');
                            if (!System.Text.RegularExpressions.Regex.IsMatch(sql, @"^(SELECT|WITH)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase) || sql.Contains(';'))
                            { data = new { ok = false, error = "Only one SELECT / WITH query." }; break; }
                            var cts = FinNewCts(TimeSpan.FromMinutes(5));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            var res = await FinRunner(PipeSrvStr(root, "pod"))(sql, 1000, cts.Token);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_fusion_run", Outcome = res.Success ? "OK" : "FAILED", DurationMs = sw.ElapsedMilliseconds, Target = PipeSrvStr(root, "pod") ?? "", Detail = sql.Length > 300 ? sql.Substring(0, 300) : sql });
                            var cols = res.Rows.Count > 0 ? res.Rows.SelectMany(r2 => r2.Keys).Distinct().ToList() : (res.Columns ?? new List<string>());
                            data = new { ok = res.Success, error = res.Error, rows = res.Rows.Count, capped = res.Capped, ms = sw.ElapsedMilliseconds, columns = cols,
                                         sample = res.Rows.Take(50).Select(r2 => cols.Select(c => r2.TryGetValue(c, out var v) ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : null).ToList()).ToList() };
                            break;
                        }
                    case "finTbSave":           // keep a live trial balance in DuckDB (fin_tb_live)
                        data = new { ok = true, rows = await Task.Run(() => FinanceLens.SaveTb(root, user)) };
                        break;
                    case "finFusionSegValues":  // all values of one segment (value set + use in GL_CODE_COMBINATIONS)
                        {
                            var cts = FinNewCts(TimeSpan.FromMinutes(20));
                            data = await Task.Run(() => FinanceFusion.SegmentValuesAsync(FinRunner(PipeSrvStr(root, "pod")), PipeSrvStr(root, "coaId"), PipeSrvStr(root, "column"), FinProgress(wv, requestId), cts.Token));
                            await Task.Run(() => FinanceLens.RebuildTbIfActive());   // names / types into the statements built from synced trial balances
                            break;
                        }
                    case "finSegValues":        // the values saved in the finance file
                        data = await Task.Run(() =>
                        {
                            string coa = PipeSrvStr(root, "coaId"), col = PipeSrvStr(root, "column");
                            var pend = FinanceLens.PendingSegValues(coa, col);   // read before any data was loaded: kept on this PC until the first load
                            if (pend != null && pend.Values != null)
                                return (object)new { ok = true, source = "pending", values = pend.Values.Select(v => new { value = v.Value, description = v.Description, combinations = v.Combinations, accountType = v.AccountType, fetchedAt = pend.FetchedAt.ToString("yyyy-MM-dd HH:mm") }) };
                            var t = FinanceLens.Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_segment_values'", 1);
                            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return (object)new { ok = true, values = Array.Empty<object>() };
                            var r = FinanceLens.Query("SELECT value, description, combinations, account_type, CAST(fetched_at AS VARCHAR) FROM fin_segment_values WHERE coa_id = " + FinanceLens.Lit(PipeSrvStr(root, "coaId")) +
                                                      " AND column_name = " + FinanceLens.Lit(PipeSrvStr(root, "column")) + " ORDER BY value", 200000);
                            return new { ok = r.Error == null, error = r.Error, source = "duckdb", values = r.Rows.Select(z => new { value = z[0], description = z[1], combinations = z[2], accountType = z[3], fetchedAt = z[4] }) };
                        });
                        break;
                    case "finBiccInspect":
                        {
                            var ov = root.TryGetProperty("map", out var mp) && mp.ValueKind == JsonValueKind.Object ? mp.Deserialize<System.Collections.Generic.Dictionary<string, string>>() : null;
                            data = await Task.Run(() => FinanceBicc.Inspect(PipeSrvStr(root, "folder"), ov));
                            break;
                        }
                    case "finBiccLoad":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                        {
                            var bo = root.GetProperty("options").Deserialize<FinanceBicc.LoadOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            bo.User = user;
                            var cts = FinNewCts(TimeSpan.FromHours(3));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            data = await Task.Run(() => FinanceBicc.Load(bo, FinProgress(wv, requestId), cts.Token));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_bicc_load", Outcome = JsonSerializer.SerializeToElement(data).GetProperty("ok").GetBoolean() ? "OK" : "FAILED",
                                DurationMs = sw.ElapsedMilliseconds, Target = string.Join(", ", bo.Ledgers.Select(l => l.Name)) });
                            break;
                        }
                    case "finUcmList":
                    case "finUcmDownload":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can read BICC files from UCM." }; break; }
                        {
                            var (origin, u, pw) = await FinPodLogin(PipeSrvStr(root, "pod"));
                            if (string.IsNullOrEmpty(pw)) { data = new { ok = false, error = "The Fusion credentials are not available." }; break; }
                            var cts = FinNewCts(TimeSpan.FromHours(1));
                            if (action == "finUcmList") data = await FinanceBicc.UcmListAsync(origin, u, pw, cts.Token);
                            else
                            {
                                var docs = root.GetProperty("docs").EnumerateArray().Select(d => (d.GetProperty("id").GetString(), d.TryGetProperty("title", out var tt) ? tt.GetString() : null)).ToList();
                                data = await FinanceBicc.UcmDownloadAsync(origin, u, pw, docs, PipeSrvStr(root, "folder"), FinProgress(wv, requestId), cts.Token);
                                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_ucm_download", Outcome = "OK", Target = docs.Count + " file(s)" });
                            }
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

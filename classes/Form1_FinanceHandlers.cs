using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
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
        private System.Threading.CancellationTokenSource _finAskCts;

        // Every long Fusion action gets its own token. Before, one shared token meant that ANY new action (an extended sync, the segment
        // values read after a TB sync, a Test query in the SQL dialog …) cancelled whatever was running. Now a sync of one kind refuses to
        // start while the same kind runs, a lookup only replaces the previous lookup of the same kind, and finCancel stops what it names.
        private sealed class FinJob { public string Action; public System.Threading.CancellationTokenSource Cts; public string Reason; public TimeSpan Limit; }
        private readonly Dictionary<string, FinJob> _finJobs = new();
        private static readonly System.Threading.AsyncLocal<FinJob> _finSlot = new();
        private static readonly HashSet<string> FIN_SYNCS = new(StringComparer.Ordinal)
        {
            "finFusionSync", "finTbSync", "finTbExtSync", "finCcidSync", "finBiccLoad", "finWcSync", "finWcItems", "finFusionDiscover", "finUcmDownload", "finFusionCheck", "finIcSync"
        };
        private static string FinLabel(string action) => action switch
        {
            "finTbSync" => "A trial balance sync", "finTbExtSync" => "An extended segments sync", "finCcidSync" => "A code combinations sync",
            "finFusionSync" => "A full GL load", "finBiccLoad" => "A BICC load", "finWcSync" => "A working capital sync", "finWcItems" => "An item master sync",
            "finFusionDiscover" => "A discovery", "finUcmDownload" => "A UCM download", "finFusionCheck" => "A Fusion check", "finIcSync" => "An intercompany sync", _ => "This action"
        };

        private System.Threading.CancellationTokenSource FinNewCts(TimeSpan limit)
        {
            var slot = _finSlot.Value ?? new FinJob { Action = "fin" };
            lock (_finJobs)
            {
                if (_finJobs.TryGetValue(slot.Action, out var prev) && !prev.Cts.IsCancellationRequested)
                {
                    if (FIN_SYNCS.Contains(slot.Action))
                        throw new InvalidOperationException(FinLabel(slot.Action) + " is already running on this PC - wait for it to finish or press Cancel first.");
                    prev.Reason = "Replaced by a newer request of the same kind.";
                    try { prev.Cts.Cancel(); } catch { }
                }
                slot.Cts = new System.Threading.CancellationTokenSource(limit);
                slot.Limit = limit;
                _finJobs[slot.Action] = slot;
                return slot.Cts;
            }
        }
        /// <summary>Stops the named action, or every running finance action when none is named.</summary>
        private int FinCancel(string only, string reason)
        {
            lock (_finJobs)
            {
                int n = 0;
                foreach (var j in _finJobs.Values.Where(j => string.IsNullOrEmpty(only) || j.Action == only).ToList())
                    if (!j.Cts.IsCancellationRequested) { j.Reason = reason; try { j.Cts.Cancel(); } catch { } n++; }
                return n;
            }
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
            var slot = new FinJob { Action = action };
            _finSlot.Value = slot;
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
                    case "finTbExtSync":        // Data › Trial balance sync › Extended segments: company × account × the chosen segments → fin_gl_balances_ext
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                            var to = root.GetProperty("options").Deserialize<FinanceFusion.TbOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            to.Pod = PipeSrvStr(root, "pod") ?? "";
                            var cts = FinNewCts(TimeSpan.FromHours(4));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            data = await Task.Run(() => FinanceFusion.SyncTbExtAsync(FinRunner(PipeSrvStr(root, "pod")), to, FinProgress(wv, requestId), cts.Token));
                            bool okE = JsonSerializer.SerializeToElement(data).TryGetProperty("ok", out var oke) && oke.ValueKind == JsonValueKind.True;
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_tb_ext_sync", Outcome = okE ? "OK" : "FAILED", DurationMs = sw.ElapsedMilliseconds,
                                Target = (PipeSrvStr(root, "pod") ?? "") + " · " + to.Ledger?.Name, Detail = string.Join(",", to.PeriodSeqs ?? new()) + " · " + string.Join(",", to.ExtSegments ?? new()) });
                            break;
                        }
                    case "finTbExtSql":         // Data › Trial balance sync › SQL dialog: the extended-segments query one period × company runs (nothing is sent to Fusion)
                        {
                            var to = root.GetProperty("options").Deserialize<FinanceFusion.TbOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            var led = to.Ledger;
                            if (led == null) { data = new { ok = false, error = "Pick a ledger." }; break; }
                            var segs = FinanceFusion.ExtSegs(led, to.ExtSegments);
                            led.Company = segs.FirstOrDefault(c => string.Equals(c, led.Company, StringComparison.OrdinalIgnoreCase)) ?? led.Company;
                            led.Account = segs.FirstOrDefault(c => string.Equals(c, led.Account, StringComparison.OrdinalIgnoreCase)) ?? led.Account;
                            string per = PipeSrvStr(root, "period") ?? "", co = PipeSrvStr(root, "company") ?? "", ac = PipeSrvStr(root, "account");
                            data = new { ok = true, segments = segs, sql = FinanceFusion.ExtSql(led, segs, to, null, per, co),
                                         sqlAccount = FinanceFusion.ExtSql(led, segs, to, null, per, co, new List<string> { string.IsNullOrEmpty(ac) ? "ACCOUNT" : ac }) };
                            break;
                        }
                    case "finCcidSync":         // every code combination of a chart → DuckDB fin_ccid, page by page (saved as it arrives, goes on from the highest id)
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                            string coaC = PipeSrvStr(root, "coaId") ?? "";
                            bool fullC = root.TryGetProperty("full", out var fC) && fC.ValueKind == JsonValueKind.True;
                            int pageC = root.TryGetProperty("pageSize", out var pC) && pC.TryGetInt32(out var pv) ? pv : 20000;
                            var cts = FinNewCts(TimeSpan.FromHours(4));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            data = await Task.Run(() => FinanceFusion.SyncCcidAsync(FinRunner(PipeSrvStr(root, "pod")), coaC, fullC, pageC, FinProgress(wv, requestId), cts.Token));
                            bool okC = JsonSerializer.SerializeToElement(data).TryGetProperty("ok", out var okc) && okc.ValueKind == JsonValueKind.True;
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_ccid_sync", Outcome = okC ? "OK" : "FAILED", DurationMs = sw.ElapsedMilliseconds,
                                Target = (PipeSrvStr(root, "pod") ?? "") + " · chart " + coaC, Detail = fullC ? "full" : "new only" });
                            break;
                        }
                    case "finCcidStatus":
                        data = await Task.Run(() => FinanceLens.CcidStatus(PipeSrvStr(root, "coaId") ?? ""));
                        break;
                    case "finTbExtAcctStatus":   // per-account results of the account-by-account extended reads (ok / empty / failed)
                        data = await Task.Run(() => FinanceLens.ExtAcctStatus(PipeSrvStr(root, "pod") ?? "", root.TryGetProperty("ledgerId", out var lidE) && lidE.TryGetInt64(out var lidV) ? lidV : 0));
                        break;
                    case "finTbExtStatus":
                        data = await Task.Run(() => FinanceLens.ExtStatus());
                        break;
                    case "finTbSync":           // Data › Trial balance sync: periods of one ledger grouped by company × account → DuckDB, statements rebuilt from them
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                            var to = root.GetProperty("options").Deserialize<FinanceFusion.TbOptions>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            to.Pod = PipeSrvStr(root, "pod") ?? "";
                            var cts = FinNewCts(TimeSpan.FromHours(3));
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
                    case "finWcSync":           // debtors / creditors / stock on hand from the Fusion subledgers → DuckDB snapshots
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                            var o = JsonSerializer.Deserialize<FinanceWorkingCapital.Options>(root.TryGetProperty("options", out var oe) ? oe.GetRawText() : "{}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new FinanceWorkingCapital.Options();
                            var cts = FinNewCts(TimeSpan.FromMinutes(30));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            var res = await Task.Run(() => FinanceWorkingCapital.SyncAsync(FinRunner(o.Pod), o, FinProgress(wv, requestId), cts.Token));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_wc_sync", Outcome = "OK", DurationMs = sw.ElapsedMilliseconds, Target = o.Pod ?? "", Detail = string.Join(",", o.Kinds ?? new List<string>()) });
                            data = new { ok = true, results = res, buckets = FinanceWorkingCapital.BucketNames(o.Buckets) };
                            break;
                        }
                    case "finIcSync":           // Inter company: FUN / AR / AP / INV / GL / BAL per month (+ legal entities) from Fusion → DuckDB rr_ic_*
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                            var o = JsonSerializer.Deserialize<FinanceIntercompany.Options>(root.TryGetProperty("options", out var oe) ? oe.GetRawText() : "{}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new FinanceIntercompany.Options();
                            var cts = FinNewCts(TimeSpan.FromHours(3));
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            var res = await Task.Run(() => FinanceIntercompany.SyncAsync(FinRunner(o.Pod), o, user, FinProgress(wv, requestId), cts.Token));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_ic_sync", Outcome = "OK", DurationMs = sw.ElapsedMilliseconds, Target = o.Pod ?? "",
                                Detail = string.Join(",", o.Kinds ?? new List<string>()) + " · " + string.Join(",", o.Months ?? new List<int>()) });
                            data = new { ok = true, results = res };
                            break;
                        }
                    case "finIcStatus":         // the intercompany reads kept on this PC (month board, checklist)
                        data = await Task.Run(() => FinanceLens.IcStatus(PipeSrvStr(root, "pod") ?? ""));
                        break;
                    case "finIcDelete":         // forget intercompany months / kinds on this PC
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the finance data." }; break; }
                            var ks = root.TryGetProperty("kinds", out var ke) && ke.ValueKind == JsonValueKind.Array ? ke.EnumerateArray().Select(x => x.GetString()).ToList() : new List<string>();
                            var ms = root.TryGetProperty("months", out var mse) && mse.ValueKind == JsonValueKind.Array ? mse.EnumerateArray().Select(x => x.GetInt32()).ToList() : new List<int>();
                            data = await Task.Run(() => FinanceLens.IcDelete(PipeSrvStr(root, "pod") ?? "", ks, ms));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_ic_delete", Outcome = "OK", Target = PipeSrvStr(root, "pod") ?? "", Detail = string.Join(",", ks) + " · " + string.Join(",", ms) });
                            break;
                        }
                    case "finIcSql":            // the queries one kind × month (× ledger) would run — nothing is sent to Fusion
                        {
                            var o = JsonSerializer.Deserialize<FinanceIntercompany.Options>(root.TryGetProperty("options", out var oe) ? oe.GetRawText() : "{}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new FinanceIntercompany.Options();
                            string kind = (PipeSrvStr(root, "kind") ?? "").ToUpperInvariant();
                            int month = root.TryGetProperty("month", out var mo) && mo.ValueKind == JsonValueKind.Number ? mo.GetInt32() : DateTime.Today.Year * 100 + DateTime.Today.Month;
                            var led = (o.Ledgers ?? new()).FirstOrDefault(l => l.Id == PipeSrvStr(root, "ledger")) ?? (o.Ledgers ?? new()).FirstOrDefault();
                            var subs = kind == "ENT" ? new[] { "ENT", "ENT_BU", "ENT_ORG" } : new[] { kind };
                            data = new { ok = true, kind, month, alternatives = subs.SelectMany(k => FinanceIntercompany.Alternatives(k, month, led, o)).Select(a => new { label = a.Label, sql = a.Sql }).ToList() };
                            break;
                        }
                    case "finWcDetail":         // the open items of one customer / supplier, or the on-hand lines of one item, live (≤ 500)
                        {
                            var cts = FinNewCts(TimeSpan.FromMinutes(5));
                            string kind = PipeSrvStr(root, "kind"), party = PipeSrvStr(root, "party");
                            data = await FinanceWorkingCapital.DetailAsync(FinRunner(PipeSrvStr(root, "pod")), kind, party, PipeSrvStr(root, "bu"), cts.Token);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_wc_detail", Outcome = "OK", Target = kind ?? "", Detail = party ?? "" });
                            break;
                        }
                    case "finWcHistory":        // one customer / supplier: profile, invoices, payments, credit notes … — this PC first, else Fusion (kept in fin_wc_history)
                        {
                            var cts = FinNewCts(TimeSpan.FromMinutes(10));
                            string kind = PipeSrvStr(root, "kind"), party = PipeSrvStr(root, "party"), pod = PipeSrvStr(root, "pod") ?? "";
                            bool refresh = root.TryGetProperty("refresh", out var rfe) && rfe.ValueKind == JsonValueKind.True;
                            int months = root.TryGetProperty("months", out var me) && me.ValueKind == JsonValueKind.Number ? me.GetInt32() : 24;
                            data = await Task.Run(() => FinanceWorkingCapital.HistoryAsync(FinRunner(pod), pod, kind, party, months, refresh, FinProgress(wv, requestId), cts.Token));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_wc_history", Outcome = "OK", Target = kind ?? "", Detail = (party ?? "") + (refresh ? " · refresh" : "") });
                            break;
                        }
                    case "finWcItems":          // item master + DFF columns of the stock organisations → fin_items
                    case "finWcItemDff":        // item DFF labels → fin_item_dff
                    case "finWcNames":          // business unit / organisation names for the kept snapshots
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can load finance data." }; break; }
                            var cts = FinNewCts(TimeSpan.FromMinutes(action == "finWcItems" ? 60 : 5));
                            string pod = PipeSrvStr(root, "pod") ?? "";
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            if (action == "finWcItems")
                            {
                                var io = JsonSerializer.Deserialize<FinanceWorkingCapital.ItemOptions>(root.TryGetProperty("options", out var oe2) ? oe2.GetRawText() : "{}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new FinanceWorkingCapital.ItemOptions();
                                io.Pod = pod;
                                data = await Task.Run(() => FinanceWorkingCapital.ItemsAsync(FinRunner(pod), io, FinProgress(wv, requestId), cts.Token));
                            }
                            else if (action == "finWcItemDff") data = await Task.Run(() => FinanceWorkingCapital.ItemDffAsync(FinRunner(pod), pod, cts.Token));
                            else data = await Task.Run(() => FinanceWorkingCapital.NamesSyncAsync(FinRunner(pod), pod, cts.Token));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = action == "finWcItems" ? "fin_wc_items" : action == "finWcItemDff" ? "fin_wc_item_dff" : "fin_wc_names", Outcome = "OK", DurationMs = sw.ElapsedMilliseconds, Target = pod });
                            break;
                        }
                    case "finWcNamesSave":      // business unit / organisation names typed on the page
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the finance data." }; break; }
                            var nm = root.TryGetProperty("names", out var ne) && ne.ValueKind == JsonValueKind.Object ? ne.Deserialize<System.Collections.Generic.Dictionary<string, string>>() : new System.Collections.Generic.Dictionary<string, string>();
                            data = await Task.Run(() => FinanceWorkingCapital.NamesSave(PipeSrvStr(root, "pod") ?? "", PipeSrvStr(root, "kind"), nm));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_wc_names_save", Outcome = "OK", Target = PipeSrvStr(root, "kind") ?? "", Detail = nm.Count + " name(s)" });
                            break;
                        }
                    case "finWcDefaults":
                        data = new { ok = true, ar = FinanceWorkingCapital.AR_DEFAULT, ap = FinanceWorkingCapital.AP_DEFAULT, inv = FinanceWorkingCapital.INV_DEFAULT };
                        break;
                    case "finWcCostTables":     // candidate unit-cost tables (ALL_TAB_COLUMNS)
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the finance data." }; break; }
                            var cts = FinNewCts(TimeSpan.FromMinutes(5));
                            data = await FinanceWorkingCapital.CostTablesAsync(FinRunner(PipeSrvStr(root, "pod")), cts.Token);
                            break;
                        }
                    case "finPlanSave":         // Planning: one version (header, lines, monthly amounts) → DuckDB fin_plan_* (the page also saves it in APEX)
                        {
                            int n = await Task.Run(() => FinanceLens.SavePlan(root, user));
                            string ev = PipeSrvStr(root, "event");
                            if (!string.IsNullOrEmpty(ev))
                                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = "fin_plan_" + ev, Outcome = "OK",
                                    Target = root.TryGetProperty("version", out var pv) ? (pv.TryGetProperty("name", out var pn) ? pn.GetString() : "") : "" });
                            data = new { ok = true, lines = n };
                            break;
                        }
                    case "finPlanDelete":
                        await Task.Run(() => FinanceLens.DeletePlan(PipeSrvStr(root, "id")));
                        data = new { ok = true };
                        break;
                    case "finPlanList":
                        data = new { ok = true, versions = await Task.Run(() => FinanceLens.PlanList()) };
                        break;
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
                    case "finSegValuesStatus":  // which segments already have their values on this PC (ticks on Chart of accounts)
                        data = await Task.Run(() => (object)new { ok = true, segments = FinanceLens.SegValuesStatus() });
                        break;
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
                        data = new { ok = true, stopped = FinCancel(PipeSrvStr(root, "what"), "Stopped - Cancel was pressed.") };
                        break;
                    case "finAsk":
                        {
                            if (!await AiControl.IsEnabledAsync(user)) { data = new { ok = false, error = "The AI is paused (AI Digital Employee › Control)." }; break; }
                            _finAskCts?.Dispose();
                            _finAskCts = new System.Threading.CancellationTokenSource(TimeSpan.FromMinutes(10));
                            var history = root.TryGetProperty("history", out var hh) ? hh.Clone() : default;
                            string question = PipeSrvStr(root, "question") ?? "";
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            string skill = PipeSrvStr(root, "skill");
                            // the read-only Fusion subledger tool (reconciliations) is for AI admins
                            var fusion = await AiControl.IsAdminAsync(user) ? FinRunner(PipeSrvStr(root, "pod")) : null;
                            var r = await FinanceAskAgent.AskAsync(question, history, PipeSrvStr(root, "context"), PipeSrvStr(root, "model"), FinProgress(wv, requestId), _finAskCts.Token, skill, fusion);
                            double? cost = null;
                            try { cost = await AiControl.CostAsync(r.Model, r.TokensIn, r.TokensOut, r.CacheRead, r.CacheWrite, user); } catch { }
                            AiControl.Audit(new AiControl.AuditEvent
                            {
                                User = user, Source = "FINANCE", Action = "turn", Outcome = r.Ok ? "OK" : "FAILED", Model = r.Model,
                                TokensIn = r.TokensIn, TokensOut = r.TokensOut, CacheRead = r.CacheRead, CacheWrite = r.CacheWrite, CostUsd = cost, DurationMs = sw.ElapsedMilliseconds,
                                Detail = (string.IsNullOrEmpty(skill) ? "" : "[skill " + skill + "] ") + (question.Length > 300 ? question.Substring(0, 300) : question) + (r.Ok ? "" : " · " + r.Error)
                            });
                            data = new { ok = r.Ok, error = r.Error, answer = r.Answer, steps = r.Steps, queries = r.Queries, costUsd = cost };
                            break;
                        }
                    case "finSkills":
                        data = new { ok = true, dir = FinanceSkills.CustomDir, skills = FinanceSkills.List().Select(k => new { name = k.Name, title = k.Title, description = k.Description, source = k.Source, uses = k.Uses, custom = k.Custom, body = k.Body }) };
                        break;
                    case "finSkillSave":
                    case "finSkillDelete":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the finance skills." }; break; }
                            string nm = (PipeSrvStr(root, "name") ?? "").Trim().ToLowerInvariant();
                            bool done = true;
                            if (action == "finSkillSave") FinanceSkills.SaveCustom(nm, PipeSrvStr(root, "text"));
                            else done = FinanceSkills.DeleteCustom(nm);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = action == "finSkillSave" ? "skill_save" : "skill_delete", Outcome = done ? "OK" : "NOT_FOUND", Detail = nm });
                            data = new { ok = done, error = done ? null : "No custom skill " + nm };
                            break;
                        }
                    case "finAskCancel":
                        _finAskCts?.Cancel();
                        data = new { ok = true };
                        break;
                    // ── board pack e-mail (FinanceMail.cs): Outlook desktop, Microsoft 365 (Graph) or SMTP, set up per PC ──
                    case "finMailStatus":
                        data = await FinanceMail.StatusAsync(user);
                        break;
                    case "finMailSave":
                        {
                            var ms = JsonSerializer.Deserialize<FinanceMail.Settings>(PipeSrvStr(root, "settings") ?? "{}", new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new FinanceMail.Settings();
                            FinanceMail.Save(ms);
                            string pw = PipeSrvStr(root, "smtpPassword");
                            if (ms.Method == "SMTP" || !string.IsNullOrEmpty(pw)) { if (!string.IsNullOrWhiteSpace(ms.SmtpUser)) SmtpVault.Save(ms.SmtpServer, ms.SmtpPort, ms.SmtpUser, pw); }
                            data = await FinanceMail.StatusAsync(user);
                            break;
                        }
                    case "finMailSignIn":
                        using (var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5)))
                            data = new { ok = true, account = await FinanceMail.SignInAsync(user, cts.Token) };
                        break;
                    case "finMailSignOut":
                        await FinanceMail.SignOutAsync(user);
                        data = new { ok = true };
                        break;
                    case "finMailTest":
                    case "finMailSend":
                        {
                            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
                            object r;
                            FinanceMail.Message msg = null;
                            if (action == "finMailTest") r = await FinanceMail.TestAsync(user, PipeSrvStr(root, "method"), PipeSrvStr(root, "to"), cts.Token);
                            else { msg = FinanceMail.FromJson(root); r = await FinanceMail.SendAsync(user, msg, PipeSrvStr(root, "method"), cts.Token); }
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FINANCE", Action = action == "finMailTest" ? "mail_test" : "pack_email", Outcome = "OK",
                                Detail = msg == null ? "test" : (msg.Subject + " → " + string.Join("; ", FinanceMail.Addresses(msg.To).Concat(FinanceMail.Addresses(msg.Cc)))) });
                            data = r;
                            break;
                        }
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
            finally
            {
                if (slot.Cts != null)
                    lock (_finJobs) { if (_finJobs.TryGetValue(action, out var cur) && ReferenceEquals(cur, slot)) _finJobs.Remove(action); }
            }
            // say WHY a run stopped instead of a bare "Cancelled."
            if (slot.Cts != null && slot.Cts.IsCancellationRequested)
            {
                try
                {
                    if (JsonSerializer.SerializeToNode(data) is System.Text.Json.Nodes.JsonObject node && node["error"] is System.Text.Json.Nodes.JsonValue ev && ev.TryGetValue<string>(out var es) && es == "Cancelled.")
                    {
                        node["error"] = slot.Reason ?? ("Stopped after its time limit of " + (slot.Limit.TotalHours >= 1 ? slot.Limit.TotalHours.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " h" : slot.Limit.TotalMinutes.ToString("0", System.Globalization.CultureInfo.InvariantCulture) + " min") + " - what was read so far is kept; Sync again to go on.");
                        data = node;
                    }
                }
                catch { }
            }
            try { slot.Cts?.Dispose(); } catch { }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "finResponse", requestId, data }));
        }
    }
}

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// AI Agent (aiagent/ page + ai-hub/ai_hub/agents): the host side of the tools the LangGraph specialists call.
    /// agent* IPC actions, reply agentResponse.
    ///   agentIssue   policy for a tool (AUTO / ASK / DENY); for ASK the host registers the confirm card it is about to
    ///                show (fingerprint of tool + exact input + pod, one use, 12 h) - nothing else can satisfy agentTool
    ///   agentTool    runs a host tool: Fusion dictionary (read-only, cached), fusion_sql_dry_run (COUNT(*) + 5 sample
    ///                rows), fusion_sql_run (BI Publisher runner → result cache, the model gets a summary), result_analyze
    ///                (group / aggregate a cached result, no new Fusion call), mra_interface (MRAProcessor, two gateway
    ///                problems in a row stop the batch), inbox_list / inbox_request (AI inbox, Teams / e-mail alerts)
    ///   agentConfirm the page's own "act" tools (save query, watchdog, order pad, job) consume their card here first
    ///   agentResult  rows of a cached result for the grid / chart / export
    /// "act" tools check the AI kill switch and write WMS_AI_AUDIT (source AIAGENT). The Fusion password never leaves C#.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private ConcurrentDictionary<string, AgentResult> _agentResults;
        private ConcurrentQueue<string> _agentResultOrder;

        private sealed class AgentResult
        {
            public string Id, Title, Sql, Pod, User;
            public List<string> Columns = new List<string>();
            public List<Dictionary<string, object>> Rows = new List<Dictionary<string, object>>();
            public bool Capped;
            public long ElapsedMs;
            public DateTime At = DateTime.Now;
        }

        private static readonly string[] AGENT_ACT_TOOLS = { "fusion_sql_run", "mra_interface", "inbox_request", "save_query", "watchdog_create", "om_prepare_order", "schedule_job" };
        private const int AGENT_MAX_RESULTS = 30;

        private static bool IsAiAgentAction(string action) =>
            action != null && action.StartsWith("agent", StringComparison.Ordinal);

        private async Task HandleAiAgentAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            string user = PipeSrvStr(root, "appUser");
            var cli = GetClaudeCliService();
            if (!string.IsNullOrWhiteSpace(user) && user != "UNKNOWN") cli.AppUser = user;
            user = cli.PolicyUser;
            try
            {
                string tool = PipeSrvStr(root, "tool") ?? "";
                string pod = (PipeSrvStr(root, "pod") ?? "PROD").ToUpperInvariant() == "TEST" ? "TEST" : "PROD";
                string input = root.TryGetProperty("input", out var inEl) && inEl.ValueKind == JsonValueKind.Object ? JsonSerializer.Serialize(inEl) : "{}";
                switch (action)
                {
                    case "agentIssue":
                        data = await AgentIssueAsync(tool, input, pod, user);
                        break;
                    case "agentConfirm":
                        data = await AgentConfirmAsync(tool, input, pod, user);
                        break;
                    case "agentTool":
                        data = await AgentToolAsync(tool, inEl, input, pod, user,
                            root.TryGetProperty("approved", out var ap) && ap.ValueKind == JsonValueKind.True);
                        break;
                    case "agentResult":
                        data = AgentResultRows(PipeSrvStr(root, "resultId"), PipeSrvInt(root, "offset", 0), PipeSrvInt(root, "limit", 5000), user);
                        break;
                    default:
                        data = new { ok = false, error = "Unknown AI Agent action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[AiAgent] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "agentResponse", requestId, data }));
        }

        private static string AgentPolicyKey(string tool) => tool switch
        {
            "fusion_sql_run" => "fusion_query",
            "mra_interface" => "mra_interface",
            "inbox_request" => "inbox_request",
            "save_query" => "fusion_save",
            "watchdog_create" => "fusion_watchdog",
            "om_prepare_order" => "om_prepare",
            "schedule_job" => "agent_job",
            _ => null
        };

        // ── confirm cards ──────────────────────────────────────
        private async Task<object> AgentIssueAsync(string tool, string input, string pod, string user)
        {
            string key = AgentPolicyKey(tool);
            if (key == null) return new { ok = true, mode = "AUTO" };
            if (!await AiControl.IsEnabledAsync(user)) return new { ok = false, paused = true, error = "AI is paused (AI Digital Employee › Control)." };
            var (mode, maxBatch) = await GetClaudeCliService().PolicyAsync(key, pod);
            if (mode == "DENY")
            {
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = tool, Outcome = "DENIED", Instance = pod, Detail = "policy " + key + " = DENY" });
                return new { ok = false, denied = true, mode, error = "Your policy does not allow " + key + " on " + pod + "." };
            }
            // AUTO is honoured only for small runs: a big Fusion query or MRA batch still gets a card
            if (mode == "AUTO" && tool == "fusion_sql_run" && pod == "PROD" && AgentInt(input, "row_limit", 5000) > (maxBatch ?? 5000)) mode = "ASK";
            if (mode == "AUTO" && tool == "mra_interface" && AgentArrayLen(input, "orders") > (maxBatch ?? 5)) mode = "ASK";
            if (mode != "AUTO") GetClaudeCliService().IssueApproval("agent_tool", tool, input, pod);
            return new { ok = true, mode, maxBatch, policy = key };
        }

        /// <summary>Card decision for an act tool: policy re-checked (DENY since the card wins), approval consumed.</summary>
        private async Task<(bool Ok, string Error)> AgentGateAsync(string tool, string input, string pod, string user, bool approved)
        {
            string key = AgentPolicyKey(tool);
            if (key == null) return (true, null);
            if (!await AiControl.IsEnabledAsync(user)) return (false, "AI is paused (AI Digital Employee › Control).");
            var (mode, maxBatch) = await GetClaudeCliService().PolicyAsync(key, pod);
            if (mode == "DENY") return (false, "Your policy does not allow " + key + " on " + pod + ".");
            bool needCard = mode != "AUTO" ||
                            (tool == "fusion_sql_run" && pod == "PROD" && AgentInt(input, "row_limit", 5000) > (maxBatch ?? 5000)) ||
                            (tool == "mra_interface" && AgentArrayLen(input, "orders") > (maxBatch ?? 5));
            if (needCard && !(approved && GetClaudeCliService().ConsumeApproval("agent_tool", tool, input, pod)))
                return (false, "Not confirmed: this needs the confirm card the app showed for exactly this input.");
            return (true, null);
        }

        private async Task<object> AgentConfirmAsync(string tool, string input, string pod, string user)
        {
            if (!AGENT_ACT_TOOLS.Contains(tool)) return new { ok = false, error = "Not an action tool." };
            var (ok, err) = await AgentGateAsync(tool, input, pod, user, true);
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = tool, Outcome = ok ? "APPROVED" : "REFUSED", Approval = "CARD", Instance = pod, Detail = ok ? AgentShort(input) : err });
            return ok ? new { ok = true } : (object)new { ok = false, error = err };
        }

        // ── tools ──────────────────────────────────────────────
        private async Task<object> AgentToolAsync(string tool, JsonElement inEl, string input, string pod, string user, bool approved)
        {
            var args = inEl.ValueKind == JsonValueKind.Object
                ? inEl.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone())
                : new Dictionary<string, JsonElement>();
            string S(string k) => args.TryGetValue(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : null;

            if (AGENT_ACT_TOOLS.Contains(tool))
            {
                var (ok, err) = await AgentGateAsync(tool, input, pod, user, approved);
                if (!ok)
                {
                    AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = tool, Outcome = "REFUSED", Instance = pod, Detail = err });
                    return new { ok = false, content = err };
                }
            }
            _fusionSqlInstance = pod;
            var svc = GetFusionSqlService();
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(6));
            switch (tool)
            {
                case "fusion_search_objects":
                case "fusion_search_columns":
                case "fusion_describe":
                case "fusion_source":
                case "fusion_dependencies":
                    {
                        string inner = tool switch
                        {
                            "fusion_search_objects" => "search_objects",
                            "fusion_search_columns" => "search_columns",
                            "fusion_describe" => "describe_object",
                            "fusion_source" => "get_source",
                            _ => "get_dependencies"
                        };
                        string text = await FusionSqlAi.RunDictionaryToolAsync(svc, inner, args, cts.Token);
                        return new { ok = !text.StartsWith("ERROR", StringComparison.Ordinal), content = text };
                    }
                case "fusion_sql_dry_run":
                    return await AgentDryRunAsync(svc, S("sql"), pod, cts.Token);
                case "fusion_sql_run":
                    {
                        string sql = AgentCleanSql(S("sql"));
                        int limit = Math.Clamp(AgentInt(input, "row_limit", 5000), 1, 50000);
                        var sw = Stopwatch.StartNew();
                        var r = await svc.ExecuteAsync(sql, limit, cts.Token);
                        AiControl.Audit(new AiControl.AuditEvent
                        {
                            User = user, Source = "AIAGENT", Action = tool, Outcome = r.Success ? "OK" : "FAILED", Approval = approved ? "CARD" : "AUTO",
                            Instance = pod, DurationMs = sw.ElapsedMilliseconds, Target = "rows:" + r.RowCount, Detail = (S("title") ?? "") + " | " + AgentShort(sql)
                        });
                        if (!r.Success) return new { ok = false, content = "ERROR: " + r.Error };
                        var res = AgentStore(new AgentResult { Title = S("title") ?? "Fusion result", Sql = sql, Pod = pod, User = user, Columns = r.Columns, Rows = r.Rows, Capped = r.Capped, ElapsedMs = r.ElapsedMs });
                        var summary = AgentSummary(res, 20);
                        return new { ok = true, content = JsonSerializer.Serialize(summary), data = summary };
                    }
                case "result_analyze":
                    return AgentAnalyze(args, user);
                case "mra_interface":
                    return await AgentMraAsync(args, pod, user);
                case "inbox_list":
                    {
                        string st = (S("status") ?? "PENDING").ToUpperInvariant();
                        if (!Regex.IsMatch(st, "^[A-Z]{3,12}$")) st = "PENDING";
                        await AiControl.EnsureTablesAsync(user);
                        var rows = await AiControl.QueryAsync("SELECT inbox_id, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created, source, requested_by, action_key, instance, title, status, decided_by " +
                            "FROM wms_ai_inbox WHERE status = " + AiControl.Lit(st, 20) + " ORDER BY inbox_id DESC FETCH FIRST 50 ROWS ONLY", user);
                        return new { ok = true, content = rows.Count == 0 ? "No " + st.ToLowerInvariant() + " requests." : JsonSerializer.Serialize(rows), data = new { rows } };
                    }
                case "inbox_request":
                    {
                        string title = S("title") ?? "AI Agent request", detail = S("detail") ?? "", kind = Regex.Replace(S("kind") ?? "request", "[^A-Za-z0-9_]", "");
                        string sig = "AIAGENT:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(user + "|" + title + "|" + detail))).Substring(0, 32);
                        var (id, status, _) = await AiControl.InboxCreateAsync(user, "AIAGENT", "agent_" + kind, pod, "agent", sig, title, detail, input);
                        return new { ok = true, content = "Request #" + id + " is " + status + " in the AI inbox; approvers were alerted.", data = new { inbox_id = id, status } };
                    }
                default:
                    return new { ok = false, content = "The app has no host tool " + tool + "." };
            }
        }

        private static string AgentCleanSql(string sql) => Regex.Replace((sql ?? "").Trim(), @";\s*$", "");

        private static async Task<object> AgentDryRunAsync(FusionSqlService svc, string sql, string pod, CancellationToken ct)
        {
            sql = AgentCleanSql(sql);
            if (!Regex.IsMatch(sql, @"^\s*(SELECT|WITH)\b", RegexOptions.IgnoreCase))
                return new { ok = false, content = "Only one SELECT or WITH statement is allowed." };
            var count = await svc.ExecuteAsync("SELECT COUNT(*) AS N FROM (\n" + sql + "\n)", 1, ct);
            if (!count.Success) return new { ok = false, content = "ERROR: " + count.Error };
            long n = 0;
            if (count.Rows.Count > 0) long.TryParse(Convert.ToString(count.Rows[0].Values.FirstOrDefault(), CultureInfo.InvariantCulture), out n);
            var sample = await svc.ExecuteAsync(sql, 5, ct);
            if (!sample.Success) return new { ok = false, content = "ERROR: " + sample.Error };
            var cols = sample.Columns.Select(c => new { name = c, type = AgentColType(sample.Rows, c) }).ToList();
            var rows = sample.Rows.Select(r => sample.Columns.ToDictionary(c => c, c => AgentCell(r.TryGetValue(c, out var v) ? v : null))).ToList();
            var d = new { pod, count = n, columns = cols, sample = rows, ms = count.ElapsedMs + sample.ElapsedMs };
            return new { ok = true, content = JsonSerializer.Serialize(d), data = d };
        }

        // ── result cache ───────────────────────────────────────
        private AgentResult AgentStore(AgentResult r)
        {
            _agentResults ??= new ConcurrentDictionary<string, AgentResult>();
            _agentResultOrder ??= new ConcurrentQueue<string>();
            r.Id = "res_" + Guid.NewGuid().ToString("N").Substring(0, 10);
            _agentResults[r.Id] = r;
            _agentResultOrder.Enqueue(r.Id);
            while (_agentResultOrder.Count > AGENT_MAX_RESULTS && _agentResultOrder.TryDequeue(out var old)) _agentResults.TryRemove(old, out _);
            return r;
        }

        private AgentResult AgentGet(string id, string user)
        {
            if (string.IsNullOrEmpty(id) || _agentResults == null || !_agentResults.TryGetValue(id, out var r)) return null;
            return string.Equals(r.User, user, StringComparison.OrdinalIgnoreCase) ? r : null;
        }

        private object AgentResultRows(string id, int offset, int limit, string user)
        {
            var r = AgentGet(id, user);
            if (r == null) return new { ok = false, error = "This result is no longer in memory (results are kept while the app runs) — ask again to re-run it." };
            var rows = r.Rows.Skip(Math.Max(0, offset)).Take(Math.Clamp(limit, 1, 50000))
                .Select(x => r.Columns.Select(c => x.TryGetValue(c, out var v) ? v : null).ToArray()).ToList();
            return new { ok = true, result_id = r.Id, title = r.Title, sql = r.Sql, pod = r.Pod, columns = r.Columns.Select(c => new { name = c, type = AgentColType(r.Rows, c) }), rows, row_count = r.Rows.Count, capped = r.Capped, elapsed_ms = r.ElapsedMs };
        }

        private static string AgentCell(object v)
        {
            string s = Convert.ToString(v, CultureInfo.InvariantCulture);
            return s != null && s.Length > 120 ? s.Substring(0, 117) + "…" : s;
        }

        private static bool AgentNum(object v, out double d)
        {
            d = 0;
            string s = Convert.ToString(v, CultureInfo.InvariantCulture);
            return !string.IsNullOrWhiteSpace(s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d);
        }

        private static string AgentColType(List<Dictionary<string, object>> rows, string col)
        {
            int seen = 0, num = 0, date = 0;
            foreach (var r in rows.Take(500))
            {
                if (!r.TryGetValue(col, out var v)) continue;
                string s = Convert.ToString(v, CultureInfo.InvariantCulture);
                if (string.IsNullOrWhiteSpace(s)) continue;
                seen++;
                if (AgentNum(s, out _) && !Regex.IsMatch(s, @"^0\d")) num++;
                else if (Regex.IsMatch(s, @"^\d{4}-\d{2}-\d{2}")) date++;
            }
            return seen == 0 ? "text" : num == seen ? "number" : date == seen ? "date" : "text";
        }

        private static object AgentSummary(AgentResult r, int sampleRows)
        {
            var stats = r.Columns.Select(c =>
            {
                string type = AgentColType(r.Rows, c);
                int nulls = 0;
                var distinct = new HashSet<string>();
                double sum = 0, min = double.MaxValue, max = double.MinValue;
                string tmin = null, tmax = null;
                foreach (var row in r.Rows)
                {
                    string s = Convert.ToString(row.TryGetValue(c, out var v) ? v : null, CultureInfo.InvariantCulture);
                    if (string.IsNullOrEmpty(s)) { nulls++; continue; }
                    if (distinct.Count < 1000) distinct.Add(s);
                    if (type == "number" && AgentNum(s, out var d)) { sum += d; min = Math.Min(min, d); max = Math.Max(max, d); }
                    else { if (tmin == null || string.CompareOrdinal(s, tmin) < 0) tmin = s; if (tmax == null || string.CompareOrdinal(s, tmax) > 0) tmax = s; }
                }
                bool any = r.Rows.Count > nulls;
                return new Dictionary<string, object>
                {
                    ["name"] = c, ["type"] = type, ["nulls"] = nulls, ["distinct"] = distinct.Count >= 1000 ? "1000+" : (object)distinct.Count,
                    ["min"] = !any ? null : type == "number" ? Math.Round(min, 4) : (object)AgentCell(tmin),
                    ["max"] = !any ? null : type == "number" ? Math.Round(max, 4) : (object)AgentCell(tmax),
                    ["sum"] = type == "number" && any ? Math.Round(sum, 4) : (object)null
                };
            }).ToList();
            var first = r.Rows.Take(sampleRows).Select(x => r.Columns.ToDictionary(c => c, c => AgentCell(x.TryGetValue(c, out var v) ? v : null))).ToList();
            return new { result_id = r.Id, title = r.Title, pod = r.Pod, row_count = r.Rows.Count, capped = r.Capped, elapsed_ms = r.ElapsedMs, columns = stats, first_rows = first };
        }

        private object AgentAnalyze(Dictionary<string, JsonElement> args, string user)
        {
            string id = args.TryGetValue("result_id", out var idEl) ? idEl.GetString() : null;
            var src = AgentGet(id, user);
            if (src == null) return new { ok = false, content = "No result " + id + " (run the query first)." };
            List<string> Arr(string k) => args.TryGetValue(k, out var a) && a.ValueKind == JsonValueKind.Array
                ? a.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()).ToList() : new List<string>();
            string Col(string name) => src.Columns.FirstOrDefault(c => string.Equals(c, name, StringComparison.OrdinalIgnoreCase));
            var groups = Arr("group_by").Select(Col).ToList();
            if (groups.Any(g => g == null)) return new { ok = false, content = "Unknown group_by column. Columns: " + string.Join(", ", src.Columns) };
            var measures = new List<(string Col, string Agg)>();
            if (args.TryGetValue("measures", out var mEl) && mEl.ValueKind == JsonValueKind.Array)
                foreach (var m in mEl.EnumerateArray())
                {
                    string c = m.TryGetProperty("column", out var ce) ? Col(ce.GetString()) : null;
                    string a = m.TryGetProperty("agg", out var ae) ? (ae.GetString() ?? "").ToLowerInvariant() : "sum";
                    if (c == null && a != "count") return new { ok = false, content = "Unknown measure column. Columns: " + string.Join(", ", src.Columns) };
                    measures.Add((c ?? src.Columns[0], a));
                }
            if (measures.Count == 0) measures.Add((src.Columns[0], "count"));
            IEnumerable<Dictionary<string, object>> rows = src.Rows;
            if (args.TryGetValue("filter", out var fEl) && fEl.ValueKind == JsonValueKind.Object)
                foreach (var f in fEl.EnumerateObject())
                {
                    string c = Col(f.Name), want = f.Value.ValueKind == JsonValueKind.String ? f.Value.GetString() : f.Value.GetRawText();
                    if (c == null) return new { ok = false, content = "Unknown filter column " + f.Name };
                    rows = rows.Where(r => string.Equals(Convert.ToString(r.TryGetValue(c, out var v) ? v : null, CultureInfo.InvariantCulture), want, StringComparison.OrdinalIgnoreCase)).ToList();
                }
            string MName((string Col, string Agg) m) => (m.Agg + "_" + m.Col).ToUpperInvariant();
            var outRows = rows.GroupBy(r => string.Join("\u0001", groups.Select(g => Convert.ToString(r.TryGetValue(g, out var v) ? v : null, CultureInfo.InvariantCulture))))
                .Select(g =>
                {
                    var o = new Dictionary<string, object>();
                    var firstRow = g.First();
                    foreach (var c in groups) o[c] = firstRow.TryGetValue(c, out var v) ? v : null;
                    foreach (var m in measures)
                    {
                        var vals = g.Select(r => r.TryGetValue(m.Col, out var v) ? v : null).ToList();
                        var nums = vals.Select(v => AgentNum(v, out var d) ? (double?)d : null).Where(d => d.HasValue).Select(d => d.Value).ToList();
                        object res = m.Agg switch
                        {
                            "count" => g.Count(),
                            "count_distinct" => vals.Select(v => Convert.ToString(v, CultureInfo.InvariantCulture)).Distinct().Count(),
                            "avg" => nums.Count > 0 ? Math.Round(nums.Average(), 4) : (object)null,
                            "min" => nums.Count > 0 ? nums.Min() : (object)null,
                            "max" => nums.Count > 0 ? nums.Max() : (object)null,
                            _ => Math.Round(nums.Sum(), 4)
                        };
                        o[MName(m)] = res;
                    }
                    return o;
                }).ToList();
            string first = MName(measures[0]);
            outRows = outRows.OrderByDescending(r => AgentNum(r[first], out var d) ? d : double.MinValue).ToList();
            int top = args.TryGetValue("top", out var tEl) && tEl.ValueKind == JsonValueKind.Number ? tEl.GetInt32() : 0;
            if (top > 0) outRows = outRows.Take(top).ToList();
            var res2 = AgentStore(new AgentResult
            {
                Title = src.Title + " · by " + (groups.Count > 0 ? string.Join(", ", groups) : "total"), Sql = src.Sql, Pod = src.Pod, User = user,
                Columns = groups.Concat(measures.Select(MName)).ToList(), Rows = outRows
            });
            var summary = AgentSummary(res2, 30);
            return new { ok = true, content = JsonSerializer.Serialize(summary), data = summary };
        }

        // ── MRA ────────────────────────────────────────────────
        private async Task<object> AgentMraAsync(Dictionary<string, JsonElement> args, string pod, string user)
        {
            var orders = args.TryGetValue("orders", out var oEl) && oEl.ValueKind == JsonValueKind.Array
                ? oEl.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() : x.GetRawText()).Where(x => Regex.IsMatch(x ?? "", @"^[A-Za-z0-9\-_/]{1,40}$")).Distinct().ToList()
                : new List<string>();
            if (orders.Count == 0 || orders.Count > 50) return new { ok = false, content = "Give 1-50 order numbers." };
            string instance = args.TryGetValue("instance", out var iEl) && iEl.ValueKind == JsonValueKind.String && iEl.GetString().ToUpperInvariant() == "TEST" ? "TEST" : pod;
            var (fusionUser, fusionPass) = await FusionCredentialsService.GetAsync();
            if (string.IsNullOrEmpty(fusionUser)) return new { ok = false, content = "Fusion credentials not available - nothing was sent." };
            var results = new List<object>();
            int streak = 0;
            string stop = null;
            foreach (var order in orders)
            {
                if (stop != null) { results.Add(new { order, status = "NOT_SENT", message = stop }); continue; }
                WMSApp.MRA.MRAProcessingResult r;
                try { r = await new WMSApp.MRA.MRAProcessor(fusionUser, fusionPass, instance).ProcessMRAInterfaceAsync(order, (m, s) => { }); }
                catch (Exception ex) { r = new WMSApp.MRA.MRAProcessingResult { Success = false, Message = ex.Message, CurrentStep = WMSApp.MRA.MRAProcessingStep.Failed }; }
                string status = r.Success ? "INTERFACED" : r.Skipped ? "NOT_REQUIRED"
                    : (r.Message ?? "").IndexOf("already done", StringComparison.OrdinalIgnoreCase) >= 0 ? "ALREADY_DONE" : "FAILED";
                if (!string.IsNullOrEmpty(r.GatewayProblem)) streak++;
                else if (r.Success || r.CurrentStep == WMSApp.MRA.MRAProcessingStep.CreatingMRAInvoice) streak = 0;
                if (streak >= 2) stop = "Not sent: the MRA gateway failed twice in a row (" + r.GatewayProblem + ") - safe to retry later.";
                results.Add(new { order, status, irn = r.IrnCode, message = r.Message, gateway = r.GatewayProblem });
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "mra_interface", Outcome = status, Approval = "CARD", Instance = instance, Ref = "ORDER:" + order, Detail = r.Message });
            }
            var d = new { instance, total = orders.Count, results };
            return new { ok = true, content = JsonSerializer.Serialize(d), data = d };
        }

        // ── helpers ────────────────────────────────────────────
        private static int AgentInt(string json, string name, int dflt)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                return doc.RootElement.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out int n) ? n : dflt;
            }
            catch { return dflt; }
        }

        private static int AgentArrayLen(string json, string name)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                return doc.RootElement.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.GetArrayLength() : 0;
            }
            catch { return 0; }
        }

        private static string AgentShort(string s) => s == null ? null : s.Length > 900 ? s.Substring(0, 900) + "…" : s;
    }
}

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens CFO Copilot: Claude answers a finance question over the Finance Lens DuckDB file with read-only tools —
    /// run_sql (one SELECT, FinanceLens.Query: ATTACH READ_ONLY, no external access), template_rows (how a statement line is
    /// mapped to accounts, from templates.json) and accounts (search the chart of accounts). The page sends what is on the
    /// screen: the filter, the statements and KPIs it computed, so the numbers match what the CFO sees. The Claude key is the
    /// Fusion SQL one (DPAPI, never sent to the page).
    /// </summary>
    public static class FinanceAskAgent
    {
        private const int MAX_TURNS = 12;
        public const string DEFAULT_MODEL = "claude-opus-5-5";

        public sealed class AskResult
        {
            public bool Ok { get; set; }
            public string Answer { get; set; }
            public string Error { get; set; }
            public List<string> Steps { get; set; } = new();
            public List<string> Queries { get; set; } = new();
            public string Model { get; set; }
            public long TokensIn, TokensOut, CacheRead, CacheWrite;
        }

        public const string GUIDE = @"You are the CFO Copilot inside Finance Lens, a financial statements and analytics module. You answer the CFO's and
financial analysts' questions from the general ledger balances loaded in a DuckDB database, like a sharp, careful finance
business partner: lead with the answer and the numbers, then the why (drivers, accounts, cost centres, journals), then
what to look at next.

DATA (DuckDB, read-only — use run_sql):
- fin_balances(scenario 'ACTUAL'|'BUDGET', ledger, company, cost_centre, account, period_name, period_seq INTEGER yyyymm-like
  fiscal year*100+period, begin_bal, period_dr, period_cr, period_net, end_bal). Amounts are DEBIT POSITIVE: revenue, liabilities
  and equity are negative. Income statement accounts (account_type R/E) restart at 0 each fiscal year (end_bal = YTD).
  Balance sheet: use end_bal of the period. Movements: SUM(period_net) over the periods.
- fin_journals(je_id, je_line, batch_name, je_name, je_source, je_category, period_name, period_seq, accounting_date DATE,
  posted_at TIMESTAMP, created_by, ledger, company, cost_centre, account, dr, cr, description) — may hold only recent months.
- fin_accounts(code, name, account_type A/L/O/R/E, class, parent), fin_companies(code, name, currency),
  fin_cost_centres(code, name, parent), fin_periods(period_name, period_seq, fiscal_year, period_num, quarter, start_date, end_date),
  fin_ledgers(code, name, currency, coa_id, company_segment, cost_centre_segment, account_segment), fin_meta(key, value).
- The CONTEXT block holds what the user is looking at: filter (period, company, cost centre, ledger), statement lines and KPI
  values the page computed with the statement templates. Prefer those numbers for lines like revenue, gross profit, EBITDA,
  net profit, cash, so you agree with the screen; use template_rows to see which accounts a line is made of, then run_sql to
  explain it (by account, cost centre, company, month, journal).
- Respect the user's filter unless they ask otherwise. Never add different currencies together: if fin_ledgers has several
  currencies, work per ledger.

RULES:
- Only SELECT / WITH queries. Keep result sets small (aggregate, LIMIT 50). Check your arithmetic with SQL, never guess numbers.
- Show money with thousands separators and the currency (fin_companies.currency / fin_meta currency); revenue as positive.
- Say what is actual and what is budget, and which period / window (month, YTD, last 12 months).
- If the data cannot answer (e.g. journals not loaded for that month), say so and what to load.
- Format the answer in Markdown: short headline, bullets or a small table. You may add ONE chart as a fenced block
  ```chart
  {""type"":""bar""|""line""|""pie"", ""title"":""..."", ""labels"":[...], ""datasets"":[{""label"":""..."",""data"":[...]}]}
  ```
- Link accounts and journals so the user can drill: [6200 Freight outwards](acct:6200), [journal 123](je:123),
  a cost centre [400 Logistics](cc:400), a period [Aug-26](period:202608).
- End with up to 3 short follow-up questions as a list of links [question](ask:question text).";

        private static Dictionary<string, JsonElement> Props(object o) =>
            JsonSerializer.SerializeToElement(o).EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());

        private static readonly List<ToolUnion> TOOLS = new()
        {
            new Tool
            {
                Name = "run_sql", Description = "Run ONE read-only DuckDB SELECT / WITH query on the finance data. Returns at most max_rows rows (default 50, max 300) as a table.",
                InputSchema = new() { Properties = Props(new { sql = new { type = "string" }, max_rows = new { type = "integer" } }), Required = new List<string> { "sql" } }
            },
            new Tool
            {
                Name = "template_rows", Description = "The rows of a statement template (PL, PLS, BS, CF or another id): row id, label, type, account mapping (ranges like 4000-4099, lists, 5* prefixes, !exclusions or {type/class}), formula, sign, basis.",
                InputSchema = new() { Properties = Props(new { template = new { type = "string" } }), Required = new List<string> { "template" } }
            },
            new Tool
            {
                Name = "accounts", Description = "Search the chart of accounts by code or words in the name (or account type A/L/O/R/E). Returns code, name, type, class.",
                InputSchema = new() { Properties = Props(new { search = new { type = "string" } }), Required = new List<string> { "search" } }
            }
        };

        private static string Arg(IReadOnlyDictionary<string, JsonElement> i, string n) =>
            i != null && i.TryGetValue(n, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : null : null;

        private static string Table(FinanceLens.QueryResult r, int max)
        {
            if (r.Error != null) return "ERROR: " + r.Error;
            var sb = new StringBuilder();
            sb.Append(string.Join(" | ", r.Columns)).Append('\n');
            foreach (var row in r.Rows.Take(max))
                sb.Append(string.Join(" | ", row.Select(v => v switch
                {
                    null => "",
                    double d => d.ToString(Math.Abs(d) >= 100 ? "0.##" : "0.####", CultureInfo.InvariantCulture),
                    float f => f.ToString("0.####", CultureInfo.InvariantCulture),
                    _ => Convert.ToString(v, CultureInfo.InvariantCulture)
                }))).Append('\n');
            sb.Append("(" + Math.Min(r.Rows.Count, max) + " row(s)" + (r.Rows.Count > max || r.Truncated ? ", more rows exist - aggregate or add LIMIT" : "") + ")");
            string s = sb.ToString();
            return s.Length > 40000 ? s.Substring(0, 40000) + "\n…(cut)" : s;
        }

        private static string Run(string name, IReadOnlyDictionary<string, JsonElement> input, out string sqlRan)
        {
            sqlRan = null;
            switch (name)
            {
                case "run_sql":
                    {
                        string sql = Arg(input, "sql");
                        int max = int.TryParse(Arg(input, "max_rows"), out var m) ? Math.Clamp(m, 1, 300) : 50;
                        var r = FinanceLens.Query(sql, max + 1);
                        if (r.Error == null) sqlRan = sql;
                        return Table(r, max);
                    }
                case "template_rows":
                    {
                        string id = (Arg(input, "template") ?? "").Trim();
                        string json = FinanceLens.ReadDoc("templates");
                        if (json == null) return "No saved templates yet - the page uses its starter templates PL, PLS, BS, CF (sample chart: 4xxx revenue, 5xxx cost of sales, 6xxx opex, 69xx D&A, 7xxx finance, 8xxx tax, 1xxx assets, 2xxx liabilities, 3xxx equity).";
                        using var d = JsonDocument.Parse(json);
                        if (!d.RootElement.TryGetProperty("templates", out var ts)) return "ERROR: templates.json has no templates";
                        foreach (var t in ts.EnumerateArray())
                        {
                            if (!string.Equals(t.TryGetProperty("id", out var tid) ? tid.GetString() : "", id, StringComparison.OrdinalIgnoreCase)) continue;
                            var sb = new StringBuilder((t.TryGetProperty("name", out var tn) ? tn.GetString() : id) + "\nid | label | type | accounts | formula | sign | basis | parent\n");
                            foreach (var r in t.GetProperty("rows").EnumerateArray())
                            {
                                string g(string k) => r.TryGetProperty(k, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText()) : "";
                                if (g("type") is "blank") continue;
                                sb.Append(string.Join(" | ", g("id"), g("label"), g("type"), g("accounts"), g("formula"), g("sign"), g("basis"), g("parent"))).Append('\n');
                            }
                            return sb.ToString();
                        }
                        return "ERROR: no template " + id + ". Templates: " + string.Join(", ", ts.EnumerateArray().Select(t => t.TryGetProperty("id", out var x) ? x.GetString() : "?"));
                    }
                case "accounts":
                    {
                        string s = (Arg(input, "search") ?? "").Trim();
                        string lit = FinanceLens.Lit("%" + s.ToLowerInvariant() + "%");
                        string where = s.Length == 1 && "ALORE".Contains(s.ToUpperInvariant()) ? "account_type = " + FinanceLens.Lit(s.ToUpperInvariant())
                            : "LOWER(code) LIKE " + lit + " OR LOWER(name) LIKE " + lit + " OR LOWER(COALESCE(class, '')) LIKE " + lit;
                        return Table(FinanceLens.Query("SELECT code, name, account_type, class FROM fin_accounts WHERE " + where + " ORDER BY code LIMIT 80", 80), 80);
                    }
            }
            return "ERROR: unknown tool " + name;
        }

        private static string Describe(string name, IReadOnlyDictionary<string, JsonElement> input) => name switch
        {
            "run_sql" => "🔎 Querying the ledger: " + Short(Arg(input, "sql")),
            "template_rows" => "📄 Reading template " + Arg(input, "template"),
            "accounts" => "📚 Searching accounts: " + Arg(input, "search"),
            _ => name
        };
        private static string Short(string s) { s = (s ?? "").Replace('\n', ' '); return s.Length > 110 ? s.Substring(0, 110) + "…" : s; }
        private static long N(object o) => o == null ? 0 : Convert.ToInt64(o);

        public static async Task<AskResult> AskAsync(string question, JsonElement history, string context, string model, Action<string> progress, CancellationToken ct)
        {
            var res = new AskResult { Model = string.IsNullOrWhiteSpace(model) ? DEFAULT_MODEL : model };
            string key = WMSApp.FusionSql.FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key)) { res.Error = "No Claude API key saved. Add it in Fusion SQL › Ask AI (⚙)."; return res; }
            if (string.IsNullOrWhiteSpace(question)) { res.Error = "Ask a question."; return res; }

            var messages = new List<MessageParam>();
            if (history.ValueKind == JsonValueKind.Array)
            {
                foreach (var h in history.EnumerateArray().TakeLast(8))
                {
                    string role = h.TryGetProperty("role", out var r) ? r.GetString() : null;
                    string content = h.TryGetProperty("content", out var c) ? c.GetString() : null;
                    if (string.IsNullOrWhiteSpace(content) || (role != "user" && role != "assistant")) continue;
                    var want = role == "user" ? Role.User : Role.Assistant;
                    if (messages.Count == 0 && want != Role.User) continue;
                    if (messages.Count > 0 && messages[^1].Role == want) continue;
                    messages.Add(new MessageParam { Role = want, Content = content.Length > 6000 ? content.Substring(0, 6000) : content });
                }
                if (messages.Count > 0 && messages[^1].Role == Role.User) messages.RemoveAt(messages.Count - 1);
            }
            var status = FinanceLens.Query("SELECT key, value FROM fin_meta", 50);
            string meta = status.Error == null ? string.Join("; ", status.Rows.Select(r => r[0] + "=" + r[1]).Where(s => !s.StartsWith("fusion_signature", StringComparison.Ordinal))) : "no data loaded";
            if (context != null && context.Length > 60000) context = context.Substring(0, 60000);
            messages.Add(new MessageParam
            {
                Role = Role.User,
                Content = "DATA: " + meta + "\nCONTEXT (what the user sees now)\n" + (context ?? "{}") + "\n\nQUESTION (today is " + DateTime.Now.ToString("yyyy-MM-dd") + ")\n" + question
            });

            var client = new AnthropicClient { ApiKey = key };
            try
            {
                for (int turn = 0; turn <= MAX_TURNS; turn++)
                {
                    bool last = turn == MAX_TURNS;
                    progress?.Invoke(turn == 0 ? "Reading the numbers…" : last ? "Writing the answer…" : "Checking the ledger…");
                    var resp = await client.Messages.Create(new MessageCreateParams
                    {
                        Model = res.Model,
                        MaxTokens = 12000,
                        System = GUIDE,
                        Tools = TOOLS,
                        ToolChoice = last ? new ToolChoiceNone() : null,
                        Thinking = new ThinkingConfigAdaptive(),
                        OutputConfig = new OutputConfig { Effort = Effort.High },
                        CacheControl = new CacheControlEphemeral(),
                        Messages = messages,
                    }, ct).ConfigureAwait(false);
                    if (resp.Usage != null)
                    {
                        res.TokensIn += N(resp.Usage.InputTokens); res.TokensOut += N(resp.Usage.OutputTokens);
                        res.CacheRead += N(resp.Usage.CacheReadInputTokens); res.CacheWrite += N(resp.Usage.CacheCreationInputTokens);
                    }
                    var assistant = new List<ContentBlockParam>();
                    var text = new StringBuilder();
                    var calls = new List<ToolUseBlock>();
                    foreach (ContentBlock block in resp.Content)
                    {
                        if (block.TryPickText(out TextBlock t)) { text.Append(t.Text); assistant.Add(new TextBlockParam { Text = t.Text }); }
                        else if (block.TryPickThinking(out ThinkingBlock th)) assistant.Add(new ThinkingBlockParam { Thinking = th.Thinking, Signature = th.Signature });
                        else if (block.TryPickRedactedThinking(out RedactedThinkingBlock rt)) assistant.Add(new RedactedThinkingBlockParam { Data = rt.Data });
                        else if (block.TryPickToolUse(out ToolUseBlock tu)) { assistant.Add(new ToolUseBlockParam { ID = tu.ID, Name = tu.Name, Input = tu.Input }); calls.Add(tu); }
                    }
                    messages.Add(new MessageParam { Role = Role.Assistant, Content = assistant });
                    if (calls.Count == 0)
                    {
                        string stop = resp.StopReason?.ToString() ?? "";
                        if (text.Length == 0) { res.Error = stop.IndexOf("refusal", StringComparison.OrdinalIgnoreCase) >= 0 ? "Claude declined this request." : "Claude returned no answer (" + stop + ")."; return res; }
                        res.Ok = true; res.Answer = text.ToString();
                        return res;
                    }
                    var results = new List<ContentBlockParam>();
                    foreach (var call in calls)
                    {
                        string label = Describe(call.Name, call.Input);
                        res.Steps.Add(label);
                        progress?.Invoke(label);
                        string ran = null;
                        string output = await Task.Run(() => Run(call.Name, call.Input, out ran), ct).ConfigureAwait(false);
                        if (ran != null) res.Queries.Add(ran);
                        results.Add(new ToolResultBlockParam { ToolUseID = call.ID, Content = output, IsError = output.StartsWith("ERROR", StringComparison.Ordinal) });
                    }
                    int left = MAX_TURNS - turn - 1;
                    if (left <= 3) results.Add(new TextBlockParam { Text = left <= 0 ? "[No more tool calls - answer now from what you have.]" : "[Tool rounds left: " + left + " - finish soon.]" });
                    messages.Add(new MessageParam { Role = Role.User, Content = results });
                }
                res.Error = "The Copilot did not finish within " + MAX_TURNS + " steps. Ask a narrower question.";
                return res;
            }
            catch (OperationCanceledException) { res.Error = "Cancelled."; return res; }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[Finance Copilot] " + ex);
                res.Error = "Claude API error: " + ex.Message;
                return res;
            }
        }
    }
}

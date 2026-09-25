using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

namespace WMSApp.FusionSql
{
    // ---------------------------------------------------------------------
    //  "Ask AI" (§7.4) — an agent with full, read-only access to the Fusion
    //  data dictionary. Claude calls tools (search objects/columns, describe,
    //  read PL/SQL source, dependencies, sample queries); every tool runs as
    //  a SELECT through the same BIP runner (FusionSqlService.ExecuteAsync),
    //  so the read-only guard and ROWNUM cap apply. The API key lives on the
    //  host (DPAPI) and never reaches the page.
    // ---------------------------------------------------------------------
    public static class FusionSqlAi
    {
        private const int MAX_TURNS = 24;             // flow designs verify many tables
        private const int MAX_TOOL_CHARS = 14000;

        private const string SYSTEM_PROMPT =
@"You are an Oracle Fusion Cloud (SaaS) database expert inside a read-only SQL workbench (Oracle Database 19c).
Queries run through a BI Publisher data model with DBMS_XMLGEN, as a BI user.

You have FULL read access to the data dictionary through tools. Use them — never guess:
- search_objects: find tables, views, synonyms, packages, procedures, functions, triggers… by name (any owner).
- search_columns: find which tables/views have a column (e.g. CUSTOMER_TRX_ID).
- describe_object: columns (with comments) of a table/view, a synonym's target, or the procedures/functions and
  arguments of a package/procedure/function.
- get_source: read PL/SQL source (package spec, package body, procedure, function, trigger, type) or a view's SQL.
- get_dependencies: what an object uses and what uses it; a table's foreign keys.
- run_query: run a small read-only SELECT to look at sample data or check values (keep it light: few rows).
Object names are often stored in lower case in this pod; tools match names case-insensitively.

Two kinds of requests:
1) Write SQL: verify every table and column with describe_object before using it. Return exactly ONE read-only
   statement starting with SELECT or WITH inside a single ```sql code block. Use {{PARAM_NAME}} tokens for filter
   values the user did not give (blank means NULL, so NVL({{P}}, col) = col means 'all'). Alias computed columns,
   TO_CHAR dates shown to users, no trailing semicolon, no DML/DDL/PL/SQL, no WITH FUNCTION. Keep it under about
   2,900 characters (the runner's limit). Owner-qualify objects not owned by FUSION.
2) Explain an object (package, procedure, function, table, view…): read its spec/source/arguments with the tools and
   explain what it does, its main entry points and parameters, and how to call/use it, with a short example.
   Say so when source is wrapped or not visible to this user.

After any SQL block add at most three short bullets on joins/assumptions. Be concise.
If the question refers to the CURRENT EDITOR SQL, modify or extend that query.";

        /// <summary>Per-session cache of dictionary tool results (not run_query), keyed by the SQL.</summary>
        private static readonly ConcurrentDictionary<string, string> _dictCache = new ConcurrentDictionary<string, string>();

        public static async Task<(bool Success, string Response, string Error, List<string> Steps)> AskAsync(
            string question, string schema, JsonElement history, string model,
            FusionSqlService svc, Action<string> progress, CancellationToken ct = default)
        {
            var steps = new List<string>();
            string key = FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key))
                return (false, null, "No Claude API key saved. Click the ⚙ gear in Ask AI (or Connection → AI assistant) to add one.", steps);

            var messages = new List<MessageParam>();
            if (history.ValueKind == JsonValueKind.Array)
            {
                // Last 8 turns; must alternate and start with the user
                foreach (var h in history.EnumerateArray().TakeLast(8))
                {
                    string role = h.TryGetProperty("role", out var r) ? r.GetString() : null;
                    string content = h.TryGetProperty("content", out var c) ? c.GetString() : null;
                    if (string.IsNullOrWhiteSpace(content) || (role != "user" && role != "assistant")) continue;
                    var want = role == "user" ? Role.User : Role.Assistant;
                    if (messages.Count == 0 && want != Role.User) continue;
                    if (messages.Count > 0 && messages[messages.Count - 1].Role == want) continue;
                    messages.Add(new MessageParam { Role = want, Content = content });
                }
                if (messages.Count > 0 && messages[messages.Count - 1].Role == Role.User) messages.RemoveAt(messages.Count - 1);
            }
            messages.Add(new MessageParam
            {
                Role = Role.User,
                Content = (string.IsNullOrWhiteSpace(schema) ? "" :
                           "STARTING HINTS — tables that look relevant (OWNER.TABLE: columns). Use the tools for anything else:\n" + schema + "\n\n") +
                          "QUESTION\n" + question
            });

            var client = new AnthropicClient { ApiKey = key };
            var tools = BuildTools();
            string useModel = string.IsNullOrWhiteSpace(model) ? "claude-opus-5" : model;

            try
            {
                for (int turn = 0; turn < MAX_TURNS; turn++)
                {
                    progress?.Invoke(turn == 0 ? "Claude is thinking…" : "Claude is reviewing what it found…");
                    var resp = await client.Messages.Create(new MessageCreateParams
                    {
                        Model = useModel,
                        MaxTokens = 16000,
                        System = SYSTEM_PROMPT,
                        Tools = tools,
                        Thinking = new ThinkingConfigAdaptive(),
                        OutputConfig = new OutputConfig { Effort = Effort.High },
                        CacheControl = new CacheControlEphemeral(),      // caches the growing prefix across tool turns
                        Messages = messages,
                    }, ct).ConfigureAwait(false);

                    var assistant = new List<ContentBlockParam>();
                    var results = new List<ContentBlockParam>();
                    var text = new StringBuilder();
                    var calls = new List<ToolUseBlock>();
                    foreach (ContentBlock block in resp.Content)
                    {
                        if (block.TryPickText(out TextBlock t)) { text.Append(t.Text); assistant.Add(new TextBlockParam { Text = t.Text }); }
                        else if (block.TryPickThinking(out ThinkingBlock th)) assistant.Add(new ThinkingBlockParam { Thinking = th.Thinking, Signature = th.Signature });
                        else if (block.TryPickRedactedThinking(out RedactedThinkingBlock rt)) assistant.Add(new RedactedThinkingBlockParam { Data = rt.Data });
                        else if (block.TryPickToolUse(out ToolUseBlock tu))
                        {
                            assistant.Add(new ToolUseBlockParam { ID = tu.ID, Name = tu.Name, Input = tu.Input });
                            calls.Add(tu);
                        }
                    }
                    messages.Add(new MessageParam { Role = Role.Assistant, Content = assistant });

                    string stop = resp.StopReason?.ToString() ?? "";
                    if (calls.Count == 0)
                    {
                        if (stop.IndexOf("refusal", StringComparison.OrdinalIgnoreCase) >= 0 && text.Length == 0)
                            return (false, null, "Claude declined this request. Rephrase the question.", steps);
                        if (text.Length == 0)
                            return (false, null, "Claude returned no text (stop reason: " + stop + ").", steps);
                        if (stop.IndexOf("max_tokens", StringComparison.OrdinalIgnoreCase) >= 0)
                            text.Append("\n\n_(answer cut off at the output limit)_");
                        return (true, text.ToString(), null, steps);
                    }

                    // Tools run one after another: each is a BIP job on the pod (RD §10 concurrency)
                    foreach (var call in calls)
                    {
                        string label = Describe(call);
                        steps.Add(label);
                        progress?.Invoke(label);
                        string output;
                        try { output = await RunToolAsync(svc, call.Name, call.Input, ct).ConfigureAwait(false); }
                        catch (Exception ex) { output = "ERROR: " + ex.Message; }
                        if (output.Length > MAX_TOOL_CHARS) output = output.Substring(0, MAX_TOOL_CHARS) + "\n…(truncated — narrow the request, e.g. from_line/to_line)";
                        results.Add(new ToolResultBlockParam { ToolUseID = call.ID, Content = output });
                    }
                    messages.Add(new MessageParam { Role = Role.User, Content = results });
                }
                return (false, null, "Claude used too many research steps without finishing. Ask a narrower question.", steps);
            }
            catch (OperationCanceledException) { return (false, null, "Cancelled.", steps); }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[FusionSql AI] " + ex);
                return (false, null, "Claude API error: " + ex.Message, steps);
            }
        }

        // ── Tool definitions ──────────────────────────────────────────
        private static JsonElement Prop(string type, string description) =>
            JsonSerializer.SerializeToElement(new { type, description });

        private static Tool MakeTool(string name, string description, Dictionary<string, JsonElement> props, params string[] required) =>
            new Tool { Name = name, Description = description, InputSchema = new() { Properties = props, Required = required.ToList() } };

        private static List<ToolUnion> BuildTools() => new List<ToolUnion>
        {
            MakeTool("search_objects",
                "Search the Fusion data dictionary (ALL_OBJECTS) by object name. Words are matched in order anywhere in the name, " +
                "case-insensitive (e.g. 'ar payment schedule', 'AR_RECEIPT%API'). Returns owner, name, type, status.",
                new Dictionary<string, JsonElement>
                {
                    ["pattern"] = Prop("string", "Name words or a LIKE pattern with %"),
                    ["object_types"] = JsonSerializer.SerializeToElement(new { type = "array", items = new { type = "string" },
                        description = "Optional filter, e.g. [\"TABLE\",\"VIEW\"] or [\"PACKAGE\",\"PROCEDURE\",\"FUNCTION\"]" }),
                    ["owner"] = Prop("string", "Optional owner, e.g. FUSION"),
                }, "pattern"),
            MakeTool("search_columns",
                "Find tables/views that have a column whose name matches (ALL_TAB_COLUMNS), optionally only in tables matching table_pattern.",
                new Dictionary<string, JsonElement>
                {
                    ["column_pattern"] = Prop("string", "Column name words or LIKE pattern, e.g. 'CUSTOMER_TRX_ID' or 'due date'"),
                    ["table_pattern"] = Prop("string", "Optional table name words/pattern to narrow the search"),
                    ["owner"] = Prop("string", "Optional owner"),
                }, "column_pattern"),
            MakeTool("describe_object",
                "Describe an object: table/view columns with types and comments (plus indexes for tables), a synonym's target, " +
                "or the procedures/functions and arguments of a package, procedure or function.",
                new Dictionary<string, JsonElement>
                {
                    ["name"] = Prop("string", "Object name (any case)"),
                    ["owner"] = Prop("string", "Optional owner"),
                }, "name"),
            MakeTool("get_source",
                "Read PL/SQL source lines from ALL_SOURCE (package spec, package body, procedure, function, trigger, type) or a view's SQL. " +
                "Returns up to 400 lines per call with line numbers; page with from_line/to_line.",
                new Dictionary<string, JsonElement>
                {
                    ["name"] = Prop("string", "Object name"),
                    ["type"] = Prop("string", "PACKAGE (spec, default for packages), PACKAGE BODY, PROCEDURE, FUNCTION, TRIGGER, TYPE, TYPE BODY or VIEW"),
                    ["owner"] = Prop("string", "Optional owner"),
                    ["from_line"] = Prop("integer", "First line (default 1)"),
                    ["to_line"] = Prop("integer", "Last line (default from_line + 399)"),
                }, "name"),
            MakeTool("get_dependencies",
                "What an object references and which objects reference it (ALL_DEPENDENCIES); for tables also its foreign keys.",
                new Dictionary<string, JsonElement>
                {
                    ["name"] = Prop("string", "Object name"),
                    ["owner"] = Prop("string", "Optional owner"),
                }, "name"),
            MakeTool("run_query",
                "Run a small read-only SELECT/WITH on Fusion to look at sample data or check values. At most 50 rows are returned.",
                new Dictionary<string, JsonElement>
                {
                    ["sql"] = Prop("string", "SELECT or WITH statement, no trailing semicolon"),
                    ["max_rows"] = Prop("integer", "Rows to return (1-50, default 20)"),
                }, "sql"),
        };

        private static string Arg(IReadOnlyDictionary<string, JsonElement> input, string name)
        {
            if (input == null || !input.TryGetValue(name, out var v)) return null;
            return v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : null;
        }
        private static int ArgInt(IReadOnlyDictionary<string, JsonElement> input, string name, int dflt)
        {
            if (input != null && input.TryGetValue(name, out var v))
            {
                if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out int n)) return n;
                if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out int m)) return m;
            }
            return dflt;
        }

        private static string Describe(ToolUseBlock call)
        {
            var i = call.Input;
            switch (call.Name)
            {
                case "search_objects": return "🔎 Searching objects: " + Arg(i, "pattern");
                case "search_columns": return "🔎 Searching columns: " + Arg(i, "column_pattern") + (Arg(i, "table_pattern") != null ? " in " + Arg(i, "table_pattern") : "");
                case "describe_object": return "📋 Describing " + Arg(i, "name");
                case "get_source": return "📜 Reading source of " + Arg(i, "name") + (Arg(i, "type") != null ? " (" + Arg(i, "type") + ")" : "") +
                                          (ArgInt(i, "from_line", 1) > 1 ? " from line " + ArgInt(i, "from_line", 1) : "");
                case "get_dependencies": return "🔗 Dependencies of " + Arg(i, "name");
                case "run_query":
                {
                    string q = Regex.Replace(Arg(i, "sql") ?? "", @"\s+", " ").Trim();
                    return "▶ Sample query: " + (q.Length > 90 ? q.Substring(0, 90) + "…" : q);
                }
                default: return "⚙ " + call.Name;
            }
        }

        // ── Tool execution (all SELECTs through the runner) ────────────
        private static string L(string s) => "'" + (s ?? "").Replace("'", "''") + "'";
        private static string Up(string s) => (s ?? "").Trim().Trim('"').ToUpperInvariant();

        /// <summary>'ar payment schedule' → '%AR%PAYMENT%SCHEDULE%'; keeps explicit % wildcards.</summary>
        private static string LikePattern(string words)
        {
            var parts = Regex.Split(Up(words), @"[\s%*]+").Where(p => p.Length > 0).Select(p => p.Replace("\\", "\\\\").Replace("_", "\\_"));
            return "%" + string.Join("%", parts) + "%";
        }

        private static async Task<FusionQueryResult> Q(FusionSqlService svc, string sql, int cap, CancellationToken ct)
        {
            var r = await svc.ExecuteAsync(sql, cap, ct).ConfigureAwait(false);
            if (!r.Success) throw new InvalidOperationException((r.Error ?? "query failed").Split('\n')[0]);
            return r;
        }

        private static string Table(FusionQueryResult r, int maxChars = MAX_TOOL_CHARS)
        {
            if (r.RowCount == 0) return "(no rows)";
            var sb = new StringBuilder(string.Join(" | ", r.Columns)).Append('\n');
            foreach (var row in r.Rows)
            {
                sb.Append(string.Join(" | ", r.Columns.Select(c => row.TryGetValue(c, out var v) ? Convert.ToString(v, CultureInfo.InvariantCulture) : ""))).Append('\n');
                if (sb.Length > maxChars) { sb.Append("…"); break; }
            }
            if (r.Capped) sb.Append("(more rows exist — narrow the search)\n");
            return sb.ToString();
        }

        private static async Task<string> Cached(string key, Func<Task<string>> make)
        {
            if (_dictCache.TryGetValue(key, out var hit)) return hit;
            var v = await make().ConfigureAwait(false);
            _dictCache[key] = v;
            return v;
        }

        /// <summary>Finds the object (case-insensitive), preferring the given owner, then FUSION.</summary>
        private static async Task<Dictionary<string, object>> Resolve(FusionSqlService svc, string name, string owner, string preferType, CancellationToken ct)
        {
            string sql = "SELECT owner, object_name, object_type, status FROM all_objects WHERE UPPER(object_name) = " + L(Up(name)) +
                         (string.IsNullOrWhiteSpace(owner) ? "" : " AND owner = " + L(Up(owner))) +
                         " AND object_type NOT IN ('INDEX','LOB','TABLE PARTITION','INDEX PARTITION','TABLE SUBPARTITION','JAVA CLASS')";
            var r = await Q(svc, sql, 50, ct).ConfigureAwait(false);
            if (r.RowCount == 0) return null;
            IEnumerable<Dictionary<string, object>> rows = r.Rows;
            var typed = preferType == null ? rows : rows.Where(x => string.Equals(Convert.ToString(x["OBJECT_TYPE"]), preferType, StringComparison.OrdinalIgnoreCase));
            if (!typed.Any()) typed = rows;
            return typed.OrderBy(x => Convert.ToString(x["OWNER"]) == "FUSION" ? 0 : 1)
                        .ThenBy(x => Convert.ToString(x["OBJECT_TYPE"]).EndsWith("BODY") ? 1 : 0).First();
        }

        private static async Task<string> RunToolAsync(FusionSqlService svc, string name, IReadOnlyDictionary<string, JsonElement> input, CancellationToken ct)
        {
            switch (name)
            {
                case "search_objects":
                {
                    var types = new List<string>();
                    if (input != null && input.TryGetValue("object_types", out var tEl) && tEl.ValueKind == JsonValueKind.Array)
                        types = tEl.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => Up(x.GetString())).Where(x => Regex.IsMatch(x, @"^[A-Z ]+$")).ToList();
                    string owner = Arg(input, "owner");
                    string sql = "SELECT owner, object_name, object_type, status FROM all_objects WHERE UPPER(object_name) LIKE " + L(LikePattern(Arg(input, "pattern"))) + " ESCAPE '\\'" +
                                 (types.Count > 0 ? " AND object_type IN (" + string.Join(",", types.Select(L)) + ")" : " AND object_type NOT IN ('INDEX','LOB','TABLE PARTITION','INDEX PARTITION','JAVA CLASS','PACKAGE BODY','TYPE BODY')") +
                                 (string.IsNullOrWhiteSpace(owner) ? "" : " AND owner = " + L(Up(owner))) +
                                 " ORDER BY LENGTH(object_name), object_name";
                    return await Cached(sql, async () => Table(await Q(svc, sql, 150, ct))).ConfigureAwait(false);
                }
                case "search_columns":
                {
                    string owner = Arg(input, "owner"), tp = Arg(input, "table_pattern");
                    string sql = "SELECT owner, table_name, column_name, data_type FROM all_tab_columns WHERE UPPER(column_name) LIKE " + L(LikePattern(Arg(input, "column_pattern"))) + " ESCAPE '\\'" +
                                 (string.IsNullOrWhiteSpace(tp) ? "" : " AND UPPER(table_name) LIKE " + L(LikePattern(tp)) + " ESCAPE '\\'") +
                                 (string.IsNullOrWhiteSpace(owner) ? "" : " AND owner = " + L(Up(owner))) +
                                 " ORDER BY LENGTH(table_name), table_name, column_name";
                    return await Cached(sql, async () => Table(await Q(svc, sql, 200, ct))).ConfigureAwait(false);
                }
                case "describe_object":
                    return await DescribeAsync(svc, Arg(input, "name"), Arg(input, "owner"), 0, ct).ConfigureAwait(false);
                case "get_source":
                    return await SourceAsync(svc, Arg(input, "name"), Arg(input, "owner"), Arg(input, "type"),
                        ArgInt(input, "from_line", 1), ArgInt(input, "to_line", 0), ct).ConfigureAwait(false);
                case "get_dependencies":
                    return await DependenciesAsync(svc, Arg(input, "name"), Arg(input, "owner"), ct).ConfigureAwait(false);
                case "run_query":
                {
                    int max = Math.Clamp(ArgInt(input, "max_rows", 20), 1, 50);
                    var r = await svc.ExecuteAsync(Arg(input, "sql"), max, ct).ConfigureAwait(false);
                    if (!r.Success) return "ERROR: " + r.Error;
                    return r.RowCount + " row(s)" + (r.Capped ? " (capped at " + max + ")" : "") + " in " + r.ElapsedMs + " ms\n" + Table(r, 8000);
                }
                default:
                    return "Unknown tool " + name;
            }
        }

        private static async Task<string> DescribeAsync(FusionSqlService svc, string name, string owner, int depth, CancellationToken ct)
        {
            var obj = await Resolve(svc, name, owner, null, ct).ConfigureAwait(false);
            if (obj == null) return "No object named " + name + (owner != null ? " owned by " + owner : "") + ". Try search_objects.";
            string o = Convert.ToString(obj["OWNER"]), n = Convert.ToString(obj["OBJECT_NAME"]), type = Convert.ToString(obj["OBJECT_TYPE"]);
            string head = o + "." + n + " — " + type + (Convert.ToString(obj["STATUS"]) == "INVALID" ? " (INVALID)" : "") + "\n";
            return await Cached("describe:" + o + "." + n + ":" + type, async () =>
            {
                var sb = new StringBuilder(head);
                if (type == "TABLE" || type == "VIEW" || type == "MATERIALIZED VIEW")
                {
                    var tc = await Q(svc, "SELECT SUBSTR(comments, 1, 400) AS comments FROM all_tab_comments WHERE owner = " + L(o) + " AND table_name = " + L(n), 1, ct).ConfigureAwait(false);
                    if (tc.RowCount > 0 && tc.Rows[0].TryGetValue("COMMENTS", out var cm) && !string.IsNullOrWhiteSpace(Convert.ToString(cm))) sb.Append("Comment: ").Append(cm).Append('\n');
                    var cols = await Q(svc,
                        "SELECT c.column_name, c.data_type || CASE WHEN c.data_type IN ('VARCHAR2','CHAR','NVARCHAR2') THEN '(' || c.char_length || ')' " +
                        "WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || ',' || NVL(c.data_scale, 0) || ')' END AS type, " +
                        "c.nullable, SUBSTR(cc.comments, 1, 160) AS comments FROM all_tab_columns c LEFT JOIN all_col_comments cc " +
                        "ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name " +
                        "WHERE c.owner = " + L(o) + " AND c.table_name = " + L(n) + " ORDER BY c.column_id", 1000, ct).ConfigureAwait(false);
                    sb.Append("Columns (").Append(cols.RowCount).Append("):\n").Append(Table(cols, 11000));
                    if (type == "TABLE")
                    {
                        var ix = await Q(svc,
                            "SELECT i.index_name, i.uniqueness, LISTAGG(c.column_name, ', ') WITHIN GROUP (ORDER BY c.column_position) AS columns " +
                            "FROM all_indexes i JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name " +
                            "WHERE i.table_owner = " + L(o) + " AND i.table_name = " + L(n) + " GROUP BY i.index_name, i.uniqueness ORDER BY i.uniqueness DESC, i.index_name", 60, ct).ConfigureAwait(false);
                        if (ix.RowCount > 0) sb.Append("Indexes:\n").Append(Table(ix, 2500));
                    }
                    else
                    {
                        var vt = await svc.ExecuteAsync("SELECT text_vc FROM all_views WHERE owner = " + L(o) + " AND view_name = " + L(n), 1, ct).ConfigureAwait(false);
                        if (vt.Success && vt.RowCount > 0) sb.Append("View SQL (first 4000 chars):\n").Append(vt.Rows[0].TryGetValue("TEXT_VC", out var tx) ? tx : "").Append('\n');
                    }
                }
                else if (type == "SYNONYM")
                {
                    var syn = await Q(svc, "SELECT table_owner, table_name, db_link FROM all_synonyms WHERE owner = " + L(o) + " AND synonym_name = " + L(n), 1, ct).ConfigureAwait(false);
                    if (syn.RowCount == 0) sb.Append("(synonym target not visible)\n");
                    else
                    {
                        string to = Convert.ToString(syn.Rows[0]["TABLE_OWNER"]), tn = Convert.ToString(syn.Rows[0]["TABLE_NAME"]);
                        sb.Append("Synonym for ").Append(to).Append('.').Append(tn).Append('\n');
                        if (depth < 2) sb.Append(await DescribeAsync(svc, tn, to, depth + 1, ct).ConfigureAwait(false));
                    }
                }
                else if (type == "PACKAGE" || type == "PROCEDURE" || type == "FUNCTION" || type == "TYPE")
                {
                    var args = await Q(svc,
                        "SELECT NVL(object_name, '-') AS subprogram, NVL(overload, '0') AS overload, position, NVL(argument_name, '(return)') AS argument, in_out, " +
                        "data_type || CASE WHEN type_name IS NOT NULL THEN ' ' || type_name END AS type, defaulted " +
                        "FROM all_arguments WHERE owner = " + L(o) + " AND data_level = 0 AND " +
                        (type == "PACKAGE" || type == "TYPE" ? "package_name = " + L(n) : "package_name IS NULL AND object_name = " + L(n)) +
                        " ORDER BY object_name, overload, position", 3000, ct).ConfigureAwait(false);
                    if (args.RowCount == 0) sb.Append("(no arguments visible — the object may have no parameters, or read get_source)\n");
                    else
                    {
                        // Group into signatures: NAME#overload(arg IN TYPE, …) RETURN TYPE
                        foreach (var g in args.Rows.GroupBy(r => Convert.ToString(r["SUBPROGRAM"]) + "#" + Convert.ToString(r["OVERLOAD"])))
                        {
                            var list = g.ToList();
                            var ret = list.FirstOrDefault(r => Convert.ToString(r["ARGUMENT"]) == "(return)" && Convert.ToString(r["POSITION"]) == "0");
                            var ps = list.Where(r => r != ret && Convert.ToString(r.TryGetValue("TYPE", out var tt) ? tt : "") != "")
                                         .Select(r => Convert.ToString(r["ARGUMENT"]) + " " + Convert.ToString(r["IN_OUT"]) + " " + Convert.ToString(r["TYPE"]) +
                                                      (Convert.ToString(r.TryGetValue("DEFAULTED", out var d) ? d : "") == "Y" ? " := default" : ""));
                            sb.Append(ret != null ? "FUNCTION " : "PROCEDURE ").Append(g.Key.Split('#')[0]).Append('(').Append(string.Join(", ", ps)).Append(')');
                            if (ret != null) sb.Append(" RETURN ").Append(Convert.ToString(ret["TYPE"]));
                            sb.Append('\n');
                            if (sb.Length > MAX_TOOL_CHARS) { sb.Append("…(more — use get_source on the package spec)\n"); break; }
                        }
                    }
                    sb.Append("Use get_source to read the ").Append(type == "PACKAGE" ? "package spec (comments/usage) or PACKAGE BODY" : "source").Append(".\n");
                }
                else if (type == "TRIGGER")
                {
                    var tr = await Q(svc, "SELECT trigger_type, triggering_event, table_owner, table_name, status FROM all_triggers WHERE owner = " + L(o) + " AND trigger_name = " + L(n), 1, ct).ConfigureAwait(false);
                    sb.Append(Table(tr)).Append("Use get_source to read the trigger body.\n");
                }
                else if (type == "SEQUENCE")
                {
                    var sq = await Q(svc, "SELECT min_value, max_value, increment_by, cache_size, last_number FROM all_sequences WHERE sequence_owner = " + L(o) + " AND sequence_name = " + L(n), 1, ct).ConfigureAwait(false);
                    sb.Append(Table(sq));
                }
                return sb.ToString();
            }).ConfigureAwait(false);
        }

        private static async Task<string> SourceAsync(FusionSqlService svc, string name, string owner, string type, int from, int to, CancellationToken ct)
        {
            string t = Up(type);
            var obj = await Resolve(svc, name, owner, t == "" ? null : (t == "PACKAGE BODY" ? "PACKAGE" : t == "TYPE BODY" ? "TYPE" : t), ct).ConfigureAwait(false);
            if (obj == null) return "No object named " + name + ". Try search_objects.";
            string o = Convert.ToString(obj["OWNER"]), n = Convert.ToString(obj["OBJECT_NAME"]), ot = Convert.ToString(obj["OBJECT_TYPE"]);
            if (ot == "SYNONYM")
            {
                var syn = await Q(svc, "SELECT table_owner, table_name FROM all_synonyms WHERE owner = " + L(o) + " AND synonym_name = " + L(n), 1, ct).ConfigureAwait(false);
                if (syn.RowCount == 0) return "Synonym target not visible.";
                return "(synonym " + n + " → " + syn.Rows[0]["TABLE_OWNER"] + "." + syn.Rows[0]["TABLE_NAME"] + ")\n" +
                       await SourceAsync(svc, Convert.ToString(syn.Rows[0]["TABLE_NAME"]), Convert.ToString(syn.Rows[0]["TABLE_OWNER"]), type, from, to, ct).ConfigureAwait(false);
            }
            if (t == "" ) t = ot;
            if (t == "VIEW" || ot == "VIEW")
            {
                var v = await svc.ExecuteAsync("SELECT text_vc FROM all_views WHERE owner = " + L(o) + " AND view_name = " + L(n), 1, ct).ConfigureAwait(false);
                return v.Success && v.RowCount > 0 ? o + "." + n + " (VIEW SQL, first 4000 chars):\n" + (v.Rows[0].TryGetValue("TEXT_VC", out var tx) ? tx : "") : "View SQL not visible.";
            }
            from = Math.Max(1, from);
            to = to <= 0 ? from + 399 : Math.Min(to, from + 399);
            string key = "source:" + o + "." + n + ":" + t + ":" + from + "-" + to;
            return await Cached(key, async () =>
            {
                var total = await Q(svc, "SELECT COUNT(*) AS n FROM all_source WHERE owner = " + L(o) + " AND name = " + L(n) + " AND type = " + L(t), 1, ct).ConfigureAwait(false);
                long lines = total.RowCount > 0 ? Convert.ToInt64(total.Rows[0]["N"], CultureInfo.InvariantCulture) : 0;
                if (lines == 0)
                    return o + "." + n + " (" + t + "): no source visible to this user" +
                           (t == "PACKAGE BODY" ? " — package bodies are often not granted/wrapped in Fusion; read the PACKAGE spec instead." : ".");
                var src = await Q(svc, "SELECT line, text FROM all_source WHERE owner = " + L(o) + " AND name = " + L(n) + " AND type = " + L(t) +
                                       " AND line BETWEEN " + from + " AND " + to + " ORDER BY line", 400, ct).ConfigureAwait(false);
                var sb = new StringBuilder(o + "." + n + " (" + t + ") lines " + from + "-" + Math.Min(to, lines) + " of " + lines + ":\n");
                foreach (var r in src.Rows)
                    sb.Append(Convert.ToString(r["LINE"], CultureInfo.InvariantCulture)).Append(": ").Append(Convert.ToString(r.TryGetValue("TEXT", out var x) ? x : "", CultureInfo.InvariantCulture)).Append('\n');
                if (src.Rows.Count > 0 && Regex.IsMatch(Convert.ToString(src.Rows[0].TryGetValue("TEXT", out var f) ? f : ""), @"\bwrapped\b", RegexOptions.IgnoreCase))
                    sb.Append("(this source is WRAPPED — it cannot be read)\n");
                if (to < lines) sb.Append("…more: call get_source with from_line=").Append(to + 1).Append('\n');
                return sb.ToString();
            }).ConfigureAwait(false);
        }

        private static async Task<string> DependenciesAsync(FusionSqlService svc, string name, string owner, CancellationToken ct)
        {
            var obj = await Resolve(svc, name, owner, null, ct).ConfigureAwait(false);
            if (obj == null) return "No object named " + name + ". Try search_objects.";
            string o = Convert.ToString(obj["OWNER"]), n = Convert.ToString(obj["OBJECT_NAME"]), type = Convert.ToString(obj["OBJECT_TYPE"]);
            return await Cached("deps:" + o + "." + n, async () =>
            {
                var sb = new StringBuilder(o + "." + n + " — " + type + "\n");
                var uses = await Q(svc, "SELECT DISTINCT referenced_owner, referenced_name, referenced_type FROM all_dependencies WHERE owner = " + L(o) + " AND name = " + L(n) +
                                        " AND referenced_owner NOT IN ('SYS','PUBLIC') ORDER BY referenced_type, referenced_name", 200, ct).ConfigureAwait(false);
                sb.Append("Uses (").Append(uses.RowCount).Append("):\n").Append(Table(uses, 5000));
                var usedBy = await Q(svc, "SELECT DISTINCT owner, name, type FROM all_dependencies WHERE referenced_owner = " + L(o) + " AND referenced_name = " + L(n) +
                                          " ORDER BY type, name", 150, ct).ConfigureAwait(false);
                sb.Append("Used by (").Append(usedBy.RowCount).Append("):\n").Append(Table(usedBy, 4000));
                if (type == "TABLE")
                {
                    var fk = await Q(svc,
                        "SELECT c.constraint_name, c.constraint_type, LISTAGG(cc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) AS columns, " +
                        "r.owner || '.' || r.table_name AS references_table FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name " +
                        "LEFT JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name " +
                        "WHERE c.owner = " + L(o) + " AND c.table_name = " + L(n) + " AND c.constraint_type IN ('P','U','R') " +
                        "GROUP BY c.constraint_name, c.constraint_type, r.owner, r.table_name ORDER BY c.constraint_type, c.constraint_name", 100, ct).ConfigureAwait(false);
                    sb.Append("Keys (P=primary, U=unique, R=foreign):\n").Append(Table(fk, 3000));
                }
                return sb.ToString();
            }).ConfigureAwait(false);
        }
    }
}

using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using FusionModel.Semantic;

namespace FusionModel.Ai
{
    /// <summary>A tool as the Claude API and MCP describe it: name, description, JSON-schema properties.</summary>
    public sealed class ToolDef
    {
        public string Name { get; init; }
        public string Description { get; init; }
        public Dictionary<string, JsonElement> Properties { get; init; } = new();
        public List<string> Required { get; init; } = new();

        /// <summary>The full JSON schema object (MCP inputSchema).</summary>
        public object Schema => new { type = "object", properties = Properties, required = Required };
    }

    /// <summary>
    /// Read-only tools over the model for any AI client (the app's Ask agent, the AI Digital Employee, MCP clients such as
    /// Claude Desktop). Every answer is compact text. Measures run through the semantic layer, so the caller's security
    /// roles apply; raw SQL is refused for users that roles restrict.
    /// </summary>
    public sealed class ModelTools
    {
        private readonly ModelEngine _e;
        public const int MaxRowsShown = 60;
        public const int MaxChars = 12000;

        public ModelTools(ModelEngine engine) { _e = engine; }

        private static JsonElement P(object schema) => JsonSerializer.SerializeToElement(schema);

        public static readonly List<ToolDef> Definitions = new()
        {
            new ToolDef
            {
                Name = "overview",
                Description = "The model at a glance: modules, tables (rows), measures (with descriptions), glossary terms and relationships. Call this first when you do not know the model.",
            },
            new ToolDef
            {
                Name = "search_model",
                Description = "Hybrid search of the model catalog: measures, tables, columns, glossary terms (with the rules to follow), verified example " +
                              "questions (with their checked query - reuse them) and column values named in the question (e.g. a customer name → the column to filter). " +
                              "Use the words of the business question.",
                Properties = { ["query"] = P(new { type = "string", description = "The question or the words to look for" }), ["k"] = P(new { type = "integer", description = "Results (default 12, max 40)" }) },
                Required = { "query" }
            },
            new ToolDef
            {
                Name = "describe",
                Description = "Details of a table (columns, types, descriptions, relationships, its measures), a column (type, description, sample values), " +
                              "a measure (expression, format, description) or a glossary term. Names: module.table, table, table[COLUMN], [Measure], term.",
                Properties = { ["name"] = P(new { type = "string", description = "What to describe" }) },
                Required = { "name" }
            },
            new ToolDef
            {
                Name = "evaluate",
                Description = "Run a measure query (the DAX-compatible language, with filter context and the user's row security). Prefer model measures. Examples:\n" +
                              "EVALUATE SUMMARIZECOLUMNS(customers[REGION], calendar[Year], \"Sales\", [Sales]) ORDER BY [Sales] DESC\n" +
                              "EVALUATE SUMMARIZECOLUMNS(items[CATEGORY], TREATAS({\"OPEN\"}, lines[STATUS]), \"Qty\", SUM(lines[QTY]))\n" +
                              "DEFINE MEASURE lines[Avg Price] = DIVIDE([Sales], SUM(lines[QTY])) EVALUATE ROW(\"Avg\", [Avg Price])\n" +
                              "Filters: FILTER(ALL(t[COL]), t[COL] = \"x\"), TREATAS({…}, t[COL]), KEEPFILTERS(…), or calendar[Year] = 2026 style predicates " +
                              "inside CALCULATE. Time intelligence: TOTALYTD, SAMEPERIODLASTYEAR, DATEADD, DATESINPERIOD over calendar[Date].",
                Properties =
                {
                    ["query"] = P(new { type = "string", description = "DEFINE MEASURE … EVALUATE SUMMARIZECOLUMNS(…) | ROW(…) [ORDER BY …]" }),
                    ["top"] = P(new { type = "integer", description = "Rows to return (default 200)" })
                },
                Required = { "query" }
            },
            new ToolDef
            {
                Name = "lookup_values",
                Description = "Distinct values of a column (optionally containing a text) - use it to get the exact spelling before filtering.",
                Properties =
                {
                    ["column"] = P(new { type = "string", description = "table[COLUMN]" }),
                    ["search"] = P(new { type = "string", description = "Text the value contains (case-insensitive); empty = the first values" }),
                    ["limit"] = P(new { type = "integer", description = "Max values (default 25)" })
                },
                Required = { "column" }
            },
            new ToolDef
            {
                Name = "run_checks",
                Description = "Run the model's reconciliation checks (e.g. GL journals vs balances, AP invoices vs schedules, trial balance) and get PASS/FAIL " +
                              "with the biggest differences. Use for 'do the books reconcile', 'is AP in balance' questions.",
                Properties = { ["names"] = P(new { type = "array", items = new { type = "string" }, description = "Check names (empty = all)" }) },
            },
            new ToolDef
            {
                Name = "run_sql",
                Description = "One read-only DuckDB SELECT across all modules (tables are module.table, e.g. sales.lines; the calendar is memory.main.calendar). " +
                              "For row-level questions and checks the measures cannot express. Not available to users restricted by security roles.",
                Properties =
                {
                    ["sql"] = P(new { type = "string", description = "SELECT / WITH statement" }),
                    ["max_rows"] = P(new { type = "integer", description = "Rows to return (default 100, max 500)" })
                },
                Required = { "sql" }
            },
        };

        public static string Describe(string name, IReadOnlyDictionary<string, JsonElement> i) => name switch
        {
            "overview" => "📚 Reading the model",
            "search_model" => "🔎 Searching the model: " + Arg(i, "query"),
            "describe" => "📋 Describing " + Arg(i, "name"),
            "evaluate" => "▶ Measures: " + Clip(Regex.Replace(Arg(i, "query") ?? "", @"\s+", " "), 110),
            "lookup_values" => "🔤 Values of " + Arg(i, "column") + (string.IsNullOrEmpty(Arg(i, "search")) ? "" : " like \"" + Arg(i, "search") + "\""),
            "run_checks" => "⚖ Running reconciliation checks",
            "run_sql" => "▶ SQL: " + Clip(Regex.Replace(Arg(i, "sql") ?? "", @"\s+", " "), 110),
            _ => "⚙ " + name
        };

        public static string Arg(IReadOnlyDictionary<string, JsonElement> i, string n) =>
            i != null && i.TryGetValue(n, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind is JsonValueKind.Number ? v.GetRawText() : null : null;

        private static int ArgInt(IReadOnlyDictionary<string, JsonElement> i, string n, int d)
        {
            var s = Arg(i, n);
            return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var x) ? x : d;
        }

        private static string Clip(string s, int n) => s.Length > n ? s.Substring(0, n) + "…" : s;

        /// <summary>Runs a tool; errors come back as text starting with ERROR (the model can correct itself).</summary>
        public async Task<string> RunAsync(string name, IReadOnlyDictionary<string, JsonElement> input, string user, CancellationToken ct = default)
        {
            try
            {
                string text = name switch
                {
                    "overview" => Overview(user),
                    "search_model" => await SearchAsync(Arg(input, "query") ?? "", Math.Clamp(ArgInt(input, "k", 12), 1, 40), ct).ConfigureAwait(false),
                    "describe" => DescribeThing(Arg(input, "name") ?? ""),
                    "evaluate" => EvaluateText(Arg(input, "query") ?? "", user, Math.Clamp(ArgInt(input, "top", 200), 1, 5000)),
                    "lookup_values" => LookupValues(Arg(input, "column") ?? "", Arg(input, "search"), user, Math.Clamp(ArgInt(input, "limit", 25), 1, 200)),
                    "run_checks" => RunChecks(input, user),
                    "run_sql" => RunSql(Arg(input, "sql") ?? "", user, Math.Clamp(ArgInt(input, "max_rows", 100), 1, 500)),
                    _ => "ERROR: unknown tool " + name
                };
                return text.Length > MaxChars ? text.Substring(0, MaxChars) + "\n…(truncated - narrow the question)" : text;
            }
            catch (MeasureException ex) { return "ERROR: " + ex.Message; }
            catch (Exception ex) { return "ERROR: " + ex.Message; }
        }

        public Task<string> RunAsync(string name, JsonElement input, string user, CancellationToken ct = default)
        {
            var dict = new Dictionary<string, JsonElement>();
            if (input.ValueKind == JsonValueKind.Object) foreach (var p in input.EnumerateObject()) dict[p.Name] = p.Value.Clone();
            return RunAsync(name, dict, user, ct);
        }

        // ── tools ────────────────────────────────────────────────────
        public string Overview(string user)
        {
            var sem = _e.Semantic();
            var def = sem.Definition;
            var manifest = _e.LoadManifest();
            var sb = new StringBuilder();
            foreach (var m in def.Modules)
            {
                manifest.Modules.TryGetValue(m.Name, out var me);
                sb.Append("MODULE ").Append(m.Name).Append(string.IsNullOrWhiteSpace(m.Title) ? "" : " - " + m.Title)
                  .Append(me == null ? " (not loaded yet)" : " (published " + me.PublishedUtc.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " UTC)").Append('\n');
                foreach (var t in def.Tables.Where(t => string.Equals(t.Module, m.Name, StringComparison.OrdinalIgnoreCase)))
                {
                    TableState ts = null; me?.Tables.TryGetValue(t.Name, out ts);
                    sb.Append("  ").Append(t.Module).Append('.').Append(t.Name).Append(ts == null ? " (empty)" : " - " + ts.Rows.ToString("#,0", CultureInfo.InvariantCulture) + " rows, " + ts.Columns.Count + " cols")
                      .Append(string.IsNullOrWhiteSpace(t.Description) ? "" : ": " + t.Description).Append('\n');
                }
            }
            if (sem.Calendar != null) sb.Append("calendar - generated dates: ").Append(string.Join(", ", sem.Calendar.Columns.Select(c => c.Name))).Append('\n');
            if (sem.Measures.Count > 0)
            {
                sb.Append("MEASURES\n");
                foreach (var ms in sem.Measures.Values.OrderBy(x => x.Folder).ThenBy(x => x.Name))
                    sb.Append("  [").Append(ms.Name).Append(']').Append(string.IsNullOrWhiteSpace(ms.Description) ? "" : " - " + ms.Description).Append('\n');
            }
            if (sem.Relationships.Count > 0)
            {
                sb.Append("RELATIONSHIPS (many → one)\n");
                foreach (var r in sem.Relationships) sb.Append("  ").Append(r.From.Id).Append(" → ").Append(r.To.Id).Append(r.Active ? "" : " (inactive: USERELATIONSHIP)").Append('\n');
            }
            if ((def.Glossary ?? new()).Count > 0)
            {
                sb.Append("GLOSSARY\n");
                foreach (var g in def.Glossary) sb.Append("  ").Append(g.Term).Append(": ").Append(g.Definition).Append(string.IsNullOrWhiteSpace(g.Rule) ? "" : " RULE: " + g.Rule).Append('\n');
            }
            if (sem.RoleFilters(user).Count > 0) sb.Append("NOTE: this user sees only the rows their security role allows; run_sql is not available.\n");
            return sb.ToString();
        }

        public async Task<string> SearchAsync(string query, int k, CancellationToken ct)
        {
            var (hits, note) = await _e.SearchAsync(query, k, ct).ConfigureAwait(false);
            if (hits.Count == 0) return "(nothing found - try other words, or call overview)";
            var sb = new StringBuilder();
            foreach (var h in hits)
            {
                var e = h.Entry;
                sb.Append(e.Kind.ToUpperInvariant()).Append(' ');
                switch (e.Kind)
                {
                    case "example": sb.Append('"').Append(e.Title).Append("\" (verified) → ").Append(e.Ref.Replace("\n", " ")); break;
                    case "value": sb.Append('"').Append(e.Title).Append("\" in ").Append(e.Ref); break;
                    case "term": sb.Append(e.Title).Append(" → ").Append(e.Ref); break;
                    default: sb.Append(e.Ref); break;
                }
                if (!string.IsNullOrWhiteSpace(e.Detail) && e.Kind != "value") sb.Append(" - ").Append(e.Detail);
                sb.Append("  [").Append(string.Join(", ", h.Why)).Append("]\n");
            }
            if (note != null) sb.Append("(").Append(note).Append(")\n");
            return sb.ToString();
        }

        public string DescribeThing(string name)
        {
            var sem = _e.Semantic();
            var ix = _e.Catalog(withValues: false);
            var e = ix.ResolveRef(name) ?? ix.Entries.FirstOrDefault(x => string.Equals(x.Title, name, StringComparison.OrdinalIgnoreCase));
            if (e == null) return "ERROR: nothing called '" + name + "' - use search_model.";
            var sb = new StringBuilder();
            switch (e.Kind)
            {
                case "table":
                {
                    var t = sem.Tables[e.Table];
                    var td = sem.Definition.Table(t.Module, t.Name);
                    sb.Append("TABLE ").Append(t.Key).Append(td?.Description is { Length: > 0 } d ? " - " + d : "").Append('\n');
                    if (t.KeyColumns.Count > 0) sb.Append("key: ").Append(string.Join(", ", t.KeyColumns)).Append('\n');
                    foreach (var c in t.Columns)
                    {
                        ColumnDoc doc = null; td?.Columns?.TryGetValue(c.Name, out doc);
                        sb.Append("  ").Append(c.Name).Append(' ').Append(c.Type).Append(string.IsNullOrWhiteSpace(doc?.Description) ? "" : " - " + doc.Description)
                          .Append(doc?.Synonyms?.Count > 0 ? " (also: " + string.Join(", ", doc.Synonyms) + ")" : "").Append('\n');
                    }
                    var rels = sem.Relationships.Where(r => r.From.Table == t || r.To.Table == t).ToList();
                    if (rels.Count > 0) sb.Append("relationships: ").Append(string.Join("; ", rels.Select(r => r.From.Id + " → " + r.To.Id + (r.Active ? "" : " (inactive)")))).Append('\n');
                    var ms = ix.Entries.Where(x => x.Kind == "measure" && x.Table == t.Key).Select(x => x.Ref).ToList();
                    if (ms.Count > 0) sb.Append("measures: ").Append(string.Join(", ", ms)).Append('\n');
                    break;
                }
                case "column":
                {
                    sb.Append("COLUMN ").Append(e.Ref).Append(" (").Append(e.Title).Append(") ").Append(e.Detail).Append('\n');
                    try
                    {
                        var col = sem.ParseColumnRef(e.Ref);
                        var r = _e.Query("SELECT COUNT(*), COUNT(DISTINCT " + Names.Q(col.Name) + "), COUNT(" + Names.Q(col.Name) + "), CAST(MIN(" + Names.Q(col.Name) + ") AS VARCHAR), CAST(MAX(" + Names.Q(col.Name) + ") AS VARCHAR) FROM " + col.Table.SqlName, 1);
                        var row = r.Rows[0];
                        sb.Append("rows ").Append(row[0]).Append(", distinct ").Append(row[1]).Append(", non-blank ").Append(row[2]).Append(", min ").Append(row[3]).Append(", max ").Append(row[4]).Append('\n');
                        if (!col.IsNumeric && !col.IsDate && !ModelEngine.RestrictedTables(sem).Contains(col.Table.Key))
                        {
                            var s = _e.Query("SELECT CAST(" + Names.Q(col.Name) + " AS VARCHAR) v, COUNT(*) n FROM " + col.Table.SqlName + " GROUP BY 1 ORDER BY n DESC LIMIT 12", 12);
                            sb.Append("top values: ").Append(string.Join(", ", s.Rows.Select(x => (x[0] ?? "(blank)") + " (" + x[1] + ")"))).Append('\n');
                        }
                    }
                    catch (Exception ex) { sb.Append("(profile not available: ").Append(ex.Message).Append(")\n"); }
                    break;
                }
                case "measure":
                {
                    var m = sem.Measures[e.Title];
                    sb.Append("MEASURE [").Append(m.Name).Append("] home ").Append(m.Table).Append('\n')
                      .Append("= ").Append(m.Expression).Append('\n');
                    if (!string.IsNullOrWhiteSpace(m.Format)) sb.Append("format ").Append(m.Format).Append('\n');
                    if (!string.IsNullOrWhiteSpace(m.Description)) sb.Append(m.Description).Append('\n');
                    if (m.Synonyms?.Count > 0) sb.Append("also called: ").Append(string.Join(", ", m.Synonyms)).Append('\n');
                    break;
                }
                default:
                    sb.Append(e.Kind.ToUpperInvariant()).Append(' ').Append(e.Title).Append(" - ").Append(e.Detail).Append('\n');
                    if (e.Refs.Count > 0) sb.Append("maps to: ").Append(string.Join(", ", e.Refs)).Append('\n');
                    if (e.Kind == "example") sb.Append("query:\n").Append(e.Ref).Append('\n');
                    break;
            }
            return sb.ToString();
        }

        public string EvaluateText(string query, string user, int top)
        {
            var r = _e.EvaluateText(query, user);
            return FormatTable(r.Columns.Select(c => c.Name).ToList(), r.Rows, r.Capped, r.Totals, top, r.Columns.Select(c => c.Format).ToList());
        }

        public string LookupValues(string column, string search, string user, int limit)
        {
            var vals = _e.LookupValues(column, search, user, limit);
            return vals.Count == 0 ? "(no values" + (string.IsNullOrEmpty(search) ? "" : " containing \"" + search + "\"") + ")" : string.Join("\n", vals);
        }

        public string RunChecks(IReadOnlyDictionary<string, JsonElement> input, string user)
        {
            List<string> names = null;
            if (input != null && input.TryGetValue("names", out var n) && n.ValueKind == JsonValueKind.Array)
                names = n.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
            var results = _e.RunChecks(user, names?.Count > 0 ? names : null);
            if (results.Count == 0) return "(no checks in the model - add a Fusion pack or define checks in Model › Checks)";
            var sb = new StringBuilder();
            foreach (var r in results)
            {
                sb.Append(r.Status).Append("  ").Append(r.Name).Append(" - ").Append(r.Description);
                if (r.Status == "ERROR") sb.Append(" · ").Append(r.Error);
                else sb.Append(" · ").Append(r.Groups).Append(" groups compared, ").Append(r.Failing).Append(" differ").Append(r.Skipped > 0 ? ", " + r.Skipped + " one-sided skipped" : "");
                sb.Append('\n');
                if (r.Rows.Count > 0) sb.Append(FormatTable(r.Columns, r.Rows, r.Failing > r.Rows.Count, null, 10, null));
            }
            return sb.ToString();
        }

        public string RunSql(string sql, string user, int max)
        {
            if (_e.Semantic().RoleFilters(user).Count > 0) return "ERROR: raw SQL is not available to this user (security roles apply). Use evaluate.";
            var r = _e.Query(sql, max);
            return FormatTable(r.Columns.Select(c => c.Name).ToList(), r.Rows, r.Capped, null, max, null);
        }

        public static string FormatTable(List<string> cols, List<object[]> rows, bool capped, object[] totals, int top, List<string> formats)
        {
            var sb = new StringBuilder();
            sb.Append(string.Join(" | ", cols)).Append('\n');
            int shown = Math.Min(Math.Min(top, MaxRowsShown), rows.Count);
            for (int i = 0; i < shown; i++) sb.Append(string.Join(" | ", rows[i].Select(Cell))).Append('\n');
            if (totals != null) sb.Append(string.Join(" | ", totals.Select((v, i) => i == 0 && v == null ? "TOTAL" : Cell(v)))).Append('\n');
            sb.Append('(').Append(rows.Count.ToString(CultureInfo.InvariantCulture)).Append(capped ? "+" : "").Append(" rows");
            if (shown < rows.Count) sb.Append(", first ").Append(shown).Append(" shown");
            sb.Append(")\n");
            return sb.ToString();
        }

        private static string Cell(object v) => v switch
        {
            null => "",
            double d => Math.Round(d, 4).ToString(CultureInfo.InvariantCulture),
            float f => Math.Round(f, 4).ToString(CultureInfo.InvariantCulture),
            decimal m => Math.Round(m, 4).ToString(CultureInfo.InvariantCulture),
            DateTime dt => dt.TimeOfDay == TimeSpan.Zero ? dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            _ => Convert.ToString(v, CultureInfo.InvariantCulture)
        };

        /// <summary>The system prompt part every AI client gets: how to use the model and the tools.</summary>
        public const string Guide =
@"You answer business questions from the Fusion Model - a semantic model (tables in modules, relationships, measures written in a
DAX-compatible language, a generated calendar, a glossary and verified examples) over DuckDB files.
How to work:
1. search_model with the words of the question first. A VERIFIED EXAMPLE that matches is the best start: reuse its query.
   A GLOSSARY term tells you which measure/column the business means and may carry a RULE you must follow.
   A VALUE hit tells you which column holds a name the user typed - filter on that column with the exact spelling.
2. Prefer model measures ([Sales]) over writing your own aggregation - they encode the business definition.
   Use describe for expressions and columns; lookup_values for exact spellings.
3. Get numbers with evaluate (DEFINE MEASURE … EVALUATE SUMMARIZECOLUMNS(…)). Use run_sql only for row-level lists or checks.
4. Never invent numbers: every figure in the answer must come from a tool result in this conversation.
Answer: lead with the figures (a short table when there are several), then one line on how they were computed
(measures, filters, period). End with the exact query you used in a ```evaluate block (or ```sql for run_sql) so it can be re-run.";
    }
}

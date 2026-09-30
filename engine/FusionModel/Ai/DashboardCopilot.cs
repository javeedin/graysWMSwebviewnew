using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace FusionModel.Ai
{
    /// <summary>
    /// Copilot for dashboards: the system prompt that teaches Claude the dashboard JSON, pulling the ```dashboard block
    /// out of an answer, and the check that runs every visual against the real model before the page ever sees it.
    /// </summary>
    public static class DashboardCopilot
    {
        public const string Schema =
@"DASHBOARD JSON (return the COMPLETE dashboard in one ```dashboard code block):
{ ""name"": ""Sales overview"", ""filters"": [],            // dashboard filters (FilterSpec, optional)
  ""pages"": [ { ""id"": ""p1"", ""name"": ""Overview"", ""filters"": [],
    ""visuals"": [ { ""id"": ""v1"", ""type"": ""card"", ""title"": ""Sales"", ""x"": 0, ""y"": 0, ""w"": 6, ""h"": 4,
                   ""fields"": { ""category"": [], ""series"": null, ""values"": [ { ""name"": ""Sales"" } ] },
                   ""top"": 1000, ""sort"": { ""by"": ""Sales"", ""desc"": true }, ""options"": {} } ] } ] }
Canvas: 24 columns wide, rows of 40 px; x 0-23, w 1-24, y from 0 down, h in rows. Visuals must not overlap.
Types and fields:
  card        one value: values[0]                                        (w 4-6, h 3-4)
  kpi         values[0] = the value, values[1] = comparison (target / last year, optional),
              category[0] = a date column for a trend line (optional, e.g. calendar[YearMonth])   (w 6, h 4-5)
  bar / column / stackedbar / stackedcolumn   category[0] = axis, series = legend (optional), values = measures
  line / area category[0] = a time column (calendar[YearMonth] / calendar[Date]), values, series optional
  combo       category[0] axis, values[0] = columns, values[1..] = lines (often a % on its own axis)
  pie / donut category[0], values[0] (≤ 8 slices - use top + sort)
  table       category = columns shown, values = measures
  matrix      category = rows, series = columns across, values
  slicer      category[0] = the column people filter by (no values); options.style = ""list"" | ""dropdown""
  gauge       values[0] = value, values[1] = maximum / target, options.max = number (optional)
  scatter     category[0] = the entity, values[0] = x measure, values[1] = y measure
  text        options.text = a heading or note (markdown-lite)
Values: { ""name"": ""Sales"" } = a model measure; { ""name"": ""Avg price"", ""expression"": ""DIVIDE([Sales], SUM(lines[QTY]))"" }
        = an ad-hoc measure in the DAX-compatible language. Prefer model measures.
Columns: Table[COLUMN] exactly as the model names them (search_model / describe); the calendar is calendar[Year],
         calendar[YearMonth], calendar[Quarter], calendar[Date] …
Filters (FilterSpec): { ""column"": ""Table[COL]"", ""op"": ""in"" | ""notIn"" | ""="" | "">="" | ""<="" | ""between"" | ""contains"" | ""blank"" | ""notBlank"", ""values"": [""…""] }
Options (all optional): ""format"": ""#,0"" | ""0.0%"", ""color"": ""#hex"", ""labels"": true, ""legend"": true, ""style"": ""list"" | ""dropdown"", ""max"": 100, ""text"": ""…"".";

        public const string Rules =
@"HOW TO DESIGN
- Think like a Power BI report designer: a title/text or KPI row on top (3-4 cards/KPIs), the main trend under it
  (line or combo over calendar[YearMonth]), then breakdowns (bar by the main dimensions, donut for share, a table
  or matrix for detail) and 1-2 slicers (e.g. year, customer) on the side or top. 6-10 visuals per page.
- Use only measures and columns that exist (use search_model / describe first). Check a doubtful visual with evaluate.
- Every visual except slicer/text needs at least one value. Give each visual a short, clear title.
- Keep ids stable when editing (only add/remove what the request asks for; keep the rest as it was).
- After the code block, add at most 3 short bullets: what the dashboard shows and any assumption.";

        public static string SystemPrompt(string mode) =>
            ModelTools.Guide + "\n\nYOU ARE THE DASHBOARD COPILOT of the Fusion Model (a Power BI-like designer).\n" +
            (mode == "insights"
                ? "Explain the page the user shares: lead with the 3-5 most important findings (numbers from the data given or " +
                  "from evaluate), then risks / anomalies and one or two suggested next questions. Plain business language, no code block."
                : Schema + "\n" + Rules);

        private static readonly Regex Block = new(@"```dashboard\s*\n(.*?)```", RegexOptions.Singleline | RegexOptions.Compiled);

        /// <summary>The dashboard in an answer's ```dashboard block (null when there is none or it is not JSON).</summary>
        public static JsonObject Extract(string answer)
        {
            var m = Block.Match(answer ?? "");
            if (!m.Success) return null;
            try { return JsonNode.Parse(m.Groups[1].Value) as JsonObject; } catch { return null; }
        }

        /// <summary>Problems in an answer (null = fine): no block, bad JSON, overlapping visuals, visuals that fail on the model.</summary>
        public static string Check(ModelEngine engine, string user, string answer)
        {
            if (!Block.IsMatch(answer ?? "")) return "No ```dashboard code block with the complete dashboard JSON.";
            var d = Extract(answer);
            if (d == null) return "The ```dashboard block is not valid JSON.";
            if (d["pages"] is not JsonArray pages || pages.Count == 0) return "The dashboard has no pages.";
            var problems = new List<string>();
            foreach (var p in pages.OfType<JsonObject>())
            {
                var boxes = new List<(string Title, int X, int Y, int W, int H)>();
                foreach (var v in (p["visuals"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
                {
                    int x = (int?)v["x"] ?? 0, y = (int?)v["y"] ?? 0, w = (int?)v["w"] ?? 6, h = (int?)v["h"] ?? 4;
                    string t = (string)v["title"] ?? (string)v["type"];
                    if (x < 0 || w < 1 || x + w > 24) problems.Add((string)p["name"] + " › " + t + ": x + w must fit in 24 columns");
                    foreach (var b in boxes)
                        if (x < b.X + b.W && b.X < x + w && y < b.Y + b.H && b.Y < y + h) { problems.Add((string)p["name"] + " › " + t + " overlaps " + b.Title); break; }
                    boxes.Add((t, x, y, w, h));
                }
            }
            problems.AddRange(engine.ValidateDashboard(d, user));
            return problems.Count == 0 ? null : string.Join("\n", problems.Take(20));
        }
    
        /// <summary>
        /// A dashboard without AI: KPI cards for the first measures, the trend over months, breakdowns by the main
        /// dimensions, a detail table and a year slicer - every visual checked against the model, failing ones dropped.
        /// </summary>
        public static JsonObject Auto(ModelEngine engine, string user, string module = null, string name = null)
        {
            var sem = engine.Semantic();
            var measures = sem.Measures.Values
                .Where(m => module == null || (m.Table ?? "").StartsWith(module + ".", StringComparison.OrdinalIgnoreCase))
                .Where(m => { try { return sem.ResolveTable(m.Table) != null; } catch { return false; } }).ToList();
            if (measures.Count == 0) throw new InvalidOperationException("No measures" + (module == null ? "" : " in module " + module) + " yet - add measures (or a Fusion pack) first.");
            var main = measures[0];
            // the fact table is the one the formula reads (measures are often parked on any table), else the home table
            FusionModel.Semantic.SemTable home = null;
            foreach (Match tm in Regex.Matches(main.Expression ?? "", @"'?([A-Za-z_][\w.]*)'?\["))
            { try { home = sem.ResolveTable(tm.Groups[1].Value); if (home != null && !home.IsCalendar) break; home = null; } catch { } }
            home ??= sem.ResolveTable(main.Table);
            var planner = new FusionModel.Semantic.QueryPlanner(sem);
            bool dated = sem.Calendar != null && sem.Relationships.Any(r => r.Active && r.To.Table == sem.Calendar && (r.From.Table == home || sem.Relationships.Any(q => q.From.Table == home && q.To.Table == r.From.Table)));
            // dimensions: text columns of the home table and the tables it points to, 2-50 distinct values
            var dims = new List<string>();
            // dimension tables first (customers, items …), then the fact table's own text columns
            var tables = sem.Relationships.Where(r => r.From.Table == home && !r.To.Table.IsCalendar).Select(r => r.To.Table).Distinct().ToList();
            tables.Add(home);
            foreach (var t in tables.Distinct())
                foreach (var c in t.Columns.Where(c => c.Type != null && c.Type.StartsWith("VARCHAR", StringComparison.OrdinalIgnoreCase) &&
                                                       !System.Text.RegularExpressions.Regex.IsMatch(c.Name, @"(_ID|_KEY|ID|_NUM|_NUMBER|DESCRIPTION|_DATE)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)))
                {
                    if (dims.Count >= 3) break;
                    try
                    {
                        var n = Convert.ToInt64(engine.Query("SELECT approx_count_distinct(" + Names.Q(c.Name) + ") FROM " + t.SqlName, 1).Rows[0][0]);
                        if (n >= 2 && n <= 50) dims.Add(planner.Display(c));
                    }
                    catch { }
                }
            JsonObject V(string id, string type, string title, int x, int y, int w, int h, string[] cat, string series, IEnumerable<string> vals, JsonObject opt = null, int? top = null, string sortBy = null)
            {
                var v = new JsonObject
                {
                    ["id"] = id, ["type"] = type, ["title"] = title, ["x"] = x, ["y"] = y, ["w"] = w, ["h"] = h,
                    ["fields"] = new JsonObject
                    {
                        ["category"] = new JsonArray((cat ?? Array.Empty<string>()).Select(c => (JsonNode)c).ToArray()),
                        ["series"] = series,
                        ["values"] = new JsonArray(vals.Select(n => (JsonNode)new JsonObject { ["name"] = n }).ToArray())
                    },
                    ["options"] = opt ?? new JsonObject()
                };
                if (top != null) v["top"] = top;
                if (sortBy != null) v["sort"] = new JsonObject { ["by"] = sortBy, ["desc"] = true };
                return v;
            }
            var visuals = new List<JsonObject>();
            var cards = measures.Take(4).ToList();
            int cw = 24 / Math.Max(1, cards.Count);
            for (int i = 0; i < cards.Count; i++) visuals.Add(V("c" + (i + 1), "card", cards[i].Name, i * cw, 0, cw, 3, null, null, new[] { cards[i].Name }));
            int y = 3;
            if (dated)
            {
                // one value axis: the trend only pairs measures of the same kind (never a % next to an amount)
                bool pct(MeasureDef m) => (m.Format ?? "").EndsWith("%") || Regex.IsMatch(m.Expression ?? "", @"^\s*DIVIDE", RegexOptions.IgnoreCase);
                visuals.Add(V("trend", "line", main.Name + " by month", 0, y, 18, 8, new[] { "calendar[YearMonth]" }, null, measures.Take(3).Where(m => pct(m) == pct(main)).Take(2).Select(m => m.Name)));
                visuals.Add(V("year", "slicer", "Year", 18, y, 6, 8, new[] { "calendar[Year]" }, null, Array.Empty<string>(), new JsonObject { ["style"] = "list" }));
                y += 8;
            }
            if (dims.Count > 0) visuals.Add(V("by1", "bar", main.Name + " by " + Short(dims[0]), 0, y, dims.Count > 1 ? 12 : 24, 8, new[] { dims[0] }, null, new[] { main.Name }, null, 15, main.Name));
            if (dims.Count > 1) visuals.Add(V("by2", "donut", main.Name + " by " + Short(dims[1]), 12, y, 12, 8, new[] { dims[1] }, null, new[] { main.Name }, null, 8, main.Name));
            if (dims.Count > 0) { y += 8; visuals.Add(V("detail", "table", "Detail by " + Short(dims[0]), 0, y, 24, 8, new[] { dims[0] }, null, cards.Select(m => m.Name), null, 200, main.Name)); }
            var d = new JsonObject
            {
                ["name"] = name ?? (module == null ? "Overview" : module.ToUpperInvariant() + " overview"),
                ["filters"] = new JsonArray(),
                ["pages"] = new JsonArray(new JsonObject { ["id"] = "p1", ["name"] = "Overview", ["filters"] = new JsonArray(), ["visuals"] = new JsonArray(visuals.Select(v => (JsonNode)v).ToArray()) })
            };
            // drop what does not run on this model
            var page = (JsonObject)((JsonArray)d["pages"])[0];
            var bad = engine.ValidateDashboard(d, user).Select(e => e.Split(':')[0]).ToHashSet();
            var keep = ((JsonArray)page["visuals"]).OfType<JsonObject>().Where(v => !bad.Contains("Overview › " + (string)v["title"])).Select(v => v.DeepClone()).ToArray();
            page["visuals"] = new JsonArray(keep);
            return d;
        }

        private static string Short(string col) { var m = Regex.Match(col, @"\[([^\]]+)\]"); return m.Success ? m.Groups[1].Value.Replace('_', ' ').ToLowerInvariant() : col; }
    }
}

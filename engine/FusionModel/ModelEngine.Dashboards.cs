using System.Text.Json;
using System.Text.Json.Nodes;
using FusionModel.Semantic;

namespace FusionModel
{
    /// <summary>
    /// Dashboards (Power BI-style pages of visuals) saved for everyone in {share}\dashboards.json. A dashboard is JSON the
    /// page owns (layout, format); the engine only needs each visual's data fields, which map to one semantic request:
    ///   { id, name, folder, filters:[FilterSpec], pages:[{ id, name, filters:[…], visuals:[{ id, type, title, x, y, w, h,
    ///     fields:{ category:[Table[Col]…], series:"Table[Col]", values:[{name, expression?}…] }, top, sort, options:{…} }] }] }
    /// </summary>
    public sealed partial class ModelEngine
    {
        public const int MaxDashboardBytes = 2_000_000;
        public string DashboardsPath => Path.Combine(Root, "dashboards.json");

        public List<JsonObject> LoadDashboards()
        {
            var path = SharedReachable ? DashboardsPath : Path.Combine(Settings.CacheRoot ?? "", "dashboards.json");
            if (!File.Exists(path)) return new List<JsonObject>();
            return (JsonNode.Parse(File.ReadAllText(path)) as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList();
        }

        public JsonObject SaveDashboard(JsonObject d, string by)
        {
            if (string.IsNullOrWhiteSpace((string)d?["name"])) throw new ArgumentException("A dashboard needs a name.");
            if (d["pages"] is not JsonArray pages || pages.Count == 0) throw new ArgumentException("A dashboard needs at least one page.");
            if (pages.Count > 30) throw new ArgumentException("At most 30 pages.");
            foreach (var p in pages.OfType<JsonObject>())
                if ((p["visuals"] as JsonArray)?.Count > 80) throw new ArgumentException("At most 80 visuals on a page.");
            d = (JsonObject)d.DeepClone();
            if (string.IsNullOrWhiteSpace((string)d["id"])) d["id"] = Guid.NewGuid().ToString("N").Substring(0, 12);
            d["by"] = by;
            d["utc"] = DateTime.UtcNow.ToString("o");
            if (d.ToJsonString().Length > MaxDashboardBytes) throw new ArgumentException("The dashboard is too large.");
            var list = LoadDashboards();
            list.RemoveAll(x => (string)x["id"] == (string)d["id"]);
            list.Add(d);
            WriteDashboards(list);
            return d;
        }

        public bool DeleteDashboard(string id)
        {
            var list = LoadDashboards();
            int n = list.RemoveAll(x => (string)x["id"] == id);
            if (n > 0) WriteDashboards(list);
            return n > 0;
        }

        private void WriteDashboards(List<JsonObject> list)
        {
            var arr = new JsonArray(list.Select(x => (JsonNode)x.DeepClone()).ToArray());
            Directory.CreateDirectory(Root);
            string tmp = DashboardsPath + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
            File.WriteAllText(tmp, arr.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            File.Move(tmp, DashboardsPath, overwrite: true);
            TryCopyToCache(DashboardsPath);
        }

        /// <summary>The semantic request behind one visual (dashboard, page and extra filters applied).</summary>
        public static SemanticRequest VisualRequest(JsonObject visual, IEnumerable<FilterSpec> filters = null)
        {
            var f = visual["fields"] as JsonObject ?? new JsonObject();
            string type = ((string)visual["type"] ?? "").ToLowerInvariant();
            var req = new SemanticRequest { Filters = filters?.ToList() ?? new() };
            foreach (var c in (f["category"] as JsonArray ?? new JsonArray()).Select(x => (string)x).Where(x => !string.IsNullOrWhiteSpace(x)))
                if (!req.GroupBy.Contains(c)) req.GroupBy.Add(c);
            string series = (string)f["series"];
            if (!string.IsNullOrWhiteSpace(series) && !req.GroupBy.Contains(series)) req.GroupBy.Add(series);
            if (type != "slicer")
                foreach (var v in (f["values"] as JsonArray ?? new JsonArray()).OfType<JsonNode>())
                {
                    if (v is JsonValue) { req.Measures.Add(new MeasureSpec { Name = (string)v }); continue; }
                    var o = (JsonObject)v;
                    req.Measures.Add(new MeasureSpec { Name = (string)o["name"], Expression = string.IsNullOrWhiteSpace((string)o["expression"]) ? null : (string)o["expression"] });
                }
            int top = (int?)visual["top"] ?? (type is "slicer" ? 500 : 1000);
            req.Top = Math.Clamp(top, 1, 10000);
            if (visual["sort"] is JsonObject s && !string.IsNullOrWhiteSpace((string)s["by"])) req.OrderBy.Add(new OrderSpec { By = (string)s["by"], Desc = (bool?)s["desc"] ?? true });
            return req;
        }

        public static List<FilterSpec> Filters(JsonNode node) =>
            node is JsonArray a ? a.Deserialize<List<FilterSpec>>(Json.Options) ?? new() : new();

        /// <summary>Runs every visual of a dashboard (5 rows each) and returns the problems as "page › visual: error".</summary>
        public List<string> ValidateDashboard(JsonObject d, string user) => ValidateDashboard(d, user, null);

        /// <summary>Runs every visual (top 5 rows); each one stops after <paramref name="perVisual"/> (reported as an error)
        /// and all stop when <paramref name="ct"/> is cancelled. <paramref name="progress"/> gets "visual i of n".</summary>
        public List<string> ValidateDashboard(JsonObject d, string user, TimeSpan? perVisual, CancellationToken ct = default, Action<string> progress = null)
        {
            var errors = new List<string>();
            int total = (d["pages"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Sum(p => (p["visuals"] as JsonArray)?.Count ?? 0), n = 0;
            var dashFilters = Filters(d["filters"]);
            foreach (var p in (d["pages"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
            {
                var pageFilters = dashFilters.Concat(Filters(p["filters"])).ToList();
                foreach (var v in (p["visuals"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
                {
                    string where = (string)p["name"] + " › " + ((string)v["title"] ?? (string)v["type"] ?? "visual");
                    ct.ThrowIfCancellationRequested();
                    progress?.Invoke("Checking visual " + (++n) + " of " + total + ": " + ((string)v["title"] ?? (string)v["type"]));
                    string type = ((string)v["type"] ?? "").ToLowerInvariant();
                    if (!Visuals.Contains(type)) { errors.Add(where + ": unknown visual type '" + type + "' (use " + string.Join(", ", Visuals) + ")"); continue; }
                    if (type is "text") continue;
                    try
                    {
                        var req = VisualRequest(v, pageFilters);
                        if (req.Measures.Count == 0 && req.GroupBy.Count == 0) { errors.Add(where + ": no fields"); continue; }
                        if (type != "slicer" && req.Measures.Count == 0) { errors.Add(where + ": needs at least one value (measure)"); continue; }
                        req.Top = 5;
                        Evaluate(req, user, perVisual, ct);
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
                    catch (Exception ex) { errors.Add(where + ": " + ex.Message); }
                }
            }
            return errors;
        }

        public static readonly string[] Visuals =
            { "card", "kpi", "bar", "column", "stackedbar", "stackedcolumn", "line", "area", "combo", "pie", "donut", "table", "matrix", "slicer", "gauge", "scatter", "text" };
    }
}

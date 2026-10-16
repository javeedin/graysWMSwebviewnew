using System.Text.Json;
using FusionModel.Ai;
using FusionModel.Semantic;

namespace FusionModel
{
    /// <summary>Catalog, hybrid search, verified examples and value lookup (what the AI and the Ask tab use).</summary>
    public sealed partial class ModelEngine
    {
        private readonly object _catalogLock = new();
        private CatalogIndex _catalog;
        private string _catalogKey;
        private ValueIndex _valueIndex;
        private string _valueKey;
        private VectorIndex _vectors;

        /// <summary>Optional embeddings provider (the host sets it when a key is saved); null = search without vectors.</summary>
        public IEmbedder Embedder { get; set; }

        public string ExamplesPath => Path.Combine(Root, "examples.json");

        public List<VerifiedExample> LoadExamples()
        {
            var path = SharedReachable ? ExamplesPath : Path.Combine(Settings.CacheRoot ?? "", "examples.json");
            return Json.Read<List<VerifiedExample>>(path) ?? new List<VerifiedExample>();
        }

        public VerifiedExample SaveExample(VerifiedExample x)
        {
            if (string.IsNullOrWhiteSpace(x?.Question) || string.IsNullOrWhiteSpace(x.Query)) throw new ArgumentException("An example needs a question and a query.");
            var list = LoadExamples();
            if (string.IsNullOrWhiteSpace(x.Id)) x.Id = Guid.NewGuid().ToString("N").Substring(0, 12);
            x.Utc = DateTime.UtcNow;
            list.RemoveAll(e => e.Id == x.Id || string.Equals(e.Question?.Trim(), x.Question.Trim(), StringComparison.OrdinalIgnoreCase));
            list.Add(x);
            Json.WriteAtomic(ExamplesPath, list);
            TryCopyToCache(ExamplesPath);
            return x;
        }

        public bool DeleteExample(string id)
        {
            var list = LoadExamples();
            int n = list.RemoveAll(e => e.Id == id);
            if (n > 0) { Json.WriteAtomic(ExamplesPath, list); TryCopyToCache(ExamplesPath); }
            return n > 0;
        }

        private void TryCopyToCache(string path)
        {
            try { Directory.CreateDirectory(Settings.CacheRoot); File.Copy(path, Path.Combine(Settings.CacheRoot, Path.GetFileName(path)), true); } catch { }
        }

        /// <summary>
        /// Distinct values of the text columns with at most <see cref="ValueIndex.MaxDistinct"/> values. Tables a security role
        /// filters - and tables that point to one - are left out, so search never shows a value a user may not see.
        /// </summary>
        public ValueIndex BuildValueIndex(SemanticModel sem)
        {
            var vi = new ValueIndex();
            var restricted = RestrictedTables(sem);
            var planner = new QueryPlanner(sem);
            lock (_sessionLock)
            {
                var conn = Session();
                foreach (var t in sem.Tables.Values)
                {
                    if (t.IsCalendar || restricted.Contains(t.Key)) continue;
                    var text = t.Columns.Where(c => c.Type != null && (c.Type.StartsWith("VARCHAR", StringComparison.OrdinalIgnoreCase) || c.Type == "TEXT")).ToList();
                    if (text.Count == 0) continue;
                    try
                    {
                        using var cmd = conn.CreateCommand();
                        cmd.CommandText = "SELECT " + string.Join(", ", text.Select(c => "approx_count_distinct(" + Names.Q(c.Name) + ")")) + " FROM " + t.SqlName;
                        using var r = cmd.ExecuteReader();
                        if (!r.Read()) continue;
                        var small = text.Where((c, i) => !r.IsDBNull(i) && Convert.ToInt64(r.GetValue(i)) is > 0 and <= ValueIndex.MaxDistinct).ToList();
                        foreach (var c in small)
                        {
                            using var dc = conn.CreateCommand();
                            dc.CommandText = "SELECT DISTINCT CAST(" + Names.Q(c.Name) + " AS VARCHAR) FROM " + t.SqlName + " WHERE " + Names.Q(c.Name) + " IS NOT NULL LIMIT " + ValueIndex.MaxDistinct;
                            using var dr = dc.ExecuteReader();
                            var vals = new List<string>();
                            while (dr.Read()) { var v = dr.GetString(0); if (v.Length is > 0 and <= 120) vals.Add(v); }
                            // ids and codes that look like numbers are not worth indexing as words
                            if (vals.Count > 0 && vals.Count(v => double.TryParse(v, out _)) < vals.Count / 2) vi.Columns.Add((t.Key + "[" + c.Name + "]", vals));
                        }
                    }
                    catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FusionModel] value index " + t.Key + ": " + ex.Message); }
                }
            }
            return vi;
        }

        /// <summary>Tables filtered by any role, plus every table whose rows reach one through many-to-one relationships.</summary>
        public static HashSet<string> RestrictedTables(SemanticModel sem)
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var r in sem.Definition.Roles ?? new())
                foreach (var f in r.Filters ?? new())
                    if (sem.Tables.TryGetValue(f.Table ?? "", out var t)) set.Add(t.Key);
            bool grew = true;
            while (grew)
            {
                grew = false;
                foreach (var rel in sem.Relationships)
                    if (set.Contains(rel.To.Table.Key) && set.Add(rel.From.Table.Key)) grew = true;
            }
            return set;
        }

        /// <summary>The catalog for the published model (rebuilt when the model, a module version or the examples change).</summary>
        public CatalogIndex Catalog(bool withValues = true)
        {
            var sem = Semantic();
            var examples = LoadExamples();
            string vkey = _semKey;
            string key = _semKey + "|" + JsonSerializer.Serialize(sem.Definition.Glossary) + JsonSerializer.Serialize(sem.Definition.Tables.Select(t => new { t.Description, t.Synonyms, t.Columns })) +
                         "|" + string.Join(",", examples.Select(e => e.Id + e.Utc.Ticks)) + "|" + withValues;
            lock (_catalogLock)
            {
                if (_catalog != null && _catalogKey == key) return _catalog;
                if (withValues && (_valueIndex == null || _valueKey != vkey)) { _valueIndex = BuildValueIndex(sem); _valueKey = vkey; }
                _catalog = CatalogIndex.Build(sem, examples, withValues ? _valueIndex : null);
                _catalogKey = key;
                return _catalog;
            }
        }

        /// <summary>Hybrid search over the catalog; adds vectors when an embedder is set (and falls back quietly when it fails).</summary>
        public async Task<(List<SearchHit> Hits, string VectorNote)> SearchAsync(string question, int k = 12, CancellationToken ct = default)
        {
            var ix = Catalog();
            List<(int, double)> vec = null;
            string note = null;
            if (Embedder != null)
            {
                try
                {
                    _vectors ??= new VectorIndex(string.IsNullOrWhiteSpace(Settings.CacheRoot) ? null : Path.Combine(Settings.CacheRoot, "catalog_vectors.json"));
                    vec = await _vectors.SearchAsync(ix, Embedder, question, 30, ct).ConfigureAwait(false);
                }
                catch (Exception ex) { note = "Vectors not used: " + ex.Message; }
            }
            return (ix.Search(question, k, vec), note);
        }

        /// <summary>Distinct values of a column containing <paramref name="search"/>, through the semantic layer so row security applies.</summary>
        public List<string> LookupValues(string column, string search, string user, int max = 25)
        {
            var req = new SemanticRequest { GroupBy = { column }, Top = Math.Clamp(max, 1, 200) };
            if (!string.IsNullOrWhiteSpace(search)) req.Filters.Add(new FilterSpec { Column = column, Op = "contains", Values = { search } });
            var r = Evaluate(req, user);
            return r.Rows.Select(x => x[0] == null ? "(blank)" : Convert.ToString(x[0], System.Globalization.CultureInfo.InvariantCulture)).ToList();
        }
    }
}

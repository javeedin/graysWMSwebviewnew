using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using FusionModel.Semantic;

namespace FusionModel.Ai
{
    /// <summary>One searchable thing in the model: a table, column, measure, glossary term, verified example or column value.</summary>
    public sealed class CatalogEntry
    {
        public string Id { get; set; }            // m:Sales · c:sales.lines[QTY] · t:sales.lines · g:DSO · x:ab12 · v:sales.customers[NAME]=Acme
        public string Kind { get; set; }          // table | column | measure | term | example | value
        public string Title { get; set; }         // what people call it
        public string Ref { get; set; }           // what a query uses: [Sales] · lines[QTY] · sales.lines
        public string Table { get; set; }         // owning table key (graph neighbours)
        public string Detail { get; set; }        // one line shown in results (type, expression, definition …)
        public List<string> Names { get; set; } = new();   // title + synonyms (fuzzy and phrase matching)
        public string Text { get; set; }          // everything searchable
        public List<string> Refs { get; set; } = new();    // glossary: what the term maps to
        public string Rule { get; set; }
    }

    public sealed class SearchHit
    {
        public CatalogEntry Entry { get; set; }
        public double Score { get; set; }
        public List<string> Why { get; set; } = new();
    }

    /// <summary>
    /// Lexical helpers: split snake_case / camelCase / punctuation, lower-case, drop stop words, light stemming
    /// (customers → customer, invoiced → invoic, shipping → ship) so "invoices shipped" meets INVOICE_ID / SHIP_DATE.
    /// </summary>
    public static class Text
    {
        private static readonly HashSet<string> Stop = new(StringComparer.Ordinal)
        {
            "a","an","the","of","for","in","on","by","to","and","or","is","are","was","were","be","what","which","who","how","many","much",
            "show","me","list","give","get","find","all","per","with","from","at","as","this","that","these","those","do","does","did","i","we",
            "our","my","it","its","there","their","please","can","you","tell","about","each","every","total","value","values","number"
        };

        public static List<string> Words(string s)
        {
            var list = new List<string>();
            if (string.IsNullOrEmpty(s)) return list;
            // camelCase → camel Case, then split on anything that is not a letter or digit
            string spaced = Regex.Replace(s, @"(?<=[a-z0-9])(?=[A-Z])", " ");
            foreach (Match m in Regex.Matches(spaced.ToLowerInvariant(), @"[\p{L}\p{N}]+")) list.Add(m.Value);
            return list;
        }

        public static string Stem(string w)
        {
            if (w.Length <= 3 || char.IsDigit(w[0])) return w;
            foreach (var suf in new[] { "ings", "ing", "ies", "ied", "es", "ed", "s" })
            {
                if (!w.EndsWith(suf, StringComparison.Ordinal) || w.Length - suf.Length < 3) continue;
                string b = w.Substring(0, w.Length - suf.Length);
                if (suf is "ies" or "ied") return b + "y";
                if (suf == "es" && !Regex.IsMatch(b, "(s|x|z|ch|sh)$")) b = w.Substring(0, w.Length - 1);   // "invoices" → "invoice"
                if (suf == "s" && w.EndsWith("ss", StringComparison.Ordinal)) return w;
                // shipping → shipp → ship
                if (b.Length > 3 && b[^1] == b[^2] && !"lsz".Contains(b[^1])) b = b.Substring(0, b.Length - 1);
                return b;
            }
            return w;
        }

        public static List<string> Tokens(string s) => Words(s).Where(w => !Stop.Contains(w)).Select(Stem).ToList();

        /// <summary>Lower-case, single-spaced words (for phrase and value matching).</summary>
        public static string Norm(string s) => string.Join(" ", Words(s));

        public static HashSet<string> Trigrams(string w)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            string p = "  " + w + " ";
            for (int i = 0; i + 3 <= p.Length; i++) set.Add(p.Substring(i, 3));
            return set;
        }

        public static double Similar(string a, string b)
        {
            if (a == b) return 1;
            var x = Trigrams(a); var y = Trigrams(b);
            int inter = x.Count(y.Contains);
            return inter == 0 ? 0 : (double)inter / (x.Count + y.Count - inter);
        }
    }

    /// <summary>
    /// The model's catalog and its hybrid search: BM25 over names, descriptions, synonyms and expressions; trigram fuzzy
    /// matching of names (typos, abbreviations); glossary expansion (a term pulls in what it maps to); column values
    /// ("Acme" → customers[NAME]); verified examples; optional vectors; neighbours in the relationship graph. The ranked
    /// lists are merged with reciprocal-rank fusion.
    /// </summary>
    public sealed class CatalogIndex
    {
        public List<CatalogEntry> Entries { get; } = new();
        private readonly Dictionary<string, CatalogEntry> _byId = new(StringComparer.OrdinalIgnoreCase);
        private List<string>[] _docTokens;
        private readonly Dictionary<string, int> _df = new(StringComparer.Ordinal);
        private double _avgLen;
        private readonly Dictionary<string, HashSet<string>> _neighbours = new(StringComparer.OrdinalIgnoreCase);
        /// <summary>Normalised value → (column ref, original value).</summary>
        private readonly Dictionary<string, List<(string Column, string Table, string Value)>> _values = new(StringComparer.Ordinal);
        public int ValueCount { get; private set; }
        /// <summary>Word → normalised values containing it (partial matches: "blue bay" → "Blue Bay Traders").</summary>
        private readonly Dictionary<string, List<string>> _valueWords = new(StringComparer.Ordinal);

        public CatalogEntry Get(string id) => _byId.TryGetValue(id ?? "", out var e) ? e : null;

        public static CatalogIndex Build(SemanticModel sem, IEnumerable<VerifiedExample> examples, ValueIndex values)
        {
            var ix = new CatalogIndex();
            var def = sem.Definition;
            var planner = new QueryPlanner(sem);
            var defs = def.Tables.ToDictionary(t => t.Module + "." + t.Name, StringComparer.OrdinalIgnoreCase);
            var modules = def.Modules.ToDictionary(m => m.Name, StringComparer.OrdinalIgnoreCase);

            foreach (var t in sem.Tables.Values)
            {
                defs.TryGetValue(t.Key, out var td);
                string moduleTitle = t.Module != null && modules.TryGetValue(t.Module, out var md) ? md.Title + " " + md.Description : "";
                var names = new List<string> { t.Name };
                names.AddRange(td?.Synonyms ?? new());
                if (t.IsCalendar) names.AddRange(new[] { "date", "calendar", "period" });
                ix.Add(new CatalogEntry
                {
                    Id = "t:" + t.Key, Kind = "table", Title = t.Key, Ref = t.Key, Table = t.Key, Names = names,
                    Detail = (t.IsCalendar ? "Generated date table (one row per day, fiscal columns)" : td?.Description ?? "") + " · " + t.Columns.Count + " columns",
                    Text = string.Join(" ", names) + " " + td?.Description + " " + moduleTitle + " " + string.Join(" ", t.Columns.Select(c => c.Name))
                });
                foreach (var c in t.Columns)
                {
                    ColumnDoc doc = null; td?.Columns?.TryGetValue(c.Name, out doc);
                    var cn = new List<string> { c.Name };
                    cn.AddRange(doc?.Synonyms ?? new());
                    string cref = planner.Display(c);
                    ix.Add(new CatalogEntry
                    {
                        Id = "c:" + c.Id, Kind = "column", Title = c.Id, Ref = cref, Table = t.Key, Names = cn,
                        Detail = c.Type + (string.IsNullOrWhiteSpace(doc?.Description) ? "" : " · " + doc.Description),
                        Text = string.Join(" ", cn) + " " + doc?.Description + " " + t.Name + " " + string.Join(" ", td?.Synonyms ?? new())
                    });
                }
            }
            foreach (var m in sem.Measures.Values)
            {
                string home = null;
                try { if (!string.IsNullOrWhiteSpace(m.Table)) home = sem.ResolveTable(m.Table).Key; } catch { }
                var names = new List<string> { m.Name };
                names.AddRange(m.Synonyms ?? new());
                ix.Add(new CatalogEntry
                {
                    Id = "m:" + m.Name, Kind = "measure", Title = m.Name, Ref = "[" + m.Name + "]", Table = home, Names = names,
                    Detail = (string.IsNullOrWhiteSpace(m.Description) ? "" : m.Description + " · ") + "= " + Short(m.Expression, 160),
                    // identifiers inside the expression count too: [Sales] mentions QTY and PRICE
                    Text = string.Join(" ", names) + " " + m.Description + " " + m.Folder + " " + m.Expression
                });
            }
            foreach (var g in def.Glossary ?? new())
            {
                if (string.IsNullOrWhiteSpace(g.Term)) continue;
                var names = new List<string> { g.Term };
                names.AddRange(g.Synonyms ?? new());
                ix.Add(new CatalogEntry
                {
                    Id = "g:" + g.Term, Kind = "term", Title = g.Term, Ref = string.Join(", ", g.Refs ?? new()), Names = names, Refs = g.Refs ?? new(), Rule = g.Rule,
                    Detail = g.Definition + (string.IsNullOrWhiteSpace(g.Rule) ? "" : " · Rule: " + g.Rule),
                    Text = string.Join(" ", names) + " " + g.Definition + " " + g.Rule
                });
            }
            foreach (var x in examples ?? Enumerable.Empty<VerifiedExample>())
            {
                if (string.IsNullOrWhiteSpace(x.Question) || string.IsNullOrWhiteSpace(x.Query)) continue;
                ix.Add(new CatalogEntry
                {
                    Id = "x:" + x.Id, Kind = "example", Title = x.Question, Ref = x.Query, Names = { x.Question },
                    Detail = (x.Kind ?? "evaluate") + (string.IsNullOrWhiteSpace(x.Note) ? "" : " · " + x.Note),
                    Text = x.Question + " " + x.Note
                });
            }
            foreach (var r in sem.Relationships)
            {
                ix.Link(r.From.Table.Key, r.To.Table.Key);
            }
            if (values != null)
                foreach (var (col, list) in values.Columns)
                {
                    SemColumn sc = null;
                    try { sc = sem.ParseColumnRef(col); } catch { }
                    if (sc == null) continue;
                    string cref = planner.Display(sc);
                    foreach (var v in list)
                    {
                        string n = Text.Norm(v);
                        if (n.Length == 0) continue;
                        if (!ix._values.TryGetValue(n, out var l))
                        {
                            ix._values[n] = l = new();
                            foreach (var w in n.Split(' ').Distinct())
                                if (w.Length >= 3) { if (!ix._valueWords.TryGetValue(w, out var wl)) ix._valueWords[w] = wl = new(); wl.Add(n); }
                        }
                        l.Add((cref, sc.Table.Key, v));
                        ix.ValueCount++;
                    }
                }
            ix.Finish();
            return ix;
        }

        private static string Short(string s, int n) { s = Regex.Replace(s ?? "", @"\s+", " ").Trim(); return s.Length > n ? s.Substring(0, n) + "…" : s; }

        private void Add(CatalogEntry e) { if (_byId.ContainsKey(e.Id)) return; Entries.Add(e); _byId[e.Id] = e; }

        private void Link(string a, string b)
        {
            if (!_neighbours.TryGetValue(a, out var x)) _neighbours[a] = x = new(StringComparer.OrdinalIgnoreCase);
            if (!_neighbours.TryGetValue(b, out var y)) _neighbours[b] = y = new(StringComparer.OrdinalIgnoreCase);
            x.Add(b); y.Add(a);
        }

        private void Finish()
        {
            _docTokens = Entries.Select(e => FusionModel.Ai.Text.Tokens(e.Text)).ToArray();
            foreach (var toks in _docTokens) foreach (var t in toks.Distinct()) _df[t] = _df.TryGetValue(t, out var n) ? n + 1 : 1;
            _avgLen = _docTokens.Length == 0 ? 1 : Math.Max(1, _docTokens.Average(d => d.Count));
        }

        // ── ranked lists ─────────────────────────────────────────────
        public List<(int Doc, double Score)> Bm25(IList<string> q, int k = 50)
        {
            const double k1 = 1.2, b = 0.75;
            int n = Entries.Count;
            var scores = new List<(int, double)>();
            var qset = q.Distinct().ToList();
            for (int d = 0; d < n; d++)
            {
                var doc = _docTokens[d];
                double s = 0;
                foreach (var t in qset)
                {
                    int tf = 0; foreach (var w in doc) if (w == t) tf++;
                    if (tf == 0) continue;
                    int df = _df.TryGetValue(t, out var x) ? x : 0;
                    double idf = Math.Log(1 + (n - df + 0.5) / (df + 0.5));
                    s += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * doc.Count / _avgLen));
                }
                // names count double: a hit in the name beats a hit in a long description
                if (s > 0 && Entries[d].Names.Any(nm => FusionModel.Ai.Text.Tokens(nm).Any(qset.Contains))) s *= 1.5;
                if (s > 0) scores.Add((d, s));
            }
            return scores.OrderByDescending(x => x.Item2).Take(k).ToList();
        }

        public List<(int Doc, double Score)> Fuzzy(IList<string> q, int k = 30)
        {
            var words = q.Where(w => w.Length >= 3).Distinct().ToList();
            var scores = new List<(int, double)>();
            if (words.Count == 0) return scores;
            for (int d = 0; d < Entries.Count; d++)
            {
                var e = Entries[d];
                if (e.Kind == "example") continue;
                var nameWords = e.Names.SelectMany(FusionModel.Ai.Text.Tokens).Distinct().ToList();
                // compact names too: "dso" meets DAYS_SALES_OUTSTANDING via initials
                var initials = e.Names.Select(nm => string.Concat(FusionModel.Ai.Text.Words(nm).Select(w => w[0]))).Where(s => s.Length >= 2).ToList();
                double best = 0;
                foreach (var w in words)
                {
                    foreach (var nw in nameWords) best = Math.Max(best, FusionModel.Ai.Text.Similar(w, nw));
                    if (initials.Contains(w)) best = Math.Max(best, 0.9);
                }
                if (best >= 0.45 && best < 1) scores.Add((d, best));
            }
            return scores.OrderByDescending(x => x.Item2).Take(k).ToList();
        }

        /// <summary>Glossary terms whose term or synonym appears in the question (as a phrase, or fuzzily for single words).</summary>
        public List<CatalogEntry> Terms(string question)
        {
            string nq = " " + FusionModel.Ai.Text.Norm(question) + " ";
            var qWords = FusionModel.Ai.Text.Words(question);
            var hits = new List<CatalogEntry>();
            foreach (var e in Entries.Where(e => e.Kind == "term"))
            {
                bool hit = e.Names.Any(nm =>
                {
                    string n = FusionModel.Ai.Text.Norm(nm);
                    if (n.Length == 0) return false;
                    if (nq.Contains(" " + n + " ")) return true;
                    return !n.Contains(' ') && n.Length >= 5 && qWords.Any(w => w.Length >= 5 && FusionModel.Ai.Text.Similar(w, n) >= 0.6);
                });
                if (hit) hits.Add(e);
            }
            return hits;
        }

        /// <summary>Column values named in the question: word n-grams (longest first) matched against the value index.</summary>
        public List<(string Column, string Table, string Value, string Matched)> Values(string question, int max = 10)
        {
            var hits = new List<(string, string, string, string)>();
            if (_values.Count == 0) return hits;
            var words = FusionModel.Ai.Text.Words(question);
            var used = new bool[words.Count];
            for (int len = Math.Min(5, words.Count); len >= 1; len--)
                for (int i = 0; i + len <= words.Count; i++)
                {
                    if (Enumerable.Range(i, len).Any(j => used[j])) continue;
                    string phrase = string.Join(" ", words.Skip(i).Take(len));
                    if (len == 1 && (phrase.Length < 3 || FusionModel.Ai.Text.Tokens(phrase).Count == 0)) continue;
                    var list = _values.TryGetValue(phrase, out var exact) ? exact : Partial(phrase, len);
                    if (list == null || list.Count == 0) continue;
                    foreach (var (c, t, v) in list.Take(3)) hits.Add((c, t, v, phrase));
                    for (int j = i; j < i + len; j++) used[j] = true;
                }
            return hits.Take(max).ToList();
        }

        /// <summary>Values that contain the phrase as whole words; only for distinctive phrases (few matches).</summary>
        private List<(string Column, string Table, string Value)> Partial(string phrase, int words)
        {
            var parts = phrase.Split(' ');
            if (parts.Any(w => w.Length < 3) || (words == 1 && phrase.Length < 4) || FusionModel.Ai.Text.Tokens(phrase).Count == 0) return null;
            if (!_valueWords.TryGetValue(parts.OrderByDescending(w => w.Length).First(), out var cands)) return null;
            var found = cands.Where(n => (" " + n + " ").Contains(" " + phrase + " ")).Take(6).ToList();
            if (found.Count == 0 || found.Count > 5) return null;           // too common a word to mean one value
            return found.SelectMany(n => _values[n]).ToList();
        }

        public IEnumerable<string> Neighbours(string table) => table != null && _neighbours.TryGetValue(table, out var s) ? s : Enumerable.Empty<string>();

        /// <summary>
        /// Hybrid search. <paramref name="vector"/> is an optional ranked list from embeddings (entry index, similarity).
        /// </summary>
        public List<SearchHit> Search(string question, int k = 12, IList<(int Doc, double Score)> vector = null)
        {
            var q = FusionModel.Ai.Text.Tokens(question);
            var fused = new Dictionary<CatalogEntry, SearchHit>();
            void Fuse(IEnumerable<CatalogEntry> ranked, double weight, string why)
            {
                int rank = 0;
                foreach (var e in ranked)
                {
                    rank++;
                    if (!fused.TryGetValue(e, out var h)) fused[e] = h = new SearchHit { Entry = e };
                    h.Score += weight / (60.0 + rank);
                    if (!h.Why.Contains(why)) h.Why.Add(why);
                }
            }

            Fuse(Bm25(q).Select(x => Entries[x.Doc]), 1.0, "words");
            Fuse(Fuzzy(q).Select(x => Entries[x.Doc]), 0.6, "fuzzy");
            if (vector != null) Fuse(vector.Where(x => x.Doc >= 0 && x.Doc < Entries.Count).Select(x => Entries[x.Doc]), 1.0, "meaning");

            // glossary: the term itself, then what it maps to
            foreach (var term in Terms(question))
            {
                var list = new List<CatalogEntry> { term };
                foreach (var r in term.Refs) { var target = ResolveRef(r); if (target != null) list.Add(target); }
                Fuse(list, 2.0, "glossary: " + term.Title);
            }
            // values: a transient hit carrying the filter, plus the column that holds the value
            foreach (var (col, table, value, matched) in Values(question))
            {
                var ve = new CatalogEntry
                {
                    Id = "v:" + col + "=" + value, Kind = "value", Title = value, Ref = col, Table = table, Names = { value }, Text = value,
                    Detail = "a value of " + col + " (filter " + col + " = \"" + value + "\")"
                };
                var colEntry = Entries.FirstOrDefault(e => e.Kind == "column" && e.Ref == col);
                Fuse(colEntry == null ? new[] { ve } : new[] { ve, colEntry }, 1.5, "value: " + matched);
            }
            // verified examples: a question worded like this one (share of words in common)
            var qs = new HashSet<string>(q);
            if (qs.Count > 0)
                Fuse(Entries.Where(e => e.Kind == "example")
                            .Select(e => (e, J: Jaccard(qs, FusionModel.Ai.Text.Tokens(e.Title))))
                            .Where(x => x.J >= 0.4).OrderByDescending(x => x.J).Select(x => x.e), 2.0, "similar question");
            // what answers need most: measures, terms and checked examples before raw columns
            foreach (var h in fused.Values) h.Score *= h.Entry.Kind switch { "example" => 1.2, "measure" or "term" => 1.15, "column" => 0.9, _ => 1.0 };

            // graph: things in tables next to the best hits get a small lift (a question about customers also needs the lines)
            var top = fused.Values.OrderByDescending(h => h.Score).Take(3).Select(h => h.Entry.Table).Where(t => t != null).Distinct().ToList();
            var near = new HashSet<string>(top.SelectMany(Neighbours), StringComparer.OrdinalIgnoreCase);
            foreach (var h in fused.Values)
                if (h.Entry.Table != null && near.Contains(h.Entry.Table) && !top.Contains(h.Entry.Table)) { h.Score += 0.002; h.Why.Add("related"); }

            return fused.Values.OrderByDescending(h => h.Score).ThenBy(h => h.Entry.Kind == "measure" ? 0 : 1).Take(Math.Clamp(k, 1, 100)).ToList();
        }

        private static double Jaccard(HashSet<string> a, List<string> b)
        {
            var bs = new HashSet<string>(b);
            int inter = a.Count(bs.Contains);
            return inter == 0 ? 0 : (double)inter / (a.Count + bs.Count - inter);
        }

        /// <summary>[Measure] · module.table[COL] · table[COL] · module.table → the catalog entry.</summary>
        public CatalogEntry ResolveRef(string r)
        {
            if (string.IsNullOrWhiteSpace(r)) return null;
            r = r.Trim();
            if (r.StartsWith("[") && r.EndsWith("]")) return Get("m:" + r.Trim('[', ']'));
            var m = Regex.Match(r, @"^'?([\w.]+)'?\[([^\]]+)\]$");
            if (m.Success)
            {
                string t = m.Groups[1].Value, c = m.Groups[2].Value;
                return Get("c:" + t + "[" + c + "]") ?? Entries.FirstOrDefault(e => e.Kind == "column" && (string.Equals(e.Ref, r, StringComparison.OrdinalIgnoreCase) ||
                           (e.Table != null && e.Table.EndsWith("." + t, StringComparison.OrdinalIgnoreCase) && e.Title.EndsWith("[" + c + "]", StringComparison.OrdinalIgnoreCase))));
            }
            return Get("t:" + r) ?? Get("m:" + r) ?? Get("g:" + r) ?? Entries.FirstOrDefault(e => e.Kind == "table" && e.Table != null && e.Table.EndsWith("." + r, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>The text each entry is embedded from.</summary>
        public static string EmbedText(CatalogEntry e) => e.Kind + ": " + e.Title + (e.Names.Count > 1 ? " (" + string.Join(", ", e.Names.Skip(1)) + ")" : "") + " — " + e.Detail;
    }

    /// <summary>Distinct values of low-cardinality text columns (column ref → values), read from the published files.</summary>
    public sealed class ValueIndex
    {
        public List<(string Column, List<string> Values)> Columns { get; } = new();
        public const int MaxDistinct = 5000;
    }
}

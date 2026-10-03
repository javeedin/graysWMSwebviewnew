using System.Globalization;
using System.Text.RegularExpressions;

namespace FusionModel.Semantic
{
    /// <summary>"Measures by columns with filters" - the call every report, page and the AI makes.</summary>
    public sealed class SemanticRequest
    {
        public List<string> GroupBy { get; set; } = new();              // "customers[NAME]", "calendar[Year]"
        public List<FilterSpec> Filters { get; set; } = new();
        public List<MeasureSpec> Measures { get; set; } = new();
        public List<OrderSpec> OrderBy { get; set; } = new();
        public int? Top { get; set; }
        public bool Totals { get; set; }
    }

    public sealed class FilterSpec
    {
        public string Column { get; set; }
        /// <summary>in · notIn · = · &lt;&gt; · &lt; · &gt; · &lt;= · &gt;= · between · blank · notBlank</summary>
        public string Op { get; set; } = "in";
        public List<string> Values { get; set; } = new();
    }

    public sealed class MeasureSpec
    {
        public string Name { get; set; }
        /// <summary>Null = the model measure called Name.</summary>
        public string Expression { get; set; }
    }

    public sealed class OrderSpec
    {
        public string By { get; set; }                                 // a measure name or a Table[Column]
        public bool Desc { get; set; }
    }

    public sealed class SemanticColumn
    {
        public string Name { get; set; }
        public string Role { get; set; }                               // group | measure
        public string Type { get; set; }
        public string Format { get; set; }
    }

    public sealed class SemanticResult
    {
        public List<SemanticColumn> Columns { get; set; } = new();
        public List<object[]> Rows { get; set; } = new();
        public object[] Totals { get; set; }
        public bool Capped { get; set; }
        public string Sql { get; set; }
        public long Ms { get; set; }
    }

    /// <summary>Turns a semantic request (or an EVALUATE query) into one DuckDB statement.</summary>
    public sealed class QueryPlanner
    {
        private readonly SemanticModel _m;
        public QueryPlanner(SemanticModel m) { _m = m; }

        public sealed class Plan
        {
            public string Sql;
            public string TotalsSql;
            public List<SemanticColumn> Columns = new();
            public int Limit;
        }

        public Plan Build(SemanticRequest req, string user, Dictionary<string, MeasureDef> local = null, List<Node> filterNodes = null)
        {
            var comp = new Compiler(_m);
            if (local != null) foreach (var kv in local) comp.LocalMeasures[kv.Key] = kv.Value;
            var ctx = new Ctx { User = user, Rls = _m.RoleFilters(user) };
            foreach (var g in req.GroupBy ?? new())
            {
                var col = _m.ParseColumnRef(g);
                if (!ctx.Group.Contains(col)) ctx.Group.Add(col);
            }
            foreach (var f in req.Filters ?? new()) ApplySpec(f, ctx);
            // SUMMARIZECOLUMNS filter arguments filter the result; they do not take a column out of the grouping
            foreach (var fn in filterNodes ?? new List<Node>())
            {
                var tmp = new Ctx { User = user, Rls = ctx.Rls };
                comp.ApplyFilter(fn, ctx.Clone(), tmp);
                foreach (var f in tmp.ColFilters.Values) foreach (var p in f.Preds) ctx.AddPred(f.Col, p);
                ctx.RowFilters.AddRange(tmp.RowFilters); ctx.SetFilters.AddRange(tmp.SetFilters); ctx.Dates.AddRange(tmp.Dates); ctx.UseRel.AddRange(tmp.UseRel);
            }

            var plan = new Plan { Limit = Math.Clamp(req.Top ?? 10000, 1, 100000) };
            foreach (var g in ctx.Group) plan.Columns.Add(new SemanticColumn { Name = Display(g), Role = "group", Type = g.Type });
            var measures = req.Measures ?? new();
            var frames = new List<Frame>();
            foreach (var ms in measures)
            {
                string expr = ms.Expression;
                MeasureDef def = null;
                if (string.IsNullOrWhiteSpace(expr))
                {
                    if (!(local != null && local.TryGetValue(ms.Name ?? "", out def)) && !_m.Measures.TryGetValue(ms.Name ?? "", out def))
                        throw new MeasureException("Unknown measure [" + ms.Name + "]");
                    expr = "[" + def.Name + "]";
                }
                Node ast;
                try { ast = Parser.Parse(expr); }
                catch (MeasureException e) { throw new MeasureException((ms.Name ?? "expression") + ": " + e.Message); }
                frames.Add(comp.EnsureKeys(comp.S(ast, ctx), ctx.Group, ctx));
                plan.Columns.Add(new SemanticColumn { Name = ms.Name ?? expr, Role = "measure", Format = def?.Format ?? FormatOf(expr) });
            }
            if (frames.Count == 0)
            {
                if (ctx.Group.Count == 0) throw new MeasureException("Pick at least one column or measure.");
                frames.Add(comp.Domain(ctx.Group, ctx));
            }
            var (joined, _, vals) = comp.Join(frames);
            var sel = ctx.Group.Select(g => "a." + comp.K(g) + " AS " + Names.Q(Display(g))).ToList();
            sel.AddRange(measures.Select((m, i) => vals[i] + " AS " + Names.Q(m.Name ?? m.Expression)));
            string from = "(" + joined + ") a";
            string where = measures.Count > 0 && ctx.Group.Count > 0 ? " WHERE NOT (" + string.Join(" AND ", measures.Select((_, i) => vals[i] + " IS NULL")) + ")" : "";
            var order = new List<string>();
            foreach (var o in req.OrderBy ?? new())
            {
                string name = measures.Any(m => string.Equals(m.Name, o.By, StringComparison.OrdinalIgnoreCase)) ? o.By
                    : ctx.Group.Select(Display).FirstOrDefault(d => string.Equals(d, o.By, StringComparison.OrdinalIgnoreCase) || string.Equals(d, SafeDisplay(o.By), StringComparison.OrdinalIgnoreCase));
                if (name != null) order.Add(Names.Q(name) + (o.Desc ? " DESC NULLS LAST" : " ASC NULLS LAST"));
            }
            if (order.Count == 0) order.AddRange(ctx.Group.Select(g => Names.Q(Display(g)) + " ASC NULLS LAST"));
            plan.Sql = "SELECT " + string.Join(", ", sel) + " FROM " + from + where + (order.Count > 0 ? " ORDER BY " + string.Join(", ", order) : "") + " LIMIT " + (plan.Limit + 1);

            if (req.Totals && measures.Count > 0 && ctx.Group.Count > 0)
            {
                var tctx = ctx.Clone(); tctx.Group.Clear();
                var tf = measures.Select((ms, i) => comp.S(Parser.Parse(string.IsNullOrWhiteSpace(ms.Expression) ? "[" + ms.Name + "]" : ms.Expression), tctx)).ToList();
                plan.TotalsSql = "SELECT " + string.Join(", ", tf.Select((f, i) => f.IsConst ? "(" + f.Const + ") AS t" + i : "(SELECT v FROM (" + f.Sql + ") LIMIT 1) AS t" + i));
            }
            return plan;
        }

        private void ApplySpec(FilterSpec f, Ctx ctx)
        {
            var col = _m.ParseColumnRef(f.Column);
            var vals = f.Values ?? new();
            string L(int i) => Compiler.Lit(col, vals.ElementAtOrDefault(i));
            string pred = (f.Op ?? "in").ToLowerInvariant() switch
            {
                "in" => vals.Count == 0 ? "FALSE" : "{c} IN (" + string.Join(", ", vals.Select(v => Compiler.Lit(col, v))) + ")",
                "notin" => vals.Count == 0 ? "TRUE" : "{c} NOT IN (" + string.Join(", ", vals.Select(v => Compiler.Lit(col, v))) + ")",
                "=" or "<>" or "<" or ">" or "<=" or ">=" => "{c} " + f.Op + " " + L(0),
                "between" => "{c} BETWEEN " + L(0) + " AND " + L(1),
                "blank" => "{c} IS NULL",
                "notblank" => "{c} IS NOT NULL",
                "contains" => "CAST({c} AS VARCHAR) ILIKE " + Compiler.Str("%" + vals.FirstOrDefault() + "%"),
                _ => throw new MeasureException("Unknown filter operator " + f.Op)
            };
            ctx.AddPred(col, pred);
        }

        public string Display(SemColumn c)
        {
            bool unique = _m.Tables.Values.Count(t => string.Equals(t.Name, c.Table.Name, StringComparison.OrdinalIgnoreCase)) == 1;
            return (unique ? c.Table.Name : c.Table.Key) + "[" + c.Name + "]";
        }

        private string SafeDisplay(string s) { try { return Display(_m.ParseColumnRef(s)); } catch { return s; } }

        private static string FormatOf(string expr) => Regex.IsMatch(expr ?? "", @"^\s*DIVIDE", RegexOptions.IgnoreCase) ? "0.0%" : null;

        // ── EVALUATE text queries ───────────────────────────────────
        /// <summary>
        /// DEFINE MEASURE t[Name] = … (repeatable) EVALUATE SUMMARIZECOLUMNS(col…, filter…, "Name", expr…) or ROW("Name", expr…),
        /// optional ORDER BY [Name] DESC. Returns the request and the locally defined measures.
        /// </summary>
        public (SemanticRequest Request, Dictionary<string, MeasureDef> Local, List<Node> FilterNodes) ParseEvaluate(string text)
        {
            var local = new Dictionary<string, MeasureDef>(StringComparer.OrdinalIgnoreCase);
            var mDefine = Regex.Match(text, @"^\s*DEFINE\s+(.*?)\s*\bEVALUATE\b", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            string evalText = text;
            if (mDefine.Success)
            {
                foreach (Match m in Regex.Matches(mDefine.Groups[1].Value, @"MEASURE\s+('[^']+'|[\w.]+)\s*\[([^\]]+)\]\s*=\s*(.*?)(?=\s*\bMEASURE\b|\s*$)", RegexOptions.IgnoreCase | RegexOptions.Singleline))
                    local[m.Groups[2].Value] = new MeasureDef { Table = m.Groups[1].Value.Trim('\''), Name = m.Groups[2].Value, Expression = m.Groups[3].Value.Trim() };
                evalText = text.Substring(mDefine.Length);
            }
            else
            {
                var e = Regex.Match(text, @"^\s*EVALUATE\b", RegexOptions.IgnoreCase);
                if (!e.Success) throw new MeasureException("A query starts with EVALUATE (optionally DEFINE MEASURE … first)");
                evalText = text.Substring(e.Length);
            }
            var req = new SemanticRequest();
            var ob = Regex.Match(evalText, @"\bORDER\s+BY\b(.*)$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (ob.Success)
            {
                foreach (var part in ob.Groups[1].Value.Split(','))
                {
                    var p = part.Trim(); if (p.Length == 0) continue;
                    bool desc = Regex.IsMatch(p, @"\bDESC\s*$", RegexOptions.IgnoreCase);
                    p = Regex.Replace(p, @"\s+(ASC|DESC)\s*$", "", RegexOptions.IgnoreCase).Trim();
                    req.OrderBy.Add(new OrderSpec { By = p.StartsWith("[") ? p.Trim('[', ']') : p, Desc = desc });
                }
                evalText = evalText.Substring(0, ob.Index);
            }
            var node = Parser.Parse(evalText) as CallNode ?? throw new MeasureException("EVALUATE supports SUMMARIZECOLUMNS(…) and ROW(…)");
            var filters = new List<Node>();
            if (node.Name == "ROW")
            {
                for (int i = 0; i + 1 < node.Args.Count; i += 2)
                    req.Measures.Add(new MeasureSpec { Name = (node.Args[i] as StringNode)?.Value ?? "Value" + i, Expression = Source(evalText, node.Args[i + 1]) });
                return (req, local, filters);
            }
            if (node.Name != "SUMMARIZECOLUMNS") throw new MeasureException("EVALUATE supports SUMMARIZECOLUMNS(…) and ROW(…)");
            for (int i = 0; i < node.Args.Count; i++)
            {
                var a = node.Args[i];
                if (a is ColumnNode c) req.GroupBy.Add((c.Table.Contains('.') || c.Table.Contains(' ') ? "'" + c.Table + "'" : c.Table) + "[" + c.Column + "]");
                else if (a is StringNode s && i + 1 < node.Args.Count) { req.Measures.Add(new MeasureSpec { Name = s.Value, Expression = Source(evalText, node.Args[i + 1]) }); i++; }
                else filters.Add(a);
            }
            return (req, local, filters);
        }

        /// <summary>The original text of an argument (so measure expressions keep their formatting in errors).</summary>
        private static string Source(string text, Node n) => Unparse(n);

        internal static string Unparse(Node n) => n switch
        {
            NumberNode x => x.Value.ToString("R", CultureInfo.InvariantCulture),
            StringNode x => "\"" + x.Value.Replace("\"", "\"\"") + "\"",
            BoolNode x => x.Value ? "TRUE()" : "FALSE()",
            ColumnNode x => "'" + x.Table + "'[" + x.Column + "]",
            BracketNode x => "[" + x.Name + "]",
            TableNode x => "'" + x.Name + "'",
            VarNode x => x.Name,
            KeywordNode x => x.Word,
            UnaryNode x => x.Op == "-" ? "(-" + Unparse(x.Operand) + ")" : "NOT(" + Unparse(x.Operand) + ")",
            BinaryNode x => "(" + Unparse(x.Left) + " " + x.Op + " " + Unparse(x.Right) + ")",
            ListNode x => "{" + string.Join(", ", x.Items.Select(Unparse)) + "}",
            CallNode x => x.Name + "(" + string.Join(", ", x.Args.Select(a => a == null ? "" : Unparse(a))) + ")",
            VarBlockNode x => string.Concat(x.Vars.Select(v => "VAR " + v.Name + " = " + Unparse(v.Expr) + " ")) + "RETURN " + Unparse(x.Return),
            _ => ""
        };

        /// <summary>Compiles every model measure (no data read); returns name → error for the ones that fail.</summary>
        public Dictionary<string, string> Validate()
        {
            var errors = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var m in _m.Measures.Values)
            {
                try { new Compiler(_m).S(Parser.Parse(m.Expression), new Ctx()); }
                catch (MeasureException e) { errors[m.Name] = e.Message; }
                catch (Exception e) { errors[m.Name] = e.Message; }
            }
            return errors;
        }
    }
}

using System.Globalization;
using System.Text;

namespace FusionModel.Semantic
{
    /// <summary>
    /// A partial result: one SQL query returning key columns (k0, k1 … named per grouping column) and a value column v.
    /// Constant frames have no SQL, only a value expression. Keys are the grouping columns the value depends on - a
    /// frame without some grouping column repeats its value for every member of it (DAX semantics).
    /// </summary>
    internal sealed class Frame
    {
        public string Sql;
        public string Const;
        public List<SemColumn> Keys = new();
        public bool IsConst => Sql == null;
    }

    internal sealed class SetFilter
    {
        public SemColumn Column;
        public Frame Inner;
        public string Cond;          // SQL over {v}
    }

    internal sealed class RowFilter
    {
        public SemTable Table;
        public Node Cond;
        public Ctx Env;
    }

    /// <summary>A date range as SQL over the group's first and last date (g.mind / g.maxd), e.g. SAMEPERIODLASTYEAR shifts both.</summary>
    internal delegate (string Lo, string Hi) DateTransform((string Lo, string Hi) range);

    /// <summary>Filter context: grouping columns, column filters, row/set filters, date transforms, relationship overrides.</summary>
    internal sealed class Ctx
    {
        public List<SemColumn> Group = new();
        public Dictionary<string, (SemColumn Col, List<string> Preds)> ColFilters = new();
        public List<RowFilter> RowFilters = new();
        public List<SetFilter> SetFilters = new();
        public List<DateTransform> Dates = new();
        public List<SemRel> UseRel = new();
        public Dictionary<string, Frame> Vars = new(StringComparer.OrdinalIgnoreCase);
        public List<(SemColumn Col, List<string> Values)> Rls = new();
        public string User;

        public Ctx Clone() => new Ctx
        {
            Group = Group.ToList(),
            ColFilters = ColFilters.ToDictionary(k => k.Key, k => (k.Value.Col, k.Value.Preds.ToList())),
            RowFilters = RowFilters.ToList(), SetFilters = SetFilters.ToList(), Dates = Dates.ToList(), UseRel = UseRel.ToList(),
            Vars = new Dictionary<string, Frame>(Vars, StringComparer.OrdinalIgnoreCase), Rls = Rls, User = User
        };

        public void AddPred(SemColumn c, string pred)
        {
            if (!ColFilters.TryGetValue(c.Id, out var f)) f = (c, new List<string>());
            f.Preds.Add(pred);
            ColFilters[c.Id] = f;
        }

        public void RemoveColumn(SemColumn c)
        {
            ColFilters.Remove(c.Id);
            Group.RemoveAll(g => g == c);
            SetFilters.RemoveAll(s => s.Column == c);
            if (c.Table.IsCalendar) Dates.Clear();
        }

        public void RemoveTables(ICollection<SemTable> tables, ICollection<SemColumn> except = null)
        {
            bool keep(SemColumn c) => except != null && except.Contains(c);
            foreach (var k in ColFilters.Where(f => tables.Contains(f.Value.Col.Table) && !keep(f.Value.Col)).Select(f => f.Key).ToList()) ColFilters.Remove(k);
            Group.RemoveAll(g => tables.Contains(g.Table) && !keep(g));
            RowFilters.RemoveAll(r => tables.Contains(r.Table));
            SetFilters.RemoveAll(s => tables.Contains(s.Column.Table) && !keep(s.Column));
            if (tables.Any(t => t.IsCalendar) && (except == null || !except.Any(c => c.Table.IsCalendar))) Dates.Clear();
        }
    }

    /// <summary>Signals an expression that needs a filter context (a measure or an aggregate) where a row value was expected.</summary>
    internal sealed class NeedsContextException : Exception { }

    /// <summary>
    /// Compiles DAX-compatible expressions to DuckDB SQL. Each aggregation becomes a leaf query over its table, joined to
    /// related tables along many-to-one relationships, grouped by the grouping columns it can reach and filtered by the
    /// filters it can reach. Scalar operators combine leaves on their shared keys. CALCULATE changes the context: a
    /// column whose filter it replaces stops being a key of that leaf, so the value repeats - as DAX does. Time
    /// intelligence joins facts to a date range computed per calendar group (first/last date of the group).
    /// </summary>
    internal sealed class Compiler
    {
        private readonly SemanticModel _m;
        private readonly Dictionary<string, string> _keyAlias = new();
        private readonly Dictionary<string, Node> _parsed = new(StringComparer.OrdinalIgnoreCase);
        private readonly Stack<string> _measureStack = new();
        public Dictionary<string, MeasureDef> LocalMeasures = new(StringComparer.OrdinalIgnoreCase);
        private int _alias;

        public Compiler(SemanticModel m) { _m = m; }

        public string K(SemColumn c)
        {
            if (!_keyAlias.TryGetValue(c.Id, out var a)) _keyAlias[c.Id] = a = "k" + _keyAlias.Count;
            return a;
        }

        private string NewAlias(string p) => p + (++_alias);

        // ── literals ───────────────────────────────────────────────
        public static string Num(double d) => d.ToString("R", CultureInfo.InvariantCulture);
        public static string Str(string s) => "'" + (s ?? "").Replace("'", "''") + "'";

        private static Frame C(string sql) => new Frame { Const = sql };

        // ── combining frames ───────────────────────────────────────
        /// <summary>Joins frames on their shared keys (full outer; cross join when they share none) and computes f(v0…vn).</summary>
        public Frame Combine(IList<Frame> frames, Func<string[], string> f)
        {
            if (frames.All(x => x.IsConst)) return C(f(frames.Select(x => "(" + x.Const + ")").ToArray()));
            var (acc, keys, vals) = Join(frames);
            return new Frame { Keys = keys, Sql = "SELECT " + string.Join("", keys.Select(k => "a." + K(k) + " AS " + K(k) + ", ")) + f(vals) + " AS v FROM (" + acc + ") a" };
        }

        /// <summary>
        /// The join behind Combine: a query with every key column and the non-constant values as v{i}; vals[i] is the
        /// expression for input i as seen from alias "a" (a.v{i}, or the constant itself).
        /// </summary>
        public (string Sql, List<SemColumn> Keys, string[] Vals) Join(IList<Frame> frames)
        {
            var keys = new List<SemColumn>();
            string acc = null;
            var vals = new string[frames.Count];
            for (int i = 0; i < frames.Count; i++)
            {
                var fr = frames[i];
                if (fr.IsConst) { vals[i] = "(" + fr.Const + ")"; continue; }
                string v = "v" + i;
                vals[i] = "a." + v;
                if (acc == null)
                {
                    acc = "SELECT " + string.Join("", fr.Keys.Select(k => K(k) + ", ")) + "v AS " + v + " FROM (" + fr.Sql + ") f";
                    keys.AddRange(fr.Keys);
                    continue;
                }
                var shared = keys.Where(fr.Keys.Contains).ToList();
                var fresh = fr.Keys.Where(k => !keys.Contains(k)).ToList();
                var prevVals = Enumerable.Range(0, i).Where(j => !frames[j].IsConst).Select(j => "a.v" + j + " AS v" + j);
                var sel = keys.Select(k => shared.Contains(k) ? "COALESCE(a." + K(k) + ", b." + K(k) + ") AS " + K(k) : "a." + K(k) + " AS " + K(k))
                    .Concat(fresh.Select(k => "b." + K(k) + " AS " + K(k))).Concat(prevVals).Concat(new[] { "b.v AS " + v });
                string join = shared.Count > 0
                    ? " FULL OUTER JOIN (" + fr.Sql + ") b ON " + string.Join(" AND ", shared.Select(k => "a." + K(k) + " IS NOT DISTINCT FROM b." + K(k)))
                    : " CROSS JOIN (" + fr.Sql + ") b";
                acc = "SELECT " + string.Join(", ", sel) + " FROM (" + acc + ") a" + join;
                keys.AddRange(fresh);
            }
            return (acc ?? "SELECT 1", keys, vals);
        }

        private Frame Map(Frame a, Func<string, string> f) => Combine(new[] { a }, v => f(v[0]));

        // ── joins from a base table ────────────────────────────────
        internal sealed class From
        {
            private readonly Compiler _c;
            public readonly SemTable Base;
            public readonly string BaseAlias;
            private readonly Ctx _ctx;
            private readonly Dictionary<string, string> _aliases = new(StringComparer.OrdinalIgnoreCase);
            private readonly List<string> _joins = new();
            public readonly List<string> Extra = new();

            public From(Compiler c, SemTable b, Ctx ctx)
            {
                _c = c; Base = b; _ctx = ctx; BaseAlias = c.NewAlias("t");
                _aliases[b.Key] = BaseAlias;
            }

            public string TryAlias(SemTable t)
            {
                if (_aliases.TryGetValue(t.Key, out var a)) return a;
                var path = _c.Path(Base, t, _ctx);
                if (path == null) return null;
                string cur = BaseAlias;
                foreach (var hop in path)
                {
                    if (!_aliases.TryGetValue(hop.To.Table.Key, out var next))
                    {
                        next = _c.NewAlias("t");
                        _joins.Add(" LEFT JOIN " + hop.To.Table.SqlName + " " + next + " ON " + JoinCond(cur, hop.From, next, hop.To));
                        _aliases[hop.To.Table.Key] = next;
                    }
                    cur = next;
                }
                return cur;
            }

            public string Col(SemColumn c)
            {
                var a = TryAlias(c.Table) ?? throw new MeasureException("Column " + c.Id + " is not related to " + Base.Key + " (add a relationship)");
                return a + "." + Names.Q(c.Name);
            }

            /// <summary>The base table's date (CAST AS DATE) along its relationship to the calendar.</summary>
            public string DateExpr()
            {
                var cal = _c._m.Calendar ?? throw new MeasureException("The calendar is switched off in the model.");
                if (Base.IsCalendar) return BaseAlias + ".\"Date\"";
                var path = _c.Path(Base, cal, _ctx) ?? throw new MeasureException("Table " + Base.Key + " has no relationship to the calendar - time intelligence needs one (e.g. " + Base.Key + ".ACCOUNTING_DATE → calendar.Date).");
                var last = path[^1];
                var owner = last.From.Table == Base ? BaseAlias : TryAlias(last.From.Table);
                return "CAST(" + owner + "." + Names.Q(last.From.Name) + " AS DATE)";
            }

            public string Sql() => Base.SqlName + " " + BaseAlias + string.Concat(_joins) + string.Concat(Extra.Select(e => ", " + e));

            private static string JoinCond(string a, SemColumn from, string b, SemColumn to)
            {
                string l = a + "." + Names.Q(from.Name), r = b + "." + Names.Q(to.Name);
                if (to.Table.IsCalendar || from.Table.IsCalendar) return "CAST(" + l + " AS DATE) = " + r;
                if (!string.Equals(from.Type, to.Type, StringComparison.OrdinalIgnoreCase) && !(from.IsNumeric && to.IsNumeric))
                    return "CAST(" + l + " AS VARCHAR) = CAST(" + r + " AS VARCHAR)";
                return l + " = " + r;
            }
        }

        /// <summary>Many-to-one path from → to (USERELATIONSHIP replaces the active relationship between the same two tables).</summary>
        internal List<SemRel> Path(SemTable from, SemTable to, Ctx ctx)
        {
            if (from == to) return new List<SemRel>();
            var usable = _m.Relationships.Where(r =>
                (r.Active && !ctx.UseRel.Any(u => u.From.Table == r.From.Table && u.To.Table == r.To.Table && u != r)) || ctx.UseRel.Contains(r)).ToList();
            var prev = new Dictionary<SemTable, SemRel>();
            var q = new Queue<SemTable>();
            q.Enqueue(from);
            var seen = new HashSet<SemTable> { from };
            while (q.Count > 0)
            {
                var t = q.Dequeue();
                foreach (var r in usable.Where(r => r.From.Table == t))
                {
                    var n = r.To.Table;
                    if (!seen.Add(n)) continue;
                    prev[n] = r;
                    if (n == to)
                    {
                        var path = new List<SemRel>();
                        for (var x = to; x != from; x = prev[x].From.Table) path.Insert(0, prev[x]);
                        return path;
                    }
                    q.Enqueue(n);
                }
            }
            return null;
        }

        /// <summary>The table and every table it reaches many-to-one (DAX's "expanded table").</summary>
        internal HashSet<SemTable> Expanded(SemTable t)
        {
            var set = new HashSet<SemTable> { t };
            var queue = new Queue<SemTable>(); queue.Enqueue(t);
            while (queue.Count > 0)
            {
                var x = queue.Dequeue();
                foreach (var r in _m.Relationships.Where(r => r.Active && r.From.Table == x))
                    if (set.Add(r.To.Table)) queue.Enqueue(r.To.Table);
            }
            return set;
        }

        // ── leaves ─────────────────────────────────────────────────
        /// <summary>An aggregation over <paramref name="baseT"/> in <paramref name="ctx"/>: SELECT keys, agg AS v FROM … WHERE … GROUP BY keys.</summary>
        internal Frame Leaf(SemTable baseT, Func<From, string> agg, Ctx ctx, IList<RowFilter> extraRows = null)
        {
            var fb = new From(this, baseT, ctx);
            string aggSql = agg(fb);
            var where = new List<string>();
            var keys = new List<(SemColumn Col, string Expr)>();
            bool range = ctx.Dates.Count > 0;

            if (range)
            {
                string dateExpr = fb.DateExpr();
                var cal = _m.Calendar;
                var calGroup = ctx.Group.Where(c => c.Table.IsCalendar).ToList();
                var calWhere = ctx.ColFilters.Values.Where(f => f.Col.Table.IsCalendar).SelectMany(f => f.Preds.Select(p => p.Replace("{c}", "c." + Names.Q(f.Col.Name)))).ToList();
                calWhere.AddRange(ctx.Rls.Where(r => r.Col.Table.IsCalendar).Select(r => "c." + Names.Q(r.Col.Name) + " IN (" + string.Join(", ", r.Values.Select(Str)) + ")"));
                string g = "SELECT " + string.Join("", calGroup.Select(c => "c." + Names.Q(c.Name) + " AS " + K(c) + ", ")) +
                           "MIN(c.\"Date\") AS mind, MAX(c.\"Date\") AS maxd FROM " + cal.SqlName + " c" +
                           (calWhere.Count > 0 ? " WHERE " + string.Join(" AND ", calWhere) : "") +
                           (calGroup.Count > 0 ? " GROUP BY " + string.Join(", ", calGroup.Select(c => "c." + Names.Q(c.Name))) : "");
                string ga = NewAlias("g");
                fb.Extra.Add("(" + g + ") " + ga);
                (string Lo, string Hi) r = (ga + ".mind", ga + ".maxd");
                foreach (var tr in ctx.Dates) r = tr(r);
                where.Add(dateExpr + " BETWEEN " + r.Lo + " AND " + r.Hi);
                foreach (var c in calGroup) keys.Add((c, ga + "." + K(c)));
            }
            foreach (var c in ctx.Group)
            {
                if (range && c.Table.IsCalendar) continue;
                var a = fb.TryAlias(c.Table);
                if (a != null) keys.Add((c, a + "." + Names.Q(c.Name)));
            }
            foreach (var f in ctx.ColFilters.Values)
            {
                if (range && f.Col.Table.IsCalendar) continue;
                var a = fb.TryAlias(f.Col.Table);
                if (a == null) { string ex = ReverseExists(fb, f.Col, f.Preds); if (ex != null) where.Add(ex); continue; }
                foreach (var p in f.Preds) where.Add(p.Replace("{c}", a + "." + Names.Q(f.Col.Name)));
            }
            foreach (var r in ctx.Rls)
            {
                if (range && r.Col.Table.IsCalendar) continue;
                var a = fb.TryAlias(r.Col.Table);
                if (a != null) where.Add(a + "." + Names.Q(r.Col.Name) + " IN (" + (r.Values.Count == 0 ? "NULL" : string.Join(", ", r.Values.Select(v => Lit(r.Col, v)))) + ")");
            }
            foreach (var rf in ctx.RowFilters.Concat(extraRows ?? Array.Empty<RowFilter>()))
            {
                var a = fb.TryAlias(rf.Table);
                if (a == null) continue;
                where.Add("(" + Row(rf.Cond, fb, rf.Table, rf.Env ?? ctx) + ")");
            }
            foreach (var s in ctx.SetFilters)
            {
                var a = fb.TryAlias(s.Column.Table);
                if (a == null) continue;
                var cond = new List<string> { "s." + K(s.Column) + " IS NOT DISTINCT FROM " + a + "." + Names.Q(s.Column.Name), s.Cond.Replace("{v}", "s.v") };
                foreach (var k in s.Inner.Keys.Where(k => k != s.Column))
                {
                    var hit = keys.FirstOrDefault(x => x.Col == k);
                    if (hit.Col != null) cond.Add("s." + K(k) + " IS NOT DISTINCT FROM " + hit.Expr);
                }
                where.Add("EXISTS (SELECT 1 FROM (" + s.Inner.Sql + ") s WHERE " + string.Join(" AND ", cond) + ")");
            }
            string sql = "SELECT " + string.Join("", keys.Select(k => k.Expr + " AS " + K(k.Col) + ", ")) + aggSql + " AS v FROM " + fb.Sql() +
                         (where.Count > 0 ? " WHERE " + string.Join(" AND ", where) : "") +
                         (keys.Count > 0 ? " GROUP BY " + string.Join(", ", keys.Select(k => k.Expr)) : "");
            return new Frame { Sql = sql, Keys = keys.Select(k => k.Col).ToList() };
        }

        /// <summary>A filter on a table the base cannot reach many-to-one, but that reaches the base through a two-way relationship.</summary>
        private string ReverseExists(From fb, SemColumn col, List<string> preds)
        {
            var rel = _m.Relationships.FirstOrDefault(r => r.Both && r.Active && r.From.Table == col.Table && fb.TryAlias(r.To.Table) != null);
            if (rel == null) return null;
            string x = NewAlias("x"), toAlias = fb.TryAlias(rel.To.Table);
            return "EXISTS (SELECT 1 FROM " + col.Table.SqlName + " " + x + " WHERE " + x + "." + Names.Q(rel.From.Name) + " = " + toAlias + "." + Names.Q(rel.To.Name) +
                   string.Concat(preds.Select(p => " AND " + p.Replace("{c}", x + "." + Names.Q(col.Name)))) + ")";
        }

        /// <summary>The distinct values of the columns in the context (their own table's filters), as a frame keyed by them.</summary>
        internal Frame Domain(IList<SemColumn> cols, Ctx ctx)
        {
            Frame acc = null;
            foreach (var grp in cols.GroupBy(c => c.Table))
            {
                var c2 = ctx.Clone();
                c2.Group = grp.ToList();
                c2.Dates.Clear();
                var d = Leaf(grp.Key, _ => "1", c2);
                acc = acc == null ? d : Combine(new[] { acc, d }, v => v[0]);
            }
            return acc ?? C("1");
        }

        /// <summary>Adds the grouping columns a frame lacks (its value repeats for each of their values).</summary>
        internal Frame EnsureKeys(Frame f, IList<SemColumn> cols, Ctx ctx)
        {
            var missing = cols.Where(c => !f.Keys.Contains(c)).ToList();
            if (missing.Count == 0) return f;
            var result = f;
            foreach (var grp in missing.GroupBy(c => c.Table))
            {
                // auto-exist: a missing column of a table the frame is already keyed on joins through the rows of that
                // table (NAME → its REGION), instead of every combination
                var sameTable = result.Keys.Where(k => k.Table == grp.Key).ToList();
                var d = Domain(grp.Concat(sameTable).ToList(), ctx);
                result = Combine(new[] { result, d }, v => v[0]);
            }
            return result;
        }

        // ── scalar expressions (filter context) ────────────────────
        public Frame S(Node n, Ctx ctx)
        {
            switch (n)
            {
                case null: return C("NULL");
                case NumberNode x: return C(Num(x.Value));
                case StringNode x: return C(Str(x.Value));
                case BoolNode x: return C(x.Value ? "TRUE" : "FALSE");
                case VarNode x: return ctx.Vars.TryGetValue(x.Name, out var fr) ? fr : throw new MeasureException("Unknown variable " + x.Name, x.Pos);
                case VarBlockNode vb:
                    {
                        var c2 = ctx.Clone();
                        foreach (var (name, e) in vb.Vars) c2.Vars[name] = S(e, c2);
                        return S(vb.Return, c2);
                    }
                case BracketNode b: return Measure(b.Name, ctx, b.Pos);
                case ColumnNode col:
                    throw new MeasureException("A column (" + col.Table + "[" + col.Column + "]) needs an aggregation here, e.g. SUM(" + col.Table + "[" + col.Column + "]) or SELECTEDVALUE(…)", col.Pos);
                case TableNode t: throw new MeasureException("A table (" + t.Name + ") cannot be used as a value here", t.Pos);
                case UnaryNode u:
                    {
                        var a = S(u.Operand, ctx);
                        return Map(a, v => u.Op == "-" ? "(-" + v + ")" : "(NOT COALESCE(" + v + ", FALSE))");
                    }
                case BinaryNode bn: return Binary(bn, ctx);
                case ListNode l: throw new MeasureException("A list { … } can only be used with IN", l.Pos);
                case CallNode call: return Call(call, ctx);
                case KeywordNode k: throw new MeasureException("Unexpected " + k.Word, k.Pos);
            }
            throw new MeasureException("Unsupported expression", n.Pos);
        }

        private Frame Measure(string name, Ctx ctx, int pos)
        {
            if (!LocalMeasures.TryGetValue(name, out var def) && !_m.Measures.TryGetValue(name, out def))
                throw new MeasureException("Unknown measure [" + name + "]", pos);
            if (_measureStack.Contains(name, StringComparer.OrdinalIgnoreCase)) throw new MeasureException("Measure [" + name + "] refers to itself", pos);
            if (!_parsed.TryGetValue(name, out var ast))
            {
                try { ast = Parser.Parse(def.Expression); }
                catch (MeasureException e) { throw new MeasureException("In measure [" + name + "]: " + e.Message); }
                _parsed[name] = ast;
            }
            _measureStack.Push(name);
            try
            {
                var c2 = ctx.Clone();
                c2.Vars = new Dictionary<string, Frame>(StringComparer.OrdinalIgnoreCase);    // variables do not leak into measures
                return S(ast, c2);
            }
            catch (MeasureException e) when (!e.Message.StartsWith("In measure")) { throw new MeasureException("In measure [" + name + "]: " + e.Message); }
            finally { _measureStack.Pop(); }
        }

        private Frame Binary(BinaryNode b, Ctx ctx)
        {
            if (b.Op == "IN")
            {
                var left = S(b.Left, ctx);
                var list = b.Right as ListNode ?? throw new MeasureException("IN needs a list { … }", b.Pos);
                var items = list.Items.Select(i => S(i, ctx)).ToList();
                if (!items.All(i => i.IsConst)) throw new MeasureException("IN lists must be constants", b.Pos);
                return Map(left, v => "(" + v + " IN (" + string.Join(", ", items.Select(i => i.Const)) + "))");
            }
            var l = S(b.Left, ctx); var r = S(b.Right, ctx);
            bool dates = b.Op is "+" or "-" && (IsDateExpr(b.Left) || IsDateExpr(b.Right));
            return Combine(new[] { l, r }, v => dates ? DateArith(b.Op, v[0], v[1]) : BinarySql(b.Op, v[0], v[1]));
        }

        /// <summary>Date ± days and date − date (days), as DAX does; a blank date stays blank.</summary>
        private static string DateArith(string op, string a, string b) => "(" + a + " " + op + " " + b + ")";

        /// <summary>Whether an expression is a date (TODAY(), a date column, MAX of a date column …) - decided from the syntax.</summary>
        private bool IsDateExpr(Node n)
        {
            switch (n)
            {
                case ColumnNode c:
                    try { return _m.ResolveColumn(c.Table, c.Column, c.Pos).IsDate; } catch { return false; }
                case CallNode c when c.Name is "TODAY" or "NOW" or "DATE" or "EOMONTH" or "EDATE" or "STARTOFMONTH" or "ENDOFMONTH": return true;
                case CallNode c when c.Name is "MAX" or "MIN" or "LASTDATE" or "FIRSTDATE" or "SELECTEDVALUE" or "MAXX" or "MINX":
                    return c.Args.Count > 0 && IsDateExpr(c.Args[c.Name is "MAXX" or "MINX" ? Math.Min(1, c.Args.Count - 1) : 0]);
                case BinaryNode b when b.Op is "+" or "-": return b.Op == "+" ? IsDateExpr(b.Left) || IsDateExpr(b.Right) : IsDateExpr(b.Left) && !IsDateExpr(b.Right);
                default: return false;
            }
        }

        private static string BinarySql(string op, string a, string b) => op switch
        {
            "+" => "(CASE WHEN " + a + " IS NULL AND " + b + " IS NULL THEN NULL ELSE COALESCE(" + a + ", 0) + COALESCE(" + b + ", 0) END)",
            "-" => "(CASE WHEN " + a + " IS NULL AND " + b + " IS NULL THEN NULL ELSE COALESCE(" + a + ", 0) - COALESCE(" + b + ", 0) END)",
            "*" => "(" + a + " * " + b + ")",
            "/" => "(CAST(" + a + " AS DOUBLE) / NULLIF(" + b + ", 0))",
            "^" => "power(" + a + ", " + b + ")",
            "&" => "(COALESCE(CAST(" + a + " AS VARCHAR), '') || COALESCE(CAST(" + b + " AS VARCHAR), ''))",
            "&&" => "(COALESCE(" + a + ", FALSE) AND COALESCE(" + b + ", FALSE))",
            "||" => "(COALESCE(" + a + ", FALSE) OR COALESCE(" + b + ", FALSE))",
            "=" => "(" + a + " = " + b + ")",
            "<>" => "(" + a + " <> " + b + ")",
            "<" or ">" or "<=" or ">=" => "(" + a + " " + op + " " + b + ")",
            _ => throw new MeasureException("Unknown operator " + op)
        };

        private SemColumn ColArg(Node n, string fn)
        {
            if (n is ColumnNode c) return _m.ResolveColumn(c.Table, c.Column, c.Pos);
            throw new MeasureException(fn + " expects a column like Table[Column]", n?.Pos ?? -1);
        }

        private SemTable TableArg(Node n, string fn)
        {
            if (n is TableNode t) return _m.ResolveTable(t.Name, t.Pos);
            throw new MeasureException(fn + " expects a table", n?.Pos ?? -1);
        }

        private static void Args(CallNode c, int min, int max)
        {
            int n = c.Args.Count;
            if (n < min || n > max) throw new MeasureException(c.Name + " takes " + (min == max ? min.ToString() : min + "–" + max) + " arguments, got " + n, c.Pos);
        }

        private Frame Call(CallNode c, Ctx ctx)
        {
            var a = c.Args;
            switch (c.Name)
            {
                // aggregations
                case "SUM": case "AVERAGE": case "MIN": case "MAX":
                    {
                        if ((c.Name == "MIN" || c.Name == "MAX") && a.Count == 2)
                            return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => (c.Name == "MIN" ? "LEAST(" : "GREATEST(") + v[0] + ", " + v[1] + ")");
                        Args(c, 1, 1);
                        var col = ColArg(a[0], c.Name);
                        string fn = c.Name == "AVERAGE" ? "AVG" : c.Name;
                        return Leaf(col.Table, fb => fn + "(" + fb.Col(col) + ")", ctx);
                    }
                case "COUNT": case "COUNTA":
                    { Args(c, 1, 1); var col = ColArg(a[0], c.Name); return Leaf(col.Table, fb => "NULLIF(COUNT(" + fb.Col(col) + "), 0)", ctx); }
                case "COUNTBLANK":
                    { Args(c, 1, 1); var col = ColArg(a[0], c.Name); return Leaf(col.Table, fb => "NULLIF(COUNT(*) - COUNT(" + fb.Col(col) + "), 0)", ctx); }
                case "DISTINCTCOUNT":
                    { Args(c, 1, 1); var col = ColArg(a[0], c.Name); return Leaf(col.Table, fb => "NULLIF(COUNT(DISTINCT " + fb.Col(col) + ") + MAX(CASE WHEN " + fb.Col(col) + " IS NULL THEN 1 ELSE 0 END), 0)", ctx); }
                case "DISTINCTCOUNTNOBLANK":
                    { Args(c, 1, 1); var col = ColArg(a[0], c.Name); return Leaf(col.Table, fb => "NULLIF(COUNT(DISTINCT " + fb.Col(col) + "), 0)", ctx); }
                case "MEDIAN":
                    { Args(c, 1, 1); var col = ColArg(a[0], c.Name); return Leaf(col.Table, fb => "median(" + fb.Col(col) + ")", ctx); }
                case "PERCENTILE.INC":
                    {
                        Args(c, 2, 2); var col = ColArg(a[0], c.Name); var k = S(a[1], ctx);
                        if (!k.IsConst) throw new MeasureException("PERCENTILE.INC needs a constant k", c.Pos);
                        return Leaf(col.Table, fb => "quantile_cont(" + fb.Col(col) + ", " + k.Const + ")", ctx);
                    }
                case "COUNTROWS":
                    {
                        Args(c, 1, 1);
                        var it = Iter(a[0], ctx);
                        if (it.Columns != null)
                        {
                            var c2 = it.Ctx.Clone();
                            foreach (var (cond, env) in it.ValueConds) ApplyValueCond(it.Columns, cond, env, c2);
                            return Leaf(it.Columns[0].Table, fb => "NULLIF(COUNT(DISTINCT (" + string.Join(", ", it.Columns.Select(fb.Col)) + ")), 0)", c2, it.Rows);
                        }
                        return Leaf(it.Table, _ => "NULLIF(COUNT(*), 0)", it.Ctx, it.Rows);
                    }
                case "SUMX": case "AVERAGEX": case "MINX": case "MAXX": case "COUNTX":
                    {
                        Args(c, 2, 2);
                        string fn = c.Name switch { "SUMX" => "SUM", "AVERAGEX" => "AVG", "MINX" => "MIN", "MAXX" => "MAX", _ => "COUNT" };
                        return Iterate(Iter(a[0], ctx), a[1], fn, ctx);
                    }
                case "RANKX": return RankX(c, ctx);

                // CALCULATE and friends
                case "CALCULATE":
                    {
                        if (a.Count < 1) throw new MeasureException("CALCULATE needs an expression", c.Pos);
                        var c2 = ctx.Clone();
                        foreach (var f in a.Skip(1)) ApplyFilter(f, ctx, c2);
                        return S(a[0], c2);
                    }
                case "TOTALYTD": case "TOTALQTD": case "TOTALMTD":
                    {
                        Args(c, 2, 4);
                        var c2 = ctx.Clone();
                        string yearEnd = c.Name == "TOTALYTD" ? YearEndArg(a.ElementAtOrDefault(3) ?? (a.ElementAtOrDefault(2) is StringNode ? a[2] : null)) : null;
                        c2.Dates.Add(PeriodToDate(c.Name.Substring(5, 1), yearEnd));
                        if (a.Count >= 3 && a[2] != null && a[2] is not StringNode) ApplyFilter(a[2], ctx, c2);
                        return S(a[0], c2);
                    }
                case "OPENINGBALANCEMONTH": case "OPENINGBALANCEQUARTER": case "OPENINGBALANCEYEAR":
                case "CLOSINGBALANCEMONTH": case "CLOSINGBALANCEQUARTER": case "CLOSINGBALANCEYEAR":
                    {
                        Args(c, 2, 3);
                        var c2 = ctx.Clone();
                        string unit = c.Name.EndsWith("MONTH") ? "month" : c.Name.EndsWith("QUARTER") ? "quarter" : "year";
                        bool open = c.Name.StartsWith("OPENING");
                        c2.Dates.Add(r =>
                        {
                            string d = open ? "CAST(date_trunc('" + unit + "', " + r.Lo + ") - INTERVAL 1 DAY AS DATE)"
                                            : "CAST(date_trunc('" + unit + "', " + r.Hi + ") + " + Interval(unit, "1") + " - INTERVAL 1 DAY AS DATE)";
                            return (d, d);
                        });
                        if (a.Count == 3 && a[2] != null) ApplyFilter(a[2], ctx, c2);
                        return S(a[0], c2);
                    }

                // logic and math
                case "DIVIDE":
                    {
                        Args(c, 2, 3);
                        var fs = new List<Frame> { S(a[0], ctx), S(a[1], ctx) };
                        if (a.Count == 3) fs.Add(S(a[2], ctx));
                        return Combine(fs, v => "(CASE WHEN " + v[1] + " IS NULL OR " + v[1] + " = 0 THEN " + (v.Length == 3 ? v[2] : "NULL") + " ELSE CAST(" + v[0] + " AS DOUBLE) / " + v[1] + " END)");
                    }
                case "IF":
                    {
                        Args(c, 2, 3);
                        var fs = new List<Frame> { S(a[0], ctx), S(a[1], ctx), a.Count == 3 ? S(a[2], ctx) : C("NULL") };
                        return Combine(fs, v => "(CASE WHEN COALESCE(" + v[0] + ", FALSE) THEN " + v[1] + " ELSE " + v[2] + " END)");
                    }
                case "SWITCH":
                    {
                        if (a.Count < 3) throw new MeasureException("SWITCH needs an expression and at least one value/result pair", c.Pos);
                        bool isTrue = a[0] is CallNode t && t.Name == "TRUE" || a[0] is BoolNode bn && bn.Value;
                        var fs = a.Select(x => S(x, ctx)).ToList();
                        return Combine(fs, v =>
                        {
                            var sb = new StringBuilder("(CASE");
                            int pairs = (v.Length - 1) / 2;
                            for (int i = 0; i < pairs; i++)
                                sb.Append(isTrue ? " WHEN COALESCE(" + v[1 + 2 * i] + ", FALSE)" : " WHEN " + v[0] + " = " + v[1 + 2 * i]).Append(" THEN ").Append(v[2 + 2 * i]);
                            if ((v.Length - 1) % 2 == 1) sb.Append(" ELSE ").Append(v[^1]);
                            return sb.Append(" END)").ToString();
                        });
                    }
                case "TRUE": return C("TRUE");
                case "FALSE": return C("FALSE");
                case "BLANK": return C("NULL");
                case "AND": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => BinarySql("&&", v[0], v[1]));
                case "OR": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => BinarySql("||", v[0], v[1]));
                case "NOT": Args(c, 1, 1); return Map(S(a[0], ctx), v => "(NOT COALESCE(" + v + ", FALSE))");
                case "ISBLANK": Args(c, 1, 1); return Map(S(a[0], ctx), v => "(" + v + " IS NULL)");
                case "COALESCE": case "IFERROR":
                    if (a.Count < 2) throw new MeasureException(c.Name + " needs at least two arguments", c.Pos);
                    return Combine(a.Select(x => S(x, ctx)).ToList(), v => "COALESCE(" + string.Join(", ", v) + ")");
                case "ABS": Args(c, 1, 1); return Map(S(a[0], ctx), v => "abs(" + v + ")");
                case "SQRT": Args(c, 1, 1); return Map(S(a[0], ctx), v => "sqrt(" + v + ")");
                case "EXP": Args(c, 1, 1); return Map(S(a[0], ctx), v => "exp(" + v + ")");
                case "LN": Args(c, 1, 1); return Map(S(a[0], ctx), v => "ln(" + v + ")");
                case "INT": Args(c, 1, 1); return Map(S(a[0], ctx), v => "CAST(floor(" + v + ") AS BIGINT)");
                case "TRUNC": Args(c, 1, 1); return Map(S(a[0], ctx), v => "trunc(" + v + ")");
                case "ROUND": case "ROUNDUP": case "ROUNDDOWN":
                    {
                        Args(c, 1, 2);
                        var d = a.Count == 2 ? S(a[1], ctx) : C("0");
                        return Combine(new[] { S(a[0], ctx), d }, v => c.Name == "ROUND" ? "round(" + v[0] + ", CAST(" + v[1] + " AS INTEGER))"
                            : (c.Name == "ROUNDUP" ? "(sign(" + v[0] + ") * ceil(abs(" + v[0] + ") * power(10, " + v[1] + ")) / power(10, " + v[1] + "))"
                                                   : "(sign(" + v[0] + ") * floor(abs(" + v[0] + ") * power(10, " + v[1] + ")) / power(10, " + v[1] + "))"));
                    }
                case "MOD": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => "(" + v[0] + " % " + v[1] + ")");
                case "POWER": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => "power(" + v[0] + ", " + v[1] + ")");

                // text and dates
                case "UPPER": Args(c, 1, 1); return Map(S(a[0], ctx), v => "upper(" + v + ")");
                case "LOWER": Args(c, 1, 1); return Map(S(a[0], ctx), v => "lower(" + v + ")");
                case "TRIM": Args(c, 1, 1); return Map(S(a[0], ctx), v => "trim(" + v + ")");
                case "LEN": Args(c, 1, 1); return Map(S(a[0], ctx), v => "length(" + v + ")");
                case "LEFT": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => "left(" + v[0] + ", CAST(" + v[1] + " AS INTEGER))");
                case "RIGHT": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => "right(" + v[0] + ", CAST(" + v[1] + " AS INTEGER))");
                case "CONCATENATE": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => BinarySql("&", v[0], v[1]));
                case "VALUE": Args(c, 1, 1); return Map(S(a[0], ctx), v => "TRY_CAST(" + v + " AS DOUBLE)");
                case "FORMAT": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => FormatSql(v[0], a[1] as StringNode));
                case "TODAY": return C("current_date");
                case "NOW": return C("CAST(current_timestamp AS TIMESTAMP)");
                case "DATE": Args(c, 3, 3); return Combine(a.Select(x => S(x, ctx)).ToList(), v => "make_date(CAST(" + v[0] + " AS INTEGER), CAST(" + v[1] + " AS INTEGER), CAST(" + v[2] + " AS INTEGER))");
                case "YEAR": case "MONTH": case "DAY": case "QUARTER":
                    Args(c, 1, 1); return Map(S(a[0], ctx), v => c.Name.ToLowerInvariant() + "(" + v + ")");
                case "EOMONTH": Args(c, 2, 2); return Combine(new[] { S(a[0], ctx), S(a[1], ctx) }, v => "last_day(CAST(" + v[0] + " AS DATE) + to_months(CAST(" + v[1] + " AS INTEGER)))");
                case "USERNAME": case "USERPRINCIPALNAME": return C(Str(ctx.User ?? ""));

                // context
                case "SELECTEDVALUE": case "VALUES":
                    {
                        Args(c, 1, c.Name == "SELECTEDVALUE" ? 2 : 1);
                        if (c.Name == "VALUES" && a[0] is TableNode) throw new MeasureException("VALUES(table) is a table - use it inside COUNTROWS, SUMX, FILTER …", c.Pos);
                        var col = ColArg(a[0], c.Name);
                        Frame f;
                        if (ctx.Group.Contains(col)) f = Keyed(col, ctx);
                        else f = Leaf(col.Table, fb => "CASE WHEN COUNT(DISTINCT " + fb.Col(col) + ") + MAX(CASE WHEN " + fb.Col(col) + " IS NULL THEN 1 ELSE 0 END) = 1 THEN MIN(" + fb.Col(col) + ") END", ctx);
                        return a.Count == 2 ? Combine(new[] { f, S(a[1], ctx) }, v => "COALESCE(" + v[0] + ", " + v[1] + ")") : f;
                    }
                case "HASONEVALUE":
                    {
                        Args(c, 1, 1); var col = ColArg(a[0], c.Name);
                        if (ctx.Group.Contains(col)) return Map(Keyed(col, ctx), _ => "TRUE");
                        return Leaf(col.Table, fb => "(COUNT(DISTINCT " + fb.Col(col) + ") + MAX(CASE WHEN " + fb.Col(col) + " IS NULL THEN 1 ELSE 0 END) = 1)", ctx);
                    }
                case "ISINSCOPE": { Args(c, 1, 1); var col = ColArg(a[0], c.Name); return C(ctx.Group.Contains(col) ? "TRUE" : "FALSE"); }
                case "ISFILTERED":
                    {
                        Args(c, 1, 1);
                        if (a[0] is TableNode tn)
                        {
                            var t = _m.ResolveTable(tn.Name, tn.Pos);
                            return C(ctx.Group.Any(g => g.Table == t) || ctx.ColFilters.Values.Any(f => f.Col.Table == t) || ctx.RowFilters.Any(r => r.Table == t) ? "TRUE" : "FALSE");
                        }
                        var col = ColArg(a[0], c.Name);
                        return C(ctx.Group.Contains(col) || ctx.ColFilters.ContainsKey(col.Id) || ctx.SetFilters.Any(s => s.Column == col) ? "TRUE" : "FALSE");
                    }
                case "FIRSTDATE": case "LASTDATE":
                    {
                        Args(c, 1, 1); var col = ColArg(a[0], c.Name);
                        return Leaf(col.Table, fb => (c.Name == "FIRSTDATE" ? "MIN(" : "MAX(") + fb.Col(col) + ")", ctx);
                    }
                case "RELATED": throw new MeasureException("RELATED works only inside an iterator (SUMX, FILTER …) over the many-side table", c.Pos);
                case "FILTER": case "ALL": case "ALLEXCEPT": case "ALLSELECTED": case "REMOVEFILTERS": case "KEEPFILTERS": case "DATESYTD": case "DATESQTD": case "DATESMTD":
                case "SAMEPERIODLASTYEAR": case "DATEADD": case "PARALLELPERIOD": case "DATESINPERIOD": case "DATESBETWEEN": case "USERELATIONSHIP": case "TREATAS":
                case "RELATEDTABLE": case "DISTINCT": case "CALCULATETABLE":
                    throw new MeasureException(c.Name + " returns a table or a filter - use it inside CALCULATE, COUNTROWS or an iterator", c.Pos);
            }
            throw new MeasureException("Function " + c.Name + " is not supported (yet)", c.Pos);
        }

        /// <summary>A frame whose value is the grouping column itself.</summary>
        private Frame Keyed(SemColumn col, Ctx ctx)
        {
            var d = Domain(new[] { col }, ctx);
            return new Frame { Keys = d.Keys.ToList(), Sql = "SELECT " + string.Join("", d.Keys.Select(k => K(k) + ", ")) + K(col) + " AS v FROM (" + d.Sql + ") d" };
        }

        private static string FormatSql(string v, StringNode fmt)
        {
            string f = fmt?.Value ?? "";
            if (f.EndsWith("%")) { int dec = f.Contains('.') ? f.Length - f.IndexOf('.') - 2 : 0; return "(CAST(round(" + v + " * 100, " + dec + ") AS VARCHAR) || '%')"; }
            if (f.StartsWith("yyyy") || f.Contains("mm") || f.Contains("MM") || f.Contains("dd")) return "strftime(CAST(" + v + " AS TIMESTAMP), " + Str(f.Replace("yyyy", "%Y").Replace("MM", "%m").Replace("dd", "%d")) + ")";
            if (f.Contains('.')) { int dec = f.Length - f.IndexOf('.') - 1; return "CAST(round(" + v + ", " + dec + ") AS VARCHAR)"; }
            return "CAST(" + v + " AS VARCHAR)";
        }

        // ── iteration ──────────────────────────────────────────────
        internal sealed class IterSpec
        {
            public SemTable Table;                 // table mode
            public List<SemColumn> Columns;        // value mode (VALUES / ALL(column) / DISTINCT)
            public Ctx Ctx;
            public List<RowFilter> Rows = new();
            public List<(Node Cond, Ctx Env)> ValueConds = new();
        }

        /// <summary>What a table expression iterates: a table (with row filters) or the values of columns.</summary>
        internal IterSpec Iter(Node n, Ctx ctx)
        {
            switch (n)
            {
                case TableNode t: return new IterSpec { Table = _m.ResolveTable(t.Name, t.Pos), Ctx = ctx.Clone() };
                case CallNode c:
                    switch (c.Name)
                    {
                        case "FILTER":
                            {
                                Args(c, 2, 2);
                                var spec = Iter(c.Args[0], ctx);
                                if (spec.Columns != null) spec.ValueConds.Add((c.Args[1], ctx));
                                else spec.Rows.Add(new RowFilter { Table = spec.Table, Cond = c.Args[1], Env = ctx });
                                return spec;
                            }
                        case "ALL": case "REMOVEFILTERS": case "ALLSELECTED":
                            {
                                var c2 = ctx.Clone();
                                if (c.Args.Count == 1 && c.Args[0] is TableNode tn)
                                {
                                    var t = _m.ResolveTable(tn.Name, tn.Pos);
                                    if (c.Name == "ALLSELECTED") c2.Group.RemoveAll(g => Expanded(t).Contains(g.Table)); else c2.RemoveTables(Expanded(t));
                                    return new IterSpec { Table = t, Ctx = c2 };
                                }
                                var cols = c.Args.Select(x => ColArg(x, c.Name)).ToList();
                                foreach (var col in cols) { if (c.Name == "ALLSELECTED") c2.Group.Remove(col); else c2.RemoveColumn(col); }
                                return new IterSpec { Columns = cols, Ctx = c2 };
                            }
                        case "VALUES": case "DISTINCT":
                            {
                                Args(c, 1, 1);
                                if (c.Args[0] is TableNode tn) return new IterSpec { Table = _m.ResolveTable(tn.Name, tn.Pos), Ctx = ctx.Clone() };
                                return new IterSpec { Columns = new List<SemColumn> { ColArg(c.Args[0], c.Name) }, Ctx = ctx.Clone() };
                            }
                        case "RELATEDTABLE": Args(c, 1, 1); return new IterSpec { Table = TableArg(c.Args[0], c.Name), Ctx = ctx.Clone() };
                        case "CALCULATETABLE":
                            {
                                if (c.Args.Count < 1) throw new MeasureException("CALCULATETABLE needs a table", c.Pos);
                                var c2 = ctx.Clone();
                                foreach (var f in c.Args.Skip(1)) ApplyFilter(f, ctx, c2);
                                return Iter(c.Args[0], c2);
                            }
                        case "DATESYTD": case "DATESQTD": case "DATESMTD": case "SAMEPERIODLASTYEAR": case "DATEADD": case "PARALLELPERIOD": case "DATESINPERIOD": case "DATESBETWEEN":
                            {
                                var c2 = ctx.Clone();
                                ApplyFilter(c, ctx, c2);
                                return new IterSpec { Columns = new List<SemColumn> { _m.Calendar.Columns[0] }, Ctx = c2 };
                            }
                    }
                    break;
            }
            throw new MeasureException("Expected a table expression (a table, FILTER, ALL, VALUES, RELATEDTABLE, CALCULATETABLE …)", n?.Pos ?? -1);
        }

        private Frame Iterate(IterSpec it, Node expr, string agg, Ctx outer)
        {
            if (it.Columns == null)
            {
                try
                {
                    return Leaf(it.Table, fb => (agg == "COUNT" ? "NULLIF(COUNT(" : agg + "(") + Row(expr, fb, it.Table, it.Ctx) + (agg == "COUNT" ? "), 0)" : ")"), it.Ctx, it.Rows);
                }
                catch (NeedsContextException)
                {
                    if (it.Table.KeyColumns.Count == 0) throw new MeasureException("Iterating " + it.Table.Key + " with a measure needs the table's key column(s) (set Key on the table)");
                    var keyCols = it.Table.KeyColumns.Select(k => _m.ResolveColumn(it.Table.Key, k)).ToList();
                    var spec = new IterSpec { Columns = keyCols, Ctx = it.Ctx.Clone() };
                    spec.Ctx.RowFilters.AddRange(it.Rows);
                    return Iterate(spec, expr, agg, outer);
                }
            }
            // value mode: evaluate expr per (outer keys × iterated values), then aggregate over the iterated values
            var inner = it.Ctx.Clone();
            foreach (var col in it.Columns) if (!inner.Group.Contains(col)) inner.Group.Add(col);
            foreach (var (cond, env) in it.ValueConds) ApplyValueCond(it.Columns, cond, env, inner);
            var f = EnsureKeys(S(expr, inner), it.Columns, inner);
            var outKeys = f.Keys.Where(k => !it.Columns.Contains(k)).ToList();
            string aggSql = agg == "COUNT" ? "NULLIF(COUNT(i.v), 0)" : agg + "(i.v)";
            return new Frame
            {
                Keys = outKeys,
                Sql = "SELECT " + string.Join("", outKeys.Select(k => "i." + K(k) + " AS " + K(k) + ", ")) + aggSql + " AS v FROM (" + f.Sql + ") i" +
                      (outKeys.Count > 0 ? " GROUP BY " + string.Join(", ", outKeys.Select(k => "i." + K(k))) : "")
            };
        }

        /// <summary>FILTER(values-of-a-column, condition): a condition on the column alone becomes a predicate; one with measures becomes a set filter.</summary>
        private void ApplyValueCond(List<SemColumn> cols, Node cond, Ctx env, Ctx target)
        {
            if (cols.Count == 1 && TryColumnPredicate(cond, env, out var col, out var pred) && col == cols[0]) { target.AddPred(col, pred); return; }
            var inner = env.Clone();
            foreach (var c in cols) if (!inner.Group.Contains(c)) inner.Group.Add(c);
            var f = EnsureKeys(S(cond, inner), cols, inner);
            target.SetFilters.Add(new SetFilter { Column = cols[0], Inner = f, Cond = "COALESCE({v}, FALSE)" });
        }

        private Frame RankX(CallNode c, Ctx ctx)
        {
            Args(c, 2, 5);
            var it = Iter(c.Args[0], ctx);
            if (it.Columns == null)
            {
                if (it.Table.KeyColumns.Count == 0) throw new MeasureException("RANKX over " + it.Table.Key + " needs the table's key column(s)", c.Pos);
                it.Columns = it.Table.KeyColumns.Select(k => _m.ResolveColumn(it.Table.Key, k)).ToList();
            }
            bool asc = c.Args.Count >= 4 && c.Args[3] is KeywordNode k && k.Word == "ASC";
            bool dense = c.Args.Count >= 5 && c.Args[4] is KeywordNode d && d.Word == "DENSE";
            var cur = S(c.Args.Count >= 3 && c.Args[2] != null ? c.Args[2] : c.Args[1], ctx);
            var inner = it.Ctx.Clone();
            foreach (var col in it.Columns) if (!inner.Group.Contains(col)) inner.Group.Add(col);
            var all = EnsureKeys(S(c.Args[1], inner), it.Columns, inner);
            if (cur.IsConst) cur = EnsureKeys(cur, ctx.Group, ctx);
            var shared = cur.Keys.Where(x => all.Keys.Contains(x) && !it.Columns.Contains(x)).ToList();
            string cmp = asc ? "<" : ">";
            string count = dense ? "COUNT(DISTINCT CASE WHEN i.v " + cmp + " c.v THEN i.v END)" : "COUNT(CASE WHEN i.v " + cmp + " c.v THEN 1 END)";
            return new Frame
            {
                Keys = cur.Keys.ToList(),
                Sql = "SELECT " + string.Join("", cur.Keys.Select(x => "c." + K(x) + " AS " + K(x) + ", ")) + "CASE WHEN c.v IS NULL THEN NULL ELSE 1 + " + count + " END AS v FROM (" + cur.Sql + ") c LEFT JOIN (" + all.Sql + ") i" +
                      (shared.Count > 0 ? " ON " + string.Join(" AND ", shared.Select(x => "c." + K(x) + " IS NOT DISTINCT FROM i." + K(x))) : " ON TRUE") +
                      " GROUP BY " + string.Join(", ", cur.Keys.Select(x => "c." + K(x)).Append("c.v"))
            };
        }

        // ── row expressions (row context) ──────────────────────────
        internal string Row(Node n, From fb, SemTable rowTable, Ctx ctx)
        {
            switch (n)
            {
                case null: return "NULL";
                case NumberNode x: return Num(x.Value);
                case StringNode x: return Str(x.Value);
                case BoolNode x: return x.Value ? "TRUE" : "FALSE";
                case ColumnNode c:
                    {
                        var col = _m.ResolveColumn(c.Table, c.Column, c.Pos);
                        if (col.Table != rowTable && fb.TryAlias(col.Table) == null) throw new MeasureException("Column " + col.Id + " is not related to " + rowTable.Key, c.Pos);
                        return fb.Col(col);
                    }
                case BracketNode b:
                    {
                        var col = rowTable.Columns.FirstOrDefault(x => string.Equals(x.Name, b.Name, StringComparison.OrdinalIgnoreCase));
                        if (col != null && !_m.Measures.ContainsKey(b.Name) && !LocalMeasures.ContainsKey(b.Name)) return fb.Col(col);
                        throw new NeedsContextException();
                    }
                case VarNode v:
                    if (ctx.Vars.TryGetValue(v.Name, out var fr) && fr.IsConst) return "(" + fr.Const + ")";
                    throw new NeedsContextException();
                case UnaryNode u: return u.Op == "-" ? "(-" + Row(u.Operand, fb, rowTable, ctx) + ")" : "(NOT COALESCE(" + Row(u.Operand, fb, rowTable, ctx) + ", FALSE))";
                case BinaryNode b:
                    if (b.Op == "IN")
                    {
                        var list = b.Right as ListNode ?? throw new MeasureException("IN needs a list { … }", b.Pos);
                        return "(" + Row(b.Left, fb, rowTable, ctx) + " IN (" + string.Join(", ", list.Items.Select(i => Row(i, fb, rowTable, ctx))) + "))";
                    }
                    return b.Op is "+" or "-" && (IsDateExpr(b.Left) || IsDateExpr(b.Right))
                        ? DateArith(b.Op, Row(b.Left, fb, rowTable, ctx), Row(b.Right, fb, rowTable, ctx))
                        : BinarySql(b.Op, Row(b.Left, fb, rowTable, ctx), Row(b.Right, fb, rowTable, ctx));
                case CallNode c:
                    {
                        var a = c.Args;
                        string R(int i) => Row(a[i], fb, rowTable, ctx);
                        switch (c.Name)
                        {
                            case "RELATED": Args(c, 1, 1); return fb.Col(ColArg(a[0], "RELATED"));
                            case "IF": Args(c, 2, 3); return "(CASE WHEN COALESCE(" + R(0) + ", FALSE) THEN " + R(1) + " ELSE " + (a.Count == 3 ? R(2) : "NULL") + " END)";
                            case "DIVIDE": Args(c, 2, 3); return "(CASE WHEN " + R(1) + " IS NULL OR " + R(1) + " = 0 THEN " + (a.Count == 3 ? R(2) : "NULL") + " ELSE CAST(" + R(0) + " AS DOUBLE) / " + R(1) + " END)";
                            case "AND": Args(c, 2, 2); return BinarySql("&&", R(0), R(1));
                            case "OR": Args(c, 2, 2); return BinarySql("||", R(0), R(1));
                            case "NOT": Args(c, 1, 1); return "(NOT COALESCE(" + R(0) + ", FALSE))";
                            case "ISBLANK": Args(c, 1, 1); return "(" + R(0) + " IS NULL)";
                            case "BLANK": return "NULL";
                            case "TRUE": return "TRUE";
                            case "FALSE": return "FALSE";
                            case "COALESCE": return "COALESCE(" + string.Join(", ", a.Select((_, i) => R(i))) + ")";
                            case "ABS": return "abs(" + R(0) + ")";
                            case "ROUND": return "round(" + R(0) + ", " + (a.Count > 1 ? "CAST(" + R(1) + " AS INTEGER)" : "0") + ")";
                            case "INT": return "CAST(floor(" + R(0) + ") AS BIGINT)";
                            case "MOD": return "(" + R(0) + " % " + R(1) + ")";
                            case "POWER": return "power(" + R(0) + ", " + R(1) + ")";
                            case "UPPER": return "upper(" + R(0) + ")";
                            case "LOWER": return "lower(" + R(0) + ")";
                            case "TRIM": return "trim(" + R(0) + ")";
                            case "LEN": return "length(" + R(0) + ")";
                            case "LEFT": return "left(" + R(0) + ", CAST(" + R(1) + " AS INTEGER))";
                            case "RIGHT": return "right(" + R(0) + ", CAST(" + R(1) + " AS INTEGER))";
                            case "CONCATENATE": return BinarySql("&", R(0), R(1));
                            case "YEAR": case "MONTH": case "DAY": case "QUARTER": return c.Name.ToLowerInvariant() + "(TRY_CAST(" + R(0) + " AS TIMESTAMP))";
                            case "DATE": return "make_date(CAST(" + R(0) + " AS INTEGER), CAST(" + R(1) + " AS INTEGER), CAST(" + R(2) + " AS INTEGER))";
                            case "TODAY": return "current_date";
                            case "VALUE": return "TRY_CAST(" + R(0) + " AS DOUBLE)";
                            case "SWITCH":
                                {
                                    bool isTrue = a[0] is CallNode t && t.Name == "TRUE" || a[0] is BoolNode bn && bn.Value;
                                    var sb = new StringBuilder("(CASE");
                                    int pairs = (a.Count - 1) / 2;
                                    for (int i = 0; i < pairs; i++) sb.Append(isTrue ? " WHEN COALESCE(" + R(1 + 2 * i) + ", FALSE)" : " WHEN " + R(0) + " = " + R(1 + 2 * i)).Append(" THEN ").Append(R(2 + 2 * i));
                                    if ((a.Count - 1) % 2 == 1) sb.Append(" ELSE ").Append(R(a.Count - 1));
                                    return sb.Append(" END)").ToString();
                                }
                        }
                        throw new NeedsContextException();     // an aggregate, CALCULATE, a measure …
                    }
            }
            throw new NeedsContextException();
        }

        // ── CALCULATE filter arguments ─────────────────────────────
        /// <summary>Applies one CALCULATE filter argument (evaluated in <paramref name="outer"/>) to <paramref name="target"/>.</summary>
        internal void ApplyFilter(Node f, Ctx outer, Ctx target)
        {
            switch (f)
            {
                case null: return;
                case BinaryNode or UnaryNode:
                    {
                        if (TryColumnPredicate(f, outer, out var col, out var pred))
                        {
                            target.RemoveColumn(col);
                            target.AddPred(col, pred);
                            return;
                        }
                        if (TryRunningDate(f, out var dt)) { target.Dates.Add(dt); return; }
                        if (TryScalarCompare(f, outer, target, replace: true)) return;
                        var tables = Columns(f).Select(c => c.Table).Distinct().ToList();
                        if (tables.Count == 1)
                        {
                            foreach (var c in Columns(f).Distinct()) target.RemoveColumn(c);
                            target.RowFilters.Add(new RowFilter { Table = tables[0], Cond = f, Env = outer });
                            return;
                        }
                        throw new MeasureException("A CALCULATE filter must refer to columns of one table (use FILTER for anything else)", f.Pos);
                    }
                case CallNode c:
                    switch (c.Name)
                    {
                        case "KEEPFILTERS":
                            {
                                Args(c, 1, 1);
                                if (TryColumnPredicate(c.Args[0], outer, out var col, out var pred)) { target.AddPred(col, pred); return; }
                                if (TryScalarCompare(c.Args[0], outer, target, replace: false)) return;
                                var tables = Columns(c.Args[0]).Select(x => x.Table).Distinct().ToList();
                                if (tables.Count == 1) { target.RowFilters.Add(new RowFilter { Table = tables[0], Cond = c.Args[0], Env = outer }); return; }
                                ApplyTableFilter(c.Args[0], outer, target, keep: true);
                                return;
                            }
                        case "ALL": case "REMOVEFILTERS":
                            if (c.Args.Count == 0) { target.ColFilters.Clear(); target.Group.Clear(); target.RowFilters.Clear(); target.SetFilters.Clear(); target.Dates.Clear(); return; }
                            foreach (var x in c.Args)
                            {
                                if (x is TableNode tn) target.RemoveTables(Expanded(_m.ResolveTable(tn.Name, tn.Pos)));
                                else target.RemoveColumn(ColArg(x, c.Name));
                            }
                            return;
                        case "ALLSELECTED":
                            if (c.Args.Count == 0) { target.Group.Clear(); return; }
                            foreach (var x in c.Args)
                            {
                                if (x is TableNode tn) { var ex = Expanded(_m.ResolveTable(tn.Name, tn.Pos)); target.Group.RemoveAll(g => ex.Contains(g.Table)); }
                                else target.Group.Remove(ColArg(x, c.Name));
                            }
                            return;
                        case "ALLEXCEPT":
                            {
                                if (c.Args.Count < 2) throw new MeasureException("ALLEXCEPT needs a table and at least one column", c.Pos);
                                var t = TableArg(c.Args[0], "ALLEXCEPT");
                                var keep = c.Args.Skip(1).Select(x => ColArg(x, "ALLEXCEPT")).ToList();
                                target.RemoveTables(Expanded(t), keep);
                                return;
                            }
                        case "USERELATIONSHIP":
                            {
                                Args(c, 2, 2);
                                var c1 = ColArg(c.Args[0], c.Name); var c2 = ColArg(c.Args[1], c.Name);
                                var rel = _m.Relationships.FirstOrDefault(r => r.From == c1 && r.To == c2 || r.From == c2 && r.To == c1)
                                          ?? throw new MeasureException("No relationship between " + c1.Id + " and " + c2.Id + " (define it, inactive)", c.Pos);
                                target.UseRel.Add(rel);
                                return;
                            }
                        case "TREATAS":
                            {
                                Args(c, 2, 2);
                                var col = ColArg(c.Args[1], c.Name);
                                var list = c.Args[0] as ListNode ?? throw new MeasureException("TREATAS takes a list { … } and a column", c.Pos);
                                var items = list.Items.Select(i => S(i, outer)).ToList();
                                if (!items.All(i => i.IsConst)) throw new MeasureException("TREATAS values must be constants", c.Pos);
                                target.RemoveColumn(col);
                                target.AddPred(col, "{c} IN (" + string.Join(", ", items.Select(i => i.Const)) + ")");
                                return;
                            }
                        case "VALUES": return;                    // the current filter - nothing to change
                        case "DATESYTD": case "DATESQTD": case "DATESMTD":
                            {
                                Args(c, 1, 2);
                                target.Dates.Add(PeriodToDate(c.Name.Substring(5, 1), c.Name == "DATESYTD" && c.Args.Count == 2 ? YearEndArg(c.Args[1]) : null));
                                return;
                            }
                        case "SAMEPERIODLASTYEAR":
                            Args(c, 1, 1);
                            target.Dates.Add(r => (Shift(r.Lo, "year", "-1"), Shift(r.Hi, "year", "-1")));
                            return;
                        case "DATEADD":
                            {
                                Args(c, 3, 3);
                                string n = ConstNumber(c.Args[1], outer), unit = Unit(c.Args[2]);
                                target.Dates.Add(r => (Shift(r.Lo, unit, n), "(CASE WHEN " + r.Hi + " = last_day(" + r.Hi + ") THEN last_day(" + Shift(r.Hi, unit, n) + ") ELSE " + Shift(r.Hi, unit, n) + " END)"));
                                return;
                            }
                        case "PARALLELPERIOD":
                            {
                                Args(c, 3, 3);
                                string n = ConstNumber(c.Args[1], outer), unit = Unit(c.Args[2]);
                                target.Dates.Add(r => ("CAST(date_trunc('" + unit + "', " + Shift(r.Lo, unit, n) + ") AS DATE)",
                                                        "CAST(date_trunc('" + unit + "', " + Shift(r.Hi, unit, n) + ") + " + Interval(unit, "1") + " - INTERVAL 1 DAY AS DATE)"));
                                return;
                            }
                        case "PREVIOUSMONTH": case "PREVIOUSQUARTER": case "PREVIOUSYEAR": case "NEXTMONTH": case "NEXTQUARTER": case "NEXTYEAR":
                            {
                                string unit = c.Name.EndsWith("MONTH") ? "month" : c.Name.EndsWith("QUARTER") ? "quarter" : "year";
                                bool prev = c.Name.StartsWith("PREVIOUS");
                                target.Dates.Add(r => prev
                                    ? ("CAST(date_trunc('" + unit + "', " + r.Lo + ") - " + Interval(unit, "1") + " AS DATE)", "CAST(date_trunc('" + unit + "', " + r.Lo + ") - INTERVAL 1 DAY AS DATE)")
                                    : ("CAST(date_trunc('" + unit + "', " + r.Hi + ") + " + Interval(unit, "1") + " AS DATE)", "CAST(date_trunc('" + unit + "', " + r.Hi + ") + " + Interval(unit, "2") + " - INTERVAL 1 DAY AS DATE)"));
                                return;
                            }
                        case "DATESINPERIOD":
                            {
                                Args(c, 4, 4);
                                string n = ConstNumber(c.Args[2], outer), unit = Unit(c.Args[3]);
                                var anchor = c.Args[1];
                                bool useLo = anchor is CallNode an && (an.Name == "MIN" || an.Name == "FIRSTDATE");
                                string constAnchor = anchor is CallNode cn && (cn.Name == "MIN" || cn.Name == "MAX" || cn.Name == "FIRSTDATE" || cn.Name == "LASTDATE") ? null : ConstDate(anchor, outer);
                                target.Dates.Add(r =>
                                {
                                    string a = constAnchor ?? (useLo ? r.Lo : r.Hi);
                                    bool back = n.StartsWith("-");
                                    return back ? ("CAST(" + a + " + " + Interval(unit, n) + " + INTERVAL 1 DAY AS DATE)", a)
                                                : (a, "CAST(" + a + " + " + Interval(unit, n) + " - INTERVAL 1 DAY AS DATE)");
                                });
                                return;
                            }
                        case "DATESBETWEEN":
                            {
                                Args(c, 3, 3);
                                string lo = ConstDate(c.Args[1], outer) ?? "DATE '0001-01-01'", hi = ConstDate(c.Args[2], outer) ?? "DATE '9999-12-31'";
                                target.Dates.Add(_ => (lo, hi));
                                return;
                            }
                        case "LASTDATE": case "FIRSTDATE": case "ENDOFMONTH": case "STARTOFMONTH":
                            {
                                bool last = c.Name == "LASTDATE" || c.Name == "ENDOFMONTH";
                                target.Dates.Add(r =>
                                {
                                    string d = c.Name == "ENDOFMONTH" ? "last_day(" + r.Hi + ")" : c.Name == "STARTOFMONTH" ? "CAST(date_trunc('month', " + r.Lo + ") AS DATE)" : last ? r.Hi : r.Lo;
                                    return (d, d);
                                });
                                return;
                            }
                        case "FILTER": case "CALCULATETABLE":
                            ApplyTableFilter(f, outer, target, keep: false);
                            return;
                        case "NOT":
                            ApplyFilter(new UnaryNode { Op = "NOT", Operand = c.Args[0], Pos = c.Pos }, outer, target);
                            return;
                    }
                    break;
                case TableNode t:
                    return;       // a table as a filter keeps its current rows
            }
            throw new MeasureException("Not a filter: " + Describe(f), f.Pos);
        }

        /// <summary>FILTER(…) as a CALCULATE argument.</summary>
        private void ApplyTableFilter(Node f, Ctx outer, Ctx target, bool keep)
        {
            var c = f as CallNode ?? throw new MeasureException("Expected FILTER(…)", f.Pos);
            if (c.Name == "CALCULATETABLE") { var spec2 = Iter(c, outer); target.RowFilters.AddRange(spec2.Rows); return; }
            if (c.Name != "FILTER") throw new MeasureException("Expected FILTER(…)", c.Pos);
            Args(c, 2, 2);
            if (TryRunningDate(c, out var dt)) { target.Dates.Add(dt); return; }
            var inner = c.Args[0] as CallNode;
            bool clears = inner != null && (inner.Name == "ALL" || inner.Name == "REMOVEFILTERS" || inner.Name == "ALLSELECTED");
            var spec = Iter(c.Args[0], outer);
            if (spec.Columns != null)
            {
                if (clears && !keep) foreach (var col in spec.Columns) target.RemoveColumn(col);
                ApplyValueCond(spec.Columns, c.Args[1], spec.Ctx, target);
                return;
            }
            if (clears && !keep) target.RemoveTables(Expanded(spec.Table));
            if (TryScalarCompare(c.Args[1], spec.Ctx, target, replace: false)) return;
            try
            {
                // a row condition (columns only) filters the table's rows; one with measures becomes a set on its key
                var probe = new From(this, spec.Table, spec.Ctx);
                Row(c.Args[1], probe, spec.Table, spec.Ctx);
                target.RowFilters.Add(new RowFilter { Table = spec.Table, Cond = c.Args[1], Env = spec.Ctx });
            }
            catch (NeedsContextException)
            {
                if (spec.Table.KeyColumns.Count != 1) throw new MeasureException("FILTER over " + spec.Table.Key + " with a measure needs a single key column on the table", c.Pos);
                ApplyValueCond(new List<SemColumn> { _m.ResolveColumn(spec.Table.Key, spec.Table.KeyColumns[0]) }, c.Args[1], spec.Ctx, target);
            }
        }

        /// <summary>FILTER(ALL(calendar[Date]), calendar[Date] &lt;= MAX(calendar[Date])) - the running-total pattern.</summary>
        private bool TryRunningDate(Node f, out DateTransform t)
        {
            t = null;
            Node cond = f;
            if (f is CallNode fc && fc.Name == "FILTER" && fc.Args.Count == 2) cond = fc.Args[1];
            if (cond is not BinaryNode b || b.Op is not ("<=" or "<" or ">=" or ">")) return false;
            if (b.Left is not ColumnNode lc || b.Right is not CallNode rc || rc.Args.Count != 1 || rc.Args[0] is not ColumnNode) return false;
            if (!(_m.Calendar != null && _m.ResolveTable(lc.Table, lc.Pos) == _m.Calendar)) return false;
            if (rc.Name is not ("MAX" or "MIN" or "LASTDATE" or "FIRSTDATE")) return false;
            bool upTo = b.Op is "<=" or "<";
            bool useMax = rc.Name is "MAX" or "LASTDATE";
            string op = b.Op;
            t = r =>
            {
                string anchor = useMax ? r.Hi : r.Lo;
                return upTo ? ("DATE '0001-01-01'", op == "<" ? "CAST(" + anchor + " - INTERVAL 1 DAY AS DATE)" : anchor)
                            : (op == ">" ? "CAST(" + anchor + " + INTERVAL 1 DAY AS DATE)" : anchor, "DATE '9999-12-31'");
            };
            return true;
        }

        /// <summary>
        /// col op scalar, where the scalar is computed in the outer filter context (a VAR, MAX(col), an aggregate - no
        /// measure, which would need context transition): the scalar is compiled once in <paramref name="outer"/>, and the
        /// values of col that satisfy the comparison become a set filter correlated on the outer grouping keys.
        /// E.g. VAR d = MAX(t[DATE]) RETURN CALCULATE(…, t[DATE] = d) → the rows of the last date in each group.
        /// </summary>
        private bool TryScalarCompare(Node n, Ctx outer, Ctx target, bool replace)
        {
            if (n is not BinaryNode b || b.Op is not ("=" or "<>" or "<" or ">" or "<=" or ">=")) return false;
            ColumnNode cn; Node other; string op;
            if (b.Left is ColumnNode l && !Columns(b.Right).Any()) { cn = l; other = b.Right; op = b.Op; }
            else if (b.Right is ColumnNode r && !Columns(b.Left).Any()) { cn = r; other = b.Left; op = Flip(b.Op); }
            else return false;
            if (HasMeasure(other)) return false;
            var col = _m.ResolveColumn(cn.Table, cn.Column, cn.Pos);
            var scalar = S(other, outer);
            if (scalar.IsConst) return false;                       // a constant is a plain predicate
            var env = outer.Clone();
            env.RemoveColumn(col);
            var values = Keyed(col, env);
            var inner = Combine(new[] { values, scalar }, v => "(" + v[0] + " " + op + " " + v[1] + ")");
            if (replace) target.RemoveColumn(col);
            target.SetFilters.Add(new SetFilter { Column = col, Inner = inner, Cond = "COALESCE({v}, FALSE)" });
            return true;
        }

        private static bool HasMeasure(Node n) => n switch
        {
            BracketNode => true,
            BinaryNode b => HasMeasure(b.Left) || HasMeasure(b.Right),
            UnaryNode u => HasMeasure(u.Operand),
            CallNode c => c.Args.Any(a => a != null && HasMeasure(a)),
            VarBlockNode v => v.Vars.Any(x => HasMeasure(x.Expr)) || HasMeasure(v.Return),
            _ => false
        };

        /// <summary>col op constant / col IN {…} / combinations of those on one column → a SQL predicate over {c}.</summary>
        private bool TryColumnPredicate(Node n, Ctx ctx, out SemColumn col, out string pred)
        {
            col = null; pred = null;
            var cols = Columns(n).Distinct().ToList();
            if (cols.Count != 1) return false;
            col = cols[0];
            try { pred = Pred(n, col, ctx); return pred != null; }
            catch (NeedsContextException) { return false; }
        }

        private string Pred(Node n, SemColumn col, Ctx ctx)
        {
            switch (n)
            {
                case BinaryNode b when b.Op is "&&" or "||":
                    return "(" + Pred(b.Left, col, ctx) + (b.Op == "&&" ? " AND " : " OR ") + Pred(b.Right, col, ctx) + ")";
                case UnaryNode u when u.Op == "NOT": return "(NOT " + Pred(u.Operand, col, ctx) + ")";
                case CallNode c when c.Name == "NOT" && c.Args.Count == 1: return "(NOT " + Pred(c.Args[0], col, ctx) + ")";
                case BinaryNode b when b.Op == "IN":
                    {
                        var list = b.Right as ListNode ?? throw new NeedsContextException();
                        var items = list.Items.Select(i => S(i, ctx)).ToList();
                        if (!items.All(i => i.IsConst)) throw new NeedsContextException();
                        return "{c} IN (" + string.Join(", ", items.Select(i => i.Const)) + ")";
                    }
                case BinaryNode b when b.Op is "=" or "<>" or "<" or ">" or "<=" or ">=":
                    {
                        bool left = b.Left is ColumnNode;
                        var other = left ? b.Right : b.Left;
                        if ((left ? b.Left : b.Right) is not ColumnNode) throw new NeedsContextException();
                        var v = S(other, ctx);
                        if (!v.IsConst) throw new NeedsContextException();
                        string op = left ? b.Op : Flip(b.Op);
                        if (v.Const == "(NULL)" || v.Const == "NULL") return op == "=" ? "{c} IS NULL" : op == "<>" ? "{c} IS NOT NULL" : "FALSE";
                        return "{c} " + op + " " + v.Const;
                    }
                case CallNode c when c.Name == "ISBLANK" && c.Args.Count == 1 && c.Args[0] is ColumnNode: return "{c} IS NULL";
            }
            throw new NeedsContextException();
        }

        private static string Flip(string op) => op switch { "<" => ">", ">" => "<", "<=" => ">=", ">=" => "<=", _ => op };

        /// <summary>Columns referenced by an expression (not inside aggregations).</summary>
        private IEnumerable<SemColumn> Columns(Node n)
        {
            switch (n)
            {
                case ColumnNode c: yield return _m.ResolveColumn(c.Table, c.Column, c.Pos); break;
                case BinaryNode b: foreach (var x in Columns(b.Left).Concat(Columns(b.Right))) yield return x; break;
                case UnaryNode u: foreach (var x in Columns(u.Operand)) yield return x; break;
                case CallNode c when c.Name is "NOT" or "ISBLANK" or "AND" or "OR" or "RELATED" or "YEAR" or "MONTH" or "UPPER" or "LOWER" or "LEFT" or "RIGHT" or "TRIM" or "LEN" or "ABS" or "ROUND":
                    foreach (var a in c.Args) foreach (var x in Columns(a)) yield return x;
                    break;
            }
        }

        // ── dates ──────────────────────────────────────────────────
        private static string Interval(string unit, string n) => unit switch
        {
            "year" => "to_years(CAST(" + n + " AS INTEGER))",
            "quarter" => "to_months(CAST(3 * (" + n + ") AS INTEGER))",
            "month" => "to_months(CAST(" + n + " AS INTEGER))",
            _ => "to_days(CAST(" + n + " AS INTEGER))"
        };

        private static string Shift(string d, string unit, string n) => "CAST(" + d + " + " + Interval(unit, n) + " AS DATE)";

        private static DateTransform PeriodToDate(string p, string yearEnd)
        {
            return r =>
            {
                string start;
                if (p == "Y" && yearEnd != null)
                {
                    var parts = yearEnd.Split('-', '/');
                    int m = int.Parse(parts[0], CultureInfo.InvariantCulture), d = int.Parse(parts[1], CultureInfo.InvariantCulture);
                    string ye = "make_date(year(" + r.Hi + "), " + m + ", " + d + ")";
                    start = "CAST(CASE WHEN " + r.Hi + " > " + ye + " THEN " + ye + " ELSE make_date(year(" + r.Hi + ") - 1, " + m + ", " + d + ") END + INTERVAL 1 DAY AS DATE)";
                }
                else start = "CAST(date_trunc('" + (p == "Y" ? "year" : p == "Q" ? "quarter" : "month") + "', " + r.Hi + ") AS DATE)";
                return (start, r.Hi);
            };
        }

        /// <summary>A year-end argument "06-30" / "6/30".</summary>
        private static string YearEndArg(Node n) => n is StringNode s && System.Text.RegularExpressions.Regex.IsMatch(s.Value, @"^\d{1,2}[-/]\d{1,2}$") ? s.Value : null;

        private static string Unit(Node n) => n is KeywordNode k && k.Word is "YEAR" or "QUARTER" or "MONTH" or "DAY" ? ((KeywordNode)n).Word.ToLowerInvariant()
            : throw new MeasureException("Expected YEAR, QUARTER, MONTH or DAY", n?.Pos ?? -1);

        /// <summary>A constant number argument (DATEADD's -1, DATESINPERIOD's -12) as a plain literal.</summary>
        private string ConstNumber(Node n, Ctx ctx)
        {
            double? v = Eval(n, ctx);
            if (v == null) throw new MeasureException("Expected a constant number", n?.Pos ?? -1);
            return Num(v.Value);
        }

        private static double? Eval(Node n, Ctx ctx) => n switch
        {
            NumberNode x => x.Value,
            UnaryNode { Op: "-" } u => -Eval(u.Operand, ctx),
            BinaryNode { Op: "+" or "-" or "*" or "/" } b when Eval(b.Left, ctx) is double l && Eval(b.Right, ctx) is double r =>
                b.Op == "+" ? l + r : b.Op == "-" ? l - r : b.Op == "*" ? l * r : r == 0 ? null : l / r,
            VarNode v when ctx.Vars.TryGetValue(v.Name, out var f) && f.IsConst && double.TryParse(f.Const.Trim('(', ')'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
            _ => null
        };

        private string ConstDate(Node n, Ctx ctx)
        {
            if (n == null || n is CallNode { Name: "BLANK" }) return null;
            var f = S(n, ctx);
            if (!f.IsConst) throw new MeasureException("Expected a constant date, e.g. DATE(2026, 1, 1)", n.Pos);
            return "CAST(" + f.Const + " AS DATE)";
        }

        private static string Describe(Node n) => n switch { CallNode c => c.Name + "(…)", ColumnNode c => c.Table + "[" + c.Column + "]", _ => n?.GetType().Name.Replace("Node", "") ?? "?" };

        /// <summary>A typed SQL literal for a filter value on this column.</summary>
        public static string Lit(SemColumn col, string v)
        {
            if (v == null) return "NULL";
            if (col.IsNumeric && double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return Num(d);
            if (col.IsDate && DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
                return (col.Type.StartsWith("DATE", StringComparison.OrdinalIgnoreCase) && col.Type.Length == 4 ? "DATE '" + dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "TIMESTAMP '" + dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)) + "'";
            if (string.Equals(col.Type, "BOOLEAN", StringComparison.OrdinalIgnoreCase) && bool.TryParse(v, out var bo)) return bo ? "TRUE" : "FALSE";
            return Str(v);
        }
    }
}

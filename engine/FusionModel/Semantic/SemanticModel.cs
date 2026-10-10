using System.Globalization;

namespace FusionModel.Semantic
{
    public sealed class SemTable
    {
        public string Key;                // wms.trip_orders · calendar
        public string Module;
        public string Name;
        public string SqlName;            // "wms"."trip_orders" · "memory"."main"."calendar"
        public List<SemColumn> Columns = new();
        public List<string> KeyColumns = new();
        public bool IsCalendar;
        public override string ToString() => Key;
    }

    public sealed class SemColumn
    {
        public SemTable Table;
        public string Name;
        public string Type;
        public string Id => Table.Key + "[" + Name + "]";
        public bool IsNumeric => Types.IsNumeric(Type);
        public bool IsDate => Type != null && (Type.StartsWith("DATE", StringComparison.OrdinalIgnoreCase) || Type.StartsWith("TIMESTAMP", StringComparison.OrdinalIgnoreCase));
        public override string ToString() => Id;
    }

    public sealed class SemRel
    {
        public SemColumn From;            // many side
        public SemColumn To;              // one side
        public bool Active;
        public bool Both;
        public override string ToString() => From.Id + " → " + To.Id;
    }

    /// <summary>
    /// The model bound to the loaded data: tables (with the columns actually in the published files), relationships,
    /// measures, the generated calendar and roles. Name lookup accepts module.table or the bare table name when unique.
    /// </summary>
    public sealed class SemanticModel
    {
        public Dictionary<string, SemTable> Tables { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<SemRel> Relationships { get; } = new();
        public Dictionary<string, MeasureDef> Measures { get; } = new(StringComparer.OrdinalIgnoreCase);
        public ModelDefinition Definition { get; private set; }
        public SemTable Calendar { get; private set; }

        public const string CalendarKey = "calendar";

        public static readonly (string Name, string Type)[] CalendarColumns =
        {
            ("Date", "DATE"), ("Year", "INTEGER"), ("Quarter", "INTEGER"), ("QuarterName", "VARCHAR"), ("Month", "INTEGER"), ("MonthName", "VARCHAR"),
            ("YearMonth", "VARCHAR"), ("MonthStart", "DATE"), ("Day", "INTEGER"), ("Weekday", "INTEGER"), ("WeekdayName", "VARCHAR"), ("IsWeekend", "BOOLEAN"),
            ("FiscalYear", "INTEGER"), ("FiscalQuarter", "INTEGER"), ("FiscalMonth", "INTEGER"), ("FiscalYearStart", "DATE")
        };

        public static SemanticModel Build(ModelDefinition def, Manifest manifest)
        {
            var m = new SemanticModel { Definition = def };
            foreach (var t in def.Tables)
            {
                string key = t.Module + "." + t.Name;
                var st = new SemTable { Key = key, Module = t.Module, Name = t.Name, SqlName = Names.Q(t.Module) + "." + Names.Q(t.Name), KeyColumns = t.Key?.ToList() ?? new() };
                TableState ts = null;
                if (manifest != null && manifest.Modules.TryGetValue(t.Module, out var me)) me.Tables.TryGetValue(t.Name, out ts);
                if (ts == null) continue;            // not loaded yet: not queryable
                foreach (var c in ts.Columns) st.Columns.Add(new SemColumn { Table = st, Name = c.Name, Type = c.Type });
                m.Tables[key] = st;
            }
            if (def.Calendar?.Enabled != false)
            {
                var cal = new SemTable { Key = CalendarKey, Name = CalendarKey, SqlName = "\"memory\".\"main\".\"calendar\"", IsCalendar = true, KeyColumns = { "Date" } };
                foreach (var (n, ty) in CalendarColumns) cal.Columns.Add(new SemColumn { Table = cal, Name = n, Type = ty });
                m.Tables[CalendarKey] = cal;
                m.Calendar = cal;
            }
            foreach (var r in def.Relationships ?? new())
            {
                if (!m.Tables.TryGetValue(r.FromTable ?? "", out var ft) || !m.Tables.TryGetValue(r.ToTable ?? "", out var tt)) continue;
                var fc = ft.Columns.FirstOrDefault(c => string.Equals(c.Name, r.FromColumn, StringComparison.OrdinalIgnoreCase));
                var tc = tt.Columns.FirstOrDefault(c => string.Equals(c.Name, r.ToColumn, StringComparison.OrdinalIgnoreCase));
                if (fc == null || tc == null) continue;
                m.Relationships.Add(new SemRel { From = fc, To = tc, Active = r.Active, Both = string.Equals(r.CrossFilter, "both", StringComparison.OrdinalIgnoreCase) });
            }
            foreach (var ms in def.Measures ?? new()) if (!string.IsNullOrWhiteSpace(ms.Name)) m.Measures[ms.Name] = ms;
            return m;
        }

        /// <summary>SQL that creates the calendar in the query session's in-memory database.</summary>
        public static string CalendarSql(CalendarDef c, int thisYear)
        {
            int start = c?.StartYear > 0 ? c.StartYear : thisYear - 5, end = c?.EndYear > 0 ? c.EndYear : thisYear + 1;
            int fs = Math.Clamp(c?.FiscalYearStartMonth ?? 1, 1, 12);
            string fy = fs == 1 ? "year(d)" : "year(d) + CASE WHEN month(d) >= " + fs + " THEN 1 ELSE 0 END";
            string fm = "((month(d) - " + fs + " + 12) % 12) + 1";
            return "CREATE OR REPLACE TABLE \"memory\".\"main\".\"calendar\" AS SELECT CAST(d AS DATE) AS \"Date\", year(d) AS \"Year\", quarter(d) AS \"Quarter\", " +
                   "'Q' || quarter(d) AS \"QuarterName\", month(d) AS \"Month\", strftime(d, '%b') AS \"MonthName\", strftime(d, '%Y-%m') AS \"YearMonth\", " +
                   "CAST(date_trunc('month', d) AS DATE) AS \"MonthStart\", day(d) AS \"Day\", isodow(d) AS \"Weekday\", strftime(d, '%a') AS \"WeekdayName\", " +
                   "isodow(d) >= 6 AS \"IsWeekend\", " + fy + " AS \"FiscalYear\", ((" + fm + " - 1) // 3) + 1 AS \"FiscalQuarter\", " + fm + " AS \"FiscalMonth\", " +
                   "CAST(make_date(CAST(" + fy + (fs == 1 ? "" : " - 1") + " AS INTEGER), " + fs + ", 1) AS DATE) AS \"FiscalYearStart\" " +
                   "FROM range(DATE '" + start.ToString("0000", CultureInfo.InvariantCulture) + "-01-01', DATE '" + (end + 1).ToString("0000", CultureInfo.InvariantCulture) + "-01-01', INTERVAL 1 DAY) AS t(d)";
        }

        public SemTable ResolveTable(string name, int pos = -1)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new MeasureException("Missing table name", pos);
            if (Tables.TryGetValue(name, out var t)) return t;
            var hits = Tables.Values.Where(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)).ToList();
            if (hits.Count == 1) return hits[0];
            if (string.Equals(name, "Date", StringComparison.OrdinalIgnoreCase) && Calendar != null) return Calendar;
            if (hits.Count > 1) throw new MeasureException("Table '" + name + "' is in several modules - write it as 'module.table' (" + string.Join(", ", hits.Select(h => h.Key)) + ")", pos);
            throw new MeasureException("Unknown table '" + name + "' (not in the model or not loaded yet)", pos);
        }

        public SemColumn ResolveColumn(string table, string column, int pos = -1)
        {
            var t = ResolveTable(table, pos);
            return t.Columns.FirstOrDefault(c => string.Equals(c.Name, column, StringComparison.OrdinalIgnoreCase))
                   ?? throw new MeasureException("Table '" + t.Key + "' has no column [" + column + "]", pos);
        }

        /// <summary>"Table[Column]" as the API and the page write it.</summary>
        public SemColumn ParseColumnRef(string text)
        {
            var node = Parser.Parse(text) as ColumnNode ?? throw new MeasureException("Expected Table[Column], got '" + text + "'");
            return ResolveColumn(node.Table, node.Column, node.Pos);
        }

        /// <summary>Filters of the roles the user belongs to (none = no restriction).</summary>
        public List<(SemColumn Column, List<string> Values)> RoleFilters(string user)
        {
            var roles = Definition.Roles ?? new();
            var mine = roles.Where(r => r.Members.Any(m => string.Equals(m, user, StringComparison.OrdinalIgnoreCase))).ToList();
            if (mine.Count == 0) mine = roles.Where(r => r.Members.Contains("*")).ToList();
            var list = new List<(SemColumn, List<string>)>();
            foreach (var r in mine)
                foreach (var f in r.Filters)
                {
                    if (!Tables.TryGetValue(f.Table ?? "", out var t)) continue;
                    var c = t.Columns.FirstOrDefault(x => string.Equals(x.Name, f.Column, StringComparison.OrdinalIgnoreCase));
                    if (c != null) list.Add((c, f.Values ?? new()));
                }
            return list;
        }
    }
}

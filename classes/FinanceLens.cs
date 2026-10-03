using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens (finance/index.html): journal balances in one DuckDB file, read by the page with read-only SQL.
    /// Tables: fin_meta, fin_segments, fin_companies, fin_cost_centres, fin_accounts, fin_periods,
    /// fin_balances (scenario ACTUAL / BUDGET × company × cost centre × account × period: begin, dr, cr, net, end —
    /// income statement accounts start each fiscal year at 0 and their result rolls into retained earnings, like Fusion GL)
    /// and fin_journals (journal lines for drill-down and journal analytics).
    /// The file is rebuilt into finance.new.duckdb and swapped in, so readers never see half a load.
    /// Statement templates, KPIs and monitors are JSON documents next to it (templates.json, config.json).
    /// Folder: %APPDATA%\GraysWMS\Finance\settings.json "root", default C:\fusion\finance.
    /// </summary>
    public static class FinanceLens
    {
        private static readonly object _lock = new object();
        private static DuckDBConnection _session;
        private static DateTime _sessionStamp;

        public static string Root
        {
            get
            {
                string env = Environment.GetEnvironmentVariable("FINANCE_LENS_ROOT");
                if (!string.IsNullOrWhiteSpace(env)) return env;
                try
                {
                    string s = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "Finance", "settings.json");
                    if (File.Exists(s))
                    {
                        using var d = JsonDocument.Parse(File.ReadAllText(s));
                        if (d.RootElement.TryGetProperty("root", out var r) && !string.IsNullOrWhiteSpace(r.GetString())) return r.GetString();
                    }
                }
                catch { }
                return @"C:\fusion\finance";
            }
        }
        public static string DbPath => Path.Combine(Root, "finance.duckdb");

        public static void SetRoot(string root)
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "Finance");
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "settings.json"), JsonSerializer.Serialize(new { root }));
            ResetSession();
        }

        // ── read side ──
        public sealed class QueryResult { public List<string> Columns = new(); public List<object[]> Rows = new(); public bool Truncated; public long Ms; public string Error; }

        private static DuckDBConnection Session()
        {
            var stamp = File.GetLastWriteTimeUtc(DbPath);
            if (_session != null && stamp == _sessionStamp) return _session;
            ResetSession();
            var conn = new DuckDBConnection("Data Source=:memory:");
            conn.Open();
            Exec(conn, "ATTACH " + Lit(DbPath) + " AS fin (READ_ONLY)");
            Exec(conn, "USE fin");
            // the page sends SQL: it may not read other files, load extensions or change settings
            Exec(conn, "SET enable_external_access = false");
            Exec(conn, "SET lock_configuration = true");
            _session = conn; _sessionStamp = stamp;
            return conn;
        }

        public static void ResetSession()
        {
            lock (_lock) { try { _session?.Dispose(); } catch { } _session = null; }
        }

        public static QueryResult Query(string sql, int maxRows)
        {
            var res = new QueryResult();
            var sw = Stopwatch.StartNew();
            string why = FusionModel.SqlGuard.Check(sql);
            if (why != null) { res.Error = why; return res; }
            if (!File.Exists(DbPath)) { res.Error = "No finance data yet - load the sample data or Fusion journal balances first."; return res; }
            maxRows = Math.Clamp(maxRows <= 0 ? 50000 : maxRows, 1, 500000);
            try
            {
                lock (_lock)
                {
                    using var cmd = Session().CreateCommand();
                    cmd.CommandText = sql.Trim().TrimEnd(';');
                    using var r = cmd.ExecuteReader();
                    for (int i = 0; i < r.FieldCount; i++) res.Columns.Add(r.GetName(i));
                    while (r.Read())
                    {
                        if (res.Rows.Count >= maxRows) { res.Truncated = true; break; }
                        var row = new object[r.FieldCount];
                        for (int i = 0; i < r.FieldCount; i++) row[i] = r.IsDBNull(i) ? null : FusionModel.ModelEngine.ToPlain(r.GetValue(i));
                        res.Rows.Add(row);
                    }
                }
            }
            catch (Exception ex) { res.Error = ex.Message; }
            res.Ms = sw.ElapsedMilliseconds;
            return res;
        }

        public static object Status()
        {
            if (!File.Exists(DbPath)) return new { ok = true, loaded = false, root = Root };
            var meta = Query("SELECT key, value FROM fin_meta", 100);
            var counts = Query("SELECT (SELECT COUNT(*) FROM fin_balances) AS balances, (SELECT COUNT(*) FROM fin_journals) AS journals, " +
                               "(SELECT COUNT(*) FROM fin_accounts) AS accounts, (SELECT COUNT(*) FROM fin_companies) AS companies, " +
                               "(SELECT COUNT(*) FROM fin_cost_centres) AS cost_centres, (SELECT MIN(period_name) FILTER (WHERE period_seq = (SELECT MIN(period_seq) FROM fin_periods)) FROM fin_periods) AS first_period, " +
                               "(SELECT MAX(period_name) FILTER (WHERE period_seq = (SELECT MAX(period_seq) FROM fin_periods)) FROM fin_periods) AS last_period", 1);
            var m = new Dictionary<string, object>();
            foreach (var r in meta.Rows) m[Convert.ToString(r[0])] = r[1];
            var c = new Dictionary<string, object>();
            if (counts.Error == null && counts.Rows.Count > 0) for (int i = 0; i < counts.Columns.Count; i++) c[counts.Columns[i]] = counts.Rows[0][i];
            bool led = HasLedgers();
            if (led) { var lc = Query("SELECT COUNT(*) FROM fin_ledgers", 1); if (lc.Error == null && lc.Rows.Count > 0) c["ledgers"] = lc.Rows[0][0]; }
            return new { ok = true, loaded = true, root = Root, meta = m, counts = c, hasLedgers = led, sizeMb = Math.Round(new FileInfo(DbPath).Length / 1048576.0, 2), error = meta.Error ?? counts.Error };
        }

        // ── documents (templates, KPIs, monitors, settings) ──
        private static readonly string[] DOCS = { "templates", "config", "notes" };
        public static string ReadDoc(string name)
        {
            if (!DOCS.Contains(name)) throw new ArgumentException("unknown document " + name);
            string f = Path.Combine(Root, name + ".json");
            return File.Exists(f) ? File.ReadAllText(f) : null;
        }
        public static void SaveDoc(string name, string json)
        {
            if (!DOCS.Contains(name)) throw new ArgumentException("unknown document " + name);
            using (JsonDocument.Parse(json)) { }          // must be JSON
            if (json.Length > 5_000_000) throw new ArgumentException("document too large");
            Directory.CreateDirectory(Root);
            string f = Path.Combine(Root, name + ".json");
            if (File.Exists(f)) File.Copy(f, f + ".bak", true);
            File.WriteAllText(f + ".tmp", json, new UTF8Encoding(false));
            File.Move(f + ".tmp", f, true);
        }

        // ── write side ──
        internal const string SCHEMA = @"
CREATE TABLE fin_meta (key VARCHAR, value VARCHAR);
CREATE TABLE fin_ledgers (code VARCHAR, name VARCHAR, currency VARCHAR, coa_id VARCHAR, company_segment VARCHAR, cost_centre_segment VARCHAR, account_segment VARCHAR, category VARCHAR);
CREATE TABLE fin_segments (seg_no INTEGER, role VARCHAR, label VARCHAR, column_name VARCHAR);
CREATE TABLE fin_coa_segments (pod VARCHAR, coa_id VARCHAR, column_name VARCHAR, segment_name VARCHAR, segment_num INTEGER, value_set_id VARCHAR, qualifiers VARCHAR,
    distinct_values BIGINT, purity DOUBLE, role VARCHAR, evidence VARCHAR, discovered_at VARCHAR);
CREATE TABLE fin_fusion_discovery (pod VARCHAR, discovered_at VARCHAR, discovered_by VARCHAR, json VARCHAR);
CREATE TABLE fin_companies (code VARCHAR, name VARCHAR, currency VARCHAR);
CREATE TABLE fin_cost_centres (code VARCHAR, name VARCHAR, parent VARCHAR);
CREATE TABLE fin_accounts (code VARCHAR, name VARCHAR, account_type VARCHAR, class VARCHAR, parent VARCHAR);
CREATE TABLE fin_periods (period_name VARCHAR, period_seq INTEGER, fiscal_year INTEGER, period_num INTEGER, quarter INTEGER, start_date DATE, end_date DATE);
CREATE TABLE fin_balances (scenario VARCHAR, company VARCHAR, cost_centre VARCHAR, account VARCHAR, period_name VARCHAR, period_seq INTEGER,
    begin_bal DOUBLE, period_dr DOUBLE, period_cr DOUBLE, period_net DOUBLE, end_bal DOUBLE, ledger VARCHAR);
CREATE TABLE fin_journals (je_id BIGINT, je_line INTEGER, batch_name VARCHAR, je_name VARCHAR, je_source VARCHAR, je_category VARCHAR,
    period_name VARCHAR, period_seq INTEGER, accounting_date DATE, posted_at TIMESTAMP, created_by VARCHAR,
    company VARCHAR, cost_centre VARCHAR, account VARCHAR, dr DOUBLE, cr DOUBLE, description VARCHAR, ledger VARCHAR);";

        /// <summary>Builds the sample: 2 companies, 6 cost centres, ~50 accounts, actuals + budget for <paramref name="months"/> months
        /// from <paramref name="startYear"/>-01, with the journals behind every actual balance.</summary>
        public static object LoadSample(int startYear = 2025, int months = 24, int seed = 7)
        {
            var sw = Stopwatch.StartNew();
            var g = new SampleGenerator(startYear, Math.Clamp(months, 12, 60), seed);
            g.Run();
            Directory.CreateDirectory(Root);
            string tmp = Path.Combine(Root, "finance.new.duckdb");
            foreach (var f in new[] { tmp, tmp + ".wal" }) if (File.Exists(f)) File.Delete(f);
            using (var conn = new DuckDBConnection("Data Source=" + tmp))
            {
                conn.Open();
                foreach (var stmt in SCHEMA.Split(';').Select(s => s.Trim()).Where(s => s.Length > 0)) Exec(conn, stmt);
                Append(conn, "fin_meta", new List<object[]> {
                    new object[] { "source", "SAMPLE" }, new object[] { "loaded_at", DateTime.Now.ToString("s") }, new object[] { "currency", "MUR" },
                    new object[] { "description", "Sample journal balances: Grays Mauritius Ltd + Grays Distribution Ltd" } });
                Append(conn, "fin_ledgers", new List<object[]> { new object[] { "SAMPLE", "Sample ledger (MUR)", "MUR", "1", "company", "cost_centre", "account", "PRIMARY" } });
                Append(conn, "fin_segments", new List<object[]> {
                    new object[] { 1, "COMPANY", "Company", "company" }, new object[] { 2, "COST_CENTRE", "Cost centre", "cost_centre" }, new object[] { 3, "ACCOUNT", "Account", "account" } });
                Append(conn, "fin_companies", SampleGenerator.Companies.Select(c => new object[] { c.Code, c.Name, "MUR" }).ToList());
                Append(conn, "fin_cost_centres", SampleGenerator.CostCentres.Select(c => new object[] { c.Code, c.Name, c.Code == "000" ? null : "ALL" }).ToList());
                Append(conn, "fin_accounts", SampleGenerator.Accounts.Select(a => new object[] { a.Code, a.Name, a.Type, a.Class, a.Parent }).ToList());
                Append(conn, "fin_periods", g.Periods.Select(p => new object[] { p.Name, p.Seq, p.Year, p.Num, (p.Num - 1) / 3 + 1, DateOnly.FromDateTime(p.Start), DateOnly.FromDateTime(p.End) }).ToList());
                Append(conn, "fin_balances", g.Balances.Select(r => r.Append("SAMPLE").ToArray()).ToList());
                Append(conn, "fin_journals", g.Journals.Select(r => r.Append("SAMPLE").ToArray()).ToList());
                Exec(conn, "CHECKPOINT");
            }
            SwapIn(tmp);
            return new { ok = true, balances = g.Balances.Count, journals = g.Journals.Count, periods = g.Periods.Count, ms = sw.ElapsedMilliseconds };
        }

        private static void ResetSessionNoLock() { try { _session?.Dispose(); } catch { } _session = null; }

        /// <summary>Replaces finance.duckdb with a file built next to it (readers never see half a load).</summary>
        internal static void SwapIn(string tmp)
        {
            lock (_lock)
            {
                ResetSessionNoLock();
                File.Move(tmp, DbPath, true);
                if (File.Exists(tmp + ".wal")) File.Delete(tmp + ".wal");
            }
        }

        /// <summary>Copies the current file for an incremental load (under the lock so no reader holds it half-way).</summary>
        internal static bool CopyCurrent(string to)
        {
            lock (_lock)
            {
                if (!File.Exists(DbPath)) return false;
                ResetSessionNoLock();
                File.Copy(DbPath, to, true);
                return true;
            }
        }

        /// <summary>Writes account classes (the page classifies Fusion accounts by type and name; the user's mapping wins).</summary>
        public static int SetClasses(Dictionary<string, string> classes)
        {
            if (classes == null || classes.Count == 0 || !File.Exists(DbPath)) return 0;
            if (classes.Count > 200000) throw new ArgumentException("too many accounts");
            lock (_lock)
            {
                ResetSessionNoLock();
                using var conn = new DuckDBConnection("Data Source=" + DbPath);
                conn.Open();
                Exec(conn, "CREATE TEMP TABLE cls (code VARCHAR, class VARCHAR)");
                Append(conn, "cls", classes.Where(kv => kv.Key != null).Select(kv => new object[] { kv.Key, string.IsNullOrWhiteSpace(kv.Value) ? null : kv.Value.Trim() }).ToList());
                Exec(conn, "UPDATE fin_accounts SET class = cls.class FROM cls WHERE fin_accounts.code = cls.code");
                Exec(conn, "CHECKPOINT");
            }
            return classes.Count;
        }

        /// <summary>Saves a Fusion discovery (ledgers, COA segments and roles) into the current finance file, when there is one;
        /// otherwise the first load writes it. Returns false when there is no file yet.</summary>
        public static bool SaveDiscovery(string pod, string json, string user, Dictionary<string, Dictionary<string, string>> roles = null)
        {
            if (!File.Exists(DbPath)) return false;
            lock (_lock)
            {
                ResetSessionNoLock();
                using var conn = new DuckDBConnection("Data Source=" + DbPath);
                conn.Open();
                FinanceFusion.WriteDiscovery(conn, pod, json, user, roles);
                Exec(conn, "CHECKPOINT");
            }
            return true;
        }

        /// <summary>The saved discovery of a pod ("" = logged-in pod) from the finance file: (json, discovered_at, by) or null.</summary>
        public static (string Json, string At, string By)? LoadDiscovery(string pod)
        {
            if (!File.Exists(DbPath)) return null;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_fusion_discovery'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return null;
            var r = Query("SELECT json, discovered_at, discovered_by FROM fin_fusion_discovery WHERE pod = " + Lit(pod ?? "") + " ORDER BY discovered_at DESC LIMIT 1", 1);
            if (r.Error != null || r.Rows.Count == 0) return null;
            return (Convert.ToString(r.Rows[0][0]), Convert.ToString(r.Rows[0][1]), Convert.ToString(r.Rows[0][2]));
        }

        /// <summary>True when the file has the ledger dimension (files built before it are rebuilt by the next load).</summary>
        public static bool HasLedgers()
        {
            var r = Query("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'fin_balances' AND column_name = 'ledger'", 1);
            return r.Error == null && r.Rows.Count > 0 && Convert.ToInt64(r.Rows[0][0]) > 0;
        }

        internal static void Append(DuckDBConnection conn, string table, List<object[]> rows)
        {
            using var app = conn.CreateAppender(table);
            foreach (var r in rows)
            {
                var row = app.CreateRow();
                foreach (var v in r)
                {
                    switch (v)
                    {
                        case null: row.AppendNullValue(); break;
                        case string s: row.AppendValue(s); break;
                        case int i: row.AppendValue(i); break;
                        case long l: row.AppendValue(l); break;
                        case double d: row.AppendValue(d); break;
                        case DateOnly dt: row.AppendValue(dt); break;
                        case DateTime ts: row.AppendValue(ts); break;
                        default: row.AppendValue(Convert.ToString(v, CultureInfo.InvariantCulture)); break;
                    }
                }
                row.EndRow();
            }
        }

        internal static void Exec(DuckDBConnection conn, string sql)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }
        internal static string Lit(string s) => "'" + (s ?? "").Replace("'", "''") + "'";

        // ═════════════ the sample: two Mauritian distributors, balanced journals behind every number ═════════════
        private sealed class SampleGenerator
        {
            public sealed record Co(string Code, string Name, double Scale);
            public sealed record Cc(string Code, string Name);
            public sealed record Acct(string Code, string Name, string Type, string Class, string Parent);
            public sealed class Period { public string Name; public int Seq, Year, Num; public DateTime Start, End; }

            public static readonly Co[] Companies = { new("01", "Grays Mauritius Ltd", 1.0), new("02", "Grays Distribution Ltd", 0.55) };
            public static readonly Cc[] CostCentres = { new("000", "Balance sheet"), new("100", "Administration"), new("200", "Sales & Marketing"), new("300", "Warehouse"), new("400", "Logistics"), new("500", "Finance") };
            public static readonly Acct[] Accounts =
            {
                new("1000", "Cash at bank", "A", "Cash", "CA"), new("1010", "Petty cash", "A", "Cash", "CA"),
                new("1100", "Trade receivables", "A", "Receivables", "CA"), new("1150", "Allowance for doubtful debts", "A", "Receivables", "CA"),
                new("1200", "Inventory - finished goods", "A", "Inventory", "CA"), new("1210", "Inventory - packaging", "A", "Inventory", "CA"),
                new("1300", "Prepayments", "A", "Other current assets", "CA"), new("1400", "VAT receivable", "A", "Other current assets", "CA"),
                new("1500", "Intercompany receivable", "A", "Intercompany", "CA"),
                new("1600", "Property, plant & equipment - cost", "A", "Fixed assets", "NCA"), new("1650", "Accumulated depreciation", "A", "Fixed assets", "NCA"),
                new("1700", "Right-of-use assets", "A", "Fixed assets", "NCA"), new("1800", "Intangible assets", "A", "Intangibles", "NCA"),
                new("2000", "Trade payables", "L", "Payables", "CL"), new("2100", "Accrued expenses", "L", "Accruals", "CL"),
                new("2200", "VAT payable", "L", "Tax liabilities", "CL"), new("2300", "Payroll liabilities", "L", "Accruals", "CL"),
                new("2400", "Income tax payable", "L", "Tax liabilities", "CL"), new("2500", "Intercompany payable", "L", "Intercompany", "CL"),
                new("2600", "Short-term borrowings", "L", "Borrowings", "CL"), new("2700", "Long-term loans", "L", "Borrowings", "NCL"),
                new("2800", "Lease liabilities", "L", "Leases", "NCL"),
                new("3000", "Share capital", "O", "Equity", "EQ"), new("3100", "Retained earnings", "O", "Equity", "EQ"),
                new("4000", "Sales - Beverages", "R", "Revenue", "REV"), new("4010", "Sales - Snacks", "R", "Revenue", "REV"),
                new("4020", "Sales - Household", "R", "Revenue", "REV"), new("4100", "Sales returns & discounts", "R", "Revenue", "REV"),
                new("4200", "Other income", "R", "Other income", "OI"),
                new("5000", "Cost of goods sold", "E", "Cost of sales", "COGS"), new("5100", "Freight inwards", "E", "Cost of sales", "COGS"),
                new("5200", "Inventory write-offs", "E", "Cost of sales", "COGS"),
                new("6000", "Salaries & wages", "E", "Staff costs", "OPEX"), new("6010", "Staff benefits", "E", "Staff costs", "OPEX"),
                new("6100", "Rent", "E", "Premises", "OPEX"), new("6110", "Utilities", "E", "Premises", "OPEX"),
                new("6200", "Freight outwards & delivery", "E", "Distribution", "OPEX"), new("6210", "Vehicle running costs", "E", "Distribution", "OPEX"),
                new("6300", "Marketing & promotions", "E", "Selling", "OPEX"), new("6400", "IT & software", "E", "Administration", "OPEX"),
                new("6500", "Professional & management fees", "E", "Administration", "OPEX"), new("6600", "Repairs & maintenance", "E", "Premises", "OPEX"),
                new("6700", "Insurance", "E", "Administration", "OPEX"), new("6800", "Bad debt expense", "E", "Selling", "OPEX"),
                new("6900", "Depreciation", "E", "Depreciation & amortisation", "DA"), new("6950", "Amortisation", "E", "Depreciation & amortisation", "DA"),
                new("7000", "Interest expense", "E", "Finance costs", "FIN"), new("7100", "Bank charges", "E", "Finance costs", "FIN"),
                new("7200", "Foreign exchange (gain) / loss", "E", "Finance costs", "FIN"),
                new("8000", "Income tax expense", "E", "Tax", "TAX"),
                new("9999", "Suspense", "A", "Suspense", "SUSP")
            };
            private static readonly double[] SEASON = { 0.92, 0.88, 0.97, 1.00, 1.02, 0.98, 1.03, 1.05, 1.00, 1.04, 1.10, 1.25 };
            private static readonly string[] CLERKS = { "a.ramsamy", "s.chen", "p.lagesse", "m.dupont" };

            public readonly List<Period> Periods = new();
            public readonly List<object[]> Balances = new();
            public readonly List<object[]> Journals = new();
            private readonly int _startYear, _months;
            private readonly Random _r;
            private int _je;
            // running actual balances (company|cc|account → amount, debit positive)
            private readonly Dictionary<string, double> _bal = new();
            private readonly Dictionary<string, double> _net = new();   // this period
            private readonly Dictionary<string, double> _dr = new(), _cr = new();

            public SampleGenerator(int startYear, int months, int seed) { _startYear = startYear; _months = months; _r = new Random(seed); }

            private double N() { double u1 = 1 - _r.NextDouble(), u2 = _r.NextDouble(); return Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2); }
            private double Noise(double sd) => 1 + sd * N();
            private static double R2(double v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
            private double Bal(string co, string cc, string a) => _bal.TryGetValue(co + "|" + cc + "|" + a, out var v) ? v : 0;

            private sealed class Je { public string Source, Category, Name, By; public DateTime Date, Posted; public List<(string Cc, string Acct, double Dr, double Cr, string Desc)> Lines = new(); }

            private void Post(Period p, string co, Je j)
            {
                double dr = j.Lines.Sum(l => l.Dr), cr = j.Lines.Sum(l => l.Cr);
                if (Math.Abs(dr - cr) > 0.005) throw new InvalidOperationException("unbalanced journal " + j.Name + " " + dr + " vs " + cr);
                _je++;
                int ln = 0;
                foreach (var l in j.Lines)
                {
                    if (l.Dr == 0 && l.Cr == 0) continue;
                    string k = co + "|" + l.Cc + "|" + l.Acct;
                    _bal[k] = (_bal.TryGetValue(k, out var b) ? b : 0) + l.Dr - l.Cr;
                    _net[k] = (_net.TryGetValue(k, out var n) ? n : 0) + l.Dr - l.Cr;
                    _dr[k] = (_dr.TryGetValue(k, out var d) ? d : 0) + l.Dr;
                    _cr[k] = (_cr.TryGetValue(k, out var c) ? c : 0) + l.Cr;
                    Journals.Add(new object[] { (long)_je, ++ln, j.Source + " " + p.Name, j.Name, j.Source, j.Category, p.Name, p.Seq, DateOnly.FromDateTime(j.Date), j.Posted, j.By,
                                                co, l.Cc, l.Acct, R2(l.Dr), R2(l.Cr), l.Desc });
                }
            }

            private DateTime WorkDay(Period p, int day)
            {
                var d = new DateTime(p.Year, p.Num, Math.Clamp(day, 1, DateTime.DaysInMonth(p.Year, p.Num)));
                int step = d.Day > 25 ? -1 : 1;                                       // late in the month: the Friday before, else the Monday after
                while (d.DayOfWeek == DayOfWeek.Saturday || d.DayOfWeek == DayOfWeek.Sunday) d = d.AddDays(step);
                return d;
            }
            private DateTime PostedAt(DateTime d) => d.AddHours(8 + _r.Next(0, 10)).AddMinutes(_r.Next(60));

            /// <summary>One journal of two or more lines (dr lines, cr lines).</summary>
            private Je J(string source, string cat, string name, DateTime date, string by = "SYSTEM") =>
                new Je { Source = source, Category = cat, Name = name, Date = date, Posted = PostedAt(date), By = by };

            /// <summary>The income statement of one company for one month: account|cc → amount (debit positive).
            /// actual = with noise and the planted surprises; plan = the smooth budget (revenue ambition +4 %).</summary>
            private Dictionary<string, double> Pl(Co co, int m, bool actual)
            {
                int month = (m % 12) + 1, yearIx = m / 12;
                double grow = 1 + 0.08 * m / 12.0, s = SEASON[month - 1] * co.Scale;
                double nz(double sd) => actual ? Noise(sd) : 1;
                var pl = new Dictionary<string, double>();
                void add(string a, string cc, double v) { string k = a + "|" + cc; pl[k] = (pl.TryGetValue(k, out var x) ? x : 0) + v; }
                double budUp = actual ? 1 : 1.04;
                double bev = 14_000_000 * grow * s * nz(0.05) * budUp, sna = 7_500_000 * grow * s * nz(0.07) * budUp, hh = 5_500_000 * grow * s * nz(0.06) * budUp;
                if (actual && m >= 18) hh *= 0.86;                                    // household slows in the 2nd half of year 2 (a real variance)
                add("4000", "200", -bev); add("4010", "200", -sna); add("4020", "200", -hh);
                double sales = bev + sna + hh;
                add("4100", "200", sales * 0.025 * nz(0.15));
                double cogsPct(double basePct) => basePct + (actual ? 0.01 * N() : 0) + (actual && m >= 12 ? 0.012 : 0);   // costs creep up in year 2
                add("5000", "300", bev * cogsPct(0.58) + sna * cogsPct(0.52) + hh * cogsPct(0.60));
                add("5100", "400", sales * 0.018 * nz(0.1));
                if (actual && _r.NextDouble() < 0.25) add("5200", "300", 60_000 * co.Scale * (1 + _r.NextDouble() * 2));
                double raise = Math.Pow(1.03, yearIx), bonus = month == 12 ? 2.0 : 1.0;
                foreach (var (cc, sal) in new[] { ("100", 300_000.0), ("200", 450_000.0), ("300", 600_000.0), ("400", 400_000.0), ("500", 250_000.0) })
                {
                    double v = sal * co.Scale * raise * bonus * nz(0.02);
                    add("6000", cc, v); add("6010", cc, v * 0.12);
                }
                add("6100", "300", 450_000 * co.Scale * raise); add("6100", "100", 180_000 * co.Scale * raise);
                add("6110", "300", 250_000 * co.Scale * nz(0.08)); add("6110", "100", 80_000 * co.Scale * nz(0.08));
                double freightOut = sales * 0.035 * nz(0.08);
                if (actual && m == 19) freightOut *= 1.6;                             // freight spike (Aug of year 2)
                add("6200", "400", freightOut);
                add("6210", "400", 450_000 * co.Scale * grow * nz(0.1));
                add("6300", "200", sales * (month == 12 ? 0.04 : 0.025) * nz(0.12));
                add("6400", "100", 300_000 * co.Scale * nz(0.05));
                add("6500", "500", 150_000 * co.Scale * nz(0.1) + (actual && m == 14 ? 2_400_000 * co.Scale : 0));   // one-off advisory fee (Mar of year 2)
                add("6600", "300", (actual ? 100_000 + _r.NextDouble() * 200_000 : 200_000) * co.Scale);
                add("6700", "100", 200_000 * co.Scale);
                add("6800", "200", sales * 0.003 + (actual && m == 10 ? 1_800_000 * co.Scale : 0));                  // big customer write-off (Nov of year 1)
                add("6900", "300", 700_000 * co.Scale); add("6900", "400", 300_000 * co.Scale); add("6900", "100", 300_000 * co.Scale);
                add("6950", "100", 100_000 * co.Scale);
                add("7000", "500", 280_000 * co.Scale * (m >= 17 ? 1.35 : 1));
                add("7100", "500", 50_000 * co.Scale * nz(0.1));
                if (actual) add("7200", "500", 60_000 * co.Scale * N());
                if (co.Code == "01") add("4200", "500", -600_000);                    // management fee charged to company 02
                else add("6500", "500", 600_000);
                double pbt = pl.Values.Sum();                                         // debit positive: a profit is negative
                add("8000", "500", pbt < 0 ? -pbt * 0.15 : 0);
                return pl;
            }

            public void Run()
            {
                for (int m = 0; m < _months; m++)
                {
                    int y = _startYear + m / 12, n = m % 12 + 1;
                    var st = new DateTime(y, n, 1);
                    Periods.Add(new Period { Name = st.ToString("MMM-yy", CultureInfo.InvariantCulture), Seq = y * 100 + n, Year = y, Num = n, Start = st, End = st.AddMonths(1).AddDays(-1) });
                }
                // opening balances (the day before the first period) — company 02 is 55 % of company 01
                foreach (var co in Companies)
                {
                    double k = co.Scale;
                    var open = new (string A, double V)[] { ("1000", 25e6), ("1010", 0.2e6), ("1100", 45e6), ("1150", -1.5e6), ("1200", 22e6), ("1210", 3e6), ("1400", 1.5e6),
                        ("1600", 120e6), ("1650", -45e6), ("1700", 18e6), ("1800", 4e6),
                        ("2000", -32e6), ("2100", -2e6), ("2200", -2.8e6), ("2400", -1.5e6), ("2700", -40e6), ("2800", -18e6), ("3000", -50e6) };
                    double sum = 0;
                    foreach (var (a, v) in open) { _bal[co.Code + "|000|" + a] = v * k; sum += v * k; }
                    _bal[co.Code + "|000|3100"] = -sum;                                   // retained earnings balance the opening position
                }
                // the budget (income statement only) is planned without noise
                var budget = Companies.ToDictionary(c => c.Code, c => Enumerable.Range(0, _months).Select(m => Pl(c, m, false)).ToList());
                var budBal = new Dictionary<string, double>();

                for (int m = 0; m < _months; m++)
                {
                    var p = Periods[m];
                    // a new fiscal year: income statement balances close into retained earnings (as Fusion does)
                    if (m > 0 && p.Num == 1)
                    {
                        foreach (var co in Companies)
                        {
                            double res = 0;
                            foreach (var key in _bal.Keys.Where(k => k.StartsWith(co.Code + "|") && IsPl(k.Split('|')[2])).ToList()) { res += _bal[key]; _bal[key] = 0; }
                            _bal[co.Code + "|000|3100"] = Bal(co.Code, "000", "3100") + res;
                            foreach (var key in budBal.Keys.Where(k => k.StartsWith(co.Code + "|")).ToList()) budBal[key] = 0;
                        }
                    }
                    var begin = new Dictionary<string, double>(_bal);
                    _net.Clear(); _dr.Clear(); _cr.Clear();
                    foreach (var co in Companies) Month(co, m, p);
                    // actual balances of every combination that has a balance or moved
                    foreach (var key in begin.Keys.Union(_bal.Keys).OrderBy(k => k))
                    {
                        double b = begin.TryGetValue(key, out var bv) ? bv : 0, e = Bal3(key);
                        double dr = _dr.TryGetValue(key, out var d) ? d : 0, cr = _cr.TryGetValue(key, out var c) ? c : 0;
                        if (Math.Abs(b) < 0.005 && Math.Abs(e) < 0.005 && dr == 0 && cr == 0) continue;
                        var parts = key.Split('|');
                        Balances.Add(new object[] { "ACTUAL", parts[0], parts[1], parts[2], p.Name, p.Seq, R2(b), R2(dr), R2(cr), R2(dr - cr), R2(e) });
                    }
                    // budget balances
                    foreach (var co in Companies)
                        foreach (var kv in budget[co.Code][m])
                        {
                            var ac = kv.Key.Split('|');
                            string bk = co.Code + "|" + ac[1] + "|" + ac[0];
                            double b = budBal.TryGetValue(bk, out var bb) ? bb : 0, v = R2(kv.Value);
                            budBal[bk] = b + v;
                            Balances.Add(new object[] { "BUDGET", co.Code, ac[1], ac[0], p.Name, p.Seq, R2(b), v > 0 ? v : 0.0, v < 0 ? -v : 0.0, v, R2(b + v) });
                        }
                }
            }

            private double Bal3(string key) => _bal.TryGetValue(key, out var v) ? v : 0;
            private static bool IsPl(string acct) => acct[0] >= '4' && acct[0] <= '8';

            private void Month(Co co, int m, Period p)
            {
                string c = co.Code;
                var pl = Pl(co, m, true);
                double get(string a, string cc) => pl.TryGetValue(a + "|" + cc, out var v) ? v : 0;
                double sumAcct(string a) => pl.Where(kv => kv.Key.StartsWith(a + "|")).Sum(kv => kv.Value);

                // ── sales invoices (Receivables): many invoices per revenue line, amounts spread like real invoices ──
                foreach (var a in new[] { "4000", "4010", "4020" })
                {
                    double total = -get(a, "200");
                    int nInv = 12 + _r.Next(8);
                    var w = Enumerable.Range(0, nInv).Select(_ => Math.Exp(1.1 * N())).ToArray();
                    double ws = w.Sum(), done = 0;
                    for (int i = 0; i < nInv; i++)
                    {
                        double net = i == nInv - 1 ? R2(total - done) : R2(total * w[i] / ws);
                        done += net;
                        double vat = R2(net * 0.15);
                        var j = J("Receivables", "Sales Invoices", "INV-" + c + p.Seq + "-" + a[2..] + (i + 1).ToString("000"), WorkDay(p, 1 + _r.Next(28)));
                        j.Lines.Add(("000", "1100", net + vat, 0, "Customer invoice"));
                        j.Lines.Add(("200", a, 0, net, "Sales"));
                        j.Lines.Add(("000", "2200", 0, vat, "Output VAT"));
                        Post(p, c, j);
                    }
                }
                { // returns & discounts (credit notes)
                    double v = R2(get("4100", "200"));
                    var j = J("Receivables", "Credit Memos", "CM-" + c + p.Seq, WorkDay(p, 27));
                    j.Lines.Add(("200", "4100", v, 0, "Returns and discounts")); j.Lines.Add(("000", "1100", 0, v, "Credit notes"));
                    Post(p, c, j);
                }
                if (c == "01")
                { // management fee to company 02 (intercompany)
                    var j = J("Manual", "Intercompany", "IC fee " + p.Name, WorkDay(p, 25), "p.lagesse");
                    j.Lines.Add(("000", "1500", 600_000, 0, "Mgmt fee due from 02")); j.Lines.Add(("500", "4200", 0, 600_000, "Management fee income"));
                    Post(p, c, j);
                }
                else
                {
                    double fee = m == 18 ? 550_000 : 600_000;                                // booked short in Jul of year 2: an intercompany mismatch
                    var j = J("Manual", "Intercompany", "IC fee " + p.Name, WorkDay(p, 26), "m.dupont");
                    j.Lines.Add(("500", "6500", fee, 0, "Management fee from 01")); j.Lines.Add(("000", "2500", 0, fee, "Due to 01"));
                    Post(p, c, j);
                }
                // ── cost of sales (Cost Management) ──
                { double v = R2(get("5000", "300")); var j = J("Cost Management", "COGS", "COGS " + p.Name, p.End); j.Posted = WorkDay(p, 28).AddHours(22);
                  j.Lines.Add(("300", "5000", v, 0, "Cost of goods sold")); j.Lines.Add(("000", "1200", 0, v, "Inventory relieved")); Post(p, c, j); }
                if (get("5200", "300") > 0) { double v = R2(get("5200", "300")); var j = J("Cost Management", "Adjustments", "Write-off " + p.Name, WorkDay(p, 20));
                  j.Lines.Add(("300", "5200", v, 0, "Damaged / expired stock")); j.Lines.Add(("000", "1200", 0, v, "Inventory write-off")); Post(p, c, j); }
                // ── purchases of stock (Payables): towards ~1.5 months of cost of sales on hand ──
                {
                    double cogs = get("5000", "300"), target = cogs * 1.4, inv = Bal(c, "000", "1200") + cogs;   // stock before this month's sales
                    double buy = Math.Max(0, cogs + 0.35 * (target - inv)) * Noise(0.04);
                    int nInv = 8 + _r.Next(6);
                    var w = Enumerable.Range(0, nInv).Select(_ => Math.Exp(0.9 * N())).ToArray(); double ws = w.Sum(), done = 0;
                    for (int i = 0; i < nInv; i++)
                    {
                        double net = i == nInv - 1 ? R2(buy - done) : R2(buy * w[i] / ws); done += net;
                        double vat = R2(net * 0.15);
                        var j = J("Payables", "Purchase Invoices", "AP-" + c + p.Seq + "-" + (i + 1).ToString("000"), WorkDay(p, 1 + _r.Next(28)), CLERKS[_r.Next(CLERKS.Length)]);
                        j.Lines.Add(("000", "1200", net, 0, "Stock purchase")); j.Lines.Add(("000", "1400", vat, 0, "Input VAT")); j.Lines.Add(("000", "2000", 0, net + vat, "Supplier invoice"));
                        Post(p, c, j);
                    }
                    double fr = R2(get("5100", "400"));
                    var jf = J("Payables", "Purchase Invoices", "AP-" + c + p.Seq + "-FRT", WorkDay(p, 15), CLERKS[_r.Next(CLERKS.Length)]);
                    jf.Lines.Add(("400", "5100", fr, 0, "Freight inwards")); jf.Lines.Add(("000", "2000", 0, fr, "Forwarder invoice")); Post(p, c, jf);
                }
                // ── operating expenses through payables / accruals ──
                foreach (var (a, src) in new[] { ("6110", "Payables"), ("6200", "Payables"), ("6210", "Payables"), ("6300", "Payables"), ("6400", "Payables"), ("6500", "Payables"), ("6600", "Payables"), ("7100", "Cash Management"), ("7200", "Manual") })
                {
                    foreach (var kv in pl.Where(kv => kv.Key.StartsWith(a + "|")))
                    {
                        string cc = kv.Key.Split('|')[1]; double v = R2(kv.Value);
                        if (a == "6500" && c == "02") v = R2(v - 600_000);              // the intercompany fee is posted with its own journal
                        if (Math.Abs(v) < 0.01) continue;
                        int pieces = a == "6200" || a == "6300" ? 3 + _r.Next(3) : 1;
                        double done = 0;
                        for (int i = 0; i < pieces; i++)
                        {
                            double part = i == pieces - 1 ? R2(v - done) : R2(v / pieces * (0.7 + 0.6 * _r.NextDouble())); done += part;
                            string contra = src == "Payables" ? "2000" : "1000";
                            var j = J(src, src == "Payables" ? "Purchase Invoices" : src == "Manual" ? "Revaluation" : "Bank Charges", a + "-" + c + p.Seq + "-" + cc + "-" + (i + 1), WorkDay(p, 3 + _r.Next(24)),
                                      src == "Manual" ? "s.chen" : CLERKS[_r.Next(CLERKS.Length)]);
                            if (part >= 0) { j.Lines.Add((cc, a, part, 0, NameOf(a))); j.Lines.Add(("000", contra, 0, part, "Supplier / bank")); }
                            else { j.Lines.Add(("000", contra, -part, 0, "Supplier / bank")); j.Lines.Add((cc, a, 0, -part, NameOf(a))); }
                            Post(p, c, j);
                        }
                    }
                }
                { // rent accrued, paid next month
                    var j = J("Manual", "Accruals", "Rent accrual " + p.Name, WorkDay(p, 28), "p.lagesse");
                    double tot = 0;
                    foreach (var kv in pl.Where(kv => kv.Key.StartsWith("6100|"))) { double v = R2(kv.Value); tot += v; j.Lines.Add((kv.Key.Split('|')[1], "6100", v, 0, "Rent")); }
                    j.Lines.Add(("000", "2100", 0, tot, "Rent accrued")); Post(p, c, j);
                    double due = -Bal(c, "000", "2100") - tot;
                    if (due > 1) { var jp = J("Payables", "Payments", "Rent payment " + p.Name, WorkDay(p, 5), CLERKS[0]); jp.Lines.Add(("000", "2100", due, 0, "Rent paid")); jp.Lines.Add(("000", "1000", 0, due, "Bank")); Post(p, c, jp); }
                }
                { // payroll
                    var j = J("Payroll", "Payroll", "Payroll " + p.Name, WorkDay(p, 26));
                    double tot = 0;
                    foreach (var kv in pl.Where(kv => kv.Key.StartsWith("6000|") || kv.Key.StartsWith("6010|"))) { double v = R2(kv.Value); tot += v; j.Lines.Add((kv.Key.Split('|')[1], kv.Key[..4], v, 0, NameOf(kv.Key[..4]))); }
                    j.Lines.Add(("000", "2300", 0, R2(tot), "Net pay and contributions")); Post(p, c, j);
                    var jp = J("Cash Management", "Payments", "Salary transfer " + p.Name, WorkDay(p, 28)); jp.Lines.Add(("000", "2300", R2(tot), 0, "Salaries paid")); jp.Lines.Add(("000", "1000", 0, R2(tot), "Bank")); Post(p, c, jp);
                }
                { // insurance: paid yearly in January, expensed monthly
                    if (p.Num == 1) { double v = 2_400_000 * co.Scale; var j = J("Payables", "Payments", "Insurance premium " + p.Year, WorkDay(p, 8), CLERKS[1]); j.Lines.Add(("000", "1300", v, 0, "Prepaid insurance")); j.Lines.Add(("000", "1000", 0, v, "Bank")); Post(p, c, j); }
                    double e = R2(get("6700", "100")); var je = J("Manual", "Prepayments", "Insurance release " + p.Name, WorkDay(p, 28), "p.lagesse");
                    je.Lines.Add(("100", "6700", e, 0, "Insurance")); je.Lines.Add(("000", "1300", 0, e, "Prepayment released")); Post(p, c, je);
                }
                { // depreciation, amortisation (Assets)
                    var j = J("Assets", "Depreciation", "Depreciation " + p.Name, p.End);
                    j.Posted = p.End.AddDays(1).AddHours(2);
                    double ppe = 0;
                    foreach (var kv in pl.Where(kv => kv.Key.StartsWith("6900|"))) { double v = R2(kv.Value); ppe += v; j.Lines.Add((kv.Key.Split('|')[1], "6900", v, 0, "Depreciation")); }
                    double rou = R2(300_000 * co.Scale);
                    j.Lines.Add(("000", "1650", 0, R2(ppe - rou), "Accumulated depreciation")); j.Lines.Add(("000", "1700", 0, rou, "ROU depreciation"));
                    double am = R2(get("6950", "100")); j.Lines.Add(("100", "6950", am, 0, "Amortisation")); j.Lines.Add(("000", "1800", 0, am, "Intangibles amortised"));
                    Post(p, c, j);
                }
                { // bad debts
                    double v = R2(get("6800", "200"));
                    var j = J("Receivables", "Adjustments", "Bad debts " + p.Name, WorkDay(p, 27), "p.lagesse");
                    double big = m == 10 ? 1_800_000 * co.Scale : 0;
                    j.Lines.Add(("200", "6800", v, 0, big > 0 ? "Customer insolvency write-off" : "Allowance top-up"));
                    if (big > 0) j.Lines.Add(("000", "1100", 0, big, "Receivable written off"));
                    j.Lines.Add(("000", "1150", 0, R2(v - big), "Allowance")); Post(p, c, j);
                }
                { // interest, loan and lease repayments
                    double i = R2(get("7000", "500"));
                    var j = J("Cash Management", "Bank", "Loan interest " + p.Name, WorkDay(p, 20)); j.Lines.Add(("500", "7000", i, 0, "Interest")); j.Lines.Add(("000", "1000", 0, i, "Bank")); Post(p, c, j);
                    double rep = R2(800_000 * co.Scale), lease = R2(330_000 * co.Scale);
                    var jr = J("Cash Management", "Bank", "Loan + lease repayment " + p.Name, WorkDay(p, 20));
                    jr.Lines.Add(("000", "2700", rep, 0, "Loan repayment")); jr.Lines.Add(("000", "2800", lease, 0, "Lease repayment")); jr.Lines.Add(("000", "1000", 0, rep + lease, "Bank")); Post(p, c, jr);
                }
                if (m == 17)
                { // new delivery fleet, financed by a loan (Jun of year 2)
                    double v = 15_000_000 * co.Scale;
                    var j = J("Manual", "Financing", "Fleet loan drawdown", WorkDay(p, 10), "p.lagesse"); j.Lines.Add(("000", "1000", v, 0, "Loan received")); j.Lines.Add(("000", "2700", 0, v, "Term loan")); Post(p, c, j);
                    var ja = J("Assets", "Additions", "Delivery trucks", WorkDay(p, 12)); ja.Lines.Add(("000", "1600", v, 0, "Trucks")); ja.Lines.Add(("000", "1000", 0, v, "Bank")); Post(p, c, ja);
                }
                if (p.Num % 3 == 0)
                { // quarterly capex
                    double v = R2(3_000_000 * co.Scale * Noise(0.2));
                    var j = J("Assets", "Additions", "Capex Q" + (p.Num / 3) + " " + p.Year, WorkDay(p, 15)); j.Lines.Add(("000", "1600", v, 0, "Equipment")); j.Lines.Add(("000", "1000", 0, v, "Bank")); Post(p, c, j);
                }
                { // income tax provision, paid quarterly
                    double t = R2(get("8000", "500"));
                    if (t > 0) { var j = J("Manual", "Tax", "Tax provision " + p.Name, WorkDay(p, 28), "p.lagesse"); j.Lines.Add(("500", "8000", t, 0, "Income tax")); j.Lines.Add(("000", "2400", 0, t, "Tax payable")); Post(p, c, j); }
                    if (p.Num % 3 == 0) { double pay = R2(-Bal(c, "000", "2400") * 0.8); if (pay > 0) { var jp = J("Cash Management", "Payments", "MRA tax payment " + p.Name, WorkDay(p, 20)); jp.Lines.Add(("000", "2400", pay, 0, "Tax paid")); jp.Lines.Add(("000", "1000", 0, pay, "Bank")); Post(p, c, jp); } }
                }
                { // VAT return (monthly)
                    double outV = -Bal(c, "000", "2200"), inV = Bal(c, "000", "1400"), net = R2(outV - inV);
                    var j = J("Manual", "VAT", "VAT return " + p.Name, WorkDay(p, 20), "s.chen");
                    j.Lines.Add(("000", "2200", R2(outV), 0, "Output VAT cleared")); j.Lines.Add(("000", "1400", 0, R2(inV), "Input VAT cleared"));
                    if (net >= 0) j.Lines.Add(("000", "1000", 0, net, "VAT paid")); else j.Lines.Add(("000", "1000", -net, 0, "VAT refund"));
                    Post(p, c, j);
                }
                if (p.Num % 3 == 0)
                { // intercompany settlement
                    double due = c == "01" ? Bal(c, "000", "1500") : -Bal(c, "000", "2500");
                    if (due > 1)
                    {
                        var j = J("Cash Management", "Intercompany", "IC settlement " + p.Name, WorkDay(p, 25));
                        if (c == "01") { j.Lines.Add(("000", "1000", R2(due), 0, "Received from 02")); j.Lines.Add(("000", "1500", 0, R2(due), "IC receivable cleared")); }
                        else { j.Lines.Add(("000", "2500", R2(due), 0, "IC payable cleared")); j.Lines.Add(("000", "1000", 0, R2(due), "Paid to 01")); }
                        Post(p, c, j);
                    }
                }
                { // customer receipts (~45-50 days of sales outstanding)
                    double ar = Bal(c, "000", "1100"), rec = R2(ar * 0.42 * Noise(0.04));
                    int n = 8 + _r.Next(6); var w = Enumerable.Range(0, n).Select(_ => Math.Exp(N())).ToArray(); double ws = w.Sum(), done = 0;
                    for (int i = 0; i < n; i++)
                    {
                        double v = i == n - 1 ? R2(rec - done) : R2(rec * w[i] / ws); done += v;
                        var j = J("Receivables", "Receipts", "RCPT-" + c + p.Seq + "-" + (i + 1).ToString("000"), WorkDay(p, 1 + _r.Next(28)));
                        j.Lines.Add(("000", "1000", v, 0, "Customer receipt")); j.Lines.Add(("000", "1100", 0, v, "Receipt applied")); Post(p, c, j);
                    }
                }
                { // supplier payments (~55 days)
                    double ap = -Bal(c, "000", "2000"), pay = R2(ap * 0.45 * Noise(0.05));
                    int n = 6 + _r.Next(5); var w = Enumerable.Range(0, n).Select(_ => Math.Exp(N())).ToArray(); double ws = w.Sum(), done = 0;
                    for (int i = 0; i < n; i++)
                    {
                        double v = i == n - 1 ? R2(pay - done) : R2(pay * w[i] / ws); done += v;
                        var j = J("Payables", "Payments", "PAY-" + c + p.Seq + "-" + (i + 1).ToString("000"), WorkDay(p, 1 + _r.Next(28)), CLERKS[_r.Next(CLERKS.Length)]);
                        j.Lines.Add(("000", "2000", v, 0, "Supplier payment")); j.Lines.Add(("000", "1000", 0, v, "Bank")); Post(p, c, j);
                    }
                }
                // keep the bank positive with a short-term facility
                double cash = Bal(c, "000", "1000");
                if (cash < 5_000_000 * co.Scale) { double v = R2(10_000_000 * co.Scale); var j = J("Cash Management", "Financing", "Overdraft draw " + p.Name, WorkDay(p, 27)); j.Lines.Add(("000", "1000", v, 0, "Facility")); j.Lines.Add(("000", "2600", 0, v, "Short-term borrowing")); Post(p, c, j); }
                else if (Bal(c, "000", "2600") < -1 && cash > 25_000_000 * co.Scale) { double v = R2(Math.Min(-Bal(c, "000", "2600"), cash - 20_000_000 * co.Scale)); var j = J("Cash Management", "Financing", "Overdraft repaid " + p.Name, WorkDay(p, 27)); j.Lines.Add(("000", "2600", v, 0, "Facility repaid")); j.Lines.Add(("000", "1000", 0, v, "Bank")); Post(p, c, j); }

                // ── things a reviewer should find ──
                if (c == "01" && m == 20)
                { // an unexplained suspense balance (Sep of year 2)
                    var j = J("Manual", "Adjustment", "Bank difference", WorkDay(p, 29), "j.doe"); var sun = p.End; while (sun.DayOfWeek != DayOfWeek.Sunday) sun = sun.AddDays(-1); j.Posted = sun.AddHours(23).AddMinutes(12);
                    j.Lines.Add(("000", "9999", 237_450, 0, "Unreconciled bank difference")); j.Lines.Add(("000", "1000", 0, 237_450, "Bank")); Post(p, c, j);
                }
                if (c == "01" && (m % 4 == 1))
                { // round-amount manual accruals posted at the weekend by one user
                    var d = new DateTime(p.Year, p.Num, 1); while (d.DayOfWeek != DayOfWeek.Saturday) d = d.AddDays(1);
                    var j = J("Manual", "Accruals", "Accrual adj " + p.Name, d, "j.doe"); j.Posted = d.AddDays(7).AddHours(21);
                    j.Lines.Add(("200", "6300", 500_000, 0, "Accrued promotions")); j.Lines.Add(("000", "2100", 0, 500_000, "Accrual")); Post(p, c, j);
                    var jr = J("Manual", "Accruals", "Accrual reversal " + p.Name, WorkDay(p, 28), "j.doe");
                    jr.Lines.Add(("000", "2100", 500_000, 0, "Accrual reversed")); jr.Lines.Add(("200", "6300", 0, 500_000, "Accrued promotions")); Post(p, c, jr);
                }
                if (c == "02" && m == 15)
                { // the same supplier invoice entered twice
                    for (int k = 0; k < 2; k++) { var j = J("Payables", "Purchase Invoices", "AP-DUP-4471", WorkDay(p, 9), "m.dupont"); j.Lines.Add(("300", "6600", 186_300, 0, "Forklift repair")); j.Lines.Add(("000", "2000", 0, 186_300, "Supplier invoice 4471")); Post(p, c, j); }
                }
            }

            private static string NameOf(string a) => Accounts.FirstOrDefault(x => x.Code == a)?.Name ?? a;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens (finance/index.html): journal balances in one DuckDB file, read by the page with read-only SQL.
    /// Tables: fin_meta, fin_segments, fin_companies, fin_cost_centres, fin_accounts, fin_periods,
    /// fin_balances (scenario ACTUAL / BUDGET × company × cost centre × account × period: begin, dr, cr, net, end —
    /// income statement accounts start each fiscal year at 0 and their result rolls into retained earnings, like Fusion GL),
    /// loaded from Oracle Fusion only (FinanceFusion.cs: SQL through the BI Publisher runner, FinanceBicc.cs: BICC extracts)
    /// and fin_journals (journal lines for drill-down and journal analytics).
    /// The file is rebuilt into finance.new.duckdb and swapped in, so readers never see half a load.
    /// Statement templates, KPIs and monitors are JSON documents next to it (templates.json, config.json).
    /// Folder: %APPDATA%\GraysWMS\Finance\settings.json "root", default C:\fusion\finance.
    /// </summary>
    public static partial class FinanceLens
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
            if (!File.Exists(DbPath)) { res.Error = "No finance data yet - load the journal balances from Oracle Fusion first (Data tab)."; return res; }
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
            // Finance Lens holds Oracle Fusion data only: a file from the old built-in sample counts as no data
            if (meta.Error == null && meta.Rows.Any(r => Convert.ToString(r[0]) == "source" && Convert.ToString(r[1]) == "SAMPLE"))
                return new { ok = true, loaded = false, oldSample = true, root = Root };
            if (meta.Error != null || !meta.Rows.Any(r => Convert.ToString(r[0]) == "source"))
            {   // only live trial balances / segment values so far
                var tb = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('fin_tb_live', 'fin_gl_balances')", 1);
                return new { ok = true, loaded = false, root = Root, snapshotsOnly = tb.Error == null && tb.Rows.Count > 0 && Convert.ToInt64(tb.Rows[0][0]) > 0 };
            }
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
        private static readonly string[] DOCS = { "templates", "config", "notes", "close", "pages", "alloc" };   // alloc = cost allocation models   // pages = My pages (CFO-designed pages)     // close = saved close packages + sign-off
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
        public static int SetClasses(Dictionary<string, string> classes, string user = null, string source = "AUTO")
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
                // the mapping itself, kept apart from the data rows: who chose which class (USER) or the page's guess (AUTO)
                Exec(conn, "CREATE TABLE IF NOT EXISTS fin_account_map (code VARCHAR, class VARCHAR, source VARCHAR, changed_by VARCHAR, changed_at TIMESTAMP)");
                Exec(conn, "DELETE FROM fin_account_map WHERE code IN (SELECT code FROM cls)" + (source == "AUTO" ? " AND source = 'AUTO'" : ""));
                Exec(conn, "INSERT INTO fin_account_map SELECT code, class, " + Lit(source) + ", " + Lit(user ?? "") + ", now() FROM cls" +
                           (source == "AUTO" ? " WHERE code NOT IN (SELECT code FROM fin_account_map WHERE source = 'USER')" : ""));
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

        /// <summary>Saves the values of one segment: in fin_segment_values when the finance file exists ("duckdb"),
        /// else as a pending file {root}\segment-values\{coa}_{column}.json that the first load imports ("pending").</summary>
        public static string SaveSegmentValues(string coaId, string column, List<FinanceFusion.SegValue> values)
        {
            if (!File.Exists(DbPath))
            {
                Directory.CreateDirectory(PendingSegDir);
                var doc = new PendingSeg { CoaId = coaId, Column = column, FetchedAt = DateTime.Now, Values = values };
                string f = PendingSegFile(coaId, column);
                File.WriteAllText(f + ".tmp", JsonSerializer.Serialize(doc));
                File.Move(f + ".tmp", f, true);
                return "pending";
            }
            lock (_lock)
            {
                ResetSessionNoLock();
                using var conn = new DuckDBConnection("Data Source=" + DbPath);
                conn.Open();
                Exec(conn, SEGVAL_TABLE);
                Exec(conn, "DELETE FROM fin_segment_values WHERE coa_id = " + Lit(coaId) + " AND column_name = " + Lit(column));
                Append(conn, "fin_segment_values", values.Select(v => new object[] { coaId, column, v.Value, v.Description, v.Combinations, v.AccountType, DateTime.Now }).ToList());
                Exec(conn, "CHECKPOINT");
            }
            try { File.Delete(PendingSegFile(coaId, column)); } catch { }
            return "duckdb";
        }

        // ── trial balances read live from Fusion (Statements › Trial balance › Live from Fusion) ──
        internal const string TB_TABLE = "CREATE TABLE IF NOT EXISTS fin_tb_live (pod VARCHAR, ledger VARCHAR, ledger_name VARCHAR, currency VARCHAR, period_seq INTEGER, period_name VARCHAR, " +
            "company VARCHAR, account VARCHAR, cost_centre VARCHAR, account_type VARCHAR, account_name VARCHAR, opening DOUBLE, ptd_dr DOUBLE, ptd_cr DOUBLE, closing DOUBLE, " +
            "qtr_open DOUBLE, year_open DOUBLE, fetched_at TIMESTAMP, fetched_by VARCHAR)";

        /// <summary>Saves a live trial balance in fin_tb_live (replacing that pod × ledger × period). Creates the finance file when
        /// there is none yet: it then holds only snapshots and still reads as "no data loaded"; the first load keeps them.</summary>
        public static int SaveTb(JsonElement root, string user)
        {
            string pod = Str(root, "pod") ?? "", by = user ?? "";
            var led = root.GetProperty("ledger"); var per = root.GetProperty("period");
            string code = Str(led, "code"), lname = Str(led, "name"), ccy = Str(led, "currency"), pname = Str(per, "name");
            int seq = per.TryGetProperty("seq", out var sq) && sq.ValueKind == JsonValueKind.Number ? sq.GetInt32() : 0;
            if (string.IsNullOrEmpty(code) || seq == 0) throw new InvalidOperationException("ledger and period are required");
            double N(JsonElement r, string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
            var now = DateTime.Now;
            var rows = root.GetProperty("rows").EnumerateArray().Select(r => new object[] { pod, code, lname, ccy, seq, pname, Str(r, "company"), Str(r, "account"), Str(r, "costCentre"), Str(r, "accountType"), Str(r, "accountName"),
                N(r, "opening"), N(r, "ptdDr"), N(r, "ptdCr"), N(r, "closing"), N(r, "qtrOpen"), N(r, "yearOpen"), now, by }).ToList();
            lock (_lock)
            {
                ResetSessionNoLock();
                Directory.CreateDirectory(Root);
                bool fresh = !File.Exists(DbPath);
                using var conn = new DuckDBConnection("Data Source=" + DbPath);
                conn.Open();
                if (fresh) Exec(conn, "CREATE TABLE IF NOT EXISTS fin_meta (key VARCHAR, value VARCHAR)");
                Exec(conn, TB_TABLE);
                Exec(conn, "DELETE FROM fin_tb_live WHERE pod = " + Lit(pod) + " AND ledger = " + Lit(code) + " AND period_seq = " + seq);
                Append(conn, "fin_tb_live", rows);
                Exec(conn, "CHECKPOINT");
            }
            return rows.Count;
        }
        private static string Str(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString()) : null;

        // ── GL_BALANCES rows (every column) of a ledger × period, read once and kept here (the live trial balance is built from them) ──
        // fin_gl_balances = pod + fetched_at + the GL_BALANCES columns with their own names (NUMBER → DOUBLE, *_ID → BIGINT, other types → VARCHAR);
        // columns Fusion adds later are added to the table on the next read. fin_gl_balances_sync = one row per ledger × period × currency read.
        internal const string RAW_SYNC_TABLE = "CREATE TABLE IF NOT EXISTS fin_gl_balances_sync (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, currency VARCHAR, rows_read BIGINT, columns_read INTEGER, ms BIGINT, " +
            "fetched_at TIMESTAMP, fetched_by VARCHAR)";
        internal static readonly string CCID_TABLE = "CREATE TABLE IF NOT EXISTS fin_ccid (coa_id VARCHAR, ccid BIGINT, account_type VARCHAR, summary_flag VARCHAR, " +
            string.Join(", ", Enumerable.Range(1, 30).Select(i => "segment" + i + " VARCHAR")) + ")";
        private static string DuckType(string col, string oracleType)
        {
            string t = (oracleType ?? "").ToUpperInvariant();
            if (t == "NUMBER" || t == "FLOAT" || t.StartsWith("BINARY_")) return col.EndsWith("_ID", StringComparison.OrdinalIgnoreCase) ? "BIGINT" : "DOUBLE";
            return "VARCHAR";
        }
        private static string QI(string name) => "\"" + name.ToLowerInvariant().Replace("\"", "") + "\"";

        private static DuckDBConnection OpenWrite()
        {
            ResetSessionNoLock();
            Directory.CreateDirectory(Root);
            bool fresh = !File.Exists(DbPath);
            var conn = new DuckDBConnection("Data Source=" + DbPath);
            conn.Open();
            if (fresh) Exec(conn, "CREATE TABLE IF NOT EXISTS fin_meta (key VARCHAR, value VARCHAR)");   // still reads as "no data loaded"
            Exec(conn, RAW_SYNC_TABLE); Exec(conn, CCID_TABLE);
            Exec(conn, "DROP TABLE IF EXISTS fin_gl_raw"); Exec(conn, "DROP TABLE IF EXISTS fin_gl_raw_sync");   // the earlier few-column layout
            return conn;
        }
        private static List<(string Name, string Type)> TableColumns(DuckDBConnection conn, string table)
        {
            var list = new List<(string, string)>();
            using var c = conn.CreateCommand();
            c.CommandText = "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = " + Lit(table) + " ORDER BY ordinal_position";
            using var r = c.ExecuteReader();
            while (r.Read()) list.Add((r.GetString(0), r.GetString(1)));
            return list;
        }

        /// <summary>The ledger's periods kept on this PC: period → (rows, fetched_at).</summary>
        public static Dictionary<string, (long Rows, DateTime At)> RawPeriods(string pod, long ledgerId, string currency)
        {
            var d = new Dictionary<string, (long, DateTime)>(StringComparer.Ordinal);
            if (!File.Exists(DbPath)) return d;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('fin_gl_balances_sync', 'fin_gl_balances')", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) < 2) return d;
            var r = Query("SELECT period_name, rows_read, CAST(fetched_at AS VARCHAR) FROM fin_gl_balances_sync WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND currency = " + Lit(currency), 10000);
            foreach (var row in r.Rows) d[Convert.ToString(row[0])] = (Convert.ToInt64(row[1]), DateTime.TryParse(Convert.ToString(row[2]), CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) ? dt : DateTime.MinValue);
            return d;
        }

        /// <summary>Replaces one ledger × period (actuals, that currency) of fin_gl_balances with the rows read (every column).</summary>
        public static void SaveRaw(string pod, long ledgerId, string period, string currency, List<(string Col, string Type)> cols, List<Dictionary<string, object>> rows, long ms, string user)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                // the identifying columns are always there (a query of your own may leave them out)
                var all = cols.ToList();
                foreach (var (c0, t0) in new[] { ("LEDGER_ID", "NUMBER"), ("PERIOD_NAME", "VARCHAR2"), ("CURRENCY_CODE", "VARCHAR2"), ("ACTUAL_FLAG", "VARCHAR2"), ("CODE_COMBINATION_ID", "NUMBER") })
                    if (!all.Any(c => string.Equals(c.Col, c0, StringComparison.OrdinalIgnoreCase))) all.Add((c0, t0));
                cols = all;
                Exec(conn, "CREATE TABLE IF NOT EXISTS fin_gl_balances (pod VARCHAR, fetched_at TIMESTAMP, " + string.Join(", ", cols.Select(c => QI(c.Col) + " " + DuckType(c.Col, c.Type))) + ")");
                var have = TableColumns(conn, "fin_gl_balances");
                foreach (var c in cols.Where(c => !have.Any(h => string.Equals(h.Name, c.Col, StringComparison.OrdinalIgnoreCase))))
                    Exec(conn, "ALTER TABLE fin_gl_balances ADD COLUMN " + QI(c.Col) + " " + DuckType(c.Col, c.Type));
                have = TableColumns(conn, "fin_gl_balances");
                string w = "pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND currency_code = " + Lit(currency) + " AND actual_flag = 'A'";
                Exec(conn, "DELETE FROM fin_gl_balances WHERE " + w);
                Exec(conn, "DELETE FROM fin_gl_balances_sync WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND currency = " + Lit(currency));
                var now = DateTime.Now;
                object Val(Dictionary<string, object> row, string name, string type)
                {
                    if (!row.TryGetValue(name.ToUpperInvariant(), out var v) && !row.TryGetValue(name, out v)) return null;
                    string sv = v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture);
                    if (string.IsNullOrEmpty(sv)) return null;
                    if (type == "BIGINT") return long.TryParse(sv, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) ? l : decimal.TryParse(sv, NumberStyles.Float, CultureInfo.InvariantCulture, out var dm) ? (long)dm : null;
                    if (type == "DOUBLE") return double.TryParse(sv, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
                    return sv;
                }
                object Cell(Dictionary<string, object> row, string name, string type) => name switch
                {
                    "pod" => pod ?? "",
                    "fetched_at" => now,
                    "ledger_id" => Val(row, name, type) ?? (type == "BIGINT" ? ledgerId : type == "DOUBLE" ? (double)ledgerId : ledgerId.ToString(CultureInfo.InvariantCulture)),
                    "period_name" => Val(row, name, type) ?? period,
                    "currency_code" => Val(row, name, type) ?? currency,
                    "actual_flag" => Val(row, name, type) ?? "A",
                    _ => Val(row, name, type)
                };
                Append(conn, "fin_gl_balances", rows.Select(row => have.Select(h => Cell(row, h.Name, h.Type)).ToArray()).ToList());
                Append(conn, "fin_gl_balances_sync", new List<object[]> { new object[] { pod ?? "", ledgerId, period, currency, (long)rows.Count, cols.Count, ms, now, user ?? "" } });
                Exec(conn, "CHECKPOINT");
            }
        }

        /// <summary>What the trial balance needs from the kept rows: (period, ccid, translated_flag, begin_dr, begin_cr, net_dr, net_cr).</summary>
        public static List<(string Period, long Ccid, string Tf, double Bdr, double Bcr, double Ndr, double Ncr)> LoadRaw(string pod, long ledgerId, string currency, IEnumerable<string> periods)
        {
            var list = new List<(string, long, string, double, double, double, double)>();
            var names = periods.Distinct().ToList();
            if (names.Count == 0 || !File.Exists(DbPath)) return list;
            lock (_lock)
            {
                ResetSessionNoLock();
                using var conn = new DuckDBConnection("Data Source=" + DbPath);
                conn.Open();
                var cols = TableColumns(conn, "fin_gl_balances");
                if (cols.Count == 0) return list;
                bool tf = cols.Any(c => c.Name == "translated_flag");
                using var c = conn.CreateCommand();
                c.CommandText = "SELECT period_name, code_combination_id, " + (tf ? "translated_flag" : "NULL") + ", begin_balance_dr, begin_balance_cr, period_net_dr, period_net_cr FROM fin_gl_balances WHERE pod = " + Lit(pod ?? "") +
                                " AND ledger_id = " + ledgerId + " AND currency_code = " + Lit(currency) + " AND actual_flag = 'A' AND period_name IN (" + string.Join(",", names.Select(Lit)) + ")";
                using var r = c.ExecuteReader();
                double N(int i) => r.IsDBNull(i) ? 0 : Convert.ToDouble(r.GetValue(i), CultureInfo.InvariantCulture);
                while (r.Read()) list.Add((r.GetString(0), Convert.ToInt64(r.GetValue(1)), r.IsDBNull(2) ? null : Convert.ToString(r.GetValue(2)), N(3), N(4), N(5), N(6)));
            }
            return list;
        }

        // ── GL_BALANCES grouped in Fusion by company × account (× cost centre): fin_gl_balances_acct + one sync row per period × company ('*' = all) ──
        internal const string ACCT_SYNC_TABLE = "CREATE TABLE IF NOT EXISTS fin_gl_balances_acct_sync (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, currency VARCHAR, grain VARCHAR, company VARCHAR, " +
            "rows_read BIGINT, ms BIGINT, fetched_at TIMESTAMP)";

        /// <summary>period → (account rows, read at, companies read — '*' = every company) of one ledger × grain kept on this PC.</summary>
        public static Dictionary<string, (long Rows, DateTime At, HashSet<string> Companies)> AcctPeriods(string pod, long ledgerId, string currency, string grain)
        {
            var d = new Dictionary<string, (long, DateTime, HashSet<string>)>(StringComparer.Ordinal);
            if (!File.Exists(DbPath)) return d;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('fin_gl_balances_acct_sync', 'fin_gl_balances_acct')", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) < 2) return d;
            var r = Query("SELECT period_name, company, rows_read, CAST(fetched_at AS VARCHAR) FROM fin_gl_balances_acct_sync WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId +
                          " AND currency = " + Lit(currency) + " AND grain = " + Lit(grain), 100000);
            foreach (var row in r.Rows)
            {
                string n = Convert.ToString(row[0]);
                var at = DateTime.TryParse(Convert.ToString(row[3]), CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) ? dt : DateTime.MinValue;
                if (!d.TryGetValue(n, out var cur)) cur = (0, at, new HashSet<string>(StringComparer.Ordinal));
                cur.Item3.Add(Convert.ToString(row[1]));
                d[n] = (cur.Item1 + Convert.ToInt64(row[2]), at < cur.Item2 ? at : cur.Item2, cur.Item3);
            }
            return d;
        }

        /// <summary>Replaces one ledger × period × grain (all companies, or the companies given) of fin_gl_balances_acct with the rows read.</summary>
        /// <summary>company IN (…) that also matches a code kept with / without its leading zeros ("1" and "01" — lists read before the zeros were kept).</summary>
        internal static string CoMatch(string col, IEnumerable<string> vals)
        {
            var v = vals.Where(x => x != null).Distinct().ToList();
            var digits = v.Where(x => x.Length > 0 && x.All(char.IsDigit)).Select(x => x.TrimStart('0')).Distinct().ToList();
            return "(" + col + " IN (" + string.Join(",", v.Select(Lit)) + ")" +
                   (digits.Count > 0 ? " OR (regexp_full_match(" + col + ", '[0-9]+') AND ltrim(" + col + ", '0') IN (" + string.Join(",", digits.Select(Lit)) + "))" : "") + ")";
        }
        public static void SaveAcct(string pod, long ledgerId, string period, string currency, string grain, List<string> companies, List<(string Col, string Type)> cols, List<Dictionary<string, object>> rows, long ms)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, ACCT_SYNC_TABLE);
                var all = cols.ToList();
                foreach (var (c0, t0) in new[] { ("LEDGER_ID", "NUMBER"), ("PERIOD_NAME", "VARCHAR2"), ("CURRENCY_CODE", "VARCHAR2"), ("COMPANY", "VARCHAR2"), ("ACCOUNT", "VARCHAR2"), ("COST_CENTRE", "VARCHAR2"), ("TRANSLATED_FLAG", "VARCHAR2"), ("ACCOUNT_TYPE", "VARCHAR2") })
                    if (!all.Any(c => string.Equals(c.Col, c0, StringComparison.OrdinalIgnoreCase))) all.Add((c0, t0));
                cols = all;
                Exec(conn, "CREATE TABLE IF NOT EXISTS fin_gl_balances_acct (pod VARCHAR, grain VARCHAR, fetched_at TIMESTAMP, " + string.Join(", ", cols.Select(c => QI(c.Col) + " " + DuckType(c.Col, c.Type))) + ")");
                var have = TableColumns(conn, "fin_gl_balances_acct");
                foreach (var c in cols.Where(c => !have.Any(h => string.Equals(h.Name, c.Col, StringComparison.OrdinalIgnoreCase))))
                    Exec(conn, "ALTER TABLE fin_gl_balances_acct ADD COLUMN " + QI(c.Col) + " " + DuckType(c.Col, c.Type));
                have = TableColumns(conn, "fin_gl_balances_acct");
                string w = "pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND grain = " + Lit(grain);
                string coIn = companies == null ? "" : " IN (" + string.Join(",", companies.Select(Lit)) + ")";
                if (companies != null)
                {   // the period was read for every company before: keep the other companies covered, one sync row each, then drop the '*' row
                    string ws = w + " AND currency = " + Lit(currency);
                    Exec(conn, "INSERT INTO fin_gl_balances_acct_sync SELECT s.pod, s.ledger_id, s.period_name, s.currency, s.grain, a.company, a.n, s.ms, s.fetched_at FROM fin_gl_balances_acct_sync s " +
                               "JOIN (SELECT company, COUNT(*) n FROM fin_gl_balances_acct WHERE " + w + " AND currency_code = " + Lit(currency) + " AND company IS NOT NULL AND NOT " + CoMatch("company", companies) + " GROUP BY company) a ON TRUE " +
                               "WHERE s.pod = " + Lit(pod ?? "") + " AND s.ledger_id = " + ledgerId + " AND s.period_name = " + Lit(period) + " AND s.grain = " + Lit(grain) + " AND s.currency = " + Lit(currency) + " AND s.company = '*'");
                    Exec(conn, "DELETE FROM fin_gl_balances_acct_sync WHERE " + ws + " AND company = '*'");
                }
                Exec(conn, "DELETE FROM fin_gl_balances_acct WHERE " + w + " AND currency_code = " + Lit(currency) + (companies == null ? "" : " AND " + CoMatch("company", companies)));
                Exec(conn, "DELETE FROM fin_gl_balances_acct_sync WHERE " + w + " AND currency = " + Lit(currency) + (companies == null ? "" : " AND " + CoMatch("company", companies)));
                var now = DateTime.Now;
                object Val(Dictionary<string, object> row, string name, string type)
                {
                    if (!row.TryGetValue(name.ToUpperInvariant(), out var v) && !row.TryGetValue(name, out v)) return null;
                    string sv = v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture);
                    if (string.IsNullOrEmpty(sv)) return null;
                    if (type == "BIGINT") return long.TryParse(sv, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) ? l : decimal.TryParse(sv, NumberStyles.Float, CultureInfo.InvariantCulture, out var dm) ? (long)dm : null;
                    if (type == "DOUBLE") return double.TryParse(sv, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
                    return sv;
                }
                object Cell(Dictionary<string, object> row, string name, string type) => name switch
                {
                    "pod" => pod ?? "",
                    "grain" => grain,
                    "fetched_at" => now,
                    "ledger_id" => Val(row, name, type) ?? (type == "BIGINT" ? ledgerId : type == "DOUBLE" ? (double)ledgerId : ledgerId.ToString(CultureInfo.InvariantCulture)),
                    "period_name" => Val(row, name, type) ?? period,
                    "currency_code" => Val(row, name, type) ?? currency,
                    _ => Val(row, name, type)
                };
                Append(conn, "fin_gl_balances_acct", rows.Select(row => have.Select(h => Cell(row, h.Name, h.Type)).ToArray()).ToList());
                var sync = companies == null
                    ? new List<object[]> { new object[] { pod ?? "", ledgerId, period, currency, grain, "*", (long)rows.Count, ms, now } }
                    : companies.Select(co => new object[] { pod ?? "", ledgerId, period, currency, grain, co, (long)rows.Count(r => string.Equals(Convert.ToString(r.TryGetValue("COMPANY", out var v) ? v : null), co, StringComparison.Ordinal)), ms, now }).ToList();
                Append(conn, "fin_gl_balances_acct_sync", sync);
                Exec(conn, "CHECKPOINT");
            }
        }

        // ── extended segments: GL_BALANCES grouped in Fusion by company × account × the extra segments an admin picks (cost centre, analysis,
        //    salesperson, profit centre …) — its own table, so the trial balance (fin_gl_balances_acct) stays small and fast ──
        internal const string EXT_TABLE = "CREATE TABLE IF NOT EXISTS fin_gl_balances_ext (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, currency_code VARCHAR, translated_flag VARCHAR, " +
            "company VARCHAR, account VARCHAR, account_type VARCHAR, segment1 VARCHAR, segment2 VARCHAR, segment3 VARCHAR, segment4 VARCHAR, segment5 VARCHAR, segment6 VARCHAR, segment7 VARCHAR, segment8 VARCHAR, segment9 VARCHAR, segment10 VARCHAR, segment11 VARCHAR, segment12 VARCHAR, segment13 VARCHAR, segment14 VARCHAR, segment15 VARCHAR, segment16 VARCHAR, segment17 VARCHAR, segment18 VARCHAR, segment19 VARCHAR, segment20 VARCHAR, segment21 VARCHAR, segment22 VARCHAR, segment23 VARCHAR, segment24 VARCHAR, segment25 VARCHAR, segment26 VARCHAR, segment27 VARCHAR, segment28 VARCHAR, segment29 VARCHAR, segment30 VARCHAR, begin_balance_dr DOUBLE, begin_balance_cr DOUBLE, period_net_dr DOUBLE, period_net_cr DOUBLE, fetched_at TIMESTAMP)";
        internal const string EXT_ACCT_TABLE = "CREATE TABLE IF NOT EXISTS fin_gl_ext_acct_status (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, company VARCHAR, account VARCHAR, " +
            "state VARCHAR, rows_read BIGINT, error VARCHAR, ms BIGINT, fetched_at TIMESTAMP, segments VARCHAR)";
        /// <summary>How each account of an account-by-account extended read went (ok / empty / failed); all = the whole period × company was read again.</summary>
        public static void SaveExtAcctStatus(string pod, long ledgerId, string period, string company, IList<(string Account, string State, int Rows, string Error, long Ms)> list, bool all, string segments = null)
        {
            lock (_lock)
            {
                list = list.GroupBy(z => z.Account).Select(g => g.Last()).ToList();   // an account read twice (tie-out) keeps its last result
                using var conn = OpenWrite();
                Exec(conn, EXT_ACCT_TABLE); Exec(conn, "ALTER TABLE fin_gl_ext_acct_status ADD COLUMN IF NOT EXISTS segments VARCHAR");
                string w = " WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND " + CoMatch("company", new[] { company });
                Exec(conn, "DELETE FROM fin_gl_ext_acct_status" + w + (all || list.Count == 0 ? "" : " AND " + CoMatch("account", list.Select(z => z.Account))));
                var now = DateTime.Now;
                if (list.Count > 0) Append(conn, "fin_gl_ext_acct_status", list.Select(z => new object[] { pod ?? "", ledgerId, period, company, z.Account, z.State, (long)z.Rows, z.Error, z.Ms, now, segments }).ToList());
                Exec(conn, "CHECKPOINT");
            }
        }
        public static object ExtAcctStatus(string pod, long ledgerId)
        {
            if (!File.Exists(DbPath)) return new { ok = true, rows = Array.Empty<object>() };
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_gl_ext_acct_status'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return new { ok = true, rows = Array.Empty<object>() };
            var r = Query("SELECT period_name, company, account, state, rows_read, error, ms, CAST(fetched_at AS VARCHAR) FROM fin_gl_ext_acct_status WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " ORDER BY 1, 2, 3", 500000);
            if (r.Error != null) return new { ok = false, error = r.Error };
            return new { ok = true, rows = r.Rows.Select(z => new { period = z[0], company = z[1], account = z[2], state = z[3], rows = z[4], error = z[5], ms = z[6], at = z[7] }) };
        }
        /// <summary>Starts an account-by-account read of one period × company afresh: its rows, sync row and account results go.</summary>
        public static void ClearExt(string pod, long ledgerId, string period, string currency, string company)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, EXT_TABLE); Exec(conn, EXT_SYNC_TABLE); Exec(conn, EXT_ACCT_TABLE);
                string w = " WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND " + CoMatch("company", new[] { company });
                Exec(conn, "DELETE FROM fin_gl_balances_ext" + w + " AND currency_code = " + Lit(currency));
                Exec(conn, "DELETE FROM fin_gl_balances_ext_sync" + w + " AND currency = " + Lit(currency));
                Exec(conn, "DELETE FROM fin_gl_ext_acct_status" + w);
                Exec(conn, "CHECKPOINT");
            }
        }
        /// <summary>Marks an account-by-account read complete: the sync row with the rows now kept for the period × company.</summary>
        public static long SealExt(string pod, long ledgerId, string period, string currency, string company, List<string> segs, long ms)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, EXT_TABLE); Exec(conn, EXT_SYNC_TABLE);
                string w = " WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND " + CoMatch("company", new[] { company });
                long n;
                using (var c = conn.CreateCommand()) { c.CommandText = "SELECT COUNT(*) FROM fin_gl_balances_ext" + w + " AND currency_code = " + Lit(currency); n = Convert.ToInt64(c.ExecuteScalar()); }
                Exec(conn, "DELETE FROM fin_gl_balances_ext_sync" + w + " AND currency = " + Lit(currency));
                Append(conn, "fin_gl_balances_ext_sync", new List<object[]> { new object[] { pod ?? "", ledgerId, period, currency, company, string.Join(",", segs), n, ms, DateTime.Now } });
                EnsureExtView(conn);
                Exec(conn, "CHECKPOINT");
                return n;
            }
        }
        /// <summary>Accounts an earlier, unfinished account-by-account read of this period × company already brought (ok / empty) with the same segments — a new Sync goes on from there.</summary>
        public static HashSet<string> ExtAcctDone(string pod, long ledgerId, string period, string company, string segments)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            if (!File.Exists(DbPath)) return set;
            var t = Query("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'fin_gl_ext_acct_status' AND column_name = 'segments'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return set;
            var r = Query("SELECT account FROM fin_gl_ext_acct_status WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND " + CoMatch("company", new[] { company }) +
                          " AND state IN ('ok', 'empty') AND segments = " + Lit(segments), 500000);
            if (r.Error == null) foreach (var z in r.Rows) if (z[0] != null) set.Add(Convert.ToString(z[0], CultureInfo.InvariantCulture));
            return set;
        }
        /// <summary>The extended rows kept for a period × company, shaped like the extended query's rows (for the tie-out).</summary>
        public static List<Dictionary<string, object>> LoadExtRows(string pod, long ledgerId, string period, string currency, string company, string accountCol)
        {
            var list = new List<Dictionary<string, object>>();
            if (!File.Exists(DbPath)) return list;
            var r = Query("SELECT translated_flag, account, begin_balance_dr, begin_balance_cr, period_net_dr, period_net_cr FROM fin_gl_balances_ext WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId +
                          " AND period_name = " + Lit(period) + " AND currency_code = " + Lit(currency) + " AND " + CoMatch("company", new[] { company }), 2000000);
            if (r.Error != null) return list;
            foreach (var z in r.Rows)
            {
                var d = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase) { [accountCol.ToUpperInvariant()] = z[1], ["BEGIN_BALANCE_DR"] = z[2], ["BEGIN_BALANCE_CR"] = z[3], ["PERIOD_NET_DR"] = z[4], ["PERIOD_NET_CR"] = z[5] };
                if (z[0] != null) d["TRANSLATED_FLAG"] = z[0];
                list.Add(d);
            }
            return list;
        }

        // ── all code combinations of a chart kept on this PC (fin_ccid) + the log of their syncs ──
        internal const string CCID_SYNC_TABLE = "CREATE TABLE IF NOT EXISTS fin_ccid_sync (coa_id VARCHAR, rows_read BIGINT, max_ccid BIGINT, pages INTEGER, ms BIGINT, full_read BOOLEAN, complete BOOLEAN, fetched_at TIMESTAMP)";
        public static long CcidMax(string coaId)
        {
            if (!File.Exists(DbPath)) return long.MinValue;
            var t = Query("SELECT MAX(ccid) FROM fin_ccid WHERE coa_id = " + Lit(coaId ?? ""), 1);
            return t.Error == null && t.Rows.Count > 0 && t.Rows[0][0] != null ? Convert.ToInt64(t.Rows[0][0]) : long.MinValue;
        }
        public static void LogCcidSync(string coaId, long rows, long maxCcid, int pages, long ms, bool full, bool complete)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, CCID_SYNC_TABLE);
                Append(conn, "fin_ccid_sync", new List<object[]> { new object[] { coaId ?? "", rows, maxCcid, pages, ms, full, complete, DateTime.Now } });
                Exec(conn, "CHECKPOINT");
            }
        }
        public static object CcidStatus(string coaId)
        {
            if (!File.Exists(DbPath)) return new { ok = true, rows = 0L };
            var t = Query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('fin_ccid', 'fin_ccid_sync')", 5);
            var have = new HashSet<string>(t.Error == null ? t.Rows.Select(z => Convert.ToString(z[0])) : Enumerable.Empty<string>());
            if (!have.Contains("fin_ccid")) return new { ok = true, rows = 0L };
            var c = Query("SELECT COUNT(*), MAX(ccid), COUNT(*) FILTER (WHERE summary_flag = 'Y') FROM fin_ccid WHERE coa_id = " + Lit(coaId ?? ""), 1);
            object last = null;
            if (have.Contains("fin_ccid_sync"))
            {
                var l = Query("SELECT rows_read, max_ccid, pages, ms, full_read, complete, CAST(fetched_at AS VARCHAR) FROM fin_ccid_sync WHERE coa_id = " + Lit(coaId ?? "") + " ORDER BY fetched_at DESC LIMIT 1", 1);
                if (l.Error == null && l.Rows.Count > 0) { var z = l.Rows[0]; last = new { rows = z[0], max = z[1], pages = z[2], ms = z[3], full = z[4], complete = z[5], at = z[6] }; }
                var fullDone = Query("SELECT COUNT(*) FROM fin_ccid_sync WHERE coa_id = " + Lit(coaId ?? "") + " AND full_read AND complete", 1);
                bool everFull = fullDone.Error == null && fullDone.Rows.Count > 0 && Convert.ToInt64(fullDone.Rows[0][0]) > 0;
                return new { ok = true, rows = c.Rows[0][0], max = c.Rows[0][1], summary = c.Rows[0][2], last, everFull };
            }
            return new { ok = true, rows = c.Rows[0][0], max = c.Rows[0][1], summary = c.Rows[0][2], last, everFull = false };
        }
        /// <summary>Code combinations of these ids from fin_ccid (type, summary flag, SEGMENTn values).</summary>
        public static Dictionary<long, (string Type, bool Summary, Dictionary<string, string> Segs)> LoadCcids(string coaId, IEnumerable<long> ids)
        {
            var d = new Dictionary<long, (string, bool, Dictionary<string, string>)>();
            if (!File.Exists(DbPath)) return d;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_ccid'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return d;
            foreach (var chunk in ids.Distinct().Chunk(5000))
            {
                var r = Query("SELECT ccid, account_type, summary_flag, " + string.Join(", ", Enumerable.Range(1, 30).Select(i => "segment" + i)) + " FROM fin_ccid WHERE coa_id = " + Lit(coaId ?? "") +
                              " AND ccid IN (" + string.Join(",", chunk.Select(i => i.ToString(CultureInfo.InvariantCulture))) + ")", chunk.Length + 10);
                if (r.Error != null) break;
                foreach (var z in r.Rows)
                {
                    var segs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 1; i <= 30; i++) if (z[2 + i] != null) segs["SEGMENT" + i] = Convert.ToString(z[2 + i], CultureInfo.InvariantCulture);
                    d[Convert.ToInt64(z[0])] = (z[1] == null ? null : Convert.ToString(z[1]), Convert.ToString(z[2]) == "Y", segs);
                }
            }
            return d;
        }

        // ── GL_BALANCES of a period by code combination (all companies), saved page by page; the extended trial balance is built from it here ──
        internal const string CCB_TABLE = "CREATE TABLE IF NOT EXISTS fin_gl_ccid_bal (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, currency_code VARCHAR, ccid BIGINT, translated_flag VARCHAR, " +
            "begin_balance_dr DOUBLE, begin_balance_cr DOUBLE, period_net_dr DOUBLE, period_net_cr DOUBLE, fetched_at TIMESTAMP)";
        internal const string CCB_SYNC_TABLE = "CREATE TABLE IF NOT EXISTS fin_gl_ccid_bal_sync (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, currency VARCHAR, rows_read BIGINT, complete BOOLEAN, ms BIGINT, fetched_at TIMESTAMP)";
        private static string CcbWhere(string pod, long ledgerId, string period, string currency, string cur = "currency_code") =>
            " WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND " + cur + " = " + Lit(currency);
        /// <summary>(rows, read at) when the period's balances are complete on this PC, else null.</summary>
        public static (long Rows, string At)? CcidBalComplete(string pod, long ledgerId, string period, string currency)
        {
            if (!File.Exists(DbPath)) return null;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_gl_ccid_bal_sync'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return null;
            var r = Query("SELECT rows_read, CAST(fetched_at AS VARCHAR) FROM fin_gl_ccid_bal_sync" + CcbWhere(pod, ledgerId, period, currency, "currency") + " AND complete", 1);
            return r.Error == null && r.Rows.Count > 0 ? (Convert.ToInt64(r.Rows[0][0]), Convert.ToString(r.Rows[0][1])) : null;
        }
        public static void CcidBalStart(string pod, long ledgerId, string period, string currency)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, CCB_TABLE); Exec(conn, CCB_SYNC_TABLE);
                Exec(conn, "DELETE FROM fin_gl_ccid_bal" + CcbWhere(pod, ledgerId, period, currency));
                Exec(conn, "DELETE FROM fin_gl_ccid_bal_sync" + CcbWhere(pod, ledgerId, period, currency, "currency"));
                Append(conn, "fin_gl_ccid_bal_sync", new List<object[]> { new object[] { pod ?? "", ledgerId, period, currency, 0L, false, 0L, DateTime.Now } });
                Exec(conn, "CHECKPOINT");
            }
        }
        public static void CcidBalPage(string pod, long ledgerId, string period, string currency, IEnumerable<(long Ccid, string Tf, double Bdr, double Bcr, double Ndr, double Ncr)> rows)
        {
            var now = DateTime.Now;
            var list = rows.Select(z => new object[] { pod ?? "", ledgerId, period, currency, z.Ccid, z.Tf, z.Bdr, z.Bcr, z.Ndr, z.Ncr, now }).ToList();
            if (list.Count == 0) return;
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, CCB_TABLE);
                Append(conn, "fin_gl_ccid_bal", list);
                Exec(conn, "UPDATE fin_gl_ccid_bal_sync SET rows_read = rows_read + " + list.Count + CcbWhere(pod, ledgerId, period, currency, "currency"));
                Exec(conn, "CHECKPOINT");
            }
        }
        public static void CcidBalDone(string pod, long ledgerId, string period, string currency, long ms)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, "UPDATE fin_gl_ccid_bal_sync SET complete = TRUE, ms = " + ms + ", fetched_at = now()" + CcbWhere(pod, ledgerId, period, currency, "currency"));
                Exec(conn, "CHECKPOINT");
            }
        }
        /// <summary>Combinations of a period's balances that fin_ccid does not hold yet (they are looked up in Fusion by primary key).</summary>
        public static List<long> CcidMissing(string pod, long ledgerId, string period, string currency, string coaId)
        {
            var r = Query("SELECT DISTINCT b.ccid FROM fin_gl_ccid_bal b" + CcbWhere(pod, ledgerId, period, currency).Replace(" WHERE pod", " WHERE b.pod").Replace(" AND ledger_id", " AND b.ledger_id").Replace(" AND period_name", " AND b.period_name").Replace(" AND currency_code", " AND b.currency_code") +
                          " AND NOT EXISTS (SELECT 1 FROM fin_ccid c WHERE c.coa_id = " + Lit(coaId ?? "") + " AND c.ccid = b.ccid)", 5000000);
            if (r.Error != null && r.Error.Contains("fin_ccid")) r = Query("SELECT DISTINCT ccid FROM fin_gl_ccid_bal" + CcbWhere(pod, ledgerId, period, currency), 5000000);
            return r.Error == null ? r.Rows.Select(z => Convert.ToInt64(z[0])).ToList() : new List<long>();
        }
        /// <summary>
        /// The extended trial balance of a period from the balances by code combination × fin_ccid, for each company: grouped by company × account ×
        /// the chosen segments (summary combinations left out), written to fin_gl_balances_ext + its sync row. Returns (company, rows, combinations without segments).
        /// </summary>
        public static List<(string Company, long Rows, long Unknown)> BuildExtFromCcid(string pod, long ledgerId, string period, string currency, string coaId, string companyCol, string accountCol, List<string> segs, IEnumerable<string> companies, long ms)
        {
            var res = new List<(string, long, long)>();
            string cc = "c." + companyCol.ToLowerInvariant(), ac = "c." + accountCol.ToLowerInvariant();
            string segSel = string.Join(", ", Enumerable.Range(1, 30).Select(i => segs.Contains("SEGMENT" + i, StringComparer.OrdinalIgnoreCase) ? "c.segment" + i : "NULL"));
            string segGrp = string.Join(", ", Enumerable.Range(1, 30).Where(i => segs.Contains("SEGMENT" + i, StringComparer.OrdinalIgnoreCase)).Select(i => "c.segment" + i));
            string bw = " WHERE b.pod = " + Lit(pod ?? "") + " AND b.ledger_id = " + ledgerId + " AND b.period_name = " + Lit(period) + " AND b.currency_code = " + Lit(currency);
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, EXT_TABLE); Exec(conn, EXT_SYNC_TABLE); Exec(conn, EXT_ACCT_TABLE); Exec(conn, CCID_TABLE); Exec(conn, CCB_TABLE);
                foreach (var co in companies.Distinct())
                {
                    string w = " WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND " + CoMatch("company", new[] { co });
                    Exec(conn, "DELETE FROM fin_gl_balances_ext" + w + " AND currency_code = " + Lit(currency));
                    Exec(conn, "DELETE FROM fin_gl_balances_ext_sync" + w + " AND currency = " + Lit(currency));
                    Exec(conn, "DELETE FROM fin_gl_ext_acct_status" + w);
                    Exec(conn, "INSERT INTO fin_gl_balances_ext (pod, ledger_id, period_name, currency_code, translated_flag, company, account, account_type, " + string.Join(", ", Enumerable.Range(1, 30).Select(i => "segment" + i)) +
                               ", begin_balance_dr, begin_balance_cr, period_net_dr, period_net_cr, fetched_at) " +
                               "SELECT " + Lit(pod ?? "") + ", " + ledgerId + ", " + Lit(period) + ", " + Lit(currency) + ", b.translated_flag, " + cc + ", " + ac + ", MAX(c.account_type), " + segSel +
                               ", SUM(b.begin_balance_dr), SUM(b.begin_balance_cr), SUM(b.period_net_dr), SUM(b.period_net_cr), now() " +
                               "FROM fin_gl_ccid_bal b JOIN fin_ccid c ON c.coa_id = " + Lit(coaId ?? "") + " AND c.ccid = b.ccid" + bw + " AND COALESCE(c.summary_flag, 'N') <> 'Y' AND " + CoMatch(cc, new[] { co }) +
                               " GROUP BY b.translated_flag, " + cc + ", " + ac + (segGrp.Length > 0 ? ", " + segGrp : ""));
                    long n, unknown;
                    using (var c = conn.CreateCommand()) { c.CommandText = "SELECT COUNT(*) FROM fin_gl_balances_ext" + w + " AND currency_code = " + Lit(currency); n = Convert.ToInt64(c.ExecuteScalar()); }
                    using (var c = conn.CreateCommand())
                    {
                        c.CommandText = "SELECT COUNT(DISTINCT b.ccid) FROM fin_gl_ccid_bal b" + bw + " AND NOT EXISTS (SELECT 1 FROM fin_ccid c WHERE c.coa_id = " + Lit(coaId ?? "") + " AND c.ccid = b.ccid)";
                        unknown = Convert.ToInt64(c.ExecuteScalar());
                    }
                    Append(conn, "fin_gl_balances_ext_sync", new List<object[]> { new object[] { pod ?? "", ledgerId, period, currency, co, string.Join(",", segs), n, ms, DateTime.Now } });
                    res.Add((co, n, unknown));
                }
                EnsureExtView(conn);
                Exec(conn, "CHECKPOINT");
            }
            return res;
        }
        internal const string EXT_SYNC_TABLE = "CREATE TABLE IF NOT EXISTS fin_gl_balances_ext_sync (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, currency VARCHAR, company VARCHAR, " +
            "segments VARCHAR, rows_read BIGINT, ms BIGINT, fetched_at TIMESTAMP)";
        /// <summary>fin_gl_ext_v: one row per period × company × account × segments with opening / dr / cr / closing (period_seq from the
        /// trial balance calendar — adjustment periods carry the seq of the period they close; translated 'R' rows left out).</summary>
        internal static void EnsureExtView(DuckDBConnection conn)
        {
            Exec(conn, EXT_TABLE); Exec(conn, TBP_TABLE);
            Exec(conn, "CREATE OR REPLACE VIEW fin_gl_ext_v AS SELECT e.pod, e.ledger_id, t.period_seq, e.period_name, COALESCE(t.adj, FALSE) AS adj, e.currency_code, e.company, e.account, e.account_type, " +
                       string.Join(", ", Enumerable.Range(1, 30).Select(i => "e.segment" + i)) + ", " +
                       "COALESCE(e.begin_balance_dr, 0) - COALESCE(e.begin_balance_cr, 0) AS opening, COALESCE(e.period_net_dr, 0) AS dr, COALESCE(e.period_net_cr, 0) AS cr, " +
                       "COALESCE(e.begin_balance_dr, 0) - COALESCE(e.begin_balance_cr, 0) + COALESCE(e.period_net_dr, 0) - COALESCE(e.period_net_cr, 0) AS closing, e.fetched_at " +
                       "FROM fin_gl_balances_ext e LEFT JOIN (SELECT DISTINCT pod, ledger_id, period_name, period_seq, adj FROM fin_tb_periods) t ON t.pod = e.pod AND t.ledger_id = e.ledger_id AND t.period_name = e.period_name " +
                       "WHERE COALESCE(e.translated_flag, '') <> 'R' AND e.account IS NOT NULL");
        }

        /// <summary>period → company → (segments read, rows, when) of one ledger kept on this PC.</summary>
        public static Dictionary<string, Dictionary<string, (HashSet<string> Segs, long Rows, DateTime At)>> ExtPeriods(string pod, long ledgerId, string currency)
        {
            var d = new Dictionary<string, Dictionary<string, (HashSet<string>, long, DateTime)>>(StringComparer.Ordinal);
            if (!File.Exists(DbPath)) return d;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_gl_balances_ext_sync'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return d;
            var r = Query("SELECT period_name, company, segments, rows_read, CAST(fetched_at AS VARCHAR) FROM fin_gl_balances_ext_sync WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND currency = " + Lit(currency), 200000);
            foreach (var row in r.Rows)
            {
                string n = Convert.ToString(row[0]);
                if (!d.TryGetValue(n, out var m)) d[n] = m = new Dictionary<string, (HashSet<string>, long, DateTime)>(StringComparer.Ordinal);
                var at = DateTime.TryParse(Convert.ToString(row[4]), CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) ? dt : DateTime.MinValue;
                m[Convert.ToString(row[1])] = (new HashSet<string>((Convert.ToString(row[2]) ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries), StringComparer.OrdinalIgnoreCase), Convert.ToInt64(row[3]), at);
            }
            return d;
        }

        /// <summary>Replaces one ledger × period × company of fin_gl_balances_ext with the rows read (columns SEGMENTn as Fusion names them).</summary>
        public static void SaveExt(string pod, long ledgerId, string period, string currency, string company, string companyCol, string accountCol, List<string> segs, List<Dictionary<string, object>> rows, long ms, IList<string> onlyAccounts = null, bool partial = false)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, EXT_TABLE); Exec(conn, EXT_SYNC_TABLE);
                string w = " WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name = " + Lit(period) + " AND " + CoMatch("company", new[] { company });
                bool merge = onlyAccounts != null && onlyAccounts.Count > 0;   // retry of some accounts: replace only their rows, keep the read's sync row
                Exec(conn, "DELETE FROM fin_gl_balances_ext" + w + " AND currency_code = " + Lit(currency) + (merge ? " AND " + CoMatch("account", onlyAccounts) : ""));
                if (!merge) Exec(conn, "DELETE FROM fin_gl_balances_ext_sync" + w + " AND currency = " + Lit(currency));
                // partial = one batch of an account-by-account read saved as it arrives: rows only, the read is sealed (sync row) when complete
                var now = DateTime.Now;
                string Sv(Dictionary<string, object> row, string k) { if (k == null) return null; var v = row.TryGetValue(k.ToUpperInvariant(), out var x) ? x : row.TryGetValue(k, out x) ? x : null; var sv = v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture); return string.IsNullOrEmpty(sv) ? null : sv; }
                object Dv(Dictionary<string, object> row, string k) => double.TryParse(Sv(row, k), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
                // a row without an account and without amounts is not a balance (an empty runner answer read as a row) - never kept
                rows = rows.Where(row => Sv(row, accountCol) != null || new[] { "BEGIN_BALANCE_DR", "BEGIN_BALANCE_CR", "PERIOD_NET_DR", "PERIOD_NET_CR" }.Any(k => Sv(row, k) != null)).ToList();
                Append(conn, "fin_gl_balances_ext", rows.Select(row =>
                {
                    var a = new List<object> { pod ?? "", ledgerId, period, currency, Sv(row, "TRANSLATED_FLAG"), Sv(row, companyCol) ?? company, Sv(row, accountCol), Sv(row, "ACCOUNT_TYPE") };
                    for (int i = 1; i <= 30; i++) a.Add(segs.Contains("SEGMENT" + i) ? Sv(row, "SEGMENT" + i) : null);
                    a.AddRange(new[] { Dv(row, "BEGIN_BALANCE_DR"), Dv(row, "BEGIN_BALANCE_CR"), Dv(row, "PERIOD_NET_DR"), Dv(row, "PERIOD_NET_CR") });
                    a.Add(now);
                    return a.ToArray();
                }).ToList());
                if (partial) { }
                else if (!merge) Append(conn, "fin_gl_balances_ext_sync", new List<object[]> { new object[] { pod ?? "", ledgerId, period, currency, company, string.Join(",", segs), (long)rows.Count, ms, now } });
                else Exec(conn, "UPDATE fin_gl_balances_ext_sync SET rows_read = (SELECT COUNT(*) FROM fin_gl_balances_ext" + w + " AND currency_code = " + Lit(currency) + "), fetched_at = now()" + w + " AND currency = " + Lit(currency));
                EnsureExtView(conn);
                Exec(conn, "CHECKPOINT");
            }
        }

        /// <summary>Extended-segment balances on this PC per pod × ledger × period: companies, segments, rows, when (for the checklist / board).</summary>
        public static object ExtStatus()
        {
            if (!File.Exists(DbPath)) return new { ok = true, rows = Array.Empty<object>() };
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_gl_balances_ext_sync'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return new { ok = true, rows = Array.Empty<object>() };
            var tp = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_tb_periods'", 1);
            bool cal = tp.Error == null && tp.Rows.Count > 0 && Convert.ToInt64(tp.Rows[0][0]) > 0;
            var r = Query("SELECT s.pod, s.ledger_id, s.period_name, " + (cal ? "p.period_seq" : "NULL") + ", s.company, s.segments, s.rows_read, CAST(s.fetched_at AS VARCHAR) FROM fin_gl_balances_ext_sync s " +
                          (cal ? "LEFT JOIN (SELECT DISTINCT pod, ledger_id, period_name, period_seq FROM fin_tb_periods) p ON p.pod = s.pod AND p.ledger_id = s.ledger_id AND p.period_name = s.period_name " : "") +
                          "ORDER BY 2, 4, 5", 200000);
            if (r.Error != null) return new { ok = false, error = r.Error };
            return new { ok = true, rows = r.Rows.Select(z => new { pod = z[0], ledgerId = z[1], period = z[2], seq = z[3], company = z[4], segments = z[5], rows = z[6], at = z[7] }) };
        }

        // ── working capital snapshots (debtors / creditors from the Fusion subledgers, stock on hand) — FinanceWorkingCapital ──
        internal const string WC_PARTIES_TABLE = "CREATE TABLE IF NOT EXISTS fin_wc_parties (pod VARCHAR, kind VARCHAR, snapshot_at TIMESTAMP, bu_id VARCHAR, party_number VARCHAR, party_name VARCHAR, currency VARCHAR, bucket VARCHAR, items BIGINT, amount DOUBLE, amount_entered DOUBLE, oldest_due VARCHAR, on_hold BIGINT)";
        internal const string WC_STOCK_TABLE = "CREATE TABLE IF NOT EXISTS fin_wc_stock (pod VARCHAR, snapshot_at TIMESTAMP, org_id VARCHAR, org_code VARCHAR, item_number VARCHAR, description VARCHAR, subinventory VARCHAR, uom VARCHAR, quantity DOUBLE, unit_cost DOUBLE, value DOUBLE, oldest_receipt VARCHAR, age_days BIGINT)";
        internal const string WC_SNAP_TABLE = "CREATE TABLE IF NOT EXISTS fin_wc_snapshots (pod VARCHAR, kind VARCHAR, snapshot_at TIMESTAMP, rows BIGINT, total DOUBLE, ms BIGINT, capped BOOLEAN, note VARCHAR)";
        internal const string WC_NAMES_TABLE = "CREATE TABLE IF NOT EXISTS fin_wc_names (pod VARCHAR, kind VARCHAR, id VARCHAR, name VARCHAR, read_at TIMESTAMP)";
        internal const string ITEMS_TABLE = "CREATE TABLE IF NOT EXISTS fin_items (pod VARCHAR, org_id VARCHAR, item_id BIGINT, item_number VARCHAR, description VARCHAR, uom VARCHAR, item_type VARCHAR, status VARCHAR, list_price DOUBLE, " +
            "attribute_category VARCHAR, attribute1 VARCHAR, attribute2 VARCHAR, attribute3 VARCHAR, attribute4 VARCHAR, attribute5 VARCHAR, attribute6 VARCHAR, attribute7 VARCHAR, attribute8 VARCHAR, attribute9 VARCHAR, attribute10 VARCHAR, attribute11 VARCHAR, attribute12 VARCHAR, attribute13 VARCHAR, attribute14 VARCHAR, attribute15 VARCHAR, attribute16 VARCHAR, attribute17 VARCHAR, attribute18 VARCHAR, attribute19 VARCHAR, attribute20 VARCHAR, attribute21 VARCHAR, attribute22 VARCHAR, attribute23 VARCHAR, attribute24 VARCHAR, attribute25 VARCHAR, attribute26 VARCHAR, attribute27 VARCHAR, attribute28 VARCHAR, attribute29 VARCHAR, attribute30 VARCHAR, attribute_number1 DOUBLE, attribute_number2 DOUBLE, attribute_number3 DOUBLE, attribute_number4 DOUBLE, attribute_number5 DOUBLE, attribute_number6 DOUBLE, attribute_number7 DOUBLE, attribute_number8 DOUBLE, attribute_number9 DOUBLE, attribute_number10 DOUBLE, attribute_date1 VARCHAR, attribute_date2 VARCHAR, attribute_date3 VARCHAR, attribute_date4 VARCHAR, attribute_date5 VARCHAR, read_at TIMESTAMP)";
        internal const string ITEM_DFF_TABLE = "CREATE TABLE IF NOT EXISTS fin_item_dff (pod VARCHAR, flex_code VARCHAR, context_code VARCHAR, column_name VARCHAR, label VARCHAR, read_at TIMESTAMP)";

        /// <summary>id → name of business units (BU) or inventory organisations (ORG) kept on this PC.</summary>
        public static Dictionary<string, string> WcNames(string pod, string kind)
        {
            var d = new Dictionary<string, string>(StringComparer.Ordinal);
            if (!File.Exists(DbPath)) return d;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_wc_names'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return d;
            foreach (var r in Query("SELECT id, name FROM fin_wc_names WHERE pod = " + Lit(pod ?? "") + " AND kind = " + Lit(kind), 100000).Rows) d[Convert.ToString(r[0])] = Convert.ToString(r[1]);
            return d;
        }
        public static void SaveWcNames(string pod, string kind, Dictionary<string, string> names)
        {
            if (names.Count == 0) return;
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, WC_NAMES_TABLE);
                foreach (var ch in names.Keys.Chunk(500)) Exec(conn, "DELETE FROM fin_wc_names WHERE pod = " + Lit(pod ?? "") + " AND kind = " + Lit(kind) + " AND id IN (" + string.Join(",", ch.Select(Lit)) + ")");
                var now = DateTime.Now;
                Append(conn, "fin_wc_names", names.Select(kv => new object[] { pod ?? "", kind, kv.Key, kv.Value, now }).ToList());
                Exec(conn, "CHECKPOINT");
            }
        }
        /// <summary>Replaces the items of one inventory organisation (rows as the Fusion runner returns them: column names upper case).</summary>
        public static void SaveItems(string pod, string orgId, List<Dictionary<string, object>> rows)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, ITEMS_TABLE);
                Exec(conn, "DELETE FROM fin_items WHERE pod = " + Lit(pod ?? "") + " AND org_id = " + Lit(orgId));
                var now = DateTime.Now;
                string Sv(Dictionary<string, object> r, string k) { var v = r.TryGetValue(k, out var x) ? x : null; var sv = v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture); return string.IsNullOrEmpty(sv) ? null : sv; }
                object Dv(Dictionary<string, object> r, string k) => double.TryParse(Sv(r, k), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
                Append(conn, "fin_items", rows.Select(r =>
                {
                    var a = new List<object> { pod ?? "", orgId, long.TryParse(Sv(r, "INVENTORY_ITEM_ID"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) ? id : null, Sv(r, "ITEM_NUMBER"), Sv(r, "DESCRIPTION"),
                                                Sv(r, "PRIMARY_UOM_CODE"), Sv(r, "ITEM_TYPE"), Sv(r, "INVENTORY_ITEM_STATUS_CODE"), Dv(r, "LIST_PRICE_PER_UNIT"), Sv(r, "ATTRIBUTE_CATEGORY") };
                    for (int i = 1; i <= 30; i++) a.Add(Sv(r, "ATTRIBUTE" + i));
                    for (int i = 1; i <= 10; i++) a.Add(Dv(r, "ATTRIBUTE_NUMBER" + i));
                    for (int i = 1; i <= 5; i++) a.Add(Sv(r, "ATTRIBUTE_DATE" + i));
                    a.Add(now);
                    return a.ToArray();
                }).ToList());
                Exec(conn, "CHECKPOINT");
            }
        }
        public static void SaveItemDff(string pod, IEnumerable<(string Flex, string Ctx, string Col, string Label)> labels)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, ITEM_DFF_TABLE);
                Exec(conn, "DELETE FROM fin_item_dff WHERE pod = " + Lit(pod ?? ""));
                var now = DateTime.Now;
                Append(conn, "fin_item_dff", labels.Select(l => new object[] { pod ?? "", l.Flex, l.Ctx, (l.Col ?? "").ToUpperInvariant(), l.Label, now }).ToList());
                Exec(conn, "CHECKPOINT");
            }
        }

        // ═════ customer / supplier history kept on this PC (FinanceWorkingCapital.HistoryAsync) ═════
        internal const string WC_HISTORY_TABLE = "CREATE TABLE IF NOT EXISTS fin_wc_history (pod VARCHAR, kind VARCHAR, party VARCHAR, section VARCHAR, months INTEGER, fetched_at TIMESTAMP, ms BIGINT, ok BOOLEAN, error VARCHAR, sql VARCHAR, alt INTEGER, capped BOOLEAN, columns_json VARCHAR, rows_json VARCHAR)";
        /// <summary>Raised when the history queries change, so a party read with the older queries is read from Fusion again once.</summary>
        public const int HISTORY_VERSION = 2;
        public sealed class HistorySection
        {
            public string Name; public bool Ok; public string Error; public string Sql; public int Alt; public bool Capped; public long Ms;
            public List<string> Columns = new(); public List<object[]> Rows = new();
        }
        public static void SaveHistory(string pod, string kind, string party, int months, DateTime at, List<HistorySection> sections)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, WC_HISTORY_TABLE);
                Exec(conn, "ALTER TABLE fin_wc_history ADD COLUMN IF NOT EXISTS ver INTEGER");
                Exec(conn, "DELETE FROM fin_wc_history WHERE pod = " + Lit(pod ?? "") + " AND kind = " + Lit(kind) + " AND party = " + Lit(party));
                Append(conn, "fin_wc_history", sections.Select(x => new object[] { pod ?? "", kind, party, x.Name, months, at, x.Ms, x.Ok, x.Error, x.Sql, x.Alt, x.Capped,
                    JsonSerializer.Serialize(x.Columns), JsonSerializer.Serialize(x.Rows), HISTORY_VERSION }).ToList());
                Exec(conn, "CHECKPOINT");
            }
        }
        public static object LoadHistory(string pod, string kind, string party)
        {
            if (!File.Exists(DbPath)) return null;
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_wc_history'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return null;
            var hasVer = Query("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'fin_wc_history' AND column_name = 'ver'", 1);
            if (hasVer.Error != null || hasVer.Rows.Count == 0 || Convert.ToInt64(hasVer.Rows[0][0]) == 0) return null;   // read with the first queries — read again
            var q = Query("SELECT section, months, CAST(fetched_at AS VARCHAR), ms, ok, error, sql, alt, capped, columns_json, rows_json FROM fin_wc_history WHERE pod = " + Lit(pod ?? "") + " AND kind = " + Lit(kind) + " AND party = " + Lit(party) + " AND COALESCE(ver, 0) >= " + HISTORY_VERSION, 100);
            if (q.Error != null || q.Rows.Count == 0) return null;
            var secs = q.Rows.Select(r => new HistorySection
            {
                Name = Convert.ToString(r[0]), Ms = Convert.ToInt64(r[3] ?? 0L), Ok = r[4] is bool b && b, Error = r[5] as string, Sql = r[6] as string, Alt = Convert.ToInt32(r[7] ?? 0), Capped = r[8] is bool c && c,
                Columns = JsonSerializer.Deserialize<List<string>>(Convert.ToString(r[9]) ?? "[]") ?? new(),
                Rows = (JsonSerializer.Deserialize<List<JsonElement[]>>(Convert.ToString(r[10]) ?? "[]") ?? new()).Select(a => a.Select(JsonValue).ToArray()).ToList()
            }).ToList();
            DateTime.TryParse(Convert.ToString(q.Rows[0][2]), CultureInfo.InvariantCulture, DateTimeStyles.None, out var at);
            return HistoryReply(kind, party, Convert.ToInt32(q.Rows[0][1] ?? 24), at, secs, true, 0);
        }
        private static object JsonValue(JsonElement e) => e.ValueKind switch
        {
            JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
            JsonValueKind.String => e.GetString(),
            JsonValueKind.True => true, JsonValueKind.False => false,
            _ => null
        };
        public static object HistoryReply(string kind, string party, int months, DateTime at, List<HistorySection> sections, bool fromCache, long ms) => new
        {
            ok = true, kind, party, months, fromCache, ms, fetchedAt = at.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            sections = sections.ToDictionary(x => x.Name, x => (object)new { ok = x.Ok, error = x.Error, sql = x.Sql, alt = x.Alt, capped = x.Capped, ms = x.Ms, columns = x.Columns, rows = x.Rows })
        };

        /// <summary>Saves one snapshot of a kind (AR | AP | INV) — rows already shaped as the table's columns after pod / kind / snapshot_at;
        /// keeps the last <paramref name="keep"/> snapshots of that kind for the trend.</summary>
        public static void SaveWc(string pod, string kind, DateTime at, List<object[]> rows, double total, long ms, bool capped, string note, int keep = 36)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, WC_PARTIES_TABLE); Exec(conn, WC_STOCK_TABLE); Exec(conn, WC_SNAP_TABLE);
                bool stock = kind == "INV";
                Append(conn, stock ? "fin_wc_stock" : "fin_wc_parties", rows.Select(r => (stock ? new object[] { pod ?? "", at } : new object[] { pod ?? "", kind, at }).Concat(r).ToArray()).ToList());
                Append(conn, "fin_wc_snapshots", new List<object[]> { new object[] { pod ?? "", kind, at, (long)rows.Count, total, ms, capped, note ?? "" } });
                // older snapshots beyond `keep` go (the trend keeps the snapshot totals in fin_wc_snapshots)
                string w = "pod = " + Lit(pod ?? "") + " AND kind = " + Lit(kind);
                Exec(conn, "DELETE FROM " + (stock ? "fin_wc_stock WHERE pod = " + Lit(pod ?? "") : "fin_wc_parties WHERE " + w) + " AND snapshot_at NOT IN (SELECT snapshot_at FROM fin_wc_snapshots WHERE " + w + " ORDER BY snapshot_at DESC LIMIT " + Math.Max(1, keep) + ")");
                Exec(conn, "CHECKPOINT");
            }
        }

        /// <summary>The kept account rows of some periods (one ledger, grain).</summary>
        public static List<FinanceFusion.AcctRow> LoadAcct(string pod, long ledgerId, string currency, string grain, IEnumerable<string> periods)
        {
            var list = new List<FinanceFusion.AcctRow>();
            var names = periods.Distinct().ToList();
            if (names.Count == 0 || !File.Exists(DbPath)) return list;
            lock (_lock)
            {
                ResetSessionNoLock();
                using var conn = new DuckDBConnection("Data Source=" + DbPath);
                conn.Open();
                var cols = TableColumns(conn, "fin_gl_balances_acct");
                if (cols.Count == 0) return list;
                using var c = conn.CreateCommand();
                c.CommandText = "SELECT period_name, company, account, cost_centre, translated_flag, account_type, begin_balance_dr, begin_balance_cr, period_net_dr, period_net_cr FROM fin_gl_balances_acct WHERE pod = " + Lit(pod ?? "") +
                                " AND ledger_id = " + ledgerId + " AND currency_code = " + Lit(currency) + " AND grain = " + Lit(grain) + " AND period_name IN (" + string.Join(",", names.Select(Lit)) + ")";
                using var r = c.ExecuteReader();
                double N(int i) => r.IsDBNull(i) ? 0 : Convert.ToDouble(r.GetValue(i), CultureInfo.InvariantCulture);
                string T(int i) => r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture);
                while (r.Read()) list.Add(new FinanceFusion.AcctRow { Period = T(0), Co = T(1), Ac = T(2), Cc = T(3), Tf = T(4), Type = T(5), Bdr = N(6), Bcr = N(7), Ndr = N(8), Ncr = N(9) });
            }
            return list.Where(z => z.Co != null && z.Ac != null).ToList();
        }

        // ── trial balances synced from Fusion → the tables the statements read (when no full load is on this PC) ──
        internal const string TBP_TABLE = "CREATE TABLE IF NOT EXISTS fin_tb_periods (pod VARCHAR, ledger_id BIGINT, period_name VARCHAR, period_seq INTEGER, fiscal_year INTEGER, period_num INTEGER, quarter INTEGER, " +
            "start_date DATE, end_date DATE, adj BOOLEAN)";
        internal const string TBL_TABLE = "CREATE TABLE IF NOT EXISTS fin_tb_ledgers (pod VARCHAR, ledger_id BIGINT, code VARCHAR, name VARCHAR, currency VARCHAR, coa_id VARCHAR, company_segment VARCHAR, " +
            "cost_centre_segment VARCHAR, account_segment VARCHAR, category VARCHAR, company_names VARCHAR)";

        /// <summary>Remembers the ledger and the calendar of the periods a trial balance sync read (period_seq = the normal period an adjustment period folds into).</summary>
        public static void SaveTbCalendar(string pod, FinanceFusion.SyncLedger led, IEnumerable<(string Name, int Seq, int Year, int Num, int Quarter, string Start, string End, bool Adj)> periods)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, TBP_TABLE); Exec(conn, TBL_TABLE);
                var list = periods.ToList();
                Exec(conn, "DELETE FROM fin_tb_periods WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + led.Id + " AND period_name IN (" + string.Join(",", list.Select(p => Lit(p.Name)).DefaultIfEmpty("''")) + ")");
                object D(string v) => DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? DateOnly.FromDateTime(d) : null;
                Append(conn, "fin_tb_periods", list.Select(p => new object[] { pod ?? "", led.Id, p.Name, p.Seq, p.Year, p.Num, p.Quarter > 0 ? p.Quarter : (p.Num - 1) / 3 + 1, D(p.Start), D(p.End), p.Adj }).ToList());
                Exec(conn, "DELETE FROM fin_tb_ledgers WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + led.Id);
                Append(conn, "fin_tb_ledgers", new List<object[]> { new object[] { pod ?? "", led.Id, string.IsNullOrEmpty(led.Code) ? led.Id.ToString(CultureInfo.InvariantCulture) : led.Code, led.Name, led.Currency, led.CoaId,
                    led.Company, led.CostCentre, led.Account, led.Category, JsonSerializer.Serialize(led.CompanyNames ?? new()) } });
                Exec(conn, "CHECKPOINT");
            }
        }

        /// <summary>
        /// Builds fin_balances (ACTUAL), fin_periods, fin_companies, fin_cost_centres, fin_accounts, fin_ledgers, fin_segments and fin_meta
        /// (source FUSION_TB) from the trial balances synced for a pod (fin_gl_balances_acct): per normal period opening = its begin balance,
        /// debits / credits = the period's plus its adjustment periods', closing = opening + net; translated_flag 'R' rows left out; per
        /// ledger × period the finest grain read (with cost centre when there is one). Never over a full SQL / BICC load.
        /// </summary>
        public static object BuildFromTb(string pod, Action<string> note)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                string Scalar(string sql) { using var c = conn.CreateCommand(); c.CommandText = sql; var v = c.ExecuteScalar(); return v == null || v is DBNull ? null : Convert.ToString(v, CultureInfo.InvariantCulture); }
                bool Has(string t) => Convert.ToInt64(Scalar("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'main' AND table_name = " + Lit(t))) > 0;
                string src = Has("fin_meta") ? Scalar("SELECT MAX(value) FROM fin_meta WHERE key = 'source'") : null;
                if (src != null && src != "FUSION_TB") { note?.Invoke("The statements keep using the full load on this PC (" + src + ") - the trial balances are kept beside it."); return new { built = false, reason = "full load" }; }
                if (!Has("fin_gl_balances_acct") || !Has("fin_tb_periods") || !Has("fin_tb_ledgers")) return new { built = false, reason = "nothing synced" };
                Exec(conn, SEGVAL_TABLE);
                foreach (var t in new[] { "fin_meta", "fin_ledgers", "fin_segments", "fin_companies", "fin_cost_centres", "fin_accounts", "fin_periods", "fin_balances", "fin_journals" }) Exec(conn, "DROP TABLE IF EXISTS " + t);
                foreach (var stmt in SCHEMA.Split(';').Select(z => z.Trim()).Where(z => z.Length > 0))
                    Exec(conn, stmt.Replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "));
                string P = Lit(pod ?? "");
                Exec(conn, "CREATE OR REPLACE TEMP TABLE tb_rows AS SELECT l.code AS ledger, a.ledger_id, a.grain, a.period_name, t.period_seq, t.adj, a.company, COALESCE(NULLIF(a.cost_centre, ''), '-') AS cc, a.account, " +
                           "COALESCE(a.begin_balance_dr, 0) - COALESCE(a.begin_balance_cr, 0) AS b0, COALESCE(a.period_net_dr, 0) AS ndr, COALESCE(a.period_net_cr, 0) AS ncr, a.account_type " +
                           "FROM fin_gl_balances_acct a JOIN fin_tb_periods t ON t.pod = a.pod AND t.ledger_id = a.ledger_id AND t.period_name = a.period_name " +
                           "JOIN fin_tb_ledgers l ON l.pod = a.pod AND l.ledger_id = a.ledger_id AND l.currency = a.currency_code " +
                           "WHERE a.pod = " + P + " AND COALESCE(a.translated_flag, '-') <> 'R' AND a.company IS NOT NULL AND a.account IS NOT NULL");
                Exec(conn, "CREATE OR REPLACE TEMP TABLE tb_pick AS SELECT ledger, period_seq, MAX(grain) AS grain FROM tb_rows WHERE NOT adj GROUP BY ledger, period_seq");
                Exec(conn, "INSERT INTO fin_balances SELECT 'ACTUAL', r.company, r.cc, r.account, MAX(r.period_name) FILTER (WHERE NOT r.adj), r.period_seq, " +
                           "SUM(CASE WHEN NOT r.adj THEN r.b0 ELSE 0 END), SUM(r.ndr), SUM(r.ncr), SUM(r.ndr - r.ncr), SUM(CASE WHEN NOT r.adj THEN r.b0 ELSE 0 END) + SUM(r.ndr - r.ncr), r.ledger " +
                           "FROM tb_rows r JOIN tb_pick p ON p.ledger = r.ledger AND p.period_seq = r.period_seq AND p.grain = r.grain " +
                           "GROUP BY r.ledger, r.company, r.cc, r.account, r.period_seq HAVING BOOL_OR(NOT r.adj)");
                Exec(conn, "INSERT INTO fin_periods SELECT period_name, period_seq, ANY_VALUE(fiscal_year), ANY_VALUE(period_num), ANY_VALUE(quarter), ANY_VALUE(start_date), ANY_VALUE(end_date) FROM fin_tb_periods " +
                           "WHERE pod = " + P + " AND NOT adj AND period_seq IN (SELECT DISTINCT period_seq FROM fin_balances) GROUP BY period_name, period_seq");
                // ledgers of this pod that have balances
                var leds = new List<(string Code, string Name, string Ccy, string Coa, string Co, string Cc, string Ac, string Cat, string Names)>();
                using (var c = conn.CreateCommand())
                {
                    c.CommandText = "SELECT code, ANY_VALUE(name), ANY_VALUE(currency), ANY_VALUE(coa_id), ANY_VALUE(company_segment), ANY_VALUE(cost_centre_segment), ANY_VALUE(account_segment), ANY_VALUE(category), ANY_VALUE(company_names) " +
                                    "FROM fin_tb_ledgers WHERE pod = " + P + " AND code IN (SELECT DISTINCT ledger FROM fin_balances) GROUP BY code ORDER BY code";
                    using var r = c.ExecuteReader();
                    string T(int i) => r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), CultureInfo.InvariantCulture);
                    while (r.Read()) leds.Add((T(0), T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(8)));
                }
                if (leds.Count == 0) { Exec(conn, "CHECKPOINT"); note?.Invoke("No synced trial balance for this pod yet."); return new { built = false, reason = "nothing synced" }; }
                var lead = leds[0];
                Append(conn, "fin_ledgers", leds.Select(l => new object[] { l.Code, l.Name, l.Ccy, l.Coa, l.Co, l.Cc, l.Ac, l.Cat }).ToList());
                Append(conn, "fin_segments", new List<object[]> {
                    new object[] { 1, "COMPANY", "Company (" + lead.Co + ")", lead.Co }, new object[] { 2, "COST_CENTRE", "Cost centre (" + (lead.Cc ?? "none") + ")", lead.Cc },
                    new object[] { 3, "ACCOUNT", "Account (" + lead.Ac + ")", lead.Ac } });
                List<string> Distinct(string sql) { var l = new List<string>(); using var c = conn.CreateCommand(); c.CommandText = sql; using var r = c.ExecuteReader(); while (r.Read()) if (!r.IsDBNull(0)) l.Add(Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture)); return l; }
                // names from this file's segment values (and the ledger's legal entities), read with this connection
                Dictionary<string, string> Names(string coa, string col)
                {
                    var d = new Dictionary<string, string>(StringComparer.Ordinal);
                    if (string.IsNullOrEmpty(col)) return d;
                    using var c = conn.CreateCommand();
                    c.CommandText = "SELECT value, ANY_VALUE(description) FROM fin_segment_values WHERE coa_id = " + Lit(coa ?? "") + " AND column_name = " + Lit(col) + " AND description IS NOT NULL GROUP BY value";
                    using var r = c.ExecuteReader(); while (r.Read()) d[Convert.ToString(r.GetValue(0))] = Convert.ToString(r.GetValue(1));
                    var pend = PendingSegValues(coa, col);
                    if (pend?.Values != null) foreach (var v in pend.Values) if (!string.IsNullOrEmpty(v.Description)) d.TryAdd(v.Value, v.Description);
                    return d;
                }
                var coNames = Names(lead.Coa, lead.Co);
                foreach (var l in leds) { try { foreach (var kv in JsonSerializer.Deserialize<Dictionary<string, string>>(l.Names ?? "{}") ?? new()) if (!string.IsNullOrEmpty(kv.Value)) coNames.TryAdd(kv.Key, kv.Value); } catch { } }
                var coCcy = new Dictionary<string, string>();
                using (var c = conn.CreateCommand())
                {
                    c.CommandText = "SELECT b.company, ANY_VALUE(l.currency) FROM fin_balances b JOIN fin_ledgers l ON l.code = b.ledger GROUP BY b.company";
                    using var r = c.ExecuteReader(); while (r.Read()) coCcy[Convert.ToString(r.GetValue(0))] = r.IsDBNull(1) ? null : Convert.ToString(r.GetValue(1));
                }
                Append(conn, "fin_companies", Distinct("SELECT DISTINCT company FROM fin_balances ORDER BY 1").Select(v => new object[] { v, coNames.TryGetValue(v, out var n) ? n : v, coCcy.TryGetValue(v, out var cy) ? cy : lead.Ccy }).ToList());
                var ccNames = Names(lead.Coa, lead.Cc);
                Append(conn, "fin_cost_centres", Distinct("SELECT DISTINCT cost_centre FROM fin_balances ORDER BY 1").Select(v => new object[] { v, v == "-" ? "(all cost centres)" : ccNames.TryGetValue(v, out var n) ? n : v, null }).ToList());
                var acNames = Names(lead.Coa, lead.Ac);
                var types = new Dictionary<string, string>(StringComparer.Ordinal);
                using (var c = conn.CreateCommand())
                {
                    c.CommandText = "SELECT account, MODE(account_type) FROM tb_rows WHERE account_type IS NOT NULL GROUP BY account";
                    using var r = c.ExecuteReader(); while (r.Read()) types[Convert.ToString(r.GetValue(0))] = Convert.ToString(r.GetValue(1));
                }
                using (var c = conn.CreateCommand())
                {   // the account segment's values read on this PC (Data › Chart of accounts) carry the account type too
                    c.CommandText = "SELECT value, ANY_VALUE(account_type) FROM fin_segment_values WHERE coa_id = " + Lit(lead.Coa ?? "") + " AND column_name = " + Lit(lead.Ac ?? "") + " AND account_type IS NOT NULL GROUP BY value";
                    using var r = c.ExecuteReader(); while (r.Read()) types.TryAdd(Convert.ToString(r.GetValue(0)), OneType(Convert.ToString(r.GetValue(1))));
                }
                { var pend = PendingSegValues(lead.Coa, lead.Ac); if (pend?.Values != null) foreach (var v in pend.Values) if (!string.IsNullOrEmpty(v.AccountType)) types.TryAdd(v.Value, OneType(v.AccountType)); }
                if (Has("fin_ccid") && Regex.IsMatch(lead.Ac ?? "", "^SEGMENT([1-9]|[12][0-9]|30)$", RegexOptions.IgnoreCase))
                    using (var c = conn.CreateCommand())
                    {
                        c.CommandText = "SELECT " + lead.Ac.ToLowerInvariant() + ", MODE(account_type) FROM fin_ccid WHERE coa_id = " + Lit(lead.Coa ?? "") + " AND account_type IS NOT NULL GROUP BY 1";
                        using var r = c.ExecuteReader(); while (r.Read()) if (!r.IsDBNull(0)) types.TryAdd(Convert.ToString(r.GetValue(0)), Convert.ToString(r.GetValue(1)));
                    }
                var cls = new Dictionary<string, string>(StringComparer.Ordinal);
                if (Has("fin_account_map"))
                    using (var c = conn.CreateCommand())
                    {   // the user's mapping first, then the page's earlier guesses
                        c.CommandText = "SELECT code, class FROM fin_account_map WHERE class IS NOT NULL ORDER BY CASE source WHEN 'USER' THEN 0 ELSE 1 END";
                        using var r = c.ExecuteReader(); while (r.Read()) cls.TryAdd(Convert.ToString(r.GetValue(0)), Convert.ToString(r.GetValue(1)));
                    }
                Append(conn, "fin_accounts", Distinct("SELECT DISTINCT account FROM fin_balances ORDER BY 1").Select(v => new object[] { v, acNames.TryGetValue(v, out var n) ? n : v, types.TryGetValue(v, out var t) ? t : null, cls.TryGetValue(v, out var k) ? k : null, null }).ToList());
                string first = Scalar("SELECT MIN(period_seq) FROM fin_periods"), last = Scalar("SELECT MAX(period_seq) FROM fin_periods");
                Append(conn, "fin_meta", new List<object[]>
                {
                    new object[] { "source", "FUSION_TB" }, new object[] { "loader", "TB" }, new object[] { "pod", pod ?? "" }, new object[] { "loaded_at", DateTime.Now.ToString("s") },
                    new object[] { "currency", lead.Ccy }, new object[] { "currencies", string.Join(",", leds.Select(l => l.Ccy).Distinct()) },
                    new object[] { "description", "Trial balances synced from Oracle Fusion: " + string.Join(", ", leds.Select(l => l.Name)) },
                    new object[] { "from_seq", first ?? "" }, new object[] { "to_seq", last ?? "" }, new object[] { "budget", "" }, new object[] { "load_mode", "TB" }
                });
                long nBal = Convert.ToInt64(Scalar("SELECT COUNT(*) FROM fin_balances")), nPer = Convert.ToInt64(Scalar("SELECT COUNT(*) FROM fin_periods"));
                Exec(conn, "DROP TABLE IF EXISTS tb_rows"); Exec(conn, "DROP TABLE IF EXISTS tb_pick");
                Exec(conn, "CHECKPOINT");
                note?.Invoke("✓ Statements data rebuilt from the synced trial balances: " + nPer + " period(s), " + nBal.ToString("N0", CultureInfo.InvariantCulture) + " balances, " + leds.Count + " ledger(s).");
                return new { built = true, periods = nPer, balances = nBal, ledgers = leds.Count };
            }
        }

        /// <summary>A segment value whose combinations carry two account types reads "A/L": the first one is used (A / L / O / R / E).</summary>
        private static string OneType(string t) { t = (t ?? "").Trim(); int i = t.IndexOf('/'); return i > 0 ? t.Substring(0, i) : t.Length == 0 ? null : t; }

        /// <summary>When the statements come from synced trial balances, builds them again (after names / types were read).</summary>
        public static object RebuildTbIfActive()
        {
            if (!File.Exists(DbPath)) return new { built = false, reason = "no data" };
            var m = Query("SELECT key, value FROM fin_meta WHERE key IN ('source', 'pod')", 10);
            if (m.Error != null) return new { built = false, reason = m.Error };
            string src = null, pod = "";
            foreach (var r in m.Rows) { if (Convert.ToString(r[0]) == "source") src = Convert.ToString(r[1]); else pod = Convert.ToString(r[1]); }
            return src == "FUSION_TB" ? BuildFromTb(pod, null) : new { built = false, reason = src ?? "no data" };
        }

        /// <summary>Synced trial balance periods: pod, ledger, period, grain, companies, rows, read at — and whether they feed the statements.</summary>
        public static object TbSyncStatus()
        {
            if (!File.Exists(DbPath)) return new { ok = true, rows = new List<object>() };
            var t = Query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('fin_gl_balances_acct_sync', 'fin_tb_periods', 'fin_tb_ledgers', 'fin_meta')", 10);
            var have = new HashSet<string>(t.Error == null ? t.Rows.Select(r => Convert.ToString(r[0])) : Enumerable.Empty<string>());
            if (!have.Contains("fin_gl_balances_acct_sync")) return new { ok = true, rows = new List<object>() };
            bool cal = have.Contains("fin_tb_periods") && have.Contains("fin_tb_ledgers");
            var q = Query("SELECT s.pod, s.ledger_id, " + (cal ? "ANY_VALUE(l.code), ANY_VALUE(l.name)" : "NULL, NULL") + ", s.period_name, " + (cal ? "ANY_VALUE(p.period_seq), BOOL_OR(p.adj)" : "NULL, NULL") + ", s.grain, " +
                          "CASE WHEN BOOL_OR(s.company = '*') THEN '*' ELSE STRING_AGG(DISTINCT s.company, ',' ORDER BY s.company) END, SUM(s.rows_read), CAST(MAX(s.fetched_at) AS VARCHAR), SUM(s.ms), s.currency " +
                          "FROM fin_gl_balances_acct_sync s" + (cal ? " LEFT JOIN fin_tb_ledgers l ON l.pod = s.pod AND l.ledger_id = s.ledger_id LEFT JOIN fin_tb_periods p ON p.pod = s.pod AND p.ledger_id = s.ledger_id AND p.period_name = s.period_name" : "") +
                          " GROUP BY s.pod, s.ledger_id, s.period_name, s.grain, s.currency ORDER BY 6 DESC NULLS LAST, 5", 5000);
            string src = have.Contains("fin_meta") ? Convert.ToString(Query("SELECT MAX(value) FROM fin_meta WHERE key = 'source'", 1).Rows.FirstOrDefault()?[0]) : null;
            return new
            {
                ok = true, statementsFrom = string.IsNullOrEmpty(src) ? "none" : src, error = q.Error,
                rows = (q.Rows ?? new()).Select(r => new { pod = r[0], ledgerId = r[1], ledger = r[2], ledgerName = r[3], period = r[4], seq = r[5], adj = r[6], grain = r[7], companies = r[8], rows = r[9], at = r[10], ms = r[11], currency = r[12] }).ToList()
            };
        }

        /// <summary>Removes synced trial balance periods (pod × ledger × periods) and rebuilds the statements data.</summary>
        public static object TbSyncDelete(string pod, long ledgerId, List<string> periods)
        {
            if (!File.Exists(DbPath) || periods == null || periods.Count == 0) return new { ok = true, removed = 0 };
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, ACCT_SYNC_TABLE); Exec(conn, TBP_TABLE);
                string w = " WHERE pod = " + Lit(pod ?? "") + " AND ledger_id = " + ledgerId + " AND period_name IN (" + string.Join(",", periods.Select(Lit)) + ")";
                Exec(conn, "DELETE FROM fin_gl_balances_acct_sync" + w);
                Exec(conn, EXT_TABLE); Exec(conn, EXT_SYNC_TABLE);
                Exec(conn, "DELETE FROM fin_gl_balances_ext" + w); Exec(conn, "DELETE FROM fin_gl_balances_ext_sync" + w);
                Exec(conn, EXT_ACCT_TABLE); Exec(conn, "DELETE FROM fin_gl_ext_acct_status" + w);
                Exec(conn, CCB_TABLE); Exec(conn, CCB_SYNC_TABLE); Exec(conn, "DELETE FROM fin_gl_ccid_bal" + w); Exec(conn, "DELETE FROM fin_gl_ccid_bal_sync" + w);
                using (var c = conn.CreateCommand()) { c.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_gl_balances_acct'"; if (Convert.ToInt64(c.ExecuteScalar()) > 0) Exec(conn, "DELETE FROM fin_gl_balances_acct" + w); }
                Exec(conn, "CHECKPOINT");
            }
            BuildFromTb(pod, null);
            return new { ok = true, removed = periods.Count };
        }

        /// <summary>Adds code combinations to fin_ccid (so they can be queried with the raw balances in the SQL explorer).</summary>
        public static void SaveCcids(string coaId, IEnumerable<(long Id, string Type, bool Summary, Dictionary<string, string> Segs)> items)
        {
            var rows = items.Select(it =>
            {
                var r = new object[34]; r[0] = coaId ?? ""; r[1] = it.Id; r[2] = it.Type; r[3] = it.Summary ? "Y" : "N";
                for (int i = 1; i <= 30; i++) r[3 + i] = it.Segs.TryGetValue("SEGMENT" + i, out var v) ? v : null;
                return r;
            }).ToList();
            if (rows.Count == 0) return;
            lock (_lock)
            {
                using var conn = OpenWrite();
                foreach (var chunk in rows.Chunk(1000))
                    Exec(conn, "DELETE FROM fin_ccid WHERE coa_id = " + Lit(coaId ?? "") + " AND ccid IN (" + string.Join(",", chunk.Select(r => Convert.ToString(r[1], CultureInfo.InvariantCulture))) + ")");
                Append(conn, "fin_ccid", rows);
                Exec(conn, "CHECKPOINT");
            }
        }

        /// <summary>Copies tables a new finance file must keep from the old one (segment values, live trial balances).</summary>
        internal static void CarryOver(DuckDBConnection conn, Action<string> note)
        {
            if (!File.Exists(DbPath)) return;
            try
            {
                Exec(conn, SEGVAL_TABLE); Exec(conn, TB_TABLE); Exec(conn, RAW_SYNC_TABLE); Exec(conn, CCID_TABLE); Exec(conn, ACCT_SYNC_TABLE); Exec(conn, TBP_TABLE); Exec(conn, TBL_TABLE);
                Exec(conn, WC_PARTIES_TABLE); Exec(conn, WC_STOCK_TABLE); Exec(conn, WC_SNAP_TABLE); Exec(conn, EXT_TABLE); Exec(conn, EXT_SYNC_TABLE); Exec(conn, EXT_ACCT_TABLE); Exec(conn, CCID_SYNC_TABLE); Exec(conn, CCB_TABLE); Exec(conn, CCB_SYNC_TABLE);
                Exec(conn, WC_NAMES_TABLE); Exec(conn, ITEMS_TABLE); Exec(conn, ITEM_DFF_TABLE); EnsurePlanTables(conn); EnsureIcTables(conn);
                Exec(conn, "ATTACH " + Lit(DbPath.Replace('\\', '/')) + " AS prev (READ_ONLY)");
                try
                {
                    foreach (var t in new[] { "fin_segment_values", "fin_tb_live", "fin_gl_balances_sync", "fin_ccid", "fin_gl_balances", "fin_gl_balances_acct_sync", "fin_gl_balances_acct", "fin_tb_periods", "fin_tb_ledgers", "fin_wc_parties", "fin_wc_stock", "fin_wc_snapshots", "fin_gl_balances_ext", "fin_gl_balances_ext_sync", "fin_gl_ext_acct_status", "fin_ccid_sync", "fin_gl_ccid_bal", "fin_gl_ccid_bal_sync", "fin_wc_names", "fin_items", "fin_item_dff", "fin_wc_history", "fin_plan_versions", "fin_plan_lines", "fin_plan_amounts", "rr_ic_sync", "rr_ic_entities", "rr_ic_bal", "rr_ic_fun", "rr_ic_ar", "rr_ic_ap", "rr_ic_inv", "rr_ic_gl", "rr_ic_xla", "rr_ic_docs", "rr_ic_log" })
                    {
                        using var c = conn.CreateCommand();
                        c.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_catalog = 'prev' AND table_name = '" + t + "'";
                        if (Convert.ToInt64(c.ExecuteScalar()) == 0) continue;
                        // fin_gl_balances has the pod's own columns: copied whole (its layout comes with it)
                        if (t == "fin_gl_balances" || t == "fin_gl_balances_acct") Exec(conn, "CREATE TABLE " + t + " AS SELECT * FROM prev." + t);
                        else
                        {   // by name: a table that gained a column since (e.g. segments) still copies; one table failing never stops the others
                            try { Exec(conn, "INSERT INTO " + t + " BY NAME SELECT * FROM prev." + t); }
                            catch (Exception ex1) { note?.Invoke("⚠ " + t + " not kept: " + ex1.Message); }
                        }
                    }
                }
                finally { Exec(conn, "DETACH prev"); }
                EnsureExtView(conn);
            }
            catch (Exception ex) { note?.Invoke("⚠ earlier segment values / trial balances not kept: " + ex.Message); }
        }

        /// <summary>value → description of one segment from this PC: fin_segment_values, the loaded dimension (fin_accounts /
        /// fin_companies / fin_cost_centres for the ledger's segments) or values kept before the first load.</summary>
        public static Dictionary<string, string> SegmentNames(string coaId, string column)
        {
            var d = new Dictionary<string, string>(StringComparer.Ordinal);
            if (string.IsNullOrEmpty(column)) return d;
            if (File.Exists(DbPath))
            {
                var t = Query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('fin_segment_values', 'fin_ledgers', 'fin_accounts')", 10);
                var have = new HashSet<string>(t.Error == null ? t.Rows.Select(r => Convert.ToString(r[0])) : Enumerable.Empty<string>());
                if (have.Contains("fin_segment_values"))
                    foreach (var r in Query("SELECT value, ANY_VALUE(description) FROM fin_segment_values WHERE coa_id = " + Lit(coaId) + " AND column_name = " + Lit(column) + " AND description IS NOT NULL GROUP BY value", 500000).Rows)
                        d[Convert.ToString(r[0])] = Convert.ToString(r[1]);
                if (have.Contains("fin_ledgers"))
                {
                    var l = Query("SELECT MAX(CASE WHEN account_segment = " + Lit(column) + " THEN 1 END), MAX(CASE WHEN company_segment = " + Lit(column) + " THEN 1 END), MAX(CASE WHEN cost_centre_segment = " + Lit(column) + " THEN 1 END) FROM fin_ledgers WHERE CAST(coa_id AS VARCHAR) = " + Lit(coaId), 1);
                    if (l.Error == null && l.Rows.Count > 0)
                    {
                        string dim = l.Rows[0][0] != null ? "fin_accounts" : l.Rows[0][1] != null ? "fin_companies" : l.Rows[0][2] != null ? "fin_cost_centres" : null;
                        if (dim != null)
                            foreach (var r in Query("SELECT code, name FROM " + dim + " WHERE name IS NOT NULL AND name <> code", 500000).Rows)
                                d.TryAdd(Convert.ToString(r[0]), Convert.ToString(r[1]));
                    }
                }
            }
            var pend = PendingSegValues(coaId, column);
            if (pend?.Values != null) foreach (var v in pend.Values) if (!string.IsNullOrEmpty(v.Description)) d.TryAdd(v.Value, v.Description);
            return d;
        }

        /// <summary>account value → account type (A/L/O/R/E) known on this PC: the most common type of the code combinations in fin_ccid,
        /// then the loaded accounts (fin_accounts) — so the trial balance query does not need MAX(account_type) from GL_CODE_COMBINATIONS.</summary>
        public static Dictionary<string, string> AccountTypes(string coaId, string column)
        {
            var d = new Dictionary<string, string>(StringComparer.Ordinal);
            if (string.IsNullOrEmpty(column) || !File.Exists(DbPath) || !Regex.IsMatch(column, "^SEGMENT([1-9]|[12][0-9]|30)$", RegexOptions.IgnoreCase)) return d;
            var t = Query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('fin_ccid', 'fin_ledgers', 'fin_accounts')", 10);
            var have = new HashSet<string>(t.Error == null ? t.Rows.Select(r => Convert.ToString(r[0])) : Enumerable.Empty<string>());
            if (have.Contains("fin_ccid"))
                foreach (var r in Query("SELECT " + column.ToLowerInvariant() + ", MODE(account_type) FROM fin_ccid WHERE coa_id = " + Lit(coaId ?? "") + " AND account_type IS NOT NULL AND " + column.ToLowerInvariant() + " IS NOT NULL GROUP BY 1", 500000).Rows)
                    d[Convert.ToString(r[0])] = Convert.ToString(r[1]);
            if (have.Contains("fin_ledgers") && have.Contains("fin_accounts"))
            {
                var l = Query("SELECT COUNT(*) FROM fin_ledgers WHERE CAST(coa_id AS VARCHAR) = " + Lit(coaId ?? "") + " AND account_segment = " + Lit(column), 1);
                if (l.Error == null && l.Rows.Count > 0 && Convert.ToInt64(l.Rows[0][0]) > 0)
                    foreach (var r in Query("SELECT code, account_type FROM fin_accounts WHERE account_type IS NOT NULL", 500000).Rows)
                        d.TryAdd(Convert.ToString(r[0]), Convert.ToString(r[1]));
            }
            return d;
        }

        // ── segment values read before any finance data was loaded ──
        public sealed class PendingSeg { public string CoaId { get; set; } public string Column { get; set; } public DateTime FetchedAt { get; set; } public List<FinanceFusion.SegValue> Values { get; set; } }
        internal static string PendingSegDir => Path.Combine(Root, "segment-values");
        private static string PendingSegFile(string coaId, string column) =>
            Path.Combine(PendingSegDir, Regex.Replace(coaId ?? "", "[^A-Za-z0-9_-]", "_") + "_" + Regex.Replace(column ?? "", "[^A-Za-z0-9_-]", "_") + ".json");
        private static PendingSeg ReadPending(string file)
        {
            try { return JsonSerializer.Deserialize<PendingSeg>(File.ReadAllText(file)); } catch { return null; }
        }
        /// <summary>Which segments already have their values on this PC: one row per chart of accounts × column with the
        /// number of values, how many are used in account combinations, how many have a name, when they were read and
        /// where they are kept (duckdb = fin_segment_values, pending = read before the first load).</summary>
        public static List<object> SegValuesStatus()
        {
            var list = new List<object>(); var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_segment_values'", 1);
                if (t.Error == null && t.Rows.Count > 0 && Convert.ToInt64(t.Rows[0][0]) > 0)
                {
                    var r = Query("SELECT coa_id, column_name, COUNT(*), COUNT(*) FILTER (WHERE combinations > 0), COUNT(*) FILTER (WHERE description IS NOT NULL AND description <> value), " +
                                  "CAST(MAX(fetched_at) AS VARCHAR) FROM fin_segment_values GROUP BY 1, 2", 5000);
                    foreach (var z in r.Rows)
                    {
                        seen.Add(z[0] + "|" + z[1]);
                        list.Add(new { coaId = Convert.ToString(z[0]), column = Convert.ToString(z[1]), values = Convert.ToInt64(z[2]), used = Convert.ToInt64(z[3]), named = Convert.ToInt64(z[4]), fetchedAt = Convert.ToString(z[5]), source = "duckdb" });
                    }
                }
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[Finance] segment status: " + ex.Message); }
            try
            {
                if (Directory.Exists(PendingSegDir))
                    foreach (var f in Directory.GetFiles(PendingSegDir, "*.json"))
                    {
                        var pend = ReadPending(f);
                        if (pend?.Values == null || seen.Contains(pend.CoaId + "|" + pend.Column)) continue;
                        list.Add(new { coaId = pend.CoaId, column = pend.Column, values = (long)pend.Values.Count, used = (long)pend.Values.Count(v => v.Combinations > 0),
                                       named = (long)pend.Values.Count(v => !string.IsNullOrEmpty(v.Description) && v.Description != v.Value), fetchedAt = pend.FetchedAt.ToString("yyyy-MM-dd HH:mm"), source = "pending" });
                    }
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[Finance] pending segment status: " + ex.Message); }
            return list;
        }

        /// <summary>The pending values of one segment (null when there are none).</summary>
        public static PendingSeg PendingSegValues(string coaId, string column)
        {
            string f = PendingSegFile(coaId, column);
            return File.Exists(f) ? ReadPending(f) : null;
        }
        /// <summary>Moves every pending segment-value file into fin_segment_values of a file being built (replacing that
        /// coa/column, newer than what the old file had); returns the files to delete once the new file is swapped in.</summary>
        internal static List<string> ImportPendingSegValues(DuckDBConnection conn, Action<string> note)
        {
            var done = new List<string>();
            if (!Directory.Exists(PendingSegDir)) return done;
            Exec(conn, SEGVAL_TABLE);
            foreach (var f in Directory.GetFiles(PendingSegDir, "*.json"))
            {
                var p = ReadPending(f);
                if (p == null || p.Values == null) continue;
                Exec(conn, "DELETE FROM fin_segment_values WHERE coa_id = " + Lit(p.CoaId) + " AND column_name = " + Lit(p.Column));
                Append(conn, "fin_segment_values", p.Values.Select(v => new object[] { p.CoaId, p.Column, v.Value, v.Description, v.Combinations, v.AccountType, p.FetchedAt }).ToList());
                note?.Invoke("Segment values of " + p.Column + " (chart " + p.CoaId + ", read " + p.FetchedAt.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + "): " + p.Values.Count.ToString("N0", CultureInfo.InvariantCulture) + " added from this PC.");
                done.Add(f);
            }
            return done;
        }
        internal static void DropPending(IEnumerable<string> files)
        {
            foreach (var f in files ?? Enumerable.Empty<string>()) try { File.Delete(f); } catch { }
        }
        internal const string SEGVAL_TABLE = "CREATE TABLE IF NOT EXISTS fin_segment_values (coa_id VARCHAR, column_name VARCHAR, value VARCHAR, description VARCHAR, combinations BIGINT, account_type VARCHAR, fetched_at TIMESTAMP)";

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

        /// <summary>Deletes the finance data file (templates, settings and the BICC folder stay).</summary>
        public static void ClearData()
        {
            lock (_lock)
            {
                ResetSessionNoLock();
                foreach (var f in new[] { DbPath, DbPath + ".wal" }) if (File.Exists(f)) File.Delete(f);
            }
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
                        case bool bo: row.AppendValue((bool?)bo); break;
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

    }
}

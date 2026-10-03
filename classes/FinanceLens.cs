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
                Exec(conn, "DELETE FROM fin_gl_balances_acct WHERE " + w + " AND currency_code = " + Lit(currency) + (companies == null ? "" : " AND company" + coIn));
                Exec(conn, "DELETE FROM fin_gl_balances_acct_sync WHERE " + w + " AND currency = " + Lit(currency) + (companies == null ? "" : " AND company" + coIn));
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
                Exec(conn, SEGVAL_TABLE); Exec(conn, TB_TABLE); Exec(conn, RAW_SYNC_TABLE); Exec(conn, CCID_TABLE); Exec(conn, ACCT_SYNC_TABLE);
                Exec(conn, "ATTACH " + Lit(DbPath.Replace('\\', '/')) + " AS prev (READ_ONLY)");
                try
                {
                    foreach (var t in new[] { "fin_segment_values", "fin_tb_live", "fin_gl_balances_sync", "fin_ccid", "fin_gl_balances", "fin_gl_balances_acct_sync", "fin_gl_balances_acct" })
                    {
                        using var c = conn.CreateCommand();
                        c.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_catalog = 'prev' AND table_name = '" + t + "'";
                        if (Convert.ToInt64(c.ExecuteScalar()) == 0) continue;
                        // fin_gl_balances has the pod's own columns: copied whole (its layout comes with it)
                        if (t == "fin_gl_balances" || t == "fin_gl_balances_acct") Exec(conn, "CREATE TABLE " + t + " AS SELECT * FROM prev." + t);
                        else Exec(conn, "INSERT INTO " + t + " SELECT * FROM prev." + t);
                    }
                }
                finally { Exec(conn, "DETACH prev"); }
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

        // ── segment values read before any finance data was loaded ──
        public sealed class PendingSeg { public string CoaId { get; set; } public string Column { get; set; } public DateTime FetchedAt { get; set; } public List<FinanceFusion.SegValue> Values { get; set; } }
        internal static string PendingSegDir => Path.Combine(Root, "segment-values");
        private static string PendingSegFile(string coaId, string column) =>
            Path.Combine(PendingSegDir, Regex.Replace(coaId ?? "", "[^A-Za-z0-9_-]", "_") + "_" + Regex.Replace(column ?? "", "[^A-Za-z0-9_-]", "_") + ".json");
        private static PendingSeg ReadPending(string file)
        {
            try { return JsonSerializer.Deserialize<PendingSeg>(File.ReadAllText(file)); } catch { return null; }
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

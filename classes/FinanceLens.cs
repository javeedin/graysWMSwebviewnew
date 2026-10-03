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

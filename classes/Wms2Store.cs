using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// WMS 2.0 (wms2/index.html) and the Shipping Agent's DuckDB mode: the pages' working copy of trips, order lines, shipment
    /// lines, print jobs, picker assignments, MRA results and the autopilot ledger in one local DuckDB file
    /// (C:\fusion\wms2\wms2.duckdb; env WMS2_ROOT for tests). Every answer the page gets from APEX / Fusion is written here
    /// (Put) and every screen reads it back with read-only SQL (Query), so the dashboard and the autopilot never wait on APEX
    /// to show or decide something. Tables are w2_* with text columns: the page normalises the field names; new fields become
    /// new columns. External file access is switched off on the connection, so page SQL can only read these tables.
    ///
    /// Several Gray's WMS windows are separate processes (openNewInstance starts the exe again) and DuckDB lets ONE process
    /// hold a database file open for writing. A connection kept open here locked every other window out — their DuckDB calls
    /// failed and the Shipping Agent fell back to reading Fusion again on every click. So nothing stays open: every operation
    /// takes the user-wide mutex Local\GraysWMS.duckdb.&lt;file&gt; (waits up to 20 s for another window's write), opens the
    /// file, does its work and closes it again. Any number of windows share the one file, writes never overlap and a reader
    /// always sees the last committed write. A wait that runs out answers "busy" (BusyException → Busy flag) and the page
    /// tries again.
    /// </summary>
    public static class Wms2Store
    {
        private static readonly object _lock = new();
        private static Mutex _mutex;
        private const int WAIT_MS = 20000;
        private static readonly Regex TableName = new("^w2_[a-z0-9_]{1,40}$", RegexOptions.Compiled);

        public static string Root
        {
            get
            {
                var env = Environment.GetEnvironmentVariable("WMS2_ROOT");
                return string.IsNullOrWhiteSpace(env) ? @"C:\fusion\wms2" : env;
            }
        }
        public static string DbPath => Path.Combine(Root, "wms2.duckdb");

        /// <summary>Another window held the file for longer than the wait.</summary>
        public sealed class BusyException : Exception { public BusyException(string m) : base(m) { } }

        /// <summary>One mutex per database file, shared by every process of this Windows session.</summary>
        private static Mutex FileMutex()
        {
            if (_mutex != null) return _mutex;
            string key = Regex.Replace(DbPath.ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
            if (key.Length > 120) key = key.Substring(key.Length - 120);
            _mutex = new Mutex(false, @"Local\GraysWMS.duckdb." + key);
            return _mutex;
        }

        /// <summary>
        /// Runs work on a fresh connection while this process holds the file mutex; the connection (and with it DuckDB's
        /// file lock) is closed before returning, so the next window can open the file. A lock still held by another
        /// process (an older build that keeps its connection open) is retried for a few seconds.
        /// </summary>
        private static T WithDb<T>(Func<DuckDBConnection, T> work)
        {
            lock (_lock)
            {
                var m = FileMutex();
                bool got;
                try { got = m.WaitOne(WAIT_MS); }
                catch (AbandonedMutexException) { got = true; }   // the window that held it is gone: the file is free
                if (!got) throw new BusyException("Another Gray's WMS window is writing to the DuckDB file (waited " + (WAIT_MS / 1000) + " s) — try again in a moment.");
                try
                {
                    Directory.CreateDirectory(Root);
                    DuckDBConnection c = null;
                    for (int attempt = 1; ; attempt++)
                    {
                        try { c = new DuckDBConnection("Data Source=" + DbPath); c.Open(); break; }
                        catch (Exception ex) when (attempt < 8 && ex.Message.IndexOf("lock", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            try { c?.Dispose(); } catch { }
                            Thread.Sleep(600);   // another process (an older build) still holds the file
                        }
                    }
                    using (c)
                    {
                        // The page sends SQL: no reading of other files, no setting changes. These settings belong to the database
                        // instance, so a second open in this process finds them already locked (that is fine).
                        try { Exec(c, "SET enable_external_access = false"); Exec(c, "SET lock_configuration = true"); }
                        catch (Exception ex) when (ex.Message.Contains("locked")) { }
                        Exec(c, "CREATE TABLE IF NOT EXISTS w2_sync_log (tbl VARCHAR, scope VARCHAR, rows_written BIGINT, ms BIGINT, logged_at VARCHAR)");
                        return work(c);
                    }
                }
                finally { m.ReleaseMutex(); }
            }
        }

        /// <summary>Column name as stored: lower case, letters / digits / underscore, never starting with a digit.</summary>
        public static string Col(string name)
        {
            var s = Regex.Replace((name ?? "").Trim().ToLowerInvariant(), "[^a-z0-9_]+", "_").Trim('_');
            if (s.Length == 0) s = "col";
            if (char.IsDigit(s[0])) s = "c_" + s;
            return s.Length > 60 ? s.Substring(0, 60) : s;
        }

        public sealed class PutResult { public bool Ok; public string Error; public bool Busy; public int Rows; public long Ms; }

        /// <summary>
        /// Replaces the rows of one scope (e.g. trip_date = '2026-10-06' and pod = 'PROD') with the given rows, or the whole
        /// table when replaceAll. Scope values may be lists (IN). New fields become new VARCHAR columns.
        /// </summary>
        public static PutResult Put(string table, Dictionary<string, List<string>> scope, List<Dictionary<string, string>> rows, bool replaceAll, IEnumerable<string> columns = null)
        {
            var res = new PutResult();
            var sw = Stopwatch.StartNew();
            if (!TableName.IsMatch(table ?? "")) { res.Error = "Table names start with w2_ (letters, digits, _)."; return res; }
            scope ??= new Dictionary<string, List<string>>();
            rows ??= new List<Dictionary<string, string>>();
            if (!replaceAll && scope.Count == 0) { res.Error = "Say which rows to replace (scope) or replace the whole table."; return res; }
            try
            {
                WithDb(c =>
                {
                    var norm = rows.Select(r => r.GroupBy(kv => Col(kv.Key)).ToDictionary(g => g.Key, g => g.First().Value)).ToList();
                    var scopeN = scope.ToDictionary(kv => Col(kv.Key), kv => kv.Value ?? new List<string>());
                    var want = new List<string> { "synced_at" };
                    foreach (var k in scopeN.Keys) if (!want.Contains(k)) want.Add(k);
                    foreach (var r in norm) foreach (var k in r.Keys) if (!want.Contains(k)) want.Add(k);
                    foreach (var k in (columns ?? Enumerable.Empty<string>()).Select(Col)) if (!want.Contains(k)) want.Add(k);

                    Exec(c, "CREATE TABLE IF NOT EXISTS " + table + " (" + string.Join(", ", want.Select(w => Q(w) + " VARCHAR")) + ")");
                    var have = Columns(c, table);
                    foreach (var w in want.Where(w => !have.Contains(w)))
                        Exec(c, "ALTER TABLE " + table + " ADD COLUMN " + Q(w) + " VARCHAR");
                    have = Columns(c, table);

                    Exec(c, "BEGIN TRANSACTION");
                    try
                    {
                        if (replaceAll) Exec(c, "DELETE FROM " + table);
                        else
                        {
                            var where = scopeN.Select(kv => kv.Value.Count == 0 ? "FALSE"
                                : kv.Value.Count == 1 ? Q(kv.Key) + " = " + Lit(kv.Value[0])
                                : Q(kv.Key) + " IN (" + string.Join(", ", kv.Value.Select(Lit)) + ")");
                            Exec(c, "DELETE FROM " + table + " WHERE " + string.Join(" AND ", where));
                        }
                        if (norm.Count > 0)
                        {
                            string at = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
                            using var app = c.CreateAppender(table);
                            foreach (var r in norm)
                            {
                                var row = app.CreateRow();
                                foreach (var col in have)
                                {
                                    string v = col == "synced_at" ? at
                                        : r.TryGetValue(col, out var x) ? x
                                        : scopeN.TryGetValue(col, out var sv) && sv.Count == 1 ? sv[0] : null;
                                    if (v == null) row.AppendNullValue(); else row.AppendValue(v);
                                }
                                row.EndRow();
                            }
                        }
                        Exec(c, "COMMIT");
                    }
                    catch { try { Exec(c, "ROLLBACK"); } catch { } throw; }

                    res.Rows = norm.Count;
                    res.Ms = sw.ElapsedMilliseconds;
                    string scopeText = replaceAll ? "*" : string.Join(" ", scopeN.Select(kv => kv.Key + "=" + string.Join("|", kv.Value.Take(20)) + (kv.Value.Count > 20 ? "…" : "")));
                    Exec(c, "INSERT INTO w2_sync_log VALUES (" + Lit(table) + ", " + Lit(scopeText.Length > 400 ? scopeText.Substring(0, 400) : scopeText) + ", " + res.Rows + ", " + res.Ms + ", " +
                            Lit(DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture)) + ")");
                    // keep the log small
                    Exec(c, "DELETE FROM w2_sync_log WHERE logged_at < " + Lit(DateTime.Now.AddDays(-14).ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture)));
                    res.Ok = true;
                    return true;
                });
            }
            catch (Exception ex) { res.Error = ex.Message; res.Busy = ex is BusyException; }
            return res;
        }

        public sealed class QueryResult { public List<string> Columns = new(); public List<object[]> Rows = new(); public bool Truncated; public long Ms; public string Error; public bool Busy; }

        /// <summary>One read-only statement (SELECT / WITH / DESCRIBE …) over the w2_* tables.</summary>
        public static QueryResult Query(string sql, int maxRows)
        {
            var res = new QueryResult();
            var sw = Stopwatch.StartNew();
            string why = FusionModel.SqlGuard.Check(sql);
            if (why != null) { res.Error = why; return res; }
            maxRows = Math.Clamp(maxRows <= 0 ? 50000 : maxRows, 1, 500000);
            try
            {
                WithDb(c =>
                {
                    using var cmd = c.CreateCommand();
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
                    return true;
                });
            }
            catch (Exception ex) { res.Error = ex.Message; res.Busy = ex is BusyException; }
            res.Ms = sw.ElapsedMilliseconds;
            return res;
        }

        /// <summary>Several read-only statements in ONE open of the file (one mutex wait, one open, one close).</summary>
        public static List<QueryResult> QueryMany(IEnumerable<string> sqls, int maxRows)
        {
            var list = (sqls ?? Enumerable.Empty<string>()).ToList();
            var results = list.Select(q => new QueryResult()).ToList();
            maxRows = Math.Clamp(maxRows <= 0 ? 50000 : maxRows, 1, 500000);
            for (int i = 0; i < list.Count; i++)
            {
                string why = FusionModel.SqlGuard.Check(list[i] ?? "");
                if (why != null) results[i].Error = why;
            }
            try
            {
                WithDb(c =>
                {
                    for (int i = 0; i < list.Count; i++)
                    {
                        var res = results[i];
                        if (res.Error != null) continue;
                        var sw = Stopwatch.StartNew();
                        try
                        {
                            using var cmd = c.CreateCommand();
                            cmd.CommandText = list[i].Trim().TrimEnd(';');
                            using var r = cmd.ExecuteReader();
                            for (int k = 0; k < r.FieldCount; k++) res.Columns.Add(r.GetName(k));
                            while (r.Read())
                            {
                                if (res.Rows.Count >= maxRows) { res.Truncated = true; break; }
                                var row = new object[r.FieldCount];
                                for (int k = 0; k < r.FieldCount; k++) row[k] = r.IsDBNull(k) ? null : FusionModel.ModelEngine.ToPlain(r.GetValue(k));
                                res.Rows.Add(row);
                            }
                        }
                        catch (Exception ex) { res.Error = ex.Message; }
                        res.Ms = sw.ElapsedMilliseconds;
                    }
                    return true;
                });
            }
            catch (Exception ex) { foreach (var r in results) if (r.Error == null) { r.Error = ex.Message; r.Busy = ex is BusyException; } }
            return results;
        }

        /// <summary>Tables with row counts and their last write, plus the file size.</summary>
        public static object Status()
        {
            try
            {
                return WithDb(c =>
                {
                    var tables = new List<object>();
                    var names = new List<string>();
                    using (var cmd = c.CreateCommand())
                    {
                        cmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'w2\\_%' ESCAPE '\\' ORDER BY 1";
                        using var r = cmd.ExecuteReader();
                        while (r.Read()) names.Add(r.GetString(0));
                    }
                    foreach (var n in names)
                    {
                        long count = 0; string last = null, lastScope = null; long lastMs = 0;
                        using (var cmd = c.CreateCommand()) { cmd.CommandText = "SELECT COUNT(*) FROM " + n; count = Convert.ToInt64(cmd.ExecuteScalar()); }
                        using (var cmd = c.CreateCommand())
                        {
                            cmd.CommandText = "SELECT logged_at, scope, ms FROM w2_sync_log WHERE tbl = " + Lit(n) + " ORDER BY logged_at DESC LIMIT 1";
                            using var r = cmd.ExecuteReader();
                            if (r.Read()) { last = r.IsDBNull(0) ? null : r.GetString(0); lastScope = r.IsDBNull(1) ? null : r.GetString(1); lastMs = r.IsDBNull(2) ? 0 : Convert.ToInt64(r.GetValue(2)); }
                        }
                        tables.Add(new { table = n, rows = count, lastWrite = last, lastScope, lastMs });
                    }
                    long size = File.Exists(DbPath) ? new FileInfo(DbPath).Length : 0;
                    return (object)new { ok = true, path = DbPath, sizeBytes = size, tables };
                });
            }
            catch (Exception ex) { return new { ok = false, error = ex.Message, busy = ex is BusyException, path = DbPath }; }
        }

        /// <summary>Drops one w2_* table, or every one (the copy is rebuilt by the next sync).</summary>
        public static object Clear(string table)
        {
            try
            {
                return WithDb(c =>
                {
                    var names = new List<string>();
                    using (var cmd = c.CreateCommand())
                    {
                        cmd.CommandText = "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'w2\\_%' ESCAPE '\\'";
                        using var r = cmd.ExecuteReader();
                        while (r.Read()) names.Add(r.GetString(0));
                    }
                    var drop = string.IsNullOrWhiteSpace(table) ? names.Where(n => n != "w2_sync_log").ToList() : names.Where(n => n == table).ToList();
                    foreach (var n in drop) Exec(c, "DROP TABLE " + n);
                    return (object)new { ok = true, dropped = drop };
                });
            }
            catch (Exception ex) { return new { ok = false, error = ex.Message, busy = ex is BusyException }; }
        }

        /// <summary>The table's columns in their stored order (the appender writes values in that order).</summary>
        private static List<string> Columns(DuckDBConnection c, string table)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT column_name FROM information_schema.columns WHERE table_name = " + Lit(table) + " ORDER BY ordinal_position";
            using var r = cmd.ExecuteReader();
            var ordered = new List<string>();
            while (r.Read()) ordered.Add(r.GetString(0));
            return ordered;
        }

        private static string Q(string col) => "\"" + col.Replace("\"", "") + "\"";
        private static string Lit(string s) => "'" + (s ?? "").Replace("'", "''") + "'";
        private static void Exec(DuckDBConnection c, string sql)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using DuckDB.NET.Data;

namespace WMSApp.Bip
{
    /// <summary>
    /// The BIP Reporting DuckDB file on this PC — `C:\fusion\bip\bip.duckdb` (env BIP_ROOT; encrypted through DuckDbVault like
    /// the WMS 2.0 and Finance files): the catalog of each pod as it was last read (so the tree opens at once and the search box
    /// has every report), each report's definition + parameters as last read, every run, and the RESULT ROWS of every data run
    /// as a table `res_&lt;runId&gt;` (loaded from the output CSV with read_csv, types inferred) — a result opens instantly, pages
    /// and sorts in DuckDB, and the Explore tab runs read-only SQL across results, the catalog and the runs.
    /// Like Wms2Store no connection is kept: every operation takes the file mutex, opens, works, closes (many WMS windows, one file).
    /// </summary>
    public static class BipStore
    {
        private static readonly object _lock = new();
        private static Mutex _mutex;
        private const int WAIT_MS = 20000;
        public const string CATALOG = "bip";
        private static readonly Regex RunIdRx = new("^[A-Za-z0-9_]{6,60}$", RegexOptions.Compiled);

        public static string Root
        {
            get { var env = Environment.GetEnvironmentVariable("BIP_ROOT"); return string.IsNullOrWhiteSpace(env) ? @"C:\fusion\bip" : env; }
        }
        public static string DbPath => Path.Combine(Root, "bip.duckdb");

        public sealed class BusyException : Exception { public BusyException(string m) : base(m) { } }

        private static Mutex FileMutex()
        {
            if (_mutex != null) return _mutex;
            string key = Regex.Replace(DbPath.ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
            if (key.Length > 120) key = key.Substring(key.Length - 120);
            _mutex = new Mutex(false, @"Local\GraysWMS.duckdb." + key);
            return _mutex;
        }

        /// <summary>Runs work on a fresh connection under the file mutex. `external` = true lets the host read files (read_csv); the page's SQL never gets it.</summary>
        private static T WithDb<T>(Func<DuckDBConnection, T> work, bool external = false)
        {
            lock (_lock)
            {
                var m = FileMutex();
                bool got;
                try { got = m.WaitOne(WAIT_MS); }
                catch (AbandonedMutexException) { got = true; }
                if (!got) throw new BusyException("Another Gray's WMS window is using the BIP DuckDB file (waited " + (WAIT_MS / 1000) + " s) — try again in a moment.");
                try
                {
                    Directory.CreateDirectory(Root);
                    DuckDBConnection c = null;
                    for (int attempt = 1; ; attempt++)
                    {
                        try { c = DuckDbVault.Open(DbPath, readOnly: false, alias: CATALOG); break; }
                        catch (Exception ex) when (attempt < 8 && ex.Message.IndexOf("lock", StringComparison.OrdinalIgnoreCase) >= 0) { Thread.Sleep(600); }
                    }
                    using (c)
                    {
                        if (!external) { try { Exec(c, "SET enable_external_access = false"); } catch (Exception ex) when (ex.Message.Contains("locked")) { } }
                        Ensure(c);
                        return work(c);
                    }
                }
                finally { m.ReleaseMutex(); }
            }
        }

        private static void Ensure(DuckDBConnection c)
        {
            Exec(c, "CREATE TABLE IF NOT EXISTS bip_catalog (pod VARCHAR, path VARCHAR, name VARCHAR, file_name VARCHAR, type VARCHAR, parent VARCHAR, modified VARCHAR, owner VARCHAR, read_at VARCHAR)");
            Exec(c, "CREATE TABLE IF NOT EXISTS bip_index_log (pod VARCHAR, root VARCHAR, folders BIGINT, reports BIGINT, read_at VARCHAR, ms BIGINT)");
            Exec(c, "CREATE TABLE IF NOT EXISTS bip_report_meta (pod VARCHAR, path VARCHAR, def_json VARCHAR, params_json VARCHAR, read_at VARCHAR)");
            Exec(c, "CREATE TABLE IF NOT EXISTS bip_runs (run_id VARCHAR, pod VARCHAR, path VARCHAR, name VARCHAR, format VARCHAR, params_json VARCHAR, params_hash VARCHAR, buckets BIGINT, status VARCHAR, rows_n BIGINT, bytes_n BIGINT, ms BIGINT, started_at VARCHAR, ended_at VARCHAR, error VARCHAR, file VARCHAR, tbl VARCHAR, app_user VARCHAR)");
        }

        private static string Lit(string s) => s == null ? "NULL" : "'" + s.Replace("'", "''") + "'";
        private static string Now() => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        private static void Exec(DuckDBConnection c, string sql) { using var cmd = c.CreateCommand(); cmd.CommandText = sql; cmd.ExecuteNonQuery(); }
        private static object Scalar(DuckDBConnection c, string sql) { using var cmd = c.CreateCommand(); cmd.CommandText = sql; return cmd.ExecuteScalar(); }
        private static List<Dictionary<string, object>> Read(DuckDBConnection c, string sql, int max = 1_000_000)
        {
            var list = new List<Dictionary<string, object>>();
            using var cmd = c.CreateCommand(); cmd.CommandText = sql;
            using var r = cmd.ExecuteReader();
            while (r.Read() && list.Count < max)
            {
                var d = new Dictionary<string, object>();
                for (int i = 0; i < r.FieldCount; i++) d[r.GetName(i)] = r.IsDBNull(i) ? null : FusionModel.ModelEngine.ToPlain(r.GetValue(i));
                list.Add(d);
            }
            return list;
        }

        public static bool Available
        {
            get { try { return WithDb(c => true); } catch { return false; } }
        }

        public static object Status()
        {
            try
            {
                return WithDb(c =>
                {
                    long size = 0; try { size = new FileInfo(DbPath).Length; } catch { }
                    var tables = Read(c, "SELECT table_name AS t FROM information_schema.tables WHERE table_catalog = '" + CATALOG + "' AND table_name LIKE 'res\\_%' ESCAPE '\\'");
                    long catalogRows = Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM bip_catalog"));
                    long runs = Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM bip_runs"));
                    return (object)new { ok = true, path = DbPath, sizeBytes = size, results = tables.Count, catalogRows, runs, encrypted = DuckDbVault.IsKnownEncrypted(DbPath), crypto = DuckDbVault.CryptoState, cryptoNote = DuckDbVault.CryptoNote };
                });
            }
            catch (Exception ex) { return new { ok = false, error = ex.Message, busy = ex is BusyException, path = DbPath }; }
        }

        // ── catalog ──────────────────────────────────────────────────
        public static void SaveFolder(string pod, string path, List<BipCatalogItem> items)
        {
            WithDb(c =>
            {
                Exec(c, "DELETE FROM bip_catalog WHERE pod = " + Lit(pod) + " AND " + InFolder(path) + " AND path <> " + Lit(path));
                InsertItems(c, pod, items, Now());
                return true;
            });
        }

        /// <summary>The parent folder of a catalog path ("/Custom/Finance/AR.xdo" → "/Custom/Finance", "/Custom" → "/").</summary>
        public static string ParentOf(string path)
        {
            if (string.IsNullOrEmpty(path)) return "/";
            string t = path.Length > 1 ? path.TrimEnd('/') : path;
            int i = t.LastIndexOf('/');
            return i <= 0 ? "/" : t.Substring(0, i);
        }

        // BI Publisher sends a blank parentAbsolutePath for the children of "/" (and sometimes "/Custom/" with a slash) —
        // a row is in a folder when its stored parent says so OR the parent taken from its own path does.
        private static string InFolder(string path)
        {
            string p = string.IsNullOrEmpty(path) ? "/" : (path.Length > 1 ? path.TrimEnd('/') : path);
            return "(parent = " + Lit(p) + " OR COALESCE(NULLIF(regexp_replace(path, '/[^/]*/?$', ''), ''), '/') = " + Lit(p) + ")";
        }

        private static void InsertItems(DuckDBConnection c, string pod, List<BipCatalogItem> items, string at)
        {
            if (items == null || items.Count == 0) return;
            using var app = c.CreateAppender("bip_catalog");
            foreach (var it in items)
            {
                var row = app.CreateRow();
                foreach (var v in new[] { pod, it.AbsolutePath ?? "", it.DisplayName ?? "", it.FileName ?? "", it.Type ?? "", ParentPath(it), it.LastModified ?? "", it.Owner ?? "", at }) row.AppendValue(v);
                row.EndRow();
            }
        }

        private static string ParentPath(BipCatalogItem it)
        {
            string pp = it.ParentAbsolutePath;
            if (string.IsNullOrWhiteSpace(pp)) return ParentOf(it.AbsolutePath);
            return pp.Length > 1 ? pp.TrimEnd('/') : pp;
        }

        /// <summary>The whole walk of a pod replaces what was kept under its root.</summary>
        public static void SaveIndex(string pod, string root, List<BipCatalogItem> items, int folders, int reports, long ms)
        {
            WithDb(c =>
            {
                string prefix = (root ?? "/").TrimEnd('/');
                Exec(c, "DELETE FROM bip_catalog WHERE pod = " + Lit(pod) + (prefix.Length > 0 ? " AND (path = " + Lit(prefix) + " OR path LIKE " + Lit(prefix.Replace("%", "\\%").Replace("_", "\\_") + "/%") + " ESCAPE '\\')" : ""));
                InsertItems(c, pod, items, Now());
                Exec(c, "INSERT INTO bip_index_log VALUES (" + Lit(pod) + ", " + Lit(root ?? "/") + ", " + folders + ", " + reports + ", " + Lit(Now()) + ", " + ms + ")");
                return true;
            });
        }

        private static BipCatalogItem ItemOf(Dictionary<string, object> r) => new BipCatalogItem
        {
            AbsolutePath = r["path"] as string, DisplayName = r["name"] as string, FileName = r["file_name"] as string, Type = r["type"] as string,
            ParentAbsolutePath = r["parent"] as string, LastModified = r["modified"] as string, Owner = r["owner"] as string
        };

        /// <summary>One folder as last kept → (items, readAt) — readAt null when the folder was never read on this PC.</summary>
        public static (List<BipCatalogItem> Items, string ReadAt) Folder(string pod, string path)
        {
            return WithDb(c =>
            {
                var rows = Read(c, "SELECT path, name, file_name, type, parent, modified, owner, read_at FROM bip_catalog WHERE pod = " + Lit(pod) + " AND " + InFolder(path) + " AND path <> " + Lit(path) + " ORDER BY CASE WHEN type = 'Folder' THEN 0 ELSE 1 END, lower(name)");
                if (rows.Count == 0)
                {
                    // the folder itself is known (its parent was read) but empty, or never read: tell them apart by the folder's own row
                    var self = Read(c, "SELECT read_at FROM bip_catalog WHERE pod = " + Lit(pod) + " AND path = " + Lit(path) + " AND type = 'Folder'", 1);
                    var log = Read(c, "SELECT read_at FROM bip_index_log WHERE pod = " + Lit(pod) + " ORDER BY read_at DESC", 1);
                    return (new List<BipCatalogItem>(), log.Count > 0 && self.Count > 0 ? log[0]["read_at"] as string : null);
                }
                return (rows.Select(ItemOf).ToList(), rows[0]["read_at"] as string);
            });
        }

        public static (List<BipCatalogItem> Items, Dictionary<string, object> Log) Index(string pod)
        {
            return WithDb(c =>
            {
                var log = Read(c, "SELECT root, folders, reports, read_at, ms FROM bip_index_log WHERE pod = " + Lit(pod) + " ORDER BY read_at DESC", 1);
                var rows = Read(c, "SELECT path, name, file_name, type, parent, modified, owner, read_at FROM bip_catalog WHERE pod = " + Lit(pod) + " ORDER BY path");
                return (rows.Select(ItemOf).ToList(), log.Count > 0 ? log[0] : null);
            });
        }

        // ── report definitions and parameters ────────────────────────
        public static void SaveMeta(string pod, string path, string defJson, string paramsJson)
        {
            WithDb(c =>
            {
                var cur = Read(c, "SELECT def_json, params_json FROM bip_report_meta WHERE pod = " + Lit(pod) + " AND path = " + Lit(path), 1);
                string d = defJson ?? (cur.Count > 0 ? cur[0]["def_json"] as string : null), p = paramsJson ?? (cur.Count > 0 ? cur[0]["params_json"] as string : null);
                Exec(c, "DELETE FROM bip_report_meta WHERE pod = " + Lit(pod) + " AND path = " + Lit(path));
                Exec(c, "INSERT INTO bip_report_meta VALUES (" + Lit(pod) + ", " + Lit(path) + ", " + Lit(d) + ", " + Lit(p) + ", " + Lit(Now()) + ")");
                return true;
            });
        }

        public static (string DefJson, string ParamsJson, string ReadAt) Meta(string pod, string path)
        {
            return WithDb(c =>
            {
                var r = Read(c, "SELECT def_json, params_json, read_at FROM bip_report_meta WHERE pod = " + Lit(pod) + " AND path = " + Lit(path), 1);
                return r.Count == 0 ? (null, null, null) : (r[0]["def_json"] as string, r[0]["params_json"] as string, r[0]["read_at"] as string);
            });
        }

        // ── runs and results ─────────────────────────────────────────
        public static string ParamsHash(string path, string paramsJson, string bucketsJson)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes((path ?? "") + "\n" + (paramsJson ?? "") + "\n" + (bucketsJson ?? "")));
            return Convert.ToHexString(bytes).Substring(0, 16).ToLowerInvariant();
        }

        public static string TableOf(string runId) => RunIdRx.IsMatch(runId ?? "") ? "res_" + runId.ToLowerInvariant() : null;

        public sealed class RunRow
        {
            public string RunId, Pod, Path, Name, Format, ParamsJson, ParamsHash, Status, StartedAt, EndedAt, Error, File, Tbl, User;
            public long Buckets, Rows, Bytes, Ms;
        }

        /// <summary>Writes / replaces the run's row (the result table is loaded separately by LoadResult).</summary>
        public static void SaveRun(RunRow r)
        {
            WithDb(c =>
            {
                Exec(c, "DELETE FROM bip_runs WHERE run_id = " + Lit(r.RunId));
                Exec(c, "INSERT INTO bip_runs VALUES (" + string.Join(", ", Lit(r.RunId), Lit(r.Pod), Lit(r.Path), Lit(r.Name), Lit(r.Format), Lit(r.ParamsJson), Lit(r.ParamsHash), r.Buckets.ToString(), Lit(r.Status), r.Rows.ToString(), r.Bytes.ToString(), r.Ms.ToString(), Lit(r.StartedAt), Lit(r.EndedAt), Lit(r.Error), Lit(r.File), Lit(r.Tbl), Lit(r.User)) + ")");
                return true;
            });
        }

        /// <summary>Loads the output CSV of a run into `res_&lt;runId&gt;` (types inferred over the whole file) → (rows, columns).</summary>
        public static (long Rows, List<string> Columns) LoadResult(string runId, string csvFile)
        {
            string tbl = TableOf(runId) ?? throw new ArgumentException("bad run id");
            return WithDb(c =>
            {
                Exec(c, "DROP TABLE IF EXISTS " + tbl);
                string file = csvFile.Replace("'", "''");
                try { Exec(c, "CREATE TABLE " + tbl + " AS SELECT * FROM read_csv('" + file + "', header = true, auto_detect = true, sample_size = -1, null_padding = true)"); }
                catch (Exception)
                {
                    // a column that defeats the type sniffing: keep every value as text
                    Exec(c, "DROP TABLE IF EXISTS " + tbl);
                    Exec(c, "CREATE TABLE " + tbl + " AS SELECT * FROM read_csv('" + file + "', header = true, all_varchar = true, null_padding = true)");
                }
                long n = Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM " + tbl));
                var cols = Read(c, "SELECT column_name AS n FROM information_schema.columns WHERE table_catalog = '" + CATALOG + "' AND table_name = " + Lit(tbl) + " ORDER BY ordinal_position").Select(x => x["n"] as string).ToList();
                Exec(c, "UPDATE bip_runs SET tbl = " + Lit(tbl) + ", rows_n = " + n + " WHERE run_id = " + Lit(runId));
                return (n, cols);
            }, external: true);
        }

        public static bool HasTable(string runId)
        {
            string tbl = TableOf(runId); if (tbl == null) return false;
            try { return WithDb(c => Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM information_schema.tables WHERE table_catalog = '" + CATALOG + "' AND table_name = " + Lit(tbl))) > 0); }
            catch { return false; }
        }

        /// <summary>A page of a result straight from DuckDB (rowid order = the file order).</summary>
        public static (List<string> Columns, List<Dictionary<string, object>> Rows, long Total) Rows(string runId, long offset, int limit)
        {
            string tbl = TableOf(runId) ?? throw new ArgumentException("bad run id");
            return WithDb(c =>
            {
                long total = Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM " + tbl));
                var cols = Read(c, "SELECT column_name AS n FROM information_schema.columns WHERE table_catalog = '" + CATALOG + "' AND table_name = " + Lit(tbl) + " ORDER BY ordinal_position").Select(x => x["n"] as string).ToList();
                var rows = Read(c, "SELECT * FROM " + tbl + " ORDER BY rowid LIMIT " + limit + " OFFSET " + offset);
                return (cols, rows, total);
            });
        }

        public static List<Dictionary<string, object>> Runs(int max = 300)
        {
            try { return WithDb(c => Read(c, "SELECT r.*, (SELECT COUNT(*) FROM information_schema.tables t WHERE t.table_catalog = '" + CATALOG + "' AND t.table_name = r.tbl) AS has_table FROM bip_runs r ORDER BY started_at DESC LIMIT " + max)); }
            catch { return new List<Dictionary<string, object>>(); }
        }

        /// <summary>The newest finished run of a report with the same parameters and buckets whose rows are still kept.</summary>
        public static Dictionary<string, object> LastRun(string pod, string path, string paramsHash)
        {
            try
            {
                return WithDb(c => Read(c, "SELECT r.* FROM bip_runs r WHERE r.pod = " + Lit(pod) + " AND r.path = " + Lit(path) + " AND r.params_hash = " + Lit(paramsHash) + " AND r.status IN ('DONE', 'PARTIAL') AND r.tbl IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_catalog = '" + CATALOG + "' AND t.table_name = r.tbl) ORDER BY r.started_at DESC LIMIT 1", 1).FirstOrDefault());
            }
            catch { return null; }
        }

        public static void DeleteRun(string runId)
        {
            string tbl = TableOf(runId); if (tbl == null) return;
            WithDb(c => { Exec(c, "DROP TABLE IF EXISTS " + tbl); Exec(c, "DELETE FROM bip_runs WHERE run_id = " + Lit(runId)); return true; });
        }

        public static object Clear(string what)
        {
            try
            {
                return WithDb(c =>
                {
                    int n = 0;
                    if (what == "catalog" || what == "all") { Exec(c, "DELETE FROM bip_catalog"); Exec(c, "DELETE FROM bip_index_log"); Exec(c, "DELETE FROM bip_report_meta"); n++; }
                    if (what == "results" || what == "all")
                    {
                        foreach (var t in Read(c, "SELECT table_name AS t FROM information_schema.tables WHERE table_catalog = '" + CATALOG + "' AND table_name LIKE 'res\\_%' ESCAPE '\\'")) { Exec(c, "DROP TABLE IF EXISTS " + (string)t["t"]); n++; }
                        Exec(c, "UPDATE bip_runs SET tbl = NULL");
                    }
                    return (object)new { ok = true, n };
                });
            }
            catch (Exception ex) { return new { ok = false, error = ex.Message }; }
        }

        /// <summary>Result tables with their run (for the Explore tab).</summary>
        public static List<Dictionary<string, object>> Tables()
        {
            try
            {
                return WithDb(c => Read(c, "SELECT t.table_name AS tbl, t.estimated_size AS rows_n, r.run_id, r.pod, r.path, r.name, r.started_at, r.params_json, r.buckets, r.status, (SELECT COUNT(*) FROM information_schema.columns k WHERE k.table_catalog = '" + CATALOG + "' AND k.table_name = t.table_name) AS cols FROM duckdb_tables() t LEFT JOIN bip_runs r ON r.tbl = t.table_name WHERE t.database_name = '" + CATALOG + "' AND t.table_name LIKE 'res\\_%' ESCAPE '\\' ORDER BY r.started_at DESC"));
            }
            catch { return new List<Dictionary<string, object>>(); }
        }

        public sealed class QueryResult { public List<string> Columns = new(); public List<object[]> Rows = new(); public bool Truncated; public long Ms; public string Error; public bool Busy; }

        /// <summary>One read-only statement from the page (SqlGuard: SELECT / WITH / DESCRIBE …; no file access).</summary>
        public static QueryResult Query(string sql, int maxRows)
        {
            var res = new QueryResult(); var sw = Stopwatch.StartNew();
            string why = FusionModel.SqlGuard.Check(sql);
            if (why != null) { res.Error = why; return res; }
            maxRows = Math.Clamp(maxRows <= 0 ? 50000 : maxRows, 1, 500000);
            try
            {
                WithDb(c =>
                {
                    using var cmd = c.CreateCommand(); cmd.CommandText = sql.Trim().TrimEnd(';');
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
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens from Oracle BI Cloud Connector (BICC) extracts — the bulk way to get every GL balance and journal line
    /// without one SQL call per month: the GL extract PVOs (balances, code combinations, journal headers / lines / batches)
    /// are read straight from their CSV / ZIP files by DuckDB (read_csv, union of all files, the newest file wins per key, so
    /// full + incremental extracts can sit side by side) and written as the Finance Lens tables. Columns are found by the
    /// attribute name they end with (BalancePeriodNetDr → PeriodNetDr), so the PVO prefixes do not matter; a map can override.
    /// Files come from a folder (BICC to UCM / OCI Object Storage, copied by hand or by a job) or are downloaded from the pod's
    /// UCM (idcplg GET_SEARCH_RESULTS / GET_FILE, Basic auth with the app's Fusion user — the password never reaches the page).
    /// The calendar comes from the page (the saved discovery), so a load works without calling Fusion.
    /// </summary>
    public static class FinanceBicc
    {
        public sealed class Pvo { public string Key, Name, Title; public string[] Attrs, Required; }

        public static readonly Pvo[] PVOS =
        {
            new Pvo { Key = "balances", Name = "FscmTopModelAM.FinExtractAM.GlBiccExtractAM.BalanceExtractPVO", Title = "balanceextractpvo",
                Attrs = new[] { "LedgerId", "CodeCombinationId", "CurrencyCode", "PeriodName", "ActualFlag", "BudgetVersionId", "TranslatedFlag", "TemplateId", "BeginBalanceDr", "BeginBalanceCr", "PeriodNetDr", "PeriodNetCr", "LastUpdateDate" },
                Required = new[] { "LedgerId", "CodeCombinationId", "CurrencyCode", "PeriodName", "ActualFlag", "PeriodNetDr", "PeriodNetCr" } },
            new Pvo { Key = "combinations", Name = "FscmTopModelAM.FinExtractAM.GlBiccExtractAM.CodeCombinationExtractPVO", Title = "codecombinationextractpvo",
                Attrs = new[] { "CodeCombinationId", "ChartOfAccountsId", "AccountType", "SummaryFlag", "LastUpdateDate" }.Concat(Enumerable.Range(1, 30).Select(i => "Segment" + i)).ToArray(),
                Required = new[] { "CodeCombinationId", "AccountType" } },
            new Pvo { Key = "journal_headers", Name = "FscmTopModelAM.FinExtractAM.GlBiccExtractAM.JournalHeaderExtractPVO", Title = "journalheaderextractpvo",
                Attrs = new[] { "JeHeaderId", "LedgerId", "JeBatchId", "Name", "JeSource", "JeCategory", "Status", "ActualFlag", "DefaultEffectiveDate", "PostedDate", "CreationDate", "CreatedBy", "Description", "LastUpdateDate" },
                Required = new[] { "JeHeaderId", "LedgerId", "Status", "ActualFlag" } },
            new Pvo { Key = "journal_lines", Name = "FscmTopModelAM.FinExtractAM.GlBiccExtractAM.JournalLineExtractPVO", Title = "journallineextractpvo",
                Attrs = new[] { "JeHeaderId", "JeLineNum", "PeriodName", "CodeCombinationId", "AccountedDr", "AccountedCr", "Description", "EffectiveDate", "LastUpdateDate" },
                Required = new[] { "JeHeaderId", "JeLineNum", "PeriodName", "CodeCombinationId", "AccountedDr", "AccountedCr" } },
            new Pvo { Key = "journal_batches", Name = "FscmTopModelAM.FinExtractAM.GlBiccExtractAM.JournalBatchExtractPVO", Title = "journalbatchextractpvo",
                Attrs = new[] { "JeBatchId", "Name" }, Required = new[] { "JeBatchId" } },
        };

        public static string DefaultFolder => Path.Combine(FinanceLens.Root, "bicc");

        // ───────────────────────── files ─────────────────────────
        /// <summary>CSV files of a PVO in the folder (zips are unpacked once into _extract\), newest first.</summary>
        public static List<FileInfo> Files(string folder, Pvo pvo)
        {
            if (!Directory.Exists(folder)) return new List<FileInfo>();
            string ex = Path.Combine(folder, "_extract");
            foreach (var z in new DirectoryInfo(folder).GetFiles("*.zip").Where(f => f.Name.IndexOf(pvo.Title, StringComparison.OrdinalIgnoreCase) >= 0))
            {
                string dest = Path.Combine(ex, Path.GetFileNameWithoutExtension(z.Name));
                if (Directory.Exists(dest) && Directory.GetFiles(dest).Length > 0) continue;
                Directory.CreateDirectory(dest);
                using var arc = ZipFile.OpenRead(z.FullName);
                foreach (var e in arc.Entries.Where(e => e.Name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) || e.Name.EndsWith(".csv.gz", StringComparison.OrdinalIgnoreCase)))
                {
                    string target = Path.GetFullPath(Path.Combine(dest, Path.GetFileName(e.Name)));
                    if (!target.StartsWith(Path.GetFullPath(dest), StringComparison.OrdinalIgnoreCase)) continue;      // no path tricks
                    e.ExtractToFile(target, true);
                    File.SetLastWriteTimeUtc(target, z.LastWriteTimeUtc);
                }
            }
            var all = new List<FileInfo>();
            foreach (var dir in new[] { folder }.Concat(Directory.Exists(ex) ? Directory.GetDirectories(ex) : Array.Empty<string>()))
                all.AddRange(new DirectoryInfo(dir).GetFiles("*").Where(f => (f.Name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) || f.Name.EndsWith(".csv.gz", StringComparison.OrdinalIgnoreCase))
                    && (f.FullName.IndexOf(pvo.Title, StringComparison.OrdinalIgnoreCase) >= 0)));
            // BICC names carry the extract time (…-20250131_093713) — newest first, then by file time
            return all.OrderByDescending(f => f.Name, StringComparer.OrdinalIgnoreCase).ThenByDescending(f => f.LastWriteTimeUtc).ToList();
        }

        private static string Lit(string s) => FinanceLens.Lit(s);
        private static string FileList(List<FileInfo> files) => "[" + string.Join(", ", files.Select(f => Lit(f.FullName.Replace('\\', '/')))) + "]";
        private static string Reader(List<FileInfo> files) => "read_csv(" + FileList(files) + ", header = true, all_varchar = true, union_by_name = true, filename = true)";

        /// <summary>The CSV columns of the PVO's files.</summary>
        private static List<string> Columns(DuckDBConnection conn, List<FileInfo> files)
        {
            var cols = new List<string>();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DESCRIBE SELECT * FROM " + Reader(files.Take(3).ToList());
            using var r = cmd.ExecuteReader();
            while (r.Read()) { string c = r.GetString(0); if (c != "filename") cols.Add(c); }
            return cols;
        }

        /// <summary>attribute → CSV column: an override, else the shortest column whose name ends with the attribute (case-insensitive).</summary>
        public static Dictionary<string, string> Detect(Pvo pvo, List<string> cols, Dictionary<string, string> overrides)
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var a in pvo.Attrs)
            {
                if (overrides != null && overrides.TryGetValue(pvo.Key + "." + a, out var o) && cols.Contains(o)) { map[a] = o; continue; }
                var hit = cols.Where(c => c.EndsWith(a, StringComparison.OrdinalIgnoreCase) && (c.Length == a.Length || !char.IsDigit(a[^1]) || !char.IsDigit(c[c.Length - a.Length - 1 < 0 ? 0 : c.Length - a.Length - 1])))
                              .OrderBy(c => c.Length).FirstOrDefault();
                if (hit != null) map[a] = hit;
            }
            return map;
        }

        public static object Inspect(string folder, Dictionary<string, string> overrides)
        {
            folder = string.IsNullOrWhiteSpace(folder) ? DefaultFolder : folder;
            Directory.CreateDirectory(folder);
            using var conn = new DuckDBConnection("Data Source=:memory:");
            conn.Open();
            var res = new List<object>();
            foreach (var p in PVOS)
            {
                var files = Files(folder, p);
                List<string> cols = new(); string err = null;
                if (files.Count > 0) { try { cols = Columns(conn, files); } catch (Exception ex) { err = ex.Message; } }
                var map = Detect(p, cols, overrides);
                res.Add(new
                {
                    key = p.Key, pvo = p.Name, files = files.Select(f => new { name = f.Name, size = f.Length, date = f.LastWriteTime.ToString("s") }).Take(200), fileCount = files.Count,
                    bytes = files.Sum(f => f.Length), columns = cols, map, missing = p.Required.Where(a => !map.ContainsKey(a)), error = err
                });
            }
            return new { ok = true, folder, pvos = res };
        }

        // ───────────────────────── load ─────────────────────────
        public sealed class CalPeriod { public string Name { get; set; } public int Year { get; set; } public int Num { get; set; } public int Quarter { get; set; } public string Start { get; set; } public string End { get; set; } public bool Adj { get; set; } }
        public sealed class LoadOptions
        {
            public string Folder { get; set; }
            public List<FinanceFusion.SyncLedger> Ledgers { get; set; } = new();
            public List<CalPeriod> Calendar { get; set; } = new();
            public int FromSeq { get; set; }
            public int ToSeq { get; set; }
            public bool Journals { get; set; } = true;
            /// <summary>Budget version id in GL_BALANCES (actual_flag B); empty = no budget.</summary>
            public string BudgetVersionId { get; set; }
            public bool FoldAdjustments { get; set; } = true;
            public Dictionary<string, string> Map { get; set; } = new();
            public JsonElement Discovery { get; set; }
            public string Pod { get; set; }
            public string User { get; set; }
        }

        public static object Load(LoadOptions o, Action<string> progress, CancellationToken ct)
        {
            var sw = Stopwatch.StartNew();
            var log = new List<string>();
            void Note(string s) { log.Add(DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "  " + s); progress?.Invoke(s); }
            string folder = string.IsNullOrWhiteSpace(o.Folder) ? DefaultFolder : o.Folder;
            if (o.Ledgers.Count == 0) return new { ok = false, error = "Pick at least one ledger." };
            if (o.Calendar.Count == 0) return new { ok = false, error = "The calendar is missing - run Discover once (it is saved)." };
            foreach (var l in o.Ledgers)
            {
                l.Company = FinanceFusion.SegCol(l.Company); l.Account = FinanceFusion.SegCol(l.Account); l.CostCentre = FinanceFusion.SegCol(l.CostCentre);
                if (l.Company == null || l.Account == null) return new { ok = false, error = "Ledger " + l.Name + ": choose the company and the account segment." };
                if (string.IsNullOrWhiteSpace(l.Code)) l.Code = l.Id.ToString(CultureInfo.InvariantCulture);
            }
            var files = PVOS.ToDictionary(p => p.Key, p => Files(folder, p));
            foreach (var k in new[] { "balances", "combinations" })
                if (files[k].Count == 0) return new { ok = false, error = "No " + k + " extract (" + PVOS.First(p => p.Key == k).Name + ") in " + folder + "." };
            bool jnl = o.Journals && files["journal_headers"].Count > 0 && files["journal_lines"].Count > 0;
            if (o.Journals && !jnl) Note("⚠ No journal header / line extracts - balances only.");

            // calendar: seq = fiscal year × 100 + period number; adjustment periods folded into the period they close
            var normal = o.Calendar.Where(p => !p.Adj).ToList();
            var tgt = new List<(string Name, CalPeriod T)>();
            foreach (var p in o.Calendar)
            {
                var t = !p.Adj ? p : !o.FoldAdjustments ? null : normal.Where(n => n.Year == p.Year && n.Num <= p.Num).OrderByDescending(n => n.Num).FirstOrDefault() ?? normal.Where(n => n.Year == p.Year).OrderBy(n => n.Num).FirstOrDefault();
                if (t != null) tgt.Add((p.Name, t));
            }
            int from = o.FromSeq > 0 ? o.FromSeq : normal.Min(p => p.Year * 100 + p.Num), to = o.ToSeq > 0 ? o.ToSeq : normal.Max(p => p.Year * 100 + p.Num);

            string tmp = Path.Combine(FinanceLens.Root, "finance.new.duckdb");
            List<string> pendingSeg = null;
            foreach (var f in new[] { tmp, tmp + ".wal" }) if (File.Exists(f)) File.Delete(f);
            var prev = o.Discovery.ValueKind == JsonValueKind.Object ? null : FinanceLens.LoadDiscovery(o.Pod ?? "");
            long nBal = 0, nJnl = 0;
            try
            {
                using var conn = new DuckDBConnection("Data Source=" + tmp);
                conn.Open();
                void X(string sql) { ct.ThrowIfCancellationRequested(); using var c = conn.CreateCommand(); c.CommandText = sql; c.ExecuteNonQuery(); }
                long N(string sql) { using var c = conn.CreateCommand(); c.CommandText = sql; var v = c.ExecuteScalar(); return v == null || v is DBNull ? 0 : Convert.ToInt64(v); }
                foreach (var stmt in FinanceLens.SCHEMA.Split(';').Select(s => s.Trim()).Where(s => s.Length > 0)) X(stmt);
                X(FinanceFusion.SYNC_TABLE); X(FinanceLens.SEGVAL_TABLE);
                FinanceLens.CarryOver(conn, Note);   // segment values and live trial balances stay with the data
                pendingSeg = FinanceLens.ImportPendingSegValues(conn, Note);

                // calendar + ledgers as tables
                X("CREATE TEMP TABLE cal (period_name VARCHAR, t_name VARCHAR, t_seq INTEGER, t_year INTEGER, t_num INTEGER, t_q INTEGER, t_start DATE, t_end DATE)");
                FinanceLens.Append(conn, "cal", tgt.Select(z => new object[] { z.Name, z.T.Name, z.T.Year * 100 + z.T.Num, z.T.Year, z.T.Num, z.T.Quarter > 0 ? z.T.Quarter : (z.T.Num - 1) / 3 + 1,
                    DateOnly.TryParse(z.T.Start, CultureInfo.InvariantCulture, out var s1) ? s1 : (object)null, DateOnly.TryParse(z.T.End, CultureInfo.InvariantCulture, out var e1) ? e1 : (object)null }).ToList());

                Dictionary<string, string> Map(string key)
                {
                    var p = PVOS.First(v => v.Key == key);
                    var m = Detect(p, Columns(conn, files[key]), o.Map);
                    var miss = p.Required.Where(a => !m.ContainsKey(a)).ToList();
                    if (miss.Count > 0) throw new InvalidOperationException(p.Name + ": no column for " + string.Join(", ", miss) + " - set them in the column map.");
                    return m;
                }
                string Col(Dictionary<string, string> m, string a, string alias = "v") => m.TryGetValue(a, out var c) ? alias + ".\"" + c.Replace("\"", "\"\"") + "\"" : "NULL";
                string Num(string e) => "COALESCE(TRY_CAST(" + e + " AS DOUBLE), 0)";
                string Ts(string e) => "TRY_CAST(replace(substr(" + e + ", 1, 19), 'T', ' ') AS TIMESTAMP)";
                void Ranked(string key, string table)
                {
                    X("CREATE TEMP TABLE f_" + table + " (fname VARCHAR, rnk INTEGER)");
                    FinanceLens.Append(conn, "f_" + table, files[key].Select((f, i) => new object[] { f.FullName.Replace('\\', '/'), i }).ToList());
                }

                // ── code combinations: the newest row per id ──
                Note("Reading " + files["combinations"].Count + " code combination file(s)…");
                var mc = Map("combinations"); Ranked("combinations", "cc");
                var segCols = Enumerable.Range(1, 30).Select(i => "Segment" + i).Where(mc.ContainsKey).ToList();
                X("CREATE TEMP TABLE gcc AS SELECT * EXCLUDE (rn) FROM (SELECT TRY_CAST(" + Col(mc, "CodeCombinationId") + " AS BIGINT) ccid, " + Col(mc, "ChartOfAccountsId") + " coa, " + Col(mc, "AccountType") + " account_type, " +
                  "COALESCE(" + Col(mc, "SummaryFlag") + ", 'N') summary_flag, " + string.Join(", ", segCols.Select(sg => Col(mc, sg) + " " + sg.ToUpperInvariant())) +
                  ", ROW_NUMBER() OVER (PARTITION BY " + Col(mc, "CodeCombinationId") + " ORDER BY f.rnk) rn FROM " + Reader(files["combinations"]) + " v JOIN f_cc f ON f.fname = replace(v.filename, '\\', '/')) WHERE rn = 1");
                Note("  " + N("SELECT COUNT(*) FROM gcc").ToString("N0", CultureInfo.InvariantCulture) + " code combinations");

                // ── balances: the newest row per balance key ──
                Note("Reading " + files["balances"].Count + " balance file(s)…");
                var mb = Map("balances"); Ranked("balances", "bal");
                string key = string.Join(", ", new[] { "LedgerId", "CodeCombinationId", "CurrencyCode", "PeriodName", "ActualFlag", "BudgetVersionId", "TranslatedFlag", "TemplateId" }.Where(mb.ContainsKey).Select(a => Col(mb, a)));
                X("CREATE TEMP TABLE bal AS SELECT * EXCLUDE (rn) FROM (SELECT " + Col(mb, "LedgerId") + " ledger_id, TRY_CAST(" + Col(mb, "CodeCombinationId") + " AS BIGINT) ccid, " + Col(mb, "CurrencyCode") + " currency, " +
                  Col(mb, "PeriodName") + " period_name, " + Col(mb, "ActualFlag") + " actual_flag, " + Col(mb, "BudgetVersionId") + " budget_version_id, " + Col(mb, "TranslatedFlag") + " translated_flag, " + Col(mb, "TemplateId") + " template_id, " +
                  Num(Col(mb, "BeginBalanceDr")) + " - " + Num(Col(mb, "BeginBalanceCr")) + " bb, " + Num(Col(mb, "PeriodNetDr")) + " dr, " + Num(Col(mb, "PeriodNetCr")) + " cr, " + Ts(Col(mb, "LastUpdateDate")) + " upd, " +
                  "ROW_NUMBER() OVER (PARTITION BY " + key + " ORDER BY f.rnk) rn FROM " + Reader(files["balances"]) + " v JOIN f_bal f ON f.fname = replace(v.filename, '\\', '/')) WHERE rn = 1");
                Note("  " + N("SELECT COUNT(*) FROM bal").ToString("N0", CultureInfo.InvariantCulture) + " balance rows");

                if (jnl)
                {
                    Note("Reading " + files["journal_headers"].Count + " journal header and " + files["journal_lines"].Count + " journal line file(s)…");
                    var mh = Map("journal_headers"); Ranked("journal_headers", "jh");
                    X("CREATE TEMP TABLE jh AS SELECT * EXCLUDE (rn) FROM (SELECT TRY_CAST(" + Col(mh, "JeHeaderId") + " AS BIGINT) id, " + Col(mh, "LedgerId") + " ledger_id, " + Col(mh, "JeBatchId") + " batch_id, " + Col(mh, "Name") + " je_name, " +
                      Col(mh, "JeSource") + " src, " + Col(mh, "JeCategory") + " cat, " + Col(mh, "Status") + " status, " + Col(mh, "ActualFlag") + " actual_flag, " + Ts(Col(mh, "DefaultEffectiveDate")) + " eff, " +
                      "COALESCE(" + Ts(Col(mh, "PostedDate")) + ", " + Ts(Col(mh, "CreationDate")) + ") posted, " + Col(mh, "CreatedBy") + " created_by, " + Col(mh, "Description") + " descr, " +
                      "ROW_NUMBER() OVER (PARTITION BY " + Col(mh, "JeHeaderId") + " ORDER BY f.rnk) rn FROM " + Reader(files["journal_headers"]) + " v JOIN f_jh f ON f.fname = replace(v.filename, '\\', '/')) WHERE rn = 1");
                    var ml = Map("journal_lines"); Ranked("journal_lines", "jl");
                    X("CREATE TEMP TABLE jl AS SELECT * EXCLUDE (rn) FROM (SELECT TRY_CAST(" + Col(ml, "JeHeaderId") + " AS BIGINT) id, TRY_CAST(" + Col(ml, "JeLineNum") + " AS INTEGER) ln, " + Col(ml, "PeriodName") + " period_name, " +
                      "TRY_CAST(" + Col(ml, "CodeCombinationId") + " AS BIGINT) ccid, " + Num(Col(ml, "AccountedDr")) + " dr, " + Num(Col(ml, "AccountedCr")) + " cr, " + Col(ml, "Description") + " descr, " + Ts(Col(ml, "EffectiveDate")) + " eff, " +
                      "ROW_NUMBER() OVER (PARTITION BY " + Col(ml, "JeHeaderId") + ", " + Col(ml, "JeLineNum") + " ORDER BY f.rnk) rn FROM " + Reader(files["journal_lines"]) + " v JOIN f_jl f ON f.fname = replace(v.filename, '\\', '/')) WHERE rn = 1");
                    if (files["journal_batches"].Count > 0)
                    {
                        var mbt = Map("journal_batches"); Ranked("journal_batches", "jb");
                        X("CREATE TEMP TABLE jb AS SELECT * EXCLUDE (rn) FROM (SELECT " + Col(mbt, "JeBatchId") + " batch_id, " + Col(mbt, "Name") + " batch_name, ROW_NUMBER() OVER (PARTITION BY " + Col(mbt, "JeBatchId") + " ORDER BY f.rnk) rn FROM " +
                          Reader(files["journal_batches"]) + " v JOIN f_jb f ON f.fname = replace(v.filename, '\\', '/')) WHERE rn = 1");
                    }
                    else X("CREATE TEMP TABLE jb (batch_id VARCHAR, batch_name VARCHAR)");
                    Note("  " + N("SELECT COUNT(*) FROM jh").ToString("N0", CultureInfo.InvariantCulture) + " journals, " + N("SELECT COUNT(*) FROM jl").ToString("N0", CultureInfo.InvariantCulture) + " lines");
                }

                // ── write per ledger ──
                foreach (var led in o.Ledgers)
                {
                    ct.ThrowIfCancellationRequested();
                    string co = "g." + led.Company, cc = led.CostCentre != null ? "g." + led.CostCentre : "'-'", ac = "g." + led.Account, ledLit = Lit(led.Id.ToString(CultureInfo.InvariantCulture));
                    string common = "b.ledger_id = " + ledLit + " AND b.currency = " + Lit(led.Currency) + " AND COALESCE(b.translated_flag, 'X') <> 'R' AND COALESCE(b.template_id, '') = '' AND COALESCE(g.summary_flag, 'N') <> 'Y'";
                    Note("Writing " + led.Name + " balances…");
                    X("INSERT INTO fin_balances SELECT 'ACTUAL', " + co + ", " + cc + ", " + ac + ", t.t_name, t.t_seq, ROUND(SUM(CASE WHEN b.period_name = t.t_name THEN b.bb ELSE 0 END), 2), ROUND(SUM(b.dr), 2), ROUND(SUM(b.cr), 2), " +
                      "ROUND(SUM(b.dr) - SUM(b.cr), 2), ROUND(SUM(CASE WHEN b.period_name = t.t_name THEN b.bb ELSE 0 END) + SUM(b.dr) - SUM(b.cr), 2), " + Lit(led.Code) +
                      " FROM bal b JOIN gcc g ON g.ccid = b.ccid JOIN cal t ON t.period_name = b.period_name WHERE " + common + " AND b.actual_flag = 'A' AND t.t_seq BETWEEN " + from + " AND " + to +
                      " GROUP BY ALL HAVING ABS(SUM(CASE WHEN b.period_name = t.t_name THEN b.bb ELSE 0 END)) >= 0.005 OR ABS(SUM(b.dr)) >= 0.005 OR ABS(SUM(b.cr)) >= 0.005");
                    if (!string.IsNullOrWhiteSpace(o.BudgetVersionId))
                        X("INSERT INTO fin_balances SELECT 'BUDGET', co, cc, ac, t_name, t_seq, ROUND(SUM(net) OVER w - net, 2), dr, cr, net, ROUND(SUM(net) OVER w, 2), " + Lit(led.Code) + " FROM (" +
                          "SELECT " + co + " co, " + cc + " cc, " + ac + " ac, t.t_name, t.t_seq, t.t_year, ROUND(SUM(b.dr), 2) dr, ROUND(SUM(b.cr), 2) cr, ROUND(SUM(b.dr) - SUM(b.cr), 2) net FROM bal b JOIN gcc g ON g.ccid = b.ccid JOIN cal t ON t.period_name = b.period_name " +
                          "WHERE " + common + " AND b.actual_flag = 'B' AND b.budget_version_id = " + Lit(o.BudgetVersionId) + " AND t.t_seq <= " + to + " GROUP BY ALL) z WHERE t_seq >= " + from +
                          " WINDOW w AS (PARTITION BY co, cc, ac, t_year ORDER BY t_seq ROWS UNBOUNDED PRECEDING)");
                    if (jnl)
                    {
                        Note("Writing " + led.Name + " journal lines…");
                        X("INSERT INTO fin_journals SELECT h.id, l.ln, jb.batch_name, h.je_name, h.src, h.cat, t.t_name, t.t_seq, CAST(COALESCE(l.eff, h.eff) AS DATE), h.posted, h.created_by, " + co + ", " + cc + ", " + ac + ", " +
                          "ROUND(l.dr, 2), ROUND(l.cr, 2), substr(COALESCE(l.descr, h.descr), 1, 200), " + Lit(led.Code) +
                          " FROM jl l JOIN jh h ON h.id = l.id JOIN gcc g ON g.ccid = l.ccid JOIN cal t ON t.period_name = l.period_name LEFT JOIN jb ON jb.batch_id = h.batch_id " +
                          "WHERE h.ledger_id = " + ledLit + " AND h.status = 'P' AND h.actual_flag = 'A' AND t.t_seq BETWEEN " + from + " AND " + to);
                    }
                    // what each period holds (no Fusion fingerprint: the check compares totals)
                    X("INSERT INTO fin_sync_periods SELECT " + Lit(led.Code) + ", t.t_seq, t.t_name, 'BAL', COUNT(*), NULL, ROUND(SUM(b.dr), 2), ROUND(SUM(b.cr), 2), NULL, now(), NULL, 'bicc', " + Lit(o.Pod ?? "") +
                      " FROM bal b JOIN gcc g ON g.ccid = b.ccid JOIN cal t ON t.period_name = b.period_name WHERE " + common + " AND b.actual_flag = 'A' AND t.t_seq BETWEEN " + from + " AND " + to + " GROUP BY t.t_seq, t.t_name");
                    if (jnl)
                        X("INSERT INTO fin_sync_periods SELECT ledger, period_seq, period_name, 'JNL', COUNT(*), COUNT(DISTINCT je_id), ROUND(SUM(dr), 2), ROUND(SUM(cr), 2), NULL, now(), NULL, 'bicc', " + Lit(o.Pod ?? "") +
                          " FROM fin_journals WHERE ledger = " + Lit(led.Code) + " GROUP BY ledger, period_seq, period_name");
                }

                // ── dimensions ──
                var lead = o.Ledgers[0];
                string coaIn = string.Join(",", o.Ledgers.Select(l => Lit(l.CoaId)).Distinct());
                X("INSERT INTO fin_accounts SELECT a.code, COALESCE(sv.description, a.code), a.t, NULL, NULL FROM (SELECT g." + lead.Account + " code, mode(g.account_type) t FROM gcc g WHERE g.coa IN (" + coaIn + ") AND g." + lead.Account +
                  " IN (SELECT DISTINCT account FROM fin_balances UNION SELECT DISTINCT account FROM fin_journals) GROUP BY 1) a LEFT JOIN (SELECT value, ANY_VALUE(description) description FROM fin_segment_values WHERE column_name = " + Lit(lead.Account) +
                  " GROUP BY value) sv ON sv.value = a.code");
                X("CREATE TEMP TABLE conames (code VARCHAR, name VARCHAR)");
                FinanceLens.Append(conn, "conames", o.Ledgers.SelectMany(l => l.CompanyNames).GroupBy(kv => kv.Key).Select(g => new object[] { g.Key, g.First().Value }).ToList());
                X("INSERT INTO fin_companies SELECT c.company, COALESCE(n.name, sv.description, c.company), c.currency FROM (SELECT b.company, ANY_VALUE(l.currency) currency FROM fin_balances b JOIN (SELECT * FROM (VALUES " +
                  string.Join(", ", o.Ledgers.Select(l => "(" + Lit(l.Code) + ", " + Lit(l.Currency) + ")")) + ") t(code, currency)) l ON l.code = b.ledger GROUP BY 1) c LEFT JOIN conames n ON n.code = c.company " +
                  "LEFT JOIN (SELECT value, ANY_VALUE(description) description FROM fin_segment_values WHERE column_name = " + Lit(lead.Company) + " GROUP BY value) sv ON sv.value = c.company");
                X("INSERT INTO fin_cost_centres SELECT c.cost_centre, CASE WHEN c.cost_centre = '-' THEN '(no cost centre segment)' ELSE COALESCE(sv.description, c.cost_centre) END, NULL FROM (SELECT DISTINCT cost_centre FROM fin_balances) c " +
                  "LEFT JOIN (SELECT value, ANY_VALUE(description) description FROM fin_segment_values WHERE column_name = " + Lit(lead.CostCentre ?? "-") + " GROUP BY value) sv ON sv.value = c.cost_centre");
                X("INSERT INTO fin_periods SELECT DISTINCT t_name, t_seq, t_year, t_num, t_q, t_start, t_end FROM cal WHERE t_seq BETWEEN " + from + " AND " + to + " AND t_seq IN (SELECT DISTINCT period_seq FROM fin_balances)");
                FinanceLens.Append(conn, "fin_ledgers", o.Ledgers.Select(l => new object[] { l.Code, l.Name, l.Currency, l.CoaId, l.Company, l.CostCentre, l.Account, l.Category }).ToList());
                FinanceLens.Append(conn, "fin_segments", new List<object[]> {
                    new object[] { 1, "COMPANY", "Company (" + lead.Company + ")", lead.Company }, new object[] { 2, "COST_CENTRE", "Cost centre (" + (lead.CostCentre ?? "none") + ")", lead.CostCentre },
                    new object[] { 3, "ACCOUNT", "Account (" + lead.Account + ")", lead.Account } });
                var chosen = o.Ledgers.GroupBy(l => l.CoaId ?? "").ToDictionary(g => g.Key, g => new Dictionary<string, string> { ["company"] = g.First().Company, ["costCentre"] = g.First().CostCentre, ["account"] = g.First().Account });
                if (o.Discovery.ValueKind == JsonValueKind.Object) FinanceFusion.WriteDiscovery(conn, o.Pod ?? "", o.Discovery.GetRawText(), o.User, chosen);
                else if (prev != null) FinanceFusion.WriteDiscovery(conn, o.Pod ?? "", prev.Value.Json, prev.Value.By, chosen);
                string signature = string.Join(";", o.Ledgers.OrderBy(l => l.Id).Select(l => l.Id + ":" + l.Company + "/" + l.CostCentre + "/" + l.Account + "/" + l.Currency));
                FinanceLens.Append(conn, "fin_meta", new List<object[]>
                {
                    new object[] { "source", "FUSION" }, new object[] { "loader", "BICC" }, new object[] { "pod", o.Pod ?? "" }, new object[] { "loaded_at", DateTime.Now.ToString("s") },
                    new object[] { "currency", lead.Currency }, new object[] { "currencies", string.Join(",", o.Ledgers.Select(l => l.Currency).Distinct()) },
                    new object[] { "description", "Oracle Fusion GL (BICC extracts): " + string.Join(", ", o.Ledgers.Select(l => l.Name)) },
                    new object[] { "fusion_signature", signature }, new object[] { "from_seq", from.ToString(CultureInfo.InvariantCulture) }, new object[] { "to_seq", to.ToString(CultureInfo.InvariantCulture) },
                    new object[] { "budget", string.IsNullOrWhiteSpace(o.BudgetVersionId) ? "" : "GL_BALANCES:" + o.BudgetVersionId }, new object[] { "load_mode", "BICC" }, new object[] { "bicc_folder", folder }
                });
                nBal = N("SELECT COUNT(*) FROM fin_balances"); nJnl = N("SELECT COUNT(*) FROM fin_journals");
                X("CHECKPOINT");
            }
            catch (OperationCanceledException) { Note("✖ Cancelled - nothing was changed."); return new { ok = false, error = "Cancelled - nothing was changed.", log }; }
            catch (Exception ex) { Note("✖ " + ex.Message + " - nothing was changed."); return new { ok = false, error = ex.Message, log }; }
            FinanceLens.SwapIn(tmp);
            FinanceLens.DropPending(pendingSeg);
            Note("Done: " + nBal.ToString("N0", CultureInfo.InvariantCulture) + " balances, " + nJnl.ToString("N0", CultureInfo.InvariantCulture) + " journal lines in " + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s.");
            try { File.WriteAllLines(Path.Combine(FinanceLens.Root, "fusion-sync.log"), new[] { "BICC load " + DateTime.Now.ToString("s") }.Concat(log)); } catch { }
            return new { ok = true, balances = nBal, journals = nJnl, mode = "BICC", ms = sw.ElapsedMilliseconds, log };
        }

        // ───────────────────────── UCM (where BICC drops its files) ─────────────────────────
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };

        private static HttpRequestMessage Req(string origin, string query, string user, string pass)
        {
            if (!origin.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || !new Uri(origin).Host.EndsWith(".oraclecloud.com", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("UCM: only https://*.oraclecloud.com pods.");
            var r = new HttpRequestMessage(HttpMethod.Get, origin.TrimEnd('/') + "/cs/idcplg?" + query);
            r.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(user + ":" + pass)));
            return r;
        }

        /// <summary>Lists the BICC extract files of the GL PVOs in UCM (newest first).</summary>
        public static async Task<object> UcmListAsync(string origin, string user, string pass, CancellationToken ct)
        {
            var res = new List<object>();
            foreach (var p in PVOS)
            {
                string q = "IdcService=GET_SEARCH_RESULTS&QueryText=" + Uri.EscapeDataString("dDocTitle <substring> `" + p.Title + "`") + "&ResultCount=200&SortField=dInDate&SortOrder=Desc&IsJson=1";
                using var rq = Req(origin, q, user, pass);
                using var resp = await Http.SendAsync(rq, ct).ConfigureAwait(false);
                string body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode) return new { ok = false, error = "UCM answered HTTP " + (int)resp.StatusCode + " - check that the Fusion user may read the BICC account (obiaImport / OBIA)." };
                try
                {
                    using var d = JsonDocument.Parse(body);
                    if (d.RootElement.TryGetProperty("LocalData", out var ld) && ld.TryGetProperty("StatusCode", out var sc) && sc.GetString() is string st && st.StartsWith("-"))
                        return new { ok = false, error = "UCM: " + (ld.TryGetProperty("StatusMessage", out var sm) ? sm.GetString() : st) };
                    var rs = d.RootElement.GetProperty("ResultSets").GetProperty("SearchResults");
                    var fields = rs.GetProperty("fields").EnumerateArray().Select(f => f.GetProperty("name").GetString()).ToList();
                    foreach (var row in rs.GetProperty("rows").EnumerateArray())
                    {
                        var vals = row.EnumerateArray().Select(v => v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString()).ToList();
                        string g(string n) { int i = fields.IndexOf(n); return i >= 0 && i < vals.Count ? vals[i] : null; }
                        res.Add(new { pvo = p.Key, id = g("dID"), name = g("dDocName"), title = g("dDocTitle"), date = g("dInDate"), size = g("dFileSize") ?? g("VaultFileSize"), original = g("dOriginalName") });
                    }
                }
                catch (Exception ex) { return new { ok = false, error = "UCM answer not understood (" + ex.Message + "): " + (body.Length > 200 ? body.Substring(0, 200) : body) }; }
            }
            return new { ok = true, files = res };
        }

        /// <summary>Downloads UCM documents (by dID) into the BICC folder; refuses HTML error pages.</summary>
        public static async Task<object> UcmDownloadAsync(string origin, string user, string pass, List<(string Id, string Title)> docs, string folder, Action<string> progress, CancellationToken ct)
        {
            folder = string.IsNullOrWhiteSpace(folder) ? DefaultFolder : folder;
            Directory.CreateDirectory(folder);
            var saved = new List<string>();
            foreach (var (id, title) in docs)
            {
                if (!long.TryParse(id, out _)) continue;
                string name = string.Concat((title ?? ("ucm_" + id)).Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
                if (!name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && !name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)) name += ".zip";
                string dest = Path.Combine(folder, name);
                if (File.Exists(dest)) { progress?.Invoke("already here: " + name); saved.Add(name); continue; }
                progress?.Invoke("Downloading " + name + "…");
                using var rq = Req(origin, "IdcService=GET_FILE&dID=" + id, user, pass);
                using var resp = await Http.SendAsync(rq, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode) return new { ok = false, error = "UCM GET_FILE " + id + ": HTTP " + (int)resp.StatusCode, saved };
                string part = dest + ".part";
                using (var fs = File.Create(part)) await resp.Content.CopyToAsync(fs, ct).ConfigureAwait(false);
                var head = new byte[4];
                using (var fs = File.OpenRead(part)) fs.Read(head, 0, 4);
                bool zip = head[0] == 'P' && head[1] == 'K';
                if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) && !zip) { File.Delete(part); return new { ok = false, error = name + " is not a ZIP (UCM sent an error page?)", saved }; }
                File.Move(part, dest, true);
                saved.Add(name);
            }
            return new { ok = true, folder, saved };
        }
    }
}

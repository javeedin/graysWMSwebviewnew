using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using DuckDB.NET.Data;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens ⇄ Oracle Fusion GL, read-only through the Fusion SQL runner (BI Publisher).
    /// Discover: probes the data dictionary first (ALL_TAB_COLUMNS of the GL / flexfield tables) so every later query only
    /// names columns that exist on this pod, then reads the ledgers (GL_LEDGERS), the chart of accounts segments and their
    /// qualifiers (FND_ID_FLEX_SEGMENTS + FND_SEGMENT_ATTRIBUTE_VALUES, or the Fusion key-flexfield tables FND_KF_*),
    /// the balancing segment (GL_LEDGERS.BAL_SEG_COLUMN_NAME or the GL_BALANCING qualifier), the natural account segment
    /// (GL_ACCOUNT qualifier, else measured: the segment whose values each carry one ACCOUNT_TYPE in GL_CODE_COMBINATIONS),
    /// the cost centre segment (FA_COST_CTR qualifier or its name), the companies of each ledger (balancing values + legal
    /// entities), the account types (majority ACCOUNT_TYPE per account value), the accounting calendar (GL_PERIODS) and the
    /// budgets (GL_BUDGET_BALANCES or GL_BALANCES actual_flag B).
    /// Sync: GL_BALANCES × GL_CODE_COMBINATIONS summed to company × cost centre × account per ledger and period (ledger
    /// currency, no translated / entered-currency rows, no summary accounts), adjustment periods folded into the period they
    /// close, optional budget, and the posted journal lines of the last N months (keyset paging by JE_HEADER_ID) — written
    /// to a new DuckDB file that is swapped in. Incremental: the current file is copied and only the synced periods replaced.
    /// </summary>
    public static class FinanceFusion
    {
        public delegate Task<FusionQueryResult> Runner(string sql, int cap, CancellationToken ct);

        /// <summary>Rows per ranked chunk (the user can choose 500 - 10,000); a chunk that times out is read again at half the size.</summary>
        public const int DEFAULT_CHUNK = 2000;
        private const int MIN_CHUNK = 250;

        // ───────────────────────── small helpers ─────────────────────────
        private static string S(Dictionary<string, object> r, string k)
        {
            if (r == null) return null;
            if (r.TryGetValue(k, out var v) || r.TryGetValue(k.ToUpperInvariant(), out v) || r.TryGetValue(k.ToLowerInvariant(), out v)) return v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture);
            foreach (var kv in r) if (string.Equals(kv.Key, k, StringComparison.OrdinalIgnoreCase)) return kv.Value == null ? null : Convert.ToString(kv.Value, CultureInfo.InvariantCulture);
            return null;
        }
        private static double D(Dictionary<string, object> r, string k)
        {
            string s = S(r, k);
            if (string.IsNullOrWhiteSpace(s)) return 0;
            s = s.Trim();
            if (s.Contains(',') && !s.Contains('.')) s = s.Replace(',', '.');
            return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
        }
        private static long L(Dictionary<string, object> r, string k) => (long)Math.Round(D(r, k));
        private static string Q(string s) => "'" + (s ?? "").Replace("'", "''") + "'";
        private static readonly Regex COL = new Regex("^SEGMENT([1-9]|[12][0-9]|30)$", RegexOptions.IgnoreCase);
        /// <summary>Only SEGMENT1..30 may be put into SQL as a column name.</summary>
        public static string SegCol(string c)
        {
            if (string.IsNullOrWhiteSpace(c)) return null;
            c = c.Trim().ToUpperInvariant();
            return COL.IsMatch(c) ? c : null;
        }
        private static string IdList(IEnumerable<long> ids) => string.Join(",", ids.Distinct());

        private sealed class Ctx
        {
            public Runner Run; public CancellationToken Ct; public Action<string> Progress;
            public List<string> Log = new();
            public Dictionary<string, HashSet<string>> Cols = new(StringComparer.OrdinalIgnoreCase);
            /// <summary>table → column → Oracle data type, in column order (from ALL_TAB_COLUMNS).</summary>
            public Dictionary<string, List<(string Col, string Type)>> Types = new(StringComparer.OrdinalIgnoreCase);
            public bool Has(string table, string col) => Cols.TryGetValue(table, out var c) && c.Contains(col);
            public bool HasTable(string table) => Cols.ContainsKey(table) && Cols[table].Count > 0;
            public void Note(string s) { lock (Log) Log.Add(DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "  " + s); Progress?.Invoke(s); }
            /// <summary>A structured event for the page's live monitor (not in the log): "\u0001" + JSON —
            /// t = sql (a query starts: id, what, sql), end (it finished: id, ok, rows, ms, error), sample (first rows of a step).</summary>
            public void Live(object o) { try { Progress?.Invoke("\u0001" + JsonSerializer.Serialize(o)); } catch { } }
            public bool LogSql;
        }

        private static int _liveId;
        /// <summary>Runs one Fusion query and tells the live monitor when it starts (with its SQL) and ends.</summary>
        private static async Task<FusionQueryResult> RunLive(Ctx x, string what, string sql, int cap)
        {
            int id = Interlocked.Increment(ref _liveId);
            x.Live(new { t = "sql", id, what, sql, at = DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) });
            var sw = Stopwatch.StartNew();
            FusionQueryResult r = null;
            try { r = await x.Run(sql, cap, x.Ct).ConfigureAwait(false); return r; }
            finally { x.Live(new { t = "end", id, ok = r != null && r.Success, rows = r?.Rows?.Count ?? 0, ms = sw.ElapsedMilliseconds, error = r == null ? "cancelled" : r.Success ? null : r.Error }); }
        }
        /// <summary>The first rows of a step for the live monitor (column names without the ranking column).</summary>
        private static void LiveSample(Ctx x, string what, List<Dictionary<string, object>> rows)
        {
            if (rows == null || rows.Count == 0) return;
            var cols = rows[0].Keys.Where(k => !string.Equals(k, "RN", StringComparison.OrdinalIgnoreCase)).ToList();
            x.Live(new { t = "sample", what, cols, rows = rows.Take(5).Select(r => cols.Select(c => r.TryGetValue(c, out var v) ? Convert.ToString(v, CultureInfo.InvariantCulture) : null).ToList()).ToList() });
        }

        private static async Task<FusionQueryResult> Try(Ctx x, string label, int cap, params string[] variants)
        {
            string last = null;
            foreach (var sql in variants.Where(v => !string.IsNullOrWhiteSpace(v)))
            {
                x.Ct.ThrowIfCancellationRequested();
                var r = await RunLive(x, label, sql, cap).ConfigureAwait(false);
                if (r.Success) return r;
                last = r.Error;
                Debug.WriteLine("[FinanceFusion] " + label + " variant failed: " + r.Error);
            }
            x.Note("⚠ " + label + ": " + (last ?? "no query applies on this pod"));
            return null;
        }

        private static readonly string[] PROBE_TABLES =
        {
            "GL_LEDGERS", "GL_BALANCES", "GL_BUDGET_BALANCES", "GL_BUDGET_VERSIONS", "GL_CODE_COMBINATIONS", "GL_PERIODS", "GL_PERIOD_STATUSES",
            "GL_JE_HEADERS", "GL_JE_LINES", "GL_JE_BATCHES", "GL_LEDGER_NORM_SEG_VALS", "XLE_ENTITY_PROFILES",
            "FND_ID_FLEX_SEGMENTS", "FND_ID_FLEX_SEGMENTS_VL", "FND_SEGMENT_ATTRIBUTE_VALUES", "FND_FLEX_VALUES_VL",
            "FND_KF_SEGMENTS_B", "FND_KF_STR_INSTANCES_B", "FND_KF_SEGMENT_INSTANCES", "FND_KF_LABELED_SEGMENTS", "FND_VS_VALUES_B", "FND_VS_VALUES_TL"
        };

        private static async Task Probe(Ctx x)
        {
            x.Note("Reading the data dictionary…");
            var r = await Try(x, "data dictionary", 20000,
                "SELECT table_name, column_name, data_type, column_id FROM all_tab_columns WHERE table_name IN (" + string.Join(",", PROBE_TABLES.Select(Q)) + ")",
                "SELECT table_name, column_name FROM all_tab_columns WHERE table_name IN (" + string.Join(",", PROBE_TABLES.Select(Q)) + ")").ConfigureAwait(false);
            if (r == null) return;
            foreach (var row in r.Rows)
            {
                string t = S(row, "TABLE_NAME"), c = S(row, "COLUMN_NAME");
                if (t == null || c == null) continue;
                if (!x.Cols.TryGetValue(t, out var set)) x.Cols[t] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (!set.Add(c)) continue;   // the same table can be visible in two schemas
                if (!x.Types.TryGetValue(t, out var list)) x.Types[t] = list = new();
                list.Add((c, S(row, "DATA_TYPE") ?? "VARCHAR2"));
            }
            foreach (var t in x.Types.Keys.ToList()) x.Types[t] = x.Types[t].ToList();
        }

        // ───────────────────────── discovery ─────────────────────────
        public sealed class Segment
        {
            public string Col { get; set; }
            public string Name { get; set; }
            public int Num { get; set; }
            public string ValueSetId { get; set; }
            public List<string> Qualifiers { get; set; } = new();
            public long Distinct { get; set; }
            public long DistinctWithType { get; set; }
            /// <summary>1.0 = every value of this segment has exactly one account type (a natural account segment).</summary>
            public double Purity { get; set; }
        }
        public sealed class Coa
        {
            public string CoaId { get; set; }
            public List<Segment> Segments { get; set; } = new();
            public string Company { get; set; }
            public string Account { get; set; }
            public string CostCentre { get; set; }
            public string Intercompany { get; set; }
            public Dictionary<string, string> Why { get; set; } = new();
            public long Combinations { get; set; }
            public Dictionary<string, long> AccountTypes { get; set; } = new();
        }
        public sealed class Ledger
        {
            public long Id { get; set; }
            public string Name { get; set; }
            public string ShortName { get; set; }
            public string CoaId { get; set; }
            public string Currency { get; set; }
            public string PeriodSet { get; set; }
            public string PeriodType { get; set; }
            public string Category { get; set; }
            public string BalSegCol { get; set; }
            public List<Dictionary<string, string>> Companies { get; set; } = new();
            public Dictionary<string, string> PeriodStatus { get; set; } = new();
        }
        public sealed class PeriodRow
        {
            public string Name { get; set; }
            public int Year { get; set; }
            public int Num { get; set; }
            public int Quarter { get; set; }
            public string Start { get; set; }
            public string End { get; set; }
            public bool Adj { get; set; }
            public int Seq => Year * 100 + Num;
        }
        public sealed class Budget { public string Source { get; set; } public string Id { get; set; } public string Name { get; set; } public long Rows { get; set; } }

        public sealed class Discovery
        {
            public bool Ok { get; set; } = true;
            public string Error { get; set; }
            public List<Ledger> Ledgers { get; set; } = new();
            public Dictionary<string, Coa> Coas { get; set; } = new();
            public Dictionary<string, List<PeriodRow>> Calendars { get; set; } = new();
            public List<Budget> Budgets { get; set; } = new();
            public List<string> Log { get; set; } = new();
            public long Ms { get; set; }
            public string DiscoveredAt { get; set; }
        }

        public static async Task<Discovery> DiscoverAsync(Runner run, Action<string> progress, CancellationToken ct)
        {
            var sw = Stopwatch.StartNew();
            var x = new Ctx { Run = run, Ct = ct, Progress = progress };
            var d = new Discovery { DiscoveredAt = DateTime.Now.ToString("s") };
            try
            {
                await Probe(x).ConfigureAwait(false);

                // 1. ledgers
                x.Note("Finding the ledgers…");
                bool bal = x.Has("GL_LEDGERS", "BAL_SEG_COLUMN_NAME"), cat = x.Has("GL_LEDGERS", "LEDGER_CATEGORY_CODE"), obj = x.Has("GL_LEDGERS", "OBJECT_TYPE_CODE");
                string lsql = "SELECT ledger_id, name, short_name, chart_of_accounts_id, currency_code, period_set_name, accounted_period_type" +
                              (cat ? ", ledger_category_code" : "") + (bal ? ", bal_seg_column_name" : "") + " FROM gl_ledgers" + (obj ? " WHERE object_type_code = 'L'" : "") + " ORDER BY name";
                var lr = await Try(x, "ledgers", 2000, lsql,
                    "SELECT ledger_id, name, short_name, chart_of_accounts_id, currency_code, period_set_name, accounted_period_type FROM gl_ledgers ORDER BY name").ConfigureAwait(false);
                if (lr == null) { d.Ok = false; d.Error = "Could not read GL_LEDGERS: " + x.Log.LastOrDefault(); d.Log = x.Log; return d; }
                foreach (var r in lr.Rows)
                    d.Ledgers.Add(new Ledger
                    {
                        Id = L(r, "LEDGER_ID"), Name = S(r, "NAME"), ShortName = S(r, "SHORT_NAME"), CoaId = S(r, "CHART_OF_ACCOUNTS_ID"), Currency = S(r, "CURRENCY_CODE"),
                        PeriodSet = S(r, "PERIOD_SET_NAME"), PeriodType = S(r, "ACCOUNTED_PERIOD_TYPE"), Category = S(r, "LEDGER_CATEGORY_CODE"), BalSegCol = SegCol(S(r, "BAL_SEG_COLUMN_NAME"))
                    });
                x.Note(d.Ledgers.Count + " ledger(s)");
                var coaIds = d.Ledgers.Select(l => l.CoaId).Where(c => !string.IsNullOrEmpty(c) && long.TryParse(c, out _)).Distinct().ToList();
                if (coaIds.Count == 0) { d.Log = x.Log; d.Ms = sw.ElapsedMilliseconds; return d; }
                string coaIn = string.Join(",", coaIds);
                foreach (var c in coaIds) d.Coas[c] = new Coa { CoaId = c };

                // 2. segments
                x.Note("Reading the chart of accounts structure…");
                string segTable = x.HasTable("FND_ID_FLEX_SEGMENTS") ? "fnd_id_flex_segments" : "fnd_id_flex_segments_vl";
                var sr = await Try(x, "COA segments", 2000,
                    "SELECT id_flex_num coa_id, application_column_name col, segment_name seg_name, segment_num seq, flex_value_set_id vs_id FROM " + segTable +
                    " WHERE application_id = 101 AND id_flex_code = 'GL#' AND NVL(enabled_flag, 'Y') = 'Y' AND id_flex_num IN (" + coaIn + ") ORDER BY id_flex_num, segment_num",
                    x.HasTable("FND_KF_SEGMENTS_B") && x.HasTable("FND_KF_STR_INSTANCES_B")
                        ? "SELECT si.structure_instance_number coa_id, sg.column_name col, sg.segment_code seg_name, sg.sequence_number seq" +
                          (x.Has("FND_KF_SEGMENT_INSTANCES", "VALUE_SET_ID") && x.Has("FND_KF_SEGMENT_INSTANCES", "STRUCTURE_INSTANCE_ID") ? ", gi.value_set_id vs_id" : ", NULL vs_id") +
                          " FROM fnd_kf_str_instances_b si JOIN fnd_kf_segments_b sg ON sg.application_id = si.application_id AND sg.key_flexfield_code = si.key_flexfield_code AND sg.structure_id = si.structure_id" +
                          (x.Has("FND_KF_SEGMENT_INSTANCES", "VALUE_SET_ID") && x.Has("FND_KF_SEGMENT_INSTANCES", "STRUCTURE_INSTANCE_ID") ? " LEFT JOIN fnd_kf_segment_instances gi ON gi.structure_instance_id = si.structure_instance_id AND gi.segment_code = sg.segment_code" : "") +
                          " WHERE si.key_flexfield_code = 'GL#' AND si.structure_instance_number IN (" + coaIn + ") ORDER BY 1, 4"
                        : null).ConfigureAwait(false);
                if (sr != null)
                    foreach (var r in sr.Rows)
                    {
                        string c = S(r, "COA_ID"), col = SegCol(S(r, "COL"));
                        if (c == null || col == null || !d.Coas.TryGetValue(c, out var coa) || coa.Segments.Any(s => s.Col == col)) continue;
                        coa.Segments.Add(new Segment { Col = col, Name = S(r, "SEG_NAME") ?? col, Num = (int)L(r, "SEQ"), ValueSetId = S(r, "VS_ID") });
                    }

                // 3. qualifiers
                var qr = await Try(x, "segment qualifiers", 2000,
                    x.HasTable("FND_SEGMENT_ATTRIBUTE_VALUES")
                        ? "SELECT id_flex_num coa_id, application_column_name col, segment_attribute_type q FROM fnd_segment_attribute_values WHERE application_id = 101 AND id_flex_code = 'GL#' AND attribute_value = 'Y' AND id_flex_num IN (" + coaIn + ")"
                        : null,
                    x.HasTable("FND_KF_LABELED_SEGMENTS") && x.HasTable("FND_KF_SEGMENTS_B")
                        ? "SELECT si.structure_instance_number coa_id, sg.column_name col, ls.segment_label_code q FROM fnd_kf_labeled_segments ls JOIN fnd_kf_segments_b sg ON sg.application_id = ls.application_id AND sg.key_flexfield_code = ls.key_flexfield_code AND sg.structure_id = ls.structure_id AND sg.segment_code = ls.segment_code " +
                          "JOIN fnd_kf_str_instances_b si ON si.application_id = sg.application_id AND si.key_flexfield_code = sg.key_flexfield_code AND si.structure_id = sg.structure_id WHERE ls.key_flexfield_code = 'GL#' AND si.structure_instance_number IN (" + coaIn + ")"
                        : null).ConfigureAwait(false);
                if (qr != null)
                    foreach (var r in qr.Rows)
                    {
                        string c = S(r, "COA_ID"), col = SegCol(S(r, "COL")), q = S(r, "Q");
                        if (c == null || col == null || q == null || !d.Coas.TryGetValue(c, out var coa)) continue;
                        var seg = coa.Segments.FirstOrDefault(s => s.Col == col);
                        if (seg == null) coa.Segments.Add(seg = new Segment { Col = col, Name = col, Num = 100 + int.Parse(col.Substring(7), CultureInfo.InvariantCulture) });
                        if (!seg.Qualifiers.Contains(q)) seg.Qualifiers.Add(q);
                    }

                // 4. measure the segments in the code combinations: which one carries the account type?
                foreach (var coa in d.Coas.Values)
                {
                    x.Note("Measuring the segments of chart " + coa.CoaId + "…");
                    var cols = coa.Segments.Count > 0 ? coa.Segments.OrderBy(s => s.Num).Select(s => s.Col).ToList() : Enumerable.Range(1, 10).Select(i => "SEGMENT" + i).ToList();
                    var sql = new StringBuilder("SELECT COUNT(*) n");
                    for (int i = 0; i < cols.Count; i++) sql.Append(", COUNT(DISTINCT ").Append(cols[i]).Append(") d").Append(i).Append(", COUNT(DISTINCT ").Append(cols[i]).Append("||'|'||account_type) t").Append(i);
                    sql.Append(" FROM gl_code_combinations WHERE chart_of_accounts_id = ").Append(coa.CoaId).Append(x.Has("GL_CODE_COMBINATIONS", "SUMMARY_FLAG") ? " AND NVL(summary_flag, 'N') = 'N'" : "");
                    void Take(int i, long dd, long tt)
                    {
                        if (dd == 0) return;                 // segment not used
                        var seg = coa.Segments.FirstOrDefault(s => s.Col == cols[i]);
                        if (seg == null) coa.Segments.Add(seg = new Segment { Col = cols[i], Name = cols[i], Num = i + 1 });
                        seg.Distinct = dd; seg.DistinctWithType = tt; seg.Purity = tt > 0 ? Math.Round((double)dd / tt, 4) : 0;
                    }
                    string where = " FROM gl_code_combinations WHERE chart_of_accounts_id = " + coa.CoaId + (x.Has("GL_CODE_COMBINATIONS", "SUMMARY_FLAG") ? " AND NVL(summary_flag, 'N') = 'N'" : "");
                    var mr = await Try(x, "segment measures (all segments in one query)", 5, sql.ToString()).ConfigureAwait(false);
                    if (mr != null && mr.Rows.Count > 0)
                    {
                        var r = mr.Rows[0];
                        coa.Combinations = L(r, "N");
                        for (int i = 0; i < cols.Count; i++) Take(i, L(r, "D" + i), L(r, "T" + i));
                    }
                    else
                    {
                        // big charts (many segments × millions of combinations) time out in one query: one segment at a time,
                        // exact first, then Oracle's APPROX_COUNT_DISTINCT (enough for the ≥ 80 % purity test)
                        x.Note("Measuring chart " + coa.CoaId + " one segment at a time (" + cols.Count + " segments)…");
                        var nr = await Try(x, "combinations of chart " + coa.CoaId, 5, "SELECT COUNT(*) n" + where).ConfigureAwait(false);
                        if (nr != null && nr.Rows.Count > 0) coa.Combinations = L(nr.Rows[0], "N");
                        for (int i = 0; i < cols.Count; i++)
                        {
                            var segR = await Try(x, "segment " + cols[i] + " of chart " + coa.CoaId, 5,
                                "SELECT COUNT(DISTINCT " + cols[i] + ") d, COUNT(DISTINCT " + cols[i] + "||'|'||account_type) t" + where,
                                "SELECT APPROX_COUNT_DISTINCT(" + cols[i] + ") d, APPROX_COUNT_DISTINCT(" + cols[i] + "||'|'||account_type) t" + where).ConfigureAwait(false);
                            if (segR != null && segR.Rows.Count > 0)
                            {
                                Take(i, L(segR.Rows[0], "D"), L(segR.Rows[0], "T"));
                                x.Note("  " + cols[i] + ": " + L(segR.Rows[0], "D").ToString("N0", CultureInfo.InvariantCulture) + " values");
                            }
                        }
                    }
                    coa.Segments = coa.Segments.OrderBy(s => s.Num).ToList();
                    Decide(coa, d.Ledgers.Where(l => l.CoaId == coa.CoaId).Select(l => l.BalSegCol).FirstOrDefault(c => c != null));
                }

                // 5. account types per natural account value
                foreach (var coa in d.Coas.Values.Where(c => c.Account != null))
                {
                    var tr = await Try(x, "account types", 10,
                        "SELECT account_type, COUNT(DISTINCT " + coa.Account + ") n FROM gl_code_combinations WHERE chart_of_accounts_id = " + coa.CoaId + " GROUP BY account_type").ConfigureAwait(false);
                    if (tr != null) foreach (var r in tr.Rows) coa.AccountTypes[S(r, "ACCOUNT_TYPE") ?? "?"] = L(r, "N");
                }

                // 6. companies of each ledger (balancing values, with the legal entity when Fusion knows it)
                x.Note("Finding the companies of each ledger…");
                string ledIn = IdList(d.Ledgers.Select(l => l.Id));
                if (x.HasTable("GL_LEDGER_NORM_SEG_VALS"))
                {
                    bool le = x.HasTable("XLE_ENTITY_PROFILES") && x.Has("GL_LEDGER_NORM_SEG_VALS", "LEGAL_ENTITY_ID");
                    var cr = await Try(x, "ledger companies", 20000,
                        le ? "SELECT n.ledger_id, n.segment_value, x.name le_name FROM gl_ledger_norm_seg_vals n LEFT JOIN xle_entity_profiles x ON x.legal_entity_id = n.legal_entity_id WHERE n.segment_type_code = 'B' AND n.ledger_id IN (" + ledIn + ")" : null,
                        "SELECT n.ledger_id, n.segment_value, NULL le_name FROM gl_ledger_norm_seg_vals n WHERE n.segment_type_code = 'B' AND n.ledger_id IN (" + ledIn + ")").ConfigureAwait(false);
                    if (cr != null)
                        foreach (var r in cr.Rows)
                        {
                            var led = d.Ledgers.FirstOrDefault(l => l.Id == L(r, "LEDGER_ID"));
                            string v = S(r, "SEGMENT_VALUE");
                            if (led == null || v == null || led.Companies.Any(c => c["value"] == v)) continue;
                            led.Companies.Add(new Dictionary<string, string> { ["value"] = v, ["legalEntity"] = S(r, "LE_NAME") });
                        }
                }

                // 7. calendars + period statuses
                x.Note("Reading the accounting calendars…");
                foreach (var g in d.Ledgers.Where(l => l.PeriodSet != null).GroupBy(l => l.PeriodSet + "|" + l.PeriodType))
                {
                    var f = g.First();
                    var pr = await Try(x, "periods " + f.PeriodSet, 5000,
                        "SELECT period_name, period_year, period_num, quarter_num, TO_CHAR(start_date, 'YYYY-MM-DD') sd, TO_CHAR(end_date, 'YYYY-MM-DD') ed, adjustment_period_flag adj FROM gl_periods WHERE period_set_name = " +
                        Q(f.PeriodSet) + " AND period_type = " + Q(f.PeriodType) + " ORDER BY period_year, period_num").ConfigureAwait(false);
                    if (pr == null) continue;
                    d.Calendars[g.Key] = pr.Rows.Select(r => new PeriodRow
                    {
                        Name = S(r, "PERIOD_NAME"), Year = (int)L(r, "PERIOD_YEAR"), Num = (int)L(r, "PERIOD_NUM"), Quarter = (int)L(r, "QUARTER_NUM"),
                        Start = S(r, "SD"), End = S(r, "ED"), Adj = S(r, "ADJ") == "Y"
                    }).Where(p => p.Name != null).ToList();
                }
                var st = await Try(x, "period statuses", 20000,
                    "SELECT ledger_id, period_name, closing_status FROM gl_period_statuses WHERE application_id = 101 AND ledger_id IN (" + ledIn + ")").ConfigureAwait(false);
                if (st != null)
                    foreach (var r in st.Rows)
                    {
                        var led = d.Ledgers.FirstOrDefault(l => l.Id == L(r, "LEDGER_ID"));
                        if (led != null && S(r, "PERIOD_NAME") != null) led.PeriodStatus[S(r, "PERIOD_NAME")] = S(r, "CLOSING_STATUS");
                    }

                // 8. budgets
                x.Note("Looking for budgets…");
                if (x.HasTable("GL_BUDGET_BALANCES"))
                {
                    string nameCol = new[] { "BUDGET_NAME", "SCENARIO", "BUDGET_VERSION_ID" }.FirstOrDefault(c => x.Has("GL_BUDGET_BALANCES", c));
                    if (nameCol != null)
                    {
                        var br = await Try(x, "budget balances", 200, "SELECT " + nameCol + " bname, COUNT(*) n FROM gl_budget_balances WHERE ledger_id IN (" + ledIn + ") GROUP BY " + nameCol).ConfigureAwait(false);
                        if (br != null) foreach (var r in br.Rows) d.Budgets.Add(new Budget { Source = "GL_BUDGET_BALANCES", Id = S(r, "BNAME"), Name = S(r, "BNAME"), Rows = L(r, "N") });
                    }
                }
                if (x.HasTable("GL_BUDGET_VERSIONS"))
                {
                    var bv = await Try(x, "budget versions", 200,
                        "SELECT v.budget_version_id id, v.budget_name bname, (SELECT COUNT(*) FROM gl_balances b WHERE b.actual_flag = 'B' AND b.budget_version_id = v.budget_version_id AND b.ledger_id IN (" + ledIn + ")) n FROM gl_budget_versions v").ConfigureAwait(false);
                    if (bv != null) foreach (var r in bv.Rows.Where(r => L(r, "N") > 0)) d.Budgets.Add(new Budget { Source = "GL_BALANCES", Id = S(r, "ID"), Name = S(r, "BNAME"), Rows = L(r, "N") });
                }
                x.Note("Done: " + d.Ledgers.Count + " ledger(s), " + d.Coas.Count + " chart(s) of accounts, " + d.Budgets.Count + " budget(s).");
            }
            catch (OperationCanceledException) { d.Ok = false; d.Error = "Cancelled."; }
            catch (Exception ex) { d.Ok = false; d.Error = ex.Message; }
            d.Log = x.Log;
            d.Ms = sw.ElapsedMilliseconds;
            return d;
        }

        /// <summary>Chooses the company, account, cost centre and intercompany segments, and says why.</summary>
        internal static void Decide(Coa coa, string ledgerBalSeg)
        {
            Segment byQ(string q) => coa.Segments.FirstOrDefault(s => s.Qualifiers.Contains(q));
            Segment byName(params string[] words) => coa.Segments.FirstOrDefault(s => words.Any(w => Regex.IsMatch(s.Name ?? "", w, RegexOptions.IgnoreCase)));
            var used = coa.Segments.Where(s => s.Distinct != 0 || s.Qualifiers.Count > 0 || coa.Combinations == 0).ToList();

            // balancing
            if (ledgerBalSeg != null && coa.Segments.Any(s => s.Col == ledgerBalSeg)) { coa.Company = ledgerBalSeg; coa.Why["company"] = "GL_LEDGERS.BAL_SEG_COLUMN_NAME"; }
            else if (byQ("GL_BALANCING") != null) { coa.Company = byQ("GL_BALANCING").Col; coa.Why["company"] = "Balancing segment qualifier"; }
            else if (byName(@"compan", @"entity", @"\bco\b", @"balanc") is Segment bn) { coa.Company = bn.Col; coa.Why["company"] = "Segment name \"" + bn.Name + "\""; }
            else if (used.Count > 0) { coa.Company = used[0].Col; coa.Why["company"] = "First segment (no qualifier found)"; }

            // natural account
            var aq = byQ("GL_ACCOUNT");
            if (aq != null) { coa.Account = aq.Col; coa.Why["account"] = "Natural account qualifier" + (aq.Purity > 0 ? " · " + (aq.Purity * 100).ToString("0.#", CultureInfo.InvariantCulture) + " % of its values carry one account type" : ""); }
            else
            {
                var best = used.Where(s => s.Col != coa.Company && s.Distinct >= 5).OrderByDescending(s => Math.Round(s.Purity, 2)).ThenByDescending(s => s.Distinct).FirstOrDefault();
                if (best != null && best.Purity >= 0.8) { coa.Account = best.Col; coa.Why["account"] = "Measured: " + (best.Purity * 100).ToString("0.#", CultureInfo.InvariantCulture) + " % of its " + best.Distinct + " values carry one account type"; }
                else if (byName(@"account", @"natural", @"\bgl\b") is Segment an) { coa.Account = an.Col; coa.Why["account"] = "Segment name \"" + an.Name + "\""; }
            }

            // cost centre
            var cq = byQ("FA_COST_CTR");
            if (cq != null && cq.Col != coa.Account && cq.Col != coa.Company) { coa.CostCentre = cq.Col; coa.Why["costCentre"] = "Cost centre qualifier"; }
            else if (coa.Segments.FirstOrDefault(s => s.Col != coa.Account && s.Col != coa.Company && Regex.IsMatch(s.Name ?? "", @"cost|dept|depart|\bcc\b|centre|center|division", RegexOptions.IgnoreCase)) is Segment cn)
            { coa.CostCentre = cn.Col; coa.Why["costCentre"] = "Segment name \"" + cn.Name + "\""; }

            var iq = byQ("GL_INTERCOMPANY") ?? coa.Segments.FirstOrDefault(s => Regex.IsMatch(s.Name ?? "", "interco", RegexOptions.IgnoreCase));
            if (iq != null && iq.Col != coa.Company) { coa.Intercompany = iq.Col; coa.Why["intercompany"] = iq.Qualifiers.Contains("GL_INTERCOMPANY") ? "Intercompany qualifier" : "Segment name \"" + iq.Name + "\""; }
        }

        // ───────────────────────── sync ─────────────────────────
        public sealed class SyncLedger
        {
            public long Id { get; set; }
            public string Name { get; set; }
            public string Code { get; set; }
            public string Currency { get; set; }
            public string CoaId { get; set; }
            public string PeriodSet { get; set; }
            public string PeriodType { get; set; }
            public string Category { get; set; }
            public string Company { get; set; }
            public string CostCentre { get; set; }
            public string Account { get; set; }
            public Dictionary<string, string> CompanyNames { get; set; } = new();
        }
        public sealed class SyncOptions
        {
            public List<SyncLedger> Ledgers { get; set; } = new();
            public int FromSeq { get; set; }
            public int ToSeq { get; set; }
            /// <summary>"" = none, GL_BALANCES (Id = budget_version_id) or GL_BUDGET_BALANCES (Id = budget name / scenario)</summary>
            public string BudgetSource { get; set; }
            public string BudgetId { get; set; }
            public int JournalMonths { get; set; } = 3;
            public bool FoldAdjustments { get; set; } = true;
            public bool Incremental { get; set; }
            public string Pod { get; set; }
            public int Parallel { get; set; } = 2;
            /// <summary>Rows per ranked chunk (ROW_NUMBER over the key, next chunk after the last key).</summary>
            public int ChunkSize { get; set; } = DEFAULT_CHUNK;
            /// <summary>Also write the SQL of every step's first chunk to the log.</summary>
            public bool LogSql { get; set; }
            /// <summary>The discovery (JSON from finFusionDiscover) - saved with the data as fin_fusion_discovery / fin_coa_segments.</summary>
            public JsonElement Discovery { get; set; }
            public string User { get; set; }
            /// <summary>Only these periods (period_seq), e.g. the ones Check found changed or new; empty = FromSeq..ToSeq.</summary>
            public List<int> PeriodSeqs { get; set; } = new();
            /// <summary>What to read for PeriodSeqs: any of "bal", "bud", "jnl" (empty = balances, budget when set, journals of the last JournalMonths).</summary>
            public List<string> Kinds { get; set; } = new();
            /// <summary>Split every read of a period: "none", "account" (ranges of natural account values) or "company" (balancing values).</summary>
            public string SplitBy { get; set; } = "none";
            /// <summary>Account (or company) values per split range.</summary>
            public int SplitSize { get; set; } = 100;
        }

        private sealed class Acc { public double Begin, Dr, Cr; }

        public static async Task<object> SyncAsync(Runner run, SyncOptions o, Action<string> progress, CancellationToken ct)
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var x = new Ctx { Run = run, Ct = cts.Token, Progress = progress, LogSql = o.LogSql };
            object res;
            try { res = await SyncCoreAsync(x, o, cts).ConfigureAwait(false); }
            catch (Exception ex) { res = new { ok = false, error = ex.Message, log = x.Log }; }
            // the whole log next to the data, for support (the page shows it live and can save it too)
            try
            {
                Directory.CreateDirectory(FinanceLens.Root);
                bool ok = JsonSerializer.SerializeToElement(res).TryGetProperty("ok", out var okp) && okp.ValueKind == JsonValueKind.True;
                File.WriteAllLines(Path.Combine(FinanceLens.Root, "fusion-sync.log"),
                    new[] { "Fusion sync " + DateTime.Now.ToString("s") + " · " + (ok ? "OK" : "FAILED") + " · pod " + (o.Pod ?? "") }.Concat(x.Log.ToArray()));
            }
            catch { }
            return res;
        }

        private static async Task<object> SyncCoreAsync(Ctx x, SyncOptions o, CancellationTokenSource cts)
        {
            var ct = cts.Token;
            var sw = Stopwatch.StartNew();
            if (o.Ledgers.Count == 0) return new { ok = false, error = "Pick at least one ledger." };
            foreach (var l in o.Ledgers)
            {
                l.Company = SegCol(l.Company); l.Account = SegCol(l.Account); l.CostCentre = SegCol(l.CostCentre);
                if (l.Company == null || l.Account == null) return new { ok = false, error = "Ledger " + l.Name + ": choose the company (balancing) and the account segment." };
                if (string.IsNullOrEmpty(l.Currency) || string.IsNullOrEmpty(l.PeriodSet)) return new { ok = false, error = "Ledger " + l.Name + ": run Discover again (currency / calendar missing)." };
                if (string.IsNullOrWhiteSpace(l.Code)) l.Code = l.Id.ToString(CultureInfo.InvariantCulture);
            }
            bool pick = o.PeriodSeqs != null && o.PeriodSeqs.Count > 0;
            if (pick) { o.FromSeq = o.PeriodSeqs.Min(); o.ToSeq = o.PeriodSeqs.Max(); }
            if (o.FromSeq <= 0 || o.ToSeq < o.FromSeq) return new { ok = false, error = "Choose the first and last period." };
            var kinds = new HashSet<string>((o.Kinds ?? new()).Select(k => (k ?? "").ToLowerInvariant()));
            bool doBal = !pick || kinds.Count == 0 || kinds.Contains("bal");
            bool doBud = !string.IsNullOrEmpty(o.BudgetSource) && (!pick || kinds.Count == 0 || kinds.Contains("bud"));
            bool pickJnl = pick && kinds.Contains("jnl");
            await Probe(x).ConfigureAwait(false);

            // ── the calendar of the first ledger defines the periods ──
            var first = o.Ledgers[0];
            if (o.Ledgers.Any(l => l.PeriodSet != first.PeriodSet || l.PeriodType != first.PeriodType))
                x.Note("⚠ The ledgers use different calendars: periods are matched by name to the calendar of " + first.Name + ".");
            var calr = await CalendarAsync(x, first, o.FoldAdjustments).ConfigureAwait(false);
            if (calr == null) return new { ok = false, error = "Could not read GL_PERIODS.", log = x.Log };
            var (cal, normal, target) = calr.Value;
            var periods = pick ? normal.Where(p => o.PeriodSeqs.Contains(p.Seq)).ToList() : normal.Where(p => p.Seq >= o.FromSeq && p.Seq <= o.ToSeq).ToList();
            if (periods.Count == 0) return new { ok = false, error = "No periods between the chosen first and last period." };
            int budgetFrom = periods.Min(p => p.Year) * 100;   // the budget is re-read from the start of the first fiscal year (running balances)
            var budgetPeriods = doBud ? normal.Where(p => p.Seq > budgetFrom && p.Seq <= o.ToSeq).ToList() : new List<PeriodRow>();
            var journalPeriods = pick ? (pickJnl ? periods.ToList() : new List<PeriodRow>())
                : o.JournalMonths > 0 ? periods.Skip(Math.Max(0, periods.Count - o.JournalMonths)).ToList() : new List<PeriodRow>();
            var balPeriods = doBal ? periods : new List<PeriodRow>();
            string NamesOf(PeriodRow p) => string.Join(",", target.Where(kv => kv.Value == p).Select(kv => Q(kv.Key)));

            // ── incremental? only when the same ledgers and segments were loaded before ──
            string signature = string.Join(";", o.Ledgers.OrderBy(l => l.Id).Select(l => l.Id + ":" + l.Company + "/" + l.CostCentre + "/" + l.Account + "/" + l.Currency));
            bool incremental = false;
            if (o.Incremental && File.Exists(FinanceLens.DbPath) && FinanceLens.HasLedgers())
            {
                var m = FinanceLens.Query("SELECT value FROM fin_meta WHERE key = 'fusion_signature'", 1);
                incremental = m.Error == null && m.Rows.Count > 0 && Convert.ToString(m.Rows[0][0]) == signature;
                if (!incremental) x.Note("Full load: the ledgers or segments changed since the last load.");
            }
            if (pick && !incremental && File.Exists(FinanceLens.DbPath) && FinanceLens.HasLedgers())
                return new { ok = false, error = "These ledgers / segments are not the ones loaded on this PC - run a full load first, then sync single periods." };
            string split = (o.SplitBy ?? "none").ToLowerInvariant();
            int splitSize = Math.Clamp(o.SplitSize <= 0 ? 100 : o.SplitSize, 5, 2000);

            Exception firstError = null;
            var allWork = new List<Task>();
            x.Note("Sync " + string.Join(", ", o.Ledgers.Select(l => l.Name)) + " · " + (pick ? string.Join(", ", periods.Select(p => p.Name)) : periods.First().Name + " – " + periods.Last().Name) +
                   (doBal ? "" : " · no balances") + (split != "none" ? " · split by " + split + " (" + splitSize + " values per range)" : "") + " · chunks of " + Math.Clamp(o.ChunkSize <= 0 ? DEFAULT_CHUNK : o.ChunkSize, MIN_CHUNK, 10000) +
                   " rows · " + Math.Clamp(o.Parallel, 1, 4) + " in parallel" + (journalPeriods.Count > 0 ? " · journals " + journalPeriods.First().Name + " – " + journalPeriods.Last().Name : " · no journals") +
                   (string.IsNullOrEmpty(o.BudgetSource) ? "" : " · budget " + o.BudgetId));
            var balances = new List<object[]>();
            var journals = new List<object[]>();
            var acctTypes = new Dictionary<string, Dictionary<string, long>>();          // account → type → combinations
            var companies = new Dictionary<string, (string Name, string Ledger)>();
            var ccs = new HashSet<string>();
            var gate = new SemaphoreSlim(Math.Clamp(o.Parallel, 1, 4));
            int done = 0, total = o.Ledgers.Count * (balPeriods.Count + budgetPeriods.Count + journalPeriods.Count);
            var syncRows = new List<object[]>();                                            // fin_sync_periods: what each period held when it was read
            var fps = new Dictionary<string, Dictionary<int, Fp>>();                          // ledger → period_seq → Fusion fingerprint before reading
            var lockObj = new object();
            void Tick(string what) { int n = Interlocked.Increment(ref done); x.Note("[" + n + "/" + total + "] " + what); }

            try
            {
                foreach (var led in o.Ledgers)
                {
                    string ccExpr = led.CostCentre != null ? "c." + led.CostCentre : "'-'";
                    string tmpl = x.Has("GL_BALANCES", "TEMPLATE_ID") ? " AND b.template_id IS NULL" : "";
                    string summ = x.Has("GL_CODE_COMBINATIONS", "SUMMARY_FLAG") ? " AND NVL(c.summary_flag, 'N') = 'N'" : "";
                    string trans = x.Has("GL_BALANCES", "TRANSLATED_FLAG") ? " AND NVL(b.translated_flag, 'X') <> 'R'" : "";

                    // account types and the companies / cost centres seen in this chart
                    x.Note("Fingerprinting " + led.Name + " in Fusion (rows, debits, credits, last update per period)…");
                    fps[led.Code] = await FingerprintAsync(x, led, cal, target, periods.Concat(journalPeriods).Distinct().ToList(), balPeriods.Count > 0, journalPeriods.Count > 0).ConfigureAwait(false);
                    var tr = await Try(x, "account types", 200000,
                        "SELECT c." + led.Account + " ac, c.account_type t, COUNT(*) n FROM gl_code_combinations c WHERE c.chart_of_accounts_id = " + led.CoaId + summ + " GROUP BY c." + led.Account + ", c.account_type").ConfigureAwait(false);
                    if (tr != null)
                        foreach (var r in tr.Rows)
                        {
                            string a = S(r, "AC"); if (a == null) continue;
                            if (!acctTypes.TryGetValue(a, out var tm)) acctTypes[a] = tm = new();
                            string t = S(r, "T") ?? "?"; tm[t] = (tm.TryGetValue(t, out var v) ? v : 0) + L(r, "N");
                        }

                    // split ranges: sorted values of the natural account (or balancing) segment cut into ranges with no gap
                    var parts = new List<(string Label, string Pred)> { ("", "") };
                    if (split == "account" || split == "company")
                    {
                        string col = split == "account" ? led.Account : led.Company;
                        List<string> vals;
                        if (split == "account") vals = acctTypes.Keys.ToList();
                        else
                        {
                            var cr = await Try(x, "company values", 20000, "SELECT DISTINCT c." + col + " v FROM gl_code_combinations c WHERE c.chart_of_accounts_id = " + led.CoaId).ConfigureAwait(false);
                            vals = cr == null ? led.CompanyNames.Keys.ToList() : cr.Rows.Select(r => S(r, "V")).Where(v => v != null).ToList();
                        }
                        parts = SplitRanges("c." + col, vals, splitSize);
                        x.Note(led.Name + " · " + parts.Count + " " + split + " range(s) per period: " + string.Join(" | ", parts.Take(6).Select(z => z.Label)) + (parts.Count > 6 ? " …" : ""));
                    }

                    async Task Bal(PeriodRow p, string scenario)
                    {
                        await gate.WaitAsync(ct).ConfigureAwait(false);
                        try
                        {
                            string names = NamesOf(p);
                            if (names.Length == 0) return;
                            string from, where;
                            if (scenario == "ACTUAL")
                            {
                                from = "gl_balances b";
                                where = "b.ledger_id = " + led.Id + " AND b.currency_code = " + Q(led.Currency) + " AND b.actual_flag = 'A'" + trans + tmpl;
                            }
                            else if (o.BudgetSource == "GL_BALANCES")
                            {
                                from = "gl_balances b";
                                where = "b.ledger_id = " + led.Id + " AND b.currency_code = " + Q(led.Currency) + " AND b.actual_flag = 'B' AND b.budget_version_id = " + (long.TryParse(o.BudgetId, out var bid) ? bid : -1) + trans + tmpl;
                            }
                            else
                            {
                                string nameCol = new[] { "BUDGET_NAME", "SCENARIO", "BUDGET_VERSION_ID" }.FirstOrDefault(c => x.Has("GL_BUDGET_BALANCES", c)) ?? "BUDGET_NAME";
                                from = "gl_budget_balances b";
                                where = "b.ledger_id = " + led.Id + " AND b.currency_code = " + Q(led.Currency) + " AND b." + nameCol + " = " + Q(o.BudgetId);
                            }
                            bool hasBegin = scenario == "ACTUAL" || o.BudgetSource == "GL_BALANCES";
                            bool grouped = from.StartsWith("gl_budget_balances", StringComparison.Ordinal);   // GL_BALANCES has one row per combination and period; budget balances are summed first
                            string dr = "NVL(b.period_net_dr, 0)", cr = "NVL(b.period_net_cr, 0)";
                            if (grouped && !x.Has("GL_BUDGET_BALANCES", "PERIOD_NET_DR"))
                            {
                                string amt = new[] { "PERIOD_NET", "BUDGET_AMOUNT", "AMOUNT", "PERIOD_NET_AMOUNT" }.FirstOrDefault(c => x.Has("GL_BUDGET_BALANCES", c));
                                if (amt == null) { x.Note("⚠ budget " + p.Name + " left out: GL_BUDGET_BALANCES has no amount column this sync knows (PERIOD_NET_DR / _CR, PERIOD_NET, BUDGET_AMOUNT)."); return; }
                                dr = "GREATEST(NVL(b." + amt + ", 0), 0)"; cr = "GREATEST(-NVL(b." + amt + ", 0), 0)";
                            }
                            string bb = hasBegin ? "NVL(b.begin_balance_dr, 0) - NVL(b.begin_balance_cr, 0)" : "0";
                            string seg = "c." + led.Company + " co, " + ccExpr + " cc, c." + led.Account + " ac";
                            string inner = grouped
                                ? "SELECT b.code_combination_id ccid, b.period_name pn, " + seg + ", SUM(" + bb + ") bb, SUM(" + dr + ") dr, SUM(" + cr + ") cr FROM " + from +
                                  " JOIN gl_code_combinations c ON c.code_combination_id = b.code_combination_id WHERE " + where + summ + " AND b.period_name IN (" + names + ")" +
                                  " GROUP BY b.code_combination_id, b.period_name, c." + led.Company + ", " + ccExpr + ", c." + led.Account
                                : "SELECT b.code_combination_id ccid, b.period_name pn, " + seg + ", " + bb + " bb, " + dr + " dr, " + cr + " cr FROM " + from +
                                  " JOIN gl_code_combinations c ON c.code_combination_id = b.code_combination_id WHERE " + where + summ + " AND b.period_name IN (" + names + ")" +
                                  " AND (" + bb + " <> 0 OR " + dr + " <> 0 OR " + cr + " <> 0)";
                            string what = led.Name + " · " + (scenario == "ACTUAL" ? "balances " : "budget ") + p.Name;
                            var rows = new List<Dictionary<string, object>>();
                            var psw = Stopwatch.StartNew();
                            try
                            {
                                for (int pi = 0; pi < parts.Count; pi++)
                                    await RankedAsync(x, what + (parts.Count > 1 ? " · " + split + " " + (pi + 1) + "/" + parts.Count + " " + parts[pi].Label : ""),
                                        inner + parts[pi].Pred, new[] { "CCID", "PN" }, new[] { true, false }, o.ChunkSize, rows.AddRange).ConfigureAwait(false);
                            }
                            catch (Exception ex) when (scenario == "BUDGET" && ex is not OperationCanceledException)
                            {
                                x.Note("⚠ budget " + p.Name + " left out: " + ex.Message);
                                return;
                            }
                            // fold: begin from the normal period, movements from all of them
                            var acc = new Dictionary<(string, string, string), Acc>();
                            foreach (var r in rows)
                            {
                                var k = (S(r, "CO") ?? "", S(r, "CC") ?? "-", S(r, "AC") ?? "");
                                if (!acc.TryGetValue(k, out var a)) acc[k] = a = new Acc();
                                if (S(r, "PN") == p.Name) a.Begin += D(r, "BB");
                                a.Dr += D(r, "DR"); a.Cr += D(r, "CR");
                            }
                            lock (lockObj)
                            {
                                foreach (var kv in acc)
                                {
                                    var a = kv.Value;
                                    if (Math.Abs(a.Begin) < 0.005 && Math.Abs(a.Dr) < 0.005 && Math.Abs(a.Cr) < 0.005) continue;
                                    double net = Math.Round(a.Dr - a.Cr, 2);
                                    balances.Add(new object[] { scenario, kv.Key.Item1, kv.Key.Item2, kv.Key.Item3, p.Name, p.Seq, Math.Round(a.Begin, 2), Math.Round(a.Dr, 2), Math.Round(a.Cr, 2), net, Math.Round(a.Begin + net, 2), led.Code });
                                    if (!companies.ContainsKey(kv.Key.Item1)) companies[kv.Key.Item1] = (led.CompanyNames.TryGetValue(kv.Key.Item1, out var cn) ? cn : null, led.Code);
                                    ccs.Add(kv.Key.Item2);
                                }
                            }
                            lock (lockObj)
                                syncRows.Add(new object[] { led.Code, p.Seq, p.Name, scenario == "ACTUAL" ? "BAL" : "BUD", (long)rows.Count, (long)acc.Count, Math.Round(rows.Sum(r => D(r, "DR")), 2), Math.Round(rows.Sum(r => D(r, "CR")), 2),
                                    scenario == "ACTUAL" && fps[led.Code].TryGetValue(p.Seq, out var bf) ? bf.Bal : null, DateTime.Now, psw.ElapsedMilliseconds, split, o.Pod ?? "" });
                            Tick("✓ " + what + " · " + rows.Count.ToString("N0", CultureInfo.InvariantCulture) + " rows → " + acc.Count.ToString("N0", CultureInfo.InvariantCulture) + " balances");
                        }
                        finally { gate.Release(); }
                    }

                    async Task Jnl(PeriodRow p)
                    {
                        await gate.WaitAsync(ct).ConfigureAwait(false);
                        try
                        {
                            string names = NamesOf(p);
                            if (names.Length == 0) return;
                            bool batch = x.HasTable("GL_JE_BATCHES");
                            string eff = x.Has("GL_JE_LINES", "EFFECTIVE_DATE") ? "NVL(l.effective_date, h.default_effective_date)" : "h.default_effective_date";
                            string inner = "SELECT h.je_header_id id, l.je_line_num ln, " + (batch ? "bt.name" : "NULL") + " bn, h.name jn, h.je_source js, h.je_category jc, l.period_name pn, " +
                                "TO_CHAR(" + eff + ", 'YYYY-MM-DD') ad, TO_CHAR(NVL(h.posted_date, h.creation_date), 'YYYY-MM-DD HH24:MI:SS') pa, h.created_by cb, " +
                                "c." + led.Company + " co, " + ccExpr + " cc, c." + led.Account + " ac, NVL(l.accounted_dr, 0) dr, NVL(l.accounted_cr, 0) cr, SUBSTR(NVL(l.description, h.description), 1, 200) ds " +
                                "FROM gl_je_lines l JOIN gl_je_headers h ON h.je_header_id = l.je_header_id " + (batch ? "JOIN gl_je_batches bt ON bt.je_batch_id = h.je_batch_id " : "") +
                                "JOIN gl_code_combinations c ON c.code_combination_id = l.code_combination_id WHERE h.ledger_id = " + led.Id + " AND h.status = 'P' AND h.actual_flag = 'A'" +
                                " AND l.period_name IN (" + names + ")";
                            string what = led.Name + " · journals " + p.Name;
                            int lines = 0; double jdr = 0, jcr = 0; var heads = new HashSet<long>();
                            var psw = Stopwatch.StartNew();
                            try
                            {
                                for (int pi = 0; pi < parts.Count; pi++)
                                lines += await RankedAsync(x, what + (parts.Count > 1 ? " · " + split + " " + (pi + 1) + "/" + parts.Count + " " + parts[pi].Label : ""), inner + parts[pi].Pred,
                                    new[] { "ID", "LN" }, new[] { true, true }, o.ChunkSize, rows =>
                                {
                                    lock (lockObj)
                                        foreach (var z in rows)
                                        {
                                            DateTime.TryParse(S(z, "AD"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var ad);
                                            DateTime.TryParse(S(z, "PA"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var pa);
                                            jdr += D(z, "DR"); jcr += D(z, "CR"); heads.Add(L(z, "ID"));
                                            journals.Add(new object[] { L(z, "ID"), (int)L(z, "LN"), S(z, "BN"), S(z, "JN"), S(z, "JS"), S(z, "JC"), p.Name, p.Seq,
                                                ad == default ? (object)null : DateOnly.FromDateTime(ad), pa == default ? (object)null : pa, S(z, "CB"),
                                                S(z, "CO") ?? "", S(z, "CC") ?? "-", S(z, "AC") ?? "", Math.Round(D(z, "DR"), 2), Math.Round(D(z, "CR"), 2), S(z, "DS"), led.Code });
                                        }
                                }).ConfigureAwait(false);
                            }
                            catch (Exception ex) when (ex is not OperationCanceledException)
                            {
                                throw new InvalidOperationException(what + ": " + ex.Message, ex);
                            }
                            lock (lockObj)
                                syncRows.Add(new object[] { led.Code, p.Seq, p.Name, "JNL", (long)lines, (long)heads.Count, Math.Round(jdr, 2), Math.Round(jcr, 2),
                                    fps[led.Code].TryGetValue(p.Seq, out var jf) ? jf.Jnl : null, DateTime.Now, psw.ElapsedMilliseconds, split, o.Pod ?? "" });
                            Tick("✓ " + what + " · " + lines.ToString("N0", CultureInfo.InvariantCulture) + " lines in " + heads.Count.ToString("N0", CultureInfo.InvariantCulture) + " journals");
                        }
                        finally { gate.Release(); }
                    }

                    var work = new List<Task>();
                    work.AddRange(balPeriods.Select(p => Bal(p, "ACTUAL")));
                    work.AddRange(budgetPeriods.Select(p => Bal(p, "BUDGET")));
                    work.AddRange(journalPeriods.Select(Jnl));
                    // the first real failure stops the other reads at once (and is the error shown)
                    foreach (var t in work)
                        _ = t.ContinueWith(tt =>
                        {
                            var e = tt.Exception?.GetBaseException();
                            if (e != null && e is not OperationCanceledException) { Interlocked.CompareExchange(ref firstError, e, null); try { cts.Cancel(); } catch { } }
                        }, TaskScheduler.Default);
                    allWork.AddRange(work);
                    await Task.WhenAll(work).ConfigureAwait(false);
                }
            }
            catch (Exception ex)
            {
                var why = firstError ?? allWork.Where(t => t.IsFaulted).Select(t => t.Exception.GetBaseException()).FirstOrDefault(e => e is not OperationCanceledException)
                          ?? (ex is OperationCanceledException ? null : ex);
                x.Note(why == null ? "✖ Cancelled - nothing was changed." : "✖ Stopped: " + why.Message + " - nothing was changed.");
                return new { ok = false, error = why == null ? "Cancelled - nothing was changed." : why.Message + " (nothing was changed - see the log)", log = x.Log };
            }

            // budget amounts as running balances (income statement accounts restart each fiscal year)
            var budRows = balances.Where(b => (string)b[0] == "BUDGET").OrderBy(b => (int)b[5]).ToList();
            if (budRows.Count > 0)
            {
                var runBal = new Dictionary<string, double>();
                int year = -1;
                foreach (var b in budRows)
                {
                    int y = (int)b[5] / 100;
                    string a = (string)b[3];
                    if (y != year) { foreach (var k in runBal.Keys.ToList()) if (IsPlType(TypeOf(acctTypes, k.Split('|')[2]))) runBal[k] = 0; year = y; }
                    string key = b[1] + "|" + b[2] + "|" + a + "|" + b[11];
                    double begin = runBal.TryGetValue(key, out var v) ? v : 0, net = (double)b[9];
                    b[6] = Math.Round(begin, 2); b[10] = Math.Round(begin + net, 2);
                    runBal[key] = begin + net;
                }
                // only the requested window is kept (earlier months of the year were read for the running balance)
                balances.RemoveAll(b => (string)b[0] == "BUDGET" && (int)b[5] < o.FromSeq);
            }

            x.Note("Reading names of accounts, companies and cost centres…");
            var acctNames = await ValueNames(x, o.Ledgers[0].CoaId, o.Ledgers[0].Account, acctTypes.Keys.ToList()).ConfigureAwait(false);
            var coNames = await ValueNames(x, o.Ledgers[0].CoaId, o.Ledgers[0].Company, companies.Keys.ToList()).ConfigureAwait(false);
            var ccNames = o.Ledgers[0].CostCentre != null ? await ValueNames(x, o.Ledgers[0].CoaId, o.Ledgers[0].CostCentre, ccs.ToList()).ConfigureAwait(false) : new Dictionary<string, string>();

            // ── write ──
            x.Note("Writing " + balances.Count.ToString("N0", CultureInfo.InvariantCulture) + " balances and " + journals.Count.ToString("N0", CultureInfo.InvariantCulture) + " journal lines…");
            string tmp = Path.Combine(FinanceLens.Root, "finance.new.duckdb");
            Directory.CreateDirectory(FinanceLens.Root);
            foreach (var f in new[] { tmp, tmp + ".wal" }) if (File.Exists(f)) File.Delete(f);
            if (incremental && !FinanceLens.CopyCurrent(tmp)) incremental = false;
            int jMin = journalPeriods.Count > 0 ? journalPeriods.Min(p => p.Seq) : int.MaxValue;
            string ledIn = string.Join(",", o.Ledgers.Select(l => FinanceLens.Lit(l.Code)));
            int keptFrom = o.FromSeq, keptTo = o.ToSeq;
            List<string> pendingSeg = null;
            var prevDiscovery = o.Discovery.ValueKind == JsonValueKind.Object ? null : FinanceLens.LoadDiscovery(o.Pod ?? "");
            using (var conn = new DuckDBConnection("Data Source=" + tmp))
            {
                conn.Open();
                if (!incremental)
                {
                    foreach (var stmt in FinanceLens.SCHEMA.Split(';').Select(s => s.Trim()).Where(s => s.Length > 0)) FinanceLens.Exec(conn, stmt);
                    FinanceLens.CarryOver(conn, x.Note);   // segment values and live trial balances stay with the data
                }
                else
                {
                    string seqIn = string.Join(",", periods.Select(p => p.Seq));
                    if (balPeriods.Count > 0) FinanceLens.Exec(conn, "DELETE FROM fin_balances WHERE ledger IN (" + ledIn + ") AND scenario = 'ACTUAL' AND period_seq IN (" + seqIn + ")");
                    if (budgetPeriods.Count > 0) FinanceLens.Exec(conn, "DELETE FROM fin_balances WHERE ledger IN (" + ledIn + ") AND scenario = 'BUDGET' AND period_seq BETWEEN " + o.FromSeq + " AND " + o.ToSeq);
                    using (var pc = conn.CreateCommand())
                    {
                        pc.CommandText = "SELECT MIN(TRY_CAST(value AS INTEGER)) FROM fin_meta WHERE key = 'from_seq'";
                        var pv = pc.ExecuteScalar();
                        if (pv != null && pv != DBNull.Value) keptFrom = Math.Min(o.FromSeq, Convert.ToInt32(pv));
                        pc.CommandText = "SELECT MAX(TRY_CAST(value AS INTEGER)) FROM fin_meta WHERE key = 'to_seq'";
                        pv = pc.ExecuteScalar();
                        if (pv != null && pv != DBNull.Value) keptTo = Convert.ToInt32(pv);
                    }
                    if (journalPeriods.Count > 0) FinanceLens.Exec(conn, "DELETE FROM fin_journals WHERE ledger IN (" + ledIn + ") AND period_seq IN (" + string.Join(",", journalPeriods.Select(p => p.Seq)) + ")");
                    foreach (var t in new[] { "fin_meta", "fin_ledgers", "fin_segments" }) FinanceLens.Exec(conn, "DELETE FROM " + t);
                }
                // segment values read before the finance file existed join the data now
                try { pendingSeg = FinanceLens.ImportPendingSegValues(conn, x.Note); } catch (Exception ex) { x.Note("⚠ pending segment values not added: " + ex.Message); }
                // dimensions: replace the codes this load saw, keep the others (incremental)
                var accRows = acctTypes.Keys.Select(a => new object[] { a, acctNames.TryGetValue(a, out var n) ? n : a, TypeOf(acctTypes, a), null, null }).ToList();
                var coRows = companies.Select(kv => new object[] { kv.Key, kv.Value.Name ?? (coNames.TryGetValue(kv.Key, out var n) ? n : kv.Key), o.Ledgers.First(l => l.Code == kv.Value.Ledger).Currency }).ToList();
                var ccRows = ccs.Select(c => new object[] { c, c == "-" ? "(no cost centre segment)" : ccNames.TryGetValue(c, out var n) ? n : c, null }).ToList();
                if (incremental)
                {
                    DeleteCodes(conn, "fin_accounts", accRows.Select(r => (string)r[0]));
                    DeleteCodes(conn, "fin_companies", coRows.Select(r => (string)r[0]));
                    DeleteCodes(conn, "fin_cost_centres", ccRows.Select(r => (string)r[0]));
                    FinanceLens.Exec(conn, "DELETE FROM fin_periods WHERE period_seq IN (" + string.Join(",", periods.Select(p => p.Seq)) + ")");
                }
                FinanceLens.Exec(conn, SYNC_TABLE);
                foreach (var g in syncRows.GroupBy(r => (string)r[3]))
                    FinanceLens.Exec(conn, "DELETE FROM fin_sync_periods WHERE kind = " + FinanceLens.Lit(g.Key) + " AND ledger || '|' || period_seq IN (" +
                                           string.Join(",", g.Select(r => FinanceLens.Lit((string)r[0] + "|" + r[1]))) + ")");
                FinanceLens.Append(conn, "fin_sync_periods", syncRows);
                FinanceLens.Append(conn, "fin_accounts", accRows);
                FinanceLens.Append(conn, "fin_companies", coRows);
                FinanceLens.Append(conn, "fin_cost_centres", ccRows);
                FinanceLens.Append(conn, "fin_periods", periods
                    .Select(p => new object[] { p.Name, p.Seq, p.Year, p.Num, p.Quarter > 0 ? p.Quarter : (p.Num - 1) / 3 + 1, ParseDate(p.Start), ParseDate(p.End) }).ToList());
                FinanceLens.Append(conn, "fin_ledgers", o.Ledgers.Select(l => new object[] { l.Code, l.Name, l.Currency, l.CoaId, l.Company, l.CostCentre, l.Account, l.Category }).ToList());
                FinanceLens.Append(conn, "fin_segments", new List<object[]> {
                    new object[] { 1, "COMPANY", "Company (" + first.Company + ")", first.Company }, new object[] { 2, "COST_CENTRE", "Cost centre (" + (first.CostCentre ?? "none") + ")", first.CostCentre },
                    new object[] { 3, "ACCOUNT", "Account (" + first.Account + ")", first.Account } });
                // the chart of accounts goes with the data: the discovery the page sent, else the one the previous file held
                {
                    var chosen = o.Ledgers.GroupBy(l => l.CoaId ?? "").ToDictionary(g => g.Key, g => new Dictionary<string, string> { ["company"] = g.First().Company, ["costCentre"] = g.First().CostCentre, ["account"] = g.First().Account });
                    if (o.Discovery.ValueKind == JsonValueKind.Object) WriteDiscovery(conn, o.Pod ?? "", o.Discovery.GetRawText(), o.User, chosen);
                    else if (prevDiscovery != null) WriteDiscovery(conn, o.Pod ?? "", prevDiscovery.Value.Json, prevDiscovery.Value.By, chosen);
                }
                FinanceLens.Append(conn, "fin_balances", balances);
                FinanceLens.Append(conn, "fin_journals", journals);
                var meta = new List<object[]>
                {
                    new object[] { "source", "FUSION" }, new object[] { "pod", o.Pod ?? "" }, new object[] { "loaded_at", DateTime.Now.ToString("s") },
                    new object[] { "currency", first.Currency }, new object[] { "currencies", string.Join(",", o.Ledgers.Select(l => l.Currency).Distinct()) },
                    new object[] { "description", "Oracle Fusion GL: " + string.Join(", ", o.Ledgers.Select(l => l.Name)) },
                    new object[] { "fusion_signature", signature }, new object[] { "from_seq", keptFrom.ToString(CultureInfo.InvariantCulture) }, new object[] { "to_seq", Math.Max(keptTo, o.ToSeq).ToString(CultureInfo.InvariantCulture) },
                    new object[] { "budget", string.IsNullOrEmpty(o.BudgetSource) ? "" : o.BudgetSource + ":" + o.BudgetId },
                    new object[] { "journals_from_seq", journalPeriods.Count > 0 ? jMin.ToString(CultureInfo.InvariantCulture) : "" },
                    new object[] { "load_mode", incremental ? "INCREMENTAL" : "FULL" }
                };
                FinanceLens.Append(conn, "fin_meta", meta);
                FinanceLens.Exec(conn, "CHECKPOINT");
            }
            FinanceLens.SwapIn(tmp);
            FinanceLens.DropPending(pendingSeg);
            x.Note("Done in " + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s.");
            return new
            {
                ok = true, balances = balances.Count, journals = journals.Count, accounts = acctTypes.Count, companies = companies.Count, periods = periods.Count, synced = syncRows.Count,
                mode = incremental ? "INCREMENTAL" : "FULL", ms = sw.ElapsedMilliseconds, log = x.Log
            };
        }

        internal const string SYNC_TABLE = "CREATE TABLE IF NOT EXISTS fin_sync_periods (ledger VARCHAR, period_seq INTEGER, period_name VARCHAR, kind VARCHAR, rows_read BIGINT, rows_local BIGINT, " +
                                           "dr DOUBLE, cr DOUBLE, fusion_fp VARCHAR, synced_at TIMESTAMP, ms BIGINT, split VARCHAR, pod VARCHAR)";

        /// <summary>The accounting calendar of a ledger and where each period lands (adjustment periods folded into the period they close).</summary>
        private static async Task<(List<PeriodRow> Cal, List<PeriodRow> Normal, Dictionary<string, PeriodRow> Target)?> CalendarAsync(Ctx x, SyncLedger first, bool fold)
        {
            var pr = await Try(x, "periods", 5000,
                "SELECT period_name, period_year, period_num, quarter_num, TO_CHAR(start_date, 'YYYY-MM-DD') sd, TO_CHAR(end_date, 'YYYY-MM-DD') ed, adjustment_period_flag adj FROM gl_periods WHERE period_set_name = " +
                Q(first.PeriodSet) + " AND period_type = " + Q(first.PeriodType) + " ORDER BY period_year, period_num").ConfigureAwait(false);
            if (pr == null) return null;
            var cal = pr.Rows.Select(r => new PeriodRow { Name = S(r, "PERIOD_NAME"), Year = (int)L(r, "PERIOD_YEAR"), Num = (int)L(r, "PERIOD_NUM"), Quarter = (int)L(r, "QUARTER_NUM"), Start = S(r, "SD"), End = S(r, "ED"), Adj = S(r, "ADJ") == "Y" }).ToList();
            var normal = cal.Where(p => !p.Adj).ToList();
            var target = new Dictionary<string, PeriodRow>();
            foreach (var p in normal) target[p.Name] = p;
            foreach (var a in cal.Where(p => p.Adj))
            {
                var t = normal.Where(p => p.Year == a.Year && p.Num <= a.Num).OrderByDescending(p => p.Num).FirstOrDefault() ?? normal.Where(p => p.Year == a.Year).OrderBy(p => p.Num).FirstOrDefault();
                if (t != null && fold) target[a.Name] = t;
            }
            return (cal, normal, target);
        }

        /// <summary>A period's fingerprint in Fusion: rows, debits, credits and last update of GL_BALANCES (ledger currency) and of the
        /// posted journal headers. Two equal fingerprints = nothing was posted or changed in between.</summary>
        public sealed class Fp
        {
            public long BalN, JnlN; public double BalDr, BalCr, JnlDr; public string BalUpd, JnlUpd;
            public string Bal => BalN + "|" + BalDr.ToString("0.00", CultureInfo.InvariantCulture) + "|" + BalCr.ToString("0.00", CultureInfo.InvariantCulture) + "|" + BalUpd;
            public string Jnl => JnlN + "|" + JnlDr.ToString("0.00", CultureInfo.InvariantCulture) + "|" + JnlUpd;
        }

        /// <summary>One cheap aggregate per ledger and fiscal year (GROUP BY period_name) for balances and for journal headers.</summary>
        private static async Task<Dictionary<int, Fp>> FingerprintAsync(Ctx x, SyncLedger led, List<PeriodRow> cal, Dictionary<string, PeriodRow> target, List<PeriodRow> want, bool bal, bool jnl)
        {
            var res = new Dictionary<int, Fp>();
            var wanted = new HashSet<int>(want.Select(p => p.Seq));
            string tmpl = x.Has("GL_BALANCES", "TEMPLATE_ID") ? " AND b.template_id IS NULL" : "";
            string trans = x.Has("GL_BALANCES", "TRANSLATED_FLAG") ? " AND NVL(b.translated_flag, 'X') <> 'R'" : "";
            string bupd = x.Has("GL_BALANCES", "LAST_UPDATE_DATE") ? "TO_CHAR(MAX(b.last_update_date), 'YYYY-MM-DD HH24:MI:SS')" : "NULL";
            string jupd = x.Has("GL_JE_HEADERS", "LAST_UPDATE_DATE") ? "TO_CHAR(MAX(h.last_update_date), 'YYYY-MM-DD HH24:MI:SS')" : "NULL";
            string jdr = x.Has("GL_JE_HEADERS", "RUNNING_TOTAL_ACCOUNTED_DR") ? "SUM(NVL(h.running_total_accounted_dr, 0))" : "0";
            foreach (var year in target.Where(kv => wanted.Contains(kv.Value.Seq)).GroupBy(kv => kv.Value.Year))
            {
                string names = string.Join(",", year.Select(kv => Q(kv.Key)));
                Fp get(string pn) { var t = target[pn]; if (!res.TryGetValue(t.Seq, out var f)) res[t.Seq] = f = new Fp(); return f; }
                if (bal)
                {
                    var r = await Try(x, "balance fingerprint " + led.Name + " " + year.Key, 1000,
                        "SELECT b.period_name pn, COUNT(*) n, SUM(NVL(b.period_net_dr, 0)) dr, SUM(NVL(b.period_net_cr, 0)) cr, " + bupd + " upd FROM gl_balances b WHERE b.ledger_id = " + led.Id +
                        " AND b.currency_code = " + Q(led.Currency) + " AND b.actual_flag = 'A'" + trans + tmpl + " AND b.period_name IN (" + names + ") GROUP BY b.period_name").ConfigureAwait(false);
                    if (r != null)
                        foreach (var z in r.Rows)
                        {
                            string pn = S(z, "PN"); if (pn == null || !target.ContainsKey(pn)) continue;
                            var f = get(pn); f.BalN += L(z, "N"); f.BalDr = Math.Round(f.BalDr + D(z, "DR"), 2); f.BalCr = Math.Round(f.BalCr + D(z, "CR"), 2);
                            string u = S(z, "UPD"); if (u != null && string.CompareOrdinal(u, f.BalUpd ?? "") > 0) f.BalUpd = u;
                        }
                }
                if (jnl)
                {
                    var r = await Try(x, "journal fingerprint " + led.Name + " " + year.Key, 1000,
                        "SELECT h.period_name pn, COUNT(*) n, " + jdr + " dr, " + jupd + " upd FROM gl_je_headers h WHERE h.ledger_id = " + led.Id +
                        " AND h.status = 'P' AND h.actual_flag = 'A' AND h.period_name IN (" + names + ") GROUP BY h.period_name").ConfigureAwait(false);
                    if (r != null)
                        foreach (var z in r.Rows)
                        {
                            string pn = S(z, "PN"); if (pn == null || !target.ContainsKey(pn)) continue;
                            var f = get(pn); f.JnlN += L(z, "N"); f.JnlDr = Math.Round(f.JnlDr + D(z, "DR"), 2);
                            string u = S(z, "UPD"); if (u != null && string.CompareOrdinal(u, f.JnlUpd ?? "") > 0) f.JnlUpd = u;
                        }
                }
            }
            return res;
        }

        /// <summary>Ranges over the sorted values of a segment with no gap: first ≤ v1, then (v1, v2], …, last &gt; vn - values that
        /// appear later still fall into a range.</summary>
        internal static List<(string Label, string Pred)> SplitRanges(string expr, IEnumerable<string> values, int size)
        {
            var vals = values.Where(v => v != null).Distinct().OrderBy(v => v, StringComparer.Ordinal).ToList();
            var parts = new List<(string, string)>();
            if (vals.Count <= size) return new List<(string, string)> { ("", "") };
            string prev = null;
            for (int i = 0; i < vals.Count; i += size)
            {
                var batch = vals.Skip(i).Take(size).ToList();
                bool last = i + size >= vals.Count;
                string lo = prev == null ? "" : expr + " > " + Q(prev), hi = last ? "" : expr + " <= " + Q(batch[^1]);
                parts.Add((batch[0] + " – " + batch[^1], " AND " + (lo.Length > 0 && hi.Length > 0 ? lo + " AND " + hi : lo.Length > 0 ? lo : hi)));
                prev = batch[^1];
            }
            return parts;
        }

        // ───────────────────────── check: which months are in sync ─────────────────────────
        public sealed class CheckOptions
        {
            public List<SyncLedger> Ledgers { get; set; } = new();
            public int FromSeq { get; set; }
            public int ToSeq { get; set; }
            public bool FoldAdjustments { get; set; } = true;
        }

        /// <summary>
        /// Compares Fusion with this PC per ledger × period: the Fusion fingerprint now against the one stored when the period was
        /// read (fin_sync_periods) and the debits / credits in DuckDB against Fusion. Status per cell: OK (in sync and ties to the
        /// cent), CHANGED (posted or changed in Fusion since), NEW (in Fusion, not loaded), DIFF (loaded totals do not tie), EMPTY,
        /// NOT_LOADED (journals). Also the open / closed status of each period.
        /// </summary>
        public static async Task<object> CheckAsync(Runner run, CheckOptions o, Action<string> progress, CancellationToken ct)
        {
            var sw = Stopwatch.StartNew();
            var x = new Ctx { Run = run, Ct = ct, Progress = progress };
            if (o.Ledgers.Count == 0) return new { ok = false, error = "No ledgers - set up the Fusion load first." };
            await Probe(x).ConfigureAwait(false);
            var calr = await CalendarAsync(x, o.Ledgers[0], o.FoldAdjustments).ConfigureAwait(false);
            if (calr == null) return new { ok = false, error = "Could not read GL_PERIODS.", log = x.Log };
            var (cal, normal, target) = calr.Value;
            string today = DateTime.Today.ToString("yyyy-MM-dd");
            var started = normal.Where(p => string.IsNullOrEmpty(p.Start) || string.CompareOrdinal(p.Start, today) <= 0).ToList();
            int to = o.ToSeq > 0 ? o.ToSeq : (started.LastOrDefault() ?? normal.Last()).Seq;
            var upto = normal.Where(p => p.Seq <= to).ToList();
            int from = o.FromSeq > 0 ? o.FromSeq : upto[Math.Max(0, upto.Count - 24)].Seq;
            var periods = normal.Where(p => p.Seq >= from && p.Seq <= to).ToList();

            // what this PC holds
            var rec = new Dictionary<string, (string Fp, DateTime? At, long Rows, long Local, long Ms, string Split)>();
            var locBal = new Dictionary<string, (double Dr, double Cr)>();
            var locJnl = new Dictionary<string, (long N, double Dr)>();
            if (File.Exists(FinanceLens.DbPath) && FinanceLens.HasLedgers())
            {
                var t = FinanceLens.Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_sync_periods'", 1);
                if (t.Error == null && Convert.ToInt64(t.Rows[0][0]) > 0)
                    foreach (var r in FinanceLens.Query("SELECT ledger, period_seq, kind, fusion_fp, synced_at, rows_read, rows_local, ms, split FROM fin_sync_periods", 500000).Rows)
                        rec[r[0] + "|" + r[1] + "|" + r[2]] = (r[3] as string, r[4] as DateTime?, Convert.ToInt64(r[5] ?? 0L), Convert.ToInt64(r[6] ?? 0L), Convert.ToInt64(r[7] ?? 0L), r[8] as string);
                foreach (var r in FinanceLens.Query("SELECT ledger, period_seq, SUM(period_dr), SUM(period_cr) FROM fin_balances WHERE scenario = 'ACTUAL' GROUP BY ALL", 500000).Rows)
                    locBal[r[0] + "|" + r[1]] = (Convert.ToDouble(r[2] ?? 0.0), Convert.ToDouble(r[3] ?? 0.0));
                foreach (var r in FinanceLens.Query("SELECT ledger, period_seq, COUNT(DISTINCT je_id), SUM(dr) FROM fin_journals GROUP BY ALL", 500000).Rows)
                    locJnl[r[0] + "|" + r[1]] = (Convert.ToInt64(r[2] ?? 0L), Convert.ToDouble(r[3] ?? 0.0));
            }
            bool tie(double a, double b) => Math.Abs(a - b) < 0.015;

            var cells = new List<object>();
            var stat = new Dictionary<string, string>();
            try
            {
                foreach (var led in o.Ledgers)
                {
                    if (string.IsNullOrWhiteSpace(led.Code)) led.Code = led.Id.ToString(CultureInfo.InvariantCulture);
                    x.Note("Checking " + led.Name + " · " + periods.First().Name + " – " + periods.Last().Name + "…");
                    var fp = await FingerprintAsync(x, led, cal, target, periods, true, true).ConfigureAwait(false);
                    var ps = await Try(x, "period statuses", 5000, "SELECT period_name, closing_status FROM gl_period_statuses WHERE application_id = 101 AND ledger_id = " + led.Id).ConfigureAwait(false);
                    var open = new Dictionary<string, string>();
                    if (ps != null) foreach (var r in ps.Rows) if (S(r, "PERIOD_NAME") != null) open[S(r, "PERIOD_NAME")] = S(r, "CLOSING_STATUS");
                    foreach (var p in periods)
                    {
                        fp.TryGetValue(p.Seq, out var f); f ??= new Fp();
                        string k = led.Code + "|" + p.Seq;
                        rec.TryGetValue(k + "|BAL", out var rb); bool hasRb = rec.ContainsKey(k + "|BAL");
                        bool hasLb = locBal.TryGetValue(k, out var lb);
                        string bs = f.BalN == 0 ? (hasLb && (lb.Dr != 0 || lb.Cr != 0) ? "DIFF" : "EMPTY")
                            : !hasLb ? "NEW"
                            : hasRb && rb.Fp != null && rb.Fp != f.Bal ? "CHANGED"
                            : tie(lb.Dr, f.BalDr) && tie(lb.Cr, f.BalCr) ? "OK"
                            : hasRb && rb.Fp == f.Bal ? "DIFF" : "CHANGED";
                        rec.TryGetValue(k + "|JNL", out var rj); bool hasRj = rec.ContainsKey(k + "|JNL");
                        bool hasLj = locJnl.TryGetValue(k, out var lj);
                        string js = f.JnlN == 0 ? (hasLj ? "DIFF" : "EMPTY")
                            : !hasLj && !hasRj ? "NOT_LOADED"
                            : hasRj && rj.Fp != null && rj.Fp != f.Jnl ? "CHANGED"
                            : lj.N == f.JnlN && (f.JnlDr == 0 || tie(lj.Dr, f.JnlDr)) ? "OK" : "CHANGED";
                        stat[bs] = ""; stat["J" + js] = "";
                        open.TryGetValue(p.Name, out var cs);
                        cells.Add(new
                        {
                            ledger = led.Code, seq = p.Seq, period = p.Name, closing = cs,
                            bal = new { status = bs, fusion = new { n = f.BalN, dr = f.BalDr, cr = f.BalCr, upd = f.BalUpd }, local = hasLb ? new { dr = Math.Round(lb.Dr, 2), cr = Math.Round(lb.Cr, 2) } : null,
                                        synced = hasRb ? rb.At : null, rows = hasRb ? rb.Rows : 0, ms = hasRb ? rb.Ms : 0, split = hasRb ? rb.Split : null },
                            jnl = new { status = js, fusion = new { n = f.JnlN, dr = f.JnlDr, upd = f.JnlUpd }, local = hasLj ? new { n = lj.N, dr = Math.Round(lj.Dr, 2) } : null,
                                        synced = hasRj ? rj.At : null, rows = hasRj ? rj.Rows : 0, ms = hasRj ? rj.Ms : 0 }
                        });
                    }
                }
            }
            catch (OperationCanceledException) { return new { ok = false, error = "Cancelled.", log = x.Log }; }
            catch (Exception ex) { return new { ok = false, error = ex.Message, log = x.Log }; }
            x.Note("Checked " + cells.Count + " ledger-period(s) in " + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s.");
            return new { ok = true, checkedAt = DateTime.Now.ToString("s"), periods = periods.Select(p => new { seq = p.Seq, name = p.Name, year = p.Year, num = p.Num, start = p.Start, end = p.End }), cells, log = x.Log, ms = sw.ElapsedMilliseconds };
        }

        // ───────────────────────── segment values ─────────────────────────
        /// <summary>Every value of one segment of a chart: from its value set (with the description) and from GL_CODE_COMBINATIONS
        /// (how many account combinations use it, and the account type for the natural account) - read in ranked chunks.</summary>
        public static async Task<object> SegmentValuesAsync(Runner run, string coaId, string column, Action<string> progress, CancellationToken ct)
        {
            var x = new Ctx { Run = run, Ct = ct, Progress = progress };
            string col = SegCol(column);
            if (col == null || !long.TryParse(coaId, out _)) return new { ok = false, error = "Choose a chart of accounts and a SEGMENTn column." };
            await Probe(x).ConfigureAwait(false);
            var used = new Dictionary<string, (long N, string T1, string T2)>();
            string summ = x.Has("GL_CODE_COMBINATIONS", "SUMMARY_FLAG") ? " AND NVL(c.summary_flag, 'N') = 'N'" : "";
            try
            {
                await RankedAsync(x, "chart " + coaId + " · " + col + " values in use", "SELECT c." + col + " v, COUNT(*) n, MIN(c.account_type) t1, MAX(c.account_type) t2 FROM gl_code_combinations c WHERE c.chart_of_accounts_id = " + coaId + summ +
                    " AND c." + col + " IS NOT NULL GROUP BY c." + col, new[] { "V" }, new[] { false }, DEFAULT_CHUNK, rows =>
                    {
                        foreach (var r in rows) { string v = S(r, "V"); if (v != null) used[v] = (L(r, "N"), S(r, "T1"), S(r, "T2")); }
                    }).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { return new { ok = false, error = ex.Message, log = x.Log }; }
            x.Note("Reading the value set descriptions…");
            var names = await ValueNames(x, coaId, col, used.Keys.ToList()).ConfigureAwait(false);
            var all = used.Keys.Union(names.Keys).OrderBy(v => v, StringComparer.Ordinal).ToList();
            var list = all.Select(v =>
            {
                used.TryGetValue(v, out var u);
                return new SegValue { Value = v, Description = names.TryGetValue(v, out var d) ? d : null, Combinations = u.N, AccountType = u.T1 == null ? null : u.T1 == u.T2 ? u.T1 : u.T1 + "/" + u.T2 };
            }).ToList();
            string saved = null;
            try { saved = FinanceLens.SaveSegmentValues(coaId, col, list); } catch (Exception ex) { x.Note("⚠ values not saved on this PC: " + ex.Message); }
            x.Note(list.Count.ToString("N0", CultureInfo.InvariantCulture) + " values (" + used.Count.ToString("N0", CultureInfo.InvariantCulture) + " in use)" +
                   (saved == "duckdb" ? " · saved in DuckDB" : saved == "pending" ? " · kept on this PC, added to DuckDB by the first load" : ""));
            return new { ok = true, coaId, column = col, values = list.Select(v => new { value = v.Value, description = v.Description, combinations = v.Combinations, accountType = v.AccountType }), savedDuck = saved == "duckdb", pendingDuck = saved == "pending", log = x.Log };
        }
        // ═════ Trial balance live from Fusion ═════
        public sealed class TbOptions
        {
            public SyncLedger Ledger { get; set; }
            /// <summary>period_seq (year × 100 + period number) of the normal period; 0 = the latest started period.</summary>
            public int PeriodSeq { get; set; }
            public bool FoldAdjustments { get; set; } = true;
            /// <summary>Only these balancing values (empty = every company of the ledger).</summary>
            public List<string> Companies { get; set; } = new();
            public bool ByCostCentre { get; set; }
            public int ChunkSize { get; set; } = DEFAULT_CHUNK;
            public bool LogSql { get; set; }
            /// <summary>Every balancing value of the ledger (from discovery): the reads are split per company.</summary>
            public List<string> AllCompanies { get; set; } = new();
            /// <summary>Reads at the same time (1-4).</summary>
            public int Parallel { get; set; } = 2;
            /// <summary>"company" (default: one read per period × company), "none" (one read per period).</summary>
            public string Split { get; set; } = "company";
            /// <summary>The pod the rows are kept for on this PC ("" = logged-in pod).</summary>
            public string Pod { get; set; } = "";
            /// <summary>Read the periods from Fusion again even when this PC already holds them.</summary>
            public bool Refresh { get; set; }
            /// <summary>The user's own GL_BALANCES query for ONE period (SELECT / WITH; placeholders {LEDGER_ID}, {PERIOD}, {CURRENCY});
            /// empty = the default. It must return CODE_COMBINATION_ID, BEGIN_BALANCE_DR / _CR and PERIOD_NET_DR / _CR.</summary>
            public string QueryTemplate { get; set; }
        }

        /// <summary>
        /// Trial balance of one ledger and period from GL_BALANCES (ledger currency, actuals, translated_flag NULL or not 'R' — for the
        /// ledger currency Fusion keeps the total AND the part entered in it, flag 'R'), by company × account (× cost centre): opening,
        /// PTD debits / credits, closing, and the balances at the start of the quarter and of the fiscal year (QTD / YTD = closing − those).
        /// On big pods every query that touches GL_CODE_COMBINATIONS by segment scans it (minutes), so GL_BALANCES is read ALONE —
        /// one period per query, keyset pages on code_combination_id (no join, no GROUP BY) — and each combination's segments come
        /// from a map kept on this PC (`CcidMapAsync`: primary-key lookups `code_combination_id IN (…)` for the ids it has not seen,
        /// so later runs need no lookup at all). Summary combinations are skipped through that map; companies are filtered in C#.
        /// Adjustment periods are folded into the period they close; names come from this PC (DuckDB / segment values).
        /// </summary>
        public static async Task<object> TrialBalanceAsync(Runner run, TbOptions o, Action<string> progress, CancellationToken ct)
        {
            var x = new Ctx { Run = run, Ct = ct, Progress = progress, LogSql = o.LogSql };
            var sw = Stopwatch.StartNew();
            try
            {
                var led = o.Ledger;
                if (led == null) return new { ok = false, error = "Pick a ledger." };
                led.Company = SegCol(led.Company); led.Account = SegCol(led.Account); led.CostCentre = SegCol(led.CostCentre);
                if (led.Company == null || led.Account == null || string.IsNullOrEmpty(led.Currency) || string.IsNullOrEmpty(led.PeriodSet))
                    return new { ok = false, error = "Ledger " + led.Name + ": the company / account segment or the calendar is missing — run Discover in Fusion setup." };
                await Probe(x).ConfigureAwait(false);
                var calr = await CalendarAsync(x, led, o.FoldAdjustments).ConfigureAwait(false);
                if (calr == null) return new { ok = false, error = "Could not read GL_PERIODS.", log = x.Log };
                var (_, normal, target) = calr.Value;
                string today = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                var p = normal.FirstOrDefault(q => q.Seq == o.PeriodSeq) ?? normal.Where(q => q.Start == null || string.CompareOrdinal(q.Start, today) <= 0).LastOrDefault() ?? normal.LastOrDefault();
                if (p == null) return new { ok = false, error = "No periods in the calendar " + led.PeriodSet + "." };
                var fy = normal.Where(q => q.Year == p.Year).OrderBy(q => q.Num).First();
                var fq = normal.Where(q => q.Year == p.Year && q.Quarter == p.Quarter).OrderBy(q => q.Num).FirstOrDefault() ?? p;
                var cur = target.Where(kv => kv.Value == p).Select(kv => kv.Key).ToList();
                bool byCc = o.ByCostCentre && led.CostCentre != null;
                var cos = new HashSet<string>((o.Companies ?? new()).Where(v => !string.IsNullOrWhiteSpace(v)));

                // one period per query: the period (opening + movements), its adjustment period(s) (movements),
                // the start of the quarter and of the year (begin balances)
                var roles = new List<(string Role, string Period, bool Begin, bool Moves)> { ("cur", p.Name, true, true) };
                foreach (var adj in cur.Where(n => n != p.Name)) roles.Add(("adj", adj, false, true));
                if (fq != p) roles.Add(("qtr", fq.Name, true, false));
                if (fy != p && fy != fq) roles.Add(("year", fy.Name, true, false));
                x.Note("Trial balance " + led.Name + " · " + p.Name + (cur.Count > 1 ? " (with " + string.Join(", ", cur.Where(n => n != p.Name)) + ")" : "") +
                       " · quarter from " + fq.Name + " · year from " + fy.Name + (cos.Count > 0 ? " · companies " + string.Join(", ", cos) : " · every company") + (byCc ? " · by cost centre" : "") +
                       " · " + roles.Count + " period(s): " + string.Join(", ", roles.Select(r => r.Period)) + " · kept on this PC after the first read");

                // 1. the GL_BALANCES rows (every column) of each period are kept on this PC (DuckDB fin_gl_balances); only missing periods are read
                var have = FinanceLens.RawPeriods(o.Pod, led.Id, led.Currency);
                var sources = new List<object>();
                var toRead = roles.Select(r => r.Period).Distinct().Where(n => o.Refresh || !have.ContainsKey(n)).ToList();
                foreach (var n in roles.Select(r => r.Period).Distinct().Where(n => !toRead.Contains(n)))
                {
                    x.Note("✓ " + n + " already on this PC: " + have[n].Rows.ToString("N0", CultureInfo.InvariantCulture) + " rows read " + have[n].At.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture));
                    sources.Add(new { period = n, from = "pc", rows = have[n].Rows, at = have[n].At.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) });
                }
                int pages = 0, rowsSoFar = 0; bool sampled = false;
                var gate = new SemaphoreSlim(Math.Clamp(o.Parallel, 1, 4));
                // every column of GL_BALANCES (as the data dictionary lists them) — kept as they are for later use
                var glbCols = (x.Types.TryGetValue("GL_BALANCES", out var gt) ? gt : new List<(string Col, string Type)>())
                    .Where(c => Regex.IsMatch(c.Col, "^[A-Z][A-Z0-9_$#]*$", RegexOptions.IgnoreCase)).ToList();
                if (glbCols.Count == 0) glbCols = new[] { "LEDGER_ID", "CODE_COMBINATION_ID", "CURRENCY_CODE", "PERIOD_NAME", "ACTUAL_FLAG", "TRANSLATED_FLAG", "BEGIN_BALANCE_DR", "BEGIN_BALANCE_CR", "PERIOD_NET_DR", "PERIOD_NET_CR" }
                    .Select(c => (c, c.EndsWith("_DR") || c.EndsWith("_CR") || c.EndsWith("_ID") ? "NUMBER" : "VARCHAR2")).ToList();
                // default query = one row per combination: the key columns + SUM() of every balance column (_DR / _CR / _ADB, also _BEQ) —
                // the other GL_BALANCES columns (who/when, partition, template …) are left out; translated_flag stays a key so the
                // ledger-currency part ('R') is never added to the total
                var glbSet = new HashSet<string>(glbCols.Select(c => c.Col), StringComparer.OrdinalIgnoreCase);
                var groupCols = new[] { "LEDGER_ID", "PERIOD_NAME", "PERIOD_YEAR", "CURRENCY_CODE", "ACTUAL_FLAG", "CODE_COMBINATION_ID", "TRANSLATED_FLAG" }
                    .Where(c => glbSet.Contains(c) || c == "LEDGER_ID" || c == "PERIOD_NAME" || c == "CODE_COMBINATION_ID").ToList();
                var sumCols = glbCols.Where(c => (c.Type ?? "").StartsWith("NUMBER", StringComparison.OrdinalIgnoreCase) && Regex.IsMatch(c.Col, "_(DR|CR|ADB)(_BEQ)?$", RegexOptions.IgnoreCase)).Select(c => c.Col.ToUpperInvariant()).ToList();
                foreach (var c in new[] { "BEGIN_BALANCE_DR", "BEGIN_BALANCE_CR", "PERIOD_NET_DR", "PERIOD_NET_CR" }) if (!sumCols.Contains(c)) sumCols.Add(c);
                glbCols = groupCols.Select(c => (c, glbCols.FirstOrDefault(g => g.Col.Equals(c, StringComparison.OrdinalIgnoreCase)).Type ?? (c.EndsWith("_ID") || c == "PERIOD_YEAR" ? "NUMBER" : "VARCHAR2")))
                    .Concat(sumCols.Select(c => (c, "NUMBER"))).ToList();
                string groupBy = string.Join(", ", groupCols.Select(c => "b." + c.ToLowerInvariant()));
                string defaultTemplate = "SELECT " + groupBy + ", " + string.Join(", ", sumCols.Select(c => "SUM(b." + c.ToLowerInvariant() + ") " + c.ToLowerInvariant())) +
                                         " FROM gl_balances b WHERE b.ledger_id = {LEDGER_ID} AND b.period_name = '{PERIOD}' AND b.currency_code = '{CURRENCY}' AND b.actual_flag = 'A' GROUP BY " + groupBy;
                string template = string.IsNullOrWhiteSpace(o.QueryTemplate) ? defaultTemplate : o.QueryTemplate.Trim().TrimEnd(';');
                bool custom = !string.IsNullOrWhiteSpace(o.QueryTemplate) && template != defaultTemplate;
                if (custom && !Regex.IsMatch(template, @"^\s*(SELECT|WITH)\b", RegexOptions.IgnoreCase)) return new { ok = false, error = "The query must start with SELECT or WITH." };
                if (custom) x.Note("Using your own GL_BALANCES query: " + template);
                string Fill(string period) => template.Replace("{LEDGER_ID}", led.Id.ToString(CultureInfo.InvariantCulture)).Replace("{PERIOD}", period.Replace("'", "''")).Replace("{CURRENCY}", (led.Currency ?? "").Replace("'", "''"));
                int page = Math.Clamp(o.ChunkSize <= 0 ? 5000 : o.ChunkSize, 100, 50000);
                bool Slow(string e) => e != null && (e.IndexOf("timed out", StringComparison.OrdinalIgnoreCase) >= 0 || e.IndexOf("timeout", StringComparison.OrdinalIgnoreCase) >= 0 || e.Contains("ORA-01013"));

                // A period is read in pages of `page` rows: first COUNT(*) (so the monitor shows page i of N), then
                //   SELECT * FROM (SELECT q.* FROM (query) q WHERE q.code_combination_id > <last id read> ORDER BY q.code_combination_id) WHERE ROWNUM <= page
                // — every page returns a small result (no time-out on a big period), continues after the last id (nothing read twice,
                // nothing missed) and stops at the first short page. A page that times out is asked again at half the size.
                async Task<List<Dictionary<string, object>>> Fetch(string period)
                {
                    string what = led.Name + " · GL_BALANCES " + period;
                    long total = -1;
                    var cr = await RunLive(x, what + " · rows", "SELECT COUNT(*) n FROM (" + Fill(period) + ")", 1).ConfigureAwait(false);
                    if (cr.Success && cr.Rows.Count > 0) { total = L(cr.Rows[0], "N"); x.Note("   " + what + " · " + total.ToString("N0", CultureInfo.InvariantCulture) + " rows → about " + Math.Max(1, (long)Math.Ceiling(total / (double)page)) + " page(s) of " + page.ToString("N0", CultureInfo.InvariantCulture)); }
                    else x.Note("   ⚠ " + what + " · the row count did not come back (" + cr.Error + ") - reading page by page anyway");
                    var all = new List<Dictionary<string, object>>();
                    if (total == 0) return all;
                    long last = long.MinValue; int size = page, n = 0, retries = 0;
                    while (true)
                    {
                        ct.ThrowIfCancellationRequested();
                        string sql = "SELECT * FROM (SELECT q.* FROM (" + Fill(period) + ") q" + (last == long.MinValue ? "" : " WHERE q.code_combination_id > " + last.ToString(CultureInfo.InvariantCulture)) +
                                     " ORDER BY q.code_combination_id) WHERE ROWNUM <= " + size;
                        if (x.LogSql && n == 0) x.Note("   SQL: " + sql);
                        string label = what + " · page " + (n + 1) + (total > 0 ? "/" + Math.Max(n + 1, (long)Math.Ceiling(total / (double)page)) : "");
                        var t0 = Stopwatch.StartNew();
                        FusionQueryResult res;
                        await gate.WaitAsync(ct).ConfigureAwait(false);
                        try { res = await RunLive(x, label, sql, size).ConfigureAwait(false); }
                        finally { gate.Release(); }
                        if (!res.Success)
                        {
                            if (Slow(res.Error) && size > 50 && retries < 4) { size = Math.Max(50, size / 2); retries++; x.Note("   ⚠ " + label + " timed out after " + (t0.ElapsedMilliseconds / 1000.0).ToString("0", CultureInfo.InvariantCulture) + " s - again with " + size.ToString("N0", CultureInfo.InvariantCulture) + " rows"); continue; }
                            throw new InvalidOperationException(label + ": " + res.Error);
                        }
                        n++;
                        if (res.Rows.Count > 0 && !res.Rows[0].ContainsKey("CODE_COMBINATION_ID")) throw new InvalidOperationException("The query must return CODE_COMBINATION_ID.");
                        bool full = res.Rows.Count >= size;
                        var rowsNow = res.Rows;
                        long nextLast = last;
                        if (full)
                        {   // a combination can have several rows in a period (e.g. translated_flag NULL and 'R'): never end a page inside one —
                            // drop the last id's rows here and read them whole on the next page
                            long tail = L(rowsNow[^1], "CODE_COMBINATION_ID");
                            var keep = rowsNow.Where(r2 => L(r2, "CODE_COMBINATION_ID") != tail).ToList();
                            if (keep.Count == 0) throw new InvalidOperationException(label + ": one code combination has more than " + size + " rows - raise the rows per fetch");
                            rowsNow = keep;
                            nextLast = L(keep[^1], "CODE_COMBINATION_ID");
                        }
                        all.AddRange(rowsNow);
                        int from, to;
                        lock (gate)
                        {
                            pages++; from = rowsSoFar + 1; rowsSoFar += rowsNow.Count; to = rowsSoFar;
                            if (!sampled && rowsNow.Count > 0) { sampled = true; LiveSample(x, what, rowsNow); }
                        }
                        x.Note((total > 0 ? "[" + Math.Min(all.Count, total) + "/" + total + "] " : "") + "   " + label + " · chunk " + pages + " · rows " + from.ToString("N0", CultureInfo.InvariantCulture) + "–" + Math.Max(from, to).ToString("N0", CultureInfo.InvariantCulture) +
                               " · " + (t0.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s");
                        if (!full) break;
                        if (nextLast <= last) throw new InvalidOperationException(label + ": code_combination_id did not move forward - stopped");
                        last = nextLast;
                        if (n >= 5000) throw new InvalidOperationException(what + ": more than 5,000 pages - stopped");
                    }
                    if (total > 0 && all.Count != total) x.Note("   ⚠ " + what + " · read " + all.Count.ToString("N0", CultureInfo.InvariantCulture) + " rows, the count said " + total.ToString("N0", CultureInfo.InvariantCulture) + " (postings in between, or several rows per combination)");
                    return all;
                }
                await Task.WhenAll(toRead.Select(async n =>
                {
                    var tw = Stopwatch.StartNew();
                    var rows = await Fetch(n).ConfigureAwait(false);
                    if (rows.Count > 0)
                    {
                        var need = new[] { "CODE_COMBINATION_ID", "BEGIN_BALANCE_DR", "BEGIN_BALANCE_CR", "PERIOD_NET_DR", "PERIOD_NET_CR" }.Where(c => !rows[0].ContainsKey(c)).ToList();
                        if (need.Count > 0) throw new InvalidOperationException("The query must return " + string.Join(", ", need) + " (it returned " + string.Join(", ", rows[0].Keys.Take(12)) + ").");
                    }
                    // the columns kept = what the query returned (types from the data dictionary when it is a GL_BALANCES column)
                    var typeOf = glbCols.ToDictionary(c => c.Col, c => c.Type, StringComparer.OrdinalIgnoreCase);
                    // (every row's keys: the runner leaves NULL values out of a row, so one row does not list every column)
                    var seen = new List<string>(); var seenSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    if (!custom) foreach (var c in glbCols) if (seenSet.Add(c.Col)) seen.Add(c.Col);
                    foreach (var r2 in rows) foreach (var k2 in r2.Keys) if (Regex.IsMatch(k2, "^[A-Z][A-Z0-9_$#]*$", RegexOptions.IgnoreCase) && seenSet.Add(k2)) seen.Add(k2);
                    var keep = seen.Select(k2 => (k2, typeOf.TryGetValue(k2, out var t2) ? t2 : rows.Take(200).All(r2 => !r2.TryGetValue(k2, out var v2) || v2 == null || double.TryParse(Convert.ToString(v2, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out _)) ? "NUMBER" : "VARCHAR2")).ToList();
                    FinanceLens.SaveRaw(o.Pod, led.Id, n, led.Currency, keep, rows, tw.ElapsedMilliseconds, null);
                    x.Note("✓ " + n + ": " + rows.Count.ToString("N0", CultureInfo.InvariantCulture) + " GL_BALANCES rows (" + glbCols.Count + " columns) read in " + (tw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s and kept on this PC (fin_gl_balances)");
                    lock (sources) sources.Add(new { period = n, from = "fusion", rows = (long)rows.Count, at = DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) });
                })).ConfigureAwait(false);

                // 2. the trial balance from the kept rows (translated_flag 'R' = the part entered in the ledger currency, already in the total)
                var bal = new Dictionary<long, double[]>();   // ccid → bb cur, dr, cr, bb qtr, bb year
                var roleOf = roles.GroupBy(r => r.Period).ToDictionary(g => g.Key, g => g.ToList());
                foreach (var r in FinanceLens.LoadRaw(o.Pod, led.Id, led.Currency, roleOf.Keys))
                {
                    if (r.Tf == "R") continue;
                    if (!bal.TryGetValue(r.Ccid, out var v)) bal[r.Ccid] = v = new double[5];
                    double b0 = r.Bdr - r.Bcr;
                    foreach (var role in roleOf[r.Period])
                    {
                        if (role.Role == "cur") { v[0] += b0; v[1] += r.Ndr; v[2] += r.Ncr; }
                        else if (role.Role == "adj") { v[1] += r.Ndr; v[2] += r.Ncr; }
                        else if (role.Role == "qtr") v[3] += b0;
                        else v[4] += b0;
                    }
                }

                // combination → segments from this PC's map (looked up in Fusion by primary key only for new ids)
                var need = new List<string> { led.Company, led.Account }; if (led.CostCentre != null) need.Add(led.CostCentre);
                var map = await CcidMapAsync(x, led.CoaId, bal.Keys.ToList(), need, Math.Clamp(o.Parallel, 1, 4)).ConfigureAwait(false);

                var acc = new Dictionary<(string Co, string Ac, string Cc), double[]>();
                var atypes = new Dictionary<(string, string), string>();
                int unknown = 0, summary = 0;
                foreach (var kv in bal)
                {
                    if (!map.TryGetValue(kv.Key, out var c)) { unknown++; continue; }
                    if (c.Summary) { summary++; continue; }
                    string co = c.Seg(led.Company), ac = c.Seg(led.Account), cc = byCc ? c.Seg(led.CostCentre) : null;
                    if (co == null || ac == null || (cos.Count > 0 && !cos.Contains(co))) continue;
                    var key = (co, ac, cc);
                    if (!acc.TryGetValue(key, out var v)) acc[key] = v = new double[5];
                    for (int i = 0; i < 5; i++) v[i] += kv.Value[i];
                    if (c.Type != null) atypes[(co, ac)] = c.Type;
                }
                if (unknown > 0) x.Note("⚠ " + unknown + " combination(s) not found in GL_CODE_COMBINATIONS - left out");
                if (summary > 0) x.Note(summary.ToString("N0", CultureInfo.InvariantCulture) + " summary combination(s) skipped");

                var accNames = FinanceLens.SegmentNames(led.CoaId, led.Account);
                var coNames = FinanceLens.SegmentNames(led.CoaId, led.Company);
                foreach (var kv in led.CompanyNames ?? new()) if (!string.IsNullOrEmpty(kv.Value) && !coNames.ContainsKey(kv.Key)) coNames[kv.Key] = kv.Value;
                var ccNames = byCc ? FinanceLens.SegmentNames(led.CoaId, led.CostCentre) : new Dictionary<string, string>();
                var list = acc.Select(kv =>
                {
                    var v = kv.Value; double op = v[0], dr = v[1], cr = v[2], cl = op + dr - cr;
                    double qo = fq == p ? op : v[3], yo = fy == p ? op : fy == fq ? v[3] : v[4];
                    string co = kv.Key.Co, ac = kv.Key.Ac, cc = kv.Key.Cc;
                    return new
                    {
                        company = co, companyName = coNames.TryGetValue(co, out var cn) ? cn : null,
                        account = ac, accountName = accNames.TryGetValue(ac, out var an) ? an : null, accountType = atypes.TryGetValue((co, ac), out var at) ? at : null,
                        costCentre = cc, costCentreName = cc != null && ccNames.TryGetValue(cc, out var ccn) ? ccn : null,
                        opening = Math.Round(op, 2), ptdDr = Math.Round(dr, 2), ptdCr = Math.Round(cr, 2), closing = Math.Round(cl, 2),
                        qtrOpen = Math.Round(qo, 2), yearOpen = Math.Round(yo, 2), qtd = Math.Round(cl - qo, 2), ytd = Math.Round(cl - yo, 2)
                    };
                }).Where(r => r.opening != 0 || r.ptdDr != 0 || r.ptdCr != 0 || r.closing != 0 || r.yearOpen != 0 || r.qtrOpen != 0)
                  .OrderBy(r => r.company, StringComparer.Ordinal).ThenBy(r => r.account, StringComparer.Ordinal).ThenBy(r => r.costCentre, StringComparer.Ordinal).ToList();
                x.Note("✓ " + list.Count.ToString("N0", CultureInfo.InvariantCulture) + " lines from " + bal.Count.ToString("N0", CultureInfo.InvariantCulture) + " combinations · " + pages + " page(s) · " +
                       (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s");
                return new
                {
                    ok = true, ledger = new { id = led.Id, code = led.Code, name = led.Name, currency = led.Currency, coaId = led.CoaId },
                    period = new { name = p.Name, seq = p.Seq, year = p.Year, quarter = p.Quarter, folded = cur.Where(n => n != p.Name).ToList(), yearFrom = fy.Name, quarterFrom = fq.Name },
                    byCostCentre = byCc, companies = cos.ToList(), rows = list, namesFromPc = accNames.Count, reads = pages, combinations = bal.Count, sources, queryTemplate = template, defaultTemplate, customQuery = custom, ms = sw.ElapsedMilliseconds, log = x.Log
                };
            }
            catch (OperationCanceledException) { return new { ok = false, error = "Cancelled.", log = x.Log }; }
            catch (Exception ex) { x.Note("✖ " + ex.Message); return new { ok = false, error = ex.Message, log = x.Log }; }
        }

        // ═════ code combination map kept on this PC ═════
        public sealed class CcidInfo
        {
            public string Type; public bool Summary; public Dictionary<string, string> Segs = new();
            public string Seg(string col) => col != null && Segs.TryGetValue(col, out var v) ? v : null;
        }
        private static readonly object _ccidLock = new();
        private static string CcidFile(string coaId) => Path.Combine(FinanceLens.Root, "ccid-cache", "coa_" + Regex.Replace(coaId ?? "x", "[^A-Za-z0-9_-]", "_") + ".tsv");

        /// <summary>
        /// Segments of code combinations: read from {root}\ccid-cache\coa_{id}.tsv (one line per combination: id, account type,
        /// summary flag, then column=value), the rest looked up in Fusion by primary key (`code_combination_id IN (…)`, 500 per query)
        /// and added to the file. A combination's segments never change, so the file only grows.
        /// </summary>
        private static async Task<Dictionary<long, CcidInfo>> CcidMapAsync(Ctx x, string coaId, List<long> ids, List<string> cols, int parallel)
        {
            var map = new Dictionary<long, CcidInfo>();
            string file = CcidFile(coaId);
            lock (_ccidLock)
            {
                if (File.Exists(file))
                    foreach (var line in File.ReadLines(file))
                    {
                        var f = line.Split('\t');
                        if (f.Length < 3 || !long.TryParse(f[0], out var id)) continue;
                        var c = new CcidInfo { Type = f[1].Length > 0 ? f[1] : null, Summary = f[2] == "Y" };
                        for (int i = 3; i < f.Length; i++) { int e = f[i].IndexOf('='); if (e > 0) c.Segs[f[i].Substring(0, e)] = f[i].Substring(e + 1); }
                        map[id] = c;
                    }
            }
            cols = cols.Select(SegCol).Where(c => c != null).Distinct().ToList();
            var missing = ids.Where(id => !map.TryGetValue(id, out var c) || cols.Any(k => !c.Segs.ContainsKey(k))).Distinct().OrderBy(i => i).ToList();
            x.Note("Code combinations: " + (ids.Count - missing.Count).ToString("N0", CultureInfo.InvariantCulture) + " known on this PC, " + missing.Count.ToString("N0", CultureInfo.InvariantCulture) + " to look up in Fusion");
            if (missing.Count == 0) return map;
            // ask for every segment this map already keeps plus the ones needed now, so the file stays complete
            var all = cols.Union(map.Values.SelectMany(c => c.Segs.Keys)).Distinct().Where(c => SegCol(c) != null).OrderBy(c => c.Length).ThenBy(c => c, StringComparer.Ordinal).ToList();
            bool hasSumm = x.Has("GL_CODE_COMBINATIONS", "SUMMARY_FLAG");
            var found = new List<(long, CcidInfo)>();
            var gate = new SemaphoreSlim(Math.Max(1, parallel));
            var batches = missing.Chunk(500).ToList();
            int done = 0;
            await Task.WhenAll(batches.Select(async (b, bi) =>
            {
                await gate.WaitAsync(x.Ct).ConfigureAwait(false);
                try
                {
                    string sql = "SELECT c.code_combination_id ccid, c.account_type atype" + (hasSumm ? ", c.summary_flag sflag" : "") + string.Concat(all.Select(c => ", c." + c)) +
                                 " FROM gl_code_combinations c WHERE c.code_combination_id IN (" + string.Join(",", b.Select(i => i.ToString(CultureInfo.InvariantCulture))) + ")";
                    var t0 = Stopwatch.StartNew();
                    var r = await RunLive(x, "code combinations " + (bi + 1) + "/" + batches.Count, sql, 1000).ConfigureAwait(false);
                    if (!r.Success) throw new InvalidOperationException("code combinations: " + r.Error);
                    lock (found)
                    {
                        foreach (var row in r.Rows)
                        {
                            var c = new CcidInfo { Type = S(row, "ATYPE"), Summary = hasSumm && S(row, "SFLAG") == "Y" };
                            foreach (var k in all) c.Segs[k] = S(row, k) ?? "";
                            found.Add((L(row, "CCID"), c));
                        }
                        done++;
                    }
                    x.Note("   code combinations " + done + "/" + batches.Count + " · " + r.Rows.Count + " · " + (t0.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s");
                }
                finally { gate.Release(); }
            })).ConfigureAwait(false);
            foreach (var (id, c) in found) map[id] = c;
            try { FinanceLens.SaveCcids(coaId, found.Select(f => (f.Item1, f.Item2.Type, f.Item2.Summary, f.Item2.Segs))); } catch (Exception ex) { x.Note("⚠ fin_ccid not saved: " + ex.Message); }
            try
            {
                lock (_ccidLock)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    var sb = new StringBuilder();
                    foreach (var kv in map.OrderBy(k => k.Key))
                        sb.Append(kv.Key.ToString(CultureInfo.InvariantCulture)).Append('\t').Append(kv.Value.Type ?? "").Append('\t').Append(kv.Value.Summary ? "Y" : "N")
                          .Append(string.Concat(kv.Value.Segs.Select(s => "\t" + s.Key + "=" + (s.Value ?? "").Replace('\t', ' ').Replace('\n', ' ')))).Append('\n');
                    File.WriteAllText(file + ".tmp", sb.ToString());
                    File.Move(file + ".tmp", file, true);
                }
                x.Note("   " + found.Count.ToString("N0", CultureInfo.InvariantCulture) + " combination(s) added to " + file);
            }
            catch (Exception ex) { x.Note("⚠ code combination map not saved: " + ex.Message); }
            return map;
        }

        public sealed class SegValue { public string Value { get; set; } public string Description { get; set; } public long Combinations { get; set; } public string AccountType { get; set; } }

        private static void DeleteCodes(DuckDBConnection conn, string table, IEnumerable<string> codes)
        {
            foreach (var chunk in codes.Distinct().Chunk(500))
                FinanceLens.Exec(conn, "DELETE FROM " + table + " WHERE code IN (" + string.Join(",", chunk.Select(FinanceLens.Lit)) + ")");
        }
        private static object ParseDate(string s) => DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? DateOnly.FromDateTime(d) : null;
        private static string TypeOf(Dictionary<string, Dictionary<string, long>> t, string a) =>
            t.TryGetValue(a, out var m) && m.Count > 0 ? m.OrderByDescending(kv => kv.Value).First().Key : "E";
        private static bool IsPlType(string t) => t == "R" || t == "E";

        /// <summary>
        /// Stores a discovery in the finance file: fin_fusion_discovery (the whole JSON for the page, per pod) and
        /// fin_coa_segments (one row per segment: name, qualifiers, measured purity, role - the chosen roles win over the
        /// discovered ones - and why). Creates the tables in files built before they existed.
        /// </summary>
        internal static void WriteDiscovery(DuckDBConnection conn, string pod, string json, string user, Dictionary<string, Dictionary<string, string>> roles)
        {
            if (string.IsNullOrWhiteSpace(json)) return;
            pod ??= "";
            FinanceLens.Exec(conn, "CREATE TABLE IF NOT EXISTS fin_fusion_discovery (pod VARCHAR, discovered_at VARCHAR, discovered_by VARCHAR, json VARCHAR)");
            FinanceLens.Exec(conn, "CREATE TABLE IF NOT EXISTS fin_coa_segments (pod VARCHAR, coa_id VARCHAR, column_name VARCHAR, segment_name VARCHAR, segment_num INTEGER, value_set_id VARCHAR, qualifiers VARCHAR, " +
                                   "distinct_values BIGINT, purity DOUBLE, role VARCHAR, evidence VARCHAR, discovered_at VARCHAR)");
            using var d = JsonDocument.Parse(json);
            var root = d.RootElement;
            string at = root.TryGetProperty("discoveredAt", out var da) && da.ValueKind == JsonValueKind.String ? da.GetString() : DateTime.Now.ToString("s");
            FinanceLens.Exec(conn, "DELETE FROM fin_fusion_discovery WHERE pod = " + FinanceLens.Lit(pod));
            FinanceLens.Exec(conn, "DELETE FROM fin_coa_segments WHERE pod = " + FinanceLens.Lit(pod));
            FinanceLens.Append(conn, "fin_fusion_discovery", new List<object[]> { new object[] { pod, at, user, json } });
            var rows = new List<object[]>();
            if (root.TryGetProperty("coas", out var coas) && coas.ValueKind == JsonValueKind.Object)
                foreach (var c in coas.EnumerateObject())
                {
                    var coa = c.Value;
                    string g(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                    var found = new Dictionary<string, string>();          // role → column
                    foreach (var role in new[] { "company", "costCentre", "account", "intercompany" }) { var col = g(coa, role); if (col != null) found[role] = col; }
                    if (roles != null && roles.TryGetValue(c.Name, out var chosen) && chosen != null)
                        foreach (var role in new[] { "company", "costCentre", "account" }) { if (chosen.TryGetValue(role, out var col) && !string.IsNullOrEmpty(col)) found[role] = col; else found.Remove(role); }
                    if (!coa.TryGetProperty("segments", out var segs) || segs.ValueKind != JsonValueKind.Array) continue;
                    foreach (var sg in segs.EnumerateArray())
                    {
                        string col = g(sg, "col");
                        string role = found.Where(kv => kv.Value == col).Select(kv => kv.Key).FirstOrDefault();
                        string why = role != null && coa.TryGetProperty("why", out var w) && w.TryGetProperty(role, out var wr) && wr.ValueKind == JsonValueKind.String ? wr.GetString() : null;
                        if (roles != null && roles.ContainsKey(c.Name) && role != null && (why == null || g(coa, role) != col)) why = "Chosen by the user";
                        var q = sg.TryGetProperty("qualifiers", out var qs) && qs.ValueKind == JsonValueKind.Array ? string.Join(",", qs.EnumerateArray().Select(z => z.GetString())) : "";
                        rows.Add(new object[] { pod, c.Name, col, g(sg, "name"), sg.TryGetProperty("num", out var n) && n.TryGetInt32(out var ni) ? ni : 0, g(sg, "valueSetId"), q,
                            sg.TryGetProperty("distinct", out var di) && di.TryGetInt64(out var dl) ? dl : 0L, sg.TryGetProperty("purity", out var pu) && pu.TryGetDouble(out var pd) ? pd : 0.0,
                            role == null ? null : role switch { "company" => "COMPANY", "costCentre" => "COST_CENTRE", "account" => "ACCOUNT", _ => "INTERCOMPANY" }, why, at });
                    }
                }
            FinanceLens.Append(conn, "fin_coa_segments", rows);
        }

        /// <summary>
        /// Reads a query in ranked chunks: ROW_NUMBER() over the key columns, at most <paramref name="chunk"/> rows per call,
        /// each next chunk starting after the last key read (keyset, so every chunk costs the same however deep it is).
        /// A chunk that fails with a time-out is read again at half the size (down to 250 rows). Every chunk is logged.
        /// </summary>
        private static async Task<int> RankedAsync(Ctx x, string what, string inner, string[] keys, bool[] numeric, int chunk, Action<List<Dictionary<string, object>>> onRows)
        {
            int size = Math.Clamp(chunk <= 0 ? DEFAULT_CHUNK : chunk, MIN_CHUNK, 10000), total = 0, n = 0, retries = 0;
            string[] last = null;
            var start = Stopwatch.StartNew();
            string order = string.Join(", ", keys.Select(k => "q." + k));
            x.Note("▶ " + what + " · ranked chunks of " + size.ToString("N0", CultureInfo.InvariantCulture) + " rows (ROW_NUMBER over " + string.Join(", ", keys) + ")");
            while (true)
            {
                x.Ct.ThrowIfCancellationRequested();
                string after = last == null ? "1 = 1" : Keyset(keys, numeric, last);
                string sql = "SELECT * FROM (SELECT q.*, ROW_NUMBER() OVER (ORDER BY " + order + ") rn FROM (" + inner + ") q WHERE " + after + ") WHERE rn <= " + size + " ORDER BY rn";
                if (x.LogSql && n == 0) x.Note("   SQL: " + sql);
                var sw = Stopwatch.StartNew();
                var r = await RunLive(x, what + " · chunk " + (n + 1), sql, size).ConfigureAwait(false);
                if (!r.Success)
                {
                    bool slow = (r.Error ?? "").IndexOf("Timed out", StringComparison.OrdinalIgnoreCase) >= 0 || (r.Error ?? "").IndexOf("timeout", StringComparison.OrdinalIgnoreCase) >= 0;
                    if (slow && size > MIN_CHUNK && retries < 4)
                    {
                        size = Math.Max(MIN_CHUNK, size / 2); retries++;
                        x.Note("   ⚠ " + what + " · chunk " + (n + 1) + " timed out after " + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s - reading it again in chunks of " + size.ToString("N0", CultureInfo.InvariantCulture));
                        continue;
                    }
                    x.Note("   ✖ " + what + " · chunk " + (n + 1) + " failed: " + r.Error);
                    throw new InvalidOperationException("chunk " + (n + 1) + " (rows " + (total + 1).ToString("N0", CultureInfo.InvariantCulture) + "…): " + r.Error);
                }
                n++;
                var rows = r.Rows;
                if (n == 1) LiveSample(x, what, rows);
                onRows(rows);
                double secs = Math.Max(0.001, sw.ElapsedMilliseconds / 1000.0);
                x.Note("   " + what + " · chunk " + n + " · rows " + (total + 1).ToString("N0", CultureInfo.InvariantCulture) + "–" + (total + rows.Count).ToString("N0", CultureInfo.InvariantCulture) +
                       " · " + secs.ToString("0.0", CultureInfo.InvariantCulture) + " s · " + ((int)(rows.Count / secs)).ToString("N0", CultureInfo.InvariantCulture) + " rows/s");
                total += rows.Count;
                if (rows.Count < size) break;
                var tail = rows[^1];
                last = keys.Select(k => S(tail, k)).ToArray();
                if (last.Any(v => v == null)) throw new InvalidOperationException("the key " + string.Join(", ", keys) + " came back empty - cannot page further");
                if (n >= 5000) throw new InvalidOperationException("more than 5,000 chunks - stopped");
            }
            x.Note("   " + what + " · " + total.ToString("N0", CultureInfo.InvariantCulture) + " rows in " + n + " chunk(s), " + (start.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s");
            return total;
        }

        /// <summary>(k1, k2) after (v1, v2): k1 > v1 OR (k1 = v1 AND k2 > v2). Numbers are checked, text is quoted.</summary>
        private static string Keyset(string[] keys, bool[] numeric, string[] vals)
        {
            string lit(int i)
            {
                if (!numeric[i]) return Q(vals[i]);
                if (!decimal.TryParse(vals[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) throw new InvalidOperationException("key " + keys[i] + " is not a number: " + vals[i]);
                return d.ToString(CultureInfo.InvariantCulture);
            }
            var parts = new List<string>();
            for (int i = 0; i < keys.Length; i++)
            {
                var eq = Enumerable.Range(0, i).Select(j => "q." + keys[j] + " = " + lit(j)).ToList();
                eq.Add("q." + keys[i] + " > " + lit(i));
                parts.Add("(" + string.Join(" AND ", eq) + ")");
            }
            return "(" + string.Join(" OR ", parts) + ")";
        }

        /// <summary>Descriptions of segment values: FND_FLEX_VALUES_VL, FND_VS_VALUES_B/_TL, or GL_FLEXFIELDS_PKG.</summary>
        private static async Task<Dictionary<string, string>> ValueNames(Ctx x, string coaId, string col, List<string> values)
        {
            var map = new Dictionary<string, string>();
            if (values.Count == 0 || col == null) return map;
            string segTable = x.HasTable("FND_ID_FLEX_SEGMENTS") ? "fnd_id_flex_segments" : "fnd_id_flex_segments_vl";
            string vsSub = "(SELECT flex_value_set_id FROM " + segTable + " WHERE application_id = 101 AND id_flex_code = 'GL#' AND id_flex_num = " + coaId + " AND application_column_name = " + Q(col) + ")";
            string kfSub = x.Has("FND_KF_SEGMENT_INSTANCES", "VALUE_SET_ID")
                ? "(SELECT gi.value_set_id FROM fnd_kf_segment_instances gi JOIN fnd_kf_str_instances_b si ON si.structure_instance_id = gi.structure_instance_id JOIN fnd_kf_segments_b sg ON sg.structure_id = si.structure_id AND sg.segment_code = gi.segment_code AND sg.key_flexfield_code = si.key_flexfield_code WHERE si.key_flexfield_code = 'GL#' AND si.structure_instance_number = " + coaId + " AND sg.column_name = " + Q(col) + " AND ROWNUM = 1)"
                : null;
            var r = await Try(x, "value names " + col, 200000,
                x.HasTable("FND_FLEX_VALUES_VL") ? "SELECT flex_value v, description d FROM fnd_flex_values_vl WHERE flex_value_set_id = " + vsSub : null,
                x.HasTable("FND_VS_VALUES_B") ? "SELECT b.value v, t.description d FROM fnd_vs_values_b b JOIN fnd_vs_values_tl t ON t.value_id = b.value_id AND t.language = USERENV('LANG') WHERE b.value_set_id = " + (kfSub ?? vsSub) : null).ConfigureAwait(false);
            if (r != null) foreach (var z in r.Rows) { string v = S(z, "V"); if (v != null && !map.ContainsKey(v)) map[v] = S(z, "D"); }
            return map;
        }
    }
}

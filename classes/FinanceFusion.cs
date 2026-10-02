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

        private const int PAGE = 50000;

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
            public bool Has(string table, string col) => Cols.TryGetValue(table, out var c) && c.Contains(col);
            public bool HasTable(string table) => Cols.ContainsKey(table) && Cols[table].Count > 0;
            public void Note(string s) { Log.Add(s); Progress?.Invoke(s); }
        }

        private static async Task<FusionQueryResult> Try(Ctx x, string label, int cap, params string[] variants)
        {
            string last = null;
            foreach (var sql in variants.Where(v => !string.IsNullOrWhiteSpace(v)))
            {
                x.Ct.ThrowIfCancellationRequested();
                var r = await x.Run(sql, cap, x.Ct).ConfigureAwait(false);
                if (r.Success) return r;
                last = r.Error;
                Debug.WriteLine("[FinanceFusion] " + label + " variant failed: " + r.Error);
            }
            x.Log.Add("⚠ " + label + ": " + (last ?? "no query applies on this pod"));
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
                "SELECT table_name, column_name FROM all_tab_columns WHERE table_name IN (" + string.Join(",", PROBE_TABLES.Select(Q)) + ")").ConfigureAwait(false);
            if (r == null) return;
            foreach (var row in r.Rows)
            {
                string t = S(row, "TABLE_NAME"), c = S(row, "COLUMN_NAME");
                if (t == null || c == null) continue;
                if (!x.Cols.TryGetValue(t, out var set)) x.Cols[t] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                set.Add(c);
            }
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
                    var mr = await Try(x, "segment measures", 5, sql.ToString()).ConfigureAwait(false);
                    if (mr != null && mr.Rows.Count > 0)
                    {
                        var r = mr.Rows[0];
                        coa.Combinations = L(r, "N");
                        for (int i = 0; i < cols.Count; i++)
                        {
                            long dd = L(r, "D" + i), tt = L(r, "T" + i);
                            if (dd == 0) continue;           // segment not used
                            var seg = coa.Segments.FirstOrDefault(s => s.Col == cols[i]);
                            if (seg == null) coa.Segments.Add(seg = new Segment { Col = cols[i], Name = cols[i], Num = i + 1 });
                            seg.Distinct = dd; seg.DistinctWithType = tt; seg.Purity = tt > 0 ? Math.Round((double)dd / tt, 4) : 0;
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
            public int Parallel { get; set; } = 3;
        }

        private sealed class Acc { public double Begin, Dr, Cr; }

        public static async Task<object> SyncAsync(Runner run, SyncOptions o, Action<string> progress, CancellationToken ct)
        {
            var sw = Stopwatch.StartNew();
            var x = new Ctx { Run = run, Ct = ct, Progress = progress };
            if (o.Ledgers.Count == 0) return new { ok = false, error = "Pick at least one ledger." };
            foreach (var l in o.Ledgers)
            {
                l.Company = SegCol(l.Company); l.Account = SegCol(l.Account); l.CostCentre = SegCol(l.CostCentre);
                if (l.Company == null || l.Account == null) return new { ok = false, error = "Ledger " + l.Name + ": choose the company (balancing) and the account segment." };
                if (string.IsNullOrEmpty(l.Currency) || string.IsNullOrEmpty(l.PeriodSet)) return new { ok = false, error = "Ledger " + l.Name + ": run Discover again (currency / calendar missing)." };
                if (string.IsNullOrWhiteSpace(l.Code)) l.Code = l.Id.ToString(CultureInfo.InvariantCulture);
            }
            if (o.FromSeq <= 0 || o.ToSeq < o.FromSeq) return new { ok = false, error = "Choose the first and last period." };
            await Probe(x).ConfigureAwait(false);

            // ── the calendar of the first ledger defines the periods ──
            var first = o.Ledgers[0];
            if (o.Ledgers.Any(l => l.PeriodSet != first.PeriodSet || l.PeriodType != first.PeriodType))
                x.Note("⚠ The ledgers use different calendars: periods are matched by name to the calendar of " + first.Name + ".");
            var pr = await Try(x, "periods", 5000,
                "SELECT period_name, period_year, period_num, quarter_num, TO_CHAR(start_date, 'YYYY-MM-DD') sd, TO_CHAR(end_date, 'YYYY-MM-DD') ed, adjustment_period_flag adj FROM gl_periods WHERE period_set_name = " +
                Q(first.PeriodSet) + " AND period_type = " + Q(first.PeriodType) + " ORDER BY period_year, period_num").ConfigureAwait(false);
            if (pr == null) return new { ok = false, error = "Could not read GL_PERIODS.", log = x.Log };
            var cal = pr.Rows.Select(r => new PeriodRow { Name = S(r, "PERIOD_NAME"), Year = (int)L(r, "PERIOD_YEAR"), Num = (int)L(r, "PERIOD_NUM"), Quarter = (int)L(r, "QUARTER_NUM"), Start = S(r, "SD"), End = S(r, "ED"), Adj = S(r, "ADJ") == "Y" }).ToList();
            var normal = cal.Where(p => !p.Adj).ToList();
            // an adjustment period is folded into the last normal period of its year at or before it (Adj-25 → Dec-25)
            var target = new Dictionary<string, PeriodRow>();
            foreach (var p in normal) target[p.Name] = p;
            foreach (var a in cal.Where(p => p.Adj))
            {
                var t = normal.Where(p => p.Year == a.Year && p.Num <= a.Num).OrderByDescending(p => p.Num).FirstOrDefault() ?? normal.Where(p => p.Year == a.Year).OrderBy(p => p.Num).FirstOrDefault();
                if (t != null && o.FoldAdjustments) target[a.Name] = t;
            }
            var periods = normal.Where(p => p.Seq >= o.FromSeq && p.Seq <= o.ToSeq).ToList();
            if (periods.Count == 0) return new { ok = false, error = "No periods between the chosen first and last period." };
            int budgetFrom = periods.Min(p => p.Year) * 100;   // the budget is re-read from the start of the first fiscal year (running balances)
            var budgetPeriods = normal.Where(p => p.Seq > budgetFrom && p.Seq <= o.ToSeq).ToList();
            var journalPeriods = o.JournalMonths > 0 ? periods.Skip(Math.Max(0, periods.Count - o.JournalMonths)).ToList() : new List<PeriodRow>();
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

            var balances = new List<object[]>();
            var journals = new List<object[]>();
            var acctTypes = new Dictionary<string, Dictionary<string, long>>();          // account → type → combinations
            var companies = new Dictionary<string, (string Name, string Ledger)>();
            var ccs = new HashSet<string>();
            var gate = new SemaphoreSlim(Math.Clamp(o.Parallel, 1, 4));
            int done = 0, total = o.Ledgers.Count * (periods.Count + (string.IsNullOrEmpty(o.BudgetSource) ? 0 : budgetPeriods.Count) + journalPeriods.Count);
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
                    var tr = await Try(x, "account types", 200000,
                        "SELECT c." + led.Account + " ac, c.account_type t, COUNT(*) n FROM gl_code_combinations c WHERE c.chart_of_accounts_id = " + led.CoaId + summ + " GROUP BY c." + led.Account + ", c.account_type").ConfigureAwait(false);
                    if (tr != null)
                        foreach (var r in tr.Rows)
                        {
                            string a = S(r, "AC"); if (a == null) continue;
                            if (!acctTypes.TryGetValue(a, out var tm)) acctTypes[a] = tm = new();
                            string t = S(r, "T") ?? "?"; tm[t] = (tm.TryGetValue(t, out var v) ? v : 0) + L(r, "N");
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
                            string amounts = "SUM(NVL(b.period_net_dr, 0)) dr, SUM(NVL(b.period_net_cr, 0)) cr";
                            if (from.StartsWith("gl_budget_balances", StringComparison.Ordinal) && !x.Has("GL_BUDGET_BALANCES", "PERIOD_NET_DR"))
                            {
                                string amt = new[] { "PERIOD_NET", "BUDGET_AMOUNT", "AMOUNT", "PERIOD_NET_AMOUNT" }.FirstOrDefault(c => x.Has("GL_BUDGET_BALANCES", c));
                                if (amt == null) throw new InvalidOperationException("GL_BUDGET_BALANCES has no amount column this sync knows (PERIOD_NET_DR / _CR, PERIOD_NET, BUDGET_AMOUNT).");
                                amounts = "SUM(GREATEST(NVL(b." + amt + ", 0), 0)) dr, SUM(GREATEST(-NVL(b." + amt + ", 0), 0)) cr";
                            }
                            string sel = "SELECT c." + led.Company + " co, " + ccExpr + " cc, c." + led.Account + " ac, b.period_name pn, " +
                                         (hasBegin ? "SUM(NVL(b.begin_balance_dr, 0) - NVL(b.begin_balance_cr, 0))" : "0") + " bb, " + amounts + " FROM " + from +
                                         " JOIN gl_code_combinations c ON c.code_combination_id = b.code_combination_id WHERE " + where + summ + " AND b.period_name IN (" + names + ")";
                            string grp = " GROUP BY c." + led.Company + ", " + ccExpr + ", c." + led.Account + ", b.period_name";
                            List<Dictionary<string, object>> rows;
                            try { rows = await Split(x, sel, grp, "c." + led.Company, "c." + led.Account).ConfigureAwait(false); }
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
                            Tick(led.Name + " · " + (scenario == "ACTUAL" ? "" : "budget ") + p.Name + " · " + acc.Count + " balances");
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
                            long after = 0; int lines = 0;
                            for (int page = 0; page < 200; page++)
                            {
                                string sql = "SELECT h.je_header_id id, l.je_line_num ln, " + (batch ? "bt.name" : "NULL") + " bn, h.name jn, h.je_source js, h.je_category jc, l.period_name pn, " +
                                    "TO_CHAR(NVL(l.effective_date, h.default_effective_date), 'YYYY-MM-DD') ad, TO_CHAR(NVL(h.posted_date, h.creation_date), 'YYYY-MM-DD HH24:MI:SS') pa, h.created_by cb, " +
                                    "c." + led.Company + " co, " + ccExpr + " cc, c." + led.Account + " ac, NVL(l.accounted_dr, 0) dr, NVL(l.accounted_cr, 0) cr, SUBSTR(NVL(l.description, h.description), 1, 200) ds " +
                                    "FROM gl_je_lines l JOIN gl_je_headers h ON h.je_header_id = l.je_header_id " + (batch ? "JOIN gl_je_batches bt ON bt.je_batch_id = h.je_batch_id " : "") +
                                    "JOIN gl_code_combinations c ON c.code_combination_id = l.code_combination_id WHERE h.ledger_id = " + led.Id + " AND h.status = 'P' AND h.actual_flag = 'A' AND h.currency_code IS NOT NULL" +
                                    " AND l.period_name IN (" + names + ") AND h.je_header_id > " + after + " ORDER BY h.je_header_id, l.je_line_num";
                                var r = await x.Run(sql, PAGE, ct).ConfigureAwait(false);
                                if (!r.Success && sql.Contains("l.effective_date"))
                                    r = await x.Run(sql.Replace("NVL(l.effective_date, h.default_effective_date)", "h.default_effective_date"), PAGE, ct).ConfigureAwait(false);
                                if (!r.Success) { x.Log.Add("⚠ journals " + p.Name + ": " + r.Error); break; }
                                var rows = r.Rows;
                                if (r.Capped && rows.Count > 0)
                                {
                                    long lastId = L(rows[^1], "ID");
                                    var keep = rows.Where(z => L(z, "ID") != lastId).ToList();
                                    if (keep.Count > 0) { rows = keep; after = L(keep[^1], "ID"); }   // the last journal may be cut: read it again on the next page
                                    else after = lastId;                                               // one journal larger than a page: keep what came
                                }
                                lock (lockObj)
                                {
                                    foreach (var z in rows)
                                    {
                                        DateTime.TryParse(S(z, "AD"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var ad);
                                        DateTime.TryParse(S(z, "PA"), CultureInfo.InvariantCulture, DateTimeStyles.None, out var pa);
                                        journals.Add(new object[] { L(z, "ID"), (int)L(z, "LN"), S(z, "BN"), S(z, "JN"), S(z, "JS"), S(z, "JC"), p.Name, p.Seq,
                                            ad == default ? (object)null : DateOnly.FromDateTime(ad), pa == default ? (object)null : pa, S(z, "CB"),
                                            S(z, "CO") ?? "", S(z, "CC") ?? "-", S(z, "AC") ?? "", Math.Round(D(z, "DR"), 2), Math.Round(D(z, "CR"), 2), S(z, "DS"), led.Code });
                                    }
                                }
                                lines += rows.Count;
                                if (!r.Capped) break;
                                x.Progress?.Invoke(led.Name + " · journals " + p.Name + " · " + lines.ToString("N0", CultureInfo.InvariantCulture) + " lines…");
                            }
                            Tick(led.Name + " · journals " + p.Name + " · " + lines.ToString("N0", CultureInfo.InvariantCulture) + " lines");
                        }
                        finally { gate.Release(); }
                    }

                    var work = new List<Task>();
                    work.AddRange(periods.Select(p => Bal(p, "ACTUAL")));
                    if (!string.IsNullOrEmpty(o.BudgetSource)) work.AddRange(budgetPeriods.Select(p => Bal(p, "BUDGET")));
                    work.AddRange(journalPeriods.Select(Jnl));
                    await Task.WhenAll(work).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException) { return new { ok = false, error = "Cancelled - nothing was changed.", log = x.Log }; }
            catch (Exception ex) { return new { ok = false, error = ex.Message, log = x.Log }; }

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
            int keptFrom = o.FromSeq;
            using (var conn = new DuckDBConnection("Data Source=" + tmp))
            {
                conn.Open();
                if (!incremental)
                    foreach (var stmt in FinanceLens.SCHEMA.Split(';').Select(s => s.Trim()).Where(s => s.Length > 0)) FinanceLens.Exec(conn, stmt);
                else
                {
                    FinanceLens.Exec(conn, "DELETE FROM fin_balances WHERE ledger IN (" + ledIn + ") AND period_seq BETWEEN " + o.FromSeq + " AND " + o.ToSeq +
                                           (string.IsNullOrEmpty(o.BudgetSource) ? " AND scenario = 'ACTUAL'" : ""));
                    using (var pc = conn.CreateCommand())
                    {
                        pc.CommandText = "SELECT MIN(TRY_CAST(value AS INTEGER)) FROM fin_meta WHERE key = 'from_seq'";
                        var pv = pc.ExecuteScalar();
                        if (pv != null && pv != DBNull.Value) keptFrom = Math.Min(o.FromSeq, Convert.ToInt32(pv));
                    }
                    if (journalPeriods.Count > 0) FinanceLens.Exec(conn, "DELETE FROM fin_journals WHERE ledger IN (" + ledIn + ") AND period_seq >= " + jMin + " AND period_seq <= " + o.ToSeq);
                    foreach (var t in new[] { "fin_meta", "fin_ledgers", "fin_segments" }) FinanceLens.Exec(conn, "DELETE FROM " + t);
                }
                // dimensions: replace the codes this load saw, keep the others (incremental)
                var accRows = acctTypes.Keys.Select(a => new object[] { a, acctNames.TryGetValue(a, out var n) ? n : a, TypeOf(acctTypes, a), null, null }).ToList();
                var coRows = companies.Select(kv => new object[] { kv.Key, kv.Value.Name ?? (coNames.TryGetValue(kv.Key, out var n) ? n : kv.Key), o.Ledgers.First(l => l.Code == kv.Value.Ledger).Currency }).ToList();
                var ccRows = ccs.Select(c => new object[] { c, c == "-" ? "(no cost centre segment)" : ccNames.TryGetValue(c, out var n) ? n : c, null }).ToList();
                if (incremental)
                {
                    DeleteCodes(conn, "fin_accounts", accRows.Select(r => (string)r[0]));
                    DeleteCodes(conn, "fin_companies", coRows.Select(r => (string)r[0]));
                    DeleteCodes(conn, "fin_cost_centres", ccRows.Select(r => (string)r[0]));
                    FinanceLens.Exec(conn, "DELETE FROM fin_periods WHERE period_seq BETWEEN " + o.FromSeq + " AND " + o.ToSeq);
                }
                FinanceLens.Append(conn, "fin_accounts", accRows);
                FinanceLens.Append(conn, "fin_companies", coRows);
                FinanceLens.Append(conn, "fin_cost_centres", ccRows);
                FinanceLens.Append(conn, "fin_periods", normal.Where(p => p.Seq >= o.FromSeq && p.Seq <= o.ToSeq)
                    .Select(p => new object[] { p.Name, p.Seq, p.Year, p.Num, p.Quarter > 0 ? p.Quarter : (p.Num - 1) / 3 + 1, ParseDate(p.Start), ParseDate(p.End) }).ToList());
                FinanceLens.Append(conn, "fin_ledgers", o.Ledgers.Select(l => new object[] { l.Code, l.Name, l.Currency, l.CoaId, l.Company, l.CostCentre, l.Account, l.Category }).ToList());
                FinanceLens.Append(conn, "fin_segments", new List<object[]> {
                    new object[] { 1, "COMPANY", "Company (" + first.Company + ")", first.Company }, new object[] { 2, "COST_CENTRE", "Cost centre (" + (first.CostCentre ?? "none") + ")", first.CostCentre },
                    new object[] { 3, "ACCOUNT", "Account (" + first.Account + ")", first.Account } });
                FinanceLens.Append(conn, "fin_balances", balances);
                FinanceLens.Append(conn, "fin_journals", journals);
                var meta = new List<object[]>
                {
                    new object[] { "source", "FUSION" }, new object[] { "pod", o.Pod ?? "" }, new object[] { "loaded_at", DateTime.Now.ToString("s") },
                    new object[] { "currency", first.Currency }, new object[] { "currencies", string.Join(",", o.Ledgers.Select(l => l.Currency).Distinct()) },
                    new object[] { "description", "Oracle Fusion GL: " + string.Join(", ", o.Ledgers.Select(l => l.Name)) },
                    new object[] { "fusion_signature", signature }, new object[] { "from_seq", keptFrom.ToString(CultureInfo.InvariantCulture) }, new object[] { "to_seq", o.ToSeq.ToString(CultureInfo.InvariantCulture) },
                    new object[] { "budget", string.IsNullOrEmpty(o.BudgetSource) ? "" : o.BudgetSource + ":" + o.BudgetId },
                    new object[] { "journals_from_seq", journalPeriods.Count > 0 ? jMin.ToString(CultureInfo.InvariantCulture) : "" },
                    new object[] { "load_mode", incremental ? "INCREMENTAL" : "FULL" }
                };
                FinanceLens.Append(conn, "fin_meta", meta);
                FinanceLens.Exec(conn, "CHECKPOINT");
            }
            FinanceLens.SwapIn(tmp);
            x.Note("Done in " + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s.");
            return new
            {
                ok = true, balances = balances.Count, journals = journals.Count, accounts = acctTypes.Count, companies = companies.Count, periods = periods.Count,
                mode = incremental ? "INCREMENTAL" : "FULL", ms = sw.ElapsedMilliseconds, log = x.Log
            };
        }

        private static void DeleteCodes(DuckDBConnection conn, string table, IEnumerable<string> codes)
        {
            foreach (var chunk in codes.Distinct().Chunk(500))
                FinanceLens.Exec(conn, "DELETE FROM " + table + " WHERE code IN (" + string.Join(",", chunk.Select(FinanceLens.Lit)) + ")");
        }
        private static object ParseDate(string s) => DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? DateOnly.FromDateTime(d) : null;
        private static string TypeOf(Dictionary<string, Dictionary<string, long>> t, string a) =>
            t.TryGetValue(a, out var m) && m.Count > 0 ? m.OrderByDescending(kv => kv.Value).First().Key : "E";
        private static bool IsPlType(string t) => t == "R" || t == "E";

        /// <summary>Runs a grouped query; when the row cap is reached it splits by company, then by company × first character of the account.</summary>
        private static async Task<List<Dictionary<string, object>>> Split(Ctx x, string sel, string grp, string coExpr, string acExpr)
        {
            var r = await x.Run(sel + grp, 100000, x.Ct).ConfigureAwait(false);
            if (!r.Success) throw new InvalidOperationException(r.Error);
            if (!r.Capped) return r.Rows;
            var cos = await x.Run("SELECT DISTINCT " + coExpr + " v" + sel.Substring(sel.IndexOf(" FROM ", StringComparison.Ordinal)), 10000, x.Ct).ConfigureAwait(false);
            if (!cos.Success) throw new InvalidOperationException(cos.Error);
            var all = new List<Dictionary<string, object>>();
            foreach (var co in cos.Rows.Select(z => S(z, "V")).Where(v => v != null))
            {
                var p = await x.Run(sel + " AND " + coExpr + " = " + Q(co) + grp, 100000, x.Ct).ConfigureAwait(false);
                if (!p.Success) throw new InvalidOperationException(p.Error);
                if (!p.Capped) { all.AddRange(p.Rows); continue; }
                foreach (var ch in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
                {
                    var q = await x.Run(sel + " AND " + coExpr + " = " + Q(co) + " AND UPPER(SUBSTR(" + acExpr + ", 1, 1)) = '" + ch + "'" + grp, 100000, x.Ct).ConfigureAwait(false);
                    if (!q.Success) throw new InvalidOperationException(q.Error);
                    if (q.Capped) throw new InvalidOperationException("More than 100,000 balances for company " + co + " in one period - map fewer segments or ask for BICC extracts.");
                    all.AddRange(q.Rows);
                }
            }
            return all;
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

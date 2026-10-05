using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens › Planning (finance/fin-plan.js): budget / forecast / scenario versions kept on this PC in the finance DuckDB file
    /// (the shared copy is in APEX — WMS_FIN_PLAN_VERSIONS / _LINES / _EVENTS, written by the page). Nothing goes to Oracle Fusion.
    ///   fin_plan_versions  one row per version: name, kind, fiscal year, ledger, currency, status, rev, periods + the rest as JSON
    ///   fin_plan_lines     one row per company × cost centre × account: rule (method + parameters), adj, note, months as JSON
    ///   fin_plan_amounts   the same months one row per period (natural sign, debit − credit) — what statements, the SQL explorer and
    ///                      the Copilot read (the page uses the version chosen as budget as scenario BUDGET)
    /// Kept by full loads (CarryOver), removed with the data file (the page brings them back from APEX).
    /// </summary>
    public static partial class FinanceLens
    {
        internal const string PLAN_VERSIONS_TABLE = "CREATE TABLE IF NOT EXISTS fin_plan_versions (version_id VARCHAR, name VARCHAR, kind VARCHAR, fiscal_year INTEGER, ledger VARCHAR, " +
            "currency VARCHAR, status VARCHAR, rev INTEGER, actual_through INTEGER, periods_json VARCHAR, meta_json VARCHAR, changed_at TIMESTAMP, changed_by VARCHAR)";
        internal const string PLAN_LINES_TABLE = "CREATE TABLE IF NOT EXISTS fin_plan_lines (version_id VARCHAR, company VARCHAR, cost_centre VARCHAR, account VARCHAR, method VARCHAR, " +
            "rule_json VARCHAR, adj DOUBLE, note VARCHAR, total DOUBLE, amounts_json VARCHAR)";
        internal const string PLAN_AMOUNTS_TABLE = "CREATE TABLE IF NOT EXISTS fin_plan_amounts (version_id VARCHAR, ledger VARCHAR, company VARCHAR, cost_centre VARCHAR, account VARCHAR, " +
            "period_seq INTEGER, fiscal_year INTEGER, amount DOUBLE)";
        internal static readonly string[] PLAN_TABLES = { "fin_plan_versions", "fin_plan_lines", "fin_plan_amounts" };
        internal static void EnsurePlanTables(DuckDBConnection conn) { Exec(conn, PLAN_VERSIONS_TABLE); Exec(conn, PLAN_LINES_TABLE); Exec(conn, PLAN_AMOUNTS_TABLE); }

        /// <summary>Replaces one version (header, lines, monthly amounts). root = { version: {...}, lines: [{company, cc, account, m: [..], rule, adj, note}] }.
        /// Returns the number of lines.</summary>
        public static int SavePlan(JsonElement root, string user)
        {
            var v = root.GetProperty("version");
            string id = Str(v, "id");
            if (string.IsNullOrWhiteSpace(id) || id.Length > 60) throw new InvalidOperationException("version id is required");
            int I(JsonElement e, string k) => e.TryGetProperty(k, out var x) && x.ValueKind == JsonValueKind.Number && x.TryGetInt32(out var n) ? n : 0;
            var periods = v.TryGetProperty("periods", out var ps) && ps.ValueKind == JsonValueKind.Array ? ps.EnumerateArray().Select(p => (Seq: I(p, "period_seq"), Year: I(p, "fiscal_year"))).ToList() : new List<(int Seq, int Year)>();
            if (periods.Count == 0 || periods.Count > 24) throw new InvalidOperationException("the version needs its periods (1-24)");
            string ledger = Str(v, "ledger") ?? "";
            // the header: the fixed columns + everything else of the version as JSON (drivers, targets, notes, workflow)
            var meta = new Dictionary<string, JsonElement>();
            foreach (var p in v.EnumerateObject()) if (p.Name != "lines" && p.Name != "periods") meta[p.Name] = p.Value;
            var now = DateTime.Now;
            var head = new object[] { id, Str(v, "name"), Str(v, "kind") ?? "BUDGET", I(v, "year"), ledger, Str(v, "currency"), Str(v, "status") ?? "DRAFT", I(v, "rev"),
                I(v, "actualThrough") == 0 ? null : (object)I(v, "actualThrough"), ps.GetRawText(), JsonSerializer.Serialize(meta), now, user ?? "" };
            var lines = new List<object[]>(); var amounts = new List<object[]>();
            if (root.TryGetProperty("lines", out var ls) && ls.ValueKind == JsonValueKind.Array)
                foreach (var l in ls.EnumerateArray())
                {
                    string co = Str(l, "company") ?? "", cc = Str(l, "cc") ?? "", acc = Str(l, "account");
                    if (string.IsNullOrEmpty(acc)) continue;
                    var m = l.TryGetProperty("m", out var mm) && mm.ValueKind == JsonValueKind.Array ? mm.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.Number ? x.GetDouble() : 0).ToList() : new List<double>();
                    string rule = l.TryGetProperty("rule", out var ru) && ru.ValueKind == JsonValueKind.Object ? ru.GetRawText() : null;
                    string method = l.TryGetProperty("rule", out var ru2) && ru2.ValueKind == JsonValueKind.Object ? Str(ru2, "method") : "manual";
                    double adj = l.TryGetProperty("adj", out var ad) && ad.ValueKind == JsonValueKind.Number ? ad.GetDouble() : 1;
                    lines.Add(new object[] { id, co, cc, acc, method ?? "manual", rule, adj, Str(l, "note"), m.Sum(), JsonSerializer.Serialize(m) });
                    for (int i = 0; i < periods.Count && i < m.Count; i++)
                        if (Math.Abs(m[i]) >= 0.005) amounts.Add(new object[] { id, ledger, co, cc, acc, periods[i].Seq, periods[i].Year, m[i] });
                }
            lock (_lock)
            {
                using var conn = OpenWrite();
                EnsurePlanTables(conn);
                Exec(conn, "BEGIN TRANSACTION");
                try
                {
                    foreach (var t in PLAN_TABLES) Exec(conn, "DELETE FROM " + t + " WHERE version_id = " + Lit(id));
                    Append(conn, "fin_plan_versions", new List<object[]> { head });
                    Append(conn, "fin_plan_lines", lines);
                    Append(conn, "fin_plan_amounts", amounts);
                    Exec(conn, "COMMIT");
                }
                catch { Exec(conn, "ROLLBACK"); throw; }
                Exec(conn, "CHECKPOINT");
            }
            return lines.Count;
        }

        /// <summary>Forgets one version on this PC.</summary>
        public static void DeletePlan(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return;
            lock (_lock)
            {
                using var conn = OpenWrite();
                EnsurePlanTables(conn);
                foreach (var t in PLAN_TABLES) Exec(conn, "DELETE FROM " + t + " WHERE version_id = " + Lit(id));
                Exec(conn, "CHECKPOINT");
            }
        }

        /// <summary>The versions on this PC: [{id, name, kind, year, status, rev, changedAt, lines}] (empty when there are none yet).</summary>
        public static object PlanList()
        {
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_plan_versions'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return new object[0];
            var r = Query("SELECT v.version_id, v.name, v.kind, v.fiscal_year, v.status, v.rev, CAST(v.changed_at AS VARCHAR), v.changed_by, (SELECT COUNT(*) FROM fin_plan_lines l WHERE l.version_id = v.version_id) " +
                "FROM fin_plan_versions v ORDER BY v.fiscal_year DESC, v.changed_at DESC", 1000);
            return r.Rows.Select(x => new { id = Convert.ToString(x[0]), name = Convert.ToString(x[1]), kind = Convert.ToString(x[2]), year = Convert.ToInt32(x[3] ?? 0, CultureInfo.InvariantCulture),
                status = Convert.ToString(x[4]), rev = Convert.ToInt32(x[5] ?? 0, CultureInfo.InvariantCulture), changedAt = Convert.ToString(x[6]), changedBy = Convert.ToString(x[7]), lines = Convert.ToInt64(x[8] ?? 0L) }).ToList();
        }
    }
}

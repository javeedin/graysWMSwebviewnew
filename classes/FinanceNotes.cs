using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens › Statements notes (finance/fin-notes.js): any number of notes per period (or for every period — global), for one
    /// statement or every statement, optionally on one line, kept on this PC in the finance DuckDB file (fin_notes). The shared copy is
    /// in APEX (WMS_FIN_NOTES, written by the page); rev says which copy is newer. A deleted note stays as a row with removed = true so
    /// the deletion reaches the other side too. Kept by full loads (CarryOver).
    /// </summary>
    public static partial class FinanceLens
    {
        internal const string NOTES_TABLE = "CREATE TABLE IF NOT EXISTS fin_notes (note_id VARCHAR, scope VARCHAR, period_seq INTEGER, ledger VARCHAR, company VARCHAR, template_id VARCHAR, " +
            "row_id VARCHAR, row_label VARCHAR, kind VARCHAR, title VARCHAR, body VARCHAR, sort_no INTEGER, rev INTEGER, removed BOOLEAN, created_by VARCHAR, created_at VARCHAR, changed_by VARCHAR, changed_at VARCHAR)";

        /// <summary>Upserts notes (an array of {id, scope, period, ledger, company, tpl, row, rowLabel, kind, title, body, sort, rev, removed, createdBy, createdAt, changedBy, changedAt});
        /// a note is replaced only when the incoming rev is the same or newer. Returns how many were written.</summary>
        public static int SaveNotes(JsonElement notes)
        {
            if (notes.ValueKind != JsonValueKind.Array) throw new InvalidOperationException("notes must be a list");
            int I(JsonElement e, string k) => e.TryGetProperty(k, out var x) && x.ValueKind == JsonValueKind.Number && x.TryGetInt32(out var n) ? n : 0;
            string S(JsonElement e, string k, int max) { var s = Str(e, k) ?? ""; return s.Length > max ? s.Substring(0, max) : s; }
            int n0 = 0;
            lock (_lock)
            {
                using var conn = OpenWrite();
                Exec(conn, NOTES_TABLE);
                var have = new Dictionary<string, int>();
                using (var cmd = conn.CreateCommand())
                {
                    cmd.CommandText = "SELECT note_id, rev FROM fin_notes";
                    using var rd = cmd.ExecuteReader();
                    while (rd.Read()) have[rd.GetString(0)] = rd.IsDBNull(1) ? 0 : Convert.ToInt32(rd.GetValue(1), CultureInfo.InvariantCulture);
                }
                var rows = new List<object[]>(); var ids = new List<string>();
                foreach (var n in notes.EnumerateArray())
                {
                    string id = S(n, "id", 60);
                    if (string.IsNullOrWhiteSpace(id)) continue;
                    int rev = I(n, "rev");
                    if (have.TryGetValue(id, out var old) && old > rev) continue;
                    string scope = string.Equals(Str(n, "scope"), "GLOBAL", StringComparison.OrdinalIgnoreCase) ? "GLOBAL" : "PERIOD";
                    bool removed = n.TryGetProperty("removed", out var rm) && rm.ValueKind == JsonValueKind.True;
                    rows.Add(new object[] { id, scope, scope == "GLOBAL" ? null : (object)I(n, "period"), S(n, "ledger", 100), S(n, "company", 150), S(n, "tpl", 60), S(n, "row", 60), S(n, "rowLabel", 300),
                        S(n, "kind", 20), S(n, "title", 300), S(n, "body", 16000), I(n, "sort"), rev, removed, S(n, "createdBy", 100), S(n, "createdAt", 30), S(n, "changedBy", 100), S(n, "changedAt", 30) });
                    ids.Add(id);
                }
                if (rows.Count > 0)
                {
                    Exec(conn, "BEGIN TRANSACTION");
                    try
                    {
                        Exec(conn, "DELETE FROM fin_notes WHERE note_id IN (" + string.Join(",", ids.Select(Lit)) + ")");
                        Append(conn, "fin_notes", rows);
                        Exec(conn, "COMMIT");
                    }
                    catch { Exec(conn, "ROLLBACK"); throw; }
                    Exec(conn, "CHECKPOINT");
                }
                n0 = rows.Count;
            }
            return n0;
        }

        /// <summary>Every note on this PC, removed ones too (the page merges them with APEX).</summary>
        public static object ListNotes()
        {
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'fin_notes'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return new object[0];
            var r = Query("SELECT note_id, scope, period_seq, ledger, company, template_id, row_id, row_label, kind, title, body, sort_no, rev, removed, created_by, created_at, changed_by, changed_at FROM fin_notes", 100000);
            if (r.Error != null) throw new InvalidOperationException(r.Error);
            int N(object o) => o == null ? 0 : Convert.ToInt32(o, CultureInfo.InvariantCulture);
            return r.Rows.Select(x => new
            {
                id = Convert.ToString(x[0]), scope = Convert.ToString(x[1]), period = x[2] == null ? (int?)null : N(x[2]), ledger = Convert.ToString(x[3]), company = Convert.ToString(x[4]),
                tpl = Convert.ToString(x[5]), row = Convert.ToString(x[6]), rowLabel = Convert.ToString(x[7]), kind = Convert.ToString(x[8]), title = Convert.ToString(x[9]), body = Convert.ToString(x[10]),
                sort = N(x[11]), rev = N(x[12]), removed = x[13] is bool b && b, createdBy = Convert.ToString(x[14]), createdAt = Convert.ToString(x[15]), changedBy = Convert.ToString(x[16]), changedAt = Convert.ToString(x[17])
            }).ToList();
        }
    }
}

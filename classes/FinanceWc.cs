using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// Finance Lens working capital: debtors (AR_PAYMENT_SCHEDULES_ALL open items by customer × ageing bucket), creditors
    /// (AP_PAYMENT_SCHEDULES_ALL of uncancelled AP_INVOICES_ALL by supplier × bucket, items on hold) and stock on hand
    /// (INV_ONHAND_QUANTITIES_DETAIL by organisation × item × subinventory, age from the oldest receipt, an optional unit
    /// cost from a cost table the user picks) — read-only through the Fusion SQL runner, aggregated in Fusion, kept as
    /// snapshots in DuckDB (fin_wc_parties / fin_wc_stock / fin_wc_snapshots). Ages are as of the sync (SYSDATE), not a
    /// period end. The queries are editable: placeholders {BUCKET:due-date expression}, {AS_OF}, {ORG_FILTER:column}, {UNIT_COST}.
    /// </summary>
    public static class FinanceWorkingCapital
    {
        public sealed class CostSource
        {
            public string Table { get; set; } public string ItemCol { get; set; } public string OrgCol { get; set; } public string CostCol { get; set; }
            /// <summary>Cost tables keyed by cost organisation: the table's own org column (COST_ORG_ID) and the table that maps
            /// inventory organisations to cost organisations (e.g. CST_COST_INV_ORGS: inventory org column → cost org column).</summary>
            public string CostOrgCol { get; set; } public string MapTable { get; set; } public string MapInvCol { get; set; } public string MapCostCol { get; set; }
        }
        public sealed class Options
        {
            public string Pod { get; set; }
            public List<string> Kinds { get; set; } = new() { "AR", "AP", "INV" };
            public List<int> Buckets { get; set; } = new() { 30, 60, 90, 180 };
            public List<string> Orgs { get; set; } = new();          // business unit ids (AR / AP), inventory organisation ids (INV)
            public string ArQuery { get; set; }
            public string ApQuery { get; set; }
            public string InvQuery { get; set; }
            public CostSource Cost { get; set; }
        }

        public const string AR_DEFAULT = @"SELECT TO_CHAR(ps.ORG_ID) AS BU_ID, NVL(a.ACCOUNT_NUMBER, '-') AS PARTY_NUMBER, NVL(p.PARTY_NAME, '(no customer)') AS PARTY_NAME,
  ps.INVOICE_CURRENCY_CODE AS CURRENCY, {BUCKET:ps.DUE_DATE} AS BUCKET, COUNT(*) AS ITEMS,
  SUM(NVL(ps.ACCTD_AMOUNT_DUE_REMAINING, 0)) AS AMOUNT, SUM(NVL(ps.AMOUNT_DUE_REMAINING, 0)) AS AMOUNT_ENTERED,
  TO_CHAR(MIN(ps.DUE_DATE), 'YYYY-MM-DD') AS OLDEST_DUE, 0 AS ON_HOLD
FROM AR_PAYMENT_SCHEDULES_ALL ps
LEFT JOIN HZ_CUST_ACCOUNTS a ON a.CUST_ACCOUNT_ID = ps.CUSTOMER_ID
LEFT JOIN HZ_PARTIES p ON p.PARTY_ID = a.PARTY_ID
WHERE ps.STATUS = 'OP' AND NVL(ps.AMOUNT_DUE_REMAINING, 0) <> 0 {ORG_FILTER:ps.ORG_ID}
GROUP BY ps.ORG_ID, NVL(a.ACCOUNT_NUMBER, '-'), NVL(p.PARTY_NAME, '(no customer)'), ps.INVOICE_CURRENCY_CODE, {BUCKET:ps.DUE_DATE}";

        public const string AP_DEFAULT = @"SELECT TO_CHAR(i.ORG_ID) AS BU_ID, NVL(s.SEGMENT1, '-') AS PARTY_NUMBER, NVL(p.PARTY_NAME, '(no supplier)') AS PARTY_NAME,
  i.INVOICE_CURRENCY_CODE AS CURRENCY, {BUCKET:ps.DUE_DATE} AS BUCKET, COUNT(*) AS ITEMS,
  SUM(NVL(ps.AMOUNT_REMAINING, 0) * NVL(i.EXCHANGE_RATE, 1)) AS AMOUNT, SUM(NVL(ps.AMOUNT_REMAINING, 0)) AS AMOUNT_ENTERED,
  TO_CHAR(MIN(ps.DUE_DATE), 'YYYY-MM-DD') AS OLDEST_DUE, SUM(CASE WHEN ps.HOLD_FLAG = 'Y' THEN 1 ELSE 0 END) AS ON_HOLD
FROM AP_PAYMENT_SCHEDULES_ALL ps
JOIN AP_INVOICES_ALL i ON i.INVOICE_ID = ps.INVOICE_ID
LEFT JOIN POZ_SUPPLIERS s ON s.VENDOR_ID = i.VENDOR_ID
LEFT JOIN HZ_PARTIES p ON p.PARTY_ID = s.PARTY_ID
WHERE i.CANCELLED_DATE IS NULL AND NVL(ps.AMOUNT_REMAINING, 0) <> 0 {ORG_FILTER:i.ORG_ID}
GROUP BY i.ORG_ID, NVL(s.SEGMENT1, '-'), NVL(p.PARTY_NAME, '(no supplier)'), i.INVOICE_CURRENCY_CODE, {BUCKET:ps.DUE_DATE}";

        public const string INV_DEFAULT = @"SELECT TO_CHAR(q.ORGANIZATION_ID) AS ORG_ID,
  (SELECT op.ORGANIZATION_CODE FROM INV_ORG_PARAMETERS op WHERE op.ORGANIZATION_ID = q.ORGANIZATION_ID) AS ORG_CODE,
  i.ITEM_NUMBER, (SELECT tl.DESCRIPTION FROM EGP_SYSTEM_ITEMS_TL tl WHERE tl.INVENTORY_ITEM_ID = i.INVENTORY_ITEM_ID AND tl.ORGANIZATION_ID = i.ORGANIZATION_ID AND tl.LANGUAGE = USERENV('LANG')) AS DESCRIPTION,
  q.SUBINVENTORY_CODE AS SUBINVENTORY, i.PRIMARY_UOM_CODE AS UOM, SUM(NVL(q.TRANSACTION_QUANTITY, 0)) AS QUANTITY,
  {UNIT_COST} AS UNIT_COST, TO_CHAR(MIN(q.DATE_RECEIVED), 'YYYY-MM-DD') AS OLDEST_RECEIPT, {AS_OF} - TRUNC(MIN(q.DATE_RECEIVED)) AS AGE_DAYS
FROM INV_ONHAND_QUANTITIES_DETAIL q
JOIN EGP_SYSTEM_ITEMS_B i ON i.INVENTORY_ITEM_ID = q.INVENTORY_ITEM_ID AND i.ORGANIZATION_ID = q.ORGANIZATION_ID
WHERE 1 = 1 {ORG_FILTER:q.ORGANIZATION_ID}
GROUP BY q.ORGANIZATION_ID, i.INVENTORY_ITEM_ID, i.ORGANIZATION_ID, i.ITEM_NUMBER, q.SUBINVENTORY_CODE, i.PRIMARY_UOM_CODE";

        private static readonly string[] PARTY_COLS = { "BU_ID", "PARTY_NUMBER", "PARTY_NAME", "CURRENCY", "BUCKET", "ITEMS", "AMOUNT", "AMOUNT_ENTERED", "OLDEST_DUE", "ON_HOLD" };
        private static readonly string[] STOCK_COLS = { "ORG_ID", "ORG_CODE", "ITEM_NUMBER", "DESCRIPTION", "SUBINVENTORY", "UOM", "QUANTITY", "UNIT_COST", "OLDEST_RECEIPT", "AGE_DAYS" };
        private static readonly Regex IDENT = new Regex(@"^[A-Za-z][A-Za-z0-9_$#]{0,62}(\.[A-Za-z][A-Za-z0-9_$#]{0,62})?$");
        private static string Lit(string s) => "'" + (s ?? "").Replace("'", "''") + "'";

        /// <summary>Bucket names in order for the boundaries (Current, 1-30, 31-60 …, &gt;180)</summary>
        public static List<string> BucketNames(IEnumerable<int> bounds)
        {
            var b = (bounds ?? new List<int>()).Where(x => x > 0).Distinct().OrderBy(x => x).ToList();
            var names = new List<string> { "Current" };
            int lo = 1;
            foreach (var x in b) { names.Add(lo + "-" + x); lo = x + 1; }
            names.Add(">" + (b.Count > 0 ? b[^1] : 0));
            return names;
        }
        private static string BucketExpr(string due, List<int> bounds)
        {
            var b = bounds.Where(x => x > 0).Distinct().OrderBy(x => x).ToList();
            var names = BucketNames(b);
            var sb = new StringBuilder("CASE WHEN " + due + " IS NULL OR " + due + " >= TRUNC(SYSDATE) THEN '" + names[0] + "'");
            for (int i = 0; i < b.Count; i++) sb.Append(" WHEN TRUNC(SYSDATE) - TRUNC(" + due + ") <= " + b[i] + " THEN '" + names[i + 1] + "'");
            sb.Append(" ELSE '" + names[^1] + "' END");
            return sb.ToString();
        }

        /// <summary>Placeholders → SQL. Throws on a cost source that is not plain identifiers.</summary>
        public static string Fill(string tpl, Options o)
        {
            var bounds = (o.Buckets != null && o.Buckets.Count > 0) ? o.Buckets : new List<int> { 30, 60, 90, 180 };
            string sql = Regex.Replace(tpl ?? "", @"\{BUCKET:([^}]+)\}", m => BucketExpr(m.Groups[1].Value.Trim(), bounds));
            var orgs = (o.Orgs ?? new List<string>()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToList();
            sql = Regex.Replace(sql, @"\{ORG_FILTER:([^}]+)\}", m => orgs.Count == 0 ? "" : " AND TO_CHAR(" + m.Groups[1].Value.Trim() + ") IN (" + string.Join(",", orgs.Select(Lit)) + ")");
            sql = sql.Replace("{AS_OF}", "TRUNC(SYSDATE)");
            string cost = "CAST(NULL AS NUMBER)";
            var c = o.Cost;
            if (c != null && !string.IsNullOrWhiteSpace(c.Table))
            {
                bool map = string.IsNullOrWhiteSpace(c.OrgCol) && !string.IsNullOrWhiteSpace(c.MapTable) && !string.IsNullOrWhiteSpace(c.CostOrgCol);
                foreach (var id in new[] { c.Table, c.ItemCol, c.CostCol }.Concat(string.IsNullOrWhiteSpace(c.OrgCol) ? Array.Empty<string>() : new[] { c.OrgCol })
                                   .Concat(map ? new[] { c.CostOrgCol, c.MapTable, c.MapInvCol, c.MapCostCol } : Array.Empty<string>()))
                    if (!IDENT.IsMatch(id ?? "")) throw new ArgumentException("The cost source must be plain table / column names.");
                cost = "(SELECT MAX(cs." + c.CostCol + ") FROM " + c.Table + " cs WHERE cs." + c.ItemCol + " = i.INVENTORY_ITEM_ID" +
                       (!string.IsNullOrWhiteSpace(c.OrgCol) ? " AND cs." + c.OrgCol + " = q.ORGANIZATION_ID"
                        : map ? " AND cs." + c.CostOrgCol + " IN (SELECT m." + c.MapCostCol + " FROM " + c.MapTable + " m WHERE m." + c.MapInvCol + " = q.ORGANIZATION_ID)" : "") + ")";
            }
            return sql.Replace("{UNIT_COST}", cost);
        }

        private static object Get(Dictionary<string, object> row, string col)
        {
            if (row.TryGetValue(col, out var v)) return v;
            foreach (var kv in row) if (string.Equals(kv.Key, col, StringComparison.OrdinalIgnoreCase)) return kv.Value;
            return null;
        }
        private static string Short(string e) => e == null ? "" : e.Length > 160 ? e.Substring(0, 160) + "…" : e;
        private static string S(object v) => v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture);
        private static double D(object v) => v == null ? 0 : double.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
        private static double? DN(object v) => v == null || Convert.ToString(v, CultureInfo.InvariantCulture) == "" ? null : D(v);

        /// <summary>One Fusion read per kind → a DuckDB snapshot. progress gets the same live lines as the GL sync.</summary>
        public static async Task<List<object>> SyncAsync(FinanceFusion.Runner run, Options o, Action<string> progress, CancellationToken ct)
        {
            var at = DateTime.Now; at = new DateTime(at.Year, at.Month, at.Day, at.Hour, at.Minute, at.Second);
            var outList = new List<object>();
            foreach (var kind in (o.Kinds ?? new List<string>()).Select(k => k.ToUpperInvariant()).Distinct())
            {
                if (kind != "AR" && kind != "AP" && kind != "INV") continue;
                string label = kind == "AR" ? "Debtors" : kind == "AP" ? "Creditors" : "Stock on hand";
                string sql;
                try { sql = Fill(kind == "AR" ? (o.ArQuery ?? AR_DEFAULT) : kind == "AP" ? (o.ApQuery ?? AP_DEFAULT) : (o.InvQuery ?? INV_DEFAULT), o); }
                catch (Exception ex) { outList.Add(new { kind, ok = false, error = ex.Message }); continue; }
                if (!Regex.IsMatch(sql.TrimStart(), @"^(select|with)\b", RegexOptions.IgnoreCase) || sql.Contains(';')) { outList.Add(new { kind, ok = false, error = "The query must be one SELECT / WITH" }); continue; }
                string id = kind.ToLowerInvariant() + "_" + Guid.NewGuid().ToString("N").Substring(0, 6);
                progress?.Invoke("\u0001" + JsonSerializer.Serialize(new { t = "sql", id, what = label, sql }));
                progress?.Invoke("📥 " + label + " — reading the open items from Fusion …");
                var sw = Stopwatch.StartNew();
                FusionSql.FusionQueryResult r = null;
                try { r = await run(sql, 100000, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex) { r = new FusionSql.FusionQueryResult { Success = false, Error = ex.Message }; }
                progress?.Invoke("\u0001" + JsonSerializer.Serialize(new { t = "end", id, ok = r != null && r.Success, rows = r?.Rows?.Count ?? 0, ms = sw.ElapsedMilliseconds, error = r == null ? "cancelled" : r.Success ? null : r.Error }));
                if (r == null || !r.Success) { outList.Add(new { kind, ok = false, error = r?.Error ?? "cancelled", sql }); progress?.Invoke("⚠ " + label + ": " + (r?.Error ?? "cancelled")); continue; }
                var rows = new List<object[]>();
                double total = 0; int costed = 0;
                if (kind == "INV")
                {
                    foreach (var row in r.Rows)
                    {
                        double q = D(Get(row, "QUANTITY")); var uc = DN(Get(row, "UNIT_COST"));
                        double? val = uc == null ? null : q * uc.Value;
                        if (val != null) { total += val.Value; costed++; }
                        var age = DN(Get(row, "AGE_DAYS"));
                        rows.Add(new object[] { S(Get(row, "ORG_ID")), S(Get(row, "ORG_CODE")), S(Get(row, "ITEM_NUMBER")), S(Get(row, "DESCRIPTION")), S(Get(row, "SUBINVENTORY")), S(Get(row, "UOM")), q, uc, val, S(Get(row, "OLDEST_RECEIPT")), age == null ? (object)null : (long)Math.Round(age.Value) });
                    }
                }
                else
                {
                    foreach (var row in r.Rows)
                    {
                        double amt = D(Get(row, "AMOUNT")); total += amt;
                        rows.Add(new object[] { S(Get(row, "BU_ID")), S(Get(row, "PARTY_NUMBER")), S(Get(row, "PARTY_NAME")), S(Get(row, "CURRENCY")), S(Get(row, "BUCKET")), (long)D(Get(row, "ITEMS")), amt, D(Get(row, "AMOUNT_ENTERED")), S(Get(row, "OLDEST_DUE")), (long)D(Get(row, "ON_HOLD")) });
                    }
                }
                string note = kind == "INV" ? (o.Cost != null && !string.IsNullOrWhiteSpace(o.Cost.Table) ? "unit cost from " + o.Cost.Table + "." + o.Cost.CostCol + ": " + costed + " of " + rows.Count + " lines costed" : "no cost source — quantities only; value from the GL") : "";
                FinanceLens.SaveWc(o.Pod, kind, at, rows, total, sw.ElapsedMilliseconds, r.Capped, note);
                try
                {   // business unit / organisation names for the filters (kept on this PC, only ids not named yet)
                    var ids = rows.Select(z => Convert.ToString(z[0], CultureInfo.InvariantCulture)).Where(v => v != null && Regex.IsMatch(v, "^[0-9]{1,20}$")).Distinct().ToList();
                    string nk = kind == "INV" ? "ORG" : "BU";
                    var known = FinanceLens.WcNames(o.Pod, nk);
                    var todo = ids.Where(v => !known.ContainsKey(v)).ToList();
                    if (todo.Count > 0)
                    {
                        var (nm, lg) = await NamesAsync(run, nk, todo, ct).ConfigureAwait(false);
                        if (nm.Count > 0) FinanceLens.SaveWcNames(o.Pod, nk, nm);
                        progress?.Invoke("   " + nm.Count + " of " + todo.Count + (nk == "BU" ? " business unit" : " organisation") + " name(s) read" + (nm.Count < todo.Count ? " — " + string.Join(" · ", lg) : ""));
                    }
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex) { progress?.Invoke("   ⚠ names: " + ex.Message); }
                progress?.Invoke("✔ " + label + ": " + rows.Count.ToString("N0", CultureInfo.InvariantCulture) + " row(s)" + (kind == "INV" && costed == 0 ? "" : ", total " + total.ToString("N0", CultureInfo.InvariantCulture)) + (r.Capped ? " — capped at 100,000 rows, narrow it with organisations" : ""));
                outList.Add(new { kind, ok = true, rows = rows.Count, total, ms = sw.ElapsedMilliseconds, capped = r.Capped, note, at });
            }
            return outList;
        }

        /// <summary>The open items behind one customer / supplier (or the on-hand lines of one item) — live from Fusion, at most 500.</summary>
        public static async Task<object> DetailAsync(FinanceFusion.Runner run, string kind, string party, string bu, CancellationToken ct)
        {
            kind = (kind ?? "").ToUpperInvariant();
            string w = string.IsNullOrWhiteSpace(bu) ? "" : " AND TO_CHAR({ORG}) = " + Lit(bu);
            string sql = kind switch
            {
                "AR" => "SELECT ps.TRX_NUMBER, ps.CLASS, TO_CHAR(ps.TRX_DATE, 'YYYY-MM-DD') AS TRX_DATE, TO_CHAR(ps.DUE_DATE, 'YYYY-MM-DD') AS DUE_DATE, TRUNC(SYSDATE) - TRUNC(ps.DUE_DATE) AS DAYS_LATE, ps.INVOICE_CURRENCY_CODE AS CURRENCY, " +
                        "ps.AMOUNT_DUE_ORIGINAL AS ORIGINAL, ps.AMOUNT_DUE_REMAINING AS REMAINING, ps.ACCTD_AMOUNT_DUE_REMAINING AS REMAINING_LEDGER FROM AR_PAYMENT_SCHEDULES_ALL ps " +
                        "LEFT JOIN HZ_CUST_ACCOUNTS a ON a.CUST_ACCOUNT_ID = ps.CUSTOMER_ID WHERE ps.STATUS = 'OP' AND NVL(ps.AMOUNT_DUE_REMAINING, 0) <> 0 AND NVL(a.ACCOUNT_NUMBER, '-') = " + Lit(party) + w.Replace("{ORG}", "ps.ORG_ID") + " ORDER BY ps.DUE_DATE",
                "AP" => "SELECT i.INVOICE_NUM, i.INVOICE_TYPE_LOOKUP_CODE AS INVOICE_TYPE, TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD') AS INVOICE_DATE, TO_CHAR(ps.DUE_DATE, 'YYYY-MM-DD') AS DUE_DATE, TRUNC(SYSDATE) - TRUNC(ps.DUE_DATE) AS DAYS_LATE, " +
                        "i.INVOICE_CURRENCY_CODE AS CURRENCY, ps.GROSS_AMOUNT AS ORIGINAL, ps.AMOUNT_REMAINING AS REMAINING, ps.AMOUNT_REMAINING * NVL(i.EXCHANGE_RATE, 1) AS REMAINING_LEDGER, ps.HOLD_FLAG " +
                        "FROM AP_PAYMENT_SCHEDULES_ALL ps JOIN AP_INVOICES_ALL i ON i.INVOICE_ID = ps.INVOICE_ID LEFT JOIN POZ_SUPPLIERS s ON s.VENDOR_ID = i.VENDOR_ID " +
                        "WHERE i.CANCELLED_DATE IS NULL AND NVL(ps.AMOUNT_REMAINING, 0) <> 0 AND NVL(s.SEGMENT1, '-') = " + Lit(party) + w.Replace("{ORG}", "i.ORG_ID") + " ORDER BY ps.DUE_DATE",
                "INV" => "SELECT TO_CHAR(q.ORGANIZATION_ID) AS ORG_ID, q.SUBINVENTORY_CODE AS SUBINVENTORY, q.LOT_NUMBER, NVL(q.TRANSACTION_QUANTITY, 0) AS QUANTITY, TO_CHAR(q.DATE_RECEIVED, 'YYYY-MM-DD') AS DATE_RECEIVED, " +
                        "TRUNC(SYSDATE) - TRUNC(q.DATE_RECEIVED) AS AGE_DAYS FROM INV_ONHAND_QUANTITIES_DETAIL q JOIN EGP_SYSTEM_ITEMS_B i ON i.INVENTORY_ITEM_ID = q.INVENTORY_ITEM_ID AND i.ORGANIZATION_ID = q.ORGANIZATION_ID " +
                        "WHERE i.ITEM_NUMBER = " + Lit(party) + w.Replace("{ORG}", "q.ORGANIZATION_ID") + " ORDER BY q.DATE_RECEIVED",
                _ => null
            };
            if (sql == null) return new { ok = false, error = "kind is AR, AP or INV" };
            var sw = Stopwatch.StartNew();
            var r = await run(sql, 500, ct).ConfigureAwait(false);
            if (r == null || !r.Success) return new { ok = false, error = r?.Error ?? "cancelled", sql };
            var cols = r.Columns.Count > 0 ? r.Columns : r.Rows.SelectMany(x => x.Keys).Distinct().ToList();
            return new { ok = true, columns = cols, rows = r.Rows.Select(x => cols.Select(c => Get(x, c)).ToArray()).ToList(), ms = sw.ElapsedMilliseconds, capped = r.Capped, sql };
        }

        /// <summary>Candidate unit-cost tables: CST% tables with an item id and a cost column (from ALL_TAB_COLUMNS)</summary>
        public static async Task<object> CostTablesAsync(FinanceFusion.Runner run, CancellationToken ct)
        {
            const string sql = "SELECT table_name, column_name FROM all_tab_columns WHERE table_name LIKE 'CST%' AND column_name IN ('INVENTORY_ITEM_ID', 'ITEM_ID', 'ORGANIZATION_ID', 'INV_ORG_ID', 'INVENTORY_ORG_ID', 'COST_ORG_ID', " +
                               "'UNIT_COST', 'ITEM_COST', 'AVERAGE_COST', 'PERPETUAL_AVG_COST', 'STANDARD_COST', 'TOTAL_COST', 'COST', 'UNIT_COST_AMOUNT', 'UNIT_COST_AVERAGE', 'AVERAGE_UNIT_COST', 'UNIT_COST_AVG', 'STD_COST')";
            var r = await run(sql, 5000, ct).ConfigureAwait(false);
            if (r == null || !r.Success) return new { ok = false, error = r?.Error ?? "cancelled" };
            var byTable = r.Rows.GroupBy(x => S(Get(x, "TABLE_NAME"))).Where(g => g.Key != null);
            string[] itemC = { "INVENTORY_ITEM_ID", "ITEM_ID" }, orgC = { "ORGANIZATION_ID", "INV_ORG_ID", "INVENTORY_ORG_ID", "COST_ORG_ID" }, costC = { "UNIT_COST_AVERAGE", "UNIT_COST", "PERPETUAL_AVG_COST", "AVERAGE_UNIT_COST", "UNIT_COST_AVG", "AVERAGE_COST", "ITEM_COST", "STANDARD_COST", "STD_COST", "UNIT_COST_AMOUNT", "TOTAL_COST", "COST" };
            var list = new List<object>();
            foreach (var g in byTable)
            {
                var cols = g.Select(x => S(Get(x, "COLUMN_NAME"))).Where(x => x != null).Distinct().ToList();
                string item = itemC.FirstOrDefault(cols.Contains), cost = costC.FirstOrDefault(cols.Contains), org = orgC.FirstOrDefault(cols.Contains);
                if (item == null || cost == null) continue;
                list.Add(new { table = g.Key, itemCol = item, orgCol = org, costCol = cost, columns = cols, invOrg = org == "ORGANIZATION_ID" || org == "INV_ORG_ID" || org == "INVENTORY_ORG_ID" });
            }
            // tables that map inventory organisations to cost organisations (for cost tables keyed by COST_ORG_ID)
            var maps = byTable.Select(g => (T: g.Key, C: g.Select(x => S(Get(x, "COLUMN_NAME"))).ToList()))
                .Where(t => t.C.Contains("COST_ORG_ID") && t.C.Any(c => c == "INV_ORG_ID" || c == "INVENTORY_ORG_ID" || c == "ORGANIZATION_ID"))
                .Select(t => new { table = t.T, invCol = new[] { "INV_ORG_ID", "INVENTORY_ORG_ID", "ORGANIZATION_ID" }.First(t.C.Contains), costCol = "COST_ORG_ID", hasItem = t.C.Contains("INVENTORY_ITEM_ID") })
                .OrderBy(m => m.hasItem).ThenBy(m => m.table.Contains("INV_ORG") ? 0 : 1).ToList();
            // most likely first: perpetual average / item cost tables, then standard costs
            int Rank(string t) => t.Contains("PERPAVG") ? 0 : t.Contains("AVG") ? 1 : t.Contains("ITEM_COST") ? 2 : t.Contains("STD") ? 3 : 5;
            return new { ok = true, tables = list.OrderBy(t => Rank((string)t.GetType().GetProperty("table").GetValue(t))).ToList(), maps };
        }

        /// <summary>
        /// Names of business units or inventory organisations. Every source is asked for the ids still without a name, so one that
        /// is not readable (or secured to 0 rows for the runner's user) does not stop the others:
        /// BU  = FUN_ALL_BUSINESS_UNITS_V, HR_OPERATING_UNITS, HR_ALL_ORGANIZATION_UNITS_F_VL, HR_ORGANIZATION_UNITS_F_TL;
        /// ORG = INV_ORGANIZATION_DEFINITIONS_V, HR_ALL_ORGANIZATION_UNITS_F_VL, HR_ORGANIZATION_UNITS_F_TL.
        /// The log says what each source returned (shown on the page when names stay missing).
        /// </summary>
        public static async Task<(Dictionary<string, string> Names, List<string> Log)> NamesAsync(FinanceFusion.Runner run, string kind, List<string> ids, CancellationToken ct)
        {
            var d = new Dictionary<string, string>(StringComparer.Ordinal);
            var log = new List<string>();
            ids = ids.Where(v => Regex.IsMatch(v ?? "", "^[0-9]{1,20}$")).Distinct().ToList();
            if (ids.Count == 0) return (d, log);
            var sources = kind == "BU"
                ? new[] { ("FUN_ALL_BUSINESS_UNITS_V", "SELECT BU_ID AS ID, BU_NAME AS NAME FROM FUN_ALL_BUSINESS_UNITS_V WHERE BU_ID IN ({IDS})"),
                          ("HR_OPERATING_UNITS", "SELECT ORGANIZATION_ID AS ID, NAME FROM HR_OPERATING_UNITS WHERE ORGANIZATION_ID IN ({IDS})"),
                          ("HR_ALL_ORGANIZATION_UNITS_F_VL", "SELECT ORGANIZATION_ID AS ID, NAME FROM HR_ALL_ORGANIZATION_UNITS_F_VL WHERE ORGANIZATION_ID IN ({IDS})"),
                          ("HR_ORGANIZATION_UNITS_F_TL", "SELECT ORGANIZATION_ID AS ID, NAME FROM HR_ORGANIZATION_UNITS_F_TL WHERE LANGUAGE = 'US' AND ORGANIZATION_ID IN ({IDS})") }
                : new[] { ("INV_ORGANIZATION_DEFINITIONS_V", "SELECT ORGANIZATION_ID AS ID, ORGANIZATION_NAME AS NAME FROM INV_ORGANIZATION_DEFINITIONS_V WHERE ORGANIZATION_ID IN ({IDS})"),
                          ("HR_ALL_ORGANIZATION_UNITS_F_VL", "SELECT ORGANIZATION_ID AS ID, NAME FROM HR_ALL_ORGANIZATION_UNITS_F_VL WHERE ORGANIZATION_ID IN ({IDS})"),
                          ("HR_ORGANIZATION_UNITS_F_TL", "SELECT ORGANIZATION_ID AS ID, NAME FROM HR_ORGANIZATION_UNITS_F_TL WHERE LANGUAGE = 'US' AND ORGANIZATION_ID IN ({IDS})") };
            foreach (var (src, tpl) in sources)
            {
                var todo = ids.Where(v => !d.ContainsKey(v)).ToList();
                if (todo.Count == 0) break;
                int got = 0; string err = null;
                foreach (var chunk in todo.Chunk(500))
                {
                    var r = await run(tpl.Replace("{IDS}", string.Join(",", chunk)), 5000, ct).ConfigureAwait(false);
                    if (r == null || !r.Success) { err = r?.Error ?? "cancelled"; break; }
                    foreach (var row in r.Rows) { var id = S(Get(row, "ID")); var nm = S(Get(row, "NAME")); if (id != null && !string.IsNullOrEmpty(nm) && !d.ContainsKey(id)) { d[id] = nm; got++; } }
                }
                log.Add(src + ": " + (err != null ? "not readable — " + (err.Length > 140 ? err.Substring(0, 140) + "…" : err) : got + " of " + todo.Count + " named" + (got == 0 ? " (no rows — the view may be secured for the report user)" : "")));
            }
            return (d, log);
        }

        /// <summary>Names of every business unit / organisation in the kept snapshots that has none yet.</summary>
        public static async Task<object> NamesSyncAsync(FinanceFusion.Runner run, string pod, CancellationToken ct)
        {
            int n = 0; var log = new List<string>(); var missing = new Dictionary<string, List<string>>();
            foreach (var (kind, sql) in new[] { ("BU", "SELECT DISTINCT bu_id FROM fin_wc_parties WHERE pod = " + Lit(pod ?? "")), ("ORG", "SELECT DISTINCT org_id FROM fin_wc_stock WHERE pod = " + Lit(pod ?? "")) })
            {
                var q = FinanceLens.Query(sql, 100000);
                if (q.Error != null) continue;
                var known = FinanceLens.WcNames(pod, kind);
                var todo = q.Rows.Select(z => Convert.ToString(z[0], CultureInfo.InvariantCulture)).Where(v => v != null && !known.ContainsKey(v)).ToList();
                if (todo.Count == 0) continue;
                var (nm, lg) = await NamesAsync(run, kind, todo, ct).ConfigureAwait(false);
                log.AddRange(lg.Select(l => (kind == "BU" ? "Business units · " : "Organisations · ") + l));
                if (nm.Count > 0) { FinanceLens.SaveWcNames(pod, kind, nm); n += nm.Count; }
                missing[kind] = todo.Where(v => !nm.ContainsKey(v)).ToList();
            }
            return new { ok = true, named = n, log, missing };
        }

        /// <summary>Names typed on the page (when Fusion has none for the report user) — kept like the ones read from Fusion.</summary>
        public static object NamesSave(string pod, string kind, Dictionary<string, string> names)
        {
            if (kind != "BU" && kind != "ORG") return new { ok = false, error = "kind is BU or ORG" };
            var clean = (names ?? new()).Where(kv => Regex.IsMatch(kv.Key ?? "", "^[0-9]{1,20}$") && !string.IsNullOrWhiteSpace(kv.Value))
                                        .ToDictionary(kv => kv.Key, kv => kv.Value.Trim().Length > 200 ? kv.Value.Trim().Substring(0, 200) : kv.Value.Trim());
            FinanceLens.SaveWcNames(pod, kind, clean);
            return new { ok = true, saved = clean.Count };
        }

        // ═════ item master (EGP_SYSTEM_ITEMS_B with its descriptive flexfield) — synced on its own, joined to the stock on this PC ═════
        public sealed class ItemOptions
        {
            public string Pod { get; set; }
            /// <summary>Inventory organisation ids; empty = the organisations of the latest stock snapshot.</summary>
            public List<string> Orgs { get; set; } = new();
            public int PageSize { get; set; } = 5000;
        }
        private static readonly string[] ITEM_BASE = { "INVENTORY_ITEM_ID", "ORGANIZATION_ID", "ITEM_NUMBER", "PRIMARY_UOM_CODE", "ITEM_TYPE", "INVENTORY_ITEM_STATUS_CODE", "LIST_PRICE_PER_UNIT", "ATTRIBUTE_CATEGORY" };
        public static bool IsDffCol(string c) => Regex.IsMatch(c ?? "", "^ATTRIBUTE([1-9]|[12][0-9]|30)$|^ATTRIBUTE_NUMBER([1-9]|10)$|^ATTRIBUTE_DATE([1-5])$", RegexOptions.IgnoreCase);

        private static async Task<HashSet<string>> ColumnsAsync(FinanceFusion.Runner run, string table, CancellationToken ct)
        {
            var r = await run("SELECT column_name FROM all_tab_columns WHERE table_name = " + Lit(table), 2000, ct).ConfigureAwait(false);
            return new HashSet<string>(r != null && r.Success ? r.Rows.Select(x => S(Get(x, "COLUMN_NAME"))).Where(v => v != null) : Enumerable.Empty<string>(), StringComparer.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Reads the item master of some inventory organisations — item number, description, UOM, item type, status, list price and every
        /// descriptive-flexfield column the pod has (ATTRIBUTE_CATEGORY, ATTRIBUTE1..30, ATTRIBUTE_NUMBER1..10, ATTRIBUTE_DATE1..5) — one
        /// organisation at a time in keyset pages on INVENTORY_ITEM_ID, into DuckDB fin_items (replaced per organisation).
        /// </summary>
        public static async Task<object> ItemsAsync(FinanceFusion.Runner run, ItemOptions o, Action<string> progress, CancellationToken ct)
        {
            var sw = Stopwatch.StartNew();
            var orgs = (o.Orgs ?? new()).Where(v => Regex.IsMatch(v ?? "", "^[0-9]{1,20}$")).Distinct().ToList();
            if (orgs.Count == 0)
            {
                var q = FinanceLens.Query("SELECT DISTINCT org_id FROM fin_wc_stock WHERE pod = " + Lit(o.Pod ?? "") + " AND snapshot_at = (SELECT MAX(snapshot_at) FROM fin_wc_stock WHERE pod = " + Lit(o.Pod ?? "") + ")", 10000);
                if (q.Error == null) orgs = q.Rows.Select(z => Convert.ToString(z[0], CultureInfo.InvariantCulture)).Where(v => v != null && Regex.IsMatch(v, "^[0-9]{1,20}$")).ToList();
            }
            if (orgs.Count == 0) return new { ok = false, error = "No inventory organisations: sync the stock on hand first (Sync from Fusion), or name the organisations in Settings." };
            var have = await ColumnsAsync(run, "EGP_SYSTEM_ITEMS_B", ct).ConfigureAwait(false);
            if (have.Count == 0) return new { ok = false, error = "EGP_SYSTEM_ITEMS_B is not readable on this pod (ALL_TAB_COLUMNS returned nothing)." };
            var cols = ITEM_BASE.Where(have.Contains).Concat(have.Where(IsDffCol).OrderBy(c => c.Length).ThenBy(c => c, StringComparer.Ordinal)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            bool tl = (await ColumnsAsync(run, "EGP_SYSTEM_ITEMS_TL", ct).ConfigureAwait(false)).Contains("DESCRIPTION");
            int page = Math.Clamp(o.PageSize, 500, 20000);
            progress?.Invoke("📦 Item master: " + orgs.Count + " organisation(s) · " + cols.Count(IsDffCol) + " flexfield column(s) · pages of " + page.ToString("N0", CultureInfo.InvariantCulture));
            long total = 0; int reads = 0;
            var failed = new List<object>(); var done = new List<string>();
            foreach (var org in orgs)
            {
                ct.ThrowIfCancellationRequested();
                var rows = new List<Dictionary<string, object>>();
                long last = -1; var t0 = Stopwatch.StartNew();
                int pg = page; bool withTl = tl; string orgErr = null;
                while (true)
                {
                    string inner = "SELECT " + string.Join(", ", cols.Select(c => "i." + c)) +
                                   (withTl ? ", (SELECT t.DESCRIPTION FROM EGP_SYSTEM_ITEMS_TL t WHERE t.INVENTORY_ITEM_ID = i.INVENTORY_ITEM_ID AND t.ORGANIZATION_ID = i.ORGANIZATION_ID AND t.LANGUAGE = USERENV('LANG')) AS DESCRIPTION" : "") +
                                   " FROM EGP_SYSTEM_ITEMS_B i WHERE i.ORGANIZATION_ID = " + org + " AND i.INVENTORY_ITEM_ID > " + last.ToString(CultureInfo.InvariantCulture) + " ORDER BY i.INVENTORY_ITEM_ID";
                    string sql = "SELECT * FROM (" + inner + ") WHERE ROWNUM <= " + pg;
                    string id = "it_" + Guid.NewGuid().ToString("N").Substring(0, 6);
                    progress?.Invoke("\u0001" + JsonSerializer.Serialize(new { t = "sql", id, what = "Items · org " + org + " · from item " + (rows.Count + 1), sql }));
                    var ts = Stopwatch.StartNew();
                    var r = await run(sql, pg + 1, ct).ConfigureAwait(false);
                    reads++;
                    progress?.Invoke("\u0001" + JsonSerializer.Serialize(new { t = "end", id, ok = r != null && r.Success, rows = r?.Rows?.Count ?? 0, ms = ts.ElapsedMilliseconds, error = r?.Success == true ? null : r?.Error }));
                    if (r == null) throw new OperationCanceledException();
                    if (!r.Success)
                    {   // a slow page: ask again smaller, then without the description lookup, else give up on this organisation only
                        if (pg > 500) { pg = Math.Max(500, pg / 2); progress?.Invoke("   ⚠ org " + org + ": " + Short(r.Error) + " — again with " + pg + " rows per page"); continue; }
                        if (withTl) { withTl = false; progress?.Invoke("   ⚠ org " + org + ": " + Short(r.Error) + " — again without the item descriptions"); continue; }
                        orgErr = r.Error; break;
                    }
                    rows.AddRange(r.Rows);
                    if (r.Rows.Count < pg) break;
                    var lastId = r.Rows.Select(z => long.TryParse(S(Get(z, "INVENTORY_ITEM_ID")), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : -1).Max();
                    if (lastId <= last) break;
                    last = lastId;
                }
                if (orgErr != null) { failed.Add(new { org, error = Short(orgErr) }); progress?.Invoke("✖ organisation " + org + ": " + Short(orgErr) + " — skipped, the others go on"); continue; }
                FinanceLens.SaveItems(o.Pod, org, rows);
                total += rows.Count; done.Add(org);
                progress?.Invoke("✔ organisation " + org + ": " + rows.Count.ToString("N0", CultureInfo.InvariantCulture) + " items in " + (t0.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s");
            }
            return new { ok = done.Count > 0 || orgs.Count == 0, error = done.Count == 0 && failed.Count > 0 ? "No organisation could be read: " + JsonSerializer.Serialize(failed) : null,
                         orgs = done, failed, items = total, reads, flexColumns = cols.Where(IsDffCol).ToList(), ms = sw.ElapsedMilliseconds };
        }

        /// <summary>
        /// Labels of the item descriptive flexfield: FND_DF_SEGMENTS_VL (segment name per context and column) for the flexfields used on
        /// EGP_SYSTEM_ITEMS_B (FND_DF_TABLE_USAGES when the pod has it, else codes that look like the item flexfield) → fin_item_dff.
        /// </summary>
        public static async Task<object> ItemDffAsync(FinanceFusion.Runner run, string pod, CancellationToken ct)
        {
            var seg = await ColumnsAsync(run, "FND_DF_SEGMENTS_VL", ct).ConfigureAwait(false);
            if (!seg.Contains("COLUMN_NAME") || !seg.Contains("DESCRIPTIVE_FLEXFIELD_CODE")) return new { ok = false, error = "FND_DF_SEGMENTS_VL is not readable on this pod — name the flexfield columns yourself (Item DFF › your label)." };
            var use = await ColumnsAsync(run, "FND_DF_TABLE_USAGES", ct).ConfigureAwait(false);
            string nameCol = seg.Contains("NAME") ? "NAME" : seg.Contains("SEGMENT_NAME") ? "SEGMENT_NAME" : "SEGMENT_CODE";
            string ctxCol = seg.Contains("CONTEXT_CODE") ? "CONTEXT_CODE" : "NULL";
            string where = use.Contains("TABLE_NAME") && use.Contains("DESCRIPTIVE_FLEXFIELD_CODE")
                ? "s.DESCRIPTIVE_FLEXFIELD_CODE IN (SELECT u.DESCRIPTIVE_FLEXFIELD_CODE FROM FND_DF_TABLE_USAGES u WHERE u.TABLE_NAME = 'EGP_SYSTEM_ITEMS_B')"
                : "(s.DESCRIPTIVE_FLEXFIELD_CODE LIKE 'EGP%ITEM%' OR s.DESCRIPTIVE_FLEXFIELD_CODE LIKE 'EGO%ITEM%')";
            string sql = "SELECT s.DESCRIPTIVE_FLEXFIELD_CODE AS FLEX, " + (ctxCol == "NULL" ? "NULL" : "s." + ctxCol) + " AS CTX, s.COLUMN_NAME AS COL, s." + nameCol + " AS LABEL FROM FND_DF_SEGMENTS_VL s WHERE " + where;
            var r = await run(sql, 5000, ct).ConfigureAwait(false);
            if (r == null || !r.Success) return new { ok = false, error = r?.Error ?? "cancelled", sql };
            var list = r.Rows.Select(z => (Flex: S(Get(z, "FLEX")), Ctx: S(Get(z, "CTX")), Col: S(Get(z, "COL")), Label: S(Get(z, "LABEL")))).Where(z => IsDffCol(z.Col)).ToList();
            FinanceLens.SaveItemDff(pod, list);
            return new { ok = true, labels = list.Select(z => new { flex = z.Flex, context = z.Ctx, column = z.Col, label = z.Label }), sql };
        }
    }
}

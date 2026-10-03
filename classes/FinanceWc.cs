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
        public sealed class CostSource { public string Table { get; set; } public string ItemCol { get; set; } public string OrgCol { get; set; } public string CostCol { get; set; } }
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
                foreach (var id in new[] { c.Table, c.ItemCol, c.CostCol }.Concat(string.IsNullOrWhiteSpace(c.OrgCol) ? Array.Empty<string>() : new[] { c.OrgCol }))
                    if (!IDENT.IsMatch(id ?? "")) throw new ArgumentException("The cost source must be plain table / column names.");
                cost = "(SELECT MAX(cs." + c.CostCol + ") FROM " + c.Table + " cs WHERE cs." + c.ItemCol + " = i.INVENTORY_ITEM_ID" + (string.IsNullOrWhiteSpace(c.OrgCol) ? "" : " AND cs." + c.OrgCol + " = q.ORGANIZATION_ID") + ")";
            }
            return sql.Replace("{UNIT_COST}", cost);
        }

        private static object Get(Dictionary<string, object> row, string col)
        {
            if (row.TryGetValue(col, out var v)) return v;
            foreach (var kv in row) if (string.Equals(kv.Key, col, StringComparison.OrdinalIgnoreCase)) return kv.Value;
            return null;
        }
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
                               "'UNIT_COST', 'ITEM_COST', 'AVERAGE_COST', 'PERPETUAL_AVG_COST', 'STANDARD_COST', 'TOTAL_COST', 'COST', 'UNIT_COST_AMOUNT')";
            var r = await run(sql, 5000, ct).ConfigureAwait(false);
            if (r == null || !r.Success) return new { ok = false, error = r?.Error ?? "cancelled" };
            var byTable = r.Rows.GroupBy(x => S(Get(x, "TABLE_NAME"))).Where(g => g.Key != null);
            string[] itemC = { "INVENTORY_ITEM_ID", "ITEM_ID" }, orgC = { "ORGANIZATION_ID", "INV_ORG_ID", "INVENTORY_ORG_ID", "COST_ORG_ID" }, costC = { "UNIT_COST", "PERPETUAL_AVG_COST", "AVERAGE_COST", "ITEM_COST", "STANDARD_COST", "UNIT_COST_AMOUNT", "TOTAL_COST", "COST" };
            var list = new List<object>();
            foreach (var g in byTable)
            {
                var cols = g.Select(x => S(Get(x, "COLUMN_NAME"))).Where(x => x != null).Distinct().ToList();
                string item = itemC.FirstOrDefault(cols.Contains), cost = costC.FirstOrDefault(cols.Contains), org = orgC.FirstOrDefault(cols.Contains);
                if (item == null || cost == null) continue;
                list.Add(new { table = g.Key, itemCol = item, orgCol = org, costCol = cost, columns = cols, invOrg = org == "ORGANIZATION_ID" || org == "INV_ORG_ID" || org == "INVENTORY_ORG_ID" });
            }
            return new { ok = true, tables = list };
        }
    }
}

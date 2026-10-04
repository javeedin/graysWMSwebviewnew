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

        // ═════ customer / supplier history (the drill from Debtors / Creditors) ═════
        // Each section is tried with its SQL alternatives in order (a column a pod does not have → the next, simpler one); the
        // result is kept in DuckDB fin_wc_history, so opening the same party again reads this PC unless Refresh is pressed.
        private static readonly Dictionary<string, (string Title, string[] Sql)[]> HISTORY = new()
        {
            ["AR"] = new (string, string[])[]
            {
                ("profile", new[] {
                    "SELECT a.ACCOUNT_NUMBER, p.PARTY_NAME, p.PARTY_NUMBER, a.ACCOUNT_NAME, a.CUSTOMER_CLASS_CODE AS CUSTOMER_CLASS, a.CUSTOMER_TYPE, a.STATUS, TO_CHAR(a.ACCOUNT_ESTABLISHED_DATE, 'YYYY-MM-DD') AS ESTABLISHED, p.EMAIL_ADDRESS, p.PRIMARY_PHONE_NUMBER AS PHONE, p.TAX_REFERENCE FROM HZ_CUST_ACCOUNTS a JOIN HZ_PARTIES p ON p.PARTY_ID = a.PARTY_ID WHERE a.CUST_ACCOUNT_ID IN ({ID})",
                    "SELECT a.ACCOUNT_NUMBER, p.PARTY_NAME FROM HZ_CUST_ACCOUNTS a JOIN HZ_PARTIES p ON p.PARTY_ID = a.PARTY_ID WHERE a.CUST_ACCOUNT_ID IN ({ID})" }),
                ("address", new[] {
                    "SELECT l.ADDRESS1, l.ADDRESS2, l.ADDRESS3, l.CITY, l.STATE, l.POSTAL_CODE, l.COUNTRY, ps.IDENTIFYING_ADDRESS_FLAG AS MAIN FROM HZ_PARTY_SITES ps JOIN HZ_LOCATIONS l ON l.LOCATION_ID = ps.LOCATION_ID WHERE ps.PARTY_ID IN ({PID})",
                    "SELECT l.ADDRESS1, l.CITY, l.COUNTRY FROM HZ_PARTY_SITES ps JOIN HZ_LOCATIONS l ON l.LOCATION_ID = ps.LOCATION_ID WHERE ps.PARTY_ID IN ({PID})" }),
                ("credit", new[] {
                    "SELECT pa.CURRENCY_CODE AS CURRENCY, pa.OVERALL_CREDIT_LIMIT AS CREDIT_LIMIT, pa.TRX_CREDIT_LIMIT FROM HZ_CUST_PROFILE_AMTS pa WHERE pa.CUST_ACCOUNT_ID IN ({ID})",
                    "SELECT pa.CURRENCY_CODE AS CURRENCY, pa.OVERALL_CREDIT_LIMIT AS CREDIT_LIMIT FROM HZ_CUST_PROFILE_AMTS pa WHERE pa.CUST_ACCOUNT_ID IN ({ID})" }),
                ("invoices", TrxSql("ps.CLASS IN ('INV', 'DM', 'CB', 'DEP')")),
                ("creditnotes", TrxSql("ps.CLASS = 'CM'")),
                ("payments", new[] {
                    "SELECT cr.RECEIPT_NUMBER, TO_CHAR(cr.RECEIPT_DATE, 'YYYY-MM-DD') AS RECEIPT_DATE, cr.CURRENCY_CODE AS CURRENCY, cr.AMOUNT, cr.STATUS, cr.TYPE, (SELECT -SUM(ps.AMOUNT_DUE_REMAINING) FROM AR_PAYMENT_SCHEDULES_ALL ps WHERE ps.CASH_RECEIPT_ID = cr.CASH_RECEIPT_ID) AS UNAPPLIED, cr.COMMENTS FROM AR_CASH_RECEIPTS_ALL cr WHERE cr.PAY_FROM_CUSTOMER IN ({ID}) AND cr.RECEIPT_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY cr.RECEIPT_DATE DESC",
                    "SELECT cr.RECEIPT_NUMBER, TO_CHAR(cr.RECEIPT_DATE, 'YYYY-MM-DD') AS RECEIPT_DATE, cr.CURRENCY_CODE AS CURRENCY, cr.AMOUNT, cr.STATUS FROM AR_CASH_RECEIPTS_ALL cr WHERE cr.PAY_FROM_CUSTOMER IN ({ID}) AND cr.RECEIPT_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY cr.RECEIPT_DATE DESC",
                    "SELECT ps.TRX_NUMBER AS RECEIPT_NUMBER, TO_CHAR(ps.TRX_DATE, 'YYYY-MM-DD') AS RECEIPT_DATE, ps.INVOICE_CURRENCY_CODE AS CURRENCY, -ps.AMOUNT_DUE_ORIGINAL AS AMOUNT, ps.STATUS, -ps.AMOUNT_DUE_REMAINING AS UNAPPLIED FROM AR_PAYMENT_SCHEDULES_ALL ps WHERE ps.CUSTOMER_ID IN ({ID}) AND ps.CLASS = 'PMT' AND ps.TRX_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY ps.TRX_DATE DESC" }),
                ("applications", new[] {
                    "SELECT cr.RECEIPT_NUMBER, TO_CHAR(ra.APPLY_DATE, 'YYYY-MM-DD') AS APPLY_DATE, ps.TRX_NUMBER, ps.CLASS, TO_CHAR(ps.TRX_DATE, 'YYYY-MM-DD') AS TRX_DATE, TO_CHAR(ps.DUE_DATE, 'YYYY-MM-DD') AS DUE_DATE, ra.AMOUNT_APPLIED, TRUNC(ra.APPLY_DATE) - TRUNC(ps.TRX_DATE) AS DAYS_TO_PAY, TRUNC(ra.APPLY_DATE) - TRUNC(ps.DUE_DATE) AS DAYS_LATE, ra.APPLICATION_TYPE FROM AR_RECEIVABLE_APPLICATIONS_ALL ra JOIN AR_PAYMENT_SCHEDULES_ALL ps ON ps.PAYMENT_SCHEDULE_ID = ra.APPLIED_PAYMENT_SCHEDULE_ID LEFT JOIN AR_CASH_RECEIPTS_ALL cr ON cr.CASH_RECEIPT_ID = ra.CASH_RECEIPT_ID WHERE ps.CUSTOMER_ID IN ({ID}) AND ra.STATUS = 'APP' AND ra.APPLY_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY ra.APPLY_DATE DESC",
                    "SELECT TO_CHAR(ra.APPLY_DATE, 'YYYY-MM-DD') AS APPLY_DATE, ps.TRX_NUMBER, TO_CHAR(ps.TRX_DATE, 'YYYY-MM-DD') AS TRX_DATE, TO_CHAR(ps.DUE_DATE, 'YYYY-MM-DD') AS DUE_DATE, ra.AMOUNT_APPLIED, TRUNC(ra.APPLY_DATE) - TRUNC(ps.TRX_DATE) AS DAYS_TO_PAY, TRUNC(ra.APPLY_DATE) - TRUNC(ps.DUE_DATE) AS DAYS_LATE FROM AR_RECEIVABLE_APPLICATIONS_ALL ra JOIN AR_PAYMENT_SCHEDULES_ALL ps ON ps.PAYMENT_SCHEDULE_ID = ra.APPLIED_PAYMENT_SCHEDULE_ID WHERE ps.CUSTOMER_ID IN ({ID}) AND ra.STATUS = 'APP' AND ra.APPLY_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY ra.APPLY_DATE DESC" }),
                ("adjustments", new[] {
                    "SELECT adj.ADJUSTMENT_NUMBER, TO_CHAR(adj.APPLY_DATE, 'YYYY-MM-DD') AS APPLY_DATE, ps.TRX_NUMBER, adj.AMOUNT, adj.TYPE, adj.REASON_CODE, adj.STATUS FROM AR_ADJUSTMENTS_ALL adj JOIN AR_PAYMENT_SCHEDULES_ALL ps ON ps.PAYMENT_SCHEDULE_ID = adj.PAYMENT_SCHEDULE_ID WHERE ps.CUSTOMER_ID IN ({ID}) AND adj.APPLY_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY adj.APPLY_DATE DESC",
                    "SELECT TO_CHAR(adj.APPLY_DATE, 'YYYY-MM-DD') AS APPLY_DATE, ps.TRX_NUMBER, adj.AMOUNT FROM AR_ADJUSTMENTS_ALL adj JOIN AR_PAYMENT_SCHEDULES_ALL ps ON ps.PAYMENT_SCHEDULE_ID = adj.PAYMENT_SCHEDULE_ID WHERE ps.CUSTOMER_ID IN ({ID}) AND adj.APPLY_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY adj.APPLY_DATE DESC" })
            },
            ["AP"] = new (string, string[])[]
            {
                ("profile", new[] {
                    "SELECT s.SEGMENT1 AS SUPPLIER_NUMBER, p.PARTY_NAME, p.PARTY_NUMBER, s.VENDOR_TYPE_LOOKUP_CODE AS SUPPLIER_TYPE, TO_CHAR(s.START_DATE_ACTIVE, 'YYYY-MM-DD') AS ESTABLISHED, TO_CHAR(s.END_DATE_ACTIVE, 'YYYY-MM-DD') AS END_DATE, s.ENABLED_FLAG, p.EMAIL_ADDRESS, p.PRIMARY_PHONE_NUMBER AS PHONE, p.TAX_REFERENCE FROM POZ_SUPPLIERS s JOIN HZ_PARTIES p ON p.PARTY_ID = s.PARTY_ID WHERE s.VENDOR_ID IN ({ID})",
                    "SELECT s.SEGMENT1 AS SUPPLIER_NUMBER, p.PARTY_NAME FROM POZ_SUPPLIERS s JOIN HZ_PARTIES p ON p.PARTY_ID = s.PARTY_ID WHERE s.VENDOR_ID IN ({ID})" }),
                ("address", new[] {
                    "SELECT ss.VENDOR_SITE_CODE AS SITE, l.ADDRESS1, l.ADDRESS2, l.CITY, l.STATE, l.POSTAL_CODE, l.COUNTRY FROM POZ_SUPPLIER_SITES_ALL_M ss LEFT JOIN HZ_LOCATIONS l ON l.LOCATION_ID = ss.LOCATION_ID WHERE ss.VENDOR_ID IN ({ID})",
                    "SELECT l.ADDRESS1, l.CITY, l.COUNTRY, ps.IDENTIFYING_ADDRESS_FLAG AS MAIN FROM HZ_PARTY_SITES ps JOIN HZ_LOCATIONS l ON l.LOCATION_ID = ps.LOCATION_ID WHERE ps.PARTY_ID IN ({PID})" }),
                ("invoices", ApInvSql("NOT IN ('CREDIT', 'DEBIT')")),
                ("creditnotes", ApInvSql("IN ('CREDIT', 'DEBIT')")),
                ("payments", new[] {
                    "SELECT c.CHECK_NUMBER AS PAYMENT_NUMBER, TO_CHAR(c.CHECK_DATE, 'YYYY-MM-DD') AS PAYMENT_DATE, c.CURRENCY_CODE AS CURRENCY, c.AMOUNT, c.STATUS_LOOKUP_CODE AS STATUS, c.PAYMENT_METHOD_CODE AS METHOD, c.BANK_ACCOUNT_NAME AS BANK FROM AP_CHECKS_ALL c WHERE c.VENDOR_ID IN ({ID}) AND c.CHECK_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY c.CHECK_DATE DESC",
                    "SELECT c.CHECK_NUMBER AS PAYMENT_NUMBER, TO_CHAR(c.CHECK_DATE, 'YYYY-MM-DD') AS PAYMENT_DATE, c.CURRENCY_CODE AS CURRENCY, c.AMOUNT, c.STATUS_LOOKUP_CODE AS STATUS FROM AP_CHECKS_ALL c WHERE c.VENDOR_ID IN ({ID}) AND c.CHECK_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY c.CHECK_DATE DESC" }),
                ("applications", new[] {
                    "SELECT c.CHECK_NUMBER AS PAYMENT_NUMBER, TO_CHAR(c.CHECK_DATE, 'YYYY-MM-DD') AS APPLY_DATE, i.INVOICE_NUM AS TRX_NUMBER, TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD') AS TRX_DATE, (SELECT TO_CHAR(MIN(ps.DUE_DATE), 'YYYY-MM-DD') FROM AP_PAYMENT_SCHEDULES_ALL ps WHERE ps.INVOICE_ID = i.INVOICE_ID) AS DUE_DATE, ip.AMOUNT AS AMOUNT_APPLIED, TRUNC(c.CHECK_DATE) - TRUNC(i.INVOICE_DATE) AS DAYS_TO_PAY FROM AP_INVOICE_PAYMENTS_ALL ip JOIN AP_INVOICES_ALL i ON i.INVOICE_ID = ip.INVOICE_ID JOIN AP_CHECKS_ALL c ON c.CHECK_ID = ip.CHECK_ID WHERE i.VENDOR_ID IN ({ID}) AND c.CHECK_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY c.CHECK_DATE DESC",
                    "SELECT c.CHECK_NUMBER AS PAYMENT_NUMBER, TO_CHAR(c.CHECK_DATE, 'YYYY-MM-DD') AS APPLY_DATE, i.INVOICE_NUM AS TRX_NUMBER, TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD') AS TRX_DATE, ip.AMOUNT AS AMOUNT_APPLIED, TRUNC(c.CHECK_DATE) - TRUNC(i.INVOICE_DATE) AS DAYS_TO_PAY FROM AP_INVOICE_PAYMENTS_ALL ip JOIN AP_INVOICES_ALL i ON i.INVOICE_ID = ip.INVOICE_ID JOIN AP_CHECKS_ALL c ON c.CHECK_ID = ip.CHECK_ID WHERE i.VENDOR_ID IN ({ID}) AND c.CHECK_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY c.CHECK_DATE DESC" }),
                ("holds", new[] {
                    "SELECT i.INVOICE_NUM AS TRX_NUMBER, h.HOLD_LOOKUP_CODE AS HOLD, h.HOLD_REASON AS REASON, TO_CHAR(h.HOLD_DATE, 'YYYY-MM-DD') AS HOLD_DATE, h.RELEASE_LOOKUP_CODE AS RELEASE, h.RELEASE_REASON FROM AP_HOLDS_ALL h JOIN AP_INVOICES_ALL i ON i.INVOICE_ID = h.INVOICE_ID WHERE i.VENDOR_ID IN ({ID}) AND (h.HOLD_DATE >= TRUNC(SYSDATE) - {DAYS} OR h.RELEASE_LOOKUP_CODE IS NULL) ORDER BY h.HOLD_DATE DESC",
                    "SELECT i.INVOICE_NUM AS TRX_NUMBER, h.HOLD_LOOKUP_CODE AS HOLD, TO_CHAR(h.HOLD_DATE, 'YYYY-MM-DD') AS HOLD_DATE, h.RELEASE_LOOKUP_CODE AS RELEASE FROM AP_HOLDS_ALL h JOIN AP_INVOICES_ALL i ON i.INVOICE_ID = h.INVOICE_ID WHERE i.VENDOR_ID IN ({ID}) AND (h.HOLD_DATE >= TRUNC(SYSDATE) - {DAYS} OR h.RELEASE_LOOKUP_CODE IS NULL) ORDER BY h.HOLD_DATE DESC" })
            }
        };
        private static string[] TrxSql(string cls) => new[] {
            "SELECT ps.TRX_NUMBER, ps.CLASS, TO_CHAR(ps.TRX_DATE, 'YYYY-MM-DD') AS TRX_DATE, TO_CHAR(ps.DUE_DATE, 'YYYY-MM-DD') AS DUE_DATE, tt.NAME AS TRX_TYPE, ps.INVOICE_CURRENCY_CODE AS CURRENCY, ps.AMOUNT_DUE_ORIGINAL AS ORIGINAL, ps.AMOUNT_DUE_REMAINING AS REMAINING, ps.ACCTD_AMOUNT_DUE_REMAINING AS REMAINING_LEDGER, ps.STATUS, TO_CHAR(ps.ACTUAL_DATE_CLOSED, 'YYYY-MM-DD') AS CLOSED, t.PURCHASE_ORDER AS CUSTOMER_PO, t.CT_REFERENCE AS REFERENCE, TO_CHAR(ps.ORG_ID) AS BU_ID FROM AR_PAYMENT_SCHEDULES_ALL ps LEFT JOIN RA_CUSTOMER_TRX_ALL t ON t.CUSTOMER_TRX_ID = ps.CUSTOMER_TRX_ID LEFT JOIN RA_CUST_TRX_TYPES_ALL tt ON tt.CUST_TRX_TYPE_SEQ_ID = t.CUST_TRX_TYPE_SEQ_ID WHERE ps.CUSTOMER_ID IN ({ID}) AND " + cls + " AND (ps.TRX_DATE >= TRUNC(SYSDATE) - {DAYS} OR ps.STATUS = 'OP') ORDER BY ps.TRX_DATE DESC",
            "SELECT ps.TRX_NUMBER, ps.CLASS, TO_CHAR(ps.TRX_DATE, 'YYYY-MM-DD') AS TRX_DATE, TO_CHAR(ps.DUE_DATE, 'YYYY-MM-DD') AS DUE_DATE, ps.INVOICE_CURRENCY_CODE AS CURRENCY, ps.AMOUNT_DUE_ORIGINAL AS ORIGINAL, ps.AMOUNT_DUE_REMAINING AS REMAINING, ps.ACCTD_AMOUNT_DUE_REMAINING AS REMAINING_LEDGER, ps.STATUS, TO_CHAR(ps.ORG_ID) AS BU_ID FROM AR_PAYMENT_SCHEDULES_ALL ps WHERE ps.CUSTOMER_ID IN ({ID}) AND " + cls + " AND (ps.TRX_DATE >= TRUNC(SYSDATE) - {DAYS} OR ps.STATUS = 'OP') ORDER BY ps.TRX_DATE DESC" };
        private static string[] ApInvSql(string types) => new[] {
            "SELECT i.INVOICE_NUM AS TRX_NUMBER, i.INVOICE_TYPE_LOOKUP_CODE AS CLASS, TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD') AS TRX_DATE, (SELECT TO_CHAR(MIN(ps.DUE_DATE), 'YYYY-MM-DD') FROM AP_PAYMENT_SCHEDULES_ALL ps WHERE ps.INVOICE_ID = i.INVOICE_ID) AS DUE_DATE, i.INVOICE_CURRENCY_CODE AS CURRENCY, i.INVOICE_AMOUNT AS ORIGINAL, NVL(i.AMOUNT_PAID, 0) AS PAID, (SELECT SUM(ps.AMOUNT_REMAINING) FROM AP_PAYMENT_SCHEDULES_ALL ps WHERE ps.INVOICE_ID = i.INVOICE_ID) AS REMAINING, i.PAYMENT_STATUS_FLAG AS STATUS, (SELECT COUNT(*) FROM AP_HOLDS_ALL h WHERE h.INVOICE_ID = i.INVOICE_ID AND h.RELEASE_LOOKUP_CODE IS NULL) AS OPEN_HOLDS, i.DESCRIPTION, TO_CHAR(i.ORG_ID) AS BU_ID FROM AP_INVOICES_ALL i WHERE i.VENDOR_ID IN ({ID}) AND i.CANCELLED_DATE IS NULL AND i.INVOICE_TYPE_LOOKUP_CODE " + types + " AND (i.INVOICE_DATE >= TRUNC(SYSDATE) - {DAYS} OR NVL(i.PAYMENT_STATUS_FLAG, 'N') <> 'Y') ORDER BY i.INVOICE_DATE DESC",
            "SELECT i.INVOICE_NUM AS TRX_NUMBER, i.INVOICE_TYPE_LOOKUP_CODE AS CLASS, TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD') AS TRX_DATE, (SELECT TO_CHAR(MIN(ps.DUE_DATE), 'YYYY-MM-DD') FROM AP_PAYMENT_SCHEDULES_ALL ps WHERE ps.INVOICE_ID = i.INVOICE_ID) AS DUE_DATE, i.INVOICE_CURRENCY_CODE AS CURRENCY, i.INVOICE_AMOUNT AS ORIGINAL, (SELECT SUM(ps.AMOUNT_REMAINING) FROM AP_PAYMENT_SCHEDULES_ALL ps WHERE ps.INVOICE_ID = i.INVOICE_ID) AS REMAINING FROM AP_INVOICES_ALL i WHERE i.VENDOR_ID IN ({ID}) AND i.CANCELLED_DATE IS NULL AND i.INVOICE_TYPE_LOOKUP_CODE " + types + " AND i.INVOICE_DATE >= TRUNC(SYSDATE) - {DAYS} ORDER BY i.INVOICE_DATE DESC" };

        /// <summary>The history of one customer (AR, by account number) or supplier (AP, by supplier number): profile, address,
        /// credit limit, invoices, credit notes, payments, applications (with days to pay), adjustments / holds — from this PC
        /// (fin_wc_history) unless <paramref name="refresh"/>, else from Fusion and kept.</summary>
        public static async Task<object> HistoryAsync(FinanceFusion.Runner run, string pod, string kind, string party, int months, bool refresh, Action<string> progress, CancellationToken ct)
        {
            kind = (kind ?? "").ToUpperInvariant();
            if (!HISTORY.ContainsKey(kind)) return new { ok = false, error = "kind is AR or AP" };
            if (string.IsNullOrWhiteSpace(party) || party == "-") return new { ok = false, error = "This line has no " + (kind == "AR" ? "customer account" : "supplier number") + " — there is no history to read." };
            months = Math.Clamp(months <= 0 ? 24 : months, 3, 120);
            if (!refresh) { var cached = FinanceLens.LoadHistory(pod, kind, party); if (cached != null) return cached; }
            var total = Stopwatch.StartNew();
            progress?.Invoke("Finding " + (kind == "AR" ? "customer account " : "supplier ") + party + "…");
            string idSql = kind == "AR" ? "SELECT a.CUST_ACCOUNT_ID AS ID, a.PARTY_ID AS PID FROM HZ_CUST_ACCOUNTS a WHERE a.ACCOUNT_NUMBER = " + Lit(party)
                                        : "SELECT s.VENDOR_ID AS ID, s.PARTY_ID AS PID FROM POZ_SUPPLIERS s WHERE s.SEGMENT1 = " + Lit(party);
            var idr = await run(idSql, 50, ct).ConfigureAwait(false);
            if (idr == null || !idr.Success) return new { ok = false, error = "Could not find " + party + ": " + (idr?.Error ?? "cancelled") };
            string Ids(string col) => string.Join(", ", idr.Rows.Select(x => Convert.ToString(Get(x, col), CultureInfo.InvariantCulture)).Where(v => !string.IsNullOrEmpty(v) && v.All(char.IsDigit)).Distinct());
            string id = Ids("ID"), pid = Ids("PID");
            if (id.Length == 0) return new { ok = false, error = (kind == "AR" ? "No customer account " : "No supplier ") + party + " in Fusion." };
            if (pid.Length == 0) pid = "-1";
            var sections = new List<FinanceLens.HistorySection>();
            foreach (var (name, alts) in HISTORY[kind])
            {
                ct.ThrowIfCancellationRequested();
                progress?.Invoke("Reading " + name + "…");
                var sec = new FinanceLens.HistorySection { Name = name };
                var sw = Stopwatch.StartNew();
                for (int a = 0; a < alts.Length; a++)
                {
                    string sql = alts[a].Replace("{ID}", id).Replace("{PID}", pid).Replace("{DAYS}", ((int)Math.Round(months * 30.44)).ToString(CultureInfo.InvariantCulture));
                    var r = await run(sql, 5000, ct).ConfigureAwait(false);
                    if (r == null) break;
                    if (!r.Success) { sec.Error ??= r.Error; sec.Sql = sql; continue; }
                    var cols = r.Columns.Count > 0 ? r.Columns : r.Rows.SelectMany(x => x.Keys).Distinct().ToList();
                    sec.Ok = true; sec.Error = null; sec.Sql = sql; sec.Alt = a; sec.Capped = r.Capped; sec.Columns = cols;
                    sec.Rows = r.Rows.Select(x => cols.Select(c => Get(x, c)).ToArray()).ToList();
                    break;
                }
                sec.Ms = sw.ElapsedMilliseconds;
                progress?.Invoke("   " + name + ": " + (sec.Ok ? sec.Rows.Count + " row(s)" + (sec.Alt > 0 ? " (simpler query " + (sec.Alt + 1) + ")" : "") : "not available — " + Short(sec.Error)) + " · " + sec.Ms + " ms");
                sections.Add(sec);
            }
            var at = DateTime.Now;
            FinanceLens.SaveHistory(pod, kind, party, months, at, sections);
            return FinanceLens.HistoryReply(kind, party, months, at, sections, false, total.ElapsedMilliseconds);
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

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

namespace WMSApp
{
    /// <summary>
    /// Finance Lens › Inter company: every intercompany transaction of a month read from Oracle Fusion (read-only, through the
    /// Fusion SQL runner) and kept in the finance DuckDB file, one table per source — all prefixed rr_ic_:
    ///   ENT  rr_ic_entities  legal entities (+ their balancing segment values = companies, TCA party), business units, inventory organisations
    ///   FUN  rr_ic_fun       Intercompany module transactions (FUN_TRX_BATCHES × FUN_TRX_HEADERS: initiator → recipient, AR / AP invoice numbers)
    ///   AR   rr_ic_ar        receivables transactions billed to an intercompany customer (party of a legal entity, customer type I or listed)
    ///   AP   rr_ic_ap        payables invoices from an intercompany supplier (party of a legal entity, vendor type INTERCOMPANY, source or listed)
    ///   INV  rr_ic_inv       inter-organisation transfers between organisations of different legal entities (shipping side)
    ///   GL   rr_ic_gl        posted journal lines on intercompany accounts / with an intercompany segment value / in an intercompany category or source
    ///   BAL  rr_ic_bal       GL balances of those accounts by company × account × intercompany segment, per month
    /// The transaction tables share one layout (from → to, party, currency, entered + ledger amount …) so the page can match them;
    /// view rr_ic_v unions them and resolves business units / organisations to legal entities and companies. rr_ic_sync records each
    /// month × kind × scope (ledger) read: rows, total, which query alternative ran, error. Every kind tries its SQL alternatives in order
    /// (a pod without a table / column falls back to a simpler query); a custom query per kind can replace them.
    /// </summary>
    public static class FinanceIntercompany
    {
        public sealed class LedgerSeg
        {
            public string Id { get; set; } public string Name { get; set; }
            public string Company { get; set; } public string Account { get; set; } public string Ic { get; set; }
            public string CoaId { get; set; }
        }
        public sealed class Options
        {
            public string Pod { get; set; }
            public List<int> Months { get; set; } = new();
            public List<string> Kinds { get; set; } = new();
            public List<LedgerSeg> Ledgers { get; set; } = new();
            public List<string> IcAccounts { get; set; } = new();
            public List<string> IcCustomers { get; set; } = new();
            public List<string> IcSuppliers { get; set; } = new();
            public bool CrossLeOnly { get; set; } = true;
            public bool UseCategory { get; set; } = true;
            public int PageSize { get; set; } = 5000;
            public int Cap { get; set; } = 500000;
            public Dictionary<string, string> Queries { get; set; } = new();
        }

        public static readonly string[] KINDS = { "ENT", "FUN", "AR", "AP", "INV", "GL", "BAL" };
        public static readonly string[] TRX_KINDS = { "FUN", "AR", "AP", "INV", "GL" };
        public static readonly string[] TRX_COLS = { "SRC_ID", "DOC_NUMBER", "LINE_NUM", "DOC_TYPE", "DOC_DATE", "GL_DATE", "STATUS", "FROM_LE", "FROM_BU", "FROM_ORG", "FROM_COMPANY",
            "TO_LE", "TO_BU", "TO_ORG", "TO_COMPANY", "PARTY_NUMBER", "PARTY_NAME", "CURRENCY", "AMOUNT_ENTERED", "AMOUNT", "ACCOUNT", "ITEM", "QUANTITY", "REFERENCE", "REF2", "DESCRIPTION", "LEDGER_ID" };
        public static readonly HashSet<string> NUM_COLS = new(StringComparer.OrdinalIgnoreCase) { "LINE_NUM", "AMOUNT_ENTERED", "AMOUNT", "QUANTITY", "OPENING", "DR", "CR" };
        public static readonly string[] BAL_COLS = { "LEDGER_ID", "PERIOD_NAME", "COMPANY", "ACCOUNT", "IC_COMPANY", "CURRENCY", "OPENING", "DR", "CR" };
        public static readonly string[] ENT_COLS = { "ENT_TYPE", "ID", "CODE", "NAME", "LE_ID", "PARTY_ID", "LEDGER_ID", "BU_ID", "COMPANIES" };
        private static readonly Regex SEG = new Regex(@"^SEGMENT([1-9]|[12][0-9]|30)$");

        public static string Label(string kind) => kind switch
        {
            "ENT" => "Legal entities, business units & organisations", "FUN" => "Intercompany transactions (FUN)", "AR" => "Receivables (intercompany customers)",
            "AP" => "Payables (intercompany suppliers)", "INV" => "Inventory transfers between legal entities", "GL" => "GL journal lines", "BAL" => "GL balances", _ => kind
        };
        private static string Lit(string s) => "'" + (s ?? "").Replace("'", "''") + "'";
        private static string Seg(string s) => s != null && SEG.IsMatch(s.Trim().ToUpperInvariant()) ? s.Trim().ToUpperInvariant() : null;
        private static string InList(string expr, IEnumerable<string> vals)
        {
            var v = vals.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct().ToList();
            if (v.Count == 0) return null;
            return "(" + string.Join(" OR ", v.Chunk(900).Select(c => expr + " IN (" + string.Join(",", c.Select(Lit)) + ")")) + ")";
        }
        public static (string From, string To) Window(int month)
        {
            int y = month / 100, m = month % 100;
            if (y < 1900 || m < 1 || m > 12) { y = DateTime.Today.Year; m = DateTime.Today.Month; }   // ENT has no month
            var a = new DateTime(y, m, 1); var b = a.AddMonths(1);
            return ("DATE '" + a.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'", "DATE '" + b.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'");
        }

        // ── detection rules ──
        private static string IcCust(string a, Options o, int level)
        {   // level 0: party of a legal entity OR internal customer type OR listed; 1: type OR listed; 2: listed / class name
            var parts = new List<string>();
            if (level == 0) parts.Add(a + ".PARTY_ID IN (SELECT xl.PARTY_ID FROM XLE_ENTITY_PROFILES xl)");
            if (level <= 1) parts.Add("NVL(" + a + ".CUSTOMER_TYPE, 'R') = 'I'");
            if (level == 2) parts.Add("UPPER(NVL(" + a + ".CUSTOMER_CLASS_CODE, '-')) LIKE '%INTERCO%'");
            var l = InList(a + ".ACCOUNT_NUMBER", o.IcCustomers ?? new()); if (l != null) parts.Add(l);
            return "(" + string.Join(" OR ", parts) + ")";
        }
        private static string IcSupp(string s, string i, Options o, int level)
        {
            var parts = new List<string>();
            if (level == 0) parts.Add(s + ".PARTY_ID IN (SELECT xl.PARTY_ID FROM XLE_ENTITY_PROFILES xl)");
            if (level <= 1) parts.Add("UPPER(NVL(" + s + ".VENDOR_TYPE_LOOKUP_CODE, '-')) LIKE '%INTERCO%'");
            parts.Add("UPPER(NVL(" + i + ".SOURCE, '-')) LIKE '%INTERCO%'");
            var l = InList(s + ".SEGMENT1", o.IcSuppliers ?? new()); if (l != null) parts.Add(l);
            return "(" + string.Join(" OR ", parts) + ")";
        }
        /// <summary>Lines that are intercompany in the GL: an intercompany account, a counterparty in the intercompany segment, or the category / source.</summary>
        public static string GlFilter(LedgerSeg led, Options o, bool withHeader, string c = "c")
        {
            var parts = new List<string>();
            string ic = Seg(led.Ic), ac = Seg(led.Account);
            if (ic != null) parts.Add("LTRIM(NVL(" + c + "." + ic + ", '0'), '0') IS NOT NULL AND UPPER(" + c + "." + ic + ") NOT IN ('T', 'NONE', 'NA', 'N/A', 'DEFAULT')");
            if (ac != null) { var l = InList(c + "." + ac, o.IcAccounts ?? new()); if (l != null) parts.Add(l); }
            if (withHeader && o.UseCategory) parts.Add("UPPER(h.JE_CATEGORY) LIKE '%INTERCO%' OR UPPER(h.JE_SOURCE) LIKE '%INTERCO%'");
            return parts.Count == 0 ? null : "(" + string.Join(" OR ", parts.Select(p => "(" + p + ")")) + ")";
        }

        /// <summary>The query alternatives of one kind × month (× ledger), most complete first.</summary>
        public static List<(string Label, string Sql)> Alternatives(string kind, int month, LedgerSeg led, Options o)
        {
            var (from, to) = Window(month);
            var list = new List<(string, string)>();
            if (o.Queries != null && o.Queries.TryGetValue(kind, out var own) && !string.IsNullOrWhiteSpace(own))
            {
                string q = own.Replace("{FROM}", from).Replace("{TO}", to).Replace("{MONTH}", month.ToString(CultureInfo.InvariantCulture))
                    .Replace("{LEDGER_ID}", led?.Id ?? "0").Replace("{COMPANY_SEG}", Seg(led?.Company) ?? "SEGMENT1").Replace("{ACCOUNT_SEG}", Seg(led?.Account) ?? "SEGMENT1")
                    .Replace("{IC_SEG}", Seg(led?.Ic) ?? "NULL").Replace("{GL_IC_FILTER}", led == null ? "1 = 1" : GlFilter(led, o, kind == "GL") ?? "1 = 0");
                list.Add(("your own query", q));
                return list;
            }
            switch (kind)
            {
                case "ENT":
                    list.Add(("legal entities with companies", "SELECT 'LE' AS ENT_TYPE, TO_CHAR(x.LEGAL_ENTITY_ID) AS ID, x.LEGAL_ENTITY_IDENTIFIER AS CODE, x.NAME AS NAME, TO_CHAR(x.LEGAL_ENTITY_ID) AS LE_ID, TO_CHAR(x.PARTY_ID) AS PARTY_ID, " +
                        "(SELECT LISTAGG(b.FLEX_SEGMENT_VALUE, ',') WITHIN GROUP (ORDER BY b.FLEX_SEGMENT_VALUE) FROM GL_LEGAL_ENTITIES_BSVS b WHERE b.LEGAL_ENTITY_ID = x.LEGAL_ENTITY_ID) AS COMPANIES FROM XLE_ENTITY_PROFILES x"));
                    list.Add(("legal entities", "SELECT 'LE' AS ENT_TYPE, TO_CHAR(x.LEGAL_ENTITY_ID) AS ID, x.NAME AS NAME, TO_CHAR(x.LEGAL_ENTITY_ID) AS LE_ID, TO_CHAR(x.PARTY_ID) AS PARTY_ID FROM XLE_ENTITY_PROFILES x"));
                    break;
                case "ENT_BU":
                    list.Add(("business units", "SELECT 'BU' AS ENT_TYPE, TO_CHAR(u.BU_ID) AS ID, u.BU_NAME AS NAME, TO_CHAR(u.LEGAL_ENTITY_ID) AS LE_ID, TO_CHAR(u.PRIMARY_LEDGER_ID) AS LEDGER_ID, TO_CHAR(u.BU_ID) AS BU_ID FROM FUN_ALL_BUSINESS_UNITS_V u"));
                    list.Add(("business units (names)", "SELECT 'BU' AS ENT_TYPE, TO_CHAR(u.BU_ID) AS ID, u.BU_NAME AS NAME, TO_CHAR(u.BU_ID) AS BU_ID FROM FUN_ALL_BUSINESS_UNITS_V u"));
                    break;
                case "ENT_ORG":
                    list.Add(("inventory organisations", "SELECT 'ORG' AS ENT_TYPE, TO_CHAR(d.ORGANIZATION_ID) AS ID, d.ORGANIZATION_CODE AS CODE, d.ORGANIZATION_NAME AS NAME, TO_CHAR(d.LEGAL_ENTITY) AS LE_ID, " +
                        "TO_CHAR(d.SET_OF_BOOKS_ID) AS LEDGER_ID, TO_CHAR(d.BUSINESS_UNIT_ID) AS BU_ID FROM INV_ORGANIZATION_DEFINITIONS_V d"));
                    list.Add(("inventory organisations (no ledger)", "SELECT 'ORG' AS ENT_TYPE, TO_CHAR(d.ORGANIZATION_ID) AS ID, d.ORGANIZATION_CODE AS CODE, d.ORGANIZATION_NAME AS NAME, TO_CHAR(d.LEGAL_ENTITY) AS LE_ID, TO_CHAR(d.BUSINESS_UNIT_ID) AS BU_ID FROM INV_ORGANIZATION_DEFINITIONS_V d"));
                    list.Add(("inventory organisation parameters", "SELECT 'ORG' AS ENT_TYPE, TO_CHAR(p.ORGANIZATION_ID) AS ID, p.ORGANIZATION_CODE AS CODE, p.ORGANIZATION_CODE AS NAME, TO_CHAR(p.BUSINESS_UNIT_ID) AS BU_ID FROM INV_ORG_PARAMETERS p"));
                    break;
                case "FUN":
                    {
                        string core = "TO_CHAR(h.TRX_ID) AS SRC_ID, b.BATCH_NUMBER || '/' || h.TRX_NUMBER AS DOC_NUMBER, TO_CHAR(b.BATCH_DATE, 'YYYY-MM-DD') AS DOC_DATE, TO_CHAR(b.GL_DATE, 'YYYY-MM-DD') AS GL_DATE, h.STATUS AS STATUS, " +
                            "TO_CHAR(b.FROM_LE_ID) AS FROM_LE, TO_CHAR(h.TO_LE_ID) AS TO_LE, b.CURRENCY_CODE AS CURRENCY, NVL(h.INIT_AMOUNT_CR, 0) - NVL(h.INIT_AMOUNT_DR, 0) AS AMOUNT_ENTERED, " +
                            "NVL(h.INIT_AMOUNT_CR, 0) - NVL(h.INIT_AMOUNT_DR, 0) AS AMOUNT, h.AR_INVOICE_NUMBER AS REFERENCE, h.AP_INVOICE_NUMBER AS REF2, NVL(h.DESCRIPTION, b.DESCRIPTION) AS DESCRIPTION";
                        string where = " FROM FUN_TRX_BATCHES b JOIN FUN_TRX_HEADERS h ON h.BATCH_ID = b.BATCH_ID WHERE b.GL_DATE >= " + from + " AND b.GL_DATE < " + to;
                        list.Add(("batches × headers with type", "SELECT " + core + ", (SELECT t.TRX_TYPE_NAME FROM FUN_TRX_TYPES_VL t WHERE t.TRX_TYPE_ID = b.TRX_TYPE_ID) AS DOC_TYPE" + where));
                        list.Add(("batches × headers", "SELECT " + core + where));
                        list.Add(("batches × headers (few columns)", "SELECT TO_CHAR(h.TRX_ID) AS SRC_ID, h.TRX_NUMBER AS DOC_NUMBER, TO_CHAR(b.GL_DATE, 'YYYY-MM-DD') AS GL_DATE, h.STATUS AS STATUS, TO_CHAR(b.FROM_LE_ID) AS FROM_LE, " +
                            "TO_CHAR(h.TO_LE_ID) AS TO_LE, b.CURRENCY_CODE AS CURRENCY, NVL(h.INIT_AMOUNT_CR, 0) - NVL(h.INIT_AMOUNT_DR, 0) AS AMOUNT" + where));
                        break;
                    }
                case "AR":
                    for (int lv = 0; lv < 3; lv++)
                    {
                        string toLe = lv == 0 ? "(SELECT MIN(TO_CHAR(xl.LEGAL_ENTITY_ID)) FROM XLE_ENTITY_PROFILES xl WHERE xl.PARTY_ID = a.PARTY_ID)" : "NULL";
                        string sel = "SELECT TO_CHAR(t.CUSTOMER_TRX_ID) AS SRC_ID, t.TRX_NUMBER AS DOC_NUMBER, TO_CHAR(t.TRX_DATE, 'YYYY-MM-DD') AS DOC_DATE, TO_CHAR(NVL(d.GL_DATE, t.TRX_DATE), 'YYYY-MM-DD') AS GL_DATE, " +
                            "DECODE(t.COMPLETE_FLAG, 'Y', 'COMPLETE', 'INCOMPLETE') AS STATUS, TO_CHAR(t.LEGAL_ENTITY_ID) AS FROM_LE, TO_CHAR(t.ORG_ID) AS FROM_BU, " + toLe + " AS TO_LE, " +
                            "a.ACCOUNT_NUMBER AS PARTY_NUMBER, p.PARTY_NAME AS PARTY_NAME, t.INVOICE_CURRENCY_CODE AS CURRENCY, d.AMOUNT AS AMOUNT_ENTERED, d.ACCTD_AMOUNT AS AMOUNT, " +
                            "t.CT_REFERENCE AS REFERENCE, t.PURCHASE_ORDER AS REF2, t.COMMENTS AS DESCRIPTION";
                        string fromw = " FROM RA_CUSTOMER_TRX_ALL t JOIN HZ_CUST_ACCOUNTS a ON a.CUST_ACCOUNT_ID = t.BILL_TO_CUSTOMER_ID LEFT JOIN HZ_PARTIES p ON p.PARTY_ID = a.PARTY_ID " +
                            "LEFT JOIN RA_CUST_TRX_LINE_GL_DIST_ALL d ON d.CUSTOMER_TRX_ID = t.CUSTOMER_TRX_ID AND d.ACCOUNT_CLASS = 'REC' AND d.LATEST_REC_FLAG = 'Y' " +
                            "WHERE " + IcCust("a", o, lv) + " AND NVL(d.GL_DATE, t.TRX_DATE) >= " + from + " AND NVL(d.GL_DATE, t.TRX_DATE) < " + to;
                        list.Add((lv == 0 ? "transactions with type (customer = a legal entity's party, type I or listed)" : lv == 1 ? "transactions (customer type I or listed)" : "transactions (customer class or listed)",
                            sel + ", (SELECT tt.NAME FROM RA_CUST_TRX_TYPES_ALL tt WHERE tt.CUST_TRX_TYPE_SEQ_ID = t.CUST_TRX_TYPE_SEQ_ID) AS DOC_TYPE" + fromw));
                        if (lv == 0) list.Add(("transactions (no type name)", sel + fromw));
                    }
                    break;
                case "AP":
                    for (int lv = 0; lv < 2; lv++)
                    {
                        string fromLe = lv == 0 ? "(SELECT MIN(TO_CHAR(xl.LEGAL_ENTITY_ID)) FROM XLE_ENTITY_PROFILES xl WHERE xl.PARTY_ID = s.PARTY_ID)" : "NULL";
                        list.Add((lv == 0 ? "invoices (supplier = a legal entity's party, type INTERCOMPANY, source or listed)" : "invoices (supplier type, source or listed)",
                            "SELECT TO_CHAR(i.INVOICE_ID) AS SRC_ID, i.INVOICE_NUM AS DOC_NUMBER, i.INVOICE_TYPE_LOOKUP_CODE AS DOC_TYPE, TO_CHAR(i.INVOICE_DATE, 'YYYY-MM-DD') AS DOC_DATE, TO_CHAR(i.GL_DATE, 'YYYY-MM-DD') AS GL_DATE, " +
                            "CASE WHEN i.CANCELLED_DATE IS NOT NULL THEN 'CANCELLED' WHEN i.PAYMENT_STATUS_FLAG = 'Y' THEN 'PAID' WHEN i.PAYMENT_STATUS_FLAG = 'P' THEN 'PART PAID' ELSE 'OPEN' END AS STATUS, " +
                            fromLe + " AS FROM_LE, TO_CHAR(i.LEGAL_ENTITY_ID) AS TO_LE, TO_CHAR(i.ORG_ID) AS TO_BU, s.SEGMENT1 AS PARTY_NUMBER, p.PARTY_NAME AS PARTY_NAME, i.INVOICE_CURRENCY_CODE AS CURRENCY, " +
                            "i.INVOICE_AMOUNT AS AMOUNT_ENTERED, NVL(i.BASE_AMOUNT, i.INVOICE_AMOUNT * NVL(i.EXCHANGE_RATE, 1)) AS AMOUNT, i.INVOICE_NUM AS REFERENCE, i.SOURCE AS REF2, i.DESCRIPTION AS DESCRIPTION " +
                            "FROM AP_INVOICES_ALL i JOIN POZ_SUPPLIERS s ON s.VENDOR_ID = i.VENDOR_ID LEFT JOIN HZ_PARTIES p ON p.PARTY_ID = s.PARTY_ID " +
                            "WHERE " + IcSupp("s", "i", o, lv) + " AND i.GL_DATE >= " + from + " AND i.GL_DATE < " + to));
                    }
                    break;
                case "INV":
                    {
                        string le = "(SELECT MIN(TO_CHAR(od.LEGAL_ENTITY)) FROM INV_ORGANIZATION_DEFINITIONS_V od WHERE od.ORGANIZATION_ID = {O})";
                        string cross = o.CrossLeOnly ? " AND NVL(" + le.Replace("{O}", "t.ORGANIZATION_ID") + ", '-') <> NVL(" + le.Replace("{O}", "t.TRANSFER_ORGANIZATION_ID") + ", '-')" : "";
                        string baseW = " FROM INV_MATERIAL_TXNS t WHERE t.TRANSFER_ORGANIZATION_ID IS NOT NULL AND t.TRANSFER_ORGANIZATION_ID <> t.ORGANIZATION_ID AND t.PRIMARY_QUANTITY < 0 " +
                            "AND t.TRANSACTION_DATE >= " + from + " AND t.TRANSACTION_DATE < " + to;
                        string core = "SELECT TO_CHAR(t.TRANSACTION_ID) AS SRC_ID, NVL(t.SHIPMENT_NUMBER, TO_CHAR(t.TRANSACTION_ID)) AS DOC_NUMBER, TO_CHAR(t.TRANSACTION_DATE, 'YYYY-MM-DD') AS DOC_DATE, " +
                            "TO_CHAR(t.TRANSACTION_DATE, 'YYYY-MM-DD') AS GL_DATE, TO_CHAR(t.ORGANIZATION_ID) AS FROM_ORG, TO_CHAR(t.TRANSFER_ORGANIZATION_ID) AS TO_ORG, -t.PRIMARY_QUANTITY AS QUANTITY, " +
                            "(SELECT i.ITEM_NUMBER FROM EGP_SYSTEM_ITEMS_B i WHERE i.INVENTORY_ITEM_ID = t.INVENTORY_ITEM_ID AND i.ORGANIZATION_ID = t.ORGANIZATION_ID) AS ITEM, t.SHIPMENT_NUMBER AS REFERENCE";
                        string type = ", (SELECT tt.TRANSACTION_TYPE_NAME FROM INV_TRANSACTION_TYPES_VL tt WHERE tt.TRANSACTION_TYPE_ID = t.TRANSACTION_TYPE_ID) AS DOC_TYPE";
                        list.Add(("transfers between legal entities with value", core + type + ", t.CURRENCY_CODE AS CURRENCY, -t.PRIMARY_QUANTITY * NVL(t.TRANSFER_PRICE, t.TRANSACTION_COST) AS AMOUNT" + baseW + cross));
                        list.Add(("transfers between legal entities", core + type + baseW + cross));
                        list.Add(("transfers between organisations (no legal entity check)", core + baseW));
                        break;
                    }
                case "GL":
                    {
                        // Only intercompany lines, read the cheap way round:
                        //  A = the chart's intercompany code combinations (segment / accounts) → their lines of the ledger's period(s) of the month
                        //      (GL_JE_LINES by CODE_COMBINATION_ID + PERIOD_NAME, indexed) → the header for posted actuals;
                        //  B = (when "category / source" is on) lines of journals whose category or source says Intercompany that are NOT already in A.
                        // Never GL_JE_LINES.EFFECTIVE_DATE (no index: it scanned every line of the ledger) and never a function per line of the month.
                        if (led == null) break;
                        string co = Seg(led.Company), ac = Seg(led.Account), ic = Seg(led.Ic);
                        if (co == null || ac == null) break;
                        string lid = Regex.IsMatch(led.Id ?? "", "^[0-9]+$") ? led.Id : "0";
                        string coa = Regex.IsMatch(led.CoaId ?? "", "^[0-9]+$") ? led.CoaId : null;
                        string periods = "(SELECT ps.PERIOD_NAME FROM GL_PERIOD_STATUSES ps WHERE ps.APPLICATION_ID = 101 AND ps.LEDGER_ID = " + lid +
                            " AND ps.START_DATE >= " + from + " AND ps.START_DATE < " + to + " AND NVL(ps.ADJUSTMENT_PERIOD_FLAG, 'N') = 'N')";
                        string cols = "l.JE_HEADER_ID AS K1, l.JE_LINE_NUM AS K2, TO_CHAR(l.JE_HEADER_ID) || '-' || TO_CHAR(l.JE_LINE_NUM) AS SRC_ID, h.NAME AS DOC_NUMBER, l.JE_LINE_NUM AS LINE_NUM, h.JE_CATEGORY AS DOC_TYPE, " +
                            "TO_CHAR(h.DEFAULT_EFFECTIVE_DATE, 'YYYY-MM-DD') AS DOC_DATE, TO_CHAR(NVL(l.EFFECTIVE_DATE, h.DEFAULT_EFFECTIVE_DATE), 'YYYY-MM-DD') AS GL_DATE, h.STATUS AS STATUS, c." + co + " AS FROM_COMPANY, " +
                            (ic != null ? "c." + ic : "NULL") + " AS TO_COMPANY, h.CURRENCY_CODE AS CURRENCY, NVL(l.ENTERED_DR, 0) - NVL(l.ENTERED_CR, 0) AS AMOUNT_ENTERED, " +
                            "NVL(l.ACCOUNTED_DR, 0) - NVL(l.ACCOUNTED_CR, 0) AS AMOUNT, c." + ac + " AS ACCOUNT, h.JE_SOURCE AS REFERENCE, h.PERIOD_NAME AS REF2, NVL(l.DESCRIPTION, h.DESCRIPTION) AS DESCRIPTION, TO_CHAR(h.LEDGER_ID) AS LEDGER_ID";
                        string segF = GlFilter(led, new Options { IcAccounts = o.IcAccounts, UseCategory = false }, false, "c");
                        string cat = "(UPPER(h.JE_CATEGORY) LIKE '%INTERCO%' OR UPPER(h.JE_SOURCE) LIKE '%INTERCO%')";
                        string posted = " AND h.ACTUAL_FLAG = 'A' AND h.STATUS = 'P'";
                        string partB = "SELECT /*+ LEADING(h) USE_NL(l c) */ " + cols + " FROM GL_JE_HEADERS h JOIN GL_JE_LINES l ON l.JE_HEADER_ID = h.JE_HEADER_ID JOIN GL_CODE_COMBINATIONS c ON c.CODE_COMBINATION_ID = l.CODE_COMBINATION_ID " +
                            "WHERE h.LEDGER_ID = " + lid + " AND h.PERIOD_NAME IN " + periods + posted + " AND " + cat;
                        if (segF != null)
                        {
                            string partA = "SELECT /*+ LEADING(c l h) USE_NL(l h) */ " + cols + " FROM GL_CODE_COMBINATIONS c JOIN GL_JE_LINES l ON l.CODE_COMBINATION_ID = c.CODE_COMBINATION_ID JOIN GL_JE_HEADERS h ON h.JE_HEADER_ID = l.JE_HEADER_ID " +
                                "WHERE " + (coa != null ? "c.CHART_OF_ACCOUNTS_ID = " + coa + " AND " : "") + "NVL(c.SUMMARY_FLAG, 'N') = 'N' AND " + segF +
                                " AND l.LEDGER_ID = " + lid + " AND l.PERIOD_NAME IN " + periods + posted;
                            string notA = " AND (CASE WHEN " + segF + " THEN 1 ELSE 0 END) = 0";
                            if (o.UseCategory) list.Add(("intercompany code combinations + journals in an intercompany category / source", partA + " UNION ALL " + partB + notA));
                            list.Add(("intercompany code combinations", partA));
                            // a pod whose GL_JE_LINES has no LEDGER_ID / PERIOD_NAME: the header gives them
                            list.Add(("intercompany code combinations (period from the header)", partA.Replace(" AND l.LEDGER_ID = " + lid + " AND l.PERIOD_NAME IN " + periods, " AND h.LEDGER_ID = " + lid + " AND h.PERIOD_NAME IN " + periods)));
                        }
                        if (o.UseCategory) list.Add(("journals in an intercompany category / source only", partB));
                        break;
                    }
                case "BAL":
                    {
                        if (led == null) break;
                        string co = Seg(led.Company), ac = Seg(led.Account), ic = Seg(led.Ic);
                        if (co == null || ac == null) break;
                        string f = GlFilter(led, o, false); if (f == null) break;
                        string lid = Regex.IsMatch(led.Id ?? "", "^[0-9]+$") ? led.Id : "0";
                        string icx = ic != null ? "c." + ic : "NULL";
                        string body = "SELECT TO_CHAR(b.LEDGER_ID) AS LEDGER_ID, b.PERIOD_NAME AS PERIOD_NAME, c." + co + " AS COMPANY, c." + ac + " AS ACCOUNT, " + icx + " AS IC_COMPANY, b.CURRENCY_CODE AS CURRENCY, " +
                            "SUM(NVL(b.BEGIN_BALANCE_DR, 0) - NVL(b.BEGIN_BALANCE_CR, 0)) AS OPENING, SUM(NVL(b.PERIOD_NET_DR, 0)) AS DR, SUM(NVL(b.PERIOD_NET_CR, 0)) AS CR " +
                            "FROM GL_BALANCES b JOIN GL_CODE_COMBINATIONS c ON c.CODE_COMBINATION_ID = b.CODE_COMBINATION_ID{LED} WHERE b.LEDGER_ID = " + lid + " AND b.ACTUAL_FLAG = 'A' AND NVL(b.TRANSLATED_FLAG, 'N') <> 'R' " +
                            "AND NVL(c.SUMMARY_FLAG, 'N') = 'N' AND b.PERIOD_NAME IN (SELECT ps.PERIOD_NAME FROM GL_PERIOD_STATUSES ps WHERE ps.APPLICATION_ID = 101 AND ps.LEDGER_ID = " + lid +
                            " AND ps.START_DATE >= " + from + " AND ps.START_DATE < " + to + " AND NVL(ps.ADJUSTMENT_PERIOD_FLAG, 'N') = 'N') AND " + f +
                            " GROUP BY b.LEDGER_ID, b.PERIOD_NAME, c." + co + ", c." + ac + (ic != null ? ", c." + ic : "") + ", b.CURRENCY_CODE";
                        list.Add(("balances in the ledger currency", body.Replace("{LED}", " JOIN GL_LEDGERS lg ON lg.LEDGER_ID = b.LEDGER_ID AND lg.CURRENCY_CODE = b.CURRENCY_CODE")));
                        list.Add(("balances (every currency)", body.Replace("{LED}", "")));
                        break;
                    }
            }
            return list;
        }

        private static string OrderKey(string kind) => kind == "BAL" ? "q.COMPANY, q.ACCOUNT, q.IC_COMPANY, q.CURRENCY, q.PERIOD_NAME" : kind.StartsWith("ENT") ? "q.ID" : "q.SRC_ID";
        private static bool Slow(string err) => err != null && Regex.IsMatch(err, "time ?out|timed out|ORA-01013|ORA-03113|cut short|took too long|500|503|504", RegexOptions.IgnoreCase);

        /// <summary>One query read page by page (ROW_NUMBER over the key); a slow page is asked again at half size.</summary>
        private static async Task<(bool Ok, string Error, List<Dictionary<string, object>> Rows, bool Capped)> ReadAsync(FinanceFusion.Runner run, string kind, string sql, string what, Options o, Action<string> progress, CancellationToken ct)
        {
            var all = new List<Dictionary<string, object>>();
            int size = Math.Clamp(o.PageSize <= 0 ? 5000 : o.PageSize, 200, 50000), page = 0, tries = 0;
            long done = 0;
            // GL: keyset pages on (JE_HEADER_ID, JE_LINE_NUM) — each page starts where the last one ended (no ROW_NUMBER over the whole month every page)
            bool keyset = kind == "GL" && Regex.IsMatch(sql, @"\bAS K1\b") && Regex.IsMatch(sql, @"\bAS K2\b");
            object k1 = null, k2 = null;
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                string pq = keyset
                    ? "SELECT * FROM (SELECT q.* FROM (" + sql + ") q" + (k1 == null ? "" : " WHERE (q.K1 > " + Num(k1) + " OR (q.K1 = " + Num(k1) + " AND q.K2 > " + Num(k2) + "))") + " ORDER BY q.K1, q.K2) WHERE ROWNUM <= " + size
                    : "SELECT * FROM (SELECT q.*, ROW_NUMBER() OVER (ORDER BY " + OrderKey(kind) + ") AS RN__ FROM (" + sql + ") q) WHERE RN__ > " + done + " AND RN__ <= " + (done + size);
                string id = "ic_" + Guid.NewGuid().ToString("N").Substring(0, 8);
                progress?.Invoke("\u0001" + JsonSerializer.Serialize(new { t = "sql", id, what = what + (page > 0 ? " · page " + (page + 1) : ""), sql = pq }));
                var sw = Stopwatch.StartNew();
                FusionSql.FusionQueryResult r;
                try { r = await run(pq, size + 1, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex) { r = new FusionSql.FusionQueryResult { Success = false, Error = ex.Message }; }
                progress?.Invoke("\u0001" + JsonSerializer.Serialize(new { t = "end", id, ok = r.Success, rows = r.Rows?.Count ?? 0, ms = sw.ElapsedMilliseconds, error = r.Success ? null : r.Error }));
                if (!r.Success)
                {
                    if (Slow(r.Error) && size > 250 && tries < 4) { size = Math.Max(250, size / 2); tries++; progress?.Invoke("   ⚠ slow page — asking again " + size.ToString("N0", CultureInfo.InvariantCulture) + " rows at a time"); continue; }
                    return (false, r.Error, all, false);
                }
                tries = 0;
                if (page == 0 && r.Rows.Count > 0)
                    progress?.Invoke("\u0001" + JsonSerializer.Serialize(new { t = "sample", id, what, columns = r.Rows[0].Keys.Where(k => k != "RN__" && k != "K1" && k != "K2").ToList(), rows = r.Rows.Take(5).Select(x => x.Where(kv => kv.Key != "RN__" && kv.Key != "K1" && kv.Key != "K2").Select(kv => kv.Value).ToList()).ToList() }));
                if (keyset && r.Rows.Count > 0) { var lr = r.Rows[^1]; k1 = Get(lr, "K1"); k2 = Get(lr, "K2"); }
                foreach (var row in r.Rows) { row.Remove("RN__"); row.Remove("K1"); row.Remove("K2"); all.Add(row); }
                done += r.Rows.Count; page++;
                if (r.Rows.Count < size) return (true, null, all, false);
                progress?.Invoke("   " + what + " · " + done.ToString("N0", CultureInfo.InvariantCulture) + " rows so far");
                if (all.Count >= o.Cap) return (true, null, all, true);
            }
        }

        private static string Num(object v) { var t = Convert.ToString(v, CultureInfo.InvariantCulture) ?? "0"; return Regex.IsMatch(t, @"^-?[0-9]+(\.[0-9]+)?$") ? t : "0"; }
        private static object Get(Dictionary<string, object> row, string col)
        {
            if (row.TryGetValue(col, out var v)) return v;
            foreach (var kv in row) if (string.Equals(kv.Key, col, StringComparison.OrdinalIgnoreCase)) return kv.Value;
            return null;
        }
        private static object Cell(Dictionary<string, object> row, string col)
        {
            var v = Get(row, col);
            if (v == null) return null;
            if (NUM_COLS.Contains(col)) return double.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : (object)null;
            var s = Convert.ToString(v, CultureInfo.InvariantCulture);
            return s == "" ? null : s;
        }

        /// <summary>Reads every asked kind × month (× ledger) and keeps it in DuckDB. Returns one result per read.</summary>
        public static async Task<List<object>> SyncAsync(FinanceFusion.Runner run, Options o, string user, Action<string> progress, CancellationToken ct)
        {
            var results = new List<object>();
            var kinds = (o.Kinds ?? new()).Select(k => (k ?? "").ToUpperInvariant()).Where(k => KINDS.Contains(k)).Distinct().OrderBy(k => Array.IndexOf(KINDS, k)).ToList();
            var months = (o.Months ?? new()).Where(m => m > 190001 && m < 300001 && m % 100 >= 1 && m % 100 <= 12).Distinct().OrderBy(m => m).ToList();
            int total = (kinds.Contains("ENT") ? 1 : 0) + kinds.Count(k => k != "ENT") * Math.Max(1, months.Count), step = 0;
            if (kinds.Contains("ENT"))
            {
                step++;
                progress?.Invoke("[" + step + "/" + total + "] ▶ " + Label("ENT"));
                var rows = new List<object[]>(); var errs = new List<string>(); var used = new List<string>(); var sw = Stopwatch.StartNew();
                foreach (var sub in new[] { "ENT", "ENT_BU", "ENT_ORG" })
                {
                    bool got = false;
                    foreach (var (lab, sql) in Alternatives(sub, 0, null, o))
                    {
                        var r = await ReadAsync(run, "ENT", sql, Label("ENT") + " · " + lab, o, progress, ct).ConfigureAwait(false);
                        if (!r.Ok) { errs.Add(lab + ": " + r.Error); continue; }
                        foreach (var row in r.Rows) rows.Add(ENT_COLS.Select(c => Cell(row, c)).ToArray());
                        used.Add(lab + " (" + r.Rows.Count + ")"); got = true; break;
                    }
                    if (!got) progress?.Invoke("   ⚠ " + sub + " not read: " + string.Join(" · ", errs.TakeLast(1)));
                }
                bool ok = used.Count > 0;
                if (ok) FinanceLens.SaveIc(o.Pod, "ENT", 0, "*", rows);
                FinanceLens.SaveIcSync(o.Pod, "ENT", 0, "*", ok, rows.Count, 0, string.Join(" · ", used), ok ? (errs.Count > 0 ? string.Join(" · ", errs) : null) : string.Join(" · ", errs), null, sw.ElapsedMilliseconds, false, user);
                progress?.Invoke((ok ? "✓ " : "✖ ") + Label("ENT") + ": " + rows.Count + " row(s)");
                results.Add(new { kind = "ENT", month = 0, scope = "*", ok, rows = rows.Count, error = ok ? null : string.Join(" · ", errs) });
            }
            foreach (var kind in kinds.Where(k => k != "ENT"))
            {
                foreach (var month in months)
                {
                    step++;
                    var scopes = kind == "GL" || kind == "BAL" ? (o.Ledgers ?? new()).Where(l => !string.IsNullOrWhiteSpace(l.Id)).ToList() : new List<LedgerSeg> { null };
                    if (scopes.Count == 0) { results.Add(new { kind, month, scope = "*", ok = false, rows = 0, error = "No ledger with its company / account segments — Data › Fusion setup" }); continue; }
                    foreach (var led in scopes)
                    {
                        ct.ThrowIfCancellationRequested();
                        string scope = led?.Id ?? "*", what = Label(kind) + " · " + month / 100 + "-" + (month % 100).ToString("00", CultureInfo.InvariantCulture) + (led != null ? " · " + (led.Name ?? led.Id) : "");
                        progress?.Invoke("[" + step + "/" + total + "] ▶ " + what);
                        var alts = Alternatives(kind, month, led, o);
                        if (alts.Count == 0)
                        {
                            string why = kind == "GL" || kind == "BAL" ? "nothing marks a line as intercompany in this ledger — choose intercompany accounts or the intercompany segment (Inter company › Settings)" : "no query";
                            FinanceLens.SaveIcSync(o.Pod, kind, month, scope, false, 0, 0, null, why, null, 0, false, user);
                            results.Add(new { kind, month, scope, ok = false, rows = 0, error = why }); progress?.Invoke("⚠ " + what + ": " + why); continue;
                        }
                        var sw = Stopwatch.StartNew(); var errs = new List<string>(); bool ok = false;
                        for (int ai = 0; ai < alts.Count && !ok; ai++)
                        {
                            var (lab, sql) = alts[ai];
                            var r = await ReadAsync(run, kind, sql, what + " · " + lab, o, progress, ct).ConfigureAwait(false);
                            if (!r.Ok) { errs.Add(lab + ": " + r.Error); progress?.Invoke("   ⚠ " + lab + ": " + Short(r.Error) + (ai + 1 < alts.Count ? " — trying a simpler query" : "")); continue; }
                            ok = true;
                            double sum = 0;
                            var rows = new List<object[]>();
                            if (kind == "BAL")
                                foreach (var row in r.Rows) rows.Add(BAL_COLS.Select(c => Cell(row, c)).ToArray());
                            else
                                foreach (var row in r.Rows)
                                {
                                    var vals = TRX_COLS.Select(c => Cell(row, c)).ToList();
                                    if (vals[Array.IndexOf(TRX_COLS, "AMOUNT")] is double d) sum += d;
                                    var extra = row.Where(kv => !TRX_COLS.Contains(kv.Key, StringComparer.OrdinalIgnoreCase)).ToDictionary(kv => kv.Key, kv => kv.Value);
                                    vals.Add(extra.Count > 0 ? JsonSerializer.Serialize(extra) : null);
                                    rows.Add(vals.ToArray());
                                }
                            if (kind == "BAL") foreach (var row in r.Rows) sum += (Cell(row, "OPENING") as double? ?? 0) + (Cell(row, "DR") as double? ?? 0) - (Cell(row, "CR") as double? ?? 0);
                            FinanceLens.SaveIc(o.Pod, kind, month, scope, rows);
                            FinanceLens.SaveIcSync(o.Pod, kind, month, scope, true, rows.Count, sum, lab, null, sql, sw.ElapsedMilliseconds, r.Capped, user);
                            progress?.Invoke("✓ " + what + ": " + rows.Count.ToString("N0", CultureInfo.InvariantCulture) + " row(s)" + (r.Capped ? " — capped" : ""));
                            results.Add(new { kind, month, scope, ok = true, rows = rows.Count, total = sum, alt = lab, ms = sw.ElapsedMilliseconds, capped = r.Capped });
                        }
                        if (!ok)
                        {
                            string err = string.Join(" · ", errs);
                            FinanceLens.SaveIcSync(o.Pod, kind, month, scope, false, 0, 0, null, err, alts[0].Sql, sw.ElapsedMilliseconds, false, user);
                            progress?.Invoke("✖ " + what + " failed");
                            results.Add(new { kind, month, scope, ok = false, rows = 0, error = err });
                        }
                    }
                }
            }
            return results;
        }
        private static string Short(string e) => e == null ? "" : e.Length > 200 ? e.Substring(0, 200) + "…" : e;
    }

    public static partial class FinanceLens
    {
        internal static readonly string IC_TRX_COLS = string.Join(", ", FinanceIntercompany.TRX_COLS.Select(c => c.ToLowerInvariant() + (FinanceIntercompany.NUM_COLS.Contains(c) ? " DOUBLE" : " VARCHAR"))) + ", extra_json VARCHAR";
        internal static readonly string IC_SYNC_TABLE = "CREATE TABLE IF NOT EXISTS rr_ic_sync (pod VARCHAR, kind VARCHAR, month INTEGER, scope VARCHAR, ok BOOLEAN, rows_read BIGINT, total DOUBLE, alt VARCHAR, error VARCHAR, sql VARCHAR, ms BIGINT, capped BOOLEAN, fetched_at TIMESTAMP, fetched_by VARCHAR)";
        internal static readonly string IC_ENT_TABLE = "CREATE TABLE IF NOT EXISTS rr_ic_entities (pod VARCHAR, month INTEGER, scope VARCHAR, fetched_at TIMESTAMP, ent_type VARCHAR, id VARCHAR, code VARCHAR, name VARCHAR, le_id VARCHAR, party_id VARCHAR, ledger_id VARCHAR, bu_id VARCHAR, companies VARCHAR)";
        internal static readonly string IC_BAL_TABLE = "CREATE TABLE IF NOT EXISTS rr_ic_bal (pod VARCHAR, month INTEGER, scope VARCHAR, fetched_at TIMESTAMP, ledger_id VARCHAR, period_name VARCHAR, company VARCHAR, account VARCHAR, ic_company VARCHAR, currency VARCHAR, opening DOUBLE, dr DOUBLE, cr DOUBLE)";
        internal static string IcTable(string kind) => kind switch { "ENT" => "rr_ic_entities", "BAL" => "rr_ic_bal", _ => "rr_ic_" + kind.ToLowerInvariant() };

        internal static void EnsureIcTables(DuckDBConnection conn)
        {
            Exec(conn, IC_SYNC_TABLE); Exec(conn, IC_ENT_TABLE); Exec(conn, IC_BAL_TABLE);
            foreach (var k in FinanceIntercompany.TRX_KINDS)
                Exec(conn, "CREATE TABLE IF NOT EXISTS " + IcTable(k) + " (pod VARCHAR, kind VARCHAR, month INTEGER, scope VARCHAR, fetched_at TIMESTAMP, " + IC_TRX_COLS + ")");
            EnsureIcView(conn);
        }

        /// <summary>rr_ic_v: every intercompany transaction with the legal entities and companies of both sides resolved;
        /// rr_ic_bal_v: balances with closing; rr_ic_status_v: one row per kind × month (all scopes) for the month board.</summary>
        internal static void EnsureIcView(DuckDBConnection conn)
        {
            string union = string.Join(" UNION ALL BY NAME ", FinanceIntercompany.TRX_KINDS.Select(k => "SELECT * FROM " + IcTable(k)));
            Exec(conn, "CREATE OR REPLACE VIEW rr_ic_v AS WITH x AS (" + union + "), " +
                "e AS (SELECT DISTINCT ON (pod, ent_type, id) pod, ent_type, id, code, name, le_id, companies FROM rr_ic_entities ORDER BY pod, ent_type, id, fetched_at DESC), " +
                "y AS (SELECT x.*, COALESCE(x.from_le, bf.le_id, ofr.le_id) AS from_le_id, COALESCE(x.to_le, bt.le_id, otr.le_id) AS to_le_id FROM x " +
                "LEFT JOIN e bf ON bf.pod = x.pod AND bf.ent_type = 'BU' AND bf.id = x.from_bu LEFT JOIN e ofr ON ofr.pod = x.pod AND ofr.ent_type = 'ORG' AND ofr.id = x.from_org " +
                "LEFT JOIN e bt ON bt.pod = x.pod AND bt.ent_type = 'BU' AND bt.id = x.to_bu LEFT JOIN e otr ON otr.pod = x.pod AND otr.ent_type = 'ORG' AND otr.id = x.to_org) " +
                "SELECT y.*, COALESCE(NULLIF(y.from_company, ''), NULLIF(split_part(lf.companies, ',', 1), ''), lf.code, y.from_le_id) AS from_co, COALESCE(lf.name, y.from_company) AS from_name, " +
                "COALESCE(NULLIF(y.to_company, ''), NULLIF(split_part(lt.companies, ',', 1), ''), lt.code, y.to_le_id) AS to_co, COALESCE(lt.name, y.to_company) AS to_name, " +
                "CAST(y.month / 100 AS INTEGER) AS year " +
                "FROM y LEFT JOIN e lf ON lf.pod = y.pod AND lf.ent_type = 'LE' AND lf.id = y.from_le_id LEFT JOIN e lt ON lt.pod = y.pod AND lt.ent_type = 'LE' AND lt.id = y.to_le_id");
            Exec(conn, "CREATE OR REPLACE VIEW rr_ic_bal_v AS SELECT *, COALESCE(opening, 0) + COALESCE(dr, 0) - COALESCE(cr, 0) AS closing, COALESCE(dr, 0) - COALESCE(cr, 0) AS net FROM rr_ic_bal");
            Exec(conn, "CREATE OR REPLACE VIEW rr_ic_status_v AS SELECT pod, kind, month, COUNT(*) AS scopes, COUNT(*) FILTER (WHERE ok) AS scopes_ok, SUM(rows_read) AS rows_read, SUM(total) AS total, " +
                "MAX(fetched_at) AS fetched_at, string_agg(error, ' · ') FILTER (WHERE NOT ok) AS errors FROM rr_ic_sync GROUP BY pod, kind, month");
        }

        /// <summary>Replaces one kind × month × scope (ledger, or *) with the rows read.</summary>
        public static void SaveIc(string pod, string kind, int month, string scope, List<object[]> rows)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                EnsureIcTables(conn);
                string t = IcTable(kind), p = Lit(pod ?? "");
                Exec(conn, "DELETE FROM " + t + " WHERE pod = " + p + " AND month = " + month + " AND scope = " + Lit(scope));
                var now = DateTime.Now; now = new DateTime(now.Year, now.Month, now.Day, now.Hour, now.Minute, now.Second);
                bool trx = kind != "ENT" && kind != "BAL";
                Append(conn, t, rows.Select(r => (trx ? new object[] { pod ?? "", kind, month, scope, now } : new object[] { pod ?? "", month, scope, now }).Concat(r).ToArray()).ToList());
                Exec(conn, "CHECKPOINT");
            }
        }
        public static void SaveIcSync(string pod, string kind, int month, string scope, bool ok, long rows, double total, string alt, string error, string sql, long ms, bool capped, string user)
        {
            lock (_lock)
            {
                using var conn = OpenWrite();
                EnsureIcTables(conn);
                Exec(conn, "DELETE FROM rr_ic_sync WHERE pod = " + Lit(pod ?? "") + " AND kind = " + Lit(kind) + " AND month = " + month + " AND scope = " + Lit(scope));
                var now = DateTime.Now; now = new DateTime(now.Year, now.Month, now.Day, now.Hour, now.Minute, now.Second);
                Append(conn, "rr_ic_sync", new List<object[]> { new object[] { pod ?? "", kind, month, scope, ok, rows, total, alt, error, sql, ms, capped, now, user } });
                Exec(conn, "CHECKPOINT");
            }
        }
        /// <summary>The reads on this PC (month board + checklist).</summary>
        public static object IcStatus(string pod)
        {
            if (!File.Exists(DbPath)) return new { ok = true, rows = new List<object>() };
            var t = Query("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'rr_ic_sync'", 1);
            if (t.Error != null || t.Rows.Count == 0 || Convert.ToInt64(t.Rows[0][0]) == 0) return new { ok = true, rows = new List<object>() };
            var q = Query("SELECT kind, month, scope, ok, rows_read, total, alt, error, ms, capped, CAST(fetched_at AS VARCHAR), fetched_by FROM rr_ic_sync WHERE pod = " + Lit(pod ?? "") + " ORDER BY month, kind, scope", 100000);
            return new
            {
                ok = q.Error == null, error = q.Error,
                rows = q.Rows.Select(r => new { kind = r[0], month = r[1], scope = r[2], ok = r[3], rows = r[4], total = r[5], alt = r[6], error = r[7], ms = r[8], capped = r[9], at = r[10], by = r[11] }).ToList()
            };
        }
        /// <summary>Forgets the given kinds × months (all when empty) of a pod.</summary>
        public static object IcDelete(string pod, List<string> kinds, List<int> months)
        {
            lock (_lock)
            {
                if (!File.Exists(DbPath)) return new { ok = true, deleted = 0 };
                using var conn = OpenWrite();
                EnsureIcTables(conn);
                var ks = (kinds == null || kinds.Count == 0 ? FinanceIntercompany.KINDS.ToList() : kinds.Select(k => k.ToUpperInvariant()).Where(k => FinanceIntercompany.KINDS.Contains(k)).ToList());
                string mw = months == null || months.Count == 0 ? "" : " AND month IN (" + string.Join(",", months.Select(m => m.ToString(CultureInfo.InvariantCulture))) + ")";
                foreach (var k in ks)
                {
                    Exec(conn, "DELETE FROM " + IcTable(k) + " WHERE pod = " + Lit(pod ?? "") + (k == "ENT" ? "" : mw));
                    Exec(conn, "DELETE FROM rr_ic_sync WHERE pod = " + Lit(pod ?? "") + " AND kind = " + Lit(k) + (k == "ENT" ? "" : mw));
                }
                Exec(conn, "CHECKPOINT");
                return new { ok = true, kinds = ks };
            }
        }
    }
}

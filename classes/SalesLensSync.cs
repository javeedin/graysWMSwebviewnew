using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// Sales Lens — reads Oracle Fusion (read-only, through the BI Publisher SQL runner) into newline-delimited JSON files on
    /// this PC: raw\lines\{yyyymm}.jsonl (one file per month of order dates, keyset pages by FULFILL_LINE_ID, the latest change
    /// version of each order), items, customers, item costs, business units, exchange rates, units of measure, today's on-hand
    /// and the receivables overdue per customer. Every month is checked against Fusion's own COUNT / SUM (manifest.json).
    /// The Python builder (saleslens\python\sales_intel) turns these files into the DuckDB file the page reads.
    /// Every query has alternatives: a pod without a column falls back to a simpler query (the one used is kept per month).
    /// </summary>
    public static class SalesLensSync
    {
        public sealed class Options
        {
            public string Pod;
            public List<int> Months = new();        // yyyymm to read
            public bool Refresh;                     // read months already on this PC again
            public int PageSize = 5000;
            public List<string> Kinds = new() { "lines", "items", "customers", "costs", "bus", "rates", "uom", "onhand", "ar" };
            public string ReportingCurrency = "MUR";
            public string ProfitCenterCol = "ATTRIBUTE1";
            public string SupplierCol = "ATTRIBUTE2";
            public JsonElement? CostSource;
        }

        public sealed class Result
        {
            public bool Ok = true;
            public List<string> Errors = new();
            public Dictionary<string, object> Counts = new();
            public object CostSource;
        }

        private const string LATEST = "NOT EXISTS (SELECT 1 FROM doo_headers_all x WHERE x.source_order_system = h.source_order_system AND x.source_order_number = h.source_order_number AND x.change_version_number > h.change_version_number)";
        private const string LATEST_MAX = "h.change_version_number = (SELECT MAX(x.change_version_number) FROM doo_headers_all x WHERE x.header_id = h.header_id OR (x.source_order_number = h.source_order_number AND x.source_order_system = h.source_order_system))";

        private static string D(string col) => "TO_CHAR(" + col + ", 'YYYY-MM-DD')";

        /// <summary>The order-line SELECT lists, richest first.</summary>
        private static readonly string[] LINE_COLS =
        {
            "fl.fulfill_line_id, fl.header_id, h.order_number, " + D("h.ordered_date") + " AS ordered_date,\n" +
            "       (SELECT MIN(ca.account_number) FROM hz_cust_accounts ca WHERE ca.party_id = h.sold_to_party_id) AS account_number,\n" +
            "       h.org_id AS bu_id, h.transactional_currency_code AS currency, fl.inventory_item_id, fl.fulfill_org_id AS org_id, fl.fulfill_line_number AS line_number,\n" +
            "       fl.line_category_code AS category, fl.ordered_qty, fl.shipped_qty, fl.canceled_qty, fl.ordered_uom AS uom, fl.unit_list_price, fl.unit_selling_price,\n" +
            "       fl.extended_amount, fl.status_code AS status, " + D("fl.request_ship_date") + " AS request_ship_date, " + D("fl.schedule_ship_date") + " AS schedule_ship_date,\n" +
            "       " + D("fl.promise_ship_date") + " AS promise_ship_date, " + D("fl.actual_ship_date") + " AS actual_ship_date, fl.cancel_reason_code AS cancel_reason,\n" +
            "       fl.return_reason_code AS return_reason, (SELECT MIN(sc.salesperson_id) FROM doo_sales_credits sc WHERE sc.header_id = h.header_id) AS salesperson,\n" +
            "       h.order_type_code AS order_type, h.created_by",
            "fl.fulfill_line_id, fl.header_id, h.order_number, " + D("h.ordered_date") + " AS ordered_date,\n" +
            "       (SELECT MIN(ca.account_number) FROM hz_cust_accounts ca WHERE ca.party_id = h.sold_to_party_id) AS account_number,\n" +
            "       h.org_id AS bu_id, h.transactional_currency_code AS currency, fl.inventory_item_id, fl.fulfill_org_id AS org_id, fl.fulfill_line_number AS line_number,\n" +
            "       fl.line_category_code AS category, fl.ordered_qty, fl.shipped_qty, fl.canceled_qty, fl.ordered_uom AS uom, fl.unit_selling_price,\n" +
            "       fl.extended_amount, fl.status_code AS status, " + D("fl.request_ship_date") + " AS request_ship_date, " + D("fl.actual_ship_date") + " AS actual_ship_date,\n" +
            "       fl.return_reason_code AS return_reason, h.created_by",
            "fl.fulfill_line_id, fl.header_id, h.order_number, " + D("h.ordered_date") + " AS ordered_date,\n" +
            "       (SELECT MIN(ca.account_number) FROM hz_cust_accounts ca WHERE ca.party_id = h.sold_to_party_id) AS account_number,\n" +
            "       h.org_id AS bu_id, fl.inventory_item_id, fl.fulfill_org_id AS org_id, fl.fulfill_line_number AS line_number, fl.line_category_code AS category,\n" +
            "       fl.ordered_qty, fl.shipped_qty, fl.ordered_uom AS uom, fl.unit_selling_price, fl.extended_amount, fl.status_code AS status, " + D("fl.actual_ship_date") + " AS actual_ship_date, h.created_by",
            "fl.fulfill_line_id, fl.header_id, h.order_number, " + D("h.ordered_date") + " AS ordered_date,\n" +
            "       (SELECT MIN(ca.account_number) FROM hz_cust_accounts ca WHERE ca.party_id = h.sold_to_party_id) AS account_number,\n" +
            "       h.org_id AS bu_id, fl.inventory_item_id, fl.fulfill_org_id AS org_id, fl.fulfill_line_number AS line_number,\n" +
            "       fl.ordered_qty, fl.shipped_qty, fl.ordered_uom AS uom, fl.unit_selling_price, fl.extended_amount, fl.status_code AS status, " + D("fl.actual_ship_date") + " AS actual_ship_date",
        };

        /// <summary>(columns, latest-version filter) in the order they are tried.</summary>
        private static IEnumerable<(int Cols, string Latest, bool Submitted)> LineAlternatives()
        {
            for (int c = 0; c < LINE_COLS.Length; c++) yield return (c, LATEST, c < 2);
            yield return (LINE_COLS.Length - 1, LATEST_MAX, false);
            yield return (LINE_COLS.Length - 1, "1 = 1", false);
        }

        private static string MonthWhere(int ym, string latest, bool submitted)
        {
            var from = new DateTime(ym / 100, ym % 100, 1);
            var to = from.AddMonths(1);
            return "h.ordered_date >= TO_DATE('" + from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "', 'YYYY-MM-DD') AND h.ordered_date < TO_DATE('" +
                   to.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "', 'YYYY-MM-DD') AND " + latest + (submitted ? " AND NVL(h.submitted_flag, 'Y') = 'Y'" : "");
        }

        public static string LinesSql(int ym, int alt, long after, int size)
        {
            var a = LineAlternatives().ElementAt(Math.Clamp(alt, 0, LineAlternatives().Count() - 1));
            return "SELECT " + LINE_COLS[a.Cols] + "\n  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n WHERE " + MonthWhere(ym, a.Latest, a.Submitted) +
                   (after > 0 ? " AND fl.fulfill_line_id > " + after : "") + "\n ORDER BY fl.fulfill_line_id\n FETCH FIRST " + size + " ROWS ONLY";
        }

        public static string ReconSql(int ym, int alt)
        {
            var a = LineAlternatives().ElementAt(Math.Clamp(alt, 0, LineAlternatives().Count() - 1));
            return "SELECT COUNT(*) AS n, SUM(fl.ordered_qty) AS q, SUM(fl.extended_amount) AS a\n  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n WHERE " + MonthWhere(ym, a.Latest, a.Submitted);
        }

        public static string Root => SalesLensPaths.Data;
        private static string Raw(params string[] p) => Path.Combine(new[] { Root, "raw" }.Concat(p).ToArray());

        public static Dictionary<string, object> ReadManifest()
        {
            try
            {
                var f = Raw("manifest.json");
                if (File.Exists(f)) return JsonSerializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(f)) ?? new();
            }
            catch (Exception ex) { Debug.WriteLine("[SalesLens] manifest: " + ex.Message); }
            return new();
        }

        private static readonly object _manLock = new();
        private static void SaveManifest(Action<Dictionary<string, JsonElement>> change)
        {
            lock (_manLock)
            {
                var f = Raw("manifest.json");
                Directory.CreateDirectory(Path.GetDirectoryName(f));
                Dictionary<string, JsonElement> m;
                try { m = File.Exists(f) ? JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(f)) ?? new() : new(); }
                catch { m = new(); }
                change(m);
                File.WriteAllText(f + ".tmp", JsonSerializer.Serialize(m, new JsonSerializerOptions { WriteIndented = true }));
                File.Move(f + ".tmp", f, true);
            }
        }

        private static JsonElement J(object o) => JsonSerializer.SerializeToElement(o);

        private static void SetMonth(int ym, object entry) => SaveManifest(m =>
        {
            var months = m.TryGetValue("months", out var mm) && mm.ValueKind == JsonValueKind.Object
                ? JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(mm.GetRawText()) : new Dictionary<string, JsonElement>();
            months[ym.ToString(CultureInfo.InvariantCulture)] = J(entry);
            m["months"] = J(months);
        });

        private static void SetKey(string key, object value) => SaveManifest(m => m[key] = J(value));

        /// <summary>Months already on this PC (manifest + file).</summary>
        public static HashSet<int> MonthsOnPc()
        {
            var set = new HashSet<int>();
            var dir = Raw("lines");
            if (!Directory.Exists(dir)) return set;
            foreach (var f in Directory.GetFiles(dir, "*.jsonl"))
                if (int.TryParse(Path.GetFileNameWithoutExtension(f), out var ym)) set.Add(ym);
            return set;
        }

        private static string Key(Dictionary<string, object> r, string k)
        {
            foreach (var kv in r) if (string.Equals(kv.Key, k, StringComparison.OrdinalIgnoreCase)) return kv.Value == null ? null : Convert.ToString(kv.Value, CultureInfo.InvariantCulture);
            return null;
        }

        private static void WriteJsonl(string path, IEnumerable<Dictionary<string, object>> rows, bool append = false)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            using var w = new StreamWriter(path, append, new UTF8Encoding(false));
            foreach (var r in rows)
            {
                var up = r.ToDictionary(kv => kv.Key.ToUpperInvariant(), kv => kv.Value);
                w.WriteLine(JsonSerializer.Serialize(up));
            }
        }

        public static List<Dictionary<string, object>> ReadJsonl(string path)
        {
            var list = new List<Dictionary<string, object>>();
            if (!File.Exists(path)) return list;
            foreach (var line in File.ReadLines(path))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var d = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(line);
                    list.Add(d.ToDictionary(kv => kv.Key, kv => (object)(kv.Value.ValueKind switch
                    {
                        JsonValueKind.String => kv.Value.GetString(),
                        JsonValueKind.Number => kv.Value.GetDouble(),
                        JsonValueKind.Null => null,
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        _ => kv.Value.GetRawText()
                    })));
                }
                catch { /* a cut line */ }
            }
            return list;
        }

        /// <summary>Distinct values of one column over every month file.</summary>
        private static HashSet<string> Distinct(string col, Func<Dictionary<string, object>, bool> where = null)
        {
            var set = new HashSet<string>();
            var dir = Raw("lines");
            if (!Directory.Exists(dir)) return set;
            foreach (var f in Directory.GetFiles(dir, "*.jsonl"))
                foreach (var r in ReadJsonl(f))
                    if (where == null || where(r))
                    {
                        var v = Key(r, col);
                        if (!string.IsNullOrWhiteSpace(v)) set.Add(v.EndsWith(".0") ? v[..^2] : v);
                    }
            return set;
        }

        private static string Ids(IEnumerable<string> ids) => string.Join(", ", ids.Where(x => x.All(char.IsDigit)).Select(x => x));
        private static string Lits(IEnumerable<string> v) => string.Join(", ", v.Select(x => "'" + x.Replace("'", "''") + "'"));

        /// <summary>The first alternative Fusion accepts → its rows; every error kept for the log.</summary>
        private static async Task<(List<Dictionary<string, object>> Rows, int Alt, string Error)> FirstAsync(FinanceFusion.Runner run, IList<string> sqls, int cap, CancellationToken ct, Action<string> log)
        {
            string last = null;
            for (int i = 0; i < sqls.Count; i++)
            {
                ct.ThrowIfCancellationRequested();
                var r = await run(sqls[i], cap, ct).ConfigureAwait(false);
                if (r.Success) return (r.Rows, i, null);
                last = r.Error;
                log?.Invoke("   alternative " + (i + 1) + " refused: " + Short(r.Error));
            }
            return (null, -1, last);
        }

        private static string Short(string s) => string.IsNullOrEmpty(s) ? "" : (s.Length > 220 ? s.Substring(0, 220) + "…" : s);

        public static async Task<Result> RunAsync(FinanceFusion.Runner run, Options o, Action<string, string, string> step, Action<string> log, CancellationToken ct)
        {
            var res = new Result();
            Directory.CreateDirectory(Raw());
            SetKey("pod", string.IsNullOrWhiteSpace(o.Pod) ? "LOGGED-IN" : o.Pod.ToUpperInvariant());
            int lineAlt = -1;
            if (o.Kinds.Contains("lines"))
            {
                step("lines", "run", o.Months.Count + " month(s)");
                var have = MonthsOnPc();
                int done = 0, skipped = 0;
                long total = 0;
                foreach (var ym in o.Months.OrderBy(x => x))
                {
                    ct.ThrowIfCancellationRequested();
                    if (!o.Refresh && have.Contains(ym)) { skipped++; continue; }
                    var sw = Stopwatch.StartNew();
                    var tmp = Raw("lines", ym + ".jsonl.part");
                    if (File.Exists(tmp)) File.Delete(tmp);
                    long after = 0, rows = 0;
                    int size = Math.Clamp(o.PageSize, 200, 20000), page = 0;
                    while (true)
                    {
                        ct.ThrowIfCancellationRequested();
                        FusionQueryResult r = null;
                        if (lineAlt < 0)
                        {
                            int i = 0;
                            foreach (var _ in LineAlternatives())
                            {
                                r = await run(LinesSql(ym, i, after, size), size + 1, ct).ConfigureAwait(false);
                                if (r.Success) { lineAlt = i; log("Order lines: using query alternative " + (i + 1)); break; }
                                log("   order lines alternative " + (i + 1) + " refused: " + Short(r.Error));
                                i++;
                            }
                            if (lineAlt < 0) throw new InvalidOperationException("Fusion refused every order-line query: " + Short(r?.Error));
                        }
                        else
                        {
                            for (int attempt = 0; ; attempt++)
                            {
                                r = await run(LinesSql(ym, lineAlt, after, size), size + 1, ct).ConfigureAwait(false);
                                if (r.Success || attempt >= 3) break;
                                size = Math.Max(250, size / 2);           // a slow page: ask again for half
                                log("   page refused (" + Short(r.Error) + ") — asking again with " + size + " rows");
                            }
                            if (!r.Success) throw new InvalidOperationException(ym + ": " + Short(r.Error));
                        }
                        page++;
                        WriteJsonl(tmp, r.Rows, append: true);
                        rows += r.Rows.Count;
                        step("lines", "run", MonthText(ym) + " · page " + page + " · " + rows.ToString("N0", CultureInfo.InvariantCulture) + " lines");
                        if (r.Rows.Count < size) break;
                        var last = Key(r.Rows[^1], "FULFILL_LINE_ID");
                        if (!long.TryParse(last?.Split('.')[0], out after)) break;
                    }
                    // Fusion's own totals for the month, to check what was read
                    object fRows = null, fQty = null, fAmt = null;
                    var rc = await run(ReconSql(ym, lineAlt), 5, ct).ConfigureAwait(false);
                    if (rc.Success && rc.Rows.Count > 0)
                    {
                        fRows = Num(Key(rc.Rows[0], "N")); fQty = Num(Key(rc.Rows[0], "Q")); fAmt = Num(Key(rc.Rows[0], "A"));
                    }
                    File.Move(tmp, Raw("lines", ym + ".jsonl"), true);
                    SetMonth(ym, new { rows, fusionRows = fRows, fusionQty = fQty, fusionAmount = fAmt, readAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture), alt = lineAlt, ms = sw.ElapsedMilliseconds });
                    log(MonthText(ym) + ": " + rows.ToString("N0", CultureInfo.InvariantCulture) + " lines in " + (sw.ElapsedMilliseconds / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " s" +
                        (fRows != null && Convert.ToDouble(fRows, CultureInfo.InvariantCulture) != rows ? " — Fusion counts " + fRows + "!" : " — ties to Fusion"));
                    total += rows;
                    done++;
                }
                step("lines", "ok", done + " month(s) read · " + total.ToString("N0", CultureInfo.InvariantCulture) + " lines" + (skipped > 0 ? " · " + skipped + " already on this PC" : ""));
                res.Counts["lines"] = total;
                res.Counts["months"] = done;
            }

            async Task Soft(string kind, Func<Task<string>> work)
            {
                if (!o.Kinds.Contains(kind)) { step(kind, "skip", "not asked"); return; }
                try
                {
                    ct.ThrowIfCancellationRequested();
                    step(kind, "run", null);
                    var d = await work().ConfigureAwait(false);
                    step(kind, "ok", d);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    res.Errors.Add(kind + ": " + ex.Message);
                    step(kind, "warn", Short(ex.Message));
                    log(kind + " failed: " + ex.Message);
                }
            }

            await Soft("items", async () =>
            {
                var ids = Distinct("INVENTORY_ITEM_ID");
                var file = Raw("items.jsonl");
                var have = o.Refresh ? new HashSet<string>() : ReadJsonl(file).Select(r => Key(r, "INVENTORY_ITEM_ID")?.Split('.')[0]).Where(x => x != null).ToHashSet();
                var todo = ids.Where(x => !have.Contains(x)).ToList();
                var rows = o.Refresh ? new List<Dictionary<string, object>>() : ReadJsonl(file);
                string pc = SafeCol(o.ProfitCenterCol), su = SafeCol(o.SupplierCol);
                foreach (var chunk in Chunks(todo, 500))
                {
                    string desc = "(SELECT MAX(tl.description) FROM egp_system_items_tl tl WHERE tl.inventory_item_id = i.inventory_item_id AND tl.organization_id = i.organization_id AND tl.language = USERENV('LANG'))";
                    string one(bool full, bool dff) => "SELECT i.inventory_item_id, i.item_number, " + (full ? desc : "i.item_number") + " AS description, i.primary_uom_code AS primary_uom" +
                        (full ? ", i.inventory_item_status_code AS item_status, i.item_type" : "") +
                        (dff && pc != null ? ", i." + pc.ToLowerInvariant() + " AS profit_center" : "") + (dff && su != null ? ", i." + su.ToLowerInvariant() + " AS supplier" : "") +
                        "\n  FROM egp_system_items_b i\n WHERE i.inventory_item_id IN (" + Ids(chunk) + ")\n   AND i.organization_id = (SELECT MIN(i2.organization_id) FROM egp_system_items_b i2 WHERE i2.inventory_item_id = i.inventory_item_id)";
                    var (r, _, err) = await FirstAsync(run, new[] { one(true, true), one(false, true), one(true, false), one(false, false) }, 1000, ct, log).ConfigureAwait(false);
                    if (r == null) throw new InvalidOperationException(err);
                    rows.AddRange(r);
                }
                File.Delete(file + ".tmp");
                WriteJsonl(file + ".tmp", rows);
                File.Move(file + ".tmp", file, true);
                res.Counts["items"] = rows.Count;
                return rows.Count + " items (" + todo.Count + " new)";
            }).ConfigureAwait(false);

            await Soft("customers", async () =>
            {
                var accts = Distinct("ACCOUNT_NUMBER");
                var file = Raw("customers.jsonl");
                var have = o.Refresh ? new HashSet<string>() : ReadJsonl(file).Select(r => Key(r, "ACCOUNT_NUMBER")).Where(x => x != null).ToHashSet();
                var todo = accts.Where(x => !have.Contains(x)).ToList();
                var rows = o.Refresh ? new List<Dictionary<string, object>>() : ReadJsonl(file);
                foreach (var chunk in Chunks(todo, 400))
                {
                    string one(bool cls) => "SELECT ca.account_number, p.party_name AS customer_name, " + (cls ? "ca.customer_class_code" : "''") + " AS customer_class, ca.status, " +
                        D("ca.creation_date") + " AS created\n  FROM hz_cust_accounts ca\n  JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE ca.account_number IN (" + Lits(chunk) + ")";
                    var (r, _, err) = await FirstAsync(run, new[] { one(true), one(false) }, 1000, ct, log).ConfigureAwait(false);
                    if (r == null) throw new InvalidOperationException(err);
                    rows.AddRange(r);
                }
                WriteJsonl(file + ".tmp", rows);
                File.Move(file + ".tmp", file, true);
                res.Counts["customers"] = rows.Count;
                return rows.Count + " customers (" + todo.Count + " new)";
            }).ConfigureAwait(false);

            await Soft("costs", async () =>
            {
                var ids = Distinct("INVENTORY_ITEM_ID").ToList();
                (string T, string Item, string Cost)? src = null;
                if (o.CostSource is JsonElement cs && cs.ValueKind == JsonValueKind.Object)
                {
                    string t = SafeName(Str(cs, "table")), ic = SafeName(Str(cs, "itemCol")), cc = SafeName(Str(cs, "costCol"));
                    if (t != null && ic != null && cc != null) src = (t, ic, cc);
                }
                var cands = new List<(string, string, string)>();
                if (src.HasValue) cands.Add(src.Value);
                else
                {
                    var (cols, _, err) = await FirstAsync(run, new[] {
                        "SELECT table_name, column_name FROM all_tab_columns WHERE table_name LIKE 'CST%' AND column_name IN ('INVENTORY_ITEM_ID', 'ITEM_ID', " +
                        "'UNIT_COST', 'UNIT_COST_AVERAGE', 'PERPETUAL_AVG_COST', 'AVERAGE_UNIT_COST', 'AVERAGE_COST', 'ITEM_COST', 'STANDARD_COST', 'STD_COST', 'TOTAL_COST')" }, 5000, ct, log).ConfigureAwait(false);
                    if (cols == null) throw new InvalidOperationException("cost tables: " + err);
                    string[] costC = { "UNIT_COST_AVERAGE", "UNIT_COST", "PERPETUAL_AVG_COST", "AVERAGE_UNIT_COST", "AVERAGE_COST", "ITEM_COST", "STANDARD_COST", "STD_COST", "TOTAL_COST" };
                    foreach (var g in cols.GroupBy(r => Key(r, "TABLE_NAME")).Where(g => g.Key != null)
                                          .OrderBy(g => g.Key.Contains("PERPAVG") ? 0 : g.Key.Contains("AVG") ? 1 : g.Key.Contains("ITEM_COST") ? 2 : g.Key.Contains("STD") ? 3 : 5))
                    {
                        var c = g.Select(r => Key(r, "COLUMN_NAME")).ToHashSet();
                        string item = c.Contains("INVENTORY_ITEM_ID") ? "INVENTORY_ITEM_ID" : c.Contains("ITEM_ID") ? "ITEM_ID" : null;
                        string cost = costC.FirstOrDefault(c.Contains);
                        if (item != null && cost != null && SafeName(g.Key) != null) cands.Add((g.Key, item, cost));
                    }
                }
                var sample = ids.Take(300).ToList();
                foreach (var (t, item, cost) in cands.Take(8))
                {
                    ct.ThrowIfCancellationRequested();
                    var probe = await run("SELECT COUNT(*) AS n FROM " + t + " WHERE " + item + " IN (" + Ids(sample) + ") AND " + cost + " > 0", 5, ct).ConfigureAwait(false);
                    if (!probe.Success || probe.Rows.Count == 0 || Num(Key(probe.Rows[0], "N")) is not double n || n <= 0) { log("   cost table " + t + ": nothing usable"); continue; }
                    var rows = new List<Dictionary<string, object>>();
                    foreach (var chunk in Chunks(ids, 500))
                    {
                        var r = await run("SELECT " + item + " AS item_id, AVG(" + cost + ") AS unit_cost FROM " + t + " WHERE " + item + " IN (" + Ids(chunk) + ") AND " + cost + " > 0 GROUP BY " + item, 1000, ct).ConfigureAwait(false);
                        if (!r.Success) throw new InvalidOperationException(t + ": " + Short(r.Error));
                        rows.AddRange(r.Rows);
                    }
                    WriteJsonl(Raw("costs.jsonl.tmp"), rows);
                    File.Move(Raw("costs.jsonl.tmp"), Raw("costs.jsonl"), true);
                    res.CostSource = new { table = t, itemCol = item, costCol = cost };
                    res.Counts["costs"] = rows.Count;
                    return rows.Count + " item costs from " + t + "." + cost;
                }
                return "no cost table found — margins use the fallback %";
            }).ConfigureAwait(false);

            await Soft("bus", async () =>
            {
                var ids = Distinct("BU_ID").ToList();
                if (ids.Count == 0) return "none";
                var (r, _, err) = await FirstAsync(run, new[] {
                    "SELECT bu_id, bu_name FROM fun_all_business_units_v WHERE bu_id IN (" + Ids(ids) + ")",
                    "SELECT organization_id AS bu_id, name AS bu_name FROM hr_all_organization_units_f_vl WHERE organization_id IN (" + Ids(ids) + ")" }, 1000, ct, log).ConfigureAwait(false);
                if (r == null) throw new InvalidOperationException(err);
                WriteJsonl(Raw("bus.jsonl"), r);
                return r.Count + " business unit(s)";
            }).ConfigureAwait(false);

            await Soft("rates", async () =>
            {
                var rep = (o.ReportingCurrency ?? "MUR").ToUpperInvariant();
                var cur = Distinct("CURRENCY").Where(c => !string.Equals(c, rep, StringComparison.OrdinalIgnoreCase) && c.All(char.IsLetter) && c.Length == 3).ToList();
                if (cur.Count == 0) { WriteJsonl(Raw("rates.jsonl"), new List<Dictionary<string, object>>()); return "every line is in " + rep; }
                int months = Math.Max(12, o.Months.Count + 2);
                string one(string typeFilter) => "SELECT r.from_currency, TO_CHAR(r.conversion_date, 'YYYY-MM') AS month, AVG(r.conversion_rate) AS rate\n  FROM gl_daily_rates r\n" +
                    " WHERE r.to_currency = '" + rep + "' AND r.from_currency IN (" + Lits(cur) + ") AND r.conversion_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -" + months + ")" + typeFilter +
                    "\n GROUP BY r.from_currency, TO_CHAR(r.conversion_date, 'YYYY-MM')";
                var (r, _, err) = await FirstAsync(run, new[] {
                    one(" AND r.conversion_type IN ('Corporate', (SELECT MIN(t.conversion_type) FROM gl_daily_conversion_types t WHERE t.user_conversion_type = 'Corporate'))"), one("") }, 20000, ct, log).ConfigureAwait(false);
                if (r == null) throw new InvalidOperationException(err);
                WriteJsonl(Raw("rates.jsonl"), r);
                return r.Count + " monthly rate(s) for " + string.Join(", ", cur);
            }).ConfigureAwait(false);

            await Soft("uom", async () =>
            {
                var ids = Distinct("INVENTORY_ITEM_ID").ToList();
                var rows = new List<Dictionary<string, object>>();
                var std = await run("SELECT 0 AS item_id, uom_code, conversion_rate AS rate FROM inv_uom_conversions WHERE inventory_item_id = 0", 20000, ct).ConfigureAwait(false);
                if (!std.Success) throw new InvalidOperationException(Short(std.Error));
                rows.AddRange(std.Rows);
                foreach (var chunk in Chunks(ids, 500))
                {
                    var r = await run("SELECT inventory_item_id AS item_id, uom_code, conversion_rate AS rate FROM inv_uom_conversions WHERE inventory_item_id IN (" + Ids(chunk) + ")", 20000, ct).ConfigureAwait(false);
                    if (r.Success) rows.AddRange(r.Rows);
                }
                WriteJsonl(Raw("uom.jsonl"), rows);
                return rows.Count + " conversion(s)";
            }).ConfigureAwait(false);

            await Soft("onhand", async () =>
            {
                var cutoff = DateTime.Today.AddMonths(-3).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                var ids = Distinct("INVENTORY_ITEM_ID", r => string.CompareOrdinal(Key(r, "ORDERED_DATE") ?? "", cutoff) >= 0).ToList();
                var file = Raw("onhand", DateTime.Today.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + ".jsonl");
                var rows = new List<Dictionary<string, object>>();
                foreach (var chunk in Chunks(ids, 500))
                {
                    var r = await run("SELECT oh.inventory_item_id AS item_id, oh.organization_id AS org_id, SUM(oh.transaction_quantity) AS qty\n  FROM inv_onhand_quantities_detail oh\n WHERE oh.inventory_item_id IN (" +
                                      Ids(chunk) + ")\n GROUP BY oh.inventory_item_id, oh.organization_id", 50000, ct).ConfigureAwait(false);
                    if (!r.Success) throw new InvalidOperationException(Short(r.Error));
                    var seen = r.Rows.Select(x => Key(x, "ITEM_ID")?.Split('.')[0]).ToHashSet();
                    rows.AddRange(r.Rows);
                    foreach (var id in chunk.Where(x => !seen.Contains(x)))      // nothing on hand anywhere = 0 (a stock-out today)
                        rows.Add(new Dictionary<string, object> { ["ITEM_ID"] = id, ["ORG_ID"] = null, ["QTY"] = 0 });
                }
                WriteJsonl(file, rows);
                int zero = rows.GroupBy(x => Key(x, "ITEM_ID")?.Split('.')[0]).Count(g => g.Sum(x => Num(Key(x, "QTY")) is double q ? q : 0) <= 0);
                return ids.Count + " items · " + zero + " with nothing on hand";
            }).ConfigureAwait(false);

            await Soft("ar", async () =>
            {
                string one(bool hold) => "SELECT ca.account_number, SUM(ps.amount_due_remaining) AS due,\n" +
                    "       SUM(CASE WHEN ps.due_date < TRUNC(SYSDATE) THEN ps.amount_due_remaining END) AS overdue,\n" +
                    "       SUM(CASE WHEN ps.due_date < TRUNC(SYSDATE) - 90 THEN ps.amount_due_remaining END) AS over90" +
                    (hold ? ",\n       MAX((SELECT MAX(pr.credit_hold) FROM hz_customer_profiles_f pr WHERE pr.cust_account_id = ca.cust_account_id)) AS credit_hold" : "") +
                    ", " + D("TRUNC(SYSDATE)") + " AS as_of\n  FROM ar_payment_schedules_all ps\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = ps.customer_id\n WHERE ps.status = 'OP'\n GROUP BY ca.account_number";
                var (r, _, err) = await FirstAsync(run, new[] { one(true), one(false) }, 200000, ct, log).ConfigureAwait(false);
                if (r == null) throw new InvalidOperationException(err);
                WriteJsonl(Raw("ar.jsonl"), r);
                return r.Count + " customer balance(s)";
            }).ConfigureAwait(false);

            SetKey("readAt", DateTime.Now.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture));
            res.Ok = !res.Errors.Any(e => e.StartsWith("lines", StringComparison.Ordinal));
            return res;
        }

        public static string MonthText(int ym) => new DateTime(ym / 100, ym % 100, 1).ToString("MMM-yy", CultureInfo.InvariantCulture);

        private static object Num(string s) => double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
        private static string Str(JsonElement e, string n) => e.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        private static string SafeName(string s) => !string.IsNullOrWhiteSpace(s) && System.Text.RegularExpressions.Regex.IsMatch(s, "^[A-Za-z][A-Za-z0-9_$#]{0,60}$") ? s.ToUpperInvariant() : null;
        private static string SafeCol(string s) => !string.IsNullOrWhiteSpace(s) && System.Text.RegularExpressions.Regex.IsMatch(s, "^ATTRIBUTE(_CHAR)?\\d{1,2}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase) ? s.ToUpperInvariant() : null;
        private static IEnumerable<List<string>> Chunks(IEnumerable<string> src, int n)
        {
            var b = new List<string>(n);
            foreach (var x in src) { b.Add(x); if (b.Count == n) { yield return b; b = new List<string>(n); } }
            if (b.Count > 0) yield return b;
        }
    }

    /// <summary>Where Sales Lens keeps its files on this PC (env SALESLENS_ROOT for tests).</summary>
    public static class SalesLensPaths
    {
        public static string Home
        {
            get
            {
                var env = Environment.GetEnvironmentVariable("SALESLENS_ROOT");
                return string.IsNullOrWhiteSpace(env) ? @"C:\fusion\saleslens" : env;
            }
        }
        public static string Data => Path.Combine(Home, "data");
        public static string Db => Path.Combine(Data, "saleslens.duckdb");
        public static string Settings => Path.Combine(Data, "settings.json");
    }
}

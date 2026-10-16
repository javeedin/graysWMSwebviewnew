using System.Diagnostics;
using System.Globalization;
using FusionModel.Semantic;

namespace FusionModel
{
    public sealed class CheckResult
    {
        public string Name { get; set; }
        public string Description { get; set; }
        public string Folder { get; set; }
        /// <summary>PASS · FAIL · ERROR · EMPTY (no rows to compare).</summary>
        public string Status { get; set; }
        public string Error { get; set; }
        public int Groups { get; set; }
        public int Failing { get; set; }
        /// <summary>Groups not compared because one side is blank (BothSides checks).</summary>
        public int Skipped { get; set; }
        public double? LeftTotal { get; set; }
        public double? RightTotal { get; set; }
        public List<string> Columns { get; set; } = new();
        /// <summary>The failing groups (at most 100): by-values…, left, right, difference.</summary>
        public List<object[]> Rows { get; set; } = new();
        public string Query { get; set; }
        public long Ms { get; set; }
    }

    /// <summary>Reconciliation checks: two measures compared for every group (subledger vs GL, journals vs balances …).</summary>
    public sealed partial class ModelEngine
    {
        public List<CheckResult> RunChecks(string user, IEnumerable<string> names = null, IList<FilterSpec> filters = null)
        {
            var model = LoadModelForRead();
            var want = names == null ? null : new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
            var list = new List<CheckResult>();
            foreach (var c in model.Checks ?? new())
                if (want == null || want.Contains(c.Name)) list.Add(RunCheck(c, user, filters));
            return list;
        }

        public CheckResult RunCheck(CheckDef c, string user, IList<FilterSpec> filters = null)
        {
            var sw = Stopwatch.StartNew();
            var r = new CheckResult { Name = c.Name, Description = c.Description, Folder = c.Folder };
            if (string.IsNullOrWhiteSpace(c.Left) || string.IsNullOrWhiteSpace(c.Right))
            { r.Status = "ERROR"; r.Error = "Write both sides of the check (Left and Right)."; return r; }
            string left = string.IsNullOrWhiteSpace(c.LeftLabel) ? "Left" : c.LeftLabel, right = string.IsNullOrWhiteSpace(c.RightLabel) ? "Right" : c.RightLabel;
            if (left == right) right += " ";
            var req = new SemanticRequest { GroupBy = (c.By ?? new()).ToList(), Filters = filters?.ToList() ?? new(), Top = 100_000, Totals = (c.By ?? new()).Count > 0 };
            req.Measures.Add(new MeasureSpec { Name = left, Expression = c.Left });
            req.Measures.Add(new MeasureSpec { Name = right, Expression = c.Right });
            r.Query = "EVALUATE SUMMARIZECOLUMNS(" + string.Join("", req.GroupBy.Select(g => g + ", ")) + Quote(left) + ", " + c.Left + ", " + Quote(right) + ", " + c.Right + ")";
            try
            {
                var res = Evaluate(req, user);
                int nb = req.GroupBy.Count;
                r.Columns = res.Columns.Take(nb).Select(x => x.Name).Concat(new[] { left, right, "Difference" }).ToList();
                double tol = Math.Abs(c.Tolerance);
                foreach (var row in res.Rows)
                {
                    if (c.BothSides && (row[nb] == null || row[nb + 1] == null)) { r.Skipped++; continue; }
                    double l = Num(row[nb]), rt = Num(row[nb + 1]), d = l - rt;
                    r.Groups++;
                    bool ok = (c.Op ?? "=") switch { "<=" => l <= rt + tol, ">=" => l >= rt - tol, _ => Math.Abs(d) <= tol };
                    if (ok) continue;
                    r.Failing++;
                    if (r.Rows.Count < 100) r.Rows.Add(row.Take(nb).Concat(new object[] { row[nb], row[nb + 1], Math.Round(d, 4) }).ToArray());
                }
                if (res.Totals != null) { r.LeftTotal = NumOrNull(res.Totals[nb]); r.RightTotal = NumOrNull(res.Totals[nb + 1]); }
                else if (res.Rows.Count == 1 && nb == 0) { r.LeftTotal = NumOrNull(res.Rows[0][0]); r.RightTotal = NumOrNull(res.Rows[0][1]); }
                // biggest differences first
                r.Rows = r.Rows.OrderByDescending(x => Math.Abs(Num(x[^1]))).ToList();
                r.Status = r.Groups == 0 ? "EMPTY" : r.Failing == 0 ? "PASS" : "FAIL";
            }
            catch (MeasureException ex) when (ex.Message.Contains("not loaded yet"))
            {
                // a pack added but not refreshed yet is not an error in the books
                r.Status = "EMPTY"; r.Error = "Not loaded yet - refresh its module first (" + ex.Message + ")";
            }
            catch (Exception ex) { r.Status = "ERROR"; r.Error = ex.Message; }
            r.Ms = sw.ElapsedMilliseconds;
            return r;
        }

        private static string Quote(string s) => "\"" + s.Replace("\"", "\"\"") + "\"";
        private static double Num(object v) => v == null ? 0 : Convert.ToDouble(v, CultureInfo.InvariantCulture);
        private static double? NumOrNull(object v) => v == null ? null : Convert.ToDouble(v, CultureInfo.InvariantCulture);
    }
}

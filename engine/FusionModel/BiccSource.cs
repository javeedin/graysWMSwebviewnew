using System.Globalization;
using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;

namespace FusionModel
{
    /// <summary>
    /// Oracle BI Cloud Connector (BICC) extracts dropped in a folder (or synced from UCM / object storage): CSV files or
    /// ZIPs of CSVs, e.g. file_fscmtopmodelam_finextractam_glbiccextractam_balanceextractpvo-batch123-20261001_060000.zip.
    /// Source.Path = a folder or a file pattern (wildcards in the file name). Newest file wins: rows are read newest file
    /// first and a key seen once is skipped afterwards, so a full extract plus later incremental extracts give one row
    /// per key. Incremental loads skip files older than the watermark (less 2 days) and rows whose incremental column is
    /// older than watermark − overlap. Source.Rename maps file columns to model columns.
    /// </summary>
    public sealed class BiccSource : ISource
    {
        public string Kind => "bicc";
        public int PageSize { get; set; } = 5000;
        private static readonly Regex IsoLike = new(@"^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$", RegexOptions.Compiled);

        public Task<long?> CountAsync(ReadRequest request, CancellationToken ct) => Task.FromResult<long?>(null);

        public static List<FileInfo> Files(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("A BICC table needs a folder or file pattern (Source.Path).");
            string dir = Directory.Exists(path) ? path : Path.GetDirectoryName(path);
            string pattern = Directory.Exists(path) ? "*" : Path.GetFileName(path);
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) throw new DirectoryNotFoundException("BICC folder not found: " + dir);
            return new DirectoryInfo(dir).GetFiles(pattern)
                .Where(f => f.Extension.Equals(".csv", StringComparison.OrdinalIgnoreCase) || f.Extension.Equals(".zip", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(f => f.LastWriteTimeUtc).ThenByDescending(f => f.Name, StringComparer.Ordinal).ToList();
        }

        public async IAsyncEnumerable<RowPage> ReadAsync(ReadRequest req, [EnumeratorCancellation] CancellationToken ct)
        {
            var t = req.Table;
            var rename = t.Source?.Rename ?? new Dictionary<string, string>();
            var dateCols = new HashSet<string>((t.ColumnTypes ?? new()).Where(kv => kv.Value != null && (kv.Value.StartsWith("DATE", StringComparison.OrdinalIgnoreCase) || kv.Value.StartsWith("TIMESTAMP", StringComparison.OrdinalIgnoreCase))).Select(kv => kv.Key), StringComparer.OrdinalIgnoreCase);
            DateTime? since = null;
            if (!string.IsNullOrEmpty(req.Watermark) && DateTime.TryParse(req.Watermark, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var wm))
                since = wm.AddMinutes(-Math.Max(0, t.OverlapMinutes));
            var seen = t.Key?.Count > 0 ? new HashSet<string>(StringComparer.Ordinal) : null;
            var page = new RowPage();
            foreach (var file in Files(t.Source.Path))
            {
                ct.ThrowIfCancellationRequested();
                if (since != null && file.LastWriteTime < since.Value.AddDays(-2)) continue;
                foreach (var (name, open) in Entries(file))
                {
                    req.Note?.Invoke("BICC " + file.Name + (name == file.Name ? "" : " › " + name));
                    using var reader = new StreamReader(open(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
                    string[] header = null;
                    foreach (var fields in Csv(reader))
                    {
                        if (header == null) { header = fields.Select(h => rename.TryGetValue(h.Trim(), out var to) ? to : h.Trim()).ToArray(); continue; }
                        var row = new Dictionary<string, object>(header.Length, StringComparer.OrdinalIgnoreCase);
                        for (int i = 0; i < header.Length; i++)
                        {
                            string v = i < fields.Count ? fields[i] : null;
                            if (string.IsNullOrEmpty(v)) { row[header[i]] = null; continue; }
                            row[header[i]] = dateCols.Contains(header[i]) ? NormDate(v) : v;
                        }
                        if (since != null && !string.IsNullOrWhiteSpace(t.IncrementalColumn) && row.TryGetValue(t.IncrementalColumn, out var iv) && iv is string s &&
                            DateTime.TryParse(NormDate(s), CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var rowTime) && rowTime < since.Value) continue;
                        if (seen != null && !seen.Add(string.Join("\u0001", t.Key.Select(k => row.TryGetValue(k, out var kv) ? kv as string : null)))) continue;
                        page.Rows.Add(row);
                        if (page.Rows.Count >= PageSize) { yield return page; page = new RowPage(); await Task.Yield(); }
                    }
                }
            }
            if (page.Rows.Count > 0) yield return page;
        }

        /// <summary>The CSVs in a file: itself, or every .csv inside a .zip (MANIFEST files skipped).</summary>
        private static IEnumerable<(string Name, Func<Stream> Open)> Entries(FileInfo f)
        {
            if (!f.Extension.Equals(".zip", StringComparison.OrdinalIgnoreCase)) { yield return (f.Name, () => f.OpenRead()); yield break; }
            using var zip = ZipFile.OpenRead(f.FullName);
            foreach (var e in zip.Entries.Where(e => e.Name.EndsWith(".csv", StringComparison.OrdinalIgnoreCase)).OrderBy(e => e.Name, StringComparer.Ordinal))
            {
                var entry = e;
                yield return (f.Name + "/" + entry.Name, () => entry.Open());
            }
        }

        /// <summary>2026/10/01, 2026-10-01T06:00:00.000+00:00 … → 2026-10-01 06:00:00 (what DuckDB casts).</summary>
        public static string NormDate(string v)
        {
            var m = IsoLike.Match(v.Trim());
            if (!m.Success) return v;
            string d = m.Groups[1].Value + "-" + m.Groups[2].Value + "-" + m.Groups[3].Value;
            return m.Groups[4].Success ? d + " " + m.Groups[4].Value + ":" + m.Groups[5].Value + ":" + (m.Groups[6].Success ? m.Groups[6].Value : "00") : d;
        }

        /// <summary>RFC 4180 records: quoted fields, doubled quotes, line breaks inside quotes.</summary>
        public static IEnumerable<List<string>> Csv(TextReader r)
        {
            var fields = new List<string>();
            var sb = new StringBuilder();
            bool quoted = false, any = false;
            int c;
            while ((c = r.Read()) != -1)
            {
                char ch = (char)c;
                any = true;
                if (quoted)
                {
                    if (ch == '"') { if (r.Peek() == '"') { r.Read(); sb.Append('"'); } else quoted = false; }
                    else sb.Append(ch);
                    continue;
                }
                switch (ch)
                {
                    case '"': quoted = true; break;
                    case ',': fields.Add(sb.ToString()); sb.Clear(); break;
                    case '\r': break;
                    case '\n':
                        fields.Add(sb.ToString()); sb.Clear();
                        yield return fields; fields = new List<string>(); any = false;
                        break;
                    default: sb.Append(ch); break;
                }
            }
            if (any) { fields.Add(sb.ToString()); yield return fields; }
        }
    }
}

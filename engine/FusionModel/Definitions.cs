using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace FusionModel
{
    /// <summary>
    /// The model definition, shared by every PC (model.json in the shared folder): modules (one DuckDB file each)
    /// and tables (where their rows come from and how they are refreshed).
    /// </summary>
    public sealed class ModelDefinition
    {
        public int Version { get; set; } = 1;
        public List<ModuleDef> Modules { get; set; } = new();
        public List<TableDef> Tables { get; set; } = new();

        public ModuleDef Module(string name) => Modules.FirstOrDefault(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase));
        public TableDef Table(string module, string name) =>
            Tables.FirstOrDefault(t => string.Equals(t.Module, module, StringComparison.OrdinalIgnoreCase) && string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));

        /// <summary>Problems that stop a publish; empty = valid.</summary>
        public List<string> Validate()
        {
            var errors = new List<string>();
            foreach (var m in Modules)
                if (!Names.IsValid(m.Name)) errors.Add($"Module name '{m.Name}' must be lowercase letters, digits and _ (start with a letter).");
            foreach (var dup in Modules.GroupBy(m => m.Name, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
                errors.Add($"Module '{dup.Key}' is defined twice.");
            foreach (var t in Tables)
            {
                string where = $"{t.Module}.{t.Name}";
                if (!Names.IsValid(t.Name)) errors.Add($"Table name '{t.Name}' must be lowercase letters, digits and _ (start with a letter).");
                if (Module(t.Module) == null) errors.Add($"{where}: module '{t.Module}' does not exist.");
                if (t.Source == null || string.IsNullOrWhiteSpace(t.Source.Kind)) errors.Add($"{where}: no source.");
                else if (t.Source.Kind != "file" && string.IsNullOrWhiteSpace(t.Source.Sql)) errors.Add($"{where}: the source SQL is empty.");
                if (t.Strategy == LoadStrategy.Window)
                {
                    if (string.IsNullOrWhiteSpace(t.WindowColumn)) errors.Add($"{where}: a window table needs a date column (e.g. ACCOUNTING_DATE).");
                    if (t.WindowMonths < 1 || t.WindowMonths > 120) errors.Add($"{where}: window months must be 1–120.");
                }
                if (t.Strategy == LoadStrategy.Incremental)
                {
                    if (t.Key == null || t.Key.Count == 0) errors.Add($"{where}: an incremental table needs a key.");
                    if (string.IsNullOrWhiteSpace(t.IncrementalColumn)) errors.Add($"{where}: an incremental table needs an incremental column (e.g. LAST_UPDATE_DATE).");
                }
            }
            foreach (var dup in Tables.GroupBy(t => t.Module + "." + t.Name, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
                errors.Add($"Table '{dup.Key}' is defined twice.");
            return errors;
        }
    }

    public sealed class ModuleDef
    {
        public string Name { get; set; }                 // file name: gl, ap, wms …
        public string Title { get; set; }
        public string Description { get; set; }
        public ScheduleDef Schedule { get; set; } = new();
    }

    public sealed class ScheduleDef
    {
        public string Mode { get; set; } = "MANUAL";     // MANUAL, HOURLY, DAILY
        public string Time { get; set; } = "06:00";      // HH:mm for DAILY (refresher PC's local time)
    }

    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum LoadStrategy { Full, Incremental, Window }

    public sealed class TableDef
    {
        public string Module { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public SourceDef Source { get; set; } = new();
        public LoadStrategy Strategy { get; set; } = LoadStrategy.Full;
        public List<string> Key { get; set; } = new();
        /// <summary>Source column that grows on every change (LAST_UPDATE_DATE); rows newer than the watermark − overlap are reloaded.</summary>
        public string IncrementalColumn { get; set; }
        public int OverlapMinutes { get; set; } = 60;
        /// <summary>Rows per request to the source; 0 = the source's default.</summary>
        public int PageSize { get; set; }
        /// <summary>Optional declared types (column → DuckDB type); others are detected from the data.</summary>
        public Dictionary<string, string> ColumnTypes { get; set; } = new();
        /// <summary>Window strategy: the date column and how many months (current month included) are reloaded each time.</summary>
        public string WindowColumn { get; set; }
        public int WindowMonths { get; set; } = 3;
        /// <summary>auto (keyset when there is exactly one key column), keyset or rownum.</summary>
        public string Paging { get; set; } = "auto";
        /// <summary>Compare the source's COUNT(*) with the rows loaded (full loads).</summary>
        public bool CountCheck { get; set; }

        public bool UsesKeyset => Key != null && Key.Count == 1 && !string.Equals(Paging, "rownum", StringComparison.OrdinalIgnoreCase);

        /// <summary>Changes when anything that affects the rows changes (resuming a half-finished load is only safe for the same definition).</summary>
        public string DefinitionHash()
        {
            string raw = string.Join("\u0001", Source?.Kind, Source?.Sql, Source?.Path, Strategy, string.Join(",", Key ?? new()), IncrementalColumn, WindowColumn, WindowMonths, Paging);
            return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw))).Substring(0, 16);
        }
    }

    public sealed class SourceDef
    {
        public string Kind { get; set; }                 // apex, fusion, file
        public string Sql { get; set; }
        public string Path { get; set; }                 // file sources: csv / parquet / json path
    }

    /// <summary>This PC's own settings (not shared).</summary>
    public sealed class EngineSettings
    {
        /// <summary>Folder every PC can reach: model.json, manifest.json, modules\*.duckdb.</summary>
        public string SharedRoot { get; set; }
        /// <summary>Local copies of the module files (CACHE read mode).</summary>
        public string CacheRoot { get; set; }
        public string ReadMode { get; set; } = "CACHE";  // CACHE or DIRECT
        /// <summary>This PC runs scheduled refreshes and publishes (one refresher at a time, by lease).</summary>
        public bool IsRefresher { get; set; }
        /// <summary>Old module versions are deleted after this many hours.</summary>
        public int RetainHours { get; set; } = 6;
    }

    /// <summary>manifest.json - which version of each module file is current.</summary>
    public sealed class Manifest
    {
        public int Revision { get; set; }
        public DateTime UpdatedUtc { get; set; }
        public Dictionary<string, ModuleEntry> Modules { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    public sealed class ModuleEntry
    {
        public string File { get; set; }                 // modules\gl_20261001_060000.duckdb (relative to the shared root)
        public string Version { get; set; }              // 20261001_060000
        public DateTime PublishedUtc { get; set; }
        public string PublishedBy { get; set; }
        public long Bytes { get; set; }
        public Dictionary<string, TableState> Tables { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    public sealed class TableState
    {
        public long Rows { get; set; }
        public string Watermark { get; set; }
        public DateTime LoadedUtc { get; set; }
        public long LastLoadedRows { get; set; }
        public long LastMs { get; set; }
        public double RowsPerSecond { get; set; }
        public string LastMode { get; set; }             // full, incremental, window, resumed
        /// <summary>COUNT(*) at the source for the last full load (null = not checked).</summary>
        public long? SourceCount { get; set; }
        public List<string> Drift { get; set; } = new();  // column changes seen in the last load
        public List<ColumnInfo> Columns { get; set; } = new();
    }

    public sealed class ColumnInfo
    {
        public string Name { get; set; }
        public string Type { get; set; }
    }

    public static class Names
    {
        private static readonly Regex Ident = new(@"^[a-z][a-z0-9_]{0,59}$");
        public static bool IsValid(string s) => s != null && Ident.IsMatch(s);
        /// <summary>A double-quoted SQL identifier (DuckDB and Oracle).</summary>
        public static string Q(string s) => "\"" + (s ?? "").Replace("\"", "\"\"") + "\"";
        public static string Lit(string s) => "'" + (s ?? "").Replace("'", "''") + "'";
    }

    public static class Json
    {
        public static readonly JsonSerializerOptions Options = new()
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
        };

        public static T Read<T>(string path) where T : class =>
            File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options) : null;

        /// <summary>Write to a temp file, then replace: readers never see a half-written file.</summary>
        public static void WriteAtomic(string path, object value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
            string tmp = path + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(value, Options));
            File.Move(tmp, path, overwrite: true);
        }
    }
}

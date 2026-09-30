using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DuckDB.NET.Data;

namespace FusionModel
{
    /// <summary>
    /// The Fusion Model engine: one writer builds each module into a new versioned DuckDB file and publishes it through
    /// manifest.json; readers attach the current files read-only (from a local cache or straight from the shared folder)
    /// and query across modules in one session.
    ///
    /// Shared folder layout:  model.json · manifest.json · refresher.lock · refresh_log.jsonl · modules\{module}_{version}.duckdb
    /// </summary>
    public sealed partial class ModelEngine : IDisposable
    {
        private readonly string _settingsPath;
        private readonly Dictionary<string, ISource> _sources = new(StringComparer.OrdinalIgnoreCase);
        private readonly SemaphoreSlim _buildGate = new(1, 1);
        private readonly object _sessionLock = new();
        private DuckDBConnection _session;
        private string _sessionKey;
        private Timer _timer;
        private volatile string _building;

        public EngineSettings Settings { get; private set; }
        public string Machine { get; } = Environment.MachineName;

        public ModelEngine(string settingsPath, EngineSettings defaults = null)
        {
            _settingsPath = settingsPath;
            Settings = Json.Read<EngineSettings>(settingsPath) ?? defaults ?? new EngineSettings();
            Settings.SharedRoot ??= defaults?.SharedRoot;
            Settings.CacheRoot ??= defaults?.CacheRoot ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FusionModel", "cache");
            RegisterSource(new BiccSource());            // BICC extract folders need nothing from the host
        }

        // ── settings and paths ───────────────────────────────────────
        public void SaveSettings(EngineSettings s)
        {
            if (string.IsNullOrWhiteSpace(s.SharedRoot)) throw new ArgumentException("The shared folder is required.");
            s.ReadMode = string.Equals(s.ReadMode, "DIRECT", StringComparison.OrdinalIgnoreCase) ? "DIRECT" : "CACHE";
            s.RetainHours = Math.Clamp(s.RetainHours, 1, 24 * 14);
            if (string.IsNullOrWhiteSpace(s.CacheRoot)) s.CacheRoot = Settings.CacheRoot;
            Settings = s;
            Json.WriteAtomic(_settingsPath, s);
            ResetSession();
        }

        private string Root => Settings.SharedRoot ?? throw new InvalidOperationException("Set the shared folder first (Settings).");
        public string ModelPath => Path.Combine(Root, "model.json");
        public string ManifestPath => Path.Combine(Root, "manifest.json");
        private string ModulesDir => Path.Combine(Root, "modules");
        private string LockPath => Path.Combine(Root, "refresher.lock");
        private string LogPath => Path.Combine(Root, "refresh_log.jsonl");
        private string CacheManifestPath => Path.Combine(Settings.CacheRoot, "manifest.json");
        public bool SharedReachable => !string.IsNullOrWhiteSpace(Settings.SharedRoot) && Directory.Exists(Settings.SharedRoot);

        public void RegisterSource(ISource source) => _sources[source.Kind] = source;

        // ── model and manifest ───────────────────────────────────────
        public ModelDefinition LoadModel() => Json.Read<ModelDefinition>(ModelPath) ?? new ModelDefinition();

        public void SaveModel(ModelDefinition model)
        {
            var errors = model.Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors));
            Directory.CreateDirectory(Root);
            model.Version++;
            Json.WriteAtomic(ModelPath, model);
        }

        /// <summary>
        /// Adds (or with <paramref name="replace"/> replaces) one table in the model, creating its module when needed - what
        /// Fusion SQL's "Send to Fusion Model" does. Only this table's problems stop it.
        /// </summary>
        public ModelDefinition AddTable(TableDef t, string moduleTitle, bool replace)
        {
            if (t == null || !Names.IsValid(t.Module) || !Names.IsValid(t.Name))
                throw new ArgumentException("Module and table names: lowercase letters, digits and _ (start with a letter).");
            var model = LoadModel();
            if (model.Module(t.Module) == null)
                model.Modules.Add(new ModuleDef { Name = t.Module, Title = string.IsNullOrWhiteSpace(moduleTitle) ? t.Module : moduleTitle.Trim() });
            var old = model.Table(t.Module, t.Name);
            if (old != null && !replace) throw new InvalidOperationException("Table " + t.Module + "." + t.Name + " already exists - choose another name or replace it.");
            if (old != null) model.Tables.Remove(old);
            model.Tables.Add(t);
            var mine = model.Validate().Where(e => e.StartsWith(t.Module + "." + t.Name + ":", StringComparison.OrdinalIgnoreCase) || e.Contains("'" + t.Name + "'")).ToList();
            if (mine.Count > 0) throw new InvalidOperationException(string.Join("\n", mine));
            SaveModel(model);
            return model;
        }

        public Manifest LoadManifest() =>
            (SharedReachable ? Json.Read<Manifest>(ManifestPath) : Json.Read<Manifest>(CacheManifestPath)) ?? new Manifest();

        // ── refresh (the writer) ─────────────────────────────────────
        public string Building => _building;

        /// <summary>
        /// Loads the tables of one module into a new version of its file and publishes it. Incremental tables merge the
        /// rows changed since their watermark; <paramref name="full"/> reloads everything.
        /// </summary>
        public async Task<BuildResult> RefreshAsync(string module, IList<string> tables, bool full, string by, IProgress<string> progress, CancellationToken ct)
        {
            if (!await _buildGate.WaitAsync(0, ct).ConfigureAwait(false))
                throw new InvalidOperationException("A refresh is already running on this PC (" + _building + ").");
            var result = new BuildResult { Module = module };
            string building = null;
            Lease lease = null;
            var sw = Stopwatch.StartNew();
            try
            {
                var model = LoadModel();
                var mod = model.Module(module) ?? throw new InvalidOperationException("No module " + module);
                var errors = model.Validate().Where(e => e.StartsWith(module + ".", StringComparison.OrdinalIgnoreCase) || !e.Contains('.')).ToList();
                if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors));
                var todo = model.Tables.Where(t => string.Equals(t.Module, module, StringComparison.OrdinalIgnoreCase) &&
                                                   (tables == null || tables.Count == 0 || tables.Contains(t.Name, StringComparer.OrdinalIgnoreCase))).ToList();
                if (todo.Count == 0) throw new InvalidOperationException("Module " + module + " has no tables to refresh.");

                lease = Lease.Acquire(LockPath, Machine, TimeSpan.FromMinutes(45));
                var manifest = LoadManifest();
                manifest.Modules.TryGetValue(module, out var current);
                Directory.CreateDirectory(ModulesDir);
                string version = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff", CultureInfo.InvariantCulture);
                for (int n = 2; File.Exists(Path.Combine(ModulesDir, module + "_" + version + ".duckdb")); n++)
                    version = DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff", CultureInfo.InvariantCulture) + "_" + n;
                string rel = Path.Combine("modules", module + "_" + version + ".duckdb");
                string abs = Path.Combine(Root, rel);
                building = abs + ".building";
                string currentAbs = current != null ? Path.Combine(Root, current.File) : null;
                if (currentAbs != null && File.Exists(currentAbs)) File.Copy(currentAbs, building, true);
                var states = new Dictionary<string, TableState>(current?.Tables ?? new Dictionary<string, TableState>(), StringComparer.OrdinalIgnoreCase);

                using (var conn = new DuckDBConnection("Data Source=" + building))
                {
                    conn.Open();
                    foreach (var t in todo)
                    {
                        ct.ThrowIfCancellationRequested();
                        lease.Renew();
                        _building = module + "." + t.Name;
                        var tsw = Stopwatch.StartNew();
                        states.TryGetValue(t.Name, out var st);
                        bool exists = TableExists(conn, t.Name);
                        // the load mode for this run: the first load of any table is always full
                        string mode = full || !exists ? "full"
                            : t.Strategy == LoadStrategy.Incremental && !string.IsNullOrEmpty(st?.Watermark) ? "incremental"
                            : t.Strategy == LoadStrategy.Window ? "window" : "full";
                        var req = new ReadRequest { Table = t, Watermark = mode == "incremental" ? st.Watermark : null };
                        if (mode == "window")
                        {
                            var now = DateTime.Now;
                            req.WindowStart = new DateTime(now.Year, now.Month, 1).AddMonths(-(Math.Clamp(t.WindowMonths, 1, 120) - 1));
                        }
                        var notes = new List<string>();
                        req.Note = n => { lock (notes) notes.Add(n); progress?.Report($"{t.Name}: {n}"); };
                        progress?.Report($"{t.Name}: {(mode == "incremental" ? "changes since " + st.Watermark : mode == "window" ? "months from " + req.WindowStart.Value.ToString("yyyy-MM") : "full load")}…");
                        try
                        {
                            var staged = await StageAsync(conn, module, t, req, mode, n => progress?.Report($"{t.Name}: {n:N0} rows read…"), ct).ConfigureAwait(false);
                            long loaded = staged.Rows;
                            if (mode == "full")
                            {
                                if (loaded >= 0)
                                {
                                    Exec(conn, "DROP TABLE IF EXISTS " + Names.Q(t.Name));
                                    Exec(conn, "ALTER TABLE __stg RENAME TO " + Names.Q(t.Name));
                                }
                                else if (exists) Exec(conn, "DELETE FROM " + Names.Q(t.Name));     // source empty: keep the columns, no rows
                            }
                            else if (mode == "window")
                            {
                                // the window is replaced as a whole: rows deleted at the source disappear too
                                var col = Describe(conn, t.Name).FirstOrDefault(c => string.Equals(c.Name, t.WindowColumn, StringComparison.OrdinalIgnoreCase))
                                          ?? throw new InvalidOperationException("Window column " + t.WindowColumn + " is not in the table");
                                Exec(conn, "DELETE FROM " + Names.Q(t.Name) + " WHERE TRY_CAST(" + Names.Q(col.Name) + " AS TIMESTAMP) >= TIMESTAMP '" + req.WindowStart.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "'");
                                if (loaded > 0) InsertStaged(conn, t);
                                Exec(conn, "DROP TABLE IF EXISTS __stg");
                            }
                            else if (loaded > 0)
                            {
                                Merge(conn, t);
                                Exec(conn, "DROP TABLE IF EXISTS __stg");
                            }
                            else Exec(conn, "DROP TABLE IF EXISTS __stg");

                            var cols = TableExists(conn, t.Name) ? Describe(conn, t.Name) : new List<ColumnInfo>();
                            var drift = Drift(st?.Columns, cols);
                            long? sourceCount = null;
                            if (t.CountCheck && mode == "full" && t.Source.Kind != "file" && _sources.TryGetValue(t.Source.Kind ?? "", out var cs))
                            {
                                sourceCount = await cs.CountAsync(new ReadRequest { Table = t }, ct).ConfigureAwait(false);
                                if (sourceCount != null && sourceCount != Math.Max(0, loaded))
                                    req.Note($"COUNT CHECK: the source has {sourceCount:N0} rows, {Math.Max(0, loaded):N0} were loaded");
                            }
                            double secs = Math.Max(0.001, tsw.Elapsed.TotalSeconds);
                            st = new TableState
                            {
                                LoadedUtc = DateTime.UtcNow, LastLoadedRows = Math.Max(0, loaded), LastMs = tsw.ElapsedMilliseconds,
                                RowsPerSecond = Math.Round(Math.Max(0, loaded) / secs, 1), LastMode = staged.Resumed ? mode + " (resumed)" : mode,
                                Rows = TableExists(conn, t.Name) ? Scalar<long>(conn, "SELECT COUNT(*) FROM " + Names.Q(t.Name)) : 0,
                                Watermark = WatermarkOf(conn, t) ?? st?.Watermark,
                                SourceCount = sourceCount, Drift = drift, Columns = cols
                            };
                            states[t.Name] = st;
                            result.Tables.Add(new TableResult
                            {
                                Table = t.Name, Loaded = Math.Max(0, loaded), Rows = st.Rows, Ms = st.LastMs, Incremental = mode == "incremental", Mode = st.LastMode,
                                RowsPerSecond = st.RowsPerSecond, SourceCount = sourceCount, Drift = drift, Notes = notes
                            });
                            Log(new { module, table = t.Name, by, status = "OK", mode = st.LastMode, incremental = mode == "incremental", loaded = Math.Max(0, loaded), rows = st.Rows, ms = st.LastMs,
                                      rowsPerSecond = st.RowsPerSecond, sourceCount, drift = drift.Count > 0 ? drift : null, notes = notes.Count > 0 ? notes : null });
                            progress?.Report($"{t.Name}: {st.Rows:N0} rows ({Math.Max(0, loaded):N0} loaded, {st.RowsPerSecond:N0} rows/s){(drift.Count > 0 ? " · columns changed: " + string.Join("; ", drift) : "")}");
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            Log(new { module, table = t.Name, by, status = "FAILED", error = ex.Message, ms = tsw.ElapsedMilliseconds });
                            throw new InvalidOperationException(t.Name + ": " + ex.Message, ex);
                        }
                    }
                    Exec(conn, "CHECKPOINT");
                }
                File.Move(building, abs);
                building = null;

                manifest = LoadManifest();
                manifest.Modules[module] = new ModuleEntry
                {
                    File = rel, Version = version, PublishedUtc = DateTime.UtcNow, PublishedBy = (by ?? "?") + "@" + Machine,
                    Bytes = new FileInfo(abs).Length, Tables = states
                };
                manifest.Revision++;
                manifest.UpdatedUtc = DateTime.UtcNow;
                Json.WriteAtomic(ManifestPath, manifest);
                Log(new { module, by, status = "PUBLISHED", version, bytes = manifest.Modules[module].Bytes, ms = sw.ElapsedMilliseconds });
                CleanOldVersions(module, rel);
                result.Version = version;
                result.Ok = true;
                result.Ms = sw.ElapsedMilliseconds;
                progress?.Report($"Published {module} {version}");
                return result;
            }
            catch (Exception ex)
            {
                result.Ok = false;
                result.Error = ex is OperationCanceledException ? "Cancelled" : ex.Message;
                result.Ms = sw.ElapsedMilliseconds;
                if (building != null) { TryDelete(building); TryDelete(building + ".wal"); }
                if (ex is OperationCanceledException) Log(new { module, by, status = "CANCELLED" });
                return result;
            }
            finally
            {
                _building = null;
                lease?.Release();
                _buildGate.Release();
            }
        }

        private sealed class Staged { public long Rows; public bool Resumed; }

        private sealed class Checkpoint
        {
            public string DefinitionHash { get; set; }
            public string LastKey { get; set; }
            public long Rows { get; set; }
            public DateTime StartedUtc { get; set; }
        }

        private string WorkDir => Path.Combine(Root, "work");

        /// <summary>
        /// Reads the source into __stg; Rows = rows staged, or −1 when the source returned no rows (nothing staged).
        /// Full loads of keyset tables keep their rows and last key in the shared work folder, so a load that fails
        /// half way resumes from the last good page on the next run (same definition, within 24 hours).
        /// </summary>
        private async Task<Staged> StageAsync(DuckDBConnection conn, string module, TableDef t, ReadRequest req, string mode, Action<long> progress, CancellationToken ct)
        {
            Exec(conn, "DROP TABLE IF EXISTS __stg");
            if (t.Source.Kind == "file")
            {
                string path = t.Source.Path ?? throw new InvalidOperationException("No file path");
                string ext = Path.GetExtension(path).ToLowerInvariant();
                string fn = ext switch
                {
                    ".parquet" => "read_parquet(" + Names.Lit(path) + ")",
                    ".json" or ".ndjson" or ".jsonl" => "read_json_auto(" + Names.Lit(path) + ")",
                    _ => "read_csv_auto(" + Names.Lit(path) + ", header = true, sample_size = -1)"
                };
                Exec(conn, "CREATE TABLE __stg AS SELECT * FROM " + fn);
                ApplyTypes(conn, t);
                return new Staged { Rows = Scalar<long>(conn, "SELECT COUNT(*) FROM __stg") };
            }
            if (!_sources.TryGetValue(t.Source.Kind ?? "", out var src)) throw new InvalidOperationException("No source registered for '" + t.Source.Kind + "'");

            bool checkpointed = mode == "full" && t.UsesKeyset;
            string data, ckptPath = null;
            long n = 0;
            bool resumed = false;
            if (checkpointed)
            {
                Directory.CreateDirectory(WorkDir);
                data = Path.Combine(WorkDir, module + "." + t.Name + ".ndjson");
                ckptPath = Path.Combine(WorkDir, module + "." + t.Name + ".checkpoint.json");
                var ck = Json.Read<Checkpoint>(ckptPath);
                if (ck != null && ck.DefinitionHash == t.DefinitionHash() && DateTime.UtcNow - ck.StartedUtc < TimeSpan.FromHours(24) && File.Exists(data) && ck.LastKey != null)
                {
                    req.ResumeAfterKey = ck.LastKey; n = ck.Rows; resumed = true;
                    req.Note?.Invoke($"resuming after key {ck.LastKey.Substring(2)} ({ck.Rows:N0} rows already read)");
                    TruncateToLines(data, ck.Rows);                    // drop a page written after the last checkpoint
                }
                else { TryDelete(data); TryDelete(ckptPath); Json.WriteAtomic(ckptPath, new Checkpoint { DefinitionHash = t.DefinitionHash(), StartedUtc = DateTime.UtcNow }); }
            }
            else data = Path.Combine(Path.GetTempPath(), "fm_" + Guid.NewGuid().ToString("N") + ".ndjson");

            bool ok = false;
            try
            {
                using (var w = new StreamWriter(data, resumed, new UTF8Encoding(false)))
                {
                    if (checkpointed)
                    {
                        var started = (Json.Read<Checkpoint>(ckptPath) ?? new Checkpoint()).StartedUtc;
                        req.OnKey = key =>
                        {
                            w.Flush();
                            Json.WriteAtomic(ckptPath, new Checkpoint { DefinitionHash = t.DefinitionHash(), LastKey = key, Rows = n, StartedUtc = started == default ? DateTime.UtcNow : started });
                        };
                    }
                    // declared DATE / TIMESTAMP columns: Oracle's ISO text (2026-01-31T00:00:00.000+00:00, 2026/01/31) → what DuckDB casts
                    var dateCols = new HashSet<string>((t.ColumnTypes ?? new()).Where(kv => kv.Value != null &&
                        (kv.Value.StartsWith("DATE", StringComparison.OrdinalIgnoreCase) || kv.Value.StartsWith("TIMESTAMP", StringComparison.OrdinalIgnoreCase))).Select(kv => kv.Key), StringComparer.OrdinalIgnoreCase);
                    await foreach (var page in src.ReadAsync(req, ct).ConfigureAwait(false))
                    {
                        foreach (var row in page.Rows)
                        {
                            if (dateCols.Count > 0)
                                foreach (var k in row.Keys.Where(dateCols.Contains).ToList())
                                    if (row[k] is string sv) row[k] = sv.Length == 0 ? null : BiccSource.NormDate(sv);
                            w.WriteLine(JsonSerializer.Serialize(row)); n++;
                        }
                        progress?.Invoke(n);
                    }
                }
                ok = true;
                if (n == 0) return new Staged { Rows = -1, Resumed = resumed };
                Exec(conn, "CREATE TABLE __stg AS SELECT * FROM read_json(" + Names.Lit(data) + ", format = 'newline_delimited', sample_size = -1)");
                // columns that were empty in every row come back as JSON: make them plain text
                foreach (var c in Describe(conn, "__stg").Where(c => c.Type == "JSON"))
                    Exec(conn, "ALTER TABLE __stg ALTER " + Names.Q(c.Name) + " TYPE VARCHAR");
                ApplyTypes(conn, t);
                return new Staged { Rows = n, Resumed = resumed };
            }
            finally
            {
                // keep a checkpointed load's rows for the next run; everything else is removed
                if (!checkpointed || ok) { TryDelete(data); if (ckptPath != null) TryDelete(ckptPath); }
            }
        }

        private static void TruncateToLines(string path, long lines)
        {
            string tmp = path + ".trim";
            using (var r = new StreamReader(path))
            using (var w = new StreamWriter(tmp, false, new UTF8Encoding(false)))
            {
                string line; long i = 0;
                while (i < lines && (line = r.ReadLine()) != null) { w.WriteLine(line); i++; }
            }
            File.Move(tmp, path, true);
        }

        /// <summary>Column changes since the last load: "added X (TYPE)", "removed X", "X: OLD → NEW".</summary>
        public static List<string> Drift(List<ColumnInfo> before, List<ColumnInfo> after)
        {
            var d = new List<string>();
            if (before == null || before.Count == 0 || after == null) return d;
            foreach (var a in after)
            {
                var b = before.FirstOrDefault(x => string.Equals(x.Name, a.Name, StringComparison.OrdinalIgnoreCase));
                if (b == null) d.Add($"added {a.Name} ({a.Type})");
                else if (!string.Equals(a.Type, b.Type, StringComparison.OrdinalIgnoreCase)) d.Add($"{a.Name}: {b.Type} → {a.Type}");
            }
            foreach (var b in before.Where(b => !after.Any(a => string.Equals(a.Name, b.Name, StringComparison.OrdinalIgnoreCase))))
                d.Add($"removed {b.Name}");
            return d;
        }

        private static void ApplyTypes(DuckDBConnection conn, TableDef t)
        {
            if (t.ColumnTypes == null) return;
            var have = Describe(conn, "__stg");
            foreach (var kv in t.ColumnTypes)
            {
                var col = have.FirstOrDefault(c => string.Equals(c.Name, kv.Key, StringComparison.OrdinalIgnoreCase));
                if (col != null && !string.IsNullOrWhiteSpace(kv.Value) && Regex.IsMatch(kv.Value, @"^[A-Za-z0-9_(), ]{2,40}$"))
                    Exec(conn, "ALTER TABLE __stg ALTER " + Names.Q(col.Name) + " TYPE " + kv.Value);
            }
        }

        /// <summary>Incremental merge: add new columns, delete the changed keys, insert the staged rows.</summary>
        private static void Merge(DuckDBConnection conn, TableDef t)
        {
            var target = Describe(conn, t.Name);
            var staged = Describe(conn, "__stg");
            foreach (var c in staged.Where(s => !target.Any(x => string.Equals(x.Name, s.Name, StringComparison.OrdinalIgnoreCase))))
                Exec(conn, "ALTER TABLE " + Names.Q(t.Name) + " ADD COLUMN " + Names.Q(c.Name) + " " + c.Type);
            var keys = t.Key.Select(k => staged.FirstOrDefault(c => string.Equals(c.Name, k, StringComparison.OrdinalIgnoreCase))?.Name
                                          ?? throw new InvalidOperationException("Key column " + k + " is not in the source rows")).ToList();
            Exec(conn, "DELETE FROM " + Names.Q(t.Name) + " AS t USING __stg AS s WHERE " + string.Join(" AND ", keys.Select(k => "t." + Names.Q(k) + " = s." + Names.Q(k))));
            InsertStaged(conn, t);
        }

        /// <summary>Adds new columns, widens changed types (DuckDB would otherwise cast silently: 2.5 into a BIGINT column becomes 2), inserts __stg.</summary>
        private static void InsertStaged(DuckDBConnection conn, TableDef t)
        {
            var staged = Describe(conn, "__stg");
            var target = Describe(conn, t.Name);
            foreach (var c in staged.Where(s => !target.Any(x => string.Equals(x.Name, s.Name, StringComparison.OrdinalIgnoreCase))))
                Exec(conn, "ALTER TABLE " + Names.Q(t.Name) + " ADD COLUMN " + Names.Q(c.Name) + " " + c.Type);
            target = Describe(conn, t.Name);
            foreach (var st in staged)
            {
                var c = target.FirstOrDefault(x => string.Equals(x.Name, st.Name, StringComparison.OrdinalIgnoreCase));
                string wider = c == null ? null : Types.Wider(c.Type, st.Type);
                if (wider != null && Scalar<long>(conn, "SELECT COUNT(" + Names.Q(st.Name) + ") FROM __stg") == 0) wider = null;   // only empty values this time
                if (wider != null) Exec(conn, "ALTER TABLE " + Names.Q(t.Name) + " ALTER " + Names.Q(c.Name) + " TYPE " + wider);
            }
            Exec(conn, "INSERT INTO " + Names.Q(t.Name) + " BY NAME SELECT * FROM __stg");
        }

        private static string WatermarkOf(DuckDBConnection conn, TableDef t)
        {
            if (string.IsNullOrWhiteSpace(t.IncrementalColumn) || !TableExists(conn, t.Name)) return null;
            var col = Describe(conn, t.Name).FirstOrDefault(c => string.Equals(c.Name, t.IncrementalColumn, StringComparison.OrdinalIgnoreCase));
            if (col == null) return null;
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT CAST(MAX(" + Names.Q(col.Name) + ") AS VARCHAR) FROM " + Names.Q(t.Name);
            return cmd.ExecuteScalar() as string;
        }

        private void CleanOldVersions(string module, string currentRel)
        {
            try
            {
                string keep = Path.GetFileName(currentRel);
                var cutoff = DateTime.UtcNow.AddHours(-Settings.RetainHours);
                foreach (var f in Directory.GetFiles(ModulesDir, module + "_*.duckdb*"))
                {
                    string name = Path.GetFileName(f);
                    if (name.StartsWith(keep, StringComparison.OrdinalIgnoreCase)) continue;
                    if (File.GetLastWriteTimeUtc(f) < cutoff) TryDelete(f);        // a reader may still hold it: ignore failures
                }
            }
            catch { }
        }

        // ── scheduler (runs only where IsRefresher) ──────────────────
        public void StartScheduler(Func<string> by, Action<string> log = null)
        {
            _timer?.Dispose();
            _timer = new Timer(async _ =>
            {
                try
                {
                    if (!Settings.IsRefresher || !SharedReachable || _building != null) return;
                    var model = LoadModel();
                    var manifest = LoadManifest();
                    foreach (var m in model.Modules)
                    {
                        manifest.Modules.TryGetValue(m.Name, out var e);
                        if (!Due(m.Schedule, e?.PublishedUtc, DateTime.Now)) continue;
                        var r = await RefreshAsync(m.Name, null, false, by?.Invoke() ?? "SCHEDULE", null, CancellationToken.None).ConfigureAwait(false);
                        log?.Invoke($"[FusionModel] scheduled {m.Name}: {(r.Ok ? "published " + r.Version : r.Error)}");
                    }
                }
                catch (Exception ex) { log?.Invoke("[FusionModel] scheduler: " + ex.Message); }
            }, null, TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(5));
        }

        /// <summary>DAILY: once after HH:mm each day · HOURLY: an hour after the last publish.</summary>
        public static bool Due(ScheduleDef s, DateTime? lastUtc, DateTime nowLocal)
        {
            string mode = (s?.Mode ?? "MANUAL").ToUpperInvariant();
            DateTime? lastLocal = lastUtc?.ToLocalTime();
            if (mode == "HOURLY") return lastLocal == null || nowLocal - lastLocal.Value >= TimeSpan.FromMinutes(58);
            if (mode != "DAILY") return false;
            if (!TimeSpan.TryParse(s.Time ?? "06:00", CultureInfo.InvariantCulture, out var at)) at = TimeSpan.FromHours(6);
            var slot = nowLocal.Date + at;
            if (nowLocal < slot) slot = slot.AddDays(-1);
            return lastLocal == null || lastLocal.Value < slot;
        }

        // ── reading (every PC) ───────────────────────────────────────
        /// <summary>CACHE mode: copies module files whose version changed to the local cache. Returns the files copied.</summary>
        public List<string> SyncCache()
        {
            var copied = new List<string>();
            if (Settings.ReadMode != "CACHE" || !SharedReachable) return copied;
            var manifest = Json.Read<Manifest>(ManifestPath) ?? new Manifest();
            Directory.CreateDirectory(Settings.CacheRoot);
            foreach (var (name, e) in manifest.Modules)
            {
                string src = Path.Combine(Root, e.File), dst = Path.Combine(Settings.CacheRoot, Path.GetFileName(e.File));
                if (!File.Exists(src) || File.Exists(dst)) continue;
                string tmp = dst + ".copy";
                File.Copy(src, tmp, true);
                File.Move(tmp, dst, true);
                copied.Add(Path.GetFileName(dst));
            }
            Json.WriteAtomic(CacheManifestPath, manifest);
            try { if (File.Exists(ModelPath)) File.Copy(ModelPath, Path.Combine(Settings.CacheRoot, "model.json"), true); } catch { }
            if (copied.Count > 0) ResetSession();        // the next query attaches the new versions
            // old local versions: remove when nothing holds them any more (a file still open elsewhere is left for next time)
            var current = new HashSet<string>(manifest.Modules.Values.Select(e => Path.GetFileName(e.File)), StringComparer.OrdinalIgnoreCase);
            foreach (var f in Directory.GetFiles(Settings.CacheRoot, "*.duckdb"))
                if (!current.Contains(Path.GetFileName(f)) && _sessionKey?.Contains(Path.GetFileName(f)) != true) TryDelete(f);
            return copied;
        }

        /// <summary>Paths of the current module files this PC reads (cache or shared).</summary>
        public Dictionary<string, string> ReadableFiles()
        {
            // CACHE mode reads what was last synced, so every query sees one consistent set of versions until the next sync
            var manifest = Settings.ReadMode == "CACHE" ? Json.Read<Manifest>(CacheManifestPath) ?? LoadManifest() : LoadManifest();
            var files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (name, e) in manifest.Modules)
            {
                string cached = Path.Combine(Settings.CacheRoot, Path.GetFileName(e.File));
                string shared = SharedReachable ? Path.Combine(Root, e.File) : null;
                string path = Settings.ReadMode == "CACHE" && File.Exists(cached) ? cached : shared != null && File.Exists(shared) ? shared : File.Exists(cached) ? cached : null;
                if (path != null && Names.IsValid(name)) files[name] = path;
            }
            return files;
        }

        /// <summary>Runs one read-only statement across every module (each attached under its name, e.g. gl.balances).</summary>
        public QueryResult Query(string sql, int maxRows = 1000, TimeSpan? timeout = null)
        {
            var guard = SqlGuard.Check(sql);
            if (guard != null) throw new InvalidOperationException(guard);
            maxRows = Math.Clamp(maxRows, 1, 100_000);
            var sw = Stopwatch.StartNew();
            lock (_sessionLock)
            {
                var conn = Session();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = sql;
                using var reader = cmd.ExecuteReader();
                var result = new QueryResult();
                for (int i = 0; i < reader.FieldCount; i++)
                    result.Columns.Add(new ColumnInfo { Name = reader.GetName(i), Type = SafeTypeName(reader, i) });
                while (reader.Read())
                {
                    if (result.Rows.Count >= maxRows) { result.Capped = true; break; }
                    var row = new object[reader.FieldCount];
                    for (int i = 0; i < row.Length; i++) row[i] = reader.IsDBNull(i) ? null : ToPlain(reader.GetValue(i));
                    result.Rows.Add(row);
                }
                result.Ms = sw.ElapsedMilliseconds;
                return result;
            }
        }

        /// <summary>The model for reading: the shared model.json, or the copy in the local cache when the share is offline.</summary>
        public ModelDefinition LoadModelForRead() =>
            (SharedReachable ? Json.Read<ModelDefinition>(ModelPath) : null) ?? Json.Read<ModelDefinition>(Path.Combine(Settings.CacheRoot ?? "", "model.json")) ?? new ModelDefinition();

        private DuckDBConnection Session()
        {
            var files = ReadableFiles();
            var model = LoadModelForRead();
            string key = "model" + model.Version + ";" + JsonSerializer.Serialize(model.Calendar) + "|" + string.Join("|", files.OrderBy(k => k.Key).Select(k => k.Key + "=" + k.Value));
            if (_session != null && key == _sessionKey) return _session;
            ResetSessionNoLock();
            var conn = new DuckDBConnection("Data Source=:memory:");
            conn.Open();
            foreach (var (name, path) in files)
                Exec(conn, "ATTACH " + Names.Lit(path) + " AS " + Names.Q(name) + " (READ_ONLY)");
            if (model.Calendar?.Enabled != false)
                Exec(conn, FusionModel.Semantic.SemanticModel.CalendarSql(model.Calendar, DateTime.Now.Year));
            // queries (people, reports, the AI) may not read other files, load extensions or change settings
            Exec(conn, "SET enable_external_access = false");
            Exec(conn, "SET lock_configuration = true");
            _session = conn;
            _sessionKey = key;
            return conn;
        }

        public void ResetSession() { lock (_sessionLock) ResetSessionNoLock(); }
        private void ResetSessionNoLock()
        {
            try { _session?.Dispose(); } catch { }
            _session = null; _sessionKey = null;
        }

        // ── semantic queries (measures with filter context) ───────────
        private FusionModel.Semantic.SemanticModel _sem;
        private string _semKey;

        /// <summary>The model bound to the published data (cached until the model or a module version changes).</summary>
        public FusionModel.Semantic.SemanticModel Semantic()
        {
            var model = LoadModelForRead();
            var manifest = Settings.ReadMode == "CACHE" ? Json.Read<Manifest>(CacheManifestPath) ?? LoadManifest() : LoadManifest();
            string key = model.Version + "|" + string.Join(",", manifest.Modules.Select(m => m.Key + "=" + m.Value.Version)) + "|" + JsonSerializer.Serialize(model.Measures) + JsonSerializer.Serialize(model.Relationships) + JsonSerializer.Serialize(model.Roles);
            if (_sem == null || _semKey != key) { _sem = FusionModel.Semantic.SemanticModel.Build(model, manifest); _semKey = key; }
            return _sem;
        }

        /// <summary>Measures by columns with filters, for <paramref name="user"/> (their roles' row filters apply).</summary>
        public FusionModel.Semantic.SemanticResult Evaluate(FusionModel.Semantic.SemanticRequest req, string user) => Run(Semantic(), req, user, null, null);

        /// <summary>DEFINE MEASURE … EVALUATE SUMMARIZECOLUMNS(…) / ROW(…) [ORDER BY …].</summary>
        public FusionModel.Semantic.SemanticResult EvaluateText(string text, string user)
        {
            var sem = Semantic();
            var planner = new FusionModel.Semantic.QueryPlanner(sem);
            var (req, local, filters) = planner.ParseEvaluate(text);
            return Run(sem, req, user, local, filters);
        }

        private FusionModel.Semantic.SemanticResult Run(FusionModel.Semantic.SemanticModel sem, FusionModel.Semantic.SemanticRequest req, string user,
                                                         Dictionary<string, MeasureDef> local, List<FusionModel.Semantic.Node> filters)
        {
            var sw = Stopwatch.StartNew();
            var plan = new FusionModel.Semantic.QueryPlanner(sem).Build(req, user, local, filters);
            var res = new FusionModel.Semantic.SemanticResult { Columns = plan.Columns, Sql = plan.Sql };
            lock (_sessionLock)
            {
                var conn = Session();
                using (var cmd = conn.CreateCommand())
                {
                    cmd.CommandText = plan.Sql;
                    using var r = cmd.ExecuteReader();
                    for (int i = 0; i < r.FieldCount && i < res.Columns.Count; i++) res.Columns[i].Type ??= SafeTypeName(r, i);
                    while (r.Read())
                    {
                        if (res.Rows.Count >= plan.Limit) { res.Capped = true; break; }
                        var row = new object[r.FieldCount];
                        for (int i = 0; i < row.Length; i++) row[i] = r.IsDBNull(i) ? null : ToPlain(r.GetValue(i));
                        res.Rows.Add(row);
                    }
                }
                if (plan.TotalsSql != null)
                {
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = plan.TotalsSql;
                    using var r = cmd.ExecuteReader();
                    if (r.Read())
                    {
                        var t = new object[res.Columns.Count];
                        int m = 0;
                        for (int i = 0; i < res.Columns.Count; i++)
                            if (res.Columns[i].Role == "measure") { t[i] = r.IsDBNull(m) ? null : ToPlain(r.GetValue(m)); m++; }
                        res.Totals = t;
                    }
                }
            }
            res.Ms = sw.ElapsedMilliseconds;
            return res;
        }

        /// <summary>Measures that do not compile (name → error), checked against the published tables.</summary>
        public Dictionary<string, string> ValidateMeasures() => new FusionModel.Semantic.QueryPlanner(Semantic()).Validate();

        // ── status and log ───────────────────────────────────────────
        public EngineStatus Status()
        {
            var st = new EngineStatus { Settings = Settings, SharedReachable = SharedReachable, Building = _building, Machine = Machine };
            try { st.Lease = SharedReachable ? Lease.Peek(LockPath) : null; } catch { }
            try
            {
                var model = SharedReachable ? LoadModel() : new ModelDefinition();
                var manifest = LoadManifest();
                st.ModelVersion = model.Version;
                foreach (var m in model.Modules)
                {
                    manifest.Modules.TryGetValue(m.Name, out var e);
                    st.Modules.Add(new ModuleStatus
                    {
                        Name = m.Name, Title = m.Title, Schedule = m.Schedule, Version = e?.Version, PublishedUtc = e?.PublishedUtc,
                        PublishedBy = e?.PublishedBy, Bytes = e?.Bytes ?? 0,
                        Cached = e != null && File.Exists(Path.Combine(Settings.CacheRoot, Path.GetFileName(e.File))),
                        Tables = model.Tables.Where(t => string.Equals(t.Module, m.Name, StringComparison.OrdinalIgnoreCase)).Select(t =>
                        {
                            TableState ts = null; e?.Tables.TryGetValue(t.Name, out ts);
                            return new TableStatus
                            {
                                Name = t.Name, Source = t.Source?.Kind, Strategy = t.Strategy.ToString(), Rows = ts?.Rows, Watermark = ts?.Watermark, LoadedUtc = ts?.LoadedUtc,
                                Columns = ts?.Columns?.Count ?? 0, LastMs = ts?.LastMs, LastLoadedRows = ts?.LastLoadedRows, RowsPerSecond = ts?.RowsPerSecond, LastMode = ts?.LastMode,
                                SourceCount = ts?.SourceCount, Drift = ts?.Drift ?? new List<string>(), CountCheck = t.CountCheck, Paging = t.UsesKeyset ? "keyset" : "rownum"
                            };
                        }).ToList()
                    });
                }
            }
            catch (Exception ex) { st.Error = ex.Message; }
            return st;
        }

        public List<JsonElement> ReadLog(int last = 100)
        {
            var list = new List<JsonElement>();
            if (!SharedReachable || !File.Exists(LogPath)) return list;
            using var fs = new FileStream(LogPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs);
            var lines = new Queue<string>();
            string line;
            while ((line = sr.ReadLine()) != null) { lines.Enqueue(line); if (lines.Count > last) lines.Dequeue(); }
            foreach (var l in lines.Reverse()) try { list.Add(JsonDocument.Parse(l).RootElement.Clone()); } catch { }
            return list;
        }

        private void Log(object entry)
        {
            try
            {
                var node = JsonSerializer.SerializeToNode(entry)!.AsObject();
                node["at"] = DateTime.UtcNow.ToString("o");
                node["machine"] = Machine;
                File.AppendAllText(LogPath, node.ToJsonString() + "\n");
            }
            catch { }
        }

        // ── helpers ──────────────────────────────────────────────────
        private static void Exec(DuckDBConnection conn, string sql)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }

        private static T Scalar<T>(DuckDBConnection conn, string sql)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            return (T)Convert.ChangeType(cmd.ExecuteScalar(), typeof(T), CultureInfo.InvariantCulture);
        }

        private static bool TableExists(DuckDBConnection conn, string name)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'main' AND table_name = " + Names.Lit(name);
            return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture) > 0;
        }

        private static List<ColumnInfo> Describe(DuckDBConnection conn, string table)
        {
            var cols = new List<ColumnInfo>();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = " + Names.Lit(table) + " ORDER BY ordinal_position";
            using var r = cmd.ExecuteReader();
            while (r.Read()) cols.Add(new ColumnInfo { Name = r.GetString(0), Type = r.GetString(1) });
            return cols;
        }

        private static string SafeTypeName(System.Data.Common.DbDataReader r, int i)
        {
            try { return r.GetDataTypeName(i); } catch { return r.GetFieldType(i)?.Name ?? "?"; }
        }

        /// <summary>DuckDB values → JSON-friendly values.</summary>
        public static object ToPlain(object v) => v switch
        {
            null => null,
            DateTime d => d.TimeOfDay == TimeSpan.Zero ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : d.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
            DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            TimeOnly t => t.ToString("HH:mm:ss", CultureInfo.InvariantCulture),
            DateTimeOffset o => o.ToString("o", CultureInfo.InvariantCulture),
            System.Numerics.BigInteger b => b >= long.MinValue && b <= long.MaxValue ? (long)b : b.ToString(CultureInfo.InvariantCulture),   // SUM of integers is HUGEINT: keep it a number
            decimal m => (double)m,
            float f => (double)f,
            byte[] bytes => Convert.ToBase64String(bytes),
            string or bool or long or int or short or byte or sbyte or double or ulong or uint or ushort => v,
            Guid g => g.ToString(),
            _ => v.ToString()
        };

        private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }

        public void Dispose()
        {
            _timer?.Dispose();
            ResetSession();
        }
    }

    /// <summary>Column type widening for incremental merges.</summary>
    public static class Types
    {
        private static readonly string[] Numeric = { "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "FLOAT", "DOUBLE" };

        public static bool IsNumeric(string t)
        {
            string u = (t ?? "").ToUpperInvariant();
            return Rank(u) >= 0 || u is "REAL" or "UINTEGER" or "UBIGINT" or "USMALLINT" or "UTINYINT";
        }

        /// <summary>The type the target column must become to hold the staged values, or null when it already can.</summary>
        public static string Wider(string target, string staged)
        {
            string a = (target ?? "").ToUpperInvariant(), b = (staged ?? "").ToUpperInvariant();
            if (a == b || a == "VARCHAR" || b == "\"NULL\"" || b == "NULL") return null;
            int ia = Rank(a), ib = Rank(b);
            if (ia >= 0 && ib >= 0) return ib > ia ? (b.StartsWith("DECIMAL") || a.StartsWith("DECIMAL") ? "DOUBLE" : b) : null;
            if (a == "DATE" && b.StartsWith("TIMESTAMP")) return b;
            if (a.StartsWith("TIMESTAMP") && b == "DATE") return null;
            return "VARCHAR";
        }

        private static int Rank(string t)
        {
            if (t.StartsWith("DECIMAL")) return 5;
            int i = Array.IndexOf(Numeric, t);
            return i < 0 ? -1 : i;
        }
    }

    /// <summary>Only one refresher writes at a time: a lock file in the shared folder with an expiry.</summary>
    public sealed class Lease
    {
        public string Machine { get; set; }
        public int Pid { get; set; }
        public DateTime AcquiredUtc { get; set; }
        public DateTime ExpiresUtc { get; set; }
        private string _path;
        private TimeSpan _ttl;

        public static Lease Peek(string path)
        {
            var l = Json.Read<Lease>(path);
            return l != null && l.ExpiresUtc > DateTime.UtcNow ? l : null;
        }

        public static Lease Acquire(string path, string machine, TimeSpan ttl)
        {
            var held = Peek(path);
            if (held != null && !(held.Machine == machine && held.Pid == Environment.ProcessId))
                throw new InvalidOperationException($"A refresh is running on {held.Machine} (since {held.AcquiredUtc.ToLocalTime():HH:mm}). Try again when it has finished.");
            var l = new Lease { Machine = machine, Pid = Environment.ProcessId, AcquiredUtc = DateTime.UtcNow, ExpiresUtc = DateTime.UtcNow + ttl, _path = path, _ttl = ttl };
            Json.WriteAtomic(path, l);
            return l;
        }

        public void Renew()
        {
            ExpiresUtc = DateTime.UtcNow + _ttl;
            try { Json.WriteAtomic(_path, this); } catch { }
        }

        public void Release()
        {
            try
            {
                var cur = Json.Read<Lease>(_path);
                if (cur != null && cur.Machine == Machine && cur.Pid == Pid) File.Delete(_path);
            }
            catch { }
        }
    }

    /// <summary>Statements people, reports and the AI may run: one read-only query.</summary>
    public static class SqlGuard
    {
        private static readonly string[] Allowed = { "SELECT", "WITH", "FROM", "DESCRIBE", "SUMMARIZE", "SHOW", "VALUES", "PIVOT", "UNPIVOT", "TABLE" };

        /// <summary>null = allowed; otherwise the reason it is refused.</summary>
        public static string Check(string sql)
        {
            if (string.IsNullOrWhiteSpace(sql)) return "Empty query.";
            string code = StripLiteralsAndComments(sql).Trim().TrimEnd(';').Trim();
            if (code.Contains(';')) return "Only one statement at a time.";
            string first = Regex.Match(code, @"^\(*\s*([A-Za-z]+)").Groups[1].Value.ToUpperInvariant();
            if (!Allowed.Contains(first)) return "Only read-only queries (SELECT, WITH, DESCRIBE, SUMMARIZE …) are allowed.";
            return null;
        }

        public static string StripLiteralsAndComments(string sql)
        {
            var sb = new StringBuilder(sql.Length);
            for (int i = 0; i < sql.Length; i++)
            {
                char c = sql[i];
                if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-') { while (i < sql.Length && sql[i] != '\n') i++; sb.Append(' '); continue; }
                if (c == '/' && i + 1 < sql.Length && sql[i + 1] == '*') { i += 2; while (i + 1 < sql.Length && !(sql[i] == '*' && sql[i + 1] == '/')) i++; i++; sb.Append(' '); continue; }
                if (c == '\'' || c == '"')
                {
                    char q = c; i++;
                    while (i < sql.Length) { if (sql[i] == q) { if (i + 1 < sql.Length && sql[i + 1] == q) { i += 2; continue; } break; } i++; }
                    sb.Append(q == '\'' ? "''" : "\"x\"");
                    continue;
                }
                sb.Append(c);
            }
            return sb.ToString();
        }
    }

    public sealed class BuildResult
    {
        public bool Ok { get; set; }
        public string Module { get; set; }
        public string Version { get; set; }
        public string Error { get; set; }
        public long Ms { get; set; }
        public List<TableResult> Tables { get; set; } = new();
    }

    public sealed class TableResult
    {
        public string Table { get; set; }
        public bool Incremental { get; set; }
        public string Mode { get; set; }
        public double RowsPerSecond { get; set; }
        public long? SourceCount { get; set; }
        public List<string> Drift { get; set; } = new();
        public List<string> Notes { get; set; } = new();
        public long Loaded { get; set; }
        public long Rows { get; set; }
        public long Ms { get; set; }
    }

    public sealed class QueryResult
    {
        public List<ColumnInfo> Columns { get; set; } = new();
        public List<object[]> Rows { get; set; } = new();
        public bool Capped { get; set; }
        public long Ms { get; set; }
    }

    public sealed class EngineStatus
    {
        public EngineSettings Settings { get; set; }
        public bool SharedReachable { get; set; }
        public string Machine { get; set; }
        public string Building { get; set; }
        public Lease Lease { get; set; }
        public int ModelVersion { get; set; }
        public string Error { get; set; }
        public List<ModuleStatus> Modules { get; set; } = new();
    }

    public sealed class ModuleStatus
    {
        public string Name { get; set; }
        public string Title { get; set; }
        public ScheduleDef Schedule { get; set; }
        public string Version { get; set; }
        public DateTime? PublishedUtc { get; set; }
        public string PublishedBy { get; set; }
        public long Bytes { get; set; }
        public bool Cached { get; set; }
        public List<TableStatus> Tables { get; set; } = new();
    }

    public sealed class TableStatus
    {
        public string Name { get; set; }
        public long? LastMs { get; set; }
        public long? LastLoadedRows { get; set; }
        public double? RowsPerSecond { get; set; }
        public string LastMode { get; set; }
        public long? SourceCount { get; set; }
        public bool CountCheck { get; set; }
        public string Paging { get; set; }
        public List<string> Drift { get; set; } = new();
        public string Source { get; set; }
        public string Strategy { get; set; }
        public long? Rows { get; set; }
        public string Watermark { get; set; }
        public DateTime? LoadedUtc { get; set; }
        public int Columns { get; set; }
    }
}

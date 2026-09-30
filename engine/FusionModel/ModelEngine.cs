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
    public sealed class ModelEngine : IDisposable
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
                        bool incremental = !full && t.Strategy == LoadStrategy.Incremental && exists && !string.IsNullOrEmpty(st?.Watermark);
                        progress?.Report($"{t.Name}: {(incremental ? "changes since " + st.Watermark : "full load")}…");
                        try
                        {
                            long loaded = await StageAsync(conn, t, incremental ? st.Watermark : null, n => progress?.Report($"{t.Name}: {n:N0} rows read…"), ct).ConfigureAwait(false);
                            if (!incremental)
                            {
                                if (loaded >= 0)
                                {
                                    Exec(conn, "DROP TABLE IF EXISTS " + Names.Q(t.Name));
                                    Exec(conn, "ALTER TABLE __stg RENAME TO " + Names.Q(t.Name));
                                }
                                else if (exists) Exec(conn, "DELETE FROM " + Names.Q(t.Name));     // source empty: keep the columns, no rows
                            }
                            else if (loaded > 0)
                            {
                                Merge(conn, t);
                                Exec(conn, "DROP TABLE IF EXISTS __stg");
                            }
                            else Exec(conn, "DROP TABLE IF EXISTS __stg");

                            st = new TableState
                            {
                                LoadedUtc = DateTime.UtcNow, LastLoadedRows = Math.Max(0, loaded), LastMs = tsw.ElapsedMilliseconds,
                                Rows = TableExists(conn, t.Name) ? Scalar<long>(conn, "SELECT COUNT(*) FROM " + Names.Q(t.Name)) : 0,
                                Watermark = WatermarkOf(conn, t) ?? st?.Watermark,
                                Columns = TableExists(conn, t.Name) ? Describe(conn, t.Name) : new List<ColumnInfo>()
                            };
                            states[t.Name] = st;
                            result.Tables.Add(new TableResult { Table = t.Name, Loaded = Math.Max(0, loaded), Rows = st.Rows, Ms = st.LastMs, Incremental = incremental });
                            Log(new { module, table = t.Name, by, status = "OK", incremental, loaded = Math.Max(0, loaded), rows = st.Rows, ms = st.LastMs });
                            progress?.Report($"{t.Name}: {st.Rows:N0} rows ({Math.Max(0, loaded):N0} loaded)");
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

        /// <summary>Reads the source into __stg. Returns rows staged, or −1 when the source returned no rows (nothing staged).</summary>
        private async Task<long> StageAsync(DuckDBConnection conn, TableDef t, string watermark, Action<long> progress, CancellationToken ct)
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
                return Scalar<long>(conn, "SELECT COUNT(*) FROM __stg");
            }
            if (!_sources.TryGetValue(t.Source.Kind ?? "", out var src)) throw new InvalidOperationException("No source registered for '" + t.Source.Kind + "'");
            string tmp = Path.Combine(Path.GetTempPath(), "fm_" + Guid.NewGuid().ToString("N") + ".ndjson");
            long n = 0;
            try
            {
                using (var w = new StreamWriter(tmp, false, new UTF8Encoding(false)))
                {
                    await foreach (var page in src.ReadAsync(t, watermark, ct).ConfigureAwait(false))
                    {
                        foreach (var row in page.Rows) { w.WriteLine(JsonSerializer.Serialize(row)); n++; }
                        progress?.Invoke(n);
                    }
                }
                if (n == 0) return -1;
                Exec(conn, "CREATE TABLE __stg AS SELECT * FROM read_json(" + Names.Lit(tmp) + ", format = 'newline_delimited', sample_size = -1)");
                // columns that were empty in every row come back as JSON: make them plain text
                foreach (var c in Describe(conn, "__stg").Where(c => c.Type == "JSON"))
                    Exec(conn, "ALTER TABLE __stg ALTER " + Names.Q(c.Name) + " TYPE VARCHAR");
                ApplyTypes(conn, t);
                return n;
            }
            finally { TryDelete(tmp); }
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
            // widen target columns first: DuckDB would otherwise cast silently (2.5 into a BIGINT column becomes 2)
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

        private DuckDBConnection Session()
        {
            var files = ReadableFiles();
            string key = string.Join("|", files.OrderBy(k => k.Key).Select(k => k.Key + "=" + k.Value));
            if (_session != null && key == _sessionKey) return _session;
            ResetSessionNoLock();
            var conn = new DuckDBConnection("Data Source=:memory:");
            conn.Open();
            foreach (var (name, path) in files)
                Exec(conn, "ATTACH " + Names.Lit(path) + " AS " + Names.Q(name) + " (READ_ONLY)");
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
                            return new TableStatus { Name = t.Name, Source = t.Source?.Kind, Strategy = t.Strategy.ToString(), Rows = ts?.Rows, Watermark = ts?.Watermark, LoadedUtc = ts?.LoadedUtc, Columns = ts?.Columns?.Count ?? 0 };
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
            System.Numerics.BigInteger b => b.ToString(CultureInfo.InvariantCulture),
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
        public string Source { get; set; }
        public string Strategy { get; set; }
        public long? Rows { get; set; }
        public string Watermark { get; set; }
        public DateTime? LoadedUtc { get; set; }
        public int Columns { get; set; }
    }
}

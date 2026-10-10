using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using DuckDB.NET.Data;

namespace WMSApp
{
    /// <summary>
    /// AES-256 encryption for the app's DuckDB files (wms2.duckdb, finance.duckdb): one random key per PC, kept
    /// DPAPI-protected (machine scope, so every Windows user of the PC — and every WMS window — opens the same file) in
    /// %ProgramData%\GraysWMS\duckdb.key; a copy of the file, or of the key file, is useless on another machine.
    ///
    /// DuckDB opens an encrypted file only through ATTACH … (ENCRYPTION_KEY …) on an in-memory connection, so every store
    /// opens ":memory:", attaches its file (Attach / Open) and switches to it with USE — unqualified table names then mean
    /// that file, exactly as before. Writing an encrypted file needs DuckDB's OpenSSL crypto, which comes with the httpfs
    /// extension (the built-in implementation only reads): Prepare loads it from DuckDB's own extension folder, from the copy
    /// shipped next to the exe (dist\duckdb-ext\v{version}\{platform}\httpfs.duckdb_extension, downloaded by
    /// create-distribution-folder.bat) or, in the background, from extensions.duckdb.org. Until it is available a new file is
    /// created plain and an existing plain file stays plain; the first open with the crypto loaded migrates a plain file
    /// (COPY FROM DATABASE into an encrypted file next to it, every table's row count checked, then the swap). Reading an
    /// encrypted file works with or without httpfs. GRAYSWMS_DUCKDB_PLAIN=1 switches the whole thing off (tests, emergencies);
    /// GRAYSWMS_DUCKDB_KEYFILE names another key file.
    /// </summary>
    public static class DuckDbVault
    {
        private static readonly object _lock = new();
        private static string _keyHex;
        private static string _keySource = "";
        private static int _crypto;                    // 0 = not tried yet, 1 = OpenSSL crypto loads, 2 = unavailable in this process
        private static string _cryptoNote = "";
        private static string _loadWhat;               // what LOAD takes: "httpfs" (DuckDB's folder) or the shipped file's path
        private static Task _installing;
        private static readonly HashSet<string> _encrypted = new(StringComparer.OrdinalIgnoreCase);   // files known to be encrypted
        private static string _lastMigration = "";

        /// <summary>Off switch for tests and emergencies: files are left plain and attached without a key.</summary>
        public static bool Enabled => Environment.GetEnvironmentVariable("GRAYSWMS_DUCKDB_PLAIN") != "1";

        /// <summary>Where the DPAPI-protected key lives (machine-wide; falls back to the user profile when ProgramData is not writable).</summary>
        public static string KeyPath
        {
            get
            {
                var env = Environment.GetEnvironmentVariable("GRAYSWMS_DUCKDB_KEYFILE");
                if (!string.IsNullOrWhiteSpace(env)) return env;
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GraysWMS", "duckdb.key");
            }
        }
        private static string UserKeyPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "duckdb.key");

        /// <summary>"openssl" (encrypted writes possible), "unavailable" (reads only; files stay plain), "unknown" (not needed yet).</summary>
        public static string CryptoState => _crypto == 1 ? "openssl" : _crypto == 2 ? "unavailable" : "unknown";
        public static string CryptoNote => _cryptoNote;
        public static bool IsKnownEncrypted(string path) => path != null && _encrypted.Contains(Path.GetFullPath(path));

        /// <summary>What the pages show beside a file: encrypted or not, and why not.</summary>
        public static object Info(string path) => new
        {
            enabled = Enabled,
            encrypted = IsKnownEncrypted(path),
            crypto = CryptoState,
            cryptoNote = _cryptoNote,
            keyPath = Enabled ? KeyPath : null,
            keyExists = Enabled && File.Exists(KeyPath),
            keySource = _keySource,
            lastMigration = _lastMigration
        };

        // ─── the key ────────────────────────────────────────────────────────────
        /// <summary>The PC's key as 64 hex characters (created on first use).</summary>
        public static string Key()
        {
            lock (_lock)
            {
                if (_keyHex != null) return _keyHex;
                foreach (var p in new[] { KeyPath, UserKeyPath }.Distinct())
                {
                    var k = ReadKey(p);
                    if (k != null) { _keyHex = k; return k; }
                }
                var bytes = RandomNumberGenerator.GetBytes(32);
                string hex = Convert.ToHexString(bytes).ToLowerInvariant();
                if (!WriteKey(KeyPath, bytes, machine: true) && !WriteKey(UserKeyPath, bytes, machine: false))
                    throw new IOException("The DuckDB key file could not be written (" + KeyPath + ")");
                _keyHex = hex;
                return hex;
            }
        }
        private static string ReadKey(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                string text = File.ReadAllText(path).Trim();
                int i = text.IndexOf(':');
                if (i < 0) return null;
                string scope = text.Substring(0, i), body = text.Substring(i + 1);
                byte[] bytes;
                if (scope == "plain") bytes = Convert.FromHexString(body);
                else if (OperatingSystem.IsWindows())
                    bytes = ProtectedData.Unprotect(Convert.FromBase64String(body), null,
                        scope == "user" ? DataProtectionScope.CurrentUser : DataProtectionScope.LocalMachine);
                else return null;
                _keySource = scope == "plain" ? "file" : "dpapi-" + scope;
                return Convert.ToHexString(bytes).ToLowerInvariant();
            }
            catch (Exception ex) { Debug.WriteLine("[DuckDbVault] key not read from " + path + ": " + ex.Message); return null; }
        }
        private static bool WriteKey(string path, byte[] bytes, bool machine)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                string text;
                if (OperatingSystem.IsWindows())
                {
                    var scope = machine ? DataProtectionScope.LocalMachine : DataProtectionScope.CurrentUser;
                    text = (machine ? "machine:" : "user:") + Convert.ToBase64String(ProtectedData.Protect(bytes, null, scope));
                    _keySource = machine ? "dpapi-machine" : "dpapi-user";
                }
                else { text = "plain:" + Convert.ToHexString(bytes).ToLowerInvariant(); _keySource = "file"; }   // tests on Linux only
                File.WriteAllText(path, text);
                Debug.WriteLine("[DuckDbVault] key created at " + path + " (" + _keySource + ")");
                return true;
            }
            catch (Exception ex) { Debug.WriteLine("[DuckDbVault] key not written to " + path + ": " + ex.Message); return false; }
        }

        // ─── the crypto (httpfs = OpenSSL) ──────────────────────────────────────
        /// <summary>
        /// Loads the OpenSSL crypto into this connection so it can write encrypted files. True when loaded. The first call
        /// in a process finds the extension (DuckDB's folder, the shipped copy, else a background download); until then
        /// false, and the stores keep plain files.
        /// </summary>
        public static bool Prepare(DuckDBConnection c)
        {
            if (!Enabled) return false;
            lock (_lock)
            {
                if (_crypto == 2 && _installing == null) return false;
                if (_crypto == 1 && _loadWhat != null)
                {
                    try { Exec(c, "LOAD " + (_loadWhat == "httpfs" ? "httpfs" : Lit(_loadWhat))); return true; }
                    catch (Exception ex) { _crypto = 2; _cryptoNote = "httpfs did not load: " + Short(ex.Message); Debug.WriteLine("[DuckDbVault] " + _cryptoNote); return false; }
                }
                if (_installing != null) { if (!_installing.IsCompleted) return false; _installing = null; }
                // 1) DuckDB's own extension folder (installed before) — 2) the copy shipped with the app — 3) download once, in the background
                foreach (var what in new[] { "httpfs" }.Concat(ShippedCandidates(c)))
                {
                    try { Exec(c, "LOAD " + (what == "httpfs" ? "httpfs" : Lit(what))); _crypto = 1; _loadWhat = what; _cryptoNote = ""; Debug.WriteLine("[DuckDbVault] crypto from " + what); return true; }
                    catch (Exception ex) { _cryptoNote = Short(ex.Message); }
                }
                if (_crypto == 0)
                {
                    _crypto = 2;
                    _cryptoNote = "the httpfs extension is not installed yet (downloading it in the background)";
                    _installing = Task.Run(() =>
                    {
                        try
                        {
                            using var ic = new DuckDBConnection("Data Source=:memory:");
                            ic.Open();
                            Exec(ic, "INSTALL httpfs");
                            Exec(ic, "LOAD httpfs");
                            lock (_lock) { _crypto = 1; _loadWhat = "httpfs"; _cryptoNote = ""; }
                            Debug.WriteLine("[DuckDbVault] httpfs installed from extensions.duckdb.org");
                        }
                        catch (Exception ex)
                        {
                            lock (_lock) { _crypto = 2; _cryptoNote = "the httpfs extension could not be downloaded (" + Short(ex.Message) + ") — files stay unencrypted until it is available"; }
                            Debug.WriteLine("[DuckDbVault] " + _cryptoNote);
                        }
                    });
                }
                return false;
            }
        }
        /// <summary>dist\duckdb-ext\v{version}\{platform}\httpfs.duckdb_extension next to the exe (any version folder as a fallback).</summary>
        private static IEnumerable<string> ShippedCandidates(DuckDBConnection c)
        {
            var list = new List<string>();
            try
            {
                string root = Path.Combine(AppContext.BaseDirectory, "duckdb-ext");
                if (!Directory.Exists(root)) return list;
                string ver = null, plat = null;
                try { ver = Convert.ToString(Scalar(c, "SELECT version()")); plat = Convert.ToString(Scalar(c, "PRAGMA platform")); } catch { }
                if (ver != null && plat != null)
                {
                    string exact = Path.Combine(root, ver, plat, "httpfs.duckdb_extension");
                    if (File.Exists(exact)) list.Add(exact);
                }
                foreach (var f in Directory.EnumerateFiles(root, "httpfs.duckdb_extension", SearchOption.AllDirectories))
                    if (!list.Contains(f)) list.Add(f);
            }
            catch (Exception ex) { Debug.WriteLine("[DuckDbVault] shipped extension lookup: " + ex.Message); }
            return list;
        }

        // ─── open / attach ──────────────────────────────────────────────────────
        /// <summary>An open in-memory connection with the file attached as <paramref name="alias"/> and selected with USE.</summary>
        public static DuckDBConnection Open(string path, bool readOnly = false, string alias = "db")
        {
            var c = new DuckDBConnection("Data Source=:memory:");
            try
            {
                c.Open();
                Attach(c, alias, path, readOnly);
                Exec(c, "USE " + alias);
                return c;
            }
            catch { try { c.Dispose(); } catch { } throw; }
        }

        /// <summary>
        /// ATTACHes the file: with the PC's key when the file is encrypted — or new and the crypto is available —, plain
        /// otherwise. An existing plain file is migrated to an encrypted one first when the crypto is available. Returns
        /// true when the attached file is encrypted.
        /// </summary>
        public static bool Attach(DuckDBConnection c, string alias, string path, bool readOnly)
        {
            string full = Path.GetFullPath(path);
            bool crypto = Prepare(c);
            bool enc = false;
            if (Enabled)
            {
                if (!File.Exists(full)) enc = crypto && !readOnly;
                else if (IsEncrypted(c, full)) enc = true;
                else if (crypto && Migrate(c, full)) enc = true;
            }
            var opts = new List<string>();
            if (readOnly) opts.Add("READ_ONLY");
            if (enc) opts.Add("ENCRYPTION_KEY " + Lit(Key()));
            try
            {
                Exec(c, "ATTACH " + Lit(full.Replace('\\', '/')) + " AS " + alias + (opts.Count > 0 ? " (" + string.Join(", ", opts) + ")" : ""));
            }
            catch (Exception ex) when (enc && ex.Message.IndexOf("encryption key", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                // the file was encrypted with another key: the key file was replaced or deleted, or the file came from another PC
                throw new InvalidOperationException(
                    Path.GetFileName(full) + " was encrypted with a key this PC does not have (the key file " + KeyPath +
                    " was replaced or deleted, or the file was copied from another PC). Restore that key file from a backup, or move the " +
                    "file away and open the page again: it is rebuilt from the next sync. DuckDB said: " + Short(ex.Message), ex);
            }
            if (enc)
            {
                lock (_lock) _encrypted.Add(full);
                try { Exec(c, "SET temp_file_encryption = true"); } catch { /* an older library without the setting */ }
            }
            return enc;
        }

        /// <summary>Known encrypted, else a read-only probe without a key: DuckDB refuses an encrypted file with "encrypted" in the message.</summary>
        private static bool IsEncrypted(DuckDBConnection c, string full)
        {
            lock (_lock) if (_encrypted.Contains(full)) return true;
            try
            {
                Exec(c, "ATTACH " + Lit(full.Replace('\\', '/')) + " AS __probe (READ_ONLY)");
                Exec(c, "DETACH __probe");
                return false;
            }
            catch (Exception ex)
            {
                if (ex.Message.IndexOf("encrypt", StringComparison.OrdinalIgnoreCase) >= 0) { lock (_lock) _encrypted.Add(full); return true; }
                return false;      // a lock or a damaged file: the real ATTACH below says what is wrong
            }
        }

        /// <summary>Plain → encrypted: COPY FROM DATABASE into a new file next to it, every table's row count checked, then the swap.</summary>
        private static bool Migrate(DuckDBConnection c, string full)
        {
            string tmp = full + ".enc-tmp";
            var sw = Stopwatch.StartNew();
            try
            {
                foreach (var f in new[] { tmp, tmp + ".wal" }) if (File.Exists(f)) File.Delete(f);
                Exec(c, "ATTACH " + Lit(full.Replace('\\', '/')) + " AS __old (READ_ONLY)");
                try
                {
                    Exec(c, "ATTACH " + Lit(tmp.Replace('\\', '/')) + " AS __enc (ENCRYPTION_KEY " + Lit(Key()) + ")");
                    try
                    {
                        Exec(c, "COPY FROM DATABASE __old TO __enc");
                        var tables = new List<string>();
                        using (var cmd = c.CreateCommand())
                        {
                            cmd.CommandText = "SELECT table_name FROM duckdb_tables() WHERE database_name = '__old'";
                            using var r = cmd.ExecuteReader();
                            while (r.Read()) tables.Add(r.GetString(0));
                        }
                        foreach (var t in tables)
                        {
                            long a = Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM __old." + Q(t))), b = Convert.ToInt64(Scalar(c, "SELECT COUNT(*) FROM __enc." + Q(t)));
                            if (a != b) throw new InvalidOperationException("table " + t + " has " + a + " rows in the old file and " + b + " in the new one");
                        }
                        Exec(c, "CHECKPOINT __enc");
                    }
                    finally { try { Exec(c, "DETACH __enc"); } catch { } }
                }
                finally { try { Exec(c, "DETACH __old"); } catch { } }
                string old = full + ".plain-old";
                File.Move(full, old, true);
                File.Move(tmp, full, true);
                try { File.Delete(old); } catch { }
                // the plain file's WAL (now stale — its changes were read into the copy) and the temp file's own WAL
                try { if (File.Exists(full + ".wal")) File.Delete(full + ".wal"); } catch { }
                try { if (File.Exists(tmp + ".wal")) File.Delete(tmp + ".wal"); } catch { }
                lock (_lock) _encrypted.Add(full);
                _lastMigration = Path.GetFileName(full) + " encrypted at " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " in " + sw.ElapsedMilliseconds + " ms";
                Debug.WriteLine("[DuckDbVault] " + _lastMigration);
                return true;
            }
            catch (Exception ex)
            {
                _lastMigration = Path.GetFileName(full) + " NOT encrypted: " + Short(ex.Message);
                Debug.WriteLine("[DuckDbVault] migration of " + full + " failed: " + ex.Message);
                try { if (File.Exists(tmp)) File.Delete(tmp); if (File.Exists(tmp + ".wal")) File.Delete(tmp + ".wal"); } catch { }
                return false;
            }
        }

        // ─── helpers ────────────────────────────────────────────────────────────
        private static string Lit(string s) => "'" + (s ?? "").Replace("'", "''") + "'";
        private static string Q(string ident) => "\"" + (ident ?? "").Replace("\"", "\"\"") + "\"";
        private static string Short(string s) { s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim(); return s.Length > 220 ? s.Substring(0, 220) + "…" : s; }
        private static void Exec(DuckDBConnection c, string sql)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = sql;
            cmd.ExecuteNonQuery();
        }
        private static object Scalar(DuckDBConnection c, string sql)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = sql;
            return cmd.ExecuteScalar();
        }
    }
}

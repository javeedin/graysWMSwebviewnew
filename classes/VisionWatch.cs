using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// Vision watches: a webcam, an RTSP / CCTV stream or a video file watched frame by frame by `python vision.py --watch
    /// &lt;folder&gt;` (VisionCv.SCRIPT) in its own process — modes motion (zones + after-hours schedule), line (in / out counting),
    /// scan (barcodes) and detect (YOLO). The process writes status.json, events.jsonl, last.jpg and snaps\*.jpg into
    /// %LOCALAPPDATA%\GraysWMS\vision-watches\&lt;id&gt;\run-&lt;stamp&gt; and stops when a `stop` file appears.
    /// Definitions live in %APPDATA%\GraysWMS\Vision\watches.json; a stream address (it usually holds the camera's user and
    /// password) is DPAPI-encrypted there, is never sent back to the page (only a masked form) and reaches Python through the
    /// environment, never a file. Video files are picked in a dialog of the host; the page only sees the file name.
    /// At most MAX_RUNNING watches at once; all are stopped when the app closes.
    /// </summary>
    public static class VisionWatch
    {
        public const int MAX_RUNNING = 4;
        public static readonly string[] MODES = { "motion", "line", "scan", "detect" };
        private static string DefsFile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "Vision", "watches.json");
        private static string WorkRoot => Path.Combine(CodeRunner.Root, "vision-watches");
        private static readonly object _lock = new object();
        private static readonly ConcurrentDictionary<string, (Process Proc, string Dir, DateTime Started, string User)> _running = new();
        private static readonly ConcurrentDictionary<string, (string Path, DateTime At)> _videoTokens = new();

        // ── definitions ──
        private static JsonArray LoadDefs()
        {
            try { if (File.Exists(DefsFile)) return JsonNode.Parse(File.ReadAllText(DefsFile)) as JsonArray ?? new JsonArray(); } catch { }
            return new JsonArray();
        }

        private static void SaveDefs(JsonArray a)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(DefsFile));
            string tmp = DefsFile + ".tmp";
            File.WriteAllText(tmp, a.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
            File.Move(tmp, DefsFile, true);
        }

        private static string Protect(string s) => Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(s), null, DataProtectionScope.CurrentUser));
        private static string Unprotect(string s)
        {
            try { return string.IsNullOrEmpty(s) ? "" : Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s), null, DataProtectionScope.CurrentUser)); }
            catch { return ""; }
        }
        public static string Mask(string url) => Regex.Replace(url ?? "", @"//[^@/]*@", "//***@");

        private static JsonObject Find(JsonArray defs, string id) => defs.OfType<JsonObject>().FirstOrDefault(d => (string)d["id"] == id);

        /// <summary>What the page may see: everything except the encrypted address and the full video path.</summary>
        private static JsonObject ForPage(JsonObject d)
        {
            var o = JsonNode.Parse(d.ToJsonString()).AsObject();
            if (o["source"] is JsonObject src)
            {
                string enc = (string)src["url_enc"];
                src.Remove("url_enc");
                if (!string.IsNullOrEmpty(enc)) { src["url_masked"] = Mask(Unprotect(enc)); src["has_url"] = true; }
                string p = (string)src["path"];
                if (!string.IsNullOrEmpty(p)) { src.Remove("path"); src["file"] = Path.GetFileName(p); src["file_ok"] = File.Exists(p); }
            }
            string id = (string)o["id"];
            o["running"] = id != null && _running.TryGetValue(id, out var r) && !r.Proc.HasExited;
            return o;
        }

        public static object List(bool admin) => new { ok = true, admin, watches = LoadDefs().OfType<JsonObject>().Select(ForPage).ToList(), running = _running.Count(r => !r.Value.Proc.HasExited), max = MAX_RUNNING, modes = MODES };

        /// <summary>Saves one watch (new when it has no id). source.url replaces the saved address; empty keeps it.
        /// source.video_token (from PickVideo) sets the file.</summary>
        public static object Save(JsonElement w)
        {
            var inc = JsonNode.Parse(w.GetRawText()) as JsonObject ?? throw new Exception("watch must be an object");
            string mode = (string)inc["mode"] ?? "motion";
            if (!MODES.Contains(mode)) throw new Exception("mode must be one of " + string.Join(", ", MODES));
            lock (_lock)
            {
                var defs = LoadDefs();
                string id = (string)inc["id"];
                var old = string.IsNullOrEmpty(id) ? null : Find(defs, id);
                if (string.IsNullOrEmpty(id) || old == null) id = "w" + Guid.NewGuid().ToString("N")[..10];
                var src = inc["source"] as JsonObject ?? new JsonObject();
                var oldSrc = old?["source"] as JsonObject;
                string kind = (string)src["kind"] ?? "camera";
                var ns = new JsonObject { ["kind"] = kind };
                if (kind == "camera") ns["index"] = Math.Clamp((int?)src["index"] ?? 0, 0, 9);
                else if (kind == "rtsp")
                {
                    string url = ((string)src["url"] ?? "").Trim();
                    if (url.Length > 0)
                    {
                        if (!Regex.IsMatch(url, @"^(rtsps?|https?)://", RegexOptions.IgnoreCase)) throw new Exception("the stream address must start with rtsp:// or http(s)://");
                        ns["url_enc"] = Protect(url);
                    }
                    else if (oldSrc?["url_enc"] != null) ns["url_enc"] = (string)oldSrc["url_enc"];
                    else throw new Exception("give the camera's stream address (rtsp://<user>:<password>@<camera-ip>:554/…)");
                }
                else if (kind == "file")
                {
                    string tok = (string)src["video_token"];
                    if (!string.IsNullOrEmpty(tok) && _videoTokens.TryGetValue(tok, out var v)) ns["path"] = v.Path;
                    else if (oldSrc?["path"] != null && (string)oldSrc["kind"] == "file") ns["path"] = (string)oldSrc["path"];
                    else throw new Exception("pick a video file first");
                }
                else throw new Exception("source must be camera, rtsp or file");
                var def = new JsonObject
                {
                    ["id"] = id,
                    ["name"] = Trunc((string)inc["name"], 80) is { Length: > 0 } nm ? nm : "Watch " + (defs.Count + 1),
                    ["mode"] = mode,
                    ["source"] = ns,
                    ["zones"] = inc["zones"]?.DeepClone() ?? new JsonArray(),
                    ["line"] = inc["line"]?.DeepClone(),
                    ["schedule"] = inc["schedule"]?.DeepClone() ?? new JsonObject(),
                    ["options"] = inc["options"]?.DeepClone() ?? new JsonObject(),
                    ["alerts"] = inc["alerts"]?.DeepClone() ?? new JsonObject(),
                    ["changed"] = DateTime.Now.ToString("s"),
                };
                if (old != null) defs.Remove(old);
                defs.Add(def);
                SaveDefs(defs);
                return new { ok = true, watch = ForPage(def) };
            }
        }

        private static string Trunc(string s, int n) => (s ?? "").Trim() is var t && t.Length > n ? t[..n] : (s ?? "").Trim();

        public static object Delete(string id)
        {
            Stop(id, true);
            lock (_lock)
            {
                var defs = LoadDefs();
                var d = Find(defs, id);
                if (d != null) { defs.Remove(d); SaveDefs(defs); }
            }
            try { Directory.Delete(Path.Combine(WorkRoot, SafeId(id)), true); } catch { }
            return new { ok = true };
        }

        private static string SafeId(string id) => Regex.IsMatch(id ?? "", "^[A-Za-z0-9_-]{1,40}$") ? id : throw new Exception("bad watch id");

        // ── video files: picked in the host, the page gets a token and the file name ──
        public static string RegisterVideo(string path)
        {
            foreach (var k in _videoTokens.Where(x => DateTime.UtcNow - x.Value.At > TimeSpan.FromHours(2)).Select(x => x.Key).ToList()) _videoTokens.TryRemove(k, out _);
            string tok = Guid.NewGuid().ToString("N");
            _videoTokens[tok] = (path, DateTime.UtcNow);
            return tok;
        }
        public const string VIDEO_FILTER = "Video files (*.mp4;*.avi;*.mov;*.mkv;*.wmv;*.m4v;*.mpg;*.ts)|*.mp4;*.avi;*.mov;*.mkv;*.wmv;*.m4v;*.mpg;*.ts|All files (*.*)|*.*";

        // ── running ──
        private static ProcessStartInfo Psi(string py, string dir, string flag, string url)
        {
            var psi = new ProcessStartInfo(py) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = dir, RedirectStandardError = true, RedirectStandardOutput = true };
            foreach (var a in new[] { "-X", "utf8", "-u", "vision.py", flag, dir }) psi.ArgumentList.Add(a);
            foreach (var k in psi.Environment.Keys.ToList()) if (Regex.IsMatch(k, "token|secret|passw|pwd|apikey|api_key|credential|_key$", RegexOptions.IgnoreCase)) psi.Environment.Remove(k);
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["YOLO_VERBOSE"] = "False";
            if (!string.IsNullOrEmpty(url)) psi.Environment["VISION_SOURCE_URL"] = url;
            return psi;
        }

        /// <summary>The watch.json Python reads: the definition's settings flattened (options on top), the address left out.</summary>
        private static (JsonObject Cfg, string Url) BuildCfg(JsonObject def)
        {
            var src = (def["source"] as JsonObject) ?? new JsonObject();
            string url = src["url_enc"] != null ? Unprotect((string)src["url_enc"]) : (string)src["url"];
            var s2 = new JsonObject { ["kind"] = (string)src["kind"] ?? "camera" };
            if (src["index"] != null) s2["index"] = (int)src["index"];
            if (src["path"] != null) s2["path"] = (string)src["path"];
            var cfg = new JsonObject
            {
                ["mode"] = (string)def["mode"] ?? "motion",
                ["source"] = s2,
                ["zones"] = def["zones"]?.DeepClone() ?? new JsonArray(),
                ["line"] = def["line"]?.DeepClone(),
                ["schedule"] = def["schedule"]?.DeepClone() ?? new JsonObject(),
                ["models_dir"] = VisionCv.ModelsDir,
            };
            if (def["options"] is JsonObject opt)
                foreach (var kv in opt)
                    if (!cfg.ContainsKey(kv.Key) && kv.Key != "models_dir" && kv.Key != "source") cfg[kv.Key] = kv.Value?.DeepClone();
            return (cfg, url);
        }

        public static async Task<object> StartAsync(string id, string user)
        {
            SafeId(id);
            if (_running.TryGetValue(id, out var cur) && !cur.Proc.HasExited) return new { ok = true, already = true, run = Path.GetFileName(cur.Dir) };
            foreach (var k in _running.Where(r => r.Value.Proc.HasExited).Select(r => r.Key).ToList()) _running.TryRemove(k, out _);
            if (_running.Count >= MAX_RUNNING) return new { ok = false, error = "At most " + MAX_RUNNING + " watches can run at once on this PC — stop one first." };
            JsonObject def;
            lock (_lock) def = Find(LoadDefs(), id);
            if (def == null) return new { ok = false, error = "No such watch." };
            string py = await CodeRunner.FindAsync("python");
            if (py == null) return new { ok = false, error = "OpenCV is not set up on this PC yet (Vision › Set up — an AI admin)." };
            var (cfg, url) = BuildCfg(def);
            string baseDir = Path.Combine(WorkRoot, id);
            string dir = Path.Combine(baseDir, "run-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(dir);
            // keep the last 5 runs of each watch (events + snapshots), delete older ones
            foreach (var old in Directory.GetDirectories(baseDir, "run-*").OrderByDescending(x => x).Skip(5)) try { Directory.Delete(old, true); } catch { }
            File.WriteAllText(Path.Combine(dir, "vision.py"), VisionCv.Script, new UTF8Encoding(false));
            File.WriteAllText(Path.Combine(dir, "watch.json"), cfg.ToJsonString(), new UTF8Encoding(false));
            var p = new Process { StartInfo = Psi(py, dir, "--watch", url) };
            var err = new StringBuilder();
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (err) { err.AppendLine(e.Data); if (err.Length > 6000) err.Remove(0, err.Length - 6000); File.WriteAllText(Path.Combine(dir, "stderr.txt"), err.ToString()); } };
            p.OutputDataReceived += (s, e) => { };
            p.Start();
            p.BeginErrorReadLine(); p.BeginOutputReadLine();
            _running[id] = (p, dir, DateTime.Now, user);
            return new { ok = true, run = Path.GetFileName(dir) };
        }

        public static object Stop(string id, bool force = false)
        {
            if (!_running.TryGetValue(id ?? "", out var r)) return new { ok = true, running = false };
            try { File.WriteAllText(Path.Combine(r.Dir, "stop"), "stop"); } catch { }
            var proc = r.Proc;
            _ = Task.Run(async () =>
            {
                for (int i = 0; i < (force ? 5 : 100) && !proc.HasExited; i++) await Task.Delay(100);
                try { if (!proc.HasExited) proc.Kill(true); } catch { }
            });
            return new { ok = true, stopping = true };
        }

        public static void StopAll()
        {
            foreach (var r in _running.Values)
            {
                try { File.WriteAllText(Path.Combine(r.Dir, "stop"), "stop"); } catch { }
                try { if (!r.Proc.WaitForExit(1500)) r.Proc.Kill(true); } catch { }
            }
            _running.Clear();
        }

        private static string LatestRun(string id)
        {
            if (_running.TryGetValue(id, out var r)) return r.Dir;
            string b = Path.Combine(WorkRoot, SafeId(id));
            return Directory.Exists(b) ? Directory.GetDirectories(b, "run-*").OrderByDescending(x => x).FirstOrDefault() : null;
        }

        /// <summary>Status, the events after event number `after` (≤ 300), and the latest annotated frame when `frame` and it changed.</summary>
        public static object Status(string id, int after, bool frame, string frameStamp)
        {
            string dir = LatestRun(SafeId(id));
            if (dir == null) return new { ok = true, run = (string)null, running = false };
            bool running = _running.TryGetValue(id, out var r) && !r.Proc.HasExited;
            JsonNode st = null;
            try { st = JsonNode.Parse(ReadShared(Path.Combine(dir, "status.json"))); } catch { }
            var events = new List<JsonNode>();
            string ef = Path.Combine(dir, "events.jsonl");
            if (File.Exists(ef))
                foreach (var line in ReadShared(ef).Split('\n'))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try { var e = JsonNode.Parse(line); if ((int?)e["n"] > after) events.Add(e); } catch { }
                    if (events.Count >= 300) break;
                }
            string img = null, stamp = null;
            string lf = Path.Combine(dir, "last.jpg");
            if (frame && File.Exists(lf))
            {
                stamp = File.GetLastWriteTimeUtc(lf).Ticks.ToString();
                if (stamp != frameStamp) try { img = Convert.ToBase64String(ReadSharedBytes(lf)); } catch { }
            }
            string err = null;
            string sf = Path.Combine(dir, "stderr.txt");
            if (!running && File.Exists(sf)) { err = ReadShared(sf); if (err.Length > 1500) err = err[^1500..]; }
            if (!running && st != null && (string)st["state"] is "running" or "starting" or "reconnecting") st["state"] = "ended";
            return new { ok = true, run = Path.GetFileName(dir), running, status = st, events, frame = img, frameStamp = stamp, stderr = err };
        }

        public static object Snap(string id, string snap, string run)
        {
            if (!Regex.IsMatch(snap ?? "", @"^ev_\d{6}\.jpg$")) return new { ok = false, error = "bad snapshot name" };
            string dir = !string.IsNullOrEmpty(run) && Regex.IsMatch(run, @"^run-\d{8}-\d{6}$") ? Path.Combine(WorkRoot, SafeId(id), run) : LatestRun(SafeId(id));
            string f = dir == null ? null : Path.Combine(dir, "snaps", snap);
            if (f == null || !File.Exists(f)) return new { ok = false, error = "that snapshot is no longer kept" };
            return new { ok = true, media_type = "image/jpeg", data = Convert.ToBase64String(ReadSharedBytes(f)) };
        }

        /// <summary>One frame for drawing zones / lines: of a saved watch (id) or of the source being edited (source.url / video_token / index).</summary>
        public static async Task<object> PreviewAsync(string id, JsonElement? source, double atS)
        {
            string py = await CodeRunner.FindAsync("python");
            if (py == null) return new { ok = false, error = "OpenCV is not set up on this PC yet." };
            JsonObject cfg; string url;
            JsonObject def = null;
            if (!string.IsNullOrEmpty(id)) lock (_lock) def = Find(LoadDefs(), SafeId(id));
            if (source is JsonElement se && se.ValueKind == JsonValueKind.Object)
            {
                var src = JsonNode.Parse(se.GetRawText()).AsObject();
                string kind = (string)src["kind"] ?? "camera";
                var s2 = new JsonObject { ["kind"] = kind };
                url = null;
                if (kind == "camera") s2["index"] = Math.Clamp((int?)src["index"] ?? 0, 0, 9);
                else if (kind == "rtsp")
                {
                    url = ((string)src["url"] ?? "").Trim();
                    if (url.Length == 0 && def?["source"]?["url_enc"] != null) url = Unprotect((string)def["source"]["url_enc"]);
                    if (!Regex.IsMatch(url, @"^(rtsps?|https?)://", RegexOptions.IgnoreCase)) return new { ok = false, error = "give the stream address (rtsp://…)" };
                }
                else if (kind == "file")
                {
                    string tok = (string)src["video_token"];
                    if (!string.IsNullOrEmpty(tok) && _videoTokens.TryGetValue(tok, out var v)) s2["path"] = v.Path;
                    else if (def?["source"]?["path"] != null) s2["path"] = (string)def["source"]["path"];
                    else return new { ok = false, error = "pick a video file first" };
                }
                cfg = new JsonObject { ["source"] = s2 };
            }
            else if (def != null) (cfg, url) = BuildCfg(def);
            else return new { ok = false, error = "No source." };
            cfg["at_s"] = Math.Max(0, atS);
            string dir = Path.Combine(CodeRunner.Root, "coderun", "vision-grab-" + Guid.NewGuid().ToString("N")[..8]);
            try
            {
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "vision.py"), VisionCv.Script, new UTF8Encoding(false));
                File.WriteAllText(Path.Combine(dir, "watch.json"), cfg.ToJsonString(), new UTF8Encoding(false));
                using var p = new Process { StartInfo = Psi(py, dir, "--grab", url) };
                p.Start();
                var outTask = p.StandardOutput.ReadToEndAsync();
                var errTask = p.StandardError.ReadToEndAsync();
                if (!await Task.Run(() => p.WaitForExit(45000))) { try { p.Kill(true); } catch { } return new { ok = false, error = "no picture within 45 s — check the camera / address" }; }
                string fj = Path.Combine(dir, "frame.json");
                if (!File.Exists(fj)) { string e = await errTask; return new { ok = false, error = "preview failed: " + (e.Length > 800 ? e[^800..] : e) }; }
                var info = JsonNode.Parse(File.ReadAllText(fj));
                if ((bool?)info["ok"] != true) return new { ok = false, error = (string)info["error"] ?? "no picture" };
                return new { ok = true, info, media_type = "image/jpeg", data = Convert.ToBase64String(File.ReadAllBytes(Path.Combine(dir, "frame.jpg"))) };
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }

        // the watch process writes these files while we read them
        private static string ReadShared(string f)
        {
            using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var sr = new StreamReader(fs, Encoding.UTF8);
            return sr.ReadToEnd();
        }
        private static byte[] ReadSharedBytes(string f)
        {
            using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var ms = new MemoryStream();
            fs.CopyTo(ms);
            return ms.ToArray();
        }
    }
}

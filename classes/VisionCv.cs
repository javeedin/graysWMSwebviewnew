using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace WMSApp
{
    /// <summary>
    /// Vision (OpenCV) for the AI Agent: the Vision tab, the agent's `vision` tool and OpenCV inside the Code tab's Python.
    /// Runs the fixed script below (SCRIPT) in the code runner's Python (CodeRunner: %LOCALAPPDATA%\GraysWMS\runtimes\pyenv)
    /// with opencv-contrib-python-headless + zxing-cpp (barcodes of every format). Operations: info, document (find the page,
    /// flatten the perspective, colour / gray / black-and-white), barcodes, count (contours + watershed or circles), compare
    /// (align with ORB, SSIM, changed areas, heat map), find (multi-scale template match), enhance (white balance, CLAHE,
    /// denoise, sharpen, deskew, rotate), edges, resize, measure (ArUco marker → cm, volume from 2 photos), markers (printable
    /// marker sheet), ocr (PP-OCR via rapidocr + lot / expiry / weight fields), color (CIEDE2000 shade check), stitch (shelf
    /// panorama + empty spaces), generate (QR / barcode labels + A4 sheet), depth (stereo pair), level (fill level). It only reads the images it is given and writes result.json + out\*;
    /// the work folder is deleted afterwards (photos are not kept). No user code runs here, so any user may use it once an
    /// AI admin has set it up on the PC.
    /// </summary>
    public static class VisionCv
    {
        public static readonly string[] PACKAGES = { "opencv-contrib-python-headless", "zxing-cpp", "rapidocr_onnxruntime" };
        /// <summary>The YOLO add-on: Ultralytics (AGPL-3.0, see the docs) on PyTorch CPU (Windows wheels from PyPI are CPU builds).</summary>
        public static readonly string[] YOLO_PACKAGES = { "torch", "torchvision", "ultralytics" };
        public static string ModelsDir => Path.Combine(CodeRunner.Root, "models");
        public static readonly string[] OPS = { "info", "document", "barcodes", "count", "compare", "find", "enhance", "edges", "resize", "detect", "similar",
            "measure", "markers", "ocr", "color", "stitch", "generate", "depth", "level" };
        /// <summary>Operations that make pictures instead of reading them (marker sheet, labels).</summary>
        public static readonly string[] NO_IMAGE_OPS = { "markers", "generate" };
        /// <summary>The Python script, also run by VisionWatch (--watch / --grab).</summary>
        public static string Script => SCRIPT;
        private static object _status;
        private static DateTime _statusAt = DateTime.MinValue;

        public static async Task<object> StatusAsync(bool fresh = false)
        {
            if (!fresh && _status != null && DateTime.UtcNow - _statusAt < TimeSpan.FromMinutes(10)) return _status;
            string py = await CodeRunner.FindAsync("python");
            CodeRunner.Installs.TryGetValue("opencv", out var ins);
            object setup = ins == null ? null : new { ins.State, ins.Log, ins.Error };
            if (py == null) return new { python = false, opencv = (string)null, zxing = false, ready = false, setup, yolo = (string)null };
            var r = await CodeRunner.ExecAsync(py, new[] { "-c", "import json\nfrom importlib.metadata import version as V\ndef g(n):\n try: return V(n)\n except Exception: return None\ntry:\n import cv2; v=cv2.__version__\nexcept Exception: v=None\nprint(json.dumps({'cv':v,'zx':g('zxing-cpp') is not None,'ocr':g('rapidocr_onnxruntime'),'yolo':g('ultralytics'),'torch':g('torch')}))" }, null, null, 60);
            string cv = null, yolo = null, torch = null, ocr = null; bool zx = false;
            try
            {
                using var d = JsonDocument.Parse(r.Out.Trim().Split('\n').Last());
                string Str(string k) => d.RootElement.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
                cv = Str("cv"); yolo = Str("yolo"); torch = Str("torch"); ocr = Str("ocr"); zx = d.RootElement.GetProperty("zx").GetBoolean();
            }
            catch { }
            CodeRunner.Installs.TryGetValue("yolo", out var yins);
            var models = Directory.Exists(ModelsDir) ? Directory.GetFiles(ModelsDir, "*.pt").Select(f => new { name = Path.GetFileNameWithoutExtension(f), mb = Math.Round(new FileInfo(f).Length / 1048576.0, 1) }).ToList<object>() : new List<object>();
            var st = new { python = true, opencv = cv, zxing = zx, ocr, ready = cv != null, setup, path = py, yolo, torch,
                yoloSetup = yins == null ? null : new { yins.State, yins.Log, yins.Error }, models, modelsDir = ModelsDir, worker = _worker != null && !_worker.HasExited };
            if (cv != null) { _status = st; _statusAt = DateTime.UtcNow; }
            return st;
        }

        /// <summary>Background setup: Python (if missing) then pip install OpenCV + zxing-cpp into the code runner's Python.</summary>
        public static Task SetupAsync(bool yolo = false)
        {
            string key = yolo ? "yolo" : "opencv";
            string[] pkgs = yolo ? PACKAGES.Concat(YOLO_PACKAGES).ToArray() : PACKAGES;
            var ins = CodeRunner.Installs.AddOrUpdate(key, _ => new CodeRunner.Install(), (_, old) => old.State == "running" ? old : new CodeRunner.Install());
            if (ins.State == "running") return Task.CompletedTask;
            ins.State = "running"; _status = null;
            return Task.Run(async () =>
            {
                void Log(string s) { lock (ins) ins.Log = (ins.Log + s + "\n").Length > 6000 ? (ins.Log + s + "\n")[^6000..] : ins.Log + s + "\n"; }
                try
                {
                    string py = await CodeRunner.FindAsync("python");
                    if (py == null)
                    {
                        Log("Installing Python first (python.org, ~27 MB)…");
                        await CodeRunner.InstallAsync("python");
                        for (int i = 0; i < 900 && CodeRunner.Installs.TryGetValue("python", out var p) && p.State == "running"; i++) await Task.Delay(1000);
                        py = await CodeRunner.FindAsync("python");
                        if (py == null) throw new Exception("Python could not be installed — see Code tab › Languages.");
                    }
                    Log(yolo ? "Installing PyTorch (CPU) and YOLO (~600 MB — this takes a few minutes)…" : "Installing OpenCV, the barcode reader and the text reader (~120 MB)…");
                    var r = await CodeRunner.ExecAsync(py, new[] { "-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade" }.Concat(pkgs).ToArray(), null, null, 3600);
                    if (r.Code != 0) throw new Exception("pip: " + (r.Err.Length > 800 ? r.Err[^800..] : r.Err));
                    if (yolo)
                    {
                        // no usage analytics to Ultralytics, and the first model now (6 MB) so the first detection is quick
                        Directory.CreateDirectory(ModelsDir);
                        Log("Downloading the YOLO11n model…");
                        var m = await CodeRunner.ExecAsync(py, new[] { "-c", "from ultralytics import YOLO, settings\nsettings.update({'sync': False})\nimport os\nYOLO(os.path.join(r'" + ModelsDir + "', 'yolo11n.pt'))\nprint('ok')" }, null, ModelsDir, 600);
                        if (m.Code != 0) Log("Model download failed (it is tried again on first use): " + (m.Err.Length > 400 ? m.Err[^400..] : m.Err));
                    }
                    StopWorker();
                    var st = await StatusAsync(true);
                    Log("Ready: " + JsonSerializer.Serialize(st));
                    ins.State = "done";
                }
                catch (Exception ex) { ins.Error = ex.Message; ins.State = "error"; Log("Failed: " + ex.Message); }
            });
        }

        // ── the worker: one long-lived `python vision.py --serve` so OpenCV / PyTorch / YOLO models stay loaded (a live YOLO
        //    frame then takes ~50 ms instead of seconds); one job at a time, restarted when it dies or a job times out,
        //    stopped after 10 idle minutes. Same environment rules as the code runner (no secret-looking variables). ──
        private static Process _worker;
        private static readonly SemaphoreSlim _wLock = new SemaphoreSlim(1, 1);
        private static readonly object _outLock = new object();
        private static readonly Queue<string> _lines = new Queue<string>();
        private static readonly StringBuilder _err = new StringBuilder();
        private static System.Threading.Timer _idle;

        public static void StopWorker()
        {
            try { if (_worker != null && !_worker.HasExited) _worker.Kill(true); } catch { }
            _worker = null;
        }

        private static async Task<bool> EnsureWorkerAsync(string py)
        {
            if (_worker != null && !_worker.HasExited) return true;
            string wdir = Path.Combine(CodeRunner.Root, "coderun", "vision-worker");
            Directory.CreateDirectory(wdir);
            File.WriteAllText(Path.Combine(wdir, "vision.py"), SCRIPT, new UTF8Encoding(false));
            var psi = new ProcessStartInfo(py) { UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = wdir };
            foreach (var a in new[] { "-X", "utf8", "-u", "vision.py", "--serve" }) psi.ArgumentList.Add(a);
            foreach (var k in psi.Environment.Keys.ToList()) if (Regex.IsMatch(k, "token|secret|passw|pwd|apikey|api_key|credential|_key$", RegexOptions.IgnoreCase)) psi.Environment.Remove(k);
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["YOLO_VERBOSE"] = "False";
            lock (_outLock) { _lines.Clear(); _err.Clear(); }
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (_outLock) _lines.Enqueue(e.Data); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (_outLock) { _err.AppendLine(e.Data); if (_err.Length > 8000) _err.Remove(0, _err.Length - 8000); } };
            try { p.Start(); } catch (Exception ex) { lock (_outLock) _err.Append(ex.Message); return false; }
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
            _worker = p;
            for (int i = 0; i < 600; i++)        // importing OpenCV takes a moment the first time
            {
                if (p.HasExited) return false;
                lock (_outLock) if (_lines.Contains("READY")) { _lines.Clear(); return true; }
                await Task.Delay(50);
            }
            StopWorker();
            return false;
        }

        /// <summary>Runs one job folder in the worker; returns "" or the error text. Falls back to a one-shot process.</summary>
        private static async Task<string> RunInWorkerAsync(string py, string dir, int timeoutS)
        {
            await _wLock.WaitAsync();
            try
            {
                _idle?.Dispose();
                if (!await EnsureWorkerAsync(py))
                {
                    File.WriteAllText(Path.Combine(dir, "vision.py"), SCRIPT, new UTF8Encoding(false));
                    var r = await CodeRunner.ExecAsync(py, new[] { "-X", "utf8", "vision.py" }, null, dir, timeoutS);
                    return r.TimedOut ? "Stopped after the time limit." : r.Err;
                }
                await _worker.StandardInput.WriteLineAsync(dir);
                await _worker.StandardInput.FlushAsync();
                var until = DateTime.UtcNow.AddSeconds(timeoutS);
                while (DateTime.UtcNow < until)
                {
                    lock (_outLock)
                        while (_lines.Count > 0) if (_lines.Dequeue() == "DONE " + dir) return "";
                    if (_worker.HasExited) { string e; lock (_outLock) e = _err.ToString(); _worker = null; return "the vision worker stopped: " + e; }
                    await Task.Delay(15);
                }
                StopWorker();
                return "Stopped after the time limit (" + timeoutS + " s).";
            }
            finally
            {
                _idle = new System.Threading.Timer(_ => StopWorker(), null, TimeSpan.FromMinutes(10), Timeout.InfiniteTimeSpan);
                _wLock.Release();
            }
        }

        public sealed class VisionResult { public bool Ok; public string Error; public string Json; public List<(string Name, string Mime, string Base64, string Note)> Images = new(); public long Ms; }

        public static async Task<VisionResult> RunAsync(string op, string paramsJson, List<(string Name, byte[] Bytes)> images, int timeoutS = 120)
        {
            var res = new VisionResult();
            op = (op ?? "").Trim().ToLowerInvariant();
            if (!OPS.Contains(op)) { res.Error = "Operation must be one of: " + string.Join(", ", OPS); return res; }
            if ((images == null || images.Count == 0) && !NO_IMAGE_OPS.Contains(op)) { res.Error = "No image given."; return res; }
            images ??= new List<(string Name, byte[] Bytes)>();
            string py = await CodeRunner.FindAsync("python");
            if (py == null) { res.Error = "OpenCV is not set up on this PC yet (AI Agent › Vision › Set up — an AI admin)."; return res; }
            string dir = Path.Combine(CodeRunner.Root, "coderun", "vision-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N")[..6]);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                Directory.CreateDirectory(Path.Combine(dir, "in"));
                var names = new Dictionary<string, string>();
                int n = 0;
                foreach (var (name, bytes) in images.Take(6))
                {
                    if (bytes == null || bytes.Length == 0 || bytes.Length > 20_000_000) continue;
                    string ext = bytes.Length > 3 && bytes[0] == 0x89 && bytes[1] == 0x50 ? ".png" : bytes[0] == 0xFF && bytes[1] == 0xD8 ? ".jpg" : ".img";
                    string f = (++n).ToString("00") + ext;          // the order matters (compare: before / after, find: scene / thing)
                    File.WriteAllBytes(Path.Combine(dir, "in", f), bytes);
                    names[f] = string.IsNullOrWhiteSpace(name) ? f : Path.GetFileName(name);
                }
                if (n == 0 && !NO_IMAGE_OPS.Contains(op)) { res.Error = "The images are empty or larger than 20 MB."; return res; }
                JsonElement prm;
                try { prm = JsonDocument.Parse(string.IsNullOrWhiteSpace(paramsJson) ? "{}" : paramsJson).RootElement; } catch { prm = JsonDocument.Parse("{}").RootElement; }
                Directory.CreateDirectory(ModelsDir);
                File.WriteAllText(Path.Combine(dir, "params.json"), JsonSerializer.Serialize(new { op, @params = prm, names, models_dir = ModelsDir }), new UTF8Encoding(false));
                string err = await RunInWorkerAsync(py, dir, Math.Clamp(timeoutS, 10, 600));
                string rj = Path.Combine(dir, "result.json");
                if (!File.Exists(rj))
                {
                    res.Error = err.Contains("No module named 'cv2'") ? "OpenCV is not set up on this PC yet (AI Agent › Vision › Set up — an AI admin)." : "Vision failed: " + (err.Length > 1200 ? err[^1200..] : err);
                    return res;
                }
                res.Json = File.ReadAllText(rj);
                using (var d = JsonDocument.Parse(res.Json))
                {
                    res.Ok = d.RootElement.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True;
                    if (!res.Ok && d.RootElement.TryGetProperty("error", out var er)) res.Error = er.GetString();
                    if (d.RootElement.TryGetProperty("outputs", out var outs))
                        foreach (var o in outs.EnumerateArray().Take(10))
                        {
                            string f = Path.Combine(dir, "out", Path.GetFileName(o.GetProperty("file").GetString() ?? ""));
                            if (!File.Exists(f) || new FileInfo(f).Length > 8_000_000) continue;
                            res.Images.Add((Path.GetFileName(f), f.EndsWith(".jpg") ? "image/jpeg" : "image/png", Convert.ToBase64String(File.ReadAllBytes(f)),
                                o.TryGetProperty("note", out var nt) ? nt.GetString() : ""));
                        }
                }
                return res;
            }
            finally
            {
                res.Ms = sw.ElapsedMilliseconds;
                try { Directory.Delete(dir, true); } catch { }   // the user's photos are not kept
            }
        }

        // the OpenCV operations (Python); tested against opencv 5.0 and zxing-cpp 2.x
        private const string SCRIPT = """"
# Gray's WMS — OpenCV operations for the AI Agent's Vision tab and the agent's `vision` tool (classes/VisionCv.cs).
# A job = a folder with params.json + in/* images → result.json + out/*.png|jpg. Read-only on the user's images.
# One-shot: run in the job folder. Worker: `python vision.py --serve` reads one job folder per line on stdin and answers
# "DONE <folder>" (keeps OpenCV / PyTorch / YOLO models loaded between jobs). Network only for YOLO's first model download.
import glob
import json
import math
import os
import sys
import traceback

import cv2
import numpy as np

P: dict = {}
OP = ""
PRM: dict = {}
RESULT: dict = {}
_YOLO: dict = {}
FONT = cv2.FONT_HERSHEY_SIMPLEX
GREEN, RED, BLUE, YELLOW = (60, 180, 75), (40, 40, 220), (220, 120, 30), (0, 200, 255)


def num(k, d, lo=None, hi=None):
    try:
        v = float(PRM.get(k, d))
    except (TypeError, ValueError):
        v = d
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


def load(f):
    img = cv2.imdecode(np.fromfile(f, np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("Not an image: " + os.path.basename(f))
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        a = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3].astype(np.float32) * a + 255 * (1 - a)).astype(np.uint8)
    return img


def save(name, img, note=""):
    big = img.shape[0] * img.shape[1] > 2_500_000
    ext = ".jpg" if big else ".png"
    ok, buf = cv2.imencode(ext, img, [cv2.IMWRITE_JPEG_QUALITY, 90] if big else [])
    if ok:
        buf.tofile(os.path.join("out", name + ext))
        RESULT["outputs"].append({"file": name + ext, "width": int(img.shape[1]), "height": int(img.shape[0]), "note": note})


def fit(img, side):
    h, w = img.shape[:2]
    s = side / max(h, w)
    return (cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA), s) if s < 1 else (img, 1.0)


def label(img, text, org, color=GREEN):
    scale = max(0.5, min(img.shape[:2]) / 900)
    th = max(1, int(scale * 2))
    (tw, tht), _ = cv2.getTextSize(text, FONT, scale, th)
    x, y = int(org[0]), int(org[1])
    y = max(tht + 4, y)
    cv2.rectangle(img, (x, y - tht - 6), (x + tw + 6, y + 2), color, -1)
    cv2.putText(img, text, (x + 3, y - 3), FONT, scale, (255, 255, 255), th, cv2.LINE_AA)


def hexc(c):
    return "#%02x%02x%02x" % (int(c[2]), int(c[1]), int(c[0]))


# ── operations ──────────────────────────────────────────────
def op_info(imgs):
    for name, img in imgs:
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        sharp = float(cv2.Laplacian(fit(g, 1200)[0], cv2.CV_64F).var())
        small = fit(img, 160)[0].reshape(-1, 3).astype(np.float32)
        k = 5
        _, lab, cen = cv2.kmeans(small, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 2, cv2.KMEANS_PP_CENTERS)
        cnt = np.bincount(lab.flatten(), minlength=k)
        order = np.argsort(-cnt)
        RESULT["images"].append({
            "name": name, "width": int(img.shape[1]), "height": int(img.shape[0]),
            "sharpness": round(sharp, 1), "sharp_verdict": "sharp" if sharp > 150 else "ok" if sharp > 60 else "blurry",
            "brightness": round(float(g.mean()), 1), "contrast": round(float(g.std()), 1),
            "exposure": "dark" if g.mean() < 60 else "bright" if g.mean() > 200 else "ok",
            "colors": [{"hex": hexc(cen[i]), "share": round(float(cnt[i]) / len(lab) * 100, 1)} for i in order],
        })


def order_pts(p):
    p = p.reshape(4, 2).astype(np.float32)
    s, d = p.sum(1), np.diff(p, axis=1).ravel()
    return np.array([p[np.argmin(s)], p[np.argmin(d)], p[np.argmax(s)], p[np.argmax(d)]], np.float32)


def find_page(img):
    small, s = fit(img, 1000)
    g = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    area_min = small.shape[0] * small.shape[1] * 0.15
    for lo, hi in ((50, 150), (30, 100), (75, 200)):
        e = cv2.dilate(cv2.Canny(g, lo, hi), np.ones((5, 5), np.uint8), iterations=2)
        cs = sorted(cv2.findContours(e, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea, reverse=True)[:8]
        for c in cs:
            if cv2.contourArea(c) < area_min:
                break
            a = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
            if len(a) == 4 and cv2.isContourConvex(a):
                return order_pts(a / s), True
    # bright page on a darker background
    _, t = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    cs = sorted(cv2.findContours(t, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea, reverse=True)
    if cs and cv2.contourArea(cs[0]) > area_min:
        return order_pts(cv2.boxPoints(cv2.minAreaRect(cs[0])) / s), True
    h, w = img.shape[:2]
    return np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], np.float32), False


def op_document(imgs):
    mode = str(PRM.get("mode", "color")).lower()
    for i, (name, img) in enumerate(imgs, 1):
        q, found = find_page(img)
        wd = int(max(np.linalg.norm(q[0] - q[1]), np.linalg.norm(q[2] - q[3])))
        ht = int(max(np.linalg.norm(q[0] - q[3]), np.linalg.norm(q[1] - q[2])))
        M = cv2.getPerspectiveTransform(q, np.array([[0, 0], [wd - 1, 0], [wd - 1, ht - 1], [0, ht - 1]], np.float32))
        page = cv2.warpPerspective(img, M, (wd, ht), flags=cv2.INTER_CUBIC)
        if mode in ("gray", "bw"):
            page = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
            if mode == "bw":
                page = cv2.adaptiveThreshold(page, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15)
            page = cv2.cvtColor(page, cv2.COLOR_GRAY2BGR)
        else:
            lab = cv2.cvtColor(page, cv2.COLOR_BGR2LAB)
            lab[:, :, 0] = cv2.createCLAHE(2.0, (8, 8)).apply(lab[:, :, 0])
            page = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        prev = img.copy()
        cv2.polylines(prev, [q.astype(np.int32)], True, GREEN if found else RED, max(3, img.shape[1] // 300))
        save("detected_%d" % i, prev, "page edges found" if found else "no page edges found — whole image used")
        save("scan_%d" % i, page, "flattened page (" + mode + ")")
        RESULT["images"].append({"name": name, "page_found": found, "corners": q.round(1).tolist(), "width": wd, "height": ht})


def barcode_detector():
    for f in (lambda: cv2.barcode.BarcodeDetector(), lambda: cv2.barcode_BarcodeDetector()):
        try:
            return f()
        except Exception:
            pass
    return None


def read_codes(img):
    # zxing-cpp first (every 1D / 2D format: Code 128 / 39 / 93, EAN, UPC, ITF, Codabar, QR, DataMatrix, PDF417, Aztec),
    # then OpenCV's own QR and EAN / UPC readers
    found = []
    try:
        import zxingcpp
        for r in zxingcpp.read_barcodes(img):
            if r.text:
                p = r.position
                found.append({"type": str(r.format).split(".")[-1], "data": r.text,
                              "points": [[p.top_left.x, p.top_left.y], [p.top_right.x, p.top_right.y], [p.bottom_right.x, p.bottom_right.y], [p.bottom_left.x, p.bottom_left.y]]})
    except ImportError:
        RESULT["note"] = "zxing-cpp is not installed: only QR and EAN / UPC codes are read (Vision › Set up adds it)"
    except Exception:
        pass
    qr = cv2.QRCodeDetector()
    try:
        ok, texts, pts, _ = qr.detectAndDecodeMulti(img)
        if ok:
            for t, p in zip(texts, pts, strict=False):
                if t:
                    found.append({"type": "QR Code", "data": t, "points": p.reshape(-1, 2).tolist()})
    except Exception:
        pass
    bd = barcode_detector()
    if bd is not None:
        try:
            ok, pts = bd.detectMulti(img)
            boxes = list(pts) if ok and pts is not None else []
            h, w = img.shape[:2]
            boxes.append(np.array([[0, h - 1], [0, 0], [w - 1, 0], [w - 1, h - 1]], np.float32))
            for p in boxes:
                r = bd.decodeWithType(img, np.array(p, np.float32).reshape(1, 4, 2))
                if r[0]:
                    for t, ty in zip(r[1], r[2], strict=False):
                        if t:
                            found.append({"type": str(ty).replace("_", "-"), "data": t, "points": np.array(p).reshape(-1, 2).tolist()})
        except Exception:
            pass
    return found


def barcode_regions(img):
    # where barcodes probably are, even when they cannot be read yet: OpenCV's barcode detector, then the classic
    # gradient method (bars = strong horizontal gradient, weak vertical) — boxes (x, y, w, h) in the image's pixels
    boxes = []
    bd = barcode_detector()
    if bd is not None:
        try:
            ok, pts = bd.detectMulti(img)
            if ok and pts is not None:
                for p in pts:
                    x, y, w, h = cv2.boundingRect(np.array(p, np.float32).reshape(-1, 2))
                    boxes.append([x, y, w, h])
        except Exception:
            pass
    small, s = fit(img, 1000)
    g = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    for gx, gy in ((1, 0), (0, 1)):          # vertical bars, and bars turned 90°
        grad = cv2.convertScaleAbs(cv2.subtract(cv2.Sobel(g, cv2.CV_32F, gx, gy, ksize=-1), cv2.Sobel(g, cv2.CV_32F, gy, gx, ksize=-1)))
        _, t = cv2.threshold(cv2.blur(grad, (9, 9)), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 7) if gx else (7, 21))
        t = cv2.dilate(cv2.erode(cv2.morphologyEx(t, cv2.MORPH_CLOSE, k), None, iterations=4), None, iterations=4)
        for c in sorted(cv2.findContours(t, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea, reverse=True)[:3]:
            x, y, w, h = cv2.boundingRect(c)
            if w * h > 0.001 * small.shape[0] * small.shape[1] and 1.2 < max(w, h) / max(1, min(w, h)) < 8:
                boxes.append([int(x / s), int(y / s), int(w / s), int(h / s)])
    out = []
    for b in boxes:
        if all(iou(b, o) < 0.3 for o in out):
            out.append(b)
    return out[:6]


def bar_pitch(img, b):
    # how many bars cross the middle of the region and how many pixels each one gets (EAN needs ~2 or more)
    x, y, w, h = b
    g = cv2.cvtColor(img[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY)
    if g.size == 0:
        return 0, 0.0
    best = (0, 0.0)
    for line in (g[g.shape[0] // 2, :], g[:, g.shape[1] // 2]):
        if line.size < 8:
            continue
        t = (line > (int(line.min()) + int(line.max())) / 2).astype(np.int8)
        edges = np.flatnonzero(np.diff(t))
        if edges.size > best[0]:
            best = (int(edges.size), float(edges[-1] - edges[0]) / max(1, edges.size - 1))   # span of the bars only, not the margins
    return best


def read_region(img, b):
    # zoom into one region: crop with a margin, enlarge until the bars are a few pixels wide, sharpen, read again
    x, y, w, h = b
    mx, my = int(w * 0.25) + 8, int(h * 0.35) + 8
    x0, y0, x1, y1 = max(0, x - mx), max(0, y - my), min(img.shape[1], x + w + mx), min(img.shape[0], y + h + my)
    crop = img[y0:y1, x0:x1]
    if crop.size == 0:
        return [], 0.0
    f = min(6.0, max(1.0, 900.0 / max(crop.shape[:2])))
    big = cv2.resize(crop, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
    sharp = cv2.addWeighted(big, 1.7, cv2.GaussianBlur(big, (0, 0), 2.0), -0.7, 0)
    g = cv2.cvtColor(sharp, cv2.COLOR_BGR2GRAY)
    _, bw = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    blur = float(cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
    for v in (sharp, cv2.cvtColor(cv2.createCLAHE(3.0, (8, 8)).apply(g), cv2.COLOR_GRAY2BGR), cv2.cvtColor(bw, cv2.COLOR_GRAY2BGR)):
        codes = read_codes(v)
        if codes:
            for c in codes:
                c["points"] = [[x0 + px / f, y0 + py / f] for px, py in c["points"]]
                c["zoomed"] = True
            return codes, blur
    return [], blur


def tough_codes(img):
    small, s0 = fit(img, 1400)
    g = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    adapt = cv2.adaptiveThreshold(cv2.GaussianBlur(g, (3, 3), 0), 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 7)
    variants = [(255 - g, s0), (adapt, s0), (255 - adapt, s0), (cv2.morphologyEx(adapt, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)), s0)]
    if max(g.shape) < 800:
        variants.append((cv2.resize(g, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC), s0 * 3))
    out = []
    for v, s in variants:
        bgr = cv2.cvtColor(v, cv2.COLOR_GRAY2BGR)
        got = read_codes(bgr)
        if not got:
            try:
                ok, texts, pts, _ = cv2.QRCodeDetectorAruco().detectAndDecodeMulti(bgr)
                if ok:
                    got = [{"type": "QR Code", "data": t, "points": p.reshape(-1, 2).tolist()} for t, p in zip(texts, pts, strict=False) if t]
            except Exception:
                pass
        out += [(c, s) for c in got]
        if out:
            break
    return out


def op_barcodes(imgs):
    live = bool(PRM.get("live"))
    for i, (name, img) in enumerate(imgs, 1):
        seen, codes = set(), []
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        tries = [(img, 1.0), (cv2.cvtColor(cv2.createCLAHE(3.0, (8, 8)).apply(g), cv2.COLOR_GRAY2BGR), 1.0)]
        if not live:
            if max(img.shape[:2]) < 1600:
                tries.append((cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), 2.0))
            else:
                tries.append((fit(img, 1400)[0], fit(img, 1400)[1]))

        def add(c, s=1.0, seen=seen, codes=codes):
            if c["data"] in seen:
                return
            seen.add(c["data"])
            c["points"] = (np.array(c["points"]) / s).round(1).tolist()
            codes.append(c)
        for im, s in tries:
            for c in read_codes(im):
                add(c, s)
            if codes and live:
                break
        # tough QR / DataMatrix: printed light-on-dark, faded, shiny or uneven light — inverted, adaptive threshold, ×3 and the ArUco-based QR finder
        if not codes and (not live or PRM.get("tough")):
            for c, s in tough_codes(img):
                c["tough"] = True
                add(c, s)
        # nothing read: find where a barcode is, zoom in there and try again; else say why
        hint, regions = "", []
        if not codes:
            for b in barcode_regions(img):
                got, blur = read_region(img, b)
                for c in got:
                    add(c)
                if not got:
                    bars, px = bar_pitch(img, b)
                    if bars < 30:
                        continue                      # not barcode-like (text, a pattern) — no hint from it
                    unit = px / 1.7                   # edges are ~1.7 bar units apart on EAN / Code 128; decoders want ≥ 3 px per unit
                    why = "move closer — the thinnest bars are only ~%.1f px wide" % unit if unit < 3 else \
                        "hold still / focus — the picture is blurred" if blur < 60 else "turn it flat to the camera, avoid shine"
                    regions.append({"x": b[0], "y": b[1], "w": b[2], "h": b[3], "why": why, "bars": bars, "px_per_bar": round(px / 1.7, 1)})
            regions.sort(key=lambda r: r["px_per_bar"])
            if not codes:
                hint = regions[0]["why"] if regions else "no barcode found — hold it closer (about a third of the picture wide), flat and still"
        if not live:
            ann = img.copy()
            for n, c in enumerate(codes, 1):
                p = np.array(c["points"], np.int32)
                cv2.polylines(ann, [p], True, GREEN, max(2, img.shape[1] // 400))
                label(ann, "%d %s" % (n, c["data"][:40]), p.min(0))
            for r in regions:
                cv2.rectangle(ann, (r["x"], r["y"]), (r["x"] + r["w"], r["y"] + r["h"]), YELLOW, max(2, img.shape[1] // 400))
            save("codes_%d" % i, ann, "%d code(s) found" % len(codes) + (" — " + hint if hint else ""))
        RESULT["images"].append({"name": name, "count": len(codes), "hint": hint, "regions": regions,
                                 "codes": [{"n": n, "type": c["type"], "data": c["data"], "zoomed": bool(c.get("zoomed")), "points": c["points"]} for n, c in enumerate(codes, 1)]})
    RESULT["table"] = {"columns": ["image", "n", "type", "data"], "rows": [[im["name"], c["n"], c["type"], c["data"]] for im in RESULT["images"] for c in im["codes"]]}
    hints = [im["hint"] for im in RESULT["images"] if im.get("hint")]
    if hints and not RESULT["table"]["rows"]:
        RESULT["note"] = "Barcode seen but not readable: " + hints[0]


def op_count(imgs):
    method = str(PRM.get("method", "auto")).lower()
    for i, (name, img) in enumerate(imgs, 1):
        work, s = fit(img, 1400)
        g = cv2.GaussianBlur(cv2.cvtColor(work, cv2.COLOR_BGR2GRAY), (5, 5), 0)
        area = work.shape[0] * work.shape[1]
        objs = []
        if method == "circles":
            rmin = int(num("min_radius", max(6, min(work.shape[:2]) // 60), 2))
            rmax = int(num("max_radius", min(work.shape[:2]) // 4, rmin + 1))
            c = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, 1.2, rmin * 1.6, param1=120, param2=num("sensitivity", 35, 10, 100), minRadius=rmin, maxRadius=rmax)
            for x, y, r in (np.round(c[0]).astype(int) if c is not None else []):
                objs.append({"x": x / s, "y": y / s, "w": 2 * r / s, "h": 2 * r / s, "area": math.pi * r * r / s / s, "shape": ("circle", (x, y, r))})
        else:
            _, t = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            if PRM.get("invert") in (True, "true", 1) or (PRM.get("invert") is None and t.mean() > 127):
                t = 255 - t
            t = cv2.morphologyEx(t, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=2)
            if method in ("auto", "touching"):
                # split touching objects: one marker per local peak of the distance transform (peaks closer than a typical
                # object radius merge), then watershed
                dist = cv2.distanceTransform(t, cv2.DIST_L2, 5)
                nc, comp = cv2.connectedComponents(t)
                radii = [float(dist[comp == k].max()) for k in range(1, min(nc, 400))]
                r_med = float(np.median(radii)) if radii else 3.0
                k = max(3, int(r_med * num("split", 1.0, 0.3, 3.0))) | 1
                peaks = ((dist >= cv2.dilate(dist, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))) & (dist > 0.5 * r_med)).astype(np.uint8)
                peaks = cv2.dilate(peaks, np.ones((3, 3), np.uint8))
                n, markers = cv2.connectedComponents(peaks)
                markers = markers + 1
                markers[(t > 0) & (peaks == 0)] = 0
                markers = cv2.watershed(work.copy(), markers)
                masks = [(markers == k).astype(np.uint8) * 255 for k in range(2, n + 1)]
            else:
                masks = [t]
            min_area = num("min_area_pct", 0.05, 0.0, 50) / 100 * area
            for m in masks:
                for c in cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
                    a = cv2.contourArea(c)
                    if a < max(min_area, 20) or a > area * 0.9:
                        continue
                    x, y, w, h = cv2.boundingRect(c)
                    objs.append({"x": x / s, "y": y / s, "w": w / s, "h": h / s, "area": a / s / s, "shape": ("poly", c)})
        ann = work.copy()
        for n, o in enumerate(objs, 1):
            kind, v = o.pop("shape")
            if kind == "circle":
                cv2.circle(ann, (int(v[0]), int(v[1])), int(v[2]), GREEN, 2)
                org = (v[0] - 8, v[1] + 6)
            else:
                cv2.drawContours(ann, [v], -1, GREEN, 2)
                mm = cv2.moments(v)
                org = (mm["m10"] / max(mm["m00"], 1) - 8, mm["m01"] / max(mm["m00"], 1) + 6)
            label(ann, str(n), org, BLUE)
        label(ann, "%d objects" % len(objs), (10, 40), RED)
        save("count_%d" % i, ann, "%d object(s)" % len(objs))
        areas = [o["area"] for o in objs]
        RESULT["images"].append({"name": name, "count": len(objs), "method": method,
                                 "area_median": round(float(np.median(areas)), 1) if areas else 0,
                                 "objects": [{k: round(float(v), 1) for k, v in o.items()} for o in objs[:500]]})


def ssim(a, b):
    a, b = a.astype(np.float64), b.astype(np.float64)
    C1, C2 = 6.5025, 58.5225
    mu1, mu2 = cv2.GaussianBlur(a, (11, 11), 1.5), cv2.GaussianBlur(b, (11, 11), 1.5)
    s1 = cv2.GaussianBlur(a * a, (11, 11), 1.5) - mu1 ** 2
    s2 = cv2.GaussianBlur(b * b, (11, 11), 1.5) - mu2 ** 2
    s12 = cv2.GaussianBlur(a * b, (11, 11), 1.5) - mu1 * mu2
    m = ((2 * mu1 * mu2 + C1) * (2 * s12 + C2)) / ((mu1 ** 2 + mu2 ** 2 + C1) * (s1 + s2 + C2))
    return float(m.mean()), m


def align(base, mov):
    orb = cv2.ORB_create(3000)
    k1, d1 = orb.detectAndCompute(cv2.cvtColor(base, cv2.COLOR_BGR2GRAY), None)
    k2, d2 = orb.detectAndCompute(cv2.cvtColor(mov, cv2.COLOR_BGR2GRAY), None)
    if d1 is None or d2 is None:
        return mov, False
    m = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d2, d1), key=lambda x: x.distance)[:400]
    if len(m) < 12:
        return mov, False
    H, _ = cv2.findHomography(np.float32([k2[x.queryIdx].pt for x in m]), np.float32([k1[x.trainIdx].pt for x in m]), cv2.RANSAC, 5.0)
    if H is None:
        return mov, False
    return cv2.warpPerspective(mov, H, (base.shape[1], base.shape[0])), True


def op_compare(imgs):
    if len(imgs) < 2:
        raise ValueError("compare needs two images (before and after)")
    (n1, a), (n2, b) = imgs[0], imgs[1]
    a, _ = fit(a, 1600)
    b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_AREA)
    aligned = False
    if PRM.get("align", True) not in (False, "false", 0):
        b, aligned = align(a, b)
    ga, gb = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    score, smap = ssim(ga, gb)
    diff = cv2.GaussianBlur(cv2.absdiff(ga, gb), (5, 5), 0)
    _, t = cv2.threshold(diff, num("threshold", 35, 5, 200), 255, cv2.THRESH_BINARY)
    t = cv2.morphologyEx(t, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    regions = []
    ann = b.copy()
    for c in sorted(cv2.findContours(t, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea, reverse=True):
        if cv2.contourArea(c) < a.shape[0] * a.shape[1] * 0.0005:
            continue
        x, y, w, h = cv2.boundingRect(c)
        regions.append({"x": x, "y": y, "w": w, "h": h, "area_pct": round(cv2.contourArea(c) / (a.shape[0] * a.shape[1]) * 100, 2)})
        cv2.rectangle(ann, (x, y), (x + w, y + h), RED, 3)
        label(ann, str(len(regions)), (x, y), RED)
    heat = cv2.applyColorMap(cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX), cv2.COLORMAP_JET)
    save("changes", ann, "%d changed area(s) marked on the second image" % len(regions))
    save("heatmap", cv2.addWeighted(a, 0.5, heat, 0.5, 0), "where the pictures differ (red = most)")
    RESULT["images"] = [{"name": n1}, {"name": n2}]
    RESULT.update({"similarity": round(score * 100, 1), "changed_pct": round(float((t > 0).mean()) * 100, 2), "aligned": aligned, "regions": regions[:50],
                   "verdict": "same" if score > 0.97 and not regions else "minor changes" if score > 0.85 else "different"})


def deskew_angle(g):
    _, t = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    lines = cv2.HoughLinesP(t, 1, np.pi / 180, 120, minLineLength=g.shape[1] // 6, maxLineGap=20)
    if lines is None:
        return 0.0
    ang = [math.degrees(math.atan2(y2 - y1, x2 - x1)) for x1, y1, x2, y2 in np.array(lines).reshape(-1, 4)]
    ang = [x for x in ang if abs(x) < 30]
    return float(np.median(ang)) if ang else 0.0


def op_enhance(imgs):
    steps = PRM.get("steps") or ["auto"]
    if isinstance(steps, str):
        steps = [x.strip() for x in steps.split(",") if x.strip()]
    if "auto" in steps:
        steps = ["white_balance", "contrast", "denoise", "sharpen", "deskew"]
    for i, (name, img) in enumerate(imgs, 1):
        out, done = img.copy(), []
        for st in steps:
            if st == "white_balance":
                f = out.astype(np.float32)
                f *= f.mean() / np.maximum(f.reshape(-1, 3).mean(0), 1)
                out = np.clip(f, 0, 255).astype(np.uint8)
            elif st == "contrast":
                lab = cv2.cvtColor(out, cv2.COLOR_BGR2LAB)
                lab[:, :, 0] = cv2.createCLAHE(2.5, (8, 8)).apply(lab[:, :, 0])
                out = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
            elif st == "denoise":
                out = cv2.fastNlMeansDenoisingColored(fit(out, 2400)[0], None, 5, 5, 7, 21)
            elif st == "sharpen":
                out = cv2.addWeighted(out, 1.6, cv2.GaussianBlur(out, (0, 0), 2.0), -0.6, 0)
            elif st == "deskew":
                a = deskew_angle(cv2.cvtColor(fit(out, 1400)[0], cv2.COLOR_BGR2GRAY))
                if 0.3 < abs(a) < 30:
                    h, w = out.shape[:2]
                    out = cv2.warpAffine(out, cv2.getRotationMatrix2D((w / 2, h / 2), a, 1.0), (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
                    st = "deskew %.1f°" % a
                else:
                    continue
            elif st in ("gray", "grey"):
                out = cv2.cvtColor(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
            elif st.startswith("rotate"):
                k = {"rotate90": cv2.ROTATE_90_CLOCKWISE, "rotate180": cv2.ROTATE_180, "rotate270": cv2.ROTATE_90_COUNTERCLOCKWISE}.get(st)
                if k is None:
                    continue
                out = cv2.rotate(out, k)
            else:
                continue
            done.append(st)
        save("enhanced_%d" % i, out, ", ".join(done) or "nothing changed")
        RESULT["images"].append({"name": name, "steps": done})


def op_edges(imgs):
    for i, (name, img) in enumerate(imgs, 1):
        g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (5, 5), 0)
        v = float(np.median(g))
        e = cv2.Canny(g, int(max(0, 0.66 * v)), int(min(255, 1.33 * v)))
        save("edges_%d" % i, 255 - e, "edges")
        RESULT["images"].append({"name": name, "edge_pct": round(float((e > 0).mean()) * 100, 2)})


def op_find(imgs):
    if len(imgs) < 2:
        raise ValueError("find needs two images: the scene first, then the thing to look for (a logo, label, product)")
    (n1, scene), (n2, tpl) = imgs[0], imgs[1]
    scene, s = fit(scene, 1600)
    gs, gt0 = cv2.cvtColor(scene, cv2.COLOR_BGR2GRAY), cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    thr = num("threshold", 0.75, 0.3, 0.99)
    per_scale = []
    for scale in np.linspace(0.3, 1.5, 25):
        gt = cv2.resize(gt0, None, fx=scale * s, fy=scale * s, interpolation=cv2.INTER_AREA)
        if gt.shape[0] < 12 or gt.shape[1] < 12 or gt.shape[0] >= gs.shape[0] or gt.shape[1] >= gs.shape[1]:
            continue
        r = cv2.matchTemplate(gs, gt, cv2.TM_CCOEFF_NORMED)
        per_scale.append((float(r.max()), scale, gt.shape, r))
    hits = []
    if per_scale:
        # the size the thing really has in this photo = the best scale; nearby scales only (no nested duplicates)
        best = max(per_scale, key=lambda x: x[0])[1]
        for _, scale, shp, r in per_scale:
            if best / 1.2 <= scale <= best * 1.2:
                for y, x in zip(*np.where(r >= thr), strict=False):
                    hits.append([int(x), int(y), shp[1], shp[0], float(r[y, x])])
    boxes, scores = [h[:4] for h in hits], [h[4] for h in hits]
    keep = cv2.dnn.NMSBoxes(boxes, scores, thr, 0.2) if hits else []
    ann, found = scene.copy(), []
    for k in np.array(keep).flatten()[:200]:
        x, y, w, h = boxes[k]
        found.append({"x": round(x / s, 1), "y": round(y / s, 1), "w": round(w / s, 1), "h": round(h / s, 1), "score": round(scores[k], 3)})
        cv2.rectangle(ann, (x, y), (x + w, y + h), GREEN, 3)
        label(ann, "%d %.0f%%" % (len(found), scores[k] * 100), (x, y))
    save("found", ann, "%d match(es)" % len(found))
    RESULT["images"] = [{"name": n1}, {"name": n2}]
    RESULT.update({"count": len(found), "matches": found})


def op_resize(imgs):
    side = int(num("max_side", 1600, 64, 8000))
    for i, (name, img) in enumerate(imgs, 1):
        out = fit(img, side)[0]
        save("resized_%d" % i, out, "%dx%d" % (out.shape[1], out.shape[0]))
        RESULT["images"].append({"name": name, "width": int(out.shape[1]), "height": int(out.shape[0])})


def yolo_models_dir():
    d = P.get("models_dir") or os.environ.get("VISION_MODELS") or os.path.join(os.path.expanduser("~"), "GraysWMS-models")
    os.makedirs(d, exist_ok=True)
    return d


def yolo_model(name):
    os.environ.setdefault("YOLO_VERBOSE", "False")
    try:
        from ultralytics import YOLO, settings
    except ImportError as ex:
        raise ValueError("YOLO is not set up on this PC (AI Agent › Vision › Add YOLO + PyTorch)") from ex
    try:
        settings.update({"sync": False})       # no usage analytics to Ultralytics
    except Exception:
        pass
    name = str(name or "yolo11n").strip()
    if not name.endswith(".pt"):
        name += ".pt"
    if os.path.basename(name) != name:
        raise ValueError("model must be a file name in the models folder")
    path = os.path.join(yolo_models_dir(), name)
    if path not in _YOLO:                       # the official names (yolo11n.pt, yolo11n-seg.pt, yolo11n-pose.pt …) download once
        _YOLO[path] = YOLO(path)
    return name, _YOLO[path]


def yolo_classes(model, classes):
    want = [c.strip().lower() for c in (classes if isinstance(classes, list) else str(classes or "").split(",")) if str(c).strip()]
    ids = [k for k, v in model.names.items() if v.lower() in want] if want else None
    if want and not ids:
        raise ValueError("this model does not know " + ", ".join(want) + " — it knows: " + ", ".join(list(model.names.values())[:80]))
    return ids


def op_detect(imgs):
    # YOLO (Ultralytics, on PyTorch): detect / segment / pose with the official COCO models (80 classes: person, car, truck,
    # bottle, chair …) or your own trained model (a .pt file in the models folder, e.g. pallets, cartons, forklifts)
    name, model = yolo_model(PRM.get("model"))
    conf = num("conf", 0.25, 0.01, 0.99)
    ids = yolo_classes(model, PRM.get("classes"))
    counts, rows = {}, []
    for i, (iname, img) in enumerate(imgs, 1):
        r = model.predict(img, conf=conf, classes=ids, verbose=False, imgsz=int(num("imgsz", 640, 160, 1920)))[0]
        objs = []
        if r.boxes is not None:
            for b, c, k in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist(), strict=False):
                lbl = r.names[int(k)]
                counts[lbl] = counts.get(lbl, 0) + 1
                objs.append({"label": lbl, "conf": round(c, 3), "x": round(b[0], 1), "y": round(b[1], 1), "w": round(b[2] - b[0], 1), "h": round(b[3] - b[1], 1)})
                rows.append([iname, len(objs), lbl, round(c * 100, 1), round(b[0]), round(b[1]), round(b[2] - b[0]), round(b[3] - b[1])])
        if r.probs is not None:            # a classification model
            top = r.probs.top5
            objs = [{"label": r.names[int(t)], "conf": round(float(r.probs.data[int(t)]), 3)} for t in top]
            rows += [[iname, n + 1, o["label"], round(o["conf"] * 100, 1), "", "", "", ""] for n, o in enumerate(objs)]
        kp = None
        if r.keypoints is not None and len(r.keypoints):
            kp = [[[round(x, 1), round(y, 1)] for x, y in person] for person in r.keypoints.xy.tolist()]
        if not PRM.get("live"):                 # live frames: boxes only, the page draws them
            save("detect_%d" % i, r.plot(line_width=max(2, img.shape[1] // 500)), "%d object(s)" % len(objs))
        RESULT["images"].append({"name": iname, "count": len(objs), "objects": objs[:300], "keypoints": kp})
    RESULT.update({"model": name, "task": getattr(model, "task", ""), "counts": counts, "classes": len(model.names)})
    RESULT["table"] = {"columns": ["image", "n", "label", "conf %", "x", "y", "w", "h"], "rows": rows}


def iou(a, b):
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    return inter / float(a[2] * a[3] + b[2] * b[3] - inter or 1)


def op_similar(imgs):
    # "Count like this": the user marks ONE example (params.box = x, y, w, h in the picture's pixels); every thing that looks
    # like it is found two ways and merged — by colour + size + shape (keys, cartons, bottles of the same colour) and by
    # appearance (template match at the example's size and turned 90°, for printed labels and logos)
    name, img = imgs[0]
    b = PRM.get("box") or {}
    try:
        bx, by, bw, bh = [float(b[k]) for k in ("x", "y", "w", "h")]
    except (KeyError, TypeError, ValueError) as ex:
        raise ValueError("mark one example first (drag a box around it)") from ex
    H0, W0 = img.shape[:2]
    bx, by = max(0.0, bx), max(0.0, by)
    bw, bh = min(bw, W0 - bx), min(bh, H0 - by)
    if bw < 6 or bh < 6:
        raise ValueError("the example box is too small")
    work, s = fit(img, 1600)
    ex = [int(bx * s), int(by * s), max(4, int(bw * s)), max(4, int(bh * s))]
    tol = num("tolerance", 50, 5, 100)            # 0 = only near-identical … 100 = loose
    lab = cv2.cvtColor(cv2.GaussianBlur(work, (5, 5), 0), cv2.COLOR_BGR2LAB).astype(np.float32)
    x, y, w, h = ex
    core = lab[y + h // 4: y + h - h // 4, x + w // 4: x + w - w // 4].reshape(-1, 3)
    ref = np.median(core, axis=0)
    ex_area, ex_long, ex_short = w * h, max(w, h), min(w, h)
    found = []
    # 1) colour blobs of the example's size and shape
    dist = np.linalg.norm(lab - ref, axis=2)
    mask = (dist < 6 + tol * 0.5).astype(np.uint8) * 255
    k = max(3, int(min(w, h) * 0.25)) | 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    lo, hi = 1 - 0.4 * tol / 50, 1 + 0.6 * tol / 50
    contours = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]

    def shape_of(c):
        (_, _), (rw, rh), _ = cv2.minAreaRect(c)
        lng, sht = max(rw, rh), min(rw, rh)
        return lng, sht, lng / max(sht, 1), cv2.contourArea(c) / max(rw * rh, 1)   # long, short, aspect, fill (rect ≈ 1, circle ≈ 0.79)

    # the example's own shape: the colour blob at the centre of its box
    ex_shape = None
    for c in contours:
        if cv2.pointPolygonTest(c, (x + w / 2, y + h / 2), False) >= 0:
            ex_shape = shape_of(c)
            break
    ex_aspect = ex_shape[2] if ex_shape else ex_long / ex_short
    ex_fill = ex_shape[3] if ex_shape else None
    for c in contours:
        lng, sht, aspect, fill = shape_of(c)
        if not (lo <= lng / ex_long <= hi and lo <= sht / ex_short <= hi):
            continue
        if cv2.contourArea(c) < 0.35 * ex_area:
            continue
        if abs(aspect / ex_aspect - 1) > 0.25 * tol / 50 + 0.08:              # a round button is not a long key
            continue
        if ex_fill is not None and abs(fill - ex_fill) > 0.08 * tol / 50 + 0.04:
            continue
        rx, ry, rw2, rh2 = cv2.boundingRect(c)
        inner = dist[ry + rh2 // 4: ry + rh2 - rh2 // 4, rx + rw2 // 4: rx + rw2 - rw2 // 4]
        score = float(max(0.0, 1 - np.median(inner) / (6 + tol * 0.5))) if inner.size else 0.0
        found.append([rx, ry, rw2, rh2, round(0.5 + score / 2, 3), "colour"])
    # 2) appearance (grey template) at the example's size ±15 %, upright and turned 90°
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    tpl0 = gray[y:y + h, x:x + w]
    thr = 0.85 - 0.3 * tol / 100
    hits = []
    for tpl in (tpl0, cv2.rotate(tpl0, cv2.ROTATE_90_CLOCKWISE)):
        for sc in (0.85, 1.0, 1.15):
            t = cv2.resize(tpl, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA)
            if t.shape[0] >= gray.shape[0] or t.shape[1] >= gray.shape[1] or min(t.shape) < 4:
                continue
            r = cv2.matchTemplate(gray, t, cv2.TM_CCOEFF_NORMED)
            for yy, xx in zip(*np.where(r >= thr), strict=False):
                hits.append([int(xx), int(yy), t.shape[1], t.shape[0], float(r[yy, xx])])
    if hits:
        keep = cv2.dnn.NMSBoxes([h_[:4] for h_ in hits], [h_[4] for h_ in hits], thr, 0.3)
        cmax = (6 + tol * 0.5) * 1.3
        for i in np.array(keep).flatten()[:500]:
            hx, hy, hw, hh = hits[i][:4]
            inner = dist[hy + hh // 4: hy + hh - hh // 4, hx + hw // 4: hx + hw - hw // 4]
            if inner.size and float(np.median(inner)) > cmax:                   # same shape, other colour (a red key is not a blue key)
                continue
            found.append(hits[i][:4] + [round(hits[i][4], 3), "look"])
    found.append([x, y, w, h, 1.0, "example"])
    # merge: best score first, drop boxes overlapping a kept one
    found.sort(key=lambda f: (f[5] != "example", -f[4]))
    kept = []
    for f in found:
        if all(iou(f, g) < 0.3 and not (abs((f[0] + f[2] / 2) - (g[0] + g[2] / 2)) < g[2] / 2 and abs((f[1] + f[3] / 2) - (g[1] + g[3] / 2)) < g[3] / 2) for g in kept):
            kept.append(f)
    # reading order: rows (centres within half a box height of the row's first one), then left to right
    kept.sort(key=lambda f: f[1] + f[3] / 2)
    rows_, cur = [], []
    for f in kept:
        if cur and (f[1] + f[3] / 2) - (cur[0][1] + cur[0][3] / 2) > 0.6 * min(f[3], cur[0][3]):
            rows_.append(cur)
            cur = []
        cur.append(f)
    if cur:
        rows_.append(cur)
    kept = [f for r_ in rows_ for f in sorted(r_, key=lambda f: f[0])]
    ann = work.copy()
    cv2.rectangle(ann, (x, y), (x + w, y + h), YELLOW, 3)
    objs = []
    for n, f in enumerate(kept, 1):
        cv2.rectangle(ann, (f[0], f[1]), (f[0] + f[2], f[1] + f[3]), GREEN if f[5] != "example" else YELLOW, 2)
        label(ann, str(n), (f[0], f[1]), BLUE)
        objs.append({"n": n, "x": round(f[0] / s, 1), "y": round(f[1] / s, 1), "w": round(f[2] / s, 1), "h": round(f[3] / s, 1), "score": f[4], "by": f[5]})
    label(ann, "%d like the example" % len(objs), (10, 40), RED)
    save("similar", ann, "%d like the example (yellow)" % len(objs))
    RESULT["images"] = [{"name": name, "count": len(objs), "objects": objs, "width": W0, "height": H0}]
    RESULT.update({"count": len(objs), "example": {"x": bx, "y": by, "w": bw, "h": bh}, "tolerance": tol})


# ── measure: ArUco marker of known size on the same surface → real size in cm ──
ARUCO_DICT = "DICT_4X4_50"


def aruco_detector():
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, ARUCO_DICT))
    return cv2.aruco.ArucoDetector(d, cv2.aruco.DetectorParameters())


def op_markers(imgs):
    # a printable A4 sheet (300 dpi) of marker stickers, each exactly `marker_cm` wide, with a 10 cm check ruler
    cm = num("marker_cm", 5.0, 2.0, 15.0)
    dpi = 300
    pxcm = dpi / 2.54
    W, H = int(21.0 * pxcm), int(29.7 * pxcm)
    sheet = np.full((H, W), 255, np.uint8)
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, ARUCO_DICT))
    side = int(round(cm * pxcm))
    m = int(1.5 * pxcm)
    cols = max(1, int((W - m) // (side + m)))
    n = 0
    y = int(3.0 * pxcm)
    while y + side + m < H - int(3 * pxcm) and n < 12:
        for c in range(cols):
            x = m + c * (side + m)
            if x + side > W - m // 2:
                break
            sheet[y:y + side, x:x + side] = cv2.aruco.generateImageMarker(d, n, side)
            cv2.putText(sheet, "#%d  %.1f cm" % (n, cm), (x, y + side + int(0.5 * pxcm)), FONT, 1.6, 0, 3, cv2.LINE_AA)
            n += 1
        y += side + m
    cv2.putText(sheet, "Gray's WMS measuring markers - print at 100 %% (actual size). Each square = %.1f cm. Check: the bar below must be 10 cm." % cm,
                (int(pxcm), int(1.2 * pxcm)), FONT, 1.4, 0, 3, cv2.LINE_AA)
    x0, y0 = int(pxcm), H - int(2.2 * pxcm)
    cv2.rectangle(sheet, (x0, y0), (x0 + int(10 * pxcm), y0 + int(0.3 * pxcm)), 0, -1)
    for i in range(11):
        cv2.line(sheet, (x0 + int(i * pxcm), y0 - 25), (x0 + int(i * pxcm), y0), 0, 3)
    save("marker_sheet", cv2.cvtColor(sheet, cv2.COLOR_GRAY2BGR), "A4 at 300 dpi — print at 100 %%, markers %.1f cm" % cm)
    RESULT.update({"marker_cm": cm, "markers": n, "dpi": dpi})


def order_quad(p):
    return order_pts(np.array(p, np.float32))


def object_contour(img, marker_quads, box=None):
    # the thing to measure: inside the user's box if given, else the biggest object that is not a marker
    h, w = img.shape[:2]
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    e = cv2.dilate(cv2.Canny(g, 40, 120), np.ones((5, 5), np.uint8), iterations=2)
    e = cv2.morphologyEx(e, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    for q in marker_quads:                    # hide the markers (and a margin) so they are not taken for the object
        c = q.mean(0)
        big = (q - c) * 1.35 + c
        cv2.fillPoly(e, [big.astype(np.int32)], 0)
    if box:
        x, y, bw, bh = [int(box[k]) for k in ("x", "y", "w", "h")]
        roi = np.zeros_like(e)
        roi[max(0, y):y + bh, max(0, x):x + bw] = 255
        e = cv2.bitwise_and(e, roi)
    cs = [c for c in cv2.findContours(e, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0] if cv2.contourArea(c) > 0.003 * h * w]
    if not cs:
        return None
    # the edges were thickened by about 4 px to close gaps: fill the outline and shrink it back to the real border
    m = np.zeros_like(e)
    cv2.drawContours(m, [max(cs, key=cv2.contourArea)], -1, 255, -1)
    m = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    cs = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
    return max(cs, key=cv2.contourArea) if cs else None


def op_measure(imgs):
    cm = num("marker_cm", 5.0, 0.5, 100.0)
    det = aruco_detector()
    dims = []
    for i, (name, img) in enumerate(imgs, 1):
        corners, ids, _ = det.detectMarkers(img)
        if ids is None or not len(ids):
            raise ValueError(name + ": no measuring marker found — put a printed marker (Measure › Print marker sheet) flat next to the object, fully visible")
        quads = [order_quad(c.reshape(4, 2)) for c in corners]
        # the plane of the first marker in cm: a homography makes the photo top-down for everything on that surface
        q = quads[0]
        H = cv2.getPerspectiveTransform(q, np.array([[0, 0], [cm, 0], [cm, cm], [0, cm]], np.float32))
        px_per_cm = float(np.mean([np.linalg.norm(qq[0] - qq[1]) + np.linalg.norm(qq[1] - qq[2]) for qq in quads]) / 2 / cm)
        c = object_contour(img, quads, PRM.get("box") if i == 1 else None)
        if c is None:
            raise ValueError(name + ": the object could not be separated from the background — use a plain background or draw a box around it")
        pts_cm = cv2.perspectiveTransform(c.reshape(-1, 1, 2).astype(np.float32), H).reshape(-1, 2)
        (cx, cy), (a, b), ang = cv2.minAreaRect(pts_cm)
        length, width = max(a, b), min(a, b)
        area_cm2 = float(cv2.contourArea(pts_cm.astype(np.float32)))
        ann = img.copy()
        cv2.aruco.drawDetectedMarkers(ann, corners, ids)
        rect_px = cv2.boxPoints(cv2.minAreaRect(c))
        cv2.drawContours(ann, [rect_px.astype(np.int32)], -1, GREEN, max(2, img.shape[1] // 300))
        label(ann, "%.1f x %.1f cm" % (length, width), rect_px.min(0), GREEN)
        save("measure_%d" % i, ann, "%.1f × %.1f cm (marker %.1f cm)" % (length, width, cm))
        dims.append((length, width))
        RESULT["images"].append({"name": name, "length_cm": round(length, 1), "width_cm": round(width, 1), "area_cm2": round(area_cm2, 1),
                                 "markers": int(len(ids)), "px_per_cm": round(px_per_cm, 2), "angle": round(float(ang), 1)})
    if len(dims) >= 2:
        # photo 1 = top (length × width), photo 2 = side: its dimension least like the top ones is the height
        L, W = dims[0]
        hgt = max(dims[1], key=lambda v: min(abs(v - L), abs(v - W)))
        vol = L * W * hgt
        RESULT.update({"box_cm": [round(L, 1), round(W, 1), round(hgt, 1)], "volume_cm3": round(vol), "volume_m3": round(vol / 1e6, 4)})
    RESULT["note"] = "Accurate for objects lying on the marker's surface, photographed from above; a bigger marker and a straight-down photo give the best result."


# ── OCR: text on labels (PaddleOCR models via rapidocr + OpenCV) and the fields a warehouse needs ──
_OCR = {}
MONTHS = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC"


def ocr_engine():
    if "e" not in _OCR:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError as ex:
            raise ValueError("Text reading is not set up on this PC yet (Vision › Set up again — it adds the OCR models)") from ex
        _OCR["e"] = RapidOCR()
    return _OCR["e"]


def fix_digits(s):
    return s.translate(str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "S": "5", "B": "8"}))


def parse_fields(lines):
    import re
    text = "\n".join(lines)
    up = text.upper().replace("L0T", "LOT").replace("BATCH N0", "BATCH NO").replace("EXPlRY", "EXPIRY")
    out = {}
    date = (r"(\d{1,2}[./\- ]\d{1,2}[./\- ]\d{2,4}|\d{4}[./\-]\d{1,2}[./\-]\d{1,2}"
            r"|\d{1,2}[./\- ]?(?:%s)[A-Z]*[./\- ]?\d{2,4}|(?:%s)[A-Z]*[./\- ]?\d{2,4}|\d{1,2}[./\-]\d{4})") % (MONTHS, MONTHS)
    pats = {
        "lot": r"(?:LOT|BATCH|BATCH NO|LOT NO|B\.?NO)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/]{2,})",
        "expiry": r"(?:EXP(?:IRY)?(?:\s*DATE)?|USE BY|BB|BEST BEFORE(?: END)?|BBE)\s*[:.]?\s*" + date,
        "made": r"(?:MFG|MFD|MANUFACTURED|PROD(?:UCTION)?(?:\s*DATE)?|PKD|PACKED)(?:\s*ON)?\s*[:.]?\s*" + date,
        "serial": r"(?:S/?N|SERIAL(?:\s*NO)?)\s*[:#.]?\s*([A-Z0-9\-]{4,})",
        "weight": r"(?:NET\s*(?:WT|WEIGHT)|WT|WEIGHT)\s*[:.]?\s*(\d+(?:[.,]\d+)?\s*(?:KG|G|LB|L|ML))",
        "gtin": r"(?:\(01\)\s*|GTIN\s*[:.]?\s*)(\d{14})",
    }
    for k, p in pats.items():
        m = re.search(p, up)
        if not m:
            m = re.search(p, up.replace(" ", ""))
        if m:
            v = m.group(1).strip()
            out[k] = fix_digits(v) if k in ("expiry", "made", "gtin") else v
    return out


def iso_date(v):
    # 12/2026 → 2026-12-31 (end of month), 03JAN2026 / 30.11.26 / 2026-11-30 → ISO; None when unsure
    import calendar
    import re
    v = v.upper().replace(" ", "")
    mon = {m: i for i, m in enumerate(MONTHS.split("|"), 1)}
    d = m = y = None
    if re.fullmatch(r"\d{4}[./\-]\d{1,2}[./\-]\d{1,2}", v):
        y, m, d = [int(x) for x in re.split(r"[./\-]", v)]
    elif re.fullmatch(r"\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}", v):
        d, m, y = [int(x) for x in re.split(r"[./\-]", v)]
    elif re.fullmatch(r"\d{1,2}[./\-]\d{4}", v):
        m, y = [int(x) for x in re.split(r"[./\-]", v)]
    else:
        g = re.fullmatch(r"(\d{1,2})?[./\-]?(%s)[A-Z]*[./\-]?(\d{2,4})" % MONTHS, v)
        if not g:
            return None
        d, m, y = (int(g.group(1)) if g.group(1) else None), mon[g.group(2)], int(g.group(3))
    if y < 100:
        y += 2000
    if not (1 <= m <= 12 and 2000 <= y <= 2100):
        return None
    last = calendar.monthrange(y, m)[1]
    d = last if d is None else d
    return "%04d-%02d-%02d" % (y, m, d) if 1 <= d <= last else None


def op_ocr(imgs):
    eng = ocr_engine()
    all_rows = []
    for i, (name, img) in enumerate(imgs, 1):
        work, s = fit(img, 1800)
        res, _ = eng(work)
        lines = []
        ann = work.copy()
        for box, text, conf in (res or []):
            p = np.array(box, np.float32)
            cv2.polylines(ann, [p.astype(np.int32)], True, GREEN, 2)
            lines.append({"text": text, "conf": round(float(conf), 3), "box": (p / s).round(1).tolist()})
        lines.sort(key=lambda L: (round(min(q[1] for q in L["box"]) / 25), min(q[0] for q in L["box"])))
        fields = parse_fields([L["text"] for L in lines])
        for k in ("expiry", "made"):
            if fields.get(k) and iso_date(fields[k]):
                fields[k + "_date"] = iso_date(fields[k])
        if fields.get("expiry_date"):
            import datetime
            left = (datetime.date.fromisoformat(fields["expiry_date"]) - datetime.date.today()).days
            fields["days_left"] = left
            fields["expired"] = left < 0
        save("text_%d" % i, ann, "%d line(s) of text" % len(lines))
        RESULT["images"].append({"name": name, "lines": len(lines), "text": "\n".join(L["text"] for L in lines), "fields": fields, "items": lines[:300]})
        all_rows += [[name, n + 1, L["text"], L["conf"]] for n, L in enumerate(lines)]
    RESULT["table"] = {"columns": ["image", "n", "text", "conf"], "rows": all_rows}


# ── colour / shade check (CIEDE2000) ──
def de2000(l1, l2):
    L1, a1, b1 = l1
    L2, a2, b2 = l2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dL, dC = L2 - L1, C2p - C1p
    dh = 0 if C1p * C2p == 0 else (h2p - h1p if abs(h2p - h1p) <= 180 else h2p - h1p - 360 if h2p > h1p else h2p - h1p + 360)
    dH = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lb, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hb = (h1p + h2p) / 2 if abs(h1p - h2p) <= 180 else (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    if C1p * C2p == 0:
        hb = h1p + h2p
    T = 1 - 0.17 * math.cos(math.radians(hb - 30)) + 0.24 * math.cos(math.radians(2 * hb)) + 0.32 * math.cos(math.radians(3 * hb + 6)) - 0.2 * math.cos(math.radians(4 * hb - 63))
    Sl = 1 + 0.015 * (Lb - 50) ** 2 / math.sqrt(20 + (Lb - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * math.sin(math.radians(60 * math.exp(-(((hb - 275) / 25) ** 2))))
    return math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))


def region_lab(img, box):
    if box:
        x, y, w, h = [int(box[k]) for k in ("x", "y", "w", "h")]
        img = img[max(0, y):y + h, max(0, x):x + w]
    if img.size == 0:
        raise ValueError("the marked area is empty")
    lab = cv2.cvtColor(img.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab).reshape(-1, 3)
    med = np.median(lab, axis=0)
    bgr = np.median(img.reshape(-1, 3), axis=0)
    return [float(v) for v in med], hexc(bgr), float(np.std(lab[:, 0]))


def op_color(imgs):
    tol = num("tolerance", 5.0, 0.5, 50)
    name1, img1 = imgs[0]
    lab1, hex1, spread1 = region_lab(img1, PRM.get("box"))
    out = {"name": name1, "lab": [round(v, 1) for v in lab1], "hex": hex1, "spread": round(spread1, 1)}
    ref = None
    if len(imgs) > 1:
        lab2, hex2, _ = region_lab(imgs[1][1], PRM.get("box2"))
        ref = {"name": imgs[1][0], "lab": [round(v, 1) for v in lab2], "hex": hex2}
    elif PRM.get("reference"):
        h = str(PRM["reference"]).lstrip("#")
        if len(h) != 6:
            raise ValueError("reference colour must be #RRGGBB")
        px = np.uint8([[[int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)]]])
        ref = {"name": "#" + h.lower(), "lab": [round(float(v), 1) for v in cv2.cvtColor(px.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)[0, 0]], "hex": "#" + h.lower()}
    RESULT["images"] = [out]
    if ref:
        d = de2000(lab1, ref["lab"])
        dl = lab1[0] - ref["lab"][0]
        RESULT.update({"reference": ref, "delta_e": round(d, 2), "tolerance": tol, "verdict": "match" if d <= tol else "different",
                       "lighter_darker": "lighter" if dl > 1 else "darker" if dl < -1 else "same lightness",
                       "meaning": "not visible" if d < 1 else "only an expert sees it" if d < 2 else "visible side by side" if d < 5 else "clearly different"})
    sw = np.zeros((120, 480 if ref else 240, 3), np.uint8)
    sw[:, :240] = [int(hex1[5:7], 16), int(hex1[3:5], 16), int(hex1[1:3], 16)]
    if ref:
        sw[:, 240:] = [int(ref["hex"][5:7], 16), int(ref["hex"][3:5], 16), int(ref["hex"][1:3], 16)]
    save("colours", sw, "sample" + (" | reference" if ref else ""))


# ── panorama of a long shelf / rack + possible empty spaces ──
def join_sideways(parts):
    # fallback for a camera moved along a shelf: each photo continues the previous one to the right (small up/down drift allowed)
    h = min(p.shape[0] for p in parts)
    parts = [cv2.resize(p, (int(p.shape[1] * h / p.shape[0]), h)) for p in parts]
    x_at, y_at = 0, 0
    offs = [(0, 0)]
    for a, b in zip(parts, parts[1:], strict=False):
        sw = max(40, a.shape[1] // 5)
        strip = a[h // 10:h - h // 10, a.shape[1] - sw:]
        res = cv2.matchTemplate(b[:, : int(b.shape[1] * 0.8)], strip, cv2.TM_CCOEFF_NORMED)
        _, best, _, (bx, by) = cv2.minMaxLoc(res)
        if best < 0.6:
            return None
        x_at += a.shape[1] - sw - bx
        y_at += h // 10 - by
        offs.append((x_at, y_at))
    ys = [o[1] for o in offs]
    top, bot = min(ys), max(ys)
    W = offs[-1][0] + parts[-1].shape[1]
    out = np.zeros((h + bot - top, W, 3), np.uint8)
    for (ox, oy), p in zip(offs, parts, strict=False):
        out[oy - top:oy - top + h, ox:ox + p.shape[1]] = p
    return out


def op_stitch(imgs):
    if len(imgs) < 2:
        raise ValueError("panorama needs 2 to 6 overlapping photos, left to right")
    parts = [fit(im, 1400)[0] for _, im in imgs]
    mode = cv2.Stitcher_SCANS if str(PRM.get("mode", "scans")) == "scans" else cv2.Stitcher_PANORAMA
    st = cv2.Stitcher_create(mode)
    status, pano = st.stitch(parts)
    if status != cv2.Stitcher_OK:
        if mode == cv2.Stitcher_SCANS:
            status, pano = cv2.Stitcher_create(cv2.Stitcher_PANORAMA).stitch(parts)
        if status != cv2.Stitcher_OK:
            pano = join_sideways(parts)
            if pano is None:
                raise ValueError("the photos could not be joined (status %d) — overlap each photo by about a third and keep the same height" % status)
            RESULT["method"] = "sideways"
    # crop the black border
    g = cv2.cvtColor(pano, cv2.COLOR_BGR2GRAY)
    ys, xs = np.where(g > 0)
    if len(xs):
        pano = pano[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    gaps = []
    if PRM.get("gaps", True) not in (False, "false", 0):
        g = cv2.cvtColor(pano, cv2.COLOR_BGR2GRAY)
        e = cv2.Canny(cv2.GaussianBlur(g, (5, 5), 0), 40, 120).astype(np.float32) / 255
        k = max(15, pano.shape[0] // 12) | 1
        dens = cv2.blur(e, (k, k))
        # an empty space = plain (few edges) AND the colour of the shelf back (the most common plain colour)
        plain = dens < num("gap_edges", 0.025, 0.001, 0.2)
        q = (pano[plain] // 32).astype(np.int32) if plain.any() else np.zeros((0, 3), np.int32)
        if len(q):
            keys = q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]
            k0 = np.bincount(keys).argmax()
            back = np.array([k0 // 64, (k0 // 8) % 8, k0 % 8]) * 32 + 16
            lab = cv2.cvtColor(pano, cv2.COLOR_BGR2Lab).astype(np.float32)
            blab = cv2.cvtColor(np.uint8([[back]]), cv2.COLOR_BGR2Lab).astype(np.float32)[0, 0]
            near = np.linalg.norm(lab - blab, axis=2) < num("gap_colour", 28, 5, 80)
            plain &= near
            RESULT["shelf_back"] = hexc(back)
        low = plain.astype(np.uint8) * 255
        # keep only areas at least a product wide and a tenth of the height tall: slits between products and shelf edges go
        kw, kh = max(9, int(pano.shape[1] * 0.035)), max(9, int(pano.shape[0] * 0.1))
        low = cv2.morphologyEx(low, cv2.MORPH_OPEN, np.ones((kh, kw), np.uint8))
        area = pano.shape[0] * pano.shape[1]
        ann = pano.copy()
        for c in cv2.findContours(low, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
            x, y, w, h = cv2.boundingRect(c)
            if cv2.contourArea(c) > 0.008 * area and h > 0.12 * pano.shape[0] and w > 0.04 * pano.shape[1]:
                gaps.append({"x": x, "y": y, "w": w, "h": h})
                cv2.rectangle(ann, (x, y), (x + w, y + h), RED, 3)
                label(ann, "gap %d" % len(gaps), (x, y), RED)
        save("panorama_gaps", ann, "%d possible empty space(s)" % len(gaps))
    save("panorama", pano, "%d photos joined, %dx%d" % (len(parts), pano.shape[1], pano.shape[0]))
    RESULT.update({"joined": len(parts), "width": int(pano.shape[1]), "height": int(pano.shape[0]), "gaps": gaps})


# ── labels: QR / barcodes to print ──
FORMATS = {"qr": "QRCode", "code128": "Code128", "ean13": "EAN13", "ean8": "EAN8", "upca": "UPCA", "code39": "Code39", "datamatrix": "DataMatrix", "pdf417": "PDF417", "itf": "ITF"}


def op_generate(imgs):
    import zxingcpp
    items = PRM.get("items") or []
    if isinstance(items, str):
        items = [x.strip() for x in items.splitlines() if x.strip()]
    items = [str(x)[:300] for x in items][:60]
    if not items:
        raise ValueError("give the text for each label (one per line)")
    fmt = str(PRM.get("format", "qr")).lower()
    if fmt not in FORMATS:
        raise ValueError("format must be one of " + ", ".join(FORMATS))
    caption = PRM.get("caption", True) not in (False, "false", 0)
    tiles = []
    for t in items:
        try:
            b = zxingcpp.create_barcode(t, getattr(zxingcpp.BarcodeFormat, FORMATS[fmt]))
        except Exception as ex:  # noqa: BLE001 - shown per label
            raise ValueError("%s cannot hold %r: %s" % (FORMATS[fmt], t, ex)) from ex
        im = np.array(b.to_image(scale=6 if fmt in ("qr", "datamatrix") else 3, add_hrt=False))
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR) if im.ndim == 2 else im
        if caption:
            pad = np.full((70, im.shape[1], 3), 255, np.uint8)
            cv2.putText(pad, t[:40], (10, 48), FONT, 1.0, (0, 0, 0), 2, cv2.LINE_AA)
            im = np.vstack([im, pad])
        tiles.append(im)
    for n, im in enumerate(tiles[:6], 1):
        save("label_%d" % n, im, items[n - 1][:60])
    # A4 sheet at 200 dpi with a grid of labels
    W, H, m = 1654, 2339, 40
    sheet = np.full((H, W, 3), 255, np.uint8)
    cw = max(t.shape[1] for t in tiles)
    ch = max(t.shape[0] for t in tiles)
    cols = max(1, (W - m) // (cw + m))
    sc = min(1.0, (W - m * (cols + 1)) / (cols * cw))
    x, y = m, m
    placed = 0
    for t in tiles:
        tt = cv2.resize(t, None, fx=sc, fy=sc, interpolation=cv2.INTER_NEAREST) if sc < 1 else t
        if x + tt.shape[1] > W - m:
            x, y = m, y + int(ch * sc) + m
        if y + tt.shape[0] > H - m:
            break
        sheet[y:y + tt.shape[0], x:x + tt.shape[1]] = tt
        x += tt.shape[1] + m
        placed += 1
    save("label_sheet", sheet, "A4 sheet with %d label(s)" % placed)
    RESULT.update({"format": FORMATS[fmt], "labels": len(items), "on_sheet": placed})


# ── depth from a stereo pair (two cameras side by side) ──
def op_depth(imgs):
    if len(imgs) < 2:
        raise ValueError("depth needs a left and a right photo taken side by side (same height, a few cm apart)")
    L = cv2.cvtColor(fit(imgs[0][1], 1000)[0], cv2.COLOR_BGR2GRAY)
    R = cv2.cvtColor(cv2.resize(imgs[1][1], (L.shape[1], L.shape[0])), cv2.COLOR_BGR2GRAY)
    nd = int(num("disparities", 96, 16, 256)) // 16 * 16
    sg = cv2.StereoSGBM_create(minDisparity=0, numDisparities=nd, blockSize=7, P1=8 * 49, P2=32 * 49, uniquenessRatio=10, speckleWindowSize=100, speckleRange=2)
    disp = sg.compute(L, R).astype(np.float32) / 16
    valid = disp > 0
    vis = cv2.applyColorMap(cv2.normalize(np.where(valid, disp, 0), None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8), cv2.COLORMAP_TURBO)
    save("depth", vis, "near = red, far = blue (relative)")
    f, base = PRM.get("focal_px"), PRM.get("baseline_cm")
    res = {"valid_pct": round(float(valid.mean()) * 100, 1), "near_pct": round(float((disp > np.percentile(disp[valid], 80)).mean()) * 100, 1) if valid.any() else 0}
    if f and base and valid.any():
        z = float(f) * float(base) / np.median(disp[valid])
        res["median_distance_cm"] = round(z, 1)
    RESULT.update(res)
    RESULT["note"] = "Relative depth. Real distances need a calibrated stereo pair (focal_px, baseline_cm) or a depth camera."


# ── fill level of a bottle / tank / container ──
def op_level(imgs):
    for i, (name, img) in enumerate(imgs, 1):
        b = PRM.get("box")
        x, y, w, h = ([int(b[k]) for k in ("x", "y", "w", "h")] if b else (0, 0, img.shape[1], img.shape[0]))
        roi = img[y:y + h, x:x + w]
        if roi.size == 0 or h < 20:
            raise ValueError("mark the container (drag a box around it)")
        g = cv2.GaussianBlur(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.float32)
        mid = g[:, int(w * 0.25):max(int(w * 0.25) + 1, int(w * 0.75))]   # centre strip: away from the walls
        prof = mid.mean(axis=1)
        grad = np.abs(np.convolve(np.diff(prof), np.ones(5) / 5, mode="same"))
        lo, hi = int(h * 0.06), int(h * 0.94)
        row = lo + int(np.argmax(grad[lo:hi]))
        strength = float(grad[row] / (grad[lo:hi].mean() + 1e-6))
        fill = (h - row) / h * 100
        ann = img.copy()
        cv2.rectangle(ann, (x, y), (x + w, y + h), YELLOW, 2)
        cv2.line(ann, (x, y + row), (x + w, y + row), RED, max(2, img.shape[1] // 300))
        label(ann, "%.0f%% full" % fill, (x, y + row), RED)
        save("level_%d" % i, ann, "level at %.0f %% of the marked height" % fill)
        RESULT["images"].append({"name": name, "fill_pct": round(fill, 1), "line_y": y + row, "confidence": "clear" if strength > 4 else "weak" if strength > 2 else "unclear"})


OPS = {"info": op_info, "document": op_document, "barcodes": op_barcodes, "count": op_count, "compare": op_compare,
       "enhance": op_enhance, "edges": op_edges, "find": op_find, "resize": op_resize, "detect": op_detect, "similar": op_similar,
       "measure": op_measure, "markers": op_markers, "ocr": op_ocr, "color": op_color, "stitch": op_stitch, "generate": op_generate,
       "depth": op_depth, "level": op_level}
NO_IMAGE_OPS = {"markers", "generate"}


def run_job(job_dir):
    global P, OP, PRM, RESULT
    os.chdir(job_dir)
    P = json.load(open("params.json", encoding="utf-8"))
    OP = P.get("op", "info")
    PRM = P.get("params") or {}
    RESULT = {"op": OP, "opencv": cv2.__version__, "images": [], "outputs": []}
    os.makedirs("out", exist_ok=True)
    try:
        files = sorted(glob.glob(os.path.join("in", "*")))[:6]
        if not files and OP not in NO_IMAGE_OPS:
            raise ValueError("No image given")
        imgs = [(P.get("names", {}).get(os.path.basename(f), os.path.basename(f)), load(f)) for f in files]
        if OP not in OPS:
            raise ValueError("Unknown operation " + OP + " — use one of " + ", ".join(OPS))
        OPS[OP](imgs)
        RESULT["ok"] = True
    except Exception as ex:  # noqa: BLE001 - reported to the page as the result
        RESULT.update({"ok": False, "error": str(ex), "trace": traceback.format_exc()[-1500:]})
    with open("result.json", "w", encoding="utf-8") as f:
        json.dump(RESULT, f, default=lambda o: o.item() if hasattr(o, "item") else str(o))


# ── watches: a camera, an RTSP / CCTV stream or a video file, watched frame by frame in its own process ──
# vision.py --watch <folder>: reads <folder>/watch.json, writes status.json, events.jsonl, last.jpg and snaps/*.jpg
# there; stops when <folder>/stop appears (or at the end of a video file). vision.py --grab <folder> writes one
# frame (frame.jpg + frame.json) for drawing zones and lines.
def open_source(src):
    kind = str(src.get("kind", "camera"))
    if kind == "camera":
        idx = int(src.get("index", 0))
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW) if os.name == "nt" else cv2.VideoCapture(idx)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, int(src.get("width", 1280)))
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, int(src.get("height", 720)))
    elif kind == "rtsp":
        url = str(src.get("url") or os.environ.get("VISION_SOURCE_URL", ""))     # the host passes a saved address in the environment, never in a file
        if not url.lower().startswith(("rtsp://", "rtsps://", "http://", "https://")):
            raise ValueError("a camera stream address starts with rtsp:// or http(s)://")
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    elif kind == "file":
        cap = cv2.VideoCapture(str(src.get("path", "")))
    else:
        raise ValueError("source kind must be camera, rtsp or file")
    if not cap.isOpened():
        raise ValueError({"camera": "the camera could not be opened (in use by another program?)", "rtsp": "the stream could not be opened — check the address, user and password",
                          "file": "the video file could not be opened"}[kind])
    return cap


def safe_source(src):
    # what may be shown or logged: never the password inside an rtsp://user:pass@host address
    import re
    if src.get("kind") == "rtsp":
        return "stream " + re.sub(r"//[^@/]*@", "//***@", str(src.get("url") or os.environ.get("VISION_SOURCE_URL", "")))
    if src.get("kind") == "file":
        return "file " + os.path.basename(str(src.get("path", "")))
    return "camera %s" % src.get("index", 0)


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    os.replace(tmp, path)


def write_jpg(path, img, q=80):
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    if ok:
        tmp = path + ".tmp"
        buf.tofile(tmp)
        os.replace(tmp, path)


def in_schedule(sch, now):
    # sch = {"days": [0..6] (Mon = 0), "from": "18:00", "to": "07:00"} — empty = always; a window may pass midnight
    if not sch or not (sch.get("from") and sch.get("to")):
        return not sch or not sch.get("days") or now.weekday() in sch["days"]
    f = [int(x) for x in str(sch["from"]).split(":")[:2]]
    t = [int(x) for x in str(sch["to"]).split(":")[:2]]
    m, a, b = now.hour * 60 + now.minute, f[0] * 60 + f[1], t[0] * 60 + t[1]
    days = sch.get("days") or list(range(7))
    if a <= b:
        return a <= m < b and now.weekday() in days
    # over midnight: the evening part belongs to today, the morning part to the day before
    return (m >= a and now.weekday() in days) or (m < b and (now.weekday() - 1) % 7 in days)


def zone_masks(zones, w, h):
    out = []
    for n, z in enumerate(zones or [], 1):
        pts = z.get("points") if isinstance(z, dict) else z
        if not pts or len(pts) < 3:
            continue
        m = np.zeros((h, w), np.uint8)
        cv2.fillPoly(m, [np.array([[p[0] * w, p[1] * h] for p in pts], np.int32)], 255)
        out.append({"name": (z.get("name") if isinstance(z, dict) else None) or "Zone %d" % n, "mask": m, "area": max(1, int(cv2.countNonZero(m))),
                    "pts": np.array([[p[0] * w, p[1] * h] for p in pts], np.int32)})
    if not out:
        out.append({"name": "Whole picture", "mask": np.full((h, w), 255, np.uint8), "area": w * h, "pts": None})
    return out


class Tracker:
    # centroid tracker for line counting: nearest match within max_dist, a track lives max_gap frames without a match
    def __init__(self, max_dist, max_gap=12):
        self.tracks, self.next_id, self.max_dist, self.max_gap = {}, 1, max_dist, max_gap

    def update(self, points, labels=None):
        labels = labels or [""] * len(points)
        free = set(range(len(points)))
        pairs = sorted(((math.dist(t["p"], points[j]), tid, j) for tid, t in self.tracks.items() for j in range(len(points))), key=lambda x: x[0])
        used = set()
        for d, tid, j in pairs:
            if d > self.max_dist or tid in used or j not in free:
                continue
            t = self.tracks[tid]
            t["prev"], t["p"], t["gap"], t["age"] = t["p"], points[j], 0, t["age"] + 1
            used.add(tid)
            free.discard(j)
        for tid in list(self.tracks):
            if tid not in used:
                self.tracks[tid]["gap"] += 1
                self.tracks[tid]["prev"] = self.tracks[tid]["p"]
                if self.tracks[tid]["gap"] > self.max_gap:
                    del self.tracks[tid]
        for j in free:
            self.tracks[self.next_id] = {"p": points[j], "prev": points[j], "gap": 0, "age": 1, "label": labels[j], "crossed": 0}
            self.next_id += 1
        return self.tracks


def side_of(a, b, p):
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def crosses(a, b, p, q):
    # does the move p → q cross the segment a–b? +1 = from the left side to the right side (as drawn from a to b), -1 = back
    s1, s2 = side_of(a, b, p), side_of(a, b, q)
    if s1 == 0 or s1 * s2 > 0:
        return 0
    s3, s4 = side_of(p, q, a), side_of(p, q, b)
    if s3 * s4 > 0:
        return 0
    return 1 if s1 < 0 < s2 else -1 if s2 < 0 < s1 else 0


def run_watch(folder):
    import datetime
    import time
    global P, PRM, RESULT
    os.chdir(folder)
    cfg = json.load(open("watch.json", encoding="utf-8"))
    P, PRM, RESULT = {"models_dir": cfg.get("models_dir")}, cfg.get("params") or {}, {"images": [], "outputs": []}
    os.makedirs("snaps", exist_ok=True)
    src, mode = cfg.get("source") or {}, str(cfg.get("mode", "motion"))
    is_file = src.get("kind") == "file"
    st = {"state": "starting", "mode": mode, "source": safe_source(src), "pid": os.getpid(), "started": datetime.datetime.now().isoformat(timespec="seconds"),
          "frames": 0, "events": 0, "fps": 0.0, "counts": {}, "error": None}
    ev_n = [0]
    snaps_kept = []

    def event(kind, frame=None, **kw):
        ev_n[0] += 1
        now = datetime.datetime.now()
        e = {"n": ev_n[0], "type": kind, "at": now.isoformat(timespec="seconds")}
        if is_file:
            e["video_s"] = round(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000, 2)
        e.update(kw)
        if frame is not None and cfg.get("snapshots", True):
            fn = "ev_%06d.jpg" % ev_n[0]
            write_jpg(os.path.join("snaps", fn), fit(frame, 960)[0], 78)
            e["snap"] = fn
            snaps_kept.append(fn)
            if len(snaps_kept) > int(cfg.get("max_snaps", 400)):
                try:
                    os.remove(os.path.join("snaps", snaps_kept.pop(0)))
                except OSError:
                    pass
        with open("events.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(e) + "\n")
        st["events"], st["last_event"] = ev_n[0], e

    try:
        cap = open_source(src)
    except Exception as ex:  # noqa: BLE001 - reported in status.json
        st.update({"state": "error", "error": str(ex)})
        write_json("status.json", st)
        return
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) if is_file else 0
    vfps = float(cap.get(cv2.CAP_PROP_FPS) or 0) or 25.0
    step = max(1, int(cfg.get("step", 1)))
    every = max(1, int(cfg.get("every", 5 if mode in ("scan", "detect") else 1)))
    sens = max(1, min(100, int(cfg.get("sensitivity", 50))))
    cooldown = float(cfg.get("cooldown_s", 10))
    sch = cfg.get("schedule") or {}
    realtime = bool(cfg.get("realtime", False)) and is_file
    end_at = time.time() + float(cfg["max_minutes"]) * 60 if cfg.get("max_minutes") else None
    bg = cv2.createBackgroundSubtractorMOG2(history=int(cfg.get("history", 300)), varThreshold=8 + (100 - sens) * 0.6, detectShadows=True)
    model, ids = None, None
    if mode == "detect" or (mode == "line" and cfg.get("detector") == "yolo"):
        try:
            _, model = yolo_model(cfg.get("model"))
            ids = yolo_classes(model, cfg.get("classes"))
        except Exception as ex:  # noqa: BLE001
            st.update({"state": "error", "error": str(ex)})
            write_json("status.json", st)
            return
    zones, tracker, line = None, None, None
    zstate = {}
    counts = {"in": 0, "out": 0} if mode == "line" else {}
    seen_codes = {}
    prev_counts = {}
    stable = [None, 0]
    fail, n, t0, last_out, last_fps_t, fps_frames = 0, 0, time.time(), 0.0, time.time(), 0
    st["state"] = "running"
    write_json("status.json", st)
    while True:
        if os.path.exists("stop") or (end_at and time.time() > end_at):
            st["state"] = "stopped"
            break
        ok, frame = cap.read()
        if not ok or frame is None:
            if is_file:
                st["state"] = "finished"
                break
            fail += 1
            st["state"] = "reconnecting"
            write_json("status.json", st)
            time.sleep(min(30, 2 ** min(fail, 5)))
            if os.path.exists("stop"):
                st["state"] = "stopped"
                break
            cap.release()
            try:
                cap = open_source(src)
                st["state"] = "running"
            except Exception as ex:  # noqa: BLE001
                st["error"] = str(ex)
            continue
        fail = 0
        n += 1
        if step > 1 and n % step:
            continue
        frame, s = fit(frame, int(cfg.get("max_side", 1280)))
        h, w = frame.shape[:2]
        if zones is None:
            zones = zone_masks(cfg.get("zones"), w, h)
            ln = cfg.get("line")
            if mode == "line":
                if not ln or len(ln) != 2:
                    st.update({"state": "error", "error": "draw the counting line first"})
                    break
                line = ((ln[0][0] * w, ln[0][1] * h), (ln[1][0] * w, ln[1][1] * h))
                tracker = Tracker(max_dist=float(cfg.get("max_move", 0.12)) * max(w, h), max_gap=int(cfg.get("max_gap", 12)))
        now = datetime.datetime.now()
        tf = n / vfps if is_file else time.time()               # the clock events are timed on: video time for a file
        alert = in_schedule(sch, now)
        ann = frame.copy()
        fg = None
        if mode in ("motion", "line"):
            fg = bg.apply(frame, learningRate=-1)
            fg = cv2.threshold(fg, 200, 255, cv2.THRESH_BINARY)[1]     # 127 = shadow, ignored
            fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            fg = cv2.dilate(fg, np.ones((7, 7), np.uint8), iterations=2)
        warm = n / step > int(cfg.get("warmup", 30))          # the background model needs a few frames first
        if mode == "motion" and warm:
            min_pct = float(cfg.get("min_area_pct", 0.4 + (100 - sens) * 0.04))
            for z in zones:
                moving = cv2.countNonZero(cv2.bitwise_and(fg, z["mask"])) * 100.0 / z["area"]
                zs = zstate.setdefault(z["name"], {"on": False, "quiet": 0.0, "since": None, "peak": 0.0})
                if moving >= min_pct:
                    zs["quiet"] = tf
                    zs["peak"] = max(zs["peak"], moving)
                    if not zs["on"]:
                        zs["on"], zs["since"] = True, now.isoformat(timespec="seconds")
                        cs = [c for c in cv2.findContours(cv2.bitwise_and(fg, z["mask"]), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0] if cv2.contourArea(c) > 0.001 * w * h]
                        snap = frame.copy()
                        for c in cs:
                            x, y, bw, bh = cv2.boundingRect(c)
                            cv2.rectangle(snap, (x, y), (x + bw, y + bh), RED, 2)
                        if z["pts"] is not None:
                            cv2.polylines(snap, [z["pts"]], True, YELLOW, 2)
                        event("motion", snap, zone=z["name"], moving_pct=round(moving, 1), alert=alert, schedule="in" if alert else "outside")
                        counts[z["name"]] = counts.get(z["name"], 0) + 1
                elif zs["on"] and tf - zs["quiet"] > cooldown:
                    zs["on"] = False
                    event("motion_end", None, zone=z["name"], since=zs["since"], peak_pct=round(zs["peak"], 1))
                    zs["peak"] = 0.0
                col = RED if zs["on"] else GREEN
                if z["pts"] is not None:
                    cv2.polylines(ann, [z["pts"]], True, col, 2)
            ov = np.zeros_like(ann)
            ov[fg > 0] = RED
            ann = cv2.addWeighted(ann, 1.0, ov, 0.35, 0)
        elif mode == "line":
            pts, labels = [], []
            if model is not None:
                r = model.predict(frame, conf=float(cfg.get("conf", 0.35)), classes=ids, verbose=False, imgsz=int(cfg.get("imgsz", 640)))[0]
                for b, k in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), strict=False):
                    pts.append(((b[0] + b[2]) / 2, (b[1] + b[3]) / 2))
                    labels.append(r.names[int(k)])
                    cv2.rectangle(ann, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), BLUE, 2)
            elif warm:
                min_area = float(cfg.get("min_area_pct", 0.15 + (100 - sens) * 0.01)) / 100 * w * h
                for c in cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
                    if cv2.contourArea(c) >= min_area:
                        x, y, bw, bh = cv2.boundingRect(c)
                        pts.append((x + bw / 2, y + bh / 2))
                        labels.append("object")
                        cv2.rectangle(ann, (x, y), (x + bw, y + bh), BLUE, 2)
            for tid, t in tracker.update(pts, labels).items():
                if t["gap"] or t["prev"] == t["p"]:
                    continue
                d = crosses(line[0], line[1], t["prev"], t["p"])
                if d and t["crossed"] != d:
                    t["crossed"] = d
                    k = "in" if d > 0 else "out"
                    counts[k] += 1
                    if t["label"] and t["label"] != "object":
                        counts[t["label"] + " " + k] = counts.get(t["label"] + " " + k, 0) + 1
                    snap = frame.copy()
                    cv2.line(snap, tuple(int(v) for v in line[0]), tuple(int(v) for v in line[1]), YELLOW, 3)
                    cv2.circle(snap, (int(t["p"][0]), int(t["p"][1])), 10, RED, -1)
                    event("cross", snap, direction=k, track=tid, label=t["label"], total_in=counts["in"], total_out=counts["out"], alert=alert)
                cv2.circle(ann, (int(t["p"][0]), int(t["p"][1])), 5, GREEN if not t["crossed"] else RED, -1)
            cv2.line(ann, tuple(int(v) for v in line[0]), tuple(int(v) for v in line[1]), YELLOW, 3)
            label(ann, "IN %d   OUT %d" % (counts["in"], counts["out"]), (10, 40), BLUE)
        elif mode == "scan" and n % every == 0:
            for c in read_codes(frame):
                key = c["data"]
                p = np.array(c["points"], np.int32)
                cv2.polylines(ann, [p], True, GREEN, 3)
                if tf - seen_codes.get(key, -1e9) > float(cfg.get("repeat_s", 5)):
                    snap = frame.copy()
                    cv2.polylines(snap, [p], True, GREEN, 3)
                    counts[c["type"]] = counts.get(c["type"], 0) + 1
                    event("code", snap, code_type=c["type"], data=key, alert=alert)
                seen_codes[key] = tf
        elif mode == "detect" and n % every == 0:
            r = model.predict(frame, conf=float(cfg.get("conf", 0.35)), classes=ids, verbose=False, imgsz=int(cfg.get("imgsz", 640)))[0]
            cur = {}
            for b, k in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), strict=False):
                cx, cy = int((b[0] + b[2]) / 2), int((b[1] + b[3]) / 2)
                zn = next((z["name"] for z in zones if z["mask"][min(h - 1, cy), min(w - 1, cx)]), None)
                if zn is None:
                    continue
                lbl = r.names[int(k)]
                cur[lbl] = cur.get(lbl, 0) + 1
                cv2.rectangle(ann, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), BLUE, 2)
                label(ann, lbl, (b[0], b[1]), BLUE)
            # an event when what is in the zones changes and stays changed for two checks (no flicker)
            if cur == stable[0]:
                stable[1] += 1
            else:
                stable[0], stable[1] = cur, 1
            if stable[1] == 2 and cur != prev_counts:
                added = {k: v - prev_counts.get(k, 0) for k, v in cur.items() if v > prev_counts.get(k, 0)}
                gone = {k: prev_counts[k] - cur.get(k, 0) for k in prev_counts if prev_counts[k] > cur.get(k, 0)}
                event("objects", ann.copy() if added else None, now_in_zone=cur, appeared=added, left=gone, alert=alert and bool(added))
                prev_counts = dict(cur)
            counts = {"now " + k: v for k, v in cur.items()}
            for z in zones:
                if z["pts"] is not None:
                    cv2.polylines(ann, [z["pts"]], True, YELLOW, 2)
        if mode == "scan":
            for z in zones:
                if z["pts"] is not None:
                    cv2.polylines(ann, [z["pts"]], True, YELLOW, 2)
        fps_frames += 1
        tnow = time.time()
        if tnow - last_out >= float(cfg.get("status_every_s", 0.5)):
            st["fps"] = round(fps_frames / max(1e-3, tnow - last_fps_t), 1)
            fps_frames, last_fps_t = 0, tnow
            st.update({"frames": n, "counts": counts, "alerting": alert, "size": [w, h], "updated": now.isoformat(timespec="seconds")})
            if is_file:
                st.update({"position": n, "total": total, "progress": round(n * 100.0 / total, 1) if total else None,
                           "video_s": round(n / vfps, 1), "length_s": round(total / vfps, 1) if total else None})
            if mode == "motion":
                st["zones"] = {k: v["on"] for k, v in zstate.items()}
            write_json("status.json", st)
            write_jpg("last.jpg", ann)
            last_out = tnow
        if realtime:
            time.sleep(max(0.0, step / vfps - (time.time() - tnow)))
    cap.release()
    st.update({"frames": n, "counts": counts, "ended": datetime.datetime.now().isoformat(timespec="seconds"), "seconds": round(time.time() - t0, 1)})
    if is_file and total:
        st.update({"position": n, "video_s": round(n / vfps, 1), "progress": 100.0 if st["state"] == "finished" else round(n * 100.0 / total, 1)})
    write_json("status.json", st)


def grab_frame(folder):
    os.chdir(folder)
    cfg = json.load(open("watch.json", encoding="utf-8"))
    src = cfg.get("source") or {}
    info = {"ok": False}
    try:
        cap = open_source(src)
        if src.get("kind") == "file":
            fps = cap.get(cv2.CAP_PROP_FPS) or 25
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(float(cfg.get("at_s", 0)) * fps))
            info.update({"fps": round(fps, 2), "frames": total, "length_s": round(total / fps, 1)})
        frame = None
        for _ in range(1 if src.get("kind") == "file" else 8):      # cameras need a few frames to set exposure
            ok, f = cap.read()
            if ok and f is not None:
                frame = f
        cap.release()
        if frame is None:
            raise ValueError("no picture came from " + safe_source(src))
        frame = fit(frame, int(cfg.get("max_side", 1280)))[0]
        write_jpg("frame.jpg", frame, 85)
        info.update({"ok": True, "width": int(frame.shape[1]), "height": int(frame.shape[0])})
    except Exception as ex:  # noqa: BLE001 - reported to the page
        info["error"] = str(ex)
    write_json("frame.json", info)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--watch":
        run_watch(sys.argv[2])
    elif len(sys.argv) > 2 and sys.argv[1] == "--grab":
        grab_frame(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] == "--serve":
        print("READY", flush=True)
        for line in sys.stdin:
            job = line.strip()
            if not job:
                continue
            try:
                run_job(job)
            except Exception:  # noqa: BLE001 - the host reads result.json or reports the missing file
                traceback.print_exc()
            print("DONE " + job, flush=True)
    else:
        run_job(os.getcwd())
"""";
    }
}

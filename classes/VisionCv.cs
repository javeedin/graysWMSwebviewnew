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
    /// denoise, sharpen, deskew, rotate), edges, resize. It only reads the images it is given and writes result.json + out\*;
    /// the work folder is deleted afterwards (photos are not kept). No user code runs here, so any user may use it once an
    /// AI admin has set it up on the PC.
    /// </summary>
    public static class VisionCv
    {
        public static readonly string[] PACKAGES = { "opencv-contrib-python-headless", "zxing-cpp" };
        /// <summary>The YOLO add-on: Ultralytics (AGPL-3.0, see the docs) on PyTorch CPU (Windows wheels from PyPI are CPU builds).</summary>
        public static readonly string[] YOLO_PACKAGES = { "torch", "torchvision", "ultralytics" };
        public static string ModelsDir => Path.Combine(CodeRunner.Root, "models");
        public static readonly string[] OPS = { "info", "document", "barcodes", "count", "compare", "find", "enhance", "edges", "resize", "detect" };
        private static object _status;
        private static DateTime _statusAt = DateTime.MinValue;

        public static async Task<object> StatusAsync(bool fresh = false)
        {
            if (!fresh && _status != null && DateTime.UtcNow - _statusAt < TimeSpan.FromMinutes(10)) return _status;
            string py = await CodeRunner.FindAsync("python");
            CodeRunner.Installs.TryGetValue("opencv", out var ins);
            object setup = ins == null ? null : new { ins.State, ins.Log, ins.Error };
            if (py == null) return new { python = false, opencv = (string)null, zxing = false, ready = false, setup, yolo = (string)null };
            var r = await CodeRunner.ExecAsync(py, new[] { "-c", "import json\nfrom importlib.metadata import version as V\ndef g(n):\n try: return V(n)\n except Exception: return None\ntry:\n import cv2; v=cv2.__version__\nexcept Exception: v=None\nprint(json.dumps({'cv':v,'zx':g('zxing-cpp') is not None,'yolo':g('ultralytics'),'torch':g('torch')}))" }, null, null, 60);
            string cv = null, yolo = null, torch = null; bool zx = false;
            try
            {
                using var d = JsonDocument.Parse(r.Out.Trim().Split('\n').Last());
                string Str(string k) => d.RootElement.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null;
                cv = Str("cv"); yolo = Str("yolo"); torch = Str("torch"); zx = d.RootElement.GetProperty("zx").GetBoolean();
            }
            catch { }
            CodeRunner.Installs.TryGetValue("yolo", out var yins);
            var models = Directory.Exists(ModelsDir) ? Directory.GetFiles(ModelsDir, "*.pt").Select(f => new { name = Path.GetFileNameWithoutExtension(f), mb = Math.Round(new FileInfo(f).Length / 1048576.0, 1) }).ToList<object>() : new List<object>();
            var st = new { python = true, opencv = cv, zxing = zx, ready = cv != null, setup, path = py, yolo, torch,
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
                    Log(yolo ? "Installing PyTorch (CPU) and YOLO (~600 MB — this takes a few minutes)…" : "Installing OpenCV and the barcode reader (~70 MB)…");
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
            if (images == null || images.Count == 0) { res.Error = "No image given."; return res; }
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
                if (n == 0) { res.Error = "The images are empty or larger than 20 MB."; return res; }
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
                        foreach (var o in outs.EnumerateArray().Take(8))
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


def op_barcodes(imgs):
    for i, (name, img) in enumerate(imgs, 1):
        seen, codes = set(), []
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        tries = [(img, 1.0), (cv2.cvtColor(cv2.createCLAHE(3.0, (8, 8)).apply(g), cv2.COLOR_GRAY2BGR), 1.0)]
        if max(img.shape[:2]) < 1600:
            tries.append((cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), 2.0))
        else:
            tries.append((fit(img, 1400)[0], fit(img, 1400)[1]))
        for im, s in tries:
            for c in read_codes(im):
                if c["data"] in seen:
                    continue
                seen.add(c["data"])
                c["points"] = (np.array(c["points"]) / s).round(1).tolist()
                codes.append(c)
        ann = img.copy()
        for n, c in enumerate(codes, 1):
            p = np.array(c["points"], np.int32)
            cv2.polylines(ann, [p], True, GREEN, max(2, img.shape[1] // 400))
            label(ann, "%d %s" % (n, c["data"][:40]), p.min(0))
        save("codes_%d" % i, ann, "%d code(s) found" % len(codes))
        RESULT["images"].append({"name": name, "count": len(codes), "codes": [{"n": n, "type": c["type"], "data": c["data"]} for n, c in enumerate(codes, 1)]})
    RESULT["table"] = {"columns": ["image", "n", "type", "data"], "rows": [[im["name"], c["n"], c["type"], c["data"]] for im in RESULT["images"] for c in im["codes"]]}


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


def op_detect(imgs):
    # YOLO (Ultralytics, on PyTorch): detect / segment / pose with the official COCO models (80 classes: person, car, truck,
    # bottle, chair …) or your own trained model (a .pt file in the models folder, e.g. pallets, cartons, forklifts)
    os.environ.setdefault("YOLO_VERBOSE", "False")
    try:
        from ultralytics import YOLO, settings
    except ImportError as ex:
        raise ValueError("YOLO is not set up on this PC (AI Agent › Vision › Add YOLO + PyTorch)") from ex
    try:
        settings.update({"sync": False})       # no usage analytics to Ultralytics
    except Exception:
        pass
    name = str(PRM.get("model") or "yolo11n").strip()
    if not name.endswith(".pt"):
        name += ".pt"
    if os.path.basename(name) != name:
        raise ValueError("model must be a file name in the models folder")
    path = os.path.join(yolo_models_dir(), name)
    if path not in _YOLO:                       # the official names (yolo11n.pt, yolo11n-seg.pt, yolo11n-pose.pt …) download once
        _YOLO[path] = YOLO(path)
    model = _YOLO[path]
    conf = num("conf", 0.25, 0.01, 0.99)
    want = [c.strip().lower() for c in str(PRM.get("classes") or "").split(",") if c.strip()]
    ids = [k for k, v in model.names.items() if v.lower() in want] if want else None
    if want and not ids:
        raise ValueError("this model does not know " + ", ".join(want) + " — it knows: " + ", ".join(list(model.names.values())[:80]))
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


OPS = {"info": op_info, "document": op_document, "barcodes": op_barcodes, "count": op_count, "compare": op_compare,
       "enhance": op_enhance, "edges": op_edges, "find": op_find, "resize": op_resize, "detect": op_detect}


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
        if not files:
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


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
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

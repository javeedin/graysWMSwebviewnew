using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Data Loading module (dataload/index.html) — Fusion FBDI templates.
    /// Downloads Oracle's official .xlsm templates from
    /// https://www.oracle.com/webfolder/technetwork/docs/fbdi-{release}/fbdi/xlsm/{file}.xlsm
    /// into C:\fusion\FBDI\{release}\ and opens them / their folder.
    /// Replies: { action: "dataLoadResponse", requestId, data };
    /// progress: { action: "dataLoadProgress", requestId, file, index, total, status }.
    /// </summary>
    public partial class Form1
    {
        // Instance fields only — a failing static initializer takes the whole Form1 down.
        private HttpClient _fbdiHttp;

        private const string FBDI_BASE_URL = "https://www.oracle.com/webfolder/technetwork/docs/fbdi-{0}/fbdi/xlsm/{1}.xlsm";
        private const string FBDI_ROOT = @"C:\fusion\FBDI";
        private static bool FbdiFileOk(string s) => s != null && Regex.IsMatch(s, @"^[A-Za-z0-9_]{3,100}$");
        private static bool FbdiReleaseOk(string s) => s != null && Regex.IsMatch(s, @"^\d{2}[a-dA-D]$");

        private static bool IsDataLoadAction(string action) =>
            action != null && action.StartsWith("dataLoad", StringComparison.Ordinal);

        private HttpClient FbdiHttp()
        {
            if (_fbdiHttp == null)
            {
                _fbdiHttp = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
                _fbdiHttp.DefaultRequestHeaders.UserAgent.ParseAdd("GraysWMS-DataLoading/1.0");
            }
            return _fbdiHttp;
        }

        private static string FbdiStr(JsonElement root, string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static string FbdiFolder(string release)
        {
            if (!FbdiReleaseOk(release)) throw new ArgumentException("Bad release: " + release);
            return Path.Combine(FBDI_ROOT, release.ToUpperInvariant());
        }

        private async Task HandleDataLoadAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                switch (action)
                {
                    case "dataLoadInfo":
                        data = DataLoadInfo(FbdiStr(root, "release"));
                        break;
                    case "dataLoadDownload":
                        {
                            var files = new List<string>();
                            if (root.TryGetProperty("files", out var fa) && fa.ValueKind == JsonValueKind.Array)
                                foreach (var f in fa.EnumerateArray()) if (f.ValueKind == JsonValueKind.String) files.Add(f.GetString());
                            data = await DataLoadDownloadAsync(wv, requestId, FbdiStr(root, "release"), files,
                                root.TryGetProperty("overwrite", out var ow) && ow.ValueKind == JsonValueKind.True);
                            break;
                        }
                    case "dataLoadOpen":
                        {
                            string path = DataLoadLocalPath(FbdiStr(root, "release"), FbdiStr(root, "file"));
                            if (!File.Exists(path)) { data = new { ok = false, error = "Not downloaded yet." }; break; }
                            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
                            data = new { ok = true, path };
                            break;
                        }
                    case "dataLoadOpenFolder":
                        {
                            string dir = FbdiFolder(FbdiStr(root, "release"));
                            Directory.CreateDirectory(dir);
                            string file = FbdiStr(root, "file");
                            string path = file == null ? null : DataLoadLocalPath(FbdiStr(root, "release"), file);
                            if (path != null && File.Exists(path)) Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + path + "\"") { UseShellExecute = true });
                            else Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
                            data = new { ok = true, folder = dir };
                            break;
                        }
                    case "dataLoadCheckReleases":
                        {
                            var rels = new List<string>();
                            if (root.TryGetProperty("releases", out var ra) && ra.ValueKind == JsonValueKind.Array)
                                foreach (var r in ra.EnumerateArray()) if (r.ValueKind == JsonValueKind.String && FbdiReleaseOk(r.GetString())) rels.Add(r.GetString());
                            string probe = FbdiStr(root, "probe") ?? "JournalImportTemplate";
                            if (!FbdiFileOk(probe)) probe = "JournalImportTemplate";
                            var checks = rels.Take(12).Select(async r => new { release = r, available = await FbdiExistsAsync(r, probe) });
                            data = new { ok = true, releases = await Task.WhenAll(checks) };
                            break;
                        }
                    default:
                        data = new { ok = false, error = "Unknown data loading action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[DataLoad] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "dataLoadResponse", requestId, data }));
        }

        private static string DataLoadLocalPath(string release, string file)
        {
            if (!FbdiFileOk(file)) throw new ArgumentException("Bad template name: " + file);
            return Path.Combine(FbdiFolder(release), file + ".xlsm");
        }

        private object DataLoadInfo(string release)
        {
            string dir = FbdiFolder(release);
            var files = Directory.Exists(dir)
                ? new DirectoryInfo(dir).GetFiles("*.xlsm").Select(f => new { file = Path.GetFileNameWithoutExtension(f.Name), size = f.Length, modified = f.LastWriteTime.ToString("yyyy-MM-dd HH:mm") }).ToArray<object>()
                : Array.Empty<object>();
            return new { ok = true, folder = dir, files };
        }

        private async Task<bool> FbdiExistsAsync(string release, string file)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Head, string.Format(FBDI_BASE_URL, release.ToLowerInvariant(), file));
                using var res = await FbdiHttp().SendAsync(req);
                return res.IsSuccessStatusCode;
            }
            catch (Exception ex) { Debug.WriteLine($"[DataLoad] HEAD {release}/{file}: {ex.Message}"); return false; }
        }

        private async Task<object> DataLoadDownloadAsync(WebView2 wv, string requestId, string release, List<string> files, bool overwrite)
        {
            string dir = FbdiFolder(release);
            Directory.CreateDirectory(dir);
            var results = new List<object>();
            bool allOk = true;
            int i = 0;
            foreach (var file in files.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                i++;
                string path = DataLoadLocalPath(release, file);
                string url = string.Format(FBDI_BASE_URL, release.ToLowerInvariant(), file);
                void Progress(string status) =>
                    PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "dataLoadProgress", requestId, file, index = i, total = files.Count, status }));
                try
                {
                    if (!overwrite && File.Exists(path))
                    {
                        results.Add(new { file, ok = true, cached = true, path, size = new FileInfo(path).Length });
                        Progress("cached");
                        continue;
                    }
                    Progress("downloading");
                    using var res = await FbdiHttp().GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
                    if (!res.IsSuccessStatusCode)
                    {
                        string why = (int)res.StatusCode == 404 ? "Not published for release " + release.ToUpperInvariant() : "HTTP " + (int)res.StatusCode;
                        results.Add(new { file, ok = false, error = why, url });
                        allOk = false;
                        Progress("failed");
                        continue;
                    }
                    string part = path + ".part";
                    using (var src = await res.Content.ReadAsStreamAsync())
                    using (var dst = File.Create(part))
                        await src.CopyToAsync(dst);
                    // .xlsm is a zip — refuse an HTML error page saved under the template name
                    using (var fs = File.OpenRead(part))
                    {
                        int b1 = fs.ReadByte(), b2 = fs.ReadByte();
                        if (b1 != 'P' || b2 != 'K') { fs.Close(); File.Delete(part); throw new InvalidDataException("Oracle returned a page instead of the template."); }
                    }
                    if (File.Exists(path)) File.Delete(path);
                    File.Move(part, path);
                    results.Add(new { file, ok = true, cached = false, path, size = new FileInfo(path).Length });
                    Progress("done");
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[DataLoad] download {file}: {ex.Message}");
                    try { if (File.Exists(path + ".part")) File.Delete(path + ".part"); } catch { }
                    results.Add(new { file, ok = false, error = ex.Message, url });
                    allOk = false;
                    Progress("failed");
                }
            }
            return new { ok = allOk, folder = dir, results };
        }
    }
}

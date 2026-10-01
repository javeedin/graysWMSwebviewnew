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
                    case "dataLoadFsmDownload":
                        data = await FsmDownloadAsync(FbdiStr(root, "url"), FbdiStr(root, "instance"), FbdiStr(root, "name"));
                        break;
                    case "dataLoadFusionRest":
                        data = await FusionRestAsync(FbdiStr(root, "method"), FbdiStr(root, "url"), FbdiStr(root, "body"),
                            root.TryGetProperty("framework", out var fw) && fw.ValueKind == JsonValueKind.String ? fw.GetString() : null,
                            FbdiStr(root, "contentType"),
                            root.TryGetProperty("upsert", out var ups) && ups.ValueKind == JsonValueKind.True);
                        break;
                    case "dataLoadFsmReadFile":
                        {
                            string path = FsmSafePath(FbdiStr(root, "path"));
                            data = File.Exists(path)
                                ? new { ok = true, path, size = new FileInfo(path).Length, base64 = Convert.ToBase64String(File.ReadAllBytes(path)) }
                                : (object)new { ok = false, error = "The export file is no longer on this PC: " + path };
                            break;
                        }
                    case "dataLoadFsmOpenFolder":
                        {
                            string path = FbdiStr(root, "path");
                            string dir = Path.Combine(FSM_ROOT, (FbdiStr(root, "instance") ?? "PROD").ToUpperInvariant() == "TEST" ? "TEST" : "PROD");
                            Directory.CreateDirectory(dir);
                            if (!string.IsNullOrEmpty(path) && File.Exists(FsmSafePath(path))) Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + FsmSafePath(path) + "\"") { UseShellExecute = true });
                            else Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
                            data = new { ok = true, folder = dir };
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

        // ── FSM setup exports (Setup Projects tab) ─────────────────────────────
        private const string FSM_ROOT = @"C:\fusion\FSM";

        /// <summary>Only files under C:\fusion\FSM can be read back.</summary>
        private static string FsmSafePath(string path)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("No file given.");
            string full = Path.GetFullPath(path);
            if (!full.StartsWith(FSM_ROOT + "\\", StringComparison.OrdinalIgnoreCase) || !full.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Not an FSM export file: " + path);
            return full;
        }

        /// <summary>
        /// Downloads an FSM CSV export package (…/SetupOfferingCSVExportProcessResult/{id}/enclosure/FileContent or the
        /// task equivalent) with the Fusion credentials the app already holds — the password never goes to the page.
        /// Only https://*.oraclecloud.com/fscmRestApi/ URLs are allowed. Saves C:\fusion\FSM\{PROD|TEST}\{name}.zip.
        /// </summary>
        private async Task<object> FsmDownloadAsync(string url, string instance, string name)
        {
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
                !uri.Host.EndsWith(".oraclecloud.com", StringComparison.OrdinalIgnoreCase) || uri.AbsolutePath.IndexOf("/fscmRestApi/", StringComparison.OrdinalIgnoreCase) < 0)
                return new { ok = false, error = "Only Oracle Fusion REST URLs (https://…oraclecloud.com/fscmRestApi/…) can be downloaded." };
            if (!_fusionCredentialsLoaded || string.IsNullOrEmpty(_fusionUsername) || string.IsNullOrEmpty(_fusionPassword))
            {
                await FetchFusionCredentialsOnStartup();
                if (!_fusionCredentialsLoaded) return new { ok = false, error = "Oracle Fusion credentials are not available." };
            }
            string inst = (instance ?? "PROD").ToUpperInvariant() == "TEST" ? "TEST" : "PROD";
            string safe = Regex.Replace(string.IsNullOrEmpty(name) ? "fsm_export" : name, @"[^\w.-]+", "_");
            if (!safe.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) safe += ".zip";
            string dir = Path.Combine(FSM_ROOT, inst);
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, safe);

            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(_fusionUsername + ":" + _fusionPassword)));
            using var res = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
            if (!res.IsSuccessStatusCode)
            {
                string body = await res.Content.ReadAsStringAsync();
                return new { ok = false, error = "HTTP " + (int)res.StatusCode + (body.Length > 0 ? ": " + body.Substring(0, Math.Min(400, body.Length)) : "") };
            }
            byte[] bytes = await res.Content.ReadAsByteArrayAsync();
            // Some pods return the enclosure base64-encoded as text — decode it when it is not a zip already
            if (bytes.Length > 1 && !(bytes[0] == 'P' && bytes[1] == 'K'))
            {
                string text = System.Text.Encoding.ASCII.GetString(bytes).Trim().Trim('"');
                try { var dec = Convert.FromBase64String(text); if (dec.Length > 1 && dec[0] == 'P' && dec[1] == 'K') bytes = dec; } catch (FormatException) { }
            }
            if (bytes.Length < 2 || bytes[0] != 'P' || bytes[1] != 'K')
                return new { ok = false, error = "Fusion did not return a ZIP file (" + bytes.Length + " bytes) — is the export finished?" };
            File.WriteAllBytes(path, bytes);
            return new { ok = true, path, size = bytes.Length, base64 = Convert.ToBase64String(bytes) };
        }

        // ── Fusion API tab: REST calls with the HTTP status kept ─────────────────
        private static readonly string[] FusionRestRoots = { "/fscmRestApi/resources/", "/hcmRestApi/resources/", "/crmRestApi/resources/" };

        /// <summary>
        /// One Fusion REST call for the Fusion API tab. Unlike executeOracleFusion*, the reply carries the HTTP
        /// status, so the page can tell a created row from a rejected one. Only GET / POST / PATCH, only
        /// https://*.oraclecloud.com/{fscm|hcm|crm}RestApi/resources/ URLs; the Fusion credentials stay here.
        /// </summary>
        // Content types a page may ask for: custom actions (submit, cancel …) need the ADF action type; everything else is a resource item.
        private static readonly string[] FusionRestContentTypes = { "application/vnd.oracle.adf.resourceitem+json", "application/vnd.oracle.adf.action+json", "application/json" };

        private async Task<object> FusionRestAsync(string method, string url, string body, string framework, string contentType = null, bool upsert = false)
        {
            method = (method ?? "GET").ToUpperInvariant();
            if (method != "GET" && method != "POST" && method != "PATCH")
                return new { ok = false, error = "Only GET, POST and PATCH are allowed." };
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
                !uri.Host.EndsWith(".oraclecloud.com", StringComparison.OrdinalIgnoreCase) ||
                !FusionRestRoots.Any(r => uri.AbsolutePath.IndexOf(r, StringComparison.OrdinalIgnoreCase) >= 0))
                return new { ok = false, error = "Only Oracle Fusion REST URLs (https://…oraclecloud.com/fscmRestApi|hcmRestApi|crmRestApi/resources/…) are allowed." };
            if (!_fusionCredentialsLoaded || string.IsNullOrEmpty(_fusionUsername) || string.IsNullOrEmpty(_fusionPassword))
            {
                await FetchFusionCredentialsOnStartup();
                if (!_fusionCredentialsLoaded) return new { ok = false, error = "Oracle Fusion credentials are not available." };
            }
            using var req = new HttpRequestMessage(new HttpMethod(method), uri);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(_fusionUsername + ":" + _fusionPassword)));
            req.Headers.Accept.ParseAdd("application/json");
            if (!string.IsNullOrEmpty(framework) && Regex.IsMatch(framework, @"^\d{1,2}$")) req.Headers.TryAddWithoutValidation("REST-Framework-Version", framework);
            if (method != "GET")
            {
                string ct = FusionRestContentTypes.FirstOrDefault(c => string.Equals(c, contentType, StringComparison.OrdinalIgnoreCase)) ?? FusionRestContentTypes[0];
                req.Content = new StringContent(body ?? "{}", System.Text.Encoding.UTF8, ct);
                if (upsert && method == "POST") req.Headers.TryAddWithoutValidation("Upsert-Mode", "true");
            }
            var sw = Stopwatch.StartNew();
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
                using var res = await http.SendAsync(req);
                string text = await res.Content.ReadAsStringAsync();
                if (text.Length > 4_000_000) text = text.Substring(0, 4_000_000);
                return new { ok = true, status = (int)res.StatusCode, body = text, location = res.Headers.Location?.ToString(), ms = sw.ElapsedMilliseconds };
            }
            catch (TaskCanceledException) { return new { ok = false, error = "Fusion did not answer within 3 minutes.", ms = sw.ElapsedMilliseconds }; }
            catch (HttpRequestException ex) { return new { ok = false, error = "Could not reach Fusion: " + ex.Message, ms = sw.ElapsedMilliseconds }; }
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

using System;
using System.Collections.Concurrent;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using WMSApp.FusionSql;
using JsonSerializer = System.Text.Json.JsonSerializer;

namespace WMSApp
{
    /// <summary>
    /// Fusion SQL module (fusionsql/index.html) — host side of the
    /// fusionSql* / fusionDb* IPC actions. Replies are posted as
    /// { action: "fusionSqlResponse", requestId, data: {...} }.
    /// The Fusion password and the Claude API key never leave the host.
    /// </summary>
    public partial class Form1
    {
        private FusionSqlService _fusionSqlService;
        private string _fusionSqlInstance;
        private readonly ConcurrentDictionary<string, CancellationTokenSource> _fusionSqlRunning =
            new ConcurrentDictionary<string, CancellationTokenSource>();

        private static readonly JsonSerializerOptions FusionSqlJson = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private FusionSqlService GetFusionSqlService()
        {
            return _fusionSqlService ??= new FusionSqlService(
                async () =>
                {
                    if (!_fusionCredentialsLoaded || string.IsNullOrEmpty(_fusionUsername) || string.IsNullOrEmpty(_fusionPassword))
                        await FetchFusionCredentialsOnStartup();
                    return (_fusionUsername, _fusionPassword);
                },
                () => _fusionSqlInstance ?? _loggedInInstance);
        }

        private static bool IsFusionSqlAction(string action) =>
            action != null && (action.StartsWith("fusionSql", StringComparison.Ordinal) || action.StartsWith("fusionDb", StringComparison.Ordinal));

        private async Task HandleFusionSqlAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                if (root.TryGetProperty("instance", out var instEl) && instEl.ValueKind == JsonValueKind.String)
                {
                    string inst = (instEl.GetString() ?? "").ToUpperInvariant();
                    if (inst == "PROD" || inst == "TEST") _fusionSqlInstance = inst;
                }

                var svc = GetFusionSqlService();
                switch (action)
                {
                    case "fusionSqlConfig":
                        {
                            var cfg = root.TryGetProperty("patch", out var patch) && patch.ValueKind == JsonValueKind.Object
                                ? FusionSqlStore.PatchConfig(patch)
                                : FusionSqlStore.LoadConfig();
                            data = FusionSqlStatus(svc, cfg);
                            break;
                        }

                    case "fusionSqlExecute":
                        {
                            string sql = FsStr(root, "sql");
                            int? limit = root.TryGetProperty("rowLimit", out var rl) && rl.TryGetInt32(out var n) ? n : (int?)null;
                            var cts = new CancellationTokenSource();
                            _fusionSqlRunning[requestId ?? ""] = cts;
                            try { data = await svc.ExecuteAsync(sql, limit, cts.Token); }
                            catch (OperationCanceledException) { data = FusionQueryResult.Fail("Cancelled."); }
                            finally { _fusionSqlRunning.TryRemove(requestId ?? "", out _); cts.Dispose(); }
                            break;
                        }

                    case "fusionSqlCancel":
                        {
                            bool found = _fusionSqlRunning.TryGetValue(FsStr(root, "targetRequestId") ?? "", out var cts);
                            if (found) cts.Cancel();
                            data = new { success = found };
                            break;
                        }

                    case "fusionSqlDeploy":
                        {
                            var r = await svc.DeployAsync();
                            data = new { success = r.Success, steps = r.Steps, message = r.Success ? "Query runner deployed and verified." : null, error = r.Error, raw = r.Raw };
                            break;
                        }

                    case "fusionSqlCalls":
                        data = new { success = true, calls = svc.GetCalls(root.TryGetProperty("clear", out var cl) && cl.ValueKind == JsonValueKind.True) };
                        break;

                    case "fusionSqlCacheGet":
                        data = new { success = true, value = FusionSqlStore.CacheGet(FsPod(svc, root), FsStr(root, "key")) };
                        break;

                    case "fusionSqlCacheSet":
                        {
                            JsonNode value = root.TryGetProperty("value", out var v) ? JsonNode.Parse(v.GetRawText()) : null;
                            FusionSqlStore.CacheSet(FsPod(svc, root), FsStr(root, "key"), value);
                            data = new { success = true };
                            break;
                        }

                    case "fusionSqlCacheClear":
                        FusionSqlStore.CacheClear(FsPod(svc, root));
                        data = new { success = true };
                        break;

                    case "fusionSqlCacheExport":
                        {
                            string src = FusionSqlStore.CacheFileFor(FsPod(svc, root));
                            if (!File.Exists(src)) { data = new { success = false, error = "Nothing cached yet for this pod." }; break; }
                            string dest = AskSavePath("Export schema cache", Path.GetFileName(src), "JSON files (*.json)|*.json");
                            if (dest == null) { data = new { success = false, cancelled = true }; break; }
                            File.Copy(src, dest, true);
                            data = new { success = true, path = dest };
                            break;
                        }

                    case "fusionDbSave":
                        data = FusionSchemaDb.Save(FsStr(root, "owner") ?? "",
                            root.TryGetProperty("tables", out var t) ? t : default,
                            root.TryGetProperty("indexes", out var ix) ? ix : default,
                            root.TryGetProperty("fks", out var fk) ? fk : default);
                        break;

                    case "fusionDbInfo":
                        data = FusionSchemaDb.Info();
                        break;

                    case "fusionDbQuery":
                        data = FusionSchemaDb.Query(FsStr(root, "sql"), root.TryGetProperty("rowLimit", out var dl) && dl.TryGetInt32(out var dn) ? dn : 500);
                        break;

                    case "fusionDbExport":
                        {
                            if (!File.Exists(FusionSqlStore.SchemaDbFile)) { data = new { ok = false, error = "No local schema database yet." }; break; }
                            string dest = AskSavePath("Export schema database", "fusion-schema.db", "SQLite database (*.db)|*.db");
                            if (dest == null) { data = new { ok = false, cancelled = true }; break; }
                            FusionSchemaDb.ExportTo(dest);
                            data = new { ok = true, path = dest };
                            break;
                        }

                    case "fusionDbImport":
                        {
                            string src = null;
                            using (var dlg = new OpenFileDialog { Title = "Import schema database", Filter = "SQLite database (*.db)|*.db|All files (*.*)|*.*" })
                                if (dlg.ShowDialog(this) == DialogResult.OK) src = dlg.FileName;
                            if (src == null) { data = new { ok = false, cancelled = true }; break; }
                            FusionSchemaDb.ImportFrom(src);
                            data = FusionSchemaDb.Info();
                            break;
                        }

                    case "fusionSqlAiSql":
                        {
                            var cfg = FusionSqlStore.LoadConfig();
                            // Research steps (tool calls) stream to the page as they happen
                            Action<string> progress = msg =>
                            {
                                try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "fusionSqlAiProgress", requestId, message = msg }, FusionSqlJson)); }
                                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FusionSql AI] progress post failed: " + ex.Message); }
                            };
                            var r = await FusionSqlAi.AskAsync(FsStr(root, "question"), FsStr(root, "schema"),
                                root.TryGetProperty("history", out var h) ? h : default, cfg.AiModel, svc, progress);
                            data = new { success = r.Success, response = r.Response, error = r.Error, steps = r.Steps };
                            break;
                        }

                    case "fusionSqlSaveCredentials":
                        FusionSqlStore.SaveCredentials(FsStr(root, "username"), FsStr(root, "password"));
                        data = FusionSqlStatus(svc, FusionSqlStore.LoadConfig());
                        break;

                    case "fusionSqlGetCredentials":
                        {
                            var cfg = FusionSqlStore.LoadConfig();
                            var c = await svc.GetCredentialsAsync(cfg);
                            data = new { username = c.Username, hasPassword = !string.IsNullOrEmpty(c.Password), source = c.Source };
                            break;
                        }

                    case "fusionSqlSaveAiKey":
                        FusionSqlStore.SaveAiKey(FsStr(root, "apiKey"));
                        data = FusionSqlStatus(svc, FusionSqlStore.LoadConfig());
                        break;

                    case "fusionSqlShareOutlook":
                        data = FusionSqlShareOutlook(root);
                        break;

                    default:
                        data = new { success = false, error = "Unknown Fusion SQL action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionSql] {action} failed: {ex}");
                data = new { success = false, ok = false, error = ex.Message };
            }

            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "fusionSqlResponse", requestId, data }, FusionSqlJson));
        }

        private object FusionSqlStatus(FusionSqlService svc, FusionSqlConfig cfg)
        {
            var custom = FusionSqlStore.LoadCredentials();
            return new
            {
                success = true,
                config = cfg,
                origin = svc.ResolveOrigin(cfg),
                pod = svc.PodKey(cfg),
                instance = svc.InstanceName,
                credentials = new
                {
                    source = cfg.UseCustomCredentials ? "custom" : "application",
                    appUsername = _fusionUsername,
                    appLoaded = _fusionCredentialsLoaded,
                    customUsername = custom.Username,
                    customHasPassword = !string.IsNullOrEmpty(custom.Password)
                },
                ai = new { hasKey = !string.IsNullOrEmpty(FusionSqlStore.LoadAiKey()), model = cfg.AiModel },
                runnerSql = FusionSqlService.RUNNER_SQL,
                storagePath = FusionSqlStore.Root
            };
        }

        private static string FsPod(FusionSqlService svc, JsonElement root) =>
            FsStr(root, "pod") ?? svc.PodKey(FusionSqlStore.LoadConfig());

        private static string FsStr(JsonElement root, string name) =>
            root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

        /// <summary>
        /// Opens an Outlook draft (never sends) with the report as HTML body. Attachments arrive
        /// base64-encoded; ones with a "cid" are the chart images the body references as cid:…
        /// Without Outlook the files are left in a temp folder that is opened for the user.
        /// </summary>
        private object FusionSqlShareOutlook(JsonElement root)
        {
            string dir = Path.Combine(Path.GetTempPath(), "GraysWMS", "FusionSqlShare", DateTime.Now.ToString("yyyyMMdd_HHmmss"));
            Directory.CreateDirectory(dir);
            var files = new System.Collections.Generic.List<(string Path, string Cid)>();
            if (root.TryGetProperty("attachments", out var atts) && atts.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in atts.EnumerateArray())
                {
                    string name = string.Join("_", (Path.GetFileName(FsStr(a, "name") ?? "") ?? "").Split(Path.GetInvalidFileNameChars()));
                    string b64 = FsStr(a, "base64");
                    if (string.IsNullOrWhiteSpace(name) || string.IsNullOrEmpty(b64)) continue;
                    string path = Path.Combine(dir, name);
                    File.WriteAllBytes(path, Convert.FromBase64String(b64));
                    files.Add((path, FsStr(a, "cid")));
                }
            }

            string subject = FsStr(root, "subject") ?? "Fusion SQL report";
            try
            {
                Type outlookType = Type.GetTypeFromProgID("Outlook.Application");
                if (outlookType != null)
                {
                    dynamic app = Activator.CreateInstance(outlookType);
                    dynamic mail = app.CreateItem(0);                 // olMailItem
                    string to = FsStr(root, "to");
                    if (!string.IsNullOrWhiteSpace(to)) mail.To = to;
                    mail.Subject = subject;
                    foreach (var f in files)
                    {
                        dynamic att = mail.Attachments.Add(f.Path);
                        if (!string.IsNullOrEmpty(f.Cid))                 // PR_ATTACH_CONTENT_ID -> inline image
                            att.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001F", f.Cid);
                    }
                    mail.HTMLBody = FsStr(root, "html") ?? "";
                    mail.Display(false);
                    return new { ok = true, via = "outlook" };
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[FusionSql] Outlook share failed: " + ex.Message);
            }

            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
            return new { ok = true, via = "folder", folder = dir };
        }

        private string AskSavePath(string title, string fileName, string filter)
        {
            using (var dlg = new SaveFileDialog { Title = title, FileName = fileName, Filter = filter, OverwritePrompt = true })
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileName : null;
        }
    }
}

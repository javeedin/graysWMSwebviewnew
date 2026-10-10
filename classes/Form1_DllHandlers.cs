using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// DLL Explorer (dllexplorer/index.html) - "dll*" IPC actions. Reading only: a DLL is parsed and decompiled,
    /// never loaded or run. dllExplain runs the DllAi agent (Claude reads the DLL through tools and writes a
    /// feature map) and streams its steps as dllProgress messages.
    /// </summary>
    public partial class Form1
    {
        private static readonly JsonSerializerOptions DllJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        private static bool IsDllAction(string action) =>
            action != null && action.StartsWith("dll", StringComparison.Ordinal) && action.Length > 3 && char.IsUpper(action[3]);

        private static string DllStr(JsonElement root, string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        private static bool DllBool(JsonElement root, string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

        private async Task HandleDllAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                switch (action)
                {
                    case "dllSuggest":
                        data = new { ok = true, dropFolder = DllInspector.DROP_FOLDER, files = DllInspector.Suggest(), hasAiKey = !string.IsNullOrEmpty(FusionSqlStore.LoadAiKey()) };
                        break;

                    case "dllPick":
                        {
                            string start = DllStr(root, "current");
                            // WebView2 forbids modal dialogs inside its event handlers - defer to the message queue
                            BeginInvoke(new Action(() =>
                            {
                                string picked = null;
                                try
                                {
                                    using (var dlg = new OpenFileDialog())
                                    {
                                        dlg.Title = "Pick a DLL or EXE to read (it is only read, never run)";
                                        dlg.Filter = "Libraries and programs (*.dll;*.exe;*.winmd)|*.dll;*.exe;*.winmd|All files (*.*)|*.*";
                                        dlg.InitialDirectory = !string.IsNullOrEmpty(start) && Directory.Exists(Path.GetDirectoryName(start) ?? "")
                                            ? Path.GetDirectoryName(start) : Directory.Exists(DllInspector.DROP_FOLDER) ? DllInspector.DROP_FOLDER : AppContext.BaseDirectory;
                                        if (dlg.ShowDialog(this) == DialogResult.OK) picked = dlg.FileName;
                                    }
                                }
                                catch (Exception ex) { Debug.WriteLine("[Dll] pick failed: " + ex.Message); }
                                PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "dllResponse", requestId, data = new { ok = picked != null, path = picked } }, DllJson));
                            }));
                            return;
                        }

                    case "dllInspect":
                        {
                            string path = DllInspector.ResolvePath(DllStr(root, "path"));
                            bool all = DllBool(root, "includeInternal");
                            var rep = await Task.Run(() => DllInspector.InspectCached(path, all));
                            data = new { ok = true, report = rep };
                            break;
                        }

                    case "dllOutline":
                        {
                            string path = DllInspector.ResolvePath(DllStr(root, "path"));
                            bool all = DllBool(root, "includeInternal");
                            int max = root.TryGetProperty("maxChars", out var mc) && mc.TryGetInt32(out var m) ? Math.Clamp(m, 2000, 400000) : 60000;
                            string ns = DllStr(root, "namespace");
                            var rep = await Task.Run(() => DllInspector.InspectCached(path, all));
                            data = new { ok = true, text = DllInspector.Outline(rep, max, string.IsNullOrWhiteSpace(ns) ? null : ns) };
                            break;
                        }

                    case "dllDecompile":
                        {
                            string path = DllInspector.ResolvePath(DllStr(root, "path"));
                            string target = DllStr(root, "target");
                            var sw = Stopwatch.StartNew();
                            string code = await Task.Run(() => DllInspector.Decompile(path, target, 400000));
                            data = new { ok = true, target, code, ms = sw.ElapsedMilliseconds };
                            break;
                        }

                    case "dllFind":
                        {
                            string path = DllInspector.ResolvePath(DllStr(root, "path"));
                            var rep = await Task.Run(() => DllInspector.InspectCached(path, DllBool(root, "includeInternal")));
                            data = new { ok = true, hits = DllInspector.Find(rep, DllStr(root, "query"), 300) };
                            break;
                        }

                    case "dllExplain":
                        {
                            string path = DllInspector.ResolvePath(DllStr(root, "path"));
                            Action<string> progress = msg =>
                            {
                                try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "dllProgress", requestId, message = msg }, DllJson)); }
                                catch (Exception ex) { Debug.WriteLine("[Dll] progress post failed: " + ex.Message); }
                            };
                            var cfg = FusionSqlStore.LoadConfig();
                            var r = await DllAi.ExplainAsync(path, DllBool(root, "includeInternal"), DllStr(root, "focus"), cfg.AiModel, progress);
                            data = new { ok = r.Success, markdown = r.Markdown, error = r.Error, steps = r.Steps };
                            break;
                        }

                    case "dllSaveAiKey":
                        FusionSqlStore.SaveAiKey(DllStr(root, "apiKey"));
                        data = new { ok = true, hasAiKey = !string.IsNullOrEmpty(FusionSqlStore.LoadAiKey()) };
                        break;

                    case "dllOpenFolder":
                        {
                            string dir = DllStr(root, "folder");
                            if (string.IsNullOrEmpty(dir)) { dir = DllInspector.DROP_FOLDER; Directory.CreateDirectory(dir); }
                            else if (!Directory.Exists(dir)) dir = Path.GetDirectoryName(dir);
                            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) { data = new { ok = false, error = "Folder not found" }; break; }
                            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + dir + "\"") { UseShellExecute = true });
                            data = new { ok = true, folder = dir };
                            break;
                        }

                    default:
                        data = new { ok = false, error = "Unknown action " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Dll] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "dllResponse", requestId, data }, DllJson));
        }
    }
}

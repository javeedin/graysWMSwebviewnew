using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FusionModel;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Fusion Model module (fusionmodel/index.html) - "fm*" IPC actions over the engine in engine/FusionModel
    /// (DuckDB module files, versioned publish, local cache). Replies { action: "fmResponse", requestId, data };
    /// a refresh streams { action: "fmProgress", requestId, message }. This PC's settings live in
    /// %APPDATA%\GraysWMS\FusionModel\settings.json; the model and the files live in the shared folder.
    /// </summary>
    public partial class Form1
    {
        private static ModelEngine _modelEngine;
        private static readonly object _modelEngineLock = new object();
        private static readonly HttpClient _modelHttp = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        private CancellationTokenSource _modelRefreshCts;
        private System.Threading.Timer _modelSyncTimer;
        private static readonly JsonSerializerOptions _modelJson = new JsonSerializerOptions(FusionModel.Json.Options) { WriteIndented = false };

        private const string MODEL_APEX_QUERY_URL = "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/executequery";

        private static bool IsModelAction(string action) =>
            action != null && action.StartsWith("fm", StringComparison.Ordinal) && action.Length > 2 && char.IsUpper(action[2]);

        /// <summary>The engine, created on first use: sources registered, scheduler and cache sync started.</summary>
        private ModelEngine GetModelEngine()
        {
            lock (_modelEngineLock)
            {
                if (_modelEngine != null) return _modelEngine;
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "FusionModel");
                var engine = new ModelEngine(Path.Combine(dir, "settings.json"), new EngineSettings
                {
                    SharedRoot = @"C:\fusion\model",
                    CacheRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GraysWMS", "FusionModel", "cache")
                });
                engine.RegisterSource(new ApexSource(_modelHttp, MODEL_APEX_QUERY_URL, "FUSION_MODEL"));
                // Fusion rows come through the Fusion SQL runner: its credentials stay in FusionSqlStore
                engine.RegisterSource(new FusionSource(async (sql, maxRows, ct) =>
                {
                    var r = await GetFusionSqlService().ExecuteAsync(sql, maxRows, ct).ConfigureAwait(false);
                    return (r.Success, r.Error, r.Rows);
                }));
                engine.StartScheduler(() => "SCHEDULE", msg => System.Diagnostics.Debug.WriteLine(msg));
                _modelSyncTimer = new System.Threading.Timer(_ =>
                {
                    try { engine.SyncCache(); } catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FusionModel] sync: " + ex.Message); }
                }, null, TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(3));
                return _modelEngine = engine;
            }
        }

        /// <summary>Starts the engine at app start only where this PC is the refresher (scheduled refreshes need it running).</summary>
        private void StartModelEngineIfRefresher()
        {
            try
            {
                string settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "FusionModel", "settings.json");
                if (File.Exists(settings) && File.ReadAllText(settings).Contains("\"isRefresher\": true")) GetModelEngine();
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FusionModel] start: " + ex.Message); }
        }

        private async Task HandleModelAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            string user = PStr(root, "appUser");
            if (string.IsNullOrWhiteSpace(user) || user == "UNKNOWN") user = GetClaudeCliService().PolicyUser;
            object data;
            try
            {
                var engine = GetModelEngine();
                switch (action)
                {
                    case "fmStatus":
                        data = new { ok = true, status = engine.Status(), isAdmin = await AiControl.IsAdminAsync(user), user };
                        break;

                    case "fmSettingsSave":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the model settings." }; break; }
                            var s = root.GetProperty("settings").Deserialize<EngineSettings>(FusionModel.Json.Options);
                            if (string.IsNullOrWhiteSpace(s.SharedRoot)) { data = new { ok = false, error = "Enter the shared folder." }; break; }
                            Directory.CreateDirectory(s.SharedRoot);
                            engine.SaveSettings(s);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "MODEL", Action = "settings", Outcome = "OK", Detail = s.SharedRoot + " · " + s.ReadMode + (s.IsRefresher ? " · refresher" : "") });
                            data = new { ok = true };
                            break;
                        }

                    case "fmModelGet":
                        data = new { ok = true, model = engine.LoadModel() };
                        break;

                    case "fmModelSave":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the model." }; break; }
                            var model = root.GetProperty("model").Deserialize<ModelDefinition>(FusionModel.Json.Options);
                            var errors = model.Validate();
                            if (errors.Count > 0) { data = new { ok = false, error = string.Join("\n", errors), errors }; break; }
                            engine.SaveModel(model);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "MODEL", Action = "model_save", Outcome = "OK", Detail = model.Modules.Count + " modules, " + model.Tables.Count + " tables" });
                            data = new { ok = true, version = model.Version };
                            break;
                        }

                    case "fmRefresh":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can refresh the model." }; break; }
                            string module = PStr(root, "module");
                            var tables = root.TryGetProperty("tables", out var tl) && tl.ValueKind == JsonValueKind.Array ? tl.EnumerateArray().Select(x => x.GetString()).ToList() : null;
                            _modelRefreshCts?.Dispose();
                            _modelRefreshCts = new CancellationTokenSource();
                            var progress = new Progress<string>(msg =>
                            {
                                try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "fmProgress", requestId, message = msg })); } catch { }
                            });
                            var r = await Task.Run(() => engine.RefreshAsync(module, tables, PBool(root, "full"), user, progress, _modelRefreshCts.Token));
                            if (r.Ok) try { engine.SyncCache(); } catch { }
                            AiControl.Audit(new AiControl.AuditEvent
                            {
                                User = user, Source = "MODEL", Action = "refresh", Outcome = r.Ok ? "OK" : "FAILED", Ref = module,
                                Detail = r.Ok ? r.Version + " · " + string.Join(", ", r.Tables.Select(t => t.Table + " " + t.Rows)) : r.Error
                            });
                            data = new { ok = r.Ok, error = r.Error, result = r };
                            break;
                        }

                    case "fmCancel":
                        _modelRefreshCts?.Cancel();
                        data = new { ok = true };
                        break;

                    case "fmQuery":
                        {
                            string sql = PStr(root, "sql") ?? "";
                            int max = root.TryGetProperty("maxRows", out var mr) && mr.TryGetInt32(out var n) ? n : 1000;
                            var r = await Task.Run(() => engine.Query(sql, max));
                            data = new { ok = true, result = r };
                            break;
                        }

                    case "fmEvaluate":
                        {
                            var req = root.GetProperty("request").Deserialize<FusionModel.Semantic.SemanticRequest>(FusionModel.Json.Options);
                            data = new { ok = true, result = await Task.Run(() => engine.Evaluate(req, user)) };
                            break;
                        }

                    case "fmEvaluateText":
                        data = new { ok = true, result = await Task.Run(() => engine.EvaluateText(PStr(root, "text") ?? "", user)) };
                        break;

                    case "fmValidate":
                        data = new { ok = true, errors = await Task.Run(() => engine.ValidateMeasures()) };
                        break;

                    case "fmSync":
                        data = new { ok = true, copied = await Task.Run(() => engine.SyncCache()) };
                        break;

                    case "fmLog":
                        data = new { ok = true, entries = engine.ReadLog(root.TryGetProperty("last", out var l) && l.TryGetInt32(out var ln) ? ln : 100) };
                        break;

                    default:
                        data = new { ok = false, error = "Unknown action " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[FusionModel] " + action + ": " + ex);
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "fmResponse", requestId, data }, _modelJson));
        }
    }
}

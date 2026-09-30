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
        private CancellationTokenSource _modelAskCts;
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
                try { var vk = LoadModelEmbedKey(); if (!string.IsNullOrEmpty(vk)) engine.Embedder = new FusionModel.Ai.VoyageEmbedder(_modelHttp, vk); } catch { }
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

        // Voyage embeddings key (optional, adds "meaning" to search): DPAPI-encrypted for this Windows user, never sent to the page
        private static string ModelEmbedKeyPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "FusionModel", "voyage.key");
        private static string LoadModelEmbedKey()
        {
            if (!File.Exists(ModelEmbedKeyPath)) return null;
            return System.Text.Encoding.UTF8.GetString(System.Security.Cryptography.ProtectedData.Unprotect(
                Convert.FromBase64String(File.ReadAllText(ModelEmbedKeyPath)), null, System.Security.Cryptography.DataProtectionScope.CurrentUser));
        }
        private static void SaveModelEmbedKey(string key)
        {
            if (string.IsNullOrWhiteSpace(key)) { if (File.Exists(ModelEmbedKeyPath)) File.Delete(ModelEmbedKeyPath); return; }
            Directory.CreateDirectory(Path.GetDirectoryName(ModelEmbedKeyPath));
            File.WriteAllText(ModelEmbedKeyPath, Convert.ToBase64String(System.Security.Cryptography.ProtectedData.Protect(
                System.Text.Encoding.UTF8.GetBytes(key.Trim()), null, System.Security.Cryptography.DataProtectionScope.CurrentUser)));
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
                        data = new { ok = true, status = engine.Status(), isAdmin = await AiControl.IsAdminAsync(user), user, mcpPath = Path.Combine(AppContext.BaseDirectory, "FusionModel.Mcp.exe") };
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

                    case "fmSearch":
                        {
                            int k = root.TryGetProperty("k", out var kk) && kk.TryGetInt32(out var kn) ? kn : 20;
                            var (hits, note) = await Task.Run(() => engine.SearchAsync(PStr(root, "query") ?? "", k));
                            data = new { ok = true, note, hits = hits.Select(h => new { h.Entry.Id, h.Entry.Kind, h.Entry.Title, h.Entry.Ref, h.Entry.Detail, h.Entry.Rule, score = Math.Round(h.Score * 1000, 1), why = h.Why }) };
                            break;
                        }

                    case "fmAsk":
                        {
                            if (!await AiControl.IsEnabledAsync(user)) { data = new { ok = false, error = "The AI is paused (AI Digital Employee › Control)." }; break; }
                            _modelAskCts?.Dispose();
                            _modelAskCts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
                            var history = root.TryGetProperty("history", out var hh) ? hh.Clone() : default;
                            string question = PStr(root, "question") ?? "";
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            var r = await ModelAskAgent.AskAsync(engine, question, history, user, PStr(root, "model"),
                                msg => { try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "fmProgress", requestId, message = msg })); } catch { } },
                                _modelAskCts.Token);
                            double? cost = null;
                            try { cost = await AiControl.CostAsync(r.Model, r.TokensIn, r.TokensOut, r.CacheRead, r.CacheWrite, user); } catch { }
                            AiControl.Audit(new AiControl.AuditEvent
                            {
                                User = user, Source = "MODEL", Action = "turn", Outcome = r.Ok ? "OK" : "FAILED", Model = r.Model,
                                TokensIn = r.TokensIn, TokensOut = r.TokensOut, CacheRead = r.CacheRead, CacheWrite = r.CacheWrite, CostUsd = cost, DurationMs = sw.ElapsedMilliseconds,
                                Detail = (question.Length > 300 ? question.Substring(0, 300) : question) + (r.Ok ? "" : " · " + r.Error)
                            });
                            data = new { ok = r.Ok, error = r.Error, answer = r.Answer, steps = r.Steps, query = r.Query, queryKind = r.QueryKind, costUsd = cost };
                            break;
                        }

                    case "fmAskCancel":
                        _modelAskCts?.Cancel();
                        data = new { ok = true };
                        break;

                    case "fmExamples":
                        data = new { ok = true, examples = engine.LoadExamples().OrderByDescending(x => x.Utc) };
                        break;

                    case "fmExampleSave":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can mark answers as verified." }; break; }
                            var x = root.GetProperty("example").Deserialize<VerifiedExample>(FusionModel.Json.Options);
                            x.By = user;
                            // only a query that runs is saved as verified
                            if (string.Equals(x.Kind, "sql", StringComparison.OrdinalIgnoreCase)) await Task.Run(() => engine.Query(x.Query, 1));
                            else await Task.Run(() => engine.EvaluateText(x.Query, user));
                            data = new { ok = true, example = engine.SaveExample(x) };
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "MODEL", Action = "example_save", Outcome = "OK", Detail = x.Question });
                            break;
                        }

                    case "fmExampleDelete":
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can remove verified examples." }; break; }
                        data = new { ok = engine.DeleteExample(PStr(root, "id")) };
                        break;

                    case "fmEmbedStatus":
                        data = new { ok = true, hasKey = File.Exists(ModelEmbedKeyPath), provider = engine.Embedder?.Name };
                        break;

                    case "fmEmbedKeySave":
                        {
                            string k = PStr(root, "key");
                            SaveModelEmbedKey(k);
                            engine.Embedder = string.IsNullOrWhiteSpace(k) ? null : new FusionModel.Ai.VoyageEmbedder(_modelHttp, k.Trim(), PStr(root, "embedModel"));
                            string test = null;
                            if (engine.Embedder != null)
                                try { await engine.Embedder.EmbedAsync(new[] { "test" }, true, CancellationToken.None); }
                                catch (Exception ex) { test = ex.Message; }
                            data = new { ok = test == null, error = test, provider = engine.Embedder?.Name };
                            break;
                        }

                    case "fmPacks":
                        {
                            var model = engine.LoadModel();
                            data = new
                            {
                                ok = true,
                                packs = FusionModel.Packs.FusionPacks.All.Select(p => new
                                {
                                    p.Id, p.Version, p.Title, p.Area, p.Description, p.Notes, module = p.Module.Name,
                                    applied = model.Packs.TryGetValue(p.Id, out var v) ? v : null,
                                    tables = p.Tables.Select(t => new { t.Name, t.Description, strategy = t.Strategy.ToString(), sql = t.Source.Sql, columns = t.ColumnTypes.Count }),
                                    measures = p.Measures.Select(x => new { x.Name, x.Description, x.Expression }),
                                    checks = p.Checks.Select(x => new { x.Name, x.Description }),
                                    glossary = p.Glossary.Select(x => x.Term)
                                })
                            };
                            break;
                        }

                    case "fmPackProbe":
                        {
                            var pack = FusionModel.Packs.FusionPacks.Get(PStr(root, "id")) ?? throw new InvalidOperationException("Unknown pack");
                            var results = new List<ProbeResult>();
                            foreach (var t in pack.Tables)
                            {
                                try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "fmProgress", requestId, message = "Checking " + t.Name + " on the pod…" })); } catch { }
                                results.Add(await engine.ProbeTableAsync(t));
                            }
                            data = new { ok = true, results };
                            break;
                        }

                    case "fmPackApply":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can add packs to the model." }; break; }
                            var pack = FusionModel.Packs.FusionPacks.Get(PStr(root, "id")) ?? throw new InvalidOperationException("Unknown pack");
                            var model = engine.LoadModel();
                            var r = FusionModel.Packs.FusionPacks.Apply(model, pack, PBool(root, "overwrite"));
                            var errors = model.Validate();
                            if (errors.Count > 0) { data = new { ok = false, error = string.Join("\n", errors) }; break; }
                            engine.SaveModel(model);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "MODEL", Action = "pack_apply", Outcome = "OK", Ref = pack.Id, Detail = r.Added.Count + " added, " + r.Updated.Count + " updated, " + r.Kept.Count + " kept" });
                            data = new { ok = true, result = r };
                            break;
                        }

                    case "fmChecks":
                        {
                            List<string> names = root.TryGetProperty("names", out var nl) && nl.ValueKind == JsonValueKind.Array ? nl.EnumerateArray().Select(x => x.GetString()).ToList() : null;
                            data = new { ok = true, results = await Task.Run(() => engine.RunChecks(user, names)) };
                            break;
                        }

                    case "fmReports":
                        data = new { ok = true, reports = engine.LoadReports().OrderBy(x => x.Folder).ThenBy(x => x.Name) };
                        break;

                    case "fmReportSave":
                        {
                            var rep = root.GetProperty("report").Deserialize<ReportDef>(FusionModel.Json.Options);
                            rep.By = user;
                            data = new { ok = true, report = engine.SaveReport(rep) };
                            break;
                        }

                    case "fmReportDelete":
                        data = new { ok = engine.DeleteReport(PStr(root, "id")) };
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

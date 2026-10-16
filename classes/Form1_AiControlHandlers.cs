using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// AI control plane IPC (AI Digital Employee > Control, Shipping Agent, LOCAL jobs):
    /// aiControlStatus / aiControlSet (kill switch) / aiControlSettings (admins) / aiAudit (pages write an
    /// audit row) / aiInboxCreate / aiInboxGet / aiInboxDecide / aiInboxComplete. Replies are
    /// { action: "aiControlResponse", requestId, ok, error, ... } at the top level.
    /// </summary>
    public partial class Form1
    {
        private static bool IsAiControlAction(string action) =>
            action != null && (action.StartsWith("aiControl", StringComparison.Ordinal) || action.StartsWith("aiInbox", StringComparison.Ordinal) || action == "aiAudit");

        private static string CStr(JsonElement r, string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private async Task HandleAiControlAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            var svc = GetClaudeCliService();
            string user = svc.PolicyUser;
            var reply = new Dictionary<string, object> { ["action"] = "aiControlResponse", ["requestId"] = requestId, ["ok"] = true };
            try
            {
                switch (action)
                {
                    case "aiControlStatus":
                        {
                            var st = await AiControl.StatusAsync(user, root.TryGetProperty("fresh", out var f) && f.ValueKind == JsonValueKind.True);
                            reply["enabled"] = st.Enabled; reply["reason"] = st.Reason; reply["by"] = st.By; reply["at"] = st.At;
                            reply["user"] = user;
                            reply["isAdmin"] = await AiControl.IsAdminAsync(user);
                            reply["isApprover"] = await AiControl.IsApproverAsync(user);
                            var s = await AiControl.SettingsAsync(user);
                            reply["settings"] = new
                            {
                                admins = AiControl.Setting(s, "ADMINS"), approvers = AiControl.Setting(s, "APPROVERS"),
                                teamsWebhook = AiControl.Setting(s, "INBOX_TEAMS_WEBHOOK"), emailTo = AiControl.Setting(s, "INBOX_EMAIL_TO"),
                                modelPrices = AiControl.Setting(s, "MODEL_PRICES")
                            };
                            break;
                        }
                    case "aiControlSet":
                        {
                            bool enable = root.TryGetProperty("enabled", out var e) && e.ValueKind == JsonValueKind.True;
                            var (ok, err) = await AiControl.SetEnabledAsync(enable, user, CStr(root, "reason"));
                            reply["ok"] = ok; reply["error"] = err;
                            var st = await AiControl.StatusAsync(user, true);
                            reply["enabled"] = st.Enabled; reply["reason"] = st.Reason; reply["by"] = st.By; reply["at"] = st.At;
                            break;
                        }
                    case "aiControlSettings":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { reply["ok"] = false; reply["error"] = "Only an AI admin can change these settings."; break; }
                            var map = new Dictionary<string, string> { ["admins"] = "ADMINS", ["approvers"] = "APPROVERS", ["teamsWebhook"] = "INBOX_TEAMS_WEBHOOK", ["emailTo"] = "INBOX_EMAIL_TO", ["modelPrices"] = "MODEL_PRICES" };
                            foreach (var kv in map)
                                if (root.TryGetProperty(kv.Key, out var v) && (v.ValueKind == JsonValueKind.String || v.ValueKind == JsonValueKind.Null))
                                {
                                    string val = v.ValueKind == JsonValueKind.Null ? null : v.GetString()?.Trim();
                                    if (kv.Key == "admins" && !string.IsNullOrWhiteSpace(val) &&
                                        !val.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries).Any(x => string.Equals(x.Trim(), user, StringComparison.OrdinalIgnoreCase)))
                                    { reply["ok"] = false; reply["error"] = "Keep yourself (" + user + ") in the admin list, or you lock yourself out."; return; }
                                    if (kv.Key == "modelPrices" && !string.IsNullOrWhiteSpace(val)) { try { JsonDocument.Parse(val).Dispose(); } catch { reply["ok"] = false; reply["error"] = "Model prices must be JSON, e.g. {\"claude-haiku-4-5\":{\"in\":1,\"out\":5}}"; return; } }
                                    if (kv.Key == "teamsWebhook" && !string.IsNullOrWhiteSpace(val) && !val.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                                    { reply["ok"] = false; reply["error"] = "The Teams webhook must be an https:// URL"; return; }
                                    await AiControl.SetSettingAsync(kv.Value, val, user);
                                }
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "CONTROL", Action = "settings", Outcome = "OK", Detail = "control settings changed" });
                            break;
                        }
                    case "aiAudit":
                        {
                            long? L(string n) => root.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var x) ? x : (long?)null;
                            AiControl.Audit(new AiControl.AuditEvent
                            {
                                User = user, Source = CStr(root, "source") ?? "PAGE", Action = CStr(root, "actionKey"), Outcome = CStr(root, "outcome") ?? "OK",
                                Approval = CStr(root, "approval") ?? "NONE", Instance = CStr(root, "instance"), Ref = CStr(root, "refId"),
                                Target = CStr(root, "target"), Detail = CStr(root, "detail"), DurationMs = L("durationMs")
                            });
                            break;
                        }
                    case "aiInboxCreate":
                        {
                            var (id, status, selection) = await AiControl.InboxCreateAsync(user, CStr(root, "source") ?? "PAGE", CStr(root, "actionKey"), CStr(root, "instance"),
                                CStr(root, "refId"), CStr(root, "sig"), CStr(root, "title"), CStr(root, "summary"), CStr(root, "payloadJson"));
                            reply["inboxId"] = id; reply["status"] = status; reply["resultText"] = selection;
                            break;
                        }
                    case "aiInboxGet":
                        {
                            var ids = new List<long>();
                            if (root.TryGetProperty("ids", out var a) && a.ValueKind == JsonValueKind.Array)
                                foreach (var x in a.EnumerateArray()) if (x.TryGetInt64(out var id)) ids.Add(id);
                            reply["items"] = await AiControl.InboxGetAsync(user, ids);
                            break;
                        }
                    case "aiInboxDecide":
                        {
                            long id = root.TryGetProperty("inboxId", out var iv) && iv.TryGetInt64(out var x) ? x : 0;
                            bool approve = root.TryGetProperty("approve", out var av) && av.ValueKind == JsonValueKind.True;
                            var (ok, err) = await AiControl.InboxDecideAsync(user, id, approve, CStr(root, "note"), CStr(root, "selectionJson"));
                            reply["ok"] = ok; reply["error"] = err;
                            break;
                        }
                    case "aiInboxComplete":
                        {
                            long id = root.TryGetProperty("inboxId", out var iv) && iv.TryGetInt64(out var x) ? x : 0;
                            await AiControl.InboxCompleteAsync(user, id, CStr(root, "status"), CStr(root, "result"));
                            break;
                        }
                    default:
                        reply["ok"] = false; reply["error"] = "Unknown action " + action;
                        break;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[AiControl] " + action + ": " + ex);
                reply["ok"] = false; reply["error"] = ex.Message;
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(reply));
        }

        /// <summary>One "turn" audit row per chat answer: model, tokens and cost (CLI reports its own cost).</summary>
        private async Task<object> AuditAiTurnAsync(AiChatResult r)
        {
            try
            {
                var svc = GetClaudeCliService();
                double? cost = r.CliCostUsd ?? await AiControl.CostAsync(r.Model, r.TokensIn, r.TokensOut, r.CacheRead, r.CacheWrite, svc.PolicyUser);
                if (r.ModelCalls > 0)
                    AiControl.Audit(new AiControl.AuditEvent
                    {
                        User = svc.PolicyUser, Source = "CHAT", Action = "turn", Outcome = r.Success ? (r.RequiresApproval ? "ASKED" : "OK") : "FAILED",
                        Instance = svc.CurrentInstance, Ref = r.SessionId, Model = r.Model, Detail = r.Success ? (r.Rounds.Count + " research round(s), " + r.ModelCalls + " model call(s)") : r.Error,
                        TokensIn = r.TokensIn, TokensOut = r.TokensOut, CacheRead = r.CacheRead, CacheWrite = r.CacheWrite, CostUsd = cost
                    });
                return new { model = r.Model, tokensIn = r.TokensIn, tokensOut = r.TokensOut, cacheRead = r.CacheRead, cacheWrite = r.CacheWrite, costUsd = cost, calls = r.ModelCalls };
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[AiControl] turn audit: " + ex.Message); return null; }
        }
    }
}

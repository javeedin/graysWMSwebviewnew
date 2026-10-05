using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// AI Digital Employee: the user approved (or cancelled) an mra_interface card. On approve every order
    /// runs through MRAProcessor - the same code as the WMS "MRA Interface" buttons, including the
    /// already-interfaced check and the MRA_ORDER_TYPES INTERFACE_FLAG rule - one at a time, with a live
    /// status line, and the chat resumes with MRA_RESULT (a per-order status the model turns into a table).
    /// </summary>
    public partial class Form1
    {
        private async Task HandleAiMraDecision(WebView2 wv, string messageJson, string requestId)
        {
            try
            {
                bool approve = false;
                string sessionId = null, apiConversation = null, instance = "PROD", tripId = "";
                AiEngineConfig engine = null;
                var orders = new List<string>();
                string mraAppUser = null;

                using (var doc = JsonDocument.Parse(messageJson))
                {
                    var root = doc.RootElement;
                    approve = root.TryGetProperty("approve", out var aEl) && aEl.ValueKind == JsonValueKind.True;
                    if (root.TryGetProperty("appUser", out var uEl) && uEl.ValueKind == JsonValueKind.String) mraAppUser = uEl.GetString();
                    if (root.TryGetProperty("sessionId", out var sEl) && sEl.ValueKind == JsonValueKind.String) sessionId = sEl.GetString();
                    engine = ParseAiEngine(root);
                    if (root.TryGetProperty("apiConversation", out var acEl) && acEl.ValueKind == JsonValueKind.String) apiConversation = acEl.GetString();
                    if (root.TryGetProperty("pending", out var pEl) && pEl.ValueKind == JsonValueKind.Object)
                    {
                        if (pEl.TryGetProperty("instance", out var inEl) && inEl.ValueKind == JsonValueKind.String)
                            instance = (inEl.GetString() ?? "").ToUpperInvariant() == "TEST" ? "TEST" : "PROD";
                        if (pEl.TryGetProperty("tripId", out var tEl)) tripId = tEl.ValueKind == JsonValueKind.String ? tEl.GetString() : tEl.ToString();
                        if (pEl.TryGetProperty("orders", out var oEl) && oEl.ValueKind == JsonValueKind.Array)
                            foreach (var o in oEl.EnumerateArray())
                            {
                                string v = o.ValueKind == JsonValueKind.String ? o.GetString() : o.ToString();
                                if (!string.IsNullOrWhiteSpace(v) && !orders.Contains(v.Trim())) orders.Add(v.Trim());
                            }
                    }
                }

                {
                    string why = await AiDecisionAsync(approve, "mra", "mra_interface", instance, AiNormOrders(orders), tripId, AiNormInstance(instance));
                    if (why != null) { SendErrorResponse(wv, requestId, why); return; }
                }

                Func<object, Task> onEvent = (evt) =>
                {
                    try { wv.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[AI CHAT] event post failed: " + ex.Message); }
                    return Task.CompletedTask;
                };

                string mraResult;
                if (!approve)
                    mraResult = "USER_REJECTED - the user cancelled. Nothing was sent to MRA; tell them so.";
                else if (orders.Count == 0 || orders.Count > 50)
                    mraResult = "{\"success\":false,\"error\":\"The approval had " + orders.Count + " orders (1-50 allowed) - nothing was sent\"}";
                else
                {
                    var (fusionUser, fusionPass) = await FusionCredentialsService.GetAsync();
                    if (string.IsNullOrEmpty(fusionUser))
                        mraResult = "{\"success\":false,\"error\":\"Fusion credentials not available (ARMODULE/fusion webservice unreachable) - nothing was sent\"}";
                    else
                    {
                        var results = new List<object>();
                        int interfaced = 0, already = 0, notRequired = 0, failed = 0, notSent = 0, gatewayStreak = 0;
                        string gatewayStop = null;
                        for (int i = 0; i < orders.Count; i++)
                        {
                            string order = orders[i];
                            string prefix = $"MRA {i + 1}/{orders.Count} · order {order}: ";
                            // Two gateway problems in a row = MRA gateway is down: stop sending instead of waiting
                            // the full time limit for every remaining order (nothing is sent for these, safe to retry).
                            if (gatewayStop != null)
                            {
                                notSent++;
                                results.Add(new { order, status = "NOT_SENT", irn = (string)null, headerId = (string)null, step = "CreatingMRAInvoice",
                                    message = "Not sent: " + gatewayStop, details = (string)null, timings = (string)null });
                                continue;
                            }
                            await onEvent(new { action = "aiChatEvent", eventType = "status", text = prefix + "starting…" });
                            WMSApp.MRA.MRAProcessingResult r;
                            try
                            {
                                var processor = new WMSApp.MRA.MRAProcessor(fusionUser, fusionPass, instance) { Source = "AI_EMPLOYEE", TripId = tripId, AppUser = mraAppUser };
                                r = await processor.ProcessMRAInterfaceAsync(order,
                                    (msg, step) => { _ = onEvent(new { action = "aiChatEvent", eventType = "status", text = prefix + msg }); });
                            }
                            catch (Exception exOrder)
                            {
                                r = new WMSApp.MRA.MRAProcessingResult { Success = false, Message = exOrder.Message, CurrentStep = WMSApp.MRA.MRAProcessingStep.Failed };
                            }

                            string status = r.Success ? "INTERFACED"
                                : r.Skipped ? "NOT_REQUIRED"
                                : (r.Message ?? "").IndexOf("already done", StringComparison.OrdinalIgnoreCase) >= 0 ? "ALREADY_DONE"
                                : "FAILED";
                            if (status == "INTERFACED") interfaced++; else if (status == "ALREADY_DONE") already++; else if (status == "NOT_REQUIRED") notRequired++; else failed++;
                            // the streak counts gateway problems; it resets only when the gateway really answered (IRN or a rejection)
                            if (!string.IsNullOrEmpty(r.GatewayProblem)) gatewayStreak++;
                            else if (r.Success || r.CurrentStep == WMSApp.MRA.MRAProcessingStep.CreatingMRAInvoice) gatewayStreak = 0;
                            if (gatewayStreak >= 2)
                                gatewayStop = $"the MRA gateway failed for {gatewayStreak} orders in a row (last: {r.GatewayProblem}) - the batch stopped sending to save time. Retry these when the gateway answers again.";
                            results.Add(new
                            {
                                order,
                                status,
                                irn = r.IrnCode,
                                headerId = r.HeaderId,
                                step = r.CurrentStep.ToString(),
                                message = r.Message,
                                details = string.IsNullOrEmpty(r.ErrorDetails) ? null : (r.ErrorDetails.Length > 300 ? r.ErrorDetails.Substring(0, 300) : r.ErrorDetails),
                                timings = r.Timings
                            });
                            await onEvent(new { action = "aiChatEvent", eventType = "status", text = prefix + status.Replace('_', ' ').ToLowerInvariant() });
                        }
                        mraResult = JsonSerializer.Serialize(new
                        {
                            success = true,
                            instance,
                            tripId,
                            summary = new { total = orders.Count, interfaced, alreadyDone = already, notRequired, failed, notSent },
                            stoppedEarly = gatewayStop,
                            results
                        });
                    }
                }

                var result = await GetClaudeCliService().ResumeWithPromptAsync("MRA_RESULT: " + mraResult, sessionId, engine, apiConversation, onEvent);
                PostAiChatAnswer(wv, requestId, result);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[C# ERROR] aiMraDecision failed: " + ex.Message);
                SendErrorResponse(wv, requestId, ex.Message);
            }
        }
    }
}

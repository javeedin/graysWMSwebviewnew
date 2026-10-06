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
                        // same as the Shipping Agent's Print Trip: 4 orders at a time, MRA_ORDER_TYPES read once for the batch,
                        // results in the approved order, stop after two gateway problems in a row (MraBatch)
                        int n = orders.Count;
                        string P(int i, string order) => $"MRA {i + 1}/{n} · order {order}: ";
                        var (items, gatewayStop) = await WMSApp.MRA.MraBatch.RunAsync(orders,
                            order => new WMSApp.MRA.MRAProcessor(fusionUser, fusionPass, instance) { Source = "AI_EMPLOYEE", TripId = tripId, AppUser = mraAppUser },
                            (i, order) => { _ = onEvent(new { action = "aiChatEvent", eventType = "status", text = P(i, order) + "starting…" }); },
                            (i, order, msg) => { _ = onEvent(new { action = "aiChatEvent", eventType = "status", text = P(i, order) + msg }); },
                            (i, it) => { _ = onEvent(new { action = "aiChatEvent", eventType = "status", text = P(i, it.Order) + it.Status.Replace('_', ' ').ToLowerInvariant() }); });
                        int interfaced = 0, already = 0, notRequired = 0, failed = 0, notSent = 0;
                        var results = new List<object>();
                        foreach (var it in items)
                        {
                            switch (it.Status) { case "INTERFACED": interfaced++; break; case "ALREADY_DONE": already++; break; case "NOT_REQUIRED": notRequired++; break; case "NOT_SENT": notSent++; break; default: failed++; break; }
                            var r = it.Result;
                            if (r == null)
                            {
                                results.Add(new { order = it.Order, status = "NOT_SENT", irn = (string)null, headerId = (string)null, step = "CreatingMRAInvoice",
                                    message = "Not sent: " + it.NotSentReason, details = (string)null, timings = (string)null });
                                continue;
                            }
                            results.Add(new
                            {
                                order = it.Order,
                                status = it.Status,
                                irn = r.IrnCode,
                                headerId = r.HeaderId,
                                step = r.CurrentStep.ToString(),
                                message = r.Message,
                                details = string.IsNullOrEmpty(r.ErrorDetails) ? null : (r.ErrorDetails.Length > 300 ? r.ErrorDetails.Substring(0, 300) : r.ErrorDetails),
                                timings = r.Timings
                            });
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

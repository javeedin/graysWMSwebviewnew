using System;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// AI Digital Employee: the Claude API key lives in the host, DPAPI-encrypted (the same store as
    /// Fusion SQL › Ask AI and DLL Explorer - one key for the whole app), never in the page's localStorage.
    /// The page only says "api mode + model"; ParseAiEngine fills the key in here.
    /// </summary>
    public partial class Form1
    {
        private static string StoredAiKey()
        {
            try { return FusionSqlStore.LoadAiKey(); } catch { return null; }
        }

        /// <summary>
        /// One-shot Claude question from WMS pages (e.g. the Shipping Agent's trip summary), with the app's
        /// saved key. Replies { content: [{ type: "text", text }] } like the Messages API.
        /// </summary>
        private async System.Threading.Tasks.Task HandleClaudeChat(WebView2 wv, JsonElement root, string requestId)
        {
            string text, error = null;
            try
            {
                string question = root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : "";
                string key = StoredAiKey();
                if (string.IsNullOrWhiteSpace(question)) { text = ""; error = "Empty question"; }
                else if (string.IsNullOrEmpty(key)) { text = ""; error = "No Claude API key saved - add it in AI Digital Employee (engine settings)."; }
                else
                {
                    var r = await _claudeApiHandler.QueryClaudeAsync(key, question, "You are a concise assistant inside a warehouse management system. Answer briefly and concretely.", "{}");
                    if (!r.Success) { text = ""; error = r.Error; }
                    else
                    {
                        using var doc = JsonDocument.Parse(r.ResponseJson);
                        var sb = new System.Text.StringBuilder();
                        if (doc.RootElement.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.Array)
                            foreach (var b in c.EnumerateArray())
                                if (b.TryGetProperty("type", out var t) && t.GetString() == "text" && b.TryGetProperty("text", out var tx)) sb.Append(tx.GetString());
                        text = sb.ToString();
                    }
                }
            }
            catch (Exception ex) { text = ""; error = ex.Message; }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new
            {
                action = "claudeChatResponse", requestId,
                data = new { success = error == null, error, content = new[] { new { type = "text", text } } }
            }));
        }

        private void HandleAiEngineKey(WebView2 wv, string action, JsonElement root, string requestId)
        {
            bool ok = true; string error = null;
            try
            {
                if (action == "aiEngineKeySave")
                {
                    string key = root.TryGetProperty("apiKey", out var k) && k.ValueKind == JsonValueKind.String ? k.GetString()?.Trim() : null;
                    if (string.IsNullOrEmpty(key) || !key.StartsWith("sk-", StringComparison.Ordinal)) { ok = false; error = "That does not look like a Claude API key"; }
                    else FusionSqlStore.SaveAiKey(key);
                }
                else if (action == "aiSmtpSave")
                {
                    string Str(string n) => root.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                    int port = root.TryGetProperty("port", out var pv) && pv.ValueKind == JsonValueKind.Number ? pv.GetInt32() : 587;
                    if (string.IsNullOrWhiteSpace(Str("username"))) { ok = false; error = "Email address is required"; }
                    else SmtpVault.Save(Str("server"), port, Str("username"), Str("password"));
                }
                if (action == "aiSmtpSave" || action == "aiSmtpStatus")
                {
                    PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "aiSmtpResponse", requestId, ok, error, smtp = SmtpVault.Status() }));
                    return;
                }
            }
            catch (Exception ex) { ok = false; error = ex.Message; }
            // the AI page hands the whole message to its callback, so the fields sit at the top level
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "aiEngineKeyResponse", requestId, ok, error, hasKey = !string.IsNullOrEmpty(StoredAiKey()) }));
        }
    }
}

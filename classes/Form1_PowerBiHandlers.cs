using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Power BI module (powerbi/index.html) - "pbi*" IPC actions. Replies { action: "pbiResponse", requestId, data };
    /// long refreshes stream { action: "pbiProgress", requestId, message }. Settings are shared (WMS_AI_CONTROL, AI
    /// admins only); the sign-in and the APP-mode secret stay on this PC.
    /// </summary>
    public partial class Form1
    {
        private static bool IsPowerBiAction(string action) =>
            action != null && action.StartsWith("pbi", StringComparison.Ordinal) && action.Length > 3 && char.IsUpper(action[3]);

        private static string PStr(JsonElement r, string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        private static bool PBool(JsonElement r, string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.True;
        private CancellationTokenSource _pbiSignInCts;

        private async Task HandlePowerBiAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            if (action == "pbiOpenWindow") { OpenPowerBiWindow(wv, PStr(root, "url"), PStr(root, "title"), requestId); return; }
            if (action == "pbiServeFolder" || action == "pbiNavigate") { PbiLocalHost(wv, action, PStr(root, "url"), requestId); return; }
            string user = PStr(root, "appUser");
            if (string.IsNullOrWhiteSpace(user) || user == "UNKNOWN") user = GetClaudeCliService().PolicyUser;
            object data;
            try
            {
                var cfg = await PowerBiService.ConfigAsync(user);
                switch (action)
                {
                    case "pbiStatus":
                        {
                            try { await PowerBiService.EnsureTablesAsync(user); } catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[PowerBI] tables: " + ex.Message); }
                            PowerBiService.Token tok = null; string authError = null;
                            if (PowerBiService.Ready(cfg))
                                try { tok = await PowerBiService.TokenSilentAsync(cfg); } catch (Exception ex) { authError = ex.Message; }
                            data = new
                            {
                                ok = true, configured = PowerBiService.Ready(cfg), tenantId = cfg.TenantId, clientId = cfg.ClientId, workspaceId = cfg.WorkspaceId,
                                mode = cfg.Mode, hasSecret = cfg.HasSecret, signedIn = tok != null, account = tok?.Account, authError,
                                isAdmin = await AiControl.IsAdminAsync(user), user
                            };
                            break;
                        }
                    case "pbiSaveConfig":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can change the Power BI settings." }; break; }
                            foreach (var (prop, key) in new[] { ("tenantId", "PBI_TENANT_ID"), ("clientId", "PBI_CLIENT_ID"), ("workspaceId", "PBI_WORKSPACE_ID"), ("mode", "PBI_MODE") })
                                if (root.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String)
                                {
                                    string val = v.GetString()?.Trim();
                                    if ((prop == "tenantId" || prop == "clientId" || prop == "workspaceId") && !string.IsNullOrEmpty(val) && !Guid.TryParse(val, out _))
                                    { data = new { ok = false, error = prop + " must be a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)" }; goto done; }
                                    await AiControl.SetSettingAsync(key, val, user);
                                }
                            if (root.TryGetProperty("appSecret", out var sec) && sec.ValueKind == JsonValueKind.String && sec.GetString().Length > 0)
                                PowerBiService.SaveSecret(sec.GetString());
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "POWERBI", Action = "settings", Outcome = "OK", Detail = "Power BI settings changed" });
                            data = new { ok = true };
                            break;
                        }
                    case "pbiSignIn":
                        {
                            if (!PowerBiService.Ready(cfg)) { data = new { ok = false, error = "Enter the tenant and client (application) ID first." }; break; }
                            if (cfg.Mode == "APP")
                            {
                                var t = await PowerBiService.TokenSilentAsync(cfg);
                                data = t == null ? new { ok = false, error = "Save the client secret for APP mode on this PC first." } : (object)new { ok = true, account = t.Account };
                                break;
                            }
                            _pbiSignInCts?.Cancel();
                            _pbiSignInCts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
                            var tok = await PowerBiService.SignInAsync(cfg, _pbiSignInCts.Token);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "POWERBI", Action = "sign_in", Outcome = "OK", Detail = tok.Account });
                            data = new { ok = true, account = tok.Account };
                            break;
                        }
                    case "pbiSignOut":
                        await PowerBiService.SignOutAsync(cfg);
                        data = new { ok = true };
                        break;

                    case "pbiWorkspaces":
                    case "pbiReports":
                    case "pbiDatasets":
                        {
                            var tok = await PbiToken(cfg);
                            string ws = PStr(root, "workspaceId") ?? cfg.WorkspaceId;
                            if (action == "pbiWorkspaces") data = new { ok = true, items = await PowerBiService.WorkspacesAsync(tok) };
                            else if (string.IsNullOrEmpty(ws)) data = new { ok = false, error = "Pick the Power BI workspace in Setup first." };
                            else data = new { ok = true, items = action == "pbiReports" ? await PowerBiService.ReportsAsync(tok, ws) : await PowerBiService.DatasetsAsync(tok, ws) };
                            break;
                        }

                    case "pbiEmbedInfo":
                        {
                            // token for the page's powerbi-client: the user's own Power BI token (USER) or an embed token (APP)
                            var tok = await PbiToken(cfg);
                            string ws = PStr(root, "workspaceId") ?? cfg.WorkspaceId, reportId = PStr(root, "reportId"), datasetId = PStr(root, "datasetId");
                            bool edit = PBool(root, "allowEdit");
                            string token = tok.AccessToken, type = "Aad";
                            if (cfg.Mode == "APP") { token = await PowerBiService.EmbedTokenAsync(tok, ws, reportId, datasetId, edit || string.IsNullOrEmpty(reportId)); type = "Embed"; }
                            data = new { ok = true, token, tokenType = type, expiresOn = tok.ExpiresOn.ToUnixTimeMilliseconds(), workspaceId = ws };
                            break;
                        }

                    case "pbiDetectColumns":
                        data = new { ok = true, columns = await PowerBiService.DetectColumnsAsync(PStr(root, "sql") ?? "", user) };
                        break;

                    case "pbiPublish":
                        {
                            if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can publish datasets." }; break; }
                            string key = PStr(root, "key");
                            var tok = await PbiToken(cfg);
                            var (json, row) = await PowerBiService.LoadDefinitionAsync(key, user);
                            var def = PowerBiService.ParseDef(json);
                            string ws = cfg.WorkspaceId;
                            if (string.IsNullOrEmpty(ws)) { data = new { ok = false, error = "Pick the Power BI workspace in Setup first." }; break; }
                            string existing = string.Equals(row.GetValueOrDefault("WORKSPACE_ID"), ws, StringComparison.OrdinalIgnoreCase) ? row.GetValueOrDefault("PBI_DATASET_ID") : null;
                            bool relChanged = existing != null && row.GetValueOrDefault("REL_HASH") != PowerBiService.RelHash(def);
                            var (id, note) = await PowerBiService.PublishAsync(tok, ws, def, existing, relChanged, PBool(root, "recreate"));
                            await PowerBiService.SaveStateAsync(key, user, "workspace_id = " + AiControl.Lit(ws, 60) + ", pbi_dataset_id = " + AiControl.Lit(id, 60) +
                                ", schema_hash = " + AiControl.Lit(PowerBiService.SchemaHash(def), 64) + ", rel_hash = " + AiControl.Lit(PowerBiService.RelHash(def), 64));
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "POWERBI", Action = "dataset_publish", Outcome = "OK", Ref = key, Target = def.Name, Detail = note + " (" + id + ")" });
                            data = new { ok = true, datasetId = id, note };
                            break;
                        }

                    case "pbiRefresh":
                        {
                            string key = PStr(root, "key");
                            Action<string> progress = msg =>
                            {
                                try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "pbiProgress", requestId, message = msg })); } catch { }
                            };
                            var res = await PowerBiService.RefreshStoredAsync(key, user, "MANUAL", progress);
                            data = res.Error == null ? new { ok = true, totalRows = res.TotalRows, perTable = res.PerTable } : (object)new { ok = false, error = res.Error };
                            break;
                        }

                    default:
                        data = new { ok = false, error = "Unknown action " + action };
                        break;
                }
            }
            catch (Microsoft.Identity.Client.MsalException ex)
            {
                data = new { ok = false, error = "Microsoft sign-in: " + ex.Message, signInNeeded = true };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[PowerBI] " + action + ": " + ex);
                data = new { ok = false, error = ex.Message };
            }
        done:
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "pbiResponse", requestId, data }));
        }

        /// <summary>
        /// Opens a Power BI report in its own app window (top-level page, not an iframe) - the fallback when the embedded
        /// report stays blank after signing in. Only https://*.powerbi.com.
        /// </summary>
        private async void OpenPowerBiWindow(WebView2 page, string url, string title, string requestId)
        {
            object data;
            try
            {
                if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps ||
                    !(u.Host.Equals("powerbi.com", StringComparison.OrdinalIgnoreCase) || u.Host.EndsWith(".powerbi.com", StringComparison.OrdinalIgnoreCase)))
                    throw new InvalidOperationException("Only Power BI links can be opened.");
                var f = new System.Windows.Forms.Form
                {
                    Text = string.IsNullOrWhiteSpace(title) ? "Power BI" : "Power BI - " + title, Width = 1280, Height = 820,
                    StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen, Icon = this.Icon
                };
                var wv = new WebView2 { Dock = System.Windows.Forms.DockStyle.Fill };
                f.Controls.Add(wv);
                // signed in there -> the page reloads its embedded report
                f.FormClosed += (s, a) => { try { page.CoreWebView2?.PostWebMessageAsJson("{\"action\":\"pbiSignInClosed\"}"); } catch { } };
                f.Show();
                await wv.EnsureCoreWebView2Async(await GetSharedEnvironmentAsync());
                wv.CoreWebView2.NewWindowRequested += (s, e) =>
                {
                    if (TryOpenSignInPopup(e, wv.CoreWebView2)) return;
                    e.Handled = true;
                    if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var nu) && (nu.Scheme == Uri.UriSchemeHttps || nu.Scheme == Uri.UriSchemeHttp))
                        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true }); } catch { }
                };
                wv.CoreWebView2.Navigate(u.AbsoluteUri);
                data = new { ok = true };
            }
            catch (Exception ex) { data = new { ok = false, error = ex.Message }; }
            try { PostWebViewMessage(page, JsonSerializer.Serialize(new { action = "pbiResponse", requestId, data })); } catch { }
        }

        public const string PBI_LOCAL_HOST = "grays-wms.example";

        /// <summary>
        /// pbiServeFolder: serves the app's page folder (the one holding powerbi/index.html, given as the page's own file:// URL)
        /// at https://grays-wms.example/ for this tab, so the Power BI page runs as a normal https page - an embedded Power BI
        /// report does not sign in / render inside a file:// page. pbiNavigate: back to a file:// page of that same folder
        /// (an https page may not open file:// itself).
        /// </summary>
        private void PbiLocalHost(WebView2 wv, string action, string url, string requestId)
        {
            object data;
            try
            {
                if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || !u.IsFile) throw new InvalidOperationException("Expected a file:// page URL");
                string path = System.IO.Path.GetFullPath(u.LocalPath);
                if (action == "pbiServeFolder")
                {
                    string dir = System.IO.Path.GetDirectoryName(System.IO.Path.GetDirectoryName(path));      // …\powerbi\index.html -> …
                    if (dir == null || !System.IO.File.Exists(System.IO.Path.Combine(dir, "powerbi", "index.html"))) throw new InvalidOperationException("Not the app folder");
                    wv.CoreWebView2.SetVirtualHostNameToFolderMapping(PBI_LOCAL_HOST, dir, Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);
                    _pbiServedDir = dir;
                    data = new { ok = true, baseUrl = "https://" + PBI_LOCAL_HOST + "/" };
                }
                else
                {
                    if (_pbiServedDir == null || !path.StartsWith(_pbiServedDir + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(path))
                        throw new InvalidOperationException("Only pages of the app folder");
                    wv.CoreWebView2.Navigate(u.AbsoluteUri);
                    data = new { ok = true };
                }
            }
            catch (Exception ex) { data = new { ok = false, error = ex.Message }; }
            try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "pbiResponse", requestId, data })); } catch { }
        }
        private string _pbiServedDir;

        private static readonly string[] SIGN_IN_HOSTS = { "login.microsoftonline.com", "login.microsoft.com", "login.live.com", "login.windows.net", "app.powerbi.com" };

        /// <summary>
        /// A Microsoft sign-in window opened by a page (the "Sign in" button of an embedded Power BI report) is shown as a
        /// real popup (same browser profile, window.opener kept) instead of a new tab, so the report picks up the sign-in.
        /// </summary>
        private bool TryOpenSignInPopup(Microsoft.Web.WebView2.Core.CoreWebView2NewWindowRequestedEventArgs e, Microsoft.Web.WebView2.Core.CoreWebView2 opener)
        {
            // any window opened from the Power BI page or from a Power BI page (Power BI may open it as about:blank first
            // and load the Microsoft login afterwards), or a window that opens straight on a Microsoft sign-in address
            bool fromPowerBi = false;
            try
            {
                if (opener != null && Uri.TryCreate(opener.Source, UriKind.Absolute, out var src))
                    fromPowerBi = src.Host.Equals(PBI_LOCAL_HOST, StringComparison.OrdinalIgnoreCase) || src.Host.EndsWith("powerbi.com", StringComparison.OrdinalIgnoreCase);
            }
            catch { }
            bool signInUrl = Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && SIGN_IN_HOSTS.Any(h => u.Host.Equals(h, StringComparison.OrdinalIgnoreCase));
            if (!fromPowerBi && !signInUrl) return false;
            System.Diagnostics.Debug.WriteLine("[PowerBI] popup " + (e.Uri ?? "") + " from " + (opener?.Source ?? ""));
            var deferral = e.GetDeferral();
            OpenSignInPopupAsync(e, deferral, opener);
            return true;
        }

        private async void OpenSignInPopupAsync(Microsoft.Web.WebView2.Core.CoreWebView2NewWindowRequestedEventArgs e, Microsoft.Web.WebView2.Core.CoreWebView2Deferral deferral,
            Microsoft.Web.WebView2.Core.CoreWebView2 opener)
        {
            System.Windows.Forms.Form popup = null;
            try
            {
                popup = new System.Windows.Forms.Form
                {
                    Text = "Sign in - Microsoft", Width = 520, Height = 700, StartPosition = System.Windows.Forms.FormStartPosition.CenterParent,
                    ShowInTaskbar = false, MinimizeBox = false
                };
                var wv = new WebView2 { Dock = System.Windows.Forms.DockStyle.Fill };
                popup.Controls.Add(wv);
                wv.CoreWebView2InitializationCompleted += (s, a) => { if (a.IsSuccess) wv.CoreWebView2.NewWindowRequested += (s2, e2) => TryOpenSignInPopup(e2, wv.CoreWebView2); };
                // tell the page that opened it, so an embedded report reloads with the new sign-in
                popup.FormClosed += (s, a) => { try { opener?.PostWebMessageAsJson("{\"action\":\"pbiSignInClosed\"}"); } catch { } };
                popup.Show(this);
                await wv.EnsureCoreWebView2Async(await GetSharedEnvironmentAsync());
                var f = popup;
                wv.CoreWebView2.WindowCloseRequested += (s, a) => { try { f.Close(); } catch { } };
                wv.CoreWebView2.DocumentTitleChanged += (s, a) => { try { f.Text = wv.CoreWebView2.DocumentTitle; } catch { } };
                e.NewWindow = wv.CoreWebView2;
                e.Handled = true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[PowerBI] sign-in popup: " + ex.Message);
                try { popup?.Close(); } catch { }
                e.Handled = false;
            }
            finally { deferral.Complete(); }
        }

        private static async Task<PowerBiService.Token> PbiToken(PowerBiService.Config cfg)
        {
            if (!PowerBiService.Ready(cfg)) throw new InvalidOperationException("Power BI is not set up yet (Setup tab).");
            return await PowerBiService.TokenSilentAsync(cfg) ?? throw new InvalidOperationException(cfg.Mode == "APP" ? "Save the APP-mode client secret on this PC (Setup tab)." : "Sign in to Power BI first.");
        }
    }
}

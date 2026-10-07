using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;

namespace WMSApp
{
    /// <summary>
    /// E-mail for Finance Lens board packs (finance/fin-mail.js). Three ways to send, chosen per PC in the header's
    /// e-mail setup: OUTLOOK = the Outlook desktop app on this PC (COM; opens the message for a last look, or sends it),
    /// GRAPH = Microsoft 365 / Exchange Online through Microsoft Graph (the user signs in once with MSAL in the system
    /// browser — delegated Mail.Send, token cache DPAPI-encrypted per Windows user; optional shared mailbox with
    /// Mail.Send.Shared), SMTP = an Office 365 / any SMTP account (password in SmtpVault, DPAPI).
    /// Settings hold no secret: %APPDATA%\GraysWMS\Finance\mail.json. A short send log (who, what, when) feeds the
    /// recipient suggestions.
    /// </summary>
    public static class FinanceMail
    {
        public class Settings
        {
            public string Method { get; set; } = "OUTLOOK";      // OUTLOOK | GRAPH | SMTP
            public bool OutlookSend { get; set; }                 // false = open the message in Outlook, true = send at once
            public string FromName { get; set; } = "";
            public string ReplyTo { get; set; } = "";
            public string DefaultTo { get; set; } = "";
            public string DefaultCc { get; set; } = "";
            public string Signature { get; set; } = "";           // plain text / simple HTML added under the message
            public string TenantId { get; set; } = "";            // blank = the Power BI app registration (WMS_AI_CONTROL PBI_*)
            public string ClientId { get; set; } = "";
            public string SharedMailbox { get; set; } = "";       // GRAPH: send from this mailbox (Mail.Send.Shared)
            public string SmtpServer { get; set; } = "smtp.office365.com";
            public int SmtpPort { get; set; } = 587;
            public string SmtpUser { get; set; } = "";
            public string SmtpFrom { get; set; } = "";
        }
        public class Attachment { public string Name, ContentType, Cid; public byte[] Bytes; }
        public class Message { public string To, Cc, Bcc, Subject, Html; public List<Attachment> Attachments = new List<Attachment>(); public bool Display, ReadReceipt, DeliveryReceipt; }

        private static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "Finance");
        private static string FilePath => Path.Combine(Dir, "mail.json");
        private static string LogPath => Path.Combine(Dir, "mail-log.json");
        private static readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        private const string GRAPH = "https://graph.microsoft.com/v1.0";
        private static readonly string[] SCOPES = { "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/User.Read" };
        private static readonly string[] SCOPES_READ = { "https://graph.microsoft.com/Mail.ReadBasic", "https://graph.microsoft.com/User.Read" };
        private static readonly string[] SCOPES_READ_SHARED = { "https://graph.microsoft.com/Mail.ReadBasic", "https://graph.microsoft.com/Mail.Read.Shared", "https://graph.microsoft.com/User.Read" };
        private static readonly string[] SCOPES_SHARED = { "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/Mail.Send.Shared", "https://graph.microsoft.com/User.Read" };

        public static Settings Load()
        {
            try { if (File.Exists(FilePath)) return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings(); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FinanceMail] settings unreadable: " + ex.Message); }
            return new Settings();
        }
        public static void Save(Settings s)
        {
            s.Method = (s.Method ?? "OUTLOOK").ToUpperInvariant();
            if (s.Method != "GRAPH" && s.Method != "SMTP") s.Method = "OUTLOOK";
            if (s.SmtpPort <= 0) s.SmtpPort = 587;
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(s, new JsonSerializerOptions { WriteIndented = true }));
        }

        public static bool OutlookInstalled()
        {
            try { return Type.GetTypeFromProgID("Outlook.Application") != null; } catch { return false; }
        }

        /// <summary>Settings + what works on this PC: Outlook installed, who is signed in to Microsoft 365, the SMTP account.</summary>
        public static async Task<object> StatusAsync(string user)
        {
            var s = Load();
            string account = null, appFrom = null, graphError = null;
            try
            {
                var (tenant, client, from) = await AppAsync(s, user).ConfigureAwait(false);
                appFrom = from;
                if (!string.IsNullOrWhiteSpace(client))
                {
                    var app = await PcaAsync(tenant, client).ConfigureAwait(false);
                    account = (await app.GetAccountsAsync().ConfigureAwait(false)).FirstOrDefault()?.Username;
                }
            }
            catch (Exception ex) { graphError = ex.Message; }
            return new { ok = true, settings = s, outlook = OutlookInstalled(), graphAccount = account, graphApp = appFrom, graphError, smtp = SmtpVault.Status(), recent = Recent() };
        }

        // ------------------------------------------------------------------ Microsoft 365 (Graph)
        private static IPublicClientApplication _pca;
        private static string _pcaKey;
        private static readonly SemaphoreSlim _gate = new SemaphoreSlim(1, 1);

        /// <summary>The app registration to sign in with: the mail settings, else the Power BI one.</summary>
        private static async Task<(string Tenant, string Client, string From)> AppAsync(Settings s, string user)
        {
            if (!string.IsNullOrWhiteSpace(s.ClientId)) return (string.IsNullOrWhiteSpace(s.TenantId) ? "organizations" : s.TenantId.Trim(), s.ClientId.Trim(), "mail settings");
            try
            {
                var p = await PowerBiService.ConfigAsync(user).ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(p.ClientId)) return (string.IsNullOrWhiteSpace(p.TenantId) ? "organizations" : p.TenantId.Trim(), p.ClientId.Trim(), "Power BI app registration");
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FinanceMail] Power BI settings not read: " + ex.Message); }
            return ("organizations", null, null);
        }

        private static async Task<IPublicClientApplication> PcaAsync(string tenant, string client)
        {
            string key = tenant + "|" + client;
            if (_pca != null && _pcaKey == key) return _pca;
            var app = PublicClientApplicationBuilder.Create(client)
                .WithAuthority(AzureCloudInstance.AzurePublic, tenant)
                .WithRedirectUri("http://localhost")
                .Build();
            Directory.CreateDirectory(Dir);
            var storage = new StorageCreationPropertiesBuilder("mail_" + client + ".cache", Dir).Build();
            var helper = await MsalCacheHelper.CreateAsync(storage).ConfigureAwait(false);
            helper.RegisterCache(app.UserTokenCache);
            _pca = app; _pcaKey = key;
            return app;
        }

        public static async Task<string> SignInAsync(string user, CancellationToken ct)
        {
            var s = Load();
            var (tenant, client, _) = await AppAsync(s, user).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(client)) throw new InvalidOperationException("Enter the Application (client) ID of an Azure app registration with the delegated Mail.Send permission (or set up Power BI first).");
            var app = await PcaAsync(tenant, client).ConfigureAwait(false);
            var r = await app.AcquireTokenInteractive(Scopes(s)).WithUseEmbeddedWebView(false).WithPrompt(Prompt.SelectAccount).ExecuteAsync(ct).ConfigureAwait(false);
            return r.Account?.Username;
        }

        public static async Task SignOutAsync(string user)
        {
            var (tenant, client, _) = await AppAsync(Load(), user).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(client)) return;
            var app = await PcaAsync(tenant, client).ConfigureAwait(false);
            foreach (var a in await app.GetAccountsAsync().ConfigureAwait(false)) await app.RemoveAsync(a).ConfigureAwait(false);
        }

        private static string[] Scopes(Settings s) => string.IsNullOrWhiteSpace(s.SharedMailbox) ? SCOPES : SCOPES_SHARED;

        private static async Task<(string Token, string Account)> GraphTokenAsync(Settings s, string user, string[] scopes = null, bool interactive = false, CancellationToken ct = default)
        {
            var (tenant, client, _) = await AppAsync(s, user).ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(client)) throw new InvalidOperationException("Microsoft 365 is not set up — open the e-mail setup (envelope icon in the header).");
            await _gate.WaitAsync().ConfigureAwait(false);
            try
            {
                var app = await PcaAsync(tenant, client).ConfigureAwait(false);
                var acct = (await app.GetAccountsAsync().ConfigureAwait(false)).FirstOrDefault();
                if (acct == null) throw new InvalidOperationException("Sign in to Microsoft 365 first (e-mail setup › Sign in).");
                try
                {
                    var r = await app.AcquireTokenSilent(scopes ?? Scopes(s), acct).ExecuteAsync().ConfigureAwait(false);
                    return (r.AccessToken, r.Account?.Username);
                }
                catch (MsalUiRequiredException) when (interactive)
                {   // a new permission (reading the receipts): ask once in the system browser
                    var r = await app.AcquireTokenInteractive(scopes ?? Scopes(s)).WithAccount(acct).WithUseEmbeddedWebView(false).ExecuteAsync(ct).ConfigureAwait(false);
                    return (r.AccessToken, r.Account?.Username);
                }
                catch (MsalUiRequiredException) { throw new InvalidOperationException("The Microsoft 365 sign-in has expired or needs consent — sign in again in the e-mail setup."); }
            }
            finally { _gate.Release(); }
        }

        private static JsonArray Recipients(string list) =>
            new JsonArray(Addresses(list).Select(a => (JsonNode)new JsonObject { ["emailAddress"] = new JsonObject { ["address"] = a } }).ToArray());

        private const int GRAPH_INLINE_LIMIT = 3 * 1024 * 1024;   // sendMail with attachments in the body: the request must stay under 4 MB

        private static async Task<string> GraphSendAsync(Settings s, string user, Message m, CancellationToken ct)
        {
            var (token, account) = await GraphTokenAsync(s, user).ConfigureAwait(false);
            string box = string.IsNullOrWhiteSpace(s.SharedMailbox) ? "/me" : "/users/" + Uri.EscapeDataString(s.SharedMailbox.Trim());
            var msg = new JsonObject
            {
                ["subject"] = m.Subject ?? "",
                ["body"] = new JsonObject { ["contentType"] = "HTML", ["content"] = m.Html ?? "" },
                ["toRecipients"] = Recipients(m.To),
                ["ccRecipients"] = Recipients(m.Cc),
                ["bccRecipients"] = Recipients(m.Bcc)
            };
            if (!string.IsNullOrWhiteSpace(s.ReplyTo)) msg["replyTo"] = Recipients(s.ReplyTo);
            if (m.ReadReceipt) msg["isReadReceiptRequested"] = true;
            if (m.DeliveryReceipt) msg["isDeliveryReceiptRequested"] = true;
            long total = m.Attachments.Sum(a => (long)a.Bytes.Length);
            JsonNode FileAtt(Attachment a) => new JsonObject
            {
                ["@odata.type"] = "#microsoft.graph.fileAttachment", ["name"] = a.Name, ["contentType"] = a.ContentType ?? "application/octet-stream",
                ["contentBytes"] = Convert.ToBase64String(a.Bytes), ["isInline"] = !string.IsNullOrEmpty(a.Cid), ["contentId"] = a.Cid
            };
            if (total * 4 / 3 < GRAPH_INLINE_LIMIT)
            {
                msg["attachments"] = new JsonArray(m.Attachments.Select(FileAtt).ToArray());
                await GraphAsync(HttpMethod.Post, box + "/sendMail", token, new JsonObject { ["message"] = msg, ["saveToSentItems"] = true }, ct).ConfigureAwait(false);
                return account;
            }
            // big: a draft with the small (inline) attachments, the rest through upload sessions, then send
            var small = m.Attachments.Where(a => a.Bytes.Length < 1024 * 1024 && !string.IsNullOrEmpty(a.Cid)).ToList();
            msg["attachments"] = new JsonArray(small.Select(FileAtt).ToArray());
            var draft = await GraphAsync(HttpMethod.Post, box + "/messages", token, msg, ct).ConfigureAwait(false);
            string id = draft?["id"]?.GetValue<string>() ?? throw new InvalidOperationException("Microsoft 365 did not create the draft.");
            foreach (var a in m.Attachments.Except(small))
            {
                var ses = await GraphAsync(HttpMethod.Post, box + "/messages/" + id + "/attachments/createUploadSession", token, new JsonObject
                {
                    ["AttachmentItem"] = new JsonObject { ["attachmentType"] = "file", ["name"] = a.Name, ["size"] = a.Bytes.Length, ["contentType"] = a.ContentType ?? "application/octet-stream", ["isInline"] = !string.IsNullOrEmpty(a.Cid), ["contentId"] = a.Cid }
                }, ct).ConfigureAwait(false);
                string url = ses?["uploadUrl"]?.GetValue<string>() ?? throw new InvalidOperationException("No upload session for " + a.Name);
                const int CHUNK = 320 * 1024 * 12;   // a multiple of 320 KiB, under 4 MB
                for (int off = 0; off < a.Bytes.Length; off += CHUNK)
                {
                    int n = Math.Min(CHUNK, a.Bytes.Length - off);
                    using var req = new HttpRequestMessage(HttpMethod.Put, url) { Content = new ByteArrayContent(a.Bytes, off, n) };   // the upload URL carries its own token
                    req.Content.Headers.ContentRange = new ContentRangeHeaderValue(off, off + n - 1, a.Bytes.Length);
                    using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
                    if (!res.IsSuccessStatusCode) throw new InvalidOperationException("Upload of " + a.Name + " failed: HTTP " + (int)res.StatusCode + " " + Short(await res.Content.ReadAsStringAsync().ConfigureAwait(false)));
                }
            }
            await GraphAsync(HttpMethod.Post, box + "/messages/" + id + "/send", token, null, ct).ConfigureAwait(false);
            return account;
        }

        private static async Task<JsonNode> GraphAsync(HttpMethod method, string path, string token, JsonNode body, CancellationToken ct)
        {
            using var req = new HttpRequestMessage(method, GRAPH + path);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            req.Content = new StringContent(body == null ? "" : body.ToJsonString(), Encoding.UTF8, "application/json");
            using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
            string text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            if (!res.IsSuccessStatusCode)
            {
                string why = text;
                try { why = JsonNode.Parse(text)?["error"]?["message"]?.GetValue<string>() ?? text; } catch { }
                if ((int)res.StatusCode == 403) why += " — the app registration needs the delegated permission Mail.Send" + (path.StartsWith("/users/") ? " and Mail.Send.Shared (plus Send As / Send on behalf rights on that mailbox)" : "") + ", granted by an admin if your tenant asks for it.";
                throw new InvalidOperationException("Microsoft 365: HTTP " + (int)res.StatusCode + " " + Short(why));
            }
            if (string.IsNullOrWhiteSpace(text)) return null;
            try { return JsonNode.Parse(text); } catch { return null; }
        }

        // ------------------------------------------------------------------ Outlook desktop (COM)
        private static string OutlookSend(Settings s, Message m)
        {
            Type t = Type.GetTypeFromProgID("Outlook.Application") ?? throw new InvalidOperationException("Outlook (desktop) is not installed on this PC — choose Microsoft 365 or SMTP in the e-mail setup.");
            string dir = Path.Combine(Path.GetTempPath(), "GraysWMS", "FinanceMail", DateTime.Now.ToString("yyyyMMdd_HHmmss_fff"));
            Directory.CreateDirectory(dir);
            dynamic app = Activator.CreateInstance(t);
            dynamic mail = app.CreateItem(0);                 // olMailItem
            mail.To = string.Join("; ", Addresses(m.To));
            mail.CC = string.Join("; ", Addresses(m.Cc));
            mail.BCC = string.Join("; ", Addresses(m.Bcc));
            mail.Subject = m.Subject ?? "";
            foreach (var a in m.Attachments)
            {
                string path = Path.Combine(dir, SafeName(a.Name));
                File.WriteAllBytes(path, a.Bytes);
                dynamic att = mail.Attachments.Add(path);
                if (!string.IsNullOrEmpty(a.Cid)) att.PropertyAccessor.SetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001F", a.Cid);   // PR_ATTACH_CONTENT_ID → inline picture
            }
            if (!string.IsNullOrWhiteSpace(s.ReplyTo)) foreach (var r in Addresses(s.ReplyTo)) mail.ReplyRecipients.Add(r);
            mail.HTMLBody = m.Html ?? "";
            if (m.ReadReceipt) mail.ReadReceiptRequested = true;
            if (m.DeliveryReceipt) mail.OriginatorDeliveryReportRequested = true;
            bool send = s.OutlookSend && !m.Display;
            if (send) mail.Send(); else mail.Display(false);
            return send ? "sent" : "draft";
        }

        // ------------------------------------------------------------------ SMTP (Office 365 or any)
        private static async Task<string> SmtpSendAsync(Settings s, Message m, CancellationToken ct)
        {
            var st = SmtpVault.Status();
            var json = JsonSerializer.SerializeToNode(st);
            string server = string.IsNullOrWhiteSpace(s.SmtpServer) ? json?["server"]?.GetValue<string>() ?? "smtp.office365.com" : s.SmtpServer.Trim();
            int port = s.SmtpPort > 0 ? s.SmtpPort : 587;
            string login = string.IsNullOrWhiteSpace(s.SmtpUser) ? json?["username"]?.GetValue<string>() : s.SmtpUser.Trim();
            if (string.IsNullOrWhiteSpace(login)) throw new InvalidOperationException("The SMTP account is not set up — open the e-mail setup (envelope icon in the header).");
            string pw = SmtpVault.PasswordFor(login) ?? throw new InvalidOperationException("No saved SMTP password for " + login + " — enter it in the e-mail setup.");
            string from = string.IsNullOrWhiteSpace(s.SmtpFrom) ? login : s.SmtpFrom.Trim();
            using var client = new System.Net.Mail.SmtpClient(server, port) { EnableSsl = true, Credentials = new System.Net.NetworkCredential(login, pw), Timeout = 120000 };
            using var msg = new System.Net.Mail.MailMessage { From = new System.Net.Mail.MailAddress(from, string.IsNullOrWhiteSpace(s.FromName) ? null : s.FromName.Trim()), Subject = m.Subject ?? "", SubjectEncoding = Encoding.UTF8, BodyEncoding = Encoding.UTF8 };
            foreach (var a in Addresses(m.To)) msg.To.Add(a);
            foreach (var a in Addresses(m.Cc)) msg.CC.Add(a);
            foreach (var a in Addresses(m.Bcc)) msg.Bcc.Add(a);
            foreach (var a in Addresses(s.ReplyTo)) msg.ReplyToList.Add(a);
            if (m.ReadReceipt) msg.Headers.Add("Disposition-Notification-To", from);
            if (m.DeliveryReceipt) msg.DeliveryNotificationOptions = System.Net.Mail.DeliveryNotificationOptions.OnSuccess | System.Net.Mail.DeliveryNotificationOptions.OnFailure;
            var view = System.Net.Mail.AlternateView.CreateAlternateViewFromString(m.Html ?? "", Encoding.UTF8, "text/html");
            var streams = new List<Stream>();
            try
            {
                foreach (var a in m.Attachments)
                {
                    var ms = new MemoryStream(a.Bytes); streams.Add(ms);
                    if (!string.IsNullOrEmpty(a.Cid)) view.LinkedResources.Add(new System.Net.Mail.LinkedResource(ms, a.ContentType ?? "image/png") { ContentId = a.Cid });
                    else msg.Attachments.Add(new System.Net.Mail.Attachment(ms, SafeName(a.Name), a.ContentType ?? "application/octet-stream"));
                }
                msg.AlternateViews.Add(view);
                await client.SendMailAsync(msg, ct).ConfigureAwait(false);
            }
            finally { foreach (var x in streams) x.Dispose(); }
            return from;
        }

        // ------------------------------------------------------------------ send
        /// <summary>Sends (or opens in Outlook) one message the way the settings say, or the method given.</summary>
        public static async Task<object> SendAsync(string user, Message m, string method, CancellationToken ct)
        {
            var s = Load();
            string how = string.IsNullOrWhiteSpace(method) ? s.Method : method.Trim().ToUpperInvariant();
            if (!Addresses(m.To).Any() && !(how == "OUTLOOK" && (m.Display || !s.OutlookSend))) throw new InvalidOperationException("Add at least one recipient (To).");
            if (Addresses(m.To).Count + Addresses(m.Cc).Count + Addresses(m.Bcc).Count > 100) throw new InvalidOperationException("At most 100 recipients per message.");
            if (m.Attachments.Sum(a => (long)a.Bytes.Length) > 30L * 1024 * 1024) throw new InvalidOperationException("The attachments are larger than 30 MB.");
            if (!string.IsNullOrWhiteSpace(s.Signature)) m.Html = AddSignature(m.Html, s.Signature);
            string result, by;
            if (how == "GRAPH") { by = await GraphSendAsync(s, user, m, ct).ConfigureAwait(false); result = "sent"; }
            else if (how == "SMTP") { by = await SmtpSendAsync(s, m, ct).ConfigureAwait(false); result = "sent"; }
            else { result = OutlookSend(s, m); by = "Outlook"; }
            Log(m, how, result);
            return new { ok = true, via = how, result, by };
        }

        /// <summary>A small test message to the account itself (Outlook: opened, not sent).</summary>
        public static Task<object> TestAsync(string user, string method, string to, CancellationToken ct)
        {
            var m = new Message
            {
                To = to, Subject = "Finance Lens — e-mail test",
                Html = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a\"><p>This is a test from <b>Finance Lens</b> on " + System.Net.WebUtility.HtmlEncode(Environment.MachineName) +
                       ".</p><p>Board packs will be sent this way.</p></div>",
                Display = true
            };
            return SendAsync(user, m, method, ct);
        }

        // ------------------------------------------------------------------ receipts
        public class Receipt { public string Kind { get; set; } public string Email { get; set; } public string Subject { get; set; } public string At { get; set; } public string Detail { get; set; } }
        private static readonly (string Prefix, string Kind)[] PREFIXES =
        {
            ("Read:", "READ"), ("Not read:", "NOT_READ"), ("Delivered:", "DELIVERED"), ("Relayed:", "DELIVERED"),
            ("Undeliverable:", "BOUNCED"), ("Delivery has failed", "BOUNCED"), ("Mail delivery failed", "BOUNCED"), ("Delivery Status Notification (Failure)", "BOUNCED"), ("Returned mail", "BOUNCED")
        };
        /// <summary>The kind of report a subject is (READ / NOT_READ / DELIVERED / BOUNCED) and the original subject, or null</summary>
        private static (string Kind, string Orig)? ReportOf(string subject)
        {
            if (string.IsNullOrWhiteSpace(subject)) return null;
            string t = subject.Trim();
            foreach (var (p, k) in PREFIXES)
                if (t.StartsWith(p, StringComparison.OrdinalIgnoreCase)) return (k, t.Substring(p.Length).Trim().TrimStart(':', '-').Trim());
            return null;
        }
        private static string Matching(string orig, IReadOnlyCollection<string> subjects)
        {
            if (string.IsNullOrEmpty(orig)) return null;
            return subjects.FirstOrDefault(x => string.Equals(x?.Trim(), orig, StringComparison.OrdinalIgnoreCase))
                ?? subjects.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x) && orig.IndexOf(x.Trim(), StringComparison.OrdinalIgnoreCase) >= 0);
        }
        private static string AddressIn(string from, string text, IReadOnlyCollection<string> addresses)
        {
            if (!string.IsNullOrWhiteSpace(from)) { var hit = addresses.FirstOrDefault(a => string.Equals(a, from.Trim(), StringComparison.OrdinalIgnoreCase)); if (hit != null) return hit; }
            if (string.IsNullOrEmpty(text)) return null;
            return addresses.FirstOrDefault(a => text.IndexOf(a, StringComparison.OrdinalIgnoreCase) >= 0);
        }

        /// <summary>
        /// Read / delivery receipts and bounces that came back to the sending mailbox for the given subjects and addresses
        /// (Microsoft 365: Graph with Mail.ReadBasic, asked for once in the browser; Outlook: the Inbox of the Outlook profile).
        /// SMTP has no mailbox to read — its receipts arrive in that mailbox, read them there.
        /// </summary>
        public static async Task<object> ReceiptsAsync(string user, string method, DateTime since, List<string> subjects, List<string> addresses, CancellationToken ct)
        {
            var s = Load();
            string how = string.IsNullOrWhiteSpace(method) ? s.Method : method.Trim().ToUpperInvariant();
            var found = new List<Receipt>();
            int scanned = 0;
            if (how == "GRAPH")
            {
                var (token, account) = await GraphTokenAsync(s, user, string.IsNullOrWhiteSpace(s.SharedMailbox) ? SCOPES_READ : SCOPES_READ_SHARED, true, ct).ConfigureAwait(false);
                string box = string.IsNullOrWhiteSpace(s.SharedMailbox) ? "/me" : "/users/" + Uri.EscapeDataString(s.SharedMailbox.Trim());
                string path = box + "/mailFolders/inbox/messages?$select=subject,from,receivedDateTime,bodyPreview&$top=100&$orderby=receivedDateTime desc&$filter=receivedDateTime ge " +
                              since.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");
                for (int page = 0; page < 15 && path != null; page++)
                {
                    var j = await GraphAsync(HttpMethod.Get, path, token, null, ct).ConfigureAwait(false);
                    foreach (var it in (j?["value"] as JsonArray) ?? new JsonArray())
                    {
                        scanned++;
                        var rep = ReportOf(it?["subject"]?.GetValue<string>());
                        if (rep == null) continue;
                        string subj = Matching(rep.Value.Orig, subjects); if (subj == null) continue;
                        string from = it?["from"]?["emailAddress"]?["address"]?.GetValue<string>(), prev = it?["bodyPreview"]?.GetValue<string>() ?? "";
                        string email = AddressIn(rep.Value.Kind == "READ" || rep.Value.Kind == "NOT_READ" ? from : null, prev, addresses);
                        if (email == null) continue;
                        found.Add(new Receipt { Kind = rep.Value.Kind, Email = email, Subject = subj, At = it?["receivedDateTime"]?.GetValue<string>(), Detail = rep.Value.Kind == "BOUNCED" ? Short(prev) : null });
                    }
                    string next = j?["@odata.nextLink"]?.GetValue<string>();
                    path = next == null ? null : next.Substring(GRAPH.Length);
                }
                return new { ok = true, via = how, mailbox = string.IsNullOrWhiteSpace(s.SharedMailbox) ? account : s.SharedMailbox, scanned, receipts = found };
            }
            if (how == "OUTLOOK")
            {
                var (list, seen) = await Task.Run(() => OutlookReceipts(since, subjects, addresses), ct).ConfigureAwait(false);
                return new { ok = true, via = how, mailbox = "Outlook", scanned = seen, receipts = list };
            }
            return new { ok = false, via = how, error = "SMTP sends have no mailbox the app can read — the receipts arrive in " + (string.IsNullOrWhiteSpace(s.SmtpFrom) ? s.SmtpUser : s.SmtpFrom) + ". Use Microsoft 365 or Outlook to collect them automatically; opens and confirmations are still tracked." };
        }

        private static (List<Receipt>, int) OutlookReceipts(DateTime since, List<string> subjects, List<string> addresses)
        {
            var found = new List<Receipt>();
            int scanned = 0;
            Type t = Type.GetTypeFromProgID("Outlook.Application") ?? throw new InvalidOperationException("Outlook (desktop) is not installed on this PC.");
            dynamic app = Activator.CreateInstance(t);
            dynamic inbox = app.GetNamespace("MAPI").GetDefaultFolder(6);   // olFolderInbox
            dynamic items = inbox.Items;
            items.Sort("[ReceivedTime]", true);
            int n = 0;
            foreach (dynamic it in items)
            {
                if (++n > 3000) break;
                try
                {
                    DateTime at; try { at = (DateTime)it.ReceivedTime; } catch { at = (DateTime)it.CreationTime; }
                    if (at < since) break;
                    scanned++;
                    string cls = "", subject = (string)it.Subject;
                    try { cls = (string)it.MessageClass ?? ""; } catch { }
                    string kind = cls.StartsWith("REPORT.IPM.Note.IPNRN", StringComparison.OrdinalIgnoreCase) ? "READ"
                        : cls.StartsWith("REPORT.IPM.Note.IPNNRN", StringComparison.OrdinalIgnoreCase) ? "NOT_READ"
                        : cls.StartsWith("REPORT.IPM.Note.DR", StringComparison.OrdinalIgnoreCase) ? "DELIVERED"
                        : cls.StartsWith("REPORT.IPM.Note.NDR", StringComparison.OrdinalIgnoreCase) ? "BOUNCED" : null;
                    var rep = ReportOf(subject);
                    if (kind == null && rep == null) continue;
                    kind ??= rep.Value.Kind;
                    string subj = Matching(rep?.Orig ?? subject, subjects); if (subj == null) continue;
                    string body = ""; try { body = (string)it.Body ?? ""; } catch { }
                    string from = null; try { from = (string)it.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x0C1F001F"); } catch { }
                    string email = AddressIn(kind == "READ" || kind == "NOT_READ" ? from : null, body, addresses);
                    if (email == null) continue;
                    found.Add(new Receipt { Kind = kind, Email = email, Subject = subj, At = at.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), Detail = kind == "BOUNCED" ? Short(body) : null });
                }
                catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FinanceMail] receipt item: " + ex.Message); }
            }
            return (found, scanned);
        }

        // ------------------------------------------------------------------ helpers
        public static List<string> Addresses(string list)
        {
            var out1 = new List<string>();
            foreach (var p in (list ?? "").Split(new[] { ';', ',', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string a = p.Trim(); if (a.Length == 0) continue;
                try { var ma = new System.Net.Mail.MailAddress(a); if (!out1.Contains(ma.Address, StringComparer.OrdinalIgnoreCase)) out1.Add(ma.Address); }
                catch { throw new InvalidOperationException("Not an e-mail address: " + a); }
            }
            return out1;
        }
        private static string AddSignature(string html, string sig)
        {
            string block = sig.Contains('<') ? sig : System.Net.WebUtility.HtmlEncode(sig).Replace("\n", "<br>");
            block = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#334155;margin-top:18px\">" + block + "</div>";
            int i = (html ?? "").LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
            return i >= 0 ? html.Insert(i, block) : (html ?? "") + block;
        }
        private static string SafeName(string n)
        {
            n = string.Join("_", (Path.GetFileName(n ?? "") ?? "").Split(Path.GetInvalidFileNameChars()));
            return string.IsNullOrWhiteSpace(n) ? "attachment.bin" : n;
        }
        private static string Short(string s) => s == null ? "" : s.Length > 400 ? s.Substring(0, 400) + "…" : s;

        private class LogRow { public string At { get; set; } public string Via { get; set; } public string Result { get; set; } public string Subject { get; set; } public string To { get; set; } public string Cc { get; set; } }
        private static void Log(Message m, string via, string result)
        {
            try
            {
                var rows = File.Exists(LogPath) ? JsonSerializer.Deserialize<List<LogRow>>(File.ReadAllText(LogPath)) ?? new List<LogRow>() : new List<LogRow>();
                rows.Insert(0, new LogRow { At = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), Via = via, Result = result, Subject = m.Subject, To = string.Join("; ", Addresses(m.To)), Cc = string.Join("; ", Addresses(m.Cc)) });
                Directory.CreateDirectory(Dir);
                File.WriteAllText(LogPath, JsonSerializer.Serialize(rows.Take(60).ToList()));
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[FinanceMail] log: " + ex.Message); }
        }
        public static object Recent()
        {
            try { return File.Exists(LogPath) ? JsonSerializer.Deserialize<List<LogRow>>(File.ReadAllText(LogPath)) : new List<LogRow>(); }
            catch { return new List<LogRow>(); }
        }

        public static Message FromJson(JsonElement root)
        {
            string S(JsonElement e, string k) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            bool B(string k) => root.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
            var m = new Message { To = S(root, "to"), Cc = S(root, "cc"), Bcc = S(root, "bcc"), Subject = S(root, "subject"), Html = S(root, "html"), Display = B("display"), ReadReceipt = B("readReceipt"), DeliveryReceipt = B("deliveryReceipt") };
            if (m.Subject != null && m.Subject.Length > 250) m.Subject = m.Subject.Substring(0, 250);
            if (root.TryGetProperty("attachments", out var atts) && atts.ValueKind == JsonValueKind.Array)
                foreach (var a in atts.EnumerateArray())
                {
                    string b64 = S(a, "base64"); if (string.IsNullOrEmpty(b64)) continue;
                    m.Attachments.Add(new Attachment { Name = SafeName(S(a, "name")), ContentType = S(a, "contentType"), Cid = S(a, "cid"), Bytes = Convert.FromBase64String(b64) });
                }
            return m;
        }
    }
}

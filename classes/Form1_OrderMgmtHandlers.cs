using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Xml.Linq;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Order Management module (om/index.html) — om* IPC actions. Fusion credentials stay in C#:
    ///   omBip      run a BI Publisher report (/Custom/…xdo) with named parameters → data rows (lookups: customers, price lists, credit …)
    ///   omPdf      run a report as PDF (print layouts) → saved under C:\fusion\OM\{instance}\ + base64 for the page
    ///   omOpenFile open a PDF saved by omPdf
    ///   omRest     Fusion REST on salesOrdersForOrderHub only (GET / POST / PATCH; DELETE only on one order = a draft)
    ///   omMra      MRA e-invoicing for one Fusion order (MRAProcessor, the same code as the WMS MRA button), progress omProgress
    ///   omAiParse  Claude reads a pasted e-mail / text into order lines from a candidate item list (no tools, kill switch, audited)
    /// Replies: { action: "omResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        private const string OM_ROOT = @"C:\fusion\OM";
        private static readonly string[] OmRestResources = { "salesOrdersForOrderHub" };

        private static bool IsOrderMgmtAction(string action) =>
            action != null && action.Length > 2 && action.StartsWith("om", StringComparison.Ordinal) && char.IsUpper(action[2]);

        private static string OmStr(JsonElement r, string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        private static string OmInstance(JsonElement r) => string.Equals(OmStr(r, "instance"), "TEST", StringComparison.OrdinalIgnoreCase) ? "TEST" : "PROD";
        private static string OmUser(JsonElement r)
        {
            string u = OmStr(r, "appUser");
            return string.IsNullOrWhiteSpace(u) || u.Equals("UNKNOWN", StringComparison.OrdinalIgnoreCase) ? Environment.UserName : u.Trim();
        }

        private async Task HandleOrderMgmtAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                switch (action)
                {
                    case "omBip":
                        data = await OmBipAsync(OmStr(root, "path"), OmParams(root), OmInstance(root), false, null);
                        break;
                    case "omPdf":
                        data = await OmBipAsync(OmStr(root, "path"), OmParams(root), OmInstance(root), true, OmStr(root, "fileName"));
                        break;
                    case "omOpenFile":
                        {
                            string p = OmSafePath(OmStr(root, "path"));
                            if (p == null || !File.Exists(p)) { data = new { ok = false, error = "The file is no longer on this PC." }; break; }
                            Process.Start(new ProcessStartInfo(p) { UseShellExecute = true });
                            data = new { ok = true };
                            break;
                        }
                    case "omRest":
                        data = await OmRestAsync(OmStr(root, "method"), OmStr(root, "resource"), OmStr(root, "key"), OmStr(root, "body"), OmStr(root, "version"), OmStr(root, "query"), OmInstance(root));
                        break;
                    case "omMra":
                        data = await OmMraAsync(wv, requestId, OmStr(root, "orderNumber"), OmInstance(root), OmUser(root));
                        break;
                    case "omAiParse":
                        data = await OmAiParseAsync(root, OmUser(root));
                        break;
                    default:
                        data = new { ok = false, error = "Unknown Order Management action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[OM] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "omResponse", requestId, data }));
        }

        private static Dictionary<string, string> OmParams(JsonElement root)
        {
            var d = new Dictionary<string, string>();
            if (root.TryGetProperty("params", out var p) && p.ValueKind == JsonValueKind.Object)
                foreach (var kv in p.EnumerateObject())
                    if (!string.IsNullOrWhiteSpace(kv.Name) && d.Count < 30)
                        d[kv.Name] = kv.Value.ValueKind == JsonValueKind.String ? kv.Value.GetString() : kv.Value.ValueKind == JsonValueKind.Null ? "" : kv.Value.ToString();
            return d;
        }

        private static string OmSafePath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            string full = Path.GetFullPath(path);
            return full.StartsWith(Path.GetFullPath(OM_ROOT) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? full : null;
        }

        // ── BI Publisher ────────────────────────────────────────────
        private static HttpClient _omHttp;
        private static HttpClient OmHttp() => _omHttp ??= new HttpClient { Timeout = TimeSpan.FromMinutes(4) };

        private static async Task<object> OmBipAsync(string path, Dictionary<string, string> prms, string instance, bool pdf, string fileName)
        {
            var r = await BipRunBytesAsync(path, prms, instance, pdf ? "pdf" : "xml");
            if (r.Error != null) return new { ok = false, error = r.Error, ms = r.Ms };
            if (pdf)
            {
                string inst = Path.Combine(OM_ROOT, instance);
                Directory.CreateDirectory(inst);
                string safe = Regex.Replace(fileName ?? "order", @"[^A-Za-z0-9_\-]+", "_");
                if (safe.Length > 120) safe = safe.Substring(0, 120);
                string file = Path.Combine(inst, safe + ".pdf");
                File.WriteAllBytes(file, r.Bytes);
                return new { ok = true, base64 = Convert.ToBase64String(r.Bytes), path = file, ms = r.Ms };
            }
            string xml = Encoding.UTF8.GetString(r.Bytes);
            var rows = OmXmlRows(xml);
            return new { ok = true, rows, count = rows.Count, ms = r.Ms };
        }

        /// <summary>Runs one BI Publisher report (/Custom/…xdo) with named parameters in the given format (pdf | xml | csv …) → the output bytes,
        /// or an error in plain words. Shared by Order Management and Debtors Control; the Fusion credentials never leave the host.</summary>
        internal static async Task<(byte[] Bytes, string Error, long Ms)> BipRunBytesAsync(string path, Dictionary<string, string> prms, string instance, string format)
        {
            path = (path ?? "").Trim();
            if (!path.StartsWith("/")) path = "/" + path;
            if (!Regex.IsMatch(path, @"^/Custom/[^<>&""]+\.xdo$", RegexOptions.IgnoreCase) || path.Contains(".."))
                return (null, "Only BI Publisher reports under /Custom/ (…xdo) can be run.", 0);
            if (!Regex.IsMatch(format ?? "", "^[a-z]{2,8}$")) format = "pdf";
            var (user, pass) = await FusionCredentialsService.GetAsync();
            if (string.IsNullOrEmpty(user)) return (null, "Oracle Fusion credentials are not available.", 0);

            var items = new StringBuilder();
            foreach (var kv in prms ?? new Dictionary<string, string>())
                items.Append("<v2:item><v2:name>").Append(System.Security.SecurityElement.Escape(kv.Key)).Append("</v2:name><v2:values><v2:item>")
                     .Append(System.Security.SecurityElement.Escape(kv.Value ?? "")).Append("</v2:item></v2:values></v2:item>");
            string soap = "<?xml version=\"1.0\" encoding=\"utf-8\"?><soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:v2=\"http://xmlns.oracle.com/oxp/service/v2\">" +
                "<soapenv:Header/><soapenv:Body><v2:runReport><v2:reportRequest><v2:attributeFormat>" + format + "</v2:attributeFormat>" +
                "<v2:parameterNameValues><v2:listOfParamNameValues>" + items + "</v2:listOfParamNameValues></v2:parameterNameValues>" +
                "<v2:reportAbsolutePath>" + System.Security.SecurityElement.Escape(path) + "</v2:reportAbsolutePath><v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload></v2:reportRequest>" +
                "<v2:userID>" + System.Security.SecurityElement.Escape(user) + "</v2:userID><v2:password>" + System.Security.SecurityElement.Escape(pass) + "</v2:password></v2:runReport></soapenv:Body></soapenv:Envelope>";
            var sw = Stopwatch.StartNew();
            string text;
            try
            {
                using var content = new StringContent(soap, Encoding.UTF8, "text/xml");
                content.Headers.Add("SOAPAction", "\"runReport\"");
                using var res = await OmHttp().PostAsync(instance == "TEST" ? WMSApp.PrintManagement.FusionPdfDownloader.TEST_URL : WMSApp.PrintManagement.FusionPdfDownloader.PROD_URL, content);
                text = await res.Content.ReadAsStringAsync();
                if (!res.IsSuccessStatusCode)
                {
                    var fault = Regex.Match(text, @"<faultstring>([\s\S]*?)</faultstring>");
                    return (null, "Report " + path + ": " + (fault.Success ? System.Net.WebUtility.HtmlDecode(fault.Groups[1].Value).Trim() : "HTTP " + (int)res.StatusCode), sw.ElapsedMilliseconds);
                }
            }
            catch (TaskCanceledException) { return (null, "The report did not answer within 4 minutes: " + path, sw.ElapsedMilliseconds); }
            catch (HttpRequestException ex) { return (null, "Could not reach Fusion: " + ex.Message, sw.ElapsedMilliseconds); }

            var m = Regex.Match(text, @"<(?:\w+:)?reportBytes>([\s\S]*?)</(?:\w+:)?reportBytes>");
            if (!m.Success) return (null, "The report returned no data: " + path, sw.ElapsedMilliseconds);
            byte[] bytes;
            try { bytes = Convert.FromBase64String(Regex.Replace(m.Groups[1].Value, @"\s+", "")); }
            catch (FormatException) { return (null, "The report answer could not be read: " + path, sw.ElapsedMilliseconds); }
            return (bytes, null, sw.ElapsedMilliseconds);
        }

        /// <summary>BI Publisher data XML → rows: the most repeated element whose children are all leaves (G_1, ROW …).</summary>
        private static List<Dictionary<string, string>> OmXmlRows(string xml)
        {
            var rows = new List<Dictionary<string, string>>();
            if (string.IsNullOrWhiteSpace(xml)) return rows;
            XDocument doc;
            try { doc = XDocument.Parse(xml); } catch (Exception ex) { Debug.WriteLine("[OM] report XML: " + ex.Message); return rows; }
            var groups = doc.Descendants().Where(e => e.HasElements && e.Elements().All(c => !c.HasElements))
                .GroupBy(e => e.Name.LocalName).OrderByDescending(g => g.Count()).ThenByDescending(g => g.First().Ancestors().Count()).ToList();
            if (groups.Count == 0) return rows;
            foreach (var e in groups[0])
            {
                var r = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var c in e.Elements()) r[c.Name.LocalName.ToUpperInvariant()] = c.Value?.Trim() ?? "";
                rows.Add(r);
                if (rows.Count >= 200000) break;
            }
            return rows;
        }

        // ── Fusion REST: sales orders ───────────────────────────────
        private static string OmFusionBase(string instance) =>
            new Uri(instance == "TEST" ? WMSApp.PrintManagement.FusionPdfDownloader.TEST_URL : WMSApp.PrintManagement.FusionPdfDownloader.PROD_URL).GetLeftPart(UriPartial.Authority);

        private async Task<object> OmRestAsync(string method, string resource, string key, string body, string version, string query, string instance)
        {
            method = (method ?? "GET").ToUpperInvariant();
            if (!OmRestResources.Contains(resource)) return new { ok = false, error = "Only " + string.Join(", ", OmRestResources) + " can be called from Order Management." };
            if (string.IsNullOrWhiteSpace(version) || !Regex.IsMatch(version, @"^\d{1,2}(\.\d{1,2}){2,3}$")) version = "11.13.18.05";
            if (!string.IsNullOrEmpty(key) && !Regex.IsMatch(key, @"^[0-9]{1,20}$")) return new { ok = false, error = "Bad order key." };
            if (!string.IsNullOrEmpty(query) && !Regex.IsMatch(query, @"^[A-Za-z0-9_=&;,.'%\- :]{1,400}$")) return new { ok = false, error = "Bad query." };
            string url = OmFusionBase(instance) + "/fscmRestApi/resources/" + version + "/" + resource + (string.IsNullOrEmpty(key) ? "" : "/" + key) +
                         (string.IsNullOrEmpty(query) ? "" : "?" + query);
            if (method == "GET" || method == "POST" || method == "PATCH")
            {
                if (method == "PATCH" && string.IsNullOrEmpty(key)) return new { ok = false, error = "PATCH needs one order." };
                return await FusionRestAsync(method, url, body, null);
            }
            if (method != "DELETE" || string.IsNullOrEmpty(key)) return new { ok = false, error = "Only GET, POST, PATCH and DELETE of one draft order are allowed." };
            var (user, pass) = await FusionCredentialsService.GetAsync();
            if (string.IsNullOrEmpty(user)) return new { ok = false, error = "Oracle Fusion credentials are not available." };
            using var req = new HttpRequestMessage(HttpMethod.Delete, url);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(user + ":" + pass)));
            req.Headers.Accept.ParseAdd("application/json");
            try
            {
                using var res = await OmHttp().SendAsync(req);
                return new { ok = true, status = (int)res.StatusCode, body = await res.Content.ReadAsStringAsync() };
            }
            catch (Exception ex) { return new { ok = false, error = "Could not reach Fusion: " + ex.Message }; }
        }

        // ── MRA ─────────────────────────────────────────────────────
        private async Task<object> OmMraAsync(WebView2 wv, string requestId, string order, string instance, string user)
        {
            if (string.IsNullOrWhiteSpace(order) || !Regex.IsMatch(order, @"^[A-Za-z0-9_\-]{1,40}$")) return new { ok = false, error = "Bad order number." };
            var (fusionUser, fusionPass) = await FusionCredentialsService.GetAsync();
            if (string.IsNullOrEmpty(fusionUser)) return new { ok = false, error = "Oracle Fusion credentials are not available." };
            void Progress(string msg)
            {
                try { PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "omProgress", requestId, message = msg })); } catch { }
            }
            var sw = Stopwatch.StartNew();
            var processor = new WMSApp.MRA.MRAProcessor(fusionUser, fusionPass, instance) { Source = "ORDER_MGMT", AppUser = user };
            var r = await processor.ProcessMRAInterfaceAsync(order, (msg, step) => Progress(msg));
            string status = r.Success ? "INTERFACED"
                : r.Skipped ? "NOT_REQUIRED"
                : (r.Message ?? "").IndexOf("already done", StringComparison.OrdinalIgnoreCase) >= 0 ? "ALREADY_DONE"
                : "FAILED";
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "OM", Action = "mra_interface", Outcome = status == "FAILED" ? "ERROR" : "OK", Instance = instance, Ref = order, Detail = status + " " + r.Message, DurationMs = sw.ElapsedMilliseconds });
            return new
            {
                ok = true, status, irn = r.IrnCode, headerId = r.HeaderId, step = r.CurrentStep.ToString(), message = r.Message,
                details = string.IsNullOrEmpty(r.ErrorDetails) ? null : (r.ErrorDetails.Length > 600 ? r.ErrorDetails.Substring(0, 600) : r.ErrorDetails)
            };
        }

        // ── Claude: text → order lines ──────────────────────────────
        private const string OM_PARSE_PROMPT =
@"You turn a customer's order text (an e-mail, a chat message, a PDF copied as text) into sales order lines.
You get the TEXT and a CATALOG of candidate items (item number, description, unit of measure, barcode) from the price list.
Rules:
- Only use item numbers that are in the CATALOG. If a request cannot be matched with confidence, put the text in ""unmatched"" - never guess between two different products.
- qty is the number of units in the item's unit of measure. If the text gives cases/packs and the catalog item is sold per case, use the number of cases.
- type: ORD for normal ordered goods; RET for goods the customer returns (e.g. ""return"", ""send back"", ""damaged""); otherwise the MODE given.
- Ignore greetings, signatures, addresses and prices.
Reply with ONE JSON object and nothing else:
{""lines"":[{""item"":""CODE"",""qty"":1,""type"":""ORD"",""text"":""the words you read this from""}],""unmatched"":[""text you could not match""],""note"":""one short sentence for the user (optional)""}";

        private async Task<object> OmAiParseAsync(JsonElement root, string user)
        {
            string text = OmStr(root, "text") ?? "";
            if (text.Trim().Length == 0) return new { ok = false, error = "No text." };
            if (text.Length > 20000) text = text.Substring(0, 20000);
            if (!await AiControl.IsEnabledAsync(user)) return new { ok = false, error = "The AI is paused (AI Digital Employee › Control)." };
            string key = WMSApp.FusionSql.FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key)) return new { ok = false, error = "No Claude API key saved (Fusion SQL › Ask AI › gear)." };
            string catalog = root.TryGetProperty("catalog", out var c) && c.ValueKind == JsonValueKind.Array ? c.GetRawText() : "[]";
            if (catalog.Length > 60000) catalog = catalog.Substring(0, 60000);
            string mode = OmStr(root, "mode") ?? "ORD";
            string model = WMSApp.FusionSql.FusionSqlStore.LoadConfig().AiModel;
            if (string.IsNullOrWhiteSpace(model)) model = "claude-opus-5";
            var sw = Stopwatch.StartNew();
            var client = new AnthropicClient { ApiKey = key };
            var resp = await client.Messages.Create(new MessageCreateParams
            {
                Model = model,
                MaxTokens = 8000,
                System = OM_PARSE_PROMPT,
                Messages = new List<MessageParam> { new MessageParam { Role = Role.User, Content = "MODE: " + mode + "\nCATALOG:\n" + catalog + "\n\nTEXT:\n" + text } },
            });
            var answer = new StringBuilder();
            foreach (ContentBlock block in resp.Content)
                if (block.TryPickText(out TextBlock t)) answer.Append(t.Text);
            long tin = resp.Usage == null ? 0 : Convert.ToInt64(resp.Usage.InputTokens), tout = resp.Usage == null ? 0 : Convert.ToInt64(resp.Usage.OutputTokens);
            double? cost = null;
            try { cost = await AiControl.CostAsync(model, tin, tout, 0, 0, user); } catch { }
            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "OM", Action = "om_ai_parse", Outcome = "OK", Model = model, TokensIn = tin, TokensOut = tout, CostUsd = cost, DurationMs = sw.ElapsedMilliseconds, Detail = "smart paste, " + text.Length + " chars" });
            string s = answer.ToString();
            int a = s.IndexOf('{'), b = s.LastIndexOf('}');
            if (a < 0 || b <= a) return new { ok = false, error = "Claude did not return order lines." };
            try
            {
                using var doc = JsonDocument.Parse(s.Substring(a, b - a + 1));
                var lines = new List<object>();
                if (doc.RootElement.TryGetProperty("lines", out var ls) && ls.ValueKind == JsonValueKind.Array)
                    foreach (var l in ls.EnumerateArray())
                    {
                        string item = l.TryGetProperty("item", out var i) ? i.ToString() : null;
                        double qty = l.TryGetProperty("qty", out var q) && q.ValueKind == JsonValueKind.Number ? q.GetDouble() : 1;
                        if (!string.IsNullOrWhiteSpace(item)) lines.Add(new { item, qty, type = l.TryGetProperty("type", out var ty) ? ty.ToString() : mode, text = l.TryGetProperty("text", out var tx) ? tx.ToString() : "" });
                    }
                var un = new List<string>();
                if (doc.RootElement.TryGetProperty("unmatched", out var us) && us.ValueKind == JsonValueKind.Array)
                    foreach (var u in us.EnumerateArray()) un.Add(u.ToString());
                string note = doc.RootElement.TryGetProperty("note", out var n) ? n.ToString() : null;
                return new { ok = true, lines, unmatched = un, note };
            }
            catch (JsonException) { return new { ok = false, error = "Claude's answer was not valid JSON." }; }
        }
    }
}

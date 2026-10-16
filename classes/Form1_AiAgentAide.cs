using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// AI Agent ⇄ AI Digital Employee parity: every action the AI Digital Employee's chat can take, as AI Agent host
    /// tools with the SAME input fields, the SAME executors (ClaudeCliService wrappers, LocalDeviceService,
    /// FusionPdfDownloader / PrinterService, DllInspector, the Fusion Model tools, SmtpVault) and the SAME policy keys
    /// (fusion_write, db_write, schedule_job, email, print, print_orders, wms_api, mra_interface).
    ///   wms_sql      action sql          read SQL on the APEX schema (guarded gateway, 200 rows)
    ///   fusion_call  action fusion       GET at once; POST / PATCH / DELETE = fusion_write (card unless AUTO and under max batch lines)
    ///   ords_read    action ords         whitelisted helper ORDS GETs
    ///   device       action device       list_printers / system_info / list_files / import_file / move_file / download_orders at once;
    ///                                    print (a result grid) and print_orders = cards
    ///   db_write     action db_write     DDL / DML through ai/executewrite = card
    ///   wms_job      action schedule_job DB or LOCAL lane job = card
    ///   email        action email        SMTP account of the app (SmtpVault - the password stays in the host) = card
    ///   save_report  action save_report
    ///   dll          action dll          read-only (never loaded or run); secrets masked
    ///   model_tool   action model        Fusion Model tools (the user's roles apply)
    /// Cards are issued and consumed by AgentIssueAsync / AgentGateAsync (Form1_AiAgentHandlers.cs).
    /// </summary>
    public partial class Form1
    {
        private static readonly string[] AGENT_AIDE_TOOLS = { "wms_sql", "fusion_call", "ords_read", "device", "db_write", "wms_job", "email", "save_report", "dll", "model_tool" };

        private static string AideStr(JsonElement r, string n) =>
            r.ValueKind == JsonValueKind.Object && r.TryGetProperty(n, out var v) && v.ValueKind != JsonValueKind.Null && v.ValueKind != JsonValueKind.Undefined
                ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText()) : null;

        private static List<string> AideList(JsonElement r, string n) =>
            r.ValueKind == JsonValueKind.Object && r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Array
                ? v.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() : x.GetRawText()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct().ToList()
                : new List<string>();

        /// <summary>Policy key of an AIDE-parity tool for this exact input (null = read, runs at once).</summary>
        private static string AgentAidePolicyKey(string tool, string inputJson)
        {
            JsonElement r;
            try { r = JsonDocument.Parse(string.IsNullOrWhiteSpace(inputJson) ? "{}" : inputJson).RootElement; } catch { return null; }
            switch (tool)
            {
                case "fusion_call": return (AideStr(r, "method") ?? "GET").ToUpperInvariant() == "GET" ? null : "fusion_write";
                case "device":
                    var op = (AideStr(r, "op") ?? "").ToLowerInvariant();
                    return op == "print_orders" ? "print_orders" : op == "print" ? "print" : null;
                case "db_write": return "db_write";
                case "wms_job": return "schedule_job";
                case "email": return "email";
                case "api_form": return "wms_api";
                default: return null;
            }
        }

        /// <summary>AUTO for fusion_write is honoured only up to the policy's max batch of body lines (like the chat).</summary>
        private static bool AgentAideOverBatch(string tool, string inputJson, int? maxBatch)
        {
            if (tool != "fusion_call" || !maxBatch.HasValue) return false;
            try
            {
                using var d = JsonDocument.Parse(inputJson);
                if (d.RootElement.TryGetProperty("body", out var b) && b.ValueKind == JsonValueKind.Object && b.TryGetProperty("lines", out var l) && l.ValueKind == JsonValueKind.Array)
                    return l.GetArrayLength() > maxBatch.Value;
            }
            catch { }
            return false;
        }

        private async Task<object> AgentAideAsync(string tool, JsonElement inEl, JsonElement root, string pod, string user)
        {
            var cli = GetClaudeCliService();
            string reason = AideStr(inEl, "reason") ?? "";
            switch (tool)
            {
                case "wms_sql":
                    {
                        string sql = AideStr(inEl, "sql") ?? "";
                        var round = await cli.AgentQueryAsync(sql, reason);
                        return AgentGatewayResult(round, "SQL");
                    }
                case "fusion_call":
                    {
                        string method = (AideStr(inEl, "method") ?? "GET").ToUpperInvariant(), path = AideStr(inEl, "path") ?? "";
                        if (!path.StartsWith("/fscmRestApi/", StringComparison.OrdinalIgnoreCase)) return new { ok = false, content = "Invalid path - it must start with /fscmRestApi/" };
                        if (method != "GET" && method != "POST" && method != "PATCH" && method != "DELETE") return new { ok = false, content = "Method must be GET, POST, PATCH or DELETE." };
                        string body = inEl.TryGetProperty("body", out var b) && b.ValueKind != JsonValueKind.Null && b.ValueKind != JsonValueKind.Undefined ? b.GetRawText() : null;
                        string inst = (AideStr(inEl, "instance") ?? pod).ToUpperInvariant() == "TEST" ? "TEST" : "PROD";
                        var round = await cli.AgentFusionAsync(method, path, body, inst, reason);
                        if (method != "GET") AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "fusion_write", Outcome = round.Success ? "OK" : "FAILED", Instance = inst, Target = method + " " + path, Detail = round.Error });
                        return AgentGatewayResult(round, "Fusion " + method);
                    }
                case "ords_read":
                    {
                        string path = AideStr(inEl, "path") ?? "", q = "";
                        if (inEl.TryGetProperty("params", out var pe) && pe.ValueKind == JsonValueKind.Object)
                            q = "?" + string.Join("&", pe.EnumerateObject().Select(p => Uri.EscapeDataString(p.Name) + "=" + Uri.EscapeDataString(p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString())));
                        var (ok, text) = await cli.AgentOrdsAsync(path, q);
                        return new { ok, content = AgentCut(text, 14000) };
                    }
                case "device":
                    return await AgentDeviceAsync(inEl, root, pod, user);
                case "db_write":
                    {
                        string res = await cli.ExecuteDbWriteAsync(AideStr(inEl, "sql") ?? "");
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "db_write", Outcome = res.Contains("\"success\":true") ? "OK" : "FAILED", Detail = AgentShort(AideStr(inEl, "sql")) });
                        return new { ok = res.Contains("\"success\":true"), content = res };
                    }
                case "wms_job":
                    {
                        string res = await cli.CreateScheduledJobAsync(inEl.GetRawText());
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "schedule_job", Outcome = res.Contains("\"success\":false") ? "FAILED" : "OK", Detail = AgentShort(AideStr(inEl, "name") ?? AideStr(inEl, "jobName")) });
                        return new { ok = !res.Contains("\"success\":false"), content = res };
                    }
                case "email":
                    return await AgentEmailAsync(inEl, user);
                case "save_report":
                    {
                        string res = await cli.AgentSaveReportAsync(inEl.GetRawText(), user);
                        return new { ok = !res.Contains("\"success\":false"), content = res };
                    }
                case "dll":
                    {
                        string op = (AideStr(inEl, "op") ?? "inspect").ToLowerInvariant(), res;
                        try
                        {
                            if (op == "list") res = JsonSerializer.Serialize(new { success = true, dropFolder = DllInspector.DROP_FOLDER, files = DllInspector.Suggest() });
                            else
                            {
                                string full = DllInspector.ResolvePath(AideStr(inEl, "path"));
                                if (op == "decompile") res = await Task.Run(() => DllInspector.Decompile(full, AideStr(inEl, "target"), 24000));
                                else if (op == "find") res = JsonSerializer.Serialize(DllInspector.Find(await Task.Run(() => DllInspector.InspectCached(full, true)), AideStr(inEl, "query"), 80));
                                else res = DllInspector.Outline(await Task.Run(() => DllInspector.InspectCached(full, inEl.TryGetProperty("internal", out var ie) && ie.ValueKind == JsonValueKind.True)), 30000, AideStr(inEl, "namespace"));
                            }
                            res = DllInspector.Redact(res);
                        }
                        catch (Exception ex) { return new { ok = false, content = ex.Message }; }
                        return new { ok = true, content = res };
                    }
                case "model_tool":
                    {
                        if (ClaudeCliService.ModelEngineProvider == null) return new { ok = false, content = "The Fusion Model is not available in this app." };
                        string op = (AideStr(inEl, "op") ?? "overview").ToLowerInvariant();
                        string name = op switch { "search" => "search_model", "values" => "lookup_values", "sql" => "run_sql", "describe" => "describe", "evaluate" => "evaluate", "checks" => "run_checks", _ => "overview" };
                        try { return new { ok = true, content = AgentCut(await Task.Run(() => new FusionModel.Ai.ModelTools(ClaudeCliService.ModelEngineProvider()).RunAsync(name, inEl, user)), 16000) }; }
                        catch (Exception ex) { return new { ok = false, content = ex.Message }; }
                    }
                default:
                    return new { ok = false, content = "Unknown tool " + tool };
            }
        }

        /// <summary>Gateway / Fusion round → model text + the rows for the results panel.</summary>
        private static object AgentGatewayResult(AiSqlRound round, string label)
        {
            object data = null;
            try
            {
                using var doc = JsonDocument.Parse(round.ResultJson ?? "{}");
                var r = doc.RootElement;
                if (r.ValueKind == JsonValueKind.Object && r.TryGetProperty("columns", out var c) && c.ValueKind == JsonValueKind.Array && r.TryGetProperty("rows", out var rw) && rw.ValueKind == JsonValueKind.Array && rw.GetArrayLength() > 0)
                    data = new { title = label + (round.Reason is { Length: > 0 } ? ": " + round.Reason : ""), columns = JsonSerializer.Deserialize<object>(c.GetRawText()), rows = JsonSerializer.Deserialize<object>(rw.GetRawText()), sql = round.Sql };
            }
            catch { }
            string text = (round.Success ? "" : "ERROR: " + round.Error + "\n") + AgentCut(round.ResultJson, 14000);
            return new { ok = round.Success, content = text, data };
        }

        private static string AgentCut(string s, int max) => string.IsNullOrEmpty(s) || s.Length <= max ? s : s.Substring(0, max) + "\n… (cut, " + s.Length + " characters)";

        private async Task<object> AgentDeviceAsync(JsonElement inEl, JsonElement root, string pod, string user)
        {
            var cli = GetClaudeCliService();
            string op = (AideStr(inEl, "op") ?? "").ToLowerInvariant();
            string folder = string.IsNullOrWhiteSpace(cli.DownloadFolder) ? @"C:\fusion\ai_chat\downloads" : cli.DownloadFolder;
            string inst = (AideStr(inEl, "instance") ?? pod).ToUpperInvariant() == "TEST" ? "TEST" : "PROD";
            switch (op)
            {
                case "list_printers": return new { ok = true, content = LocalDeviceService.ListPrintersJson() };
                case "system_info": return new { ok = true, content = LocalDeviceService.SystemInfoJson() };
                case "list_files": return new { ok = true, content = JsonSerializer.Serialize(new { folder, files = ClaudeCliService.AgentListFolder(folder) }) };
                case "import_file":
                    {
                        // the file goes to the model as content (PDF / image as a document, text as text) - nothing is copied
                        string f = AideStr(inEl, "file") ?? "";
                        if (string.IsNullOrWhiteSpace(f) || f.IndexOfAny(new[] { '/', '\\' }) >= 0 || f.Contains("..")) return new { ok = false, content = "import_file needs a plain file name from list_files." };
                        string p = Path.Combine(folder, f);
                        if (!File.Exists(p)) return new { ok = false, content = "File not found in the intake folder: " + f };
                        var fi = new FileInfo(p);
                        if (fi.Length > 8 * 1024 * 1024) return new { ok = false, content = "The file is larger than 8 MB." };
                        string ext = fi.Extension.ToLowerInvariant();
                        string mt = ext switch { ".pdf" => "application/pdf", ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif", ".webp" => "image/webp", _ => null };
                        if (mt == null)
                            return new { ok = true, content = "File " + f + ":\n" + AgentCut(await File.ReadAllTextAsync(p), 60000) };
                        return new { ok = true, content = "File " + f + " (" + Math.Round(fi.Length / 1024.0) + " KB) is attached below.", attachment = new { name = f, media_type = mt, data = Convert.ToBase64String(await File.ReadAllBytesAsync(p)) } };
                    }
                case "move_file":
                    {
                        string f = AideStr(inEl, "file") ?? "", dest = AideStr(inEl, "dest") ?? "";
                        if (string.IsNullOrWhiteSpace(f) || f.IndexOfAny(new[] { '/', '\\' }) >= 0 || f.Contains("..") || !Regex.IsMatch(dest, @"^[A-Za-z0-9 _\-]{1,50}$"))
                            return new { ok = false, content = "move_file needs file (plain name) and dest (a simple subfolder such as processed or error)." };
                        string src = Path.Combine(folder, f);
                        if (!File.Exists(src)) return new { ok = false, content = "File not found in the intake folder: " + f };
                        string dir = Path.Combine(folder, dest); Directory.CreateDirectory(dir);
                        string to = Path.Combine(dir, f);
                        if (File.Exists(to)) to = Path.Combine(dir, Path.GetFileNameWithoutExtension(f) + "_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + Path.GetExtension(f));
                        File.Move(src, to);
                        return new { ok = true, content = "Moved to " + to };
                    }
                case "download_orders":
                case "print_orders":
                    {
                        var orders = AideList(inEl, "orders");
                        if (orders.Count == 0 || orders.Count > 20) return new { ok = false, content = "Give 1-20 order numbers." };
                        string printer = AideStr(inEl, "printer") ?? "";
                        if (op == "print_orders" && string.IsNullOrWhiteSpace(printer)) return new { ok = false, content = "print_orders needs the exact printer name (device list_printers)." };
                        var (fu, fp) = await FusionCredentialsService.GetAsync();
                        if (string.IsNullOrEmpty(fu)) return new { ok = false, content = "Fusion credentials not available." };
                        string dir = op == "download_orders" ? folder : Path.Combine(@"C:\fusion", "ai_chat", "prints", DateTime.Now.ToString("yyyy-MM-dd"));
                        Directory.CreateDirectory(dir);
                        var dl = new WMSApp.PrintManagement.FusionPdfDownloader();
                        var ps = new WMSApp.PrintManagement.PrinterService();
                        var results = new List<object>();
                        foreach (var order in orders)
                        {
                            var d = await dl.DownloadSalesOrderPdfAsync(order, inst, fu, fp);
                            if (!d.Success) { results.Add(new { order, ok = false, error = d.ErrorMessage }); continue; }
                            string pdf = Path.Combine(dir, order + ".pdf");
                            await File.WriteAllBytesAsync(pdf, Convert.FromBase64String(d.Base64Content));
                            if (op == "download_orders") { results.Add(new { order, ok = true, file = order + ".pdf" }); continue; }
                            var pr = await ps.PrintPdfAsync(pdf, printer);
                            results.Add(new { order, ok = pr.Success, printed = pr.Success, error = pr.Success ? null : pr.ErrorMessage, pdf });
                        }
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = op, Outcome = "OK", Instance = inst, Target = string.Join(",", orders), Detail = op == "print_orders" ? "printer " + printer : dir });
                        return new { ok = true, content = JsonSerializer.Serialize(new { op, instance = inst, folder = dir, printer, results }) };
                    }
                case "print":
                    {
                        // prints a result grid: the page sends the rows it shows (grid) next to the input
                        string printer = AideStr(inEl, "printer") ?? "", title = AideStr(inEl, "title") ?? "WMS AI Result";
                        var cols = new List<string>(); var rows = new List<List<string>>();
                        if (root.TryGetProperty("grid", out var g) && g.ValueKind == JsonValueKind.Object)
                        {
                            if (g.TryGetProperty("columns", out var c) && c.ValueKind == JsonValueKind.Array) cols = c.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() : x.ToString()).ToList();
                            if (g.TryGetProperty("rows", out var rr) && rr.ValueKind == JsonValueKind.Array)
                                rows = rr.EnumerateArray().Take(2000).Select(r => r.ValueKind == JsonValueKind.Array ? r.EnumerateArray().Select(v => v.ValueKind == JsonValueKind.Null ? "" : v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString()).ToList() : new List<string>()).ToList();
                        }
                        if (cols.Count == 0) return new { ok = false, content = "Nothing to print - name the result_id of the grid to print." };
                        string res = await LocalDeviceService.PrintGridAsync(printer, title, cols, rows);
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "print", Outcome = "OK", Target = printer, Detail = title });
                        return new { ok = !res.Contains("\"success\":false"), content = res };
                    }
                default:
                    return new { ok = false, content = "Unknown device op '" + op + "' - use list_printers, system_info, print, print_orders, download_orders, list_files, import_file or move_file." };
            }
        }

        private async Task<object> AgentEmailAsync(JsonElement inEl, string user)
        {
            string to = AideStr(inEl, "to") ?? "", cc = AideStr(inEl, "cc") ?? "", subject = AideStr(inEl, "subject") ?? "", body = AideStr(inEl, "bodyHtml") ?? AideStr(inEl, "body") ?? "";
            if (string.IsNullOrWhiteSpace(to)) return new { ok = false, content = "email needs to." };
            string server, from; int port;
            using (var st = JsonDocument.Parse(JsonSerializer.Serialize(SmtpVault.Status())))
            {
                from = st.RootElement.TryGetProperty("username", out var u) ? u.GetString() : null;
                server = st.RootElement.TryGetProperty("server", out var s) ? s.GetString() : "smtp.office365.com";
                port = st.RootElement.TryGetProperty("port", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : 587;
            }
            string pw = string.IsNullOrEmpty(from) ? null : SmtpVault.PasswordFor(from);
            if (string.IsNullOrEmpty(from) || string.IsNullOrEmpty(pw))
                return new { ok = false, content = "Email is not set up on this PC (AI Digital Employee › Settings › Email account)." };
            try
            {
                using var client = new System.Net.Mail.SmtpClient(string.IsNullOrWhiteSpace(server) ? "smtp.office365.com" : server, port) { EnableSsl = true, Credentials = new System.Net.NetworkCredential(from, pw), Timeout = 30000 };
                using var mail = new System.Net.Mail.MailMessage { From = new System.Net.Mail.MailAddress(from), Subject = subject, Body = body, IsBodyHtml = true };
                foreach (var r in to.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)) mail.To.Add(r.Trim());
                foreach (var r in cc.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)) mail.CC.Add(r.Trim());
                await client.SendMailAsync(mail);
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "email", Outcome = "OK", Target = to, Detail = subject });
                return new { ok = true, content = "Email sent to " + to + "." };
            }
            catch (Exception ex)
            {
                string msg = ex.Message.Contains("5.7.57") || ex.Message.ToLowerInvariant().Contains("authentication")
                    ? "Authentication failed - check the e-mail account (Office 365 with MFA needs an app password; SMTP AUTH must be enabled for the mailbox)." : ex.Message;
                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "email", Outcome = "FAILED", Target = to, Detail = msg });
                return new { ok = false, content = msg };
            }
        }
    }
}

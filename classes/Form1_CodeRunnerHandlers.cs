using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Code runner IPC (classes/CodeRunner.cs): codeRuntimes (what is installed), codeInstall (download a runtime),
    /// codeRun (the AI Agent's Code runner dialog: the user pasted the code and pressed Run). The agent's own run_code tool
    /// goes through AgentToolAsync with an ALWAYS-on confirm card. Both: AI admins only, kill switch, audited with the code's
    /// SHA-256 and its first lines. Reply action: codeResponse.
    /// </summary>
    public partial class Form1
    {
        /// <summary>
        /// The Code tab's HTML preview holds Fusion / APEX rows when it has Data sources; its CSP blocks fetch, images and forms,
        /// but a page can still navigate its own frame (location = "https://…?rows") and no page-side rule can stop that.
        /// Such frames are created with name="cw-sealed…", so the host cancels every navigation of them except about: / data: / blob:.
        /// </summary>
        private void AttachSealedFrameGuard(WebView2 wv)
        {
            wv.CoreWebView2.FrameCreated += (s, e) =>
            {
                try
                {
                    var frame = e.Frame;
                    if (frame == null || !(frame.Name ?? "").StartsWith("cw-sealed", StringComparison.Ordinal)) return;
                    frame.NavigationStarting += (s2, a) =>
                    {
                        string u = a.Uri ?? "";
                        if (u.StartsWith("about:", StringComparison.OrdinalIgnoreCase) || u.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || u.StartsWith("blob:", StringComparison.OrdinalIgnoreCase)) return;
                        a.Cancel = true;
                        Debug.WriteLine("[CodeRunner] blocked a sealed HTML preview navigating to " + (u.Length > 80 ? u[..80] + "…" : u));
                    };
                }
                catch (Exception ex) { Debug.WriteLine("[CodeRunner] frame guard: " + ex.Message); }
            };
        }

        private static bool IsCodeAction(string action) => action == "codeRuntimes" || action == "codeInstall" || action == "codeRun" ||
            action == "visionStatus" || action == "visionSetup" || action == "visionRun" || action == "visionModelsFolder";

        private async Task HandleCodeAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            var cli = GetClaudeCliService();
            string u = PipeSrvStr(root, "appUser");
            if (!string.IsNullOrWhiteSpace(u) && u != "UNKNOWN") cli.AppUser = u;
            string user = cli.PolicyUser;
            try
            {
                bool admin = await AiControl.IsAdminAsync(user);
                switch (action)
                {
                    case "codeRuntimes":
                        data = new { ok = true, admin, runtimes = await CodeRunner.StatusAsync() };
                        break;
                    case "codeInstall":
                        if (!admin) { data = new { ok = false, error = "Only an AI admin can install code runtimes." }; break; }
                        string lang = CodeRunner.Norm(PipeSrvStr(root, "lang"));
                        _ = CodeRunner.InstallAsync(lang);
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "code_install", Outcome = "STARTED", Target = lang });
                        data = new { ok = true, started = lang };
                        break;
                    case "codeRun":
                        data = await CodeRunAsync(root, user, admin, "dialog", false);
                        break;
                    // ── Vision (OpenCV, classes/VisionCv.cs): fixed operations on the given images, any user ──
                    case "visionStatus":
                        data = new { ok = true, admin, status = await VisionCv.StatusAsync(root.TryGetProperty("fresh", out var fr) && fr.ValueKind == JsonValueKind.True), ops = VisionCv.OPS };
                        break;
                    case "visionSetup":
                        {
                            if (!admin) { data = new { ok = false, error = "Only an AI admin can set up OpenCV / YOLO on this PC." }; break; }
                            bool yolo = root.TryGetProperty("yolo", out var yl) && yl.ValueKind == JsonValueKind.True;
                            _ = VisionCv.SetupAsync(yolo);
                            AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "vision_setup", Outcome = "STARTED", Target = string.Join(" ", yolo ? VisionCv.PACKAGES.Concat(VisionCv.YOLO_PACKAGES) : VisionCv.PACKAGES) });
                            data = new { ok = true, started = true };
                            break;
                        }
                    case "visionModelsFolder":     // custom YOLO models (.pt): opens the fixed folder in Explorer, an admin drops files there
                        if (!admin) { data = new { ok = false, error = "Only an AI admin can add models." }; break; }
                        Directory.CreateDirectory(VisionCv.ModelsDir);
                        Process.Start(new ProcessStartInfo("explorer.exe") { ArgumentList = { VisionCv.ModelsDir }, UseShellExecute = false });
                        data = new { ok = true, folder = VisionCv.ModelsDir };
                        break;
                    case "visionRun":
                        {
                            var imgs = new List<(string, byte[])>();
                            if (root.TryGetProperty("images", out var ie) && ie.ValueKind == JsonValueKind.Array)
                                foreach (var im in ie.EnumerateArray().Take(6))
                                {
                                    string b64 = im.TryGetProperty("data", out var dd) ? dd.GetString() ?? "" : "";
                                    int comma = b64.IndexOf(','); if (b64.StartsWith("data:") && comma > 0) b64 = b64[(comma + 1)..];
                                    try { imgs.Add((im.TryGetProperty("name", out var nm) ? nm.GetString() : null, Convert.FromBase64String(b64))); } catch { }
                                }
                            string prm = root.TryGetProperty("params", out var pe) && pe.ValueKind == JsonValueKind.Object ? pe.GetRawText() : "{}";
                            var vr = await VisionCv.RunAsync(PipeSrvStr(root, "op"), prm, imgs);
                            if (PipeSrvStr(root, "via") == "agent")
                                AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "AIAGENT", Action = "vision", Outcome = vr.Ok ? "OK" : "FAILED", Target = PipeSrvStr(root, "op") + " · " + imgs.Count + " image(s)", DurationMs = vr.Ms });
                            data = new { ok = vr.Ok, error = vr.Error, ms = vr.Ms, result = vr.Json == null ? (JsonElement?)null : JsonDocument.Parse(vr.Json).RootElement,
                                images = vr.Images.Select(x => new { name = x.Name, media_type = x.Mime, data = x.Base64, note = x.Note }) };
                            break;
                        }
                    default:
                        data = new { ok = false, error = "Unknown code action " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[CodeRunner] " + action + " failed: " + ex);
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "codeResponse", requestId, data }));
        }

        /// <summary>One run (dialog or agent). input: {language, code, stdin, timeout_s, packages[], install}; root.grid = input.csv.</summary>
        private async Task<object> CodeRunAsync(JsonElement input, string user, bool admin, string via, bool approved, JsonElement? gridRoot = null)
        {
            if (!admin) return new { ok = false, content = "Only an AI admin can run code (AI Digital Employee › Control › admins)." };
            if (!await AiControl.IsEnabledAsync(user)) return new { ok = false, content = "AI is paused (AI Digital Employee › Control)." };
            string S(string k) => input.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            string lang = CodeRunner.Norm(S("language") ?? S("lang")), code = S("code") ?? "";
            int timeout = input.TryGetProperty("timeout_s", out var t) && t.TryGetInt32(out var ti) ? ti : 60;
            var packages = input.TryGetProperty("packages", out var pk) && pk.ValueKind == JsonValueKind.Array ? pk.EnumerateArray().Select(x => x.ToString()).ToList() : new List<string>();

            // a missing runtime is downloaded first when the run was confirmed (card / Run button) with install = true
            if (await CodeRunner.FindAsync(lang) == null && input.TryGetProperty("install", out var ins) && ins.ValueKind == JsonValueKind.True)
            {
                await CodeRunner.InstallAsync(lang);
                for (int i = 0; i < 360 && CodeRunner.Installs.TryGetValue(lang, out var st) && st.State == "running"; i++) await Task.Delay(1000);
            }

            List<string> cols = null; List<List<string>> rows = null;
            var g = gridRoot ?? (input.TryGetProperty("grid", out var gi) ? gi : (JsonElement?)null);
            if (g.HasValue && g.Value.ValueKind == JsonValueKind.Object && g.Value.TryGetProperty("columns", out var gc) && g.Value.TryGetProperty("rows", out var gr))
            {
                cols = gc.EnumerateArray().Select(x => x.ToString()).ToList();
                rows = gr.EnumerateArray().Take(100000).Select(r => r.ValueKind == JsonValueKind.Array ? r.EnumerateArray().Select(c => c.ValueKind == JsonValueKind.Null ? "" : c.ToString()).ToList() : new List<string>()).ToList();
            }

            // Data sources of the Code tab (dialog runs only): already fetched read-only by the page, written as <name>.csv
            var extra = new List<(string Name, List<string> Cols, List<List<string>> Rows)>();
            if (via == "dialog" && input.TryGetProperty("data", out var dsEl) && dsEl.ValueKind == JsonValueKind.Array)
                foreach (var ds in dsEl.EnumerateArray().Take(3))
                {
                    if (ds.ValueKind != JsonValueKind.Object || !ds.TryGetProperty("name", out var dn) || !ds.TryGetProperty("columns", out var dc) || !ds.TryGetProperty("rows", out var dr)) continue;
                    extra.Add((dn.ToString(), dc.EnumerateArray().Select(x => x.ToString()).ToList(),
                        dr.EnumerateArray().Take(100000).Select(row => row.ValueKind == JsonValueKind.Array ? row.EnumerateArray().Select(c => c.ValueKind == JsonValueKind.Null ? "" : c.ToString()).ToList() : new List<string>()).ToList()));
                }

            string hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)))[..16];
            var r = await CodeRunner.RunAsync(lang, code, S("stdin"), timeout, packages, cols, rows, default, extra);
            AiControl.Audit(new AiControl.AuditEvent
            {
                User = user, Source = "AIAGENT", Action = "run_code", Outcome = r.Error != null ? "FAILED" : r.Ok ? "OK" : "EXIT_" + r.ExitCode, Approval = via == "agent" ? (approved ? "CARD" : "AUTO") : "USER",
                Target = lang + " sha256:" + hash, DurationMs = r.Ms, Detail = via + " | " + (code.Length > 300 ? code[..300] + "…" : code)
            });
            if (r.Error != null && r.ExitCode == 0 && string.IsNullOrEmpty(r.Stdout)) return new { ok = false, content = r.Error };

            var sb = new StringBuilder();
            sb.Append(lang).Append(" · exit ").Append(r.ExitCode).Append(" · ").Append(r.Ms).Append(" ms").Append(r.Error != null ? " · " + r.Error : "").Append('\n');
            if (r.Stdout.Length > 0) sb.Append("── output ──\n").Append(r.Stdout.Length > 12000 ? r.Stdout[..12000] + "\n… (cut)" : r.Stdout).Append('\n');
            if (r.Stderr.Length > 0) sb.Append("── errors ──\n").Append(r.Stderr.Length > 4000 ? r.Stderr[^4000..] : r.Stderr).Append('\n');
            if (r.Files.Count > 0) sb.Append("── files in ").Append(r.Folder).Append(" ──\n").Append(string.Join("\n", r.Files.Select(f => JsonSerializer.Serialize(f))));
            if (r.Columns != null) sb.Append("\n(output.csv: ").Append(r.Rows.Count).Append(" rows → shown in the results panel)");
            return new
            {
                ok = r.Ok, content = sb.ToString(),
                data = r.Columns != null ? new { title = "Code result (" + lang + ")", columns = r.Columns, rows = r.Rows } : null,
                attachment = r.ImageBase64 != null ? new { name = r.ImageName, media_type = "image/png", data = r.ImageBase64 } : null,
                run = new { lang, r.ExitCode, r.Ms, r.Stdout, r.Stderr, r.Error, r.Folder, r.Files, image = r.ImageBase64 != null ? "data:image/png;base64," + r.ImageBase64 : null, r.Columns, r.Rows }
            };
        }
    }
}

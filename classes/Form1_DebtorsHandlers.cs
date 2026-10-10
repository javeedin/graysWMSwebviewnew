using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Fusion Debtors Control (debtors/index.html) — dc* IPC actions. The Fusion credentials and the mail accounts stay in C#;
    /// everything that is recorded (runs, statements, who got what, responses, the CRM timeline) is written by the page to APEX.
    ///   dcInfo          this PC's name + the statements folder
    ///   dcBipRows       run a BI Publisher report (/Custom/…xdo) as data → rows (customer balances from the statement summary reports)
    ///   dcStatementPdf  run the statement report as PDF for one customer → C:\fusion\debtors\statements\{POD}\{BU}\{date}\{account}.pdf
    ///                   with its size and SHA-256 (the fingerprint recorded in APEX)
    ///   dcSend          e-mail one statement through the Finance Lens mail setup (Outlook / Microsoft 365 / SMTP) — the PDF is read
    ///                   from the statements folder here, never sent through the page; audited source DEBTORS
    ///   dcFileCheck     is the PDF still on this PC, is it the same file (SHA-256)
    ///   dcOpenFile / dcOpenFolder
    /// Replies: { action: "dcResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        private const string DC_ROOT = @"C:\fusion\debtors";
        private static string DcStatementsRoot => Path.Combine(DC_ROOT, "statements");

        private static bool IsDebtorsAction(string action) =>
            action != null && action.Length > 2 && action.StartsWith("dc", StringComparison.Ordinal) && char.IsUpper(action[2]);

        private async Task HandleDebtorsAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            try
            {
                string user = OmUser(root), instance = OmInstance(root);
                switch (action)
                {
                    case "dcInfo":
                        data = new { ok = true, machine = Environment.MachineName, root = DcStatementsRoot, user };
                        break;

                    case "dcBipRows":
                        {
                            var r = await BipRunBytesAsync(OmStr(root, "path"), OmParams(root), instance, "xml");
                            if (r.Error != null) { data = new { ok = false, error = r.Error, ms = r.Ms }; break; }
                            var rows = OmXmlRows(Encoding.UTF8.GetString(r.Bytes));
                            data = new { ok = true, rows, count = rows.Count, ms = r.Ms };
                            break;
                        }

                    case "dcStatementPdf":
                        {
                            var r = await BipRunBytesAsync(OmStr(root, "path"), OmParams(root), instance, "pdf");
                            if (r.Error != null) { data = new { ok = false, error = r.Error, ms = r.Ms }; break; }
                            if (r.Bytes.Length < 5 || Encoding.ASCII.GetString(r.Bytes, 0, 5) != "%PDF-")
                            {
                                string head = Encoding.UTF8.GetString(r.Bytes, 0, Math.Min(r.Bytes.Length, 300));
                                data = new { ok = false, error = "The statement report did not return a PDF (check its layout / parameters): " + Regex.Replace(head, @"\s+", " ").Trim(), ms = r.Ms };
                                break;
                            }
                            string dir = Path.Combine(DcStatementsRoot, instance, DcSafe(OmStr(root, "bu"), "BU"), DcSafe(OmStr(root, "stmtDate"), DateTime.Today.ToString("yyyy-MM-dd")));
                            Directory.CreateDirectory(dir);
                            string file = Path.Combine(dir, DcSafe(OmStr(root, "fileName"), "statement") + ".pdf");
                            File.WriteAllBytes(file, r.Bytes);
                            data = new { ok = true, path = file, name = Path.GetFileName(file), bytes = r.Bytes.Length, sha256 = DcSha(r.Bytes), ms = r.Ms };
                            break;
                        }

                    case "dcSend":
                        {
                            string file = DcSafePath(OmStr(root, "file"));
                            if (file == null || !File.Exists(file)) { data = new { ok = false, error = "The statement PDF is not on this PC any more — generate it again." }; break; }
                            byte[] bytes = File.ReadAllBytes(file);
                            var m = FinanceMail.FromJson(root);   // to, cc, bcc, subject, html, display, readReceipt, deliveryReceipt
                            m.NoSignature = true;                 // the statement text carries its own sign-off
                            m.Attachments.Clear();
                            string attName = OmStr(root, "attachName");
                            attName = string.IsNullOrWhiteSpace(attName) ? Path.GetFileName(file) : Regex.Replace(attName, @"[\\/:*?""<>|]+", "_");
                            if (!attName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) attName += ".pdf";
                            m.Attachments.Add(new FinanceMail.Attachment { Name = attName, ContentType = "application/pdf", Bytes = bytes });
                            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
                            var sw = Stopwatch.StartNew();
                            var r = await FinanceMail.SendAsync(user, m, OmStr(root, "method"), cts.Token);
                            AiControl.Audit(new AiControl.AuditEvent
                            {
                                User = user, Source = "DEBTORS", Action = m.Display ? "statement_draft" : "statement_email", Outcome = "OK",
                                Detail = (OmStr(root, "account") ?? "") + " · " + m.Subject + " → " + string.Join("; ", FinanceMail.Addresses(m.To).Concat(FinanceMail.Addresses(m.Cc)))
                            });
                            var j = JsonSerializer.SerializeToElement(r);
                            data = new
                            {
                                ok = true,
                                via = j.TryGetProperty("via", out var v) ? v.GetString() : null,
                                result = j.TryGetProperty("result", out var rs) ? rs.GetString() : null,
                                by = j.TryGetProperty("by", out var b) ? b.GetString() : null,
                                sha256 = DcSha(bytes), bytes = bytes.Length, ms = sw.ElapsedMilliseconds
                            };
                            break;
                        }

                    case "dcFileCheck":
                        {
                            string file = DcSafePath(OmStr(root, "path"));
                            if (file == null || !File.Exists(file)) { data = new { ok = true, exists = false }; break; }
                            byte[] bytes = File.ReadAllBytes(file);
                            data = new { ok = true, exists = true, bytes = bytes.Length, sha256 = DcSha(bytes) };
                            break;
                        }

                    case "dcOpenFile":
                        {
                            string file = DcSafePath(OmStr(root, "path"));
                            if (file == null || !File.Exists(file)) { data = new { ok = false, error = "The file is not on this PC (it was made on another PC, or deleted)." }; break; }
                            Process.Start(new ProcessStartInfo(file) { UseShellExecute = true });
                            data = new { ok = true };
                            break;
                        }

                    case "dcOpenFolder":
                        {
                            string p = DcSafePath(OmStr(root, "path"));
                            string dir = p == null ? DcStatementsRoot : (Directory.Exists(p) ? p : Path.GetDirectoryName(p));
                            if (string.IsNullOrEmpty(dir) || !dir.StartsWith(DC_ROOT, StringComparison.OrdinalIgnoreCase)) dir = DcStatementsRoot;
                            Directory.CreateDirectory(dir);
                            if (p != null && File.Exists(p)) Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + p + "\"") { UseShellExecute = true });
                            else Process.Start(new ProcessStartInfo(dir) { UseShellExecute = true });
                            data = new { ok = true, path = dir };
                            break;
                        }

                    default:
                        data = new { ok = false, error = "Unknown Debtors Control action: " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Debtors] {action} failed: {ex}");
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "dcResponse", requestId, data }));
        }

        private static string DcSafe(string s, string fallback)
        {
            s = Regex.Replace((s ?? "").Trim(), @"[^A-Za-z0-9_\-\.]+", "_").Trim('_', '.');
            if (s.Length > 100) s = s.Substring(0, 100);
            return s.Length == 0 ? fallback : s;
        }

        /// <summary>Only files and folders under C:\fusion\debtors.</summary>
        private static string DcSafePath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            try
            {
                string full = Path.GetFullPath(path);
                return full.StartsWith(Path.GetFullPath(DC_ROOT) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ? full : null;
            }
            catch { return null; }
        }

        private static string DcSha(byte[] bytes)
        {
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(bytes)).ToLowerInvariant();
        }
    }
}

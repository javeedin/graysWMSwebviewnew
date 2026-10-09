using System;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// A page hands the host a file it built itself (e.g. the Day debrief PDF made with jsPDF) and the person picks
    /// where it goes — a Save dialog that starts in Downloads. Replaces the browser download of a blob: URL, which in
    /// this app's WebView2 opened the file as a bare new tab without a Close control.
    ///   saveFileAs  { fileName, base64, filter?, title? }  → saveFileAsResponse { ok, path, bytes } | { ok: false, cancelled: true } | { ok: false, error }
    ///   revealFile  { path }                                → opens Explorer with that file selected (only a file this action saved before)
    /// </summary>
    public partial class Form1
    {
        private const long SAVE_FILE_MAX_BYTES = 60L * 1024 * 1024;
        private static readonly System.Collections.Generic.HashSet<string> _savedFiles = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);

        private static string SaveFileStr(JsonElement root, string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        /// <summary>A file name the page suggested, made safe for Windows (no path, no reserved characters, ≤ 150 chars).</summary>
        private static string SafeSaveName(string name, string fallback)
        {
            string n = Path.GetFileName((name ?? "").Trim());
            n = string.Join("_", n.Split(Path.GetInvalidFileNameChars())).Trim(' ', '.');
            if (n.Length > 150) n = n.Substring(0, 150);
            return string.IsNullOrWhiteSpace(n) ? fallback : n;
        }

        private async Task HandleSaveFileAs(WebView2 wv, JsonElement root, string requestId)
        {
            object data;
            try
            {
                string b64 = SaveFileStr(root, "base64");
                if (string.IsNullOrEmpty(b64)) throw new ArgumentException("No file content was sent.");
                byte[] bytes = Convert.FromBase64String(Regex.Replace(b64, @"\s+", ""));
                if (bytes.LongLength > SAVE_FILE_MAX_BYTES)
                    throw new ArgumentException("The file is too big to save this way (" + (bytes.LongLength / 1048576) + " MB; the limit is " + (SAVE_FILE_MAX_BYTES / 1048576) + " MB).");

                string fileName = SafeSaveName(SaveFileStr(root, "fileName"), "file.bin");
                string ext = Path.GetExtension(fileName).TrimStart('.');
                string filter = SaveFileStr(root, "filter");
                if (string.IsNullOrWhiteSpace(filter))
                    filter = string.IsNullOrEmpty(ext) ? "All files (*.*)|*.*" : ext.ToUpperInvariant() + " files (*." + ext + ")|*." + ext + "|All files (*.*)|*.*";
                string title = SaveFileStr(root, "title") ?? "Save file";

                string downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                string path = null;
                using (var dlg = new SaveFileDialog
                {
                    Title = title,
                    FileName = fileName,
                    Filter = filter,
                    DefaultExt = ext,
                    OverwritePrompt = true,
                    AddExtension = true,
                    InitialDirectory = Directory.Exists(downloads) ? downloads : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
                })
                {
                    if (dlg.ShowDialog(this) == DialogResult.OK) path = dlg.FileName;
                }

                if (path == null) data = new { ok = false, cancelled = true };
                else
                {
                    await File.WriteAllBytesAsync(path, bytes);
                    lock (_savedFiles) _savedFiles.Add(path);
                    data = new { ok = true, path, bytes = bytes.LongLength };
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[saveFileAs] " + ex.Message);
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "saveFileAsResponse", requestId, data }));
        }

        /// <summary>Explorer with the file selected — only for a file saveFileAs wrote in this session (never an arbitrary path from a page).</summary>
        private void HandleRevealFile(JsonElement root)
        {
            try
            {
                string path = SaveFileStr(root, "path");
                if (string.IsNullOrWhiteSpace(path)) return;
                bool known; lock (_savedFiles) known = _savedFiles.Contains(path);
                if (!known || !File.Exists(path)) return;
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe", "/select,\"" + path + "\"") { UseShellExecute = true });
            }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[revealFile] " + ex.Message); }
        }
    }
}

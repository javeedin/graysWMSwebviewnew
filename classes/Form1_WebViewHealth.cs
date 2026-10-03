using System;
using System.Collections.Concurrent;
using System.IO;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Keeps pages alive: a crashed or hung page process is reloaded (at most 3 times in 2 minutes per tab), GPU
    /// crashes recover on their own, and every failure is logged to %TEMP%\GraysWMS\webview_health.log. Background
    /// tabs get a low memory target (scripts keep running - the Shipping Agent and auto-print work in hidden tabs, so
    /// tabs are never suspended).
    /// </summary>
    public partial class Form1
    {
        private static readonly ConcurrentDictionary<WebView2, (DateTime First, int Count)> _reloads = new();

        private void AttachWebViewHealth(WebView2 wv)
        {
            try { wv.CoreWebView2.ProcessFailed += (s, e) => OnWebViewProcessFailed(wv, e); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[WebView] health hook: " + ex.Message); }
        }

        private void OnWebViewProcessFailed(WebView2 wv, CoreWebView2ProcessFailedEventArgs e)
        {
            string url = "";
            try { url = wv.Source?.ToString() ?? ""; } catch { }
            LogWebViewHealth($"{e.ProcessFailedKind} reason={e.Reason} exit={e.ExitCode} url={url}");
            try
            {
                BeginInvoke(new Action(() =>
                {
                    switch (e.ProcessFailedKind)
                    {
                        case CoreWebView2ProcessFailedKind.RenderProcessExited:
                        case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                        case CoreWebView2ProcessFailedKind.FrameRenderProcessExited:
                            var now = DateTime.UtcNow;
                            var r = _reloads.AddOrUpdate(wv, (now, 1), (_, old) => now - old.First > TimeSpan.FromMinutes(2) ? (now, 1) : (old.First, old.Count + 1));
                            if (r.Count > 3) { LogWebViewHealth("not reloading again (3 reloads in 2 minutes): " + url); return; }
                            try { wv.CoreWebView2?.Reload(); LogWebViewHealth("reloaded " + url); } catch (Exception ex) { LogWebViewHealth("reload failed: " + ex.Message); }
                            break;
                        case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                            System.Windows.Forms.MessageBox.Show(this, "The browser engine stopped unexpectedly. Please close and reopen the app.\n\nDetails are in %TEMP%\\GraysWMS\\webview_health.log",
                                "Gray's WMS", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Warning);
                            break;
                        default:
                            break;       // GPU / utility processes restart by themselves
                    }
                }));
            }
            catch (Exception ex) { LogWebViewHealth("handler: " + ex.Message); }
        }

        private static void SetBackgroundMemory(WebView2 wv, bool background)
        {
            try
            {
                if (wv?.CoreWebView2 != null)
                    wv.CoreWebView2.MemoryUsageTargetLevel = background ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
            }
            catch { }
        }

        private static void LogWebViewHealth(string line)
        {
            System.Diagnostics.Debug.WriteLine("[WebView] " + line);
            try
            {
                string dir = Path.Combine(Path.GetTempPath(), "GraysWMS");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "webview_health.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine);
            }
            catch { }
        }
    }
}

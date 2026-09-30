using System;
using System.IO;
using Microsoft.Web.WebView2.Core;

namespace WMSApp
{
    /// <summary>
    /// Window title follows the page in the current tab: "Gray's WMS" only inside the WMS module,
    /// otherwise the module's own name (Data Loading, Fusion SQL, …), then the version / source suffix.
    /// </summary>
    public partial class Form1
    {
        private string _titleSuffix = "";

        /// <summary>Module name for a page, by its folder; falls back to the page's own &lt;title&gt;.</summary>
        private static string ModuleTitle(string source, string documentTitle)
        {
            string folder = "";
            try
            {
                var uri = new Uri(source);
                string path = uri.IsFile ? uri.LocalPath : uri.AbsolutePath;
                folder = Path.GetFileName(Path.GetDirectoryName(path.Replace('/', Path.DirectorySeparatorChar)) ?? "") ?? "";
            }
            catch (UriFormatException) { }
            string title = (documentTitle ?? "").Trim();

            switch (folder.ToLowerInvariant())
            {
                case "wms": return "Gray's WMS";
                case "home": return "Fusion Client";
                case "dataload": return "Data Loading";
                case "fusionsql": return "Fusion SQL";
                case "dllexplorer": return "DLL Explorer";
                case "powerbi": return "Power BI";
                case "admin": return "Admin";
                case "gl": return "General Ledger";
                case "ap": return "Accounts Payable";
                case "ar": return "Accounts Receivable";
                case "ca": return "Cash Management";
                case "fa": return "Fixed Assets";
                case "om": return "Order Management";
                case "pos": return "Point of Sale";
                case "sync": return "Sync";
                case "inventory": return "Inventory";
                case "aianalysis": return "AI Digital Employee";
                case "rag": return "AI Knowledge Base";
                case "formsdesigner": return "Forms Designer";
                case "internetsearch": return "Internet Search";
            }
            // The WMS app can also be served from the root index.html ("WMS - Trip Management")
            if (title.StartsWith("WMS", StringComparison.OrdinalIgnoreCase)) return "Gray's WMS";
            // Other pages: their own title without the product suffix
            foreach (string cut in new[] { " — Fusion Client", " - Fusion Client", " — Gray's WMS", " - Gray's WMS", " - Grays WMS" })
            {
                int i = title.IndexOf(cut, StringComparison.OrdinalIgnoreCase);
                if (i > 0) { title = title.Substring(0, i); break; }
            }
            return string.IsNullOrEmpty(title) || title.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? "Fusion Client" : title;
        }

        /// <summary>Set the window title for the page shown in the current tab.</summary>
        private void UpdateWindowTitle()
        {
            try
            {
                var core = GetCurrentWebView()?.CoreWebView2;
                string name = core == null ? "Fusion Client" : ModuleTitle(core.Source, core.DocumentTitle);
                this.Text = name + (string.IsNullOrEmpty(_titleSuffix) ? "" : " | " + _titleSuffix);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[Title] {ex.Message}");
            }
        }
    }
}

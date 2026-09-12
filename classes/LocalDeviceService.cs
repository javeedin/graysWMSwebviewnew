using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// Local system access for the AI chat "device" action:
    /// list installed printers, basic system info, and printing the
    /// last result grid straight to a chosen Windows printer.
    /// </summary>
    public static class LocalDeviceService
    {
        // ------------------------------------------------------------
        // Installed printers -> JSON
        // ------------------------------------------------------------
        public static string ListPrintersJson()
        {
            try
            {
                string defaultPrinter = "";
                try { defaultPrinter = new PrinterSettings().PrinterName; } catch { }

                var list = new List<object>();
                foreach (string name in PrinterSettings.InstalledPrinters)
                {
                    bool valid = false;
                    try { valid = new PrinterSettings { PrinterName = name }.IsValid; } catch { }
                    list.Add(new
                    {
                        name,
                        isDefault = string.Equals(name, defaultPrinter, StringComparison.OrdinalIgnoreCase),
                        available = valid
                    });
                }
                // best-effort: shared printers published on the network
                // (Active Directory printQueue objects) not yet installed here
                var network = BrowseNetworkPrinters(list);

                return JsonSerializer.Serialize(new
                {
                    success = true,
                    machine = Environment.MachineName,
                    defaultPrinter,
                    count = list.Count,
                    printers = list,
                    networkPrinters = network
                });
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Browses printers published in Active Directory (printQueue objects).
        /// Returns only ones whose UNC is not already installed locally.
        /// Empty list on workgroup PCs / no domain / any error - best effort.
        /// </summary>
        private static List<object> BrowseNetworkPrinters(List<object> installed)
        {
            var found = new List<object>();
            try
            {
                var installedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (string name in PrinterSettings.InstalledPrinters)
                    installedNames.Add(name);

                using var root = new System.DirectoryServices.DirectoryEntry();
                using var searcher = new System.DirectoryServices.DirectorySearcher(root)
                {
                    Filter = "(objectCategory=printQueue)",
                    SizeLimit = 100,
                    ClientTimeout = TimeSpan.FromSeconds(5)
                };
                searcher.PropertiesToLoad.Add("printerName");
                searcher.PropertiesToLoad.Add("serverName");
                searcher.PropertiesToLoad.Add("uNCName");
                searcher.PropertiesToLoad.Add("location");

                foreach (System.DirectoryServices.SearchResult r in searcher.FindAll())
                {
                    string First(string prop) =>
                        r.Properties.Contains(prop) && r.Properties[prop].Count > 0
                            ? r.Properties[prop][0]?.ToString() : null;

                    string unc = First("uNCName");
                    string pname = First("printerName");
                    if (string.IsNullOrWhiteSpace(unc)) continue;
                    // skip ones already installed (either by UNC or share name)
                    if (installedNames.Contains(unc)) continue;

                    found.Add(new
                    {
                        name = pname ?? unc,
                        server = First("serverName"),
                        unc,
                        location = First("location"),
                        installed = false
                    });
                    if (found.Count >= 50) break;
                }
            }
            catch
            {
                // not on a domain, no directory access, or search failed - fine
            }
            return found;
        }

        /// <summary>
        /// Installs a connection to a shared network printer (\\server\share)
        /// using the Windows printui helper. Driver download may take a moment.
        /// </summary>
        public static Task<string> ConnectNetworkPrinterAsync(string uncPath)
        {
            return Task.Run(() =>
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(uncPath) || !uncPath.StartsWith(@"\\"))
                        return JsonSerializer.Serialize(new { success = false, error = "A UNC path like \\\\server\\printer is required" });

                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "rundll32.exe",
                        Arguments = $"printui.dll,PrintUIEntry /in /q /n \"{uncPath}\"",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    using var proc = System.Diagnostics.Process.Start(psi);
                    proc.WaitForExit(60000);

                    // verify it now shows up in the installed list
                    foreach (string name in PrinterSettings.InstalledPrinters)
                        if (name.Equals(uncPath, StringComparison.OrdinalIgnoreCase))
                            return JsonSerializer.Serialize(new { success = true, printer = name });

                    return JsonSerializer.Serialize(new
                    {
                        success = false,
                        error = "Connection did not complete - the driver may still be installing, or access was denied. Re-open the printer list in a moment."
                    });
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { success = false, error = ex.Message });
                }
            });
        }

        // ------------------------------------------------------------
        // Basic system info -> JSON
        // ------------------------------------------------------------
        public static string SystemInfoJson()
        {
            try
            {
                var drives = new List<object>();
                foreach (var d in DriveInfo.GetDrives())
                {
                    try
                    {
                        if (!d.IsReady) continue;
                        drives.Add(new
                        {
                            name = d.Name,
                            type = d.DriveType.ToString(),
                            totalGb = Math.Round(d.TotalSize / 1073741824.0, 1),
                            freeGb = Math.Round(d.AvailableFreeSpace / 1073741824.0, 1)
                        });
                    }
                    catch { }
                }
                string defaultPrinter = "";
                try { defaultPrinter = new PrinterSettings().PrinterName; } catch { }

                return JsonSerializer.Serialize(new
                {
                    success = true,
                    machine = Environment.MachineName,
                    user = Environment.UserName,
                    os = Environment.OSVersion.VersionString,
                    is64Bit = Environment.Is64BitOperatingSystem,
                    processors = Environment.ProcessorCount,
                    localTime = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    defaultPrinter,
                    drives
                });
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { success = false, error = ex.Message });
            }
        }

        // ------------------------------------------------------------
        // Print a result grid (columns + string rows) to a printer.
        // Renders a paginated table with System.Drawing.Printing -
        // works with any installed Windows printer, no Office needed.
        // ------------------------------------------------------------
        public static Task<string> PrintGridAsync(string printerName, string title,
            List<string> columns, List<List<string>> rows)
        {
            return Task.Run(() =>
            {
                try
                {
                    if (columns == null || columns.Count == 0)
                        return JsonSerializer.Serialize(new { success = false, error = "Nothing to print - no result grid available" });

                    var settings = new PrinterSettings { PrinterName = printerName };
                    if (!settings.IsValid)
                        return JsonSerializer.Serialize(new { success = false, error = "Printer not found: " + printerName });

                    rows ??= new List<List<string>>();

                    using var doc = new PrintDocument();
                    doc.PrinterSettings = settings;
                    doc.DocumentName = string.IsNullOrWhiteSpace(title) ? "WMS AI Result" : title;
                    doc.DefaultPageSettings.Landscape = columns.Count > 6;
                    doc.DefaultPageSettings.Margins = new Margins(40, 40, 45, 45);

                    int rowIndex = 0;
                    int pageNo = 0;
                    using var headFont = new Font("Segoe UI", 8f, FontStyle.Bold);
                    using var cellFont = new Font("Segoe UI", 7.5f);
                    using var titleFont = new Font("Segoe UI", 11f, FontStyle.Bold);
                    using var footFont = new Font("Segoe UI", 6.5f);
                    using var linePen = new Pen(Color.FromArgb(170, 170, 170), 0.5f);

                    doc.PrintPage += (s, e) =>
                    {
                        pageNo++;
                        var g = e.Graphics;
                        var area = e.MarginBounds;
                        float y = area.Top;

                        if (pageNo == 1 && !string.IsNullOrWhiteSpace(title))
                        {
                            g.DrawString(title, titleFont, Brushes.Black, area.Left, y);
                            y += titleFont.GetHeight(g) + 6;
                        }

                        // column widths: weighted by the longest content seen,
                        // capped so one wide column cannot eat the page
                        int n = columns.Count;
                        var weight = new float[n];
                        for (int c = 0; c < n; c++)
                        {
                            int max = (columns[c] ?? "").Length;
                            for (int r = 0; r < rows.Count && r < 60; r++)
                            {
                                var v = c < rows[r].Count ? rows[r][c] : null;
                                if (v != null && v.Length > max) max = v.Length;
                            }
                            weight[c] = Math.Min(Math.Max(max, 4), 38);
                        }
                        float total = 0; foreach (var w in weight) total += w;
                        var colW = new float[n];
                        for (int c = 0; c < n; c++) colW[c] = area.Width * (weight[c] / total);

                        string Fit(string txt, float width, Font f)
                        {
                            txt ??= "";
                            if (g.MeasureString(txt, f).Width <= width) return txt;
                            while (txt.Length > 1 && g.MeasureString(txt + "…", f).Width > width)
                                txt = txt.Substring(0, txt.Length - 1);
                            return txt + "…";
                        }

                        // header row
                        float rowH = cellFont.GetHeight(g) + 5;
                        float x = area.Left;
                        for (int c = 0; c < n; c++)
                        {
                            g.DrawString(Fit(columns[c], colW[c] - 4, headFont), headFont, Brushes.Black, x, y);
                            x += colW[c];
                        }
                        y += headFont.GetHeight(g) + 3;
                        g.DrawLine(linePen, area.Left, y, area.Right, y);
                        y += 3;

                        // data rows
                        while (rowIndex < rows.Count && y + rowH <= area.Bottom - 14)
                        {
                            x = area.Left;
                            var row = rows[rowIndex];
                            for (int c = 0; c < n; c++)
                            {
                                string v = c < row.Count ? row[c] : "";
                                g.DrawString(Fit(v, colW[c] - 4, cellFont), cellFont, Brushes.Black, x, y);
                                x += colW[c];
                            }
                            y += rowH;
                            rowIndex++;
                        }

                        // footer
                        g.DrawString($"{doc.DocumentName}  ·  {rows.Count} row(s)  ·  page {pageNo}  ·  {DateTime.Now:yyyy-MM-dd HH:mm}",
                            footFont, Brushes.Gray, area.Left, area.Bottom - 10);

                        e.HasMorePages = rowIndex < rows.Count;
                    };

                    doc.Print();
                    return JsonSerializer.Serialize(new
                    {
                        success = true,
                        printer = printerName,
                        rowsPrinted = rows.Count,
                        pages = pageNo == 0 ? 1 : pageNo
                    });
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { success = false, error = ex.Message });
                }
            });
        }
    }
}

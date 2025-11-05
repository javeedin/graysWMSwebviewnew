using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing.Printing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace commet_like.PrintManagement
{
    /// <summary>
    /// Manages printer operations including listing printers, printing PDFs, and monitoring print jobs
    /// </summary>
    public class PrinterService
    {
        /// <summary>
        /// Gets list of all installed printers on the system
        /// </summary>
        public List<string> GetInstalledPrinters()
        {
            var printers = new List<string>();

            try
            {
                foreach (string printer in PrinterSettings.InstalledPrinters)
                {
                    printers.Add(printer);
                }

                System.Diagnostics.Debug.WriteLine($"[PrinterService] Found {printers.Count} installed printers");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService ERROR] Failed to get printers: {ex.Message}");
            }

            return printers;
        }

        /// <summary>
        /// Gets the default printer name
        /// </summary>
        public string GetDefaultPrinter()
        {
            try
            {
                var settings = new PrinterSettings();
                return settings.PrinterName;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService ERROR] Failed to get default printer: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Tests if a printer is available and working
        /// </summary>
        public async Task<PrinterTestResult> TestPrinterAsync(string printerName)
        {
            try
            {
                var printers = GetInstalledPrinters();

                if (!printers.Contains(printerName))
                {
                    return new PrinterTestResult
                    {
                        Success = false,
                        Message = $"Printer '{printerName}' not found on system"
                    };
                }

                // Check if printer is online/ready
                var settings = new PrinterSettings { PrinterName = printerName };

                if (!settings.IsValid)
                {
                    return new PrinterTestResult
                    {
                        Success = false,
                        Message = $"Printer '{printerName}' is not valid or not ready"
                    };
                }

                return new PrinterTestResult
                {
                    Success = true,
                    Message = $"Printer '{printerName}' is ready",
                    PrinterName = printerName,
                    IsDefault = settings.IsDefaultPrinter
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService ERROR] Test failed: {ex.Message}");
                return new PrinterTestResult
                {
                    Success = false,
                    Message = $"Test failed: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Prints a PDF file to the specified printer
        /// Note: This uses Adobe Acrobat Reader if available, otherwise falls back to other methods
        /// </summary>
        public async Task<PrintResult> PrintPdfAsync(string pdfPath, string printerName)
        {
            return await Task.Run(() => PrintPdf(pdfPath, printerName));
        }

        private PrintResult PrintPdf(string pdfPath, string printerName)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService] Printing {pdfPath} to {printerName}");

                if (!File.Exists(pdfPath))
                {
                    return new PrintResult
                    {
                        Success = false,
                        ErrorMessage = $"PDF file not found: {pdfPath}"
                    };
                }

                // Method 1: Try using Adobe Acrobat Reader (most reliable)
                var acrobatResult = PrintWithAcrobat(pdfPath, printerName);
                if (acrobatResult.Success)
                {
                    return acrobatResult;
                }

                // Method 2: Try using SumatraPDF (if installed)
                var sumatraResult = PrintWithSumatra(pdfPath, printerName);
                if (sumatraResult.Success)
                {
                    return sumatraResult;
                }

                // Method 3: Use Windows default handler
                var defaultResult = PrintWithWindowsDefault(pdfPath, printerName);
                if (defaultResult.Success)
                {
                    return defaultResult;
                }

                return new PrintResult
                {
                    Success = false,
                    ErrorMessage = "Failed to print using all available methods. Please install Adobe Acrobat Reader or SumatraPDF."
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService ERROR] Print failed: {ex.Message}");
                return new PrintResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        /// <summary>
        /// Prints using Adobe Acrobat Reader command line
        /// </summary>
        private PrintResult PrintWithAcrobat(string pdfPath, string printerName)
        {
            try
            {
                // Look for Adobe Acrobat Reader
                string[] acrobatPaths = new[]
                {
                    @"C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe",
                    @"C:\Program Files (x86)\Adobe\Acrobat Reader DC\Reader\AcroRd32.exe",
                    @"C:\Program Files\Adobe\Acrobat Reader DC\Reader\AcroRd32.exe"
                };

                string acrobatPath = acrobatPaths.FirstOrDefault(File.Exists);

                if (acrobatPath == null)
                {
                    System.Diagnostics.Debug.WriteLine("[PrinterService] Adobe Acrobat not found");
                    return new PrintResult { Success = false };
                }

                // Use /t parameter for silent printing
                var startInfo = new ProcessStartInfo
                {
                    FileName = acrobatPath,
                    Arguments = $"/t \"{pdfPath}\" \"{printerName}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                var process = Process.Start(startInfo);
                process.WaitForExit(30000); // Wait up to 30 seconds

                System.Diagnostics.Debug.WriteLine("[PrinterService] Printed with Adobe Acrobat");

                return new PrintResult
                {
                    Success = true,
                    PrintMethod = "Adobe Acrobat Reader"
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService] Acrobat print failed: {ex.Message}");
                return new PrintResult { Success = false };
            }
        }

        /// <summary>
        /// Prints using SumatraPDF (lightweight and fast)
        /// </summary>
        private PrintResult PrintWithSumatra(string pdfPath, string printerName)
        {
            try
            {
                string[] sumatraPaths = new[]
                {
                    @"C:\Program Files\SumatraPDF\SumatraPDF.exe",
                    @"C:\Program Files (x86)\SumatraPDF\SumatraPDF.exe"
                };

                string sumatraPath = sumatraPaths.FirstOrDefault(File.Exists);

                if (sumatraPath == null)
                {
                    System.Diagnostics.Debug.WriteLine("[PrinterService] SumatraPDF not found");
                    return new PrintResult { Success = false };
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = sumatraPath,
                    Arguments = $"-print-to \"{printerName}\" -silent \"{pdfPath}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                var process = Process.Start(startInfo);
                process.WaitForExit(30000);

                System.Diagnostics.Debug.WriteLine("[PrinterService] Printed with SumatraPDF");

                return new PrintResult
                {
                    Success = true,
                    PrintMethod = "SumatraPDF"
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService] SumatraPDF print failed: {ex.Message}");
                return new PrintResult { Success = false };
            }
        }

        /// <summary>
        /// Prints using Windows default handler (verb "printto")
        /// </summary>
        private PrintResult PrintWithWindowsDefault(string pdfPath, string printerName)
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = pdfPath,
                    Verb = "printto",
                    Arguments = $"\"{printerName}\"",
                    UseShellExecute = true,
                    CreateNoWindow = true
                };

                var process = Process.Start(startInfo);

                // Give it some time to spool
                System.Threading.Thread.Sleep(5000);

                System.Diagnostics.Debug.WriteLine("[PrinterService] Printed with Windows default handler");

                return new PrintResult
                {
                    Success = true,
                    PrintMethod = "Windows Default"
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrinterService] Windows default print failed: {ex.Message}");
                return new PrintResult { Success = false, ErrorMessage = ex.Message };
            }
        }

        /// <summary>
        /// Gets the status of a printer
        /// </summary>
        public PrinterStatus GetPrinterStatus(string printerName)
        {
            try
            {
                var settings = new PrinterSettings { PrinterName = printerName };

                if (!settings.IsValid)
                {
                    return PrinterStatus.NotFound;
                }

                // Note: Detailed status requires WMI or System.Management
                // For now, we'll return a simple status
                return PrinterStatus.Ready;
            }
            catch
            {
                return PrinterStatus.Error;
            }
        }
    }

    /// <summary>
    /// Result of printer test operation
    /// </summary>
    public class PrinterTestResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string PrinterName { get; set; }
        public bool IsDefault { get; set; }
    }

    /// <summary>
    /// Result of print operation
    /// </summary>
    public class PrintResult
    {
        public bool Success { get; set; }
        public string PrintMethod { get; set; }
        public string ErrorMessage { get; set; }
    }

    /// <summary>
    /// Printer status enum
    /// </summary>
    public enum PrinterStatus
    {
        Ready,
        NotFound,
        Offline,
        Error,
        Printing,
        PaperJam,
        OutOfPaper
    }
}
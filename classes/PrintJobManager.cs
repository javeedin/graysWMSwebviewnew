using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace WMSApp.PrintManagement
{
    /// <summary>
    /// Orchestrates the complete print workflow: download, queue, print, monitor
    /// </summary>
    public class PrintJobManager
    {
        private readonly FusionPdfDownloader _pdfDownloader;
        private readonly PrinterService _printerService;
        private readonly LocalStorageManager _storageManager;
        private readonly Queue<PrintJob> _printQueue;
        private bool _isProcessingQueue = false;

        public PrintJobManager()
        {
            _pdfDownloader = new FusionPdfDownloader();
            _printerService = new PrinterService();
            _storageManager = new LocalStorageManager();
            _printQueue = new Queue<PrintJob>();
        }

        /// <summary>
        /// Get all print jobs from all trips
        /// </summary>
        public static async Task<List<PrintJob>> GetAllPrintJobsAsync()
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Getting all print jobs...");

                var allJobs = new List<PrintJob>();

                // Get all trip folders
                string basePath = @"C:\fusion";

                if (!Directory.Exists(basePath))
                {
                    System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Base path does not exist: {basePath}");
                    return allJobs;
                }

                // Get all date folders
                var dateFolders = Directory.GetDirectories(basePath);

                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Found {dateFolders.Length} date folders");

                foreach (var dateFolder in dateFolders)
                {
                    // Get all trip folders in this date
                    var tripFolders = Directory.GetDirectories(dateFolder);

                    foreach (var tripFolder in tripFolders)
                    {
                        try
                        {
                            string tripId = Path.GetFileName(tripFolder);
                            string tripDate = Path.GetFileName(dateFolder);

                            System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Loading trip: {tripId} on {tripDate}");

                            // Load trip config
                            var config = LocalStorageManager.LoadTripPrintConfig(tripDate, tripId);

                            if (config != null && config.Orders != null)
                            {
                                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Found {config.Orders.Count} orders in trip {tripId}");

                                foreach (var order in config.Orders)
                                {
                                    // Check if PDF exists
                                    string pdfPath = Path.Combine(tripFolder, $"{order.OrderNumber}.pdf");
                                    bool pdfExists = File.Exists(pdfPath);

                                    // Determine status based on file existence
                                    PrintJobStatus status;
                                    if (pdfExists)
                                    {
                                        status = PrintJobStatus.Completed;
                                    }
                                    else if (!string.IsNullOrEmpty(order.ErrorMessage))
                                    {
                                        status = PrintJobStatus.Failed;
                                    }
                                    else
                                    {
                                        status = PrintJobStatus.Pending;
                                    }

                                    var job = new PrintJob
                                    {
                                        OrderNumber = order.OrderNumber,
                                        TripId = tripId,
                                        TripDate = tripDate,
                                        Status = status,
                                        FilePath = pdfExists ? pdfPath : null,
                                        ErrorMessage = order.ErrorMessage,
                                        CreatedAt = config.CreatedAt,
                                        UpdatedAt = DateTime.Now
                                    };

                                    allJobs.Add(job);
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] Failed to load trip folder {tripFolder}: {ex.Message}");
                            // Continue with next folder
                        }
                    }
                }

                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Total jobs loaded: {allJobs.Count}");

                // Sort by date descending (newest first)
                allJobs = allJobs.OrderByDescending(j => j.TripDate)
                                 .ThenBy(j => j.TripId)
                                 .ThenBy(j => j.OrderNumber)
                                 .ToList();

                return allJobs;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] Get all print jobs failed: {ex.Message}");
                return new List<PrintJob>();
            }
        }

        /// <summary>
        /// Enables auto-print for a trip and initiates download/print workflow
        /// MODIFIED: Works even without printer configuration
        /// </summary>
        public async Task<AutoPrintResult> EnableAutoPrintAsync(
            string tripId,
            string tripDate,
            List<OrderInfo> orders)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Enabling auto-print for trip {tripId}");

                // Load printer configuration (optional)
                var printerConfig = _storageManager.LoadPrinterConfig();

                // Create or update trip configuration regardless of printer setup
                var tripConfig = _storageManager.CreateOrUpdateTripConfig(tripId, tripDate, true, orders);

                if (tripConfig == null)
                {
                    return new AutoPrintResult
                    {
                        Success = false,
                        Message = "Failed to create trip configuration"
                    };
                }

                // Only start processing if printer is configured AND auto-download is enabled
                if (!string.IsNullOrEmpty(printerConfig.PrinterName) && printerConfig.AutoDownload)
                {
                    _ = Task.Run(() => ProcessTripOrdersAsync(tripId, tripDate, printerConfig));

                    return new AutoPrintResult
                    {
                        Success = true,
                        Message = $"Auto-print enabled for trip {tripId}. Processing {orders.Count} orders.",
                        TripConfig = tripConfig
                    };
                }
                else
                {
                    // Auto-print enabled but printer not configured - just save the configuration
                    return new AutoPrintResult
                    {
                        Success = true,
                        Message = $"Auto-print enabled for trip {tripId} with {orders.Count} orders. Configure printer in Printer Setup to start downloading.",
                        TripConfig = tripConfig
                    };
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] {ex.Message}");
                return new AutoPrintResult
                {
                    Success = false,
                    Message = ex.Message
                };
            }
        }

        /// <summary>
        /// Disables auto-print for a trip
        /// </summary>
        public bool DisableAutoPrint(string tripId, string tripDate)
        {
            try
            {
                var tripConfig = LocalStorageManager.LoadTripPrintConfig(tripDate, tripId);
                if (tripConfig != null)
                {
                    tripConfig.AutoPrintEnabled = false;
                    return _storageManager.SaveTripPrintConfig(tripConfig);
                }
                return false;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Processes all orders for a trip: download PDFs and queue for printing
        /// </summary>
        private async Task ProcessTripOrdersAsync(string tripId, string tripDate, PrinterConfig printerConfig)
        {
            try
            {
                var tripConfig = LocalStorageManager.LoadTripPrintConfig(tripDate, tripId);
                if (tripConfig == null || !tripConfig.AutoPrintEnabled)
                {
                    return;
                }

                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Processing {tripConfig.Orders.Count} orders for trip {tripId}");

                foreach (var job in tripConfig.Orders)
                {
                    // Skip if already completed
                    if (job.DownloadStatus == DownloadStatus.Completed &&
                        job.PrintStatus == PrintStatus.Printed)
                    {
                        continue;
                    }

                    // Download PDF
                    if (job.DownloadStatus != DownloadStatus.Completed)
                    {
                        await DownloadOrderPdfAsync(job, printerConfig);
                    }

                    // Queue for printing if download successful and auto-print enabled
                    if (job.DownloadStatus == DownloadStatus.Completed &&
                        printerConfig.AutoPrint &&
                        job.PrintStatus != PrintStatus.Printed &&
                        !string.IsNullOrEmpty(printerConfig.PrinterName))
                    {
                        QueueForPrinting(job, printerConfig.PrinterName);
                    }
                }

                // Start processing print queue
                if (!_isProcessingQueue)
                {
                    _ = Task.Run(() => ProcessPrintQueueAsync());
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] Process trip orders failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Downloads PDF for a single order
        /// </summary>
        private async Task<bool> DownloadOrderPdfAsync(PrintJob job, PrinterConfig printerConfig)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Downloading PDF for order {job.OrderNumber}");

                // Update status to downloading
                _storageManager.UpdatePrintJobStatus(
                    job.TripDate,
                    job.TripId,
                    job.OrderNumber,
                    downloadStatus: DownloadStatus.Downloading
                );

                // Download from Fusion
                var result = await _pdfDownloader.DownloadAndSavePdfAsync(
                    job.OrderNumber,
                    job.TripId,
                    job.TripDate,
                    printerConfig.FusionInstance,
                    printerConfig.FusionUsername,
                    printerConfig.FusionPassword
                );

                if (result.Success)
                {
                    // Update status to completed
                    job.PdfPath = result.FilePath;
                    job.DownloadStatus = DownloadStatus.Completed;

                    _storageManager.UpdatePrintJobStatus(
                        job.TripDate,
                        job.TripId,
                        job.OrderNumber,
                        downloadStatus: DownloadStatus.Completed
                    );

                    System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Download completed for {job.OrderNumber}");
                    return true;
                }
                else
                {
                    // Update status to failed
                    job.DownloadStatus = DownloadStatus.Failed;
                    job.ErrorMessage = result.ErrorMessage;
                    job.RetryCount++;

                    _storageManager.UpdatePrintJobStatus(
                        job.TripDate,
                        job.TripId,
                        job.OrderNumber,
                        downloadStatus: DownloadStatus.Failed,
                        errorMessage: result.ErrorMessage
                    );

                    System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Download failed for {job.OrderNumber}: {result.ErrorMessage}");
                    return false;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] Download exception: {ex.Message}");

                _storageManager.UpdatePrintJobStatus(
                    job.TripDate,
                    job.TripId,
                    job.OrderNumber,
                    downloadStatus: DownloadStatus.Failed,
                    errorMessage: ex.Message
                );

                return false;
            }
        }

        /// <summary>
        /// Queues a job for printing
        /// </summary>
        private void QueueForPrinting(PrintJob job, string printerName)
        {
            lock (_printQueue)
            {
                job.PrinterName = printerName;
                job.PrintStatus = PrintStatus.Queued;
                _printQueue.Enqueue(job);

                _storageManager.UpdatePrintJobStatus(
                    job.TripDate,
                    job.TripId,
                    job.OrderNumber,
                    printStatus: PrintStatus.Queued
                );

                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Queued {job.OrderNumber} for printing");
            }
        }

        /// <summary>
        /// Processes the print queue
        /// </summary>
        private async Task ProcessPrintQueueAsync()
        {
            if (_isProcessingQueue)
            {
                return;
            }

            _isProcessingQueue = true;

            try
            {
                while (_printQueue.Count > 0)
                {
                    PrintJob job;
                    lock (_printQueue)
                    {
                        job = _printQueue.Dequeue();
                    }

                    await PrintOrderAsync(job);

                    // Small delay between print jobs
                    await Task.Delay(2000);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] Print queue processing failed: {ex.Message}");
            }
            finally
            {
                _isProcessingQueue = false;
            }
        }

        /// <summary>
        /// Prints a single order
        /// </summary>
        private async Task<bool> PrintOrderAsync(PrintJob job)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Printing order {job.OrderNumber}");

                // Update status to printing
                _storageManager.UpdatePrintJobStatus(
                    job.TripDate,
                    job.TripId,
                    job.OrderNumber,
                    printStatus: PrintStatus.Printing
                );

                // Print the PDF
                var result = await _printerService.PrintPdfAsync(job.PdfPath, job.PrinterName);

                if (result.Success)
                {
                    // Update status to printed
                    _storageManager.UpdatePrintJobStatus(
                        job.TripDate,
                        job.TripId,
                        job.OrderNumber,
                        printStatus: PrintStatus.Printed
                    );

                    System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Print completed for {job.OrderNumber}");
                    return true;
                }
                else
                {
                    // Update status to failed
                    job.RetryCount++;
                    _storageManager.UpdatePrintJobStatus(
                        job.TripDate,
                        job.TripId,
                        job.OrderNumber,
                        printStatus: PrintStatus.Failed,
                        errorMessage: result.ErrorMessage
                    );

                    System.Diagnostics.Debug.WriteLine($"[PrintJobManager] Print failed for {job.OrderNumber}: {result.ErrorMessage}");
                    return false;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[PrintJobManager ERROR] Print exception: {ex.Message}");

                _storageManager.UpdatePrintJobStatus(
                    job.TripDate,
                    job.TripId,
                    job.OrderNumber,
                    printStatus: PrintStatus.Failed,
                    errorMessage: ex.Message
                );

                return false;
            }
        }

        /// <summary>
        /// Manually downloads a single order PDF
        /// </summary>
        public async Task<DownloadResult> DownloadSingleOrderAsync(
            string orderNumber,
            string tripId,
            string tripDate)
        {
            try
            {
                var printerConfig = _storageManager.LoadPrinterConfig();
                var tripConfig = LocalStorageManager.LoadTripPrintConfig(tripDate, tripId);

                if (tripConfig == null)
                {
                    return new DownloadResult
                    {
                        Success = false,
                        Message = "Trip configuration not found"
                    };
                }

                var job = tripConfig.Orders.FirstOrDefault(o => o.OrderNumber == orderNumber);
                if (job == null)
                {
                    return new DownloadResult
                    {
                        Success = false,
                        Message = "Order not found in trip"
                    };
                }

                bool success = await DownloadOrderPdfAsync(job, printerConfig);

                return new DownloadResult
                {
                    Success = success,
                    Message = success ? "Download completed" : job.ErrorMessage,
                    FilePath = job.PdfPath
                };
            }
            catch (Exception ex)
            {
                return new DownloadResult
                {
                    Success = false,
                    Message = ex.Message
                };
            }
        }

        /// <summary>
        /// Manually prints a single order
        /// </summary>
        public async Task<PrintResult> PrintSingleOrderAsync(
            string orderNumber,
            string tripId,
            string tripDate)
        {
            try
            {
                var printerConfig = _storageManager.LoadPrinterConfig();
                var tripConfig = LocalStorageManager.LoadTripPrintConfig(tripDate, tripId);

                if (tripConfig == null)
                {
                    return new PrintResult
                    {
                        Success = false,
                        ErrorMessage = "Trip configuration not found"
                    };
                }

                var job = tripConfig.Orders.FirstOrDefault(o => o.OrderNumber == orderNumber);
                if (job == null)
                {
                    return new PrintResult
                    {
                        Success = false,
                        ErrorMessage = "Order not found in trip"
                    };
                }

                if (string.IsNullOrEmpty(job.PdfPath))
                {
                    return new PrintResult
                    {
                        Success = false,
                        ErrorMessage = "PDF not downloaded yet"
                    };
                }

                job.PrinterName = printerConfig.PrinterName;
                bool success = await PrintOrderAsync(job);

                return new PrintResult
                {
                    Success = success,
                    ErrorMessage = success ? null : job.ErrorMessage
                };
            }
            catch (Exception ex)
            {
                return new PrintResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        /// <summary>
        /// Retries failed downloads/prints for a trip
        /// </summary>
        public async Task<RetryResult> RetryFailedJobsAsync(string tripId, string tripDate)
        {
            try
            {
                var printerConfig = _storageManager.LoadPrinterConfig();
                var tripConfig = LocalStorageManager.LoadTripPrintConfig(tripDate, tripId);

                if (tripConfig == null)
                {
                    return new RetryResult
                    {
                        Success = false,
                        Message = "Trip configuration not found"
                    };
                }

                int retriedCount = 0;

                foreach (var job in tripConfig.Orders)
                {
                    // Retry failed downloads
                    if (job.DownloadStatus == DownloadStatus.Failed)
                    {
                        await DownloadOrderPdfAsync(job, printerConfig);
                        retriedCount++;
                    }

                    // Retry failed prints
                    if (job.DownloadStatus == DownloadStatus.Completed &&
                        job.PrintStatus == PrintStatus.Failed &&
                        !string.IsNullOrEmpty(printerConfig.PrinterName))
                    {
                        QueueForPrinting(job, printerConfig.PrinterName);
                        retriedCount++;
                    }
                }

                if (retriedCount > 0 && !_isProcessingQueue)
                {
                    _ = Task.Run(() => ProcessPrintQueueAsync());
                }

                return new RetryResult
                {
                    Success = true,
                    Message = $"Retried {retriedCount} failed jobs",
                    RetriedCount = retriedCount
                };
            }
            catch (Exception ex)
            {
                return new RetryResult
                {
                    Success = false,
                    Message = ex.Message
                };
            }
        }
    }

    /// <summary>
    /// Result of auto-print enable operation
    /// </summary>
    public class AutoPrintResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public TripPrintConfig TripConfig { get; set; }
    }

    /// <summary>
    /// Result of download operation
    /// </summary>
    public class DownloadResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public string FilePath { get; set; }
    }

    /// <summary>
    /// Result of retry operation
    /// </summary>
    public class RetryResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
        public int RetriedCount { get; set; }
    }
}

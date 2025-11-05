using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace commet_like.PrintManagement
{
    /// <summary>
    /// Manages local storage of print jobs and configurations
    /// </summary>
    public class LocalStorageManager
    {
        private const string BASE_PATH = @"C:\fusion";
        private const string CONFIG_FILE = "printer_config.json";
        private const string ORDERS_FILE = "orders.json";

        /// <summary>
        /// Saves printer configuration
        /// </summary>
        public bool SavePrinterConfig(PrinterConfig config)
        {
            try
            {
                Directory.CreateDirectory(BASE_PATH);
                string configPath = Path.Combine(BASE_PATH, CONFIG_FILE);

                string json = JsonConvert.SerializeObject(config, Formatting.Indented);
                File.WriteAllText(configPath, json);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Printer config saved to {configPath}");
                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to save config: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Loads printer configuration
        /// </summary>
        public PrinterConfig LoadPrinterConfig()
        {
            try
            {
                string configPath = Path.Combine(BASE_PATH, CONFIG_FILE);

                if (!File.Exists(configPath))
                {
                    System.Diagnostics.Debug.WriteLine("[LocalStorageManager] Config file not found, returning defaults");
                    return new PrinterConfig
                    {
                        FusionInstance = "TEST",
                        FusionUsername = "shaik",
                        FusionPassword = "fusion1234",
                        AutoDownload = true,
                        AutoPrint = true
                    };
                }

                string json = File.ReadAllText(configPath);
                var config = JsonConvert.DeserializeObject<PrinterConfig>(json);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Config loaded successfully");
                return config;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to load config: {ex.Message}");
                return new PrinterConfig();
            }
        }

        /// <summary>
        /// Saves trip print configuration
        /// </summary>
        /// 
        /// <summary>
        /// Save trip print configuration to local storage
        /// </summary>
        /// 
        private string SanitizeDateForPath(string dateStr)
        {
            if (string.IsNullOrWhiteSpace(dateStr))
                return "unknown";

            try
            {
                // Try to parse as DateTime
                if (DateTime.TryParse(dateStr, out DateTime parsedDate))
                {
                    return parsedDate.ToString("yyyy-MM-dd");
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Could not parse date: {dateStr}, Error: {ex.Message}");
            }

            // Fallback: Remove invalid characters
            var sanitized = dateStr
                .Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)[0] // Take first part
                .Replace(":", "-")
                .Replace("/", "-")
                .Replace("\\", "-");

            // Extract only date-like pattern (e.g., 2025-11-04)
            var match = System.Text.RegularExpressions.Regex.Match(sanitized, @"(\d{4}-\d{2}-\d{2})");
            if (match.Success)
                return match.Groups[1].Value;

            // Last resort: just clean up
            return new string(sanitized.Where(c => char.IsLetterOrDigit(c) || c == '-').ToArray())
                .Substring(0, Math.Min(sanitized.Length, 10));
        }
        public bool SaveTripPrintConfig(TripPrintConfig config)
        {
            try
            {
                // 🔧 VALIDATION
                if (config == null)
                {
                    System.Diagnostics.Debug.WriteLine("[LocalStorageManager ERROR] Config is null");
                    return false;
                }

                if (string.IsNullOrWhiteSpace(config.TripId))
                {
                    System.Diagnostics.Debug.WriteLine("[LocalStorageManager ERROR] TripId is null or empty");
                    return false;
                }

                // 🔧 SANITIZE DATE AND ID
                string safeTripDate = SanitizeDateForPath(config.TripDate);
                string safeTripId = SanitizeFileName(config.TripId);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Original date: '{config.TripDate}' -> Sanitized: '{safeTripDate}'");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Original ID: '{config.TripId}' -> Sanitized: '{safeTripId}'");

                // 🔧 CREATE SAFE PATH
                string folderPath = Path.Combine(BASE_PATH, safeTripDate, safeTripId);

                // Create directory (will not throw if already exists)
                Directory.CreateDirectory(folderPath);

                string filePath = Path.Combine(folderPath, ORDERS_FILE);

                // Update timestamp
                config.UpdatedAt = DateTime.Now;

                // Serialize and save
                string json = JsonConvert.SerializeObject(config, Formatting.Indented);
                File.WriteAllText(filePath, json, System.Text.Encoding.UTF8);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ✅ Trip config saved successfully to: {filePath}");
                return true;
            }
            catch (UnauthorizedAccessException ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Access denied: {ex.Message}");
                return false;
            }
            catch (DirectoryNotFoundException ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Directory not found: {ex.Message}");
                return false;
            }
            catch (PathTooLongException ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Path too long: {ex.Message}");
                return false;
            }
            catch (IOException ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] IO error: {ex.Message}");
                return false;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Unexpected error: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Stack trace: {ex.StackTrace}");
                return false;
            }
        }
        private string SanitizeFileName(string fileName)
        {
            if (string.IsNullOrWhiteSpace(fileName))
                return "unknown";

            var invalidChars = Path.GetInvalidFileNameChars();
            var sanitized = string.Join("_", fileName.Split(invalidChars, StringSplitOptions.RemoveEmptyEntries));

            // Also remove spaces and other problematic characters
            sanitized = sanitized.Replace(" ", "_").Replace(":", "-");

            return string.IsNullOrWhiteSpace(sanitized) ? "unknown" : sanitized;
        }
        public bool SaveTripPrintConfigold(TripPrintConfig config)
        {
            try
            {
                string folderPath = Path.Combine(BASE_PATH, config.TripDate, config.TripId);
                Directory.CreateDirectory(folderPath);

                string filePath = Path.Combine(folderPath, ORDERS_FILE);
                config.UpdatedAt = DateTime.Now;

                string json = JsonConvert.SerializeObject(config, Formatting.Indented);
                File.WriteAllText(filePath, json);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Trip config saved to {filePath}");
                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to save trip config: {ex.Message}");
                return false;
            }
        }

        public static TripPrintConfig LoadTripPrintConfig(string tripDate, string tripId)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Loading trip config...");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Input tripDate: {tripDate}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Input tripId: {tripId}");

                // FIX: Format date properly
                string formattedDate = FormatDateForPath(tripDate);
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Formatted date: {formattedDate}");

                string folderPath = Path.Combine(BASE_PATH, formattedDate, tripId);
                string filePath = Path.Combine(folderPath, ORDERS_FILE);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Looking for file: {filePath}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] File exists: {File.Exists(filePath)}");

                if (!File.Exists(filePath))
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Trip config not found for {tripId}");
                    return null;
                }

                string json = File.ReadAllText(filePath);
                var config = JsonConvert.DeserializeObject<TripPrintConfig>(json);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Trip config loaded successfully");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Orders count: {config?.Orders?.Count ?? 0}");

                return config;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to load trip config: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Stack trace: {ex.StackTrace}");
                return null;
            }
        }


        // 4. IF YOU HAVE GetTripFolderPath METHOD, UPDATE IT TOO
        // ───────────────────────────────────────────────────────────

        public string GetTripFolderPath(string tripDate, string tripId)
        {
            // FIX: Format date properly
            string formattedDate = FormatDateForPath(tripDate);
            return Path.Combine(BASE_PATH, formattedDate, tripId);
        }


        // 5. IF YOU HAVE GetOrderPdfPath METHOD, UPDATE IT TOO
        // ───────────────────────────────────────────────────────────

        public string GetOrderPdfPath(string tripDate, string tripId, string orderNumber)
        {
            // FIX: Format date properly
            string formattedDate = FormatDateForPath(tripDate);
            string folderPath = Path.Combine(BASE_PATH, formattedDate, tripId);
            return Path.Combine(folderPath, $"{orderNumber}.pdf");
        }
        private static string FormatDateForPath(string dateString)
        {
            if (string.IsNullOrEmpty(dateString))
            {
                return DateTime.Now.ToString("yyyy-MM-dd");
            }

            // Try to parse as DateTime
            if (DateTime.TryParse(dateString, out DateTime parsedDate))
            {
                return parsedDate.ToString("yyyy-MM-dd");
            }

            // If parsing fails, extract date part before 'T' (ISO 8601 format)
            if (dateString.Contains("T"))
            {
                return dateString.Split('T')[0];
            }

            // If already in correct format or unknown format, return as-is
            return dateString;
        }
        /// <summary>
        /// Loads trip print configuration
        /// </summary>
        public TripPrintConfig LoadTripPrintConfig1(string tripDate, string tripId)
        {
            try
            {
                string folderPath = Path.Combine(BASE_PATH, tripDate, tripId);
                string filePath = Path.Combine(folderPath, ORDERS_FILE);
                filePath = "C:\\fusion\\2025-11-05\\1380\\orders.json";
                if (!File.Exists(filePath))
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Trip config not found for {tripId}");
                    return null;
                }

                string json = File.ReadAllText(filePath);
                var config = JsonConvert.DeserializeObject<TripPrintConfig>(json);

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Trip config loaded for {tripId}");
                return config;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to load trip config: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Updates print job status
        /// </summary>
        public bool UpdatePrintJobStatus(string tripDate, string tripId, string orderNumber,
            DownloadStatus? downloadStatus = null, PrintStatus? printStatus = null, string errorMessage = null)
        {
            try
            {
                var config = LoadTripPrintConfig(tripDate, tripId);
                if (config == null)
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Cannot update - trip config not found");
                    return false;
                }

                var job = config.Orders.FirstOrDefault(o => o.OrderNumber == orderNumber);
                if (job == null)
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Job not found for order {orderNumber}");
                    return false;
                }

                // Update statuses
                if (downloadStatus.HasValue)
                {
                    job.DownloadStatus = downloadStatus.Value;
                    if (downloadStatus == DownloadStatus.Completed)
                    {
                        //job.DownloadTimestamp = DateTime.Now;
                    }
                }

                if (printStatus.HasValue)
                {
                    job.PrintStatus = printStatus.Value;
                    if (printStatus == PrintStatus.Printed)
                    {
                        //job.PrintTimestamp = DateTime.Now;
                    }
                }

                if (!string.IsNullOrEmpty(errorMessage))
                {
                    job.ErrorMessage = errorMessage;
                }

                // Save updated config
                return SaveTripPrintConfig(config);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to update job status: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Gets all print jobs across all trips
        /// </summary>
        public List<PrintJob> GetAllPrintJobs(DateTime? startDate = null, DateTime? endDate = null)
        {
            var allJobs = new List<PrintJob>();

            try
            {
                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ⭐ GetAllPrintJobs STARTED");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Base Path: {BASE_PATH}");

                if (!Directory.Exists(BASE_PATH))
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ❌ Base directory does not exist!");
                    return allJobs;
                }

                // Iterate through all date folders
                var dateFolders = Directory.GetDirectories(BASE_PATH);
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Found {dateFolders.Length} date folders");

                foreach (var dateFolder in dateFolders)
                {
                    string dateFolderName = Path.GetFileName(dateFolder);
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Processing date folder: {dateFolderName}");

                    // Skip config folder
                    if (dateFolderName == "config")
                    {
                        System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Skipping config folder");
                        continue;
                    }

                    // Iterate through trip folders
                    var tripFolders = Directory.GetDirectories(dateFolder);
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Found {tripFolders.Length} trip folders in {dateFolderName}");

                    foreach (var tripFolder in tripFolders)
                    {
                        string tripId = Path.GetFileName(tripFolder);
                        System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Loading trip: {tripId}");

                        var config = LoadTripPrintConfig(dateFolderName, tripId);

                        if (config != null && config.Orders != null)
                        {
                            System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ✅ Loaded {config.Orders.Count} jobs from {tripId}");
                            allJobs.AddRange(config.Orders);
                        }
                        else
                        {
                            System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ⚠️ No jobs found for {tripId}");
                        }
                    }
                }

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ✅ Total jobs retrieved: {allJobs.Count}");
                System.Diagnostics.Debug.WriteLine("====================================");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ❌ EXCEPTION: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Stack Trace: {ex.StackTrace}");
                System.Diagnostics.Debug.WriteLine("====================================");
            }

            return allJobs;
        }
        /// <summary>
        /// Gets print jobs for a specific trip
        /// </summary>
        public List<PrintJob> GetTripPrintJobs(string tripDate, string tripId)
        {
            try
            {
                var config = LoadTripPrintConfig(tripDate, tripId);
                return config?.Orders ?? new List<PrintJob>();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to get trip jobs: {ex.Message}");
                return new List<PrintJob>();
            }
        }

        /// <summary>
        /// Creates or updates trip print configuration when auto-print is enabled
        /// </summary>
        /// <summary>
        /// Creates or updates trip print configuration when auto-print is enabled
        /// </summary>

        /// <summary>
        /// Creates or updates trip print configuration when auto-print is enabled
        /// </summary>
        public TripPrintConfig CreateOrUpdateTripConfig(string tripId, string tripDate, bool autoPrintEnabled, List<OrderInfo> orders)
        {
            try
            {
                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ⭐ CreateOrUpdateTripConfig STARTED");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] TripId: {tripId}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] TripDate: {tripDate}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Orders: {orders?.Count ?? 0}");

                // Validate inputs
                if (string.IsNullOrEmpty(tripId) || string.IsNullOrEmpty(tripDate) || orders == null)
                {
                    System.Diagnostics.Debug.WriteLine("[LocalStorageManager] ❌ Invalid input parameters");
                    return null;
                }

                // Try to load existing config
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Loading existing config...");
                var config = LoadTripPrintConfig(tripDate, tripId);

                if (config == null)
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] No existing config - creating new one");
                    config = new TripPrintConfig
                    {
                        TripId = tripId,
                        TripDate = tripDate,
                        AutoPrintEnabled = autoPrintEnabled,
                        CreatedAt = DateTime.Now,
                        UpdatedAt = DateTime.Now,
                        Orders = new List<PrintJob>()
                    };
                }
                else
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Existing config found - updating");
                    config.AutoPrintEnabled = autoPrintEnabled;
                    config.UpdatedAt = DateTime.Now;
                    config.Orders ??= new List<PrintJob>();
                }

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Processing {orders.Count} orders...");

                // Add/update print jobs for each order
                int addedCount = 0;
                int updatedCount = 0;

                foreach (var orderInfo in orders)
                {
                    if (orderInfo == null || string.IsNullOrEmpty(orderInfo.OrderNumber))
                    {
                        System.Diagnostics.Debug.WriteLine("[LocalStorageManager] Skipping invalid order");
                        continue;
                    }

                    var existingJob = config.Orders.FirstOrDefault(o =>
                        string.Equals(o.OrderNumber, orderInfo.OrderNumber, StringComparison.OrdinalIgnoreCase)
                    );

                    if (existingJob == null)
                    {
                        var newJob = new PrintJob
                        {
                            OrderNumber = orderInfo.OrderNumber,
                            AccountNumber = orderInfo.AccountNumber ?? "",
                            CustomerName = orderInfo.CustomerName ?? "Unknown",
                            TripId = tripId,
                            TripDate = tripDate
                        };

                        config.Orders.Add(newJob);
                        addedCount++;

                        System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ✅ Added: {newJob.OrderNumber}");
                    }
                    else
                    {
                        if (!string.IsNullOrEmpty(orderInfo.CustomerName))
                            existingJob.CustomerName = orderInfo.CustomerName;

                        if (!string.IsNullOrEmpty(orderInfo.AccountNumber))
                            existingJob.AccountNumber = orderInfo.AccountNumber;

                        updatedCount++;
                        System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ⚠️ Updated: {existingJob.OrderNumber}");
                    }
                }

                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Processing complete: Added={addedCount}, Updated={updatedCount}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Total orders in config: {config.Orders.Count}");

                // Save config
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Saving config...");
                bool saved = SaveTripPrintConfig(config);

                if (saved)
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ✅ Config saved successfully");
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] File location: C:\\fusion\\{tripDate}\\{tripId}\\orders.json");
                    System.Diagnostics.Debug.WriteLine("====================================");
                    return config;
                }
                else
                {
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ❌ Failed to save config");
                    System.Diagnostics.Debug.WriteLine("====================================");
                    return null;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] ❌ EXCEPTION: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Stack Trace: {ex.StackTrace}");
                System.Diagnostics.Debug.WriteLine("====================================");
                return null;
            }
        }
        /// <summary>
        /// Deletes a trip configuration
        /// </summary>
        public bool DeleteTripConfig(string tripDate, string tripId)
        {
            try
            {
                string folderPath = Path.Combine(BASE_PATH, tripDate, tripId);

                if (Directory.Exists(folderPath))
                {
                    Directory.Delete(folderPath, true);
                    System.Diagnostics.Debug.WriteLine($"[LocalStorageManager] Deleted trip folder: {folderPath}");
                    return true;
                }

                return false;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to delete trip config: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Gets summary statistics for monitoring page
        /// </summary>
        public PrintJobStats GetPrintJobStats()
        {
            try
            {
                var allJobs = GetAllPrintJobs();

                return new PrintJobStats
                {
                    TotalJobs = allJobs.Count,
                    PendingDownload = allJobs.Count(j => j.DownloadStatus == DownloadStatus.Pending),
                    DownloadCompleted = allJobs.Count(j => j.DownloadStatus == DownloadStatus.Completed),
                    DownloadFailed = allJobs.Count(j => j.DownloadStatus == DownloadStatus.Failed),
                    PendingPrint = allJobs.Count(j => j.PrintStatus == PrintStatus.Pending),
                    Printed = allJobs.Count(j => j.PrintStatus == PrintStatus.Printed),
                    PrintFailed = allJobs.Count(j => j.PrintStatus == PrintStatus.Failed)
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LocalStorageManager ERROR] Failed to get stats: {ex.Message}");
                return new PrintJobStats();
            }
        }
    }

    /// <summary>
    /// Print job statistics
    /// </summary>
    public class PrintJobStats
    {
        public int TotalJobs { get; set; }
        public int PendingDownload { get; set; }
        public int DownloadCompleted { get; set; }
        public int DownloadFailed { get; set; }
        public int PendingPrint { get; set; }
        public int Printed { get; set; }
        public int PrintFailed { get; set; }
    }
}
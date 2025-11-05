using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace WMSApp.PrintManagement
{
    /// <summary>
    /// Represents a print job for an order
    /// </summary>
    public class PrintJobold
    {
        [JsonProperty("orderNumber")]
        public string OrderNumber { get; set; }

        [JsonProperty("accountNumber")]
        public string AccountNumber { get; set; }

        [JsonProperty("customerName")]
        public string CustomerName { get; set; }

        [JsonProperty("tripId")]
        public string TripId { get; set; }

        [JsonProperty("tripDate")]
        public string TripDate { get; set; }

        [JsonProperty("downloadStatus")]
        public DownloadStatus DownloadStatus { get; set; }

        [JsonProperty("downloadTimestamp")]
        public DateTime? DownloadTimestamp { get; set; }

        [JsonProperty("pdfPath")]
        public string PdfPath { get; set; }

        [JsonProperty("printStatus")]
        public PrintStatus PrintStatus { get; set; }

        [JsonProperty("printTimestamp")]
        public DateTime? PrintTimestamp { get; set; }

        [JsonProperty("printerName")]
        public string PrinterName { get; set; }

        [JsonProperty("errorMessage")]
        public string ErrorMessage { get; set; }

        [JsonProperty("retryCount")]
        public int RetryCount { get; set; }
    }

    /// <summary>
    /// Represents a trip with auto-print configuration
    /// </summary>
    public class PrintJob
    {
        /// <summary>
        /// Order number
        /// </summary>
        public string OrderNumber { get; set; }
        public string AccountNumber { get; set; }


        /// <summary>
        /// Trip ID this order belongs to
        /// </summary>
        public string TripId { get; set; }

        /// <summary>
        /// Trip date
        /// </summary>
        public string TripDate { get; set; }

        /// <summary>
        /// Overall status of the print job
        /// </summary>
        public PrintJobStatus Status { get; set; }

        /// <summary>
        /// Download status
        /// </summary>
        public DownloadStatus DownloadStatus { get; set; }

        /// <summary>
        /// Print status
        /// </summary>
        public PrintStatus PrintStatus { get; set; }

        /// <summary>
        /// Full file path to the downloaded PDF
        /// </summary>
        public string FilePath { get; set; }

        /// <summary>
        /// PDF file path (alias for FilePath)
        /// </summary>
        public string PdfPath { get; set; }

        /// <summary>
        /// Printer name to use for printing
        /// </summary>
        public string PrinterName { get; set; }

        /// <summary>
        /// Error message if download or print failed
        /// </summary>
        public string ErrorMessage { get; set; }

        /// <summary>
        /// When the job was created
        /// </summary>
        public DateTime CreatedAt { get; set; }

        /// <summary>
        /// When the job was last updated
        /// </summary>
        public DateTime? UpdatedAt { get; set; }

        /// <summary>
        /// Number of retry attempts
        /// </summary>
        public int RetryCount { get; set; }

        /// <summary>
        /// Customer name (optional)
        /// </summary>
        public string CustomerName { get; set; }

        /// <summary>
        /// When the PDF was downloaded
        /// </summary>
        public DateTime? DownloadedAt { get; set; }

        /// <summary>
        /// When the PDF was printed
        /// </summary>
        public DateTime? PrintedAt { get; set; }

        /// <summary>
        /// Constructor
        /// </summary>
        public PrintJob()
        {
            CreatedAt = DateTime.Now;
            Status = PrintJobStatus.Pending;
            DownloadStatus = DownloadStatus.Pending;
            PrintStatus = PrintStatus.Pending;
            RetryCount = 0;
        }
    }
    public class TripPrintConfig
    {
        [JsonProperty("tripId")]
        public string TripId { get; set; }

        [JsonProperty("tripDate")]
        public string TripDate { get; set; }

        [JsonProperty("autoPrintEnabled")]
        public bool AutoPrintEnabled { get; set; }

        [JsonProperty("orders")]
        public List<PrintJob> Orders { get; set; } = new List<PrintJob>();

        [JsonProperty("createdAt")]
        public DateTime CreatedAt { get; set; }

        [JsonProperty("updatedAt")]
        public DateTime UpdatedAt { get; set; }
    }
    public enum PrintJobStatus
    {
        Pending,
        Downloading,
        Downloaded,
        Printing,
        Completed,
        Failed
    }
    /// <summary>
    /// Printer configuration settings
    /// </summary>
    public class PrinterConfig
    {
        [JsonProperty("printerName")]
        public string PrinterName { get; set; }

        [JsonProperty("paperSize")]
        public string PaperSize { get; set; } = "A4";

        [JsonProperty("orientation")]
        public string Orientation { get; set; } = "Portrait";

        [JsonProperty("fusionInstance")]
        public string FusionInstance { get; set; } = "PROD";

        [JsonProperty("fusionUsername")]
        public string FusionUsername { get; set; }

        [JsonProperty("fusionPassword")]
        public string FusionPassword { get; set; }

        [JsonProperty("autoDownload")]
        public bool AutoDownload { get; set; } = true;

        [JsonProperty("autoPrint")]
        public bool AutoPrint { get; set; } = true;
    }

    /// <summary>
    /// Download status enum
    /// </summary>
    public enum DownloadStatus
    {
        Pending = 0,
        Downloading = 1,
        Completed = 2,
        Failed = 3
    }

    /// <summary>
    /// Print status enum
    /// </summary>
    public enum PrintStatus
    {
        Pending = 0,
        Queued = 1,
        Printing = 2,
        Printed = 3,
        Failed = 4
    }

    /// <summary>
    /// Message from JavaScript to download PDF
    /// </summary>
    public class DownloadPdfMessage
    {
        [JsonProperty("action")]
        public string Action { get; set; }

        [JsonProperty("requestId")]
        public string RequestId { get; set; }

        [JsonProperty("orderNumber")]
        public string OrderNumber { get; set; }

        [JsonProperty("tripId")]
        public string TripId { get; set; }

        [JsonProperty("tripDate")]
        public string TripDate { get; set; }

        [JsonProperty("instance")]
        public string Instance { get; set; }
    }

    /// <summary>
    /// Message from JavaScript to print PDF
    /// </summary>
    public class PrintPdfMessage
    {
        [JsonProperty("action")]
        public string Action { get; set; }

        [JsonProperty("requestId")]
        public string RequestId { get; set; }

        [JsonProperty("orderNumber")]
        public string OrderNumber { get; set; }

        [JsonProperty("tripId")]
        public string TripId { get; set; }

        [JsonProperty("tripDate")]
        public string TripDate { get; set; }

        [JsonProperty("pdfPath")]
        public string PdfPath { get; set; }
    }

    /// <summary>
    /// Message from JavaScript to get print jobs
    /// </summary>
    public class GetPrintJobsMessage
    {
        [JsonProperty("action")]
        public string Action { get; set; }

        [JsonProperty("requestId")]
        public string RequestId { get; set; }

        [JsonProperty("tripId")]
        public string TripId { get; set; }

        [JsonProperty("startDate")]
        public string StartDate { get; set; }

        [JsonProperty("endDate")]
        public string EndDate { get; set; }
    }

    /// <summary>
    /// Message from JavaScript to configure printer
    /// </summary>
    public class ConfigurePrinterMessage
    {
        [JsonProperty("action")]
        public string Action { get; set; }

        [JsonProperty("requestId")]
        public string RequestId { get; set; }

        [JsonProperty("config")]
        public PrinterConfig Config { get; set; }
    }

    /// <summary>
    /// Message from JavaScript to enable/disable auto print
    /// </summary>
    public class ToggleAutoPrintMessage
    {
        [JsonProperty("action")]
        public string Action { get; set; }

        [JsonProperty("requestId")]
        public string RequestId { get; set; }

        [JsonProperty("tripId")]
        public string TripId { get; set; }

        [JsonProperty("tripDate")]
        public string TripDate { get; set; }

        [JsonProperty("enabled")]
        public bool Enabled { get; set; }

        [JsonProperty("orders")]
        public List<OrderInfo> Orders { get; set; }
    }

    /// <summary>
    /// Order information from trip
    /// </summary>
    public class OrderInfo
    {
        [JsonProperty("orderNumber")]
        public string OrderNumber { get; set; }

        [JsonProperty("accountNumber")]
        public string AccountNumber { get; set; }

        [JsonProperty("customerName")]
        public string CustomerName { get; set; }

        [JsonProperty("orderDate")]
        public string OrderDate { get; set; }

        [JsonProperty("tripId")]
        public string TripId { get; set; }

        [JsonProperty("tripDate")]
        public string TripDate { get; set; }
    }
}
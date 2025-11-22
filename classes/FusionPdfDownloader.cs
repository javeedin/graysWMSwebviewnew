using System;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Xml.Linq;

namespace WMSApp.PrintManagement
{
    /// <summary>
    /// Downloads PDF reports from Oracle Fusion using SOAP API
    /// Converted from PL/SQL WMS_PRINT_SALESORDER_F function
    /// </summary>
    public class FusionPdfDownloader
    {
        private const string TEST_URL = "https://efmh-test.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService";
        private const string PROD_URL = "https://efmh.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService";
        private const string REPORT_PATH = "/Custom/OQ/GR_SalesOrder_Rep.xdo";

        private readonly HttpClient _httpClient;

        public FusionPdfDownloader()
        {
            _httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(120)
            };
        }

        /// <summary>
        /// Downloads a sales order PDF from Oracle Fusion
        /// </summary>
        /// <param name="orderNumber">The order number to download</param>
        /// <param name="instance">Instance name (TEST or PROD)</param>
        /// <param name="username">Fusion username</param>
        /// <param name="password">Fusion password</param>
        /// <returns>Base64 encoded PDF content</returns>
        public async Task<FusionPdfResult> DownloadSalesOrderPdfAsync(
            string orderNumber,
            string instance,
            string username,
            string password)
        {
            try
            {
                // Determine URL based on instance
                string serviceUrl = instance.ToUpper() == "PROD" ? PROD_URL : TEST_URL;

                // Build SOAP request
                string soapRequest = BuildSoapRequest(orderNumber, username, password);

                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Requesting PDF for order: {orderNumber}");
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Using instance: {instance} ({serviceUrl})");

                // Make HTTP POST request
                var content = new StringContent(soapRequest, Encoding.UTF8, "text/xml");
                content.Headers.Add("SOAPAction", "\"runReport\"");

                var response = await _httpClient.PostAsync(serviceUrl, content);

                if (!response.IsSuccessStatusCode)
                {
                    return new FusionPdfResult
                    {
                        Success = false,
                        ErrorMessage = $"HTTP Error: {response.StatusCode} - {response.ReasonPhrase}"
                    };
                }

                // Read response
                string responseContent = await response.Content.ReadAsStringAsync();
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Response received, length: {responseContent.Length}");

                // Parse SOAP response
                var base64Pdf = ExtractBase64FromSoapResponse(responseContent);

                if (string.IsNullOrEmpty(base64Pdf))
                {
                    return new FusionPdfResult
                    {
                        Success = false,
                        ErrorMessage = "No <reportBytes> found in SOAP response"
                    };
                }

                // Clean up base64 string (remove whitespace, line breaks)
                base64Pdf = CleanBase64String(base64Pdf);

                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] PDF download successful, base64 length: {base64Pdf.Length}");

                return new FusionPdfResult
                {
                    Success = true,
                    Base64Content = base64Pdf
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader ERROR] {ex.Message}");
                return new FusionPdfResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        /// <summary>
        /// Downloads and saves PDF to local file system
        /// </summary>
        public async Task<FusionPdfResult> DownloadAndSavePdfAsync(
            string orderNumber,
            string tripId,
            string tripDate,
            string instance,
            string username,
            string password)
        {
            try
            {
                // Download PDF
                var result = await DownloadSalesOrderPdfAsync(orderNumber, instance, username, password);

                if (!result.Success)
                {
                    return result;
                }

                // Create folder structure: C:\fusion\{trip_date}\{trip_id}
                string folderPath = Path.Combine(@"C:\fusion", tripDate, tripId);
                folderPath = "C:\\fusion\\2025-11-05\\"+ tripId;
                Directory.CreateDirectory(folderPath);

                // Save PDF file
                string fileName = $"{orderNumber}.pdf";
                string filePath = Path.Combine(folderPath, fileName);

                // Convert base64 to bytes and save
                byte[] pdfBytes = Convert.FromBase64String(result.Base64Content);
                await File.WriteAllBytesAsync(filePath, pdfBytes);

                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] PDF saved to: {filePath}");

                result.FilePath = filePath;
                return result;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader ERROR] Failed to save PDF: {ex.Message}");
                return new FusionPdfResult
                {
                    Success = false,
                    ErrorMessage = $"Failed to save PDF: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Builds the SOAP request XML
        /// </summary>
        private string BuildSoapRequest(string orderNumber, string username, string password)
        {
            return $@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/"" xmlns:v2=""http://xmlns.oracle.com/oxp/service/v2"">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>{REPORT_PATH}</v2:reportAbsolutePath>
        <v2:parameterNameValues>     
           <v2:listOfParamNameValues>            
            <v2:item><v2:name>Order_Number</v2:name><v2:values><v2:item>{orderNumber}</v2:item></v2:values></v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>{username}</v2:userID>
      <v2:password>{password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>";
        }

        /// <summary>
        /// Extracts base64 content from SOAP response
        /// </summary>
        private string ExtractBase64FromSoapResponse(string soapResponse)
        {
            try
            {
                // Parse XML
                XDocument doc = XDocument.Parse(soapResponse);

                // Define namespaces
                XNamespace ns = "http://xmlns.oracle.com/oxp/service/v2";

                // Try to find reportBytes element
                var reportBytesElement = doc.Descendants(ns + "reportBytes").FirstOrDefault();

                if (reportBytesElement != null)
                {
                    return reportBytesElement.Value;
                }

                // If namespace didn't work, try without namespace
                reportBytesElement = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "reportBytes");

                if (reportBytesElement != null)
                {
                    return reportBytesElement.Value;
                }

                return null;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader ERROR] Failed to parse SOAP response: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Cleans base64 string by removing whitespace and line breaks
        /// </summary>
        private string CleanBase64String(string base64)
        {
            if (string.IsNullOrEmpty(base64))
                return base64;

            // Remove line feeds, carriage returns, and spaces
            return base64.Replace("\n", "")
                         .Replace("\r", "")
                         .Replace(" ", "")
                         .Replace("\t", "");
        }

        /// <summary>
        /// Downloads any Fusion report PDF (Generic method)
        /// </summary>
        /// <param name="reportPath">Full report path (e.g., /Custom/DEXPRESS/...)</param>
        /// <param name="parameterName">Parameter name (e.g., SOURCE_CODE, Order_Number)</param>
        /// <param name="parameterValue">Parameter value (e.g., order number)</param>
        /// <param name="instance">Instance name (TEST or PROD)</param>
        /// <param name="username">Fusion username</param>
        /// <param name="password">Fusion password</param>
        /// <returns>FusionPdfResult with PDF data or error</returns>
        public async Task<FusionPdfResult> DownloadGenericReportPdfAsync(
            string reportPath,
            string parameterName,
            string parameterValue,
            string instance,
            string username,
            string password)
        {
            try
            {
                // Determine URL based on instance
                string serviceUrl = instance.ToUpper() == "PROD" ? PROD_URL : TEST_URL;

                // Build SOAP request
                string soapRequest = BuildGenericReportSoapRequest(parameterValue, username, password, reportPath, parameterName);

                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Requesting report: {reportPath}");
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Parameter: {parameterName}={parameterValue}");
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Using instance: {instance} ({serviceUrl})");

                // Make HTTP POST request
                var content = new StringContent(soapRequest, Encoding.UTF8, "text/xml");
                content.Headers.Add("SOAPAction", "\"runReport\"");

                var response = await _httpClient.PostAsync(serviceUrl, content);

                if (!response.IsSuccessStatusCode)
                {
                    return new FusionPdfResult
                    {
                        Success = false,
                        ErrorMessage = $"HTTP Error: {response.StatusCode} - {response.ReasonPhrase}"
                    };
                }

                // Read response
                string responseContent = await response.Content.ReadAsStringAsync();
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Response received, length: {responseContent.Length}");

                // Parse SOAP response
                var base64Pdf = ExtractBase64FromSoapResponse(responseContent);

                if (string.IsNullOrEmpty(base64Pdf))
                {
                    return new FusionPdfResult
                    {
                        Success = false,
                        ErrorMessage = "No <reportBytes> found in SOAP response"
                    };
                }

                // Clean up base64 string
                base64Pdf = CleanBase64String(base64Pdf);

                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Report PDF download successful, base64 length: {base64Pdf.Length}");

                return new FusionPdfResult
                {
                    Success = true,
                    Base64Content = base64Pdf
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader ERROR] {ex.Message}");
                return new FusionPdfResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        /// <summary>
        /// Downloads report data and parses into data table (for verification)
        /// </summary>
        /// <param name="reportPath">Full report path (e.g., /Custom/DEXPRESS/...)</param>
        /// <param name="parameterName">Parameter name (e.g., SOURCE_CODE)</param>
        /// <param name="parameterValue">Parameter value (e.g., order number)</param>
        /// <param name="instance">Instance name (TEST or PROD)</param>
        /// <param name="username">Fusion username</param>
        /// <param name="password">Fusion password</param>
        /// <param name="forPrint">True for PDF download, False for data extraction</param>
        /// <returns>FusionDataResult with data table or PDF</returns>
        public async Task<FusionDataResult> DownloadGenericReportAsync(
            string reportPath,
            string parameterName,
            string parameterValue,
            string instance,
            string username,
            string password,
            bool forPrint = false)
        {
            try
            {
                // Determine URL based on instance
                string serviceUrl = instance.ToUpper() == "PROD" ? PROD_URL : TEST_URL;

                // Build SOAP request (original format, no format specification)
                string soapRequest = BuildGenericReportSoapRequest(
                    parameterValue, username, password, reportPath, parameterName);

                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Mode: {(forPrint ? "PRINT (PDF)" : "VERIFY (DATA)")}");
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Report: {reportPath}");
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Parameter: {parameterName}={parameterValue}");
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Instance: {instance} ({serviceUrl})");
                System.Diagnostics.Debug.WriteLine("====================================");

                // Make HTTP POST request
                var content = new StringContent(soapRequest, Encoding.UTF8, "text/xml");
                content.Headers.Add("SOAPAction", "\"runReport\"");

                var response = await _httpClient.PostAsync(serviceUrl, content);

                if (!response.IsSuccessStatusCode)
                {
                    System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] ❌ HTTP Error: {response.StatusCode}");
                    return new FusionDataResult
                    {
                        Success = false,
                        ErrorMessage = $"HTTP Error: {response.StatusCode} - {response.ReasonPhrase}"
                    };
                }

                // Read response
                string responseContent = await response.Content.ReadAsStringAsync();
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Response length: {responseContent.Length}");

                // Parse SOAP response to get base64 content
                var base64Content = ExtractBase64FromSoapResponse(responseContent);

                if (string.IsNullOrEmpty(base64Content))
                {
                    System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] ❌ No <reportBytes> found");
                    return new FusionDataResult
                    {
                        Success = false,
                        ErrorMessage = "No <reportBytes> found in SOAP response"
                    };
                }

                // Clean up base64 string
                base64Content = CleanBase64String(base64Content);
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Base64 content length: {base64Content.Length}");

                // If for print, return PDF as-is
                if (forPrint)
                {
                    System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] ✅ Returning PDF for print");
                    return new FusionDataResult
                    {
                        Success = true,
                        Base64Content = base64Content,
                        IsPdf = true
                    };
                }

                // For verification, decode and parse the XML data
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Decoding Base64 to extract data...");
                byte[] decodedBytes = Convert.FromBase64String(base64Content);
                string decodedContent = Encoding.UTF8.GetString(decodedBytes);

                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Decoded content length: {decodedContent.Length}");
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Content preview (first 500 chars):");
                System.Diagnostics.Debug.WriteLine(decodedContent.Substring(0, Math.Min(500, decodedContent.Length)));

                // Parse XML to extract data records
                var dataRecords = ParseXmlDataToTable(decodedContent);
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] ✅ Extracted {dataRecords.Count} data records");

                return new FusionDataResult
                {
                    Success = true,
                    DataRecords = dataRecords,
                    IsPdf = false
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] ❌ ERROR: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[FusionReportDownloader] Stack trace: {ex.StackTrace}");
                return new FusionDataResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        /// <summary>
        /// Parses XML data into a list of records (data table)
        /// </summary>
        private System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, string>> ParseXmlDataToTable(string xmlContent)
        {
            var records = new System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, string>>();

            try
            {
                System.Diagnostics.Debug.WriteLine($"[ParseXmlData] Starting XML parsing...");

                // Parse XML
                XDocument doc = XDocument.Parse(xmlContent);

                // Look for common row elements (ROW, row, G_1, DATA_ROW, etc.)
                var rowElements = doc.Descendants()
                    .Where(e => e.Name.LocalName.Equals("ROW", StringComparison.OrdinalIgnoreCase) ||
                               e.Name.LocalName.Equals("G_1", StringComparison.OrdinalIgnoreCase) ||
                               e.Name.LocalName.Equals("DATA_ROW", StringComparison.OrdinalIgnoreCase) ||
                               e.Name.LocalName.Contains("ROW"))
                    .ToList();

                System.Diagnostics.Debug.WriteLine($"[ParseXmlData] Found {rowElements.Count} row elements");

                foreach (var row in rowElements)
                {
                    var record = new System.Collections.Generic.Dictionary<string, string>();

                    // Extract all child elements as columns
                    foreach (var element in row.Elements())
                    {
                        string columnName = element.Name.LocalName;
                        string columnValue = element.Value;
                        record[columnName] = columnValue;
                    }

                    if (record.Count > 0)
                    {
                        records.Add(record);
                        System.Diagnostics.Debug.WriteLine($"[ParseXmlData] Record {records.Count}: {record.Count} columns");
                    }
                }

                System.Diagnostics.Debug.WriteLine($"[ParseXmlData] ✅ Parsed {records.Count} records total");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ParseXmlData] ❌ Parse error: {ex.Message}");
            }

            return records;
        }

        /// <summary>
        /// Builds SOAP request for data report with specific output format
        /// </summary>
        private string BuildGenericReportDataSoapRequest(
            string parameterValue, string username, string password,
            string reportPath, string parameterName, string outputFormat)
        {
            return $@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/"" xmlns:v2=""http://xmlns.oracle.com/oxp/service/v2"">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>{reportPath}</v2:reportAbsolutePath>
        <v2:attributeFormat>{outputFormat}</v2:attributeFormat>
        <v2:parameterNameValues>
           <v2:listOfParamNameValues>
            <v2:item><v2:name>{parameterName}</v2:name><v2:values><v2:item>{parameterValue}</v2:item></v2:values></v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
      </v2:reportRequest>
      <v2:userID>{username}</v2:userID>
      <v2:password>{password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>";
        }

        /// <summary>
        /// Builds SOAP request for any Fusion report (Generic)
        /// </summary>
        /// <param name="parameterValue">The value for the parameter</param>
        /// <param name="username">Fusion username</param>
        /// <param name="password">Fusion password</param>
        /// <param name="reportPath">Full report path</param>
        /// <param name="parameterName">Parameter name</param>
        private string BuildGenericReportSoapRequest(string parameterValue, string username, string password, string reportPath, string parameterName)
        {
            return $@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/"" xmlns:v2=""http://xmlns.oracle.com/oxp/service/v2"">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>{reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
           <v2:listOfParamNameValues>
            <v2:item><v2:name>{parameterName}</v2:name><v2:values><v2:item>{parameterValue}</v2:item></v2:values></v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>{username}</v2:userID>
      <v2:password>{password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>";
        }

        public void Dispose()
        {
            _httpClient?.Dispose();
        }
    }

    /// <summary>
    /// Result of PDF download operation
    /// </summary>
    public class FusionPdfResult
    {
        public bool Success { get; set; }
        public string Base64Content { get; set; }
        public string FilePath { get; set; }
        public string ErrorMessage { get; set; }
    }

    /// <summary>
    /// Result of report download with data table support
    /// </summary>
    public class FusionDataResult
    {
        public bool Success { get; set; }
        public string Base64Content { get; set; }  // For PDF mode
        public System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, string>> DataRecords { get; set; }  // For data mode
        public bool IsPdf { get; set; }  // True if PDF, False if data
        public string ErrorMessage { get; set; }
    }
}
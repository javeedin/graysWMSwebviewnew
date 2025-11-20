using System;
using System.IO;
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
        /// Downloads Store Transaction PDF from Oracle Fusion
        /// </summary>
        /// <param name="orderNumber">The order/transaction number (SOURCE_CODE parameter)</param>
        /// <param name="instance">Instance name (TEST or PROD)</param>
        /// <param name="username">Fusion username</param>
        /// <param name="password">Fusion password</param>
        /// <returns>FusionPdfResult with PDF data or error</returns>
        public async Task<FusionPdfResult> DownloadStoreTransactionPdfAsync(
            string orderNumber,
            string instance,
            string username,
            string password)
        {
            try
            {
                // Determine URL based on instance
                string serviceUrl = instance.ToUpper() == "PROD" ? PROD_URL : TEST_URL;

                // Report path for Store Transactions
                string reportPath = "/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo";

                // Build SOAP request
                string soapRequest = BuildStoreTransactionSoapRequest(orderNumber, username, password, reportPath);

                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Requesting Store Transaction PDF for: {orderNumber}");
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

                System.Diagnostics.Debug.WriteLine($"[FusionPdfDownloader] Store Transaction PDF download successful, base64 length: {base64Pdf.Length}");

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
        /// Builds SOAP request for Store Transaction report
        /// </summary>
        private string BuildStoreTransactionSoapRequest(string orderNumber, string username, string password, string reportPath)
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
            <v2:item><v2:name>SOURCE_CODE</v2:name><v2:values><v2:item>{orderNumber}</v2:item></v2:values></v2:item>
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
}
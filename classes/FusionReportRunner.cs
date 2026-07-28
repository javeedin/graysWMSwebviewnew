using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Xml.Linq;

namespace WMSApp.MRA
{
    /// <summary>
    /// Generic Fusion BI Publisher Report Runner
    /// Runs reports and returns data in DataTable format
    /// </summary>
    public class FusionReportRunner
    {
        private const string TEST_URL = "https://efmh-test.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService";
        private const string PROD_URL = "https://efmh.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService";

        private readonly HttpClient _httpClient;
        private readonly string _username;
        private readonly string _password;
        private readonly string _instance;

        public FusionReportRunner(string username, string password, string instance)
        {
            _httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(120)
            };
            _username = username;
            _password = password;
            _instance = instance;
        }

        /// <summary>
        /// Runs a Fusion BI Publisher report and returns data as DataSet
        /// </summary>
        /// <param name="reportPath">Full report path (e.g., /Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORDER_SUMMARY_4_ORDER_NUMBER_BIP.xdo)</param>
        /// <param name="parameters">Report parameters as dictionary</param>
        /// <param name="outputFormat">Output format (xml, csv, pdf, etc). Default is xml for data extraction</param>
        /// <returns>DataSet containing report data</returns>
        public async Task<FusionReportResult> RunReportAsync(
            string reportPath,
            Dictionary<string, string> parameters,
            string outputFormat = "xml",
            Action<string> log = null)
        {
            // Emit sends a line to both the debugger and (when provided) the on-screen log callback
            void Emit(string m)
            {
                System.Diagnostics.Debug.WriteLine(m);
                try { log?.Invoke(m); } catch { }
            }

            try
            {
                string serviceUrl = _instance.ToUpper() == "PROD" ? PROD_URL : TEST_URL;

                Emit($"[Report] Running: {reportPath}");
                Emit($"[Report] Instance: {_instance} ({serviceUrl})");
                Emit($"[Report] Parameters: {string.Join(", ", parameters.Select(p => $"{p.Key}={p.Value}"))}");

                // Build SOAP request
                string soapRequest = BuildSoapRequest(reportPath, parameters, outputFormat);

                // 🔍 DEBUG: Log full SOAP XML request (with credentials masked)
                string maskedXml = soapRequest.Replace(_password, "[PASSWORD_MASKED]");
                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine("[FusionReportRunner] FULL SOAP XML REQUEST:");
                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine(maskedXml);
                System.Diagnostics.Debug.WriteLine("====================================");

                // Make HTTP POST request
                var content = new StringContent(soapRequest, Encoding.UTF8, "text/xml");
                content.Headers.Add("SOAPAction", "\"runReport\"");

                var response = await _httpClient.PostAsync(serviceUrl, content);
                Emit($"[Report] HTTP status: {(int)response.StatusCode} {response.StatusCode}");

                if (!response.IsSuccessStatusCode)
                {
                    Emit($"[Report] ⚠ HTTP error: {response.StatusCode} - {response.ReasonPhrase}");
                    return new FusionReportResult
                    {
                        Success = false,
                        ErrorMessage = $"HTTP Error: {response.StatusCode} - {response.ReasonPhrase}"
                    };
                }

                // Read response
                string responseContent = await response.Content.ReadAsStringAsync();
                Emit($"[Report] SOAP response length: {responseContent.Length} chars");

                // 🔍 DEBUG: Log full SOAP XML response
                System.Diagnostics.Debug.WriteLine("====================================");
                System.Diagnostics.Debug.WriteLine("[FusionReportRunner] FULL SOAP XML RESPONSE:");
                System.Diagnostics.Debug.WriteLine("====================================");
                string debugResponse = TruncateBase64InXml(responseContent);
                System.Diagnostics.Debug.WriteLine(debugResponse);
                System.Diagnostics.Debug.WriteLine("====================================");

                // Extract report data from SOAP response
                var reportData = ExtractReportDataFromSoapResponse(responseContent);

                if (string.IsNullOrEmpty(reportData))
                {
                    Emit("[Report] ⚠ No report data found in SOAP response (possible SOAP fault or empty result).");
                    Emit($"[Report] Raw SOAP (first 1500 chars): {Truncate(TruncateBase64InXml(responseContent), 1500)}");
                    return new FusionReportResult
                    {
                        Success = false,
                        ErrorMessage = "No report data found in SOAP response"
                    };
                }

                Emit($"[Report] Extracted report data: {reportData.Length} chars");

                // Parse XML data into DataSet
                DataSet dataSet = new DataSet();

                if (outputFormat.ToLower() == "xml")
                {
                    using (StringReader stringReader = new StringReader(reportData))
                    {
                        dataSet.ReadXml(stringReader);
                    }
                }

                Emit($"[Report] Parsed dataset: {dataSet.Tables.Count} table(s)");
                for (int i = 0; i < dataSet.Tables.Count; i++)
                {
                    var t = dataSet.Tables[i];
                    Emit($"[Report]   Table[{i}] '{t.TableName}': rows={t.Rows.Count}, cols={t.Columns.Count}");
                }
                Emit($"[Report] Report XML (first 1500 chars): {Truncate(reportData, 1500)}");

                return new FusionReportResult
                {
                    Success = true,
                    DataSet = dataSet,
                    RawXmlData = reportData
                };
            }
            catch (Exception ex)
            {
                Emit($"[Report] ⚠ Exception: {ex.Message}");
                return new FusionReportResult
                {
                    Success = false,
                    ErrorMessage = ex.Message
                };
            }
        }

        /// <summary>
        /// Builds SOAP request XML with dynamic parameters
        /// </summary>
        private string BuildSoapRequest(string reportPath, Dictionary<string, string> parameters, string outputFormat)
        {
            StringBuilder paramXml = new StringBuilder();

            if (parameters != null && parameters.Count > 0)
            {
                paramXml.AppendLine("        <v2:parameterNameValues>");
                paramXml.AppendLine("          <v2:listOfParamNameValues>");

                foreach (var param in parameters)
                {
                    paramXml.AppendLine($"            <v2:item>");
                    paramXml.AppendLine($"              <v2:name>{param.Key}</v2:name>");
                    paramXml.AppendLine($"              <v2:values>");
                    paramXml.AppendLine($"                <v2:item>{System.Security.SecurityElement.Escape(param.Value)}</v2:item>");
                    paramXml.AppendLine($"              </v2:values>");
                    paramXml.AppendLine($"            </v2:item>");
                }

                paramXml.AppendLine("          </v2:listOfParamNameValues>");
                paramXml.AppendLine("        </v2:parameterNameValues>");
            }

            return $@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/"" xmlns:v2=""http://xmlns.oracle.com/oxp/service/v2"">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>{System.Security.SecurityElement.Escape(reportPath)}</v2:reportAbsolutePath>
{paramXml}
        <v2:attributeFormat>{outputFormat}</v2:attributeFormat>
        <v2:attributeLocale>en-US</v2:attributeLocale>
      </v2:reportRequest>
      <v2:userID>{System.Security.SecurityElement.Escape(_username)}</v2:userID>
      <v2:password>{System.Security.SecurityElement.Escape(_password)}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>";
        }

        /// <summary>
        /// Truncates a string to maxLen characters for on-screen log display.
        /// </summary>
        private string Truncate(string s, int maxLen)
        {
            if (string.IsNullOrEmpty(s) || s.Length <= maxLen) return s;
            return s.Substring(0, maxLen) + $"... [truncated {s.Length - maxLen} chars]";
        }

        /// <summary>
        /// Truncates base64 content within reportBytes elements for debug logging
        /// Shows first 100 chars and last 50 chars of base64 data
        /// </summary>
        private string TruncateBase64InXml(string xml)
        {
            if (string.IsNullOrEmpty(xml))
                return xml;

            try
            {
                // Find reportBytes content and truncate it
                int startTag = xml.IndexOf("<reportBytes>", StringComparison.OrdinalIgnoreCase);
                int endTag = xml.IndexOf("</reportBytes>", StringComparison.OrdinalIgnoreCase);

                if (startTag >= 0 && endTag > startTag)
                {
                    int contentStart = startTag + "<reportBytes>".Length;
                    string base64Content = xml.Substring(contentStart, endTag - contentStart);

                    if (base64Content.Length > 200)
                    {
                        string truncated = base64Content.Substring(0, 100) +
                            $"... [TRUNCATED {base64Content.Length - 150} chars] ..." +
                            base64Content.Substring(base64Content.Length - 50);

                        return xml.Substring(0, contentStart) + truncated + xml.Substring(endTag);
                    }
                }

                return xml;
            }
            catch
            {
                // If truncation fails, return original (may be long)
                return xml;
            }
        }

        /// <summary>
        /// Extracts report data from SOAP response
        /// </summary>
        private string ExtractReportDataFromSoapResponse(string soapResponse)
        {
            try
            {
                XDocument doc = XDocument.Parse(soapResponse);
                XNamespace ns = "http://xmlns.oracle.com/oxp/service/v2";

                // Try to find reportBytes (base64 encoded) or reportFileContent
                var reportBytesElement = doc.Descendants(ns + "reportBytes").FirstOrDefault();
                if (reportBytesElement != null && !string.IsNullOrWhiteSpace(reportBytesElement.Value))
                {
                    // Decode base64
                    byte[] data = Convert.FromBase64String(reportBytesElement.Value.Trim());
                    return Encoding.UTF8.GetString(data);
                }

                // Try reportFileContent
                var reportContentElement = doc.Descendants(ns + "reportFileContent").FirstOrDefault();
                if (reportContentElement != null && !string.IsNullOrWhiteSpace(reportContentElement.Value))
                {
                    return reportContentElement.Value;
                }

                System.Diagnostics.Debug.WriteLine("[FusionReportRunner] No report data found in response");
                return null;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionReportRunner] Error extracting report data: {ex.Message}");
                return null;
            }
        }

        public void Dispose()
        {
            _httpClient?.Dispose();
        }
    }

    /// <summary>
    /// Result from Fusion Report execution
    /// </summary>
    public class FusionReportResult
    {
        public bool Success { get; set; }
        public string ErrorMessage { get; set; }
        public DataSet DataSet { get; set; }
        public string RawXmlData { get; set; }
    }
}

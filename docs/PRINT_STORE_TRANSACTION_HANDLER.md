# Print Store Transaction - C# Handler Implementation Guide

## Overview
This document provides specifications for implementing the C# WebView2 handler for printing Store Transaction reports from Oracle Fusion BI Publisher.

---

## JavaScript Integration

The JavaScript calls the C# handler via `sendMessageToCSharp()` with the following structure:

```javascript
sendMessageToCSharp({
    action: 'printStoreTransaction',
    orderNumber: '123456',              // The SOURCE_CODE parameter value
    instance: 'TEST',                   // 'TEST' or 'PROD'
    reportPath: '/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo',
    parameterName: 'SOURCE_CODE'
}, callback);
```

---

## C# Handler Requirements

### 1. Handler Method Pattern

Similar to your existing `FusionPdfDownloader` class, create a new handler method or extend the existing one:

```csharp
// Add this to your WebView message handler
case "printStoreTransaction":
    await HandlePrintStoreTransaction(message);
    break;
```

### 2. Implementation Example

```csharp
private async Task HandlePrintStoreTransaction(dynamic message)
{
    try
    {
        string orderNumber = message.orderNumber;
        string instance = message.instance;
        string reportPath = message.reportPath;
        string parameterName = message.parameterName;

        // Determine URL based on instance
        string serviceUrl = instance == "PROD"
            ? "https://efmh.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService"
            : "https://efmh-test.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService";

        // Get credentials from config or settings
        string username = GetFusionUsername(instance);
        string password = GetFusionPassword(instance);

        // Build SOAP request
        string soapRequest = BuildStoreTransactionSoapRequest(
            reportPath,
            parameterName,
            orderNumber,
            username,
            password
        );

        // Call Fusion BI Publisher
        byte[] pdfBytes = await CallFusionBiPublisher(serviceUrl, soapRequest);

        // Save PDF to downloads folder
        string fileName = $"StoreTransaction_{orderNumber}_{DateTime.Now:yyyyMMdd_HHmmss}.pdf";
        string downloadsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads",
            fileName
        );

        await File.WriteAllBytesAsync(downloadsPath, pdfBytes);

        // Send success response back to JavaScript
        SendMessageToJs(new
        {
            success = true,
            message = $"Report saved to Downloads: {fileName}",
            filePath = downloadsPath
        });
    }
    catch (Exception ex)
    {
        // Send error response back to JavaScript
        SendMessageToJs(new
        {
            success = false,
            message = ex.Message
        });
    }
}
```

### 3. SOAP Request Builder

```csharp
private string BuildStoreTransactionSoapRequest(
    string reportPath,
    string paramName,
    string paramValue,
    string username,
    string password)
{
    return $@"<?xml version=""1.0"" encoding=""utf-8""?>
<soapenv:Envelope xmlns:soapenv=""http://schemas.xmlsoap.org/soap/envelope/""
                  xmlns:v2=""http://xmlns.oracle.com/oxp/service/v2"">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>{reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>{paramName}</v2:name>
              <v2:values>
                <v2:item>{paramValue}</v2:item>
              </v2:values>
            </v2:item>
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
```

### 4. Fusion BI Publisher Call

```csharp
private async Task<byte[]> CallFusionBiPublisher(string serviceUrl, string soapRequest)
{
    using (var client = new HttpClient())
    {
        client.Timeout = TimeSpan.FromMinutes(5); // Reports can take time

        var content = new StringContent(soapRequest, Encoding.UTF8, "text/xml");
        content.Headers.Add("SOAPAction", "runReport");

        var response = await client.PostAsync(serviceUrl, content);
        response.EnsureSuccessStatusCode();

        string responseXml = await response.Content.ReadAsStringAsync();

        // Parse SOAP response and extract Base64 PDF
        return ExtractPdfFromSoapResponse(responseXml);
    }
}
```

### 5. Extract PDF from SOAP Response

```csharp
private byte[] ExtractPdfFromSoapResponse(string soapXml)
{
    var xmlDoc = XDocument.Parse(soapXml);
    XNamespace ns = "http://xmlns.oracle.com/oxp/service/v2";

    // Check for SOAP fault
    var fault = xmlDoc.Descendants()
        .FirstOrDefault(e => e.Name.LocalName == "Fault");

    if (fault != null)
    {
        var faultString = fault.Descendants()
            .FirstOrDefault(e => e.Name.LocalName == "faultstring")?.Value;
        throw new Exception($"SOAP Fault: {faultString}");
    }

    // Extract reportBytes element
    var reportBytes = xmlDoc.Descendants(ns + "reportBytes").FirstOrDefault();

    if (reportBytes == null)
        throw new Exception("No reportBytes found in SOAP response");

    string base64Content = reportBytes.Value;

    // Clean Base64 content (remove whitespace, newlines, etc.)
    base64Content = base64Content
        .Replace("\n", "")
        .Replace("\r", "")
        .Replace("\t", "")
        .Replace(" ", "");

    return Convert.FromBase64String(base64Content);
}
```

---

## Configuration

### URLs by Instance

| Instance | URL |
|----------|-----|
| TEST | `https://efmh-test.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService` |
| PROD | `https://efmh.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService` |

### Report Details

- **Report Path**: `/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo`
- **Parameter Name**: `SOURCE_CODE`
- **Parameter Value**: Order Number (from JavaScript)

### Credentials

Store credentials securely in app settings or configuration file:

```json
{
  "FusionReports": {
    "TEST": {
      "Username": "your-test-username",
      "Password": "your-test-password"
    },
    "PROD": {
      "Username": "your-prod-username",
      "Password": "your-prod-password"
    }
  }
}
```

---

## Error Handling

### Common Errors

1. **SOAP Fault**: Report not found, invalid credentials
   - Return error message from SOAP fault to JavaScript
   - Log full error details

2. **Network Timeout**: Fusion server slow or unreachable
   - Set appropriate timeout (5 minutes recommended)
   - Show "Generating report, please wait..." message

3. **Invalid Base64**: Malformed response
   - Validate Base64 before converting
   - Log raw response for debugging

4. **File Save Error**: Permission denied, disk full
   - Try alternate location
   - Return error to JavaScript

### Error Response Format

Always send error back to JavaScript in this format:

```csharp
new
{
    success = false,
    message = "User-friendly error message here",
    technicalDetails = ex.ToString() // Optional for debugging
}
```

---

## Testing

### Test with Postman

Use the SOAP request structure from above to test Fusion BI Publisher directly:

1. Create new POST request
2. URL: `https://efmh-test.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService`
3. Headers:
   - `Content-Type: text/xml`
   - `SOAPAction: runReport`
4. Body: Use SOAP XML from above
5. Check response for `<v2:reportBytes>` with Base64 PDF

### Test from Application

1. Open Trip Details
2. Click Print icon on any Store to Van order
3. Verify PDF downloads to Downloads folder
4. Open PDF and verify content matches order number

---

## Integration with Existing FusionPdfDownloader

If you already have `FusionPdfDownloader` class, you can extend it:

```csharp
public class FusionPdfDownloader
{
    private const string TEST_URL = "https://efmh-test.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService";
    private const string PROD_URL = "https://efmh.fa.em3.oraclecloud.com/xmlpserver/services/v2/ReportService";

    // Existing report path
    private const string SALES_ORDER_REPORT_PATH = "/Custom/OQ/GR_SalesOrder_Rep.xdo";

    // New report path
    private const string STORE_TRANSACTION_REPORT_PATH = "/Custom/DEXPRESS/STORETRANSACTIONS/GRAYS_MATERIAL_TRANSACTIONS_BIP.xdo";

    // Add new method
    public async Task<byte[]> GenerateStoreTransactionReport(
        string orderNumber,
        string instance = "TEST")
    {
        string serviceUrl = instance == "PROD" ? PROD_URL : TEST_URL;

        var parameters = new Dictionary<string, string>
        {
            { "SOURCE_CODE", orderNumber }
        };

        return await GenerateReport(
            serviceUrl,
            STORE_TRANSACTION_REPORT_PATH,
            parameters,
            instance
        );
    }
}
```

---

## JavaScript Callback

The JavaScript expects either:

1. **Success**: `{ success: true, message: "..." }`
2. **Error**: Error string or `{ success: false, message: "..." }`

Example successful callback:
```javascript
{
    success: true,
    message: "Report saved to Downloads: StoreTransaction_123456_20251120_143522.pdf",
    filePath: "C:\\Users\\YourName\\Downloads\\StoreTransaction_123456_20251120_143522.pdf"
}
```

---

## Summary

**What's Already Done (JavaScript)**:
- ✅ Print icons added to grid and modal
- ✅ Loading indicator while generating
- ✅ Sends correct parameters to C# handler
- ✅ Handles success/error responses

**What Needs Implementation (C# WebView)**:
- ⚠️ Add case handler for `action: 'printStoreTransaction'`
- ⚠️ Build SOAP request with parameters
- ⚠️ Call Fusion BI Publisher SOAP service
- ⚠️ Extract Base64 PDF from SOAP response
- ⚠️ Save PDF to Downloads folder
- ⚠️ Return success/error to JavaScript

**Testing Checklist**:
- [ ] Test with TEST instance
- [ ] Test with PROD instance
- [ ] Verify PDF content is correct
- [ ] Test error handling (invalid order, network error)
- [ ] Verify file saved to Downloads folder
- [ ] Check PDF opens correctly

---

**Created**: 2025-11-20
**Related Files**:
- `wms/app.js` - JavaScript implementation (lines 2493, 3373, 3202-3261)
- C# WebView Handler - To be implemented

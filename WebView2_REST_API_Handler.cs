// ============================================================================
// WebView2 REST API Handler for WMS Application
// ============================================================================
//
// Add this code to your C# WebView2 Form (e.g., Form1.cs or WMSForm.cs)
// This handles REST API calls from JavaScript to bypass CORS restrictions
//
// ============================================================================

using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace YourNamespace
{
    public partial class YourFormName : Form
    {
        private static readonly HttpClient httpClient = new HttpClient();

        // Add this in your Form constructor or initialization method
        private void InitializeWebView2MessageHandler()
        {
            // Subscribe to WebMessageReceived event
            webView2Control.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
        }

        // Event handler for messages from JavaScript
        private async void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string messageJson = e.WebMessageAsJson;
                using JsonDocument document = JsonDocument.Parse(messageJson);
                JsonElement root = document.RootElement;

                // Check if this is a REST API call request
                if (root.TryGetProperty("type", out JsonElement typeElement) &&
                    typeElement.GetString() == "REST_API_CALL")
                {
                    string url = root.GetProperty("url").GetString();
                    string method = root.GetProperty("method").GetString();
                    string callback = root.GetProperty("callback").GetString();

                    // Make the REST API call
                    await HandleRestApiCall(url, method, callback);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error handling web message: {ex.Message}");

                // Send error back to JavaScript
                string errorScript = $"console.error('[WebView2] REST API Error: {ex.Message}');";
                await webView2Control.ExecuteScriptAsync(errorScript);
            }
        }

        // Handle REST API calls
        private async Task HandleRestApiCall(string url, string method, string callback)
        {
            try
            {
                HttpResponseMessage response;

                if (method.ToUpper() == "GET")
                {
                    response = await httpClient.GetAsync(url);
                }
                else if (method.ToUpper() == "POST")
                {
                    // For POST requests, you might need to include body data
                    response = await httpClient.PostAsync(url, null);
                }
                else
                {
                    throw new NotSupportedException($"HTTP method {method} not supported");
                }

                response.EnsureSuccessStatusCode();
                string responseData = await response.Content.ReadAsStringAsync();

                // Call the JavaScript callback with the data
                string escapedData = JsonSerializer.Serialize(responseData);
                string script = $"{callback}(JSON.parse({escapedData}));";

                await webView2Control.ExecuteScriptAsync(script);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error making REST API call to {url}: {ex.Message}");

                // Send error to JavaScript
                string errorScript = $"console.error('[WebView2] Failed to fetch {url}: {ex.Message}');";
                await webView2Control.ExecuteScriptAsync(errorScript);
            }
        }
    }
}

// ============================================================================
// USAGE INSTRUCTIONS:
// ============================================================================
//
// 1. Add this code to your WebView2 Form class
//
// 2. Replace 'YourNamespace' with your actual namespace
//
// 3. Replace 'YourFormName' with your actual form class name
//
// 4. Replace 'webView2Control' with your actual WebView2 control name
//
// 5. Call InitializeWebView2MessageHandler() after WebView2 is initialized
//    Example:
//    private async void Form1_Load(object sender, EventArgs e)
//    {
//        await webView21.EnsureCoreWebView2Async();
//        InitializeWebView2MessageHandler();
//        webView21.Source = new Uri("file:///path/to/wms/index.html");
//    }
//
// 6. Make sure you have these NuGet packages installed:
//    - Microsoft.Web.WebView2
//    - System.Net.Http.Json (optional, for easier JSON handling)
//
// ============================================================================

using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Text.Json;

namespace commet_like
{
    /// <summary>
    /// Handles communication between JavaScript and C# in WebView2
    /// </summary>
    public class WebViewMessageRouter
    {
        private readonly RestApiClient _restApiClient;
        private readonly WebView2 _webView;

        public WebViewMessageRouter(WebView2 webView, RestApiClient restApiClient = null)
        {
            _webView = webView ?? throw new ArgumentNullException(nameof(webView));
            _restApiClient = restApiClient ?? new RestApiClient();
            _webView.CoreWebView2InitializationCompleted += OnCoreWebView2InitializationCompleted;
        }

        private void OnCoreWebView2InitializationCompleted(object sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (e.IsSuccess && _webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                _webView.CoreWebView2.Settings.IsWebMessageEnabled = true;
            }
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var messageJson = e.WebMessageAsJson;
                System.Diagnostics.Debug.WriteLine($"[RECEIVED MESSAGE] {messageJson}");

                var message = JsonSerializer.Deserialize<WebMessage>(messageJson);
                ProcessMessage(message);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[ERROR] Message processing failed: {ex.Message}");
                SendErrorResponse($"Message processing error: {ex.Message}");
            }
        }

        private void ProcessMessage(WebMessage message)
        {
            System.Diagnostics.Debug.WriteLine($"[PROCESSING] Action: {message.Action}, URL: {message.FullUrl}");

            switch (message.Action?.ToLower())
            {
                case "executeget":
                    HandleExecuteGet(message);
                    break;
                default:
                    SendErrorResponse($"Unknown action: {message.Action}");
                    break;
            }
        }

        private void HandleExecuteGet(WebMessage message)
        {
            try
            {
                if (string.IsNullOrEmpty(message.FullUrl))
                {
                    SendErrorResponse("FullUrl parameter is required");
                    return;
                }

                // Execute async operation
                _ = Task.Run(async () =>
                {
                    try
                    {
                        System.Diagnostics.Debug.WriteLine($"[REST CALL] Starting GET request to: {message.FullUrl}");

                        var responseData = await _restApiClient.ExecuteGetAsync(message.FullUrl);

                        System.Diagnostics.Debug.WriteLine($"[REST CALL] Success! Response length: {responseData?.Length ?? 0}");

                        var response = new WebResponse
                        {
                            Action = "restResponse",
                            RequestId = message.RequestId,
                            Data = responseData
                        };

                        _webView.Invoke((MethodInvoker)delegate {
                            if (_webView.CoreWebView2 != null)
                            {
                                _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                            }
                        });
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"[REST CALL] FAILED: {ex.Message}");
                        _webView.Invoke((MethodInvoker)delegate {
                            SendErrorResponse($"API call failed: {ex.Message}", message.RequestId);
                        });
                    }
                });
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[HANDLE EXECUTE] Setup failed: {ex.Message}");
                SendErrorResponse($"API call setup failed: {ex.Message}", message.RequestId);
            }
        }

        private void SendErrorResponse(string errorMessage, string requestId = null)
        {
            var response = new WebResponse
            {
                Action = "error",
                RequestId = requestId,
                Data = new { message = errorMessage }
            };

            if (_webView.CoreWebView2 != null)
            {
                _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
            }
        }

        public void Dispose()
        {
            _restApiClient?.Dispose();
            if (_webView?.CoreWebView2 != null)
            {
                _webView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
            }
            _webView.CoreWebView2InitializationCompleted -= OnCoreWebView2InitializationCompleted;
        }
    }
    // Message classes for communication
    public class WebMessage
    {
        public string Action { get; set; }
        public string RequestId { get; set; }
        public string FullUrl { get; set; }
        public string ModuleCode { get; set; }
        public object Parameters { get; set; }
    }

    public class WebResponse
    {
        public string Action { get; set; }
        public string RequestId { get; set; }
        public object Data { get; set; }
    }
}
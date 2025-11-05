using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace WMSApp
{
    /// <summary>
    /// Handles all Claude API operations for the WebView2 application
    /// </summary>
    public class ClaudeApiHandler
    {
        private readonly HttpClient _httpClient;
        private const string CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
        private const string CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
        private const string ANTHROPIC_VERSION = "2023-06-01";

        public ClaudeApiHandler()
        {
            _httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(120)
            };
        }

        /// <summary>
        /// Tests if the provided API key is valid
        /// </summary>
        public async Task<ClaudeTestResponse> TestApiKeyAsync(string apiKey)
        {
            try
            {
                var request = new ClaudeApiRequest
                {
                    Model = CLAUDE_MODEL,
                    MaxTokens = 10,
                    Messages = new[]
                    {
                        new ClaudeMessage { Role = "user", Content = "Hi" }
                    }
                };

                var response = await SendClaudeRequestAsync(apiKey, request);

                return new ClaudeTestResponse
                {
                    Success = true,
                    Message = "API key is valid"
                };
            }
            catch (HttpRequestException ex)
            {
                return new ClaudeTestResponse
                {
                    Success = false,
                    Message = $"HTTP Error: {ex.Message}"
                };
            }
            catch (Exception ex)
            {
                return new ClaudeTestResponse
                {
                    Success = false,
                    Message = $"Error: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Sends a query to Claude API with warehouse data
        /// </summary>
        public async Task<ClaudeQueryResponse> QueryClaudeAsync(
            string apiKey,
            string userQuery,
            string systemPrompt,
            string dataJson)
        {
            try
            {
                var request = new ClaudeApiRequest
                {
                    Model = CLAUDE_MODEL,
                    MaxTokens = 4096,
                    System = systemPrompt,
                    Messages = new[]
                    {
                        new ClaudeMessage
                        {
                            Role = "user",
                            Content = $"Data: {dataJson}\n\nQuestion: {userQuery}"
                        }
                    }
                };

                var responseJson = await SendClaudeRequestAsync(apiKey, request);

                return new ClaudeQueryResponse
                {
                    Success = true,
                    ResponseJson = responseJson
                };
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                return new ClaudeQueryResponse
                {
                    Success = false,
                    Error = "Invalid API key. Please check your key at console.anthropic.com"
                };
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                return new ClaudeQueryResponse
                {
                    Success = false,
                    Error = "Rate limit exceeded or insufficient credits"
                };
            }
            catch (Exception ex)
            {
                return new ClaudeQueryResponse
                {
                    Success = false,
                    Error = $"Error: {ex.Message}"
                };
            }
        }

        /// <summary>
        /// Sends the actual HTTP request to Claude API
        /// </summary>
        private async Task<string> SendClaudeRequestAsync(string apiKey, ClaudeApiRequest request)
        {
            using (var httpRequest = new HttpRequestMessage(HttpMethod.Post, CLAUDE_API_URL))
            {
                // Set headers
                httpRequest.Headers.Add("x-api-key", apiKey);
                httpRequest.Headers.Add("anthropic-version", ANTHROPIC_VERSION);

                // Serialize request body
                var jsonOptions = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
                };

                string jsonContent = JsonSerializer.Serialize(request, jsonOptions);
                httpRequest.Content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

                System.Diagnostics.Debug.WriteLine($"[Claude API] Sending request to {CLAUDE_API_URL}");

                // Send request
                var response = await _httpClient.SendAsync(httpRequest);
                var responseContent = await response.Content.ReadAsStringAsync();

                System.Diagnostics.Debug.WriteLine($"[Claude API] Response status: {response.StatusCode}");

                if (!response.IsSuccessStatusCode)
                {
                    throw new HttpRequestException(
                        $"API returned {response.StatusCode}: {responseContent}",
                        null,
                        response.StatusCode
                    );
                }

                return responseContent;
            }
        }

        public void Dispose()
        {
            _httpClient?.Dispose();
        }
    }

    #region Request/Response Models

    public class ClaudeApiRequest
    {
        [JsonPropertyName("model")]
        public string Model { get; set; }

        [JsonPropertyName("max_tokens")]
        public int MaxTokens { get; set; }

        [JsonPropertyName("system")]
        public string System { get; set; }

        [JsonPropertyName("messages")]
        public ClaudeMessage[] Messages { get; set; }
    }

    public class ClaudeMessage
    {
        [JsonPropertyName("role")]
        public string Role { get; set; }

        [JsonPropertyName("content")]
        public string Content { get; set; }
    }

    public class ClaudeTestResponse
    {
        public bool Success { get; set; }
        public string Message { get; set; }
    }

    public class ClaudeQueryResponse
    {
        public bool Success { get; set; }
        public string ResponseJson { get; set; }
        public string Error { get; set; }
    }

    #endregion

    #region WebView Message Models

    public class ClaudeApiTestMessage
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("requestId")]
        public string RequestId { get; set; }

        [JsonPropertyName("apiKey")]
        public string ApiKey { get; set; }
    }

    public class ClaudeApiRequestMessage
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("requestId")]
        public string RequestId { get; set; }

        [JsonPropertyName("apiKey")]
        public string ApiKey { get; set; }

        [JsonPropertyName("userQuery")]
        public string UserQuery { get; set; }

        [JsonPropertyName("systemPrompt")]
        public string SystemPrompt { get; set; }

        [JsonPropertyName("dataJson")]
        public string DataJson { get; set; }
    }

    #endregion
}
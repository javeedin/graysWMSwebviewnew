using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace commet_like
{
    /// <summary>
    /// Generic REST API client that handles GET requests
    /// </summary>
    public class RestApiClient
    {
        private readonly HttpClient _httpClient;

        public RestApiClient(HttpClient httpClient = null)
        {
            _httpClient = httpClient ?? new HttpClient();
            _httpClient.Timeout = TimeSpan.FromSeconds(30);
        }

        public async Task<string> ExecuteGetAsync(string fullUrl)
        {
            if (string.IsNullOrWhiteSpace(fullUrl))
                throw new ArgumentException("URL cannot be null or empty", nameof(fullUrl));

            try
            {
                System.Diagnostics.Debug.WriteLine($"[HTTP CLIENT] Making GET request to: {fullUrl}");

                var response = await _httpClient.GetAsync(fullUrl);

                System.Diagnostics.Debug.WriteLine($"[HTTP CLIENT] Response status: {response.StatusCode}");

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    System.Diagnostics.Debug.WriteLine($"[HTTP CLIENT] Error content: {errorContent}");
                    throw new HttpRequestException($"HTTP {response.StatusCode}: {response.ReasonPhrase}. Content: {errorContent}");
                }

                var jsonResponse = await response.Content.ReadAsStringAsync();
                System.Diagnostics.Debug.WriteLine($"[HTTP CLIENT] Response received, length: {jsonResponse.Length}");
                return jsonResponse;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[HTTP CLIENT] Exception: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"[HTTP CLIENT] Stack trace: {ex.StackTrace}");
                throw;
            }
        }

        public void Dispose()
        {
            _httpClient?.Dispose();
        }
    }
}
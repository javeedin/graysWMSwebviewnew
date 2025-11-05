using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace commet_like
{
    /// <summary>
    /// Downloads HTML files from Oracle APEX and saves them to local temp directory
    /// Returns file:// URLs that can be used with WebView2 Navigate() method
    /// </summary>
    public class ApexHtmlFileDownloader
    {
        private readonly HttpClient _httpClient;
        private readonly string _tempDirectory;
        private ApexHtmlFileDownloader _apexDownloader;

        /// <summary>
        /// Initializes a new instance of the ApexHtmlFileDownloader class
        /// </summary>
        public ApexHtmlFileDownloader()
        {
            _httpClient = new HttpClient();
            _httpClient.Timeout = TimeSpan.FromSeconds(30);

            // Create temp directory for APEX HTML files
            _tempDirectory = Path.Combine(Path.GetTempPath(), "CommetApexHtml");
            Directory.CreateDirectory(_tempDirectory);
        }

        /// <summary>
        /// Downloads an HTML file from APEX URL and returns a local file:// URL
        /// </summary>
        /// <param name="apexHtmlUrl">Full URL to the HTML file hosted in Oracle APEX</param>
        /// <param name="localFileName">Local filename to save as (e.g., "warehouse.html")</param>
        /// <returns>Local file:// URL that can be passed to Navigate() method</returns>
        /// <exception cref="Exception">Thrown when download fails</exception>
        public async Task<string> DownloadApexHtmlFileAsync(string apexHtmlUrl, string localFileName)
        {
            if (string.IsNullOrWhiteSpace(apexHtmlUrl))
                throw new ArgumentException("APEX HTML URL cannot be null or empty", nameof(apexHtmlUrl));

            if (string.IsNullOrWhiteSpace(localFileName))
                throw new ArgumentException("Local filename cannot be null or empty", nameof(localFileName));

            try
            {
                // Download HTML content from APEX
                string htmlContent = await _httpClient.GetStringAsync(apexHtmlUrl);

                // Sanitize filename to remove invalid characters
                string safeFileName = string.Join("_", localFileName.Split(Path.GetInvalidFileNameChars()));
                string localFilePath = Path.Combine(_tempDirectory, safeFileName);

                // Save to local file
                File.WriteAllText(localFilePath, htmlContent);

                // Return file:// URL for WebView2
                return $"file:///{localFilePath.Replace("\\", "/")}";
            }
            catch (HttpRequestException httpEx)
            {
                throw new Exception($"Failed to download HTML file from APEX. HTTP Error: {httpEx.Message}", httpEx);
            }
            catch (TaskCanceledException timeoutEx)
            {
                throw new Exception($"Timeout while downloading HTML file from APEX: {timeoutEx.Message}", timeoutEx);
            }
            catch (Exception ex)
            {
                throw new Exception($"Unexpected error downloading HTML file from APEX: {ex.Message}", ex);
            }
        }

        /// <summary>
        /// Gets the full local file path for a given filename
        /// </summary>
        /// <param name="fileName">The filename to get path for</param>
        /// <returns>Full local file path</returns>
        public string GetLocalFilePath(string fileName)
        {
            string safeFileName = string.Join("_", fileName.Split(Path.GetInvalidFileNameChars()));
            return Path.Combine(_tempDirectory, safeFileName);
        }

        /// <summary>
        /// Cleans up the temp directory (optional - files will be cleaned by OS eventually)
        /// </summary>
        public void CleanupTempFiles()
        {
            try
            {
                if (Directory.Exists(_tempDirectory))
                {
                    Directory.Delete(_tempDirectory, true);
                }
            }
            catch
            {
                // Ignore cleanup errors
            }
        }

        /// <summary>
        /// Disposes the HTTP client
        /// </summary>
        public void Dispose()
        {
            _httpClient?.Dispose();
        }
    }
}
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;

namespace FusionUpdater
{
    public class ReleaseInfo
    {
        public string TagName { get; set; } = "";
        public string Version { get; set; } = "";
        public string DownloadUrl { get; set; } = "";
        public string ReleaseNotes { get; set; } = "";
        public DateTime PublishedAt { get; set; }
    }

    public class UpdateChecker
    {
        private readonly UpdaterConfig _config;
        private readonly HttpClient _httpClient;

        public UpdateChecker(UpdaterConfig config)
        {
            _config = config;
            _httpClient = new HttpClient();
            _httpClient.DefaultRequestHeaders.UserAgent.Add(
                new ProductInfoHeaderValue("FusionUpdater", "1.0"));
            if (!string.IsNullOrEmpty(config.GitHubToken))
                _httpClient.DefaultRequestHeaders.Authorization =
                    new AuthenticationHeaderValue("Bearer", config.GitHubToken);
        }

        public string GetLocalVersion()
        {
            try
            {
                var versionFile = Path.Combine(_config.InstallDirectory, "version.json");
                if (!File.Exists(versionFile)) return "0.0.0";
                var json = File.ReadAllText(versionFile);
                var obj = JObject.Parse(json);
                return obj["version"]?.ToString() ?? "0.0.0";
            }
            catch
            {
                return "0.0.0";
            }
        }

        public async Task<ReleaseInfo?> GetLatestReleaseAsync()
        {
            try
            {
                var url = $"https://api.github.com/repos/{_config.GitHubOwner}/{_config.GitHubRepo}/releases/latest";
                var response = await _httpClient.GetStringAsync(url);
                var release = JObject.Parse(response);

                var tagName = release["tag_name"]?.ToString() ?? "";
                var version = tagName.TrimStart('v');
                var notes = release["body"]?.ToString() ?? "";
                var publishedAt = release["published_at"]?.ToObject<DateTime>() ?? DateTime.MinValue;

                // Find the fusionclient.zip asset
                var assets = release["assets"] as JArray;
                string downloadUrl = "";
                if (assets != null)
                {
                    foreach (var asset in assets)
                    {
                        var name = asset["name"]?.ToString() ?? "";
                        if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                        {
                            downloadUrl = asset["url"]?.ToString() ?? "";
                            break;
                        }
                    }
                }

                if (string.IsNullOrEmpty(downloadUrl)) return null;

                return new ReleaseInfo
                {
                    TagName = tagName,
                    Version = version,
                    DownloadUrl = downloadUrl,
                    ReleaseNotes = notes,
                    PublishedAt = publishedAt
                };
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[UpdateChecker] Failed: {ex.Message}");
                return null;
            }
        }

        public static bool IsNewer(string remoteVersion, string localVersion)
        {
            try
            {
                var remote = new Version(remoteVersion);
                var local = new Version(localVersion);
                return remote > local;
            }
            catch
            {
                return string.Compare(remoteVersion, localVersion, StringComparison.Ordinal) > 0;
            }
        }

        public async Task<(bool hasUpdate, ReleaseInfo? release)> CheckForUpdateAsync()
        {
            var local = GetLocalVersion();
            var release = await GetLatestReleaseAsync();
            if (release == null) return (false, null);
            var hasUpdate = IsNewer(release.Version, local);
            return (hasUpdate, release);
        }
    }
}

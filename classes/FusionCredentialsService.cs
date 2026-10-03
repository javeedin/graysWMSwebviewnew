using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// Central source of Oracle Fusion credentials for the whole application.
    /// Credentials are fetched from the ARMODULE/fusion webservice and cached
    /// in memory — nothing is hardcoded and nothing is written to disk.
    /// Response format: { "items": [ { "username": "...", "password1": "..." } ] }
    /// </summary>
    public static class FusionCredentialsService
    {
        private const string CREDENTIALS_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/ARMODULE/fusion";

        private static readonly SemaphoreSlim _lock = new SemaphoreSlim(1, 1);
        private static string _username;
        private static string _password;

        public static bool IsLoaded =>
            !string.IsNullOrEmpty(_username) && !string.IsNullOrEmpty(_password);

        public static string Username => _username;
        public static string Password => _password;

        /// <summary>
        /// Returns cached credentials, fetching them from the webservice on first use.
        /// Returns (null, null) if the webservice is unreachable or returns no items.
        /// </summary>
        public static async Task<(string Username, string Password)> GetAsync()
        {
            if (IsLoaded)
            {
                return (_username, _password);
            }

            await _lock.WaitAsync().ConfigureAwait(false);
            try
            {
                if (IsLoaded)
                {
                    return (_username, _password);
                }

                using (var client = new HttpClient())
                {
                    client.Timeout = TimeSpan.FromSeconds(30);
                    var response = await client.GetAsync(CREDENTIALS_URL).ConfigureAwait(false);

                    if (!response.IsSuccessStatusCode)
                    {
                        System.Diagnostics.Debug.WriteLine($"[FusionCredentialsService] ERROR - HTTP {response.StatusCode}");
                        return (null, null);
                    }

                    string json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

                    using (var doc = JsonDocument.Parse(json))
                    {
                        var items = doc.RootElement.GetProperty("items");
                        foreach (var item in items.EnumerateArray())
                        {
                            string user = item.TryGetProperty("username", out var userProp) ? userProp.GetString() : null;
                            string pass = item.TryGetProperty("password1", out var passProp) ? passProp.GetString() : null;

                            if (!string.IsNullOrEmpty(user) && !string.IsNullOrEmpty(pass))
                            {
                                _username = user;
                                _password = pass;
                                System.Diagnostics.Debug.WriteLine($"[FusionCredentialsService] Credentials loaded for user: {user}");
                                return (_username, _password);
                            }
                        }
                    }

                    System.Diagnostics.Debug.WriteLine("[FusionCredentialsService] WARNING - No valid credentials in response");
                    return (null, null);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[FusionCredentialsService] ERROR - {ex.Message}");
                return (null, null);
            }
            finally
            {
                _lock.Release();
            }
        }

        /// <summary>
        /// Synchronous bridge for legacy non-async callers. Uses the in-memory
        /// cache when warm; otherwise blocks on a background fetch.
        /// </summary>
        public static (string Username, string Password) Get()
        {
            if (IsLoaded)
            {
                return (_username, _password);
            }
            return Task.Run(() => GetAsync()).GetAwaiter().GetResult();
        }
    }
}

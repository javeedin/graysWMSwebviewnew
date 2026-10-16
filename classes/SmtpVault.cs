using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WMSApp
{
    /// <summary>
    /// SMTP account for mails the app sends (AI Digital Employee, jobs, Agent Flow). The password is
    /// DPAPI-encrypted for the Windows user in %APPDATA%\GraysWMS\smtp.json - pages keep only server,
    /// port and username, and send an empty password; the host fills it in here.
    /// </summary>
    public static class SmtpVault
    {
        private static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "smtp.json");

        private class Stored { public string Server { get; set; } public int Port { get; set; } public string Username { get; set; } public string Password { get; set; } }

        public static void Save(string server, int port, string username, string password)
        {
            var old = Read();
            string enc = !string.IsNullOrEmpty(password)
                ? Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(password), null, DataProtectionScope.CurrentUser))
                : (old != null && string.Equals(old.Username, username, StringComparison.OrdinalIgnoreCase) ? old.Password : null);
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
            File.WriteAllText(FilePath, JsonSerializer.Serialize(new Stored
            {
                Server = string.IsNullOrWhiteSpace(server) ? "smtp.office365.com" : server.Trim(),
                Port = port > 0 ? port : 587,
                Username = (username ?? "").Trim(),
                Password = enc
            }));
        }

        private static Stored Read()
        {
            try { return File.Exists(FilePath) ? JsonSerializer.Deserialize<Stored>(File.ReadAllText(FilePath)) : null; }
            catch { return null; }
        }

        /// <summary>The saved password for this username (blank username = the saved account), else null.</summary>
        public static string PasswordFor(string username)
        {
            var s = Read();
            if (s == null || string.IsNullOrEmpty(s.Password)) return null;
            if (!string.IsNullOrWhiteSpace(username) && !string.Equals(s.Username, username.Trim(), StringComparison.OrdinalIgnoreCase)) return null;
            try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s.Password), null, DataProtectionScope.CurrentUser)); }
            catch { return null; }
        }

        public static object Status()
        {
            var s = Read();
            return new { username = s?.Username ?? "", server = s?.Server ?? "smtp.office365.com", port = s?.Port ?? 587, hasPassword = !string.IsNullOrEmpty(s?.Password) };
        }
    }
}

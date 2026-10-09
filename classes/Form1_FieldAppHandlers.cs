using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;

namespace WMSApp
{
    /// <summary>
    /// Field Apps (fieldapps/index.html) — host side of the apps the desktop publishes to the pickers' phones.
    /// The page keeps everything in APEX through the gateway; the host only does what a page cannot:
    ///   fieldAppKeys    the signing key pair of this PC (ECDSA P-256; private key DPAPI-protected, public key as SPKI base64 + key id)
    ///   fieldAppSign    signs "appId.version.sha256(code).sha256(manifest)" (AI admins only, audited) — the phone verifies with the public key
    ///   fieldAppFetch   GET of an APEX ORDS URL as base64 (a photo a phone uploaded, served by field/photos/:id)
    ///   fieldAppUpload  POST of binary bytes to an APEX ORDS URL (the desktop preview's photos go to field/photos like a phone's)
    /// Replies: { action: "fieldAppResponse", requestId, data }.
    /// </summary>
    public partial class Form1
    {
        private static bool IsFieldAppAction(string action) =>
            action != null && action.StartsWith("fieldApp", StringComparison.Ordinal) && action.Length > 8 && char.IsUpper(action[8]);

        private static readonly string FieldAppsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "FieldApps");
        private static string FieldAppsKeyFile => Path.Combine(FieldAppsRoot, "signing.key");
        private static string FieldAppsPubFile => Path.Combine(FieldAppsRoot, "signing.pub");
        private static readonly HttpClient FieldAppsHttp = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };

        private async Task HandleFieldAppAction(WebView2 wv, string action, JsonElement root, string requestId)
        {
            object data;
            string user = PStr(root, "appUser");
            if (string.IsNullOrWhiteSpace(user) || user == "UNKNOWN") user = Environment.UserName;
            try
            {
                switch (action)
                {
                    case "fieldAppKeys":
                    {
                        bool admin = await AiControl.IsAdminAsync(user);
                        var k = FieldAppsLoadKeys(create: admin && PBool(root, "create"));
                        data = k == null ? new { ok = true, admin, exists = false } : new { ok = true, admin, exists = true, keyId = k.Value.KeyId, spki = k.Value.Spki, created = k.Value.Created };
                        break;
                    }
                    case "fieldAppSign":
                    {
                        if (!await AiControl.IsAdminAsync(user)) { data = new { ok = false, error = "Only an AI admin can sign and publish an app." }; break; }
                        string payload = PStr(root, "payload");
                        if (string.IsNullOrWhiteSpace(payload) || payload.Length > 400) { data = new { ok = false, error = "Nothing to sign." }; break; }
                        var k = FieldAppsLoadKeys(create: true);
                        if (k == null) { data = new { ok = false, error = "No signing key on this PC." }; break; }
                        string sig = FieldAppsSign(payload);
                        AiControl.Audit(new AiControl.AuditEvent { User = user, Source = "FIELDAPPS", Action = "field_app_sign", Target = (PStr(root, "appId") ?? "") + " v" + (PStr(root, "version") ?? ""), Detail = payload });
                        data = new { ok = true, signature = sig, keyId = k.Value.KeyId, spki = k.Value.Spki };
                        break;
                    }
                    case "fieldAppFetch":
                    {
                        string url = PStr(root, "url");
                        if (!FieldAppsUrlOk(url, out string why)) { data = new { ok = false, error = why }; break; }
                        using var res = await FieldAppsHttp.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
                        if (!res.IsSuccessStatusCode) { string body = await res.Content.ReadAsStringAsync(); data = new { ok = false, status = (int)res.StatusCode, error = "HTTP " + (int)res.StatusCode + (body.Length > 0 ? " · " + body.Substring(0, Math.Min(body.Length, 300)) : "") }; break; }
                        long? len = res.Content.Headers.ContentLength;
                        if (len > 12_000_000) { data = new { ok = false, error = "The file is over 12 MB." }; break; }
                        byte[] bytes = await res.Content.ReadAsByteArrayAsync();
                        if (bytes.Length > 12_000_000) { data = new { ok = false, error = "The file is over 12 MB." }; break; }
                        data = new { ok = true, bytes = bytes.Length, mime = res.Content.Headers.ContentType?.MediaType ?? "application/octet-stream", base64 = Convert.ToBase64String(bytes) };
                        break;
                    }
                    case "fieldAppUpload":
                    {
                        string url = PStr(root, "url");
                        if (!FieldAppsUrlOk(url, out string why)) { data = new { ok = false, error = why }; break; }
                        string b64 = PStr(root, "base64") ?? "";
                        int comma = b64.IndexOf(','); if (b64.StartsWith("data:") && comma > 0) b64 = b64.Substring(comma + 1);
                        byte[] bytes;
                        try { bytes = Convert.FromBase64String(Regex.Replace(b64, @"\s+", "")); } catch { data = new { ok = false, error = "The picture is not valid base64." }; break; }
                        if (bytes.Length > 8_000_000) { data = new { ok = false, error = "The picture is over 8 MB." }; break; }
                        using var content = new ByteArrayContent(bytes);
                        content.Headers.ContentType = new MediaTypeHeaderValue(string.IsNullOrWhiteSpace(PStr(root, "mime")) ? "image/jpeg" : PStr(root, "mime"));
                        using var res = await FieldAppsHttp.PostAsync(url, content);
                        string body = await res.Content.ReadAsStringAsync();
                        data = new { ok = res.IsSuccessStatusCode, status = (int)res.StatusCode, body, error = res.IsSuccessStatusCode ? null : "HTTP " + (int)res.StatusCode + " · " + body.Substring(0, Math.Min(body.Length, 300)) };
                        break;
                    }
                    default:
                        data = new { ok = false, error = "Unknown action " + action };
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[FieldApps] " + action + ": " + ex);
                data = new { ok = false, error = ex.Message };
            }
            PostWebViewMessage(wv, JsonSerializer.Serialize(new { action = "fieldAppResponse", requestId, data }));
        }

        /// <summary>Only https URLs of the APEX ORDS host may be fetched or posted to (the phones' own handlers).</summary>
        private static bool FieldAppsUrlOk(string url, out string why)
        {
            why = null;
            if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https") { why = "Only https URLs are allowed."; return false; }
            bool host = uri.Host.EndsWith(".oraclecloudapps.com", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith(".oraclecloud.com", StringComparison.OrdinalIgnoreCase);
            if (!host || uri.AbsolutePath.IndexOf("/ords/", StringComparison.OrdinalIgnoreCase) < 0) { why = "Only the APEX ORDS endpoints can be used here."; return false; }
            return true;
        }

        private static (string KeyId, string Spki, string Created)? FieldAppsLoadKeys(bool create)
        {
            try
            {
                if (File.Exists(FieldAppsKeyFile) && File.Exists(FieldAppsPubFile))
                {
                    string pub = File.ReadAllText(FieldAppsPubFile).Trim();
                    return (FusionModel.Licensing.Licences.KeyIdOf(pub), pub, File.GetCreationTime(FieldAppsKeyFile).ToString("yyyy-MM-dd HH:mm"));
                }
                if (!create) return null;
                Directory.CreateDirectory(FieldAppsRoot);
                var pair = FusionModel.Licensing.Licences.CreateKeyPair();
                byte[] pem = Encoding.UTF8.GetBytes(pair.PrivatePem);
                byte[] stored = OperatingSystem.IsWindows() ? ProtectedData.Protect(pem, null, DataProtectionScope.CurrentUser) : pem;
                File.WriteAllText(FieldAppsKeyFile, (OperatingSystem.IsWindows() ? "dpapi:" : "plain:") + Convert.ToBase64String(stored));
                File.WriteAllText(FieldAppsPubFile, pair.PublicKey);
                return (FusionModel.Licensing.Licences.KeyIdOf(pair.PublicKey), pair.PublicKey, DateTime.Now.ToString("yyyy-MM-dd HH:mm"));
            }
            catch (Exception ex) { Debug.WriteLine("[FieldApps] keys: " + ex.Message); return null; }
        }

        private static string FieldAppsPrivatePem()
        {
            string raw = File.ReadAllText(FieldAppsKeyFile).Trim();
            int i = raw.IndexOf(':');
            string tag = i > 0 ? raw.Substring(0, i) : "plain", b64 = i > 0 ? raw.Substring(i + 1) : raw;
            byte[] bytes = Convert.FromBase64String(b64);
            if (tag == "dpapi") bytes = ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }

        /// <summary>ECDSA P-256 over SHA-256, signature as IEEE P1363 (r||s) base64 — what WebCrypto's verify expects.</summary>
        private static string FieldAppsSign(string payload)
        {
            using var ec = ECDsa.Create();
            ec.ImportFromPem(FieldAppsPrivatePem());
            return Convert.ToBase64String(ec.SignData(Encoding.UTF8.GetBytes(payload), HashAlgorithmName.SHA256));
        }
    }
}

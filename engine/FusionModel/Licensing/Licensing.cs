using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FusionModel.Licensing
{
    /// <summary>What a customer bought: who, which packs and features, how many users, which pods, until when.</summary>
    public sealed class LicenceInfo
    {
        public string Id { get; set; }
        public string Customer { get; set; }
        public string Edition { get; set; } = "standard";          // standard, enterprise, trial
        /// <summary>Fusion packs (gl, ap …); "*" = all.</summary>
        public List<string> Packs { get; set; } = new();
        /// <summary>server, mcp, ai, bicc, multipod …; "*" = all.</summary>
        public List<string> Features { get; set; } = new();
        public int MaxUsers { get; set; }                           // 0 = unlimited
        /// <summary>Fusion pod hosts the licence is for (empty = any).</summary>
        public List<string> Pods { get; set; } = new();
        public DateTime IssuedUtc { get; set; }
        public DateTime ExpiresUtc { get; set; }
    }

    /// <summary>licence.json: the licence and the vendor's ECDSA P-256 / SHA-256 signature over its canonical JSON.</summary>
    public sealed class LicenceFile
    {
        public LicenceInfo Licence { get; set; }
        public string KeyId { get; set; }
        public string Signature { get; set; }
    }

    public sealed class LicenceCheck
    {
        public bool Valid { get; set; }
        public string Reason { get; set; }
        public LicenceInfo Licence { get; set; }
        public int DaysLeft { get; set; }

        public bool Allows(string what, string kind = "feature")
        {
            if (!Valid || Licence == null) return false;
            var list = kind == "pack" ? Licence.Packs : Licence.Features;
            return list.Contains("*") || list.Any(x => string.Equals(x, what, StringComparison.OrdinalIgnoreCase));
        }

        public bool AllowsPod(string host) =>
            Valid && (Licence.Pods.Count == 0 || Licence.Pods.Any(p => string.Equals(p, host, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// Licence files signed by the vendor. The vendor creates a key pair once (<see cref="CreateKeyPair"/>, e.g.
    /// "FusionModel.Server licence keygen"), keeps the private key offline and builds the public key into
    /// <see cref="VendorPublicKey"/>. A build without a vendor key reports every licence as not verifiable.
    /// </summary>
    public static class Licences
    {
        /// <summary>The vendor's public key (SubjectPublicKeyInfo, base64). Set before building a product release.</summary>
        public const string VendorPublicKey = "";

        private static readonly JsonSerializerOptions Canonical = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never
        };

        /// <summary>The exact bytes that are signed: the licence as compact camelCase JSON, dates in UTC.</summary>
        public static byte[] CanonicalBytes(LicenceInfo l)
        {
            var copy = JsonSerializer.Deserialize<LicenceInfo>(JsonSerializer.Serialize(l, Canonical), Canonical)!;
            copy.IssuedUtc = DateTime.SpecifyKind(copy.IssuedUtc, DateTimeKind.Utc);
            copy.ExpiresUtc = DateTime.SpecifyKind(copy.ExpiresUtc, DateTimeKind.Utc);
            return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(copy, Canonical));
        }

        /// <summary>A new ECDSA P-256 key pair: private key (PKCS#8 PEM, keep it secret) and public key (base64 SPKI).</summary>
        public static (string PrivatePem, string PublicKey) CreateKeyPair()
        {
            using var ec = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            return (ec.ExportPkcs8PrivateKeyPem(), Convert.ToBase64String(ec.ExportSubjectPublicKeyInfo()));
        }

        public static string KeyIdOf(string publicKey) =>
            Convert.ToHexString(SHA256.HashData(Convert.FromBase64String(publicKey))).Substring(0, 12).ToLowerInvariant();

        public static LicenceFile Sign(LicenceInfo licence, string privatePem)
        {
            using var ec = ECDsa.Create();
            ec.ImportFromPem(privatePem);
            if (string.IsNullOrWhiteSpace(licence.Id)) licence.Id = Guid.NewGuid().ToString("N").Substring(0, 16);
            if (licence.IssuedUtc == default) licence.IssuedUtc = DateTime.UtcNow;
            string pub = Convert.ToBase64String(ec.ExportSubjectPublicKeyInfo());
            return new LicenceFile
            {
                Licence = licence,
                KeyId = KeyIdOf(pub),
                Signature = Convert.ToBase64String(ec.SignData(CanonicalBytes(licence), HashAlgorithmName.SHA256))
            };
        }

        public static LicenceCheck Verify(LicenceFile file, string publicKey = null, DateTime? nowUtc = null)
        {
            publicKey = string.IsNullOrWhiteSpace(publicKey) ? VendorPublicKey : publicKey;
            var r = new LicenceCheck { Licence = file?.Licence };
            if (file?.Licence == null || string.IsNullOrWhiteSpace(file.Signature)) { r.Reason = "No licence."; return r; }
            if (string.IsNullOrWhiteSpace(publicKey)) { r.Reason = "This build has no vendor key, so licences cannot be verified (development build)."; return r; }
            try
            {
                using var ec = ECDsa.Create();
                ec.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKey), out _);
                if (!ec.VerifyData(CanonicalBytes(file.Licence), Convert.FromBase64String(file.Signature), HashAlgorithmName.SHA256))
                { r.Reason = "The licence signature is not valid (the file was changed or is not from the vendor)."; return r; }
            }
            catch (Exception ex) { r.Reason = "The licence cannot be read: " + ex.Message; return r; }
            var now = nowUtc ?? DateTime.UtcNow;
            r.DaysLeft = (int)Math.Floor((file.Licence.ExpiresUtc - now).TotalDays);
            if (file.Licence.ExpiresUtc < now) { r.Reason = "The licence expired on " + file.Licence.ExpiresUtc.ToString("yyyy-MM-dd") + "."; return r; }
            r.Valid = true;
            r.Reason = file.Licence.Edition + " licence for " + file.Licence.Customer + ", " + r.DaysLeft + " days left";
            return r;
        }

        public static LicenceCheck VerifyFile(string path, string publicKey = null, DateTime? nowUtc = null)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return new LicenceCheck { Reason = "No licence file (" + path + ")." };
            try { return Verify(JsonSerializer.Deserialize<LicenceFile>(File.ReadAllText(path), Json.Options), publicKey, nowUtc); }
            catch (Exception ex) { return new LicenceCheck { Reason = "The licence file cannot be read: " + ex.Message }; }
        }
    }
}

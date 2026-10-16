using System.Security.Cryptography;
using System.Text;

namespace FusionModel.Access
{
    /// <summary>An API token of the model server: who it acts as (their security roles apply) and what it may do.</summary>
    public sealed class ApiToken
    {
        public string Id { get; set; }
        public string Name { get; set; }
        /// <summary>The app login the token acts as - row-level security of that user applies.</summary>
        public string User { get; set; }
        /// <summary>read (query, measures, search, checks, MCP) and/or admin (refresh).</summary>
        public List<string> Scopes { get; set; } = new() { "read" };
        /// <summary>SHA-256 of the token; the token itself is shown once and never stored.</summary>
        public string Hash { get; set; }
        public DateTime CreatedUtc { get; set; }
        public DateTime? LastUsedUtc { get; set; }
        public bool Revoked { get; set; }
    }

    /// <summary>tokens.json next to the server: hashed tokens only.</summary>
    public sealed class TokenStore
    {
        private readonly string _path;
        private readonly object _lock = new();
        private List<ApiToken> _tokens;
        private DateTime _lastSave = DateTime.MinValue;

        public TokenStore(string path) { _path = path; }

        public static string HashOf(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token ?? ""))).ToLowerInvariant();

        public List<ApiToken> All() { lock (_lock) return Load().Select(t => t).ToList(); }

        private List<ApiToken> Load() => _tokens ??= Json.Read<List<ApiToken>>(_path) ?? new List<ApiToken>();

        /// <summary>Creates a token and returns it in clear text - the only time it is visible.</summary>
        public (ApiToken Token, string Secret) Create(string name, string user, IEnumerable<string> scopes)
        {
            if (string.IsNullOrWhiteSpace(user)) throw new ArgumentException("A token acts as a user (--user).");
            string secret = "fm_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(30)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
            var t = new ApiToken
            {
                Id = Guid.NewGuid().ToString("N").Substring(0, 10), Name = string.IsNullOrWhiteSpace(name) ? user : name, User = user.Trim(),
                Scopes = (scopes ?? new[] { "read" }).Select(s => s.Trim().ToLowerInvariant()).Where(s => s is "read" or "admin").Distinct().ToList(),
                Hash = HashOf(secret), CreatedUtc = DateTime.UtcNow
            };
            if (t.Scopes.Count == 0) t.Scopes.Add("read");
            lock (_lock) { Load().Add(t); Json.WriteAtomic(_path, _tokens); }
            return (t, secret);
        }

        public bool Revoke(string id)
        {
            lock (_lock)
            {
                var t = Load().FirstOrDefault(x => x.Id == id);
                if (t == null) return false;
                t.Revoked = true;
                Json.WriteAtomic(_path, _tokens);
                return true;
            }
        }

        /// <summary>The token for a presented secret (constant-time compare), or null. Last-used is saved at most once a minute.</summary>
        public ApiToken Validate(string secret)
        {
            if (string.IsNullOrWhiteSpace(secret)) return null;
            var h = Encoding.ASCII.GetBytes(HashOf(secret.Trim()));
            lock (_lock)
            {
                var t = Load().FirstOrDefault(x => !x.Revoked && x.Hash != null && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(x.Hash), h));
                if (t == null) return null;
                t.LastUsedUtc = DateTime.UtcNow;
                if ((DateTime.UtcNow - _lastSave).TotalMinutes >= 1) { try { Json.WriteAtomic(_path, _tokens); _lastSave = DateTime.UtcNow; } catch { } }
                return t;
            }
        }

        /// <summary>Distinct users with a live token (for the licence's user limit).</summary>
        public int ActiveUsers() { lock (_lock) return Load().Where(t => !t.Revoked).Select(t => t.User.ToUpperInvariant()).Distinct().Count(); }
    }
}

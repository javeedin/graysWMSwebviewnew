using System.Globalization;
using System.Text.Json;
using FusionModel.Access;
using FusionModel.Licensing;

namespace FusionModel.Server
{
    /// <summary>Command line: API tokens (customer admins) and licences (show; keygen / sign for the vendor).</summary>
    public static class Cli
    {
        public static int Run(string[] args)
        {
            var o = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 2; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--")) continue;
                string k = args[i].Substring(2);
                if (i + 1 < args.Length && !args[i + 1].StartsWith("--")) o[k] = args[++i]; else flags.Add(k);
            }
            string Opt(string k) => o.TryGetValue(k, out var v) ? v : null;
            List<string> Csv(string k) => (Opt(k) ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
            var cfg = ServerConfig.Load();
            string cmd = args[0].ToLowerInvariant() == "license" ? "licence" : args[0].ToLowerInvariant();
            string sub = args.Length > 1 ? args[1].ToLowerInvariant() : "";
            try
            {
                switch (cmd + " " + sub)
                {
                    case "token add":
                        {
                            var store = new TokenStore(cfg.Abs(cfg.TokensPath));
                            var scopes = flags.Contains("admin") ? new[] { "read", "admin" } : new[] { "read" };
                            var (t, secret) = store.Create(Opt("name"), Opt("user"), scopes);
                            Console.WriteLine("Token " + t.Id + " for " + t.User + " (" + string.Join(", ", t.Scopes) + "):");
                            Console.WriteLine();
                            Console.WriteLine("  " + secret);
                            Console.WriteLine();
                            Console.WriteLine("Copy it now - it is not stored and cannot be shown again. Use: Authorization: Bearer <token>");
                            return 0;
                        }
                    case "token list":
                        foreach (var t in new TokenStore(cfg.Abs(cfg.TokensPath)).All())
                            Console.WriteLine($"{t.Id}  {t.User,-20} {t.Name,-24} {string.Join("+", t.Scopes),-11} created {t.CreatedUtc:yyyy-MM-dd}  last used {(t.LastUsedUtc?.ToString("yyyy-MM-dd HH:mm") ?? "never"),-16} {(t.Revoked ? "REVOKED" : "")}");
                        return 0;
                    case "token revoke":
                        Console.WriteLine(new TokenStore(cfg.Abs(cfg.TokensPath)).Revoke(Opt("id")) ? "Revoked." : "No token " + Opt("id"));
                        return 0;
                    case "licence show":
                        {
                            var c = Licences.VerifyFile(Opt("file") ?? cfg.Abs(cfg.LicencePath), Opt("pub"));
                            Console.WriteLine((c.Valid ? "VALID  " : "INVALID  ") + c.Reason);
                            if (c.Licence != null) Console.WriteLine(JsonSerializer.Serialize(c.Licence, Json.Options));
                            return c.Valid ? 0 : 2;
                        }
                    case "licence keygen":
                        {
                            var (priv, pub) = Licences.CreateKeyPair();
                            string dir = Opt("out") ?? Directory.GetCurrentDirectory();
                            Directory.CreateDirectory(dir);
                            string file = Path.Combine(dir, "vendor-private-" + Licences.KeyIdOf(pub) + ".pem");
                            File.WriteAllText(file, priv);
                            Console.WriteLine("Private key: " + file);
                            Console.WriteLine("  Keep it offline and backed up. Anyone with it can issue licences. Never commit it.");
                            Console.WriteLine("Public key (put it in engine/FusionModel/Licensing/Licensing.cs → Licences.VendorPublicKey, then build the release):");
                            Console.WriteLine("  " + pub);
                            return 0;
                        }
                    case "licence sign":
                        {
                            string key = Opt("key") ?? throw new ArgumentException("--key vendor-private.pem is required");
                            var info = new LicenceInfo
                            {
                                Customer = Opt("customer") ?? throw new ArgumentException("--customer is required"),
                                Edition = Opt("edition") ?? "standard",
                                Packs = o.ContainsKey("packs") ? Csv("packs") : new List<string> { "*" },
                                Features = o.ContainsKey("features") ? Csv("features") : new List<string> { "server", "mcp", "ai", "refresh", "bicc" },
                                MaxUsers = int.TryParse(Opt("users"), out var u) ? u : 0,
                                Pods = Csv("pods"),
                                ExpiresUtc = DateTime.SpecifyKind(DateTime.ParseExact(Opt("expires") ?? throw new ArgumentException("--expires yyyy-MM-dd is required"), "yyyy-MM-dd", CultureInfo.InvariantCulture), DateTimeKind.Utc)
                            };
                            var file = Licences.Sign(info, File.ReadAllText(key));
                            string outPath = Opt("out") ?? "licence.json";
                            File.WriteAllText(outPath, JsonSerializer.Serialize(file, Json.Options));
                            Console.WriteLine("Licence " + info.Id + " for " + info.Customer + " until " + info.ExpiresUtc.ToString("yyyy-MM-dd") + " → " + outPath);
                            return 0;
                        }
                    default:
                        Console.WriteLine("FusionModel.Server [token add --user U [--name N] [--admin] | token list | token revoke --id X |");
                        Console.WriteLine("                    licence show [--file F] | licence keygen [--out DIR] |");
                        Console.WriteLine("                    licence sign --key PEM --customer C --expires yyyy-MM-dd [--packs a,b|*] [--features …] [--users N] [--pods h1,h2] [--edition E] [--out F]]");
                        Console.WriteLine("Without arguments: runs the server (settings: fusionmodel-server.json next to the exe).");
                        return cmd == "help" || cmd == "--help" ? 0 : 1;
                }
            }
            catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
        }
    }
}

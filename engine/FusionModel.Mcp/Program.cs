using FusionModel;
using FusionModel.Ai;

// fusion-model MCP server (stdio). Claude Desktop config example:
//   "mcpServers": { "fusion-model": { "command": "C:\\fusion\\app\\FusionModel.Mcp.exe", "args": ["--user", "KHALID"] } }
// Options: --settings <file>  (default %APPDATA%\GraysWMS\FusionModel\settings.json, the app's own)
//          --shared <folder> --cache <folder> --mode CACHE|DIRECT   (override the settings)
//          --user <login>      (security roles of this login apply; default the Windows user)
// Env: FUSION_MODEL_VOYAGE_KEY (optional) adds vector search.
var opts = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
for (int i = 0; i + 1 < args.Length; i += 2) if (args[i].StartsWith("--")) opts[args[i].Substring(2)] = args[i + 1];
string Opt(string k) => opts.TryGetValue(k, out var v) ? v : null;

string settingsPath = Opt("settings") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GraysWMS", "FusionModel", "settings.json");
var engine = new ModelEngine(settingsPath, new EngineSettings
{
    SharedRoot = @"C:\fusion\model",
    CacheRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GraysWMS", "FusionModel", "cache")
});
// command-line overrides apply to this process only (never written back to the app's settings)
var s = engine.Settings;
if (Opt("shared") != null) s.SharedRoot = Opt("shared");
if (Opt("cache") != null) s.CacheRoot = Opt("cache");
if (Opt("mode") != null) s.ReadMode = Opt("mode").ToUpperInvariant();
string user = Opt("user") ?? Environment.UserName;

string voyage = Environment.GetEnvironmentVariable("FUSION_MODEL_VOYAGE_KEY");
if (!string.IsNullOrWhiteSpace(voyage)) engine.Embedder = new VoyageEmbedder(new HttpClient { Timeout = TimeSpan.FromSeconds(60) }, voyage);

Console.Error.WriteLine("[fusion-model] shared " + s.SharedRoot + " · " + s.ReadMode + " · user " + user);
if (s.ReadMode == "CACHE") { try { engine.SyncCache(); } catch (Exception ex) { Console.Error.WriteLine("[fusion-model] sync: " + ex.Message); } }

var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true, NewLine = "\n" };
await new McpHandler(new ModelTools(engine), user).ServeAsync(Console.In, stdout);
engine.Dispose();

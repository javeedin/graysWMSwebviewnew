using System.Text.Json;
using FusionModel;
using FusionModel.Access;
using FusionModel.Ai;
using FusionModel.Licensing;
using FusionModel.Semantic;
using FusionModel.Server;

// FusionModel.Server - the model over HTTP.
//   FusionModel.Server.exe                 run (console, or as the Windows service "FusionModelServer")
//   FusionModel.Server.exe token add --user KHALID [--name "Power BI"] [--admin]
//   FusionModel.Server.exe token list | token revoke --id <id>
//   FusionModel.Server.exe licence show [--file licence.json] [--pub <base64>]
//   FusionModel.Server.exe licence keygen [--out <folder>]                       (vendor only)
//   FusionModel.Server.exe licence sign --key vendor-private.pem --customer "…" --expires 2027-12-31
//                          [--packs gl,ap|*] [--features server,mcp|*] [--users 25] [--pods host,…] [--edition enterprise] [--out licence.json]
if (args.Length > 0 && args[0] is "token" or "licence" or "license" or "help" or "--help")
    return Cli.Run(args);

var cfg = ServerConfig.Load();
var engine = cfg.CreateEngine();
var tokens = new TokenStore(cfg.Abs(cfg.TokensPath));
var licence = new LicenceState(cfg);
var jsonOut = new JsonSerializerOptions(FusionModel.Json.Options) { WriteIndented = false };

var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });
builder.Host.UseWindowsService(o => o.ServiceName = "FusionModelServer");
builder.WebHost.UseUrls(cfg.Urls);
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
});
var app = builder.Build();
var log = app.Logger;

if (engine.Settings.IsRefresher)
{
    if (licence.Allows("refresh")) { engine.StartScheduler(() => "SERVER", m => log.LogInformation("{m}", m)); log.LogInformation("Refresher: scheduled refreshes run here"); }
    else log.LogWarning("isRefresher is set but the licence does not include 'refresh'");
}
if (engine.Settings.ReadMode == "CACHE")
    _ = new Timer(_ => { try { engine.SyncCache(); } catch (Exception ex) { log.LogWarning("sync: {e}", ex.Message); } }, null, TimeSpan.Zero, TimeSpan.FromMinutes(3));
log.LogInformation("Licence: {r}", licence.Describe());

// ── auth: Bearer token → user; licence (or trial); admin scope for refresh ──
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "";
    if (!(path.StartsWith("/v1", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/mcp", StringComparison.OrdinalIgnoreCase))) { await next(); return; }
    string auth = ctx.Request.Headers.Authorization.ToString();
    var token = auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? tokens.Validate(auth.Substring(7)) : null;
    if (token == null) { ctx.Response.StatusCode = 401; ctx.Response.Headers.WWWAuthenticate = "Bearer"; await ctx.Response.WriteAsJsonAsync(new { error = "A valid API token is required (Authorization: Bearer fm_…)." }); return; }
    var gate = licence.Gate(tokens, path.StartsWith("/mcp", StringComparison.OrdinalIgnoreCase) ? "mcp" : "server");
    if (gate != null) { ctx.Response.StatusCode = 403; await ctx.Response.WriteAsJsonAsync(new { error = gate }); return; }
    if (path.StartsWith("/v1/refresh", StringComparison.OrdinalIgnoreCase) && !token.Scopes.Contains("admin"))
    { ctx.Response.StatusCode = 403; await ctx.Response.WriteAsJsonAsync(new { error = "This token has no admin scope." }); return; }
    ctx.Items["token"] = token;
    await next();
});

static ApiToken Tok(HttpContext c) => (ApiToken)c.Items["token"];
IResult Fail(Exception ex) => Results.Json(new { error = ex.Message }, statusCode: ex is MeasureException or InvalidOperationException or ArgumentException ? 400 : 500);

app.MapGet("/health", () => Results.Json(new { ok = true, version = typeof(ModelEngine).Assembly.GetName().Version?.ToString(), licence = licence.Describe(), shared = engine.SharedReachable }));

app.MapGet("/v1/status", (HttpContext c) => Results.Json(new { status = engine.Status(), user = Tok(c).User, licence = licence.Summary() }, jsonOut));

app.MapGet("/v1/model", () =>
{
    // what a client needs to build queries - not the source SQL
    var m = engine.LoadModelForRead();
    return Results.Json(new
    {
        modules = m.Modules.Select(x => new { x.Name, x.Title, x.Description }),
        tables = m.Tables.Select(t => new { t.Module, t.Name, t.Description, t.Synonyms, columns = t.Columns }),
        m.Relationships, measures = m.Measures.Select(x => new { x.Name, x.Table, x.Description, x.Format, x.Folder, x.Synonyms }),
        m.Glossary, checks = m.Checks.Select(x => new { x.Name, x.Description })
    }, jsonOut);
});

app.MapPost("/v1/query", (HttpContext c, QueryBody b) =>
{
    try
    {
        if (engine.Semantic().RoleFilters(Tok(c).User).Count > 0) return Results.Json(new { error = "Raw SQL is not available to users restricted by security roles - use /v1/evaluate." }, statusCode: 403);
        return Results.Json(engine.Query(b.Sql ?? "", Math.Clamp(b.MaxRows ?? 1000, 1, cfg.MaxRows)), jsonOut);
    }
    catch (Exception ex) { return Fail(ex); }
});

app.MapPost("/v1/evaluate", (HttpContext c, EvaluateBody b) =>
{
    try
    {
        var user = Tok(c).User;
        return Results.Json(!string.IsNullOrWhiteSpace(b.Text) ? engine.EvaluateText(b.Text, user) : engine.Evaluate(b.Request ?? new SemanticRequest(), user), jsonOut);
    }
    catch (Exception ex) { return Fail(ex); }
});

app.MapGet("/v1/search", async (string q, int? k) =>
{
    var (hits, note) = await engine.SearchAsync(q ?? "", Math.Clamp(k ?? 12, 1, 50));
    return Results.Json(new { note, hits = hits.Select(h => new { h.Entry.Kind, h.Entry.Title, h.Entry.Ref, h.Entry.Detail, h.Entry.Rule, h.Score, h.Why }) }, jsonOut);
});

app.MapPost("/v1/checks", (HttpContext c, ChecksBody b) =>
{
    try { return Results.Json(engine.RunChecks(Tok(c).User, b?.Names?.Count > 0 ? b.Names : null), jsonOut); }
    catch (Exception ex) { return Fail(ex); }
});

app.MapGet("/v1/reports", () => Results.Json(engine.LoadReports(), jsonOut));

app.MapPost("/v1/tools/{name}", async (HttpContext c, string name, JsonElement args) =>
{
    if (ModelTools.Definitions.All(t => t.Name != name)) return Results.Json(new { error = "Unknown tool " + name }, statusCode: 404);
    string text = await new ModelTools(engine).RunAsync(name, args, Tok(c).User, c.RequestAborted);
    return Results.Text(text, "text/plain; charset=utf-8");
});

app.MapGet("/v1/tools", () => Results.Json(ModelTools.Definitions.Select(t => new { t.Name, t.Description, inputSchema = t.Schema })));

// MCP over HTTP (JSON-RPC in the POST body, JSON back; notifications get 202)
app.MapPost("/mcp", async (HttpContext c) =>
{
    using var sr = new StreamReader(c.Request.Body);
    string body = await sr.ReadToEndAsync();
    string reply = await new McpHandler(new ModelTools(engine), Tok(c).User).HandleAsync(body, c.RequestAborted);
    return reply == null ? Results.StatusCode(202) : Results.Text(reply, "application/json; charset=utf-8");
});
app.MapGet("/mcp", () => Results.StatusCode(405));

app.MapPost("/v1/refresh", async (HttpContext c, RefreshBody b) =>
{
    if (!licence.Allows("refresh")) return Results.Json(new { error = "The licence does not include refresh." }, statusCode: 403);
    var progress = new Progress<string>(m => log.LogInformation("{m}", m));
    var r = await engine.RefreshAsync(b.Module, b.Tables, b.Full, "API:" + Tok(c).User, progress, c.RequestAborted);
    if (r.Ok && engine.Settings.ReadMode == "CACHE") try { engine.SyncCache(); } catch { }
    return Results.Json(r, jsonOut, statusCode: r.Ok ? 200 : 500);
});

app.Run();
return 0;

namespace FusionModel.Server
{
    public sealed class QueryBody { public string Sql { get; set; } public int? MaxRows { get; set; } }
    public sealed class EvaluateBody { public string Text { get; set; } public SemanticRequest Request { get; set; } }
    public sealed class ChecksBody { public List<string> Names { get; set; } }
    public sealed class RefreshBody { public string Module { get; set; } public List<string> Tables { get; set; } public bool Full { get; set; } }

    /// <summary>fusionmodel-server.json next to the exe (every path in it may be relative to that folder).</summary>
    public sealed class ServerConfig
    {
        public string Urls { get; set; } = "http://0.0.0.0:5088";
        public string SettingsPath { get; set; } = "settings.json";
        public string SharedRoot { get; set; }
        public string CacheRoot { get; set; } = "cache";
        public string ReadMode { get; set; }
        public bool? IsRefresher { get; set; }
        public string ApexQueryUrl { get; set; }
        public string TokensPath { get; set; } = "tokens.json";
        public string LicencePath { get; set; } = "licence.json";
        public int TrialDays { get; set; } = 30;
        public int MaxRows { get; set; } = 100_000;

        public static string Folder => AppContext.BaseDirectory;
        public string Abs(string p) => string.IsNullOrWhiteSpace(p) ? p : Path.IsPathRooted(p) ? p : Path.Combine(Folder, p);

        public static ServerConfig Load()
        {
            string path = Environment.GetEnvironmentVariable("FUSION_MODEL_SERVER_CONFIG") ?? Path.Combine(Folder, "fusionmodel-server.json");
            return Json.Read<ServerConfig>(path) ?? new ServerConfig();
        }

        public ModelEngine CreateEngine()
        {
            var e = new ModelEngine(Abs(SettingsPath), new EngineSettings { SharedRoot = SharedRoot, CacheRoot = Abs(CacheRoot) });
            var s = e.Settings;
            if (!string.IsNullOrWhiteSpace(SharedRoot)) s.SharedRoot = SharedRoot;
            if (!string.IsNullOrWhiteSpace(CacheRoot)) s.CacheRoot = Abs(CacheRoot);
            if (!string.IsNullOrWhiteSpace(ReadMode)) s.ReadMode = ReadMode.ToUpperInvariant();
            if (IsRefresher.HasValue) s.IsRefresher = IsRefresher.Value;
            if (!string.IsNullOrWhiteSpace(ApexQueryUrl)) e.RegisterSource(new ApexSource(new HttpClient { Timeout = TimeSpan.FromMinutes(5) }, ApexQueryUrl, "FUSION_MODEL_SERVER"));
            string voyage = Environment.GetEnvironmentVariable("FUSION_MODEL_VOYAGE_KEY");
            if (!string.IsNullOrWhiteSpace(voyage)) e.Embedder = new VoyageEmbedder(new HttpClient { Timeout = TimeSpan.FromSeconds(60) }, voyage);
            return e;
        }
    }

    /// <summary>The licence, or a trial of TrialDays from the first start (trial.json) when there is no valid licence.</summary>
    public sealed class LicenceState
    {
        private readonly ServerConfig _cfg;
        private LicenceCheck _check;
        private DateTime _checkedUtc;
        private readonly DateTime _trialStartUtc;

        public LicenceState(ServerConfig cfg)
        {
            _cfg = cfg;
            string trial = cfg.Abs("trial.json");
            var t = Json.Read<Dictionary<string, DateTime>>(trial);
            if (t == null || !t.TryGetValue("firstStartUtc", out _trialStartUtc))
            {
                _trialStartUtc = DateTime.UtcNow;
                try { Json.WriteAtomic(trial, new Dictionary<string, DateTime> { ["firstStartUtc"] = _trialStartUtc }); } catch { }
            }
        }

        public LicenceCheck Check
        {
            get
            {
                if (_check == null || (DateTime.UtcNow - _checkedUtc).TotalMinutes > 10) { _check = Licences.VerifyFile(_cfg.Abs(_cfg.LicencePath)); _checkedUtc = DateTime.UtcNow; }
                return _check;
            }
        }

        public int TrialDaysLeft => (int)Math.Ceiling((_trialStartUtc.AddDays(_cfg.TrialDays) - DateTime.UtcNow).TotalDays);
        public bool InTrial => !Check.Valid && TrialDaysLeft > 0;
        public bool Allows(string feature) => InTrial || Check.Allows(feature) || Check.Allows("*");

        public string Describe() => Check.Valid ? Check.Reason : InTrial ? "trial, " + TrialDaysLeft + " days left (" + Check.Reason + ")" : "not licensed: " + Check.Reason;

        public object Summary() => new { valid = Check.Valid, trial = InTrial, trialDaysLeft = InTrial ? TrialDaysLeft : 0, reason = Describe(), licence = Check.Licence };

        /// <summary>Why a request may not run (null = it may).</summary>
        public string Gate(TokenStore tokens, string feature)
        {
            if (InTrial) return null;
            if (!Check.Valid) return "Not licensed: " + Check.Reason + " Put a licence.json from the vendor next to the server.";
            if (!Allows(feature)) return "The licence does not include '" + feature + "'.";
            if (Check.Licence.MaxUsers > 0 && tokens.ActiveUsers() > Check.Licence.MaxUsers) return "The licence allows " + Check.Licence.MaxUsers + " users; revoke tokens of users who no longer need access.";
            return null;
        }
    }
}

using System.Text.Json;
using System.Text.Json.Nodes;

namespace FusionModel.Ai
{
    /// <summary>
    /// Model Context Protocol (JSON-RPC 2.0, one message per line) over the model tools, so any MCP client - Claude Desktop,
    /// Claude Code, other agents - can ask the model. Read-only; the user is fixed when the server starts (their roles apply).
    /// </summary>
    public sealed class McpHandler
    {
        private readonly ModelTools _tools;
        private readonly string _user;
        public static readonly string[] Versions = { "2025-06-18", "2025-03-26", "2024-11-05" };
        public string ServerVersion { get; init; } = "1.0.0";
        private static readonly JsonSerializerOptions Wire = new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

        public McpHandler(ModelTools tools, string user) { _tools = tools; _user = user; }

        /// <summary>Handles one message; returns the reply line, or null for notifications.</summary>
        public async Task<string> HandleAsync(string line, CancellationToken ct = default)
        {
            JsonNode id = null;
            try
            {
                var msg = JsonNode.Parse(line) as JsonObject ?? throw new JsonException("not an object");
                id = msg["id"]?.DeepClone();
                string method = (string)msg["method"];
                var prms = msg["params"] as JsonObject;
                if (method == null) return null;                               // a response to us - we send no requests
                bool notification = !msg.ContainsKey("id");
                if (notification) return null;                                 // notifications/initialized, cancelled …

                JsonNode result = method switch
                {
                    "initialize" => Initialize(prms),
                    "ping" => new JsonObject(),
                    "tools/list" => new JsonObject
                    {
                        ["tools"] = new JsonArray(ModelTools.Definitions.Select(t => (JsonNode)new JsonObject
                        {
                            ["name"] = t.Name,
                            ["description"] = t.Description,
                            ["inputSchema"] = JsonSerializer.SerializeToNode(t.Schema),
                            ["annotations"] = new JsonObject { ["readOnlyHint"] = true, ["openWorldHint"] = false }
                        }).ToArray())
                    },
                    "tools/call" => await CallAsync(prms, ct).ConfigureAwait(false),
                    "resources/list" => new JsonObject { ["resources"] = new JsonArray() },
                    "prompts/list" => new JsonObject { ["prompts"] = new JsonArray() },
                    _ => null
                };
                if (result == null) return Error(id, -32601, "Method not found: " + method);
                return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result }.ToJsonString(Wire);
            }
            catch (JsonException ex) { return Error(id, -32700, "Parse error: " + ex.Message); }
            catch (Exception ex) { return Error(id, -32603, ex.Message); }
        }

        private JsonNode Initialize(JsonObject prms)
        {
            string asked = (string)prms?["protocolVersion"];
            return new JsonObject
            {
                ["protocolVersion"] = Versions.Contains(asked) ? asked : Versions[0],
                ["capabilities"] = new JsonObject { ["tools"] = new JsonObject { ["listChanged"] = false } },
                ["serverInfo"] = new JsonObject { ["name"] = "fusion-model", ["version"] = ServerVersion },
                ["instructions"] = ModelTools.Guide
            };
        }

        private async Task<JsonNode> CallAsync(JsonObject prms, CancellationToken ct)
        {
            string name = (string)prms?["name"];
            if (ModelTools.Definitions.All(t => t.Name != name))
                return new JsonObject { ["content"] = Content("Unknown tool: " + name), ["isError"] = true };
            var args = prms?["arguments"] is JsonObject a ? JsonSerializer.SerializeToElement(a) : JsonSerializer.SerializeToElement(new { });
            string text = await _tools.RunAsync(name, args, _user, ct).ConfigureAwait(false);
            return new JsonObject { ["content"] = Content(text), ["isError"] = text.StartsWith("ERROR:", StringComparison.Ordinal) };
        }

        private static JsonArray Content(string text) => new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text });

        private static string Error(JsonNode id, int code, string message) =>
            new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id?.DeepClone(), ["error"] = new JsonObject { ["code"] = code, ["message"] = message } }.ToJsonString(Wire);

        /// <summary>Serves stdin → stdout until stdin closes (log lines go to stderr; stdout carries only protocol).</summary>
        public async Task ServeAsync(TextReader input, TextWriter output, CancellationToken ct = default)
        {
            string line;
            while (!ct.IsCancellationRequested && (line = await input.ReadLineAsync(ct).ConfigureAwait(false)) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var reply = await HandleAsync(line, ct).ConfigureAwait(false);
                if (reply == null) continue;
                await output.WriteLineAsync(reply).ConfigureAwait(false);
                await output.FlushAsync().ConfigureAwait(false);
            }
        }
    }
}

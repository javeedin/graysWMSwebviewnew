using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;
using WMSApp.FusionSql;

namespace WMSApp
{
    /// <summary>
    /// DLL Explorer › "Explain with AI": Claude reads a DLL through read-only tools over DllInspector
    /// (outline, find, decompile) and writes a feature map - what the DLL does, feature by feature, with the
    /// classes/methods behind each one, what it talks to (URLs, databases, Windows APIs), its settings and
    /// risks, and which methods would make good chat actions. Uses the Claude key saved for Fusion SQL
    /// (DPAPI, never sent to the page). Secrets in strings/decompiled code are masked before they go out.
    /// </summary>
    public static class DllAi
    {
        private const int MAX_TURNS = 14;
        private const int WRAP_UP_AT = 3;
        private const int MAX_TOOL_CHARS = 24000;
        private const int FIRST_OUTLINE_CHARS = 45000;

        private const string SYSTEM_PROMPT = @"You are a senior .NET / Windows engineer. You are reading a DLL for a business user of Gray's WMS
(a warehouse app on Oracle Fusion + Oracle APEX) who wants to know WHAT IT CAN DO - not how C# works.
You start with an outline (version info, capabilities with evidence, references, P/Invoke/imports, exports,
hard-coded URLs/SQL/paths, types and members). Use the tools to look closer:
- find: search type/member names, XML-doc summaries, exports and hard-coded strings.
- outline: the outline of one namespace (when the first outline listed its types by name only).
- decompile: C# of one type (Ns.Type, nested Ns.Outer+Inner) or one member (Ns.Type::Method) - .NET only.
Research efficiently: call several tools in the same round; decompile the few types that carry the logic
(services, processors, handlers, controllers), not models/DTOs; skip generated code. Native DLLs cannot be
decompiled - reason from exports, imports, strings and version info and say so.
Passwords/keys show as *** - never guess them.

Write the answer in Markdown with exactly these sections:
## Summary
Two or three sentences: what the DLL is, who made it, what it is for.
## Features
A table: Feature | What it does (business words) | Where (Type.Method) - one row per real capability, grouped
logically, most important first. Include step-by-step flows for the main processes (numbered lists) when
you decompiled them.
## Talks to
Web endpoints / databases / files / printers / Windows APIs / other DLLs it depends on - with the evidence.
## Settings and hard-coded values
URLs, table names, folders, timeouts, magic values a support person must know (secrets stay ***).
## Risks and notes
Obfuscation, reference-only assemblies, hard-coded production URLs, missing error handling, anything
surprising. Mark guesses as guesses.
## Chat actions
Public methods that would make good AI chat actions, as a table: Action name | Method | Inputs | Writes data?
(anything that writes/sends/prints is marked 'yes - needs approval card'). Say 'none' for a library with nothing
runnable. If the DLL already has [AiAction] methods list them first.
Be concrete and business-readable. Do not paste large code blocks.";

        public static async Task<(bool Success, string Markdown, string Error, List<string> Steps)> ExplainAsync(
            string path, bool includeInternal, string focus, string model, Action<string> progress, CancellationToken ct = default)
        {
            var steps = new List<string>();
            string key = FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key))
                return (false, null, "No Claude API key saved. Add it with the key button (it is the same key Fusion SQL › Ask AI uses).", steps);

            DllInspector.DllReport rep;
            try { rep = await Task.Run(() => DllInspector.InspectCached(path, includeInternal), ct).ConfigureAwait(false); }
            catch (Exception ex) { return (false, null, "Cannot read the DLL: " + ex.Message, steps); }

            string outline = DllInspector.Redact(DllInspector.Outline(rep, FIRST_OUTLINE_CHARS));
            var messages = new List<MessageParam>
            {
                new MessageParam
                {
                    Role = Role.User,
                    Content = "OUTLINE OF " + rep.FileName + "\n" + outline + "\n\n" +
                              (string.IsNullOrWhiteSpace(focus) ? "Write the feature map." : "Write the feature map, paying special attention to: " + focus.Trim())
                }
            };
            var client = new AnthropicClient { ApiKey = key };
            var tools = BuildTools(rep.Kind != "native");
            string useModel = string.IsNullOrWhiteSpace(model) ? "claude-opus-5" : model;

            try
            {
                for (int turn = 0; turn <= MAX_TURNS; turn++)
                {
                    bool finalRound = turn == MAX_TURNS;
                    progress?.Invoke(turn == 0 ? "Claude is reading the outline…" : finalRound ? "Claude is writing the feature map…" : "Claude is reviewing what it found…");
                    var resp = await client.Messages.Create(new MessageCreateParams
                    {
                        Model = useModel,
                        MaxTokens = 16000,
                        System = SYSTEM_PROMPT,
                        Tools = tools,
                        ToolChoice = finalRound ? new ToolChoiceNone() : null,
                        Thinking = new ThinkingConfigAdaptive(),
                        OutputConfig = new OutputConfig { Effort = Effort.High },
                        CacheControl = new CacheControlEphemeral(),
                        Messages = messages,
                    }, ct).ConfigureAwait(false);

                    var assistant = new List<ContentBlockParam>();
                    var results = new List<ContentBlockParam>();
                    var text = new StringBuilder();
                    var calls = new List<ToolUseBlock>();
                    foreach (ContentBlock block in resp.Content)
                    {
                        if (block.TryPickText(out TextBlock t)) { text.Append(t.Text); assistant.Add(new TextBlockParam { Text = t.Text }); }
                        else if (block.TryPickThinking(out ThinkingBlock th)) assistant.Add(new ThinkingBlockParam { Thinking = th.Thinking, Signature = th.Signature });
                        else if (block.TryPickRedactedThinking(out RedactedThinkingBlock rt)) assistant.Add(new RedactedThinkingBlockParam { Data = rt.Data });
                        else if (block.TryPickToolUse(out ToolUseBlock tu))
                        {
                            assistant.Add(new ToolUseBlockParam { ID = tu.ID, Name = tu.Name, Input = tu.Input });
                            calls.Add(tu);
                        }
                    }
                    messages.Add(new MessageParam { Role = Role.Assistant, Content = assistant });

                    string stop = resp.StopReason?.ToString() ?? "";
                    if (calls.Count == 0)
                    {
                        if (stop.IndexOf("refusal", StringComparison.OrdinalIgnoreCase) >= 0 && text.Length == 0)
                            return (false, null, "Claude declined to analyse this file.", steps);
                        if (text.Length == 0)
                            return (false, null, "Claude returned no text (stop reason: " + stop + ").", steps);
                        if (stop.IndexOf("max_tokens", StringComparison.OrdinalIgnoreCase) >= 0)
                            text.Append("\n\n_(cut off at the output limit)_");
                        return (true, text.ToString(), null, steps);
                    }

                    foreach (var call in calls)
                    {
                        string label = Describe(call);
                        steps.Add(label);
                        progress?.Invoke(label);
                        string output;
                        try { output = await Task.Run(() => RunTool(rep, path, includeInternal, call.Name, call.Input), ct).ConfigureAwait(false); }
                        catch (Exception ex) { output = "ERROR: " + ex.Message; }
                        output = DllInspector.Redact(output);
                        if (output.Length > MAX_TOOL_CHARS) output = output.Substring(0, MAX_TOOL_CHARS) + "\n…(truncated - decompile one member (Type::Member) instead)";
                        results.Add(new ToolResultBlockParam { ToolUseID = call.ID, Content = output });
                    }
                    int left = MAX_TURNS - turn - 1;
                    results.Add(new TextBlockParam
                    {
                        Text = left <= 0
                            ? "[Research budget used up - no more tools. Write the feature map NOW from what you saw; mark guesses as guesses.]"
                            : left <= WRAP_UP_AT ? "[Research rounds left: " + left + ". Finish now - write the feature map.]"
                            : "[Research rounds left: " + left + "]"
                    });
                    messages.Add(new MessageParam { Role = Role.User, Content = results });
                }
                return (false, null, "Claude did not finish the feature map.", steps);
            }
            catch (OperationCanceledException) { return (false, null, "Cancelled.", steps); }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[DllAi] " + ex);
                return (false, null, "Claude API error: " + ex.Message, steps);
            }
        }

        private static string Str(IReadOnlyDictionary<string, JsonElement> input, string name) =>
            input != null && input.TryGetValue(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static string RunTool(DllInspector.DllReport rep, string path, bool includeInternal, string name, IReadOnlyDictionary<string, JsonElement> input)
        {
            switch (name)
            {
                case "find":
                    {
                        var hits = DllInspector.Find(rep, Str(input, "query"), 120);
                        if (hits.Count == 0 && !includeInternal)
                        {
                            // public API had nothing - the logic may sit in internal types
                            var all = DllInspector.InspectCached(path, true);
                            hits = DllInspector.Find(all, Str(input, "query"), 120);
                        }
                        return hits.Count == 0 ? "No match." : JsonSerializer.Serialize(hits);
                    }
                case "outline":
                    {
                        string ns = Str(input, "namespace");
                        var r = includeInternal || string.IsNullOrEmpty(ns) ? rep : DllInspector.InspectCached(path, true);
                        return DllInspector.Outline(r, MAX_TOOL_CHARS, string.IsNullOrWhiteSpace(ns) ? null : ns.Trim());
                    }
                case "decompile":
                    if (rep.Kind == "native") return "ERROR: native DLL - machine code cannot be decompiled to C#.";
                    return DllInspector.Decompile(path, Str(input, "target"), MAX_TOOL_CHARS);
                default:
                    return "ERROR: unknown tool " + name;
            }
        }

        private static string Describe(ToolUseBlock call)
        {
            var input = call.Input;
            switch (call.Name)
            {
                case "find": return "Searching for “" + Str(input, "query") + "”";
                case "outline": return "Outline of " + (Str(input, "namespace") ?? "the DLL");
                case "decompile": return "Decompiling " + Str(input, "target");
                default: return call.Name;
            }
        }

        private static JsonElement Prop(string type, string description) => JsonSerializer.SerializeToElement(new { type, description });
        private static Tool MakeTool(string name, string description, Dictionary<string, JsonElement> props, params string[] required) =>
            new Tool { Name = name, Description = description, InputSchema = new() { Properties = props, Required = required.ToList() } };

        private static List<ToolUnion> BuildTools(bool managed)
        {
            var list = new List<ToolUnion>
            {
                MakeTool("find", "Search the DLL: type and member names, XML-doc summaries, exports and hard-coded strings (URLs, SQL, paths). Words are AND-ed, case-insensitive.",
                    new Dictionary<string, JsonElement> { ["query"] = Prop("string", "e.g. 'invoice', 'print', 'http', 'Order Submit'") }, "query"),
                MakeTool("outline", "Outline of one namespace with every type and member signature (includes internal types).",
                    new Dictionary<string, JsonElement> { ["namespace"] = Prop("string", "Exact namespace, e.g. 'WMSApp.MRA'") }, "namespace"),
            };
            if (managed)
                list.Add(MakeTool("decompile", "C# source of one type or one member. Target 'Ns.Type' (nested: 'Ns.Outer+Inner') or 'Ns.Type::Member' (all overloads).",
                    new Dictionary<string, JsonElement> { ["target"] = Prop("string", "e.g. 'WMSApp.MRA.MRAProcessor::ProcessMRAInterfaceAsync'") }, "target"));
            return list;
        }
    }
}

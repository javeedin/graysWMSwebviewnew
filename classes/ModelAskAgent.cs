using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;
using FusionModel;
using FusionModel.Ai;

namespace WMSApp
{
    /// <summary>
    /// "Ask" on the Fusion Model page: Claude answers a business question with the read-only model tools
    /// (FusionModel.Ai.ModelTools - search, describe, evaluate measures, look up values, SQL). Measures run with the
    /// user's security roles. The Claude key is the Fusion SQL one (DPAPI, never sent to the page).
    /// </summary>
    public static class ModelAskAgent
    {
        private const int MAX_TURNS = 14;
        public const string DEFAULT_MODEL = "claude-opus-5-5";

        public sealed class AskResult
        {
            public bool Ok { get; set; }
            public string Answer { get; set; }
            public string Error { get; set; }
            public List<string> Steps { get; set; } = new List<string>();
            /// <summary>The last query that ran without error (so the page can re-run it or mark it verified).</summary>
            public string Query { get; set; }
            public string QueryKind { get; set; }
            public string Model { get; set; }
            public long TokensIn, TokensOut, CacheRead, CacheWrite;
        }

        private static long N(object o) => o == null ? 0 : Convert.ToInt64(o);

        /// <param name="systemPrompt">Replaces the default guide (e.g. the dashboard designer's).</param>
        /// <param name="checkAnswer">Checks a final answer; a non-null result is sent back to Claude to fix (at most twice).</param>
        public static async Task<AskResult> AskAsync(ModelEngine engine, string question, JsonElement history, string user, string model,
                                                     Action<string> progress, CancellationToken ct,
                                                     string systemPrompt = null, Func<string, string> checkAnswer = null)
        {
            int repairs = 0;
            var res = new AskResult { Model = string.IsNullOrWhiteSpace(model) ? DEFAULT_MODEL : model };
            string key = WMSApp.FusionSql.FusionSqlStore.LoadAiKey();
            if (string.IsNullOrEmpty(key)) { res.Error = "No Claude API key saved. Add it in Fusion SQL › Ask AI (⚙)."; return res; }

            var tools = new ModelTools(engine);
            var messages = new List<MessageParam>();
            if (history.ValueKind == JsonValueKind.Array)
            {
                foreach (var h in history.EnumerateArray().TakeLast(8))
                {
                    string role = h.TryGetProperty("role", out var r) ? r.GetString() : null;
                    string content = h.TryGetProperty("content", out var c) ? c.GetString() : null;
                    if (string.IsNullOrWhiteSpace(content) || (role != "user" && role != "assistant")) continue;
                    var want = role == "user" ? Role.User : Role.Assistant;
                    if (messages.Count == 0 && want != Role.User) continue;
                    if (messages.Count > 0 && messages[messages.Count - 1].Role == want) continue;
                    messages.Add(new MessageParam { Role = want, Content = content });
                }
                if (messages.Count > 0 && messages[messages.Count - 1].Role == Role.User) messages.RemoveAt(messages.Count - 1);
            }
            // the model overview goes in the first user turn of this question (it changes when the model does)
            string overview = await Task.Run(() => tools.Overview(user), ct).ConfigureAwait(false);
            messages.Add(new MessageParam { Role = Role.User, Content = "THE MODEL\n" + overview + "\nQUESTION (today is " + DateTime.Now.ToString("yyyy-MM-dd") + ")\n" + question });

            var apiTools = ModelTools.Definitions.Select(t => (ToolUnion)new Tool
            {
                Name = t.Name, Description = t.Description,
                InputSchema = new() { Properties = t.Properties, Required = t.Required }
            }).ToList();
            var client = new AnthropicClient { ApiKey = key };
            try
            {
                for (int turn = 0; turn <= MAX_TURNS; turn++)
                {
                    bool last = turn == MAX_TURNS;
                    progress?.Invoke(turn == 0 ? "Claude is reading the model…" : last ? "Claude is writing the answer…" : "Claude is checking the results…");
                    var resp = await client.Messages.Create(new MessageCreateParams
                    {
                        Model = res.Model,
                        MaxTokens = 12000,
                        System = systemPrompt ?? ModelTools.Guide,
                        Tools = apiTools,
                        ToolChoice = last ? new ToolChoiceNone() : null,
                        Thinking = new ThinkingConfigAdaptive(),
                        OutputConfig = new OutputConfig { Effort = Effort.High },
                        CacheControl = new CacheControlEphemeral(),
                        Messages = messages,
                    }, ct).ConfigureAwait(false);
                    if (resp.Usage != null)
                    {
                        res.TokensIn += N(resp.Usage.InputTokens); res.TokensOut += N(resp.Usage.OutputTokens);
                        res.CacheRead += N(resp.Usage.CacheReadInputTokens); res.CacheWrite += N(resp.Usage.CacheCreationInputTokens);
                    }

                    var assistant = new List<ContentBlockParam>();
                    var text = new StringBuilder();
                    var calls = new List<ToolUseBlock>();
                    foreach (ContentBlock block in resp.Content)
                    {
                        if (block.TryPickText(out TextBlock t)) { text.Append(t.Text); assistant.Add(new TextBlockParam { Text = t.Text }); }
                        else if (block.TryPickThinking(out ThinkingBlock th)) assistant.Add(new ThinkingBlockParam { Thinking = th.Thinking, Signature = th.Signature });
                        else if (block.TryPickRedactedThinking(out RedactedThinkingBlock rt)) assistant.Add(new RedactedThinkingBlockParam { Data = rt.Data });
                        else if (block.TryPickToolUse(out ToolUseBlock tu)) { assistant.Add(new ToolUseBlockParam { ID = tu.ID, Name = tu.Name, Input = tu.Input }); calls.Add(tu); }
                    }
                    messages.Add(new MessageParam { Role = Role.Assistant, Content = assistant });

                    if (calls.Count == 0)
                    {
                        string stop = resp.StopReason?.ToString() ?? "";
                        if (text.Length == 0) { res.Error = stop.IndexOf("refusal", StringComparison.OrdinalIgnoreCase) >= 0 ? "Claude declined this request." : "Claude returned no answer (" + stop + ")."; return res; }
                        string problems = checkAnswer == null || repairs >= 2 ? null : await Task.Run(() => checkAnswer(text.ToString()), ct).ConfigureAwait(false);
                        if (problems != null && !last)
                        {
                            repairs++;
                            res.Steps.Add("🔧 Fixing: " + (problems.Length > 120 ? problems.Substring(0, 120) + "…" : problems));
                            progress?.Invoke(res.Steps[^1]);
                            messages.Add(new MessageParam { Role = Role.User, Content = "The app checked your answer and found problems - fix them and send the complete answer again:\n" + problems });
                            continue;
                        }
                        res.Ok = true;
                        res.Answer = text.ToString();
                        return res;
                    }

                    var results = new List<ContentBlockParam>();
                    foreach (var call in calls)
                    {
                        string label = ModelTools.Describe(call.Name, call.Input);
                        res.Steps.Add(label);
                        progress?.Invoke(label);
                        string output = await Task.Run(() => tools.RunAsync(call.Name, call.Input, user, ct), ct).ConfigureAwait(false);
                        if ((call.Name == "evaluate" || call.Name == "run_sql") && !output.StartsWith("ERROR", StringComparison.Ordinal))
                        {
                            res.Query = ModelTools.Arg(call.Input, call.Name == "evaluate" ? "query" : "sql");
                            res.QueryKind = call.Name == "evaluate" ? "evaluate" : "sql";
                        }
                        results.Add(new ToolResultBlockParam { ToolUseID = call.ID, Content = output, IsError = output.StartsWith("ERROR", StringComparison.Ordinal) });
                    }
                    int left = MAX_TURNS - turn - 1;
                    if (left <= 3) results.Add(new TextBlockParam { Text = left <= 0 ? "[No more tool calls - answer now from what you have.]" : "[Tool rounds left: " + left + " - finish soon.]" });
                    messages.Add(new MessageParam { Role = Role.User, Content = results });
                }
                res.Error = "Claude did not finish within " + MAX_TURNS + " steps. Ask a narrower question.";
                return res;
            }
            catch (OperationCanceledException) { res.Error = "Cancelled."; return res; }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[FusionModel Ask] " + ex);
                res.Error = "Claude API error: " + ex.Message;
                return res;
            }
        }
    }
}

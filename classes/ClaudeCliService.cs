using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace WMSApp
{
    /// <summary>
    /// One SQL round executed during a chat turn (for the SQL Inspector panel).
    /// </summary>
    public class AiSqlRound
    {
        public string Kind { get; set; } = "sql";  // "sql" | "fusion"
        public string Sql { get; set; }
        public string Method { get; set; }         // fusion only
        public string Path { get; set; }           // fusion only
        public string Reason { get; set; }
        public bool Success { get; set; }
        public int RowCount { get; set; }
        public long ElapsedMs { get; set; }
        public string Error { get; set; }
        public string ResultJson { get; set; }   // raw gateway response (columns + rows) for the preview panel
    }

    /// <summary>
    /// A Fusion write call (POST/PATCH/DELETE) waiting for on-screen user approval.
    /// </summary>
    public class AiPendingFusion
    {
        public string Method { get; set; }
        public string Path { get; set; }
        public string Body { get; set; }
        public string Instance { get; set; }
        public string Reason { get; set; }
    }

    /// <summary>
    /// Final outcome of one user message (after up to 5 SQL/Fusion rounds).
    /// </summary>
    public class AiChatResult
    {
        public bool Success { get; set; }
        public string Markdown { get; set; }
        public string GridJson { get; set; }     // raw {"action":"grid",...} object for interactive answers
        public string Error { get; set; }
        public string SessionId { get; set; }
        public bool RequiresApproval { get; set; }
        public AiPendingFusion Pending { get; set; }
        public List<AiSqlRound> Rounds { get; set; } = new List<AiSqlRound>();
    }

    /// <summary>
    /// Runs the Claude CLI headless (stream-json in/out, --resume for memory)
    /// and drives the JSON action protocol:
    ///   model -> { "action":"sql", "sql":"...", "reason":"..." }  -> run via ORDS gateway -> SQL_RESULT back
    ///   model -> { "action":"answer", "markdown":"..." }          -> done
    /// SQL execution always goes through the guarded ORDS endpoint, never directly to the DB.
    /// </summary>
    public class ClaudeCliService
    {
        private const string METADATA_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/getobjectslist";
        private const string QUERY_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/executequery";

        private const int MAX_SQL_ROUNDS = 5;
        private const int CLI_TIMEOUT_SECONDS = 240;
        private const string PROMPT_TEMPLATE_MARKER = "FUSION-CATALOG-V4";
        private const string REPORT_SAVE_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/reports/save";
        private const int FUSION_RESULT_MAX_CHARS = 25000;   // fed back to the model
        private const int FUSION_STORE_MAX_CHARS  = 100000;  // kept for the inspector

        private const string FUSION_PROD_BASE = "https://efmh.fa.em3.oraclecloud.com";
        private const string FUSION_TEST_BASE = "https://efmh-test.fa.em3.oraclecloud.com";

        private static readonly string BaseDir      = @"C:\fusion\ai_chat";
        private static readonly string WorkspaceDir = Path.Combine(BaseDir, "workspace");

        private readonly HttpClient _http;
        private Process _current;

        public ClaudeCliService()
        {
            _http = new HttpClient();
            _http.Timeout = TimeSpan.FromSeconds(60);
        }

        // ============================================================
        // CLI presence check
        // ============================================================
        public async Task<(bool Installed, string Version)> CheckCliAsync()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c claude --version",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var p = Process.Start(psi);
                string output = await p.StandardOutput.ReadToEndAsync();
                await p.WaitForExitAsync();
                if (p.ExitCode == 0 && !string.IsNullOrWhiteSpace(output))
                    return (true, output.Trim());
                return (false, null);
            }
            catch
            {
                return (false, null);
            }
        }

        // ============================================================
        // Workspace: CLAUDE.md (system prompt + metadata catalog)
        // ============================================================
        public async Task<int> PrepareWorkspaceAsync(bool forceRefresh)
        {
            Directory.CreateDirectory(WorkspaceDir);
            Directory.CreateDirectory(Path.Combine(WorkspaceDir, ".claude"));

            string claudeMdPath = Path.Combine(WorkspaceDir, "CLAUDE.md");
            string settingsPath = Path.Combine(WorkspaceDir, ".claude", "settings.local.json");

            if (!File.Exists(settingsPath))
                await File.WriteAllTextAsync(settingsPath, "{\n  \"permissions\": { \"allow\": [], \"deny\": [] }\n}");

            if (File.Exists(claudeMdPath) && !forceRefresh)
            {
                // refresh once a day, and always when the prompt template changed
                string existing = await File.ReadAllTextAsync(claudeMdPath);
                if ((DateTime.Now - File.GetLastWriteTime(claudeMdPath)).TotalHours < 24 &&
                    existing.Contains(PROMPT_TEMPLATE_MARKER))
                    return -1;
            }

            string metadataJson = await _http.GetStringAsync(METADATA_URL);
            var (catalog, objectCount) = CompactCatalog(metadataJson);

            var sb = new StringBuilder();
            sb.AppendLine("# GraysWMS Data Assistant");
            sb.AppendLine();
            sb.AppendLine("You are the GraysWMS data assistant. You answer questions about warehouse operations by writing Oracle SQL against the schema described below and returning results.");
            sb.AppendLine();
            sb.AppendLine("## Response protocol (MANDATORY)");
            sb.AppendLine();
            sb.AppendLine("Reply with EXACTLY ONE JSON object and NOTHING else - no prose before or after, no code fences.");
            sb.AppendLine();
            sb.AppendLine("To run a query:");
            sb.AppendLine("{ \"action\": \"sql\", \"sql\": \"SELECT ...\", \"reason\": \"one line\" }");
            sb.AppendLine();
            sb.AppendLine("To call an Oracle Fusion REST service:");
            sb.AppendLine("{ \"action\": \"fusion\", \"method\": \"GET\", \"path\": \"/fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order=418978&limit=200\", \"instance\": \"PROD\", \"reason\": \"one line\" }");
            sb.AppendLine("{ \"action\": \"fusion\", \"method\": \"PATCH\", \"path\": \"/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/OPS:418978\", \"body\": { }, \"instance\": \"PROD\", \"reason\": \"one line\" }");
            sb.AppendLine();
            sb.AppendLine("To answer the user:");
            sb.AppendLine("{ \"action\": \"answer\", \"markdown\": \"### heading\\n| markdown table |\" }");
            sb.AppendLine();
            sb.AppendLine("After each sql action you receive a user message starting with SQL_RESULT: containing columns, rows (max 200), rowCount, truncated, or error. After each fusion action you receive FUSION_RESULT: with the HTTP status and response body (possibly truncated). You have at most 5 sql/fusion rounds per question; then you must answer.");
            sb.AppendLine();
            sb.AppendLine("<!-- " + PROMPT_TEMPLATE_MARKER + " -->");
            sb.AppendLine("## Oracle Fusion REST catalog");
            sb.AppendLine();
            sb.AppendLine("Use action fusion for these. instance is PROD (default) or TEST. path must start with /fscmRestApi/. GET calls run immediately; POST/PATCH/DELETE are WRITE calls - the app shows the user an approval card first, and you may receive FUSION_RESULT: USER_REJECTED, in which case continue without it and tell the user.");
            sb.AppendLine();
            sb.AppendLine("- GET /fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order={orderNumber}&limit=500");
            sb.AppendLine("  Shipment lines of one sales order. Key fields: OrderNumber, LineStatus (Ready to Release / Released to Warehouse / Staged / Interfaced / Cancelled), LineStatusCode (Y=Interfaced/Shipped, C=Staged, X=Cancelled), Item, ShippedQuantity.");
            sb.AppendLine("- GET /fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub?q=SourceTransactionNumber={orderNumber} (or /OPS:{orderNumber} for one order, add ?expand=lines for lines)");
            sb.AppendLine("  Sales order header/lines from Order Management.");
            sb.AppendLine("- GET /fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions?q=OrganizationName=GIC;TransactionTypeName=Direct Organization Transfer");
            sb.AppendLine("  Errored/staged inventory transactions awaiting processing.");
            sb.AppendLine("- PATCH /fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/OPS:{orderNumber}   (WRITE)");
            sb.AppendLine("  Cancel order lines. body: { \"lines\": [ { \"FulfillLineId\": 123, \"OrderedQuantity\": 0, \"CancelReason\": \"OUT OF STOCK\" } ] }. Get FulfillLineId from wms_order_shipment_lines or from a fusion GET first. Cancelling a main line must include its child lines (numbered sub-lines like 3.1, or BOGO promo items).");
            sb.AppendLine("- POST /fscmRestApi/resources/11.13.18.05/pickTransactions   (WRITE) - pick confirm.");
            sb.AppendLine("- POST /fscmRestApi/resources/11.13.18.05/shipmentTransactionRequests   (WRITE) - shipping transaction request / pick release.");
            sb.AppendLine("- POST /fscmRestApi/resources/11.13.18.05/shippingTransactions   (WRITE) - ship confirm.");
            sb.AppendLine("- DELETE /fscmRestApi/resources/11.13.18.05/inventoryStagedTransactions/{TransactionInterfaceId}   (WRITE) - remove an errored staged transaction.");
            sb.AppendLine();
            sb.AppendLine("Routing rule: when the user's message mentions \"fusion\", prefer these Fusion REST services over SQL. Otherwise prefer SQL against the local WMS schema; combine both when useful (e.g. FULFILL_LINE_ID from SQL, then a Fusion PATCH).");
            sb.AppendLine();
            sb.AppendLine("## Interactive grid answers (selectable lists with actions)");
            sb.AppendLine();
            sb.AppendLine("When the user asks for a list they may want to ACT ON (cancellable/Scheduled/Manual Reservation lines, staged transaction errors, orders to process) - or asks for a selectable/checkbox list - answer with action grid instead of a markdown table:");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"grid\", \"title\": \"Manual Reservation lines - Trip 6720\", \"markdown\": \"one-line intro\",");
            sb.AppendLine("  \"columns\": [\"Order\", \"Line\", \"Item\", \"Description\", \"Status\", \"Qty\"],");
            sb.AppendLine("  \"rows\": [ { \"cells\": [\"418978\", \"3\", \"EFI218893001B\", \"Corned Beef 340g\", \"Manual Reservation Required\", \"5\"],");
            sb.AppendLine("               \"data\": { \"ORDER_NUMBER\": \"418978\", \"LINE_NUMBER\": \"3\", \"FULFILL_LINE_ID\": 300001234, \"STATUS\": \"Manual Reservation Required\", \"ITEM\": \"EFI218893001B\" } } ],");
            sb.AppendLine("  \"actions\": [ { \"id\": \"cancel_lines\", \"label\": \"Cancel selected lines\",");
            sb.AppendLine("                  \"instruction\": \"Cancel the selected order lines in Fusion (PATCH salesOrdersForOrderHub, OrderedQuantity 0, CancelReason OUT OF STOCK), including their child lines (numbered sub-lines or BOGO promo items)\" } ] }");
            sb.AppendLine();
            sb.AppendLine("Grid rules:");
            sb.AppendLine("- cells align 1:1 with columns; max 200 rows; 1-3 actions.");
            sb.AppendLine("- data must carry EVERY identifier a follow-up action needs. For line-cancel grids FULFILL_LINE_ID and ORDER_NUMBER are mandatory (query wms_order_shipment_lines or a fusion GET to obtain them).");
            sb.AppendLine("- When the user selects rows and clicks an action you receive: GRID_ACTION: {\"actionId\":\"...\",\"instruction\":\"...\",\"selectedRows\":[ <data objects> ]}");
            sb.AppendLine("  Perform that action for exactly those rows - writes go through action fusion (the user then sees an approval card). Group lines of the same order into ONE PATCH. When done, reply with action answer summarizing what happened.");
            sb.AppendLine();
            sb.AppendLine("## Saving reports");
            sb.AppendLine();
            sb.AppendLine("When the user asks to SAVE something as a report (\"save this as a report\", \"save this KPI\"), reply with:");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"save_report\", \"name\": \"Weekly WMS KPIs\", \"description\": \"one line\", \"category\": \"KPI\",");
            sb.AppendLine("  \"sql\": \"SELECT ... WHERE trip_date >= :P_START_DATE\",");
            sb.AppendLine("  \"params\": [ { \"name\": \"P_START_DATE\", \"label\": \"Start date\", \"dataType\": \"DATE\", \"defaultValue\": null, \"required\": true } ] }");
            sb.AppendLine();
            sb.AppendLine("Rules: single SELECT; turn the literal filters of the SQL you last ran into :P_XXX bind parameters where a future user would want to choose the value (trip id, order number, date range); dataType is TEXT, NUMBER or DATE (DATE values are exchanged as YYYY-MM-DD); params may be empty for a fixed report. You then receive REPORT_SAVE_RESULT: {success, reportId} - confirm to the user with action answer, mentioning the report name and its parameters. Saved reports appear in the Reports tab where the user re-runs them live with prompted parameters.");
            sb.AppendLine();
            sb.AppendLine("## SQL rules");
            sb.AppendLine();
            sb.AppendLine("- Oracle dialect. Single SELECT (or WITH) statement only - no INSERT/UPDATE/DELETE/DDL, no semicolons, no PL/SQL.");
            sb.AppendLine("- Today = TRUNC(SYSDATE). Date ranges: col >= TRUNC(SYSDATE) AND col < TRUNC(SYSDATE)+1.");
            sb.AppendLine("- Always alias aggregates. Prefer explicit column lists over SELECT *.");
            sb.AppendLine("- Add FETCH FIRST 200 ROWS ONLY yourself when the question implies a list.");
            sb.AppendLine("- Never guess a column that is not in the catalog below. If unsure, ask a clarifying question via action answer.");
            sb.AppendLine("- On an error result (ORA message), correct the SQL and try again within the round budget.");
            sb.AppendLine();
            sb.AppendLine("## Formatting rules");
            sb.AppendLine();
            sb.AppendLine("- Answers in markdown. Tabular data as a markdown table (max 30 rows inline; otherwise summarize and say the full set is in the results panel).");
            sb.AppendLine("- State that SQL was run and how many rows came back.");
            sb.AppendLine();
            sb.AppendLine("## Schema catalog");
            sb.AppendLine();
            sb.AppendLine("Column types: n=number, d=date/timestamp, s=string. Comments follow in quotes / after --.");
            sb.AppendLine();
            sb.AppendLine("```");
            sb.Append(catalog);
            sb.AppendLine("```");

            await File.WriteAllTextAsync(claudeMdPath, sb.ToString());
            return objectCount;
        }

        private static (string Catalog, int Count) CompactCatalog(string metadataJson)
        {
            var sb = new StringBuilder();
            int count = 0;
            using var doc = JsonDocument.Parse(metadataJson);
            if (!doc.RootElement.TryGetProperty("objects", out var objects))
                return ("", 0);

            foreach (var obj in objects.EnumerateArray())
            {
                string name = obj.GetProperty("name").GetString();
                string tabComment = obj.TryGetProperty("comment", out var tcEl) && tcEl.ValueKind == JsonValueKind.String
                    ? tcEl.GetString() : null;

                var cols = new List<string>();
                if (obj.TryGetProperty("columns", out var colsEl))
                {
                    foreach (var col in colsEl.EnumerateArray())
                    {
                        string cname = col.GetProperty("name").GetString();
                        string dtype = col.TryGetProperty("dataType", out var dtEl) && dtEl.ValueKind == JsonValueKind.String
                            ? dtEl.GetString() : "";
                        string letter = "s";
                        if (dtype.StartsWith("NUMBER") || dtype.StartsWith("FLOAT") || dtype.StartsWith("BINARY")) letter = "n";
                        else if (dtype.StartsWith("DATE") || dtype.StartsWith("TIMESTAMP")) letter = "d";

                        string ccomment = col.TryGetProperty("comment", out var ccEl) && ccEl.ValueKind == JsonValueKind.String
                            ? ccEl.GetString() : null;

                        cols.Add(cname + " " + letter +
                                 (string.IsNullOrWhiteSpace(ccomment) ? "" : " \"" + ccomment.Replace("\"", "'") + "\""));
                    }
                }

                sb.Append(name).Append('(').Append(string.Join(", ", cols)).Append(')');
                if (!string.IsNullOrWhiteSpace(tabComment))
                    sb.Append(" -- ").Append(tabComment.Replace("\n", " "));
                sb.AppendLine();
                count++;
            }
            return (sb.ToString(), count);
        }

        // ============================================================
        // Chat turn: user message -> action loop -> final answer
        // ============================================================
        public Task<AiChatResult> SendAsync(string userText, string sessionId, Func<object, Task> onEvent)
        {
            return RunLoopAsync(userText, sessionId, onEvent);
        }

        /// <summary>
        /// Continues a turn that stopped for a Fusion write approval.
        /// Executes (or skips) the pending call, feeds FUSION_RESULT back and resumes the loop.
        /// </summary>
        public async Task<AiChatResult> ResumeWithFusionDecisionAsync(bool approve, AiPendingFusion pending,
            string sessionId, Func<object, Task> onEvent)
        {
            string prompt;
            var preRounds = new List<AiSqlRound>();

            if (approve && pending != null)
            {
                await onEvent(new { action = "aiChatEvent", eventType = "status", text = $"Executing {pending.Method} (approved)..." });
                var round = await ExecuteFusionAsync(pending.Method, pending.Path, pending.Body, pending.Instance, pending.Reason);
                preRounds.Add(round);
                await onEvent(new
                {
                    action = "aiChatEvent", eventType = "sqlRound", round = 1,
                    kind = "fusion", method = round.Method, path = round.Path,
                    sql = (string)null, success = round.Success,
                    rowCount = round.RowCount, elapsedMs = round.ElapsedMs, error = round.Error
                });
                prompt = "FUSION_RESULT: " + TruncateForModel(round.ResultJson);
            }
            else
            {
                prompt = "FUSION_RESULT: USER_REJECTED - the user declined this write call. Continue without it and tell the user it was not executed.";
            }

            var result = await RunLoopAsync(prompt, sessionId, onEvent);
            result.Rounds.InsertRange(0, preRounds);
            return result;
        }

        private async Task<AiChatResult> RunLoopAsync(string initialPrompt, string sessionId, Func<object, Task> onEvent)
        {
            var result = new AiChatResult { SessionId = sessionId };
            string prompt = initialPrompt;
            bool retriedMalformed = false;
            int guard = 0;

            while (guard++ < (MAX_SQL_ROUNDS * 2) + 4)
            {
                await onEvent(new { action = "aiChatEvent", eventType = "status", text = "Claude is thinking..." });

                var turn = await RunTurnAsync(prompt, result.SessionId);
                if (!turn.Ok)
                {
                    result.Success = false;
                    result.Error = turn.Error;
                    return result;
                }
                if (!string.IsNullOrEmpty(turn.SessionId)) result.SessionId = turn.SessionId;

                JsonDocument modelJson = ExtractJson(turn.ResultText);
                if (modelJson == null)
                {
                    if (!retriedMalformed)
                    {
                        retriedMalformed = true;
                        prompt = "Your previous reply was not a single valid JSON object. Reply again with EXACTLY ONE JSON object per the protocol (action sql or action answer), nothing else.";
                        continue;
                    }
                    result.Success = false;
                    result.Error = "The model did not return valid JSON. Raw reply: " +
                                   Truncate(turn.ResultText, 500);
                    return result;
                }

                using (modelJson)
                {
                    string action = modelJson.RootElement.TryGetProperty("action", out var aEl) ? aEl.GetString() : null;

                    if (string.Equals(action, "answer", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Success = true;
                        result.Markdown = modelJson.RootElement.TryGetProperty("markdown", out var mEl)
                            ? mEl.GetString() : "(empty answer)";
                        return result;
                    }

                    if (string.Equals(action, "grid", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Success = true;
                        result.Markdown = modelJson.RootElement.TryGetProperty("markdown", out var gmEl) &&
                                          gmEl.ValueKind == JsonValueKind.String ? gmEl.GetString() : "";
                        result.GridJson = modelJson.RootElement.GetRawText();
                        return result;
                    }

                    if (string.Equals(action, "sql", StringComparison.OrdinalIgnoreCase))
                    {
                        if (result.Rounds.Count >= MAX_SQL_ROUNDS)
                        {
                            prompt = "You have used all " + MAX_SQL_ROUNDS +
                                     " SQL rounds. Reply NOW with { \"action\": \"answer\", \"markdown\": \"...\" } summarizing what you found.";
                            continue;
                        }

                        string sql    = modelJson.RootElement.TryGetProperty("sql",    out var sEl) ? sEl.GetString() : "";
                        string reason = modelJson.RootElement.TryGetProperty("reason", out var rEl) ? rEl.GetString() : "";
                        int roundNo = result.Rounds.Count + 1;

                        await onEvent(new { action = "aiChatEvent", eventType = "status", text = $"Running SQL (round {roundNo})..." });

                        var round = await ExecuteGatewayAsync(sql, reason);
                        result.Rounds.Add(round);

                        await onEvent(new
                        {
                            action = "aiChatEvent",
                            eventType = "sqlRound",
                            round = roundNo,
                            kind = "sql",
                            sql = round.Sql,
                            method = (string)null,
                            path = (string)null,
                            success = round.Success,
                            rowCount = round.RowCount,
                            elapsedMs = round.ElapsedMs,
                            error = round.Error
                        });

                        prompt = "SQL_RESULT: " + round.ResultJson;
                        continue;
                    }

                    if (string.Equals(action, "fusion", StringComparison.OrdinalIgnoreCase))
                    {
                        if (result.Rounds.Count >= MAX_SQL_ROUNDS)
                        {
                            prompt = "You have used all " + MAX_SQL_ROUNDS +
                                     " rounds. Reply NOW with { \"action\": \"answer\", \"markdown\": \"...\" } summarizing what you found.";
                            continue;
                        }

                        var root = modelJson.RootElement;
                        string method   = root.TryGetProperty("method",   out var mtEl) ? (mtEl.GetString() ?? "GET").ToUpperInvariant() : "GET";
                        string path     = root.TryGetProperty("path",     out var pEl)  ? pEl.GetString() : "";
                        string instance = root.TryGetProperty("instance", out var iEl) && iEl.ValueKind == JsonValueKind.String
                                          ? iEl.GetString() : "PROD";
                        string reason   = root.TryGetProperty("reason",   out var rsEl) ? rsEl.GetString() : "";
                        string body     = null;
                        if (root.TryGetProperty("body", out var bEl) && bEl.ValueKind != JsonValueKind.Null &&
                            bEl.ValueKind != JsonValueKind.Undefined)
                            body = bEl.GetRawText();

                        if (string.IsNullOrWhiteSpace(path) || !path.StartsWith("/fscmRestApi/", StringComparison.OrdinalIgnoreCase))
                        {
                            prompt = "FUSION_RESULT: {\"success\":false,\"error\":\"Invalid path - it must start with /fscmRestApi/\"}";
                            continue;
                        }

                        bool isWrite = method != "GET";
                        if (isWrite)
                        {
                            // stop here - the UI shows an approval card, then calls ResumeWithFusionDecisionAsync
                            result.Success = true;
                            result.RequiresApproval = true;
                            result.Pending = new AiPendingFusion
                            {
                                Method = method, Path = path, Body = body,
                                Instance = instance, Reason = reason
                            };
                            return result;
                        }

                        int fRoundNo = result.Rounds.Count + 1;
                        await onEvent(new { action = "aiChatEvent", eventType = "status", text = $"Calling Fusion {method} (round {fRoundNo})..." });

                        var fRound = await ExecuteFusionAsync(method, path, body, instance, reason);
                        result.Rounds.Add(fRound);

                        await onEvent(new
                        {
                            action = "aiChatEvent",
                            eventType = "sqlRound",
                            round = fRoundNo,
                            kind = "fusion",
                            sql = (string)null,
                            method = fRound.Method,
                            path = fRound.Path,
                            success = fRound.Success,
                            rowCount = fRound.RowCount,
                            elapsedMs = fRound.ElapsedMs,
                            error = fRound.Error
                        });

                        prompt = "FUSION_RESULT: " + TruncateForModel(fRound.ResultJson);
                        continue;
                    }

                    if (string.Equals(action, "save_report", StringComparison.OrdinalIgnoreCase))
                    {
                        await onEvent(new { action = "aiChatEvent", eventType = "status", text = "Saving report..." });
                        string saveResult;
                        try
                        {
                            // pass the model's object through, adding the app user
                            var root = modelJson.RootElement;
                            using var ms = new MemoryStream();
                            using (var w = new Utf8JsonWriter(ms))
                            {
                                w.WriteStartObject();
                                foreach (var prop in root.EnumerateObject())
                                {
                                    if (prop.NameEquals("action")) continue;
                                    prop.WriteTo(w);
                                }
                                w.WriteString("appUser", Environment.UserName);
                                w.WriteEndObject();
                            }
                            var resp = await _http.PostAsync(REPORT_SAVE_URL,
                                new StringContent(Encoding.UTF8.GetString(ms.ToArray()), Encoding.UTF8, "application/json"));
                            saveResult = await resp.Content.ReadAsStringAsync();
                        }
                        catch (Exception ex)
                        {
                            saveResult = JsonSerializer.Serialize(new { success = false, error = ex.Message });
                        }
                        await onEvent(new { action = "aiChatEvent", eventType = "reportSaved", result = saveResult });
                        prompt = "REPORT_SAVE_RESULT: " + saveResult;
                        continue;
                    }

                    // Unknown action - treat like malformed once
                    if (!retriedMalformed)
                    {
                        retriedMalformed = true;
                        prompt = "Unknown action '" + action + "'. Reply with EXACTLY ONE JSON object: action sql or action answer.";
                        continue;
                    }
                    result.Success = false;
                    result.Error = "The model returned an unknown action: " + action;
                    return result;
                }
            }

            result.Success = false;
            result.Error = "Conversation loop exceeded the round budget.";
            return result;
        }

        public void Cancel()
        {
            try
            {
                var p = _current;
                if (p != null && !p.HasExited)
                    p.Kill(entireProcessTree: true);
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[ClaudeCliService] Cancel failed: " + ex.Message);
            }
        }

        // ============================================================
        // One headless CLI invocation
        // ============================================================
        private class TurnOutcome
        {
            public bool Ok;
            public string ResultText;
            public string SessionId;
            public string Error;
        }

        private async Task<TurnOutcome> RunTurnAsync(string prompt, string sessionId)
        {
            var outcome = new TurnOutcome();
            Directory.CreateDirectory(WorkspaceDir);

            string args = "/c claude -p --input-format stream-json --output-format stream-json --verbose";
            if (!string.IsNullOrEmpty(sessionId))
                args += " --resume " + sessionId;

            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = args,
                WorkingDirectory = WorkspaceDir,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            Process p = null;
            try
            {
                p = Process.Start(psi);
                _current = p;

                // user turn on stdin as one JSON line, then close stdin
                var stdinObj = new
                {
                    type = "user",
                    message = new
                    {
                        role = "user",
                        content = new object[] { new { type = "text", text = prompt } }
                    }
                };
                await p.StandardInput.WriteLineAsync(JsonSerializer.Serialize(stdinObj));
                p.StandardInput.Close();

                var assistantText = new StringBuilder();
                var stderrTask = p.StandardError.ReadToEndAsync();

                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(CLI_TIMEOUT_SECONDS));
                string line;
                while ((line = await p.StandardOutput.ReadLineAsync().WaitAsync(cts.Token)) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        using var evt = JsonDocument.Parse(line);
                        var root = evt.RootElement;
                        string type = root.TryGetProperty("type", out var tEl) ? tEl.GetString() : "";

                        if (root.TryGetProperty("session_id", out var sidEl) && sidEl.ValueKind == JsonValueKind.String)
                            outcome.SessionId = sidEl.GetString();

                        if (type == "assistant" &&
                            root.TryGetProperty("message", out var msgEl) &&
                            msgEl.TryGetProperty("content", out var contentEl))
                        {
                            foreach (var part in contentEl.EnumerateArray())
                            {
                                if (part.TryGetProperty("type", out var ptEl) && ptEl.GetString() == "text" &&
                                    part.TryGetProperty("text", out var txtEl))
                                    assistantText.Append(txtEl.GetString());
                            }
                        }
                        else if (type == "result")
                        {
                            bool isError = root.TryGetProperty("is_error", out var ieEl) &&
                                           ieEl.ValueKind == JsonValueKind.True;
                            string resultText = root.TryGetProperty("result", out var resEl) &&
                                                resEl.ValueKind == JsonValueKind.String
                                ? resEl.GetString() : null;
                            if (isError)
                            {
                                outcome.Ok = false;
                                outcome.Error = "Claude CLI error: " + Truncate(resultText ?? "(no message)", 500);
                            }
                            else
                            {
                                outcome.Ok = true;
                                outcome.ResultText = !string.IsNullOrEmpty(resultText)
                                    ? resultText
                                    : assistantText.ToString();
                            }
                        }
                    }
                    catch (JsonException)
                    {
                        // non-JSON noise on stdout - ignore
                    }
                }

                await p.WaitForExitAsync(cts.Token);

                if (!outcome.Ok && outcome.Error == null)
                {
                    string stderr = await stderrTask;
                    string fallback = assistantText.ToString();
                    if (!string.IsNullOrWhiteSpace(fallback))
                    {
                        outcome.Ok = true;
                        outcome.ResultText = fallback;
                    }
                    else
                    {
                        outcome.Error = "Claude CLI produced no result." +
                                        (string.IsNullOrWhiteSpace(stderr) ? "" : " stderr: " + Truncate(stderr, 500));
                    }
                }
            }
            catch (OperationCanceledException)
            {
                try { if (p != null && !p.HasExited) p.Kill(entireProcessTree: true); } catch { }
                outcome.Ok = false;
                outcome.Error = "Claude CLI timed out after " + CLI_TIMEOUT_SECONDS + "s (or was cancelled).";
            }
            catch (Exception ex)
            {
                outcome.Ok = false;
                outcome.Error = "Failed to run Claude CLI: " + ex.Message +
                                " - is the CLI installed and logged in? (npm install -g @anthropic-ai/claude-code, then 'claude login')";
            }
            finally
            {
                _current = null;
            }
            return outcome;
        }

        // ============================================================
        // Guarded SQL gateway call
        // ============================================================
        private async Task<AiSqlRound> ExecuteGatewayAsync(string sql, string reason)
        {
            var round = new AiSqlRound { Sql = sql, Reason = reason };
            try
            {
                var body = JsonSerializer.Serialize(new { sql, maxRows = 200, appUser = Environment.UserName });
                var resp = await _http.PostAsync(QUERY_URL,
                    new StringContent(body, Encoding.UTF8, "application/json"));
                string respBody = await resp.Content.ReadAsStringAsync();
                round.ResultJson = respBody;

                try
                {
                    using var doc = JsonDocument.Parse(respBody);
                    var root = doc.RootElement;
                    round.Success = root.TryGetProperty("success", out var sEl) &&
                                    sEl.ValueKind == JsonValueKind.True;
                    if (root.TryGetProperty("rowCount", out var rcEl) && rcEl.ValueKind == JsonValueKind.Number)
                        round.RowCount = rcEl.GetInt32();
                    if (root.TryGetProperty("elapsedMs", out var emEl) && emEl.ValueKind == JsonValueKind.Number)
                        round.ElapsedMs = emEl.GetInt64();
                    if (root.TryGetProperty("error", out var errEl) && errEl.ValueKind == JsonValueKind.String)
                        round.Error = errEl.GetString();
                }
                catch (JsonException)
                {
                    round.Success = false;
                    round.Error = "Gateway returned non-JSON (HTTP " + (int)resp.StatusCode + ")";
                    round.ResultJson = JsonSerializer.Serialize(new
                    {
                        success = false,
                        error = "Gateway returned non-JSON response: " + Truncate(respBody, 300)
                    });
                }
            }
            catch (Exception ex)
            {
                round.Success = false;
                round.Error = ex.Message;
                round.ResultJson = JsonSerializer.Serialize(new { success = false, error = ex.Message });
            }
            return round;
        }

        // ============================================================
        // Oracle Fusion REST call (Basic auth via FusionCredentialsService)
        // ============================================================
        private async Task<AiSqlRound> ExecuteFusionAsync(string method, string path, string body,
            string instance, string reason)
        {
            var round = new AiSqlRound
            {
                Kind = "fusion",
                Method = method,
                Path = path,
                Reason = reason
            };
            var sw = Stopwatch.StartNew();
            try
            {
                var (username, password) = await FusionCredentialsService.GetAsync();
                if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
                    throw new Exception("Fusion credentials are not configured in the app.");

                string baseUrl = string.Equals(instance, "TEST", StringComparison.OrdinalIgnoreCase)
                    ? FUSION_TEST_BASE : FUSION_PROD_BASE;
                string url = baseUrl + path;

                using var req = new HttpRequestMessage(new HttpMethod(method), url);
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
                    "Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(username + ":" + password)));
                req.Headers.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
                if (!string.IsNullOrEmpty(body) && method != "GET" && method != "DELETE")
                    req.Content = new StringContent(body, Encoding.UTF8, "application/json");

                var resp = await _http.SendAsync(req);
                string respBody = await resp.Content.ReadAsStringAsync();
                sw.Stop();

                round.ElapsedMs = sw.ElapsedMilliseconds;
                round.Success = resp.IsSuccessStatusCode;
                round.RowCount = CountFusionItems(respBody);
                if (!resp.IsSuccessStatusCode)
                    round.Error = "HTTP " + (int)resp.StatusCode + " " + resp.ReasonPhrase;

                // wrap so the model always sees a JSON envelope with the HTTP status
                string stored = respBody != null && respBody.Length > FUSION_STORE_MAX_CHARS
                    ? respBody.Substring(0, FUSION_STORE_MAX_CHARS) : respBody;
                round.ResultJson = JsonSerializer.Serialize(new
                {
                    success = round.Success,
                    httpStatus = (int)resp.StatusCode,
                    method = method,
                    path = path,
                    body = stored
                });
            }
            catch (Exception ex)
            {
                sw.Stop();
                round.ElapsedMs = sw.ElapsedMilliseconds;
                round.Success = false;
                round.Error = ex.Message;
                round.ResultJson = JsonSerializer.Serialize(new { success = false, error = ex.Message, method, path });
            }
            return round;
        }

        private static int CountFusionItems(string json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                    doc.RootElement.TryGetProperty("items", out var items) &&
                    items.ValueKind == JsonValueKind.Array)
                    return items.GetArrayLength();
            }
            catch { }
            return 0;
        }

        private static string TruncateForModel(string s)
        {
            if (s == null) return "";
            return s.Length <= FUSION_RESULT_MAX_CHARS
                ? s
                : s.Substring(0, FUSION_RESULT_MAX_CHARS) + " ...(truncated - refine the query with q= filters or fields= to reduce the payload)";
        }

        // ============================================================
        // Helpers
        // ============================================================
        private static JsonDocument ExtractJson(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            string t = text.Trim();

            // strip markdown fences if present
            if (t.StartsWith("```"))
            {
                int firstNewline = t.IndexOf('\n');
                if (firstNewline > 0) t = t.Substring(firstNewline + 1);
                int fence = t.LastIndexOf("```", StringComparison.Ordinal);
                if (fence >= 0) t = t.Substring(0, fence);
                t = t.Trim();
            }

            int start = t.IndexOf('{');
            int end = t.LastIndexOf('}');
            if (start < 0 || end <= start) return null;
            t = t.Substring(start, end - start + 1);

            try { return JsonDocument.Parse(t); }
            catch (JsonException) { return null; }
        }

        private static string Truncate(string s, int max)
        {
            if (s == null) return "";
            return s.Length <= max ? s : s.Substring(0, max) + "...";
        }
    }
}

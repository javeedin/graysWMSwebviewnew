using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
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
    /// A DDL/DML statement waiting for on-screen user approval.
    /// </summary>
    public class AiPendingDbWrite
    {
        public string Sql { get; set; }
        public string Reason { get; set; }
    }

    /// <summary>
    /// A local print request waiting for on-screen user approval.
    /// The page supplies the grid data (the last shown result) on approve.
    /// </summary>
    public class AiPendingPrint
    {
        public string Printer { get; set; }
        public string Title { get; set; }
        public string Reason { get; set; }
    }

    /// <summary>
    /// Order-PDF print request waiting for on-screen user approval:
    /// each order's sales-order PDF is downloaded from Oracle BI
    /// Publisher (SOAP) and sent to the chosen Windows printer.
    /// </summary>
    public class AiPendingPrintOrders
    {
        public List<string> Orders { get; set; } = new List<string>();
        public string Printer { get; set; }
        public string Instance { get; set; }
        public string Reason { get; set; }
    }

    /// <summary>
    /// A scheduled job definition waiting for on-screen user approval.
    /// JobJson is the model's raw schedule_job object.
    /// </summary>
    public class AiPendingJob
    {
        public string JobJson { get; set; }
    }

    /// <summary>
    /// An outgoing email waiting for on-screen user approval.
    /// </summary>
    public class AiPendingEmail
    {
        public string To { get; set; }
        public string Cc { get; set; }
        public string Subject { get; set; }
        public string BodyHtml { get; set; }
        public string Reason { get; set; }
    }

    /// <summary>
    /// Which Claude transport to use: the local CLI (subscription login)
    /// or the Claude API directly (api key, no install on the PC).
    /// </summary>
    public class AiEngineConfig
    {
        public string Mode { get; set; } = "cli";          // "cli" | "api"
        public string ApiKey { get; set; }
        public string Model { get; set; } = "claude-sonnet-5";
    }

    /// <summary>
    /// Final outcome of one user message (after up to 5 SQL/Fusion rounds).
    /// </summary>
    public class AiChatResult
    {
        // API mode only: serialized message list so an approval pause can
        // resume the exact conversation (the CLI uses SessionId instead)
        public string ApiConversation { get; set; }
        public bool Success { get; set; }
        public string Markdown { get; set; }
        public string GridJson { get; set; }     // raw {"action":"grid",...} object for interactive answers
        public string ApiFormJson { get; set; }  // raw {"action":"api_form",...} object - JS renders the form and runs the API after user confirmation
        public AiPendingPrint PendingPrint { get; set; }
        public AiPendingPrintOrders PendingPrintOrders { get; set; }
        public string Error { get; set; }
        public string SessionId { get; set; }
        public bool RequiresApproval { get; set; }
        public AiPendingFusion Pending { get; set; }
        public AiPendingEmail PendingEmail { get; set; }
        public AiPendingDbWrite PendingDbWrite { get; set; }
        public AiPendingJob PendingJob { get; set; }
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

        /// <summary>Folder for AI-downloaded files. The page sends the user's
        /// configured folder with each chat message; falls back to the default.</summary>
        public string DownloadFolder { get; set; } = @"C:\fusion\ai_chat\downloads";

        /// <summary>Current PROD/TEST instance, sent by the page with each
        /// chat message. Used to resolve action policies.</summary>
        public string CurrentInstance { get; set; } = "PROD";

        // ------------------------------------------------------------
        // Action policies (WMS_AI_POLICIES): AUTO / ASK / DENY per
        // user + action + instance. Cached 5 minutes; missing = ASK.
        // ------------------------------------------------------------
        private class PolicyRule
        {
            public string AppUser;
            public string Action;
            public string Instance;
            public string Mode;
            public int? MaxBatch;
        }
        private List<PolicyRule> _policies;
        private DateTime _policiesLoadedAt = DateTime.MinValue;
        private const string POLICIES_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/policies";

        private async Task<(string Mode, int? MaxBatch)> GetPolicyAsync(string actionKey)
        {
            try
            {
                if (_policies == null || (DateTime.Now - _policiesLoadedAt).TotalMinutes > 5)
                {
                    var list = new List<PolicyRule>();
                    var resp = await _http.GetAsync(POLICIES_URL + "?appuser=" + Uri.EscapeDataString(Environment.UserName) + "&t=" + DateTime.Now.Ticks);
                    if (resp.IsSuccessStatusCode)
                    {
                        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                        if (doc.RootElement.TryGetProperty("policies", out var arr) && arr.ValueKind == JsonValueKind.Array)
                            foreach (var p in arr.EnumerateArray())
                                list.Add(new PolicyRule
                                {
                                    AppUser  = p.TryGetProperty("appUser",  out var u) ? u.GetString() : "*",
                                    Action   = p.TryGetProperty("action",   out var a) ? a.GetString() : "",
                                    Instance = p.TryGetProperty("instance", out var i) ? i.GetString() : "*",
                                    Mode     = p.TryGetProperty("mode",     out var m) ? m.GetString() : "ASK",
                                    MaxBatch = p.TryGetProperty("maxBatch", out var b) && b.ValueKind == JsonValueKind.Number ? b.GetInt32() : (int?)null
                                });
                        _policies = list;
                        _policiesLoadedAt = DateTime.Now;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine("[ClaudeCliService] policy fetch failed: " + ex.Message);
            }

            if (_policies == null) return ("ASK", null);   // endpoint missing -> safe default

            string user = Environment.UserName;
            string inst = string.Equals(CurrentInstance, "TEST", StringComparison.OrdinalIgnoreCase) ? "TEST" : "PROD";
            PolicyRule Find(string pu, string pi) =>
                _policies.Find(p => string.Equals(p.Action, actionKey, StringComparison.OrdinalIgnoreCase)
                                 && string.Equals(p.AppUser, pu, StringComparison.OrdinalIgnoreCase)
                                 && string.Equals(p.Instance, pi, StringComparison.OrdinalIgnoreCase));
            var rule = Find(user, inst) ?? Find(user, "*") ?? Find("*", inst) ?? Find("*", "*");
            return rule == null ? ("ASK", null) : (rule.Mode?.ToUpperInvariant() ?? "ASK", rule.MaxBatch);
        }

        private const int MAX_SQL_ROUNDS = 5;
        private const int CLI_TIMEOUT_SECONDS = 240;
        private const string PROMPT_TEMPLATE_MARKER = "FUSION-CATALOG-V16";
        private const string JOBS_CREATE_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/jobs/create";
        private const string DB_WRITE_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/executewrite";
        private const string REPORT_SAVE_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/reports/save";
        private const int FUSION_RESULT_MAX_CHARS = 25000;   // fed back to the model
        private const int FUSION_STORE_MAX_CHARS  = 100000;  // kept for the inspector

        private const string ORDS_ROOT_URL =
            "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP";
        // read-only ORDS helper endpoints the model may GET via action "ords"
        private static readonly string[] ORDS_READ_WHITELIST = { "/ARMODULE/BOGO" };

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
            sb.AppendLine("## Database writes (CREATE TABLE / INSERT / UPDATE / DELETE ...)");
            sb.AppendLine();
            sb.AppendLine("When the user asks to CREATE or change database objects or data, reply with:");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"db_write\", \"sql\": \"CREATE TABLE ai_student (studentno NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY, studentname VARCHAR2(200) NOT NULL)\", \"reason\": \"one line\" }");
            sb.AppendLine();
            sb.AppendLine("Rules: exactly ONE statement starting with CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, MERGE, COMMENT or TRUNCATE; no PL/SQL blocks, no GRANT/REVOKE, no ALTER SESSION/SYSTEM. The app shows the user an approval card with the exact statement - nothing runs until they approve. You then receive DB_WRITE_RESULT: {success, verb, rowsAffected} or USER_REJECTED - confirm with action answer. Always include sensible constraints (primary key, NOT NULL) when creating tables. After a successful CREATE/ALTER/DROP the schema catalog refreshes automatically, so you can query the new object afterwards. For UPDATE/DELETE, first run a SELECT (action sql) to show the user which rows will be affected. SELECT statements still use action sql, never db_write.");
            sb.AppendLine();
            sb.AppendLine("## Scheduling background jobs (DBMS_SCHEDULER)");
            sb.AppendLine();
            sb.AppendLine("When the user asks to SCHEDULE recurring or delayed work (\"every 10 minutes...\", \"tonight at 8pm...\", \"keep checking until...\"), reply with:");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"schedule_job\", \"name\": \"Cancel manual lines trip 6720\", \"description\": \"one line\",");
            sb.AppendLine("  \"scheduleType\": \"REPEAT_UNTIL_DONE\",   // or ONCE or RECURRING");
            sb.AppendLine("  \"startAt\": \"2026-09-12 18:00\",          // optional, YYYY-MM-DD HH24:MI, default now");
            sb.AppendLine("  \"intervalMinutes\": 10,                    // for RECURRING / REPEAT_UNTIL_DONE, min 2");
            sb.AppendLine("  \"maxRuns\": 50, \"untilDate\": \"2026-09-19\",");
            sb.AppendLine("  \"instance\": \"PROD\",                       // PROD or TEST; OMIT it unless the user names one - the DB then uses its configured default");
            sb.AppendLine("  \"completionSql\": \"SELECT 1 FROM wms_order_shipment_lines WHERE ... \",   // REPEAT_UNTIL_DONE: job is DONE when this SELECT returns 0 rows");
            sb.AppendLine("  \"steps\": [");
            sb.AppendLine("    { \"type\": \"rest\", \"method\": \"GET\", \"auth\": \"none\",");
            sb.AppendLine("      \"url\": \"https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/...\",");
            sb.AppendLine("      \"extract\": { \"FLID\": \"items[1].FULFILL_LINE_ID\" } },   // APEX_JSON paths - arrays are 1-BASED");
            sb.AppendLine("    { \"type\": \"rest\", \"method\": \"PATCH\", \"auth\": \"fusion\",");
            sb.AppendLine("      \"url\": \"#FUSION_BASE#/fscmRestApi/...\",   // #FUSION_BASE# = the job's Fusion instance base URL, resolved at run time");
            sb.AppendLine("      \"body\": { \"lines\": [ { \"FulfillLineId\": \"#FLID#\", \"OrderedQuantity\": 0, \"CancelReason\": \"OUT OF STOCK\" } ] } },");
            sb.AppendLine("    { \"type\": \"sql\", \"sql\": \"SELECT ...\" } ] }");
            sb.AppendLine();
            sb.AppendLine("Rules: steps run in order inside the DATABASE (the app can be closed); rest URLs only on the ORDS host or the two Fusion hosts (efmh / efmh-test); always write Fusion step URLs with #FUSION_BASE# instead of a hardcoded host so the job follows its instance; auth fusion uses stored credentials; #VAR# substitutes values captured by an earlier step's extract; sql steps and completionSql must be plain SELECTs (the runner evaluates SELECT COUNT(*) of them). The app shows the user an approval card with the full plan - nothing is scheduled until approved. You then receive JOB_RESULT: {success, jobId, firstRun} or USER_REJECTED - confirm with action answer and tell the user to watch it in the Scheduled Jobs tab.");
            sb.AppendLine();
            sb.AppendLine("## Action policies (authority limits)");
            sb.AppendLine();
            sb.AppendLine("The app enforces per-user policies on write actions: AUTO (the action runs immediately without an approval card - the result marker says so; tell the user it was auto-approved by policy), ASK (approval card, the default), DENY (you receive ..._RESULT with DENIED_BY_POLICY - tell the user this action is not allowed for them and DO NOT retry or work around it). Policies live in WMS_AI_POLICIES; an admin can change them there.");
            sb.AppendLine();
            sb.AppendLine("## Helper ORDS reads (action ords)");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"ords\", \"path\": \"/ARMODULE/BOGO\", \"params\": { \"p_instance_name\": \"PROD\" }, \"reason\": \"one line\" }");
            sb.AppendLine();
            sb.AppendLine("GET-only, whitelisted helper endpoints on the app's own ORDS. Currently: /ARMODULE/BOGO = the BOGO promotion mapping - items[] rows with mainitemcode (parent item) and promoitemcode (free/child item). Runs immediately; you receive ORDS_RESULT: {...}.");
            sb.AppendLine();
            sb.AppendLine("## Cancelling order lines WITH CHILD LINES (shipping-agent rule)");
            sb.AppendLine();
            sb.AppendLine("Whenever you cancel a MAIN order line (typically status Manual Reservation Required, Scheduled or Backordered), you MUST expand and cancel its child lines exactly like the app's Shipping Agent does:");
            sb.AppendLine("1. Get ALL lines of the order (action sql on the shipment lines for the current instance, or fusion shipmentLines GET): line number, item code, status, FULFILL_LINE_ID.");
            sb.AppendLine("2. NUMBERED SUB-LINES first: children of line N are the lines whose line number starts with \"N.\" (line 3 -> 3.1, 3.2, ...).");
            sb.AppendLine("3. BOGO fallback - ONLY when the parent has no numbered sub-lines at all: fetch /ARMODULE/BOGO once for the current instance (action ords), map the parent's ITEM CODE (uppercase) to its promoitemcode list, and the children are the SAME ORDER's lines whose item code is in that list.");
            sb.AppendLine("4. SKIP (and report, never cancel) any child whose status contains CANCEL, SHIP or INTERFAC, and any child without a FULFILL_LINE_ID.");
            sb.AppendLine("5. Show the user the FULL plan before acting: main lines, child lines marked as child-of-N via SUB-LINE or BOGO, and the skipped ones with reasons (use a grid or a clear list).");
            sb.AppendLine("6. Cancel with ONE fusion PATCH per order (salesOrdersForOrderHub, lines array carrying every FulfillLineId with OrderedQuantity 0 and a CancelReason) - the approval card then covers the whole order's set. Never cancel a child silently; never skip the expansion because the user only named the main line.");
            sb.AppendLine();
            sb.AppendLine("## WMS write APIs (interactive forms)");
            sb.AppendLine();
            sb.AppendLine("The app has a catalog of WMS write webservices (POST/PUT/DELETE - all READS are done with action sql, never these). When the user wants to perform one of these operations, reply with:");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"api_form\", \"apiId\": \"trips.create\", \"values\": { \"trip_date\": \"2026-09-13\", \"priority\": 1 }, \"note\": \"short markdown shown above the form\" }");
            sb.AppendLine();
            sb.AppendLine("The app renders an editable form prefilled with your values; the user reviews, confirms, the app runs the API and logs it, and you receive API_RESULT: {apiId, success, status, response} as the next message - then confirm the outcome with action answer and REMEMBER returned ids (e.g. trip_id) as defaults for follow-up operations in this conversation.");
            sb.AppendLine();
            sb.AppendLine("Catalog (apiId - purpose - body/param fields you may prefill):");
            sb.AppendLine("- trips.create - create a new trip - trip_date, cost_date (YYYY-MM-DD), vehicle, picker (id number), priority (number), loading_bay, notes");
            sb.AppendLine("- trips.addorders - add orders to a trip - trip_id (number), orders (array of {order_number, account_number, account_name, order_date, order_type, salesrep_name, instance})");
            sb.AppendLine("- trip.updatetrip - update trip header - p_trip_id, trip_lorry, trip_status, trip_loading_bay, trip_priority");
            sb.AppendLine("- trip.assignpicker - assign picker to one order - p_trx_number (order number), p_picker_id, p_picker_name");
            sb.AppendLine("- trip.pickerassignment - trip-level picker assignment - raw JSON body");
            sb.AppendLine("- trip.deletetripline - remove one order from its trip - order_number");
            sb.AppendLine("- trip.callpickwave - launch pick wave for one order - warehouse, order_number");
            sb.AppendLine("- trip.pickrelease.oneorder - pick release one order - order_number");
            sb.AppendLine("- trip.cancelorderline - cancel one order line - order_number, line_id");
            sb.AppendLine("- trip.cancelnotpickedlines - cancel not-picked lines of an order - order_number");
            sb.AppendLine("- trip.cancelscheduledlines - cancel scheduled lines of an order - order_number");
            sb.AppendLine("- trip.updatepickconfirmstatus / trip.sets2vdata / trip.processs2v / storetrans.process / materialtrx.allocatelots - advanced, raw JSON body");
            sb.AppendLine("- trip.cancels2vline - cancel staged S2V line - transaction_id;  trip.cancels2vlot - cancel S2V lot - lot_line_id");
            sb.AppendLine();
            sb.AppendLine("Rules: instance fields are filled by the app from the current instance - never include them in values. Prefill everything you can from the conversation (the trip you just created, the orders just discussed). ADD-ORDERS FLOW: when the user pastes order numbers to add to a trip, FIRST run action sql to validate them against the pending shipment lines for the current instance (which exist and are not already on a trip), THEN return api_form for trips.addorders with the valid orders in values.orders (the app shows them as tick rows) and list the invalid ones with reasons in note. If the user did not say which trip, default trip_id to the trip created/discussed in this conversation, else omit it and the form lets them pick. If API_RESULT says USER_CANCELLED, continue without it and tell the user.");
            sb.AppendLine();
            sb.AppendLine("## Local devices (this PC)");
            sb.AppendLine();
            sb.AppendLine("The app runs on a Windows PC and can touch its local devices via action device:");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"device\", \"op\": \"list_printers\", \"reason\": \"one line\" }   // installed printers + default, runs immediately");
            sb.AppendLine("{ \"action\": \"device\", \"op\": \"system_info\", \"reason\": \"one line\" }     // machine, user, OS, drives with free space, runs immediately");
            sb.AppendLine("{ \"action\": \"device\", \"op\": \"print\", \"printer\": \"exact printer name\", \"title\": \"heading on the printout\", \"reason\": \"one line\" }");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"device\", \"op\": \"print_orders\", \"orders\": [\"418978\",\"419001\"], \"printer\": \"exact printer name\", \"instance\": \"PROD|TEST\", \"reason\": \"one line\" }");
            sb.AppendLine("{ \"action\": \"device\", \"op\": \"download_orders\", \"orders\": [\"418978\",\"419001\"], \"instance\": \"PROD|TEST\", \"reason\": \"one line\" }   // runs immediately, no approval");
            sb.AppendLine("{ \"action\": \"device\", \"op\": \"list_files\", \"reason\": \"one line\" }   // files in the user's download folder, runs immediately");
            sb.AppendLine();
            sb.AppendLine("The user's context line may include [DEFAULT_PRINTER: name] - the printer they configured for this app. For BOTH print and print_orders: when the user does not name a printer, use the DEFAULT_PRINTER directly without listing or asking. Only when it is absent, fall back to list_printers and use the Windows default or ask. A printer the user names always wins.");
            sb.AppendLine();
            sb.AppendLine("You receive DEVICE_RESULT: {...} for the read ops - format printers as a small markdown table marking the default one. list_printers may also return networkPrinters: shared printers published on the network that are NOT installed on this PC - show them separately and, if the user wants one, tell them to connect it via the printer button (or /default-printer) first; only installed printers are valid print targets.");
            sb.AppendLine("op print sends THE LAST RESULT GRID currently shown in the app (the data of your latest sql/fusion round) to that printer as a paginated table - you cannot print arbitrary content. The app shows the user an approval card first and you then receive PRINT_RESULT: {success, printer, rowsPrinted, pages} or USER_REJECTED - confirm with action answer. Flow: if the user has not named a printer, run list_printers first and either use the default or ask which one via action answer; use the exact name from the list. If the user asks to print something not yet queried, run the sql action first so the result exists, then print.");
            sb.AppendLine();
            sb.AppendLine("op download_orders DOWNLOADS order documents without printing: for each order number the app downloads the official Sales Order PDF from Oracle BI Publisher on the given instance and saves it into the user's configured download folder, named exactly {orderNumber}.pdf - NEVER ask the user for a folder or file name, both are fixed. Use it when the user says download order(s) / save the order PDFs. Max 20 per request; for a trip, run action sql first to get the order numbers. DEVICE_RESULT returns downloaded (per-order success/size) AND folderFiles (the folder's current contents) - ALWAYS show the user the file list as a small markdown table (file, size, modified) with the folder path after a download. op list_files returns the same listing on demand (\"show my downloaded files\").");
            sb.AppendLine();
            sb.AppendLine("op print_orders is for printing ORDER DOCUMENTS: for each order number the app downloads the official Sales Order PDF from Oracle BI Publisher (SOAP report GR_SalesOrder_Rep) on the given instance and prints it on the printer - use it whenever the user says print order / print the orders / print the trip's orders. Max 20 orders per request. Flow: (1) if the user says a trip (\"print all orders of trip 6812\"), FIRST run action sql to fetch that trip's order numbers for the current instance, then tell the user how many you found; (2) if no printer was named, run list_printers and use the default or ask; (3) send print_orders with the exact order numbers, printer name and the current instance. The app shows an approval card listing every order first. You then receive PRINT_ORDERS_RESULT: {results:[{order, downloaded, printed, method, error}]} or USER_REJECTED - summarize per order with action answer, calling out any failures.");
            sb.AppendLine();
            sb.AppendLine("## Sending emails");
            sb.AppendLine();
            sb.AppendLine("When the user asks to EMAIL something (a result, a summary, an alert), reply with:");
            sb.AppendLine();
            sb.AppendLine("{ \"action\": \"email\", \"to\": \"a@company.com;b@company.com\", \"cc\": \"\", \"subject\": \"...\",");
            sb.AppendLine("  \"bodyHtml\": \"<p>...</p><table>...</table>\", \"reason\": \"one line\" }");
            sb.AppendLine();
            sb.AppendLine("Rules: bodyHtml is a complete simple HTML fragment - short intro paragraph, then data as an HTML table with inline styles (border-collapse, 1px solid #ccc cells, bold header row); include the rows from your last result yourself (max 100 rows, note if truncated). The app shows the user an approval card with the recipients and body before sending, using the sender account configured in the app - you never see or need credentials. You then receive EMAIL_RESULT: {success, message} (or USER_REJECTED) - confirm to the user with action answer. If the user did not say who to send to, ask via action answer instead of guessing.");
            sb.AppendLine();
            sb.AppendLine("## Current instance (PROD / TEST)");
            sb.AppendLine();
            sb.AppendLine("Every user message starts with a line like [CURRENT_INSTANCE: TEST] - the instance the user selected in the app (it is app context, not part of what the user typed). Apply it everywhere:");
            sb.AppendLine("- action fusion: set \"instance\" to the current instance.");
            sb.AppendLine("- action schedule_job: set \"instance\" to the current instance.");
            sb.AppendLine("- action sql / save_report: when a table has an INSTANCE_NAME column, filter it with INSTANCE_NAME = '<current instance>' (for saved reports, keep it as a fixed filter, not a parameter, unless the user asks).");
            sb.AppendLine("The user's own words override it: if they explicitly name an instance (\"in PROD\", \"on test\"), use that one instead and say so in your answer.");
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
            _systemPromptCache = null;   // API mode re-reads the fresh prompt
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
            return SendAsync(userText, sessionId, null, null, onEvent);
        }

        public Task<AiChatResult> SendAsync(string userText, string sessionId, AiEngineConfig engine,
            string historyJson, Func<object, Task> onEvent)
        {
            List<object> apiMsgs = null;
            if (IsApi(engine))
                apiMsgs = BuildApiMessagesFromHistory(historyJson);
            return RunLoopAsync(userText, sessionId, engine, apiMsgs, onEvent);
        }

        private static bool IsApi(AiEngineConfig engine)
        {
            return engine != null && string.Equals(engine.Mode, "api", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Continues a turn that stopped for a Fusion write approval.
        /// Executes (or skips) the pending call, feeds FUSION_RESULT back and resumes the loop.
        /// </summary>
        public async Task<AiChatResult> ResumeWithFusionDecisionAsync(bool approve, AiPendingFusion pending,
            string sessionId, AiEngineConfig engine, string apiConversation, Func<object, Task> onEvent)
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

            var result = await RunLoopAsync(prompt, sessionId, engine, ParseApiConversation(apiConversation), onEvent);
            result.Rounds.InsertRange(0, preRounds);
            return result;
        }

        /// <summary>
        /// Resumes a paused turn with an arbitrary result prompt
        /// (e.g. EMAIL_RESULT after the user approved/rejected sending).
        /// </summary>
        public Task<AiChatResult> ResumeWithPromptAsync(string prompt, string sessionId,
            AiEngineConfig engine, string apiConversation, Func<object, Task> onEvent)
        {
            return RunLoopAsync(prompt, sessionId, engine, ParseApiConversation(apiConversation), onEvent);
        }

        private static List<object> ParseApiConversation(string apiConversation)
        {
            if (string.IsNullOrEmpty(apiConversation)) return null;
            try
            {
                var elements = JsonSerializer.Deserialize<List<JsonElement>>(apiConversation);
                return elements == null ? null : new List<object>(elements.Count == 0
                    ? Array.Empty<object>() : elements.ConvertAll(e => (object)e));
            }
            catch (JsonException) { return null; }
        }

        private static List<object> BuildApiMessagesFromHistory(string historyJson)
        {
            var msgs = new List<object>();
            if (string.IsNullOrEmpty(historyJson)) return msgs;
            try
            {
                using var doc = JsonDocument.Parse(historyJson);
                foreach (var m in doc.RootElement.EnumerateArray())
                {
                    string role = m.TryGetProperty("role", out var rEl) ? rEl.GetString() : null;
                    string text = m.TryGetProperty("text", out var tEl) ? tEl.GetString() : null;
                    if ((role == "user" || role == "assistant") && !string.IsNullOrWhiteSpace(text))
                        msgs.Add(new { role, content = text });
                }
                // API requires alternating roles starting with user; drop a leading assistant msg
                if (msgs.Count > 0)
                {
                    using var first = JsonDocument.Parse(JsonSerializer.Serialize(msgs[0]));
                    if (first.RootElement.GetProperty("role").GetString() == "assistant")
                        msgs.RemoveAt(0);
                }
            }
            catch (JsonException) { }
            return msgs;
        }

        private async Task<AiChatResult> RunLoopAsync(string initialPrompt, string sessionId,
            AiEngineConfig engine, List<object> apiMsgs, Func<object, Task> onEvent)
        {
            bool isApi = IsApi(engine);
            if (isApi && apiMsgs == null) apiMsgs = new List<object>();

            var result = new AiChatResult { SessionId = sessionId };
            string prompt = initialPrompt;
            bool retriedMalformed = false;
            int guard = 0;

            while (guard++ < (MAX_SQL_ROUNDS * 2) + 4)
            {
                await onEvent(new { action = "aiChatEvent", eventType = "status", text = "Claude is thinking..." });

                TurnOutcome turn;
                if (isApi)
                {
                    apiMsgs.Add(new { role = "user", content = prompt });
                    turn = await RunApiTurnAsync(engine, apiMsgs);
                }
                else
                {
                    turn = await RunTurnAsync(prompt, result.SessionId);
                }
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

                    if (string.Equals(action, "ords", StringComparison.OrdinalIgnoreCase))
                    {
                        if (result.Rounds.Count >= MAX_SQL_ROUNDS)
                        {
                            prompt = "You have used all " + MAX_SQL_ROUNDS +
                                     " rounds. Reply NOW with { \"action\": \"answer\", \"markdown\": \"...\" } summarizing what you found.";
                            continue;
                        }

                        var root = modelJson.RootElement;
                        string opath = root.TryGetProperty("path", out var opEl) && opEl.ValueKind == JsonValueKind.String ? opEl.GetString() : "";
                        string oreason = root.TryGetProperty("reason", out var orEl) && orEl.ValueKind == JsonValueKind.String ? orEl.GetString() : "";

                        bool allowed = false;
                        foreach (var w in ORDS_READ_WHITELIST)
                            if (string.Equals(opath, w, StringComparison.OrdinalIgnoreCase)) { allowed = true; break; }
                        if (!allowed)
                        {
                            prompt = "ORDS_RESULT: {\"success\":false,\"error\":\"Path not in the read whitelist: " + opath + "\"}";
                            continue;
                        }

                        var query = new StringBuilder();
                        if (root.TryGetProperty("params", out var oqEl) && oqEl.ValueKind == JsonValueKind.Object)
                            foreach (var qp in oqEl.EnumerateObject())
                            {
                                query.Append(query.Length == 0 ? '?' : '&');
                                query.Append(Uri.EscapeDataString(qp.Name)).Append('=');
                                query.Append(Uri.EscapeDataString(qp.Value.ValueKind == JsonValueKind.String ? qp.Value.GetString() : qp.Value.ToString()));
                            }

                        int oRoundNo = result.Rounds.Count + 1;
                        await onEvent(new { action = "aiChatEvent", eventType = "status", text = $"Reading {opath} (round {oRoundNo})..." });

                        var oRound = new AiSqlRound { Kind = "fusion", Method = "GET", Path = opath, Reason = oreason };
                        var sw = System.Diagnostics.Stopwatch.StartNew();
                        try
                        {
                            var oResp = await _http.GetAsync(ORDS_ROOT_URL + opath + query);
                            string oBody = await oResp.Content.ReadAsStringAsync();
                            oRound.Success = oResp.IsSuccessStatusCode;
                            oRound.ResultJson = oBody;
                            if (!oResp.IsSuccessStatusCode) oRound.Error = "HTTP " + (int)oResp.StatusCode;
                        }
                        catch (Exception oex)
                        {
                            oRound.Success = false;
                            oRound.Error = oex.Message;
                            oRound.ResultJson = JsonSerializer.Serialize(new { success = false, error = oex.Message });
                        }
                        oRound.ElapsedMs = sw.ElapsedMilliseconds;
                        result.Rounds.Add(oRound);

                        await onEvent(new
                        {
                            action = "aiChatEvent",
                            eventType = "sqlRound",
                            round = oRoundNo,
                            kind = "fusion",
                            sql = (string)null,
                            method = "GET",
                            path = opath,
                            success = oRound.Success,
                            rowCount = (int?)null,
                            elapsedMs = oRound.ElapsedMs,
                            error = oRound.Error
                        });

                        prompt = "ORDS_RESULT: " + TruncateForModel(oRound.ResultJson);
                        continue;
                    }

                    if (string.Equals(action, "device", StringComparison.OrdinalIgnoreCase))
                    {
                        var root = modelJson.RootElement;
                        string op = root.TryGetProperty("op", out var opEl) ? (opEl.GetString() ?? "").ToLowerInvariant() : "";

                        if (op == "list_printers" || op == "system_info")
                        {
                            await onEvent(new { action = "aiChatEvent", eventType = "status", text = op == "list_printers" ? "Reading installed printers..." : "Reading system info..." });
                            string devResult = op == "list_printers"
                                ? LocalDeviceService.ListPrintersJson()
                                : LocalDeviceService.SystemInfoJson();
                            prompt = "DEVICE_RESULT: " + devResult;
                            continue;
                        }

                        if (op == "download_orders")
                        {
                            // downloads run immediately (read-only SOAP + local save, no approval)
                            var dlOrders = new List<string>();
                            if (root.TryGetProperty("orders", out var dloEl) && dloEl.ValueKind == JsonValueKind.Array)
                                foreach (var o in dloEl.EnumerateArray())
                                {
                                    string v = o.ValueKind == JsonValueKind.String ? o.GetString() : o.ToString();
                                    if (!string.IsNullOrWhiteSpace(v)) dlOrders.Add(v.Trim());
                                }
                            string dlInstance = root.TryGetProperty("instance", out var dliEl) && dliEl.ValueKind == JsonValueKind.String &&
                                                dliEl.GetString().ToUpperInvariant() == "TEST" ? "TEST" : "PROD";

                            if (dlOrders.Count == 0)
                            {
                                prompt = "DEVICE_RESULT: {\"success\":false,\"error\":\"download_orders needs a non-empty orders array\"}";
                                continue;
                            }
                            if (dlOrders.Count > 20)
                            {
                                prompt = "DEVICE_RESULT: {\"success\":false,\"error\":\"Too many orders (" + dlOrders.Count + ") - max 20 per download request. Split it and ask the user.\"}";
                                continue;
                            }

                            var (fu, fp) = await FusionCredentialsService.GetAsync();
                            if (string.IsNullOrEmpty(fu))
                            {
                                prompt = "DEVICE_RESULT: {\"success\":false,\"error\":\"Fusion credentials not available\"}";
                                continue;
                            }

                            string folder = string.IsNullOrWhiteSpace(DownloadFolder) ? @"C:\fusion\ai_chat\downloads" : DownloadFolder;
                            try { Directory.CreateDirectory(folder); }
                            catch (Exception exDir)
                            {
                                prompt = "DEVICE_RESULT: " + JsonSerializer.Serialize(new { success = false, error = "Cannot create folder " + folder + ": " + exDir.Message });
                                continue;
                            }

                            var dlDownloader = new WMSApp.PrintManagement.FusionPdfDownloader();
                            var dlResults = new List<object>();
                            for (int di = 0; di < dlOrders.Count; di++)
                            {
                                string order = dlOrders[di];
                                await onEvent(new { action = "aiChatEvent", eventType = "status",
                                    text = $"Order {order}: downloading PDF ({di + 1}/{dlOrders.Count})..." });
                                var dl = await dlDownloader.DownloadSalesOrderPdfAsync(order, dlInstance, fu, fp);
                                if (!dl.Success)
                                {
                                    dlResults.Add(new { order, success = false, error = dl.ErrorMessage });
                                    continue;
                                }
                                try
                                {
                                    string fpath = Path.Combine(folder, order + ".pdf");
                                    var bytes = Convert.FromBase64String(dl.Base64Content);
                                    await File.WriteAllBytesAsync(fpath, bytes);
                                    dlResults.Add(new { order, success = true, file = order + ".pdf", sizeKb = Math.Round(bytes.Length / 1024.0, 1) });
                                }
                                catch (Exception exSave)
                                {
                                    dlResults.Add(new { order, success = false, error = "Save failed: " + exSave.Message });
                                }
                            }

                            prompt = "DEVICE_RESULT: " + JsonSerializer.Serialize(new
                            {
                                success = true,
                                folder,
                                instance = dlInstance,
                                downloaded = dlResults,
                                folderFiles = ListFolderFiles(folder)
                            });
                            continue;
                        }

                        if (op == "list_files")
                        {
                            string folder = string.IsNullOrWhiteSpace(DownloadFolder) ? @"C:\fusion\ai_chat\downloads" : DownloadFolder;
                            prompt = "DEVICE_RESULT: " + JsonSerializer.Serialize(new
                            {
                                success = true,
                                folder,
                                files = ListFolderFiles(folder)
                            });
                            continue;
                        }

                        if (op == "print_orders")
                        {
                            var (poMode, _) = await GetPolicyAsync("print_orders");
                            if (poMode == "DENY")
                            {
                                prompt = "PRINT_ORDERS_RESULT: {\"success\":false,\"error\":\"DENIED_BY_POLICY - this user is not allowed to print order documents. Tell the user and do not retry.\"}";
                                continue;
                            }
                            // pause - the UI shows an approval card listing the orders,
                            // then calls aiPrintOrdersDecision (download SOAP PDFs + print)
                            var orders = new List<string>();
                            if (root.TryGetProperty("orders", out var odEl) && odEl.ValueKind == JsonValueKind.Array)
                                foreach (var o in odEl.EnumerateArray())
                                {
                                    string v = o.ValueKind == JsonValueKind.String ? o.GetString() : o.ToString();
                                    if (!string.IsNullOrWhiteSpace(v)) orders.Add(v.Trim());
                                }

                            if (orders.Count == 0)
                            {
                                prompt = "DEVICE_RESULT: {\"success\":false,\"error\":\"print_orders needs a non-empty orders array\"}";
                                continue;
                            }
                            if (orders.Count > 20)
                            {
                                prompt = "DEVICE_RESULT: {\"success\":false,\"error\":\"Too many orders (" + orders.Count + ") - max 20 per print request. Split it and ask the user.\"}";
                                continue;
                            }

                            result.Success = true;
                            result.RequiresApproval = true;
                            if (isApi) result.ApiConversation = JsonSerializer.Serialize(apiMsgs);
                            result.PendingPrintOrders = new AiPendingPrintOrders
                            {
                                Orders   = orders,
                                Printer  = root.TryGetProperty("printer",  out var poEl) && poEl.ValueKind == JsonValueKind.String ? poEl.GetString() : "",
                                Instance = root.TryGetProperty("instance", out var piEl) && piEl.ValueKind == JsonValueKind.String ? piEl.GetString() : "PROD",
                                Reason   = root.TryGetProperty("reason",   out var pnEl) && pnEl.ValueKind == JsonValueKind.String ? pnEl.GetString() : ""
                            };
                            return result;
                        }

                        if (op == "print")
                        {
                            var (prMode, _) = await GetPolicyAsync("print");
                            if (prMode == "DENY")
                            {
                                prompt = "PRINT_RESULT: {\"success\":false,\"error\":\"DENIED_BY_POLICY - this user is not allowed to print. Tell the user and do not retry.\"}";
                                continue;
                            }
                            // pause - the UI shows a print approval card holding the
                            // last result grid, then calls aiPrintDecision
                            result.Success = true;
                            result.RequiresApproval = true;
                            if (isApi) result.ApiConversation = JsonSerializer.Serialize(apiMsgs);
                            result.PendingPrint = new AiPendingPrint
                            {
                                Printer = root.TryGetProperty("printer", out var prEl) && prEl.ValueKind == JsonValueKind.String ? prEl.GetString() : "",
                                Title   = root.TryGetProperty("title",   out var tiEl) && tiEl.ValueKind == JsonValueKind.String ? tiEl.GetString() : "WMS AI Result",
                                Reason  = root.TryGetProperty("reason",  out var rnEl) && rnEl.ValueKind == JsonValueKind.String ? rnEl.GetString() : ""
                            };
                            return result;
                        }

                        prompt = "DEVICE_RESULT: {\"success\":false,\"error\":\"Unknown device op '" + op + "' - use list_printers, system_info, print, print_orders, download_orders or list_files\"}";
                        continue;
                    }

                    if (string.Equals(action, "api_form", StringComparison.OrdinalIgnoreCase))
                    {
                        // ends the turn like an answer: the page renders the form, the user
                        // reviews/confirms, JS runs the API and continues with API_RESULT
                        result.Success = true;
                        result.Markdown = modelJson.RootElement.TryGetProperty("note", out var fnEl) &&
                                          fnEl.ValueKind == JsonValueKind.String ? fnEl.GetString() : "";
                        result.ApiFormJson = modelJson.RootElement.GetRawText();
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
                            var (fwMode, fwMaxBatch) = await GetPolicyAsync("fusion_write");

                            if (fwMode == "DENY")
                            {
                                prompt = "FUSION_RESULT: {\"success\":false,\"error\":\"DENIED_BY_POLICY - this user is not allowed to run Fusion write operations. Tell the user and do not retry.\"}";
                                continue;
                            }

                            if (fwMode == "AUTO")
                            {
                                // batch cap: more lines than max_batch downgrades to ASK
                                int lineCount = 0;
                                try
                                {
                                    if (!string.IsNullOrEmpty(body))
                                        using (var bDoc = JsonDocument.Parse(body))
                                            if (bDoc.RootElement.ValueKind == JsonValueKind.Object &&
                                                bDoc.RootElement.TryGetProperty("lines", out var lnEl) &&
                                                lnEl.ValueKind == JsonValueKind.Array)
                                                lineCount = lnEl.GetArrayLength();
                                }
                                catch { }

                                if (!(fwMaxBatch.HasValue && lineCount > fwMaxBatch.Value))
                                {
                                    int aRoundNo = result.Rounds.Count + 1;
                                    await onEvent(new { action = "aiChatEvent", eventType = "status",
                                        text = $"Auto-approved by policy: Fusion {method} (round {aRoundNo})..." });

                                    var aRound = await ExecuteFusionAsync(method, path, body, instance,
                                        (string.IsNullOrEmpty(reason) ? "" : reason + " ") + "[auto-approved by policy]");
                                    result.Rounds.Add(aRound);
                                    await onEvent(new
                                    {
                                        action = "aiChatEvent", eventType = "sqlRound", round = aRoundNo,
                                        kind = "fusion", sql = (string)null,
                                        method = aRound.Method, path = aRound.Path,
                                        success = aRound.Success, rowCount = aRound.RowCount,
                                        elapsedMs = aRound.ElapsedMs, error = aRound.Error
                                    });
                                    prompt = "FUSION_RESULT (auto-approved by policy - tell the user it ran without an approval card): "
                                             + TruncateForModel(aRound.ResultJson);
                                    continue;
                                }
                                // over the batch cap -> fall through to ASK
                            }

                            // ASK - stop here: the UI shows an approval card, then calls ResumeWithFusionDecisionAsync
                            result.Success = true;
                            result.RequiresApproval = true;
                            if (isApi) result.ApiConversation = JsonSerializer.Serialize(apiMsgs);
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

                    if (string.Equals(action, "schedule_job", StringComparison.OrdinalIgnoreCase))
                    {
                        var (sjMode, _) = await GetPolicyAsync("schedule_job");
                        if (sjMode == "DENY")
                        {
                            prompt = "JOB_RESULT: {\"success\":false,\"error\":\"DENIED_BY_POLICY - this user is not allowed to schedule jobs. Tell the user and do not retry.\"}";
                            continue;
                        }
                        if (sjMode == "AUTO")
                        {
                            await onEvent(new { action = "aiChatEvent", eventType = "status", text = "Auto-approved by policy: creating scheduled job..." });
                            string sjResult = await CreateScheduledJobAsync(modelJson.RootElement.GetRawText());
                            await onEvent(new { action = "aiChatEvent", eventType = "jobCreated", result = sjResult });
                            prompt = "JOB_RESULT (auto-approved by policy - tell the user it was scheduled without an approval card): " + sjResult;
                            continue;
                        }

                        result.Success = true;
                        result.RequiresApproval = true;
                        if (isApi) result.ApiConversation = JsonSerializer.Serialize(apiMsgs);
                        result.PendingJob = new AiPendingJob { JobJson = modelJson.RootElement.GetRawText() };
                        return result;
                    }

                    if (string.Equals(action, "db_write", StringComparison.OrdinalIgnoreCase))
                    {
                        var root = modelJson.RootElement;
                        string dwSql    = root.TryGetProperty("sql",    out var swEl) ? swEl.GetString() : "";
                        string dwReason = root.TryGetProperty("reason", out var rwEl) && rwEl.ValueKind == JsonValueKind.String ? rwEl.GetString() : "";

                        var (dwMode, _) = await GetPolicyAsync("db_write");
                        if (dwMode == "DENY")
                        {
                            prompt = "DB_WRITE_RESULT: {\"success\":false,\"error\":\"DENIED_BY_POLICY - this user is not allowed to run DDL/DML. Tell the user and do not retry.\"}";
                            continue;
                        }
                        if (dwMode == "AUTO")
                        {
                            await onEvent(new { action = "aiChatEvent", eventType = "status", text = "Auto-approved by policy: executing database write..." });
                            string dwResult = await ExecuteDbWriteAsync(dwSql);
                            prompt = "DB_WRITE_RESULT (auto-approved by policy - tell the user it ran without an approval card): " + dwResult;
                            continue;
                        }

                        result.Success = true;
                        result.RequiresApproval = true;
                        if (isApi) result.ApiConversation = JsonSerializer.Serialize(apiMsgs);
                        result.PendingDbWrite = new AiPendingDbWrite { Sql = dwSql, Reason = dwReason };
                        return result;
                    }

                    if (string.Equals(action, "email", StringComparison.OrdinalIgnoreCase))
                    {
                        var (emMode, _) = await GetPolicyAsync("email");
                        if (emMode == "DENY")
                        {
                            prompt = "EMAIL_RESULT: {\"success\":false,\"error\":\"DENIED_BY_POLICY - this user is not allowed to send emails. Tell the user and do not retry.\"}";
                            continue;
                        }

                        var root = modelJson.RootElement;
                        result.Success = true;
                        result.RequiresApproval = true;
                        if (isApi) result.ApiConversation = JsonSerializer.Serialize(apiMsgs);
                        result.PendingEmail = new AiPendingEmail
                        {
                            To       = root.TryGetProperty("to",       out var toEl) ? toEl.GetString() : "",
                            Cc       = root.TryGetProperty("cc",       out var ccEl) && ccEl.ValueKind == JsonValueKind.String ? ccEl.GetString() : "",
                            Subject  = root.TryGetProperty("subject",  out var suEl) ? suEl.GetString() : "",
                            BodyHtml = root.TryGetProperty("bodyHtml", out var bhEl) ? bhEl.GetString() : "",
                            Reason   = root.TryGetProperty("reason",   out var reEl) && reEl.ValueKind == JsonValueKind.String ? reEl.GetString() : ""
                        };
                        return result;
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

        /// <summary>Newest-first listing of a folder (max 100 files) for DEVICE_RESULT.</summary>
        private static List<object> ListFolderFiles(string folder)
        {
            var files = new List<object>();
            try
            {
                if (!Directory.Exists(folder)) return files;
                var infos = new DirectoryInfo(folder).GetFiles();
                Array.Sort(infos, (a, b) => b.LastWriteTime.CompareTo(a.LastWriteTime));
                foreach (var f in infos)
                {
                    files.Add(new
                    {
                        name = f.Name,
                        sizeKb = Math.Round(f.Length / 1024.0, 1),
                        modified = f.LastWriteTime.ToString("yyyy-MM-dd HH:mm")
                    });
                    if (files.Count >= 100) break;
                }
            }
            catch { }
            return files;
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
        // Claude API transport (api-key mode - no CLI on the PC)
        // ============================================================
        private const string CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
        private const string ANTHROPIC_VERSION = "2023-06-01";
        private string _systemPromptCache;

        private async Task<string> GetSystemPromptAsync()
        {
            if (_systemPromptCache != null) return _systemPromptCache;
            string path = Path.Combine(WorkspaceDir, "CLAUDE.md");
            if (!File.Exists(path))
                await PrepareWorkspaceAsync(false);
            _systemPromptCache = File.Exists(path) ? await File.ReadAllTextAsync(path) : "";
            return _systemPromptCache;
        }

        /// <summary>
        /// One Claude API call. apiMsgs already contains the new user turn;
        /// the assistant reply is appended to it on success. The system
        /// prompt (schema catalog) carries a cache_control breakpoint so
        /// repeat calls read it from the prompt cache at ~10% input price.
        /// </summary>
        private async Task<TurnOutcome> RunApiTurnAsync(AiEngineConfig engine, List<object> apiMsgs)
        {
            var outcome = new TurnOutcome();
            try
            {
                if (string.IsNullOrEmpty(engine.ApiKey))
                {
                    outcome.Ok = false;
                    outcome.Error = "API mode is selected but no API key is configured (gear icon > AI Engine).";
                    return outcome;
                }

                string systemPrompt = await GetSystemPromptAsync();
                var body = new
                {
                    model = string.IsNullOrEmpty(engine.Model) ? "claude-sonnet-5" : engine.Model,
                    max_tokens = 8000,
                    system = new object[]
                    {
                        new
                        {
                            type = "text",
                            text = systemPrompt,
                            cache_control = new { type = "ephemeral" }
                        }
                    },
                    messages = apiMsgs
                };

                using var req = new HttpRequestMessage(HttpMethod.Post, CLAUDE_API_URL);
                req.Headers.Add("x-api-key", engine.ApiKey);
                req.Headers.Add("anthropic-version", ANTHROPIC_VERSION);
                req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(CLI_TIMEOUT_SECONDS));
                var resp = await _http.SendAsync(req, cts.Token);
                string respBody = await resp.Content.ReadAsStringAsync();

                using var doc = JsonDocument.Parse(respBody);
                var root = doc.RootElement;

                if (!resp.IsSuccessStatusCode)
                {
                    string apiErr = root.TryGetProperty("error", out var eEl) &&
                                    eEl.TryGetProperty("message", out var mEl)
                        ? mEl.GetString() : respBody;
                    outcome.Ok = false;
                    outcome.Error = "Claude API error (HTTP " + (int)resp.StatusCode + "): " + Truncate(apiErr, 400);
                    return outcome;
                }

                var textSb = new StringBuilder();
                if (root.TryGetProperty("content", out var contentEl))
                {
                    foreach (var blockEl in contentEl.EnumerateArray())
                    {
                        if (blockEl.TryGetProperty("type", out var tEl) && tEl.GetString() == "text" &&
                            blockEl.TryGetProperty("text", out var txtEl))
                            textSb.Append(txtEl.GetString());
                    }
                }

                string assistantText = textSb.ToString();
                apiMsgs.Add(new { role = "assistant", content = assistantText });
                outcome.Ok = true;
                outcome.ResultText = assistantText;
            }
            catch (OperationCanceledException)
            {
                outcome.Ok = false;
                outcome.Error = "Claude API request timed out.";
            }
            catch (Exception ex)
            {
                outcome.Ok = false;
                outcome.Error = "Claude API call failed: " + ex.Message;
            }
            return outcome;
        }

        /// <summary>
        /// Executes an approved DDL/DML statement via the guarded ORDS write
        /// endpoint. After a successful CREATE/ALTER/DROP the schema catalog
        /// (CLAUDE.md) is regenerated so the model can see the new object.
        /// </summary>
        public async Task<string> ExecuteDbWriteAsync(string sql)
        {
            string respBody;
            try
            {
                var body = JsonSerializer.Serialize(new { sql, appUser = Environment.UserName });
                var resp = await _http.PostAsync(DB_WRITE_URL,
                    new StringContent(body, Encoding.UTF8, "application/json"));
                respBody = await resp.Content.ReadAsStringAsync();
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { success = false, error = ex.Message });
            }

            try
            {
                using var doc = JsonDocument.Parse(respBody);
                bool ok = doc.RootElement.TryGetProperty("success", out var sEl) &&
                          sEl.ValueKind == JsonValueKind.True;
                if (ok && Regex.IsMatch(sql ?? "", @"^\s*(CREATE|ALTER|DROP)\b", RegexOptions.IgnoreCase))
                {
                    try { await PrepareWorkspaceAsync(true); }   // refresh schema catalog
                    catch (Exception ex) { Debug.WriteLine("[ClaudeCliService] catalog refresh failed: " + ex.Message); }
                }
            }
            catch (JsonException)
            {
                return JsonSerializer.Serialize(new { success = false, error = "Non-JSON response from write endpoint: " + Truncate(respBody, 300) });
            }
            return respBody;
        }

        /// <summary>
        /// Creates an approved scheduled job via ai/jobs/create, stamping the
        /// Windows user and machine name for the audit columns.
        /// </summary>
        public async Task<string> CreateScheduledJobAsync(string jobJson)
        {
            try
            {
                using var doc = JsonDocument.Parse(jobJson);
                using var ms = new MemoryStream();
                using (var w = new Utf8JsonWriter(ms))
                {
                    w.WriteStartObject();
                    foreach (var prop in doc.RootElement.EnumerateObject())
                    {
                        if (prop.NameEquals("action")) continue;
                        prop.WriteTo(w);
                    }
                    w.WriteString("createdBy", Environment.UserName);
                    w.WriteString("createdMachine", Environment.MachineName);
                    w.WriteEndObject();
                }
                var resp = await _http.PostAsync(JOBS_CREATE_URL,
                    new StringContent(Encoding.UTF8.GetString(ms.ToArray()), Encoding.UTF8, "application/json"));
                return await resp.Content.ReadAsStringAsync();
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new { success = false, error = ex.Message });
            }
        }

        /// <summary>Minimal ping to validate an API key + model.</summary>
        public async Task<(bool Ok, string Message)> TestApiKeyAsync(string apiKey, string model)
        {
            try
            {
                var body = new
                {
                    model = string.IsNullOrEmpty(model) ? "claude-sonnet-5" : model,
                    max_tokens = 32,
                    messages = new object[] { new { role = "user", content = "Reply with the single word OK." } }
                };
                using var req = new HttpRequestMessage(HttpMethod.Post, CLAUDE_API_URL);
                req.Headers.Add("x-api-key", apiKey ?? "");
                req.Headers.Add("anthropic-version", ANTHROPIC_VERSION);
                req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
                var resp = await _http.SendAsync(req);
                string respBody = await resp.Content.ReadAsStringAsync();
                if (resp.IsSuccessStatusCode)
                    return (true, "API key works (" + body.model + ")");
                using var doc = JsonDocument.Parse(respBody);
                string msg = doc.RootElement.TryGetProperty("error", out var eEl) &&
                             eEl.TryGetProperty("message", out var mEl)
                    ? mEl.GetString() : ("HTTP " + (int)resp.StatusCode);
                return (false, msg);
            }
            catch (Exception ex)
            {
                return (false, ex.Message);
            }
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

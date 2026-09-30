# CLAUDE.md — Gray's WMS WebView Application

## Project Overview

Gray's WMS (Warehouse Management System) is a **hybrid desktop-web application** built with C#/.NET 8.0 Windows Forms hosting a WebView2 (Chromium) browser control. The web frontend uses vanilla JavaScript with jQuery and DevExtreme components, backed by Oracle APEX REST APIs and Oracle Database.

**Key modules:** Trip Management, Printer Management, Print Job Queue, Monitor Printing, Inventory Management, Receiving, Fusion SQL, and Claude AI Integration.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Host | C# / .NET 8.0 / Windows Forms / WebView2 |
| Frontend | HTML5, CSS3, Vanilla JS, jQuery 3.6.0, DevExtreme 23.2.6, Chart.js, ExcelJS |
| Backend API | Oracle APEX REST (ORDS) |
| Database | Oracle Database (PL/SQL) |
| Serialization | Newtonsoft.Json 13.0.4 |
| AI | Claude API (Anthropic) |

---

## Repository Structure

```
graysWMSwebviewnew/
├── Program.cs                    # Application entry point (STAThread)
├── Form1.cs                      # Main form — WebView2 init, UI logic, IPC (~1800 lines)
├── Form1.Designer.cs             # Auto-generated Windows Forms designer code
├── WMSApp.csproj                 # .NET 8.0 project file (MSBuild)
├── WMSApp.sln                    # Visual Studio solution
├── index.html                    # Main web UI (SPA, menu-based navigation)
├── app.js                        # Core frontend logic (~2600 lines)
├── config.js                     # API_CONFIG — APEX base URL, debug, timeout
├── printer-management-new.js     # Printer configuration UI module
├── monitor-printing.js           # Print monitoring and auto-print module
├── styles.css                    # Application styles (CSS variables)
├── classes/                      # C# helper classes (13 files)
│   ├── RestApiClient.cs          #   Generic HTTP client (async GET/POST)
│   ├── WebViewMessageRouter.cs   #   JS ↔ C# IPC message routing
│   ├── PrintJobManager.cs        #   Print workflow orchestration
│   ├── PrinterService.cs         #   Windows printer integration
│   ├── LocalStorageManager.cs    #   JSON file-based local storage
│   ├── FusionPdfDownloader.cs    #   Oracle Fusion PDF download (SOAP)
│   ├── ApexHtmlFileDownloader.cs #   HTML file download from APEX
│   ├── ClaudeApiHandler.cs       #   Claude API integration
│   ├── PromptHistoryManager.cs   #   AI prompt history tracking
│   ├── PromptHistoryViewer.cs    #   Prompt history UI component
│   ├── PrintModels.cs            #   Data models & enums for print ops
│   ├── EndpointRegistry.cs       #   Static API endpoint registry
│   └── Form1_PrintHandlers.cs    #   Print event handlers (partial class)
├── apex_sql/                     # Oracle APEX database scripts (22 files)
│   ├── 01_create_tables.sql      #   Schema: wms_printer_config, wms_trip_config, wms_print_jobs
│   ├── 02_post_procedures.sql    #   INSERT/UPDATE/DELETE procedures
│   ├── 03_get_procedures.sql     #   SELECT procedures
│   ├── 04_apex_rest_api_setup.sql#   APEX REST endpoint config guide
│   ├── 05_test_data.sql          #   Development test data
│   └── ...                       #   Additional endpoint & testing scripts
├── docs/                         # Documentation
│   └── PRINTER_SETUP_GUIDE.md    #   Printer configuration guide
├── README.md                     # Project readme
└── .gitignore                    # Visual Studio standard ignores
```

---

## Build & Development

### Prerequisites

- **Windows 10/11** (WebView2 requirement)
- **.NET 8.0 SDK** or Visual Studio 2022+
- **WebView2 Runtime** (pre-installed on Windows 11)
- **Oracle APEX instance** with REST APIs configured

### Build Commands

```bash
dotnet restore   # Restore NuGet packages
dotnet build     # Compile (web assets auto-copied to output)
dotnet run       # Run the application
```

Or open `WMSApp.sln` in Visual Studio and press F5.

### NuGet Dependencies

- `Microsoft.Web.WebView2` v1.0.3537.50
- `Newtonsoft.Json` v13.0.4
- `System.Drawing.Common` v9.0.10

### Web Assets

HTML, JS, and CSS files in the root are copied to the build output directory automatically via `<CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>` in the `.csproj`. When adding new web files, add a corresponding entry in `WMSApp.csproj`.

---

## Architecture & Key Patterns

### IPC Bridge (C# ↔ JavaScript)

Communication between the C# backend and JavaScript frontend uses WebView2 messaging:

- **JS → C#:** `window.chrome.webview.postMessage(message)` sends a JSON message
- **C# → JS:** `webView.CoreWebView2.ExecuteScriptAsync(...)` calls JS from C#
- **Routing:** `WebViewMessageRouter.cs` dispatches incoming messages by `action` field
- **Callbacks:** `window.pendingRequests[requestId]` stores callback functions keyed by request ID

### SPA Navigation

`index.html` uses `data-page` attributes on menu items. The `showPage()` function in `app.js` hides/shows sections. No client-side router.

### State Management

- **C#:** Stateful service classes (`PrintJobManager._printQueue`, etc.)
- **JavaScript:** Global variables (`currentParams`, `allPrintJobs`, `monitoringTripsData`)
- **Persistence:** JSON files at `C:\fusion\` (printer config, print jobs, orders)

### API Integration

- **Oracle APEX REST:** Base URL in `config.js` → `API_CONFIG.APEX_BASE_URL`
- **Oracle Fusion:** SOAP XML requests via `FusionPdfDownloader.cs`
- **Claude API:** Direct HTTP POST via `ClaudeApiHandler.cs`
- **HTTP Client:** `RestApiClient.cs` with 30-second timeout and async/await

---

## Naming Conventions

### C#

- **Classes:** PascalCase — `PrintJobManager`, `LocalStorageManager`
- **Methods:** PascalCase — `LoadPrinterConfig()`, `ExecuteGetAsync()`
- **Private fields:** `_camelCase` — `_httpClient`, `_printQueue`
- **Constants:** UPPER_SNAKE_CASE — `CLAUDE_API_URL`, `BASE_PATH`
- **Async methods:** suffix with `Async` — `TestPrinterAsync()`, `DownloadSalesOrderPdfAsync()`
- **Namespaces:** `WMSApp`, `WMSApp.PrintManagement`

### JavaScript

- **Functions:** camelCase — `generateRequestId()`, `sendMessageToCSharp()`
- **Global objects:** camelCase — `currentParams`, `allPrintJobs`
- **Constants:** UPPER_SNAKE_CASE — `APEX_API_BASE_URL_NEW`
- **No ES modules** — plain `<script>` tags, functions on `window`

### CSS

- **Custom properties:** `--kebab-case` — `--primary`, `--sidebar-width`
- **Classes:** `.kebab-case` — `.menu-item`, `.main-content`
- **HTML data attributes:** `data-page="trip-management"`

### Database (Oracle PL/SQL)

- **Tables:** `wms_` prefix — `wms_printer_config`, `wms_print_jobs`
- **Procedures:** `wms_` prefix — `wms_save_printer_config`
- **REST paths:** `/wms/v1/` — RESTful structure

---

## Error Handling

- **C#:** Try-catch with `System.Diagnostics.Debug.WriteLine(...)` logging. Service methods return result objects with `Success` and `Message`/`Error` properties rather than throwing.
- **JavaScript:** Callback `(error, data)` pattern. User-facing errors via `showNotification(message, 'error')`. Debug via `console.log('[Module] ...')`.

---

## File-Based Local Storage

Print data is stored locally (not in a database):

```
C:\fusion\
├── printer_config.json               # Printer configurations
└── {YYYY-MM-DD}/
    └── {TripId}/
        ├── orders.json                # Order data for the trip
        └── {OrderNumber}.pdf          # Downloaded PDF files
```

Managed by `LocalStorageManager.cs` using Newtonsoft.Json serialization.

---

## Database Scripts

SQL scripts in `apex_sql/` must be run **in numbered order**:

1. `01_create_tables.sql` — Create schema
2. `02_post_procedures.sql` — POST/write procedures
3. `03_get_procedures.sql` — GET/read procedures
4. `04_apex_rest_api_setup.sql` — REST endpoint setup guide
5. `05_test_data.sql` — Seed test data
6. `06+` — Additional endpoints and features

No ORM or migration framework — scripts are run manually in SQL Developer or SQL*Plus.

---

## Testing

There is **no automated test framework** (no xUnit, NUnit, Jest, etc.).

- **SQL testing:** Manual test procedures in `apex_sql/06_testing_guide.sql`
- **API testing:** Postman collection guide in `docs/POSTMAN_TESTING_GUIDE.md`
- **Debug logging:** Extensive `Debug.WriteLine` (C#) and `console.log` (JS) throughout

---

## CI/CD

No CI/CD pipeline is configured. No GitHub Actions, Jenkins, or Azure Pipelines.

---

## Important Notes for AI Assistants

1. **Form1.cs is large** (~1800 lines). It is the main orchestrator — read it before making changes to core application flow. `Form1_PrintHandlers.cs` is a partial class extension of Form1.

2. **Web assets must be registered in `.csproj`** — if you add a new `.js`, `.html`, or `.css` file, add a `<None Update="filename">` entry with `CopyToOutputDirectory` so it's included in the build output.

3. **No package manager for frontend** — JavaScript libraries are loaded via CDN `<script>` tags in `index.html`. Do not look for `package.json` or `node_modules`.

4. **Windows-only** — This application requires Windows (WebView2, Windows Forms, Windows printing APIs). Paths use backslashes and `C:\fusion\` is hard-coded for local storage.

5. **Config points to production** — `config.js` contains the production Oracle APEX URL. Be careful when modifying API configuration.

6. **IPC message format** — Messages between JS and C# follow this pattern:
   ```json
   { "action": "actionName", "requestId": "unique-id", "data": { ... } }
   ```
   New actions require handler registration in `WebViewMessageRouter.cs` and corresponding JS code.

7. **Credentials** — Fusion credentials are stored in plain text in local JSON files. Do not introduce additional credential storage without encryption.

8. **Partial class pattern** — `Form1` uses partial classes split across `Form1.cs` and `classes/Form1_PrintHandlers.cs`. Add new Form1 methods in the appropriate partial class file.

9. **Oracle PL/SQL conventions** — REST endpoints use `HTP.p()` for manual JSON construction. New endpoints should follow the numbered script pattern in `apex_sql/`.

10. **Fusion SQL module** — `fusionsql/` (page) + `classes/FusionSqlService.cs`, `classes/FusionSqlExtras.cs` (SQLite schema store), `classes/FusionSqlAgent.cs` (Ask AI: Claude tool-use agent with read-only dictionary tools — search objects/columns, describe, PL/SQL source, dependencies, sample queries — all run through the BIP runner) and `classes/Form1_FusionSqlHandlers.cs` (`fusionSql*` / `fusionDb*` IPC actions). Runs read-only SQL through one BI Publisher DBMS_XMLGEN runner report. Design: `docs/Fusion_SQL_Technical_RD.md`. Saved queries live in the APEX table `WMS_FUSION_SQL_QUERIES` (`apex_sql/63_fusion_sql_queries.sql`, auto-created by the page via `ai/executewrite`). "Format Results" (`fusionsql/report.js`) turns the result grid into a dashboard (KPIs, insights, Chart.js charts, summary + formatted table) with Excel/PDF/HTML/CSV/PNG export and sharing (Outlook draft via the `fusionSqlShareOutlook` host action — never auto-sent — or rich copy for email/Teams). "Save to APEX" stores a result as an APEX table `FSQ_<NAME>` registered in `WMS_FUSION_SQL_DATASETS` (`apex_sql/64_fusion_sql_datasets.sql`, `fusionsql/datasets.js`) with its source SQL + parameters, so it can be refreshed (load-safe, REPLACE or APPEND) and queried back from the APEX Data tab. The Flows tab (`fusionsql/flows.js`, starters in `fusionsql/flows-seed.js`, tables `WMS_FUSION_FLOWS` / `WMS_FUSION_FLOW_STEPS` / `WMS_FUSION_FLOW_RUNS` in `apex_sql/68_fusion_flows.sql`) runs process flows (e.g. Order to Cash) for one document: steps run in order through the runner, each hands key columns (`outputs`) to later steps as `IN ({{KEY}})` / `IN ({{KEY:str}})`, the diagram shows rows per step and where the flow stops, and a flow report adds headline figures (e.g. margin). "Fusion flow library" (`fusionsql/flows-catalog.js`, 65 standard processes by area incl. 25 period reconciliations — subledger vs SLA vs GL) sends a chosen process to Ask AI to build. Ask AI designs flows (a ```flow JSON block rendered as a Save card; `flAiDecorate` adds the flow guide) and fixes single steps. The Fusion Setups tab (`fusionsql/setups.js`, starter list in `fusionsql/setups-seed.js`) is a module-wise setup checklist stored in `WMS_FUSION_SETUP_TASKS` / `WMS_FUSION_SETUP_RESULTS` (`apex_sql/65_fusion_setup_checklist.sql`): each task's check SQL runs as `COUNT(*)` through the runner (DONE when ≥ min rows, results kept per pod) and drills down to the records. Data pipelines (phase 1: DB objects + setups): `apex_sql/69_fusion_pipelines.sql` (WMS_PIPE_SERVERS, _CONNECTIONS, WMS_PIPELINES, WMS_PIPE_TASKS, _RUNS, _TASK_RUNS, WMS_PIPE_LOG, view WMS_PIPE_STATUS_V); Setups tab › "Data pipeline setups" (`fusionsql/pipeline-setup.js`) edits the Python FastAPI pipeline server (host/port/API user+token; Test calls GET /health and /public-key through the executeGet/executePost relay with Basic auth) and target connections (Oracle EZ/TNS/ADB wallet, APEX REST, SQL Server, MySQL, PostgreSQL). Connection passwords are encrypted in the page with the server's RSA public key (RSA-OAEP SHA-256, `rsa-oaep-256:<base64>`) — APEX holds only ciphertext, only the pipeline server decrypts. Pipelines tab (phase 2, `fusionsql/pipelines.js`, tables auto-created by the page): pipelines (schedule MANUAL / INTERVAL / CRON / CONTINUOUS until cancelled, ON/OFF switch) with ordered tasks (source Fusion/APEX/connection SQL with `{{P_X}}` / `{{WATERMARK}}` → target connection + object, APPEND / TRUNCATE_INSERT / MERGE / INCREMENTAL); Run now POSTs /pipelines/{id}/run to the server and falls back to a QUEUED run row, Cancel sets `cancel_requested='Y'` (+ POST /runs/{id}/cancel), run history polls every 3 s while active; "Add to pipeline" in the SQL Builder grid opens the task editor with the current SQL. Other local data lives in `%APPDATA%\GraysWMS\FusionSql\`; the Fusion password and Claude key are DPAPI-encrypted and never sent to the page.

11. **Admin module / releases** — `admin/index.html` + `classes/Form1_AdminHandlers.cs` (`admin*` IPC actions); the Home tile appears only where the host finds the source repo (release.bat). A build run from the repo loads Home from that repo, not from the installed copy under `C:\fusion`. "Create ZIP file" runs `release.bat` unattended (`RELEASE_AUTO=1`, `DIST_OUT=dist-release` because the running app locks its own `dist\`) in a visible PowerShell console, tees the output to a log in `%TEMP%\GraysWMS\release\` and the page polls it for stage status. `create-distribution-folder.bat` / `package-release.bat` verify the build (System.Text.Json 10, Anthropic, SQLite, fresh deps.json) and refuse stale output; `dist/` is build output and is not tracked in git. Keep Form1 free of static field initializers that can fail (they run lazily and kill browser init).

12. **Data Loading module** — `dataload/` (page) + `classes/Form1_DataLoadHandlers.cs` (`dataLoad*` IPC actions). The "Fusion FBDI Templates" tab lists Oracle's official FBDI workbooks from `dataload/fbdi-catalog.js`, which is **generated** from the real 26C `.xlsm` files (sheets = interface tables, columns in CSV load order, `*` = required; `jv:1` = import process named in the template itself; blank `u` = UCM account not confirmed). Downloads come from `https://www.oracle.com/webfolder/technetwork/docs/fbdi-{release}/fbdi/xlsm/{File}.xlsm` (23A onwards) into `C:\fusion\FBDI\{RELEASE}\`; the host checks the zip signature so an Oracle error page is never saved as a template, and HEAD-probes for newer quarterly releases. The "Prepare & Load" tab (`dataload/prepare.js`) fills a template from real data — Source (Excel/CSV via SheetJS, paste, APEX SQL, Fusion SQL) → Map (one expression per template column: constants, `{Col|date|num|dr|cr|map:…}`, `{#doc}` / `{#line}` by the load's document key, `{#sum:Col}`, `{#load}`) → Check (template types/lengths/required from `dataload/fbdi-specs.js`, rules + live read-only Fusion lookups in `dataload/fbdi-rules.js`) → Generate (CSV exactly like Oracle's macro: no header, trailing `END` column, CRLF, UTF-8 no BOM, YYYY/MM/DD; zipped with JSZip). Specs are **generated** from the .xlsm (cell comments = DB column/type/length/help, row 5 = example, CSV names + trailing-END flag from the VBA; Item/Planners use the "Name / Data Type / Technical Name" row layout starting at column B): `dataload/fbdi-specs.js` holds `FBDI_SPEC_INDEX` for all 49 templates plus the loader `fbdiSpec(tpl)`, and each supported template (45) has `dataload/specs/<File>.js`, loaded on demand (New load, open, Change template). 4 are not supported because Oracle's macro doesn't write one CSV per sheet (Intercompany, Lockbox receipts, Cross-validation rules, Project import). Journals, Payables Invoices and Inventory Transactions have hand-written rules in `fbdi-rules.js` (synonyms, balancing, live Fusion checks); every other template gets `frAutoRules` (sheet links from shared key columns, a "Header" first sheet = one row per document, generated interface keys, Oracle's sample value for Action/Import Action/Operation columns) — `fbdiRules(tpl)` returns whichever applies. `FE.toCsv(sheet, spec.end)` omits END for the templates whose macro has none (Daily Rates, Segment Values, GL Budget Balances). The engine is `dataload/fbdi-engine.js`. `dataload/prepare-assist.js` adds the shortcuts: "Browse tables" (APEX SQL source — lists `user_tables`/`user_views`, ticks the columns that match the template, writes the SELECT), "Download input template" (Excel source — the user picks the FBDI sheets and Required / Required + common / All; one flat "Data" sheet with a "Document key" column for header/line templates, generated keys and control values left out, a "Columns" guide and a hidden `_fbdi` sheet whose JSON mapping is applied when the file is dropped back — `itRecognise`) and "Prepare FBDI" (lists required values that are unmapped or empty, fixes them with a constant, a source column or `|default:`, then runs the checks and opens Generate). `FR_REQUIRED` in `fbdi-rules.js` marks required columns for workbooks that do not (Item Import). Everything is stored in APEX (`apex_sql/70_fbdi_loads.sql`, auto-created): WMS_FBDI_LOADS, _LOAD_MAPS, _LOAD_ROWS (staged file/paste rows), _LOAD_RUNS (every check/generate), WMS_FBDI_RUN_FILES (the CSVs of each ZIP — History rebuilds any ZIP). Generate saves pending edits first so APEX matches the ZIP. Prepare & Load opens on an "FBDI sheets" step (the workbook as Excel shows it, Oracle's sample rows `ex` or the load's mapped data) and shows the template's sheets as linked cards (one row per document vs per source row, include, link column from `FBDI_RULES[..].links`). The "Setup Projects" tab (`dataload/fsm.js`) tracks Oracle FSM implementation projects and tasks: it discovers the `ASM_` objects on the pod (e.g. `ASM_IMPL_PROJECTS_VL`), guesses the project/task tables and column roles (editable, or custom SQL returning PROJ_KEY/PROJ_NAME and PROJ_KEY/TASK_KEY/TASK_NAME/STATUS …), saves that per pod in APEX, and every "Read from Fusion" stores task states, status-change events and per-project snapshots (burn-down) in `apex_sql/71_fsm_tracking.sql` tables (WMS_FSM_CONFIG, WMS_FSM_TASKS, WMS_FSM_TASK_EVENTS, WMS_FSM_SNAPSHOTS). Its "Setup data" view (`dataload/fsm-export.js`) shows what setup really exists: it starts an FSM CSV export through REST (`setupOfferingCSVExports` for an offering or functional area, `setupTaskCSVExports` for a task, via `executeOracleFusionPost/Get`), polls `ProcessCompletedFlag`, downloads `…ProcessResult/{id}/enclosure/FileContent` with the host action `dataLoadFsmDownload` (Fusion credentials stay in C#; only https://*.oraclecloud.com/fscmRestApi/ URLs; saved to `C:\fusion\FSM\{POD}\`), or analyses a ZIP exported by hand; counts rows per business-object CSV (configured vs empty, per area), matches objects to the tracked FSM tasks (flags "completed but no rows" / "rows but not started"), and compares two exports. Stored in WMS_FSM_EXPORTS / WMS_FSM_EXPORT_OBJECTS. APEX reads must never contain `DBMS_`/`UTL_` or words like UPDATE/DELETE (the ai/executequery gateway rejects them even inside quotes) — read CLOBs with `LENGTH` + `TO_CHAR(SUBSTR())`. The "Fusion API" tab (`dataload/fapi.js`, catalog `dataload/fapi-catalog.js` — ~50 Fusion REST resources by module × Setup / Masters / Transactions / Integration, with their FBDI alternative) loads data through REST: "Check all on pod" probes each resource, Fields come live from `{resource}/describe` (types, lengths, required, child collections, actions), Sample data reads 10 live records and Query runs GET with `q=` — both show each record's links (self/record, child collections, LOVs) as chips that drill down in a dialog with breadcrumbs (`faDrill`), Load data takes paste / Excel / APEX SQL / Fusion SQL rows, maps them with the Prepare & Load expressions, optionally groups rows into a child collection (e.g. invoiceLines), validates against the describe and POSTs / PATCHes record by record (parallel 1–4, stop after N errors, retry rejected). Calls go through the host action `dataLoadFusionRest` (GET/POST/PATCH only, https://*.oraclecloud.com/{fscm|hcm|crm}RestApi/resources/ only, returns the HTTP status; credentials stay in C#). Mappings, runs and per-record results live in WMS_FAPI_JOBS / WMS_FAPI_RUNS / WMS_FAPI_RUN_ROWS (`apex_sql/72_fusion_api_loads.sql`, auto-created). Next phase: upload + import through `ErpIntegrationService.importBulkData`.

13. **AI Digital Employee knowledge** — the chat's system prompt is built in `classes/ClaudeCliService.cs` (`PrepareWorkspaceAsync` → `C:\fusion\ai_chat\workspace\CLAUDE.md`, also used as the API-mode system prompt); repo docs are not read. Business knowledge sits there as prompt sections (e.g. `MRA_KNOWLEDGE` — how `classes/MRAProcessor.cs` interfaces orders to the Mauritius Revenue Authority) or as rows in `WMS_AI_PROCESSES`. The chat can run MRA itself with the `mra_interface` action: always an approval card listing the orders (`renderMraApprovalCard` in `aianalysis/index.html`; a policy can only DENY it), then `aiMraDecision` → `classes/Form1_AiMraHandlers.cs` runs each order through `MRAProcessor` and resumes the chat with `MRA_RESULT`. The Shipping Agent's Print Trip interfaces to MRA before printing (MRA St column, `wms/shipping-agent.js`). When you change the MRA code, update `MRA_KNOWLEDGE`; bump `PROMPT_TEMPLATE_MARKER` whenever the prompt text changes so clients rebuild it at once. Safety rules (phase A): every approval card is registered by the host (`IssueAiApprovals` in `classes/Form1_AiGuard.cs`) and a decision only runs if it matches a card the app issued (one use, 12 h) and the policy is not DENY by then — new approval kinds must be added there. Policies resolve for the app login the page sends (`appUser` on every `ai*` message), and `db_write` always uses the PROD rule (one APEX database; `apex_sql/74_ai_safety_fixes.sql`). LOCAL job / Daily Task steps run without cards, so `aianalysis/local-jobs.js` only allows listed `ipc` actions and data-changing `rest` calls to the app's own ORDS (never Fusion or `ai/executewrite`); stuck LOCAL jobs are released by the `WMS_AI_LOCAL_RECOVER` scheduler job. The Claude key and the SMTP password live in the host (DPAPI: `FusionSqlStore` key shared by chat / Fusion SQL / DLL Explorer, `classes/SmtpVault.cs`) — pages keep only mode/model/username. The Shipping Agent never cancels Fusion lines on its own: Task 2 raises an approval card and holds printing of those orders. The mobile listener accepts local-network senders only and has a pairing token (`%APPDATA%\GraysWMS\mobile_listener.json`, "Require token" switch in WMS). Control plane (phase B, `classes/AiControl.cs` + `classes/Form1_AiControlHandlers.cs` — `aiControl*` / `aiInbox*` / `aiAudit` IPC; tables in `apex_sql/75_ai_control.sql`, created by the host on first use): kill switch `WMS_AI_CONTROL.AI_ENABLED` (anyone may pause, only `ADMINS` resume) checked by the chat loop before any acting action (`ActingActionKey`), by every approval decision (`AiDecisionAsync`), by LOCAL jobs, the Shipping Agent tick and the DB-lane runner (`wms_ai_is_enabled`, 38_ai_jobs.sql); one audit trail `WMS_AI_AUDIT` (chat actions, decisions, inbox, jobs, agents, one `turn` row per answer with model/tokens/cost — API cost from the price list in `AiControl.PRICES` or `MODEL_PRICES`, CLI cost as reported); approval inbox `WMS_AI_INBOX` (requests decided from any PC with Teams-webhook / e-mail alerts; the Shipping Agent's cancel requests go there and it carries out approvals on its next tick, only the selected orders); chats synced to `WMS_AI_CONVERSATIONS` per app user (result data stripped). UI: AI Digital Employee › Control tab (`aianalysis/control.js`: status, inbox, activity, usage & cost, settings; also guards policy edits to admins).

14. **DLL Explorer** — `dllexplorer/` (page) + `classes/Form1_DllHandlers.cs` (`dll*` IPC actions). `classes/DllInspector.cs` reads a .dll/.exe **without loading or running it**: System.Reflection.Metadata for .NET (namespaces, types, member signatures, XML-doc summaries when the .xml sits next to it, references, type forwarders, P/Invoke, hard-coded URLs/SQL/paths/registry keys from the #US heap, `[AiAction]` methods) and a hand-written PE parser for native DLLs (version resource, exports, imports incl. delay-load, strings); both get a capability fingerprint (HTTP, database, printing, registry, crypto … with evidence). `Decompile(path, "Ns.Type" | "Ns.Type::Member")` uses ICSharpCode.Decompiler 9.1 (NuGet). `Redact()` masks passwords/keys/tokens — everything sent to Claude goes through it. "Explain with AI" = `classes/DllAnalystAgent.cs` (`DllAi.ExplainAsync`, Claude tool-use over outline/find/decompile, the Fusion SQL Claude key) writing a Markdown feature map (Summary, Features, Talks to, Settings, Risks, Chat actions); "Save to APEX" stores it in `WMS_AI_DLL_MAPS` (`apex_sql/73_ai_dll_maps.sql`, auto-created, one row per SHA-256). The AI Digital Employee has a read-only `dll` action (ops list / inspect / find / decompile — `DLL_KNOWLEDGE` in `ClaudeCliService.cs`) and checks saved maps first. Reading a DLL never lets the chat run it. Drop folder: `C:\fusion\dll`.

15. **Power BI module** — `powerbi/` (page; `powerbi/lib/powerbi.min.js` is powerbi-client 2.25.0 shipped with the app, MIT) + `classes/PowerBiService.cs` + `classes/Form1_PowerBiHandlers.cs` (`pbi*` IPC actions, replies `pbiResponse`, refresh progress `pbiProgress`). Sign-in with MSAL (Microsoft.Identity.Client): USER mode = each user's Microsoft account via the system browser (token cache DPAPI-encrypted in `%APPDATA%\GraysWMS\PowerBI\`), APP mode = service principal whose client secret is DPAPI-encrypted on that PC only. Tenant / client / workspace / mode are shared settings in `WMS_AI_CONTROL` (`PBI_*`, AI admins only). Datasets are **push datasets** defined in `WMS_PBI_DATASETS` (`apex_sql/76_powerbi.sql`, created by the host): tables = APEX SQL (dates as ISO text), columns (String/Int64/Double/DateTime/Boolean), DAX measures, relationships (from = many side). Publish creates / updates the dataset in the workspace (relationships cannot change in place → Recreate); Refresh deletes the rows and re-sends them (pages of 1000 from ai/executequery, batches of 5000); the scheduler (DAILY / HOURLY) runs on any PC signed in with the app open and takes a 45-min lease so only one PC runs it; every run is logged in `WMS_PBI_REFRESH_LOG` and audited. The starter "WMS Operations" (`powerbi/starter.js`) reads the app's own tables (trips, orders, print jobs, agent activity, shipment lines). The Reports tab embeds workspace reports (filters, edit / save, print), and "New report" opens the Power BI editor in create mode on a dataset. **Without an app registration** (`powerbi/desktop.js`, `apex_sql/77_powerbi_feed.sql` — run once, it creates the ORDS GET `pbi/feed` in the WAREHOUSEMANAGEMENT module and the procedure `wms_pbi_feed`): "Add report" saves any app.powerbi.com report link (address bar, File › Embed report, app or Publish-to-web link — normalised to a `reportEmbed?…&autoAuth=true` secure-embed URL by `pbNormalizeLink`) in `WMS_PBI_LINKS` and shows it in an iframe; the viewer signs in with their own Microsoft account (the host opens Microsoft sign-in windows as real popups — `TryOpenSignInPopup` in `Form1_PowerBiHandlers.cs`); the page reloads itself from `https://grays-wms.example/` (host action `pbiServeFolder` maps the app folder for that tab — Power BI does not render inside a file:// page; `?u=` carries the login, Back uses `pbiNavigate`), the report reloads when the sign-in popup closes (`pbiSignInClosed`), and "Open in window" (`pbiOpenWindow`) shows it top-level; WMS filters become Power BI URL filters (`pbFilterExpr`, "Keep filters" stores them per link; `?link=<id|name>&filter=Table.Column:value`). "Power BI Desktop" in Datasets writes the Power Query code (a `WmsFeed` function paging `pbi/feed?ds=&t=&skip=&take=` with `ApiKeyName = "k"`, one query per table with its column types), the DAX measures (DAX query view `DEFINE MEASURE …`) and the relationships; the Power BI service then refreshes on its own schedule. Feed keys (Setup) are random, shown once; only `RAWTOHEX(STANDARD_HASH(key,'SHA256'))` is stored in `WMS_PBI_FEED_KEYS` (optional per-dataset scope, revoke, last used); the feed runs only a single SELECT/WITH from the stored definition.

16. **Fusion Model (DuckDB dataset) — phase 0** — engine in `engine/FusionModel/` (its own net8.0 project, no Windows APIs; `WMSApp.csproj` references it and removes `engine\**` from its own globs) with xUnit tests in `engine/FusionModel.Tests/` (`dotnet test`, runs on Linux). `ModelEngine`: the model (`model.json`: modules = one DuckDB file each, tables = source `apex` | `fusion` | `file` + SQL, FULL or INCREMENTAL by key + changed-since column with overlap) lives in a shared folder with `manifest.json`, `refresher.lock`, `refresh_log.jsonl` and `modules\{module}_{version}.duckdb`. One writer (lease file) builds a NEW version file (copy → stage rows as NDJSON → `read_json` → replace or merge: widen types first, DuckDB would silently cast) and publishes it by rewriting the manifest atomically; readers ATTACH the current files READ_ONLY in one in-memory session (`module.table` names, cross-module joins) from a local cache (CACHE: copied when the version changes; queries keep the synced set) or straight from the share (DIRECT); every query session runs with `enable_external_access = false` + `lock_configuration = true`, and `SqlGuard` allows one SELECT/WITH/DESCRIBE/SUMMARIZE… only. Sources: `ApexSource` (ai/executequery, 1,000 rows per call, ROWNUM paging ordered by the key), `FusionSource` (the host passes the Fusion SQL runner, credentials stay in FusionSqlStore). Host: `classes/Form1_ModelHandlers.cs` (`fm*` IPC, replies `fmResponse`, progress `fmProgress`; settings per PC in `%APPDATA%\GraysWMS\FusionModel\settings.json`, default share `C:\fusion\model`; AI admins change settings/model/refresh; the scheduler runs only where "This PC is the refresher"; cache sync every 3 min). Page: `fusionmodel/` (Modules with WMS / Fusion reference starters in `fusionmodel/starter.js`, Explore = SQL over all modules, Refresh log, Settings). `classes/Form1_WebViewHealth.cs`: crashed/hung pages reload (max 3 in 2 min, `%TEMP%\GraysWMS\webview_health.log`), background tabs get a low memory target (never suspended — agents run in hidden tabs). Phase 1 (loading at scale): `OraclePager` shared by both sources — keyset paging when a table has exactly one key (`WHERE key > last ORDER BY key`, pages cost the same at any depth; `Paging` = auto | keyset | rownum), retries with back-off and halved pages after a timeout, resumable full loads (rows + last key checkpointed in `{share}\work\{module}.{table}.*`, resumed within 24 h if `DefinitionHash` is unchanged), strategy `Window` (reload the last N months by a date column, first load full), optional source `COUNT(*)` check, schema drift (added / removed / retyped columns) and rows/s per table in the manifest and log; page tab "Refresh Center" (modules with next run, table health, log). Phase 2 (semantic model, `engine/FusionModel/Semantic/`): the model also holds relationships (from = many side, `calendar` for the generated date table; active / inactive, single / both), measures (DAX-compatible text, home table, format), `CalendarDef` (years, fiscal start month → Year/Quarter/Month/YearMonth/Fiscal* columns; created as `memory.main.calendar` in every query session), hierarchies and roles (row filters = column IN values, applied to every query incl. the AI). `Parser.cs` (lexer + precedence parser; NOT binds looser than comparisons), `SemanticModel.cs` (binding to the columns actually published), `Compiler.cs` (every aggregation = a *frame*: SELECT keys, agg AS v grouped by the grouping columns it reaches many-to-one and filtered by the filters it reaches; frames combine by FULL OUTER JOIN on shared keys; CALCULATE replaces a column filter and drops that column as a key so the value repeats, KEEPFILTERS intersects, ALL/ALLEXCEPT work on the expanded table, ALLSELECTED only drops grouping; FILTER with measures = EXISTS set filter correlated on the leaf's keys; iterators with measures (context transition) = nested frames grouped by the iterated key; time intelligence = range join from each calendar group's first/last date (YTD/QTD/MTD incl. fiscal year end, SAMEPERIODLASTYEAR, DATEADD, PARALLELPERIOD, PREVIOUS*/NEXT*, DATESINPERIOD, DATESBETWEEN, running total FILTER(ALL(calendar[Date]), … <= MAX(…)), opening/closing balances); auto-exist for grouping columns of one table), `QueryEngine.cs` (`SemanticRequest` → one DuckDB statement + totals; `DEFINE MEASURE … EVALUATE SUMMARIZECOLUMNS(…)/ROW(…) ORDER BY`). `ModelEngine.Evaluate / EvaluateText / ValidateMeasures`; host `fmEvaluate`, `fmEvaluateText`, `fmValidate`; page tab "Model" (`fusionmodel/studio.js`: measures with Try-it by any column, relationship Suggest, calendar, security) and Explore's "Measures (EVALUATE)" mode. Expected values in `MeasureTests.cs` are computed independently with LINQ (no Power BI in CI). Phase 3 (catalog, search, AI): the model also holds `glossary` terms (term, synonyms, definition, refs to measures/columns, a rule for the AI), measure/table synonyms and column docs (`TableDef.Columns`); verified examples live in `{share}\examples.json` (`SaveExample` checks the query runs). `engine/FusionModel/Ai/Catalog.cs` builds the catalog (tables, columns, measures, terms, examples) and its hybrid search: BM25 over names/descriptions/expressions, trigram fuzzy + initials, glossary expansion, column values (distinct values of text columns with ≤ 5,000 values, exact or whole-word partial match; tables a role filters — and tables pointing to them — are never indexed), similar verified questions, optional vectors, relationship neighbours, merged by reciprocal-rank fusion with kind weights. `Ai/Embeddings.cs`: `IEmbedder` + `VoyageEmbedder` (key DPAPI-encrypted by the host in `%APPDATA%\GraysWMS\FusionModel\voyage.key`), vectors cached in the cache folder by text hash; search falls back to words when it fails. `Ai/ModelTools.cs`: read-only tools for any AI (overview, search_model, describe, evaluate, lookup_values, run_sql — SQL refused for role-restricted users; `Guide` is the shared system prompt). `Ai/McpHandler.cs` + `engine/FusionModel.Mcp` (stdio MCP server `FusionModel.Mcp.exe`, shipped next to the app; `--user`, `--shared`, `--mode`; Voyage key from `FUSION_MODEL_VOYAGE_KEY`). Host: `classes/ModelAskAgent.cs` (Claude tool loop, Fusion SQL key, audited as MODEL/turn with cost, blocked by the kill switch) and `fmSearch`, `fmAsk` (+ `fmProgress`), `fmAskCancel`, `fmExamples`, `fmExampleSave` / `fmExampleDelete` (AI admins), `fmEmbedStatus`, `fmEmbedKeySave`. The AI Digital Employee has a read-only `model` action (`MODEL_KNOWLEDGE` in `ClaudeCliService.cs`, `ModelEngineProvider` set by Form1). Page: tab Ask (`fusionmodel/ask.js`: chat with steps, the query used → Open in Explore / Mark as verified, catalog search with why-chips, verified examples), Model › Glossary / Descriptions, Settings › search by meaning + MCP config. Phase 4 (packs, checks, reports): `engine/FusionModel/Packs/fusion-packs.json` (embedded; `FusionPacks.All / Get / Apply` — adds what is missing, keeps customer changes unless overwrite, records `model.Packs[id] = version`) ships six Fusion packs — gl, ap, ar, po, om, inv — on the standard tables (GL_BALANCES/GL_JE_LINES, AP_INVOICES_ALL/AP_PAYMENT_SCHEDULES_ALL, RA_CUSTOMER_TRX_ALL/AR_PAYMENT_SCHEDULES_ALL, PO_HEADERS_ALL/PO_LINES_ALL/RCV_TRANSACTIONS, DOO_HEADERS_ALL/DOO_FULFILL_LINES_ALL, EGP_SYSTEM_ITEMS_B/INV_ONHAND_QUANTITIES_DETAIL/INV_MATERIAL_TXNS) with declared column types + docs, relationships, 46 measures, glossary and notes on what to verify per pod; bare table names are unique across packs so measures combine. `ModelEngine.ProbeTableAsync` runs a table's query for its first rows (no key order) and lists missing columns ("Check on pod"). Reconciliation checks (`ModelDefinition.Checks` / `CheckDef`: Left vs Right measure per By group, op = / <= / >=, tolerance, BothSides) run with `RunChecks` (`ModelEngine.Checks.cs`; PASS / FAIL with the 100 biggest differences / EMPTY incl. not loaded / ERROR), also as the AI tool `run_checks` and the chat's `model` op `checks`. Saved reports (`ReportDef`: semantic request + pivot column + chart) live in `{share}\reports.json`. Compiler: a filter comparing a column with an outer-context scalar (`VAR d = MAX(t[D]) RETURN CALCULATE(…, t[D] = d)`, `FILTER(t, t[D] = MAX(t[D]))`) becomes a correlated set filter (`TryScalarCompare`); date ± number is date arithmetic (`IsDateExpr`). `Phase4Tests` loads every pack table from generated rows and runs all measures and checks. Host: `fmPacks`, `fmPackProbe`, `fmPackApply` (admins), `fmChecks`, `fmReports`, `fmReportSave`, `fmReportDelete`. Page: Modules › Fusion packs (`fusionmodel/packs.js`: gallery, check on pod, add / reset), Model › Checks, tab Reports (`fusionmodel/reports.js`: values / rows / across / filters, KPIs, Chart.js with a % axis, pivot table, CSV / Excel (ExcelJS) / PNG, copy EVALUATE, Ask AI about it). Phase 5 (product shell): `engine/FusionModel.Server` (ASP.NET Core minimal API, `UseWindowsService`, config `fusionmodel-server.json` next to the exe or `FUSION_MODEL_SERVER_CONFIG`): `/health`, `/v1/status|model|evaluate|query|search|checks|reports|tools/{name}|refresh` and MCP over HTTP at `/mcp`; Bearer tokens from `FusionModel.Access.TokenStore` (tokens.json holds SHA-256 hashes only; each token acts as an app login, so its roles apply; `admin` scope for refresh; raw SQL refused for role-restricted users); CLI `token add|list|revoke`, `licence show|keygen|sign`; `install-service.ps1`, `README.txt`; `publish-fusion-model.bat` → `dist-model\` (tests, self-contained win-x64 server + MCP, zip; git-ignored). Licences (`engine/FusionModel/Licensing/Licensing.cs`, class `Licences`): ECDSA P-256 signature over the canonical JSON of `LicenceInfo` (customer, edition, packs, features, max users, pods, expiry); `Licences.VendorPublicKey` is empty in this repo (a development build: every licence reads as not verifiable) — the vendor runs `licence keygen` once, keeps the private key offline (never in git) and builds the public key in. The server runs a 30-day trial (trial.json) without a valid licence; the WMS app only shows the licence (Settings) and never blocks. `BiccSource` (kind `bicc`, registered by the engine itself): BICC extract CSVs / ZIPs in a folder or pattern, newest file wins per key, incremental by file time + incremental column, `SourceDef.Rename` maps VO attribute headers, dates normalised. Dashboards (Power BI-style): tab Dashboards (`fusionmodel/dashboards.js` core — pages of visuals on a 24-column × 40 px canvas, card / KPI (value vs comparison + trend) / bar / column / stacked / line / area / combo (one value axis) / pie / donut / gauge / scatter / table / matrix / slicer / text, click-to-cross-filter (deferred with setTimeout — the click handler must not destroy its own chart), slicers show only values with data, focus mode, show as table, export CSV, print, phone layout below 700 px, fixed validated categorical colours (8 + Other); `fusionmodel/dash-edit.js` — Data pane (unloaded pack measures greyed), Visualizations pane Build / Format / Filters, wells, drag fields onto wells / visuals / empty canvas, move and resize, undo / redo). Stored in `{share}\dashboards.json` (`ModelEngine.Dashboards.cs`: `SaveDashboard`, `VisualRequest` = the one semantic request behind a visual, `ValidateDashboard` runs every visual). Copilot (`engine/FusionModel/Ai/DashboardCopilot.cs`: dashboard JSON schema + design rules as the system prompt, `Check` = ```dashboard block present, JSON, no overlaps, fits 24 columns, every visual runs — failures go back to Claude through `ModelAskAgent.AskAsync(checkAnswer:)`, at most twice; `Auto` = Quick dashboard without AI: cards, monthly trend (same-unit measures only), dimension breakdowns, detail table, year slicer). Host: `fmDashboards`, `fmDashboardSave` (locked dashboards: author or AI admin), `fmDashboardDelete`, `fmDashboardAuto`, `fmDashAi` (mode create / edit / insights, audited `dashboard_*` with cost, kill switch). Multi-pod: the host registers `fusion:PROD` and `fusion:TEST` sources (own FusionSqlService each, same app credentials) besides `fusion` (logged-in pod); a pack can be added with `source` = one of them.

17. **No linting or formatting tools** — There are no `.eslintrc`, `.prettierrc`, or `editorconfig` files. Follow existing code style when making changes.

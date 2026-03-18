# CLAUDE.md — Gray's WMS WebView Application

## Project Overview

Gray's WMS (Warehouse Management System) is a **hybrid desktop-web application** built with C#/.NET 8.0 Windows Forms hosting a WebView2 (Chromium) browser control. The web frontend uses vanilla JavaScript with jQuery and DevExtreme components, backed by Oracle APEX REST APIs and Oracle Database.

**Key modules:** Trip Management, Printer Management, Print Job Queue, Monitor Printing, Inventory Management, Receiving, and Claude AI Integration.

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

10. **No linting or formatting tools** — There are no `.eslintrc`, `.prettierrc`, or `editorconfig` files. Follow existing code style when making changes.

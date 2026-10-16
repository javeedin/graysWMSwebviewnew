FUSION MODEL - server and MCP
=============================

What is in this folder
  server\   FusionModel.Server.exe - the model over HTTP (and MCP over HTTP); runs as a Windows service
  mcp\      FusionModel.Mcp.exe    - the model for Claude Desktop / Claude Code on one PC (stdio MCP)

1. Configure
  server\fusionmodel-server.json (created from the sample by install-service.ps1):
    sharedRoot   the folder with model.json, manifest.json and modules\*.duckdb (the same folder the app uses)
    readMode     CACHE (local copy, fastest) or DIRECT
    isRefresher  true only on the one machine that runs scheduled refreshes
    apexQueryUrl the APEX ai/executequery URL when this machine refreshes APEX tables
  BICC: tables with source "bicc" read extract files (CSV or ZIP) from a folder - no Fusion credentials needed.
  Optional: environment variable FUSION_MODEL_VOYAGE_KEY adds search by meaning.

2. Install (PowerShell as Administrator, in server\)
    .\install-service.ps1                                  LocalSystem
    .\install-service.ps1 -Account DOMAIN\svc -Password …  a domain account (needed to reach a \\share)

3. Tokens (each acts as an app login - that user's security roles apply)
    .\FusionModel.Server.exe token add --user KHALID --name "Power BI"      read
    .\FusionModel.Server.exe token add --user ADMIN --admin                  read + refresh
    .\FusionModel.Server.exe token list | token revoke --id <id>

4. Licence
  Put licence.json from the vendor next to FusionModel.Server.exe. Without one the server runs a 30-day trial.
    .\FusionModel.Server.exe licence show

API (Authorization: Bearer <token>)
  GET  /health                      no token
  GET  /v1/status   /v1/model   /v1/reports   /v1/tools
  POST /v1/evaluate  {"text": "EVALUATE SUMMARIZECOLUMNS(customers[REGION], \"Sales\", [Sales])"}
  POST /v1/query     {"sql": "SELECT … FROM module.table", "maxRows": 1000}    (not for role-restricted users)
  GET  /v1/search?q=backlog by customer
  POST /v1/checks    {"names": []}
  POST /v1/tools/{overview|search_model|describe|evaluate|lookup_values|run_checks|run_sql}  {arguments}
  POST /v1/refresh   {"module": "gl", "full": false}                          (admin tokens)
  POST /mcp          MCP (JSON-RPC) over HTTP - e.g. Claude: add a remote MCP server with this URL and the token as a Bearer header

MCP on one PC (Claude Desktop - Settings > Developer > Edit Config):
  { "mcpServers": { "fusion-model": { "command": "C:\\FusionModel\\mcp\\FusionModel.Mcp.exe", "args": ["--user", "KHALID"] } } }

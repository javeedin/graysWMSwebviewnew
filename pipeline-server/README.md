# Gray's WMS — Pipeline Server

A Python service that runs the **pipelines you define in the WMS app** (Fusion SQL › Pipelines) on another
machine — your laptop first, a Windows Server later. It syncs Fusion (and APEX / other databases) into
**APEX (Oracle)** or **DuckDB**, fully or incrementally, on a schedule or continuously, and has its own
live **console** in the browser. The WMS app shows the same status and can pause / resume / stop it.

```
 WMS app (Fusion SQL › Pipelines)                 Pipeline server (this folder)
 ───────────────────────────────                  ─────────────────────────────────────────────
 defines pipelines + tasks  ──► APEX tables ◄──  reads definitions, writes runs / logs / heartbeat
 Run now / Cancel / Pause   ──── HTTP API  ────►  supervisor ─► one worker process per run
 shows status + server bar  ◄── APEX tables       │            Fusion (BI Publisher runner) → APEX / DuckDB
 "Open console"             ──── browser  ────►   └ console  http://<server>:8000/ui/
```

## 1. Install (Windows laptop or Windows Server)

1. Copy this `pipeline-server` folder to the machine (e.g. `C:\pipeline-server`).
2. Right-click **setup.ps1 › Run with PowerShell** (as administrator if you want the firewall rule). It
   - finds Python 3.11+ (offers `winget install Python.Python.3.12` when missing),
   - creates `.venv` and installs the packages,
   - asks: server name, port (8000), time zone, how to reach the control tables, Fusion user + password,
   - creates the encryption key, prints the **API token once** — copy it,
   - tests the APEX tables and Fusion.
3. In the WMS app: **Fusion SQL › Setups › Data pipeline setups › Add server**
   - name = the server name you chose (the server already registered itself under that name),
   - host = this machine's name or IP (`localhost` when the app runs on the same laptop), port 8000,
   - API user `pipeline`, API token = the token from step 2 → **Test**. The app fetches the public key.
4. Add **connections** there (targets): *DuckDB file* (a path on the pipeline server, created if missing) or
   *Oracle / Oracle Autonomous / APEX REST*. Passwords are encrypted in the app with the server's key —
   only this server can read them.
5. Build pipelines in **Fusion SQL › Pipelines** (or "Add to pipeline" under any query result).

Start it: **start-server.bat** (runs in a window). Background, started with Windows:
**install-service.ps1** as administrator (NSSM service if `tools\nssm.exe` exists, else a scheduled task
at startup; `-Mode Logon` on a laptop). It runs as the account that ran setup, because the passwords live
in that account's Windows Credential Manager.

Try it without anything: **demo.bat** → http://localhost:8000/ui/ (sample pipelines, generated rows, DuckDB).

## 2. What a task does

| Load mode        | What happens |
|------------------|--------------|
| `APPEND`         | inserts every row the SQL returns |
| `TRUNCATE_INSERT`| empties the target, then loads (a source that returns 0 rows leaves the target untouched) |
| `MERGE`          | upsert by the task's key columns |
| `INCREMENTAL`    | only rows whose **watermark column** (e.g. `LAST_UPDATE_DATE`) moved since the last run. With keys: merge, re-reading a 5-minute overlap (`WM_OVERLAP_MIN`); without keys: append strictly after the watermark |

- Pages of `batch_size` rows (default 5,000), ordered by the watermark / keys so paging is stable. The
  watermark is saved after **every** page, so a run that stops half-way continues from there.
- The target table is created on the first load (types detected from the data: numbers, dates, text,
  CLOB > 4,000 bytes); new source columns are added to it. Force a type in the task's column map:
  `{"ORDER_DATE": "ORDER_DATE:DATE", "PHONE": "PHONE:TEXT", "OLD_COL": "SKIP"}`.
- `{{P_X}}` parameters come from the pipeline / run parameters (same rules as the app).
  `{{WATERMARK}}` in the SQL puts the watermark exactly where you want it (instead of the automatic filter).
- Pipeline parameters the server understands: `FUSION_POD` (PROD / TEST, default from the settings),
  `WM_TYPE` (DATE / NUMBER), `WM_OVERLAP_MIN` (default 5).
- Fusion SQL runs through the **same BI Publisher runner report** the app deploys
  (`/Custom/GraysWMS/QueryRunner.xdo`) — deploy it once from the app (Fusion SQL › Connection).
- Schedules: MANUAL, INTERVAL (from the end of the last run), CRON (server time zone), CONTINUOUS (cycles
  with a pause until cancelled; a person's cancel keeps it off until Run now; a failure retries after 5 min).
- One run per pipeline at a time; `max_parallel` pipelines at once (server row in the app).

## 3. Watch and control

**Console** `http://<server>:8000/ui/` (sign in with the API token):
Overview (engine mode, running runs with task steps, rows, rows/s, watermark, Cancel / Kill, activity
feed, throughput chart, CPU / memory) · Pipelines (schedule, next / last run, Run now, tasks, reset a
watermark) · Runs (history, a run opens with steps and its live log, Retry from the failed task) ·
Connections (test from this server) · Settings (Fusion user / password, key fingerprint, new API token).

**Engine controls** (console header, the app's server bar, or `POST /engine/{action}`):

| | |
|---|---|
| Pause / Resume | nothing new starts; running runs finish |
| Drain | running runs finish, then the engine stops |
| Stop now | running runs are cancelled at their next page |
| Kill (per run) | the worker process is stopped at once (stuck run) |

The server writes a heartbeat to `WMS_PIPE_SERVERS` every poll; the app shows it as online / paused /
offline even when it cannot reach the server over the network. Runs that were running when the server
stopped are queued again at the next start.

## 4. API (HTTP Basic: API user + token)

```
GET  /health                 POST /pipelines/{id}/run      {params, requested_by}
GET  /public-key             POST /pipelines/{id}/preview  {task_id, limit}
POST /connections/test       POST /runs/{id}/cancel     POST /runs/{id}/kill
GET  /runs?limit=            GET  /runs/{id}            POST /reload
GET  /engine                 POST /engine/{pause|resume|drain|stop|start}
```
Interactive docs: `/docs`.

## 5. Commands

```
.venv\Scripts\python -m pipeline_server init | run | demo | test | status
.venv\Scripts\python -m pipeline_server new-token | set-fusion-password | set-db-password
```

Settings: `data\config.json` (no passwords). Secrets: Windows Credential Manager (service
`GraysPipelineServer`). Private key: `data\keys\private.pem`, encrypted with a passphrase kept in the
Credential Manager. Logs of the service: `data\logs\service.log`; run logs are in `WMS_PIPE_LOG`.

**Control tables** are read through the app's own APEX gateway (`…/WAREHOUSEMANAGEMENT/ai`, nothing to
install). For very large loads into APEX use an *Oracle Autonomous* connection (direct, bind variables,
`executemany`) instead of the APEX REST gateway (literal SQL, ~40 KB per statement).

Tests (any OS): `pip install pytest && python -m pytest` — a fake Fusion pod, the WebCrypto↔Python key
round trip, incremental / merge / full loads against real DuckDB files, the scheduler and the API.

# Requirements Document — Saved Reports (AI Analysis)

**Version:** 1.0 · **Date:** 2026-09-12 · **Parent RD:** `docs/AI_ANALYSIS_RD.md` §3.2/§4/§7.3
**Scope:** only the Save-Report feature — save an AI answer's SQL as a named, parameterized report and re-run it live any time.

---

## 1. Concept

When the chatbot answers a question with SQL, the user can save that answer as a **report**: the SQL is stored in the database with **prompt-able parameters** (trip id, date range, order number…). Running the report later always executes the SQL **live** through the same guarded SELECT-only executor the chat uses — a report is never a stored result, always a stored query.

Rules the model follows when saving:
- Turn the filters of the original question into `:P_XXX` bind parameters where useful (e.g. `TRIP_ID = :P_TRIP_ID`, `trip_date >= :P_START_DATE`).
- Give each parameter a label, a data type (TEXT / NUMBER / DATE), required flag and a default (often the value from the original question).
- When a table has an `INSTANCE_NAME` column, keep the current instance as a **fixed filter** in the SQL (not a parameter) unless the user asks otherwise.

---

## 2. Database objects (script `apex_sql/36_ai_reports.sql`)

### 2.1 WMS_AI_REPORTS
| Column | Type | Notes |
|---|---|---|
| `report_id` | NUMBER identity | PK |
| `report_name` | VARCHAR2(200) | NOT NULL |
| `description` | VARCHAR2(1000) | |
| `category` | VARCHAR2(100) | default `'General'` — drives grouping in the UI |
| `sql_text` | CLOB | NOT NULL — single SELECT; parameters written as `:P_NAME` binds |
| `created_by` | VARCHAR2(100) | app user |
| `created_date` / `updated_date` | DATE | |
| `last_run_date` | DATE | stamped on every run |
| `run_count` | NUMBER | incremented on every run |
| `active_flag` | CHAR(1) Y/N | soft delete / hide |

### 2.2 WMS_AI_REPORT_PARAMS
| Column | Type | Notes |
|---|---|---|
| `param_id` | NUMBER identity | PK |
| `report_id` | NUMBER | FK → WMS_AI_REPORTS, ON DELETE CASCADE |
| `param_name` | VARCHAR2(60) | bind name WITHOUT colon, e.g. `P_TRIP_ID` (stored UPPER, colon stripped) |
| `label` | VARCHAR2(200) | shown in the run-prompt dialog |
| `data_type` | VARCHAR2(20) | `TEXT` / `NUMBER` / `DATE` (DATE values exchanged as `YYYY-MM-DD` strings) |
| `default_value` | VARCHAR2(400) | prefilled in the dialog |
| `required_flag` | CHAR(1) Y/N | |
| `param_order` | NUMBER | display order |

### 2.3 Procedures
| Procedure | Purpose |
|---|---|
| `WMS_AI_SAVE_REPORT(p_body CLOB)` | Insert (or update when `reportId` given: update header, delete + reinsert params). **Implementation note:** `APEX_JSON.get_boolean` returns PL/SQL BOOLEAN which is not a SQL type — resolve it into a `CHAR(1)` variable *before* the INSERT, or the procedure compiles INVALID and the handler returns HTTP 555. |
| `WMS_AI_RUN_REPORT(p_body CLOB)` | Loads `sql_text`, validates and substitutes each parameter as a **typed safe literal** (see §4), stamps `last_run_date`/`run_count`, then delegates to the shared guarded executor `WMS_AI_EXECUTE_SQL` (SELECT-only, keyword ban, row cap, query log). |

---

## 3. REST endpoints (ORDS module `WAREHOUSEMANAGEMENT`)

Base: `…/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai`

### 3.1 POST `/reports/save` → `BEGIN wms_ai_save_report(:body_text); END;`
Request:
```json
{
  "reportId": null,
  "name": "Trips by date",
  "category": "Trips",
  "description": "All trips for a given date with priority and bay",
  "sql": "SELECT trip_id, trip_lorry, trip_priority FROM wms_trip_config WHERE trip_date = :P_TRIP_DATE AND instance_name = 'PROD'",
  "appUser": "javeed",
  "params": [
    { "name": "P_TRIP_DATE", "label": "Trip date", "dataType": "DATE",
      "defaultValue": "2026-09-12", "required": true }
  ]
}
```
`reportId: null` (or omitted) = create; a number = update that report (params are replaced).
Response: `{"success":true,"reportId":12,"paramCount":1}` or `{"success":false,"error":"..."}`

### 3.2 POST `/reports/run` → `BEGIN wms_ai_run_report(:body_text); END;`
Request:
```json
{ "reportId": 12, "maxRows": 200, "appUser": "javeed",
  "params": { "P_TRIP_DATE": "2026-09-12" } }
```
Response: same shape as the chat SQL gateway — `{"success":true,"columns":[...],"rows":[[...]],"rowCount":n,"truncated":false}`; missing/invalid required parameter → `{"success":false,"error":"Missing/invalid required parameter: P_TRIP_DATE","code":"PARAM"}`.

### 3.3 GET `/reports/list` — no parameters
Response: `{"reports":[{"reportId","name","description","category","createdBy","createdDate","lastRunDate","runCount","paramCount"}...]}` — active reports only, ordered by category then name.

### 3.4 GET `/reports/get?id=` — **declare handler Parameter** (Name=id, Bind=id, Source=URI, IN, STRING)
Response: `{"reportId","name","description","category","sql","params":[{"name","label","dataType","defaultValue","required":true|false}]}`

### 3.5 POST `/reports/delete` — `{"reportId":12}` → hard-deletes params + report; response `{"success":true}`.

---

## 4. Parameter substitution (the part worth copying exactly)

`WMS_AI_RUN_REPORT` substitutes each declared parameter into the SQL as a typed literal — no dynamic binds needed under ORDS:

1. Value = request value, else `default_value`; NULL + required → `PARAM` error; NULL + optional → literal `NULL`.
2. `NUMBER` → validated with `TO_NUMBER`, rendered with `TO_CHAR(v,'TM9')`.
3. `DATE` → **first unwrap** any `TO_DATE(:P_NAME,'fmt')` already present in the saved SQL (regex `TO_DATE\(\s*:NAME\s*,\s*'[^']*'\s*\)` → `:NAME`), then substitute `TO_DATE('YYYY-MM-DD','YYYY-MM-DD')`. Without the unwrap you get `TO_DATE(TO_DATE(...))` and the report silently returns no rows — this was a real production bug.
4. `TEXT` → single quotes doubled, wrapped in quotes.
5. Replace `:NAME` on a word boundary, case-insensitive: `REGEXP_REPLACE(sql, ':'||name||'(\W|$)', literal||'\1', 1, 0, 'i')`.
6. The final SQL still passes through the guarded executor, so a malicious stored SQL or parameter cannot escape SELECT-only.

---

## 5. UI specification

### 5.1 Saving from the chat
- Every SQL-backed answer bubble shows a **“Save as report”** button; `/save-report` does the same by prompt.
- Clicking opens a small modal: **Name** (required), **Category** (default General), **Description** (optional).
- Submit sends an instruction turn to the model; the model replies with the `save_report` action carrying the final SQL + typed params; the app POSTs it to `/reports/save` (adding `appUser`) and feeds `REPORT_SAVE_RESULT: {...}` back so the model confirms.

### 5.2 Saved Reports tab (page tab 2)
- **Left panel:** report list grouped by category; each card shows name, description, run count / last run, an **API inspector** link that displays the exact `/reports/run` URL + POST body (for Postman testing), and Delete.
- **Right panel:** run the selected report → if it has params, a **parameter dialog** first (label, typed input — date picker for DATE, number input for NUMBER — defaults prefilled, required marked); then the live result grid with **Excel / CSV / PDF-print / Copy SQL** export buttons.
- Refresh uses a cache-buster (`?t=timestamp`) — ORDS GETs can otherwise be cached by the WebView.
- Reports can also be run **into the chat** (the chat's Reports shortcut runs a report and renders the grid as a chat answer).

### 5.3 The `save_report` action (model protocol)
```json
{ "action": "save_report",
  "name": "Trips by date", "category": "Trips",
  "description": "one line",
  "sql": "SELECT ... WHERE trip_date = :P_TRIP_DATE",
  "params": [ { "name": "P_TRIP_DATE", "label": "Trip date",
                "dataType": "DATE", "defaultValue": "2026-09-12",
                "required": true } ] }
```
Feedback: `REPORT_SAVE_RESULT: {"success":true,"reportId":12,...}` → model answers with a confirmation.

---

## 6. Guardrails
- Reports execute only through the guarded executor: single SELECT/WITH, keyword ban, `maxRows` cap, full query log (`WMS_AI_QUERY_LOG`).
- Typed literal substitution (quotes doubled, numbers/dates validated) — parameters cannot inject SQL.
- `active_flag` allows soft-hiding without breaking history; delete endpoint hard-deletes.
- Every run is attributed (`appUser`) and counted (`run_count`, `last_run_date`).

---

## 7. React porting notes
- **Reuse unchanged:** both tables, both procedures, all five `/reports/*` endpoints — the React app only issues the same five HTTP calls.
- **Reimplement:** the Save-as-report modal, the reports list + parameter dialog + result grid, exports.
- **Known ORDS pitfalls already solved here:** declare the `id` URI parameter on `/reports/get`; keep BOOLEAN out of SQL inserts in handlers; the DATE double-TO_DATE unwrap in §4.

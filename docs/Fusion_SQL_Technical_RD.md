# Fusion SQL — Technical Requirements & Design (RD)

**Product:** Re-ERP desktop · **Module:** Administration → Fusion SQL (`/admin/fusion-sql`)
**Status:** Implemented in the Electron app (reference implementation) · **Version:** 1.0 · 2026-09-24
**Purpose of this document:** a complete, implementation-level description of how Fusion SQL connects to Oracle Fusion Cloud through BI Publisher (BIP) and runs SQL, written so it can be re-implemented in **C# with a WebView2 UI**. Section 12 maps every piece to C#.

---

## 1. What Fusion SQL is

A desktop SQL workbench (like CloudMiner or SQL Developer) for **Oracle Fusion Cloud (SaaS)**:

- Type a `SELECT`, run it **live against the Fusion pod's database**, and see the rows in a grid.
- Browse the schema (owners → tables/views/… → columns, indexes, foreign keys).
- Use `{{PARAM}}` / `:BIND` placeholders, saved queries, history, and Excel/PDF export.
- Use an "Ask AI" assistant (Claude) that writes SQL from a question, using the cached schema.
- Save the schema to a local SQLite file that can be shared with other laptops.

### 1.1 The core problem, and the trick

Fusion SaaS gives **no JDBC/ODBC access** to its database. The only supported way to run arbitrary SQL inside the pod is **BI Publisher**. BIP reports run SQL data models inside the pod and are exposed over **SOAP web services**.

So Fusion SQL deploys **one tiny "query-runner" BIP report**. Its data model takes **one text parameter (`P_QRY_STMT`) holding a base64-encoded SQL statement**, decodes it, runs it through `DBMS_XMLGEN.getXML` (which turns any query into one XML document), and returns that XML. The desktop app calls `runReport` over SOAP, decodes the result, and parses the XML into rows and columns.

Everything else, including the schema browser, is ordinary `SELECT`s against the Oracle data dictionary (`ALL_OBJECTS`, `ALL_TAB_COLUMNS`, …) sent through the same runner. **Only one BIP object is needed.**

---

## 2. Architecture

```
┌──────────────────────── Desktop app ────────────────────────┐
│  UI (web page: React today → HTML/JS in WebView2 for C#)     │
│   editor · schema tree · results grid · params · AI · export │
│                │  IPC (request/response, JSON)               │
│  Native host (Electron main today → C# host)                 │
│   • config + encrypted credentials   • SOAP client           │
│   • response decoding + parsing      • schema cache (JSON)   │
│   • SQLite schema store              • API call log          │
│   • Claude API call for "Ask AI"                             │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS  SOAP 1.1 (text/xml)
                             ▼
┌──────────────── Oracle Fusion pod (SaaS) ───────────────────┐
│ /xmlpserver/services/v2/ReportService   → runReport         │
│ /xmlpserver/services/v2/CatalogService  → createFolder,     │
│                                            uploadObject      │
│ BI catalog: /Custom/ReERP/QueryRunnerDM.xdm (data model)    │
│             /Custom/ReERP/QueryRunner.xdo   (report)        │
│ Data source ApplicationDB_FSCM → Fusion DB (runs as the user)│
└─────────────────────────────────────────────────────────────┘
```

**Rule:** the UI never talks to Fusion directly. All network, credential and file work happens in the native host. The UI only calls host methods (§9).

Reference source files:
| File | Role |
|---|---|
| `electron/fusion-sql.cjs` | config, SOAP `runReport`, response parsing, auto-deploy, call log, schema cache |
| `electron/fusion-sqlite.cjs` | SQLite schema store (sql.js / WASM) |
| `electron/main.cjs` (IPC `fusion-sql:*`, `fusion-db:*`, `save-fusion-credentials`) | host ↔ UI bridge, credential storage, Claude call |
| `electron/preload.cjs` | exposes the bridge to the page as `window.electronAPI.*` |
| `src/pages/admin/FusionSql.tsx` | main UI |
| `src/pages/admin/FusionTablesList.tsx` | "Tables List" tab: bulk schema pull → SQLite |
| `fusion/bip/query_runner_datamodel.sql`, `fusion/bip/README.md` | runner SQL + manual BIP setup |

---

## 3. The BI Publisher query runner

### 3.1 Data model SQL (the heart of the design)

Data set `Q1`, **Type of SQL = Standard SQL**, data source `ApplicationDB_FSCM`:

```sql
SELECT REGEXP_REPLACE(
         DBMS_XMLGEN.getxml(
           UTL_RAW.cast_to_varchar2(
             UTL_ENCODE.base64_decode(UTL_RAW.cast_to_raw(:P_QRY_STMT))
           )
         ),
         '<\?xml[^>]*\?>', ''
       ) AS result
FROM dual
```

Step by step:
1. `:P_QRY_STMT` = base64 text of the user's (already row-capped) SELECT.
2. `UTL_RAW.cast_to_raw` → `UTL_ENCODE.base64_decode` → `UTL_RAW.cast_to_varchar2` gives back the plain SQL text.
3. `DBMS_XMLGEN.getxml(sql)` runs it and returns **one CLOB**: `<ROWSET><ROW><COL1>…</COL1>…</ROW>…</ROWSET>`.
4. `REGEXP_REPLACE` strips the inner `<?xml …?>` prolog, so the nested document doesn't break BIP's outer XML.

**Why not a ref cursor?** On Fusion SaaS, BIP does **not** register the reserved `:xdo_cursor` OUT bind for a PL/SQL data set. A ref-cursor runner fails with `ORA-17041: Missing IN or OUT parameter at index: N`. `DBMS_XMLGEN` keeps the data set as plain Standard SQL, and BIP auto-detects the `:P_QRY_STMT` bind.

### 3.2 Data model XML (`_datamodel.xdm`)

Key properties the parser depends on: `include_rowsettag=false`, `xml_tag_case=upper`, `include_null_Element=false`, output root `DATA_DS`, row tag `G_1`, and parameter `P_QRY_STMT` (String). The full XML is generated by `buildDataModelXml(dataSource)` in `fusion-sql.cjs`. Reproduce it byte for byte.

```xml
<dataModel xmlns="http://xmlns.oracle.com/oxp/xmlp" version="2.0" defaultDataSourceRef="ApplicationDB_FSCM" …>
  <dataProperties>
    <property name="include_parameters" value="true"/>
    <property name="include_null_Element" value="false"/>
    <property name="include_rowsettag" value="false"/>
    <property name="xml_tag_case" value="upper"/>
    <property name="db_fetch_size" value="500"/>
  </dataProperties>
  <parameters>
    <parameter name="P_QRY_STMT" defaultValue="" dataType="xsd:string" rowPlacement="1"><input label="P_QRY_STMT"/></parameter>
  </parameters>
  <dataSets>
    <dataSet name="Q1" type="simple">
      <sql dataSourceRef="ApplicationDB_FSCM" nsQuery="false" xmlRowTagName="G_1"><![CDATA[ …runner SQL… ]]></sql>
    </dataSet>
  </dataSets>
  <output rootName="DATA_DS" uniqueRowName="false"><nodeList/></output>
  <eventTriggers/><lexicals/><valueSets/>
</dataModel>
```

### 3.3 Report XML (`_report.xdo`)

A report bound to the data model, with a "Data" template that allows **`csv` and `xml`** output (`defaultOutputFormat="csv"`). Generated by `buildReportXml(dataModelPath)`.

### 3.4 Catalog locations (defaults, configurable)

| Item | Default |
|---|---|
| Folder | `/Custom/ReERP` |
| Data model | `/Custom/ReERP/QueryRunnerDM.xdm` |
| Report (called by `runReport`) | `/Custom/ReERP/QueryRunner.xdo` |
| Data source | `ApplicationDB_FSCM` (Financials pods; check BIP → Administration → JDBC Connection) |

### 3.5 Deploying the runner

**A. Automatic (one click in the app)** uses `CatalogService` over SOAP. It needs a Fusion user with **BI Author / BI Administrator**.
1. `createFolder(folderAbsolutePath=/Custom/ReERP)`. "Already exists" is fine.
2. `uploadObject(reportObjectAbsolutePathURL=…/QueryRunnerDM.xdm, objectType=xdmz, objectZippedData=<base64 ZIP containing one entry "_datamodel.xdm">)`
3. `uploadObject(…/QueryRunner.xdo, objectType=xdoz, objectZippedData=<base64 ZIP containing "_report.xdo">)`

ZIP details: store mode (no compression) is accepted. The reference implementation writes the ZIP by hand (CRC32 plus local and central headers). In C#, use `System.IO.Compression.ZipArchive` with `CompressionLevel.NoCompression`.

Catalog SOAP details: namespace `http://xmlns.oracle.com/oxp/service/v2` (prefix `pub`), `userID`/`password` elements **inside** each operation, and also an HTTP `Authorization: Basic` header (sent defensively). `SOAPAction` = operation name. After each call, check for `<faultstring>`. If a fault is present, stop and show it together with the raw response.

**B. Manual fallback:** create the data model and report in the BIP UI, following `fusion/bip/README.md` §1–2.

### 3.6 Fusion-side prerequisites

- The account the app uses needs **BI Consumer** (to run the report) plus data roles granting SELECT on whatever you query. Deploying needs BI Author once.
- **Use a dedicated, least-privilege BI account in production.** Every statement runs and is audited **as that user**.

---

## 4. Running a statement (`execute`)

### 4.1 Input rules and preparation

```
input: { sql, rowLimit }
1. stmt = trim(sql) with trailing ';' removed
2. reject if empty
3. reject unless it starts with SELECT or WITH (case-insensitive)      ← read-only guard
4. cap = clamp(rowLimit ?? config.rowLimit ?? 100, 1, 100000)
5. capped = "SELECT * FROM (" + stmt + ") WHERE ROWNUM <= " + cap
6. base64Sql = Base64(UTF-8 bytes of capped)
```

`{{PARAM}}` and `:BIND` placeholders are substituted in the **UI before** this step (§7.2). The runner can't bind values, so everything arrives as literal SQL.

### 4.2 SOAP request — `ReportService.runReport` (v2)

- **POST** `https://<pod>/xmlpserver/services/v2/ReportService`
- Headers: `Content-Type: text/xml; charset=utf-8`, `SOAPAction: "runReport"`
- Credentials go **in the SOAP body** (`userID`/`password`). No Basic auth is needed for this call.
- Timeout: `config.timeoutMs`, default 120 000 ms, clamped to 5 s–10 min.

```xml
<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:attributeFormat>xml</v2:attributeFormat>            <!-- then csv as fallback -->
        <v2:reportAbsolutePath>/Custom/ReERP/QueryRunner.xdo</v2:reportAbsolutePath>
        <v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>P_QRY_STMT</v2:name>
              <v2:values><v2:item>U0VMRUNUICogRlJPTSAo…</v2:item></v2:values>
            </v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>JOHN.DOE</v2:userID>          <!-- XML-escaped -->
      <v2:password>••••••</v2:password>        <!-- XML-escaped; redact in logs -->
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>
```

### 4.3 Response handling (exact algorithm)

```
r = POST(format = "xml")
bytes = text of the first <…:reportBytes> element (strip whitespace)   ← base64
if bytes:
    decoded = UTF-8(Base64Decode(bytes))
    rows = parseXmlGenRows(decoded) ?? parseXmlRows(decoded)
xmlFault = bytes ? null : (network error | <faultstring> | <message>)
if !bytes and !xmlFault:                      ← only when XML gave neither rows nor an error
    r2 = POST(format = "csv")
    if r2 has reportBytes: rows = parseXmlGenRows(dec) ?? parseCsv(dec)
if still no bytes: return { success:false, error: xmlFault | fault | "HTTP <status>", raw: first 1200 chars }
columns = union of all row keys, in first-seen order
return { success:true, rows, columns, rowCount, capped: rowCount >= cap }
```

**Important:** a fault from the XML attempt (e.g. `ORA-00904: invalid identifier` in the user's SQL) **is** the real error. Never let a CSV "invalid format" fault hide it.

### 4.4 What the decoded document looks like

```xml
<DATA_DS>
  <P_QRY_STMT>U0VMRUNU…</P_QRY_STMT>             <!-- echoed parameter (include_parameters) -->
  <G_1>
    <RESULT>&lt;ROWSET&gt;&lt;ROW&gt;&lt;INVOICE_ID&gt;1001&lt;/INVOICE_ID&gt;…&lt;/ROW&gt;&lt;/ROWSET&gt;</RESULT>
  </G_1>
</DATA_DS>
```
- **XML output:** the inner ROWSET is **XML-escaped once** inside `<RESULT>`.
- **CSV output:** the ROWSET usually arrives with **real tags** inside a CSV field.

### 4.5 Parsers

**`parseXmlGenRows(decoded)`** (primary):
1. If the text doesn't contain `ROWSET` → return null.
2. If it has `&lt;ROWSET` but no real `<ROWSET` → XML-unescape the whole text **once** (order: `&lt; &gt; &quot; &apos; &#n;`, then `&amp;` last).
3. For each `<ROW>…</ROW>`: each child element whose content has no nested tags → `row[TAG] = coerce(unescape(text).trim())`.
4. An empty result (`<ROWSET/>` or `<ROWSET></ROWSET>`) is **success with 0 rows**. When the query returns no rows, `DBMS_XMLGEN` may return NULL; treat that as an empty grid.

**`parseXmlRows(xml)`** (fallback, generic BIP XML): find the most frequent element that contains child elements and treat it as the row wrapper, then read its scalar children.

**`parseCsv(text)`** (fallback): RFC-4180 (quoted fields, `""` escapes, embedded commas/newlines), strip BOM, first line = header.

**`coerce(v)`**: `''` for null or empty. A value matching `^-?\d{1,15}(\.\d+)?$` (commas removed) whose number keeps ≤15 significant digits becomes a number. Everything else stays a string. IDs longer than 15 digits stay strings, so precision isn't lost.

Parser facts to preserve:
- Column names are **UPPER-CASE** (DBMS_XMLGEN). Alias columns in SQL to control names.
- **NULL columns are omitted** from a row, which is why columns = the *union* of keys. Caveat: if row 1 has a NULL, that column appears later in the order. A C# implementation can fix this by reading the column order from the first row that has all columns, or by parsing `ROWSET` metadata.
- Dates and timestamps come back as **strings** in the DB session's NLS format. Use `TO_CHAR(col,'YYYY-MM-DD')` in the SQL for stable formats.
- The UI treats columns ending in `_id`/`_number`/`id`/`number` as **identifiers**: shown and exported as text, never with thousands separators.

### 4.6 Errors to expect

| Symptom | Cause |
|---|---|
| `ORA-17041 Missing IN or OUT parameter` | The data model uses a ref cursor. Switch to the DBMS_XMLGEN SQL (§3.1). |
| `ORA-00942 table or view does not exist` | The BI user's data roles don't cover the table. |
| SOAP fault "report not found / no access" | Wrong `reportPath`, or the user lacks BI Consumer on the folder. |
| HTTP 401/500 with an auth fault | Wrong credentials, or the account is locked. |
| Timeout | Slow query, or the pod is busy. Raise `timeoutMs` or narrow the query. |
| Empty grid, no error | Zero rows. The ROWSET was empty or NULL. |

### 4.7 API call inspector

Keep the **last 30 SOAP calls** in memory: `{at, kind, protocol, url, status, headers, request, response}`, request and response each truncated to 20 000 chars. **Before storing, redact `<…password>…</…password>` → `***`**, and log the Basic header as `Basic <base64 user:password>`. The UI can list and clear these calls.

---

## 5. Configuration and credentials

### 5.1 Config (`<userData>/fusion-sql-config.json`)

```json
{
  "baseUrl": "https://xxxx.fa.em3.oraclecloud.com",
  "reportPath": "/Custom/ReERP/QueryRunner.xdo",
  "dataModelPath": "/Custom/ReERP/QueryRunnerDM.xdm",
  "folderPath": "/Custom/ReERP",
  "dataSource": "ApplicationDB_FSCM",
  "rowLimit": 100,
  "timeoutMs": 120000,
  "reportServicePath": "/xmlpserver/services/v2/ReportService",
  "catalogServicePath": "/xmlpserver/services/v2/CatalogService"
}
```
Only the **origin** of `baseUrl` is used (scheme + host + port). It must start with `http(s)://`.

### 5.2 Credentials (`<userData>/fusion-creds.json`)

`{ "username": "...", "password": "<base64>", "encrypted": true }`. The password is encrypted with the OS keychain (Electron `safeStorage` = DPAPI on Windows) and then base64-encoded. If OS encryption isn't available, it falls back to plain base64 with `encrypted:false`, which **should be avoided** in the C# version. The same Fusion credentials are shared with other Re-ERP modules.

> **Current behaviour to fix in the port:** `get-fusion-credentials` returns the **decrypted password to the page**, although the Fusion SQL screen only uses it to show "password saved" (`hasPassword: !!c.password`). The C# host must return only `{ username, hasPassword }` and keep the password on the native side.

---

## 6. Schema browser (bootstrapped through the same runner)

All of these are ordinary `execute` calls:

| Purpose | SQL (owner/name are quoted literals; `'` doubled) | rowLimit |
|---|---|---|
| Owners | `SELECT username FROM all_users ORDER BY username` (+ `PUBLIC` added for public synonyms) | 5000 |
| Object list (paged) | `SELECT object_name FROM (SELECT object_name, ROW_NUMBER() OVER (ORDER BY object_name) rn FROM all_objects WHERE owner='X' AND object_type='TABLE') WHERE rn BETWEEN a AND b` | 5000/page, repeat until a page returns < 5000, safety ceiling 200 000 |
| Server search (beyond the cached list) | `… AND UPPER(object_name) LIKE '%TERM%' ORDER BY object_name` | 2000 |
| Columns | `SELECT column_name, data_type, data_length, nullable FROM all_tab_columns WHERE owner='X' AND table_name='T' ORDER BY column_id` | 1000 |
| Arguments (procedures/functions/packages) | `SELECT NVL(argument_name,'(return)') AS column_name, data_type, in_out FROM all_arguments WHERE owner='X' AND object_name='T' AND argument_name IS NOT NULL ORDER BY position` | 1000 |
| Indexes | `all_indexes` ⨝ `all_ind_columns`, `LISTAGG(column_name, ', ') WITHIN GROUP (ORDER BY column_position)`, grouped by index | 500 |
| Foreign keys | `all_constraints` (type `R`) ⨝ `all_cons_columns` ⟕ referenced `all_constraints` → `fk_name, fk_columns, ref_table` | 500 |

Object types offered: TABLE, VIEW, MATERIALIZED VIEW, SYNONYM, PROCEDURE, FUNCTION, PACKAGE, TRIGGER, SEQUENCE, TYPE. Columns can be expanded for tables, views and materialized views; arguments for procedures, functions and packages; indexes and foreign keys for tables only.

**Cache (never re-query unless the user clicks Refresh):** one JSON file per pod, `<userData>/fusion-sql-cache/schema-<pod-sanitised>.json` (non-`[\w.-]` → `_`, max 120 chars), as a key → value map:
- `owners` → `string[]`
- `schema.<OWNER>.<KIND>` → `{ at, names[], capped }`
- `detail.<OWNER>.<KIND>.<NAME>` → column/argument rows
- `idx.<OWNER>.<TABLE>`, `fk.<OWNER>.<TABLE>` → rows

Saved queries use the same store under the pseudo-pod `__queries`, key `list`. The cache file can be exported with a Save dialog. The list UI filters client-side and pages 200 names at a time.

### 6.1 SQLite schema store ("Tables List" tab)

A bulk pull for one owner (tables + all indexes + all FKs, paged 5 000 at a time) is saved to `<userData>/fusion-schema.db`:
```sql
fusion_tables(owner, table_name)
fusion_indexes(owner, table_name, index_name, uniqueness, columns)
fusion_foreign_keys(owner, table_name, fk_name, fk_columns, ref_table)
```
Rows are replaced per owner (delete + insert); other owners are left untouched. You can export the `.db` (copy it out) and import one (copy it in), so one person can pull the schema once and share it. There's also an info call (tables + row counts + size) and a read-only query call.

---

## 7. UI functional requirements

### 7.1 Layout (tabs)
1. **SQL Builder:** toolbar (Execute, Ask AI, History, Save, Row limit 1–100 000, default 100), schema tree on the left, SQL editor, and sub-tabs **Results (n)** and **Logs**.
2. **List of Queries (n):** saved queries with Run / Edit / Delete. Saving with an existing name updates that query.
3. **Tables List:** bulk schema pull → SQLite, with export/import (§6.1).
4. **Connection settings:** pod URL, report/data-model/folder paths, data source, row limit, Fusion username/password, **Deploy runner report** button with a step log, and the **API calls** inspector.

### 7.2 Parameters
- Detect `{{NAME}}` and Oracle binds `:NAME` (not `::` or `x:NAME`) in the SQL. If any are present, show a dialog asking for their values before running. Remember the values for next time.
- Substitution: blank → `NULL` (so `NVL(:P, col)` means "all"). Numeric (`^-?\d+(\.\d+)?$`) → as is. Anything else → `'text'` with `'` doubled.

### 7.3 Results
- Grid with 100 rows per page, horizontal scroll, and a client-side search over all cells. Numbers are right-aligned with separators, except ID columns.
- Excel export (header bold on red, frozen top row, column width 12–45) and PDF export (landscape when more than 6 columns).
- Logs: one line per run: `n rows in X ms — <sql…>` or `ERROR: …`.
- History: the last 30 distinct statements, stored in local storage.

### 7.4 "Ask AI" (Claude writes the SQL)
1. Build a **schema context** from the cache: extract the question's keywords (≥3 letters) plus finance synonyms (CUSTOMER→CUST/PARTY/HZ_, SUPPLIER→VENDOR/POZ_/AP_SUPPLIER, INVOICE→RA_CUSTOMER_TRX/AP_INVOICES/TRX, PAYMENT→AP_PAYMENT/CHECKS/PAYMENT_SCHEDULES, ACCOUNT→GL_CODE_COMBINATIONS, JOURNAL→GL_JE, TAX→ZX_, BANK→CE_/IBY_, …). Match them against cached TABLE and VIEW names (up to 40 candidates). Use cached columns, or fetch columns live for at most 15 uncached tables. Format: `OWNER.TABLE: col1, col2, …`.
2. Host → Claude Messages API with a system prompt that enforces: exactly one read-only `SELECT`/`WITH` in a `sql` code block, **only columns from the provided schema**, owner-qualify non-FUSION tables, `{{PARAM}}` tokens instead of hard-coded filter values, no trailing semicolon. Send the last 8 turns as history.
3. The UI extracts the ```` ```sql ```` block into the editor. The user reviews it and runs it.
The API key is stored by the host (encrypted) and never exposed to the page.

---

## 8. Security requirements (keep these; the C# port should improve them)

1. **Read-only by design:** BIP data models can't run DML, the host rejects anything not starting with `SELECT`/`WITH`, and every statement is wrapped in a `ROWNUM` cap.
   **Hardening item (not in the reference implementation):** Oracle 12c+ allows `WITH FUNCTION … BEGIN … END` (inline PL/SQL) at the start of a query. Reject statements matching `^\s*WITH\s+(FUNCTION|PROCEDURE)\b` and any `PRAGMA AUTONOMOUS_TRANSACTION`.
2. The statement runs **as the configured Fusion user**. Use a least-privilege BI account. Fusion audits the usage.
3. Credentials are encrypted at rest with the OS (DPAPI) and never logged (redacted in the call log). **Requirement for the port:** never send the password to the web page (today's bridge does; see §5.2).
4. HTTPS only to the pod origin. Don't disable certificate validation.
5. Dictionary queries build literals with `'` → `''` escaping. Owner and object names come from the dictionary itself, not free text, except in search, which is escaped.

---

## 9. Host ↔ UI contract (current IPC — reuse the same shapes in C#)

| Method | Request | Response |
|---|---|---|
| `fusionSqlConfig(patch?)` | partial config, or nothing = read | `{success, config}` |
| `fusionSqlExecute({sql, rowLimit})` | | `{success, rows[], columns[], rowCount, capped}` or `{success:false, error, raw?}` |
| `fusionSqlDeploy()` | | `{success, steps[], message}` or `{success:false, error, steps, raw}` |
| `fusionSqlCalls({clear?})` | | `{success, calls[]}` |
| `fusionSqlCacheGet({pod, key?})` / `CacheSet({pod,key,value})` / `CacheClear({pod})` / `CacheExport({pod})` | | `{success, value?}` / `{success, path?}` |
| `fusionDbSave({owner, tables[], indexes[], fks[]})` | | `{ok, path, counts}` |
| `fusionDbInfo()` / `fusionDbQuery({sql,rowLimit})` / `fusionDbExport()` / `fusionDbImport()` | | `{ok, …}` |
| `fusionSqlAiSql({question, schema, history[]})` | | `{success, response}` |
| `saveFusionCredentials(user, pass)` / `getFusionCredentials()` | | `{success}` / `{username, hasPassword}` (the UI only needs this) |

---

## 10. Known limits and gotchas

- **Statement length:** the decoded SQL goes through `VARCHAR2` functions **in SQL context**. Unless the pod has `MAX_STRING_SIZE=EXTENDED`, that is **4 000 bytes of base64 ≈ 2 900 characters of SQL**. Test with a long statement. If it's too small, move the decode into a PL/SQL function (not possible without DB access) or keep queries compact. *(The README's "32 767" figure applies to PL/SQL, not SQL.)*
- **Result size:** everything comes back as one XML CLOB in one SOAP response (`sizeOfDataChunkDownload=-1`). Large row caps (tens of thousands of wide rows) can hit BIP's report size/time limits. Keep the default cap small and page with `ROW_NUMBER()` windows the way the schema loader does.
- **Column order and NULLs:** see §4.5.
- **Output format:** some pods have CSV disabled on the report. That's why XML is tried first and CSV is only a fallback.
- **Type fidelity:** everything is text over the wire. Only numbers are inferred.
- **Concurrency:** each query is a separate BIP job. Avoid firing many in parallel against production; the schema loader runs pages one after another.

### 10.1 Corrections to `fusion/bip/README.md` (it describes an older design)
| README says | The code actually does |
|---|---|
| endpoint `ExternalReportWSSService` | **`/xmlpserver/services/v2/ReportService`** (v2 namespace, credentials in the body) |
| mechanism "`OPEN :xdo_cursor FOR <sql>`" | **`DBMS_XMLGEN.getxml`** Standard-SQL runner (§3.1). Ref cursors fail on SaaS. |
| "parses CSV first, falls back to XML" | **XML first**, CSV only when XML returns neither data nor a fault |

---

## 11. Acceptance tests

1. `SELECT 1 AS n FROM dual` → 1 row, column `N`, value `1` (a number).
2. `SELECT invoice_id, invoice_num FROM ap_invoices_all` with row limit 5 → exactly 5 rows, `capped=true`. `INVOICE_ID` is displayed without separators.
3. A query returning 0 rows → success, empty grid, no error.
4. A bad column → the error shows the `ORA-00904` text from the XML attempt (not a CSV-format error).
5. A value containing `<`, `&`, `"` and a newline round-trips exactly.
6. `DELETE FROM x` and `WITH FUNCTION f …` → rejected by the host before any network call.
7. `{{SUPPLIER}}` with a blank value → `NULL`, with `O'Neil` → `'O''Neil'`.
8. Deploy on a clean pod → folder, data model and report created. Running test 1 then works.
9. The call inspector shows the request with the password as `***`.
10. Schema: owners load once and come from the cache on reopen. FUSION tables page through all objects. Expanding a table shows its columns, indexes and FKs.

---

## 12. C# + WebView2 implementation guide

### 12.1 Stack
| Concern | .NET choice |
|---|---|
| Shell | WPF or WinForms + **Microsoft.Web.WebView2** |
| UI | Reuse the HTML/JS/React bundle, or build a new page. Load it from local files via `SetVirtualHostNameToFolderMapping("app.local", folder, Allow)`. |
| Bridge | `CoreWebView2.WebMessageReceived` + `PostWebMessageAsJson` with a `{id, method, params}` → `{id, result|error}` request/response protocol (async-friendly). Avoid `AddHostObjectToScript` for complex async calls. |
| HTTP/SOAP | One shared `HttpClient`, `StringContent(envelope, Encoding.UTF8, "text/xml")`, `SOAPAction` header, `CancellationTokenSource(timeout)` |
| XML | `XDocument`/`XmlReader`. Parse properly instead of with regex; an `XmlReader` handles the once-escaped `<RESULT>` naturally: read RESULT's value, then parse it as a second document. |
| Base64 | `Convert.ToBase64String(Encoding.UTF8.GetBytes(sql))` |
| ZIP | `ZipArchive` with `CompressionLevel.NoCompression` for `.xdmz`/`.xdoz` |
| Secrets | `ProtectedData.Protect(..., DataProtectionScope.CurrentUser)` (DPAPI) or Windows Credential Manager |
| Config/cache | JSON files under `%APPDATA%\ReERP\` via `System.Text.Json` |
| SQLite | `Microsoft.Data.Sqlite` (same three tables) |
| Excel | ClosedXML (or do the export in JS as today) |
| Claude | `HttpClient` → `https://api.anthropic.com/v1/messages` (`x-api-key`, `anthropic-version: 2023-06-01`) |

### 12.2 Core service sketch
```csharp
public sealed class FusionSqlService
{
    private static readonly HttpClient Http = new();
    private static readonly Regex ReadOnly = new(@"^\s*(select|with)\b", RegexOptions.IgnoreCase);
    private static readonly Regex InlinePlsql = new(@"^\s*with\s+(function|procedure)\b|pragma\s+autonomous_transaction", RegexOptions.IgnoreCase);

    public async Task<QueryResult> ExecuteAsync(string sql, int? rowLimit, CancellationToken ct = default)
    {
        var stmt = sql.Trim().TrimEnd(';', ' ', '\n', '\r', '\t');
        if (stmt.Length == 0) return QueryResult.Fail("Empty statement");
        if (!ReadOnly.IsMatch(stmt) || InlinePlsql.IsMatch(stmt))
            return QueryResult.Fail("Only SELECT / WITH statements are allowed (read-only)");

        var cfg = Config.Load(); var cred = Credentials.Load();
        int cap = Math.Clamp(rowLimit ?? cfg.RowLimit, 1, 100_000);
        var b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes($"SELECT * FROM ({stmt}) WHERE ROWNUM <= {cap}"));

        var xml = await RunReportAsync(cfg, cred, b64, "xml", ct);
        var rows = xml.Bytes is { } b ? RowsetParser.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(b))) : null;
        if (rows is null && xml.Fault is null)
        {
            var csv = await RunReportAsync(cfg, cred, b64, "csv", ct);
            if (csv.Bytes is { } b2) rows = RowsetParser.ParseXmlGenOrCsv(Encoding.UTF8.GetString(Convert.FromBase64String(b2)));
            else return QueryResult.Fail(csv.Fault ?? $"HTTP {csv.Status}", csv.Raw);
        }
        if (rows is null) return QueryResult.Fail(xml.Fault ?? $"HTTP {xml.Status}", xml.Raw);
        return QueryResult.Ok(rows, cap);
    }

    private async Task<SoapResult> RunReportAsync(FusionConfig cfg, FusionCred cred, string b64, string format, CancellationToken ct)
    {
        var env = SoapEnvelopes.RunReport(cfg.ReportPath, b64, cred.User, cred.Password, format); // SecurityElement.Escape user/pass
        using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(cfg.Origin), cfg.ReportServicePath))
        { Content = new StringContent(env, Encoding.UTF8, "text/xml") };
        req.Headers.Add("SOAPAction", "\"runReport\"");
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromMilliseconds(Math.Clamp(cfg.TimeoutMs, 5_000, 600_000)));
        var res = await Http.SendAsync(req, cts.Token);
        var text = await res.Content.ReadAsStringAsync(cts.Token);
        CallLog.Record("runReport (" + format + ")", req, env, (int)res.StatusCode, text);  // redacts password
        var doc = XDocument.Parse(text);
        var bytes = doc.Descendants().FirstOrDefault(e => e.Name.LocalName == "reportBytes")?.Value;
        var fault = doc.Descendants().FirstOrDefault(e => e.Name.LocalName is "faultstring" or "message")?.Value;
        return new SoapResult((int)res.StatusCode, string.IsNullOrWhiteSpace(bytes) ? null : Regex.Replace(bytes, @"\s", ""), fault?.Trim(), text[..Math.Min(1200, text.Length)]);
    }
}
```

`RowsetParser.Parse`: load the decoded document. If a `RESULT` element exists, `XDocument.Parse(resultElement.Value)` (the value is already unescaped once by the XML parser), then read `ROWSET/ROW/*`. An empty or missing ROWSET means 0 rows. Keep `coerce` and union-columns exactly as in §4.5. Wrap the error path of `XDocument.Parse(text)` so HTML error pages from a proxy or login redirect come back as a readable error rather than an exception.

### 12.3 Bridge message example
```js
// page → host
chrome.webview.postMessage({ id: 42, method: 'fusionSqlExecute', params: { sql, rowLimit: 100 } });
// host → page
window.chrome.webview.addEventListener('message', e => resolvePending(e.data)); // { id: 42, result: {...} }
```
Wrap it in a JS shim that exposes the same method names as §9 (`window.fusionApi.fusionSqlExecute(...)` returning a Promise), so the existing React page can be reused unchanged.

### 12.4 Build order
1. Config + DPAPI credentials + `ExecuteAsync` + `RowsetParser`, with unit tests using the sample documents in §4.4.
2. WebView2 shell + bridge + a minimal page (editor, Execute, grid).
3. Auto-deploy (CatalogService + ZIP) and the call inspector.
4. Schema browser + JSON cache, then SQLite store.
5. Parameters, saved queries, history, exports.
6. Ask AI.

# Oracle BIP Reporting — the BI Publisher catalog, run from the desktop

Most Oracle Fusion customers keep their reporting in the BI Publisher catalog: hundreds of `.xdo` reports with
parameters, lists of values and layouts, run from the Fusion UI one at a time. This module brings that catalog
into the WMS desktop: browse it, search it, read a report's parameters and values, run it — in date or value
buckets when one run would be too big or too slow — and keep the result as a grid, a pivot, a chart, a file, a
table in DuckDB you can query with SQL, or a card on a dashboard everyone shares.

```
bip/ (page)                          host (C#)                                    Oracle Fusion pod
┌────────────────────────┐  bip*     ┌────────────────────────────────┐  SOAP     ┌──────────────────────────┐
│ Catalog · Run          │ ────────▶ │ Form1_BipHandlers.cs           │ ────────▶ │ /xmlpserver/services/v2/ │
│ Dashboards · Explore   │ ◀──────── │ BipService.cs (SOAP, streams)  │ ◀──────── │   CatalogService         │
│ History · Settings     │ progress  │ BipStore.cs  ──▶ C:\fusion\bip\bip.duckdb │   ReportService          │
└────────────────────────┘           │   runs → %LOCALAPPDATA%\…\Bip  │           └──────────────────────────┘
          │ gateway SQL              └────────────────────────────────┘
          ▼
   APEX: WMS_BIP_CATALOG (+ _LOG) · WMS_BIP_DASHBOARDS · WMS_BIP_FAVORITES · WMS_BIP_REPORT_NOTES · WMS_BIP_RUN_LOG
```

## What is where

| Piece | Path |
|---|---|
| Page | `bip/index.html`, `bip-core.js` (screens), `bip-engine.js` (pure: parameter kinds, date formats, buckets, plan, search, output formats of a definition, filters / sorting / pivot, aggregations), `bip-grid.js` (the page's own grid and pivot), `bip-store.js` (host bridge + APEX), `bip.css` |
| Host | `classes/BipService.cs` (SOAP: catalog, definition, parameters, streamed + chunked runs, data model download, CSV / XML readers and the XML → CSV flattener), `classes/BipStore.cs` (the DuckDB file), `classes/Form1_BipHandlers.cs` (`bip*` actions) |
| APEX | `apex_sql/98_bip_reporting.sql` — the page creates the same tables on first use |
| Tests | `bip/tests/bip-engine.test.js` (node, CI) |

## Three places, one order: DuckDB → APEX → Fusion

Everything the module reads from Fusion is kept, so the second time is instant and nothing is asked twice:

- **This PC's DuckDB file** `C:\fusion\bip\bip.duckdb` (env `BIP_ROOT`; AES-256 encrypted like the WMS 2.0 and Finance
  files): `bip_catalog` (every folder as last read, every index walk), `bip_report_meta` (each report's definition and
  parameters as last read), `bip_runs` (every run of this PC) and one table **`res_<runId>`** per data run holding its
  rows (loaded from the output CSV with `read_csv`, types inferred). A folder, a parameter form or a result opens
  from here without a call to Fusion.
- **APEX, shared** (`WMS_BIP_CATALOG`, `WMS_BIP_CATALOG_LOG`): every folder a user reads and every index walk is
  written there too, so another user's first open of the same folder — and their search box — is instant: the
  page asks DuckDB first, APEX second, Fusion last, and what Fusion answers is kept in both.
- **Fusion** only when nothing is kept, or on **Refresh** (the note beside every folder, definition and result says
  where it came from and when — *from DuckDB · read …*, *from APEX · read … by ravi*, *from Fusion … · kept + shared*).

The working indicator is a small chip in the header toolbar (spinner + what is going on), not a strip over the tabs.

## Catalog, the search popup and the index

The left column is the folder tree (`/Custom`, `/Shared Folders` …), the right the reports and data models of the
folder; the box above the listing only filters that folder. **The search lives in the header**: a box beside the
pod chip (Ctrl+K) opens a popup like the WMS toolbar search — type part of a name and every word must match the
name or the path; hits come grouped as Reports, Data models and Folders with the match marked and the folder on
the right, ↑ ↓ move, Enter opens (a report in the Run tab, a data model's SQL, a folder in the Catalog), Esc
closes; empty, it shows your favourites and recent runs; the footer says when the catalog was indexed, by whom,
what the last update found, and offers *Update*.

**The index** behind it: *Index the catalog* (the popup footer, the Catalog tab or Settings) walks the whole tree
once — breadth-first from the root (Settings › *Index from*), every folder once with
`CatalogService.getFolderContents`, four folders at a time, at most 1,500 folders, progress shown — and records
each item: path, name, type, parent folder, modified, owner. The list goes to DuckDB, to APEX for everyone, and into
the page. It is a listing of the catalog, not of report contents.

**Once indexed it is never rebuilt by itself.** The button becomes *Update the index (since …)*: the host walks the
folders again and compares every item with the kept copy — new paths, paths whose modified date (or name or type)
changed, kept paths the walk no longer saw — and the page writes only that delta to APEX, with a log row
(`index_mode` UPDATE, the counts, who, when); the toast and the popup footer say *n new, m changed, k removed since
<timestamp>*. The comparison is with the kept copy rather than with a date alone, so a report moved, renamed or
restored with an old date still shows up as new. The index also keeps itself current: Settings › *Keep it current*
(default: update when older than 1 day) runs an update in the background when the page opens and the index is
older than that — at most once an hour. *Re-index everything* (Settings) is for a changed root or an index that
looks wrong. Folders opened one at a time are kept the same way. Favourites (★), *Popular* (from the run log of
every PC) and *Recent runs* sit on top of the Catalog; notes and tags on a report are shared through APEX; the
catalog itself can be queried in Explore (`bip_catalog`).

## Run

Opening a report reads its definition (`getReportDefinition`: layouts and their output formats, the default
format, the data model) and its parameters (`getReportParameters`: type, default, date format, list of values,
multi-select) — from DuckDB after the first time, *Refresh* reads Fusion again. The form is built from that: menus
with the LOV values (and *All* when the report allows it), date pickers that send the date in the parameter's own
format (`MM-dd-yyyy`, `dd-MMM-yyyy` …), text and numbers.

**Output format — from the report definition.** The select lists exactly the formats the report's layouts offer
(PDF, Excel, CSV, HTML … as the definition names them) plus **XML data**, which `runReport` always accepts, and it
starts on the definition's `defaultOutputFormat`. CSV appears only when a layout offers it — asking BI Publisher for
csv on a layout without it fails with *Invalid format requested: csv* — and the note under the select says when no
layout offers CSV (XML data gives the same rows for the grid). Should a csv run still be refused, the host runs it
again as XML and says so in the result.

**Buckets** turn one run into many: *By date range* splits the from / to dates into days / weeks / months /
quarters / years (the pair of date parameters is detected from their names), *By the values of a parameter* runs
once per value (every value of the LOV, or a typed list), *Dates × values* both. The host runs the buckets one
after the other, joins the data parts into one `output.csv` (XML parts are flattened to CSV: the first repeating
element is a row, its leaves the columns), reports progress per bucket (rows so far, bytes, time left) and carries
on when a bucket fails — the failed ones are listed and *Run the failed buckets again* runs only those.

**The result** of a data run (CSV or XML) is loaded into DuckDB as `res_<runId>` and shown in the page's own grid:
sticky header, click a header to sort, a filter box per column (contains, `=exact`, `!not`, `>n`, `<n`, `a..b`), a
search over every column, only the rows on screen in the DOM (hundreds of thousands scroll like fifty), totals of
the numeric columns over the filtered rows, column chooser, drag to resize, CSV / Excel / Copy for Excel; hidden
columns and widths are remembered per report. **Pivot** (also the page's own): row fields, column fields, value +
function (sum / count / avg / min / max), subtotals, totals, rows by name or by total, Swap, CSV / Excel / Copy;
the layout is kept per report. **Chart** (Chart.js) and **Summary** (facts per column) as before. *SQL* on the
result opens it in Explore. PDF / Excel / HTML output opens as a file. Every run is kept under
`%LOCALAPPDATA%\GraysWMS\Bip\runs\<runId>\` with its `run.json`; History reopens (from DuckDB — instant), re-runs,
saves or deletes them.

**SQL behind it** downloads the report's data model (`CatalogService.downloadObject` of the `.xdm`) and shows its
SQL data sets and parameters — *Open in Fusion SQL* hands the SQL to the Fusion SQL page. **SOAP request** shows
the exact `runReport` envelope (password masked).

## Explore — SQL over everything kept

One read-only SQL box (SELECT / WITH / DESCRIBE / SUMMARIZE; Ctrl+Enter) over the DuckDB file: every result table
(listed with its report, rows, columns and date — click one for `SELECT * … LIMIT 500`), `bip_runs`, `bip_catalog`,
`bip_report_meta`, `bip_index_log`, and samples (runs, reports run most, reports per folder, find a report). Results
land in the own grid, with *As a result* to chart them in the Run tab. Join two results, compare this month's run
with last month's, count rows per folder — DuckDB does it on the PC; the host runs it with external access off and
`SqlGuard`, so nothing is written and no file is read.

## Big reports without a WCF proxy

A generated service reference is not needed to run large reports. `BipService` posts the SOAP envelope with
`HttpClient` (no message-size limit), reads the answer with an `XmlReader` and decodes `reportBytes` from base64
straight into the output file — a 300 MB report never sits in memory — and asks for the output in chunks
(`sizeOfDataChunkDownload`, default 8 MB; the rest comes with `downloadReportDataChunk`). The time limit per
run is yours (default 20 min). What still does not fit goes into buckets.

## Dashboards

A dashboard is a set of cards kept in APEX (shared, or private to its owner). *Add to a dashboard* from the Run
tab keeps the report, its parameter values, its buckets (optionally *rolling*: the last n days up to today), how to
show the result (one number — count, sum, average … of a column, red below a limit —, a table of the first rows,
or a chart) and **the format it runs with**: a data format of the report's definition — its default when that is
CSV or XML, else CSV when a layout offers it, else XML data — never a hard-coded CSV; added from the Catalog, the
dialog reads the definition and says what the report's default is. Each card runs one by one (*Run all*) or on a
timer while the tab is open, and **opens on its last kept result**: the newest run of exactly these parameters and
buckets in DuckDB (`bipLastRun`, by a hash of path + parameters + buckets) shows at once, marked *from DuckDB*, until
you press Run. Export / Import moves a dashboard as a JSON file.

## Settings

Pod (PROD / TEST — the host calls that pod's services with the application's Fusion credentials; the page never
holds them), the DuckDB file (path, size, what it holds, encryption; *Clear the results / the catalog + definitions /
everything* for AI admins), chunk size, time limit per run, rows loaded into the page at once, the default date
window for reports whose dates are empty, the root the catalog index starts from, *Keep it current* (when the index
updates itself), *Re-index everything*, and how the index works.

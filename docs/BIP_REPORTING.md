# Oracle BIP Reporting — the BI Publisher catalog, run from the desktop

Most Oracle Fusion customers keep their reporting in the BI Publisher catalog: hundreds of `.xdo` reports with
parameters, lists of values and templates, run from the Fusion UI one at a time. This module brings that catalog
into the WMS desktop: browse it, search it, read a report's parameters and values, run it — in date or value
buckets when one run would be too big or too slow — and keep the result as a grid, a pivot, a chart, a file, or a
card on a dashboard everyone shares.

```
bip/ (page)                        host (C#)                               Oracle Fusion pod
┌──────────────────────┐  bip*     ┌──────────────────────────────┐  SOAP   ┌─────────────────────────────┐
│ Catalog · Run        │ ────────▶ │ Form1_BipHandlers.cs         │ ──────▶ │ /xmlpserver/services/v2/    │
│ Dashboards · History │ ◀──────── │ BipService.cs                │ ◀────── │   CatalogService            │
│ Settings             │ progress  │   runs → %LOCALAPPDATA%\…\Bip │ streamed│   ReportService             │
└──────────────────────┘           └──────────────────────────────┘         └─────────────────────────────┘
          │ gateway SQL
          ▼
   APEX: WMS_BIP_DASHBOARDS · WMS_BIP_FAVORITES · WMS_BIP_REPORT_NOTES · WMS_BIP_RUN_LOG
```

## What is where

| Piece | Path |
|---|---|
| Page | `bip/index.html`, `bip-core.js` (screens), `bip-engine.js` (pure: parameter kinds, date formats, buckets, plan, search, aggregations), `bip-store.js` (host bridge + APEX), `bip.css` |
| Host | `classes/BipService.cs` (SOAP: catalog, definition, parameters, streamed + chunked runs, data model download, CSV / XML readers), `classes/Form1_BipHandlers.cs` (`bip*` actions) |
| APEX | `apex_sql/98_bip_reporting.sql` — the page creates the same tables on first use |
| Tests | `bip/tests/bip-engine.test.js` (node, CI) |

## Catalog

The left column is the folder tree (`/Custom`, `/Shared Folders` …), the right the reports and data models of the
folder. **Index the catalog** walks the whole tree once (breadth-first, up to 1,500 folders, progress shown) and
keeps it per pod in `%APPDATA%\GraysWMS\Bip\catalog_<POD>.json`; from then on the search box finds a report by
name wherever it sits. Favourites (★), *Popular on PROD* (from the run log of every PC) and *Recent runs* sit on
top so the reports people use are one click away. Notes and tags on a report are shared through APEX.

## Run

Opening a report reads its definition (`getReportDefinition`: templates and their output formats, the data model)
and its parameters (`getReportParameters`: type, default, date format, list of values, multi-select). The form is
built from that: menus with the LOV values (and *All* when the report allows it), date pickers that send the
date in the parameter's own format (`MM-dd-yyyy`, `dd-MMM-yyyy` …), text and numbers.

**Buckets** turn one run into many: *By date range* splits the from / to dates into days / weeks / months /
quarters / years (the pair of date parameters is detected from their names), *By the values of a parameter* runs
once per value (every value of the LOV, or a typed list), *Dates × values* both. The plan is listed before you
press Run. The host runs the buckets one after the other, appends the CSVs into one file (header once), reports
progress per bucket (rows so far, bytes, time left) and carries on when a bucket fails — the failed ones are
listed and *Run the failed buckets again* runs only those.

**Output**: CSV (the default — the result comes back as a grid you can filter, pivot, chart, summarise, copy
to Excel or export) or XML for data; PDF / Excel / HTML and the other formats of the report's templates open as
files. Every run is kept on this PC under `%LOCALAPPDATA%\GraysWMS\Bip\runs\<runId>\` with its `run.json`
(parameters, buckets, rows, time, status); History reopens, re-runs, saves or deletes them.

**SQL behind it** downloads the report's data model (`CatalogService.downloadObject` of the `.xdm`) and shows its
SQL data sets and parameters — *Open in Fusion SQL* hands the SQL to the Fusion SQL page, where it runs
read-only without BI Publisher at all. **SOAP request** shows the exact `runReport` envelope (password masked)
to reproduce a run in SoapUI.

## Big reports without a WCF proxy

A generated service reference is not needed to run large reports. `BipService` posts the SOAP envelope with
`HttpClient` (no message-size limit), reads the answer with an `XmlReader` and decodes `reportBytes` from base64
straight into the output file — a 300 MB report never sits in memory — and asks for the output in chunks
(`sizeOfDataChunkDownload`, default 8 MB; the rest comes with `downloadReportDataChunk`). The time limit per
run is yours (default 20 min). What still does not fit goes into buckets.

## Dashboards

A dashboard is a set of cards kept in APEX (shared, or private to its owner). *Add to a dashboard* from the Run
tab keeps the report, its parameter values, its buckets (optionally *rolling*: the last n days up to today, so
the card stays current) and how to show the result: one number (count, sum, average … of a column, red below a
limit), a table of the first rows, or a chart (category × value). Cards run one by one (*Run all*) or on a timer
while the tab is open; the last result of each card is remembered on the PC so the dashboard shows numbers as
soon as it opens. Export / Import moves a dashboard as a JSON file.

## Settings

Pod (PROD / TEST — the host calls that pod's services with the application's Fusion credentials; the page never
holds them), chunk size, time limit per run, rows loaded into the page at once (the file keeps everything), the
default date window for reports whose dates are empty, and the root the catalog index starts from.

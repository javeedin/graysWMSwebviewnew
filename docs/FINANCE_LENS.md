# Finance Lens — guide

Finance Lens turns Oracle Fusion general-ledger **journal balances** (ledger × company × cost centre × account × period, actual and budget) into
formatted financial statements, KPIs, monitoring, analytics, journal-risk tests, close checks and a one-click board pack.
The data sits in one DuckDB file on the PC (`C:\fusion\finance\finance.duckdb`), so every screen answers in well under a
second even with millions of rows.

## Start: connect Oracle Fusion

Finance Lens holds Oracle Fusion data only. Home › **Finance Lens** › *Connect to Fusion* (AI admins) opens Data › Fusion setup:
*Discover* finds the ledgers, the chart of accounts segments and the account types, then *Load* reads the GL balances and
journals (or use BICC bulk extracts). The statements are built from your accounts by class at once; adjust them in Data ›
Account mapping and the Template designer. Data › Data & folder › *Remove the data on this PC* clears the file (setup,
templates and mapping stay).

## The screens

- **Overview** — headline KPIs with 12-month sparklines and monitor status, plain-language commentary (month vs budget,
  YTD vs last year, unusual accounts, monitor alerts), revenue and profit, margins, the net-profit bridge, cash and
  working capital, opex mix, biggest movements.
- **Statements** — one **statement bar** on top for every statement: Ledger · Year · Period (the synced months as
  buttons) · Company · Amounts, then the statements as tabs — Trial balance, Income statement, Balance sheet, Cash
  flow (and Other) — and the **Template** to run it with (each statement can have several: management, statutory, a
  group view …), *Edit mapping* and *New template*. Hide empty lines, account detail; Excel (formatted, one sheet per
  statement), CSV, print. Accounts with amounts that are in no line of the template are named in a warning with
  *Place them automatically*. **Click any amount** to drill:
  the accounts behind it → companies, cost centres and months → journal lines → the whole journal.
- **Analytics** — trends of several income statement lines on one chart (pick any lines of any income statement template — Sales, Cost of sales, Discounts …, up to 8, each in its own colour; quick sets Sales & costs / Profit / Operating expenses / Margins; lines or columns; % lines on a right-hand axis; a monthly table underneath) with a seasonal forecast per line (dotted; Holt-Winters with 24+ months) and optional budget (dashed), variance bridges (YTD vs budget,
  vs last year, month vs budget / last month, last 12 months), cost centres against budget as a heat map, companies
  with intercompany elimination and the group total, all ratios with trends, common-size statements, what-if drivers
  (volume, unit cost, payroll, other costs, finance costs) and anomalies (seasonal: this month against the same month
  last year × the usual growth).
- **KPIs & monitor** — monitor rules (e.g. covenants: net debt / EBITDA > 2.5×, interest cover < 4×) with a
  12-month status strip, and the KPI library you can extend.
- **Journal risk** — weekend and out-of-hours postings, round-amount and large manual journals, possible
  duplicates, suspense postings, postings long after the period end, rare users, Benford's law on first digits, a
  risk score per journal, activity by source, person and hour.
- **Close checks** — trial balance per company, every journal balanced, balance sheet balances, cash flow ties to the
  bank, suspense cleared, intercompany balances and income/expense agree, abnormal balance signs, budget loaded,
  clean year-end roll-over, late manual journals, unusual movements reviewed.
- **Statement builder** — see *Statement builder* below; the advanced *Template designer* (formulas, ranges, styles
  row by row) opens from it.
- **Data** — sync status against Fusion, chart of accounts and segment values, Fusion setup, BICC, account mapping, SQL explorer, folder.
- **Board pack** (header button) — title, sections, statements and an editable commentary → a print-ready pack
  (cover, executive summary with KPI tiles and attention points, KPI table, charts, statements, cost centres,
  monitors, risk highlights). Print / save as PDF, or save the HTML.

## Statement builder

An income statement or balance sheet is **main groups → sections → accounts**:

- **Main group** — a heading (Revenue, Cost of sales, Operating expenses …) with its *nature*: income / expense for the
  income statement, asset / liability / equity for the balance sheet (which side shows as positive). A group with one
  section is one line; with more it shows its sections and a *Total …* line.
- **Section** — a line inside the group (Staff costs, Rent …) holding accounts, plus an optional rule (`5011*`,
  `5020-5099`, `!5050`) for accounts added later. The balance sheet's equity has *Profit for the year to date*
  (automatic: every income and expense account).
- **Subtotal** — Gross profit, EBITDA, Net profit … adds up the groups above it (income +, expenses −); on the balance
  sheet the groups since the previous subtotal. Click its description to pick the groups yourself; *margin %* adds a
  margin line. The balance sheet gets a check line (assets = equity + liabilities).

**Default mapping**: from the synced trial balance (account, description, account type) every account gets a class
(`FINE.classify`) and lands in its section; accounts without a type get one from the name and code (`FINE.guessType`:
"PL EXP – …" → expense, 1… asset, 2… liability, 3… equity, 4… revenue, 5–9… expense). Until you change it the
default mapping follows the chart of accounts (re-done on every refresh, so names synced later still move accounts to
the right line); the first edit makes it yours. Only classes you chose (Account mapping, also from APEX) stick — the
others are worked out again from the type and name each time.

**Working in the builder**: click a section (it lights up), then click accounts on the right to put them there — or
drag accounts (ticked ones together) onto a section, or tick several and *Move*. The right side lists *Not mapped*,
every account of the statement, *In two* sections, or all, with their amounts; every line shows its amount live (YTD
for the income statement, closing balance for the balance sheet) and the bar says whether everything is mapped and
whether the balance sheet balances. *Auto-place* puts the accounts that are not mapped next to accounts of the same
class; *Default mapping* starts again. *Columns*: Month · YTD · last year, Month & YTD vs budget, YTD vs last year, last
12 months + YTD, Month · quarter · YTD · full year (balance sheet: period end · last month · last year end, 12 month
ends, vs a year ago).

**Download / upload the mapping**: *Download mapping* writes an Excel (or CSV) with one row per account — Template,
Main group, Nature, Section, Account, Account name, Type, Amount — accounts not mapped yet at the bottom in yellow,
plus a *How to fill* sheet. Fill it in (or write your own with those columns; a subtotal is a row with Nature =
`subtotal` and its name in Main group) and *Upload mapping*: replace the current template's mapping, or save it as
new templates — several template names in one file make several templates. Groups and sections keep their ids when
their names match, so KPIs (`PL.REV`, `BS.CASH` …) keep working.

Stored with the other templates in `templates.json` (`simple` = the structure, compiled to rows by
`FINE.simpleCompile`). The default income statement and balance sheet keep the ids `PL` / `BS` and the starter line ids.

## Templates (advanced designer)

A template is a list of rows and columns, stored in `templates.json` next to the data.

Row types:

| Type | What it does |
|---|---|
| header | A section title |
| accounts | Sum of the accounts it picks: `4000-4099` range, `4000, 4010` list, `6*` starts with, `!6950` leave out |
| group | Sum of the rows that name it in *In group* (groups can nest: Net revenue = Gross sales + Returns) |
| formula | Row ids with `+ − * / ^ ( )` and `PCT DIV IF ABS MIN MAX SUM AVG ROUND NEG` — e.g. `GP - OPEX + OI`, `PCT(GP, REV)` |
| check | A formula that must come to nil (shown ✓ or in red) |
| blank, text | Spacing and notes |

Per accounts row: **sign** (auto shows credits as + for revenue, liability and equity rows), **basis** (movement for
the income statement, closing balance for the balance sheet, change and opening balance for the cash flow), format
(amount, %, ratio, days), *better when* higher / lower (variances are shown favourable + / unfavourable −), style (bold,
italic, top border, double underline, highlight, hidden), indent.

Columns: scenario (actual / budget) × range (month, QTD, YTD, last 12 months, full year, closing or opening balance) ×
period (this, previous month, 3 months back, same period last year, last year end, *n* months back), variances (amount
or %), and % of a row (common size). Presets: month & YTD vs budget and last year, year on year, balance now / last
month / year end, 12-month trend, quarter + full-year budget.

The designer warns when accounts are **in no row** (left out of the totals) or **in two rows** (double counted), and
shows a live preview on the current data. Templates can be exported and imported as JSON.

## Understanding the KPIs and the company health

**How a KPI is worked out** — click any KPI (KPI library, the ❓ next to a monitor, or a chip in the health card): what it means in plain words and
its healthy range, the formula, the formula **with this period's numbers in it** (`PCT(-42,072,189, 32,822,657) = -128.2 %`), and a table of every
input — the statement line (e.g. `PL.REV` = line *Revenue* of the income statement), the window (year to date, last 12 months, closing balance …)
with the exact periods it covers, its amount, and a fold-out with **the accounts behind it** (code, name, amount) — or, for a formula line such as
Gross profit, its parts (REV − COGS) with their amounts. Below: the last 12 months and the monitor rules on it. The same panel sits in the KPI
editor (refreshed by *Test*) and in the monitor rule editor, which also says what the rule means right now ("Current ratio < 1.20×. Aug-26: 1.35× → OK").

**No data is not 0 %** — a KPI that needs data that is not there (no budget loaded, last year not synced, the previous month missing) shows
*no data* with the reason instead of a misleading 0.0 %, and its monitor is not raised. A last-12-month input built from fewer than 12 synced
months is flagged.

**Company health** (top of KPIs & monitor) — a score out of 100 with a grade (Healthy ≥ 75, Watch ≥ 55, At risk), strengths and concerns, and
seven pillars: Profitability (gross / EBITDA / net margin, ROE), Growth & plan (vs last year, vs budget), Liquidity (current, quick ratio),
Working capital (DSO, DIO, cash cycle), Debt & solvency (debt / equity, net debt / EBITDA, interest cover), Cash generation (OCF / EBITDA) and
Books in order (balance check, suspense). Each KPI is good (100) / watch (60) / poor (20) against typical ranges (`FINE.HEALTH.bands`; change them
in config.json `health.bands`); pillars are averaged with weights. The score is marked *provisional* while data is missing, and **To complete the
picture** lists what is missing with the button that gets it: last year's periods, 12 months in a row, the budget (full GL load), accounts not
mapped to receivables / inventory / payables / cash / finance costs / cost of sales (Statement builder), accounts without a Fusion type, journal
lines. The master data checklist (Data › Trial balance sync and SQL explorer) has the same items — *12 months in a row* and *Last year* with a
Sync button for exactly the missing periods, and *Budget*.

### Trial balance sync — table view

Data › Trial balance sync opens as a table (switch to Tiles at the top right). Each period is one row:

| Period | Trial balance | | Extended segments | |
|---|---|---|---|---|
| Jan-26 | ✓ Yes · 46 rows · read time | Overwrite | ✗ No | Sync |

- **Trial balance** and **Extended segments** are synced separately; each has its own Sync (or Overwrite once read) on the row.
- While a sync runs the row shows its live state (waiting, syncing · company i of n, failed) and the yellow banner shows the run.
- *Sync extended* syncs the extended segments for every ticked row.
- Periods that are not open yet are marked *not open yet* and are never synced.
- **When a company times out**, the extended segments of that company are read **account by account** (Settings › Extended segments › *Read*: per company with the account fallback (default), always account by account, or per company only; *accounts per query* 1–50 — a batch that fails is split in half). The account list comes from the trial balance already synced for that period, so sync the trial balance first. The row shows *company 01 · account 12 of 80* while it runs; a company that still fails is listed with ⚠ and the other companies are kept.
- **Syncs no longer stop each other.** Each sync runs on its own: starting a test query, a segment-values read or another kind of sync never cancels a running one, and a second sync of the same kind is refused until the first ends (or you press Cancel). A stopped sync says why — Cancel pressed or its time limit (trial balance 3 h, extended 4 h); what was read so far is kept.
- **Ties to the trial balance.** Every extended read is checked against the trial balance already synced: per account, opening, debits and credits must match. Accounts that are missing or different are read again account by account straight away — but only after a per-company read and when at most half the accounts differ. An account-by-account read is never repeated (it would return the same rows), and when most accounts differ the difference is in the data; the sync log then shows the first three accounts with TB vs extended opening / debits / credits. The row shows *ties to TB* or *n accounts differ from TB* (hover for the list).
- **👁 View** next to each status shows the rows kept on this PC for that period — trial balance or extended segments, with names, totals, the debits = credits check, filters per column and CSV. The extended view lists first the accounts that do not add up to the trial balance (TB vs extended, *missing* when Fusion returned nothing).
- **</> SQL** beside each Sync / Overwrite button opens the query that period runs: pick a company, see the exact SQL, **Test in Fusion** (rows, time, first rows) or copy it. For the trial balance, **Edit query** changes the query every Sync uses (kept on this PC; *Default query* puts it back). The query box that used to sit in Settings is gone.
- When Fusion answers with text instead of rows, the error now says what it was — the Oracle error (e.g. *ORA-01652 unable to extend temp segment*), or that BI Publisher cut the answer short (then the trial balance sync reads company by company) — instead of *it returned RESULT*.
- The 👁 view opens on **Raw rows from Fusion**: exactly what each read brought and is kept on this PC — every column (segments with their names), translated rows included, nothing added up — with the column totals and each read (company, rows, segments, when). **Balances** switches to opening / debit / credit / closing.
- Codes with a leading zero (*000*, *03*, *0101*) are now kept as text; before, Fusion values such as salesperson or profit centre *000* were stored as *0*. Press **Overwrite** on periods synced before this fix.
- The table has no bulk buttons any more: every action is on its row (Sync / Overwrite, </> SQL, 👁 data, 🗑 delete). The column headers have **Sync n missing** to fill every open period of the year at once. The Tiles view keeps tick-and-act buttons.
- The extended query names its columns after the segments — `c.SEGMENT1 company, c.SEGMENT4 account, c.SEGMENT10 salesperson, c.SEGMENT15 item_profit_center` — so the SQL and its Test result read in your own words.
- **Why so few rows?** in the SQL dialog counts the rows kept after each filter (ledger · period · currency, templates, zero rows, the join, summary combinations, the company, translated rows, the grouped query with and without the hint) and points at the step where they disappear. A query that finds nothing now simply shows **0 rows** — the long base64 text was only the runner echoing the query back.
- **Company 01 read as 1.** Company lists discovered before leading zeros were kept say *1* where Fusion holds *01*, so a filter `c.SEGMENT1 = '1'` found nothing. Every filter and comparison now accepts both (`… OR LTRIM(c.SEGMENT1, '0') = '1'`), and the board asks you to run **Fusion setup › Discover** again; afterwards **Overwrite** the periods synced before so the stored codes are exact.
- **Companies** are picked right under the ledger (not in Settings). The first time, the company of the header filter is ticked — else the ledger's first company — instead of all; your choice is kept per ledger.
- **Extended segments: …** (beside Table / Tiles) opens the segment choice in a dialog: tick the segments, how they are read, *Save choice*. The rows then offer Sync for every period that lacks them.
- **Accounts read one by one** each get a result: ✓ synced, ○ no data in Fusion, ✗ failed. A failing account no longer stops the others. The icon beside the extended status (*✗ 2 failed* in red, or *✓ 160* in green) opens the list of accounts with their error and **Retry n failed**, which reads only those accounts again and keeps the rest.
- **Fastest: by code combination** (Extended segments › *Read*, now the default). Each period reads GL_BALANCES on its own — no join and no grouping in Fusion, all companies at once — in pages saved as they arrive; the segments come from the code combinations kept on this PC, and the extended trial balance is built on the PC. Sync the code combinations once in the master data checklist (**Code combinations › Sync**, page by page; later **Sync new** only reads the new ones).
- **Saved while fetching.** Account-by-account reads save each batch as it comes (20 accounts per query by default); if a read stops, the next Sync goes on with the accounts still missing.
- **Menu on the left.** The pages are listed in a left menu grouped as Reports, Control & close and Setup; **Collapse** shrinks it to icons (hover for the name) and the choice is remembered on this PC.

## Segment P&L (P&L, pivot and trial balance by extended segments)

The **Segment P&L** tab works on the extended segments synced in Data › Trial balance sync (view `fin_gl_ext_v`).
Segments are named from the chart of accounts (fin_coa_segments, else the saved Fusion discovery), e.g. *Salesperson* rather than SEGMENT10.

- **Left panel**: ledger · periods (tick several; *Last*, *Quarter*, *YTD*, *12 m*, *All*, or a year) · **Group by** — add
  segments in order (e.g. *Salesperson*, then *Item profit centre* under it; company and account are always in the data),
  move them up / down, filter each segment to some values (search, tick) · companies · the statement template · the lines
  the tree shows.
- **Tree**: one row per value of the first segment, ▸ opens the next segment under it; the columns are P&L lines
  (revenue, cost of sales, gross profit, operating expenses, EBITDA, net profit … — *choose the lines*). Every row is the
  real statement template computed on that row's accounts, so subtotals, margins and formulas are right; ⋯ shows the whole
  statement for that row. Rows with no P&L at all (balance-sheet only) are left out.
- **By columns**: the whole statement with one column per value of the first segment (biggest 12, others, total).
  Press ▸ on a line (or *Open all lines*) to see its accounts with their amount in every column; click an account amount for
  the balance rows behind it (period × company × segments, debits / credits, filters and CSV).
  **Columns**: one per value of the first segment, or *one per period* (each chosen month side by side + Total).
  **Compare with**: *same period last year* or *previous period(s)* — every column then shows Actual, the comparison,
  Δ and Δ % (green when good for that line: income up, costs down; margins in points). Opened accounts and the
  drill-down work on the comparison too. Comparison months that are not synced with the extended segments are named,
  with a link to Trial balance sync.
- **KPIs** (first view): one page per group-by segment (e.g. Salesperson) for the chosen periods —
  - KPI cards: revenue, gross profit and margin, operating expenses (% of revenue), EBITDA and margin, net profit — each with
    its change when *Compare with* is set — plus active values, loss makers, top-5 share of revenue and the share of opex
    sitting on a blank / default value (e.g. D000).
  - **What stands out**: plain sentences found by rules — revenue concentration, costs not owned by anyone, loss makers,
    margin laggards (with the gross profit at stake), revenue without cost of sales (a posting gap), costs without revenue,
    the biggest EBITDA gain and drop, values lost since the comparison.
  - Charts: margin map (revenue × gross margin, red triangles = EBITDA negative), concentration curve, and what drove the
    change (or the top values) — *Rank and chart by* revenue, gross profit, EBITDA or net profit.
  - Ranking table with share, margins, change, a trend sparkline (3+ periods) and flags; click a row for its statement.
  - *Ask the Copilot* sends the table and asks for the five things to act on.
  - **Focus on** one value (type its code or name, or click its row in the ranking): its revenue, margins, opex and EBITDA
    against the average / median value and the comparison, what to look at (margin gap with the money at stake, missing
    cost of sales, loss, rank and rank change, the account that moved most), the P&L line by line next to the comparison
    and the average value, the accounts that moved most, and revenue / gross profit / EBITDA by period. The value is
    circled on the margin map. *AI deep dive* hands it to the AI Agent.
- **AI Agent**: one-click missions for the CFO (executive briefing, who to talk to this week, margin recovery plan, fair
  allocation of costs sitting on blank / default values, run-rate & outlook, board pack text, A / B / C scorecards, deep
  dive on one value) and for the CIO and controllers (data quality audit, unusual postings, reconciliation & coverage with
  the trial balance, what to automate), plus your own question. The agent gets the segment table and the findings and can
  read every balance on this PC (read-only); each answer is a card with the steps it took, tables / charts, its cost, Copy,
  Save .md, follow-up in the Copilot and Run again — kept on this PC.
- **Tree**: *Periods* added up — optionally *Compare with* the same period last year or the previous periods, so every
  line shows Actual, PY / Prev, Δ and Δ % — or *side by side* (one column per period under every line), with the change
  vs the previous or the first period and an optional Total column. Rows show only the value (the segment is the
  column header).
- **Pivot** with a column field (e.g. Period): *Variance* vs the previous or the first column as Δ, Δ % or both
  (green when profit goes up / a cost goes down), and a *Total column* you can switch on or off — for periods it is off
  by default, since adding months together says little when you compare them.
- **Amounts** (top bar): absolute, hundreds, thousands or millions, and 0–2 decimals (the same scale as the header).
- **Trial balance** names the periods it covers and shows *One row per period* (each period's opening, debits,
  credits and closing) or *Periods added up* (opening of the first, movements of all, closing), with a Period column.
- **Pivot**: rows = any fields in order (company, account, period, any segment) with subtotals and ▸ / open all / close
  all, columns = one field (default period), value = profit (income +, costs −), net movement, closing balance or one
  statement line (e.g. *Revenue* by salesperson × month).
- **Trial balance**: company × account × the group-by segments with opening (first period), debits, credits, closing,
  a balance check and a filter box under every column. This is where the trial balance with extended segments is shown.
- The chosen periods are added up (movement); closing = opening of the first period + movement. Excel exports the view
  on screen.

A **yellow banner** under the tabs shows every sync while it runs (trial balance, extended segments, master data,
working capital, item master …) with the last step and the time; it turns green when done or red with the error.

## Extended segments (cost centre, analysis, salesperson, profit centre …)

The trial balance sync reads balances by company × account (× cost centre) — small and fast. To report by more segments,
pick them in Data › Trial balance sync › Settings › **Extended segments** (chips for every segment of the chart of
accounts; company and account are always included), press *Save choice*, then **Sync extended** — or tick *sync them after
every trial balance sync*.

- One query per period × company: GL_BALANCES joined to GL_CODE_COMBINATIONS, grouped by company × account × the chosen
  segments, zero and summary rows skipped. A period × company already read with these segments is not asked again
  (Overwrite reads again); choosing an extra segment later re-reads only what lacks it.
- Kept in its own table **fin_gl_balances_ext** (columns segment1 … segment30, only the chosen ones filled) with
  **fin_gl_balances_ext_sync** (what was read, with which segments, when). Query **fin_gl_ext_v** in the SQL explorer:
  period_seq, company, account, segmentN, opening, dr, cr, closing (translated 'R' rows left out). It totals exactly to
  the trial balance per account.
- The period tiles show **ext ✓** (every company has them) or **ext ◐**; the master data checklist has an
  *Extended segments* row (Sync n period(s) / Choose segments) and a values & names row per chosen segment.
- The CFO Copilot knows fin_gl_ext_v, so you can ask "expenses by salesperson last quarter".

## Chart of accounts — which segments are synced

Data › Chart of accounts marks every segment card: a solid green tick when its values (codes, names, account types) are
on this PC, an outlined tick when they are only in APEX, a grey circle when they have not been read. The card shows the
number of values, how many are used in account combinations, the share with a name and the read date (hover for where
they are kept). Above the cards a pill says how many segments are synced, and AI admins get **Read the n missing from
Fusion**, which reads the remaining segments one after the other and saves each in APEX.

## Working capital (debtors, creditors, inventory)

The **Working capital** tab shows what the CFO needs beside the statements: who owes us, whom we owe and what sits in
the warehouse — straight from the Fusion subledgers, read-only.

- **Sync from Fusion** (AI admins, audited `fin_wc_sync`) runs one query per kind through the Fusion SQL runner of the
  logged-in pod (or PROD / TEST from Settings) and keeps a dated snapshot in DuckDB, so a trend builds up sync by sync:
  - **Debtors** — `AR_PAYMENT_SCHEDULES_ALL` open items (status OP) by business unit × customer × currency × age bucket,
    in ledger currency (`ACCTD_AMOUNT_DUE_REMAINING`) → `fin_wc_parties` kind `AR`.
  - **Creditors** — `AP_PAYMENT_SCHEDULES_ALL` × `AP_INVOICES_ALL` (not cancelled), remaining × exchange rate, items on
    hold counted → kind `AP`.
  - **Inventory** — `INV_ONHAND_QUANTITIES_DETAIL` × `EGP_SYSTEM_ITEMS_B` by organisation × item × subinventory, aged from
    the oldest receipt → `fin_wc_stock`. Unit costs differ per pod: Settings › *Find cost tables in Fusion* lists the
    `CST%` tables with an item id and a cost column (ALL_TAB_COLUMNS) and you pick one; without it the card shows the
    quantities and takes the value from the GL inventory line.
  - Every sync also writes `fin_wc_snapshots` (rows, total, time, capped). The last 36 snapshots per kind are kept and
    carried over by full GL loads.
- **Cards**: total, overdue, over 90 days, DSO / DPO / DIO from the KPIs, open items / on hold, the GL control balance
  (balance-sheet lines AR / AP / INV at the period in the header) with the difference, and a sparkline of the snapshots.
  The cash conversion cycle sits under them. Ages are as of the snapshot time, the GL at the period end — a difference
  can be timing.
- **Debtors / Creditors**: an ageing bar (buckets from Settings, default 30 / 60 / 90 / 180 days past due), customers or
  suppliers biggest first with each bucket, overdue %, oldest due date; click one for its open items, read live from
  Fusion (≤ 500, CSV). Filter by business unit, search by name or number.
- **Inventory**: stock age (0-90 / 91-180 / 181-365 / over a year) by value or quantity, by organisation, items by value
  with the oldest receipt; click an item for its on-hand lines (lots, subinventories, receipt dates).
- **Filter bar on top**: *Business unit* (debtors and creditors — cards, ageing and list) and *Inventory organisation*
  (inventory), shown with their names (FUN_ALL_BUSINESS_UNITS_V / INV_ORGANIZATION_DEFINITIONS_V, else HR organisation
  units; read with every sync and by *Read names* — no re-sync needed — kept in fin_wc_names). *Read names* tries
  FUN_ALL_BUSINESS_UNITS_V, HR_OPERATING_UNITS, HR_ALL_ORGANIZATION_UNITS_F_VL and HR_ORGANIZATION_UNITS_F_TL for the ids
  still unnamed and shows what each returned (a view secured for the report user returns no rows); **Names** lets an AI
  admin type or fix the names (`finWcNamesSave`), kept on this PC like the ones from Fusion. With a filter on, the GL comparison is hidden
  (the GL control is for every business unit).
- **Every grid filters by column**: a box under each header — text = contains, `=x` exact, `!x` not, numbers `>100`,
  `<=5`, `10..20`; click a header to sort; CSV exports what is shown (`FL.grid` in fin-core.js, also in the open-items
  window).
- **Item master** (checklist › *Sync items*, `finWcItems`): EGP_SYSTEM_ITEMS_B of the stock organisations — item number,
  description, UOM, item type, status, list price and every flexfield column the pod has (ATTRIBUTE_CATEGORY,
  ATTRIBUTE1..30, ATTRIBUTE_NUMBER1..10, ATTRIBUTE_DATE1..5) — one organisation at a time in keyset pages, into
  **fin_items**; the stock is joined to it on this PC.
- **Item DFF** (`finWcItemDff`): the flexfield labels from FND_DF_SEGMENTS_VL (flexfields used on EGP_SYSTEM_ITEMS_B) →
  fin_item_dff. *Profile & name* shows each column's fill rate, distinct values and most used values; give the columns
  your own names (e.g. *Inventory category*) and pick the default grouping. Inventory › *Stock by* groups the stock by
  organisation, subinventory, item type, status or any named flexfield column; clicking a group filters the items.
- **Valuation**: item cost from the cost table you pick (Settings › *Find cost tables* — perpetual average / item / standard
  cost tables first; tables keyed by COST_ORG_ID are joined through the inventory-org → cost-org table, e.g.
  CST_COST_INV_ORGS), else quantity × the item list price (can be switched off), else the GL balance. The card and the item
  grid show the basis per line.
- **Working capital checklist** (bottom of the tab, chip on top): debtors, creditors, stock, names, item master, item DFF,
  valuation — each with its action, and *Sync all missing* (runs every missing one in turn). Item master: *Sync n missing
  organisation(s)* reads only the stock organisations that have no items yet; a slow organisation is asked again with
  smaller pages, then without the description lookup, and one that still fails is skipped and listed — the others are
  saved. Item DFF: *Sync labels from Fusion*. Valuation: *Find cost table & sync* picks the most likely cost table
  (perpetual average first, mapped to the inventory organisations) and syncs the stock with it; with a cost table set
  it offers *Sync stock with costs*.
- **Excel** exports the customers, suppliers and on-hand lines of the latest snapshots.
- Settings: pod, buckets, business units / inventory orgs (ids), cost source and the three queries (placeholders
  `{BUCKET:due date column}`, `{AS_OF}`, `{ORG_FILTER:column}`, `{UNIT_COST}`; the column names must stay) — kept in
  `config.json` `wc`.
- The CFO Copilot gets the latest totals, buckets and biggest parties in its context and can query `fin_wc_*` itself.

Host: `classes/FinanceWc.cs` (`FinanceWorkingCapital`: default queries, `Fill`, `SyncAsync`, `DetailAsync`,
`CostTablesAsync`), IPC `finWcSync`, `finWcDetail`, `finWcDefaults`, `finWcCostTables`; page `finance/fin-wc.js`.

## Close & reconcile (finance skills)

The **Close & reconcile** tab runs finance workflows ("skills") through the CFO Copilot on your synced ledger — one click,
for the period and entity in the header:

| Task | What you get |
|---|---|
| Month-end close package | close checks (TB balances, BS balances, suspense nil, no missing months, late journals), accrual schedule, roll-forwards of cash / receivables / inventory / payables / accruals / borrowings, variance commentary, open points |
| Variance commentary | every line over materiality vs previous month, last year and budget, with the *driver* (why, not what) from accounts, cost centres and journals — or "driver unclear — flag for controller" |
| Accrual schedule | one row per accrual on your policy list (or proposed candidates from recurring costs), basis, already booked, this-period accrual, support, **draft** journals |
| Roll-forward | opening + movements by journal source ± reclasses ± revaluation = closing, foot check, biggest journals |
| GL ↔ subledger reconciliation | trade payables / receivables (inventory optional) in the GL against the open balances in Oracle Fusion's subledgers, breaks classified (timing, unposted, manual GL journal, mapping, FX), material breaks traced; the Fusion side runs read-only and only for AI admins |

Nothing is ever posted: journals are drafts for the controller. **Save as close package** keeps the result in
`close.json` with a sign-off trail **Draft → Prepared → Reviewed → Approved** (the preparer cannot review or approve;
*Send back to draft* needs a note); **Excel** writes a Package sheet plus one sheet per table and the sign-off trail;
**Continue in Copilot** asks follow-ups. The **close policy** (config.json `close`: materiality % and floor, lines to
always comment on, the accrual policy list, reconciliation tolerance) is what the skills read.

The shipped skills (`finance/skills/*.md`) are adapted from **Anthropic's Claude for Financial Services** plugins
(github.com/anthropics/financial-services-plugins, Apache-2.0 — `finance/skills/NOTICE.md` lists the changes): the
month-end closer's accrual-schedule, roll-forward and variance-commentary and the GL reconciler's gl-recon and
break-trace, rewritten for a Fusion general ledger. The **Skills library** shows each skill; an AI admin can add a
custom skill or *make my own version* of a shipped one (saved in the data folder `skills\`, same name wins, audited).
The Copilot also picks a skill by itself when a question asks for such a task ("run the month-end close …").

## KPIs

KPI formulas refer to template rows with a window: `PL.NP@YTD`, `BS.AR@BAL`, `CF.OPC@LTM`; windows `MTD QTD YTD LTM BAL
OPEN PM PMBAL PY PYYTD PYLTM PYBAL PYE BUD BUDYTD BUDFY FY`; and to earlier KPIs by id (`dso + dio - dpo`). The 37
starters cover profitability, cost control, budget, liquidity, efficiency (DSO / DIO / DPO / cash conversion cycle),
returns & leverage (ROE, ROCE, net debt / EBITDA, interest cover), cash flow and control (suspense, balance check).

## Your own data: Oracle Fusion — the Data workspace

Data has seven views (side menu): **Sync status**, **Chart of accounts**, **Fusion setup**, **BICC bulk extracts**,
**Account mapping**, **SQL explorer**, **Data & folder**. Everything reads Fusion read-only; the Fusion password stays in the app.

### Fusion setup (once)
*Discover* reads the data dictionary first (`ALL_TAB_COLUMNS`, so every query only names columns your pod has), then the
**ledgers** (`GL_LEDGERS`, companies = balancing values + legal entities, open periods), the **segments** of each chart of
accounts with their qualifiers, the **balancing segment** (`BAL_SEG_COLUMN_NAME` / qualifier), the **natural account segment**
(qualifier, else *measured*: the segment whose values each carry one `ACCOUNT_TYPE` in `GL_CODE_COMBINATIONS`), the **cost
centre** segment, account types, the calendar and the budgets. Tick the primary ledgers (secondary / reporting ledgers repeat
the same companies — this is the default choice for loading), check the segment roles and *Save setup*. Loading itself is done
in **Sync status**.

Read options: *Rows per chunk* (default 2,000 — every read is ranked with `ROW_NUMBER()` and the next chunk starts after the
last key; a chunk that times out is read again at half the size), *Reads in parallel* (default 2) and **Split each period**
— *by GL account ranges* (the sorted natural account values cut into ranges of *n* values, with no gap) or *by company* — so
no single query is big enough to time out. *Show the SQL in the log* adds each step's SQL to the detailed log.

### Sync status — load, watch and check
**Load from Fusion** (a fold-out card): tick the ledgers to load (each shows its currency, companies and segments), the months,
budget, journal months and the read options below, then *Load into Finance Lens* (or, once data is loaded, *Sync these months*
— keeps the other months — or *Full reload*).

The **live monitor** above it shows any Fusion run (load, period sync, check, discovery, segment values, live trial balance):
*Running now* — every query in flight with its full SQL and how long it has been running (copy button); *Finished queries* —
the last 60 with rows and seconds (click for the SQL); *Sample rows* — the first rows of every step exactly as Fusion returned
them; *Log* — the detailed log (save / copy). Leaving the page and coming back shows the run again.

A grid of ledger × month, one square for balances and one for journals. **Check Fusion now** runs one small aggregate per
ledger and year — rows, debits, credits and last update of every month in `GL_BALANCES` and of the posted journal headers —
and compares it with what this PC holds:

| Square | Meaning |
|---|---|
| green — In sync | the Fusion fingerprint is the one recorded when the month was read, and debits / credits tie to the cent |
| amber — Changed in Fusion | something was posted or changed since — sync it again |
| blue — New in Fusion | Fusion has balances for the month, this PC has none (a new period) |
| red — Does not tie | the totals here differ from Fusion |
| grey / dashed | nothing in Fusion / journals not loaded |

**Sync changed & new months** reloads only those months, **Sync open periods** the periods that are open in Fusion, **Sync one
period…** any month; click a square for the numbers (Fusion vs this PC, rows read, time, split) and to sync just that month
(balances, journals or both) or open its trial balance. After a sync the check runs again. Each month's record is kept in
`fin_sync_periods` (rows read, debits, credits, Fusion fingerprint, time, split).

### Chart of accounts
Every chart with its segments as a strip (company / cost centre / natural account / intercompany marked, values, "one type per
value", qualifiers, why each role was chosen). Click a segment for **all its values**: description (value set), how many
account combinations use it, account type, and for the natural account its class in the mapping. *Read from Fusion* (ranked
chunks) saves them in DuckDB (`fin_segment_values`) and APEX (`WMS_FIN_SEGMENT_VALUES`); later they open from there.
Before any finance data is loaded there is no DuckDB file yet: the values are then kept on this PC
(`segment-values\{chart}_{segment}.json` in the finance folder) and the first load (SQL or BICC) adds them to DuckDB.
Discovery measures every segment in one query; on a big chart that times out, so it then measures one segment at a time.

### BICC bulk extracts — every balance and journal at once
For large ledgers: BI Cloud Connector extracts the GL view objects (`…GlBiccExtractAM.BalanceExtractPVO`,
`CodeCombinationExtractPVO`, `JournalHeaderExtractPVO`, `JournalLineExtractPVO`, `JournalBatchExtractPVO`) to UCM or OCI.
*Download from UCM* lists them in the pod's UCM (`/cs/idcplg` search, the app's Fusion user) and downloads the new ones; or
copy them into the folder yourself. *Look at the files* shows what each PVO has and which column feeds which attribute (found by
the attribute name a column ends with; pick it when one is missing). *Load from the BICC files* reads every file with DuckDB
in one pass (zips unpacked once), keeps the newest version of every row (full + incremental extracts can sit together), and
builds the same tables as the SQL load — millions of rows in seconds, no month-by-month queries. Plan: a full extract once,
then daily incremental extracts, then *Load* (it rebuilds from all files, so nothing is missed).

### Where everything is kept
- **APEX** (shared by every PC; `apex_sql/85_finance_lens_fusion.sql`, created by the page): `WMS_FIN_DISCOVERY` (the whole
  discovery), `WMS_FIN_COA_SEGMENTS` (segments + roles + why), `WMS_FIN_LEDGERS`, `WMS_FIN_ACCOUNT_MAP` (class per account —
  your choices win on every PC and every load), `WMS_FIN_SEGMENT_VALUES`, `WMS_FIN_TB_LIVE` (saved live trial balances).
- **DuckDB** (with the data): `fin_fusion_discovery`, `fin_coa_segments`, `fin_ledgers`, `fin_segment_values`, `fin_tb_live`,
  `fin_account_map` + `fin_accounts.class`, `fin_sync_periods`; plus `config.json` (setup), `fusion-sync.log`, `bicc\`.

### Account mapping
Every account with its class and the income statement / balance sheet line it lands in; filter *in no line* / *in two lines*,
change a class in place (saved on this PC, in DuckDB and in APEX; in Statement builder templates the account moves to the section of its new class), *Save all to APEX*, *Rebuild default statements*.

### Statements on any chart of accounts
After a Fusion load every account gets a class from its type and name and the statements are built on those classes with the
same line ids as the starters, so KPIs, monitors, analytics and the board pack work at once. Click a line *name* in Statements
for the accounts mapped to it.

### Trial balance sync (Data › Trial balance sync)
The quickest way to statements: **Data › Trial balance sync** (the Data tab's first view). Pick the pod and the ledger, then a
**year**: each year chip shows how many of its periods are synced (e.g. *2025 · 9/12*) and the board shows one tile per period —
✓ synced (every company), ◐ some companies, ✗ not synced, and while a sync runs ⏳ waiting, ⟳ syncing (company k of n) or ⚠ failed
(with the reason). Tick tiles (*Select not synced* does it for you) and press **Sync** (reads only what is missing), **Overwrite**
(reads the ticked periods again and replaces what this PC holds — after postings in Fusion) or **Delete** (removes them from this
PC). One status line shows progress; *Details* unfolds the full monitor (every query, its SQL, sample rows, the log) and
*Settings* the companies, *by cost centre*, folding, reads in parallel and the query. The same board sits on top of
**Data › SQL explorer** (sync or overwrite a period from there; samples *TB sync status* and *TB by period*). Each period —
with the adjustment periods it closes — is read grouped by company × account in Fusion (the query below, one query per company
and period, *Reads in parallel* at a time, only what this PC is missing unless *read again from Fusion*) and kept in DuckDB.
After every sync the statements data is rebuilt from **all synced periods** (fin_balances, periods, companies, accounts with
their type, cost centres, ledgers — source *synced trial balances*): **Statements** starts with the **Trial balance** (debits =
credits check, Excel / CSV / *Save to APEX*), the income statement, balance sheet and cash flow, Analytics and KPIs all work on
the synced periods, and the header's period list shows exactly those periods. The grid *Synced on this PC* shows ledger ×
period (✓ every company, n/m some, cc by cost centre); select cells to *Sync again* or *Remove* them. A full SQL / BICC load
(Data › Full GL load) wins over synced trial balances; they are kept beside it. Year to date figures need every period of the
year synced (use *Year to date*). Account names come from the segment values on this PC (Data › Chart of accounts).

Seeing what happened: the monitor's *Finished queries* also lists what was **not** asked from Fusion ("already on this PC",
with the SQL that would run) — tick *read again from Fusion* to ask. Every query there has **Run** (asks Fusion now: rows, time,
first rows), and the query box has **Test query** (the To period, the first company). A company written into the query
(`AND c.SEGMENT1 = '01'`) or a missing `{COMPANY_FILTER}` is flagged with *Fix the query* — with one query per company the app
puts each company there itself (and keeps only that company's rows if the query has none). **Account names & types** come from the
segment values. The **Master data checklist** under the board (and in the SQL explorer) lists everything the statements need — ledgers & calendar,
segment roles, company / account (with account type) / cost centre values and names, account classes, synced periods — each ✓ / ◐ / ✗ with its
numbers and a button (*Sync* from Fusion, *From APEX*, Fusion setup, Account mapping), plus *Sync all missing*. After every trial balance
sync the values this PC does not have yet are read automatically (APEX first, else Fusion) and the statements are rebuilt with the names. The trial balance has Ledger / Year / Period
selects, and closing balances that do not net to nil show which ledger × company is off.

The query, its options and the reading below are the same as for one period:
pod, ledger, period, companies (all or some), optional cost centre, *Fetch from Fusion*. One read of `GL_BALANCES` (ledger
currency, actuals, no translated / summary rows) joined only to `GL_CODE_COMBINATIONS`, grouped by company × account
(× cost centre).

**Group in Fusion** (switch above the fetch button):

- **Company × account** (default): one query per period: GL_BALANCES joined to GL_CODE_COMBINATIONS, `SUM()` of the balance
  columns grouped by the company and account segments (× cost centre when ticked), summary combinations left out
  (`c.summary_flag = 'N'`), translated_flag kept as a key so the 'R' part is dropped on the PC. A few thousand rows a period, read in
  one go (no paging); kept in DuckDB `fin_gl_balances_acct` (+ `fin_gl_balances_acct_sync`, one row per period × company read, `*` =
  every company). Placeholders `{COMPANY_SEGMENT}` `{ACCOUNT_SEGMENT}` `{COST_CENTRE_SEGMENT}` `{COMPANY_FILTER}` (ticked companies →
  `AND c.SEGMENTn IN (…)`). A read that times out for every company is asked again **company by company** (Reads in parallel at a time).
- **Code combination**: GL_BALANCES alone, one row per code combination, read in pages (below); segments from the map on this PC.
  A period with more than 1,000,000 rows stops after the row count and shows what they are (detail / summary template, translated,
  zero / non-zero) with *Add these filters & run* (`template_id IS NULL AND NOT (zero balance and no movement)` — same trial balance).

Options under the query (they change the default query; kept per PC): **skip zero & summary rows** (on — `b.template_id IS NULL
AND (begin dr <> begin cr OR period net dr <> 0 OR period net cr <> 0)`, applied while GL_BALANCES is scanned, before the join
and the grouping — those rows add nothing to a trial balance), **all balance columns** (off — only BEGIN_BALANCE_DR / _CR and
PERIOD_NET_DR / _CR are summed), **one query per company** (on — company × account: `AND c.SEGMENTn = '01'`, one query per company and period, *Reads in parallel* at a time; companies already kept on this PC are not read again; the result is a few thousand rows, read in one go — no ROW_NUMBER paging, which would repeat the join and grouping for every page), **optimizer hint** (on — `/*+ LEADING(b) USE_HASH(c) PARALLEL(4) */`). The account type is not
read from Fusion (it would need MAX() per account): it comes from this PC (`FinanceLens.AccountTypes` — fin_ccid, fin_accounts).

The query box warns about fixed values (`ledger_id = 300000003236002`, `period_name = 'Oct-26'` … → *Use placeholders & run*) and
about an own ROWNUM / ROW_NUMBER.

In *Code combination* mode the **GL_BALANCES balances** of each period it needs (the period, its adjustment
period, the start of the quarter and of the year) are read **once**, one query per period filtered only on ledger, period, currency and actual flag (no join, no
expression filters). The default query keeps only what a balance needs — one row per combination:

```sql
SELECT b.ledger_id, b.period_name, b.period_year, b.currency_code, b.actual_flag, b.code_combination_id, b.translated_flag,
       SUM(b.begin_balance_dr) begin_balance_dr, SUM(b.begin_balance_cr) begin_balance_cr,
       SUM(b.period_net_dr) period_net_dr, SUM(b.period_net_cr) period_net_cr, ... -- every _DR / _CR / _ADB (_BEQ) column
FROM gl_balances b
WHERE b.ledger_id = {LEDGER_ID} AND b.period_name = '{PERIOD}' AND b.currency_code = '{CURRENCY}' AND b.actual_flag = 'A'
GROUP BY b.ledger_id, b.period_name, b.period_year, b.currency_code, b.actual_flag, b.code_combination_id, b.translated_flag
```

(code_combination_id maps a row to company / account; translated_flag stays a key so the 'R' part is never added to the
total). The rows are kept on this PC (DuckDB `fin_gl_balances`, the columns the query returns with Fusion's names — do not add ROWNUM: the app pages the query itself, and a query pasted with real values gets its placeholders back on Run — listed under *GL
balances kept on this PC*); after that the trial balance is built from this
copy in a fraction of a second. Tick *read again from Fusion* after postings. Every period is read **page by page**: its rows are counted
first (the monitor shows *page i of N*), then *Rows per fetch* rows at a time in code_combination_id order, each page after the
last id read (a page never ends inside one combination; a page that times out is asked again at half the size). **GL_BALANCES query** (fold-out under the fetch button): change
the query — `{LEDGER_ID}`, `{PERIOD}`, `{CURRENCY}` are filled in for each period; it must return CODE_COMBINATION_ID,
BEGIN_BALANCE_DR / _CR and PERIOD_NET_DR / _CR — and *Run with this query*; *Default query* goes back. The segments of each combination come from a map on this PC (`ccid-cache`, also
`fin_ccid`), looked up in Fusion by primary key only for new combinations. All shown in the live monitor: **opening, PTD debits / credits / net, QTD, YTD, closing** (QTD / YTD
= closing − the balance at the start of the quarter / fiscal year; adjustment periods folded into the period they close).
Names are not read from the value sets (keeps the Fusion query small): they come from this PC (DuckDB accounts or segment
values), else APEX; if there are none yet, *Read the account names from Fusion* reads the account segment once and keeps it.
*Save to DuckDB* (`fin_tb_live`, kept across loads; before the first load the file holds only these and still reads as "no
data loaded") and *Save to APEX* (`WMS_FIN_TB_LIVE`, shared); *Saved trial balances* reopen without Fusion. When that ledger
and period are loaded, each line is compared with this PC (*On this PC*, *Difference*). Excel / CSV; click a line for the
account across companies.

### Trial balance — loaded data
Statements › Trial balance › **This PC**: every account with opening balance, debits, credits, net movement and closing balance as debit
/ credit — for the month, quarter to date, year to date or last 12 months; every account, by class or by type; split by company,
cost centre or ledger; actual or budget. The header shows *debits = credits* and *closing balances net to nil*; click a line to
drill; Excel (with SUM formulas and the check) and CSV.

## CFO Copilot

Header › **Ask**: ask in plain words — "why is net profit behind budget this month?", "which cost centres are over budget
and on which accounts?", "explain the cash movement", "give me three lines for the board". Claude answers with read-only
tools over the same DuckDB file (one SELECT at a time, no file or network access), the statement mapping and the chart of
accounts; the page sends what is on screen (filter, statement lines, KPIs, monitor alerts) so the answer matches the
numbers shown. Answers carry a chart when it helps and links that drill: accounts, journals, cost centres, periods, and
follow-up questions. Every line in the drill dialog has *Ask the Copilot*. It uses the Claude key of Fusion SQL › Ask AI,
stops when the AI is paused (AI Digital Employee › Control) and every answer is audited with its cost.

## My pages (pages you design)

*My pages* (first under Reports) holds your own pages. Start from the **CFO cockpit**, a blank page, or **describe it to the
Copilot**. A page has its own periods (tick months, or Last / Quarter / YTD / 12 m), *Compare with* and company, and a grid
of widgets: KPI cards (with the change against the comparison), bar / line / donut charts, tables and notes. Each widget is
one read-only query over the ledger on this PC, so a saved page shows fresh numbers every time you open it.

- **Edit page**: add a widget (title, type, width, number format, its query — *Test* runs it), make it narrower / wider,
  move it up / down, remove it. Press **Save** to keep the page; *⋯* duplicates, exports or imports a page.
- **Design with the Copilot**: type what you want in the bar under the page — "add a chart of gross profit by salesperson",
  "make the KPIs year-to-date", "a page for the monthly board meeting". The Copilot checks every query on your data and
  proposes the whole page; you see what is new or removed and press **Apply** (then Save) or Discard. A widget that fails
  offers *Ask the Copilot to fix it*. In the Copilot drawer, any page it proposes shows *Apply to this page*.

The Copilot drawer now keeps its working steps folded (the line shows what it is doing) and lists **suggested prompts for
the page you are on** — a click puts the prompt in the box so you can change it; nothing is sent until you press Enter.



## Debtors, Creditors and Inventory pages

Three pages under Reports, each built on the working-capital snapshots (Sync from the page or from Working capital). Data stays on this PC in `finance.duckdb`; the loss / provision rates are in `config.json`.

- **Compare with** — the previous snapshot by default, or the first / any earlier one. Tiles show the change, a bridge shows what was new, grew, shrank or cleared, and the ageing chart shows the last 12 snapshots. Sync regularly (e.g. weekly) so the comparison means something.
- **Debtors** — collection worklist (overdue weighted by age, with the next step per customer), expected credit loss with an editable IFRS 9 provision matrix, concentration (Pareto), business units, every customer with its change.
- **Creditors** — payment run planner: type the cash available and choose who to pay first (oldest debt, largest, smallest to clear the most suppliers, or pro rata); on-hold suppliers can be skipped. It only plans — nothing is sent to Fusion. Suppliers to act on lists holds, items over 90 days and debit balances.
- **Inventory** — ABC × age, items that did not move since the comparison, slow-moving provision by age band (editable rates), stock to review, organisations and the stock explorer.
- Every page has rule-based findings, Excel export and Copilot prompts for that page; the Copilot gets the page's figures as context.


## Stopping a sync, and one period after another

- The yellow banner at the top has a **Stop** button while a Fusion sync runs, and the running row of Trial balance sync shows **Stop** too. What was read before you stopped stays on this PC; Sync again carries on from there.
- **One period after another** (Trial balance sync › Settings, on by default): when several periods are ticked, each period is synced and saved completely before the next starts; the others show *waiting in line*. Stop ends the current period and the rest are not started.
- Extended segments read account by account start with *accounts per query* (default 20). When a batch fails or times out it is read again in halves, and the smaller size is kept for the next accounts instead of trying 20 again each time; after 3 good reads it doubles back. The row shows e.g. *accounts 41–45 of 156 · 5 per query*.


## Full screen and the AI Agent page

- Every chart, grid and table card has a ⤢ button in its top-right corner: it opens that card full screen (the chart grows to the window, the grid shows as many rows as fit). ✕ or Esc closes it.
- **AI Agent** is its own page in the left menu (under Segment P&L). It uses the same left panel (ledger, periods, group by, filters) as Segment P&L; *AI deep dive* on a value in Segment P&L › KPIs opens it and runs the deep dive.


## Grouping segment values (Segment P&L)

- **Group by › ⧉** (or *Group the values of a segment…*): make groups of a segment's values — e.g. Salesperson → *Door to door*, *Pre-sales*, *Shops*. Add groups, then tick values (header box = every row shown, Shift+click = a range; the list starts on *Not grouped* so moved values drop out) and press a group in the bar that appears — or drag them onto a group chip, or press the group's number 1–9. Search matches value, name or group. *Paste a list…* puts pasted codes or names (e.g. an Excel column) into a group at once; *Suggest* fills groups from the first word of the value name or a code prefix. Save keeps it in `config.json` on this PC.
- The grouping then appears under **Group by** (with the segment under it): the Tree shows the groups and opens each into its values; **By columns** shows one column per group — ▸ opens a group into one column per value with the group as the subtotal, *Open every group* opens them all. Pivot and KPIs can use the grouping too. Values in no group show as *(not grouped)*.
- **By columns › Show**: top 8 / 12 / 20 / 50 or every value; *Others (n) ⊕* shows every value.


## Customer and supplier history (drill-down)

Click any customer on Debtors (or supplier on Creditors, or a party in Working capital) to open its history page:

- **Header** — name, number, class / status, address, e-mail, phone, customer since; tiles for total due, overdue, over 90 days, credit limit used (customers) or open holds (suppliers), invoiced and collected in the last 12 months, days to pay (weighted by amount, and days late against the due date) and the last receipt / payment.
- **Tabs** — Overview (invoiced vs collected by month, open items by age, findings, days to pay by month), Open items (with *Live from Fusion*), Invoices, Payments, Credit notes, Paid invoices (each payment against the invoice it paid, with days to pay), Adjustments (customers) / Holds (suppliers), Sources (the query behind each tab).
- **Where the data comes from** — the first time a customer is opened its history is read from Fusion and **kept in DuckDB on this PC** (`fin_wc_history`). Opening it again reads this PC — the header says *From this PC · read from Fusion … ago*. **Refresh from Fusion** reads it again; changing the history window (12 / 24 / 36 / 60 months) does too.
- The Debtors / Creditors / Inventory pages themselves always read the synced snapshots on this PC; only **Sync** asks Fusion. The page header says how long ago the last sync was.


## Customer rating and grid totals

- **Rating** (customers): a grade A–E with a score out of 100, in the header of the customer page and as a card in Overview. Six factors, each shown with its score and what it is based on (hover for how it is scored): paying on time (30 %), overdue now (20 %), collected vs invoiced in 12 months (15 %), credit notes and write-offs vs invoiced (15 %), the trend of days to pay against the year before (10 %) and credit limit use (10 %). Each grade comes with a suggested action — from *a higher limit can be considered* (A) to *stop further credit* (E). The grade is remembered on this PC and shown in the *Rating* column of the Debtors lists.
- **Payments** include receipts from another account (e.g. a head office paying for its branches) that were applied to this customer's invoices — see *Applied here* and *Paid by*. *Collected* counts the cash applied to the customer's invoices.
- **Totals**: every grid in Finance Lens has a totals row at the bottom for its value columns — over every row the filters keep, not only the rows shown. Days, percentages, rates and quantities in mixed units are not totalled.


## Segment P&L: periods without segments

The period list shows every month whose trial balance is synced. Months whose extended segments (Salesperson, Item profit centre …) are not synced yet show **dashed** — click them to pick some (or none for all) and press **Sync segments**: Trial balance sync opens on that ledger and reads the segments for those months, one after another. Come back to Segment P&L and they can be chosen.

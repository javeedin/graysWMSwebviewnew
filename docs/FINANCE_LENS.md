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

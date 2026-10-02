# Finance Lens — guide

Finance Lens turns general-ledger **journal balances** (company × cost centre × account × period, actual and budget) into
formatted financial statements, KPIs, monitoring, analytics, journal-risk tests, close checks and a one-click board pack.
The data sits in one DuckDB file on the PC (`C:\fusion\finance\finance.duckdb`), so every screen answers in well under a
second even with millions of rows.

## Start with the sample

Home › **Finance Lens** › *Load the sample data* (AI admins). It builds two companies (Grays Mauritius Ltd, Grays
Distribution Ltd), six cost centres and ~50 accounts with 24 months of balanced journals (≈ 13,600 lines) and a
budget. A few things are planted for you to find:

| What | Where it shows |
|---|---|
| Freight spike in August of year 2 | Overview › What happened, Analytics › Anomalies, the variance bridge |
| One-off advisory fee in March of year 2 | Anomalies, Administration over budget (cost-centre heat map) |
| Customer insolvency write-off in November of year 1 | Anomalies (Nov), bad debt line |
| Household sales slowing in the second half of year 2 | Month vs budget commentary, movers |
| Intercompany fee booked short (550 K instead of 600 K) | Close checks › intercompany income = expense |
| Unreconciled bank difference parked in suspense | Close checks, monitors (critical), journal risk |
| Round-amount accruals posted at the weekend by one user | Journal risk › riskiest journals |
| A supplier invoice entered twice | Journal risk › possible duplicates |

## The screens

- **Overview** — headline KPIs with 12-month sparklines and monitor status, plain-language commentary (month vs budget,
  YTD vs last year, unusual accounts, monitor alerts), revenue and profit, margins, the net-profit bridge, cash and
  working capital, opex mix, biggest movements.
- **Statements** — any template for the period and filter (company, cost centre, units / thousands / millions); hide
  empty lines, account detail; Excel (formatted, one sheet per statement), CSV, print. **Click any amount** to drill:
  the accounts behind it → companies, cost centres and months → journal lines → the whole journal.
- **Analytics** — trends with a seasonal forecast (Holt-Winters with 24+ months), variance bridges (YTD vs budget,
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
- **Template designer** — see below.
- **Data** — what is loaded, the folder, a read-only SQL explorer and the chart of accounts.
- **Board pack** (header button) — title, sections, statements and an editable commentary → a print-ready pack
  (cover, executive summary with KPI tiles and attention points, KPI table, charts, statements, cost centres,
  monitors, risk highlights). Print / save as PDF, or save the HTML.

## Templates

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

## Your own data: Oracle Fusion

Data › **Oracle Fusion general ledger** (AI admins). Everything runs read-only through the Fusion SQL runner (BI Publisher),
for the logged-in pod or PROD / TEST; the Fusion password stays in the app.

1. **Discover** — reads the data dictionary first (`ALL_TAB_COLUMNS`), so every later query only names columns that exist
   on your pod, then finds:
   - **Ledgers** (`GL_LEDGERS`: currency, chart of accounts, calendar, primary / secondary) with their **companies** —
     the balancing values and their legal entities (`GL_LEDGER_NORM_SEG_VALS` + `XLE_ENTITY_PROFILES`) — and open periods.
     Dashboards by company need the ledger of each company: tick the primary ledgers (secondary and reporting ledgers
     repeat the same companies).
   - The **segments** of each chart of accounts and their qualifiers (`FND_ID_FLEX_SEGMENTS` + `FND_SEGMENT_ATTRIBUTE_VALUES`,
     or the Fusion key-flexfield tables `FND_KF_*`).
   - The **balancing segment** (`GL_LEDGERS.BAL_SEG_COLUMN_NAME`, else the balancing qualifier, else its name), the
     **natural account segment** (the account qualifier, else *measured*: the segment whose values each carry exactly one
     `ACCOUNT_TYPE` in `GL_CODE_COMBINATIONS` — shown as "one type per value"), the **cost centre segment** (cost centre
     qualifier or its name) and the intercompany segment. Every choice says why; change a role if Fusion is set up differently.
   - The **account type** of every account (the most common `ACCOUNT_TYPE` of its combinations), the calendar (`GL_PERIODS`,
     adjustment periods marked) and the **budgets** (`GL_BUDGET_BALANCES` names, or `GL_BALANCES` budget versions).
2. **Load** — per ledger and period, `GL_BALANCES` × `GL_CODE_COMBINATIONS` summed to company × cost centre × account (ledger
   currency, no entered-currency / translated rows, no summary accounts, no templates), **adjustment periods folded** into the
   period they close (Adj-25 → Dec-25), the chosen budget (as running balances, income statement restarting each year) and the
   **posted journal lines** of the last N months (`GL_JE_HEADERS` / `_LINES` / `_BATCHES`, paged by journal id). Big periods
   are split by company, then by account, when the runner's row cap is reached. The new file is swapped in when it is complete.
3. **Sync again** — one click reloads only the last *n* periods (incremental: the file is copied and those periods replaced);
   it runs a full load when the ledgers or segments changed.

Names: account, company and cost centre descriptions come from the value sets (`FND_FLEX_VALUES_VL` or `FND_VS_VALUES_B/_TL`);
companies take the legal entity name when Fusion has one.

**Statements on any chart of accounts.** After a Fusion load every account gets a **class** from its type and name (Cash,
Receivables, Inventory, Fixed assets, Accumulated depreciation, Payables, Borrowings, Revenue, Cost of sales, Staff costs,
Premises, Distribution, Selling, Depreciation & amortisation, Finance costs, Tax …) and the statements are built on those
classes with the same line ids as the starters, so all KPIs, monitors, analytics and the board pack work at once. The
classes are written to `fin_accounts.class`.

**Account mapping** (Data tab) lists every account with its class and the income statement / balance sheet line it lands
in; filter the accounts that are **in no line** (left out of the totals) or **in two lines** (double counted), change a class
in place (kept in `config.json` → `accountClass`, so it survives the next load) and *Build statements from classes* again.

**Drill to the mapped accounts.** In Statements, click a line *name*: the mapping (classes / ranges, basis, sign), the
accounts mapped to it with their amounts for the statement's columns, and from an account its companies, cost centres,
months and journal lines. A total line shows the lines it is made of.

**Ledgers in the header.** With more than one ledger a Ledger filter appears; the company list follows it. Ledgers in
different currencies are never added up by default (the first ledger is selected, and "All ledgers" shows a warning).

## CFO Copilot

Header › **Ask**: ask in plain words — "why is net profit behind budget this month?", "which cost centres are over budget
and on which accounts?", "explain the cash movement", "give me three lines for the board". Claude answers with read-only
tools over the same DuckDB file (one SELECT at a time, no file or network access), the statement mapping and the chart of
accounts; the page sends what is on screen (filter, statement lines, KPIs, monitor alerts) so the answer matches the
numbers shown. Answers carry a chart when it helps and links that drill: accounts, journals, cost centres, periods, and
follow-up questions. Every line in the drill dialog has *Ask the Copilot*. It uses the Claude key of Fusion SQL › Ask AI,
stops when the AI is paused (AI Digital Employee › Control) and every answer is audited with its cost.

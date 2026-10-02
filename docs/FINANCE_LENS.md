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

## Your own data (next step)

The loader from Oracle Fusion reads `GL_BALANCES` joined to `GL_CODE_COMBINATIONS` for a ledger, summed to the segments
you map (company, cost centre, account …), with `GL_PERIODS`, budget balances and, for drill-down, `GL_JE_LINES` (BICC
extracts for large volumes). Map your account ranges in the templates once; everything else works unchanged.

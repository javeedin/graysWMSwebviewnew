# Sales Lens — missed sales, why, what they cost, what to do

Sales Lens finds the sales you did not make — per **customer × item × month** — explains each one with evidence,
puts a value on it (revenue, gross margin, recoverable margin), ranks it, and recommends the next step.
It also predicts which customers are about to buy less and which open order lines are at risk, suggests what
else a customer could buy, and lets you try "what if" scenarios in the Simulation Lab.

Page `saleslens/` (Home tile *Sales Lens*, access code `saleslens` in Admin › User Access).
Host `classes/Form1_SalesLensHandlers.cs` + `classes/SalesLensSync.cs`.
Python package `saleslens/python/sales_intel` (copied to `C:\fusion\saleslens\python`, runs in `C:\fusion\saleslens\.venv`).

## How it works

```
Fusion (BI Publisher SQL runner, read-only)                 APEX (ai/executequery)
  order lines (latest change version), items + DFF,          WMS_W2_CANCEL_LOG "OUT OF STOCK" lines
  customers, item costs, BUs, daily rates, UOM,                        │
  on hand, open AR                                                     │
        │  SalesLensSync.cs                                             │ salesLensPutRaw
        ▼                                                              ▼
C:\fusion\saleslens\data\raw\  lines\{yyyymm}.jsonl · items · customers · costs · bus · rates · uom ·
                               onhand\{yyyymmdd}.jsonl · ar · oos · manifest.json (Fusion count + sum per month)
        │  python -m sales_intel build
        ▼
prep  → data-quality rules, quarantine, reconciliation against the manifest
engine→ monthly customer × item facts, seasonal rolling baseline (frozen at the window start),
        opportunities with causes + evidence, recoverability, confidence, score, priority, action
models→ customer decline (LightGBM → logistic → rules), order-line late / cancel / partial,
        reasons per row in plain words, back-test, drift (PSI), registry
market→ cross-sell (association rules + peer penetration), price response (shrunk elasticity)
        │
        ▼
C:\fusion\saleslens\data\saleslens.duckdb  (built as saleslens.new.duckdb, swapped in)
        │                                   │
        ▼ salesLensQuery (read-only)        ▼ the page copies each run
   every screen                        APEX WMS_SI_* (apex_sql/102_sales_lens.sql)
```

The page always reads the DuckDB file on this PC first. APEX keeps a copy of every run (the run, the top
opportunities, customer scores, order risk, model metrics, feedback, scenarios, settings) so other PCs and
reports can see it. The APEX address is a setting (`apexBase`, Setup & data › Settings); empty = the app's APEX.

## Causes

| Code | Shown as | Evidence it needs |
|---|---|---|
| STOCKOUT | Stock-out | lines cancelled for stock (Fusion reason or the WMS cancellation log), nothing on hand |
| PARTIAL | Partial shipment | shipped less than ordered |
| LATE | Late delivery | shipped after the promised date |
| CANCEL | Cancelled lines | other cancellations |
| PRICE_UP / DISCOUNT_DOWN | Price / Discount reduced | net price up or discount down vs the customer's own history |
| MARGIN_LEAK | Margin leak | margin down while volume held |
| RETURNS | Returns | return share of the window |
| PAYMENT | Overdue balance | open AR past due |
| CYCLE | Buying cycle | a gap that the customer's usual cycle explains |
| INACTIVE | Stopped buying | nothing (or < 40 %) in the last month |
| SUBSTITUTION | Switched product | a related item grew while this one fell |
| SEASONAL / LIFECYCLE | Season / Product decline | the whole item fell for every customer |
| UNKNOWN | Unknown | the drop is real but no rule explains it |

Every cause carries a share (0–100 %) and the evidence lines; the strongest is the primary cause.

## Screens

* **Dashboard** — missed revenue / margin, recoverable margin, high priority, recovered so far (what the user
  typed when they gave a value, else the sales measured after the window — one figure per opportunity),
  customers at risk, open lines at risk, the best scenario; expected vs actual by month, causes, act first,
  customers at risk, missed margin by profit centre.
* **Worklist** — every opportunity ranked by recoverable margin × urgency × account tier, cause chips, a
  filter per column, CSV / Excel. A row opens the evidence, the month-by-month chart with the 90 % range,
  likely causes, the recommended action and **feedback** (Accept / Reject, why, outcome, value won).
  Feedback goes to `data\feedback.jsonl` and APEX and is carried into every later build.
* **Customers** — risk of buying less in the next 3 months with its reasons; Customer 360: revenue, margin,
  risk, missed, deliveries, returns & cancels, overdue, expected vs actual, opportunities, could also buy.
* **Products** — revenue, customers buying less, stock-out loss, on hand, price response, demand and net price.
* **Order risk** — open lines with the chance of late / cancelled / partial and why.
* **Simulation Lab** — levers (stock, fill rate, lead time, price, discount, cancellations, returns, recovery
  rate, substitution) on a scope (profit centre, items, customers, BU) → baseline, result, change, a range,
  the assumptions. Kept in `data\sims\` and APEX. Estimates — test the big ones before acting.
* **Models** — each model's method, training window, accuracy (ROC-AUC / PR-AUC / precision / recall / F1, or
  WAPE / bias / coverage for the baseline), top factors, input drift, retraining history, runs.
* **Setup & data** — Python (install / update / versions / self-test), Data (sync from Fusion with months and
  kinds, build, demo data, live steps), Quality (rules, quarantine, Fusion reconciliation per month),
  Settings (thresholds, exclusions, recoverability, nightly run, APEX address, BU access per login), Storage
  (tables on this PC, the APEX copy, clear).

The filter bar (BU, profit centre, tier, salesperson, search) applies to every screen. `allowedBus` in the
settings limits a login to its business units.

## Running it

1. Setup & data › Python › *Install everything* (once per PC).
2. Setup & data › Data › *Sync from Fusion* (24 months the first time; later the recent months). A build runs
   by itself after the sync. *Try the demo* builds a made-up wholesaler instead (refused when Fusion data is on the PC).
3. Nightly: Settings › *Nightly sync + build* (while the app is open on this PC).

Only AI admins change settings or clear data. Sync, build, simulate and feedback are audited (source SALESLENS).

## Tests

* `cd saleslens/python && python -m pytest -q` — the demo wholesaler has planted cases (a stock-out, a price
  rise, a customer who stopped, late deliveries with an overdue balance, returns, a declining product, a short
  shipment, a white-space item, a duplicate line, a month that does not reconcile) and the tests check each is
  found with the right cause; also the simulation, feedback carry-over, the rules and the CLI.
* `python sl_check.py selftest` — the installed packages on made-up data.
* CI job *Sales Lens engine* runs ruff, pytest and the self-test.

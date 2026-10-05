# WMS 2.0 (beta)

A new warehouse module next to the WMS. Home › **WMS 2.0** opens a control tower for one trip date: by default tomorrow (today + 1). The existing WMS is not changed. Both modules run side by side and read the same APEX data.

## What you see

**Control tower** (first screen), for the trip date and instance in the top bar:

- KPI tiles: trips, orders on trips, picker assigned, released to the warehouse, interfaced, MRA, printed, lines to cancel, pending orders not on a trip.
- **Order flow**: the orders that reached each stage. They go On trip → Picker assigned → Released → Picked / staged → Interfaced → MRA done → Printed. Click a stage to see the orders still before it.
- **Trips**: one row per trip with picker, progress, MRA, print and cancel status. Click a trip to open **Trip 360**.
- **Needs attention**: what to fix now, each item with a button. Examples are orders without a picker, lines to cancel, MRA failed, print failed, orders not released and old pending orders.
- Picker load, lines per trip (by Fusion status), MRA and printing, the autopilot and the latest activity.

The left menu has these pages:

- **Trips**: as a board by stage, or as a list. Each trip you open gets its own tab next to **All trips**, so several trips stay open at once. Ctrl+click or middle-click opens a trip in the background, × or middle-click on a tab closes it, and **Close all** closes them all. The tabs are kept per instance and trip date for the session.
- **Orders**: every order of the date, with filters.
- **Picking**: the load per picker.
- **Pick release (day)**: release every trip of the date at once.
- **Cancellation autopilot**.
- **MRA**.
- **Printing**.
- **Pending orders**.
- **Insights**.
- **Data & sync** and **Settings**.

Press **Ctrl K** to find any trip, order, customer, picker or page.

## Trip features: the same WMS screens

Everything the WMS trip page does is available in WMS 2.0, from the WMS's own code. The WMS trip page, its dialogs and the order dialogs are copied as they are into `wms2/legacy/`, so the same tested screens run. To refresh that copy after a fix in the WMS, run `python wms2/legacy/copy-from-wms.py`.

**Opening a trip** shows the stage timeline and the WMS 2.0 cards first: orders, lines interfaced, without picker, MRA, printed, lines to cancel and lorry load. Below them is the WMS trip page itself, with every WMS button and the WMS orders grid. Its own summary cards are hidden, because the cards above replace them. **Insights** switches the tab to the WMS 2.0 view: the orders with their Fusion status, MRA, print and cancellations, plus an action bar that runs the same WMS actions with the right orders ticked. Each trip tab keeps its own WMS page, so ticked rows and a running pick release stay when you switch tabs.

| WMS trip page | In WMS 2.0 |
|---|---|
| Assign Picker (+ date) | Trip 360 › Assign picker: the orders without a picker are ticked. Order panel › Assign / Change picker. |
| Unassign Picker (a stub in the WMS) | Trip 360 › Unassign picker, or the order panel: tick the orders, and their picker assignment is removed. |
| Pick Release All (with or without lots) | Trip 360 › Pick Release All: the orders not yet released are ticked. Also **Pick release (day)** for every trip of the date. |
| Allocate Lots for S2V | Trip 360 › Allocate lots S2V: the Store to Van / Van to Store orders are ticked. |
| Edit Trip (lorry, loading bay, priority) | Trip 360 › Edit trip |
| Add Orders (pending orders, paste orders, fetch pending shipments) | Trip 360 › Add orders. The date is read again afterwards. |
| All Shipment Lines (update ship date, cancel) | Trip 360 › All shipment lines |
| Show Lines | Trip 360 › Show lines |
| Get Profit Centers | Trip 360 › Profit centers |
| Add to Agent | Trip 360 › Add to agent |
| Move order to another trip | Order panel › Move to another trip |
| Remove from trip | Order panel › Remove from trip |
| Print (sales order / store transaction) | Order panel › Print |
| Order / Store Transactions (lines, lots, pick confirm, ship confirm, cancel lines by hand, QOH, set data, process) | Order panel › Order details |
| Create New Trip (Co-Pilot) | Trips › Create trip (the new trip opens as a tab) |
| Trip summary, volume vs lorry capacity, Excel export | The trip tab's cards (Lorry load) and the WMS page's grid |

When you leave a trip's WMS page (another tab or page), WMS 2.0 reads the date again, so the dashboard shows what you changed.

## Fast: the local copy

WMS 2.0 reads the trip date from the WMS sources. It writes every answer into a DuckDB file on the PC (`C:\fusion\wms2\wms2.duckdb`), and every screen reads that file. The sources are:

- the trips and trip lines (GETTRIPDETAILS);
- picker assignments;
- print jobs;
- Fusion shipment lines;
- WMS order lines;
- MRA status;
- pending orders.

The top bar says how old the copy is. The trip date on screen is refreshed every 3 minutes while the page is visible. **Refresh** reads it again at once. **Data & sync** shows each step, its result and its time, and lets you run one step again.

### Where the data comes from

```
APEX (ORDS endpoints, AI gateway)  ┐
Fusion (shipment lines REST, MRA BIP) ┘ → the app (C# host: executeGet / executePost / executeOracleFusionGet / omBip)
   → WMS 2.0 page → w2Put → DuckDB C:\fusion\wms2\wms2.duckdb → every screen (w2Query)
```

APEX stays the master. DuckDB is a local copy of one trip date: a refresh reads that date again and replaces it.

### When the screen is empty

- **"This build of the app does not have WMS 2.0's local database yet"**: the pages come from the source folder, but the running GraysWMS.exe was built before WMS 2.0. Rebuild the app and start it again.
- **"Reading … from APEX and Fusion"**: the first refresh of the date is running. The step it is on is shown, and the trips appear as soon as the trip lines are saved.
- **"No trips for …"**: the last refresh finished. Its steps are listed with what each one read and any error. For example, *trips: 0 trip(s)* means APEX had no trips for that date on that instance.

## Pick release for the whole day

**Pick release (day)** lists every order of every trip of the date. Orders not yet released are ticked. Click a trip chip to choose one trip only.

It makes the same calls as the WMS Pick release:

- **No lots**: one call per order.
- **With lots**: release the pick wave, then read the picks, then the lots.

It runs 1–4 orders at a time, with a live log and **Retry failed**. The released orders are read again from Fusion straight away. Store to Van / Van to Store orders are not pick released here, as in the WMS. Use their Store Transactions button instead.

## Cancellation autopilot

The autopilot cancels lines automatically, with the Shipping Agent's rules:

- Main lines in **Scheduled** or **Manual Reservation Required** are cancelled with their numbered sub-lines (3 → 3.1, 3.2). If a line has no sub-lines, its BOGO promo items are cancelled with it.
- Lines in **Awaiting Shipping** are never cancelled by the autopilot, and neither are child lines already shipped, interfaced or cancelled. Cancel those by hand in the order details.
- Fusion receives the same request as before: quantity 0, reason OUT OF STOCK.

How a run works:

1. It reads every trip's order lines into the local copy and finds the orders to cancel there.
2. Just before cancelling, it reads each order again live, so nothing is decided from old data.
3. After the cancel it reads the order once more. A line counts as cancelled only when it now reads Cancelled. Otherwise it is reported as failed and tried again on the next run, at most 3 times.

Controls and safeguards:

- **ON / OFF** is set per instance, with a reason, and is shared by every PC. The settings are also shared: run every n minutes, trips of today and/or tomorrow, and a safety stop after a number of lines per run.
- Only one PC cancels at a time (a lease in APEX).
- The AI kill switch (AI Digital Employee › Control) stops the autopilot too.
- **Check (no cancel)** shows what a run would cancel. **Run now** runs once for the date on screen.
- Every cancelled, failed or skipped line is logged in APEX (`WMS_W2_CANCEL_LOG`) and in the local copy. Each order is also audited.

## MRA and printing

- **MRA**: sends interfaced orders to MRA, 4 at a time, with a log per order. **Check** reads the MRA report without sending anything. The MRA interface switch (Yes / No) is shown here; it is still changed in the WMS.
- **Printing**: shows the print jobs of the date, failed jobs first, with **Print again**, and the orders that are ready but not queued.

## Setup

None is needed. The page creates its three APEX tables on first use. The same DDL is in `apex_sql/87_wms2.sql`.

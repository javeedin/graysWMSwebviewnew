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

- **Trips**: as a board by stage, or as a list.
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

## Order details: the same WMS screens

**Order details** in Trip 360 opens the WMS dialogs themselves: Order Transactions for sales orders, and Store Transactions for Store to Van / Van to Store. These include sales order lines, pick release details, lots, shipment lines, pick confirm, ship confirm and cancelling lines by hand (for example lines in Awaiting Shipping).

They are a copy of the WMS code, kept as it is in `wms2/legacy/`, so the same tested screens run.

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

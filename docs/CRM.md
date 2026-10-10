# Customer CRM

Home › Warehouse & Orders › **Customer CRM** (`crm/index.html`). This is one place for everything about a customer: Fusion sales, AR and stock, the statements sent and how the customer answered them, support tickets with an SLA, phone calls and e-mails.

## What it does

| Tab | What you get |
|-----|--------------|
| **Today** | Your queue, tickets past or close to their SLA, callbacks due, today's activity and recent customers. The KPI tiles open the matching ticket list. |
| **Customers** | Searches the whole Fusion customer master kept on this PC (name, account, party number, phone, e-mail, address, tax reference), plus Debtors cards, tickets, calls and contacts. The bar on top loads the master (see *The customer master* below). **Find in Fusion** searches Fusion live; what it finds is kept too. |
| **Customer 360** | Header with phone (click to call), e-mail, address, collector, terms, credit limit, credit hold and a **health score** (0–100 with reasons). The sub-tabs are listed below. |
| **Tickets** | List or board, filtered by scope (open, mine, unassigned, past the SLA, waiting, resolved), queue and priority. The ticket drawer has the conversation, internal notes, canned replies, e-mail replies, SLA bars, details, the customer, *solved before* (similar resolved tickets) and the customer's link. |
| **Calls** | Call log with KPIs (answered, missed, talk time), callbacks, recordings with a fingerprint check, and CSV export. |
| **E-mails** | Every e-mail sent from the CRM, with its attachments and their fingerprints. |
| **Insights** | SLA met %, average first reply and resolution time, satisfaction, tickets by category, channel and agent, customers with the most tickets, and calls per day. |
| **Setup** | Categories and queues, agents, SLA per priority, business hours and holidays, routing rules, canned replies, the phone, learning (ML.NET), the customer page and database objects. |
| **Autopilot** | The AI Agent with the **Customer Desk** specialist, embedded the same way as in Debtors Control. |

The **Customer 360** sub-tabs:

- **Overview**: balance, overdue, 24-month sales trend, aging, the latest activity, the last statement and open tickets.
- **Timeline**: tickets, replies, calls, e-mails, statements, Debtors activities, orders and payments, merged.
- **Invoices & AR**: the customer's whole receivables picture, with these views:
  - **Summary**: KPI tiles (balance, overdue, invoiced and collected in 12 months, credit notes, bounced cheques, days to pay, returns), invoiced vs collected by month for 24 months, aging, latest movements, and the **customer rating**.
  - **Open items**.
  - **All transactions**: invoices, credit memos, debit memos, chargebacks and deposits for 24 months, each with paid / open, due and closed dates, the order, the invoice a credit memo was made against, and its reason.
  - **Payments**: applied and unapplied amounts, and reversals.
  - **Applications**: which receipt or credit memo paid which invoice, with days to pay, days late, and *paid by* when another account (e.g. a head office) paid.
  - **Bounced cheques**: reversed receipts with the reason (NSF = bounced, STOP = stop payment, REV = reversed).
  - **Returns & credit notes**: sales-order return lines with the reason, and credit memos.
  - **Adjustments**.

  Every number drills down; a number inside a drill opens the next transaction, receipt or order, and **Back** returns. An invoice shows its lines, the receipts and credit notes applied to it, adjustments, accounting and journal lines. A receipt shows its applications and its history (cleared, reversed). Each view has a filter and CSV. **Statements** and **Send statement** sit in the bar.

  The **customer rating** (A–E, 0–100) is built from weighted factors:

  | Factor | Weight |
  |--------|--------|
  | Paying on time (amount-weighted days late) | 30 % |
  | Overdue now (90+ counts twice) | 20 % |
  | Collected vs invoiced | 15 % |
  | Credit notes and adjustments vs invoiced | 15 % |
  | Bounced cheques | 10 % |
  | Trend of days late | 10 % |
  | Credit limit use, when the customer has a limit | added |

  The rating also shows on the Overview.
- **Sales orders**: drill to the lines, or open the order in Fusion.
- **Items & stock**: what the customer buys, plus **Stock now** (on hand per org and subinventory).
- **Statements**: the journey of the last statement (recorded, PDF, sent, delivered, opened, read, agreed or queried) and every statement sent. Actions: **Send again**, **Open the PDF**, **Check the file** (SHA-256).
- **Tickets**, **Calls**, **E-mails**.
- **Contacts**: CRM contacts you can edit, plus the Fusion contacts.
- **Details**: the Fusion master and the Debtors card.

### The ask bar (Ctrl+K)

The ask bar answers without an AI model. Type any of these:

- a customer name, an account or a phone number
- a ticket number (`CS-000123`, `ticket 45`)
- plain words such as *last statement of Alpha*, *send statement to 1002*, *how much does Winners owe*, *my tickets*, *tickets past the SLA*, *callbacks*, *missed calls*, *new ticket*

The rules live in `CRME.ask`. Anything the rules do not cover is offered to the Autopilot.

### Statements

**Send statement** (from Customer 360 or the ask bar) follows exactly the Debtors Control path:

1. The PDF comes from the business unit's statement report (`dcStatementPdf`).
2. It is recorded in `WMS_DC_STMTS` **before** the e-mail goes.
3. It is sent with the business unit's statement text, with an optional opens counter and an *agree / query* button.
4. The result is written back to the statement record, the CRM message and the Debtors timeline.

**New e-mail** can also attach:

- files from the PC
- the last statement PDF, after checking it is the recorded file
- a fresh statement, which is recorded too

### Tickets and the SLA

- **Numbers** come from `WMS_CRM_TICKET_SEQ` (`CS-000001`; the prefix is set in Setup).
- **Due dates.** First reply and resolution are due after the SLA hours of the priority. Only **working hours** count (days, open / close times, Saturday close, holidays).
- **Pause.** While a ticket waits for the customer the SLA is paused. When it moves on, the resolution due date moves by the working minutes it was paused.
- **Routing.** The rules run first (words, category or channel → queue, priority or owner). Then the category's queue applies. Then the least busy agent of the queue gets the ticket.
- **Replies** can be e-mailed. The subject is `[CS-000123] …` and the e-mail has a button to the customer's page.
- **Resolve** keeps the resolution. Later tickets show it under *solved before*.
- **Reopen** counts reopenings, which lower the health score.

### The customer page

The customer page lives in your APEX:

- **Raise a request:** `…/WAREHOUSEMANAGEMENT/crm/new/<key>`. No login is needed; the key comes from Setup › Customer page, and a new key stops old links.
- **Follow a ticket:** `…/WAREHOUSEMANAGEMENT/crm/t/<token>`. The customer can reply (a resolved ticket reopens) and rate it from 1 to 5.

These pages are the procedures `WMS_CRM_PORTAL` and `WMS_CRM_TK`. Create them in Setup › Database, or with `apex_sql/100_crm.sql`.

Portal tickets arrive as *New*. The next time any CRM page loads it **triages** them:

- works out the SLA due dates
- picks the queue and the owner
- finds the customer account from the phone number or e-mail

### Phone and call centre

The CRM keeps the call record; the telephone line stays with your phone or softphone.

Choose how calls are placed in Setup › Phone:

- **Desk phone.** You dial; the CRM times and logs the call.
- **Softphone on this PC.** The host hands a `tel:`, `sip:` or `callto:` link to Teams, Zoiper, MicroSIP, 3CX and similar (`crmDial`).
- **Call listener.** For incoming calls, the host listens on `127.0.0.1:<port>` (only this PC, with a key). Configure the softphone to open this address on a call event:

  ```
  http://127.0.0.1:8765/call?event=ring&from=%NUMBER%&key=<key>
  ```

  `event` = `ring` · `answer` · `hangup` · `missed` · `dial` (an outgoing call from the softphone, with the number in `to`). Typical settings:

  - MicroSIP: *cmdCallRing* calls this URL with curl.
  - Zoiper: *Run on incoming call*.
  - 3CX and other CTI connectors: a call-event URL.

  The CRM pops the caller, shows the customer, open tickets and an **Answer** button, and logs missed calls.

**Calls** in the panel:

- **Screen pop.** The caller is matched by the last 7 digits against the CRM contacts, Debtors cards, the Fusion master kept on this PC (`w2_crm_phone`), and then live against Fusion `HZ_CONTACT_POINTS`.
- **During and after the call:** a timer, notes, outcome, what the call was about, a callback time, a link to a ticket, *make a ticket from it*, and **Record**.
- **Recording.** Record captures this PC's microphone and saves it as `C:\fusion\crm\recordings\yyyy-MM\<call>.webm` with its SHA-256. Use the softphone's own recording when both sides must be heard. The consent sentence is shown to the agent.

Other telephony, for example a WebRTC SIP client, can be added later with `CRM.phone.register(name, {label, dial})`.

### Learning

The CRM suggests a **category and priority** for every new ticket and lists similar resolved tickets:

- **ML.NET** (`Microsoft.ML` 5.0, SDCA maximum entropy on featurised ticket text) is trained in Setup › Learning from the categorised tickets. The models are kept in `%APPDATA%\GraysWMS\Crm\ml-{category|priority}.zip`, and accuracy is measured on a held-out 20 % once there are 40+ tickets.
- Until a model is trained, a **naive-Bayes** model built in the page (`CRME.nbTrain` / `nbPredict`) is used.
- *Similar tickets* use TF-IDF cosine similarity (`CRME.similar`).

## Where things live

**APEX** (created by the page; the same DDL is in `apex_sql/100_crm.sql`):

| Table | Holds |
|-------|-------|
| `WMS_CRM_SETTINGS` | JSON per key: `SETUP`, `PORTAL_KEY`, `PORTAL_CATEGORIES`, `PREFIX` |
| `WMS_CRM_TICKETS` | Tickets; numbers come from `WMS_CRM_TICKET_SEQ` |
| `WMS_CRM_TICKET_EVENTS` | Conversation and history: `COMMENT`, `NOTE`, `EMAIL_OUT`, `CUSTOMER`, `STATUS`, `ASSIGN`, `CALL`, `SLA`, `CSAT`, `CREATED` |
| `WMS_CRM_CALLS` | Calls, with the recording path and SHA-256 |
| `WMS_CRM_MESSAGES` | E-mails, with attachments and their fingerprints, ticket and statement |
| `WMS_CRM_CONTACTS` | Contacts kept in the CRM |
| `WMS_CRM_C360` | The Customer 360 Fusion sections as last read (rows JSON up to 250,000 characters, plus the SQL) |
| `WMS_CRM_CUSTOMERS` | The whole Fusion customer master per pod |

Statements, Debtors cards and the Debtors timeline are the **Debtors Control** tables. The CRM loads `../debtors/dc-*.js`, so a release with `crm` always carries `debtors`.

**Order of reading a Customer 360 section: DuckDB → APEX → Fusion.**

1. This PC's copy (`w2_crm_c360` in the WMS 2.0 DuckDB file) is shown at once.
2. The shared APEX copy (`WMS_CRM_C360`) fills in what this PC does not have, or has older, and is copied to this PC. It is what another PC read.
3. Fusion is read last. Master, open items and sales are always read live in the background; the other sections are read when their tab is opened, or with Refresh.

Every Fusion read is written to both copies. The source note says where the rows came from (*read from Fusion · kept on this PC and in APEX*, *from APEX · read … by …*, *kept on this PC*).

**When a section fails**, its error is shown with **the SQL that failed** inline, with:

- **Copy**
- **Open in Fusion SQL**, which opens Fusion SQL with the query in its editor
- **Try again**
- every alternative tried, with its own error

The table then says *Not read*, never *No …*. Each section tries alternatives that drop columns a pod may not have. For example, the sales-order currency is `TRANSACTIONAL_CURRENCY_CODE`; the last alternative has no currency column at all.

### The customer master

Customers › the bar on top keeps the whole Fusion customer master on this PC (DuckDB `w2_crm_customers`) and in APEX (`WMS_CRM_CUSTOMERS`):

- **Load all Fusion customers** / **Reload all** reads `HZ_CUST_ACCOUNTS` × `HZ_PARTIES` with the bill-to address, primary e-mail and phone (`CRME.sql.customersPage`). It reads in keyset pages of 1,000 by `CUST_ACCOUNT_ID`, so every page costs the same at any depth, with alternatives that drop the address or contact columns. Each page goes to DuckDB at once and to APEX (MERGE, 40 rows a statement) while the next page is read. **Stop** keeps what was read, and **Continue the load** goes on from the last id.
- **Sync changes** reads only accounts or parties changed since the newest change kept.
- **Copy from APEX**: a PC whose copy is empty fills it from APEX without asking Fusion. This happens on its own when the page opens.

The last load is recorded in `WMS_CRM_SETTINGS` `CUST_SYNC_<pod>` (when, who, rows, mode).

**Browsing.** With the box empty, the Customers grid lists every customer of this copy in pages, sorted by name:

- pager « ‹ Prev, page n of m, Next › » and 25 / 50 / 100 / 200 / 500 rows a page
- **Refresh** reads the page and the counts again
- without DuckDB, the same pages come from the APEX copy

**Searching** pages through the matches the same way. A search with nothing on this PC (3+ characters) reads Fusion by itself. What Fusion finds shows at once (*Fusion · just read*) and is kept on this PC and in APEX, so the next search finds it here. Enter or **Find in Fusion** always asks Fusion.

**The APEX copy.** Every value is cut to its column's size in bytes, because accented names and addresses take more than one byte per letter. A statement APEX refuses is retried as smaller pieces, down to one row, so one bad row never stops the rest. Rows APEX still refuses are counted (*n refused by APEX*, with the reason on hover). When this PC has more customers than APEX, **Copy n to APEX** pushes this PC's copy, so other PCs get them without Fusion.

Searches use this copy: the Customers box and the ask bar, every word against one search text, and 7+ digits against the phone digits. The screen pop looks up a caller's number here before asking Fusion. Without DuckDB, the APEX copy is searched. The phone index is `w2_crm_phone`.

**Host** (`classes/Form1_CrmHandlers.cs`, `crm*` actions):

| Action | Does |
|--------|------|
| `crmInfo` | This PC's name and the CRM folder |
| `crmSaveRecording` / `crmRecording` | Save a call recording / read it back to play |
| `crmOpenFolder` | Open a CRM file or folder in Explorer |
| `crmDial` | Hand a number to the softphone |
| `crmSend` | E-mail through the Finance Lens mail setup (Outlook, Microsoft 365 or SMTP), with page attachments plus files under `C:\fusion\crm`, `C:\fusion\debtors` or `C:\fusion\OM`; audited as source CRM |
| `crmCtiStart` / `crmCtiStop` / `crmCtiPoll` | The call listener |
| `crmMlTrain` / `crmMlPredict` / `crmMlStatus` | The ML.NET models |

## Autopilot (Customer Desk)

The AI Agent page is embedded as `../aiagent/index.html?embed=1&module=crm` (AI Hub 1.6.0). The **Customer Desk** specialist (`crm`; pins `@crm`, `@customer`, `@tickets`) has these page tools (`aiagent/tools-crm.js`, built on the CRM store and engine):

| Tool | Does |
|------|------|
| `crm_tickets` | Tickets by scope, priority, category, account or words |
| `crm_ticket` | One ticket with its conversation and *solved before* |
| `crm_customer` | 360 from the CRM records |
| `crm_calls` | The call log and callbacks |
| `crm_open` | Opens a customer, ticket or tab in the CRM page |

It also has the Debtors tools (balances, open items, statements, follow-ups) and the Fusion SQL tools. It is read-only: replies, ticket changes, calls and e-mails stay with the user.

## Tests

- `node crm/tests/crm-engine.test.js` (CI) covers business hours and the SLA (with pause), routing, phone numbers, the health score, the timeline, KPIs, naive Bayes, similar tickets, the ask parser, the read-only 360 SQL (incl. the order currency column and its fallbacks), the customer-master pages, rows and search, and the AR 360 totals and rating.
- AI Hub: `test_crm_customer_desk_routing_tools_and_module_threads`, plus the evals `crm_sla` and `crm_missed`.
- A browser run with a fake host, a SQLite stand-in for the APEX gateway and a fake DuckDB covers 87 checks. They include:
  - every AR view, filter and drill (invoice → receipt that paid it → Back)
  - the Statements button
  - sections kept in APEX and on this PC
  - a failing section with its SQL inline and Open in Fusion SQL
  - another PC opening from the APEX copy without a Fusion read
  - 1,500 customers loaded into DuckDB and APEX
  - paging (next, last, 200 a page, Refresh)
  - a customer read from Fusion by itself and kept
  - Copy to APEX
  - search and screen pop without Fusion
  - Sync changes and the copy from APEX

  It also covers Customer 360 from Fusion, a ticket with an acknowledgement, a reply that waits and a resolution, a statement recorded before it is sent, an e-mail with a file and the last statement, an incoming call through the listener (screen pop, answer, notes, callback), an outbound call through `tel:`, a logged missed call, the ask bar, the database objects, the portal key, ML.NET training, the suggestion, portal ticket triage, Insights and the Autopilot frame.

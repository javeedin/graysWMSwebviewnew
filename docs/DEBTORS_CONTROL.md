# Fusion Debtors Control

Home › Finance › **Fusion Debtors Control** (`debtors/`). It replaces the statement and customer-balance part of the
old DevExpress debtors form, and adds what that form never had: **a permanent record in APEX of every statement —
who it went to, when, from which mailbox, whether it arrived, whether it was opened, and whether the customer agreed
or queried the balance** — plus a customer timeline (calls, notes, promises to pay, disputes, follow-ups) that grows
into a small credit-control CRM.

## The rule

Every statement is written to APEX **before** its e-mail goes out. If the record cannot be written, the statement is
not sent. Afterwards the same row gets the outcome: sent / failed (with the reason), the method and mailbox, and later
opened / delivered / read / bounced and the customer's answer.

## Statement cycles — the month-end workflow

**Statement cycles** is the way to send the month's statements. One cycle = one business unit × one month (one per pod;
a second cycle for the same month is refused). **New cycle**: business unit, month, statement date (the month end),
pod, owner, send-by date, the OM ↔ AR tolerance. It is worked through five steps, each recorded in APEX with who and
when; the *Trail* beside it lists every step, run, bypass and send.

1. **Checklist** — the same checks for every customer of the cycle:

   | Area | Check | Default |
   |---|---|---|
   | Receivables | no unapplied receipts (≤ statement date) · no unidentified receipts · no incomplete transactions · every AR event accounted (XLA) · AR period open/closed | blocking (period: warning) |
   | Order to cash | AutoInvoice interface empty · shipped OM lines billed · OM vs AR amounts of the month within the tolerance · the legacy OM ↔ AR reconciliation BIP (off by default) | blocking |
   | Customers (on the balances read for the cycle) | every customer with a balance has an e-mail (or is set to post) · every address is valid · addresses shared by two accounts · credit balances · old debt (> 25 % over 90 days) without a follow-up | e-mail checks blocking, the rest warnings |

   Fusion checks run through the read-only SQL runner (`{BU_ID}`, `{STMT_DATE}`, `{PERIOD_START}`, `{MON_YY}`,
   `{PERIOD_NAME}`, `{TOLERANCE}` filled in), two at a time; each keeps its SQL, the rows found (first 50), the amount,
   the time and who ran it — **Details** shows them, with CSV. A failed (or not runnable) check is fixed in Fusion and run
   again, or **bypassed with a comment** (at least 10 characters; name, time and reason are kept and printed in the audit
   pack). *Checklist done* is only possible when every check ran and no blocking failure is left; the score (passed /
   bypassed / warnings) is kept. Setup › *Statement cycle checklist* switches checks on / off, changes blocking ↔ warning,
   edits the SQL or adds your own checks (Fusion SQL or a BI Publisher report).
2. **Archive balances** — one frozen row per customer in `WMS_DC_CYCLE_BAL` (balance, overdue, aging buckets, items,
   e-mail, delivery, priority, last cycle's balance) and the cycle totals (customers, total due, owed, overdue, aging,
   credit balances, e-mail / post split) with the **movement** against the previous cycle (new, cleared, up, down, the
   biggest moves). The checklist is locked from here on.
3. **Statement check** — the statement report's **query is captured**: its BI Publisher data model is read and every
   data set's SQL kept with the cycle, fingerprinted (SHA-256). When the fingerprint differs from the previous cycle the
   step says *changed since the last cycle* and **What changed** shows a line diff. Sample statements (largest balance,
   oldest debt, a credit, the longest) are made and opened; sign-off needs a tick and a note (and a reason when the
   query could not be captured).
4. **Send** — opens *Send statements* on the archive (the frozen balances, not a new read), every statement and the run
   carry the cycle id. The step shows coverage per customer: e-mailed / by post / failed / not sent / opened / agreed /
   queried, with the latest try counting (a resend over a failure).
5. **Close** — coverage and what is left; a closing note is required when not everyone was sent. A closed cycle is
   read-only; it can be reopened with a reason (in the trail).

**Audit pack** — one HTML file with the cycle, the checklist (results, SQL, bypasses), the archive with totals and
movement, the captured statement query, every statement sent and the trail.

## Sending statements

1. **Send statements** — choose the business unit and the statement date (default: last day of last month) and press
   **Read the balances**. The customers come from the business unit's source:
   - a **BI Publisher report** — by default the reports the old form used
     (`/Custom/OQ/Customer Stmt/CUSTOMER_STATEMENT_SUMMARY_BIP.xdo`, Sugarworld: `SW_Customer_Statement_Summary_BIP.xdo`)
     with `p_date_fr` (MM-dd-yyyy) and `BUSINESS_UNIT_ID`; or
   - **Fusion SQL** (direct, read-only through the app's SQL runner) — the starter query reads the open items of
     `AR_PAYMENT_SCHEDULES_ALL` with aging buckets and the customer's e-mail.
2. The grid shows every customer with the balance, a **priority** (see below), **where the statement goes** (e-mail
   address, or post and why) and the **last statement** sent. Filters: balance above zero, not sent yet for this date,
   e-mail / post.
3. **Preview the e-mail** for each ticked customer, then **Send**. The confirmation shows how many go by e-mail, how
   many by post, the mailbox they are sent from, and warns when a ticked customer already got this date's statement.
4. For each customer: the statement PDF is made by the business unit's statement report
   (`Customer_Statement_Rep.xdo` / `SW_Customer_Statement.xdo` with `p_cust_no`, `p_date_fr`, `BUSINESS_UNIT_ID`),
   saved under `C:\fusion\debtors\statements\{POD}\{BU}\{date}\`, fingerprinted (SHA-256), **recorded**, then e-mailed
   (or kept for the post). PDFs are made up to 4 at a time; e-mails go one by one. Stop ends the run cleanly;
   failed ones can be sent again from the result.

**Who gets it:** the e-mail on the customer's **card** (Customers › Card) wins over Fusion's. Delivery: the card's
choice (e-mail / post / no statement), else `EMAIL_STAT = NO` in the report means post, else e-mail when there is a
valid address, else post.

## What happens after it is sent

- **Opened** — a 1×1 tracking picture in the e-mail (only counted when the mail client shows pictures).
- **Agreed / queried** — the button *Confirm or query this balance* opens a page (served by APEX) with the balance and
  two buttons: *Yes, I agree with the balance* / *I want to query this balance*, plus a comment. It is a form (POST),
  so mail scanners that open links never answer for the customer. A query becomes an open **dispute** on the
  customer's timeline and in *Needs you*.
- **Delivered / read / bounced** — ask for read / delivery receipts when sending, then **Statements sent › Check
  receipts** reads them from the mailbox (Outlook or Microsoft 365) and matches them to the statements.

Set up the customer links once: **Setup › Customer links › Set up** (or run `apex_sql/99_debtors_control.sql` in SQL
Developer).

## The customer (CRM)

**Customers** lists the business unit's customers with balance, priority, last statement, last contact, open promises
and collector. **Customer 360** shows the card (statement e-mail, phone, contact, collector, tags, notes, credit hold),
the balance with its aging bar, why the priority is what it is, and one **timeline** of statements, the customer's
answers, calls, notes, promises to pay, disputes and follow-ups. From there: *Log a call*, *Note*, *Promise to pay*
(amount + date), *Follow-up*, *Dispute*, *Card*, *Send a statement*.

**Priority (0–100)** — a large balance, old debt (60+ / 90+ days), broken promises, open disputes, no contact for 45
days and a statement that did not arrive all raise it; each reason is shown.

**Follow-ups** — everything open, grouped past its date / today / next 7 days / later. A promise is closed as *Paid*
or *Not paid* (a follow-up in 2 days is added); a dispute is resolved with how it was resolved.

## Setup

- **Business units** — name, id, company name (used in the e-mail), currency; the balances source (report + parameters
  as `name = value` lines, or SQL), column names when the report uses others, the statement report, and the e-mail:
  subject, attachment name, contact for queries, always cc / bcc, HTML body, tracking picture, agree / query button,
  receipts. Values in `{…}` are filled per customer: `{STMT_DATE}`, `{STMT_DATE_MDY}`, `{STMT_DATE_LONG}`, `{MONTH}`,
  `{BU_ID}`, `{COMPANY}`, `{CONTACT}`, `{ACCOUNT_NUMBER}`, `{ACCOUNT_NAME}`, `{BALANCE}`, `{OVERDUE}`, `{CURRENCY}`.
  **Test the balances** and **Make a test PDF** check a business unit before a run.
- **E-mail from this PC** — Outlook on this PC (choose the account), Microsoft 365 or SMTP. It is the same setup as
  Finance Lens › E-mail; the full form (sender name, reply-to, SMTP server) is there.

## Where it is stored (APEX)

| Table | What |
|---|---|
| `WMS_DC_SETTINGS` | business units, sources, templates (JSON) |
| `WMS_DC_CUSTOMERS` | the customer card |
| `WMS_DC_RUNS` | one row per statement run |
| `WMS_DC_STMTS` | one row per statement — the record |
| `WMS_DC_ACTIVITY` | the customer timeline |
| `WMS_DC_CYCLES` | one row per statement cycle: steps, totals, the captured statement query (CLOB) + fingerprint, coverage |
| `WMS_DC_CYCLE_CHECKS` | the checklist result per check: status, rows, amount, SQL, sample rows, bypass note / by / at |
| `WMS_DC_CYCLE_BAL` | the archived balance of every customer of the cycle |
| `WMS_DC_CYCLE_EVENTS` | the trail |

The PDFs stay on the PC that made them (the record names the PC and the file); the fingerprint lets anyone check that
a PDF is exactly the one that was sent.

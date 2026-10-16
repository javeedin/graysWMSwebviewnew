---
name: month-end-close
title: Month-end close package
description: Run the month-end close for the entity and period in the filter — accrual schedule, roll-forwards of the key balance sheet accounts, variance commentary and close checks — and stage a close package for controller sign-off. Use for period-end close; drafts journals, never posts.
source: anthropic-adapted
uses: accrual-schedule, roll-forward, variance-commentary, gl-recon
---

# Month-end close

You are the controller's right hand running the close checklist for one entity (the filter's ledger / company) and
one period (the filter's period). You produce a close package a controller can review and sign.

## Deliver, in this order

1. **Close status** — a short table: check · result · note. Checks (all with `run_sql`):
   - Trial balance balances: SUM(end_bal) of the period = 0 per ledger and company (and debits = credits).
   - Balance sheet balances: assets − equity − liabilities = 0 (template BS line CHK, see `template_rows`).
   - Suspense / clearing accounts (class Suspense, or names like suspense / clearing / unallocated) are nil.
   - Every month of the year to date is present in fin_periods (no gaps).
   - Journals posted after the period end date (fin_journals.posted_at > fin_periods.end_date), if journals are loaded.
2. **Accrual schedule** — follow the `accrual-schedule` skill (policy list from `close_settings`).
3. **Roll-forwards** — follow the `roll-forward` skill for: cash, trade receivables, inventory, trade payables,
   accruals, borrowings (the BS lines CASH, AR, INV, AP, ACCR, LOANS/STB when they exist), plus any account the user named.
4. **Variance commentary** — follow the `variance-commentary` skill for the income statement and the balance sheet.
5. **Open points for the controller** — what you could not tie or explain, each with the next action.

## Guardrails

- **No posting.** Journal entries are drafts in the package; posting happens in Fusion after controller approval.
- **Never plug.** A difference you cannot explain is an open point with its amount, not an adjustment.
- Numbers come from tools, never from memory; amounts in fin_balances are debit-positive.
- If data is missing (journals not loaded, no budget, prior year not synced), say which part of the package it
  affects and what to load (Data › Trial balance sync / Full GL load).

## Format

Headings per section, Markdown tables (one table per schedule — the page turns every table into an Excel sheet),
amounts with thousands separators and the ledger currency, and a one-paragraph summary at the top:
"Close <period> for <entity>: <n> checks passed, <n> open points, <n> draft journals totalling <amount>."

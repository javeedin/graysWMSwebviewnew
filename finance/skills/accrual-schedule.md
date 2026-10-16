---
name: accrual-schedule
title: Accrual schedule
description: Build the period-end accrual schedule — for each accrual on the policy list (or each recurring cost with no charge this month), compute the entry, cite the support and draft the journal. Use during month-end close; the journal is a draft for controller approval, never posted.
source: anthropic-adapted
---

# Accrual schedule

Produce one row per accrual with its calculation, its support and a draft journal.

## The policy list

Read it with `close_settings` (accruals: name, expense account, accrued-liability account, method, amount, reverses).
If it is empty, PROPOSE candidates instead and label the section "Proposed — not on the policy list": recurring
expense accounts (charged in at least 3 of the last 4 months) with no or unusually low charge this month
(`run_sql` on fin_balances, scenario ACTUAL, period_net by account and period_seq).

## For each accrual

| Field | How to derive |
|---|---|
| Accrual | Name from the policy list, or the account name for a proposal |
| Basis | method `fixed` = the policy amount per month; `avg3` = average period_net of the last 3 months for the expense account; `annual` = policy amount ÷ 12 — cite the query or the policy |
| Already booked | period_net of the expense account this period (fin_balances, filter's ledger / company) |
| This-period accrual | Basis − already booked (no accrual when ≤ 0 or below the materiality floor) |
| Support | the SQL you ran, or "policy: <name>" |

## Draft journal

For each non-zero row:

```
Dr  <expense account> <name>      <amount>
  Cr  <accrued liability account> <amount>
Memo: <accrual> — <period> accrual per <support>
```

When the policy says it reverses, add "reverses on day 1 of next period" to the memo.

## Output

The schedule table, then the journal drafts, then the total. **Do not post** — staged for controller sign-off.

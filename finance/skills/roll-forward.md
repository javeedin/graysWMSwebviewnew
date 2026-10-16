---
name: roll-forward
title: Roll-forward
description: Build a roll-forward for a balance sheet account or statement line — opening balance plus movements equals closing balance, each component tied to the ledger and split by journal source. Use for the month-end close package and audit support.
source: anthropic-adapted
---

# Roll-forward

For an account, an account group or a balance sheet line (resolve a line to its accounts with `template_rows`), for
the filter's entity and period (or a range the user gives), tie opening to closing.

## Structure

```
Opening balance (end of the previous period)        X
  + Movements by journal source / category          A1, A2 …   (debits and credits)
  ± Reclasses / adjustments (category Adjustment, Reclass) E
  ± Revaluation / FX (source Revaluation, category Revaluation) F
Closing balance (end of the period)                 Y
```

## Tie each line

- **Opening** — fin_balances.begin_bal of the first period (scenario ACTUAL).
- **Movements** — from fin_journals grouped by je_source / je_category (dr, cr) when journals are loaded for the
  period; otherwise period_dr and period_cr from fin_balances as one line "Movements (journals not loaded)".
- **Closing** — fin_balances.end_bal of the last period.

The schedule **must foot**: `X + ΣA + E + F = Y`. Compare the journal total with period_net in fin_balances; a
difference is an unexplained item (e.g. journals not fully loaded) — show it, never plug it.

## Output

The roll-forward table with a "ties to" column (the query or table behind each line), a foot check (pass / fail and
the unexplained difference) and the three biggest journals of the period with links [journal 123](je:123).

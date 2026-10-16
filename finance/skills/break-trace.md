---
name: break-trace
title: Break trace
description: Root-cause one reconciliation break — follow the ledger journals and the subledger records behind it, state what differs and why, and who should act. Use after gl-recon has found a break.
source: anthropic-adapted
---

# Root-cause a break

Given one break (control account, entity, GL amount, subledger amount, likely cause):

## Trace

1. **GL side** — `run_sql` on fin_journals for the account and the last 2 periods: manual journals, reversals,
   reclasses, revaluations, the biggest lines with je_id, source, category, created_by, posted_at.
2. **Subledger side** — `fusion_sql` (read-only): the open items closest to the difference (same amount, or the
   largest items created / updated around the period end), with their accounting status (e.g. accounted / not
   accounted, posted flags on the distribution or XLA events where the columns exist).
3. **Diff** — posting date vs cut-off, account, amount, sign, currency. The attribute that differs is usually the cause.

## Statement

One sentence: "<side> <did what> because <reason>", e.g.
- "Manual GL journal 48213 (posted 31-Aug by J. Doe) moved 120,000 into trade payables with no matching supplier invoice — reverse or support it."
- "Invoice INV-7781 for 45,300 is validated in Payables but not accounted — run Create Accounting; clears on posting."

## Output

A table per traced break: root cause · owner (accounts payable / receivable / GL / IT) · expected clear date ·
action (monitor | adjust | raise ticket). This skill diagnoses — it never posts.

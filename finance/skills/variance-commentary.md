---
name: variance-commentary
title: Variance commentary
description: Write flux commentary for every income statement and balance sheet line over threshold — current vs previous period, vs the same period last year and vs budget — with the driver explained from the underlying accounts, cost centres and journals. Use for the month-end close package and management reporting.
source: anthropic-adapted
---

# Variance commentary

For the filter's entity and period, produce a commentary table for the statement lines (use the statement lines in
the CONTEXT and `template_rows` for their accounts).

## Threshold

Read materiality with `close_settings` (percent and floor; default 5 % and 10,000). Comment a line when
|variance| ≥ max(percent × |line|, floor) against any comparison, or when the line is on the always-comment list
(default: revenue, staff costs, cash).

## For each flagged line

| Column | Content |
|---|---|
| Line | Statement line (link the biggest account: [6200 Freight](acct:6200)) |
| Current · Previous month · Last year · Budget | the values (skip a comparison that has no data and say so once) |
| Δ vs previous · Δ vs budget | amount and % |
| Driver | ONE sentence on WHY, from the activity behind the line |

A driver explains why, not what: "Freight up 1.2M on 3 extra container shipments for the August promotion" — not
"Freight increased 1.2M (18 %)".

## Finding the driver

Break the line down with `run_sql`: by account, then cost centre, then journal source / category, then the largest
journals (fin_journals, when loaded) and their descriptions. If the data does not show the driver, write
"driver unclear — flag for controller" — never invent one.

## Output

The commentary table, then 3–5 sentences on the period's biggest movers.

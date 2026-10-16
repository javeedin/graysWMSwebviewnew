# Finance Lens skills — notice

The skills in this folder marked `source: anthropic-adapted` are adapted from **Claude for Financial Services**
(https://github.com/anthropics/financial-services-plugins, commit 574ed3624aebd0418c7e96cd101262f30210ab26),
Copyright Anthropic, licensed under the Apache License 2.0 — see `LICENSE-anthropic-financial-services-plugins.txt`.

Changes made for Finance Lens: the workflows were rewritten for a corporate general ledger synced from Oracle Fusion
(instead of fund administration / MCP data connectors): the data comes from the Finance Lens tools `run_sql`
(fin_balances, fin_journals, fin_accounts …), `fusion_sql` (read-only Oracle Fusion subledgers), `close_settings`
(materiality, always-comment lines, accrual policy) and `template_rows`; outputs are Markdown tables for the close
package (exported to Excel by the page) and journal drafts that are never posted; the GL ↔ subledger reconciliation
was changed from trade-date positions to control accounts (payables, receivables, inventory) against Fusion subledgers.

Skills with `source: grays` are written for Grays. Custom skills an admin adds live in the Finance Lens data folder
(`skills\*.md`) and override a skill with the same name.

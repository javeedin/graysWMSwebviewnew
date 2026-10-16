"""Sales Lens — sales opportunity intelligence on Oracle Fusion order lines.

Raw extracts (newline-delimited JSON written by the desktop host, or by ``demo``) → one DuckDB file with the clean lines,
customer × item × month history, expected-demand baselines, missed opportunities with causes and evidence, customer and
order-line risk scores, cross-sell, price response, simulations, model registry and data-quality results.
"""

VERSION = "1.0.0"

"""What-if simulation (RD section 12): baseline (last 12 months) vs a scenario of business assumptions.

Every result is an estimate: price / discount effects use each item's price response (estimated where prices varied, assumed
otherwise), operational levers win back a share of the lost sales the opportunity engine attributed to that cause. The output
names its assumptions, gives a low / high range and the model version it ran on.
"""
import numpy as np
import pandas as pd

LEVERS = {
    "inventoryPct": "More stock (% of the items' normal volume)",
    "fillRatePts": "Better fill rate (points)",
    "leadTimeDays": "Shorter lead time (days)",
    "pricePct": "Price change (%)",
    "discountPts": "Discount change (points)",
    "cancelReductionPct": "Fewer cancellations (%)",
    "returnReductionPct": "Fewer returns (%)",
    "recoveryRatePct": "Lost sales won back by the team (%)",
    "substitution": "Offer substitutes when out of stock",
}


def run(db, scenario, version="?"):
    """db: a duckdb connection on the Sales Lens file; scenario: dict of levers + scope."""
    s = {k: float(scenario.get(k) or 0) for k in LEVERS if k != "substitution"}
    subst = bool(scenario.get("substitution"))
    scope = scenario.get("scope") or {}
    where, params = ["l.is_return = FALSE", "l.month > (SELECT MAX(month) FROM sl_lines) - 100"], []
    if scope.get("profitCenter"):
        where.append("i.profit_center = ?")
        params.append(scope["profitCenter"])
    if scope.get("items"):
        where.append("l.item_number IN (" + ",".join("?" * len(scope["items"])) + ")")
        params += list(scope["items"])
    if scope.get("customers"):
        where.append("l.account_number IN (" + ",".join("?" * len(scope["customers"])) + ")")
        params += list(scope["customers"])
    if scope.get("bu"):
        where.append("l.bu_id = ?")
        params.append(str(scope["bu"]))
    w = " AND ".join(where)
    items = db.execute(f"""SELECT l.item_id, MAX(l.item_number) item, MAX(i.profit_center) pc, SUM(l.revenue) rev, SUM(l.margin) mar, SUM(l.qty) qty,
                                 SUM(CASE WHEN l.oos_cancel > 0 THEN l.oos_cancel * l.net_price ELSE 0 END) oos_val,
                                 SUM(CASE WHEN l.oos_cancel = 0 THEN l.cancel_value ELSE 0 END) cancel_val,
                                 SUM(CASE WHEN l.partial THEN GREATEST(l.qty - COALESCE(l.shipped_qty, 0), 0) * l.net_price ELSE 0 END) short_val,
                                 SUM(CASE WHEN l.done THEN l.qty END) done_qty, SUM(CASE WHEN l.done THEN COALESCE(l.shipped_qty, 0) END) shipped,
                                 COUNT(DISTINCT l.account_number) customers, AVG(l.discount_pct) disc
                            FROM sl_lines l LEFT JOIN sl_items i ON i.item_id = l.item_id WHERE {w} GROUP BY l.item_id""", params).df()
    ret = db.execute(f"""SELECT SUM(l.return_value) v FROM sl_lines l LEFT JOIN sl_items i ON i.item_id = l.item_id
                          WHERE l.is_return AND l.month > (SELECT MAX(month) FROM sl_lines) - 100
                          {('AND ' + ' AND '.join(where[2:])) if len(where) > 2 else ''}""", params[0:]).fetchone()[0] or 0.0
    price = db.execute("SELECT item_id, used, se, source FROM sl_price").df() if _has(db, "sl_price") else pd.DataFrame(columns=["item_id", "used", "se", "source"])
    opp_where = ["1 = 1"]
    op = []
    if scope.get("profitCenter"):
        opp_where.append("profit_center = ?")
        op.append(scope["profitCenter"])
    if scope.get("items"):
        opp_where.append("item IN (" + ",".join("?" * len(scope["items"])) + ")")
        op += list(scope["items"])
    if scope.get("customers"):
        opp_where.append("account_number IN (" + ",".join("?" * len(scope["customers"])) + ")")
        op += list(scope["customers"])
    opps = db.execute("SELECT * FROM sl_opps WHERE " + " AND ".join(opp_where), op).df() if _has(db, "sl_opps") else pd.DataFrame()
    win = 3
    if len(opps):
        win = int(max(1, (opps["window_to"].max() // 100 * 12 + opps["window_to"].max() % 100) - (opps["window_from"].min() // 100 * 12 + opps["window_from"].min() % 100) + 1))
    ann = 12.0 / win

    base_rev, base_mar, base_qty = float(items["rev"].sum()), float(items["mar"].sum()), float(items["qty"].sum())
    mpct = base_mar / base_rev if base_rev else 0.25
    parts, lo_hi = [], []

    def add(key, label, d_rev, d_mar, unc, note):
        parts.append({"lever": key, "label": label, "delta_revenue": round(d_rev, 2), "delta_margin": round(d_mar, 2), "note": note})
        lo_hi.append((d_rev, d_mar, unc))

    # price and discount through each item's price response
    if s["pricePct"] or s["discountPts"]:
        el = dict(zip(price["item_id"], price["used"])) if len(price) else {}
        se = dict(zip(price["item_id"], price["se"])) if len(price) else {}
        dr = dm = dr_lo = dr_hi = 0.0
        for r in items.itertuples(index=False):
            if r.qty <= 0 or r.rev <= 0:
                continue
            p = r.rev / r.qty
            c = (r.rev - r.mar) / r.qty
            disc = float(r.disc or 0)
            x = (1 + s["pricePct"] / 100) * (1 - s["discountPts"] / max(1.0, 100 - disc)) - 1
            e = float(el.get(r.item_id, scenario.get("defaultElasticity", -1.2)))
            u = se.get(r.item_id)
            u = 0.5 if u is None or (isinstance(u, float) and np.isnan(u)) else float(u)

            def outcome(ee, r=r, x=x, p=p, c=c):
                q2 = r.qty * (1 + x) ** ee
                return q2 * p * (1 + x) - r.rev, q2 * (p * (1 + x) - c) - r.mar

            a, b = outcome(e)
            dr += a
            dm += b
            l1, h1 = outcome(e - 1.64 * u)[1], outcome(e + 1.64 * u)[1]
            dr_lo += min(l1, h1)
            dr_hi += max(l1, h1)
        add("price", f"Price {s['pricePct']:+.1f} % / discount {s['discountPts']:+.1f} pts", dr, dm, None,
            "each item's price response (estimated where its price varied, else assumed)")
        lo_hi[-1] = (dr, dm, (dr_lo, dr_hi))
    # operational levers win back part of the lost sales the engine attributed to that cause (annualised)
    if len(opps):
        by_cause = opps.groupby("primary_cause").agg(rev=("lost_revenue", "sum"), mar=("lost_margin", "sum"))
    else:
        by_cause = pd.DataFrame(columns=["rev", "mar"])

    def lost(cause):
        if cause in by_cause.index:
            return float(by_cause.loc[cause, "rev"]) * ann, float(by_cause.loc[cause, "mar"]) * ann
        return 0.0, 0.0

    if s["inventoryPct"]:
        lr, lm = lost("STOCKOUT")
        oos = float(items["oos_val"].sum())
        vol = float(items["rev"].sum())
        need = (lr + oos) / vol * 100 if vol else 0
        share = min(1.0, s["inventoryPct"] / need) * 0.8 if need > 0 else 0
        add("inventoryPct", f"Stock +{s['inventoryPct']:.0f} %", (lr + oos) * share, (lm + oos * mpct) * share, 0.3,
            f"stock-out losses {lr + oos:,.0f} a year; +{s['inventoryPct']:.0f} % stock covers {min(100, s['inventoryPct'] / need * 100) if need else 0:.0f} % of them, 80 % turned into sales")
    if subst:
        lr, lm = lost("STOCKOUT")
        add("substitution", "Substitutes offered", lr * 0.3, lm * 0.3, 0.4, "30 % of stock-out losses taken by a substitute the customer accepts")
    if s["fillRatePts"]:
        short = float(items["short_val"].sum()) + float(items["cancel_val"].sum())
        dq, sh = float(items["done_qty"].sum() or 0), float(items["shipped"].sum() or 0)
        fill = sh / dq * 100 if dq else 100
        lr, lm = lost("PARTIAL")
        share = min(1.0, s["fillRatePts"] / max(0.5, 100 - fill))
        add("fillRatePts", f"Fill rate +{s['fillRatePts']:.1f} pts (now {fill:.1f} %)", (short + lr) * share * 0.7, ((short * mpct) + lm) * share * 0.7, 0.3,
            "shortfalls + partial-delivery losses, 70 % recovered")
    if s["leadTimeDays"]:
        lr, lm = lost("LATE")
        late = opps.loc[opps["primary_cause"] == "LATE"] if len(opps) else opps
        avg = 3.0
        share = min(1.0, s["leadTimeDays"] / avg) * 0.6
        add("leadTimeDays", f"Lead time −{s['leadTimeDays']:.0f} day(s)", lr * share, lm * share, 0.35,
            f"losses from late deliveries ({len(late)} opportunity(ies)), 60 % recovered when on time")
    if s["cancelReductionPct"]:
        cv = float(items["cancel_val"].sum())
        add("cancelReductionPct", f"Cancellations −{s['cancelReductionPct']:.0f} %", cv * s["cancelReductionPct"] / 100, cv * s["cancelReductionPct"] / 100 * mpct, 0.25,
            "cancelled order value (not for stock) kept")
    if s["returnReductionPct"]:
        add("returnReductionPct", f"Returns −{s['returnReductionPct']:.0f} %", float(ret) * s["returnReductionPct"] / 100, float(ret) * s["returnReductionPct"] / 100 * mpct, 0.25,
            "credit for returned goods kept")
    if s["recoveryRatePct"] and len(opps):
        handled = {"STOCKOUT"} if s["inventoryPct"] else set()
        rest = opps[~opps["primary_cause"].isin(handled)]
        lr, lm = float(rest["lost_revenue"].sum()) * ann, float(rest["lost_margin"].sum()) * ann
        add("recoveryRatePct", f"Team wins back {s['recoveryRatePct']:.0f} %", lr * s["recoveryRatePct"] / 100, lm * s["recoveryRatePct"] / 100, 0.3,
            f"{len(rest)} open opportunities worth {lr:,.0f} a year")

    d_rev = sum(p["delta_revenue"] for p in parts)
    d_mar = sum(p["delta_margin"] for p in parts)
    lo = hi = 0.0
    for _r, m, unc in lo_hi:
        if isinstance(unc, tuple):
            lo += unc[0]
            hi += unc[1]
        else:
            u = unc or 0.3
            lo += m * (1 - u)
            hi += m * (1 + u)
    impacted_items = items.assign(share=items["rev"] / max(1.0, base_rev)).sort_values("rev", ascending=False)
    cust_n = int(db.execute(f"SELECT COUNT(DISTINCT l.account_number) FROM sl_lines l LEFT JOIN sl_items i ON i.item_id = l.item_id WHERE {w}", params).fetchone()[0])
    open_orders = int(db.execute("SELECT COUNT(DISTINCT header_id) FROM sl_lines WHERE open").fetchone()[0]) if s["fillRatePts"] or s["leadTimeDays"] else 0
    return {
        "estimate": True,
        "label": "Estimate — not a guaranteed outcome",
        "scenario": scenario,
        "baseline": {"revenue": round(base_rev, 2), "margin": round(base_mar, 2), "qty": round(base_qty, 2), "period": "last 12 months"},
        "result": {"revenue": round(base_rev + d_rev, 2), "margin": round(base_mar + d_mar, 2)},
        "delta": {"revenue": round(d_rev, 2), "margin": round(d_mar, 2), "revenue_pct": round(d_rev / base_rev * 100, 2) if base_rev else 0,
                  "margin_pct": round(d_mar / base_mar * 100, 2) if base_mar else 0},
        "range": {"margin_low": round(min(lo, hi), 2), "margin_high": round(max(lo, hi), 2)},
        "levers": parts,
        "impacted": {"customers": cust_n, "items": int(len(items)), "open_orders": open_orders, "opportunities": int(len(opps)),
                     "top_items": impacted_items.head(10)[["item", "pc", "rev", "customers"]].round(2).to_dict("records")},
        "assumptions": [p["note"] for p in parts] + ["baseline = the last 12 months of clean order lines in the scope",
                                                     "operational levers use the lost sales of the latest opportunity run, annualised"],
        "model_version": version,
    }


def _has(db, t):
    return bool(db.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?", [t]).fetchone()[0])

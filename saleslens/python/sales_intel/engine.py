"""Expected demand, missed opportunities, causes with evidence, scores and the next best action (RD sections 10, 13, 14).

Grain: customer × item × month. The expected quantity of a month is the deseasonalised average of the 12 months before it
(from the pair's first purchase), times the month's seasonal index (the item's own when it has 24+ months of history, else its
profit centre's, shrunk half-way to 1). Opportunities freeze the baseline at the start of the analysis window, so a change
that started inside the window does not lower its own expectation.
"""
import hashlib
from datetime import date, timedelta

import numpy as np
import pandas as pd

from .util import add_months, current_month, money, month_label, months_between

CAUSES = {
    "STOCKOUT": "Stock-out / not enough available",
    "PARTIAL": "Partial shipment / backorder",
    "LATE": "Late shipment or delivery",
    "CANCEL": "Order lines cancelled",
    "PRICE_UP": "Price increase",
    "DISCOUNT_DOWN": "Discount reduced",
    "MARGIN_LEAK": "Excessive discount / margin leakage",
    "RETURNS": "High returns / quality issue",
    "PAYMENT": "Payment or credit problem",
    "CYCLE": "Customer buys less often",
    "INACTIVE": "Customer stopped buying",
    "SUBSTITUTION": "Switched to another product",
    "SEASONAL": "Market-wide drop for the item",
    "LIFECYCLE": "Product decline / discontinued",
    "UNKNOWN": "Unknown / not enough evidence",
}

ACTIONS = {
    "STOCKOUT": ("Supply chain + sales rep", "Reserve the available stock of {item} or expedite the next receipt, call {cust} to confirm their demand{alt}."),
    "PARTIAL": ("Supply chain", "Ship the backordered quantity of {item} and confirm the balance with {cust}."),
    "LATE": ("Logistics + sales rep", "Agree a firm delivery slot with {cust}; their deliveries ran {late} days late — check the route and warehouse."),
    "CANCEL": ("Sales rep", "Ask {cust} why {item} lines were cancelled and re-offer the quantity."),
    "PRICE_UP": ("Sales rep + pricing", "Review the price {cust} pays for {item} (up {price}); propose an approved deal if the account is worth it."),
    "DISCOUNT_DOWN": ("Sales rep + pricing", "{cust} lost {disc} points of discount on {item}; check whether a promotion ended and offer an approved one."),
    "MARGIN_LEAK": ("Pricing", "Discounts on {item} for {cust} grew without more volume — review the deal."),
    "RETURNS": ("Quality + sales rep", "{cust} returned {ret} of {item}; check the batches and the reasons before pushing volume."),
    "PAYMENT": ("Credit control + sales rep", "Agree a payment plan with {cust} (overdue {overdue}) before asking for more orders."),
    "CYCLE": ("Sales rep", "{cust} orders less often; agree a standing order or visit schedule for {item}."),
    "INACTIVE": ("Sales manager", "{cust} stopped buying across the range — visit them this week."),
    "SUBSTITUTION": ("Sales rep", "{cust} moved from {item} to {sub}; protect the margin or win {item} back."),
    "SEASONAL": ("Sales manager", "The whole market for {item} fell; keep {cust} warm, low priority."),
    "LIFECYCLE": ("Product manager", "{item} is declining for everybody; offer {cust} the replacement product{alt}."),
    "UNKNOWN": ("Sales rep", "Call {cust} to confirm their demand for {item}."),
}


def tier_of(values):
    """ABC by cumulative share: A = first 80 %, B = next 15 %, C = the rest."""
    s = values.sort_values(ascending=False)
    tot = s.sum()
    out = pd.Series("C", index=s.index)
    if tot <= 0:
        return out
    cum = s.cumsum() / tot
    out[cum <= 0.8] = "A"
    out[(cum > 0.8) & (cum <= 0.95)] = "B"
    first = s.index[0]
    out[first] = "A"
    return out


def windows(cfg, last_month=None):
    cur = current_month()
    lf = last_month or (cur if cfg.get("includeCurrentMonth") else add_months(cur, -1))
    n = max(1, int(cfg.get("analysisMonths", 3)))
    w = [add_months(lf, -i) for i in range(n - 1, -1, -1)]
    return lf, w


def monthly(lines):
    """customer × item × month facts from the clean lines."""
    sale = lines[~lines["IS_RETURN"]].assign(_late=lambda d: (d["LATE_DAYS"] > 0).astype(int), _lated=lambda d: d["LATE_DAYS"].clip(lower=0).fillna(0))
    g = sale.groupby(["ACCOUNT_NUMBER", "ITEM_ID", "MONTH"])
    cm = g.agg(qty=("QTY", "sum"), demand_qty=("DEMAND_QTY", "sum"), revenue=("REVENUE", "sum"), margin=("MARGIN", "sum"),
               cancel_qty=("CANCEL_QTY", "sum"), cancel_value=("CANCEL_VALUE", "sum"), oos_cancel=("OOS_CANCEL", "sum"),
               lines=("FULFILL_LINE_ID", "size"), done_lines=("DONE", "sum"), partial_lines=("PARTIAL", "sum"),
               late_lines=("_late", "sum"), late_days=("_lated", "sum"),
               orders=("HEADER_ID", "nunique"), list_value=("LIST_PRICE", "size")).reset_index()
    lv = sale.assign(_lv=sale["QTY"] * sale["LIST_PRICE"]).groupby(["ACCOUNT_NUMBER", "ITEM_ID", "MONTH"])["_lv"].sum().reset_index()
    cm = cm.drop(columns=["list_value"]).merge(lv.rename(columns={"_lv": "list_value"}), on=["ACCOUNT_NUMBER", "ITEM_ID", "MONTH"], how="left")
    ret = lines[lines["IS_RETURN"]].groupby(["ACCOUNT_NUMBER", "ITEM_ID", "MONTH"]).agg(return_qty=("RETURN_QTY", "sum"), return_value=("RETURN_VALUE", "sum")).reset_index()
    cm = cm.merge(ret, on=["ACCOUNT_NUMBER", "ITEM_ID", "MONTH"], how="outer")
    for c in cm.columns:
        if c not in ("ACCOUNT_NUMBER", "ITEM_ID", "MONTH"):
            cm[c] = cm[c].fillna(0)
    cm["MONTH"] = cm["MONTH"].astype(int)
    return cm


def seasonal_index(cm, items, lf):
    """month-of-year index per item (24+ months) else per profit centre, shrunk half-way to 1."""
    start = add_months(lf, -35)
    h = cm[(cm["MONTH"] >= start) & (cm["MONTH"] <= lf)]
    pc = dict(zip(items["ITEM_ID"], items["PROFIT_CENTER"].fillna("").astype(str))) if len(items) else {}

    def idx_of(series):
        s = series.groupby(series.index % 100).mean()
        if len(s) < 12 or s.mean() <= 0:
            return None
        raw = s / s.mean()
        return {int(k): float(1 + 0.5 * (v - 1)) for k, v in raw.items()}

    by_item = {}
    it = h.groupby(["ITEM_ID", "MONTH"])["qty"].sum()
    for item, ser in it.groupby(level=0):
        ser = ser.droplevel(0)
        if ser.index.nunique() >= 24:
            by_item[item] = idx_of(ser)
    by_pc = {}
    h2 = h.assign(PC=h["ITEM_ID"].map(pc).fillna(""))
    for p, ser in h2.groupby(["PC", "MONTH"])["qty"].sum().groupby(level=0):
        ser = ser.droplevel(0)
        if ser.index.nunique() >= 24:
            by_pc[p] = idx_of(ser)
    return by_item, by_pc, pc


def expected_history(cm, items, lf, cfg):
    """dense pair × month series (36 months to lf) with the rolling expected quantity (the chart line) and the spread.

    Done as matrix arithmetic (pairs × months) with cumulative sums, so millions of order lines stay fast."""
    first_m = add_months(lf, -35)
    months = [add_months(first_m, i) for i in range(36)]
    mpos = {m: k for k, m in enumerate(months)}
    sub = cm[(cm["MONTH"] >= first_m) & (cm["MONTH"] <= lf)]
    active = sub[(sub["MONTH"] >= add_months(lf, -23)) & (sub["qty"] > 0)][["ACCOUNT_NUMBER", "ITEM_ID"]].drop_duplicates()
    by_item, by_pc, pc = seasonal_index(cm, items, lf)
    if not len(active):
        return pd.DataFrame(), by_item, by_pc, pc
    active = active.reset_index(drop=True)
    active["p"] = np.arange(len(active))
    sub = sub.merge(active, on=["ACCOUNT_NUMBER", "ITEM_ID"])
    P, T = len(active), len(months)
    cols = ["qty", "demand_qty", "revenue", "margin", "cancel_qty", "oos_cancel", "lines", "done_lines", "partial_lines", "return_qty", "list_value"]
    mats = {c: np.zeros((P, T)) for c in cols}
    pi, ti = sub["p"].values, sub["MONTH"].map(mpos).values
    for c in cols:
        np.add.at(mats[c], (pi, ti), sub[c].values.astype(float))
    q = mats["qty"]
    bought = q > 0
    first = np.where(bought.any(axis=1), bought.argmax(axis=1), T)
    live = np.arange(T)[None, :] >= first[:, None]
    season = np.ones((P, T))
    for k, (item) in enumerate(active["ITEM_ID"].values):
        d = by_item.get(item) or by_pc.get(pc.get(item, "")) or None
        if d:
            season[k] = [d.get(m % 100, 1.0) for m in months]
    des = np.where(live, q / np.clip(season, 0.2, None), 0.0)
    cnt = live.astype(float)
    pad = np.zeros((P, 1))
    cs, cs2, cc = (np.concatenate([pad, np.cumsum(x, axis=1)], axis=1) for x in (des, des ** 2, cnt))
    cb = np.concatenate([pad, np.cumsum(bought.astype(float), axis=1)], axis=1)
    lo_idx = np.clip(np.arange(T) - 12, 0, None)
    n = cc[:, np.arange(T)] - cc[:, lo_idx]
    s1 = cs[:, np.arange(T)] - cs[:, lo_idx]
    s2 = cs2[:, np.arange(T)] - cs2[:, lo_idx]
    hist = cb[:, np.arange(T)] - cb[:, lo_idx]
    with np.errstate(invalid="ignore", divide="ignore"):
        level = np.where(n >= 3, s1 / n, np.nan)
        var = np.where(n >= 3, s2 / n - level ** 2, np.nan)
    spread = np.sqrt(np.clip(var, 0, None))
    expected = level * season
    floor = np.maximum(1.0, 0.25 * np.nan_to_num(level))
    sd = np.maximum(np.nan_to_num(spread) * season, floor)
    keep = live
    rows, tcol = np.nonzero(keep)
    dense = pd.DataFrame({"ACCOUNT_NUMBER": active["ACCOUNT_NUMBER"].values[rows], "ITEM_ID": active["ITEM_ID"].values[rows],
                          "MONTH": np.array(months)[tcol], "season": season[rows, tcol], "level": level[rows, tcol],
                          "spread": spread[rows, tcol], "hist_months": hist[rows, tcol], "expected": expected[rows, tcol], "sd": sd[rows, tcol]})
    for c in cols:
        dense[c] = mats[c][rows, tcol]
    dense["deseason"] = des[rows, tcol]
    dense["lo"] = (dense["expected"] - 1.64 * dense["sd"]).clip(lower=0)
    dense["hi"] = dense["expected"] + 1.64 * dense["sd"]
    return dense, by_item, by_pc, pc


def backtest(dense, lf, tiers, pc):
    """the expected line against what really happened in the 12 months before the analysis window: WAPE, MAE, bias."""
    lo, hi = add_months(lf, -14), add_months(lf, -3)
    b = dense[(dense["MONTH"] >= lo) & (dense["MONTH"] <= hi) & dense["expected"].notna() & (dense["hist_months"] >= 3)].copy()
    if not len(b):
        return [], {}
    b["err"] = b["expected"] - b["qty"]
    out = []

    def met(d, seg, val):
        a = d["qty"].sum()
        if a <= 0:
            return
        out.append({"segment": seg, "value": val, "pairs": int(d.groupby(["ACCOUNT_NUMBER", "ITEM_ID"]).ngroups), "months": int(d["MONTH"].nunique()),
                    "wape": round(float(d["err"].abs().sum() / a), 4), "mae": round(float(d["err"].abs().mean()), 3),
                    "bias": round(float(d["err"].sum() / a), 4),
                    "coverage": round(float(((d["qty"] >= d["lo"]) & (d["qty"] <= d["hi"])).mean()), 4)})

    met(b, "ALL", "all")
    b["tier"] = b["ACCOUNT_NUMBER"].map(tiers).fillna("C")
    for t, d in b.groupby("tier"):
        met(d, "customer tier", t)
    b["pc"] = b["ITEM_ID"].map(pc).fillna("")
    for p, d in b.groupby("pc"):
        met(d, "profit centre", p or "(none)")
    overall = out[0] if out else {}
    return out, overall


def opp_id(acct, item, w_end):
    return hashlib.sha256(f"{acct}|{item}|{w_end}".encode()).hexdigest()[:16]  # an id, not a secret; SHA-256 so scanners do not flag it


def find(lines, cm, dense, ctx, cfg):
    """the analysis window's gaps → opportunities with causes, evidence, value, score and the next best action."""
    lf, w = ctx["lf"], ctx["window"]
    w0, n_w = w[0], len(w)
    base_from, base_to = add_months(w0, -12), add_months(w0, -1)
    items, customers = ctx["items"], ctx["customers"]
    inum = dict(zip(items["ITEM_ID"], items["ITEM_NUMBER"].astype(str)))
    idesc = dict(zip(items["ITEM_ID"], items["DESCRIPTION"].fillna("").astype(str)))
    istatus = dict(zip(items["ITEM_ID"], items["ITEM_STATUS"].fillna("").astype(str)))
    pc = ctx["pc"]
    cname = dict(zip(customers["ACCOUNT_NUMBER"].astype(str), customers["CUSTOMER_NAME"].fillna("").astype(str)))
    tiers = ctx["tiers"]
    mins = float(cfg.get("minDropPct", 30)) / 100

    d = dense
    base = d[d["MONTH"] == w0][["ACCOUNT_NUMBER", "ITEM_ID", "level", "hist_months", "spread"]].rename(
        columns={"level": "base_level", "spread": "base_spread", "hist_months": "base_hist"})
    win = d[d["MONTH"].isin(w)].merge(base, on=["ACCOUNT_NUMBER", "ITEM_ID"], how="inner")
    win = win[win["base_level"].notna() & (win["base_hist"] >= float(cfg.get("minHistoryMonths", 4)))]
    if not len(win):
        return pd.DataFrame(), {}
    win["exp_frozen"] = win["base_level"] * win["season"]
    agg = win.groupby(["ACCOUNT_NUMBER", "ITEM_ID"]).agg(
        expected=("exp_frozen", "sum"), actual=("qty", "sum"), demand=("demand_qty", "sum"), revenue_w=("revenue", "sum"), margin_w=("margin", "sum"),
        cancel_w=("cancel_qty", "sum"), oos_w=("oos_cancel", "sum"), lines_w=("lines", "sum"), done_w=("done_lines", "sum"),
        partial_w=("partial_lines", "sum"), returns_w=("return_qty", "sum"), list_w=("list_value", "sum"), spread=("base_spread", "first"),
        hist=("base_hist", "first"), season=("season", "mean"), last_qty=("qty", "last")).reset_index()
    agg["gap"] = agg["expected"] - agg["actual"]
    agg["drop"] = np.where(agg["expected"] > 0, agg["gap"] / agg["expected"], 0)
    sd = np.maximum(agg["spread"].fillna(0) * agg["season"], np.maximum(1.0, 0.25 * agg["expected"] / n_w))
    agg["z"] = agg["gap"] / (sd * np.sqrt(n_w))

    bw = cm[(cm["MONTH"] >= base_from) & (cm["MONTH"] <= base_to)].groupby(["ACCOUNT_NUMBER", "ITEM_ID"]).agg(
        bq=("qty", "sum"), brev=("revenue", "sum"), bmar=("margin", "sum"), blist=("list_value", "sum"), bret=("return_qty", "sum"),
        bord=("orders", "sum"), bmonths=("qty", lambda s: int((s > 0).sum()))).reset_index()
    agg = agg.merge(bw, on=["ACCOUNT_NUMBER", "ITEM_ID"], how="left").fillna({"bq": 0, "brev": 0, "bmar": 0, "blist": 0, "bret": 0, "bord": 0, "bmonths": 0})
    agg["base_price"] = np.where(agg["bq"] > 0, agg["brev"] / agg["bq"], 0)
    agg["base_unit_margin"] = np.where(agg["bq"] > 0, agg["bmar"] / agg["bq"], 0)
    agg["win_price"] = np.where(agg["actual"] > 0, agg["revenue_w"] / agg["actual"], np.nan)
    agg["base_disc"] = np.where(agg["blist"] > 0, (agg["blist"] - agg["brev"]) / agg["blist"] * 100, 0)
    agg["win_disc"] = np.where(agg["list_w"] > 0, (agg["list_w"] - agg["revenue_w"]) / agg["list_w"] * 100, np.nan)
    agg["lost_revenue"] = agg["gap"].clip(lower=0) * agg["base_price"]
    agg["lost_margin"] = agg["gap"].clip(lower=0) * agg["base_unit_margin"]

    flag = (agg["gap"] > 0) & (agg["drop"] >= mins) & (agg["z"] >= float(cfg.get("zThreshold", 1.2))) & (agg["lost_revenue"] >= float(cfg.get("minGapValue", 1000)))
    opp = agg[flag].copy()
    stats = {"pairs": int(len(agg)), "flagged": int(len(opp)), "window": [int(x) for x in w]}
    if not len(opp):
        return pd.DataFrame(), stats

    # evidence tables
    sale = lines[~lines["IS_RETURN"]]
    item_w = cm[cm["MONTH"].isin(w)].groupby("ITEM_ID").agg(iq=("qty", "sum"), idem=("demand_qty", "sum"), ioos=("oos_cancel", "sum"), icancel=("cancel_qty", "sum"))
    item_exp = win.groupby("ITEM_ID")["exp_frozen"].sum()
    item_act = win.groupby("ITEM_ID")["qty"].sum()
    oos_log = ctx["oos"]
    oos_items = {}
    if len(oos_log):
        lg = oos_log.copy()
        lg["MONTH"] = pd.to_datetime(lg["LOGGED_AT"].astype("string").str.slice(0, 10), errors="coerce").pipe(lambda s: s.dt.year * 100 + s.dt.month)
        lg = lg[lg["MONTH"].isin(w) & lg["RESULT"].astype("string").str.upper().fillna("").isin(["DONE", ""])]
        num2id = {v: k for k, v in inum.items()}
        for it_num, n in lg.groupby("ITEM").size().items():
            oos_items[num2id.get(str(it_num), str(it_num))] = int(n)
    onhand_zero = set()
    oh = ctx["onhand"]
    if len(oh):
        lastday = oh["DAY"].max()
        z = oh[oh["DAY"] == lastday].groupby("ITEM_ID")["QTY"].apply(lambda s: pd.to_numeric(s, errors="coerce").sum())
        onhand_zero = {str(k).split(".")[0] for k, v in z.items() if v <= 0}
    cust_w = cm[cm["MONTH"].isin(w)].groupby("ACCOUNT_NUMBER")["revenue"].sum()
    cust_last = cm[cm["MONTH"] == w[-1]].groupby("ACCOUNT_NUMBER")["revenue"].sum()
    cust_bmonths = cm[(cm["MONTH"] >= base_from) & (cm["MONTH"] <= base_to) & (cm["revenue"] > 0)].groupby("ACCOUNT_NUMBER")["MONTH"].nunique()
    cust_b = cm[(cm["MONTH"] >= base_from) & (cm["MONTH"] <= base_to)].groupby("ACCOUNT_NUMBER")["revenue"].sum() * n_w / 12
    late_from = add_months(w0, -3)
    lt = sale[(sale["MONTH"] >= late_from) & (sale["MONTH"] <= lf) & sale["DONE"] & sale["LATE_DAYS"].notna()]
    cust_late = lt.groupby("ACCOUNT_NUMBER").agg(late_share=("LATE_DAYS", lambda s: float((s > float(cfg.get("lateDays", 2))).mean())),
                                                 late_avg=("LATE_DAYS", lambda s: float(s[s > 0].mean()) if (s > 0).any() else 0.0))
    ord_w = sale[sale["MONTH"].isin(w)].groupby("ACCOUNT_NUMBER")["ORDERED_DATE"].nunique() / n_w
    ord_b = sale[(sale["MONTH"] >= base_from) & (sale["MONTH"] <= base_to)].groupby("ACCOUNT_NUMBER")["ORDERED_DATE"].nunique() / 12
    ar = ctx["ar"]
    armap = {}
    if len(ar):
        for _, r in ar.iterrows():
            armap[str(r["ACCOUNT_NUMBER"])] = (float(pd.to_numeric(r["OVERDUE"], errors="coerce") or 0), float(pd.to_numeric(r["OVER90"], errors="coerce") or 0),
                                               str(r.get("CREDIT_HOLD") or "N").upper().startswith("Y"))
    # substitution: same customer, same profit centre, items that grew in the window vs base
    grow = cm[cm["MONTH"].isin(w)].groupby(["ACCOUNT_NUMBER", "ITEM_ID"])["revenue"].sum().sub(
        cm[(cm["MONTH"] >= base_from) & (cm["MONTH"] <= base_to)].groupby(["ACCOUNT_NUMBER", "ITEM_ID"])["revenue"].sum() * n_w / 12, fill_value=0)
    grow_accts = set(grow.index.get_level_values(0))
    pair_bu = sale.groupby(["ACCOUNT_NUMBER", "ITEM_ID"])["BU_ID"].agg(lambda x: x.mode().iloc[0] if len(x.mode()) else "").to_dict()
    owner = sale.sort_values("ORDERED_DATE").groupby("ACCOUNT_NUMBER").agg(rep=("SALESPERSON", "last"), taker=("CREATED_BY", "last"))
    lr = cfg.get("recoverability") or {}

    rows = []
    for r in opp.itertuples(index=False):
        a, i = r.ACCOUNT_NUMBER, r.ITEM_ID
        ev, cs = [], {}
        exp_q, act_q = r.expected, r.actual
        drop_pct = r.drop * 100
        ev.append(f"Bought {act_q:,.0f} vs {exp_q:,.0f} expected ({-drop_pct:.0f} %) in {month_label(w[0])}–{month_label(w[-1])}")
        iw = item_w.loc[i] if i in item_w.index else None
        oos_share = float(iw["ioos"] / iw["idem"]) if iw is not None and iw["idem"] > 0 else 0.0
        if oos_share * 100 >= float(cfg.get("stockoutCancelPct", 10)) or oos_items.get(i) or i in onhand_zero or r.oos_w > 0:
            s = min(1.0, 0.4 + oos_share * 1.5 + (0.2 if oos_items.get(i) else 0) + (0.15 if i in onhand_zero else 0) + (0.2 if r.oos_w > 0 else 0))
            cs["STOCKOUT"] = s
            bits = []
            if oos_share > 0:
                bits.append(f"{oos_share * 100:.0f} % of the item's ordered quantity was cancelled for stock")
            if oos_items.get(i):
                bits.append(f"{oos_items[i]} line(s) cancelled OUT OF STOCK by the WMS")
            if i in onhand_zero:
                bits.append("no stock on hand at the last snapshot")
            ev.append("Stock: " + "; ".join(bits or ["this customer's lines were cancelled for stock"]))
        cust_cancel = r.cancel_w / r.demand if r.demand > 0 else 0
        if cust_cancel >= 0.15 and "STOCKOUT" not in cs:
            cs["CANCEL"] = min(1.0, 0.3 + cust_cancel)
            ev.append(f"{cust_cancel * 100:.0f} % of what they ordered was cancelled")
        part = r.partial_w / r.done_w if r.done_w > 0 else 0
        if part * 100 >= float(cfg.get("partialRatePct", 15)):
            cs["PARTIAL"] = min(1.0, 0.3 + part)
            ev.append(f"{part * 100:.0f} % of their deliveries were partial")
        if a in cust_late.index:
            ls, la = cust_late.loc[a, "late_share"], cust_late.loc[a, "late_avg"]
            if ls >= 0.3 and la >= float(cfg.get("lateDays", 2)):
                cs["LATE"] = min(1.0, 0.25 + ls * 0.5 + min(la, 10) / 20)
                ev.append(f"{ls * 100:.0f} % of deliveries late, {la:.1f} days on average")
        if r.base_price > 0 and not np.isnan(r.win_price):
            pchg = (r.win_price / r.base_price - 1) * 100
            if pchg >= float(cfg.get("priceUpPct", 3)):
                cs["PRICE_UP"] = min(1.0, 0.3 + pchg / 20)
                ev.append(f"net price up {pchg:.1f} %")
        if not np.isnan(r.win_disc):
            dd = r.base_disc - r.win_disc
            if dd >= float(cfg.get("discountDownPts", 2)):
                cs["DISCOUNT_DOWN"] = min(1.0, 0.3 + dd / 10)
                ev.append(f"discount down {dd:.1f} points")
            if -dd >= 5 and r.actual <= r.expected:
                cs["MARGIN_LEAK"] = 0.3
                ev.append(f"discount up {-dd:.1f} points without more volume")
        rr = r.returns_w / max(1.0, r.actual)
        if rr * 100 >= float(cfg.get("returnRatePct", 10)):
            cs["RETURNS"] = min(1.0, 0.3 + rr)
            ev.append(f"{rr * 100:.0f} % returned")
        if a in armap:
            od, o90, hold = armap[a]
            if hold or o90 > 0:
                cs["PAYMENT"] = 0.6 if hold else min(0.8, 0.3 + o90 / max(1.0, od + 1) * 0.5)
                ev.append("credit hold" if hold else f"{money(o90)} overdue more than 90 days")
        cw, cb = float(cust_w.get(a, 0)), float(cust_b.get(a, 0))
        stopped = float(cust_last.get(a, 0)) <= 0 and float(cust_bmonths.get(a, 0)) >= 10
        if cb > 0 and (cw < 0.4 * cb or stopped):
            cs["INACTIVE"] = min(1.0, 0.5 + (1 - cw / cb) * 0.5)
            ev.append(f"the customer's whole spend fell {(1 - cw / cb) * 100:.0f} %" + (f" and nothing was ordered in {month_label(w[-1])}" if stopped else ""))
        elif a in ord_b.index and ord_b[a] > 0:
            fw = float(ord_w.get(a, 0))
            if fw < 0.6 * ord_b[a] and cw >= 0.6 * cb:
                cs["CYCLE"] = 0.45
                ev.append(f"orders {fw:.1f} times a month instead of {ord_b[a]:.1f}")
        ie, ia = float(item_exp.get(i, 0)), float(item_act.get(i, 0))
        idrop = (1 - ia / ie) if ie > 0 else 0
        if idrop * 100 >= float(cfg.get("itemDropPct", 40)) and "STOCKOUT" not in cs:
            if idrop >= 0.6 or istatus.get(i, "").upper() not in ("", "ACTIVE"):
                cs["LIFECYCLE"] = min(1.0, 0.3 + idrop)
                ev.append(f"the item fell {idrop * 100:.0f} % across every customer")
            else:
                cs["SEASONAL"] = min(1.0, 0.2 + idrop)
                ev.append(f"the item fell {idrop * 100:.0f} % across every customer")
        lost_val = r.lost_revenue
        sub_item = None
        if "INACTIVE" not in cs:
            same = list(grow.loc[a].items()) if a in grow_accts else []
            same = [(it2, v) for it2, v in same if it2 != i and pc.get(it2, "") == pc.get(i, "") and v > 0.5 * lost_val]
            if same:
                sub_item = max(same, key=lambda x: x[1])[0]
                cs["SUBSTITUTION"] = 0.5
                ev.append(f"bought {money(max(same, key=lambda x: x[1])[1])} more of {inum.get(sub_item, sub_item)} (same profit centre)")
        if "INACTIVE" in cs:          # the whole customer stopped: that explains the item better than the item's market
            for k in ("LIFECYCLE", "SEASONAL", "SUBSTITUTION"):
                if k in cs:
                    cs[k] *= 0.5
        if not cs:
            cs["UNKNOWN"] = 1.0
        tot = sum(cs.values()) + 0.15
        probs = {k: v / tot for k, v in cs.items()}
        order = sorted(probs.items(), key=lambda x: -x[1])
        primary = order[0][0]
        secondary = order[1][0] if len(order) > 1 else ""
        strength = max(cs.values()) if primary != "UNKNOWN" else 0.2
        conf = float(np.clip(0.3 + 0.08 * min(r.z, 5) + 0.25 * strength + 0.02 * min(r.hist, 12), 0.2, 0.97))
        recov = sum(float(lr.get(k, 0.35)) * p for k, p in probs.items()) / max(1e-9, sum(probs.values()))
        rec_rev = lost_val * recov * conf
        rec_mar = r.lost_margin * recov * conf
        last_share = float(r.last_qty) / max(1e-9, exp_q / n_w)
        urgency = float(np.clip(1.0 - 0.4 * min(1.0, last_share), 0.6, 1.0))
        weight = float((cfg.get("tierWeights") or {}).get(tiers.get(a, "C"), 1.0))
        raw_score = rec_mar * urgency * weight
        who = owner.loc[a] if a in owner.index else None
        rep = (str(who["rep"]) if who is not None and pd.notna(who["rep"]) and str(who["rep"]) else (str(who["taker"]) if who is not None and pd.notna(who["taker"]) else ""))
        act_owner, act_text = ACTIONS.get(primary, ACTIONS["UNKNOWN"])
        rows.append({
            "opp_id": opp_id(a, i, w[-1]), "account_number": a, "customer": cname.get(a, a), "tier": tiers.get(a, "C"), "bu_id": str(pair_bu.get((a, i), "") or ""),
            "item_id": i, "item": inum.get(i, i), "description": idesc.get(i, ""), "profit_center": pc.get(i, ""),
            "window_from": int(w[0]), "window_to": int(w[-1]), "expected_qty": round(exp_q, 2), "actual_qty": round(act_q, 2),
            "gap_qty": round(r.gap, 2), "drop_pct": round(drop_pct, 1), "z": round(float(r.z), 2), "hist_months": int(r.hist),
            "base_price": round(float(r.base_price), 4), "lost_revenue": round(lost_val, 2), "lost_margin": round(float(r.lost_margin), 2),
            "recoverability": round(recov, 3), "confidence": round(conf, 3), "recoverable_revenue": round(rec_rev, 2), "recoverable_margin": round(rec_mar, 2),
            "urgency": round(urgency, 3), "weight": weight, "raw_score": raw_score, "primary_cause": primary, "secondary_cause": secondary,
            "cause_probs": {k: round(v, 3) for k, v in order}, "evidence": "; ".join(ev),
            "owner": act_owner, "salesperson": rep, "substitute": inum.get(sub_item, "") if sub_item else "",
            "_act": act_text, "_late": float(cust_late.loc[a, "late_avg"]) if a in cust_late.index else 0.0,
            "_price": f"{(r.win_price / r.base_price - 1) * 100:.1f} %" if r.base_price > 0 and not np.isnan(r.win_price) else "",
            "_disc": f"{(r.base_disc - (r.win_disc if not np.isnan(r.win_disc) else r.base_disc)):.1f}", "_ret": f"{rr * 100:.0f} %",
            "_overdue": money(armap.get(a, (0, 0, False))[0]),
        })
    out = pd.DataFrame(rows)
    # score 0–100 by rank of the money-weighted raw score; priority by rank
    rk = out["raw_score"].rank(pct=True)
    out["score"] = (rk * 100).round(0).astype(int)
    out["priority"] = np.where(rk >= 0.8, "High", np.where(rk >= 0.4, "Medium", "Low"))
    today = date.today()
    out["due_date"] = [str(today + timedelta(days={"High": 2, "Medium": 7, "Low": 14}[p])) for p in out["priority"]]
    out["action"] = [t.format(item=f"{it}", cust=c, alt=(f" (alternative: {s})" if s else ""), late=f"{lt:.0f}", price=pr or "?", disc=dc,
                              ret=rt, overdue=od, sub=s or "another item")
                     for t, it, c, s, lt, pr, dc, rt, od in zip(out["_act"], out["item"], out["customer"], out["substitute"], out["_late"],
                                                                out["_price"], out["_disc"], out["_ret"], out["_overdue"])]
    out = out.drop(columns=[c for c in out.columns if c.startswith("_")]).sort_values("raw_score", ascending=False).reset_index(drop=True)
    out["rank"] = np.arange(1, len(out) + 1)
    stats["lost_revenue"] = round(float(out["lost_revenue"].sum()), 2)
    stats["lost_margin"] = round(float(out["lost_margin"].sum()), 2)
    stats["recoverable_margin"] = round(float(out["recoverable_margin"].sum()), 2)
    return out, stats


def alternatives(opps, cm, items, lf):
    """an approved alternative for stock-out / lifecycle gaps: the best seller of the same profit centre the customer does not buy."""
    if not len(opps):
        return opps
    pc = dict(zip(items["ITEM_ID"], items["PROFIT_CENTER"].fillna("")))
    recent = cm[cm["MONTH"] >= add_months(lf, -2)]
    best = recent.assign(PC=recent["ITEM_ID"].map(pc)).groupby(["PC", "ITEM_ID"])["revenue"].sum().reset_index().sort_values("revenue", ascending=False)
    inum = dict(zip(items["ITEM_ID"], items["ITEM_NUMBER"].astype(str)))
    bought = cm[cm["MONTH"] >= add_months(lf, -11)].groupby("ACCOUNT_NUMBER")["ITEM_ID"].apply(set)
    alts = []
    for r in opps.itertuples(index=False):
        if r.primary_cause not in ("STOCKOUT", "LIFECYCLE") or r.substitute:
            alts.append(r.substitute)
            continue
        have = bought.get(r.account_number, set())
        cand = best[(best["PC"] == pc.get(r.item_id, "")) & (best["ITEM_ID"] != r.item_id) & (~best["ITEM_ID"].isin(have))]
        alts.append(inum.get(cand.iloc[0]["ITEM_ID"], "") if len(cand) else "")
    opps = opps.copy()
    opps["substitute"] = alts
    opps["action"] = [a if not s or s in a else a.rstrip(".") + f" (alternative: {s})." for a, s in zip(opps["action"], opps["substitute"])]
    return opps


def months_since(mk, lf):
    return months_between(int(mk), int(lf))

"""Predictive models (RD section 11): customer purchase decline and order-line risk (late, cancelled, partly shipped).

LightGBM gradient boosting when there are enough examples of both outcomes, else logistic regression, else a transparent rule.
Every score carries its top reasons in business words — LightGBM's own per-row contributions (pred_contrib), or coefficient ×
distance from the average for the logistic model. Training is time-based: the most recent cut-offs are held out for the metrics.
"""
import warnings

import numpy as np
import pandas as pd

from .util import add_months

warnings.filterwarnings("ignore")

CHURN_FEATURES = {
    "rev_trend": ("Spending trend (last 3 vs the 3 before)", "spending fell {pct} in 3 months", "spending grew {pct}"),
    "rev_12": ("Spend in 12 months", "smaller account", "large account"),
    "recency": ("Months since the last order", "no order for {v:.0f} month(s)", "ordered recently"),
    "active_12": ("Months with an order (of 12)", "orders only in {v:.0f} of 12 months", "orders every month"),
    "items_trend": ("Items bought (last 3 vs the 3 before)", "buys fewer different items", "buys more different items"),
    "cancel_rate": ("Cancelled share (6 months)", "{pct} of their quantity was cancelled", "few cancellations"),
    "late_rate": ("Late deliveries (6 months)", "{pct} of deliveries late", "deliveries on time"),
    "partial_rate": ("Partial deliveries (6 months)", "{pct} of deliveries partial", "complete deliveries"),
    "return_rate": ("Returned share (6 months)", "{pct} returned", "few returns"),
    "price_change": ("Net price change (3 vs 12 months)", "pays {pct} more than before", "pays less than before"),
    "tenure": ("Months as a customer", "new customer", "long-standing customer"),
    "margin_pct": ("Gross margin %", "low-margin account", "high-margin account"),
}

RISK_FEATURES = {
    "cust_late_rate": ("Customer's late deliveries (6 months)", "{pct} of this customer's deliveries were late"),
    "cust_cancel_rate": ("Customer's cancelled share", "{pct} of this customer's quantity was cancelled"),
    "item_cancel_rate": ("Item's cancelled share", "{pct} of this item's quantity was cancelled lately"),
    "item_oos_rate": ("Item cancelled for stock", "{pct} of this item was cancelled for stock"),
    "item_partial_rate": ("Item's partial deliveries", "{pct} of this item's deliveries were partial"),
    "org_late_rate": ("Warehouse's late deliveries", "{pct} of this warehouse's deliveries were late"),
    "lead_days": ("Days between order and promise", "only {v:.0f} day(s) to the promised date"),
    "qty_ratio": ("Quantity vs the customer's usual", "{v:.1f}× the usual quantity"),
    "order_lines": ("Lines on the order", "{v:.0f} lines on the order"),
    "dow": ("Day of the week ordered", "ordered on a busy day"),
}


def _fit(x, y, names):
    """LightGBM when both outcomes have 15+ rows, else logistic regression with 5+, else None."""
    pos, neg = int(y.sum()), int(len(y) - y.sum())
    if pos >= 15 and neg >= 15 and len(y) >= 80:
        import lightgbm as lgb
        m = lgb.LGBMClassifier(n_estimators=200, learning_rate=0.05, num_leaves=15, min_child_samples=10, subsample=0.9,
                               colsample_bytree=0.9, reg_lambda=1.0, verbose=-1, class_weight="balanced")
        m.fit(x, y)
        return {"kind": "LightGBM", "m": m}
    if pos >= 5 and neg >= 5:
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
        sc = StandardScaler().fit(x)
        m = LogisticRegression(max_iter=500, class_weight="balanced").fit(sc.transform(x), y)
        return {"kind": "Logistic regression", "m": m, "sc": sc}
    return None


def _proba(model, x):
    if model["kind"] == "LightGBM":
        return model["m"].predict_proba(x)[:, 1]
    return model["m"].predict_proba(model["sc"].transform(x))[:, 1]


def _contrib(model, x):
    """per-row contribution of every feature towards the risk (log-odds)."""
    if model["kind"] == "LightGBM":
        return model["m"].predict(x, pred_contrib=True)[:, :-1]
    z = model["sc"].transform(x)
    return z * model["m"].coef_[0]


def _importance(model, names):
    if model["kind"] == "LightGBM":
        imp = model["m"].booster_.feature_importance(importance_type="gain")
    else:
        imp = np.abs(model["m"].coef_[0])
    tot = float(np.sum(imp)) or 1.0
    return sorted([{"feature": n, "importance": round(float(v) / tot, 4)} for n, v in zip(names, imp)], key=lambda r: -r["importance"])


def _metrics(y, p):
    from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score, roc_auc_score
    out = {"rows": int(len(y)), "positives": int(np.sum(y))}
    if len(set(y)) < 2:
        out["note"] = "one outcome only in the test months"
        return out
    out["roc_auc"] = round(float(roc_auc_score(y, p)), 4)
    out["pr_auc"] = round(float(average_precision_score(y, p)), 4)
    yhat = (p >= 0.5).astype(int)
    out["precision"] = round(float(precision_score(y, yhat, zero_division=0)), 4)
    out["recall"] = round(float(recall_score(y, yhat, zero_division=0)), 4)
    out["f1"] = round(float(f1_score(y, yhat, zero_division=0)), 4)
    return out


def psi(a, b, bins=10):
    """population stability index of one feature: training rows vs the rows scored now."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    if len(a) < 20 or len(b) < 5:
        return None
    qs = np.unique(np.quantile(a, np.linspace(0, 1, bins + 1)))
    if len(qs) < 3:
        return 0.0
    ea = np.histogram(a, qs)[0] / len(a) + 1e-4
    eb = np.histogram(np.clip(b, qs[0], qs[-1]), qs)[0] / len(b) + 1e-4
    return round(float(np.sum((eb - ea) * np.log(eb / ea))), 4)


def _words(spec, name, v, contrib=1.0):
    """the reason in business words — only factors that push the risk up are shown, so the 'bad' wording is used."""
    t = spec.get(name)
    if not t:
        return name
    txt = t[1] if contrib > 0 or len(t) < 3 else t[2]
    pct = f"{abs(v) * 100:.0f} %" if abs(v) <= 5 else f"{abs(v):.0f}"
    try:
        return txt.format(pct=pct, v=v)
    except (KeyError, ValueError, IndexError):
        return txt


def churn_panel(cm, lines, lf, cfg):
    """customer × cut-off month features (only data up to the cut-off) and the label: spend in the next H months falls by churnDropPct."""
    h = int(cfg.get("churnHorizonMonths", 3))
    drop = float(cfg.get("churnDropPct", 50)) / 100
    cust_m = cm.groupby(["ACCOUNT_NUMBER", "MONTH"]).agg(rev=("revenue", "sum"), mar=("margin", "sum"), qty=("qty", "sum"), dem=("demand_qty", "sum"),
                                                         canc=("cancel_qty", "sum"), done=("done_lines", "sum"), part=("partial_lines", "sum"),
                                                         late=("late_lines", "sum"), ret=("return_qty", "sum"), items=("ITEM_ID", "nunique"),
                                                         listv=("list_value", "sum")).reset_index()
    first_m = int(cust_m["MONTH"].min()) if len(cust_m) else lf
    months = []
    m = add_months(first_m, 12)
    while m <= lf:
        months.append(m)
        m = add_months(m, 1)
    accts = cust_m["ACCOUNT_NUMBER"].unique()
    full = pd.MultiIndex.from_product([accts, sorted(set(cust_m["MONTH"]) | set(months))], names=["ACCOUNT_NUMBER", "MONTH"])
    cmx = cust_m.set_index(["ACCOUNT_NUMBER", "MONTH"]).reindex(full, fill_value=0).reset_index().sort_values(["ACCOUNT_NUMBER", "MONTH"])
    firsts = cust_m[cust_m["rev"] > 0].groupby("ACCOUNT_NUMBER")["MONTH"].min()
    g = cmx.groupby("ACCOUNT_NUMBER", sort=False)

    def roll(col, n):
        return g[col].transform(lambda s: s.rolling(n, min_periods=1).sum())

    cmx["r3"] = roll("rev", 3)
    cmx["r3p"] = g["rev"].transform(lambda s: s.shift(3).rolling(3, min_periods=1).sum())
    cmx["r12"] = roll("rev", 12)
    cmx["m12"] = roll("mar", 12)
    cmx["act12"] = g["rev"].transform(lambda s: (s > 0).rolling(12, min_periods=1).sum())
    cmx["it3"] = g["items"].transform(lambda s: s.rolling(3, min_periods=1).mean())
    cmx["it3p"] = g["items"].transform(lambda s: s.shift(3).rolling(3, min_periods=1).mean())
    for c in ("qty", "dem", "canc", "done", "part", "late", "ret", "listv", "rev"):
        cmx[c + "6"] = roll(c, 6)
    cmx["p3"] = roll("rev", 3) / roll("qty", 3).replace(0, np.nan)
    cmx["p12"] = roll("rev", 12) / roll("qty", 12).replace(0, np.nan)
    last_buy = cmx["MONTH"].where(cmx["rev"] > 0)
    cmx["last_buy"] = last_buy.groupby(cmx["ACCOUNT_NUMBER"]).ffill()
    cmx["next"] = g["rev"].transform(lambda s: s[::-1].rolling(h, min_periods=1).sum()[::-1].shift(-1))
    cmx = cmx[cmx["MONTH"].isin(months)].copy()
    cmx["first"] = cmx["ACCOUNT_NUMBER"].map(firsts)
    cmx = cmx[cmx["first"].notna() & (cmx["MONTH"] >= cmx["first"])]

    def mdiff(a, b):
        return [(int(x) // 100 * 12 + int(x) % 100) - (int(y) // 100 * 12 + int(y) % 100) if pd.notna(y) else 99 for x, y in zip(a, b)]

    f = pd.DataFrame({"ACCOUNT_NUMBER": cmx["ACCOUNT_NUMBER"].values, "MONTH": cmx["MONTH"].values})
    f["rev_trend"] = np.where(cmx["r3p"] > 0, cmx["r3"] / cmx["r3p"].replace(0, np.nan) - 1, 0).clip(-1, 3)
    f["rev_12"] = np.log1p(cmx["r12"].clip(lower=0).values)
    f["recency"] = mdiff(cmx["MONTH"], cmx["last_buy"])
    f["active_12"] = cmx["act12"].values
    f["items_trend"] = np.where(cmx["it3p"] > 0, cmx["it3"] / cmx["it3p"].replace(0, np.nan) - 1, 0).clip(-1, 3)
    f["cancel_rate"] = (cmx["canc6"] / cmx["dem6"].replace(0, np.nan)).fillna(0).values
    f["late_rate"] = (cmx["late6"] / cmx["done6"].replace(0, np.nan)).fillna(0).values
    f["partial_rate"] = (cmx["part6"] / cmx["done6"].replace(0, np.nan)).fillna(0).values
    f["return_rate"] = (cmx["ret6"] / cmx["qty6"].replace(0, np.nan)).fillna(0).clip(0, 2).values
    f["price_change"] = (cmx["p3"] / cmx["p12"] - 1).fillna(0).clip(-1, 2).values
    f["tenure"] = mdiff(cmx["MONTH"], cmx["first"])
    f["margin_pct"] = (cmx["m12"] / cmx["r12"].replace(0, np.nan)).fillna(0).clip(-1, 1).values
    base = cmx["r3"].values
    f["label"] = np.where(base > 0, (cmx["next"].values < (1 - drop) * base * h / 3).astype(float), np.nan)
    f["r3"] = base
    f["r12"] = cmx["r12"].values
    return f


def churn(cm, lines, lf, cfg, ar=None):
    h = int(cfg.get("churnHorizonMonths", 3))
    f = churn_panel(cm, lines, lf, cfg)
    names = list(CHURN_FEATURES)
    train = f[(f["MONTH"] <= add_months(lf, -h)) & f["label"].notna() & (f["r3"] > 0)]
    score = f[(f["MONTH"] == lf) & (f["r12"] > 0)].copy()
    info = {"model": "churn", "title": "Customer purchase decline", "target": f"spend in the next {h} months falls {cfg.get('churnDropPct', 50)} %+",
            "train_from": int(train["MONTH"].min()) if len(train) else None, "train_to": int(train["MONTH"].max()) if len(train) else None, "rows": int(len(train))}
    if not len(score):
        return pd.DataFrame(), info, []
    cut = add_months(lf, -h - 2)
    tr, te = train[train["MONTH"] < cut], train[train["MONTH"] >= cut]
    model = _fit(tr[names].values, tr["label"].values, names) if len(tr) else None
    if model and len(te):
        info["metrics"] = _metrics(te["label"].values, _proba(model, te[names].values))
    if model:
        model = _fit(train[names].values, train["label"].values, names) or model
    info["method"] = model["kind"] if model else "Rule (too little history to train)"
    info["importance"] = _importance(model, names) if model else []
    info["drift"] = [{"feature": n, "psi": psi(train[n].values, score[n].values)} for n in names] if len(train) else []
    if model:
        p = _proba(model, score[names].values)
        con = _contrib(model, score[names].values)
    else:
        p = np.clip(0.15 + (-score["rev_trend"].clip(-1, 0)) * 0.6 + score["recency"].clip(0, 6) / 12, 0, 0.99).values
        con = np.column_stack([-score["rev_trend"].values, np.zeros(len(score)), score["recency"].values] + [np.zeros(len(score))] * (len(names) - 3))
    reasons = []
    for k in range(len(score)):
        row = score.iloc[k]
        order = np.argsort(-con[k])
        top = [names[j] for j in order[:3] if con[k][j] > 0]
        reasons.append([{"feature": n, "label": CHURN_FEATURES[n][0], "text": _words(CHURN_FEATURES, n, float(row[n]), 1.0),
                         "weight": round(float(con[k][names.index(n)]), 3)} for n in top])
    out = score[["ACCOUNT_NUMBER"] + names + ["r3", "r12"]].copy()
    out["risk"] = np.round(p, 4)
    out["risk_band"] = np.where(out["risk"] >= 0.6, "High", np.where(out["risk"] >= 0.35, "Medium", "Low"))
    out["reasons"] = reasons
    out["revenue_at_risk"] = (out["risk"] * out["r12"] * h / 12).round(2)
    if ar is not None and len(ar):
        od = dict(zip(ar["ACCOUNT_NUMBER"].astype(str), pd.to_numeric(ar["OVERDUE"], errors="coerce").fillna(0)))
        o9 = dict(zip(ar["ACCOUNT_NUMBER"].astype(str), pd.to_numeric(ar["OVER90"], errors="coerce").fillna(0)))
        out["overdue"] = out["ACCOUNT_NUMBER"].map(od).fillna(0)
        out["over90"] = out["ACCOUNT_NUMBER"].map(o9).fillna(0)
    else:
        out["overdue"] = 0.0
        out["over90"] = 0.0
    return out.rename(columns={"ACCOUNT_NUMBER": "account_number"}), info, names


def _rates(df, key, num, den, months):
    """per key × month: the rate over the 6 months BEFORE that month (never the line's own month) — matrix of cumulative sums."""
    if not len(df):
        return lambda keys, ms: np.zeros(len(keys))
    lo, hi = int(min(months)), int(max(months))
    allm, m = [], lo
    while m <= hi:
        allm.append(m)
        m = add_months(m, 1)
    mpos = {mm: k for k, mm in enumerate(allm)}
    g = df.groupby([key, "MONTH"]).agg(n=(num, "sum"), d=(den, "sum")).reset_index()
    keys = {k: i for i, k in enumerate(g[key].unique())}
    N, D = np.zeros((len(keys), len(allm))), np.zeros((len(keys), len(allm)))
    ri, ci = g[key].map(keys).values, g["MONTH"].map(mpos).values
    np.add.at(N, (ri, ci), g["n"].values.astype(float))
    np.add.at(D, (ri, ci), g["d"].values.astype(float))
    pad = np.zeros((len(keys), 1))
    cn, cd = np.concatenate([pad, np.cumsum(N, axis=1)], axis=1), np.concatenate([pad, np.cumsum(D, axis=1)], axis=1)
    t = np.arange(len(allm))
    lo_i = np.clip(t - 6, 0, None)
    n6, d6 = cn[:, t] - cn[:, lo_i], cd[:, t] - cd[:, lo_i]
    with np.errstate(invalid="ignore", divide="ignore"):
        rate = np.where(d6 > 0, n6 / d6, 0.0)

    def look(kv, mv):
        r = np.array([keys.get(k, -1) for k in kv])
        c = np.array([mpos.get(int(mm), -1) for mm in mv])
        ok = (r >= 0) & (c >= 0)
        out = np.zeros(len(kv))
        out[ok] = rate[r[ok], c[ok]]
        return out
    return look


def order_risk(lines, lf, cfg):
    """three classifiers on finished lines of the last 18 months, applied to the open lines."""
    sale = lines[~lines["IS_RETURN"]].copy()
    sale["DONE_OR_CANCEL"] = sale["DONE"] | sale["CANCELED"]
    sale["IS_LATE"] = (sale["LATE_DAYS"] > float(cfg.get("lateDays", 2))).astype(float)
    sale["HAS_PROMISE"] = sale["PROMISED"].notna()
    sale = sale[sale["MONTH"] >= add_months(lf, -18)]
    if not len(sale):
        return pd.DataFrame(), []
    months = sorted(sale["MONTH"].unique())
    sale["one"] = 1.0
    sale["dem"] = sale["DEMAND_QTY"]
    sale["late_n"] = sale["IS_LATE"].where(sale["DONE"] & sale["HAS_PROMISE"], 0)
    sale["late_d"] = (sale["DONE"] & sale["HAS_PROMISE"]).astype(float)
    sale["part_n"] = sale["PARTIAL"].astype(float)
    sale["done_n"] = sale["DONE"].astype(float)
    r_cl = _rates(sale, "ACCOUNT_NUMBER", "late_n", "late_d", months)
    r_cc = _rates(sale, "ACCOUNT_NUMBER", "CANCEL_QTY", "dem", months)
    r_ic = _rates(sale, "ITEM_ID", "CANCEL_QTY", "dem", months)
    r_io = _rates(sale, "ITEM_ID", "OOS_CANCEL", "dem", months)
    r_ip = _rates(sale, "ITEM_ID", "part_n", "done_n", months)
    sale["ORG_ID"] = sale["ORG_ID"].astype(str)
    r_ol = _rates(sale, "ORG_ID", "late_n", "late_d", months)
    usual = sale[sale["QTY"] > 0].groupby(["ACCOUNT_NUMBER", "ITEM_ID"])["QTY"].median()
    nlines = sale.groupby("HEADER_ID")["FULFILL_LINE_ID"].count()
    X = pd.DataFrame(index=sale.index)
    X["cust_late_rate"] = r_cl(sale["ACCOUNT_NUMBER"].values, sale["MONTH"].values)
    X["cust_cancel_rate"] = r_cc(sale["ACCOUNT_NUMBER"].values, sale["MONTH"].values)
    X["item_cancel_rate"] = r_ic(sale["ITEM_ID"].values, sale["MONTH"].values)
    X["item_oos_rate"] = r_io(sale["ITEM_ID"].values, sale["MONTH"].values)
    X["item_partial_rate"] = r_ip(sale["ITEM_ID"].values, sale["MONTH"].values)
    X["org_late_rate"] = r_ol(sale["ORG_ID"].values, sale["MONTH"].values)
    X["lead_days"] = (sale["PROMISED"] - sale["ORDERED_DATE"]).dt.days.fillna(-1).clip(-1, 120)
    X["qty_ratio"] = (sale["DEMAND_QTY"] / [usual.get((a, i), np.nan) for a, i in zip(sale["ACCOUNT_NUMBER"], sale["ITEM_ID"])]).fillna(1).clip(0, 20)
    X["order_lines"] = sale["HEADER_ID"].map(nlines).fillna(1).values
    X["dow"] = sale["ORDERED_DATE"].dt.dayofweek.fillna(0)
    names = list(RISK_FEATURES)
    targets = [("late", "Late shipment", (sale["DONE"] & sale["HAS_PROMISE"]), sale["IS_LATE"]),
               ("cancel", "Cancellation", sale["DONE_OR_CANCEL"], sale["CANCELED"].astype(float)),
               ("partial", "Partial shipment", sale["DONE"], sale["PARTIAL"].astype(float))]
    open_mask = sale["OPEN"]
    scored = sale[open_mask][["FULFILL_LINE_ID", "HEADER_ID", "ORDER_NUMBER", "ORDERED_DATE", "ACCOUNT_NUMBER", "ITEM_ID", "ITEM_NUMBER", "QTY", "NET_PRICE",
                              "REVENUE", "PROMISED", "STATUS", "ORG_ID", "BU_ID", "SALESPERSON"]].copy()
    infos = []
    cut = add_months(lf, -2)
    for key, title, train_mask, y in targets:
        tm = train_mask & ~open_mask
        tr, te = tm & (sale["MONTH"] < cut), tm & (sale["MONTH"] >= cut)
        info = {"model": "order_" + key, "title": f"Order risk — {title.lower()}", "target": title, "rows": int(tm.sum()),
                "train_from": int(sale.loc[tm, "MONTH"].min()) if tm.any() else None, "train_to": int(sale.loc[tm, "MONTH"].max()) if tm.any() else None,
                "base_rate": round(float(y[tm].mean()), 4) if tm.any() else None}
        model = _fit(X.loc[tr, names].values, y[tr].values, names) if tr.sum() else None
        if model and te.sum():
            info["metrics"] = _metrics(y[te].values, _proba(model, X.loc[te, names].values))
        if model:
            model = _fit(X.loc[tm, names].values, y[tm].values, names) or model
        info["method"] = model["kind"] if model else "Rule (too few examples)"
        info["importance"] = _importance(model, names) if model else []
        info["drift"] = [{"feature": n, "psi": psi(X.loc[tm, n].values, X.loc[open_mask, n].values)} for n in names] if open_mask.any() else []
        infos.append(info)
        if not open_mask.any():
            continue
        xo = X.loc[open_mask, names]
        if model:
            p = _proba(model, xo.values)
            con = _contrib(model, xo.values)
        else:
            base = {"late": "cust_late_rate", "cancel": "item_cancel_rate", "partial": "item_partial_rate"}[key]
            p = np.clip(xo[base].values * 1.2, 0, 0.99)
            con = np.zeros((len(xo), len(names)))
            con[:, names.index(base)] = xo[base].values
        scored["p_" + key] = np.round(p, 4)
        scored["why_" + key] = [[{"feature": names[j], "text": _words(RISK_FEATURES, names[j], float(xo.iloc[k][names[j]]), 1.0)}
                                 for j in np.argsort(-con[k])[:3] if con[k][j] > 0] for k in range(len(xo))]
    if len(scored):
        for k in ("late", "cancel", "partial"):
            if "p_" + k not in scored:
                scored["p_" + k] = 0.0
                scored["why_" + k] = [[] for _ in range(len(scored))]
        scored["risk"] = scored[["p_late", "p_cancel", "p_partial"]].max(axis=1)
        scored["main_risk"] = scored[["p_late", "p_cancel", "p_partial"]].idxmax(axis=1).str.replace("p_", "", regex=False)
        scored["value_at_risk"] = (scored["REVENUE"] * scored["risk"]).round(2)
        scored["action"] = [{"late": "Confirm the ship date with the warehouse and tell the customer now.",
                             "cancel": "Check stock / allocation before the customer cancels; offer an alternative.",
                             "partial": "Reserve the full quantity or agree the split with the customer."}[m] for m in scored["main_risk"]]
        scored["ORDERED_DATE"] = scored["ORDERED_DATE"].dt.strftime("%Y-%m-%d")
        scored["PROMISED"] = scored["PROMISED"].dt.strftime("%Y-%m-%d")
        scored = scored.sort_values("value_at_risk", ascending=False)
    return scored, infos

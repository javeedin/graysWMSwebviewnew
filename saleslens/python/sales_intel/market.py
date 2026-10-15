"""Cross-sell (association rules + peer penetration) and price response (within-customer log-log elasticity) — RD 11 / Phase 6."""
import numpy as np
import pandas as pd

from .util import add_months


def cross_sell(cm, customers, items, lf, top=5):
    """for every customer: items peers buy that it does not, with the reason and an expected monthly value."""
    recent = cm[(cm["MONTH"] > add_months(lf, -12)) & (cm["MONTH"] <= lf) & (cm["revenue"] > 0)]
    if not len(recent):
        return pd.DataFrame(), pd.DataFrame()
    cls = dict(zip(customers["ACCOUNT_NUMBER"].astype(str), customers["CUSTOMER_CLASS"].fillna("").astype(str)))
    inum = dict(zip(items["ITEM_ID"], items["ITEM_NUMBER"].astype(str)))
    idesc = dict(zip(items["ITEM_ID"], items["DESCRIPTION"].fillna("").astype(str)))
    buys = recent.groupby(["ACCOUNT_NUMBER", "ITEM_ID"])["revenue"].sum().reset_index()
    sets = buys.groupby("ACCOUNT_NUMBER")["ITEM_ID"].apply(set)
    n_cust = len(sets)
    item_buyers = buys.groupby("ITEM_ID")["ACCOUNT_NUMBER"].nunique()
    support = item_buyers / n_cust
    # pair counts (association rules a → b)
    pair = {}
    for s in sets:
        s = sorted(s)
        for x in s:
            for y in s:
                if x != y:
                    pair[(x, y)] = pair.get((x, y), 0) + 1
    rules = []
    for (a, b), n in pair.items():
        if n < 3:
            continue
        conf = n / item_buyers[a]
        lift = conf / support[b]
        if lift > 1.1:
            rules.append({"antecedent": a, "consequent": b, "support": round(n / n_cust, 4), "confidence": round(conf, 4), "lift": round(lift, 3), "customers": n})
    rules = pd.DataFrame(rules)
    by_b = {}
    if len(rules):
        for r in rules.itertuples(index=False):
            by_b.setdefault(r.consequent, []).append((r.antecedent, r.lift, r.confidence))
    monthly = buys.copy()
    monthly["per_month"] = monthly["revenue"] / 12
    med_item = monthly.groupby("ITEM_ID")["per_month"].median()
    size = buys.groupby("ACCOUNT_NUMBER")["revenue"].sum()
    med_size = float(size.median()) or 1.0
    class_buyers = buys.assign(C=buys["ACCOUNT_NUMBER"].map(cls)).groupby(["C", "ITEM_ID"])["ACCOUNT_NUMBER"].nunique()
    class_n = pd.Series(cls).value_counts()
    out = []
    for acct, have in sets.items():
        c = cls.get(acct, "")
        cands = []
        for b in item_buyers.index:
            if b in have:
                continue
            pen = float(class_buyers.get((c, b), 0)) / max(1, int(class_n.get(c, n_cust))) if c else float(support[b])
            assoc = [(a, li, co) for a, li, co in by_b.get(b, []) if a in have]
            lift_score = sum(co * li for _, li, co in assoc) / max(1, len(have))
            score = 0.6 * pen + 0.4 * min(1.0, lift_score)
            if score < 0.15 or pen < 0.1:
                continue
            ratio = float(np.clip(size.get(acct, med_size) / med_size, 0.25, 4))
            val = float(med_item.get(b, 0)) * ratio
            why = []
            if c and pen >= 0.1:
                why.append(f"bought by {pen * 100:.0f} % of {c.title()} customers")
            elif pen >= 0.1:
                why.append(f"bought by {pen * 100:.0f} % of customers")
            if assoc:
                best = sorted(assoc, key=lambda x: -x[1])[:2]
                why.append("often bought with " + ", ".join(inum.get(a, a) for a, _, _ in best))
            cands.append({"account_number": acct, "item_id": b, "item": inum.get(b, b), "description": idesc.get(b, ""), "score": round(score, 4),
                          "penetration": round(pen, 4), "lift_score": round(lift_score, 4), "monthly_value": round(val, 2), "reason": "; ".join(why)})
        cands.sort(key=lambda r: -(r["score"] * (1 + np.log1p(r["monthly_value"]) / 10)))
        out.extend(cands[:top])
    rules_named = rules.copy()
    if len(rules_named):
        rules_named["antecedent_item"] = rules_named["antecedent"].map(inum)
        rules_named["consequent_item"] = rules_named["consequent"].map(inum)
        rules_named = rules_named.sort_values("lift", ascending=False).head(500)
    return pd.DataFrame(out), rules_named


def elasticity(cm, items, lf, default=-1.2, months=24):
    """per item: slope of log(quantity) on log(net price) inside each customer (customer means removed), months with a sale only."""
    d = cm[(cm["MONTH"] > add_months(lf, -months)) & (cm["MONTH"] <= lf) & (cm["qty"] > 0) & (cm["revenue"] > 0)].copy()
    inum = dict(zip(items["ITEM_ID"], items["ITEM_NUMBER"].astype(str)))
    out = []
    rev = d.groupby("ITEM_ID")["revenue"].sum()
    for item, g in d.groupby("ITEM_ID"):
        price = g["revenue"] / g["qty"]
        lq, lp = np.log(g["qty"].values), np.log(price.values)
        cust = g["ACCOUNT_NUMBER"].values
        dq = lq - pd.Series(lq).groupby(cust).transform("mean").values
        dp = lp - pd.Series(lp).groupby(cust).transform("mean").values
        n = len(g)
        cv = float(np.std(price) / np.mean(price)) if np.mean(price) > 0 else 0
        row = {"item_id": item, "item": inum.get(item, item), "obs": int(n), "customers": int(len(set(cust))), "price_cv": round(cv, 4),
               "revenue_12": round(float(g[g["MONTH"] > add_months(lf, -12)]["revenue"].sum()), 2)}
        if n >= 20 and cv >= 0.015 and np.sum(dp ** 2) > 1e-6:
            b = float(np.sum(dp * dq) / np.sum(dp ** 2))
            resid = dq - b * dp
            dof = max(1, n - len(set(cust)) - 1)
            se = float(np.sqrt(np.sum(resid ** 2) / dof / np.sum(dp ** 2)))
            r2 = float(1 - np.sum(resid ** 2) / max(1e-9, np.sum(dq ** 2)))
            k = 10.0          # shrink towards the default by how much evidence there is
            w = (1 / max(se, 1e-3) ** 2)
            used = float(np.clip((w * b + k * default) / (w + k), -4, 0.3))
            row.update({"elasticity": round(b, 3), "se": round(se, 3), "r2": round(r2, 3), "used": round(used, 3), "source": "estimated"})
        else:
            row.update({"elasticity": None, "se": None, "r2": None, "used": default, "source": "assumed (too little price variation)"})
        out.append(row)
    res = pd.DataFrame(out)
    if len(res):
        res["revenue_share"] = res["item_id"].map(rev / rev.sum()).round(5)
    return res

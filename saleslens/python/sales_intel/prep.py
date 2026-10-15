"""Raw extracts → clean order lines, with the data-quality rules of the RD (section 20).

Every rule writes a row to ``dq`` (rule, severity, rows, detail); rows that break a hard rule go to ``quarantine`` with the
reason and never reach the analysis. Lines a business rule leaves out (zero price, crates, excluded order types) are counted,
not quarantined.
"""
import glob
import json
import os
import re

import numpy as np
import pandas as pd

from .util import fnum, month_key

DONE = {"CLOSED", "SHIPPED", "BILLED", "AWAIT_BILLING", "AWAITING_BILLING", "FULFILLED", "INVOICED", "INTERFACED"}
LINE_COLS = ["FULFILL_LINE_ID", "HEADER_ID", "ORDER_NUMBER", "ORDERED_DATE", "ACCOUNT_NUMBER", "BU_ID", "CURRENCY", "INVENTORY_ITEM_ID", "ORG_ID",
             "LINE_NUMBER", "CATEGORY", "ORDERED_QTY", "SHIPPED_QTY", "CANCELED_QTY", "UOM", "UNIT_LIST_PRICE", "UNIT_SELLING_PRICE",
             "EXTENDED_AMOUNT", "STATUS", "REQUEST_SHIP_DATE", "SCHEDULE_SHIP_DATE", "PROMISE_SHIP_DATE", "ACTUAL_SHIP_DATE",
             "CANCEL_REASON", "RETURN_REASON", "SALESPERSON", "ORDER_TYPE", "CREATED_BY"]


def read_jsonl(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    return rows


def frame(rows, cols=None):
    df = pd.DataFrame(rows)
    if cols:
        for c in cols:
            if c not in df.columns:
                df[c] = None
    return df


def load_raw(root):
    raw = os.path.join(root, "raw")
    files = sorted(glob.glob(os.path.join(raw, "lines", "*.jsonl")))
    parts = []
    for f in files:
        rows = read_jsonl(f)
        if rows:
            d = frame(rows, LINE_COLS)
            d["_file"] = os.path.basename(f)
            parts.append(d)
    lines = pd.concat(parts, ignore_index=True) if parts else frame([], LINE_COLS + ["_file"])
    onhand = []
    for f in sorted(glob.glob(os.path.join(raw, "onhand", "*.jsonl"))):
        day = os.path.basename(f)[:8]
        for r in read_jsonl(f):
            r["DAY"] = day
            onhand.append(r)
    manifest = {}
    try:
        with open(os.path.join(raw, "manifest.json"), encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (OSError, ValueError):
        pass
    return {
        "lines": lines,
        "items": frame(read_jsonl(os.path.join(raw, "items.jsonl")), ["INVENTORY_ITEM_ID", "ITEM_NUMBER", "DESCRIPTION", "PRIMARY_UOM", "ITEM_STATUS", "PROFIT_CENTER", "SUPPLIER", "ITEM_TYPE"]),
        "customers": frame(read_jsonl(os.path.join(raw, "customers.jsonl")), ["ACCOUNT_NUMBER", "CUSTOMER_NAME", "CUSTOMER_CLASS", "STATUS", "CREATED"]),
        "costs": frame(read_jsonl(os.path.join(raw, "costs.jsonl")), ["ITEM_ID", "UNIT_COST"]),
        "bus": frame(read_jsonl(os.path.join(raw, "bus.jsonl")), ["BU_ID", "BU_NAME"]),
        "rates": frame(read_jsonl(os.path.join(raw, "rates.jsonl")), ["FROM_CURRENCY", "MONTH", "RATE"]),
        "uom": frame(read_jsonl(os.path.join(raw, "uom.jsonl")), ["ITEM_ID", "UOM_CODE", "RATE"]),
        "oos": frame(read_jsonl(os.path.join(raw, "oos.jsonl")), ["ITEM", "LOGGED_AT", "RESULT", "MESSAGE"]),
        "ar": frame(read_jsonl(os.path.join(raw, "ar.jsonl")), ["ACCOUNT_NUMBER", "DUE", "OVERDUE", "OVER90", "CREDIT_HOLD", "AS_OF"]),
        "onhand": frame(onhand, ["ITEM_ID", "ORG_ID", "QTY", "DAY"]),
        "manifest": manifest,
    }


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def _date(s):
    return pd.to_datetime(s.astype("string").str.slice(0, 10), errors="coerce", format="%Y-%m-%d")


def _sid(s):
    """ids as text without a trailing .0"""
    def one(v):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return None
        if isinstance(v, (int, float, np.integer, np.floating)) and float(v).is_integer():
            return str(int(v))
        return str(v).strip()
    return s.map(one)


def clean(raw, cfg):
    dq, quarantine = [], []

    def rule(name, severity, n, detail=""):
        dq.append({"rule": name, "severity": severity, "rows": int(n), "detail": detail})

    df = raw["lines"].copy()
    total_in = len(df)
    rule("Lines read", "INFO", total_in, f"{df['_file'].nunique() if total_in else 0} month file(s)")

    def quarantine_rows(mask, reason):
        n = int(mask.sum())
        if n:
            q = df[mask].copy()
            q["REASON"] = reason
            quarantine.append(q)
        return n

    df["FULFILL_LINE_ID"] = _sid(df["FULFILL_LINE_ID"])
    df["ACCOUNT_NUMBER"] = df["ACCOUNT_NUMBER"].astype("string").str.strip()
    df["ITEM_ID"] = _sid(df["INVENTORY_ITEM_ID"])
    df["BU_ID"] = _sid(df["BU_ID"])
    for c in ("ORDERED_QTY", "SHIPPED_QTY", "CANCELED_QTY", "UNIT_LIST_PRICE", "UNIT_SELLING_PRICE", "EXTENDED_AMOUNT"):
        df[c] = _num(df[c])
    df["ORDERED_DATE"] = _date(df["ORDERED_DATE"])

    # 1. duplicates: the same fulfilment line twice (keep the first, quarantine the rest)
    dup = df["FULFILL_LINE_ID"].notna() & df.duplicated(subset=["FULFILL_LINE_ID"], keep="first")
    n = quarantine_rows(dup, "duplicate order line")
    rule("Duplicate order lines quarantined", "WARN" if n else "OK", n)
    df = df[~dup]
    # 2. no date / customer / item
    bad = df["ORDERED_DATE"].isna() | df["ACCOUNT_NUMBER"].isna() | (df["ACCOUNT_NUMBER"] == "") | df["ITEM_ID"].isna()
    n = quarantine_rows(bad, "no order date, customer or item")
    rule("Lines without date / customer / item", "WARN" if n else "OK", n)
    df = df[~bad]
    # 3. negative quantity on an order (not a return)
    cat = df["CATEGORY"].astype("string").str.upper().fillna("ORDER")
    is_ret = cat.str.contains("RETURN") | df["ORDER_TYPE"].astype("string").str.upper().fillna("").str.contains("RETURN")
    neg = (~is_ret) & (df["ORDERED_QTY"] < 0)
    n = quarantine_rows(neg, "negative quantity on an order line")
    rule("Negative quantities on order lines", "WARN" if n else "OK", n)
    df = df[~neg]
    is_ret = is_ret[~neg]
    df["IS_RETURN"] = is_ret.values

    # business units
    bus = [str(b) for b in (cfg.get("businessUnits") or []) if str(b).strip()]
    if bus:
        out = ~df["BU_ID"].isin(bus)
        rule("Other business units left out", "INFO", int(out.sum()), ", ".join(bus))
        df = df[~out]

    # exclusions: zero price, crates / deposits, consignment sub-lines, order types
    items = raw["items"].copy()
    items["ITEM_ID"] = _sid(items["INVENTORY_ITEM_ID"])
    num = dict(zip(items["ITEM_ID"], items["ITEM_NUMBER"].astype("string").fillna("")))
    desc = dict(zip(items["ITEM_ID"], items["DESCRIPTION"].astype("string").fillna("")))
    df["ITEM_NUMBER"] = df["ITEM_ID"].map(num).fillna(df["ITEM_ID"])
    excl = pd.Series(False, index=df.index)
    if cfg.get("excludeZeroPrice", True):
        zero = (~df["IS_RETURN"]) & (df["UNIT_SELLING_PRICE"].fillna(0) == 0)
        rule("Zero-price lines left out (BOGO / free)", "INFO", int(zero.sum()))
        excl |= zero
    pats = [p.upper() for p in (cfg.get("excludeItemPatterns") or []) if p]
    if pats:
        text = (df["ITEM_NUMBER"].astype("string").fillna("") + " " + df["ITEM_ID"].map(desc).fillna("")).str.upper()
        hit = text.str.contains("|".join(re.escape(p) for p in pats), regex=True, na=False)
        rule("Items left out by name (crates, deposits …)", "INFO", int((hit & ~excl).sum()), ", ".join(pats))
        excl |= hit
    lp = cfg.get("excludeLinePattern")
    if lp:
        try:
            rx = re.compile(lp)
            sub = df["LINE_NUMBER"].astype("string").fillna("").str.contains(rx, regex=True, na=False)
            rule("Sub-lines left out (consignment / crate lines N.1 / N.2)", "INFO", int((sub & ~excl).sum()), lp)
            excl |= sub
        except re.error:
            rule("Line pattern is not valid", "WARN", 0, lp)
    ots = [o.upper() for o in (cfg.get("excludeOrderTypes") or []) if o]
    if ots:
        ot = df["ORDER_TYPE"].astype("string").str.upper().isin(ots)
        rule("Order types left out", "INFO", int((ot & ~excl).sum()), ", ".join(ots))
        excl |= ot
    df = df[~excl].copy()

    # currency → reporting currency (monthly average rates)
    rep = (cfg.get("reportingCurrency") or "MUR").upper()
    df["MONTH"] = df["ORDERED_DATE"].dt.year * 100 + df["ORDERED_DATE"].dt.month
    cur = df["CURRENCY"].astype("string").str.upper().fillna(rep)
    rates = raw["rates"].copy()
    fx = pd.Series(1.0, index=df.index)
    other = cur != rep
    if other.any():
        rmap = {}
        for _, r in rates.iterrows():
            rmap[(str(r["FROM_CURRENCY"]).upper(), month_key(r["MONTH"]))] = fnum(r["RATE"], 0)
        missing = 0
        for i in df.index[other]:
            key = (cur[i], int(df.at[i, "MONTH"]))
            rate = rmap.get(key)
            if not rate:
                cands = [(abs(k[1] - key[1]), v) for k, v in rmap.items() if k[0] == key[0] and v]
                rate = min(cands)[1] if cands else None
            if rate:
                fx[i] = rate
            else:
                missing += 1
        rule(f"Lines in another currency converted to {rep}", "INFO", int(other.sum()) - missing)
        if missing:
            rule("Lines in another currency without a rate (kept at 1:1)", "WARN", missing, "sync the exchange rates")
    df["FX"] = fx

    # units of measure → the item's primary unit
    prim = dict(zip(items["ITEM_ID"], items["PRIMARY_UOM"].astype("string").fillna("")))
    uom = raw["uom"].copy()
    conv = {}
    for _, r in uom.iterrows():
        conv[(str(r["ITEM_ID"] if r["ITEM_ID"] is not None else "0").split(".")[0], str(r["UOM_CODE"]).upper())] = fnum(r["RATE"], 0)
    factor = pd.Series(1.0, index=df.index)
    lu = df["UOM"].astype("string").str.upper().fillna("")
    pu = df["ITEM_ID"].map(prim).fillna("").astype(str).str.upper()
    need = (lu != "") & (pu != "") & (lu != pu)
    mixed = 0
    for i in df.index[need]:
        a_ = conv.get((df.at[i, "ITEM_ID"], lu[i])) or conv.get(("0", lu[i]))
        b_ = conv.get((df.at[i, "ITEM_ID"], pu[i])) or conv.get(("0", pu[i]))
        if a_ and b_:
            factor[i] = a_ / b_
        else:
            mixed += 1
    df["UOM_FACTOR"] = factor
    if mixed:
        rule("Lines in another unit without a conversion (quantity kept as ordered)", "WARN", mixed, "sync units of measure")

    status = df["STATUS"].astype("string").str.upper().fillna("")
    canceled_status = status.str.startswith("CANCEL")
    ordered = df["ORDERED_QTY"].fillna(0)
    canceled = df["CANCELED_QTY"].fillna(0)
    canceled = canceled.where(~(canceled_status & (canceled == 0)), ordered.abs())
    kept = ordered.where(~canceled_status, 0)
    kept_p = (kept.where(~df["IS_RETURN"], 0) * df["UOM_FACTOR"]).clip(lower=0)
    shipped_p = df["SHIPPED_QTY"] * df["UOM_FACTOR"]
    act0 = _date(df["ACTUAL_SHIP_DATE"])
    finished = (status.isin(DONE) | act0.notna()) & ~canceled_status & shipped_p.notna()
    # what was really sold: the shipped quantity of a finished line (a short shipment is a lost sale), the ordered one while open
    df["ORDERED_KEPT"] = kept_p
    df["QTY"] = np.where(finished, np.minimum(shipped_p.fillna(0), kept_p), kept_p)
    df["RETURN_QTY"] = (ordered.abs().where(df["IS_RETURN"], 0) * df["UOM_FACTOR"])
    df["CANCEL_QTY"] = canceled.where(~df["IS_RETURN"], 0) * df["UOM_FACTOR"]
    df["DEMAND_QTY"] = df["ORDERED_KEPT"] + df["CANCEL_QTY"]
    net = df["UNIT_SELLING_PRICE"].fillna(0) * df["FX"] / df["UOM_FACTOR"]
    lst = df["UNIT_LIST_PRICE"].where(df["UNIT_LIST_PRICE"].fillna(0) > 0, df["UNIT_SELLING_PRICE"]).fillna(0) * df["FX"] / df["UOM_FACTOR"]
    df["NET_PRICE"] = net
    df["LIST_PRICE"] = lst
    df["DISCOUNT_PCT"] = np.where(lst > 0, (lst - net) / lst * 100, 0.0)
    ext = df["EXTENDED_AMOUNT"] * df["FX"]
    full = (df["QTY"] >= df["ORDERED_KEPT"] - 1e-9)
    df["REVENUE"] = np.where(df["IS_RETURN"], 0.0, np.where(ext.notna() & (kept > 0) & full, ext, df["QTY"] * net))
    df["RETURN_VALUE"] = np.where(df["IS_RETURN"], (ext.abs()).fillna(df["RETURN_QTY"] * net), 0.0)
    df["CANCEL_VALUE"] = df["CANCEL_QTY"] * net
    costs = raw["costs"].copy()
    cmap = dict(zip(_sid(costs["ITEM_ID"]), _num(costs["UNIT_COST"])))
    uc = df["ITEM_ID"].map(cmap)          # the item cost is in the ledger (reporting) currency, per primary unit
    df["UNIT_COST"] = uc
    fallback = float(cfg.get("marginFallbackPct", 25)) / 100
    df["MARGIN_KNOWN"] = uc.notna() & (uc > 0)
    df["MARGIN"] = np.where(df["MARGIN_KNOWN"], df["REVENUE"] - df["QTY"] * uc.fillna(0), df["REVENUE"] * fallback)
    known = int(df.loc[~df["IS_RETURN"], "MARGIN_KNOWN"].sum())
    allv = int((~df["IS_RETURN"]).sum())
    rule("Lines with an item cost (margin from cost)", "INFO" if known == allv else "WARN", known,
         f"{allv - known} line(s) use the fallback margin {cfg.get('marginFallbackPct', 25)} %")

    # dates, lateness, partial shipments, open lines
    req = _date(df["REQUEST_SHIP_DATE"])
    prom = _date(df["PROMISE_SHIP_DATE"]).fillna(_date(df["SCHEDULE_SHIP_DATE"])).fillna(req)
    act = _date(df["ACTUAL_SHIP_DATE"])
    df["PROMISED"] = prom
    df["SHIPPED_ON"] = act
    df["LATE_DAYS"] = (act - prom).dt.days
    shipped = df["SHIPPED_QTY"].fillna(0) * df["UOM_FACTOR"]
    done = (status.isin(DONE) | act.notna()) & ~canceled_status & ~df["IS_RETURN"]
    df["DONE"] = done
    df["PARTIAL"] = done & (((shipped > 0) & (shipped < df["ORDERED_KEPT"] * 0.999)) | status.str.contains("PARTIAL"))
    df["OPEN"] = (~done) & (~canceled_status) & (~df["IS_RETURN"]) & (df["ORDERED_KEPT"] > 0)
    df["CANCELED"] = canceled_status | (df["CANCEL_QTY"] > 0)
    nopromise = int((done & prom.isna()).sum())
    rule("Shipped lines without a requested / promised date", "WARN" if nopromise else "OK", nopromise, "late shipments cannot be measured for them")
    noship = int((status.isin(DONE) & act.isna() & ~df["IS_RETURN"]).sum())
    rule("Closed lines without an actual ship date", "INFO" if noship else "OK", noship)
    reason = df["CANCEL_REASON"].astype("string").str.upper().fillna("")
    df["OOS_CANCEL"] = df["CANCEL_QTY"].where(reason.str.contains("STOCK|OOS|SHORT|AVAIL"), 0)

    # reconciliation against the counts Fusion gave when the month was read
    recon = []
    man = (raw.get("manifest") or {}).get("months") or {}
    loaded = raw["lines"].copy()
    loaded["MONTH"] = _date(loaded["ORDERED_DATE"]).pipe(lambda s: s.dt.year * 100 + s.dt.month)
    by_month = loaded.groupby("MONTH").agg(rows=("FULFILL_LINE_ID", "size"), qty=("ORDERED_QTY", lambda s: _num(s).sum()),
                                           amount=("EXTENDED_AMOUNT", lambda s: _num(s).sum())) if len(loaded) else pd.DataFrame()
    for mk, m in sorted(man.items()):
        mk_i = int(mk)
        got = by_month.loc[mk_i] if len(by_month) and mk_i in by_month.index else None
        rows = int(got["rows"]) if got is not None else 0
        amt = float(got["amount"]) if got is not None else 0.0
        frow = m.get("fusionRows")
        famt = m.get("fusionAmount")
        ok_rows = frow is None or int(frow) == rows
        ok_amt = famt is None or abs(float(famt) - amt) <= max(1.0, abs(float(famt)) * 0.0005)
        recon.append({"month": mk_i, "rows": rows, "fusion_rows": frow, "amount": round(amt, 2), "fusion_amount": famt,
                      "status": "OK" if ok_rows and ok_amt else "DIFF", "read_at": m.get("readAt"), "alt": m.get("alt")})
    diffs = sum(1 for r in recon if r["status"] != "OK")
    rule("Months that tie to Fusion totals", "OK" if not diffs else "WARN", len(recon) - diffs, f"{diffs} month(s) differ" if diffs else "")

    q = pd.concat(quarantine, ignore_index=True) if quarantine else pd.DataFrame()
    df = df.drop(columns=[c for c in ("_file",) if c in df.columns])
    rule("Clean lines used", "INFO", len(df))
    return df, pd.DataFrame(dq), q, pd.DataFrame(recon)

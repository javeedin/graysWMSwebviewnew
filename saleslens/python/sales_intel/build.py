"""One build: raw extracts → clean lines → history → baselines → opportunities → models → cross-sell → prices → one DuckDB file.

The file is written as saleslens.new.duckdb and swapped in at the end, so the app keeps reading the previous results while a
build runs. Opportunity history, feedback and simulations carry over from the previous file.
"""
import glob
import hashlib
import json
import os
import time
import uuid

import duckdb
import numpy as np
import pandas as pd

from . import VERSION, engine, market, models, prep
from .settings import merge
from .util import Progress, add_months, now_iso, read_json, write_json

DB = "saleslens.duckdb"


def data_hash(root):
    h = hashlib.sha256()
    for f in sorted(glob.glob(os.path.join(root, "raw", "**", "*"), recursive=True)):
        if os.path.isfile(f):
            st = os.stat(f)
            h.update(f"{os.path.relpath(f, root)}|{st.st_size}|{int(st.st_mtime)}".encode())
    return h.hexdigest()[:16]


def _jsonable(df):
    out = df.copy()
    for c in out.columns:
        if out[c].dtype == object and len(out) and isinstance(next((v for v in out[c] if v is not None), None), (dict, list)):
            out[c] = out[c].map(lambda v: json.dumps(v, default=str))
    return out


def _write(con, name, df):
    df = _jsonable(df) if len(df) else df
    if not len(df.columns):
        con.execute(f"CREATE OR REPLACE TABLE {name} (empty VARCHAR)")
        return
    con.register("_df", df)
    con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM _df")
    con.unregister("_df")


def _prev(root, table):
    path = os.path.join(root, DB)
    if not os.path.exists(path):
        return pd.DataFrame()
    try:
        c = duckdb.connect(path, read_only=True)
        try:
            if c.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?", [table]).fetchone()[0]:
                return c.execute(f"SELECT * FROM {table}").df()
        finally:
            c.close()
    except duckdb.Error:
        pass
    return pd.DataFrame()


def _feedback(root):
    rows = prep.read_jsonl(os.path.join(root, "feedback.jsonl"))
    if not rows:
        return pd.DataFrame(columns=["opp_id", "decision", "reason", "outcome", "value", "by", "at", "note"])
    df = pd.DataFrame(rows)
    for c in ("opp_id", "decision", "reason", "outcome", "value", "by", "at", "note"):
        if c not in df.columns:
            df[c] = None
    df = df.sort_values("at").groupby("opp_id").tail(1) if "at" in df.columns else df
    return df


def run(root, user_settings=None, quiet=False, last_month=None):
    p = Progress(quiet)
    t0 = time.time()
    cfg = merge(user_settings or read_json(os.path.join(root, "settings.json"), {}))
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    p.step("read", "Reading the extracts")
    raw = prep.load_raw(root)
    if not len(raw["lines"]):
        return {"ok": False, "error": "No order lines on this PC yet — sync from Fusion first (Setup & data), or try the demo data."}
    p.step("clean", "Data quality and clean lines", f"{len(raw['lines']):,} lines read")
    lines, dq, quarantine, recon = prep.clean(raw, cfg)
    items = raw["items"].copy()
    items["ITEM_ID"] = prep._sid(items["INVENTORY_ITEM_ID"])
    if not len(items):
        items = pd.DataFrame({"ITEM_ID": lines["ITEM_ID"].unique()})
        for c in ("ITEM_NUMBER", "DESCRIPTION", "PRIMARY_UOM", "ITEM_STATUS", "PROFIT_CENTER", "SUPPLIER", "ITEM_TYPE"):
            items[c] = items["ITEM_ID"] if c == "ITEM_NUMBER" else ""
    missing = set(lines["ITEM_ID"]) - set(items["ITEM_ID"])
    if missing:
        items = pd.concat([items, pd.DataFrame({"ITEM_ID": list(missing), "ITEM_NUMBER": list(missing), "DESCRIPTION": "", "PROFIT_CENTER": "", "ITEM_STATUS": ""})], ignore_index=True)
    customers = raw["customers"].copy()
    customers["ACCOUNT_NUMBER"] = customers["ACCOUNT_NUMBER"].astype(str)
    missing = set(lines["ACCOUNT_NUMBER"]) - set(customers["ACCOUNT_NUMBER"])
    if missing:
        customers = pd.concat([customers, pd.DataFrame({"ACCOUNT_NUMBER": list(missing), "CUSTOMER_NAME": list(missing), "CUSTOMER_CLASS": ""})], ignore_index=True)

    p.step("history", "Customer × item × month history")
    lf, win = engine.windows(cfg, last_month)
    cm = engine.monthly(lines)
    rev12 = cm[(cm["MONTH"] > add_months(lf, -12)) & (cm["MONTH"] <= lf)].groupby("ACCOUNT_NUMBER")["revenue"].sum()
    tiers = engine.tier_of(rev12).to_dict()
    irev12 = cm[(cm["MONTH"] > add_months(lf, -12)) & (cm["MONTH"] <= lf)].groupby("ITEM_ID")["revenue"].sum()
    itiers = engine.tier_of(irev12).to_dict()

    p.step("baseline", "Expected demand (baselines)")
    dense, by_item, by_pc, pc = engine.expected_history(cm, items, lf, cfg)
    bt, bt_all = engine.backtest(dense, lf, tiers, pc)

    p.step("opps", "Missed opportunities, causes and evidence")
    ctx = {"lf": lf, "window": win, "items": items, "customers": customers, "pc": pc, "tiers": tiers, "oos": raw["oos"], "onhand": raw["onhand"], "ar": raw["ar"]}
    opps, ostats = engine.find(lines, cm, dense, ctx, cfg)
    opps = engine.alternatives(opps, cm, items, lf)

    p.step("churn", "Customer decline model")
    cust_scores, churn_info, _ = models.churn(cm, lines, lf, cfg, raw["ar"])
    p.step("orders", "Order-line risk models")
    order_risk, risk_infos = models.order_risk(lines, lf, cfg)
    p.step("xsell", "Cross-sell")
    xsell, rules = market.cross_sell(cm, customers, items, lf)
    p.step("price", "Price response")
    price = market.elasticity(cm, items, lf, float(cfg.get("defaultElasticity", -1.2)))

    version = f"{VERSION}+{lf}-{data_hash(root)[:6]}"
    scored_at = now_iso()
    if len(opps):
        opps["run_id"] = run_id
        opps["model_version"] = version
        opps["scored_at"] = scored_at
    fb = _feedback(root)
    if len(opps) and len(fb):
        opps = opps.merge(fb[["opp_id", "decision", "outcome"]].rename(columns={"decision": "fb_decision", "outcome": "fb_outcome"}), on="opp_id", how="left")

    p.step("write", "Writing the DuckDB file")
    hist = _prev(root, "sl_opp_history")
    if len(opps):
        cur = opps[["opp_id", "run_id", "scored_at", "account_number", "customer", "item", "window_from", "window_to", "lost_revenue", "lost_margin",
                    "recoverable_margin", "primary_cause", "confidence", "score", "priority", "model_version"]]
        hist = pd.concat([hist, cur], ignore_index=True) if len(hist) else cur
        hist = hist.drop_duplicates(subset=["opp_id", "run_id"], keep="last")
    sims = []
    for f in sorted(glob.glob(os.path.join(root, "sims", "*.json"))):
        s = read_json(f, {})
        if s:
            sims.append({"sim_id": os.path.basename(f)[:-5], "name": (s.get("scenario") or {}).get("name", ""), "at": s.get("at", ""), "by": s.get("by", ""),
                         "delta_revenue": (s.get("delta") or {}).get("revenue"), "delta_margin": (s.get("delta") or {}).get("margin"), "json": json.dumps(s, default=str)})

    # realised recovery: accepted opportunities whose window ended — sales after the window vs the window's monthly average
    recovered = []
    if len(hist) and len(fb):
        acc = fb[fb["decision"].astype(str).str.upper() == "ACCEPTED"][["opp_id", "decision", "outcome", "value"]]  # the page also sends account / item
        last = hist.sort_values("scored_at").groupby("opp_id").tail(1)
        num2id = dict(zip(items["ITEM_NUMBER"].astype(str), items["ITEM_ID"]))
        for r in last.merge(acc, on="opp_id").itertuples(index=False):
            iid = num2id.get(str(r.item), str(r.item))
            pair = cm[(cm["ACCOUNT_NUMBER"] == r.account_number) & (cm["ITEM_ID"] == iid)]
            inw = pair[(pair["MONTH"] >= r.window_from) & (pair["MONTH"] <= r.window_to)]["revenue"].sum()
            nw = max(1, (int(r.window_to) // 100 * 12 + int(r.window_to) % 100) - (int(r.window_from) // 100 * 12 + int(r.window_from) % 100) + 1)
            after = pair[pair["MONTH"] > r.window_to]
            if not len(after):
                continue
            na = after["MONTH"].nunique()
            gain = max(0.0, float(after["revenue"].sum()) - inw / nw * na)
            recovered.append({"opp_id": r.opp_id, "account_number": r.account_number, "item": r.item, "months_after": int(na), "recovered_revenue": round(gain, 2),
                              "typed_value": getattr(r, "value", None), "outcome": getattr(r, "outcome", None)})

    tmp = os.path.join(root, "saleslens.new.duckdb")
    for f in (tmp, tmp + ".wal"):
        if os.path.exists(f):
            os.remove(f)
    con = duckdb.connect(tmp)
    try:
        lw = lines.copy()
        lw.columns = [c.lower() for c in lw.columns]
        for c in ("ordered_date", "promised", "shipped_on"):
            lw[c] = pd.to_datetime(lw[c], errors="coerce").dt.strftime("%Y-%m-%d")
        keep = ["fulfill_line_id", "header_id", "order_number", "ordered_date", "month", "account_number", "bu_id", "org_id", "item_id", "item_number", "line_number",
                "is_return", "qty", "demand_qty", "cancel_qty", "oos_cancel", "return_qty", "shipped_qty", "net_price", "list_price", "discount_pct", "revenue",
                "margin", "margin_known", "cancel_value", "return_value", "status", "promised", "shipped_on", "late_days", "done", "partial", "open", "canceled",
                "cancel_reason", "return_reason", "salesperson", "created_by", "order_type", "currency", "fx", "uom", "uom_factor"]
        lw = lw[[c for c in keep if c in lw.columns]]
        lw["header_id"] = lw["header_id"].astype(str)
        lw["org_id"] = lw["org_id"].astype(str)
        _write(con, "sl_lines", lw)
        it = items.copy()
        it.columns = [c.lower() for c in it.columns]
        it["abc"] = it["item_id"].map(itiers).fillna("C")
        it["revenue_12"] = it["item_id"].map(irev12).fillna(0)
        _write(con, "sl_items", it)
        cu = customers.copy()
        cu.columns = [c.lower() for c in cu.columns]
        cu["tier"] = cu["account_number"].map(tiers).fillna("C")
        main_bu = lines.groupby("ACCOUNT_NUMBER")["BU_ID"].agg(lambda x: x.mode().iloc[0] if len(x.mode()) else "")
        cu["bu_id"] = cu["account_number"].map(main_bu).fillna("").astype(str)
        rep = lines.sort_values("ORDERED_DATE").groupby("ACCOUNT_NUMBER")["SALESPERSON"].last()
        cu["salesperson"] = cu["account_number"].map(rep).fillna("").astype(str)
        cu["revenue_12"] = cu["account_number"].map(rev12).fillna(0)
        if len(cust_scores):
            cu = cu.merge(cust_scores[["account_number", "risk", "risk_band", "revenue_at_risk"]], on="account_number", how="left")
        _write(con, "sl_customers", cu)
        bus = raw["bus"].copy()
        bus.columns = [c.lower() for c in bus.columns]
        _write(con, "sl_bus", bus)
        cmw = cm.rename(columns={"ACCOUNT_NUMBER": "account_number", "ITEM_ID": "item_id", "MONTH": "month"})
        if len(dense):
            ex = dense[["ACCOUNT_NUMBER", "ITEM_ID", "MONTH", "expected", "lo", "hi", "season"]].rename(columns={"ACCOUNT_NUMBER": "account_number", "ITEM_ID": "item_id", "MONTH": "month"})
            cmw = cmw.merge(ex, on=["account_number", "item_id", "month"], how="left")
        _write(con, "sl_cm", cmw)
        _write(con, "sl_opps", opps)
        _write(con, "sl_opp_history", hist if len(hist) else pd.DataFrame({"opp_id": pd.Series(dtype=str)}))
        _write(con, "sl_cust_scores", cust_scores)
        _write(con, "sl_order_risk", order_risk.rename(columns=str.lower) if len(order_risk) else order_risk)
        _write(con, "sl_xsell", xsell)
        _write(con, "sl_rules", rules)
        _write(con, "sl_price", price)
        _write(con, "sl_dq", dq)
        _write(con, "sl_quarantine", quarantine.astype(str) if len(quarantine) else pd.DataFrame({"reason": pd.Series(dtype=str)}))
        _write(con, "sl_recon", recon if len(recon) else pd.DataFrame({"month": pd.Series(dtype=int)}))
        _write(con, "sl_backtest", pd.DataFrame(bt))
        _write(con, "sl_feedback", fb.astype(str) if len(fb) else pd.DataFrame({"opp_id": pd.Series(dtype=str)}))
        _write(con, "sl_recovered", pd.DataFrame(recovered) if recovered else pd.DataFrame({"opp_id": pd.Series(dtype=str)}))
        _write(con, "sl_sims", pd.DataFrame(sims) if sims else pd.DataFrame({"sim_id": pd.Series(dtype=str)}))
        oh = raw["onhand"].copy()
        oh.columns = [c.lower() for c in oh.columns]
        _write(con, "sl_onhand", oh.astype(str) if len(oh) else pd.DataFrame({"item_id": pd.Series(dtype=str)}))
        model_rows, imp_rows, drift_rows = [], [], []
        base_info = {"model": "baseline", "title": "Expected demand baseline", "method": "Seasonal rolling average (12 months, deseasonalised)",
                     "target": "monthly quantity per customer × item", "metrics": bt_all, "rows": int(len(dense)),
                     "train_from": int(dense["MONTH"].min()) if len(dense) else None, "train_to": int(lf)}
        for info in [base_info, churn_info] + risk_infos:
            model_rows.append({"model": info["model"], "title": info.get("title"), "version": version, "method": info.get("method"), "target": info.get("target"),
                               "trained_at": scored_at, "train_from": info.get("train_from"), "train_to": info.get("train_to"), "rows": info.get("rows"),
                               "base_rate": info.get("base_rate"), "metrics": json.dumps(info.get("metrics") or {}), "run_id": run_id, "status": "ACTIVE"})
            for r in info.get("importance") or []:
                imp_rows.append({"model": info["model"], **r})
            for r in info.get("drift") or []:
                drift_rows.append({"model": info["model"], **r})
        prev_models = _prev(root, "sl_model_history")
        mh = pd.DataFrame(model_rows)
        mh = pd.concat([prev_models, mh], ignore_index=True) if len(prev_models) else mh
        _write(con, "sl_models", pd.DataFrame(model_rows))
        _write(con, "sl_model_history", mh.tail(500))
        _write(con, "sl_importance", pd.DataFrame(imp_rows))
        _write(con, "sl_drift", pd.DataFrame(drift_rows))
        summary = {
            "run_id": run_id, "version": version, "started": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(t0)), "ended": now_iso(),
            "seconds": round(time.time() - t0, 1), "last_month": int(lf), "window": [int(x) for x in win], "lines": int(len(lines)),
            "customers": int(lines["ACCOUNT_NUMBER"].nunique()), "items": int(lines["ITEM_ID"].nunique()),
            "months": int(lines["MONTH"].nunique()), "first_month": int(lines["MONTH"].min()), "opportunities": int(len(opps)), "stats": ostats,
            "quarantined": int(len(quarantine)), "dq_warnings": int((dq["severity"] == "WARN").sum()) if len(dq) else 0,
            "recon_diff": int((recon["status"] != "OK").sum()) if len(recon) else 0, "data_hash": data_hash(root),
            "open_lines": int(lines["OPEN"].sum()), "at_risk_customers": int((cust_scores["risk_band"] == "High").sum()) if len(cust_scores) else 0,
            "settings": cfg, "steps": p.steps, "pod": (raw.get("manifest") or {}).get("pod", ""),
        }
        prev_runs = _prev(root, "sl_runs")
        if "at" in prev_runs.columns:  # "at" is a DuckDB keyword: older files used it
            prev_runs = prev_runs.rename(columns={"at": "built_at"})
        runs = pd.concat([prev_runs, pd.DataFrame([{"run_id": run_id, "built_at": summary["ended"], "version": version, "opportunities": summary["opportunities"],
                                                    "lines": summary["lines"], "seconds": summary["seconds"], "summary": json.dumps(summary, default=str)}])], ignore_index=True)
        _write(con, "sl_runs", runs.tail(200))
        con.execute("CHECKPOINT")
    finally:
        con.close()
    target = os.path.join(root, DB)
    for attempt in range(20):
        try:
            os.replace(tmp, target)
            break
        except OSError:
            if attempt == 19:
                raise
            time.sleep(0.5)
    write_json(os.path.join(root, "runs", run_id + ".json"), summary)
    p.step("done", "Done", f"{len(opps)} opportunities")
    return {"ok": True, **{k: v for k, v in summary.items() if k != "settings"}}


def np_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    return str(o)

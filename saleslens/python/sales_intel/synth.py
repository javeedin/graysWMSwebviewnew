"""Demo data: a made-up wholesaler with known problems planted in the last months, written exactly like the host's Fusion
extract (raw/*.jsonl, upper-case column names, dates as text). Used by Setup › "Try with demo data" and by the tests.

Planted, so the tests can check the engine finds them (L1 = last full month):
  I005 stock-out in L1 (lines cancelled OUT_OF_STOCK + the WMS cancellation log) · C1007 pays 12 % more for I010 and buys
  half · C1012 stops buying after L3 · C1015 gets every delivery 6 days late and buys less · I020 comes back 25 % of the
  time · I030 falls 70 % for everybody · C1020 gets I002 only partly shipped · C1003 never bought I041 (peers do).
"""
import json
import os
from datetime import date, timedelta

import numpy as np

from .util import add_months, current_month

CATS = ["BEVERAGES", "DAIRY", "SNACKS", "HOUSEHOLD"]
SUPPLIERS = ["SUP-NORTH", "SUP-EAST", "SUP-WEST"]
CLASSES = ["RETAIL", "WHOLESALE", "HORECA"]


def _d(mk, day):
    y, m = divmod(mk, 100)
    day = max(1, min(day, 28))
    return date(y, m, day)


def generate(root, months=30, seed=7, pod="DEMO"):
    rng = np.random.default_rng(seed)
    raw = os.path.join(root, "raw")
    for sub in ("lines", "onhand"):
        os.makedirs(os.path.join(raw, sub), exist_ok=True)
    cur = current_month()
    first = add_months(cur, -(months - 1))
    month_list = [add_months(first, i) for i in range(months)]
    L1, L2, L3 = add_months(cur, -1), add_months(cur, -2), add_months(cur, -3)

    items = []
    for i in range(1, 61):
        cat = CATS[i % len(CATS)]
        price = float(round(rng.uniform(20, 400), 2))
        items.append({"INVENTORY_ITEM_ID": 100000 + i, "ITEM_NUMBER": f"I{i:03d}", "DESCRIPTION": f"{cat.title()} item {i}",
                      "PRIMARY_UOM": "EA", "ITEM_STATUS": "Active", "PROFIT_CENTER": cat, "SUPPLIER": SUPPLIERS[i % 3],
                      "ITEM_TYPE": "FINISHED", "_price": price, "_cost": round(price * float(rng.uniform(0.55, 0.8)), 2)})
    items.append({"INVENTORY_ITEM_ID": 100099, "ITEM_NUMBER": "CRATE-24", "DESCRIPTION": "Crate deposit", "PRIMARY_UOM": "EA",
                  "ITEM_STATUS": "Active", "PROFIT_CENTER": "", "SUPPLIER": "", "ITEM_TYPE": "DEPOSIT", "_price": 15.0, "_cost": 15.0})
    by_num = {it["ITEM_NUMBER"]: it for it in items}
    season = {c: [1 + 0.25 * np.sin(2 * np.pi * (k + j) / 12) for k in range(12)] for j, c in enumerate(CATS)}

    customers = []
    for c in range(1, 61):
        acct = f"C{1000 + c}"
        size = float(rng.lognormal(0, 0.6))
        cls = CLASSES[c % 3]
        n_items = int(rng.integers(8, 18))
        picks = list(rng.choice(60, n_items, replace=False) + 1)
        if acct == "C1003" and 41 in picks:
            picks.remove(41)
        basket = {f"I{p:03d}": max(2.0, float(rng.uniform(5, 40)) * size) for p in picks}
        if acct in ("C1007",):
            basket["I010"] = 60 * size
        if acct in ("C1020",):
            basket.setdefault("I002", 30 * size)
        if acct in ("C1015",):
            basket.update({"I011": 25 * size, "I012": 25 * size, "I013": 20 * size})
        for k in ("I005", "I020", "I030"):
            if rng.random() < 0.45 or acct in ("C1005", "C1009"):
                basket.setdefault(k, float(rng.uniform(8, 30)) * size)
        if acct != "C1003" and rng.random() < 0.6:
            basket.setdefault("I041", float(rng.uniform(5, 15)) * size)
        customers.append({"ACCOUNT_NUMBER": acct, "CUSTOMER_NAME": f"Customer {acct}", "CUSTOMER_CLASS": cls, "STATUS": "A",
                          "CREATED": str(_d(first, 1)), "_basket": basket, "_rep": f"SALESREP {1 + c % 5}"})

    lines_by_month = {mk: [] for mk in month_list}
    oos = []
    line_id = 5000000
    header_id = 900000
    order_no = 410000
    today = date.today()
    for mk in month_list:
        mi = month_list.index(mk)
        moy = mk % 100 - 1
        for cu in customers:
            acct = cu["ACCOUNT_NUMBER"]
            if acct == "C1012" and mk > L3:
                continue
            n_orders = int(rng.integers(2, 5))
            for o in range(n_orders):
                header_id += 1
                order_no += 1
                odate = _d(mk, 2 + o * 7 + int(rng.integers(0, 4)))
                if odate > today:
                    continue
                ln = 0
                for inum, base in cu["_basket"].items():
                    it = by_num[inum]
                    if rng.random() < 0.25:
                        continue
                    qty = base / n_orders * season[it["PROFIT_CENTER"] or CATS[0]][moy] * (1 + 0.004 * mi)
                    price = it["_price"]
                    list_price = price
                    if inum == "I030" and mk >= L3:
                        qty *= 0.3
                    if acct == "C1007" and inum == "I010" and mk >= L3:
                        price *= 1.12
                        qty *= 0.3
                    if acct == "C1015" and mk >= L3:
                        qty *= 0.55
                    if inum == "I020" and mk >= L3:
                        qty *= 0.6
                    qty = int(max(0, rng.poisson(max(qty, 0.3))))
                    if qty <= 0:
                        continue
                    ln += 1
                    line_id += 1
                    disc = float(rng.choice([0, 0, 0, 2, 5]))
                    selling = round(price * (1 - disc / 100), 2)
                    canceled = 0
                    cancel_reason = ""
                    status = "CLOSED"
                    shipped = qty
                    if inum == "I005" and mk == L1 and rng.random() < 0.85:
                        canceled, shipped, status, cancel_reason = qty, 0, "CANCELED", "OUT_OF_STOCK"
                        oos.append({"ITEM": inum, "LOGGED_AT": str(odate) + " 10:00:00", "RESULT": "DONE", "MESSAGE": "OUT OF STOCK", "ORDER_NUMBER": str(order_no)})
                    elif rng.random() < 0.02:
                        canceled, shipped, status, cancel_reason = qty, 0, "CANCELED", "CUSTOMER_REQUEST"
                    if acct == "C1020" and inum == "I002" and mk >= L3 and status != "CANCELED":
                        shipped = max(0, int(qty * 0.5))
                        status = "PARTIALLY_SHIPPED" if mk == L1 else "CLOSED"
                    req = odate + timedelta(days=2)
                    late = 6 if acct == "C1015" and mk >= add_months(cur, -4) else int(rng.choice([0, 0, 0, 0, 1, 3]))
                    ship = req + timedelta(days=late) if status != "CANCELED" else None
                    open_line = mk == cur and odate >= today - timedelta(days=4) and status != "CANCELED"
                    if open_line:
                        status, ship, shipped = "AWAIT_SHIPPING", None, 0
                    ordered = 0 if status == "CANCELED" else qty
                    lines_by_month[mk].append({
                        "FULFILL_LINE_ID": line_id, "HEADER_ID": header_id, "ORDER_NUMBER": str(order_no), "ORDERED_DATE": str(odate),
                        "ACCOUNT_NUMBER": acct, "BU_ID": 300000003234003, "CURRENCY": "MUR", "INVENTORY_ITEM_ID": it["INVENTORY_ITEM_ID"],
                        "ORG_ID": 300000001, "LINE_NUMBER": str(ln), "CATEGORY": "ORDER", "ORDERED_QTY": ordered, "SHIPPED_QTY": shipped,
                        "CANCELED_QTY": canceled, "UOM": "EA", "UNIT_LIST_PRICE": list_price, "UNIT_SELLING_PRICE": selling,
                        "EXTENDED_AMOUNT": round(ordered * selling, 2), "STATUS": status, "REQUEST_SHIP_DATE": str(req),
                        "SCHEDULE_SHIP_DATE": str(req), "PROMISE_SHIP_DATE": str(req), "ACTUAL_SHIP_DATE": str(ship) if ship else None,
                        "CANCEL_REASON": cancel_reason, "RETURN_REASON": "", "SALESPERSON": cu["_rep"], "ORDER_TYPE": "STANDARD",
                        "CREATED_BY": cu["_rep"].replace(" ", ".").lower()})
                    if inum == "I020" and mk >= L3 and status == "CLOSED" and rng.random() < 0.25:
                        line_id += 1
                        lines_by_month[mk].append({
                            "FULFILL_LINE_ID": line_id, "HEADER_ID": header_id + 500000, "ORDER_NUMBER": "R" + str(order_no),
                            "ORDERED_DATE": str(odate + timedelta(days=5)), "ACCOUNT_NUMBER": acct, "BU_ID": 300000003234003, "CURRENCY": "MUR",
                            "INVENTORY_ITEM_ID": it["INVENTORY_ITEM_ID"], "ORG_ID": 300000001, "LINE_NUMBER": "1", "CATEGORY": "RETURN",
                            "ORDERED_QTY": -max(1, qty // 2), "SHIPPED_QTY": 0, "CANCELED_QTY": 0, "UOM": "EA", "UNIT_LIST_PRICE": list_price,
                            "UNIT_SELLING_PRICE": selling, "EXTENDED_AMOUNT": -round(max(1, qty // 2) * selling, 2), "STATUS": "CLOSED",
                            "REQUEST_SHIP_DATE": None, "SCHEDULE_SHIP_DATE": None, "PROMISE_SHIP_DATE": None, "ACTUAL_SHIP_DATE": None,
                            "CANCEL_REASON": "", "RETURN_REASON": "DAMAGED", "SALESPERSON": cu["_rep"], "ORDER_TYPE": "RETURN", "CREATED_BY": "returns"})
                if ln and rng.random() < 0.5:     # a crate line on the order (left out by the rules)
                    line_id += 1
                    lines_by_month[mk].append({**lines_by_month[mk][-1], "FULFILL_LINE_ID": line_id, "INVENTORY_ITEM_ID": 100099,
                                               "LINE_NUMBER": f"{ln}.2", "ORDERED_QTY": 2, "SHIPPED_QTY": 2, "CANCELED_QTY": 0,
                                               "UNIT_LIST_PRICE": 15.0, "UNIT_SELLING_PRICE": 15.0, "EXTENDED_AMOUNT": 30.0, "CATEGORY": "ORDER"})
    # a duplicated line (quarantined by the data-quality rules)
    some = lines_by_month[L2]
    if some:
        some.append(dict(some[0]))

    manifest = {"pod": pod, "kind": "demo", "months": {}}
    for mk, rows in lines_by_month.items():
        with open(os.path.join(raw, "lines", f"{mk}.jsonl"), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        kept = [r for r in rows]
        qty = sum(float(r["ORDERED_QTY"] or 0) for r in kept)
        amt = sum(float(r["EXTENDED_AMOUNT"] or 0) for r in kept)
        manifest["months"][str(mk)] = {"rows": len(rows), "fusionRows": len(rows) - (1 if mk == L2 else 0), "fusionQty": round(qty, 2),
                                       "fusionAmount": round(amt, 2), "readAt": str(today), "alt": 0}

    def dump(name, rows):
        with open(os.path.join(raw, name), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps({k: v for k, v in r.items() if not k.startswith("_")}) + "\n")

    dump("items.jsonl", items)
    dump("customers.jsonl", customers)
    dump("costs.jsonl", [{"ITEM_ID": it["INVENTORY_ITEM_ID"], "UNIT_COST": it["_cost"]} for it in items if not it["ITEM_NUMBER"].startswith("I0") or int(it["ITEM_NUMBER"][1:]) % 9])
    dump("bus.jsonl", [{"BU_ID": 300000003234003, "BU_NAME": "GRAYS INC BU"}])
    dump("oos.jsonl", oos)
    dump("ar.jsonl", [{"ACCOUNT_NUMBER": c["ACCOUNT_NUMBER"], "DUE": round(float(rng.uniform(0, 50000)), 2),
                       "OVERDUE": 45000.0 if c["ACCOUNT_NUMBER"] == "C1015" else round(float(rng.uniform(0, 5000)), 2),
                       "OVER90": 20000.0 if c["ACCOUNT_NUMBER"] == "C1015" else 0.0, "CREDIT_HOLD": "N", "AS_OF": str(today)} for c in customers])
    with open(os.path.join(raw, "onhand", f"{today:%Y%m%d}.jsonl"), "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps({"ITEM_ID": it["INVENTORY_ITEM_ID"], "ORG_ID": 300000001, "QTY": 0 if it["ITEM_NUMBER"] == "I005" else int(rng.integers(20, 900))}) + "\n")
    manifest["items"] = {"rows": len(items)}
    manifest["customers"] = {"rows": len(customers)}
    manifest["readAt"] = str(today)
    with open(os.path.join(raw, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    return {"months": len(month_list), "lines": sum(len(v) for v in lines_by_month.values()), "customers": len(customers), "items": len(items)}

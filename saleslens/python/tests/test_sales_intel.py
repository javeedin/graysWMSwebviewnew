"""End-to-end tests on the demo data: every planted problem must come out with the right cause and evidence."""
import json
import os
import subprocess
import sys

import duckdb
import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from sales_intel import build, prep, synth  # noqa: E402
from sales_intel.settings import merge  # noqa: E402
from sales_intel.simulate import run as simulate  # noqa: E402


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = str(tmp_path_factory.mktemp("sl"))
    synth.generate(root, months=30, seed=7)
    out = build.run(root, quiet=True)
    assert out["ok"], out
    con = duckdb.connect(os.path.join(root, "saleslens.duckdb"), read_only=True)
    yield root, out, con
    con.close()


def opps(con, where):
    return con.execute(f"SELECT * FROM sl_opps WHERE {where}").df()


def test_summary(built):
    _, out, _ = built
    assert out["opportunities"] > 20
    assert out["months"] == 30
    assert out["quarantined"] == 1          # the planted duplicate line
    assert out["recon_diff"] == 1           # the month whose Fusion count differs


def test_stockout(built):
    _, _, con = built
    d = opps(con, "item = 'I005'")
    assert len(d) >= 2
    assert (d["primary_cause"] == "STOCKOUT").all()
    assert d["evidence"].str.contains("OUT OF STOCK").all()
    assert d["substitute"].str.len().gt(0).all()          # an alternative item is proposed


def test_price_increase(built):
    _, _, con = built
    d = opps(con, "account_number = 'C1007' AND item = 'I010'")
    assert len(d) == 1
    probs = json.loads(d.iloc[0]["cause_probs"])
    assert "PRICE_UP" in probs
    assert "net price up" in d.iloc[0]["evidence"]


def test_customer_stopped(built):
    _, _, con = built
    d = opps(con, "account_number = 'C1012'")
    assert len(d) >= 1 and (d["primary_cause"] == "INACTIVE").all()


def test_late_and_payment(built):
    _, _, con = built
    d = opps(con, "account_number = 'C1015'")
    assert len(d) >= 2
    assert (d["primary_cause"] == "LATE").any()
    assert d["evidence"].str.contains("overdue").any()


def test_lifecycle_and_returns(built):
    _, _, con = built
    assert (opps(con, "item = 'I030' AND account_number <> 'C1012'")["primary_cause"] == "LIFECYCLE").all()
    d = opps(con, "item = 'I020'")
    assert d["cause_probs"].str.contains("RETURNS").any()


def test_partial(built):
    _, _, con = built
    d = opps(con, "account_number = 'C1020' AND item = 'I002'")
    assert len(d) == 1 and d.iloc[0]["primary_cause"] == "PARTIAL"


def test_every_opportunity_is_complete(built):
    _, _, con = built
    d = con.execute("SELECT * FROM sl_opps").df()
    for col in ("lost_revenue", "lost_margin", "confidence", "evidence", "action", "owner", "due_date", "model_version", "scored_at", "run_id"):
        assert d[col].notna().all(), col
    assert (d["lost_revenue"] > 0).all()
    assert d["score"].between(0, 100).all()
    assert set(d["priority"]) <= {"High", "Medium", "Low"}


def test_cross_sell_and_models(built):
    _, _, con = built
    x = con.execute("SELECT item FROM sl_xsell WHERE account_number = 'C1003'").df()
    assert "I041" in set(x["item"])
    m = con.execute("SELECT model, method FROM sl_models").df()
    assert {"baseline", "churn", "order_late", "order_cancel", "order_partial"} <= set(m["model"])
    r = con.execute("SELECT * FROM sl_order_risk").df()
    assert len(r) > 0 and r["risk"].between(0, 1).all()
    c = con.execute("SELECT * FROM sl_cust_scores ORDER BY risk DESC").df()
    assert c.iloc[0]["account_number"] in ("C1012", "C1015")


def test_simulation(built):
    _, _, con = built
    s = simulate(con, {"inventoryPct": 10, "pricePct": 2, "recoveryRatePct": 20})
    assert s["estimate"] is True
    assert s["baseline"]["revenue"] > 0
    assert {p["lever"] for p in s["levers"]} == {"inventoryPct", "price", "recoveryRatePct"}
    assert s["range"]["margin_low"] <= s["delta"]["margin"] <= s["range"]["margin_high"] + 1e-6
    only = simulate(con, {"pricePct": 5, "scope": {"items": ["I005"]}})
    assert only["impacted"]["items"] == 1


def test_feedback_carries_over(built, tmp_path):
    root, _, con = built
    first, acct, item = con.execute("SELECT opp_id, account_number, item FROM sl_opps LIMIT 1").fetchone()
    with open(os.path.join(root, "feedback.jsonl"), "a", encoding="utf-8") as f:  # the fields the page sends
        f.write(json.dumps({"opp_id": first, "account_number": acct, "item": item, "decision": "ACCEPTED", "outcome": "WON", "value": "5000", "at": "2026-01-01T00:00:00", "by": "TEST"}) + "\n")
    con.close()
    out = build.run(root, quiet=True)
    assert out["ok"]
    c2 = duckdb.connect(os.path.join(root, "saleslens.duckdb"), read_only=True)
    try:
        assert c2.execute("SELECT fb_decision FROM sl_opps WHERE opp_id = ?", [first]).fetchone()[0] == "ACCEPTED"
        assert c2.execute("SELECT COUNT(DISTINCT run_id) FROM sl_opp_history").fetchone()[0] == 2
    finally:
        c2.close()


def test_rules_leave_out_lines():
    raw = {"lines": prep.frame([
        {"FULFILL_LINE_ID": 1, "ORDERED_DATE": "2026-01-05", "ACCOUNT_NUMBER": "A", "INVENTORY_ITEM_ID": 1, "ORDERED_QTY": 2, "UNIT_SELLING_PRICE": 0, "LINE_NUMBER": "1"},
        {"FULFILL_LINE_ID": 2, "ORDERED_DATE": "2026-01-05", "ACCOUNT_NUMBER": "A", "INVENTORY_ITEM_ID": 2, "ORDERED_QTY": 2, "UNIT_SELLING_PRICE": 5, "LINE_NUMBER": "1.2"},
        {"FULFILL_LINE_ID": 3, "ORDERED_DATE": "2026-01-05", "ACCOUNT_NUMBER": "A", "INVENTORY_ITEM_ID": 3, "ORDERED_QTY": 2, "UNIT_SELLING_PRICE": 5, "LINE_NUMBER": "2"},
        {"FULFILL_LINE_ID": 4, "ORDERED_DATE": "2026-01-05", "ACCOUNT_NUMBER": "A", "INVENTORY_ITEM_ID": 3, "ORDERED_QTY": -2, "UNIT_SELLING_PRICE": 5, "LINE_NUMBER": "3"},
        {"FULFILL_LINE_ID": 5, "ORDERED_DATE": "2026-01-05", "ACCOUNT_NUMBER": "A", "INVENTORY_ITEM_ID": 3, "ORDERED_QTY": 2, "UNIT_SELLING_PRICE": 5, "LINE_NUMBER": "4", "CURRENCY": "USD"},
    ], prep.LINE_COLS).assign(_file="x"), "items": prep.frame([], ["INVENTORY_ITEM_ID", "ITEM_NUMBER", "DESCRIPTION", "PRIMARY_UOM"]),
        "rates": prep.frame([{"FROM_CURRENCY": "USD", "MONTH": "2026-01", "RATE": 45}]), "uom": prep.frame([], ["ITEM_ID", "UOM_CODE", "RATE"]),
        "costs": prep.frame([], ["ITEM_ID", "UNIT_COST"]), "manifest": {}}
    lines, dq, q, _ = prep.clean(raw, merge({}))
    assert sorted(lines["FULFILL_LINE_ID"]) == ["3", "5"]
    assert len(q) == 1 and "negative" in q.iloc[0]["REASON"]
    assert float(lines.loc[lines["FULFILL_LINE_ID"] == "5", "NET_PRICE"].iloc[0]) == 225.0


def test_cli_demo_and_build(tmp_path):
    root = str(tmp_path / "cli")
    for cmd in (["demo", "--months", "26"], ["build", "--quiet"]):
        r = subprocess.run([sys.executable, "-m", "sales_intel", cmd[0], "--root", root] + cmd[1:], cwd=HERE, capture_output=True, text=True, timeout=600)
        last = [x for x in r.stdout.splitlines() if x.startswith("{")][-1]
        assert json.loads(last)["ok"], r.stdout[-2000:] + r.stderr[-2000:]

"""Sales Lens — Python check run by the desktop app (Setup tab).

    python sl_check.py versions   -> JSON: Python + every package (required / installed / ok)
    python sl_check.py selftest   -> JSON: a tiny end-to-end run (baseline forecast, LightGBM with reasons,
                                     scikit-learn metric, DuckDB write + read, Parquet) with the time per step

Prints exactly one JSON line on stdout; never touches Fusion, APEX or any real data.
"""
import json
import os
import platform
import sys
import tempfile
import time
from importlib import metadata

PACKAGES = [  # (import name, distribution name)
    ("numpy", "numpy"), ("pandas", "pandas"), ("statsmodels", "statsmodels"), ("sklearn", "scikit-learn"),
    ("lightgbm", "lightgbm"), ("duckdb", "duckdb"), ("pyarrow", "pyarrow"), ("joblib", "joblib"),
]


def required():
    req = {}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.split("#", 1)[0].strip()
                if not line:
                    continue
                for op in ("==", ">=", "<=", "~="):
                    if op in line:
                        name, ver = line.split(op, 1)
                        req[name.strip().lower()] = op + ver.strip()
                        break
                else:
                    req[line.lower()] = ""
    except OSError:
        pass
    return req


def vtuple(v):
    out = []
    for p in v.split("."):
        n = "".join(ch for ch in p if ch.isdigit())
        out.append(int(n) if n else 0)
    return tuple(out)


def satisfies(installed, spec):
    if not spec:
        return True
    op, want = spec[:2], spec[2:]
    a, b = vtuple(installed), vtuple(want)
    if op == "==":
        return a[:len(b)] == b
    if op == ">=":
        return a >= b
    if op == "<=":
        return a <= b
    return a[:len(b) - 1] == b[:len(b) - 1] and a >= b  # ~=


def versions():
    req = required()
    rows = []
    for mod, dist in PACKAGES:
        spec = req.get(dist, "")
        try:
            ver = metadata.version(dist)
        except metadata.PackageNotFoundError:
            ver = None
        err = None
        if ver:
            try:
                __import__(mod)
            except Exception as e:  # installed but does not load (e.g. a missing Visual C++ runtime)
                err = f"{type(e).__name__}: {e}"
        rows.append({"name": dist, "required": spec, "installed": ver,
                     "ok": bool(ver) and err is None and satisfies(ver, spec), "error": err})
    return {"ok": all(r["ok"] for r in rows), "python": platform.python_version(), "executable": sys.executable,
            "platform": platform.platform(), "packages": rows}


def selftest():
    steps = []

    def step(name, fn):
        t = time.perf_counter()
        try:
            detail = fn()
            steps.append({"step": name, "ok": True, "ms": round((time.perf_counter() - t) * 1000), "detail": detail})
            return True
        except Exception as e:
            hint = ""
            if "lightgbm" in name.lower() and ("dll" in str(e).lower() or "vcomp" in str(e).lower()):
                hint = " — install the Microsoft Visual C++ Redistributable (x64) and run the self-test again"
            steps.append({"step": name, "ok": False, "ms": round((time.perf_counter() - t) * 1000), "detail": f"{type(e).__name__}: {e}{hint}"})
            return False

    ctx = {}

    def make_data():
        import numpy as np
        import pandas as pd
        rng = np.random.default_rng(7)
        months = pd.period_range("2023-01", periods=36, freq="M")
        rows = []
        for c in range(20):
            for i in range(10):
                base = rng.uniform(50, 400)
                for k, m in enumerate(months):
                    season = 1 + 0.25 * np.sin(2 * np.pi * k / 12)
                    stockout = rng.random() < 0.08
                    qty = max(0.0, base * season * rng.normal(1, 0.12) * (0.3 if stockout else 1))
                    rows.append((f"C{c:03d}", f"I{i:03d}", str(m), k, season, int(stockout), round(qty, 2)))
        df = pd.DataFrame(rows, columns=["customer", "item", "month", "t", "season", "stockout", "qty"])
        ctx["df"] = df
        return f"{len(df):,} synthetic customer × item × month rows"

    def baseline():
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        s = ctx["df"].groupby("t")["qty"].sum()
        fit = ExponentialSmoothing(s.values, trend="add", seasonal="add", seasonal_periods=12).fit()
        f = fit.forecast(3)
        return "Holt-Winters baseline, next 3 months: " + ", ".join(f"{v:,.0f}" for v in f)

    def model():
        import lightgbm as lgb
        import numpy as np
        df = ctx["df"]
        x = df[["t", "season", "stockout"]].astype(float).values
        y = df["qty"].values
        m = lgb.LGBMRegressor(n_estimators=60, learning_rate=0.1, num_leaves=15, verbose=-1).fit(x, y)
        contrib = m.predict(x[:5], pred_contrib=True)
        ctx["pred"] = m.predict(x)
        top = ["t", "season", "stockout"][int(np.argmax(np.abs(contrib[:, :3]).mean(axis=0)))]
        return f"LightGBM trained on {len(y):,} rows; per-row reasons work (strongest factor: {top})"

    def metric():
        from sklearn.metrics import mean_absolute_percentage_error
        df = ctx["df"]
        mask = df["qty"] > 1
        mape = mean_absolute_percentage_error(df["qty"][mask], ctx["pred"][mask])
        return f"scikit-learn: in-sample error {mape:.1%}"

    def storage():
        import duckdb
        df = ctx["df"]
        d = tempfile.mkdtemp(prefix="sl_selftest_")
        db = os.path.join(d, "selftest.duckdb")
        pq = os.path.join(d, "selftest.parquet")
        df.to_parquet(pq)
        con = duckdb.connect(db)
        con.execute("CREATE TABLE t AS SELECT * FROM read_parquet(?)", [pq])
        n, total = con.execute("SELECT COUNT(*), ROUND(SUM(qty)) FROM t").fetchone()
        con.close()
        for f in (db, pq):
            try:
                os.remove(f)
            except OSError:
                pass
        try:
            os.rmdir(d)
        except OSError:
            pass
        return f"Parquet + DuckDB {duckdb.__version__}: {n:,} rows written and read back"

    if step("Sample data (pandas / numpy)", make_data):
        step("Baseline forecast (statsmodels)", baseline)
        if step("Model with reasons (LightGBM)", model):
            step("Accuracy (scikit-learn)", metric)
        step("Storage (Parquet + DuckDB)", storage)
    return {"ok": all(s["ok"] for s in steps) and len(steps) == 5, "python": platform.python_version(), "steps": steps}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "versions"
    try:
        out = selftest() if mode == "selftest" else versions()
    except Exception as e:
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(out))


if __name__ == "__main__":
    main()

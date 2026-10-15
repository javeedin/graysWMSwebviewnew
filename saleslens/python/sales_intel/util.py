"""Small helpers shared by the steps."""
import json
import math
import os
import sys
import time
from datetime import date, datetime


def now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def month_key(d):
    """'2026-03-15' / date → 202603 (int)."""
    if d is None:
        return None
    if isinstance(d, (int, float)) and not (isinstance(d, float) and math.isnan(d)):
        return int(d)
    s = str(d)[:10]
    if len(s) < 7 or not s[:4].isdigit():
        return None
    return int(s[:4]) * 100 + int(s[5:7])


def add_months(mk, n):
    y, m = divmod(mk, 100)
    t = y * 12 + (m - 1) + n
    return (t // 12) * 100 + (t % 12) + 1


def months_between(a, b):
    """number of months from a to b (b - a)."""
    ya, ma = divmod(a, 100)
    yb, mb = divmod(b, 100)
    return (yb * 12 + mb) - (ya * 12 + ma)


def month_label(mk):
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    y, m = divmod(int(mk), 100)
    return f"{names[m - 1]}-{str(y)[2:]}"


def current_month():
    t = date.today()
    return t.year * 100 + t.month


def fnum(x, default=0.0):
    try:
        if x is None or x == "":
            return default
        v = float(x)
        return default if math.isnan(v) or math.isinf(v) else v
    except (TypeError, ValueError):
        return default


def money(v):
    v = fnum(v)
    a = abs(v)
    if a >= 1e6:
        return f"{v / 1e6:,.2f}M"
    if a >= 1e3:
        return f"{v / 1e3:,.1f}k"
    return f"{v:,.0f}"


class Progress:
    """Progress lines the host forwards to the page: ``PROGRESS {json}`` on stdout."""

    def __init__(self, quiet=False):
        self.quiet = quiet
        self.t0 = time.time()
        self.steps = []

    def step(self, key, label, detail=""):
        self.steps.append({"key": key, "label": label, "t": round(time.time() - self.t0, 1)})
        self.emit({"step": key, "label": label, "detail": detail})

    def note(self, msg):
        self.emit({"note": msg})

    def emit(self, obj):
        if self.quiet:
            return
        obj["t"] = round(time.time() - self.t0, 1)
        sys.stdout.write("PROGRESS " + json.dumps(obj, default=str) + "\n")
        sys.stdout.flush()


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, default=str, indent=1)
    os.replace(tmp, path)

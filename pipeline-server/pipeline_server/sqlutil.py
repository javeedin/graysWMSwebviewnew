"""SQL text helpers shared by the control store, sources and targets (Oracle dialect unless noted)."""
from __future__ import annotations

import datetime as dt
import re

RE_BRACE = re.compile(r"\{\{\s*([A-Za-z_]\w*)\s*\}\}")
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
PIECE = 1300                      # CLOB read back in pieces through the ORDS gateway


def lit(v) -> str:
    """Oracle literal: NULL, number, TIMESTAMP or quoted text."""
    if v is None or v == "":
        return "NULL"
    if isinstance(v, bool):
        return "'Y'" if v else "'N'"
    if isinstance(v, (int, float)):
        return repr(v) if isinstance(v, int) else format(v, ".15g")
    if isinstance(v, dt.datetime):
        return "TO_TIMESTAMP('" + v.strftime("%Y-%m-%d %H:%M:%S.%f") + "', 'YYYY-MM-DD HH24:MI:SS.FF6')"
    if isinstance(v, dt.date):
        return "DATE '" + v.isoformat() + "'"
    s = str(v)
    if len(s) > 3900:             # a literal over 4000 bytes fails: build a CLOB in pieces
        return " || ".join("TO_CLOB('" + s[i:i + 3000].replace("'", "''") + "')" for i in range(0, len(s), 3000))
    return "'" + s.replace("'", "''") + "'"


def vlit(v, max_len: int = 4000) -> str:
    return lit(None if v is None else str(v)[:max_len])


def ts_lit(t: dt.datetime | None) -> str:
    return "NULL" if t is None else "TO_TIMESTAMP('" + t.strftime("%Y-%m-%d %H:%M:%S") + "', 'YYYY-MM-DD HH24:MI:SS')"


def clob_pieces(col: str, n: int = 12) -> str:
    return ", ".join(f"TO_CHAR(SUBSTR({col}, {i * PIECE + 1}, {PIECE})) AS P{i}" for i in range(n))


def join_pieces(row: dict, n: int = 12) -> str:
    return "".join(row.get(f"P{i}") or "" for i in range(n))


def ident(name: str) -> str:
    """A safe UPPER-case Oracle / DuckDB identifier from a column name."""
    s = re.sub(r"[^A-Za-z0-9_$#]", "_", str(name).strip()).upper().strip("_") or "COL"
    if s[0].isdigit():
        s = "C_" + s
    return s[:128]


def table_name(name: str) -> str:
    """owner.table or table; each part sanitised."""
    return ".".join(ident(p) for p in str(name).split(".") if p.strip())


# ── {{P_X}} parameters - the same rules as the app (fusionsql.js substituteParams) ──
def parse_date_value(v: str, name: str = ""):
    v = str(v or "").strip().upper()
    tm = re.match(r"^(.*?)[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$", v)
    time = None
    if tm:
        v = tm.group(1).strip()
        time = f"{int(tm.group(2)):02d}:{tm.group(3)}:{tm.group(4) or '00'}"
    if m := re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", v):
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    elif m := re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$", v):
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
    elif (m := re.match(r"^(\d{1,2})[-/. ]?([A-Z]{3})[A-Z]*[-/. ]?(\d{2}|\d{4})$", v)) and m[2] in MONTHS:
        d, mo, y = int(m[1]), MONTHS[m[2]], int(m[3])
        y = y + 2000 if y < 100 else y
    elif "DATE" in (name or "").upper() and (m := re.match(r"^(\d{4})(\d{2})(\d{2})$", v)):
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    else:
        return None
    try:
        dt.date(y, mo, d)
    except ValueError:
        return None
    return f"{y:04d}-{mo:02d}-{d:02d}", time


def param_literal(v, name: str, in_to_date: bool) -> str:
    t = "" if v is None else str(v).strip()
    if t == "":
        return "NULL"
    if in_to_date:
        return lit(t)
    dv = parse_date_value(t, name)
    if dv:
        return f"TO_DATE('{dv[0]} {dv[1]}','YYYY-MM-DD HH24:MI:SS')" if dv[1] else f"DATE '{dv[0]}'"
    if re.fullmatch(r"-?\d+(\.\d+)?", t):
        return t
    return lit(str(v))


def substitute_params(sql: str, values: dict) -> str:
    """{{NAME}} → literal (outside quotes and comments). Unknown names become NULL like in the app.
    {{WATERMARK}} is left alone - the loader fills it."""
    by_upper = {str(k).upper(): v for k, v in (values or {}).items()}
    out, i, n = [], 0, len(sql)
    code_start = 0

    def flush(code: str):
        def rep(m):
            nm = m.group(1).upper()
            if nm == "WATERMARK":
                return m.group(0)
            before = code[:m.start()]
            in_td = bool(re.search(r"TO_(DATE|TIMESTAMP)\s*\(\s*$", before, re.I))
            return param_literal(by_upper.get(nm), nm, in_td)
        out.append(RE_BRACE.sub(rep, code))

    while i < n:
        c = sql[i]
        if c == "'" or sql.startswith("--", i) or sql.startswith("/*", i):
            flush(sql[code_start:i])
            if c == "'":
                j = i + 1
                while j < n:
                    if sql[j] == "'" and j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    if sql[j] == "'":
                        break
                    j += 1
                j = min(j + 1, n)
            elif sql.startswith("--", i):
                j = sql.find("\n", i)
                j = n if j < 0 else j
            else:
                j = sql.find("*/", i + 2)
                j = n if j < 0 else j + 2
            out.append(sql[i:j])
            i = code_start = j
            continue
        i += 1
    flush(sql[code_start:])
    return "".join(out)


def strip_sql(sql: str) -> str:
    s = (sql or "").strip()
    while s.endswith(";"):
        s = s[:-1].rstrip()
    return s


READ_ONLY = re.compile(r"^\s*(\(\s*)*(SELECT|WITH)\b", re.I)
INLINE_PLSQL = re.compile(r"\bWITH\s+(FUNCTION|PROCEDURE)\b|\bPRAGMA\b", re.I)


def check_read_only(sql: str) -> str | None:
    body = re.sub(r"^(\s*(--[^\n]*\n|/\*.*?\*/))*", "", sql, flags=re.S)
    if not READ_ONLY.match(body):
        return "Only SELECT / WITH statements can be a pipeline source."
    if INLINE_PLSQL.search(body):
        return "Inline PL/SQL (WITH FUNCTION / PROCEDURE, PRAGMA) is not allowed."
    return None

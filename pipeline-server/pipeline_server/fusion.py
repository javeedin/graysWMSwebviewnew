"""Run read-only SQL on Oracle Fusion through the BI Publisher "query runner" report - the same runner the
WMS app deploys (Fusion SQL › Connection › Deploy runner report, /Custom/GraysWMS/QueryRunner.xdo).

The statement goes base64-encoded in the report parameter P_QRY_STMT; the data model runs it through
DBMS_XMLGEN and the rows come back as a ROWSET inside the report bytes. Port of FusionSqlService.cs.
"""
from __future__ import annotations

import base64
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from html import escape

import httpx

from .sqlutil import check_read_only, strip_sql

V2_NS = "http://xmlns.oracle.com/oxp/service/v2"


class FusionError(Exception):
    pass


@dataclass
class FusionResult:
    columns: list = field(default_factory=list)
    rows: list = field(default_factory=list)     # dicts, values as text ('' never - NULL columns are absent)
    elapsed_ms: int = 0


def build_envelope(report_path: str, user: str, password: str, b64: str, fmt: str = "xml") -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="{V2_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:attributeFormat>{fmt}</v2:attributeFormat>
        <v2:reportAbsolutePath>{escape(report_path)}</v2:reportAbsolutePath>
        <v2:sizeOfDataChunkDownload>-1</v2:sizeOfDataChunkDownload>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>
            <v2:item>
              <v2:name>P_QRY_STMT</v2:name>
              <v2:values><v2:item>{b64}</v2:item></v2:values>
            </v2:item>
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>{escape(user)}</v2:userID>
      <v2:password>{escape(password)}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>"""


def capped_sql(stmt: str, cap: int) -> str:
    # line breaks matter: a last line ending in a -- comment would swallow the closing parenthesis
    return "SELECT * FROM (\n" + stmt + "\n) WHERE ROWNUM <= " + str(int(cap))


def read_soap(text: str, element: str = "reportBytes") -> tuple[str | None, str | None]:
    if not text or not text.strip():
        return None, None
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        title = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
        return None, "Unexpected non-XML response" + (f" ({title.group(1).strip()})" if title else "") + ": " + re.sub(r"\s+", " ", text)[:200]
    value = fault = None
    for e in root.iter():
        tag = e.tag.split("}")[-1]
        if tag == element and value is None:
            value = e.text or ""
        elif tag in ("faultstring", "message") and fault is None and (e.text or "").strip():
            fault = e.text.strip()
    return value, fault


# ── ROWSET parsing (FusionSqlService.RowsetParser) ─────────────
_XML_NAME = re.compile(r"_x([0-9A-Fa-f]{4})_")
_LOOSE_ROW = re.compile(r"<ROW>(.*?)</ROW>", re.S)
_LOOSE_COL = re.compile(r"<([^\s<>/]+)>(.*?)</\1>|<([^\s<>/]+)\s*/>", re.S)
_ENVELOPE_KEYS = {"RESULT", "P_QRY_STMT"}


def decode_name(tag: str) -> str:
    return _XML_NAME.sub(lambda m: chr(int(m.group(1), 16)), tag)


def xml_unescape_once(s: str) -> str:
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")
    s = re.sub(r"&#(x?)([0-9A-Fa-f]+);", lambda m: chr(int(m.group(2), 16 if m.group(1) else 10)), s)
    return s.replace("&amp;", "&")


def _rowset_text(frag: str):
    try:
        root = ET.fromstring(re.sub(r"^\s*<\?xml[^>]*\?>", "", frag))
    except ET.ParseError:
        return None
    rows = []
    for row in root:
        if row.tag.split("}")[-1] != "ROW":
            continue
        d = {}
        for c in row:
            if len(c) == 0:
                d[decode_name(c.tag.split("}")[-1])] = (c.text or "").strip()
        rows.append(d)
    return rows


def _rowset_loose(frag: str):
    rows = []
    for r in _LOOSE_ROW.finditer(frag):
        d = {}
        for c in _LOOSE_COL.finditer(r.group(1)):
            if c.group(3):
                continue                               # <COL/> = NULL
            d[decode_name(c.group(1))] = xml_unescape_once(c.group(2)).strip()
        rows.append(d)
    return rows if rows or "<ROWSET" in frag else None


def _extract_rowset(t: str):
    start = t.find("<ROWSET")
    if start < 0:
        return None
    close = t.find(">", start)
    if close > start and t[close - 1] == "/":
        return []
    end = t.find("</ROWSET>", start)
    if end < 0:
        return None
    frag = t[start:end + len("</ROWSET>")]
    before = start - 1
    while before >= 0 and t[before].isspace():
        before -= 1
    if before >= 0 and t[before] == '"':
        frag = frag.replace('""', '"')
    r = _rowset_text(frag)
    return r if r is not None else _rowset_loose(frag)


def _empty_envelope(t: str) -> bool:
    try:
        root = ET.fromstring(t)
    except ET.ParseError:
        lines = [l.strip().strip('"').strip() for l in t.split("\n") if l.strip()]
        return lines == ["RESULT"]
    if root.tag.split("}")[-1] != "DATA_DS":
        return False
    return all(not (e.text or "").strip() for e in root.iter() if e.tag.split("}")[-1] == "RESULT")


def parse_rows(decoded: str):
    """Rows from the decoded report output, or None when the output is not understood."""
    if not decoded or not decoded.strip():
        return None
    t = decoded.lstrip("﻿")
    for _ in range(3):
        rows = _extract_rowset(t)
        if rows is not None:
            return rows
        if "lt;ROWSET" not in t:
            break
        t = xml_unescape_once(t)
    if _empty_envelope(t):
        return []
    return None


def columns_of(rows: list) -> list:
    union, seen = [], set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                union.append(k)
    full = next((r for r in rows if len(r) == len(union)), None)
    return list(full.keys()) if full else union


class FusionRunner:
    def __init__(self, origin: str, user: str, password: str, report_path: str, service_path: str = "/xmlpserver/services/v2/ReportService",
                 timeout_s: int = 300, retries: int = 2, transport: httpx.BaseTransport | None = None):
        if not origin.lower().startswith("https://") and not origin.startswith("http://127.0.0.1") and not origin.startswith("http://localhost"):
            raise FusionError("Only HTTPS pod URLs are allowed.")
        if not user or not password:
            raise FusionError("Fusion credentials are not set on the pipeline server (console › Settings › Fusion, or `python -m pipeline_server set-fusion-password`).")
        self.url = origin.rstrip("/") + service_path
        self.user, self.password, self.report_path = user, password, report_path
        self.retries = max(0, retries)
        self.client = httpx.Client(timeout=timeout_s, transport=transport)

    def run(self, sql: str, row_limit: int = 5000) -> FusionResult:
        stmt = strip_sql(sql)
        err = check_read_only(stmt)
        if err:
            raise FusionError(err)
        b64 = base64.b64encode(capped_sql(stmt, max(1, row_limit)).encode()).decode()
        t0 = time.monotonic()
        last = None
        for attempt in range(self.retries + 1):
            try:
                rows = self._run_once(b64)
                return FusionResult(columns=columns_of(rows), rows=rows, elapsed_ms=int((time.monotonic() - t0) * 1000))
            except FusionError as e:
                last = e
                # ORA- errors are the SQL's fault - retrying does not help
                if "ORA-" in str(e) or attempt == self.retries:
                    raise
                time.sleep(2 * (attempt + 1))
        raise last  # pragma: no cover

    def _soap(self, b64: str, fmt: str) -> tuple[str | None, str | None, int]:
        env = build_envelope(self.report_path, self.user, self.password, b64, fmt)
        try:
            r = self.client.post(self.url, content=env.encode(), headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '"runReport"'})
        except httpx.TimeoutException:
            raise FusionError("Fusion did not answer in time (timeout). Narrow the query or lower the page size.")
        except httpx.HTTPError as e:
            raise FusionError(f"Network error: {e}")
        val, fault = read_soap(r.text)
        val = re.sub(r"\s", "", val) if val else None
        if not val and not fault and r.status_code >= 400:
            fault = f"HTTP {r.status_code}"
        return val, fault, r.status_code

    def _run_once(self, b64: str) -> list:
        val, fault, status = self._soap(b64, "xml")
        decoded = None
        rows = None
        if val:
            decoded = base64.b64decode(val).decode("utf-8", "replace")
            rows = parse_rows(decoded)
        if rows is None and fault is None:
            cval, cfault, cstatus = self._soap(b64, "csv")
            if cval:
                rows = parse_rows(base64.b64decode(cval).decode("utf-8", "replace"))
            elif not val:
                raise FusionError(cfault or f"HTTP {cstatus}")
        if rows is None:
            raise FusionError(fault or ("The runner report answered, but its output has no DBMS_XMLGEN ROWSET - redeploy the runner report "
                                        "from the WMS app (Fusion SQL › Connection)." if decoded else f"HTTP {status}"))
        return [{k: v for k, v in r.items() if k not in _ENVELOPE_KEYS} for r in rows]

    def close(self):
        self.client.close()

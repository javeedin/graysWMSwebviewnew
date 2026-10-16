import base64

import httpx
import pytest

from pipeline_server.fusion import FusionError, FusionRunner, build_envelope, capped_sql, parse_rows
from pipeline_server.sqlutil import check_read_only, lit, substitute_params


def soap(decoded: str) -> str:
    b = base64.b64encode(decoded.encode()).decode()
    return f'<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><ns:runReportResponse xmlns:ns="http://xmlns.oracle.com/oxp/service/v2"><ns:runReportReturn><ns:reportBytes>{b}</ns:reportBytes></ns:runReportReturn></ns:runReportResponse></env:Body></env:Envelope>'


ROWSET = "<ROWSET><ROW><ORDER_NUMBER>1001</ORDER_NUMBER><STATUS>CLOSED</STATUS><COUNT_x0028__x002A__x0029_>3</COUNT_x0028__x002A__x0029_></ROW><ROW><ORDER_NUMBER>1002</ORDER_NUMBER></ROW></ROWSET>"


def test_parse_escaped_rowset_inside_data_ds():
    escaped = ROWSET.replace("<", "&lt;").replace(">", "&gt;")
    rows = parse_rows(f"<?xml version='1.0'?><DATA_DS><G_1><RESULT>{escaped}</RESULT></G_1></DATA_DS>")
    assert rows == [{"ORDER_NUMBER": "1001", "STATUS": "CLOSED", "COUNT(*)": "3"}, {"ORDER_NUMBER": "1002"}]


def test_parse_empty_envelope_and_csv():
    assert parse_rows("<DATA_DS><G_1><RESULT></RESULT></G_1></DATA_DS>") == []
    csv = 'RESULT\n"' + ROWSET.replace('"', '""') + '"\n'
    assert parse_rows(csv)[0]["ORDER_NUMBER"] == "1001"
    assert parse_rows("<html>nope</html>") is None


def test_runner_end_to_end_with_fake_pod():
    seen = {}

    def handler(req: httpx.Request):
        body = req.content.decode()
        b64 = body.split("<v2:item>")[2].split("</v2:item>")[0]
        seen["sql"] = base64.b64decode(b64).decode()
        seen["soapaction"] = req.headers["SOAPAction"]
        if "BAD" in seen["sql"]:
            return httpx.Response(500, text='<e:Envelope xmlns:e="http://schemas.xmlsoap.org/soap/envelope/"><e:Body><e:Fault><faultstring>ORA-00942: table or view does not exist</faultstring></e:Fault></e:Body></e:Envelope>')
        return httpx.Response(200, text=soap("<DATA_DS><G_1><RESULT>" + ROWSET.replace("<", "&lt;").replace(">", "&gt;") + "</RESULT></G_1></DATA_DS>"))

    r = FusionRunner("https://pod.example.com", "u", "p", "/Custom/GraysWMS/QueryRunner.xdo", transport=httpx.MockTransport(handler), retries=1)
    res = r.run("select order_number from doo_headers_all;", 500)
    assert seen["sql"] == "SELECT * FROM (\nselect order_number from doo_headers_all\n) WHERE ROWNUM <= 500"
    assert seen["soapaction"] == '"runReport"'
    assert res.columns == ["ORDER_NUMBER", "STATUS", "COUNT(*)"] and len(res.rows) == 2
    with pytest.raises(FusionError, match="ORA-00942"):
        r.run("SELECT * FROM BAD", 10)
    with pytest.raises(FusionError, match="SELECT / WITH"):
        r.run("DELETE FROM x", 1)


def test_envelope_escapes_credentials():
    env = build_envelope("/Custom/a&b.xdo", "user<x>", "p&ss", "QUJD")
    assert "user&lt;x&gt;" in env and "p&amp;ss" in env and "/Custom/a&amp;b.xdo" in env
    assert capped_sql("select 1 from dual -- x", 5).endswith("-- x\n) WHERE ROWNUM <= 5")


def test_params_like_the_app():
    sql = "SELECT * FROM t WHERE d >= {{P_FROM}} AND s = {{P_STATUS}} AND n = {{P_N}} AND x = '{{P_FROM}}' -- {{P_FROM}}\nAND w > {{WATERMARK}} AND e = TO_DATE({{P_TXT}}, 'DD/MM')"
    out = substitute_params(sql, {"p_from": "2026-09-30", "P_STATUS": "O'PEN", "P_N": "42", "P_TXT": "30/09"})
    assert "d >= DATE '2026-09-30'" in out and "s = 'O''PEN'" in out and "n = 42" in out
    assert "x = '{{P_FROM}}'" in out and "-- {{P_FROM}}" in out          # strings and comments untouched
    assert "{{WATERMARK}}" in out and "TO_DATE('30/09', 'DD/MM')" in out
    assert substitute_params("a = {{MISSING}}", {}) == "a = NULL"
    assert check_read_only("  -- hi\n WITH x AS (SELECT 1 FROM dual) SELECT * FROM x") is None
    assert check_read_only("UPDATE t SET a = 1")
    assert check_read_only("WITH FUNCTION f RETURN 1 IS BEGIN RETURN 1; END; SELECT f FROM dual")
    assert lit("it's") == "'it''s'" and lit(None) == "NULL" and lit(5) == "5"

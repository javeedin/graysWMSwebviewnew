-- ============================================================================
-- 99  Fusion Debtors Control — statements, who got them, and the customer CRM
-- Tip: the page creates all of this itself — Setup › Database objects › Create missing (APEX execute API).
-- ============================================================================
-- The page (debtors/index.html) creates the tables on first use (debtors/dc-store.js S.DDL); Setup › Customer links
-- creates parts 3–5 through ai/executewrite. Run this script in SQL Developer when that is not allowed.
--
--   WMS_DC_SETTINGS   business units, balances source (BI Publisher report or Fusion SQL), statement report, e-mail template
--   WMS_DC_CUSTOMERS  the customer card: statement e-mail / cc, delivery (EMAIL | POST | NONE), collector, phone, tags, notes, hold
--   WMS_DC_RUNS       one row per statement run (BU, statement date, counts, who, which PC, mailbox)
--   WMS_DC_STMTS      one row per statement: customer, balance + aging, To / Cc, subject, PDF name + SHA-256, status
--                     GENERATED | SENT | DRAFT | POSTED | SKIPPED | FAILED, method + mailbox, sent_at, and what happened after:
--                     opened (tracking picture), delivered / read / bounced (receipts), the customer's answer AGREED / DISPUTED
--   WMS_DC_ACTIVITY   the CRM timeline: NOTE, CALL, EMAIL, VISIT, PROMISE (amount + date), DISPUTE, CONFIRM, TASK, HOLD
--
-- Customer links (one random token per statement):
--   …/WAREHOUSEMANAGEMENT/dc/px/<token>    1×1 picture → opened
--   …/WAREHOUSEMANAGEMENT/dc/resp/<token>  "Does this balance agree with your records?" — Agree / Query + a comment;
--                                          the answer is a POST (a form), so link scanners never answer for the customer
-- ============================================================================

-- 1. Tables ---------------------------------------------------------------------
CREATE TABLE wms_dc_settings (
    skey          VARCHAR2(60) PRIMARY KEY,         -- BUS, GENERAL
    sval          CLOB,                              -- JSON
    changed_by    VARCHAR2(100),
    changed_date  DATE DEFAULT SYSDATE
);

CREATE TABLE wms_dc_customers (
    bu_id          VARCHAR2(30)  NOT NULL,
    account_number VARCHAR2(60)  NOT NULL,
    account_name   VARCHAR2(360),
    stmt_to        VARCHAR2(1000),                   -- statement e-mail (wins over Fusion's)
    stmt_cc        VARCHAR2(1000),
    delivery       VARCHAR2(10),                     -- EMAIL | POST | NONE (blank = from Fusion)
    owner_user     VARCHAR2(100),                    -- collector
    phone          VARCHAR2(100),
    contact_name   VARCHAR2(200),
    tags           VARCHAR2(400),
    notes          VARCHAR2(4000),
    on_hold        VARCHAR2(1) DEFAULT 'N',
    changed_by     VARCHAR2(100),
    changed_date   DATE DEFAULT SYSDATE,
    CONSTRAINT wms_dc_customers_pk PRIMARY KEY (bu_id, account_number)
);

CREATE TABLE wms_dc_runs (
    run_id        VARCHAR2(40) PRIMARY KEY,
    pod           VARCHAR2(20),
    bu_id         VARCHAR2(30),
    bu_name       VARCHAR2(240),
    stmt_date     VARCHAR2(10),                      -- YYYY-MM-DD
    title         VARCHAR2(300),
    customers     NUMBER,
    emailed       NUMBER DEFAULT 0,
    posted        NUMBER DEFAULT 0,
    failed        NUMBER DEFAULT 0,
    skipped       NUMBER DEFAULT 0,
    total_balance NUMBER,
    status        VARCHAR2(20),                      -- RUNNING | DONE | STOPPED
    method        VARCHAR2(20),                      -- OUTLOOK | GRAPH | SMTP
    mailbox       VARCHAR2(320),
    source_kind   VARCHAR2(10),                      -- BIP | SQL
    app_user      VARCHAR2(100),
    machine       VARCHAR2(100),
    started_at    DATE DEFAULT SYSDATE,
    finished_at   DATE,
    note          VARCHAR2(1000)
);

CREATE TABLE wms_dc_stmts (
    stmt_id        VARCHAR2(40) PRIMARY KEY,
    run_id         VARCHAR2(40),
    pod            VARCHAR2(20),
    bu_id          VARCHAR2(30),
    bu_name        VARCHAR2(240),
    company        VARCHAR2(200),
    account_number VARCHAR2(60),
    account_name   VARCHAR2(360),
    stmt_date      VARCHAR2(10),
    currency       VARCHAR2(10),
    balance        NUMBER,
    overdue        NUMBER,
    aging_json     VARCHAR2(1000),
    delivery       VARCHAR2(10),
    email_to       VARCHAR2(1000),
    email_cc       VARCHAR2(1000),
    subject        VARCHAR2(400),
    file_name      VARCHAR2(300),
    file_path      VARCHAR2(600),                    -- on the PC that made it (machine)
    sha256         VARCHAR2(64),                     -- fingerprint of the PDF that was attached
    bytes_n        NUMBER,
    status         VARCHAR2(20),
    error_text     VARCHAR2(2000),
    method         VARCHAR2(20),
    mailbox        VARCHAR2(320),
    app_user       VARCHAR2(100),
    machine        VARCHAR2(100),
    created_at     DATE DEFAULT SYSDATE,
    generated_at   DATE,
    sent_at        DATE,
    token          VARCHAR2(64),
    tracked        VARCHAR2(1) DEFAULT 'N',
    opens          NUMBER DEFAULT 0,
    first_open     DATE,
    last_open      DATE,
    last_agent     VARCHAR2(400),
    delivered_at   DATE,
    read_at        DATE,
    bounced_at     DATE,
    bounce_text    VARCHAR2(1000),
    resp_status    VARCHAR2(20),                     -- AGREED | DISPUTED
    resp_comment   VARCHAR2(2000),
    resp_at        DATE,
    resp_agent     VARCHAR2(400),
    resent_of      VARCHAR2(40)                      -- a resend points to the statement it repeats
);
CREATE INDEX wms_dc_stmts_acct ON wms_dc_stmts (bu_id, account_number);
CREATE INDEX wms_dc_stmts_tok  ON wms_dc_stmts (token);
CREATE INDEX wms_dc_stmts_run  ON wms_dc_stmts (run_id);

CREATE TABLE wms_dc_activity (
    act_id         VARCHAR2(40) PRIMARY KEY,
    bu_id          VARCHAR2(30),
    account_number VARCHAR2(60),
    account_name   VARCHAR2(360),
    kind           VARCHAR2(20),                     -- NOTE | CALL | EMAIL | VISIT | PROMISE | DISPUTE | CONFIRM | TASK | HOLD
    subject        VARCHAR2(400),
    body           VARCHAR2(4000),
    amount         NUMBER,                           -- promise to pay / disputed amount
    due_date       DATE,                             -- promise date / follow-up date
    status         VARCHAR2(20) DEFAULT 'OPEN',      -- OPEN | DONE | KEPT | BROKEN | RESOLVED | CANCELLED
    ref_id         VARCHAR2(40),                     -- the statement it is about
    source         VARCHAR2(20) DEFAULT 'USER',      -- USER | CUSTOMER (from the agree / query page) | SYSTEM
    assigned_to    VARCHAR2(100),
    created_by     VARCHAR2(100),
    created_at     DATE DEFAULT SYSDATE,
    done_by        VARCHAR2(100),
    done_at        DATE,
    outcome        VARCHAR2(1000)
);
CREATE INDEX wms_dc_act_acct ON wms_dc_activity (bu_id, account_number);

-- 1b. Statement cycles (one business unit × one month: checklist → archive → statement check → send → close) --------
ALTER TABLE wms_dc_stmts ADD (cycle_id VARCHAR2(40));     -- the page adds these to older tables itself
ALTER TABLE wms_dc_runs  ADD (cycle_id VARCHAR2(40));

CREATE TABLE wms_dc_cycles (
    cycle_id     VARCHAR2(40) PRIMARY KEY,
    pod          VARCHAR2(20),
    bu_id        VARCHAR2(30),
    bu_name      VARCHAR2(240),
    period       VARCHAR2(7),                      -- YYYY-MM
    stmt_date    VARCHAR2(10),                     -- the statement date (month end)
    title        VARCHAR2(300),
    status       VARCHAR2(20),                     -- OPEN | CHECKED | ARCHIVED | READY | SENDING | CLOSED
    owner_user   VARCHAR2(100),
    due_date     VARCHAR2(10),
    tolerance    NUMBER,                           -- OM vs AR amount tolerance
    note         VARCHAR2(2000),
    created_by   VARCHAR2(100),
    created_at   DATE DEFAULT SYSDATE,
    checks_at DATE, checks_by VARCHAR2(100), checks_score NUMBER,
    snap_at DATE, snap_by VARCHAR2(100), snap_source VARCHAR2(10),
    customers NUMBER, total_due NUMBER, owed NUMBER, overdue NUMBER, cur_amt NUMBER, d30 NUMBER, d60 NUMBER, d90 NUMBER, d90p NUMBER,
    credit_n NUMBER, credit_amt NUMBER, email_n NUMBER, post_n NUMBER, none_n NUMBER, items_n NUMBER,
    new_n NUMBER, cleared_n NUMBER, up_n NUMBER, down_n NUMBER, prev_total NUMBER,   -- movement against the previous cycle
    stmt_path VARCHAR2(1000), stmt_dm VARCHAR2(1000), stmt_sha VARCHAR2(64), stmt_changed VARCHAR2(1),
    stmt_sql CLOB,                                  -- the statement report's data-model SQL, as it was when checked
    stmt_def CLOB,                                  -- its report definition (JSON)
    review_at DATE, review_by VARCHAR2(100), review_note VARCHAR2(2000),
    sent_n NUMBER, posted_n NUMBER, failed_n NUMBER, cover_pct NUMBER,
    closed_at DATE, closed_by VARCHAR2(100), close_note VARCHAR2(2000),
    CONSTRAINT wms_dc_cycles_uk UNIQUE (pod, bu_id, period)
);

CREATE TABLE wms_dc_cycle_checks (
    cycle_id    VARCHAR2(40) NOT NULL,
    check_id    VARCHAR2(40) NOT NULL,
    title       VARCHAR2(300),
    area        VARCHAR2(60),
    severity    VARCHAR2(10),                      -- BLOCK | WARN
    kind        VARCHAR2(10),                      -- SQL | BIP | LOCAL
    status      VARCHAR2(20),                      -- PASS | FAIL | ERROR
    rows_n      NUMBER,
    amount      NUMBER,
    ms          NUMBER,
    error_text  VARCHAR2(2000),
    sql_text    CLOB,                              -- what ran
    sample_json CLOB,                              -- the first 50 exception rows
    ran_at DATE, ran_by VARCHAR2(100),
    bypass_note VARCHAR2(2000), bypass_by VARCHAR2(100), bypass_at DATE,   -- a failure let through, with why and who
    CONSTRAINT wms_dc_cycle_checks_pk PRIMARY KEY (cycle_id, check_id)
);

CREATE TABLE wms_dc_cycle_bal (                    -- the archived balance of every customer of the cycle
    cycle_id VARCHAR2(40) NOT NULL, account_number VARCHAR2(60) NOT NULL, account_name VARCHAR2(360), currency VARCHAR2(10),
    balance NUMBER, overdue NUMBER, cur_amt NUMBER, d30 NUMBER, d60 NUMBER, d90 NUMBER, d90p NUMBER, items_n NUMBER,
    email VARCHAR2(1000), delivery VARCHAR2(10), why VARCHAR2(400), score NUMBER, prev_balance NUMBER,
    CONSTRAINT wms_dc_cycle_bal_pk PRIMARY KEY (cycle_id, account_number)
);

CREATE TABLE wms_dc_cycle_events (                 -- the cycle's audit trail
    event_id VARCHAR2(40) PRIMARY KEY, cycle_id VARCHAR2(40), event VARCHAR2(40), detail VARCHAR2(2000), by_user VARCHAR2(100), event_at DATE DEFAULT SYSDATE
);

-- 2. The 1×1 transparent GIF of the tracking picture --------------------------------
CREATE TABLE wms_dc_gif (id NUMBER PRIMARY KEY, gif BLOB);
INSERT INTO wms_dc_gif (id, gif) VALUES (1, TO_BLOB(HEXTORAW('47494638396101000100800000FFFFFF00000021F90401000000002C00000000010001000002024401003B')));
COMMIT;

-- 3. The picture: count the open, answer with the GIF -------------------------------
CREATE OR REPLACE PROCEDURE wms_dc_px (p_tok IN VARCHAR2) AS
    v_gif BLOB;
    v_ua  VARCHAR2(400);
BEGIN
    BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END;
    IF p_tok IS NOT NULL AND LENGTH(p_tok) BETWEEN 16 AND 64 THEN
        UPDATE wms_dc_stmts SET opens = NVL(opens, 0) + 1, first_open = NVL(first_open, SYSDATE), last_open = SYSDATE, last_agent = v_ua WHERE token = p_tok;
        COMMIT;
    END IF;
    SELECT gif INTO v_gif FROM wms_dc_gif WHERE id = 1;
    OWA_UTIL.mime_header('image/gif', FALSE);
    HTP.p('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    HTP.p('Pragma: no-cache');
    OWA_UTIL.http_header_close;
    WPG_DOCLOAD.download_file(v_gif);
END wms_dc_px;
/

-- 4. The customer's page: GET shows the balance with Agree / Query, POST records the answer -------
CREATE OR REPLACE PROCEDURE wms_dc_resp (p_tok IN VARCHAR2, p_post IN VARCHAR2, p_choice IN VARCHAR2, p_note IN VARCHAR2) AS
    v_id VARCHAR2(40); v_company VARCHAR2(200); v_name VARCHAR2(360); v_acct VARCHAR2(60); v_date VARCHAR2(10); v_cur VARCHAR2(10);
    v_bal NUMBER; v_bu VARCHAR2(30); v_resp VARCHAR2(20); v_at DATE; v_ua VARCHAR2(400); v_choice VARCHAR2(20);
    PROCEDURE page (p_body IN VARCHAR2) IS
    BEGIN
        OWA_UTIL.mime_header('text/html', FALSE, 'UTF-8');
        HTP.p('Cache-Control: no-store');
        OWA_UTIL.http_header_close;
        HTP.p('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Statement of account</title>' ||
              '<style>body{margin:0;font:15px/1.5 "Segoe UI",Arial,sans-serif;background:#eef2f7;color:#0f172a}.c{max-width:560px;margin:7vh auto;background:#fff;border-radius:14px;padding:30px 34px;box-shadow:0 10px 30px rgba(15,23,42,.1)}' ||
              'h1{font-size:21px;margin:0 0 4px}.m{color:#64748b;font-size:13px}.bal{font-size:26px;font-weight:700;margin:14px 0}textarea{width:100%;box-sizing:border-box;min-height:90px;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit}' ||
              '.b{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}button{border:0;border-radius:9px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;color:#fff}.ag{background:#15803d}.di{background:#b45309}.ok{color:#15803d;font-weight:700;font-size:17px}.f{margin-top:22px;font-size:12px;color:#94a3b8}</style></head><body><div class="c">');
        HTP.p(p_body);
        HTP.p('<div class="f">' || HTF.escape_sc(v_company) || ' · Accounts Receivable</div></div></body></html>');
    END;
BEGIN
    BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END;
    BEGIN
        SELECT stmt_id, company, account_name, account_number, stmt_date, currency, balance, bu_id, resp_status, resp_at
          INTO v_id, v_company, v_name, v_acct, v_date, v_cur, v_bal, v_bu, v_resp, v_at
          FROM wms_dc_stmts WHERE token = p_tok AND LENGTH(p_tok) >= 16;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        page('<h1>This link is not valid</h1><p class="m">It may have been copied incompletely. Please use the button in the e-mail.</p>');
        RETURN;
    END;
    v_choice := CASE UPPER(p_choice) WHEN 'AGREE' THEN 'AGREED' WHEN 'DISPUTE' THEN 'DISPUTED' ELSE NULL END;
    IF p_post = 'Y' AND v_resp IS NULL AND v_choice IS NOT NULL THEN
        UPDATE wms_dc_stmts SET resp_status = v_choice, resp_comment = SUBSTR(p_note, 1, 2000), resp_at = SYSDATE, resp_agent = v_ua,
               opens = GREATEST(NVL(opens, 0), 1), first_open = NVL(first_open, SYSDATE)
         WHERE stmt_id = v_id;
        INSERT INTO wms_dc_activity (act_id, bu_id, account_number, account_name, kind, subject, body, amount, status, ref_id, source, created_by, created_at)
        VALUES ('cu' || LOWER(RAWTOHEX(SYS_GUID())), v_bu, v_acct, v_name, CASE v_choice WHEN 'AGREED' THEN 'CONFIRM' ELSE 'DISPUTE' END,
                CASE v_choice WHEN 'AGREED' THEN 'Customer agreed the balance as at ' || v_date ELSE 'Customer disputes the balance as at ' || v_date END,
                SUBSTR(p_note, 1, 4000), v_bal, CASE v_choice WHEN 'AGREED' THEN 'DONE' ELSE 'OPEN' END, v_id, 'CUSTOMER', 'customer', SYSDATE);
        COMMIT;
        v_resp := v_choice; v_at := SYSDATE;
    END IF;
    IF v_resp IS NULL THEN
        page('<div class="m">' || HTF.escape_sc(v_company) || '</div><h1>Statement of account as at ' || HTF.escape_sc(v_date) || '</h1>' ||
             '<p class="m">' || HTF.escape_sc(v_name) || ' · account ' || HTF.escape_sc(v_acct) || '</p><div class="bal">' || HTF.escape_sc(v_cur) || ' ' || TO_CHAR(v_bal, 'FM999G999G999G990D00') || '</div>' ||
             '<form method="post"><p>Does this balance agree with your records?</p><textarea name="note" maxlength="2000" placeholder="Optional: tell us what differs (invoice numbers, payments, credit notes …)"></textarea>' ||
             '<div class="b"><button class="ag" type="submit" name="choice" value="AGREE">&#10003; Yes, I agree with the balance</button><button class="di" type="submit" name="choice" value="DISPUTE">I want to query this balance</button></div></form>');
    ELSE
        page('<div class="m">' || HTF.escape_sc(v_company) || '</div><h1>Statement of account as at ' || HTF.escape_sc(v_date) || '</h1>' ||
             '<p class="ok">&#10003; Thank you — ' || CASE v_resp WHEN 'AGREED' THEN 'you agreed the balance' ELSE 'your query has been passed to our accounts team' END || '</p>' ||
             '<p class="m">' || HTF.escape_sc(v_name) || ' · ' || TO_CHAR(v_at, 'DD Mon YYYY HH24:MI') || '</p>');
    END IF;
END wms_dc_resp;
/

-- 5. ORDS endpoints (the module of ai/executequery, found by its URI prefix) ----------
DECLARE
    v_module VARCHAR2(200);
BEGIN
    SELECT name INTO v_module FROM user_ords_modules WHERE UPPER(uri_prefix) LIKE '%WAREHOUSEMANAGEMENT%' AND ROWNUM = 1;
    ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'dc/px/:tok');
    ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'dc/px/:tok', p_method => 'GET',
        p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_dc_px(:tok); END;');
    ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'dc/resp/:tok');
    ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'dc/resp/:tok', p_method => 'GET',
        p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_dc_resp(:tok, ''N'', NULL, NULL); END;');
    ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'dc/resp/:tok', p_method => 'POST',
        p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_dc_resp(:tok, ''Y'', :choice, :note); END;');
    COMMIT;
END;
/

-- 6. Check ----------------------------------------------------------------------------
-- SELECT name, type, line, text FROM user_errors WHERE name LIKE 'WMS_DC%' ORDER BY name, sequence;
-- Open …/WAREHOUSEMANAGEMENT/dc/resp/0000000000000000 in a browser: "This link is not valid" = the endpoint works.
-- Statements of one customer:
-- SELECT stmt_date, status, email_to, TO_CHAR(sent_at, 'YYYY-MM-DD HH24:MI') sent, opens, resp_status, resp_comment
--   FROM wms_dc_stmts WHERE account_number = :acct ORDER BY created_at DESC;

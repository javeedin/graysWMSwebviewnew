-- ============================================================================
-- 95  Finance Lens — board pack distribution & e-mail tracking
-- ============================================================================
-- Every board pack e-mailed from Finance Lens (finance/fin-mail.js) is recorded here: one row per send and one per
-- recipient. With tracking on, each recipient gets their own copy carrying
--   * a 1×1 picture  …/WAREHOUSEMANAGEMENT/pack/px/<token>   → opened (when the mail client shows pictures)
--   * a button       …/WAREHOUSEMANAGEMENT/pack/ack/<token>  → a page with "I have received the board pack";
--                     the confirmation is a POST (a form), so link scanners that only open the link do not confirm it
-- Read receipts, delivery receipts and bounces come back to the sending mailbox and are matched by the app
-- (Board packs › Distribution › Check receipts — Microsoft 365 / Outlook).
-- The tables are also created by the page on first use; the procedures and the ORDS endpoints need this script
-- (Board packs › Distribution › Set up tracking runs parts 2–4 through ai/executewrite, else run it in SQL Developer).
-- ============================================================================

-- 1. Tables ---------------------------------------------------------------------
CREATE TABLE wms_fin_pack_sends (
    send_id      VARCHAR2(40)   NOT NULL,          -- = the document ID of the copy (BP-yyyymmdd-XXXX)
    doc_id       VARCHAR2(40),
    pack_id      VARCHAR2(60),
    pack_name    VARCHAR2(200),
    title        VARCHAR2(300),
    company      VARCHAR2(200),
    period       VARCHAR2(40),
    ledgers      VARCHAR2(400),
    subject      VARCHAR2(400),
    method       VARCHAR2(20),                      -- OUTLOOK | GRAPH | SMTP
    mailbox      VARCHAR2(320),                     -- who it was sent from
    app_user     VARCHAR2(100),
    machine      VARCHAR2(100),
    sent_at      DATE DEFAULT SYSDATE,
    file_name    VARCHAR2(300),
    sha256       VARCHAR2(64),
    tracked      CHAR(1) DEFAULT 'N',
    receipts     CHAR(1) DEFAULT 'N',
    recipients   NUMBER,
    note         VARCHAR2(1000),
    CONSTRAINT wms_fin_pack_sends_pk PRIMARY KEY (send_id)
);

CREATE TABLE wms_fin_pack_rcpt (
    token         VARCHAR2(64)   NOT NULL,         -- random, one per recipient copy
    send_id       VARCHAR2(40)   NOT NULL,
    email         VARCHAR2(320)  NOT NULL,
    kind          VARCHAR2(4),                      -- TO | CC | BCC | ALL (one message for everyone)
    status        VARCHAR2(20),                     -- PENDING | SENT | DRAFT | FAILED
    error_text    VARCHAR2(1000),
    sent_at       DATE,
    delivered_at  DATE,
    bounced_at    DATE,
    bounce_text   VARCHAR2(1000),
    read_at       DATE,                             -- read receipt
    not_read_at   DATE,                             -- deleted unread (receipt)
    opens         NUMBER DEFAULT 0,                 -- tracking picture
    first_open    DATE,
    last_open     DATE,
    last_agent    VARCHAR2(400),
    ack_at        DATE,                             -- "I have received it"
    ack_agent     VARCHAR2(400),
    CONSTRAINT wms_fin_pack_rcpt_pk PRIMARY KEY (token)
);
CREATE INDEX wms_fin_pack_rcpt_send ON wms_fin_pack_rcpt (send_id);
CREATE INDEX wms_fin_pack_rcpt_mail ON wms_fin_pack_rcpt (email);

-- the 1×1 transparent GIF served by the picture link
CREATE TABLE wms_fin_pack_gif (id NUMBER PRIMARY KEY, gif BLOB);
INSERT INTO wms_fin_pack_gif (id, gif) VALUES (1, TO_BLOB(HEXTORAW('47494638396101000100800000FFFFFF00000021F90401000000002C00000000010001000002024401003B')));
COMMIT;

-- 2. The picture: count the open, answer with the GIF -----------------------------
CREATE OR REPLACE PROCEDURE wms_fin_pack_px (p_tok IN VARCHAR2) AS
    v_gif BLOB;
    v_ua  VARCHAR2(400);
BEGIN
    BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END;
    IF p_tok IS NOT NULL AND LENGTH(p_tok) BETWEEN 16 AND 64 THEN
        UPDATE wms_fin_pack_rcpt
           SET opens = NVL(opens, 0) + 1, first_open = NVL(first_open, SYSDATE), last_open = SYSDATE, last_agent = v_ua
         WHERE token = p_tok;
        COMMIT;
    END IF;
    SELECT gif INTO v_gif FROM wms_fin_pack_gif WHERE id = 1;
    OWA_UTIL.mime_header('image/gif', FALSE);
    HTP.p('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    HTP.p('Pragma: no-cache');
    OWA_UTIL.http_header_close;
    WPG_DOCLOAD.download_file(v_gif);
END wms_fin_pack_px;
/

-- 3. The confirmation page: GET shows the button, POST records it ----------------
CREATE OR REPLACE PROCEDURE wms_fin_pack_ack (p_tok IN VARCHAR2, p_post IN VARCHAR2) AS
    v_email VARCHAR2(320); v_title VARCHAR2(300); v_company VARCHAR2(200); v_period VARCHAR2(40); v_doc VARCHAR2(40); v_ack DATE; v_ua VARCHAR2(400);
    PROCEDURE page (p_body IN VARCHAR2) IS
    BEGIN
        OWA_UTIL.mime_header('text/html', FALSE, 'UTF-8');
        HTP.p('Cache-Control: no-store');
        OWA_UTIL.http_header_close;
        HTP.p('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Board pack</title>' ||
              '<style>body{margin:0;font:15px/1.5 "Segoe UI",Arial,sans-serif;background:#eef1f7;color:#0f172a}.c{max-width:520px;margin:8vh auto;background:#fff;border-radius:14px;padding:30px 34px;box-shadow:0 10px 30px rgba(15,23,42,.1)}' ||
              'h1{font-size:21px;margin:0 0 6px}.m{color:#64748b;font-size:13px}button{margin-top:18px;background:#1d4ed8;color:#fff;border:0;border-radius:9px;padding:12px 20px;font:inherit;font-weight:700;cursor:pointer}' ||
              '.ok{color:#15803d;font-weight:700;font-size:17px}.f{margin-top:22px;font-size:12px;color:#94a3b8}</style></head><body><div class="c">');
        HTP.p(p_body);
        HTP.p('<div class="f">Finance Lens · Powered by Fusion Client</div></div></body></html>');
    END;
BEGIN
    BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END;
    BEGIN
        SELECT r.email, s.title, s.company, s.period, s.doc_id, r.ack_at
          INTO v_email, v_title, v_company, v_period, v_doc, v_ack
          FROM wms_fin_pack_rcpt r JOIN wms_fin_pack_sends s ON s.send_id = r.send_id
         WHERE r.token = p_tok;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        page('<h1>This link is not valid</h1><p class="m">It may have been copied incompletely. Please use the button in the e-mail.</p>');
        RETURN;
    END;
    IF p_post = 'Y' AND v_ack IS NULL THEN
        UPDATE wms_fin_pack_rcpt SET ack_at = SYSDATE, ack_agent = v_ua WHERE token = p_tok;
        COMMIT;
        v_ack := SYSDATE;
    END IF;
    IF v_ack IS NULL THEN
        page('<div class="m">' || HTF.escape_sc(v_company) || '</div><h1>' || HTF.escape_sc(v_title) || ' · ' || HTF.escape_sc(v_period) || '</h1>' ||
             '<p>Please confirm that you (' || HTF.escape_sc(v_email) || ') have received this board pack.</p><p class="m">Document ' || HTF.escape_sc(v_doc) || '</p>' ||
             '<form method="post"><button type="submit">I have received the board pack</button></form>');
    ELSE
        page('<div class="m">' || HTF.escape_sc(v_company) || '</div><h1>' || HTF.escape_sc(v_title) || ' · ' || HTF.escape_sc(v_period) || '</h1>' ||
             '<p class="ok">&#10003; Thank you — receipt confirmed</p><p class="m">' || HTF.escape_sc(v_email) || ' · ' || TO_CHAR(v_ack, 'DD Mon YYYY HH24:MI') || ' · document ' || HTF.escape_sc(v_doc) || '</p>');
    END IF;
END wms_fin_pack_ack;
/

-- 4. ORDS endpoints (same module as ai/executequery — found by its URI prefix) -------
DECLARE
    v_module VARCHAR2(200);
BEGIN
    SELECT name INTO v_module FROM user_ords_modules WHERE UPPER(uri_prefix) LIKE '%WAREHOUSEMANAGEMENT%' AND ROWNUM = 1;
    ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'pack/px/:tok');
    ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'pack/px/:tok', p_method => 'GET',
        p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_fin_pack_px(:tok); END;');
    ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'pack/ack/:tok');
    ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'pack/ack/:tok', p_method => 'GET',
        p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_fin_pack_ack(:tok, ''N''); END;');
    ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'pack/ack/:tok', p_method => 'POST',
        p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_fin_pack_ack(:tok, ''Y''); END;');
    COMMIT;
END;
/

-- 5. Check ------------------------------------------------------------------------
-- SELECT name, type, line, text FROM user_errors WHERE name LIKE 'WMS_FIN_PACK%' ORDER BY name, sequence;
-- Open …/WAREHOUSEMANAGEMENT/pack/ack/0000000000000000 in a browser: "This link is not valid" = the endpoint works.
